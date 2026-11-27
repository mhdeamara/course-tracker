// Unit tests for the courses overview: generated course emblems (art.js), card summaries (views/courses.js) and the
// partial reorder used when completed items are folded (ui.reorderSome) — run with:  node --test tests/courses.test.js
'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
globalThis.window = globalThis;
Object.defineProperty(globalThis, 'localStorage', { value: { getItem: () => null, setItem() {}, removeItem() {} }, configurable: true, writable: true });
Object.defineProperty(globalThis, 'navigator', { value: { languages: ['he-IL'], language: 'he-IL' }, configurable: true, writable: true });
globalThis.document = { addEventListener() {}, querySelectorAll: () => [], documentElement: { setAttribute() {} } }; // ui.js wires listeners at load
globalThis.addEventListener = () => {};
require('../js/utils.js');
require('../js/i18n.js');
require('../js/model.js');
require('../js/stats.js');
require('../js/ui.js');
require('../js/art.js');
globalThis.CT.store = {}; // the card summary needs no store; the views module only keeps a reference
require('../js/views/courses.js');
const { art, ui } = globalThis.CT;
const P = globalThis.CT.views.courses;

test('emblem motif follows the subject, in Hebrew and English', () => {
  const m = (name) => art.motif({ name, id: 'x' });
  assert.equal(m('אותות ומערכות'), 'wave');
  assert.equal(m('מעגלים אלקטרוניים'), 'circuit');
  assert.equal(m('מבוא למבני נתונים ואלגוריתמים'), 'tree');
  assert.equal(m('שיטות הערכה'), 'dist');
  assert.equal(m('פיזיקה קוונטית'), 'orbit');
  assert.equal(m('אימות פורמלי'), 'logic');
  assert.equal(m('הספק'), 'power');
  assert.equal(m('מעבדה 1ב'), 'lab');
  assert.equal(m('מעבדה במעגלים'), 'lab'); // a lab is a lab, whatever its subject
  assert.equal(m('Linear Algebra'), 'matrix');
  assert.equal(m('Calculus 1'), 'integral');
});

test('emblem is deterministic, and unknown subjects still get a stable generic motif', () => {
  const c = { id: 'abc', number: '00440131', name: 'קורס כלשהו' };
  assert.equal(art.svg(c), art.svg({ ...c }));
  assert.ok(['facets', 'grid', 'rings'].includes(art.motif(c)));
  // details come from the number/id, so two courses on the same subject can differ
  const variants = new Set(['1', '2', '3', '4', '5', '6', '7', '8'].map((n) => art.svg({ id: n, number: n, name: 'אותות' })));
  assert.ok(variants.size > 1);
});

test('emblem never contains the course name or other user text, and is hidden from screen readers', () => {
  const evil = '<img src=x onerror=alert(1)> "quoted" אותות';
  const svg = art.svg({ id: evil, number: evil, name: evil });
  assert.ok(!svg.includes('<img') && !svg.includes('quoted') && !svg.includes('אותות'));
  assert.match(svg, /^<svg class="c-art" viewBox="0 0 64 64" aria-hidden="true" focusable="false" data-motif="wave">/);
  assert.ok(!/https?:|href|<image/.test(svg)); // local drawing only, no external images
});

test('card summary: progress per non-empty category, next open dated task, next upcoming exam', () => {
  const it = (title, o = {}) => Object.assign({ id: title, title, status: 'todo', due: '' }, o);
  const c = {
    id: 'c', name: 'x', categories: [
      { id: 'a', name: 'הרצאות', items: [it('h1', { status: 'done' }), it('h2')] },
      { id: 'b', name: 'ריק', items: [] },
      { id: 'd', name: 'ש״ב', items: [it('w1', { due: '2026-12-05' }), it('w2', { due: '2026-11-30' }), it('w0', { due: '2026-11-20', status: 'done' })] },
    ],
    exams: [{ id: 'e1', label: 'עבר', date: '2026-11-01' }, { id: 'e2', label: 'מועד ב', date: '2027-03-01' }, { id: 'e3', label: 'מועד א', date: '2027-02-01' }],
  };
  const s = P.summary(c, '2026-11-27');
  assert.deepEqual(s.cats.map((x) => [x.name, x.done, x.total]), [['הרצאות', 1, 2], ['ש״ב', 1, 3]]);
  assert.equal(s.next.title, 'w2');
  assert.equal(s.exam.label, 'מועד א');
  assert.equal(s.done, 2);
  assert.equal(s.total, 5);
});

test('reorderSome: drag inside the open group moves only those items; folded (done) items keep their slots', () => {
  const arr = ['o1', 'd1', 'o2', 'd2', 'o3'].map((id) => ({ id }));
  ui.reorderSome(arr, ['o3', 'o1', 'o2']);
  assert.deepEqual(arr.map((x) => x.id), ['o3', 'd1', 'o1', 'd2', 'o2']);
  ui.reorderSome(arr, ['ghost', 'd2', 'd1']); // unknown ids are ignored
  assert.deepEqual(arr.map((x) => x.id), ['o3', 'd2', 'o1', 'd1', 'o2']);
});

test('status, outcome and relative-date labels follow the interface language', () => {
  const I = globalThis.CT.i18n;
  I.setLang('en');
  assert.equal(ui.statusLabel('review'), 'Revisit');
  assert.equal(ui.outcomeLabel('pass', true), 'Pass');
  I.setLang('he');
  assert.equal(ui.statusLabel('review'), 'צריך לחזור');
  assert.equal(ui.outcomeLabel('withdrawn', true), 'נטש');
});
