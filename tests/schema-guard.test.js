// Schema guard: an app version never saves over data it cannot read (newer schema / malformed version).
// Run with:  node --test tests/schema-guard.test.js
//
// These are MOCKED tests: real modules (model, schema-guard, store, backup, cloud) on a fake localStorage, a fake
// Supabase (fetch) that applies the same rules as supabase/schema-guard.sql, and fake timers. The real database rules
// are tested by PART 2 of supabase/schema-guard.sql, which runs only in Supabase.
'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');

const JS = path.join(__dirname, '..', 'js');
const MODULES = ['utils', 'i18n', 'ical', 'moodle', 'game', 'adhkar', 'model', 'schema-guard', 'store', 'stats', 'backup', 'cloud'];
const UID = '11111111-1111-4111-8111-111111111111';
const OTHER = '22222222-2222-4222-8222-222222222222';

/* ---------- fake browser ---------- */
function makeStorage() {
  const m = new Map();
  return {
    m, full: false, failAll: false,
    getItem: (k) => (m.has(k) ? m.get(k) : null),
    setItem(k, v) { if (this.failAll || (this.full && !m.has(k))) throw new Error('QuotaExceededError'); m.set(k, String(v)); },
    removeItem: (k) => { m.delete(k); },
  };
}

/* ---------- fake Supabase: same rules as public.ct_user_data_guard / ct_save (mock, not the real DB) ---------- */
const schemaOf = (d) => {
  if (!d || typeof d !== 'object' || Array.isArray(d)) return -1;
  if (!('version' in d)) return 1;
  const s = typeof d.version === 'number' || typeof d.version === 'string' ? String(d.version) : '';
  return /^[1-9][0-9]{0,2}$/.test(s) ? Number(s) : -1;
};
function guardRule(old, data, writer) {
  const n = schemaOf(data);
  if (old) {
    const o = schemaOf(old.data);
    if (o < 0) return 'ct_schema_malformed_stored';
    if (writer < o) return 'ct_schema_too_old';
  }
  if (n < 0) return 'ct_schema_malformed';
  if (n > writer) return 'ct_schema_writer_mismatch';
  if (old && n < schemaOf(old.data)) return 'ct_schema_downgrade';
  return null;
}
function makeServer(row) {
  const S = { row, calls: [], rpcMissing: false, rpcFail: null, hold: null, beforeSave: null };
  const res = (status, body) => ({ ok: status >= 200 && status < 300, status, text: async () => (body === undefined ? '' : JSON.stringify(body)) });
  S.writes = () => S.calls.filter((c) => c.method !== 'GET' && !c.url.includes('/auth/'));
  S.fetch = async (url, opts = {}) => {
    const method = opts.method || 'GET';
    const body = opts.body ? JSON.parse(opts.body) : undefined;
    S.calls.push({ method, url, body });
    if (url.includes('/auth/v1/token')) return res(200, { access_token: 'tok', refresh_token: 'ref', expires_in: 3600, user: { id: UID, email: 'a@example.invalid' } });
    if (url.includes('/auth/v1/logout')) return res(204);
    if (url.includes('/rest/v1/rpc/ct_save')) {
      if (S.hold) await S.hold;
      if (S.rpcMissing) return res(404, { code: 'PGRST202', message: 'Could not find the function public.ct_save' });
      if (S.rpcFail) return res(S.rpcFail.status, S.rpcFail.body);
      if (S.beforeSave) S.beforeSave();
      const { p_data, p_expected, p_writer } = body;
      if (!Number.isInteger(p_writer) || p_writer < 1 || p_writer > 999) return res(400, { code: 'P0001', message: 'ct_schema_bad_writer' });
      if (p_expected == null) {
        if (S.row) return res(200, null);
        const err = guardRule(null, p_data, p_writer);
        if (err) return res(400, { code: 'P0001', message: err });
        S.row = { data: p_data, version: 1, updated_at: 'now' };
        return res(200, 1);
      }
      if (!S.row || S.row.version !== p_expected) return res(200, null);
      const err = guardRule(S.row, p_data, p_writer);
      if (err) return res(400, { code: 'P0001', message: err });
      S.row = { data: p_data, version: S.row.version + 1, updated_at: 'now' };
      return res(200, S.row.version);
    }
    if (url.includes('/rest/v1/user_data')) {
      if (method === 'GET') return res(200, S.row ? [S.row] : []);
      if (method === 'POST') { // legacy insert (no writer → baseline 4)
        const err = guardRule(null, body.data, 4);
        if (err) return res(400, { code: 'P0001', message: err });
        S.row = { data: body.data, version: 1, updated_at: 'now' };
        return res(201, [S.row]);
      }
      if (method === 'PATCH') { // legacy optimistic update (baseline 4)
        const v = Number(/version=eq\.(\d+)/.exec(url)[1]);
        if (!S.row || S.row.version !== v) return res(200, []);
        const err = guardRule(S.row, body.data, 4);
        if (err) return res(400, { code: 'P0001', message: err });
        S.row = { data: body.data, version: body.version, updated_at: 'now' };
        return res(200, [S.row]);
      }
    }
    return res(404, { message: 'unexpected ' + url });
  };
  return S;
}

/* ---------- boot the real modules on a fresh fake browser ---------- */
function boot({ local, ls, server, cloud = true } = {}) {
  for (const f of MODULES) delete require.cache[require.resolve(path.join(JS, f + '.js'))];
  const storage = ls || makeStorage();
  if (local !== undefined) storage.m.set('ct.data.v1', local);
  const listeners = {};
  const env = { storage, server: server || makeServer(null), reloads: 0, toasts: [], modals: [], listeners };
  globalThis.window = globalThis;
  delete globalThis.CT;
  globalThis.localStorage = storage;
  globalThis.sessionStorage = makeStorage();
  globalThis.addEventListener = (type, fn) => { (listeners[type] = listeners[type] || []).push(fn); };
  globalThis.location = { reload: () => { env.reloads++; }, href: 'https://example.test/', origin: 'https://example.test' };
  Object.defineProperty(globalThis, 'navigator', { value: { onLine: true }, configurable: true, writable: true });
  globalThis.fetch = (...a) => env.server.fetch(...a);
  globalThis.CT_CONFIG = cloud ? { supabaseUrl: 'https://proj.example.test', supabaseKey: 'sb_publishable_test' } : {};
  require(path.join(JS, 'utils.js'));
  globalThis.CT.ui = {
    toast: (m, o) => env.toasts.push({ m, o }),
    modal: (o) => { env.modals.push(o); },
    confirm: async () => true,
  };
  for (const f of MODULES.slice(1)) require(path.join(JS, f + '.js'));
  env.CT = globalThis.CT;
  return env;
}

const v4 = (extra = {}) => Object.assign({ version: 4, semesters: [], courses: [{ id: 'c1', name: 'מקומי', categories: [] }], studyLog: [], settings: {} }, extra);
const v5 = (extra = {}) => Object.assign({ version: 5, semesters: [], courses: [{ id: 'c9', name: 'חדש', categories: [], futureField: { x: 1 } }], studyLog: [], settings: {}, newSection: [1, 2] }, extra);
const signIn = (env) => env.CT.cloud.signIn('a@example.invalid', 'not-a-real-password');
const tick = () => new Promise((r) => setImmediate(r));

/* ================= detection ================= */
test('schemaOf / classify: valid, missing, newer and malformed versions', () => {
  const { CT } = boot();
  const M = CT.model;
  assert.deepEqual(M.schemaOf({ version: 4 }), { ok: true, v: 4 });
  assert.deepEqual(M.schemaOf({ version: '5' }), { ok: true, v: 5 });
  assert.deepEqual(M.schemaOf({ courses: [] }), { ok: true, v: 1 });
  for (const bad of ['abc', -1, 4.5, null, 0, 1000, '05', '', [4], {}, true]) assert.equal(M.classify({ version: bad }), 'malformed', String(bad));
  for (const bad of [null, 5, 'x', [1]]) assert.equal(M.classify(bad), 'malformed');
  assert.equal(M.classify({ version: 4 }), 'ok');
  assert.equal(M.classify({ version: 3 }), 'ok');
  assert.equal(M.classify({ version: 5 }), 'newer');
});

test('migrate keeps the newer-schema mark (the old bug overwrote it)', () => {
  const { CT } = boot();
  const st = CT.model.migrate(v5({ meta: { createdAt: 'x' } }));
  assert.equal(st.meta.newerSchema, 5);
  assert.equal(CT.model.migrate(v4()).meta.newerSchema, undefined);
});

/* ================= local data ================= */
test('newer local data: read-only, stored text untouched by load, commit, replace, undo and persist', () => {
  const raw = JSON.stringify(v5());
  const env = boot({ local: raw, cloud: false });
  const { CT, storage } = env;
  let autos = 0;
  CT.backup.scheduleAutoSave = () => { autos++; };
  assert.equal(CT.store.load(), 'locked');
  assert.equal(CT.guard.locked(), true);
  assert.equal(CT.guard.info.reason, 'newer');
  assert.equal(CT.store.state.courses[0].name, 'חדש'); // display copy
  assert.throws(() => CT.store.commit('x', (s) => { s.courses = []; }), (e) => e.locked === true);
  assert.throws(() => CT.store.replace(CT.model.initialData(), 'x'), (e) => e.locked === true);
  CT.store.undo();
  assert.equal(CT.store.persist(), false);
  assert.equal(CT.store.state.courses.length, 1, 'nothing changed in memory either');
  assert.equal(storage.getItem('ct.data.v1'), raw, 'byte for byte');
  assert.equal(autos, 0);
});

test('malformed local version: locked as malformed (not "newer"), never normalized', () => {
  const raw = JSON.stringify(v4({ version: 'abc' }));
  const env = boot({ local: raw, cloud: false });
  assert.equal(env.CT.store.load(), 'locked');
  assert.equal(env.CT.guard.info.reason, 'malformed');
  assert.equal(env.storage.getItem('ct.data.v1'), raw);
});

test('unreadable JSON: kept as a copy and replaced (as before); if no copy can be kept, read-only instead', () => {
  let env = boot({ local: '{not json', cloud: false });
  assert.equal(env.CT.store.load(), 'new');
  assert.ok([...env.storage.m.keys()].some((k) => k.startsWith('ct.data.v1.corrupt-')));
  env = boot({ local: '{not json', cloud: false });
  env.storage.full = true; // the copy cannot be saved
  assert.equal(env.CT.store.load(), 'locked');
  assert.equal(env.CT.guard.info.reason, 'malformed');
  assert.equal(env.storage.getItem('ct.data.v1'), '{not json');
});

test('supported data behaves as before: load, commit, undo, persist', () => {
  const env = boot({ local: JSON.stringify(v4()), cloud: false });
  const { CT } = env;
  assert.equal(CT.store.load(), 'loaded');
  assert.equal(CT.guard.locked(), false);
  CT.store.commit('rename', (s) => { s.courses[0].name = 'שונה'; });
  assert.equal(JSON.parse(env.storage.getItem('ct.data.v1')).courses[0].name, 'שונה');
  CT.store.undo();
  assert.equal(JSON.parse(env.storage.getItem('ct.data.v1')).courses[0].name, 'מקומי');
});

test('another tab saved newer data: the next save here locks instead of overwriting it', () => {
  const env = boot({ local: JSON.stringify(v4()), cloud: false });
  const { CT, storage } = env;
  CT.store.load();
  const newer = JSON.stringify(v5());
  storage.m.set('ct.data.v1', newer); // the other tab
  CT.store.commit('x', (s) => { s.courses[0].name = 'דורס'; }); // the change runs in memory, the save refuses
  assert.equal(storage.getItem('ct.data.v1'), newer);
  assert.equal(CT.guard.locked(), true);
  assert.equal(CT.store.state.courses[0].name, 'חדש', 'the screen now shows the newer data, read-only');
});

test('storage event from another tab locks this tab at once', () => {
  const env = boot({ local: JSON.stringify(v4()), cloud: false });
  env.CT.store.load();
  env.CT.guard.watch();
  const newer = JSON.stringify(v5());
  env.storage.m.set('ct.data.v1', newer);
  env.listeners.storage.forEach((fn) => fn({ key: 'ct.data.v1', newValue: newer }));
  assert.equal(env.CT.guard.locked(), true);
  assert.equal(env.CT.store.state.courses[0].name, 'חדש');
});

test('storage failures never unlock: everything fails to save, the lock holds and nothing is written', () => {
  const raw = JSON.stringify(v5());
  const env = boot({ local: raw, cloud: false });
  env.storage.failAll = true;
  assert.equal(env.CT.store.load(), 'locked');
  assert.equal(env.CT.guard.storeFailed, true);
  assert.equal(env.CT.store.persist(), false);
  assert.equal(env.storage.getItem('ct.data.v1'), raw);
});

test('"הורד גיבוי" files: the local original byte for byte, inside the importable export envelope', () => {
  const raw = JSON.stringify(v5());
  const env = boot({ local: raw, cloud: false });
  env.CT.store.load();
  const files = env.CT.guard.files();
  assert.equal(files.length, 1);
  assert.ok(files[0].text.includes(raw));
  assert.deepEqual(JSON.parse(files[0].text).data, JSON.parse(raw));
});

test('import: newer and malformed files are refused; a supported file still imports', async () => {
  const env = boot({ local: JSON.stringify(v4()), cloud: false });
  const { CT } = env;
  CT.store.load();
  const file = (o) => ({ text: async () => JSON.stringify(o) });
  await CT.backup.importFile(file({ app: 'course-tracker', data: v5() }));
  assert.equal(CT.store.state.courses[0].name, 'מקומי');
  assert.match(env.toasts.pop().m, /גרסה חדשה יותר/);
  await CT.backup.importFile(file({ data: v4({ version: -1 }) }));
  assert.match(env.toasts.pop().m, /לא תקינה/);
  assert.equal(CT.store.state.courses[0].name, 'מקומי');
  await CT.backup.importFile(file({ data: v4({ courses: [{ id: 'c2', name: 'מיובא', categories: [] }] }) }));
  assert.equal(CT.store.state.courses[0].name, 'מיובא');
});

/* ================= cloud ================= */
test('newer cloud row: locked before any write; row and unsynced local edits kept per account; local untouched', async () => {
  const local = JSON.stringify(v4());
  const server = makeServer({ data: v5(), version: 7, updated_at: 'u' });
  const env = boot({ local, server });
  env.storage.m.set('ct.sync', JSON.stringify({ version: 6, dirty: true })); // edits the cloud never got
  env.CT.store.load();
  const afterLoad = env.storage.getItem('ct.data.v1'); // load re-saves supported data in its normalized form (as before)
  await signIn(env);
  assert.equal(env.CT.guard.locked(), true);
  assert.equal(env.CT.cloud.status, 'locked');
  assert.deepEqual(server.writes(), []);
  assert.equal(env.storage.getItem('ct.data.v1'), afterLoad);
  assert.deepEqual(JSON.parse(env.storage.getItem(`ct.incompatible.remote:${UID}`)).data, v5());
  assert.equal(env.storage.getItem(`ct.unsynced.local:${UID}`), afterLoad);
  assert.equal(JSON.parse(env.storage.getItem('ct.sync')).dirty, true, 'still marked unsynced');
  assert.equal(env.CT.store.state.courses[0].name, 'חדש');
  const names = env.CT.guard.files().map((f) => f.name).join(' ');
  assert.match(names, /cloud-newer/);
  assert.match(names, /unsynced/);
});

test('malformed cloud version: locked as malformed, nothing written', async () => {
  const server = makeServer({ data: v4({ version: 4.5 }), version: 3, updated_at: 'u' });
  const env = boot({ local: JSON.stringify(v4()), server });
  env.CT.store.load();
  await signIn(env);
  assert.equal(env.CT.guard.info.reason, 'malformed');
  assert.deepEqual(server.writes(), []);
});

test('reload after a cloud lock, offline: still locked, shows the kept copy, no network', () => {
  const local = JSON.stringify(v4());
  const ls = makeStorage();
  ls.m.set('ct.auth', JSON.stringify({ access_token: 't', refresh_token: 'r', expires_at: Date.now() + 3600e3, user: { id: UID } }));
  ls.m.set('ct.lock.v1', JSON.stringify({ reason: 'newer', found: 5, supported: 4, source: 'cloud', uid: UID }));
  ls.m.set(`ct.incompatible.remote:${UID}`, JSON.stringify({ data: v5(), version: 7 }));
  const env = boot({ local, ls });
  env.server.fetch = () => { throw new TypeError('offline'); };
  assert.equal(env.CT.store.load(), 'locked');
  assert.equal(env.CT.store.state.courses[0].name, 'חדש');
  assert.equal(JSON.parse(env.storage.getItem('ct.data.v1')).courses[0].name, 'מקומי', 'this device keeps its own data');
  assert.equal(env.CT.store.persist(), false);
});

test('another account on the same browser never sees the first account\'s lock or copies', () => {
  const ls = makeStorage();
  ls.m.set('ct.auth', JSON.stringify({ access_token: 't', user: { id: OTHER } }));
  ls.m.set('ct.lock.v1', JSON.stringify({ reason: 'newer', source: 'cloud', uid: UID }));
  ls.m.set(`ct.incompatible.remote:${UID}`, JSON.stringify({ data: v5(), version: 7 }));
  ls.m.set(`ct.unsynced.local:${UID}`, JSON.stringify(v4()));
  const env = boot({ local: JSON.stringify(v4()), ls });
  assert.equal(env.CT.store.load(), 'loaded');
  assert.equal(env.CT.guard.locked(), false);
  assert.equal(env.CT.guard.remote, null);
  assert.deepEqual(env.CT.guard.files(), []);
  assert.ok(ls.getItem(`ct.incompatible.remote:${UID}`), 'the first account\'s copy is kept for it');
});

test('after the app is updated (it reads the kept row now): the lock lifts, copies stay until a clean sync', () => {
  const ls = makeStorage();
  ls.m.set('ct.auth', JSON.stringify({ access_token: 't', user: { id: UID } }));
  ls.m.set('ct.lock.v1', JSON.stringify({ reason: 'newer', source: 'cloud', uid: UID }));
  ls.m.set(`ct.incompatible.remote:${UID}`, JSON.stringify({ data: v4(), version: 7 }));
  const env = boot({ local: JSON.stringify(v4()), ls });
  assert.equal(env.CT.store.load(), 'loaded');
  assert.equal(ls.getItem('ct.lock.v1'), null);
  assert.ok(ls.getItem(`ct.incompatible.remote:${UID}`));
});

test('sign-out while showing a cloud lock reloads the page (nothing of it stays on screen)', async () => {
  const server = makeServer({ data: v5(), version: 2, updated_at: 'u' });
  const env = boot({ local: JSON.stringify(v4()), server });
  env.CT.store.load();
  await signIn(env);
  await env.CT.cloud.signOut();
  assert.equal(env.reloads, 1);
});

test('same-version corruption by an older writer is refused (mock of the DB rule) and the client locks', async () => {
  // the row turns v5 between this device's read and its save (another device upgraded it meanwhile)
  const server = makeServer({ data: v4(), version: 1, updated_at: 'u' });
  const env = boot({ local: JSON.stringify(v4()), server });
  env.storage.m.set('ct.sync', JSON.stringify({ version: 1, dirty: true }));
  env.CT.store.load();
  server.beforeSave = () => { server.row = { data: v5(), version: 1, updated_at: 'u2' }; server.beforeSave = null; };
  await signIn(env);
  assert.deepEqual(server.row.data, v5(), 'the newer row survived');
  assert.equal(env.CT.guard.locked(), true);
  assert.equal(env.CT.guard.info.reason, 'newer');
  // the legacy path (no ct_save, an app built before this fix) is refused by the same rule even if it keeps version 5
  assert.equal(guardRule({ data: v5() }, Object.assign(v4(), { version: 5 }), 4), 'ct_schema_too_old');
});

test('pending writes when the lock activates: the scheduled push and auto-backup write nothing', async (t) => {
  const server = makeServer({ data: v4(), version: 1, updated_at: 'u' });
  const env = boot({ local: JSON.stringify(v4()), server });
  env.CT.store.load();
  await signIn(env); // in sync, version 1
  let fileWrites = 0;
  env.CT.backup.handle = { createWritable: async () => ({ write: async () => { fileWrites++; }, close: async () => {}, abort: async () => {} }) };
  env.CT.backup.status = 'granted';
  t.mock.timers.enable({ apis: ['setTimeout'] });
  env.CT.store.commit('edit', (s) => { s.courses[0].name = 'עריכה'; }); // schedules push (1.5 s) and file save (2 s)
  env.CT.guard.lock({ reason: 'newer', found: 5, source: 'local', uid: null });
  t.mock.timers.tick(5000);
  t.mock.timers.reset();
  await tick();
  await env.CT.backup.writeNow(); // even a direct call
  assert.deepEqual(server.writes(), []);
  assert.equal(fileWrites, 0);
});

test('a request already in flight when the lock activates: no second write, the lock holds', async () => {
  const server = makeServer({ data: v4(), version: 1, updated_at: 'u' });
  const env = boot({ local: JSON.stringify(v4()), server });
  env.CT.store.load();
  await signIn(env);
  let release;
  server.hold = new Promise((r) => { release = r; });
  env.CT.store.state.courses[0].name = 'x';
  env.storage.m.set('ct.sync', JSON.stringify({ version: 1, dirty: true }));
  env.CT.cloud.onLocalChange();
  const p = env.CT.cloud.syncNow();
  await tick();
  env.CT.guard.lock({ reason: 'newer', found: 5, source: 'local', uid: null });
  release();
  await p;
  assert.equal(server.writes().length, 1, 'only the request that was already sent');
  assert.equal(env.CT.guard.locked(), true);
  await env.CT.cloud.syncNow();
  assert.equal(server.writes().length, 1);
});

test('conflict dialog answered after the lock activated: nothing is pushed', async () => {
  const server = makeServer({ data: v4({ courses: [] }), version: 3, updated_at: 'u' });
  const env = boot({ local: JSON.stringify(v4()), server });
  env.storage.m.set('ct.sync', JSON.stringify({ version: 2, dirty: true }));
  env.CT.store.load();
  const p = signIn(env);
  await tick(); await tick(); await tick();
  const dlg = env.modals.pop();
  assert.ok(dlg, 'the conflict dialog opened');
  env.CT.guard.lock({ reason: 'newer', found: 5, source: 'local', uid: null });
  dlg.actions.find((a) => !a.primary).fn(); // "השאר את המכשיר הזה"
  await p;
  assert.deepEqual(server.writes(), []);
});

test('conflict dialog: the cloud became newer while it was open → lock, no push', async () => {
  const server = makeServer({ data: v4({ courses: [] }), version: 3, updated_at: 'u' });
  const env = boot({ local: JSON.stringify(v4()), server });
  env.storage.m.set('ct.sync', JSON.stringify({ version: 2, dirty: true }));
  env.CT.store.load();
  const p = signIn(env);
  await tick(); await tick(); await tick();
  const dlg = env.modals.pop();
  server.row = { data: v5(), version: 4, updated_at: 'u2' };
  dlg.actions.find((a) => !a.primary).fn();
  await p;
  assert.deepEqual(server.writes(), []);
  assert.equal(env.CT.guard.locked(), true);
});

test('supported cloud data: saves go through ct_save with this app\'s schema; conflicts still detected', async () => {
  const server = makeServer({ data: v4(), version: 1, updated_at: 'u' });
  const env = boot({ local: JSON.stringify(v4()), server });
  env.storage.m.set('ct.sync', JSON.stringify({ version: 1, dirty: true }));
  env.CT.store.load();
  await signIn(env);
  const w = server.writes();
  assert.equal(w.length, 1);
  assert.match(w[0].url, /rpc\/ct_save$/);
  assert.equal(w[0].body.p_writer, 4);
  assert.equal(w[0].body.p_expected, 1);
  assert.equal(server.row.version, 2);
  assert.equal(env.CT.cloud.status, 'synced');
  // cloud changed elsewhere + local edits → the usual dialog, no blind write
  server.row = { data: v4({ courses: [] }), version: 5, updated_at: 'u' };
  env.CT.store.commit('edit', (s) => { s.courses[0].name = 'y'; });
  const p = env.CT.cloud.syncNow(); // waits for the user's answer in the dialog
  await tick(); await tick(); await tick();
  assert.equal(env.modals.length, 1);
  assert.equal(server.writes().length, 1, 'no write while the dialog is open');
  env.modals.pop().actions.find((a) => a.primary).fn(); // "use the cloud copy"
  await p;
  assert.equal(server.writes().length, 1);
});

test('first save of a new account inserts through ct_save (expected = null)', async () => {
  const server = makeServer(null);
  const env = boot({ local: JSON.stringify(v4()), server });
  env.CT.store.load();
  await signIn(env);
  assert.equal(server.row.version, 1);
  assert.equal(server.writes()[0].body.p_expected, null);
});

test('legacy write only when ct_save is confirmed missing (PGRST202), never after other errors', async () => {
  // confirmed missing → PATCH
  let server = makeServer({ data: v4(), version: 1, updated_at: 'u' });
  server.rpcMissing = true;
  let env = boot({ local: JSON.stringify(v4()), server });
  env.storage.m.set('ct.sync', JSON.stringify({ version: 1, dirty: true }));
  env.CT.store.load();
  await signIn(env);
  assert.deepEqual(server.writes().map((c) => c.method), ['POST', 'PATCH']);
  assert.equal(server.row.version, 2);
  // any other failure → no fallback
  const failures = [
    { status: 401, body: { code: 'PGRST301', message: 'JWT expired' } },
    { status: 403, body: { code: '42501', message: 'permission denied' } },
    { status: 404, body: { message: 'not found' } }, // 404 without PGRST202 is not proof
    { status: 400, body: { code: 'P0001', message: 'ct_schema_too_old' } },
    { status: 500, body: { message: 'boom' } },
  ];
  for (const f of failures) {
    server = makeServer({ data: v4(), version: 1, updated_at: 'u' });
    server.rpcFail = f;
    env = boot({ local: JSON.stringify(v4()), server });
    env.storage.m.set('ct.sync', JSON.stringify({ version: 1, dirty: true }));
    env.CT.store.load();
    await signIn(env);
    assert.equal(server.writes().filter((c) => c.method === 'PATCH').length, 0, `no PATCH after ${f.status} ${f.body.message}`);
    assert.equal(server.row.version, 1);
  }
  // network error → offline, no fallback
  server = makeServer({ data: v4(), version: 1, updated_at: 'u' });
  env = boot({ local: JSON.stringify(v4()), server });
  env.storage.m.set('ct.sync', JSON.stringify({ version: 1, dirty: true }));
  env.CT.store.load();
  const real = server.fetch;
  server.fetch = async (url, o) => { if (url.includes('rpc/ct_save')) throw new TypeError('Failed to fetch'); return real(url, o); };
  await signIn(env);
  assert.equal(env.CT.cloud.status, 'offline');
  assert.equal(server.row.version, 1);
});

/* ================= "עדכן עכשיו" ================= */
function updEnv(o = {}) {
  const session = new Map();
  const e = {
    reloads: 0, posted: [],
    online: () => o.online !== false,
    getReg: async () => (o.reg === undefined ? null : o.reg),
    waitController: async () => o.takes !== false,
    session: { get: (k) => session.get(k) || null, set: (k, v) => session.set(k, v) },
    now: () => o.now || 1e12,
    reload: () => { e.reloads++; },
  };
  return e;
}
test('update flow: offline, network failure, nothing new, timeout — no reload', async () => {
  const { CT } = boot({ cloud: false });
  const G = CT.guard;
  assert.equal(await G.runUpdate(updEnv({ online: false })), 'offline');
  let e = updEnv({ reg: { update: async () => { throw new TypeError('net'); } } });
  assert.equal(await G.runUpdate(e), 'network');
  assert.equal(e.reloads, 0);
  // nothing waiting: the new release may already be active (sw.js activates on install) → one reload, then "none"
  e = updEnv({ reg: { update: async () => {}, waiting: null, installing: null } });
  assert.equal(await G.runUpdate(e), 'reloading');
  assert.equal(await G.runUpdate(e), 'none');
  assert.equal(e.reloads, 1);
  const w = { postMessage(m) { e.posted.push(m); } };
  e = updEnv({ reg: { update: async () => {}, waiting: w }, takes: false });
  assert.equal(await G.runUpdate(e), 'timeout');
  assert.equal(e.reloads, 0);
});
test('update flow: a waiting worker is told to take over, then exactly one reload; no reload loop', async () => {
  const { CT } = boot({ cloud: false });
  const G = CT.guard;
  const posted = [];
  const reg = { update: async () => {}, waiting: { postMessage: (m) => posted.push(m) } };
  const e = updEnv({ reg });
  assert.equal(await G.runUpdate(e), 'reloading');
  assert.deepEqual(posted, [{ type: 'SKIP_WAITING' }]);
  assert.equal(e.reloads, 1);
  // the reloaded page still can't read the data and the user presses again within 5 minutes → no second reload
  assert.equal(await G.runUpdate(e), 'loop');
  assert.equal(e.reloads, 1);
  // a worker that is still installing: wait for it to take control, then reload
  const e2 = updEnv({ reg: { update: async () => {}, installing: {} } });
  assert.equal(await G.runUpdate(e2), 'reloading');
  // no service worker at all: one plain reload, then no more
  const e3 = updEnv({ reg: null });
  assert.equal(await G.runUpdate(e3), 'reloading');
  assert.equal(await G.runUpdate(e3), 'loop');
  assert.equal(e3.reloads, 1);
});
