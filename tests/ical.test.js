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
  it.title = 'ש״ב 1 — עם דנה';
  it.due = '2026-12-08';
  Mo.merge(st, events({ ...E1, summary: 'שם אחר is due', start: '20261214T215900Z' }), OPTS);
  assert.equal(it.title, 'ש״ב 1 — עם דנה');
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

/* ================= "מה השתנה" list and the link's range ================= */
test('change list: new, date changed, gone, back — newest first, unseen until marked', () => {
  const c = course({ number: '00440131' });
  const st = state(c);
  // E2 is due before E1's new date: "gone" is only marked up to the last date the new feed covers
  const E2 = { ...E1, uid: '102@moodle26.technion.ac.il', summary: 'תרגיל בית 2 is due', start: '20261212T215900Z' };
  const r1 = Mo.merge(st, events(E1, E2), OPTS);
  assert.deepEqual(r1.changes.map((x) => x.kind), ['new', 'new']);
  assert.equal(Mo.unseenText(Mo.unseen(st)), 'נוספו 2 מטלות חדשות');
  Mo.markSeen(st);
  assert.equal(Mo.unseen(st).total, 0);
  // same file again: nothing new in the list
  assert.equal(Mo.merge(st, events(E1, E2), OPTS).changes.length, 0);
  assert.equal(st.moodle.changes.length, 2);
  // E1 moves, E2 leaves the feed
  const r2 = Mo.merge(st, events({ ...E1, start: '20261214T215900Z' }), { ...OPTS, now: '2026-11-27T10:00:00.000Z' });
  assert.deepEqual(r2.changes.map((x) => x.kind).sort(), ['changed', 'gone']);
  const ch = st.moodle.changes.find((x) => x.kind === 'changed');
  assert.equal(ch.prevDue, '2026-12-10');
  assert.equal(ch.due, '2026-12-14');
  assert.equal(ch.course, c.id);
  assert.equal(st.moodle.changes[0].at, '2026-11-27T10:00:00.000Z', 'newest first');
  assert.equal(Mo.unseenText(Mo.unseen(st)), 'מטלה אחת השתנתה · מטלה אחת לא מופיעה יותר');
  assert.equal(items(c).length, 2, 'nothing deleted');
  const r3 = Mo.merge(st, events({ ...E1, start: '20261214T215900Z' }, E2), OPTS);
  assert.deepEqual(r3.changes.map((x) => x.kind), ['restored']);
  assert.equal(st.moodle.horizon, '2026-12-14');
});

test('change list: an unassigned event is listed once, and the list is capped', () => {
  const st = state(course({ number: '00440131', name: 'מבני נתונים' }));
  const A = { uid: 'a@x', summary: 'עבודה is due', start: '20261210T215900Z', cats: 'שם שלא מתאים לשום דבר' };
  Mo.merge(st, events(A), OPTS);
  Mo.merge(st, events(A), OPTS);
  assert.equal(st.moodle.changes.filter((x) => x.uid === 'a@x').length, 1);
  assert.equal(st.moodle.changes[0].unassigned, true);
  st.moodle.changes = Array.from({ length: 150 }, (_, i) => ({ kind: 'new', uid: `x${i}`, seen: true }));
  Mo.merge(st, events({ ...A, uid: 'b@x' }), OPTS);
  assert.equal(st.moodle.changes.length, Mo.CHANGES_MAX);
  assert.equal(st.moodle.changes[0].uid, 'b@x');
});

test('link range: moving windows are fine, short ones and missing "all events" warn', () => {
  assert.equal(Mo.rangeInfo('custom', 'all').warn, false);
  assert.equal(Mo.rangeInfo('recentupcoming', 'all').warn, false);
  assert.equal(Mo.rangeInfo('weeknow', 'all').warn, true);
  assert.equal(Mo.rangeInfo('monthnext', 'all').warn, true);
  assert.equal(Mo.rangeInfo('custom', 'courses').warn, true);
  assert.match(Mo.rangeInfo(null, null).text, /שמירה מחדש/);
});

/* ================= event categories ================= */
const cls = (title, rawTitle, category = '00440137.200', st = { courses: [] }) => Mo.classify(st, { title, rawTitle: rawTitle || title, category }).cls;

test('classify: Hebrew names (real Moodle titles)', () => {
  assert.equal(cls('תרגול דנה'), 'tut');
  assert.equal(cls('תרגול + שעת קבלה - דנה'), 'tut');
  assert.equal(cls('הרצאות - קבוצה 20 - מבוא'), 'lec');
  assert.equal(cls('תרגיל הכנה מספר 3'), 'prep');
  assert.equal(cls('שיעור הכנה 2'), 'prep');
  assert.equal(cls('תרגיל בית 4'), 'hw');
  assert.equal(cls('בוחן אמצע'), 'exam');
  assert.equal(cls('ש״ב 2'), 'hw', 'Hebrew gershayim are read as a plain quote');
  assert.equal(cls('הגשת המטלה'), 'hw', 'keyword after the prefix letter ה');
});

test('classify: English names, whole words only', () => {
  assert.equal(cls('HW2 Submission'), 'hw');
  assert.equal(cls('Homework 3'), 'hw');
  assert.equal(cls('Midterm exam'), 'exam');
  assert.equal(cls('Lab 4 report'), 'lab');
  assert.equal(cls('Tutorial 5'), 'tut');
  assert.equal(cls('Syllabus update'), '', '"lab" inside "Syllabus" does not count');
});

test('classify: several keywords — "דוח מעבדה" is a lab, two different classes → not sure', () => {
  assert.equal(cls('דוח מעבדה 2'), 'lab');
  assert.equal(cls('הגשת דוח מעבדה 2'), 'lab', '"הגשת" is not a keyword; the report decides');
  const r = Mo.classify({ courses: [] }, { title: 'תרגול לקראת המבחן', rawTitle: 'תרגול לקראת המבחן', category: 'x' });
  assert.equal(r.cls, '');
  assert.equal(r.why, 'ambiguous');
  assert.deepEqual(r.candidates.sort(), ['exam', 'tut']);
});

test('classify: no keywords → not classified; Moodle\'s "יש להגיש את" alone → assignments', () => {
  const st = { courses: [] };
  assert.equal(cls('רישום לזוגות (Due date)'), '');
  assert.equal(Mo.classify(st, { title: 'פגישה', rawTitle: 'פגישה', category: '' }).why, 'none');
  const t = Mo.cleanTitle("יש להגיש את 'Project proposal'");
  assert.equal(t, 'Project proposal');
  assert.equal(cls(t, "יש להגיש את 'Project proposal'"), 'hw');
  assert.equal(Mo.cleanTitle('תאריך הגשה Project proposal'), 'Project proposal');
  assert.equal(cls('Project proposal', 'תאריך הגשה Project proposal'), 'hw');
  assert.equal(cls('תרגול 3', "יש להגיש את 'תרגול 3'"), 'tut', 'a keyword is more specific than the prefix');
});

const S_TUT = { uid: '201@moodle26.technion.ac.il', summary: 'תרגול דנה', start: '20261201T083000Z', cats: '00440137.200' };
const S_TUT2 = { uid: '202@moodle26.technion.ac.il', summary: 'תרגול דנה', start: '20261208T083000Z', cats: '00440137.200' };
const S_HW = { uid: '203@moodle26.technion.ac.il', summary: "יש להגיש את 'תרגיל בית 2'", start: '20261210T215900Z', cats: '00440137.200' };
const S_LAB = { uid: '204@moodle26.technion.ac.il', summary: 'דוח מעבדה 1', start: '20261211T215900Z', cats: '00440137.200' };
const S_ODD = { uid: '205@moodle26.technion.ac.il', summary: 'רישום לזוגות', start: '20261212T215900Z', cats: '00440137.200' };

test('sync: deadlines go to their course table, sessions and unclassified stay on "המודל שלי"', () => {
  const c = course({ number: '00440137' });
  const st = state(c);
  const r = Mo.merge(st, events(S_TUT, S_HW, S_LAB, S_ODD), OPTS);
  assert.equal(r.added, 2);
  assert.equal(r.listed, 2);
  assert.equal(r.unclassified, 1);
  assert.deepEqual(c.categories.map((x) => x.name).sort(), ['מעבדות', 'שיעורי בית']);
  assert.equal(items(c).find((x) => x.source.uid === S_HW.uid).title, 'תרגיל בית 2');
  assert.deepEqual(st.moodle.events.map((e) => [e.uid, e.cls]), [[S_TUT.uid, 'tut'], [S_ODD.uid, '']]);
  assert.deepEqual(r.changes.map((x) => x.uid).sort(), [S_HW.uid, S_LAB.uid, S_ODD.uid].sort(), 'no "new" alert for a tutorial');
  // again: nothing new, nothing moves
  const r2 = Mo.merge(st, events(S_TUT, S_HW, S_LAB, S_ODD), OPTS);
  assert.deepEqual([r2.added, r2.listed, r2.reclassified, r2.unchanged], [0, 0, 0, 4]);
});

test('manual class: remembered for similar events, wins over the rules, survives every sync', () => {
  const c = course({ number: '00440137' });
  const st = state(c);
  Mo.merge(st, events(S_ODD, S_TUT), OPTS);
  // "רישום לזוגות" → assignments: leaves "המודל שלי" for the course page
  assert.equal(Mo.setClass(st, S_ODD.uid, 'hw', OPTS), 1);
  assert.equal(items(c).find((x) => x.source.uid === S_ODD.uid).source.cls, 'hw');
  // a tutorial you call a lab: the rule says תרגולים, your choice wins — for the next "תרגול דנה" too
  Mo.setClass(st, S_TUT.uid, 'lab', OPTS);
  const r = Mo.merge(st, events(S_ODD, S_TUT, S_TUT2), OPTS);
  const lab = c.categories.find((x) => x.name === 'מעבדות');
  assert.deepEqual(lab.items.map((x) => x.source.uid).sort(), [S_TUT.uid, S_TUT2.uid]);
  assert.equal(st.moodle.events.length, 0);
  assert.equal(r.reclassified, 0, 'sync does not undo your choice');
  assert.equal(Mo.classify(st, { title: 'תרגול דנה', rawTitle: 'תרגול דנה', category: '00440137.200' }).why, 'manual');
  // you can change it at any time; forgetting it returns the events to the rules
  const [rule] = Mo.classRules(st).filter((x) => x.cls === 'lab');
  assert.equal(rule.pattern, 'תרגול דנה');
  Mo.clearClass(st, rule.key, OPTS);
  assert.deepEqual(st.moodle.events.map((e) => e.cls), ['tut', 'tut'], 'untouched items go back to "המודל שלי"');
});

test('reclassify: items synced before categories move to the right place, unless you touched or moved them', () => {
  const c = course({ number: '00440137' });
  const st = state(c);
  const hw = { id: 'h', name: 'שיעורי בית', items: [] };
  const mine = { id: 'm', name: 'שלי', items: [] };
  c.categories.push(hw, mine);
  const old = (u, title, extra = {}) => Object.assign({ id: u, title, status: 'todo', note: '', due: '2026-12-01', link: '', tags: [], flag: false,
    source: { kind: 'moodle', uid: u, title, rawTitle: title, due: '2026-12-01', dueTime: '10:30', url: '', category: '00440137.200', changed: null, gone: null, mergeWith: null } }, extra);
  hw.items.push(old('a@m', 'תרגול דנה'), old('b@m', 'תרגול דנה', { note: 'שאלה 3' }), old('c@m', 'דוח מעבדה 1'));
  mine.items.push(old('d@m', 'דוח מעבדה 2'));
  Mo.ensure(st);
  Mo.reclassifyAll(st, OPTS);
  assert.deepEqual(hw.items.map((x) => x.id), ['b@m'], 'the tutorial with your note stays');
  assert.equal(hw.items[0].source.cls, 'tut');
  assert.deepEqual(st.moodle.events.map((e) => e.uid), ['a@m']);
  assert.deepEqual(c.categories.find((x) => x.name === 'מעבדות').items.map((x) => x.id), ['c@m']);
  assert.deepEqual(mine.items.map((x) => x.id), ['d@m'], 'an item you moved yourself stays in your table');
});

test('cleaner titles from the same Moodle text update quietly (no "changed" flood)', () => {
  const c = course({ number: '00440137' });
  const st = state(c);
  Mo.merge(st, events(S_HW), OPTS);
  const it = items(c)[0];
  // as stored by the older version, which did not strip "יש להגיש את"
  Object.assign(it, { title: S_HW.summary });
  Object.assign(it.source, { title: S_HW.summary });
  const r = Mo.merge(st, events(S_HW), OPTS);
  assert.equal(r.updated, 0);
  assert.equal(it.title, 'תרגיל בית 2');
  assert.equal(it.source.changed, null);
  assert.equal(r.changes.length, 0);
});

test('editing categories: rename, keywords, new class, delete, defaults back', () => {
  const st = { courses: [] };
  const mo = Mo.ensure(st);
  assert.deepEqual(mo.classes.map((c) => c.id), ['hw', 'prep', 'tut', 'lec', 'exam', 'lab', 'other']);
  const proj = Mo.addClass(st, 'פרויקט');
  assert.equal(Mo.addClass(st, 'פרויקט'), null, 'no duplicate names');
  assert.equal(Mo.addClass(st, 'לא מסווג'), null);
  proj.keywords = Mo.parseKeywords('פרויקט, project\nproposal, פרויקט');
  assert.deepEqual(proj.keywords, ['פרויקט', 'project', 'proposal']);
  assert.equal(cls('Project proposal', 'Project proposal', 'x', st), proj.id);
  mo.classMap['x|a'] = proj.id;
  Mo.removeClass(st, proj.id);
  assert.equal(mo.classMap['x|a'], undefined);
  assert.equal(cls('Project proposal', 'Project proposal', 'x', st), '');
  mo.classes[0].name = 'הגשות';
  Mo.resetClasses(st);
  assert.equal(mo.classes[0].name, 'מטלות והגשות');
});

test('pattern key: same course, same name up to numbers', () => {
  assert.equal(Mo.patternKey('00440137.200', 'תרגיל בית 3'), Mo.patternKey('00440137.200', 'תרגיל בית 12'));
  assert.notEqual(Mo.patternKey('00440137.200', 'תרגיל בית 3'), Mo.patternKey('00440148.100', 'תרגיל בית 3'));
  assert.equal(Mo.patternKey('c', 'מטלת מודל 1 - אורך גל וניסוי בראג'), Mo.patternKey('c', 'מטלת מודל 2 - אפקט פוטואלקטרי'), 'the topic after " - " is not part of it');
  assert.equal(Mo.patternKey('c', 'תרגול + שעת קבלה - דנה'), 'c|תרגול שעת קבלה');
  assert.equal(Mo.patternKey('c', '3 - מבוא'), 'c|# מבוא', 'a head without letters keeps the whole name');
});
