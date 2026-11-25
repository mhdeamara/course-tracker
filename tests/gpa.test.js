// Unit tests for js/gpa.js — run with:  node tests/gpa.test.js   (Node 18+, no packages needed)
'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
require('../js/gpa.js'); // attaches CT.gpa to globalThis
const G = globalThis.CT.gpa;

const close = (a, b, msg) => assert.ok(Math.abs(a - b) < 1e-9, `${msg || ''} expected ${b}, got ${a}`);
const SEMS = [
  { id: 's1', name: 'חורף תשפ״ד', year: 5784, term: 'winter' },
  { id: 's2', name: 'אביב תשפ״ד', year: 5784, term: 'spring' },
  { id: 's3', name: 'חורף תשפ״ה', year: 5785, term: 'winter' },
];
let n = 0;
const course = (o) => Object.assign({ id: `c${++n}`, number: '', credits: 3, semesterId: 's1' }, o);
const graded = (grade, extra = {}) => Object.assign({ type: 'graded', grade }, extra);

test('no courses: no average, nothing earned', () => {
  const r = G.compute([], SEMS, {});
  assert.equal(r.avg, null);
  assert.equal(r.earned, 0);
  assert.equal(r.count, 0);
  assert.deepEqual(r.perSemester, []);
});

test('unfinished courses are ignored', () => {
  const r = G.compute([course({ outcome: null }), course({})], SEMS, {});
  assert.equal(r.avg, null);
  assert.equal(r.earned, 0);
});

test('one course', () => {
  const r = G.compute([course({ credits: 3, outcome: graded(90) })], SEMS, {});
  close(r.avg, 90);
  assert.equal(r.earned, 3);
  assert.equal(r.count, 1);
});

test('weighted by credits, with 2.5 / 3.5 credit courses', () => {
  const r = G.compute([
    course({ credits: 2.5, outcome: graded(80) }),
    course({ credits: 3.5, outcome: graded(90) }),
  ], SEMS, {});
  close(r.avg, (80 * 2.5 + 90 * 3.5) / 6); // 85.8333…
  close(r.earned, 6);
});

test('credits given as strings (as stored by the form) still work', () => {
  const r = G.compute([course({ credits: '3.5', outcome: graded(70) }), course({ credits: '2.5', outcome: graded(100) })], SEMS, {});
  close(r.avg, (70 * 3.5 + 100 * 2.5) / 6);
});

test('pass/fail: earns credits, not in the average', () => {
  const r = G.compute([
    course({ credits: 4, outcome: graded(80) }),
    course({ credits: 2, outcome: { type: 'pass' } }),
  ], SEMS, {});
  close(r.avg, 80);
  close(r.earned, 6);
  close(r.avgCredits, 4);
});

test('exempt: credits by rule, overridable per course; never in the average', () => {
  const cs = [course({ credits: 4, outcome: graded(80) }), course({ credits: 3, outcome: { type: 'exempt' } })];
  close(G.compute(cs, SEMS, { exemptCredits: true }).earned, 7);
  close(G.compute(cs, SEMS, { exemptCredits: false }).earned, 4);
  const noCredit = [course({ credits: 3, outcome: { type: 'exempt', exemptCredits: false } })];
  close(G.compute(noCredit, SEMS, { exemptCredits: true }).earned, 0);
  close(G.compute(cs, SEMS, {}).avg, 80);
});

test('withdrawn: no credits, not in the average', () => {
  const r = G.compute([course({ credits: 4, outcome: graded(80) }), course({ credits: 5, outcome: { type: 'withdrawn', grade: 20 } })], SEMS, {});
  close(r.avg, 80);
  close(r.earned, 4);
});

test('failing grade: in the average by default, no credits; can be excluded', () => {
  const cs = [course({ credits: 3, outcome: graded(90) }), course({ credits: 3, outcome: graded(40) })];
  const on = G.compute(cs, SEMS, { failedInAvg: true });
  close(on.avg, 65);
  close(on.earned, 3);
  const off = G.compute(cs, SEMS, { failedInAvg: false });
  close(off.avg, 90);
  close(off.earned, 3);
});

test('pass mark boundary: exactly the pass grade passes; custom pass grade', () => {
  close(G.compute([course({ credits: 2, outcome: graded(55) })], SEMS, {}).earned, 2);
  close(G.compute([course({ credits: 2, outcome: graded(54.9) })], SEMS, {}).earned, 0);
  close(G.compute([course({ credits: 2, outcome: graded(58) })], SEMS, { passGrade: 60 }).earned, 0);
});

test('"failed" outcome: with a grade it counts in the average, without one it does not', () => {
  const r1 = G.compute([course({ credits: 2, outcome: graded(80) }), course({ credits: 2, outcome: { type: 'failed', grade: 30 } })], SEMS, {});
  close(r1.avg, 55);
  const r2 = G.compute([course({ credits: 2, outcome: graded(80) }), course({ credits: 2, outcome: { type: 'failed', grade: null } })], SEMS, {});
  close(r2.avg, 80);
  close(r2.earned, 2);
});

test('repeated course, rule "last": only the last attempt counts, credits once', () => {
  const cs = [
    course({ number: '00440131', credits: 5, semesterId: 's1', outcome: graded(45) }),
    course({ number: '00440131', credits: 5, semesterId: 's2', outcome: graded(75) }),
    course({ number: '01040034', credits: 3.5, semesterId: 's1', outcome: graded(90) }),
  ];
  const r = G.compute(cs, SEMS, { repeat: 'last' });
  close(r.avg, (75 * 5 + 90 * 3.5) / 8.5);
  close(r.earned, 8.5);
  assert.equal(r.rows.filter((x) => x.status === 'superseded').length, 1);
  assert.equal(r.count, 2);
});

test('repeated course, rule "last" even when the last attempt is lower', () => {
  const cs = [
    course({ number: '00440131', credits: 5, semesterId: 's1', outcome: graded(80) }),
    course({ number: '00440131', credits: 5, semesterId: 's3', outcome: graded(70) }),
  ];
  close(G.compute(cs, SEMS, { repeat: 'last' }).avg, 70);
  close(G.compute(cs, SEMS, { repeat: 'best' }).avg, 80);
});

test('repeated course, rule "all": every grade averaged, credits counted once', () => {
  const cs = [
    course({ number: '00440131', credits: 5, semesterId: 's1', outcome: graded(45) }),
    course({ number: '00440131', credits: 5, semesterId: 's2', outcome: graded(75) }),
  ];
  const r = G.compute(cs, SEMS, { repeat: 'all' });
  close(r.avg, 60);
  close(r.earned, 5);
});

test('repeat matching: old 6-digit number equals the 8-digit one; withdrawn is not an attempt', () => {
  const cs = [
    course({ number: '044131', credits: 5, semesterId: 's1', outcome: graded(50) }),
    course({ number: '00440131', credits: 5, semesterId: 's2', outcome: { type: 'withdrawn' } }),
    course({ number: '0044-0131', credits: 5, semesterId: 's3', outcome: graded(85) }),
  ];
  const r = G.compute(cs, SEMS, { repeat: 'last' });
  close(r.avg, 85);
  close(r.earned, 5);
});

test('same semester, two attempts: the later date wins under "last"', () => {
  const cs = [
    course({ number: '00440131', credits: 5, semesterId: 's1', outcome: graded(40, { date: '2024-02-20' }) }),
    course({ number: '00440131', credits: 5, semesterId: 's1', outcome: graded(65, { date: '2024-03-15' }) }),
  ];
  close(G.compute(cs, SEMS, { repeat: 'last' }).avg, 65);
});

test('courses without a number are never treated as repeats', () => {
  const r = G.compute([course({ credits: 2, outcome: graded(60) }), course({ credits: 2, outcome: graded(80) })], SEMS, {});
  close(r.avg, 70);
  close(r.earned, 4);
});

test('missing credits count as 0 and are flagged', () => {
  const r = G.compute([course({ credits: '', outcome: graded(100) }), course({ credits: 2, outcome: graded(60) })], SEMS, {});
  close(r.avg, 60);
  assert.equal(r.rows.find((x) => x.cls.missingCredits).cls.grade, 100);
});

test('per-semester averages, sorted by year and term, and the cumulative trend', () => {
  const cs = [
    course({ credits: 4, semesterId: 's3', outcome: graded(70) }),
    course({ credits: 2, semesterId: 's1', outcome: graded(90) }),
    course({ credits: 2, semesterId: 's2', outcome: graded(80) }),
    course({ credits: 2, semesterId: 's2', outcome: { type: 'pass' } }),
  ];
  const r = G.compute(cs, SEMS, {});
  assert.deepEqual(r.perSemester.map((p) => p.semester.id), ['s1', 's2', 's3']);
  close(r.perSemester[1].avg, 80);
  close(r.perSemester[1].earned, 4);
  close(r.trend[0].cumulative, 90);
  close(r.trend[1].cumulative, 85);
  close(r.trend[2].cumulative, (90 * 2 + 80 * 2 + 70 * 4) / 8);
});

test('filters: gpaExclude and include()', () => {
  const cs = [
    course({ id: 'a', credits: 3, outcome: graded(100), gpaExclude: true }),
    course({ id: 'b', credits: 3, outcome: graded(80) }),
    course({ id: 'c', credits: 3, semesterId: 's2', outcome: graded(60) }),
  ];
  close(G.compute(cs, SEMS, {}).avg, 70);
  close(G.compute(cs, SEMS, {}, { include: (c) => c.semesterId === 's1' }).avg, 80);
});

test('"what if": hypothetical grades for unfinished courses', () => {
  const cs = [course({ id: 'done', credits: 4, outcome: graded(80) }), course({ id: 'open', credits: 4, outcome: null })];
  close(G.compute(cs, SEMS, {}).avg, 80);
  close(G.compute(cs, SEMS, {}, { hypothetical: { open: 90 } }).avg, 85);
  close(G.compute(cs, SEMS, {}, { hypothetical: { done: 10 } }).avg, 80); // finished courses keep their real grade
});

test('required average for a target', () => {
  const req = G.required(850, 10, 88, 5); // (88·15 − 850) / 5
  close(req.need, 94);
  assert.equal(req.impossible, false);
  assert.equal(G.required(850, 10, 99, 2).impossible, true);
  close(G.required(950, 10, 80, 5).need, 50); // avg 95 now, target 80 → still need 50 in the remaining 5 credits
  assert.equal(G.required(950, 10, 80, 5).secured, false);
  assert.equal(G.required(950, 10, 60, 5).secured, true); // (60·15 − 950) / 5 = −10
  assert.equal(G.required(850, 10, 88, 0), null);
  close(G.required(0, 0, 90, 10).need, 90); // nothing graded yet
});

test('normNum and round', () => {
  assert.equal(G.normNum('044131'), '00440131');
  assert.equal(G.normNum('00440131'), '00440131');
  assert.equal(G.normNum(''), '');
  assert.equal(G.round(85.8333333, 2), 85.83);
  assert.equal(G.round(null), null);
});
