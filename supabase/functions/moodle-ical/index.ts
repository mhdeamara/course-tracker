// Supabase Edge Function "moodle-ical": fetches the signed-in user's own Moodle calendar export and returns it.
//
// Why a server at all: the browser cannot read Moodle's export directly (CORS).
// What it does, in order:
//   1. Checks the caller's JWT with Supabase Auth (only signed-in users; the token decides whose link is read).
//   2. Reads the caller's link with the caller's own token through public.moodle_feed_get(), which decrypts it from
//      Supabase Vault for auth.uid() only (no service_role key is used anywhere).
//   3. Accepts only https://moodle<NN>.technion.ac.il/calendar/export_execute.php?… — never an open proxy, no SSRF:
//      fixed host pattern, default port, no credentials in the URL, redirects are not followed.
//   4. Rate limit: one Moodle fetch per user every 5 minutes (public.moodle_claim_fetch()).
//   5. Fetches with a 10 s timeout and a 2 MB cap, checks it is really an iCalendar file, returns the text.
// The link is never logged and never sent back. Errors are short codes plus a Hebrew message.
//
// Dependency-free (plain fetch), so tests/edge-function.test.js runs handle() in Node with a fake fetch.

export const HOST_RE = /^moodle\d{0,2}\.technion\.ac\.il$/;
export const EXPORT_PATH = '/calendar/export_execute.php';
export const MAX_BYTES = 2 * 1024 * 1024;
export const TIMEOUT_MS = 10_000;
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
  'rate-limit': 'סונכרן לפני פחות מ-5 דקות. נסה שוב בעוד כמה דקות',
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

export async function handle(req: Request, env: Env, fetchFn: FetchFn = fetch): Promise<Response> {
  if (req.method === 'OPTIONS') return new Response(null, { status: 204, headers: cors(req) });
  if (req.method !== 'POST') return fail(req, 405, 'method');

  const authz = req.headers.get('authorization') || '';
  if (!/^Bearer \S+$/.test(authz)) return fail(req, 401, 'not-signed-in');
  const apikey = req.headers.get('apikey') || env.key;
  const sb = { apikey, Authorization: authz };

  try {
    // 1. who is calling
    const who = await fetchFn(`${env.url}/auth/v1/user`, { headers: sb });
    if (!who.ok) return fail(req, 401, 'not-signed-in');
    const user = await who.json();
    if (!user || typeof user.id !== 'string') return fail(req, 401, 'not-signed-in');

    // 2. their link: decrypted from Vault by an owner-only SQL function, called with their own token
    const got = await fetchFn(`${env.url}/rest/v1/rpc/moodle_feed_get`, {
      method: 'POST', headers: { ...sb, 'Content-Type': 'application/json' }, body: '{}',
    });
    if (!got.ok) return fail(req, 500, 'server');
    const link = await got.json();
    if (typeof link !== 'string' || !link) return fail(req, 404, 'no-link');

    // 3. allowlist
    const bad = checkLink(link);
    if (bad) return fail(req, 400, bad);

    // 4. rate limit
    const claim = await fetchFn(`${env.url}/rest/v1/rpc/moodle_claim_fetch`, {
      method: 'POST', headers: { ...sb, 'Content-Type': 'application/json' }, body: '{}',
    });
    if (!claim.ok) return fail(req, 500, 'server');
    const wait = Number(await claim.json()) || 0;
    if (wait > 0) return fail(req, 429, 'rate-limit', { retryAfter: wait });

    // 5. fetch from Moodle
    let res: Response;
    try {
      res = await fetchFn(link, {
        redirect: 'manual',
        signal: AbortSignal.timeout(TIMEOUT_MS),
        headers: { 'Accept': 'text/calendar, */*;q=0.1', 'User-Agent': 'course-tracker calendar sync' },
      });
    } catch (e) {
      const name = (e as Error)?.name;
      return fail(req, name === 'TimeoutError' || name === 'AbortError' ? 504 : 502, name === 'TimeoutError' || name === 'AbortError' ? 'timeout' : 'moodle-down');
    }
    if ((res.status >= 300 && res.status < 400) || res.status === 401 || res.status === 403 || res.status === 404) {
      return fail(req, 400, 'link-rejected'); // Moodle sends a bad or expired token to the login page or an error
    }
    if (!res.ok) return fail(req, 502, 'moodle-down');
    const text = await readLimited(res, MAX_BYTES);
    if (text === null) return fail(req, 413, 'too-big');
    if (!/^BEGIN:VCALENDAR\s*$/m.test(text)) return fail(req, 400, 'link-rejected'); // an HTML error page, not a calendar
    const events = (text.match(/^BEGIN:(VEVENT|VTODO)\s*$/gm) || []).length;
    console.log(JSON.stringify({ fetch: 'ok', events, bytes: text.length })); // no link, no user id
    return reply(req, 200, { ok: true, ics: text, events, host: new URL(link).hostname, fetchedAt: new Date().toISOString() });
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
