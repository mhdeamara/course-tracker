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
  const G = CT.guard; // read-only lock for data this app version must not save over (schema-guard.js)
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
    if (G.info && G.info.source === 'cloud' && G.info.uid !== auth.user.id) { location.reload(); return; } // another account's lock
    meta = readLS(META_KEY) || { version: null, dirty: false };
    await C.syncNow({ firstLogin: true });
  };

  C.signUp = async (email, password) => {
    const r = await http('/auth/v1/signup', { method: 'POST', body: { email, password } });
    if (r && r.access_token) {
      storeSession(r);
      if (G.info && G.info.source === 'cloud' && G.info.uid !== auth.user.id) { location.reload(); return 'signed-in'; }
      await C.syncNow({ firstLogin: true });
      return 'signed-in';
    }
    return 'confirm-email';
  };

  function signOutLocal() {
    auth = null;
    writeLS(AUTH_KEY, null);
    meta = { version: null, dirty: false };
    saveMeta();
    setStatus(C.enabled ? 'signed-out' : 'off');
    // the screen shows this account's cloud copy (read-only lock): reload so none of it stays visible to whoever
    // signs in next. Its kept copies stay under its own key and come back only when it signs in again.
    if (G.info && G.info.source === 'cloud') location.reload();
  }
  /* ---------------- Moodle calendar link ----------------
   * The link lives only in Supabase Vault (encrypted), reached through owner-only SQL functions (supabase/moodle.sql).
   * This device never keeps it: not in the state, not in localStorage, not in a backup. It is sent once when saved,
   * and read back only as its host name (moodle_feeds has no link in it). */
  C.moodleFeed = async () => {
    const rows = await api(`/rest/v1/moodle_feeds?select=*&user_id=eq.${auth.user.id}`);
    return rows && rows[0] ? rows[0] : null;
  };
  /** The calendar the scheduled refresh (or "רענן עכשיו") last fetched: { ics, hash, events, fetched_at, changed_at,
   *  checked_at, error }. No link in it. null when there is none (or the table is missing). */
  C.moodleSnapshot = async () => {
    const rows = await api(`/rest/v1/moodle_snapshots?select=ics,hash,events,fetched_at,changed_at,checked_at,error&user_id=eq.${auth.user.id}`);
    return rows && rows[0] ? rows[0] : null;
  };
  C.saveMoodleLink = (url) => api('/rest/v1/rpc/moodle_feed_set', { method: 'POST', body: { p_url: url } });
  C.deleteMoodleLink = () => api('/rest/v1/rpc/moodle_feed_delete', { method: 'POST', body: {} });
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

  /** The cloud row was saved by a newer app version (or its schema version is malformed): read-only.
   *  Nothing local is overwritten and `meta` stays as it was (so nothing is pushed, and unsynced edits stay "dirty");
   *  the row as received and any unsynced local data are kept for this account (schema-guard.js). */
  function lockFromRemote(row, cls) {
    clearTimeout(pushTimer);
    let local = null;
    if (meta.dirty) { try { local = localStorage.getItem('ct.data.v1'); } catch (e) { /* kept in ct.data.v1 anyway */ } }
    G.lock({ reason: cls, found: G.found(row.data), source: 'cloud', uid: auth.user.id },
      { remote: { data: row.data, version: row.version, updated_at: row.updated_at }, local });
    CT.store.state = G.display(row.data);
    setStatus('locked');
    CT.store.emit();
  }
  const rowCls = (row) => CT.model.classify(row && row.data);

  /** Replace local data with the cloud copy (no undo across devices). */
  function applyRemote(row) {
    const cls = rowCls(row);
    if (cls !== 'ok') { lockFromRemote(row, cls); return; }
    CT.store.state = CT.model.migrate(row.data);
    CT.store.undoStack = [];
    CT.store.persist(true);
    meta = { version: row.version, dirty: false };
    saveMeta();
    CT.store.emit();
  }

  /**
   * Save the local state. expected = the cloud version this device last saw (null → first save, insert).
   * Returns the new cloud version, or null on a conflict (the cloud changed, or a row already exists).
   * Goes through public.ct_save (supabase/schema-guard.sql), which tells the server which schema this app supports.
   * The old direct write is used only when the server says that function does not exist (PGRST202) — never after
   * an auth, conflict, compatibility or network error.
   */
  let rpc = 'unknown'; // 'yes' | 'missing'
  const lockedErr = () => Object.assign(new Error('read-only'), { locked: true });
  async function save(expected) {
    if (G.locked()) throw lockedErr(); // write boundary
    if (rpc !== 'missing') {
      try {
        const v = await api('/rest/v1/rpc/ct_save', {
          method: 'POST', body: { p_data: CT.store.state, p_expected: expected, p_writer: CT.model.VERSION },
        });
        rpc = 'yes';
        return v == null ? null : Number(v);
      } catch (e) {
        if (!(e.status === 404 && e.code === 'PGRST202')) throw e;
        rpc = 'missing';
        console.warn('ct_save is not installed (supabase/schema-guard.sql): using the direct write, without the server check');
      }
    }
    if (G.locked()) throw lockedErr();
    if (expected == null) {
      const rows = await api(`/rest/v1/${TABLE}`, {
        method: 'POST', body: { user_id: auth.user.id, data: CT.store.state, version: 1 },
        headers: { Prefer: 'return=representation' },
      });
      return rows && rows[0] ? rows[0].version : null;
    }
    const rows = await api(`/rest/v1/${TABLE}?user_id=eq.${auth.user.id}&version=eq.${expected}`, {
      method: 'PATCH', body: { data: CT.store.state, version: expected + 1, updated_at: new Date().toISOString() },
      headers: { Prefer: 'return=representation' },
    });
    return rows && rows.length ? rows[0].version : null;
  }

  /** First save of this account. Returns false when a row appeared meanwhile (→ conflict). */
  async function insertRemote() {
    const v = await save(null);
    if (v == null) return false;
    meta = { version: v, dirty: false };
    saveMeta();
    return true;
  }

  /** Push local state if the cloud still has the version we last saw. Returns false on conflict. */
  async function pushRemote() {
    const v = await save(meta.version);
    if (v == null) return false;
    meta = { version: v, dirty: false };
    saveMeta();
    return true;
  }

  /** The server refused a save because of the schema (ct_schema_*): see what the cloud holds now. */
  async function onSchemaRejected(e) {
    try {
      const r = await fetchRemote();
      const cls = rowCls(r);
      if (r && cls !== 'ok') { lockFromRemote(r, cls); return; }
    } catch (e2) { /* report the original refusal below */ }
    setStatus('error', 'השרת סירב לשמור בגלל גרסת הנתונים. הנתונים במכשיר לא נמחקו.');
    console.warn('save refused by the server', e && e.message);
  }

  /** Main sync step: reconcile local and cloud. */
  /** True when local data holds no real work yet (fresh device: only the empty course structure). */
  C.isEmpty = (st) => !st.studyLog.length && st.courses.every((c) =>
    !c.exams.length && !c.schedule.length && !c.notebook.length && !c.grade.components.some((g) => u.isNum(g.score))
    && c.categories.every((cat) => cat.items.every((i) => i.status === 'todo' && !i.note && !i.flag && !i.due)));

  C.syncNow = async ({ firstLogin = false } = {}) => {
    const pristine = C.isEmpty(CT.store.state);
    if (!C.enabled || !C.signedIn() || pushing || conflictOpen) return;
    if (G.locked()) { setStatus('locked'); return; }
    if (!navigator.onLine) { setStatus('offline'); return; }
    pushing = true;
    setStatus('syncing');
    try {
      const remote = await fetchRemote();
      const cls = rowCls(remote);
      if (remote && cls !== 'ok') {
        lockFromRemote(remote, cls); // before any branch: never merge, apply or push over it
      } else if (!remote) {
        // first device: upload what we have (a row that appeared meanwhile → conflict)
        if (!(await insertRemote())) await resolveConflict(await fetchRemote(), 'conflict');
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
      if (C.status === 'synced' && !meta.dirty) G.cleanup(auth && auth.user && auth.user.id);
    } catch (e) {
      console.warn('sync failed', e);
      if (e.locked) setStatus('locked');
      else if (/^ct_schema_/.test(String(e.message || ''))) await onSchemaRejected(e);
      else if (e instanceof TypeError) setStatus('offline');
      else if (e.status === 401) setStatus('signed-out', 'פג תוקף ההתחברות — התחבר שוב');
      else setStatus('error', heMsg(e));
    } finally {
      pushing = false;
    }
  };

  /** Both sides changed (or first login on a device with data): let the user choose. */
  function resolveConflict(remote, kind) {
    if (!remote) return Promise.resolve();
    const rc = rowCls(remote);
    if (rc !== 'ok') { lockFromRemote(remote, rc); return Promise.resolve(); } // no "keep this device" over newer data
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
        if (G.locked()) { setStatus('locked'); resolve(); return; } // locked while the dialog was open
        try {
          if (choice === 'cloud' && remoteState) {
            const hadWork = !C.isEmpty(CT.store.state);
            if (hadWork) localBackupBeforeOverwrite();
            applyRemote(remote);
            ui.toast(hadWork ? 'נטענו הנתונים מהענן. עותק של נתוני המכשיר נשמר בהורדות.' : 'נטענו הנתונים מהענן');
          } else {
            // write boundary: the cloud may have changed while the dialog was open — check it again first
            const fresh = await fetchRemote();
            const fc = rowCls(fresh);
            if (fresh && fc !== 'ok') { lockFromRemote(fresh, fc); resolve(); return; }
            if (fresh && fresh.version !== remote.version) { setStatus('error', 'הענן השתנה שוב — נסה "סנכרן עכשיו"'); resolve(); return; }
            meta.dirty = true;
            let ok;
            if (fresh) { meta.version = fresh.version; ok = await pushRemote(); } else ok = await insertRemote();
            if (!ok) { setStatus('error', 'הענן השתנה שוב — נסה "סנכרן עכשיו"'); resolve(); return; }
            ui.toast('הנתונים מהמכשיר הזה נשמרו בענן');
          }
          if (!G.locked()) setStatus('synced');
        } catch (e) {
          if (e.locked) setStatus('locked');
          else if (/^ct_schema_/.test(String(e.message || ''))) await onSchemaRejected(e);
          else setStatus('error', heMsg(e));
        }
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
    if (!C.enabled || !C.signedIn() || G.locked()) return;
    meta.dirty = true;
    saveMeta();
    if (C.status !== 'conflict') setStatus(navigator.onLine ? 'syncing' : 'offline');
    clearTimeout(pushTimer);
    pushTimer = setTimeout(() => C.syncNow(), 1500);
  };

  /** Read-only lock: drop a push that is waiting for its 1.5 s delay (save() re-checks the lock anyway). */
  C.cancelPending = () => { clearTimeout(pushTimer); pushTimer = null; };

  /** Lightweight check for changes made on another device. */
  async function poll() {
    if (!C.signedIn() || pushing || conflictOpen || document.hidden || meta.dirty || G.locked()) return;
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
    locked: ['bad', G.info && G.info.reason === 'malformed' ? 'גרסת הנתונים לא תקינה' : 'נדרש עדכון גרסה'],
  }[C.status] || ['', C.status]);
})(window.CT);
