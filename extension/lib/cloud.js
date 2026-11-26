/* cloud.js — connected mode: sign in to *your own* Supabase project and read your own row (user_data), read-only.
 * Same REST endpoints as the site (js/cloud.js), so the same Row Level Security applies: a signed-in user can only
 * read their own row. The extension has its own session (sharing the site's would break token renewal). The
 * password is sent only to Supabase and never stored; the session lives in chrome.storage.local.
 * The extension never writes the row: changes (✓) go through the open site (see ext-bridge.js). */
(function (root) {
  'use strict';
  const C = {};
  const heMsg = (status, j) => {
    const m = String((j && (j.error_description || j.msg || j.message || j.error)) || '');
    if (/invalid login|invalid_grant|invalid credentials/i.test(m)) return 'אימייל או סיסמה שגויים';
    if (/email not confirmed/i.test(m)) return 'צריך לאשר את האימייל קודם';
    if (status === 401 || status === 403) return 'ההתחברות פגה — התחבר שוב בהגדרות';
    return m || `שגיאה (${status})`;
  };
  async function call(s, path, { method = 'GET', body, token } = {}) {
    const headers = { apikey: s.sbKey, 'Content-Type': 'application/json' };
    if (token) headers.Authorization = `Bearer ${token}`;
    const r = await fetch(s.sbUrl.replace(/\/+$/, '') + path, { method, headers, body: body ? JSON.stringify(body) : undefined, cache: 'no-store' });
    let j = null;
    try { j = await r.json(); } catch (e) { /* empty body */ }
    if (!r.ok) { const e = new Error(heMsg(r.status, j)); e.status = r.status; throw e; }
    return j;
  }
  const session = (j) => ({
    access_token: j.access_token, refresh_token: j.refresh_token,
    expires_at: j.expires_at || Math.floor(Date.now() / 1000) + (j.expires_in || 3600),
    user: { id: j.user && j.user.id, email: j.user && j.user.email },
  });

  C.signIn = async (s, email, password) => session(await call(s, '/auth/v1/token?grant_type=password', { method: 'POST', body: { email, password } }));
  /** A valid session (renewed when it's about to expire), or throws. */
  C.fresh = async (s, auth) => {
    if (!auth || !auth.refresh_token) { const e = new Error('לא מחובר'); e.status = 401; throw e; }
    if (auth.expires_at - 90 > Date.now() / 1000) return auth;
    return session(await call(s, '/auth/v1/token?grant_type=refresh_token', { method: 'POST', body: { refresh_token: auth.refresh_token } }));
  };
  C.fetchState = async (s, auth) => {
    const rows = await call(s, `/rest/v1/user_data?select=data,version,updated_at&user_id=eq.${encodeURIComponent(auth.user.id)}`, { token: auth.access_token });
    const row = Array.isArray(rows) ? rows[0] : null;
    return row ? { state: row.data, updated_at: row.updated_at } : null;
  };
  C.signOut = async (s, auth) => {
    try { if (auth && auth.access_token) await call(s, '/auth/v1/logout', { method: 'POST', token: auth.access_token }); } catch (e) { /* signed out locally anyway */ }
  };

  root.CTCloud = C;
})(typeof self !== 'undefined' ? self : globalThis);
