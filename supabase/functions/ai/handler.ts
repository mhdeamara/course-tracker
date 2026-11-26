// The AI Edge Function's logic: sign-in check, limits, cost accounting, error messages.
// No imports and no SDK here: index.ts injects the Claude client, so tests/ai-function.test.js runs this file in Node
// with a fake network and a fake Claude.
//
// Rules this file guarantees:
//   * Only a signed-in user (JWT checked with Supabase Auth) gets anything.
//   * The API key never leaves the server. It is not in the code, not in a response, not in a log.
//   * Limits per user, counted in the database by functions only the service role can run (supabase/ai.sql):
//     requests per minute, cost per day, grade sheets per day; plus size limits on every request.
//   * The model is one of a fixed list; the system prompts and tools are fixed here, never taken from the browser.
//   * Logs hold only short codes and numbers, never content.

export const PRICES: Record<string, { input: number; output: number }> = { // US$ per million tokens
  'claude-haiku-5-5': { input: 0.10, output: 0.50 },
  'claude-sonnet-5-5': { input: 2, output: 10 },
  'claude-opus-5-5': { input: 4, output: 20 },
};
export const DEFAULT_MODELS: Record<string, string> = { extract: 'claude-sonnet-5-5', chat: 'claude-haiku-5-5', ping: 'claude-haiku-5-5' };
export const LIMITS = {
  perMinute: 10,
  dailyCostUsd: 0.5,
  dailyExtracts: 10,
  maxBodyBytes: 14_500_000,          // a 10 MB file as base64 (+ a little JSON)
  maxFileBytes: 10 * 1024 * 1024,
  maxPdfPages: 10,
  maxChatChars: 2000,
};
const ORIGINS = ['https://mhdeamara.github.io', 'http://127.0.0.1:8765', 'http://localhost:8765', 'null'];

export const MESSAGES: Record<string, string> = {
  'method': 'בקשה לא נתמכת',
  'bad-request': 'בקשה לא תקינה',
  'too-big': 'הבקשה גדולה מדי',
  'not-signed-in': 'צריך להתחבר לאתר כדי להשתמש בעוזר',
  'not-yet': 'הפעולה הזו עוד לא זמינה',
  'ai-not-configured': 'העוזר עוד לא הוגדר: חסר הסוד ANTHROPIC_API_KEY ב-Supabase (ההוראות ב-README)',
  'daily-cost': `הגעת לתקרת השימוש היומית ($${LIMITS.dailyCostUsd.toFixed(2)}). העוזר יחזור מחר; שאר האתר עובד כרגיל`,
  'daily-extracts': `הגעת למספר גיליונות הציונים המרבי ליום (${LIMITS.dailyExtracts}). אפשר שוב מחר`,
  'per-minute': 'יותר מדי בקשות בדקה האחרונה. נסה שוב בעוד רגע',
  'ai-key': 'מפתח ה-API נדחה. בדוק את הסוד ANTHROPIC_API_KEY ב-Supabase',
  'ai-busy': 'שירות ה-AI עמוס כרגע. נסה שוב בעוד דקה',
  'ai-down': 'שירות ה-AI לא זמין כרגע. האתר ממשיך לעבוד כרגיל',
  'ai-bad-request': 'שירות ה-AI דחה את הבקשה',
  'ai-refused': 'המודל סירב לבקשה הזו',
  'server': 'שגיאה בשרת. נסה שוב מאוחר יותר',
};

export type Usage = { input_tokens?: number; output_tokens?: number; cache_creation_input_tokens?: number | null; cache_read_input_tokens?: number | null };
/** What index.ts provides. Errors come out as { aiError: 'ai-key' | 'ai-busy' | 'ai-down' | 'ai-bad-request' }. */
export type Claude = { create: (params: Record<string, unknown>) => Promise<{ content: Array<Record<string, unknown>>; usage: Usage; stop_reason?: string }> };
export type Env = { url: string; anonKey: string; serviceKey: string };
export type Deps = { fetch: (input: string, init?: RequestInit) => Promise<Response>; claude: Claude | null };

/** Cost in US$ of one response (cache writes 1.25×, cache reads 0.1× the input price). */
export function costOf(model: string, u: Usage): number {
  const p = PRICES[model];
  if (!p || !u) return 0;
  const input = (u.input_tokens || 0) + 1.25 * (u.cache_creation_input_tokens || 0) + 0.1 * (u.cache_read_input_tokens || 0);
  return (input * p.input + (u.output_tokens || 0) * p.output) / 1_000_000;
}
export const pickModel = (kind: string, asked: unknown): string =>
  (typeof asked === 'string' && asked in PRICES) ? asked : DEFAULT_MODELS[kind];

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
export function reply(req: Request, status: number, body: Record<string, unknown>): Response {
  return new Response(JSON.stringify(body), { status, headers: { ...cors(req), 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' } });
}
export const fail = (req: Request, status: number, code: string, extra: Record<string, unknown> = {}) =>
  reply(req, status, { ok: false, error: code, message: MESSAGES[code] || MESSAGES.server, ...extra });
const log = (o: Record<string, unknown>) => console.log(JSON.stringify(o)); // codes and numbers only

/* ---------- Supabase calls ---------- */
const serviceHeaders = (env: Env) => Object.assign(
  { apikey: env.serviceKey, 'Content-Type': 'application/json' },
  env.serviceKey.startsWith('eyJ') ? { Authorization: `Bearer ${env.serviceKey}` } : {}, // new sb_secret_ keys are not JWTs
);
async function rpc(env: Env, deps: Deps, name: string, args: Record<string, unknown>): Promise<unknown> {
  const res = await deps.fetch(`${env.url}/rest/v1/rpc/${name}`, { method: 'POST', headers: serviceHeaders(env), body: JSON.stringify(args) });
  if (!res.ok) throw new Error(`rpc ${name} ${res.status}`);
  const text = await res.text();
  return text ? JSON.parse(text) : null;
}
/** Count the request against the limits; null when allowed, else a ready error Response. */
export async function begin(req: Request, env: Env, deps: Deps, user: string, kind: string): Promise<Response | null> {
  const r = await rpc(env, deps, 'ai_begin', {
    p_user: user, p_kind: kind, p_per_minute: LIMITS.perMinute, p_daily_cost: LIMITS.dailyCostUsd, p_daily_extracts: LIMITS.dailyExtracts,
  }) as { ok?: boolean; reason?: string; retry_after?: number } | null;
  if (r && r.ok) return null;
  const reason = (r && r.reason) || 'server';
  log({ ai: 'limit', reason });
  return fail(req, reason === 'server' ? 500 : 429, reason, r && r.retry_after ? { retryAfter: r.retry_after } : {});
}
export async function finish(env: Env, deps: Deps, user: string, model: string, u: Usage): Promise<number> {
  const cost = costOf(model, u);
  await rpc(env, deps, 'ai_finish', { p_user: user, p_input: u.input_tokens || 0, p_output: u.output_tokens || 0, p_cost: cost });
  return cost;
}

/* ---------- actions ---------- */
type Ctx = { req: Request; env: Env; deps: Deps; user: string; authz: string; apikey: string; body: Record<string, unknown> };

/** Today's usage and the limits, for the settings screen. No AI call, not counted. */
async function usage(c: Ctx): Promise<Response> {
  const today = new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Jerusalem' }).format(new Date());
  const res = await c.deps.fetch(`${c.env.url}/rest/v1/ai_usage?select=requests,extracts,input_tokens,output_tokens,cost_usd&user_id=eq.${encodeURIComponent(c.user)}&day=eq.${today}`,
    { headers: { apikey: c.apikey, Authorization: c.authz } }); // read with the user's own token: RLS applies
  if (!res.ok) return fail(c.req, 500, 'server');
  const rows = await res.json();
  const row = Array.isArray(rows) && rows[0] ? rows[0] : {};
  return reply(c.req, 200, {
    ok: true, configured: !!c.deps.claude, day: today,
    today: { requests: row.requests || 0, extracts: row.extracts || 0, costUsd: Number(row.cost_usd || 0) },
    limits: { perMinute: LIMITS.perMinute, dailyCostUsd: LIMITS.dailyCostUsd, dailyExtracts: LIMITS.dailyExtracts, maxFileBytes: LIMITS.maxFileBytes, maxPdfPages: LIMITS.maxPdfPages, maxChatChars: LIMITS.maxChatChars },
    models: Object.keys(PRICES), defaults: DEFAULT_MODELS,
  });
}

/** A tiny call to check that the key works ("בדוק חיבור"). Costs a fraction of a cent. */
async function ping(c: Ctx): Promise<Response> {
  const model = DEFAULT_MODELS.ping;
  const stop = await begin(c.req, c.env, c.deps, c.user, 'ping');
  if (stop) return stop;
  const r = await c.deps.claude!.create({
    model, max_tokens: 16,
    thinking: { type: 'disabled' }, output_config: { effort: 'low' },
    system: 'Reply with the single word OK.',
    messages: [{ role: 'user', content: 'ping' }],
  });
  const cost = await finish(c.env, c.deps, c.user, model, r.usage);
  log({ ai: 'ping', model, cost });
  return reply(c.req, 200, { ok: true, model, costUsd: cost });
}

export const ACTIONS: Record<string, (c: Ctx) => Promise<Response>> = { usage, ping };
const NEEDS_AI = new Set(['ping', 'extract', 'chat']);

export async function handle(req: Request, env: Env, deps: Deps, actions = ACTIONS): Promise<Response> {
  if (req.method === 'OPTIONS') return new Response(null, { status: 204, headers: cors(req) });
  if (req.method !== 'POST') return fail(req, 405, 'method');
  const authz = req.headers.get('authorization') || '';
  if (!/^Bearer \S+$/.test(authz)) return fail(req, 401, 'not-signed-in');
  const len = Number(req.headers.get('content-length') || 0);
  if (len > LIMITS.maxBodyBytes) return fail(req, 413, 'too-big');
  const apikey = req.headers.get('apikey') || env.anonKey;

  try {
    const who = await deps.fetch(`${env.url}/auth/v1/user`, { headers: { apikey, Authorization: authz } });
    if (!who.ok) return fail(req, 401, 'not-signed-in');
    const user = await who.json();
    if (!user || typeof user.id !== 'string') return fail(req, 401, 'not-signed-in');

    const raw = await req.text();
    if (raw.length > LIMITS.maxBodyBytes) return fail(req, 413, 'too-big');
    let body: Record<string, unknown>;
    try { body = JSON.parse(raw || '{}'); } catch { return fail(req, 400, 'bad-request'); }
    if (!body || typeof body !== 'object' || Array.isArray(body)) return fail(req, 400, 'bad-request');
    const action = String(body.action || '');
    const fn = actions[action];
    if (!fn) return fail(req, 400, NEEDS_AI.has(action) ? 'not-yet' : 'bad-request');
    if (NEEDS_AI.has(action) && !deps.claude) return fail(req, 503, 'ai-not-configured');
    if (NEEDS_AI.has(action) && !env.serviceKey) return fail(req, 500, 'server');
    return await fn({ req, env, deps, user: user.id, authz, apikey, body });
  } catch (e) {
    const code = e && typeof e === 'object' && 'aiError' in e ? String((e as { aiError: string }).aiError) : 'server';
    log({ ai: 'error', code, name: code === 'server' ? ((e as Error)?.name || 'unknown') : undefined }); // never the message
    const status = code === 'ai-busy' ? 429 : code === 'ai-key' ? 502 : code === 'ai-bad-request' ? 400 : code === 'ai-down' ? 503 : 500;
    return fail(req, status, code in MESSAGES ? code : 'server');
  }
}
