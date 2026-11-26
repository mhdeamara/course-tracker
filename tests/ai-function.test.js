// Tests for the AI Edge Function core (supabase/functions/ai/handler.ts), in Node with a fake Supabase and a fake Claude:
//   node tests/ai-function.test.js      (Node 23.6+ reads TypeScript directly; on Node 22 add --experimental-strip-types)
'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');

const ENV = { url: 'https://proj.supabase.co', anonKey: 'pub', serviceKey: 'sb_secret_SERVICEKEY' };
let H;
test.before(async () => { H = await import('../supabase/functions/ai/handler.ts'); });

const json = (body, status = 200) => new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });
/** Fake Supabase. o.begin: what ai_begin answers; o.user: the Auth answer; o.usageRow: today's ai_usage row. */
function supa(o = {}) {
  const calls = [];
  const fn = async (url, init = {}) => {
    calls.push({ url, init, body: init.body ? JSON.parse(init.body) : null });
    if (url.endsWith('/auth/v1/user')) return o.user || json({ id: 'user-1' });
    if (url.endsWith('/rpc/ai_begin')) return json(o.begin || { ok: true });
    if (url.endsWith('/rpc/ai_finish')) return new Response(null, { status: 204 });
    if (url.includes('/rest/v1/ai_usage')) return json(o.usageRow ? [o.usageRow] : []);
    throw new Error(`unexpected fetch ${url}`);
  };
  fn.calls = calls;
  return fn;
}
/** Fake Claude: records params; o.error throws { aiError }. */
function fakeClaude(o = {}) {
  const calls = [];
  return {
    calls,
    async create(params) {
      calls.push(params);
      if (o.error) throw { aiError: o.error };
      return { content: [{ type: 'text', text: 'OK' }], usage: o.usage || { input_tokens: 20, output_tokens: 2 }, stop_reason: 'end_turn' };
    },
  };
}
const req = (body = { action: 'usage' }, opts = {}) => new Request('https://proj.supabase.co/functions/v1/ai', {
  method: opts.method || 'POST',
  headers: Object.assign({ origin: 'https://mhdeamara.github.io', apikey: 'pub', 'content-type': 'application/json' },
    opts.noAuth ? {} : { authorization: 'Bearer user-jwt' }, opts.headers || {}),
  body: (opts.method || 'POST') === 'POST' ? (typeof body === 'string' ? body : JSON.stringify(body)) : undefined,
});
async function run(body, o = {}, reqOpts = {}) {
  const fetchFn = supa(o);
  const claude = o.noKey ? null : fakeClaude(o);
  const res = await H.handle(req(body, reqOpts), Object.assign({}, ENV, o.env || {}), { fetch: fetchFn, claude });
  const text = await res.text();
  assert.ok(!text.includes('SERVICEKEY'), 'the service key never appears in a response');
  return { res, body: text ? JSON.parse(text) : null, calls: fetchFn.calls, claude };
}

test('cost: per model, with cache writes and reads', () => {
  assert.equal(H.costOf('claude-haiku-5-5', { input_tokens: 1_000_000, output_tokens: 1_000_000 }), 0.6);
  assert.equal(H.costOf('claude-sonnet-5-5', { input_tokens: 10_000, output_tokens: 3_000 }), 0.05);
  const cached = H.costOf('claude-opus-5-5', { input_tokens: 0, output_tokens: 0, cache_creation_input_tokens: 1_000_000, cache_read_input_tokens: 1_000_000 });
  assert.ok(Math.abs(cached - (1.25 * 4 + 0.1 * 4)) < 1e-9);
  assert.equal(H.costOf('unknown-model', { input_tokens: 5 }), 0);
});

test('model choice: only models from the fixed list, otherwise the default for the task', () => {
  assert.equal(H.pickModel('chat', 'claude-opus-5-5'), 'claude-opus-5-5');
  assert.equal(H.pickModel('chat', 'gpt-whatever'), 'claude-haiku-5-5');
  assert.equal(H.pickModel('extract', undefined), 'claude-sonnet-5-5');
});

test('not signed in: no token, or Auth rejects it — nothing else happens', async () => {
  const a = await run({ action: 'ping' }, {}, { noAuth: true });
  assert.equal(a.res.status, 401);
  assert.equal(a.calls.length, 0);
  assert.equal(a.claude.calls.length, 0);
  const b = await run({ action: 'ping' }, { user: json({}, 401) });
  assert.equal(b.body.error, 'not-signed-in');
  assert.equal(b.claude.calls.length, 0);
});

test('CORS preflight, wrong method, bad JSON, unknown action', async () => {
  assert.equal((await H.handle(req({}, { method: 'OPTIONS' }), ENV, { fetch: supa(), claude: null })).status, 204);
  assert.equal((await run({}, {}, { method: 'GET' })).res.status, 405);
  assert.equal((await run('{not json')).body.error, 'bad-request');
  assert.equal((await run({ action: 'drop-tables' })).body.error, 'bad-request');
  assert.equal((await run({ action: 'extract' })).body.error, 'not-yet'); // arrives in step B
});

test('too big: rejected before anything is read', async () => {
  const { res, body, calls } = await run({ action: 'ping' }, {}, { headers: { 'content-length': String(H.LIMITS.maxBodyBytes + 1) } });
  assert.equal(res.status, 413);
  assert.equal(body.error, 'too-big');
  assert.equal(calls.length, 0);
});

test('usage: read with the caller\'s own token (RLS), not counted, no AI call', async () => {
  const { res, body, calls, claude } = await run({ action: 'usage' }, { usageRow: { requests: 3, extracts: 1, cost_usd: '0.012300' } });
  assert.equal(res.status, 200);
  assert.deepEqual(body.today, { requests: 3, extracts: 1, costUsd: 0.0123 });
  assert.equal(body.limits.dailyCostUsd, 0.5);
  assert.equal(body.configured, true);
  const read = calls.find((c) => c.url.includes('/rest/v1/ai_usage'));
  assert.equal(read.init.headers.Authorization, 'Bearer user-jwt');
  assert.ok(!calls.some((c) => c.url.includes('/rpc/')));
  assert.equal(claude.calls.length, 0);
});

test('usage works without an API key and says so', async () => {
  const { body } = await run({ action: 'usage' }, { noKey: true });
  assert.equal(body.ok, true);
  assert.equal(body.configured, false);
});

test('ping without the secret → clear Hebrew message', async () => {
  const { res, body } = await run({ action: 'ping' }, { noKey: true });
  assert.equal(res.status, 503);
  assert.equal(body.error, 'ai-not-configured');
  assert.match(body.message, /ANTHROPIC_API_KEY/);
});

test('ping: counted before the call, cost recorded after, with the service key; cheap model and tiny output', async () => {
  const { res, body, calls, claude } = await run({ action: 'ping' }, { usage: { input_tokens: 30, output_tokens: 2 } });
  assert.equal(res.status, 200);
  assert.equal(body.model, 'claude-haiku-5-5');
  const order = calls.map((c) => c.url.split('/').pop());
  assert.deepEqual(order, ['user', 'ai_begin', 'ai_finish']);
  const beginCall = calls.find((c) => c.url.endsWith('ai_begin'));
  assert.equal(beginCall.init.headers.apikey, ENV.serviceKey);
  assert.equal(beginCall.body.p_user, 'user-1'); // the user comes from Auth, never from the request body
  assert.equal(beginCall.body.p_daily_cost, 0.5);
  const fin = calls.find((c) => c.url.endsWith('ai_finish')).body;
  assert.deepEqual([fin.p_input, fin.p_output], [30, 2]);
  assert.ok(Math.abs(fin.p_cost - (30 * 0.1 + 2 * 0.5) / 1e6) < 1e-12);
  assert.equal(claude.calls[0].model, 'claude-haiku-5-5');
  assert.ok(claude.calls[0].max_tokens <= 16);
});

test('the user id in the request body is ignored', async () => {
  const { calls } = await run({ action: 'ping', user: 'someone-else', p_user: 'someone-else' });
  assert.equal(calls.find((c) => c.url.endsWith('ai_begin')).body.p_user, 'user-1');
});

test('limits: per minute, daily cost, daily grade sheets — no AI call, Hebrew message', async () => {
  const a = await run({ action: 'ping' }, { begin: { ok: false, reason: 'per-minute', retry_after: 42 } });
  assert.equal(a.res.status, 429);
  assert.equal(a.body.retryAfter, 42);
  assert.equal(a.claude.calls.length, 0);
  const b = await run({ action: 'ping' }, { begin: { ok: false, reason: 'daily-cost' } });
  assert.equal(b.body.error, 'daily-cost');
  assert.match(b.body.message, /\$0\.50/);
  assert.equal(b.claude.calls.length, 0);
  const c = await run({ action: 'ping' }, { begin: { ok: false, reason: 'daily-extracts' } });
  assert.equal(c.body.error, 'daily-extracts');
});

test('Claude errors become clear codes; nothing is recorded as spent', async () => {
  for (const [err, status] of [['ai-key', 502], ['ai-busy', 429], ['ai-down', 503], ['ai-bad-request', 400]]) {
    const { res, body, calls } = await run({ action: 'ping' }, { error: err });
    assert.equal(body.error, err);
    assert.equal(res.status, status);
    assert.ok(!calls.some((c) => c.url.endsWith('ai_finish')));
  }
});

test('logs hold codes only — no content, no keys', async () => {
  const logs = [];
  const orig = console.log;
  console.log = (...a) => logs.push(a.join(' '));
  try {
    await run({ action: 'ping', secretNote: 'my private grade sheet text' });
    await run({ action: 'ping' }, { error: 'ai-key' });
  } finally { console.log = orig; }
  assert.ok(logs.length >= 2);
  assert.ok(logs.every((l) => !/private grade|SERVICEKEY|user-jwt/.test(l)), logs.join('\n'));
});
