// Unit tests for the adhkar logic (CT.adhkar) — run with:  node --test tests/adhkar.test.js
'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
globalThis.window = globalThis;
require('../js/utils.js');
require('../js/adhkar.js');
require('../js/game.js');
const A = globalThis.CT.adhkar;
const G = globalThis.CT.game;
const DOC = JSON.parse(fs.readFileSync(path.join(__dirname, '..', 'data', 'adhkar.json'), 'utf8'));

const at = (h, m = 0, d = 26, mo = 10) => new Date(2026, mo, d, h, m); // 26 Nov 2026
const fresh = (cfg = {}) => { const st = { courses: [], studyLog: [] }; A.ensure(st); st.adhkar.cfg = cfg; return st; };

/* ---------- time windows ---------- */
test('default is automatic: Haifa, Egyptian method, Shafii Asr', () => {
  const c = A.cfg(fresh());
  assert.equal(c.mode, 'auto');
  assert.equal(c.city, 'haifa');
  assert.equal(c.method, 'egypt');
  assert.equal(c.asr, 'shafii');
  assert.equal(A.windows(c, at(12)).auto, true);
});

test('manual windows: 04:30–11:30 and 15:30–20:30, edges', () => {
  const c = A.cfg(fresh({ mode: 'manual' }));
  assert.equal(A.period(c, at(4, 29)), null);
  assert.equal(A.period(c, at(4, 30)), 'm');
  assert.equal(A.period(c, at(11, 29)), 'm');
  assert.equal(A.period(c, at(11, 30)), null);
  assert.equal(A.period(c, at(15, 30)), 'e');
  assert.equal(A.period(c, at(20, 29)), 'e');
  assert.equal(A.period(c, at(20, 30)), null);
});

test('a window can wrap past midnight', () => {
  const c = A.cfg(fresh({ mode: 'manual', evening: { from: '22:00', to: '01:00' } }));
  assert.equal(A.period(c, at(23, 0)), 'e');
  assert.equal(A.period(c, at(0, 30)), 'e');
  assert.equal(A.period(c, at(1, 0)), null);
});

test('quiet hours wrap past midnight; equal ends mean no quiet hours', () => {
  const c = A.cfg(fresh());
  assert.equal(A.quiet(c, at(23, 0)), true);
  assert.equal(A.quiet(c, at(7, 59)), true);
  assert.equal(A.quiet(c, at(8, 0)), false);
  assert.equal(A.quiet(A.cfg(fresh({ general: { quietFrom: '10:00', quietTo: '10:00' } })), at(10, 0)), false);
});

test('toMin / fmt', () => {
  assert.equal(A.toMin('04:30'), 270);
  assert.equal(A.toMin('bad'), null);
  assert.equal(A.fmt(270), '04:30');
  assert.equal(A.fmt(-10), '23:50');
});

/* ---------- prayer times (reference: timeanddate.com, Haifa) ---------- */
const near = (min, hhmm, tol, label) => assert.ok(Math.abs(min - A.toMin(hhmm)) <= tol, `${label}: ${A.fmt(min)} vs ${hhmm}`);
test('Haifa 26 Nov 2026 (UTC+2): sunrise 06:19, noon 11:27, sunset 16:34; Fajr/Isha near 18° twilight', () => {
  const t = A.prayerTimes(new Date(2026, 10, 26, 12), 32.794, 34.989, 'egypt', 'shafii', 2);
  near(t.sunrise, '06:19', 2, 'sunrise');
  near(t.dhuhr - 1, '11:27', 2, 'noon');
  near(t.maghrib, '16:34', 2, 'sunset');
  // astronomical twilight (18°) per timeanddate: 04:53 / 18:00 → 19.5° Fajr is a few minutes earlier, 17.5° Isha slightly earlier
  assert.ok(t.fajr < A.toMin('04:53') && t.fajr > A.toMin('04:38'), `fajr ${A.fmt(t.fajr)}`);
  assert.ok(t.isha <= A.toMin('18:00') && t.isha > A.toMin('17:52'), `isha ${A.fmt(t.isha)}`);
  assert.ok(t.asr > t.dhuhr && t.asr < t.maghrib);
});

test('Haifa 21 Jun 2027 (summer time, UTC+3): sunrise 05:32, noon 12:41, sunset 19:51', () => {
  const t = A.prayerTimes(new Date(2027, 5, 21, 12), 32.794, 34.989, 'egypt', 'shafii', 3);
  near(t.sunrise, '05:32', 2, 'sunrise');
  near(t.dhuhr - 1, '12:41', 2, 'noon');
  near(t.maghrib, '19:51', 2, 'sunset');
});

test('Hanafi Asr is later than Shafi\'i; Umm al-Qura Isha is 90 minutes after Maghrib', () => {
  const s = A.prayerTimes(new Date(2026, 10, 26, 12), 32.794, 34.989, 'egypt', 'shafii', 2);
  const h = A.prayerTimes(new Date(2026, 10, 26, 12), 32.794, 34.989, 'egypt', 'hanafi', 2);
  assert.ok(h.asr - s.asr > 20);
  const q = A.prayerTimes(new Date(2026, 10, 26, 12), 32.794, 34.989, 'umm', 'shafii', 2);
  assert.ok(Math.abs(q.isha - q.maghrib - 90) < 0.01);
});

test('auto windows: Fajr → Dhuhr and Asr → Isha; custom place without coordinates falls back to manual', () => {
  const c = A.cfg(fresh({ mode: 'auto', city: 'haifa' }));
  const w = A.windows(c, at(12));
  assert.equal(w.auto, true);
  assert.ok(w.m[0] > A.toMin('04:00') && w.m[1] > A.toMin('11:00') && w.m[1] < A.toMin('12:30'));
  assert.ok(w.e[0] > A.toMin('13:30') && w.e[1] > A.toMin('17:30'));
  const c2 = A.cfg(fresh({ mode: 'auto', city: 'custom' }));
  assert.equal(A.windows(c2, at(12)).auto, false);
});

/* ---------- counters and completion ---------- */
test('tap counts up to the target and completes the group when every item is full', () => {
  const st = fresh();
  const items = A.group(DOC, 'm');
  const first = items[0];
  for (let k = 0; k < first.count + 2; k++) A.tap(st, DOC, 'm', first.id, at(6));
  assert.equal(A.progress(st, DOC, 'm', at(6)).counts[first.id], first.count); // never above the target
  assert.equal(A.progress(st, DOC, 'm', at(6)).done, false);
  let last;
  items.forEach((it) => { for (let k = 0; k < it.count; k++) last = A.tap(st, DOC, 'm', it.id, at(6)); });
  assert.equal(last.groupDone, true);
  assert.equal(A.progress(st, DOC, 'm', at(6)).done, true);
  assert.equal(A.progress(st, DOC, 'e', at(6)).done, false); // evening untouched
  assert.equal(A.tap(st, DOC, 'm', 'nope', at(6)), null);
});

test('counters are per day', () => {
  const st = fresh();
  const it = A.group(DOC, 'e')[0];
  A.tap(st, DOC, 'e', it.id, at(18));
  assert.equal(A.progress(st, DOC, 'e', at(18, 0, 27)).counts[it.id], undefined);
});

test('the general group never marks a day "done"', () => {
  const st = fresh();
  A.group(DOC, 'g').forEach((it) => { for (let k = 0; k < it.count; k++) A.tap(st, DOC, 'g', it.id, at(13)); });
  assert.equal(A.progress(st, DOC, 'g', at(13)).done, false);
});

test('streak: consecutive done days; today counts only once done; a gap resets, no penalty', () => {
  const st = fresh();
  ['2026-11-22', '2026-11-24', '2026-11-25'].forEach((d) => { st.adhkar.days[d] = { m: { c: {}, done: true } }; });
  assert.equal(A.streak(st, 'm', '2026-11-26'), 2);
  A.markDone(st, 'm', at(7));
  assert.equal(A.streak(st, 'm', '2026-11-26'), 3);
  assert.equal(A.streak(st, 'e', '2026-11-26'), 0);
});

test('prune keeps the recent days only', () => {
  const st = fresh();
  st.adhkar.days['2026-01-01'] = { m: { c: {}, done: true } };
  st.adhkar.days['2026-11-20'] = { m: { c: {}, done: true } };
  A.prune(st, '2026-11-26', 120);
  assert.deepEqual(Object.keys(st.adhkar.days), ['2026-11-20']);
});

/* ---------- reminders ---------- */
test('window note: once per window per day, not when already done, not when turned off', () => {
  const st = fresh();
  const m0 = { seen: {}, lastGen: at(5).getTime() };
  assert.deepEqual(A.due(st, m0, at(6)), [{ type: 'period', p: 'm' }]);
  assert.deepEqual(A.due(st, { seen: { m: '2026-11-26' }, lastGen: m0.lastGen }, at(6)), []);
  A.markDone(st, 'm', at(6));
  assert.deepEqual(A.due(st, m0, at(7)), []);
  assert.deepEqual(A.due(fresh({ startToast: false }), m0, at(6)), []);
  assert.deepEqual(A.due(fresh({ enabled: false }), m0, at(6)), []);
  assert.deepEqual(A.due(fresh({ general: { every: 0 } }), m0, at(13)), []); // outside both windows
});

test('general dhikr: every 30 minutes by default; can be off; every N minutes; not in quiet hours; muted for today', () => {
  const mem = { seen: { e: '2026-11-26' }, lastGen: at(12).getTime() };
  assert.equal(A.cfg(fresh()).general.every, 30);
  assert.deepEqual(A.due(fresh(), mem, at(12, 29)), []);
  assert.deepEqual(A.due(fresh(), mem, at(12, 30)), [{ type: 'general' }]);
  assert.deepEqual(A.due(fresh({ general: { every: 0 } }), mem, at(16)), []); // frequency off
  const st = fresh({ general: { every: 60 } });
  assert.deepEqual(A.due(st, mem, at(12, 59)), []);
  assert.deepEqual(A.due(st, mem, at(13)), [{ type: 'general' }]);
  assert.deepEqual(A.due(st, Object.assign({}, mem, { muted: '2026-11-26' }), at(14)), []);
  assert.deepEqual(A.due(st, Object.assign({}, mem, { lastGen: at(21).getTime() }), at(23)), []); // quiet hours
});

test('pickGeneral never repeats the last one', () => {
  const g = A.group(DOC, 'g');
  for (let k = 0; k < 20; k++) assert.notEqual(A.pickGeneral(DOC, g[0].id, () => 0).id, g[0].id);
});

/* ---------- points link (on by default; reading screen only; never deductions) ---------- */
const readAll = (st, p, d) => { const t = p === 'm' ? at(7, 0, d) : at(18, 0, d); A.group(DOC, p).forEach((x) => { for (let k = 0; k < x.count; k++) A.tap(st, DOC, p, x.id, t); }); };
const adk = (L) => L.filter((e) => e.t === 'adk' || (e.t === 'rev' && e.k.startsWith('adk:')));
const ptsState = (cfg) => { const st = fresh(cfg); G.ensure(st, at(8, 0, 20)); st.game.cfg.extras = false; return st; };

test('points: linked by default from the release day, never earlier; only the reading screen earns', () => {
  const st = ptsState();
  assert.equal(A.cfg(st).points, true);
  assert.equal(A.pointsSince(st), A.POINTS_SINCE);
  readAll(st, 'm', 25); // the day before the release: nothing
  A.markDone(st, 'e', at(18, 0, 26)); // "כבר אמרתי": done, no points
  assert.equal(A.isDone(st, 'e', '2026-11-26'), true);
  readAll(st, 'm', 26);
  const added = adk(G.reconcile(st, at(20)));
  assert.deepEqual(added.map((e) => [e.k, e.p, e.label]), [['adk:2026-11-26:m', 5, 'אזכרות בוקר']]);
  assert.equal(st.adhkar.days['2026-11-26'].m.via, 'read');
  assert.equal(st.adhkar.days['2026-11-26'].e.via, 'mark');
});

test('points: once per window per day — re-reading, more taps and repeated syncs add nothing', () => {
  const st = ptsState();
  readAll(st, 'e', 27);
  assert.equal(adk(G.reconcile(st, at(20, 0, 27))).length, 1);
  readAll(st, 'e', 27); // counters are capped; reading again changes nothing
  A.markDone(st, 'e', at(19, 0, 27));
  assert.equal(adk(G.reconcile(st, at(20, 30, 27))).length, 0);
  assert.equal(adk(G.reconcile(st, at(21, 0, 27))).length, 0);
  assert.equal(st.game.ledger.filter((e) => e.k === 'adk:2026-11-27:e').length, 1);
  readAll(st, 'm', 28); readAll(st, 'e', 28);
  assert.equal(adk(G.reconcile(st, at(20, 0, 28))).length, 2, 'morning and evening are separate windows');
});

test('points: undoing the completion takes back exactly what was given; turning the link off takes nothing', () => {
  const st = ptsState();
  st.game.cfg.pts = { adk: 7 }; // the value can be changed
  readAll(st, 'm', 27);
  const before = G.balance(st);
  G.reconcile(st, at(12, 0, 27));
  assert.equal(G.balance(st), before + 7);
  const snap = JSON.parse(JSON.stringify(st.adhkar));
  st.adhkar.days['2026-11-27'].m.done = false; // e.g. an older version of the data came back from another device
  const rev = adk(G.reconcile(st, at(13, 0, 27)));
  assert.deepEqual(rev.map((e) => [e.t, e.p]), [['rev', -7]]);
  assert.equal(G.balance(st), before);
  st.adhkar = snap; // completed again: earns again
  G.reconcile(st, at(14, 0, 27));
  assert.equal(G.balance(st), before + 7);
  A.set(st, 'points', false, '2026-11-27');
  assert.equal(adk(G.reconcile(st, at(15, 0, 27))).length, 0, 'turning it off takes nothing back');
  readAll(st, 'e', 27);
  assert.equal(adk(G.reconcile(st, at(20, 0, 27))).length, 0, 'and earns nothing new');
  A.set(st, 'points', true, '2026-11-28');
  assert.equal(adk(G.reconcile(st, at(21, 0, 27))).length, 0, 'turning it on again is not retroactive');
  A.set(st, 'enabled', false, '2026-11-28');
  assert.equal(adk(G.reconcile(st, at(22, 0, 27))).length, 0, 'switching the feature off takes nothing back');
});

test('points: never a deduction; adhkar are outside the daily minimum and the study streak', () => {
  const st = ptsState();
  G.setPenalties(st, true, at(8, 0, 20));
  st.game.cfg.penalty.graceDays = 0; st.game.cfg.penalty.freezesPerMonth = 0;
  // the 27th: the study minimum met (a 30-minute session), no adhkar at all → no deduction
  st.studyLog.push({ id: 's27', date: '2026-11-27', minutes: 30 });
  G.reconcile(st, at(12, 0, 27));
  // the 28th: only adhkar → they don't count as the study minimum, and missing adhkar is never the reason
  readAll(st, 'm', 28); readAll(st, 'e', 28);
  G.reconcile(st, at(12, 0, 29));
  const pens = st.game.ledger.filter((e) => e.t === 'pen');
  assert.ok(!pens.some((e) => e.d === '2026-11-27'), 'a day without adhkar costs nothing');
  assert.ok(pens.every((e) => !/אזכר|adk/.test(JSON.stringify(e))));
  assert.ok(st.game.ledger.filter((e) => e.t === 'adk').every((e) => e.p > 0));
  assert.equal(G.minimumMet(G.dayStats(st.game.ledger, '2026-11-28'), st.game.cfg.penalty), false);
  assert.equal(G.streak(st, '2026-11-28').today, false, 'adhkar alone does not keep the study streak');
});

test('points: two adhkar achievements — 7 days of morning and evening, and 30 completions', () => {
  const st = ptsState();
  st.game.cfg.extras = true;
  const badges = () => [...G.badgesEarned(st).keys()].filter((k) => k.startsWith('adk'));
  for (let d = 26; d <= 31; d++) { readAll(st, 'm', d); readAll(st, 'e', d); G.reconcile(st, new Date(2026, 10, d, 21)); } // 26 Nov – 1 Dec
  assert.deepEqual(badges(), [], '6 days are not enough');
  readAll(st, 'm', 32); readAll(st, 'e', 32); // 2 Dec
  G.reconcile(st, new Date(2026, 11, 2, 21));
  assert.deepEqual(badges(), ['adk-both7']);
  for (let d = 33; d <= 40; d++) { readAll(st, 'm', d); readAll(st, 'e', d); G.reconcile(st, new Date(2026, 10, d, 21)); }
  assert.deepEqual(badges().sort(), ['adk-both7', 'adk30']);
});

/* ---------- the data file ---------- */
test('data file: every group item exists, has a positive count, a source and a grade; no weak marking', () => {
  const ids = new Set(DOC.items.map((x) => x.id));
  assert.equal(ids.size, DOC.items.length);
  ['morning', 'evening', 'general'].forEach((g) => {
    assert.ok(DOC.groups[g].items.length > 0);
    DOC.groups[g].items.forEach((id) => assert.ok(ids.has(id), id));
  });
  DOC.items.forEach((it) => {
    assert.ok(Number.isInteger(it.count) && it.count > 0, it.id);
    assert.ok(it.text || (it.quran && it.quran.length), it.id);
    assert.ok(it.source && it.grade, it.id);
    assert.ok(!/ضعيف|موضوع|منكر/.test(it.grade), it.id);
    if (it.text) assert.match(it.text, /[ً-ْ]/, `${it.id}: has tashkeel`);
  });
  assert.ok(DOC.sources.tanzil.notice.some((l) => /Tanzil/.test(l)));
});

test('data file: morning and evening keep apart what belongs to the other time', () => {
  // compare bare letters; "اللهم بك أصبحنا وبك أمسينا" names both times on purpose (that is its wording)
  const bare = (s) => s.replace(/[ً-ٰٟـ]/g, '');
  const m = bare(A.group(DOC, 'm').map((x) => x.text || '').join(' ')).replace(/وبك أمسينا/g, '');
  const e = bare(A.group(DOC, 'e').map((x) => x.text || '').join(' '));
  assert.ok(!/أمسينا|أمسى/.test(m));
  assert.ok(!/أصبحنا|أصبح/.test(e));
  assert.ok(!A.group(DOC, 'm').some((x) => x.id === 'kalimat-tammat'));
  assert.ok(!A.group(DOC, 'e').some((x) => x.id === 'fitra' || x.id === 'juwayriya'));
});

/* ---------- schema v4 ---------- */
test('migration v3 → v4: adds empty adhkar state, keeps everything else, re-import keeps the counters', () => {
  require('../js/ical.js');
  require('../js/moodle.js');
  require('../js/model.js');
  const M = globalThis.CT.model;
  assert.equal(M.VERSION, 4);
  assert.equal(M.BACKUP_KEY, 'ct.backup.pre-v4');
  assert.ok(M.OLD_BACKUP_KEYS.includes('ct.backup.pre-v3'));
  const v3 = { version: 3, semesters: [], studyLog: [], settings: { activeSemesterId: '' }, courses: [{ id: 'c1', name: 'קורס', categories: [] }],
    game: { v: 1, ledger: [{ id: 'x', k: 'item:a', t: 'item', p: 12, d: '2026-11-20', at: '' }], base: [], cfg: {}, since: '2026-11-01T00:00:00.000Z' } };
  const st = M.migrate(JSON.parse(JSON.stringify(v3)));
  assert.equal(st.version, 4);
  assert.deepEqual(st.adhkar, { cfg: {}, days: {}, pointsFrom: '' });
  assert.equal(st.game.ledger.length, 1);
  A.markDone(st, 'm', new Date());
  const again = M.migrate(JSON.parse(JSON.stringify(st)));
  assert.equal(A.isDone(again, 'm', A.dayKey()), true);
});
