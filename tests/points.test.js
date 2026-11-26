// Unit tests for the points ledger and levels (CT.game) — run with:  node --test tests/points.test.js
'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
globalThis.window = globalThis;
require('../js/utils.js');
require('../js/game.js');
const g = globalThis.CT.game;

// 2026-11-26 at 12:00 local time; the points day starts at 04:00
const NOW = new Date(2026, 10, 26, 12, 0);
const at = (d, h = 12) => new Date(2026, 10, d, h, 0);
let n = 0;
const item = (title, o = {}) => Object.assign({ id: `i${++n}`, title, status: 'todo', due: '', note: '', completedAt: null }, o);
const state = (cats, extra = {}) => Object.assign({
  courses: [{ id: 'c1', name: 'קורס', categories: cats.map(([name, items]) => ({ id: `k-${name}`, name, items })) }],
  studyLog: [],
}, extra);
const sumP = (entries) => entries.reduce((s, e) => s + e.p, 0);
// points system started a few days ago; goals / challenge / badges off unless a test turns them on
const fresh = (st, when = at(20)) => { g.ensure(st, when); st.game.cfg.extras = false; return st; };

test('day boundary is 04:00', () => {
  assert.equal(g.dayKey(new Date(2026, 10, 26, 3, 59)), '2026-11-25');
  assert.equal(g.dayKey(new Date(2026, 10, 26, 4, 0)), '2026-11-26');
});

test('accrual: finishing an item earns by difficulty, with on-time and early bonuses', () => {
  const lec = item('הרצאה 1'), hw = item('ש״ב 1', { due: '2026-11-30' }), hwLate = item('ש״ב 2', { due: '2026-11-20' });
  const st = fresh(state([['הרצאות', [lec]], ['שיעורי בית', [hw, hwLate]]]));
  [lec, hw, hwLate].forEach((i) => { i.status = 'done'; });
  const added = g.reconcile(st, NOW);
  const byKey = Object.fromEntries(added.map((e) => [e.k, e]));
  assert.equal(byKey['item:' + lec.id].p, 12); // normal
  assert.equal(byKey['item:' + hw.id].p, 20 + 5 + 5); // hard + on time + 4 days early
  assert.equal(byKey['item:' + hwLate.id].p, 20); // late: no bonus, no penalty
  assert.deepEqual(byKey['item:' + hw.id].why, ['קשה', 'בזמן', 'מוקדם']);
  assert.equal(g.earned(st), 62);
});

test('no double accrual: reconcile twice and toggling V back and forth', () => {
  const a = item('הרצאה 1');
  const st = fresh(state([['הרצאות', [a]]]));
  a.status = 'done';
  assert.equal(sumP(g.reconcile(st, NOW)), 12);
  assert.equal(g.reconcile(st, NOW).length, 0, 'second reconcile adds nothing');
  for (let i = 0; i < 5; i++) {
    a.status = 'todo'; g.reconcile(st, NOW);
    a.status = 'done'; g.reconcile(st, NOW);
  }
  assert.equal(g.earned(st), 12, 'net is exactly one award');
});

test('undo: un-checking reverses exactly what was given; restoring a snapshot restores the ledger', () => {
  const a = item('ש״ב 1', { due: '2026-11-27' });
  const st = fresh(state([['שיעורי בית', [a]]]));
  const snap = JSON.stringify(st);
  a.status = 'done';
  const [award] = g.reconcile(st, NOW);
  assert.equal(award.p, 25);
  a.status = 'todo';
  const [rev] = g.reconcile(st, NOW);
  assert.equal(rev.t, 'rev');
  assert.equal(rev.p, -25);
  assert.equal(g.earned(st), 0);
  // store.undo() replaces the state with the snapshot taken before the change — ledger included
  const restored = JSON.parse(snap);
  assert.equal(g.earned(restored), 0);
  assert.equal(g.reconcile(restored, NOW).length, 0);
});

test('baseline: things done before the points system started never earn', () => {
  const old = item('הרצאה 1', { status: 'done', note: 'הערה ארוכה מספיק כדי להיחשב כהערה' });
  const st = state([['הרצאות', [old]]], { studyLog: [{ id: 's1', courseId: 'c1', date: '2026-11-01', minutes: 60 }] });
  g.ensure(st, at(20));
  st.game.cfg.extras = false;
  assert.equal(g.reconcile(st, NOW).length, 0);
  old.status = 'todo'; g.reconcile(st, NOW);
  old.status = 'done';
  assert.equal(g.reconcile(st, NOW).length, 0, 're-checking an old item does not earn');
  assert.equal(g.earned(st), 0);
});

test('daily caps: study time stops at the cap, and a capped award is not retried', () => {
  const st = fresh(state([['הרצאות', []]]));
  st.studyLog.push({ id: 's1', date: '2026-11-26', minutes: 100 }, { id: 's2', date: '2026-11-26', minutes: 100 });
  const added = g.reconcile(st, NOW);
  assert.deepEqual(added.map((e) => e.p), [40, 20]); // 4 per 10 min, cap 60/day
  assert.ok(added[1].why.includes('תקרה יומית'));
  assert.equal(g.reconcile(st, NOW).length, 0);
  st.studyLog.push({ id: 's3', date: '2026-11-26', minutes: 30 });
  assert.equal(g.reconcile(st, NOW)[0].p, 0);
  // next day the cap starts over
  st.studyLog.push({ id: 's4', date: '2026-11-27', minutes: 30 });
  assert.equal(g.reconcile(st, at(27))[0].p, 12);
});

test('deleting a study entry takes its points back', () => {
  const st = fresh(state([['הרצאות', []]]));
  st.studyLog.push({ id: 's1', date: '2026-11-26', minutes: 25 });
  g.reconcile(st, NOW);
  assert.equal(g.earned(st), 10);
  st.studyLog = [];
  g.reconcile(st, NOW);
  assert.equal(g.earned(st), 0);
});

test('notes earn once per item, only from 20 characters, and are not taken back', () => {
  const a = item('הרצאה 1');
  const st = fresh(state([['הרצאות', [a]]]));
  a.note = 'קצר';
  assert.equal(g.reconcile(st, NOW).length, 0);
  a.note = 'סיכום: משפט נורטון ותבנין';
  assert.equal(sumP(g.reconcile(st, NOW)), 3);
  a.note = ''; g.reconcile(st, NOW);
  a.note = 'סיכום חדש וארוך עוד יותר מקודם';
  assert.equal(g.reconcile(st, NOW).length, 0);
  assert.equal(g.earned(st), 3);
});

test('closing a "צריך לחזור" item earns a bonus; finishing a course earns once', () => {
  const a = item('תרגול 3', { status: 'done', fromReview: true });
  const st = fresh(state([['תרגולים', [a]]]));
  // the item above was done before the system started → baseline; a new one after:
  const b = item('תרגול 4');
  st.courses[0].categories[0].items.push(b);
  b.status = 'done'; b.fromReview = true;
  st.courses[0].outcome = { type: 'graded', grade: 91 };
  const added = g.reconcile(st, NOW);
  assert.deepEqual(added.map((e) => [e.t, e.p]).sort(), [['course', 100], ['item', 12], ['review', 5]]);
  st.courses[0].outcome = { type: 'withdrawn' };
  assert.equal(g.reconcile(st, NOW)[0].p, -100);
});

test('streak: days in a row with points; multiplier applies to finished items', () => {
  const items = [1, 2, 3, 4].map((i) => item(`הרצאה ${i}`));
  const st = fresh(state([['הרצאות', items]]), at(10));
  [23, 24, 25].forEach((d, i) => { items[i].status = 'done'; g.reconcile(st, at(d)); });
  assert.deepEqual(g.streak(st, '2026-11-25'), { days: 3, today: true });
  assert.deepEqual(g.streak(st, '2026-11-26'), { days: 3, today: false }); // not broken yet today
  items[3].status = 'done';
  const [e] = g.reconcile(st, NOW); // 4th day in a row → ×1.1
  assert.equal(e.p, Math.round(12 * 1.1));
  assert.ok(e.why.includes('רצף ×1.1'));
  assert.deepEqual(g.streak(st, '2026-11-28'), { days: 0, today: false }); // a missed day breaks it
});

test('levels: thresholds, crossing one, and the level never goes down', () => {
  assert.equal(g.levelOf(0).n, 1);
  assert.equal(g.levelOf(149).n, 1);
  assert.equal(g.levelOf(150).n, 2);
  assert.equal(g.levelStart(3), 375);
  assert.equal(g.levelOf(374).n, 2);
  assert.equal(g.levelOf(375).n, 3);
  assert.equal(g.levelOf(150).name, 'בתנופה');
  assert.equal(g.levelOf(225).pct, 33);
  for (let k = 2; k < 30; k++) assert.ok(g.levelStart(k + 1) - g.levelStart(k) > g.levelStart(k) - g.levelStart(k - 1));
  // crossing by real awards, then losing points: the level stays
  const items = Array.from({ length: 13 }, (_, i) => item(`ש״ב ${i}`));
  const st = fresh(state([['שיעורי בית', items]]));
  items.slice(0, 7).forEach((i) => { i.status = 'done'; });
  g.reconcile(st, NOW);
  assert.equal(g.summary(st, NOW).level.n, 1); // 7 × 20 = 140
  items[7].status = 'done'; g.reconcile(st, NOW);
  assert.equal(g.summary(st, NOW).level.n, 2); // 160
  items[7].status = 'todo'; items[6].status = 'todo'; g.reconcile(st, NOW);
  assert.equal(g.earned(st), 120);
  assert.equal(g.summary(st, NOW).level.n, 2, 'level is based on the peak');
});

test('difficulty: automatic from category/title, manual override wins; disabled system awards nothing', () => {
  assert.equal(g.difficulty({ title: 'הרצאה 1' }, { name: 'הרצאות' }), 2);
  assert.equal(g.difficulty({ title: 'ניסוי 2 — דוח' }, { name: 'ניסוי 2' }), 3);
  assert.equal(g.difficulty({ title: 'ש״ב 3' }, { name: 'שיעורי בית' }), 3);
  assert.equal(g.difficulty({ title: 'ש״ב 3', diff: 1 }, { name: 'שיעורי בית' }), 1);
  const a = item('הרצאה 1');
  const st = fresh(state([['הרצאות', [a]]]));
  st.game.cfg = { enabled: false, extras: false, pts: { normal: 99 } };
  a.status = 'done';
  assert.equal(g.reconcile(st, NOW).length, 0);
  st.game.cfg.enabled = true;
  assert.equal(g.reconcile(st, NOW)[0].p, 99, 'configured values are used');
});

test('migration v2 → v3: old data gets a points ledger, existing progress is the baseline, re-import keeps the ledger', () => {
  require('../js/ical.js');
  require('../js/moodle.js');
  require('../js/model.js');
  const M = globalThis.CT.model;
  assert.equal(M.VERSION, 4); // 4 added state.adhkar (see adhkar.test.js)
  const v2 = {
    version: 2, semesters: [], studyLog: [{ id: 's1', courseId: 'c1', date: '2026-11-01', minutes: 50 }], settings: {},
    courses: [{ id: 'c1', name: 'קורס', categories: [{ id: 'k', name: 'הרצאות', items: [{ id: 'a', title: 'הרצאה 1', status: 'done' }, { id: 'b', title: 'הרצאה 2', status: 'todo' }] }] }],
  };
  const st = M.migrate(JSON.parse(JSON.stringify(v2)));
  assert.equal(st.version, 4);
  assert.deepEqual(st.game.ledger, []);
  st.game.cfg.extras = false;
  assert.ok(st.game.base.includes('item:a') && st.game.base.includes('study:s1'));
  assert.equal(g.reconcile(st, NOW).length, 0, 'nothing old earns');
  st.courses[0].categories[0].items[1].status = 'done';
  assert.equal(sumP(g.reconcile(st, NOW)), 12);
  // a JSON backup includes the ledger; importing it again keeps the points
  const again = M.migrate(JSON.parse(JSON.stringify(st)));
  assert.equal(g.earned(again), 12);
  assert.equal(g.reconcile(again, NOW).length, 0);
});

test('"רק 5 דקות": starting earns once per item per day, with a daily cap', () => {
  const items = Array.from({ length: 7 }, (_, i) => item(`ש״ב ${i}`));
  const st = fresh(state([['שיעורי בית', items]]));
  const start = (it, d = '2026-11-26') => st.game.starts.push({ id: `s${++n}`, itemId: it.id, d, label: it.title });
  start(items[0]); start(items[0]); start(items[0]);
  assert.deepEqual(g.reconcile(st, NOW).map((e) => [e.t, e.p]), [['start', 3]], 'three starts of the same item today = one award');
  items.slice(1).forEach((it) => start(it));
  const added = g.reconcile(st, NOW);
  assert.equal(sumP(added), 12, 'cap of 15 per day: 3 already + 12 more');
  start(items[0], '2026-11-27');
  assert.equal(g.reconcile(st, at(27))[0].p, 3, 'the same item again on another day');
});

test('subtasks: each one checked earns, unchecking or deleting takes it back', () => {
  const a = item('ש״ב 1', { subs: [{ id: 'x', t: 'שאלה 1', done: false }, { id: 'y', t: 'שאלה 2', done: false }] });
  const st = fresh(state([['שיעורי בית', [a]]]));
  a.subs[0].done = true;
  assert.deepEqual(g.reconcile(st, NOW).map((e) => [e.t, e.p, e.label]), [['sub', 2, 'שאלה 1']]);
  a.subs[1].done = true; g.reconcile(st, NOW);
  assert.equal(g.earned(st), 4);
  a.subs[0].done = false; g.reconcile(st, NOW);
  a.subs = a.subs.filter((s) => s.id !== 'y'); g.reconcile(st, NOW);
  assert.equal(g.earned(st), 0);
  a.subs[0].done = true; g.reconcile(st, NOW); g.reconcile(st, NOW);
  assert.equal(g.earned(st), 2, 'no double');
});

/* ---------- goals, challenge, badges, prizes, seasons ---------- */
const withExtras = (st) => { st.game.cfg.extras = true; return st; };
const ofType = (added, t) => added.filter((e) => e.t === t);

test('daily goal: reached with 2 items (or 45 min), taken back the same day if undone; past days stay', () => {
  const [a, b] = [item('הרצאה 1'), item('הרצאה 2')];
  const st = withExtras(fresh(state([['הרצאות', [a, b]]])));
  a.status = 'done';
  assert.equal(ofType(g.reconcile(st, NOW), 'goal').length, 0);
  b.status = 'done';
  const goal = ofType(g.reconcile(st, NOW), 'goal');
  assert.deepEqual(goal.map((e) => [e.k, e.p]), [['goal:d:2026-11-26', 15]]);
  b.status = 'todo';
  assert.ok(g.reconcile(st, NOW).some((e) => e.t === 'rev' && e.k === 'goal:d:2026-11-26'));
  b.status = 'done'; g.reconcile(st, NOW);
  // next day: yesterday's goal is settled even if yesterday's item is unchecked
  b.status = 'todo';
  const next = g.reconcile(st, at(27));
  assert.ok(!next.some((e) => e.k === 'goal:d:2026-11-26'));
});

test('weekly goal by minutes; perfect day needs both items and minutes', () => {
  const st = withExtras(fresh(state([['הרצאות', []]])));
  st.game.cfg.caps = { study: 1000 };
  st.studyLog.push({ id: 'w1', date: '2026-11-26', minutes: 300 });
  const added = g.reconcile(st, NOW);
  assert.ok(added.some((e) => e.k === 'goal:w:2026-11-22' && e.p === 50), 'week starts on Sunday 22/11');
  assert.ok(added.some((e) => e.k === 'goal:d:2026-11-26'));
  assert.ok(!g.badgesEarned(st).has('perfect-day'), 'minutes alone are not a perfect day');
  const items = [item('a'), item('b')];
  st.courses[0].categories[0].items.push(...items);
  items.forEach((i) => { i.status = 'done'; });
  g.reconcile(st, NOW);
  assert.ok(g.badgesEarned(st).has('perfect-day'));
});

test('daily challenge: same one all day, earned once', () => {
  assert.equal(g.challenge('2026-11-26').id, g.challenge('2026-11-26').id);
  const ids = new Set(Array.from({ length: 30 }, (_, i) => g.challenge(`2026-12-${String(i + 1).padStart(2, '0')}`).id));
  assert.ok(ids.size >= 4, 'it varies across days');
  const st = withExtras(fresh(state([['שיעורי בית', [item('ש״ב 1'), item('ש״ב 2'), item('ש״ב 3')]]])));
  const day = ['2026-11-26', '2026-11-27', '2026-11-28', '2026-11-29', '2026-11-30'].find((d) => g.challenge(d).id === 'three' || g.challenge(d).id === 'hard');
  assert.ok(day, 'one of these days has an item challenge');
  const when = at(Number(day.slice(8)));
  st.courses[0].categories[0].items.forEach((i) => { i.status = 'done'; });
  const chal = ofType(g.reconcile(st, when), 'chal');
  assert.equal(chal.length, 1);
  assert.equal(chal[0].p, 10);
  assert.equal(ofType(g.reconcile(st, when), 'chal').length, 0);
});

test('badges: earned once, kept even when the reason is undone; secret ones too', () => {
  const a = item('תרגול 1', { due: '2026-11-10' });
  const st = withExtras(fresh(state([['תרגולים', [a]]])));
  a.status = 'done';
  const night = new Date(2026, 10, 27, 2, 30); // 02:30 → still the 26th's day, and a night owl
  const earned = ofType(g.reconcile(st, night), 'badge').map((e) => e.label).sort();
  assert.deepEqual(earned, ['ינשוף לילה', 'צעד ראשון', 'קאמבק', 'תרגול ראשון'].sort());
  a.status = 'todo'; g.reconcile(st, NOW);
  assert.equal(g.badgesEarned(st).size, 4, 'badges stay');
  a.status = 'done';
  assert.equal(ofType(g.reconcile(st, NOW), 'badge').length, 0, 'never twice');
  assert.equal(g.BADGES.length, 25);
  assert.equal(new Set(g.BADGES.map((b) => b.id)).size, 25);
  assert.deepEqual(g.BADGES.filter((b) => b.secret).map((b) => b.id).sort(), ['back', 'comeback', 'night']);
});

test('badges: streak, back after a break, thousand-point club', () => {
  const items = Array.from({ length: 4 }, (_, i) => item(`הרצאה ${i}`));
  const st = withExtras(fresh(state([['הרצאות', items]]), at(1)));
  [2, 3, 4].forEach((d, i) => { items[i].status = 'done'; g.reconcile(st, at(d)); });
  assert.ok(g.badgesEarned(st).has('streak3'));
  assert.ok(!g.badgesEarned(st).has('back'));
  items[3].status = 'done'; g.reconcile(st, at(20)); // 16 days later
  assert.ok(g.badgesEarned(st).has('back'));
  st.game.cfg.pts = { course: 1000 };
  st.courses[0].outcome = { type: 'graded', grade: 95 };
  st.courses[0].semesterId = 'sem1';
  st.semesters = [{ id: 'sem1' }];
  g.reconcile(st, at(21));
  ['course', 'grade90', 'semester', 'k1'].forEach((b) => assert.ok(g.badgesEarned(st).has(b), b));
});

test('prizes: redeem needs enough points, is logged and never refunded; level unaffected', () => {
  const items = Array.from({ length: 3 }, (_, i) => item(`ש״ב ${i}`));
  const st = fresh(state([['שיעורי בית', items]]));
  items.forEach((i) => { i.status = 'done'; });
  g.reconcile(st, NOW); // 60
  st.game.prizes.push({ id: 'p1', name: 'פיצה', cost: 50 }, { id: 'p2', name: 'סרט', cost: 100 });
  assert.equal(g.redeem(st, 'p2', NOW), null, 'not enough');
  const e = g.redeem(st, 'p1', NOW);
  assert.equal(e.p, -50);
  assert.equal(g.balance(st), 10);
  assert.equal(g.earned(st), 60, 'earned and level are not reduced by spending');
  assert.equal(g.reconcile(st, NOW).length, 0, 'reconcile never refunds');
  assert.equal(g.redeem(st, 'p1', NOW), null);
});

test('undo never refunds a redemption: restoring an older snapshot keeps it', () => {
  const items = Array.from({ length: 3 }, (_, i) => item(`ש״ב ${i}`));
  const st = fresh(state([['שיעורי בית', items]]));
  items.forEach((i) => { i.status = 'done'; });
  g.reconcile(st, NOW);
  st.game.prizes.push({ id: 'p1', name: 'פיצה', cost: 50 });
  const before = JSON.parse(JSON.stringify(st)); // what store.undo() would restore
  g.redeem(st, 'p1', NOW);
  g.carry(st, before);
  assert.equal(g.balance(before), 10);
  g.carry(st, before);
  assert.equal(before.game.ledger.filter((e) => e.t === 'redeem').length, 1, 'carried once');
});

test('seasons: XP per semester; level and badges carry over', () => {
  const [a, b] = [item('ש״ב 1'), item('ש״ב 2')];
  const st = withExtras(fresh(state([['שיעורי בית', [a, b]]], { settings: { activeSemesterId: 'A' } })));
  a.status = 'done'; g.reconcile(st, NOW);
  st.settings.activeSemesterId = 'B';
  b.status = 'done'; g.reconcile(st, NOW);
  assert.equal(g.seasonXP(st, 'A'), 20 + 10); // the item + the "צעד ראשון" badge, earned while A was active
  assert.ok(g.seasonXP(st, 'B') >= 20);
  assert.equal(g.seasonXP(st, 'A') + g.seasonXP(st, 'B'), g.earned(st));
  assert.deepEqual(g.titles(st), ['צעדים ראשונים']);
  assert.ok(g.UNLOCKS.every((x) => x.level >= 2));
});

/* ---------- deductions, pause, freezes ---------- */
// earn 200 on day 10 so there is a balance to deduct from; points system started on day 1
const penState = () => {
  const items = Array.from({ length: 10 }, (_, i) => item(`ש״ב ${i}`));
  const st = fresh(state([['שיעורי בית', items]]), at(1));
  items.forEach((i) => { i.status = 'done'; });
  g.reconcile(st, at(10));
  return st;
};
const pens = (st) => st.game.ledger.filter((e) => e.t === 'pen').map((e) => [e.d, e.p]);

test('deductions are off by default, and turning them on never reaches back', () => {
  const st = penState();
  g.reconcile(st, at(20));
  assert.deepEqual(pens(st), [], 'off by default');
  g.setPenalties(st, true, at(20));
  st.game.cfg.penalty.freezesPerMonth = 0;
  g.reconcile(st, at(20, 13));
  assert.deepEqual(pens(st), [], 'days before turning on never count');
  g.reconcile(st, at(21));
  assert.deepEqual(pens(st), [['2026-11-20', -15]], 'the 20th was below the minimum');
  g.reconcile(st, at(21, 18));
  assert.equal(pens(st).length, 1, 'each day is settled once');
});

test('deductions: daily and weekly caps, never below 0, level never goes down', () => {
  const st = penState();
  g.setPenalties(st, true, at(15));
  Object.assign(st.game.cfg.penalty, { freezesPerMonth: 0, amount: 25, capDay: 20, capWeek: 45 });
  const levelBefore = g.summary(st, at(15)).level.n;
  g.reconcile(st, at(22)); // 15..21: week of 15/11 (Sun) gets 20+20+5, then the week of 22/11 starts
  assert.deepEqual(pens(st).map((x) => x[1]), [-20, -20, -5]);
  assert.equal(g.balance(st), 200 - 45);
  assert.equal(g.summary(st, at(22)).level.n, levelBefore);
  assert.equal(g.earned(st), 200, 'earned XP is untouched');
  // with nothing left to take, no deduction is written
  const poor = fresh(state([['x', []]]), at(1));
  g.setPenalties(poor, true, at(10));
  poor.game.cfg.penalty.freezesPerMonth = 0;
  g.reconcile(poor, at(14));
  assert.deepEqual(pens(poor), []);
  assert.equal(g.balance(poor), 0);
});

test('grace period, minimum met, pause and streak freezes each prevent a deduction', () => {
  const st = penState();
  g.setPenalties(st, true, at(3)); // inside the first week (system started on day 1)
  st.game.cfg.penalty.freezesPerMonth = 0;
  g.reconcile(st, at(9));
  assert.deepEqual(pens(st).map((x) => x[0]), ['2026-11-08'], 'days 3–7 are grace');
  // minimum met on day 10 (it has items): no deduction
  g.reconcile(st, at(12));
  assert.ok(!pens(st).some((x) => x[0] === '2026-11-10'));
  assert.ok(pens(st).some((x) => x[0] === '2026-11-11'));
  // pause from day 12
  g.pause(st, 'exams', '', at(12));
  g.reconcile(st, at(16));
  assert.ok(!pens(st).some((x) => x[0] >= '2026-11-12'), 'paused days are free');
  g.resume(st, at(16));
  // freezes: 2 per month cover the first missed days
  st.game.cfg.penalty.freezesPerMonth = 2;
  g.reconcile(st, at(20));
  assert.deepEqual(st.game.freezes, ['2026-11-16', '2026-11-17']);
  assert.ok(pens(st).some((x) => x[0] === '2026-11-18'));
});

test('a long absence is not piled up: only the last 7 days are checked', () => {
  const st = penState();
  g.setPenalties(st, true, at(10));
  Object.assign(st.game.cfg.penalty, { freezesPerMonth: 0, capWeek: 1000, capDay: 15 });
  g.reconcile(st, new Date(2026, 11, 20, 12)); // 40 days later
  assert.equal(pens(st).length, 7);
});

test('streak survives paused and frozen days; "at risk" only when it matters', () => {
  const items = Array.from({ length: 4 }, (_, i) => item(`הרצאה ${i}`));
  const st = fresh(state([['הרצאות', items]]), at(1));
  [10, 11, 12].forEach((d, i) => { items[i].status = 'done'; g.reconcile(st, at(d)); });
  st.game.pauses.push({ id: 'p', from: '2026-11-13', to: '2026-11-15', reason: 'sick' });
  st.game.freezes.push('2026-11-16');
  assert.equal(g.streak(st, '2026-11-17').days, 3, 'pause + freeze keep the 3-day streak alive');
  const risk = g.atRisk(st, at(17, 20));
  assert.ok(risk && risk.streak === 3 && !risk.penOn, 'a 3-day streak is at risk tonight');
  items[3].status = 'done'; g.reconcile(st, at(17, 20));
  assert.equal(g.atRisk(st, at(17, 21)), null, 'minimum met');
  assert.equal(g.streak(st, '2026-11-17').days, 4);
  g.pause(st, 'vacation', '', at(18));
  assert.equal(g.atRisk(st, at(18, 20)), null, 'paused: no warning');
});
