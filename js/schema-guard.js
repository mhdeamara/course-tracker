/* schema-guard.js — read-only lock for data this app version must not save over.
 *
 * Two reasons: 'newer' (saved by a newer app version: a newer schema this code cannot fully read) and 'malformed'
 * (the schema version itself is not valid). In both cases nothing is normalized and saved:
 *  - the original stays exactly where it is (ct.data.v1 is never written while locked) or, when it came from the
 *    cloud, a copy of the row is kept under this account's own key;
 *  - unsynced local edits are kept separately (also per account);
 *  - the screen shows a normalized copy that lives in memory only;
 *  - every write path (store.persist, the auto-backup file, the cloud) checks G.locked() right before writing, so
 *    timers and requests scheduled before the lock write nothing.
 * The lock is set in memory first; saving the lock note and the copies may fail (storage full) without unlocking.
 * The server has its own guard (supabase/schema-guard.sql) for app versions that predate this file. */
(function (CT) {
  'use strict';
  const G = {};
  const DATA_KEY = 'ct.data.v1', LOCK_KEY = 'ct.lock.v1', AUTH_KEY = 'ct.auth', UPDATE_KEY = 'ct.update.at';
  const REMOTE = (uid) => `ct.incompatible.remote:${uid}`;
  const UNSYNCED = (uid) => `ct.unsynced.local:${uid || 'local'}`;
  G.KEYS = { DATA_KEY, LOCK_KEY, REMOTE, UNSYNCED, UPDATE_KEY };

  G.info = null;         // { reason: 'newer'|'malformed', found, supported, source: 'local'|'cloud', uid, at }
  G.remote = null;       // { data, version, updated_at } — the cloud row as received (cloud locks)
  G.unsynced = null;     // raw local state string with edits the cloud never got
  G.storeFailed = false; // a copy or the lock note could not be saved in this browser → download now
  G.msg = '';            // status of "עדכן עכשיו": an UPDATE_MSG code, translated where it is shown
  const listeners = [];
  G.onChange = (fn) => listeners.push(fn);
  const changed = () => listeners.forEach((fn) => { try { fn(G.info); } catch (e) { console.error(e); } });

  const ls = {
    get: (k) => { try { return localStorage.getItem(k); } catch (e) { return null; } },
    set: (k, v) => { try { localStorage.setItem(k, v); return true; } catch (e) { return false; } },
    del: (k) => { try { localStorage.removeItem(k); } catch (e) { /* ignore */ } },
  };
  const parse = (s) => { try { return JSON.parse(s); } catch (e) { return undefined; } };

  /** The signed-in account on this browser (from the saved session), or null. */
  G.uid = () => {
    const a = parse(ls.get(AUTH_KEY));
    return (a && a.user && typeof a.user.id === 'string' && a.user.id) || null;
  };
  G.locked = () => !!G.info;
  G.found = (data) => { const s = CT.model.schemaOf(data); return s.ok ? s.v : null; };

  /** Error thrown by store.commit / replace while locked: nothing was changed. */
  G.lockedError = () => Object.assign(new Error(CT.i18n ? CT.i18n.tx('lock.error') : 'האתר במצב קריאה בלבד'), { locked: true });

  /** Classify a stored state string. Cheap for the app's own format ({"version":N,... first); full parse otherwise.
   *  Returns { cls, data } — data only when it had to be parsed. Unparseable text counts as malformed. */
  G.classifyRaw = (raw) => {
    const m = /^\{"version":(\d{1,4})[,}]/.exec(raw);
    if (m) return { cls: CT.model.classify({ version: /^[1-9]/.test(m[1]) ? Number(m[1]) : m[1] }) };
    const data = parse(raw);
    return { cls: data === undefined ? 'malformed' : CT.model.classify(data), data };
  };

  /** Normalized copy for the screen only. Never saved. */
  G.display = (data) => {
    try {
      const st = CT.model.migrate(JSON.parse(JSON.stringify(data)));
      if (CT.game) CT.game.reconcile(st);
      return st;
    } catch (e) {
      return CT.model.initialData(); // unreadable structure: show an empty screen; the original is untouched
    }
  };

  /**
   * Lock. info: { reason, found, source, uid }. copies: { remote: row, local: raw string }.
   * Order: in-memory lock first (from now on nothing writes), then cancel scheduled writes, then try to keep copies.
   */
  G.lock = (info, copies = {}) => {
    if (!G.info) G.info = Object.assign({ supported: CT.model.VERSION, at: new Date().toISOString() }, info);
    try { if (CT.cloud && CT.cloud.cancelPending) CT.cloud.cancelPending(); } catch (e) { /* ignore */ }
    try { if (CT.backup && CT.backup.cancelAuto) CT.backup.cancelAuto(); } catch (e) { /* ignore */ }
    if (CT.store) CT.store.undoStack = [];
    let ok = ls.set(LOCK_KEY, JSON.stringify(G.info));
    if (copies.remote) { G.remote = copies.remote; ok = ls.set(REMOTE(G.info.uid), JSON.stringify(copies.remote)) && ok; }
    if (typeof copies.local === 'string') { G.unsynced = copies.local; ok = ls.set(UNSYNCED(G.info.uid), copies.local) && ok; }
    if (!ok) G.storeFailed = true;
    changed();
  };

  /** ct.data.v1 itself can't be saved over (loaded at start, or written by another tab). Returns the display copy. */
  G.lockLocal = (raw, data, cls) => {
    const d = data === undefined ? parse(raw) : data;
    G.lock({ reason: cls, found: d === undefined ? null : G.found(d), source: 'local', uid: null });
    return d === undefined ? CT.model.initialData() : G.display(d);
  };

  /**
   * At start, after the local data loaded normally: re-apply a lock that came from the cloud in an earlier run
   * (works offline). Only for the account that is signed in now; another account's lock and copies stay hidden.
   * Returns the state to show, or null when there is nothing to re-apply.
   */
  G.restore = (current) => {
    const info = parse(ls.get(LOCK_KEY));
    if (!info || typeof info !== 'object') return null;
    if (info.source !== 'cloud') { ls.del(LOCK_KEY); return null; } // a local lock is decided by ct.data.v1 itself
    const uid = G.uid();
    if (!uid || uid !== info.uid) return null;
    const row = parse(ls.get(REMOTE(uid)));
    const unsynced = ls.get(UNSYNCED(uid));
    if (row && row.data !== undefined && CT.model.classify(row.data) === 'ok') {
      ls.del(LOCK_KEY); // this app version reads it now: the normal sync takes over (copies stay until it succeeds)
      return null;
    }
    G.info = info;
    if (row && row.data !== undefined) { G.remote = row; G.info.reason = CT.model.classify(row.data); }
    if (unsynced) G.unsynced = unsynced;
    changed();
    return G.remote ? G.display(G.remote.data) : current; // no copy saved (storage was full): stay locked anyway
  };

  /** After a clean sync for this account: the copies are no longer needed. */
  G.cleanup = (uid) => {
    if (G.locked() || !uid) return;
    ls.del(REMOTE(uid));
    ls.del(UNSYNCED(uid));
    const info = parse(ls.get(LOCK_KEY));
    if (info && info.uid === uid) ls.del(LOCK_KEY);
  };

  /* ---------- other tabs ---------- */
  G.watch = () => {
    window.addEventListener('storage', (e) => {
      if (G.locked() || !e.newValue) return;
      let view = null;
      if (e.key === DATA_KEY) {
        const r = G.classifyRaw(e.newValue);
        if (r.cls !== 'ok') view = G.lockLocal(e.newValue, r.data, r.cls);
      } else if (e.key === LOCK_KEY) {
        const info = parse(e.newValue);
        if (info && info.source === 'cloud') view = G.restore(CT.store.state);
        else {
          const raw = ls.get(DATA_KEY);
          const r = raw ? G.classifyRaw(raw) : { cls: 'ok' };
          if (r.cls !== 'ok') view = G.lockLocal(raw, r.data, r.cls);
        }
      }
      if (view) { CT.store.state = view; CT.store.emit(); }
    });
  };

  /* ---------- "הורד גיבוי": every original this lock protects, each as its own importable file ---------- */
  const stamp = () => new Date().toISOString().slice(0, 10);
  const wrapRaw = (raw, extra) => {
    // keeps the stored text byte for byte inside the usual export envelope (importable later), if it is JSON at all
    if (parse(raw) === undefined) return raw;
    return `{"app":"course-tracker","exportedAt":${JSON.stringify(new Date().toISOString())},${extra ? extra + ',' : ''}"data":${raw}}`;
  };
  G.files = () => {
    const out = [];
    if (!G.info) return out;
    if (G.info.source === 'local') {
      const raw = ls.get(DATA_KEY);
      if (raw) out.push({ name: `course-tracker-${G.info.reason}-${stamp()}.json`, text: wrapRaw(raw) });
    }
    if (G.remote) {
      out.push({ name: `course-tracker-cloud-${G.info.reason}-${stamp()}.json`,
        text: JSON.stringify({ app: 'course-tracker', exportedAt: new Date().toISOString(), source: 'cloud',
          cloudVersion: G.remote.version, updatedAt: G.remote.updated_at, data: G.remote.data }) });
    }
    if (G.unsynced) out.push({ name: `course-tracker-unsynced-${stamp()}.json`, text: wrapRaw(G.unsynced, '"source":"unsynced"') });
    return out;
  };
  G.download = () => {
    const files = G.files();
    files.forEach((f, i) => setTimeout(() => {
      const a = document.createElement('a');
      a.href = URL.createObjectURL(new Blob([f.text], { type: 'application/json' }));
      a.download = f.name;
      document.body.appendChild(a);
      a.click();
      setTimeout(() => { URL.revokeObjectURL(a.href); a.remove(); }, 1000);
    }, i * 400));
    return files.length;
  };

  /* ---------- "עדכן עכשיו": activate the new service worker, then reload once ---------- */
  // codes → i18n keys 'update.<code>' (texts in js/i18n.js)
  G.UPDATE_MSG = { checking: 'update.checking', offline: 'update.offline', network: 'update.network', none: 'update.none',
    timeout: 'update.timeout', loop: 'update.loop', reloading: 'update.reloading' };
  const RELOAD_GAP = 5 * 60000;
  /** Reload at most once per 5 minutes (per tab session), so a version that still can't read the data never loops. */
  const reloadOnce = (env) => {
    const last = Number(env.session.get(UPDATE_KEY)) || 0;
    if (env.now() - last < RELOAD_GAP) return false;
    env.session.set(UPDATE_KEY, String(env.now()));
    env.reload();
    return true;
  };
  /**
   * env: { online(), getReg() → registration|null, waitController(ms) → Promise<boolean>, session {get,set}, now(), reload() }
   * Returns one of the UPDATE_MSG keys. A reload happens only after the new worker controls the page — the new
   * worker starts with a new, empty cache (old caches are deleted on activate), so every file then comes from the
   * new release and old and new files never mix.
   */
  G.runUpdate = async (env) => {
    if (!env.online()) return 'offline';
    let reg = null;
    try { reg = await env.getReg(); } catch (e) { reg = null; }
    if (!reg) return reloadOnce(env) ? 'reloading' : 'loop'; // no service worker (file:// or unsupported): a plain reload
    try { await reg.update(); } catch (e) { return 'network'; }
    // nothing waiting: a new release may already be active (sw.js activates itself on install) while this page still
    // runs the old files — one reload picks it up; a second press within 5 minutes means there really is nothing new
    if (!reg.waiting && !reg.installing) return reloadOnce(env) ? 'reloading' : 'none';
    const took = env.waitController(15000);
    if (reg.waiting) { try { reg.waiting.postMessage({ type: 'SKIP_WAITING' }); } catch (e) { /* the old worker may not listen */ } }
    if (!(await took)) return 'timeout';
    return reloadOnce(env) ? 'reloading' : 'loop';
  };
  G.update = async () => {
    G.msg = 'checking'; changed();
    const sw = typeof navigator !== 'undefined' && 'serviceWorker' in navigator ? navigator.serviceWorker : null;
    const r = await G.runUpdate({
      online: () => navigator.onLine !== false,
      getReg: async () => (sw ? (await sw.getRegistration()) || null : null),
      waitController: (ms) => new Promise((res) => {
        if (!sw) { res(false); return; }
        const t = setTimeout(() => res(false), ms);
        sw.addEventListener('controllerchange', () => { clearTimeout(t); res(true); }, { once: true });
      }),
      session: {
        get: (k) => { try { return sessionStorage.getItem(k); } catch (e) { return null; } },
        set: (k, v) => { try { sessionStorage.setItem(k, v); } catch (e) { /* ignore */ } },
      },
      now: () => Date.now(),
      reload: () => location.reload(),
    });
    G.msg = G.UPDATE_MSG[r] ? r : '';
    changed();
    return r;
  };

  /** A blocked change: point at the warning (throttled, it can come from background tasks too). */
  let lastNudge = 0;
  G.nudge = () => {
    const now = Date.now();
    if (now - lastNudge < 1500) return;
    lastNudge = now;
    if (G.onNudge) { try { G.onNudge(); } catch (e) { /* ignore */ } }
  };

  CT.guard = G;
})(window.CT);
