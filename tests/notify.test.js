// Notification center model: derivation, dedupe, stable ids, read state, account isolation, persistence, timestamps.
const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');

globalThis.window = globalThis;
require(path.join(__dirname, '..', 'js', 'notify.js'));
const N = globalThis.CT.notify;

function makeStorage(init = {}, { broken = false } = {}) {
  const m = new Map(Object.entries(init));
  if (broken) return { getItem() { throw new Error('blocked'); }, setItem() { throw new Error('blocked'); } };
  return { m, getItem: (k) => (m.has(k) ? m.get(k) : null), setItem: (k, v) => m.set(k, String(v)) };
}
const FULL = {
  moodle: { unseen: { new: 2, changed: 1, gone: 0, restored: 0, total: 3 }, lastChangeAt: '2026-11-27T08:00:00.000Z',
    error: { code: 'fetch', message: 'השרת של מודל לא ענה', at: '2026-11-27T07:00:00.000Z' },
    inbox: [{ uid: 'a', title: 'Survey' }, { uid: 'b', title: 'ש״ב 3' }, { uid: 'c', title: 'Quiz' }] },
  backup: { status: 'none', remind: true, days: 10, lastKey: '2026-11-17' },
  cloud: { enabled: true, signedIn: false, status: 'signed-out' },
  xp: { type: 'pen', count: 2, points: 30, lastId: 'p9', day: '2026-11-26' },
};
const ids = (list) => list.map((n) => n.id);

test('derive: every non-critical source becomes one notification, grouped in a fixed order', () => {
  const list = N.derive(FULL);
  assert.deepEqual(list.map((n) => n.group), ['moodle', 'moodle', 'moodle', 'backup', 'account', 'xp']);
  const ch = list[0];
  assert.equal(ch.title.k, 'notif.moodle.changes');
  assert.deepEqual(ch.sub.map((s) => s.k), ['notif.moodle.new', 'notif.moodle.changed']);
  assert.equal(ch.at, FULL.moodle.lastChangeAt);
  const inbox = list.find((n) => n.id.startsWith('moodle-inbox'));
  assert.deepEqual(inbox.sub.map((s) => s.raw), ['Survey', 'ש״ב 3', '…'], 'imported titles stay as they are');
  assert.equal(list.find((n) => n.group === 'xp').at, '2026-11-26');
});

test('derive: nothing to say → empty; critical states never become notifications', () => {
  assert.deepEqual(N.derive({}), []);
  const conflict = N.derive({ cloud: { enabled: true, signedIn: false, status: 'conflict' } });
  assert.deepEqual(conflict, [], 'no sign-in reminder while a sync conflict is open (that stays on screen)');
  const signedIn = N.derive({ cloud: { enabled: true, signedIn: true, status: 'error' } });
  assert.deepEqual(signedIn, [], 'sync errors are not notifications');
});

test('timestamps are only the real ones (never invented)', () => {
  const list = N.derive(FULL);
  const at = Object.fromEntries(list.map((n) => [n.id.split(':')[0], n.at]));
  assert.equal(at['backup-remind'], null);
  assert.equal(at.signin, null);
  assert.equal(at['moodle-inbox'], null);
  assert.equal(at['moodle-error'], FULL.moodle.error.at);
});

test('ids are stable across renders and change when the situation changes', () => {
  assert.deepEqual(ids(N.derive(FULL)), ids(N.derive(JSON.parse(JSON.stringify(FULL)))));
  const reordered = JSON.parse(JSON.stringify(FULL)); reordered.moodle.inbox.reverse();
  assert.equal(ids(N.derive(reordered)).find((i) => i.startsWith('moodle-inbox')), ids(N.derive(FULL)).find((i) => i.startsWith('moodle-inbox')), 'inbox id ignores order');
  const more = JSON.parse(JSON.stringify(FULL)); more.moodle.inbox.push({ uid: 'd', title: 'x' });
  assert.notEqual(ids(N.derive(more)).find((i) => i.startsWith('moodle-inbox')), ids(N.derive(FULL)).find((i) => i.startsWith('moodle-inbox')));
  const newChange = JSON.parse(JSON.stringify(FULL)); newChange.moodle.lastChangeAt = '2026-11-27T09:00:00.000Z';
  assert.notEqual(ids(N.derive(newChange))[0], ids(N.derive(FULL))[0]);
});

test('dedupe: one entry per id; backup permission wins over the reminder', () => {
  const list = N.derive({ ...FULL, backup: { status: 'needs-permission', remind: true, days: 3 } });
  assert.equal(list.filter((n) => n.group === 'backup').length, 1);
  assert.equal(list.find((n) => n.group === 'backup').id, 'backup-permission');
  assert.equal(new Set(ids(list)).size, list.length);
});

test('read state: marking read keeps unresolved items listed and does not come back unread', () => {
  const ls = makeStorage();
  const list = N.derive(FULL);
  assert.equal(N.unread(list, N.readMap(ls, null)).length, list.length);
  N.markRead(ls, null, ids(list), list);
  const again = N.derive(FULL); // next render
  assert.equal(again.length, list.length, 'still listed — reading does not resolve');
  assert.equal(N.unread(again, N.readMap(ls, null)).length, 0, 'read items stay read across renders');
  const newer = JSON.parse(JSON.stringify(FULL)); newer.moodle.lastChangeAt = '2026-11-28T09:00:00.000Z';
  const l2 = N.derive(newer);
  assert.deepEqual(N.unread(l2, N.readMap(ls, null)).map((n) => n.group), ['moodle'], 'a new Moodle update is unread again');
});

test('read state: entries of resolved items are pruned, so a later recurrence is new', () => {
  const ls = makeStorage();
  const list = N.derive(FULL);
  N.markRead(ls, null, ids(list), list);
  const resolved = N.derive({ ...FULL, cloud: { enabled: true, signedIn: true, status: 'synced' } });
  N.markRead(ls, null, [], resolved);
  assert.ok(!('signin' in N.readMap(ls, null)));
  assert.equal(N.unread(N.derive(FULL), N.readMap(ls, null)).map((n) => n.id).join(), 'signin');
});

test('account isolation: read state is kept apart per account and for local use', () => {
  const ls = makeStorage();
  const list = N.derive(FULL);
  N.markRead(ls, 'user-a', ids(list), list);
  assert.equal(N.unread(list, N.readMap(ls, 'user-a')).length, 0);
  assert.equal(N.unread(list, N.readMap(ls, 'user-b')).length, list.length);
  assert.equal(N.unread(list, N.readMap(ls, null)).length, list.length);
  assert.deepEqual([...ls.m.keys()], ['ct.notif.user-a']);
});

test('persistence: survives a reload; corrupt or blocked storage never throws', () => {
  const ls = makeStorage();
  const list = N.derive(FULL);
  N.markRead(ls, null, [list[0].id], list);
  const reloaded = makeStorage(Object.fromEntries(ls.m));
  assert.deepEqual(Object.keys(N.readMap(reloaded, null)), [list[0].id]);
  assert.deepEqual(N.readMap(makeStorage({ 'ct.notif.local': '{bad' }), null), {});
  assert.deepEqual(N.readMap(makeStorage({ 'ct.notif.local': '[1]' }), null), {});
  const broken = makeStorage({}, { broken: true });
  assert.doesNotThrow(() => N.markRead(broken, null, ids(list), list));
  assert.deepEqual(N.readMap(broken, null), {});
});

test('markRead ignores unknown ids and caps the stored map', () => {
  const ls = makeStorage();
  const list = N.derive(FULL);
  N.markRead(ls, null, ['not-a-notification'], list);
  assert.deepEqual(N.readMap(ls, null), {});
  const many = Array.from({ length: 260 }, (_, i) => ({ id: 'x' + i }));
  N.markRead(ls, null, many.map((n) => n.id), many);
  assert.equal(Object.keys(N.readMap(ls, null)).length, 200);
});

test('when(): relative and locale-aware, empty for missing times', () => {
  const now = new Date('2026-11-27T12:00:00');
  assert.equal(N.when(null, 'en-GB', now), '');
  assert.equal(N.when('nonsense', 'en-GB', now), '');
  assert.equal(N.when(new Date('2026-11-27T11:48:00').toISOString(), 'en-GB', now), '12 minutes ago');
  assert.equal(N.when('2026-11-26', 'en-GB', now), 'yesterday');
  assert.equal(N.when('2026-11-26', 'he-IL', now), 'אתמול');
  assert.match(N.when('2026-10-01', 'en-GB', now), /1 Oct/);
});
