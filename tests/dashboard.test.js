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
