// Unit tests for js/ical.js and js/moodle.js — run with:  node tests/ical.test.js   (Node 18+, no packages needed)
'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
require('../js/ical.js');
require('../js/moodle.js');
const I = globalThis.CT.ical;
const Mo = globalThis.CT.moodle;

const cal = (...events) => ['BEGIN:VCALENDAR', 'VERSION:2.0', 'PRODID:-//Moodle Pty Ltd//NONSGML Moodle Version 2024100700//EN', ...events.flat(), 'END:VCALENDAR'].join('\r\n');
const ev = ({ uid, summary, start, cats, extra = [] }) => [
  'BEGIN:VEVENT', `UID:${uid}`, `SUMMARY:${summary}`, 'DESCRIPTION:', 'CLASS:PUBLIC', 'LAST-MODIFIED:20261101T080000Z',
  'DTSTAMP:20261101T080000Z', `DTSTART:${start}`, `DTEND:${start}`, ...(cats ? [`CATEGORIES:${cats}`] : []), ...extra, 'END:VEVENT',
];

/* ================= parser ================= */
test('not an iCalendar file → error', () => {
  assert.throws(() => I.parse('<html>login</html>'), /not-ical/);
  assert.throws(() => I.parse(''), /not-ical/);
});

test('empty calendar → no events', () => {
  assert.deepEqual(I.parse(cal()).events, []);
});

test('folded lines, escapes, BOM, LF-only line ends', () => {
  const text = '﻿' + cal(ev({ uid: '1@x', summary: 'תרגיל בית 1\\, חלק א\\; גרסה\\\\2', start: '20261130T215900Z' }))
    .replace('DESCRIPTION:', 'DESCRIPTION:שורה ראשונה\\nשורה\r\n  שנייה').replace(/\r\n/g, '\n');
  const [e] = I.parse(text).events;
  assert.equal(e.summary, 'תרגיל בית 1, חלק א; גרסה\\2');
  assert.equal(e.description, 'שורה ראשונה\nשורה שנייה');
});

test('UTC times are converted to Israel time (winter +2, summer +3)', () => {
  const [w, s] = I.parse(cal(
    ev({ uid: 'w', summary: 'a', start: '20261130T215900Z' }),
    ev({ uid: 's', summary: 'b', start: '20260615T205900Z' }),
  )).events;
  assert.deepEqual([w.due.date, w.due.time], ['2026-11-30', '23:59']);
  assert.deepEqual([s.due.date, s.due.time], ['2026-06-15', '23:59']);
});

test('UTC late evening crosses into the next Israeli day', () => {
  const [e] = I.parse(cal(ev({ uid: 'x', summary: 'a', start: '20261130T230000Z' }))).events;
  assert.deepEqual([e.due.date, e.due.time], ['2026-12-01', '01:00']);
});

test('TZID, floating and date-only values', () => {
  const base = ev({ uid: 't', summary: 'a', start: 'X' }).filter((l) => !/^DT(START|END)/.test(l));
  const withStart = (line) => cal([...base.slice(0, -1), line, 'END:VEVENT']);
  let e = I.parse(withStart('DTSTART;TZID=Asia/Jerusalem:20261201T120000')).events[0];
  assert.deepEqual([e.due.date, e.due.time], ['2026-12-01', '12:00']);
  e = I.parse(withStart('DTSTART;TZID=Europe/London:20261201T120000')).events[0];
  assert.deepEqual([e.due.date, e.due.time], ['2026-12-01', '14:00']);
  e = I.parse(withStart('DTSTART;TZID="Not/AZone":20261201T120000')).events[0];
  assert.equal(e.due.time, '12:00'); // unknown zone → read as Israel time
  e = I.parse(withStart('DTSTART:20261201T093000')).events[0];
  assert.equal(e.due.time, '09:30');
  e = I.parse(withStart('DTSTART;VALUE=DATE:20261201')).events[0];
  assert.deepEqual([e.due.date, e.due.time], ['2026-12-01', null]);
  e = I.parse(withStart('DTSTART:garbage')).events[0];
  assert.equal(e.due, null);
});

test('CATEGORIES with an escaped comma, VTODO DUE, nested VALARM ignored', () => {
  const text = cal(
    ev({ uid: 'c', summary: 'a', start: '20261201T100000Z', cats: '044131 - מערכות\\, לינאריות' }),
    ['BEGIN:VTODO', 'UID:todo1', 'SUMMARY:משימה', 'DTSTART:20261201T100000Z', 'DUE:20261205T100000Z',
      'BEGIN:VALARM', 'SUMMARY:לא זה', 'TRIGGER:-PT15M', 'END:VALARM', 'END:VTODO'],
  );
  const [a, b] = I.parse(text).events;
  assert.deepEqual(a.categories, ['044131 - מערכות, לינאריות']);
  assert.equal(b.kind, 'VTODO');
  assert.equal(b.summary, 'משימה');
  assert.equal(b.due.date, '2026-12-05');
});

/* ================= merge ================= */
let n = 0;
const uid = () => `id${++n}`;
const course = (o) => Object.assign({ id: uid(), name: 'קורס', number: '', semesterId: 's1', kind: 'full', archived: false, categories: [] }, o);
const state = (...courses) => ({ courses, settings: { activeSemesterId: 's1' }, moodle: undefined });
const OPTS = { today: '2026-11-26', now: '2026-11-26T10:00:00.000Z', uid };
const events = (...evs) => I.parse(cal(...evs.map(ev))).events;
const items = (c) => c.categories.flatMap((cat) => cat.items);
const E1 = { uid: '101@moodle26.technion.ac.il', summary: 'תרגיל בית 1 is due', start: '20261210T215900Z', cats: '00440131' };

test('new event → item in the course "שיעורי בית" category, title cleaned, Moodle link', () => {
  const c = course({ number: '00440131' });
  const st = state(c);
  const r = Mo.merge(st, events(E1), OPTS);
  assert.equal(r.added, 1);
  assert.equal(c.categories[0].name, 'שיעורי בית');
  const [it] = items(c);
  assert.equal(it.title, 'תרגיל בית 1');
  assert.equal(it.due, '2026-12-10');
  assert.equal(it.source.dueTime, '23:59');
  assert.equal(it.source.uid, E1.uid);
  assert.match(it.link, /^https:\/\/moodle26\.technion\.ac\.il\/calendar\/view\.php\?view=day&time=\d+#event_101$/);
});

test('importing the same file twice creates no duplicates', () => {
  const c = course({ number: '00440131' });
  const st = state(c);
  Mo.merge(st, events(E1), OPTS);
  const r = Mo.merge(st, events(E1), OPTS);
  assert.equal(items(c).length, 1);
  assert.equal(r.added, 0);
  assert.equal(r.unchanged, 1);
});

test('the same UID twice in one file counts once', () => {
  const c = course({ number: '00440131' });
  const st = state(c);
  Mo.merge(st, events(E1, E1), OPTS);
  assert.equal(items(c).length, 1);
});

test('midnight deadline → the previous day, shown as 24:00', () => {
  const c = course({ number: '00440131' });
  const st = state(c);
  Mo.merge(st, events({ ...E1, start: '20261209T220000Z' }), OPTS); // 00:00 on 10.12 in Israel
  const [it] = items(c);
  assert.equal(it.due, '2026-12-09');
  assert.equal(it.source.dueTime, '24:00');
});

test('updated in Moodle: new date and title applied, previous values kept, your V / note / tags / star untouched', () => {
  const c = course({ number: '00440131' });
  const st = state(c);
  Mo.merge(st, events(E1), OPTS);
  const it = items(c)[0];
  Object.assign(it, { status: 'done', completedAt: 'x', note: 'שלי', tags: ['חשוב'], flag: true });
  const r = Mo.merge(st, events({ ...E1, summary: 'תרגיל בית 1 (מתוקן) is due', start: '20261214T215900Z' }), OPTS);
  assert.equal(r.updated, 1);
  assert.equal(it.title, 'תרגיל בית 1 (מתוקן)');
  assert.equal(it.due, '2026-12-14');
  assert.deepEqual([it.status, it.note, it.tags, it.flag], ['done', 'שלי', ['חשוב'], true]);
  assert.deepEqual([it.source.changed.prevTitle, it.source.changed.prevDue, it.source.changed.prevTime], ['תרגיל בית 1', '2026-12-10', '23:59']);
  // a second change keeps the oldest values you have not seen yet
  Mo.merge(st, events({ ...E1, start: '20261216T215900Z' }), OPTS);
  assert.equal(it.source.changed.prevDue, '2026-12-10');
  assert.equal(it.due, '2026-12-16');
});

test('your own title or date on a synced item is not overwritten by a Moodle change', () => {
  const c = course({ number: '00440131' });
  const st = state(c);
  Mo.merge(st, events(E1), OPTS);
  const it = items(c)[0];
  it.title = 'ש״ב 1 — עם יואב';
  it.due = '2026-12-08';
  Mo.merge(st, events({ ...E1, summary: 'שם אחר is due', start: '20261214T215900Z' }), OPTS);
  assert.equal(it.title, 'ש״ב 1 — עם יואב');
  assert.equal(it.due, '2026-12-08');
  assert.equal(it.source.due, '2026-12-14'); // Moodle's value is still recorded
  assert.ok(it.source.changed);
});

test('event gone from the feed: marked, not deleted; comes back → unmarked', () => {
  const c = course({ number: '00440131' });
  const st = state(c);
  const E2 = { ...E1, uid: '102@moodle26.technion.ac.il', summary: 'תרגיל בית 2 is due', start: '20261224T215900Z' };
  Mo.merge(st, events(E1, E2), OPTS);
  const r = Mo.merge(st, events(E2), OPTS);
  assert.equal(r.gone, 1);
  assert.equal(items(c).length, 2);
  assert.ok(items(c).find((x) => x.source.uid === E1.uid).source.gone);
  const back = Mo.merge(st, events(E1, E2), OPTS);
  assert.equal(back.restored, 1);
  assert.equal(items(c).find((x) => x.source.uid === E1.uid).source.gone, null);
});

test('past deadlines that age out of the export window are not marked as gone', () => {
  const c = course({ number: '00440131' });
  const st = state(c);
  const old = { ...E1, uid: '90@moodle26.technion.ac.il', start: '20261101T215900Z' };
  Mo.merge(st, events(old, E1), OPTS);
  const r = Mo.merge(st, events(E1), OPTS);
  assert.equal(r.gone, 0);
});

test('events after the last date in the new feed are not marked (shorter export window)', () => {
  const c = course({ number: '00440131' });
  const st = state(c);
  const far = { ...E1, uid: '200@moodle26.technion.ac.il', start: '20270301T215900Z' };
  Mo.merge(st, events(E1, far), OPTS);
  assert.equal(Mo.merge(st, events(E1), OPTS).gone, 0);
});

test('event without a known course → "לא משויך"; assigning remembers the Moodle course', () => {
  const c = course({ name: 'אימות פורמלי' });
  const st = state(c);
  const A = { uid: 'a@m', summary: 'Assignment 1 is due', start: '20261210T215900Z', cats: 'FV-2027' };
  const B = { uid: 'b@m', summary: 'Assignment 2 is due', start: '20261217T215900Z', cats: 'FV-2027' };
  const r = Mo.merge(st, events(A, B), OPTS);
  assert.equal(r.unassigned, 2);
  assert.equal(st.moodle.inbox.length, 2);
  assert.equal(items(c).length, 0);
  assert.equal(Mo.assign(st, 'a@m', c.id, true, { uid }), 2); // both events of FV-2027 move
  assert.equal(st.moodle.inbox.length, 0);
  assert.equal(st.moodle.map['FV-2027'], c.id);
  const C = { uid: 'c@m', summary: 'Assignment 3 is due', start: '20261224T215900Z', cats: 'FV-2027' };
  const r2 = Mo.merge(st, events(A, B, C), OPTS);
  assert.equal(r2.added, 1);
  assert.equal(items(c).length, 3);
});

test('assign one event only, and ignore an event for good', () => {
  const c = course({ name: 'הספק' });
  const st = state(c);
  const A = { uid: 'a@m', summary: 'x is due', start: '20261210T215900Z' }; // no CATEGORIES at all
  const B = { uid: 'b@m', summary: 'אירוע אישי', start: '20261211T100000Z' };
  Mo.merge(st, events(A, B), OPTS);
  Mo.assign(st, 'a@m', c.id, false, { uid });
  assert.equal(st.moodle.uidMap['a@m'], c.id);
  Mo.ignore(st, 'b@m');
  const r = Mo.merge(st, events(A, B), OPTS);
  assert.equal(r.ignored, 1);
  assert.equal(st.moodle.inbox.length, 0);
  assert.equal(items(c).length, 1);
});

test('unassigned events that left the feed drop out of the list', () => {
  const st = state(course({}));
  Mo.merge(st, events({ uid: 'a@m', summary: 'x', start: '20261210T215900Z' }), OPTS);
  Mo.merge(st, events({ uid: 'b@m', summary: 'y', start: '20261210T215900Z' }), OPTS);
  assert.deepEqual(st.moodle.inbox.map((x) => x.uid), ['b@m']);
});

test('a synced item you deleted is not created again', () => {
  const c = course({ number: '00440131' });
  const st = state(c);
  Mo.merge(st, events(E1), OPTS);
  c.categories[0].items = [];
  const r = Mo.merge(st, events(E1), OPTS);
  assert.equal(r.deletedByYou, 1);
  assert.equal(items(c).length, 0);
});

test('"opens" events are skipped', () => {
  const c = course({ number: '00440131' });
  const st = state(c);
  const r = Mo.merge(st, events({ ...E1, uid: 'o1', summary: 'Quiz 1 opens' }, { ...E1, uid: 'o2', summary: 'בוחן 1 נפתח' }, { ...E1, uid: 'c1', summary: 'Quiz 1 closes' }), OPTS);
  assert.equal(r.skippedOpen, 2);
  assert.equal(r.added, 1);
  assert.equal(items(c)[0].title, 'Quiz 1');
});

test('events without a UID are counted as invalid', () => {
  const st = state(course({ number: '00440131' }));
  const r = Mo.merge(st, [{ uid: '', summary: 'x', categories: [], due: null }], OPTS);
  assert.equal(r.invalid, 1);
});

test('course matching: 6-digit number in the title, course name, active semester first, ambiguity → unassigned', () => {
  const old = course({ number: '00440131', semesterId: 's0' });
  const cur = course({ number: '00440131', semesterId: 's1' });
  const fv = course({ name: 'אימות פורמלי' });
  const st = state(old, cur, fv);
  assert.equal(Mo.matchCourse(st, { uid: '1', summary: 'ש"ב 2 - 044131', categories: [] }), cur);
  assert.equal(Mo.matchCourse(st, { uid: '2', summary: 'x', categories: ['אימות פורמלי - חורף תשפ"ז'] }), fv);
  const st2 = state(course({ name: 'פיזיקה 1' }), course({ name: 'פיזיקה 1מ' }));
  assert.equal(Mo.matchCourse(st2, { uid: '3', summary: 'x', categories: ['פיזיקה'] }), null);
  // record (past grade-only) and archived courses are never targets
  const st3 = state(course({ number: '00440131', kind: 'record' }), course({ number: '00440131', archived: true }));
  assert.equal(Mo.matchCourse(st3, { uid: '4', summary: 'x', categories: ['00440131'] }), null);
});

test('placeholder "ש״ב 3": merge is suggested, never automatic; merging keeps your data', () => {
  const ph = { id: 'ph', title: 'ש״ב 3', status: 'doing', note: 'התחלתי', due: '', link: '', tags: ['קשה'], flag: false };
  const c = course({ number: '00440131', categories: [{ id: 'hw', name: 'שיעורי בית', items: [{ id: 'p2', title: 'ש״ב 2', tags: [] }, ph] }] });
  const st = state(c);
  Mo.merge(st, events({ ...E1, summary: 'תרגיל בית 3 is due' }), OPTS);
  const it = c.categories[0].items.find((x) => x.source);
  assert.equal(c.categories[0].items.length, 3);
  assert.equal(it.source.mergeWith, 'ph');
  const merged = Mo.mergeIntoPlaceholder(c, it.id);
  assert.equal(merged, ph);
  assert.equal(c.categories[0].items.length, 2);
  assert.deepEqual([ph.title, ph.status, ph.note, ph.tags, ph.due], ['ש״ב 3', 'doing', 'התחלתי', ['קשה'], '2026-12-10']);
  assert.equal(ph.source.uid, E1.uid);
  // the next sync updates the merged placeholder, not a new item
  const r = Mo.merge(st, events({ ...E1, summary: 'תרגיל בית 3 is due', start: '20261212T215900Z' }), OPTS);
  assert.equal(r.added, 0);
  assert.equal(ph.due, '2026-12-12');
  assert.equal(ph.title, 'ש״ב 3'); // your title stays
});

/* ================= calendar link ================= */
const GOOD = 'https://moodle26.technion.ac.il/calendar/export_execute.php?userid=12345&authtoken=abcdef0123&preset_what=all&preset_time=recentupcoming';

test('link check: only Technion Moodle calendar export links', () => {
  assert.equal(Mo.checkLink(GOOD), null);
  assert.equal(Mo.checkLink(`  ${GOOD}  `), null);
  assert.equal(Mo.checkLink(GOOD.replace('moodle26', 'moodle')), null);
  const bad = [
    '', 'not a url', GOOD.replace('https', 'http'),
    GOOD.replace('moodle26.technion.ac.il', 'moodle26.technion.ac.il.evil.com'),
    GOOD.replace('moodle26.technion.ac.il', 'evil.com'),
    GOOD.replace('moodle26.technion.ac.il', 'moodle26.technion.ac.il:8443'),
    GOOD.replace('https://', 'https://user:pw@'),
    GOOD.replace('export_execute.php', 'export.php'),
    GOOD.replace('authtoken=abcdef0123', 'authtoken='),
    GOOD.replace('userid=12345&', ''),
    GOOD + '&x=' + 'a'.repeat(600),
  ];
  bad.forEach((b) => assert.notEqual(Mo.checkLink(b), null, b));
});

test('redact hides the authtoken anywhere in a backup', () => {
  const out = Mo.redact(JSON.stringify({ note: `my link ${GOOD}` }));
  assert.ok(!out.includes('abcdef0123'));
  assert.ok(out.includes('authtoken=***&preset_what=all'));
  assert.equal(Mo.redact('nothing secret'), 'nothing secret');
});

test('sync preferences are on by default, and old data gains them without losing anything', () => {
  const st = { courses: [], moodle: { map: { a: 'b' } } };
  Mo.ensure(st);
  assert.deepEqual([st.moodle.auto, st.moodle.periodic, st.moodle.lastLink, st.moodle.map.a], [true, true, null, 'b']);
});

test('summary text', () => {
  assert.equal(Mo.summary({ added: 2, updated: 1, restored: 0, gone: 0, unassigned: 3 }), '2 חדשות · 1 עודכנו · 3 לא משויכות');
  assert.equal(Mo.summary({}), 'אין שינויים');
});
