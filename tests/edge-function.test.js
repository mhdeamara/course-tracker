// Tests for the Supabase Edge Function (supabase/functions/moodle-ical/index.ts), run in Node with a fake network:
//   node tests/edge-function.test.js      (Node 23.6+ reads TypeScript directly; on Node 22 add --experimental-strip-types)
'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');

const ENV = { url: 'https://proj.supabase.co', key: 'pub' };
const LINK = 'https://moodle26.technion.ac.il/calendar/export_execute.php?userid=1&authtoken=SECRET123&preset_what=all';
const ICS = 'BEGIN:VCALENDAR\r\nBEGIN:VEVENT\r\nUID:1@x\r\nSUMMARY:a\r\nDTSTART:20261210T100000Z\r\nEND:VEVENT\r\nEND:VCALENDAR\r\n';
let F;
test.before(async () => { F = await import('../supabase/functions/moodle-ical/index.ts'); });

const json = (body, status = 200) => new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });
/** A fake network: Supabase Auth, the feeds table, the rate-limit RPC and Moodle. `o` overrides answers. */
function net(o = {}) {
  const calls = [];
  const fn = async (url, init = {}) => {
    calls.push({ url, init });
    if (url.endsWith('/auth/v1/user')) return o.user || json({ id: 'user-1' });
    if (url.endsWith('/rpc/moodle_feed_get')) return o.feed || json(o.link === null ? null : (o.link || LINK));
    if (url.endsWith('/rpc/moodle_claim_fetch')) return o.claim || json(0);
    if (url.startsWith('https://moodle')) { if (o.moodle instanceof Error) throw o.moodle; return o.moodle || new Response(ICS, { status: 200 }); }
    throw new Error(`unexpected fetch ${url}`);
  };
  fn.calls = calls;
  return fn;
}
const req = (opts = {}) => new Request('https://proj.supabase.co/functions/v1/moodle-ical', {
  method: opts.method || 'POST',
  headers: Object.assign({ origin: 'https://mhdeamara.github.io', apikey: 'pub' }, opts.noAuth ? {} : { authorization: 'Bearer user-jwt' }),
  body: (opts.method || 'POST') === 'POST' ? '{}' : undefined,
});
async function run(o, r) {
  const fetchFn = net(o);
  const res = await F.handle(r || req(), ENV, fetchFn);
  const text = await res.text();
  assert.ok(!text.includes('SECRET123'), 'the link must never be in a response');
  return { res, body: text ? JSON.parse(text) : null, calls: fetchFn.calls };
}

test('happy path: returns the calendar, never the link; the table is read with the caller\'s token (RLS)', async () => {
  const { res, body, calls } = await run({});
  assert.equal(res.status, 200);
  assert.equal(body.ok, true);
  assert.equal(body.events, 1);
  assert.equal(body.host, 'moodle26.technion.ac.il');
  assert.match(body.ics, /BEGIN:VCALENDAR/);
  assert.equal(res.headers.get('access-control-allow-origin'), 'https://mhdeamara.github.io');
  assert.equal(res.headers.get('cache-control'), 'no-store');
  assert.equal(calls.find((c) => c.url.includes('moodle_feed_get')).init.headers.Authorization, 'Bearer user-jwt');
  const moodle = calls.find((c) => c.url === LINK);
  assert.equal(moodle.init.redirect, 'manual');
  assert.ok(moodle.init.signal, 'has a timeout');
});

test('CORS preflight, and wrong method', async () => {
  assert.equal((await F.handle(req({ method: 'OPTIONS' }), ENV, net())).status, 204);
  const { res, body } = await run({}, req({ method: 'GET' }));
  assert.equal(res.status, 405);
  assert.equal(body.error, 'method');
});

test('not signed in: no token, or Auth rejects it — nothing else is fetched', async () => {
  const a = await run({}, req({ noAuth: true }));
  assert.equal(a.res.status, 401);
  assert.equal(a.calls.length, 0);
  const b = await run({ user: json({ msg: 'bad jwt' }, 401) });
  assert.equal(b.body.error, 'not-signed-in');
  assert.equal(b.calls.length, 1);
});

test('no saved link (and it does not use up the rate limit)', async () => {
  const { res, body, calls } = await run({ link: null });
  assert.equal(res.status, 404);
  assert.equal(body.error, 'no-link');
  assert.ok(!calls.some((c) => c.url.includes('claim')));
});

test('allowlist: other hosts are never fetched (no open proxy, no SSRF)', async () => {
  for (const link of [
    'https://evil.com/calendar/export_execute.php?userid=1&authtoken=SECRET123',
    'https://moodle26.technion.ac.il.evil.com/calendar/export_execute.php?userid=1&authtoken=SECRET123',
    'http://moodle26.technion.ac.il/calendar/export_execute.php?userid=1&authtoken=SECRET123',
    'https://moodle26.technion.ac.il:444/calendar/export_execute.php?userid=1&authtoken=SECRET123',
    'https://169.254.169.254/calendar/export_execute.php?userid=1&authtoken=SECRET123',
    'https://moodle26.technion.ac.il/admin/index.php?userid=1&authtoken=SECRET123',
  ]) {
    const { res, body, calls } = await run({ link });
    assert.equal(res.status, 400, link);
    assert.equal(body.error, 'bad-link');
    assert.ok(calls.every((c) => c.url.startsWith(ENV.url)), `fetched outside Supabase for ${link}`);
  }
});

test('rate limit: says how long to wait, does not call Moodle', async () => {
  const { res, body, calls } = await run({ claim: json(184) });
  assert.equal(res.status, 429);
  assert.equal(body.error, 'rate-limit');
  assert.equal(body.retryAfter, 184);
  assert.ok(!calls.some((c) => c.url.startsWith('https://moodle')));
});

test('expired or regenerated link: redirect to login, an HTML error page, or 403', async () => {
  const a = await run({ moodle: new Response(null, { status: 303, headers: { location: 'https://moodle26.technion.ac.il/login/index.php' } }) });
  assert.equal(a.body.error, 'link-rejected');
  assert.match(a.body.message, /העתק אותו שוב/);
  assert.equal((await run({ moodle: new Response('<html>Invalid authentication token</html>', { status: 200 }) })).body.error, 'link-rejected');
  assert.equal((await run({ moodle: new Response('nope', { status: 403 }) })).body.error, 'link-rejected');
});

test('Moodle down, timeout, network error, too big', async () => {
  assert.equal((await run({ moodle: new Response('x', { status: 503 }) })).body.error, 'moodle-down');
  assert.equal((await run({ moodle: Object.assign(new Error('t'), { name: 'TimeoutError' }) })).body.error, 'timeout');
  assert.equal((await run({ moodle: new TypeError('dns') })).body.error, 'moodle-down');
  const r = await run({ moodle: new Response(`BEGIN:VCALENDAR\r\n${'X'.repeat(F.MAX_BYTES + 10)}`, { status: 200 }) });
  assert.equal(r.res.status, 413);
  assert.equal(r.body.error, 'too-big');
});

test('an empty calendar is fine (0 events), not an error', async () => {
  const { res, body } = await run({ moodle: new Response('BEGIN:VCALENDAR\r\nEND:VCALENDAR\r\n') });
  assert.equal(res.status, 200);
  assert.equal(body.events, 0);
});

test('unexpected failures leak the link neither in the response nor in the logs', async () => {
  const logs = [];
  const orig = console.error;
  console.error = (...a) => logs.push(a.join(' '));
  try {
    const { res, body } = await run({ feed: { ok: true, json: async () => { throw new Error(`boom ${LINK}`); } } });
    assert.equal(res.status, 500);
    assert.equal(body.error, 'server');
  } finally { console.error = orig; }
  assert.ok(logs.length && logs.every((l) => !l.includes('SECRET123')));
});

test('the function\'s link check agrees with the app\'s', () => {
  globalThis.window = undefined;
  require('../js/moodle.js');
  const Mo = globalThis.CT.moodle;
  [LINK, LINK.replace('moodle26', 'evil'), LINK.replace('https', 'http'), LINK.replace('authtoken=SECRET123', 'authtoken=')]
    .forEach((l) => assert.equal(F.checkLink(l) === null, Mo.checkLink(l) === null, l));
  assert.equal(F.checkLink(42), 'bad-link');
});

// Static checks on the storage rules (supabase/moodle.sql cannot run here; these keep its guarantees from drifting).
test('the link is stored only in Vault, through owner-only functions', () => {
  const fs = require('node:fs');
  const path = require('node:path');
  const sql = fs.readFileSync(path.join(__dirname, '..', 'supabase', 'moodle.sql'), 'utf8').replace(/--.*$/gm, '');
  assert.match(sql, /vault\.create_secret\(/);
  assert.match(sql, /drop column url/);
  assert.doesNotMatch(sql, /create table if not exists public\.moodle_feeds \([^;]*\burl\b/, 'no plain url column');
  for (const fn of ['moodle_feed_set', 'moodle_feed_get', 'moodle_feed_delete']) {
    assert.match(sql, new RegExp(String.raw`function public\.${fn}\([^)]*\)[\s\S]*?security definer[\s\S]*?auth\.uid\(\)`), `${fn} checks auth.uid()`);
    assert.match(sql, new RegExp(String.raw`revoke all on function public\.${fn}\([^)]*\)\s+from public, anon`), `${fn} not for anon`);
  }
  assert.match(sql, /revoke all on public\.moodle_feeds from anon, authenticated/);
  assert.doesNotMatch(sql, /service_role/);
  // the site saves and deletes, but never reads the decrypted link back
  const js = ['cloud.js', 'views/moodle.js', 'moodle.js'].map((f) => fs.readFileSync(path.join(__dirname, '..', 'js', f), 'utf8')).join('\n');
  assert.doesNotMatch(js, /moodle_feed_get/);
  assert.match(js, /rpc\/moodle_feed_set/);
  assert.match(js, /rpc\/moodle_feed_delete/);
});
