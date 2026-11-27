// Degree screens: what the GPA page shows equals js/gpa.js, in both languages, and names stay inert text.
// Renders the real view (js/views/gpa.js) with a tiny DOM stub — run with:  node tests/degree-ui.test.js
'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');

const ROOT = path.join(__dirname, '..');
const noop = () => {};
globalThis.window = globalThis;
globalThis.addEventListener = noop;
globalThis.removeEventListener = noop;
const mem = new Map();
globalThis.localStorage = { getItem: (k) => (mem.has(k) ? mem.get(k) : null), setItem: (k, v) => mem.set(k, String(v)), removeItem: (k) => mem.delete(k), key: (i) => [...mem.keys()][i] ?? null, get length() { return mem.size; } };
Object.defineProperty(globalThis, 'navigator', { value: { languages: ['he-IL'], language: 'he-IL' }, configurable: true });
globalThis.document = {
  addEventListener: noop, removeEventListener: noop, querySelectorAll: () => [], querySelector: () => null, getElementById: () => null,
  documentElement: { setAttribute: noop, style: { setProperty: noop }, dataset: {} },
  body: { appendChild: noop, classList: { add: noop, remove: noop, toggle: noop } },
};
for (const f of ['js/utils.js', 'js/i18n.js', 'js/model.js', 'js/gpa.js', 'js/ui.js']) require(path.join(ROOT, f));
const CT = globalThis.CT;

const HOSTILE = '<img src=x onerror="alert(1)">';
const st = {
  courses: [
    { id: 'a', name: `מבוא ${HOSTILE}`, number: '00440131', credits: 4, semesterId: 's1', outcome: { type: 'graded', grade: 91 }, categories: [] },
    { id: 'b', name: 'הספק', number: '00440148', credits: 3.5, semesterId: 's1', outcome: { type: 'graded', grade: 78 }, categories: [] },
    { id: 'c', name: 'פיזיקה', number: '01140051', credits: 5, semesterId: 's2', outcome: { type: 'graded', grade: 86 }, categories: [] },
    { id: 'd', name: 'פטור', number: '01040031', credits: 5, semesterId: 's2', outcome: { type: 'exempt' }, categories: [] },
    { id: 'e', name: 'פתוח', number: '00460002', credits: 3, semesterId: 's2', outcome: null, categories: [] },
  ],
  semesters: [{ id: 's1', name: `חורף ${HOSTILE}`, year: 5786, term: 'winter' }, { id: 's2', name: 'אביב תשפ״ו', year: 5786, term: 'spring' }],
  settings: { gpa: { decimals: 2 }, activeSemesterId: 's2' },
};
CT.store = { state: st, semester: (id) => st.semesters.find((x) => x.id === id), commit: noop, escape: noop };
CT.catalog = { ready: false, labs: [], mandatorySet: new Set(), electives: () => [], isFaculty: () => false };
CT.views = { catalog: { fallbackHTML: () => '', load: () => Promise.resolve() } };
require(path.join(ROOT, 'js/views/gpa.js'));

const render = (lang) => {
  CT.i18n.setLang(lang);
  const root = { innerHTML: '', querySelector: () => ({ addEventListener: noop, focus: noop }) };
  CT.views.gpa.render(root, {});
  return root.innerHTML;
};
const kpis = (html) => [...html.matchAll(/class="kpi-v[^"]*"[^>]*>([^<]*)</g)].map((m) => m[1].trim());

test('the average and credits shown equal js/gpa.js, identical in Hebrew and English', () => {
  const r = CT.gpa.compute(st.courses, st.semesters, st.settings.gpa);
  const want = [String(+r.avg.toFixed(2)), String(+r.earned.toFixed(2))];
  const he = kpis(render('he')), en = kpis(render('en'));
  assert.deepEqual(he.slice(0, 2), want);
  assert.deepEqual(en.slice(0, 2), want);
  assert.deepEqual(he, en, 'every KPI is the same number in both languages');
});

test('the exempt course earns credits without changing the average; the open course counts for neither', () => {
  const r = CT.gpa.compute(st.courses, st.semesters, st.settings.gpa);
  const graded = st.courses.filter((c) => c.outcome && c.outcome.type === 'graded');
  const avg = graded.reduce((s, c) => s + c.outcome.grade * c.credits, 0) / graded.reduce((s, c) => s + c.credits, 0);
  assert.ok(Math.abs(r.avg - avg) < 1e-9);
  assert.equal(r.earned, 4 + 3.5 + 5 + 5);
});

test('per-semester averages appear on the page as computed', () => {
  const r = CT.gpa.compute(st.courses, st.semesters, st.settings.gpa);
  const html = render('en');
  r.perSemester.filter((p) => p.avg != null).forEach((p) => assert.ok(html.includes(String(+p.avg.toFixed(2))), `semester ${p.id} average ${p.avg}`));
});

test('course and semester names are escaped in the rendered markup (both languages)', () => {
  for (const lang of ['he', 'en']) {
    const html = render(lang);
    assert.ok(!html.includes('<img'), `${lang}: no live <img> from a name`);
    assert.ok(html.includes('&lt;img'), `${lang}: the name is shown as text`);
  }
});

test('English page has no Hebrew interface words; Hebrew names keep their own direction', () => {
  const html = render('en');
  const text = html.replace(/<[^>]*(dir="auto"|lang="he")[^>]*>[^<]*<\/[^>]+>/g, '').replace(/<[^>]+>/g, ' ');
  const names = [...st.courses.map((c) => c.name), ...st.semesters.map((s) => s.name)].map((s) => s.replace(/[<>"=]/g, ''));
  const leftovers = text.split(/\s{2,}/).filter((s) => /[֐-׿]/.test(s) && !names.some((n) => n.includes(s.trim()) || s.includes(n.split(' ')[0])));
  assert.deepEqual(leftovers, []);
});
