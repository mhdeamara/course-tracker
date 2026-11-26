// Supabase Edge Function "moodle-ical": fetches Moodle calendar exports.
//
// Why a server at all: the browser cannot read Moodle's export directly (CORS), and the scheduled refresh has to run
// while the site is closed.
//
// Two ways in:
// A. "רענן עכשיו" — a signed-in user (JWT):
//   1. Checks the caller's JWT with Supabase Auth (only signed-in users; the token decides whose link is read).
//   2. Reads the caller's link with the caller's own token through public.moodle_feed_get(), which decrypts it from
//      Supabase Vault for auth.uid() only (no service_role key is used anywhere).
//   3. Rate limit: one Moodle fetch per user every 5 minutes (public.moodle_claim_fetch()).
//   4. Fetches (see below), stores the result as the user's snapshot (public.moodle_snapshot_save) and returns it.
// B. The schedule (pg_cron, every 2 hours) — header x-cron-secret, no user:
//   1. Asks public.moodle_cron_feeds(secret) for the links that are due. The SQL function checks the secret against
//      Vault; a wrong secret gets nothing.
//   2. Fetches each one and stores the result with public.moodle_cron_save(secret, …). Returns counts only.
// Fetching (both): only https://moodle<NN>.technion.ac.il/calendar/export_execute.php?… — never an open proxy, no
// SSRF: fixed host pattern, default port, no credentials in the URL, redirects are not followed. 10 s timeout, 2 MB cap,
// must really be an iCalendar file.
// Links are never logged and never sent back. Errors are short codes plus a Hebrew message.
//
// Dependency-free (plain fetch), so tests/edge-function.test.js runs handle() in Node with a fake fetch.

export const HOST_RE = /^moodle\d{0,2}\.technion\.ac\.il$/;
export const EXPORT_PATH = '/calendar/export_execute.php';
export const MAX_BYTES = 2 * 1024 * 1024;
export const TIMEOUT_MS = 10_000;
export const CRON_BUDGET_MS = 100_000; // stop starting new fetches after this, so one run stays well inside the limit
const ORIGINS = ['https://mhdeamara.github.io', 'http://127.0.0.1:8765', 'http://localhost:8765', 'null'];

export const MESSAGES: Record<string, string> = {
  'method': 'בקשה לא נתמכת',
  'not-signed-in': 'צריך להתחבר לאתר כדי לסנכרן מטלות ממודל',
  'no-link': 'עוד לא נשמר קישור לוח שנה של מודל. הדבק אותו בהגדרות',
  'bad-link': 'הקישור לא תקין. העתק אותו שוב במלואו ממודל (לוח שנה ← ייצוא לוח שנה ← קבל כתובת לוח שנה)',
  'link-rejected': 'מודל דחה את הקישור. העתק אותו שוב במלואו ממודל (לוח שנה ← ייצוא לוח שנה ← קבל כתובת לוח שנה) והדבק אותו בהגדרות',
  'moodle-down': 'מודל לא זמין כרגע. נסה שוב מאוחר יותר',
  'timeout': 'מודל לא ענה תוך 10 שניות. נסה שוב מאוחר יותר',
  'too-big': 'הקובץ שמודל החזיר גדול מדי. בחר במודל טווח זמן קצר יותר והפק קישור חדש',
  'rate-limit': 'רועננת לפני פחות מ-5 דקות. נסה שוב בעוד כמה דקות',
  'forbidden': 'אין הרשאה',
  'server': 'שגיאה בשרת הסנכרון. נסה שוב מאוחר יותר',
};

/** null when the link is an allowed Moodle calendar export address, else the error code. */
export function checkLink(raw: unknown): string | null {
  if (typeof raw !== 'string' || raw.length > 600) return 'bad-link';
  let u: URL;
  try { u = new URL(raw.trim()); } catch { return 'bad-link'; }
  if (u.protocol !== 'https:' || u.port !== '' || u.username !== '' || u.password !== '') return 'bad-link';
  if (!HOST_RE.test(u.hostname)) return 'bad-link';
  if (u.pathname !== EXPORT_PATH) return 'bad-link';
  if (!u.searchParams.get('authtoken') || !u.searchParams.get('userid')) return 'bad-link';
  return null;
}

type Env = { url: string; key: string };
type FetchFn = (input: string, init?: RequestInit) => Promise<Response>;
type Fetched = { ok: true; ics: string; events: number; hash: string } | { ok: false; error: string; status: number };

function cors(req: Request): Record<string, string> {
  const origin = req.headers.get('origin') || '';
  return {
    'Access-Control-Allow-Origin': ORIGINS.includes(origin) ? origin : ORIGINS[0],
    'Access-Control-Allow-Methods': 'POST, OPTIONS',
    'Access-Control-Allow-Headers': 'authorization, apikey, content-type, x-client-info',
    'Access-Control-Max-Age': '86400',
    'Vary': 'Origin',
  };
}

function reply(req: Request, status: number, body: Record<string, unknown>): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...cors(req), 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' },
  });
}
const fail = (req: Request, status: number, code: string, extra: Record<string, unknown> = {}) =>
  reply(req, status, { ok: false, error: code, message: MESSAGES[code] || MESSAGES.server, ...extra });

/** Reads at most `max` bytes; returns null when the body is larger. */
async function readLimited(res: Response, max: number): Promise<string | null> {
  if (!res.body) return '';
  const reader = res.body.getReader();
  const chunks: Uint8Array[] = [];
  let size = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    size += value.byteLength;
    if (size > max) { try { await reader.cancel(); } catch { /* ignore */ } return null; }
    chunks.push(value);
  }
  const all = new Uint8Array(size);
  let at = 0;
  for (const c of chunks) { all.set(c, at); at += c.byteLength; }
  return new TextDecoder('utf-8').decode(all);
}

export async function sha256(text: string): Promise<string> {
  const d = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(text));
  return [...new Uint8Array(d)].map((b) => b.toString(16).padStart(2, '0')).join('');
}

/** Fetch one calendar link (already allowlisted). Never throws; never puts the link in an error. */
export async function fetchCalendar(link: string, fetchFn: FetchFn): Promise<Fetched> {
  const bad = checkLink(link);
  if (bad) return { ok: false, error: bad, status: 400 };
  let res: Response;
  try {
    res = await fetchFn(link, {
      redirect: 'manual',
      signal: AbortSignal.timeout(TIMEOUT_MS),
      headers: { 'Accept': 'text/calendar, */*;q=0.1', 'User-Agent': 'course-tracker calendar sync' },
    });
  } catch (e) {
    const name = (e as Error)?.name;
    const slow = name === 'TimeoutError' || name === 'AbortError';
    return { ok: false, error: slow ? 'timeout' : 'moodle-down', status: slow ? 504 : 502 };
  }
  if ((res.status >= 300 && res.status < 400) || res.status === 401 || res.status === 403 || res.status === 404) {
    return { ok: false, error: 'link-rejected', status: 400 }; // a bad token goes to the login page or an error
  }
  if (!res.ok) return { ok: false, error: 'moodle-down', status: 502 };
  const text = await readLimited(res, MAX_BYTES);
  if (text === null) return { ok: false, error: 'too-big', status: 413 };
  if (!/^BEGIN:VCALENDAR\s*$/m.test(text)) return { ok: false, error: 'link-rejected', status: 400 }; // an HTML page
  const ics = text.slice(text.indexOf('BEGIN:VCALENDAR'));
  const events = (ics.match(/^BEGIN:(VEVENT|VTODO)\s*$/gm) || []).length;
  return { ok: true, ics, events, hash: await sha256(ics) };
}

const rpc = (env: Env, fetchFn: FetchFn, name: string, body: unknown, headers: Record<string, string>) =>
  fetchFn(`${env.url}/rest/v1/rpc/${name}`, { method: 'POST', headers: { ...headers, 'Content-Type': 'application/json' }, body: JSON.stringify(body) });

/* ---------- B. the schedule ---------- */
async function handleCron(req: Request, env: Env, fetchFn: FetchFn, secret: string): Promise<Response> {
  const sb = { apikey: env.key }; // no user: the secret, checked inside SQL, is the only key
  const started = Date.now();
  const due = await rpc(env, fetchFn, 'moodle_cron_feeds', { p_secret: secret }, sb);
  if (due.status === 401 || due.status === 403) return fail(req, 403, 'forbidden');
  if (!due.ok) {
    const body = await due.text().catch(() => '');
    return /42501|forbidden/.test(body) ? fail(req, 403, 'forbidden') : fail(req, 500, 'server');
  }
  const list = await due.json();
  const out = { ok: true, due: Array.isArray(list) ? list.length : 0, saved: 0, failed: 0, skipped: 0 };
  for (const row of Array.isArray(list) ? list : []) {
    if (Date.now() - started > CRON_BUDGET_MS) { out.skipped++; continue; } // picked up by the next run
    if (!row || typeof row.user_id !== 'string') continue;
    const r = await fetchCalendar(row.url, fetchFn);
    const save = await rpc(env, fetchFn, 'moodle_cron_save', {
      p_secret: secret, p_user: row.user_id,
      p_ics: r.ok ? r.ics : null, p_hash: r.ok ? r.hash : null, p_events: r.ok ? r.events : null, p_error: r.ok ? null : r.error,
    }, sb);
    if (save.ok && r.ok) out.saved++; else out.failed++;
  }
  console.log(JSON.stringify({ cron: 'done', ...out })); // counts only: no links, no user ids
  return reply(req, 200, out);
}

/* ---------- A. a signed-in user ---------- */
export async function handle(req: Request, env: Env, fetchFn: FetchFn = fetch): Promise<Response> {
  if (req.method === 'OPTIONS') return new Response(null, { status: 204, headers: cors(req) });
  if (req.method !== 'POST') return fail(req, 405, 'method');

  try {
    const secret = req.headers.get('x-cron-secret');
    if (secret !== null) {
      if (!/^[0-9a-f]{32,128}$/.test(secret)) return fail(req, 403, 'forbidden');
      return await handleCron(req, env, fetchFn, secret);
    }

    const authz = req.headers.get('authorization') || '';
    if (!/^Bearer \S+$/.test(authz)) return fail(req, 401, 'not-signed-in');
    const apikey = req.headers.get('apikey') || env.key;
    const sb = { apikey, Authorization: authz };

    // 1. who is calling
    const who = await fetchFn(`${env.url}/auth/v1/user`, { headers: sb });
    if (!who.ok) return fail(req, 401, 'not-signed-in');
    const user = await who.json();
    if (!user || typeof user.id !== 'string') return fail(req, 401, 'not-signed-in');

    // 2. their link: decrypted from Vault by an owner-only SQL function, called with their own token
    const got = await rpc(env, fetchFn, 'moodle_feed_get', {}, sb);
    if (!got.ok) return fail(req, 500, 'server');
    const link = await got.json();
    if (typeof link !== 'string' || !link) return fail(req, 404, 'no-link');
    const bad = checkLink(link);
    if (bad) return fail(req, 400, bad);

    // 3. rate limit
    const claim = await rpc(env, fetchFn, 'moodle_claim_fetch', {}, sb);
    if (!claim.ok) return fail(req, 500, 'server');
    const wait = Number(await claim.json()) || 0;
    if (wait > 0) return fail(req, 429, 'rate-limit', { retryAfter: wait });

    // 4. fetch, keep as the snapshot (best effort: an older SQL version without the function still works)
    const r = await fetchCalendar(link, fetchFn);
    const keep = (r.ok || ['link-rejected', 'too-big'].includes(r.error))
      ? rpc(env, fetchFn, 'moodle_snapshot_save', r.ok ? { p_ics: r.ics, p_hash: r.hash, p_events: r.events, p_error: null }
        : { p_ics: null, p_hash: null, p_events: null, p_error: r.error }, sb).catch(() => null)
      : Promise.resolve(null);
    await keep;
    if (!r.ok) return fail(req, r.status, r.error);
    console.log(JSON.stringify({ fetch: 'ok', events: r.events, bytes: r.ics.length })); // no link, no user id
    return reply(req, 200, { ok: true, ics: r.ics, events: r.events, hash: r.hash, host: new URL(link).hostname, fetchedAt: new Date().toISOString() });
  } catch (e) {
    console.error(JSON.stringify({ fetch: 'error', name: (e as Error)?.name || 'unknown' })); // never the message: it could quote the link
    return fail(req, 500, 'server');
  }
}

// Deno (Supabase Edge Runtime) entry point. SUPABASE_URL and SUPABASE_ANON_KEY are set by Supabase automatically.
declare const Deno: { serve: (h: (req: Request) => Promise<Response>) => void; env: { get: (k: string) => string | undefined } };
if (typeof Deno !== 'undefined') {
  Deno.serve((req) => handle(req, { url: Deno.env.get('SUPABASE_URL') || '', key: Deno.env.get('SUPABASE_ANON_KEY') || '' }));
}
