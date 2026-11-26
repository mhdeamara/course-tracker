/* cloud.js — sync with Supabase (auth + one JSON row per user), using plain fetch (no SDK).
 *
 * How sync works:
 *  - localStorage stays the working copy (fast, works offline).
 *  - Every local change marks the device "dirty" and is pushed ~1.5s later.
 *  - The cloud row has a `version`. A push only succeeds if the cloud still has the version this
 *    device last saw (optimistic locking). If not, another device changed it → we ask what to keep.
 *  - Every 20s (and when the tab regains focus) we check the cloud version; if it is newer and
 *    nothing is pending locally, the cloud data replaces the local copy. */
(function (CT) {
  'use strict';
  const { u, ui } = CT;
  const C = {};
  CT.cloud = C;

  const cfg = window.CT_CONFIG || {};
  const BASE = String(cfg.supabaseUrl || '').replace(/\/+$/, '');
  const KEY = cfg.supabaseKey || '';
  const AUTH_KEY = 'ct.auth';
  const META_KEY = 'ct.sync';
  const TABLE = 'user_data';

  C.enabled = !!(BASE && KEY);
  C.status = C.enabled ? 'signed-out' : 'off'; // off | signed-out | syncing | synced | offline | error | conflict
  C.error = '';
  C.lastSync = null;

  let auth = null;      // { access_token, refresh_token, expires_at, user: { id, email } }
  let meta = { version: null, dirty: false }; // version = last cloud version this device has seen
  let pushTimer = null, pushing = false, conflictOpen = false;

  const readLS = (k) => { try { return JSON.parse(localStorage.getItem(k)); } catch (e) { return null; } };
  const writeLS = (k, v) => { try { if (v == null) localStorage.removeItem(k); else localStorage.setItem(k, JSON.stringify(v)); } catch (e) { /* ignore */ } };
  const saveMeta = () => writeLS(META_KEY, meta);

  const setStatus = (s, err = '') => {
    C.status = s;
    C.error = err;
    if (s === 'synced') C.lastSync = new Date();
    if (CT.app && CT.app.updateSyncBadge) CT.app.updateSyncBadge();
  };

  C.email = () => (auth && auth.user && auth.user.email) || '';
  C.signedIn = () => !!(auth && auth.access_token);

  /* ---------------- HTTP helpers ---------------- */
  async function http(path, { method = 'GET', body, token, headers = {} } = {}) {
    const res = await fetch(BASE + path, {
      method,
      // new "sb_publishable_" keys are not JWTs: send them only as apikey; Authorization carries the user's token
      headers: Object.assign({ apikey: KEY, 'Content-Type': 'application/json' },
        token ? { Authorization: `Bearer ${token}` } : (KEY.startsWith('eyJ') ? { Authorization: `Bearer ${KEY}` } : {}),
        headers),
      body: body === undefined ? undefined : JSON.stringify(body),
    });
    const text = await res.text();
    let data = null;
    try { data = text ? JSON.parse(text) : null; } catch (e) { data = text; }
    if (!res.ok) {
      const msg = (data && (data.msg || data.message || data.error_description || data.error)) || `HTTP ${res.status}`;
      const err = new Error(msg);
      err.status = res.status;
      err.code = data && (data.error_code || data.code || data.error);
      err.data = data && typeof data === 'object' ? data : null;
      throw err;
    }
    return data;
  }

  /* ---------------- auth (Supabase GoTrue REST) ---------------- */
  const storeSession = (s) => {
    auth = {
      access_token: s.access_token, refresh_token: s.refresh_token,
      expires_at: s.expires_at ? s.expires_at * 1000 : Date.now() + (s.expires_in || 3600) * 1000,
      user: { id: s.user && s.user.id, email: s.user && s.user.email },
    };
    writeLS(AUTH_KEY, auth);
  };

  async function refresh() {
    const s = await http('/auth/v1/token?grant_type=refresh_token', { method: 'POST', body: { refresh_token: auth.refresh_token } });
    storeSession(s);
  }

  /** Returns a valid access token (refreshing if needed), or throws. */
  async function token() {
    if (!auth) throw Object.assign(new Error('not signed in'), { status: 401 });
    if (Date.now() > auth.expires_at - 60000) await refresh();
    return auth.access_token;
  }

  /** Authenticated REST call with one retry after a token refresh on 401. */
  async function api(path, opts = {}) {
    try { return await http(path, { ...opts, token: await token() }); } catch (e) {
      if (e.status === 401 && auth) {
        try { await refresh(); } catch (e2) { signOutLocal(); throw e2; }
        return http(path, { ...opts, token: auth.access_token });
      }
      throw e;
    }
  }

  const heMsg = (e) => {
    const m = String(e.message || '');
    if (/invalid login credentials/i.test(m)) return 'אימייל או סיסמה שגויים';
    if (/email not confirmed/i.test(m)) return 'צריך קודם לאשר את המייל (בדוק את תיבת הדואר)';
    if (/already registered|already exists/i.test(m)) return 'המייל הזה כבר רשום — התחבר במקום להירשם';
    if (/signups not allowed|signup.*disabled/i.test(m)) return 'הרשמה חדשה חסומה בפרויקט (וזה טוב). התחבר עם החשבון הקיים';
    if (/password/i.test(m) && /6|short|weak/i.test(m)) return 'הסיסמה קצרה מדי (לפחות 6 תווים, עדיף 10+)';
    if (e instanceof TypeError) return 'אין חיבור לשרת (אינטרנט?)';
    return m;
  };
  C.heMsg = heMsg;

  C.signIn = async (email, password) => {
    const s = await http('/auth/v1/token?grant_type=password', { method: 'POST', body: { email, password } });
    storeSession(s);
    meta = readLS(META_KEY) || { version: null, dirty: false };
    await C.syncNow({ firstLogin: true });
  };

  C.signUp = async (email, password) => {
    const r = await http('/auth/v1/signup', { method: 'POST', body: { email, password } });
    if (r && r.access_token) { storeSession(r); await C.syncNow({ firstLogin: true }); return 'signed-in'; }
    return 'confirm-email';
  };

  function signOutLocal() {
    auth = null;
    writeLS(AUTH_KEY, null);
    meta = { version: null, dirty: false };
    saveMeta();
    setStatus(C.enabled ? 'signed-out' : 'off');
  }
  /* ---------------- Moodle calendar link ----------------
   * The link lives only in the moodle_feeds table (RLS: owner only). This device never keeps it: not in the state,
   * not in localStorage, not in a backup. It is sent once when saved, and read back only as its host name. */
  C.moodleFeed = async () => {
    const rows = await api(`/rest/v1/moodle_feeds?select=host,updated_at&user_id=eq.${auth.user.id}`);
    return rows && rows[0] ? rows[0] : null;
  };
  C.saveMoodleLink = (url) => api('/rest/v1/moodle_feeds?on_conflict=user_id', {
    method: 'POST',
    body: { user_id: auth.user.id, url, updated_at: new Date().toISOString() },
    headers: { Prefer: 'resolution=merge-duplicates,return=minimal' },
  });
  C.deleteMoodleLink = () => api(`/rest/v1/moodle_feeds?user_id=eq.${auth.user.id}`, { method: 'DELETE', headers: { Prefer: 'return=minimal' } });
  /** The Edge Function fetches the calendar with the saved link and returns { ok, ics, events, host, fetchedAt }. */
  C.fetchMoodle = () => api('/functions/v1/moodle-ical', { method: 'POST', body: {} });
  /** The AI Edge Function (supabase/functions/ai). The API key never reaches the browser. */
  C.ai = (body) => api('/functions/v1/ai', { method: 'POST', body });

  C.signOut = async () => {
    try { if (auth) await http('/auth/v1/logout', { method: 'POST', token: auth.access_token }); } catch (e) { /* ignore */ }
    signOutLocal();
  };

  /* ---------------- data sync ---------------- */
  const fetchRemote = async (fields = 'data,version,updated_at') => {
    const rows = await api(`/rest/v1/${TABLE}?select=${fields}&user_id=eq.${auth.user.id}`);
    return rows && rows[0] ? rows[0] : null;
  };

  /** Replace local data with the cloud copy (no undo across devices). */
  function applyRemote(row) {
    CT.store.state = CT.model.migrate(row.data);
    CT.store.undoStack = [];
    CT.store.persist(true);
    meta = { version: row.version, dirty: false };
    saveMeta();
    CT.store.emit();
  }

  async function insertRemote() {
    const rows = await api(`/rest/v1/${TABLE}`, {
      method: 'POST', body: { user_id: auth.user.id, data: CT.store.state, version: 1 },
      headers: { Prefer: 'return=representation' },
    });
    meta = { version: rows[0].version, dirty: false };
    saveMeta();
  }

  /** Push local state if the cloud still has the version we last saw. Returns false on conflict. */
  async function pushRemote() {
    const next = (meta.version || 0) + 1;
    const rows = await api(`/rest/v1/${TABLE}?user_id=eq.${auth.user.id}&version=eq.${meta.version}`, {
      method: 'PATCH', body: { data: CT.store.state, version: next, updated_at: new Date().toISOString() },
      headers: { Prefer: 'return=representation' },
    });
    if (!rows || !rows.length) return false;
    meta = { version: rows[0].version, dirty: false };
    saveMeta();
    return true;
  }

  /** Main sync step: reconcile local and cloud. */
  /** True when local data holds no real work yet (fresh device: only the empty course structure). */
  C.isEmpty = (st) => !st.studyLog.length && st.courses.every((c) =>
    !c.exams.length && !c.schedule.length && !c.notebook.length && !c.grade.components.some((g) => u.isNum(g.score))
    && c.categories.every((cat) => cat.items.every((i) => i.status === 'todo' && !i.note && !i.flag && !i.due)));

  C.syncNow = async ({ firstLogin = false } = {}) => {
    const pristine = C.isEmpty(CT.store.state);
    if (!C.enabled || !C.signedIn() || pushing || conflictOpen) return;
    if (!navigator.onLine) { setStatus('offline'); return; }
    pushing = true;
    setStatus('syncing');
    try {
      const remote = await fetchRemote();
      if (!remote) {
        await insertRemote(); // first device: upload what we have
      } else if (meta.version == null) {
        // this device never synced: keep cloud unless the user has real local work to keep
        if (pristine) applyRemote(remote);
        else await resolveConflict(remote, firstLogin ? 'first' : 'conflict');
      } else if (remote.version === meta.version) {
        if (meta.dirty && !(await pushRemote())) await resolveConflict(await fetchRemote(), 'conflict');
      } else if (!meta.dirty) {
        applyRemote(remote);
      } else {
        await resolveConflict(remote, 'conflict');
      }
      if (C.status === 'syncing') setStatus('synced'); // a conflict dialog sets its own result
    } catch (e) {
      console.warn('sync failed', e);
      if (e instanceof TypeError) setStatus('offline');
      else if (e.status === 401) setStatus('signed-out', 'פג תוקף ההתחברות — התחבר שוב');
      else setStatus('error', heMsg(e));
    } finally {
      pushing = false;
    }
  };

  /** Both sides changed (or first login on a device with data): let the user choose. */
  function resolveConflict(remote, kind) {
    if (!remote) return Promise.resolve();
    conflictOpen = true;
    setStatus('conflict');
    const count = (st) => {
      const items = st.courses.flatMap((c) => c.categories.flatMap((cat) => cat.items));
      return `${st.courses.length} קורסים · ${items.filter((i) => i.status === 'done').length} פריטים הושלמו`;
    };
    const when = (iso) => (iso ? new Date(iso).toLocaleString('he-IL', { dateStyle: 'short', timeStyle: 'short' }) : '—');
    let remoteState;
    try { remoteState = CT.model.migrate(remote.data); } catch (e) { remoteState = null; }
    return new Promise((resolve) => {
      let done = false;
      const finish = async (choice) => {
        if (done) return;
        done = true;
        conflictOpen = false;
        try {
          if (choice === 'cloud' && remoteState) {
            const hadWork = !C.isEmpty(CT.store.state);
            if (hadWork) localBackupBeforeOverwrite();
            applyRemote(remote);
            ui.toast(hadWork ? 'נטענו הנתונים מהענן. עותק של נתוני המכשיר נשמר בהורדות.' : 'נטענו הנתונים מהענן');
          } else {
            meta.version = remote.version;
            meta.dirty = true;
            const ok = await pushRemote();
            if (!ok) { setStatus('error', 'הענן השתנה שוב — נסה "סנכרן עכשיו"'); resolve(); return; }
            ui.toast('הנתונים מהמכשיר הזה נשמרו בענן');
          }
          setStatus('synced');
        } catch (e) { setStatus('error', heMsg(e)); }
        resolve();
      };
      ui.modal({
        title: kind === 'first' ? 'יש כבר נתונים בענן' : 'הנתונים השתנו בשני מכשירים',
        body: `<p>${kind === 'first'
          ? 'בחשבון כבר שמורים נתונים, וגם במכשיר הזה יש נתונים. איזה עותק להשאיר?'
          : 'מכשיר אחר שמר שינויים בזמן שגם כאן היו שינויים שעוד לא סונכרנו. איזה עותק להשאיר?'}</p>
          <div class="choice-grid">
            <div class="choice"><b>☁️ הענן</b><span>${remoteState ? count(remoteState) : 'לא קריא'}</span><span class="muted small">עודכן: ${when(remote.updated_at)}</span></div>
            <div class="choice"><b>💻 המכשיר הזה</b><span>${count(CT.store.state)}</span><span class="muted small">עודכן: ${when(CT.store.state.meta.updatedAt)}</span></div>
          </div>
          <p class="muted small">העותק שלא נבחר לא נמחק לגמרי: אם תבחר בענן, עותק של נתוני המכשיר יורד כקובץ גיבוי.</p>`,
        actions: [
          { label: 'השאר את המכשיר הזה', fn: () => { finish('local'); } },
          { label: 'השאר את הענן', primary: true, fn: () => { finish('cloud'); } },
        ],
        onClose: () => { if (!done) { conflictOpen = false; done = true; setStatus('conflict', 'ההתנגשות לא נפתרה'); resolve(); } },
      });
    });
  }

  function localBackupBeforeOverwrite() {
    try {
      const blob = new Blob([CT.backup.serialize()], { type: 'application/json' });
      const a = document.createElement('a');
      a.href = URL.createObjectURL(blob);
      a.download = `course-tracker-before-cloud-${u.today()}.json`;
      document.body.appendChild(a); a.click();
      setTimeout(() => { URL.revokeObjectURL(a.href); a.remove(); }, 1000);
    } catch (e) { /* ignore */ }
  }

  /** Called by the store after every local change. */
  C.onLocalChange = () => {
    if (!C.enabled || !C.signedIn()) return;
    meta.dirty = true;
    saveMeta();
    if (C.status !== 'conflict') setStatus(navigator.onLine ? 'syncing' : 'offline');
    clearTimeout(pushTimer);
    pushTimer = setTimeout(() => C.syncNow(), 1500);
  };

  /** Lightweight check for changes made on another device. */
  async function poll() {
    if (!C.signedIn() || pushing || conflictOpen || document.hidden || meta.dirty) return;
    if (!navigator.onLine) { setStatus('offline'); return; }
    try {
      const r = await fetchRemote('version');
      if (r && r.version !== meta.version) await C.syncNow();
      else if (C.status !== 'synced') setStatus('synced');
    } catch (e) {
      if (e instanceof TypeError) setStatus('offline');
    }
  }

  /** Boot: restore session, start background checks, do the first sync. */
  C.init = async () => {
    if (!C.enabled) return;
    auth = readLS(AUTH_KEY);
    meta = readLS(META_KEY) || { version: null, dirty: false };
    // background checks run always; they do nothing while signed out
    setInterval(poll, 20000);
    window.addEventListener('focus', poll);
    document.addEventListener('visibilitychange', () => { if (!document.hidden) poll(); });
    window.addEventListener('online', () => C.syncNow());
    window.addEventListener('offline', () => { if (C.signedIn()) setStatus('offline'); });
    if (!C.signedIn()) { setStatus('signed-out'); return; }
    await C.syncNow();
  };

  /** Human-readable status for the sidebar / settings. */
  C.label = () => ({
    off: ['', 'מקומי בלבד'],
    'signed-out': ['warn', 'לא מחובר לסנכרון'],
    syncing: ['busy', 'מסנכרן…'],
    synced: ['ok', 'מסונכרן'],
    offline: ['warn', 'אין אינטרנט — יסונכרן אחר כך'],
    error: ['bad', 'שגיאת סנכרון'],
    conflict: ['bad', 'צריך לבחור גרסה'],
  }[C.status] || ['', C.status]);
})(window.CT);
