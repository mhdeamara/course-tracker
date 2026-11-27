// Unit tests for the home screen's "הפעולה הבאה" ranking (CT.stats.nextActions) — run with:  node tests/dashboard.test.js
'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
globalThis.window = globalThis;
require('../js/utils.js');
require('../js/stats.js');
const st = globalThis.CT.stats;

const TODAY = '2026-11-26';
let n = 0;
const item = (title, o = {}) => Object.assign({ id: `i${++n}`, title, status: 'todo', due: '', completedAt: null }, o);
const course = (name, cats) => ({ id: name, name, categories: cats.map(([cname, items]) => ({ id: `${name}-${cname}`, name: cname, items })) });

test('order: overdue → due today/tomorrow → started → this week → "צריך לחזור" → next in line', () => {
  const c = course('א', [
    ['הרצאות', [item('הרצאה 1', { status: 'done' }), item('הרצאה 2')]],
    ['שיעורי בית', [item('ש״ב 1', { due: '2026-11-20' }), item('ש״ב 2', { due: '2026-11-27' }), item('ש״ב 3', { due: '2026-11-30' })]],
    ['תרגולים', [item('תרגול 1', { status: 'review' }), item('תרגול 2', { status: 'doing' })]],
  ]);
  const got = st.nextActions([c], TODAY, 10).map((x) => [x.item.title, x.reason]);
  assert.deepEqual(got, [
    ['ש״ב 1', 'באיחור — כדאי לסגור ראשון'],
    ['ש״ב 2', 'להגשה מחר'],
    ['תרגול 2', 'כבר התחלת — קל להמשיך'],
    ['ש״ב 3', 'דדליין בעוד 4 ימים'],
    ['תרגול 1', 'סימנת שצריך לחזור לזה'],
    ['הרצאה 2', 'הבא בתור בהרצאות'],
  ]);
});

test('no repeats, done items never suggested, limit respected, nothing open → empty', () => {
  const c = course('א', [['ש״ב', [item('x', { due: '2026-11-25' }), item('y', { status: 'done', due: '2026-11-20' })]]]);
  const got = st.nextActions([c], TODAY);
  assert.deepEqual(got.map((x) => x.item.title), ['x']);
  assert.equal(got[0].reason, 'היה להגשה אתמול — עוד אפשר לסגור');
  const many = course('ב', [['a', Array.from({ length: 9 }, (_, i) => item(`t${i}`, { due: '2026-11-10' }))]]);
  assert.equal(st.nextActions([many], TODAY, 3).length, 3);
  assert.deepEqual(st.nextActions([course('ג', [['a', [item('z', { status: 'done' })]]])], TODAY), []);
});

test('"next in line" starts with the course that is furthest behind', () => {
  const ahead = course('מתקדם', [['הרצאות', [item('a1', { status: 'done' }), item('a2', { status: 'done' }), item('a3')]]]);
  const behind = course('מאחור', [['הרצאות', [item('b1'), item('b2'), item('b3')]]]);
  assert.deepEqual(st.nextActions([ahead, behind], TODAY).map((x) => x.item.title), ['b1', 'a3']);
});

test('every suggestion carries a translatable reason key with its params', () => {
  const c = course('ה', [['ש״ב', [item('w', { due: '2026-11-29' }), item('o', { due: '2026-11-20' })]], ['תרגולים', [item('r', { status: 'review' })]]]);
  const why = Object.fromEntries(st.nextActions([c], TODAY, 10).map((x) => [x.item.title, x.why]));
  assert.deepEqual(why.o, { k: 'why.overdue', p: {} });
  assert.deepEqual(why.w, { k: 'why.week', p: { n: 3 } });
  assert.deepEqual(why.r, { k: 'why.review', p: {} });
});

/* ---------- upcoming list on "היום": items + exams, once each ---------- */
const exam = (label, date, id = `e${++n}`) => ({ id, label, date });
const withExams = (c, exams) => Object.assign(c, { exams });

test('agenda: open dated items (overdue + next 7 days) and exams (next 21 days), sorted, exams first on a tie', () => {
  const c = withExams(course('ו', [['ש״ב', [
    item('late', { due: '2026-11-20' }), item('soon', { due: '2026-11-28' }), item('far', { due: '2026-12-10' }),
    item('done', { due: '2026-11-27', status: 'done' }), item('nodate'), item('tie', { due: '2026-11-30' }),
  ]]]), [exam('מועד א', '2026-11-30'), exam('מועד ב', '2027-01-30'), exam('עבר', '2026-11-01')]);
  const got = st.agenda([c], TODAY).map((x) => (x.kind === 'exam' ? `exam:${x.exam.label}` : x.item.title));
  assert.deepEqual(got, ['late', 'soon', 'exam:מועד א', 'tie']);
});

test('agenda: an item that is the same event as an exam (same course, same date, title contained) appears once, as the exam', () => {
  const c = withExams(course('ז', [['בחנים', [item('בוחן אמצע', { due: '2026-12-01' }), item('ש״ב 4', { due: '2026-12-01' })]]]), [exam('בוחן', '2026-12-01')]);
  const other = withExams(course('ח', [['בחנים', [item('בוחן', { due: '2026-12-01' })]]]), []);
  const got = st.agenda([c, other], TODAY).map((x) => `${x.course.id}:${x.kind}:${x.kind === 'exam' ? x.exam.label : x.item.title}`);
  assert.deepEqual(got, ['ז:exam:בוחן', 'ז:item:ש״ב 4', 'ח:item:בוחן']);
  assert.equal(new Set(got).size, got.length);
});

test('agenda: distinct items with similar names on an exam date stay visible (whole words, one item per exam)', () => {
  const c = withExams(course('י', [['x', [
    item('בוחן 10', { due: '2026-12-01' }), item('הכנה למבחן', { due: '2026-12-02' }), item('תרגיל 1', { due: '2026-12-03' }),
    item('בוחן 2', { due: '2026-12-04' }), item('בוחן', { due: '2026-12-04' }),
  ]]]), [exam('בוחן 1', '2026-12-01'), exam('מבחן', '2026-12-02'), exam('1', '2026-12-03'), exam('בוחן', '2026-12-04')]);
  const got = st.agenda([c], TODAY, 14).map((x) => (x.kind === 'exam' ? `exam:${x.exam.label}` : x.item.title));
  assert.deepEqual(got, ['exam:בוחן 1', 'בוחן 10', 'exam:מבחן', 'הכנה למבחן', 'exam:1', 'תרגיל 1', 'exam:בוחן', 'בוחן 2']);
  // two exams with the same name on the same day are two events: both stay, and each can absorb its own item
  const d = withExams(course('כ', [['x', [item('בוחן', { due: '2026-12-04' }), item('בוחן', { due: '2026-12-04' })]]]), [exam('בוחן', '2026-12-04'), exam('בוחן', '2026-12-04')]);
  assert.deepEqual(st.agenda([d], TODAY, 14).map((x) => x.kind), ['exam', 'exam']);
});

test('agenda: the same course listed twice never duplicates an entry', () => {
  const c = withExams(course('ט', [['a', [item('x', { due: '2026-11-27' })]]]), [exam('מועד', '2026-11-28', 'ex1')]);
  assert.equal(st.agenda([c, c], TODAY).length, 2);
});
