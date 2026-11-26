// Tests for js/catalog.js over the real catalogs/bundle.js — run with:  node tests/catalog.test.js   (Node 18+)
// Also runs the validator in --check mode, so a broken catalog file fails here too.
'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const { execFileSync } = require('node:child_process');

globalThis.window = globalThis;
require('../catalogs/bundle.js');
require('../js/catalog.js');
const K = globalThis.CT.catalog;
const DATA = globalThis.CT.catalogData;

test('validator passes on every catalog file', () => {
  const root = path.join(__dirname, '..');
  // throws (non-zero exit) on any error
  execFileSync(process.execPath, [path.join(root, 'tools', 'validate-catalogs.js'), '--check'], { cwd: root, stdio: 'pipe' });
});

test('faculty list comes from the data only, EE first', () => {
  const ids = K.faculties().map((f) => f.id);
  assert.deepEqual([...ids].sort(), Object.keys(DATA).sort());
  assert.equal(ids[0], 'ee');
  for (const f of K.faculties()) assert.ok(f.name && f.name !== f.id, `faculty ${f.id} has a name`);
  assert.equal(K.FACULTIES.ee, K.faculties()[0].name);
});

test('select: exact year, nearest year, no year', () => {
  K.select('ee', 5784);
  assert.equal(K.year, 5784); assert.equal(K.fallback, null);
  K.select('ee', 5780);
  assert.equal(K.year, Math.min(...K.available('ee'))); assert.equal(K.fallback, 'nearest');
  K.select('cs', null);
  assert.equal(K.faculty, 'cs'); assert.equal(K.fallback, 'none-chosen');
});

test('select clears fields of the previous catalog', () => {
  K.select('civil', null);
  assert.ok(K.specializations.length > 0);
  K.select('ee', 5784);
  assert.deepEqual(K.specializations, []);
  assert.deepEqual(K.choices, []);
  assert.equal(K.facultyPrefixes, undefined);
});

test('isFaculty: EE default 004, others by facultyPrefixes', () => {
  K.select('ee', 5784);
  assert.ok(K.isFaculty('00440102')); assert.ok(!K.isFaculty('02340114'));
  K.select('cs', null);
  assert.ok(K.isFaculty('02340114')); assert.ok(!K.isFaculty('00440102'));
  K.select('bme', null);
  assert.ok(K.isFaculty('03340021')); assert.ok(!K.isFaculty('01040031'));
});

test('electives: no mandatory, no lab, no "choose from list" course', () => {
  for (const fac of Object.keys(DATA)) {
    for (const y of K.available(fac)) {
      K.select(fac, y);
      const el = K.electives();
      for (const n of el) {
        assert.ok(!K.mandatorySet.has(n), `${fac}/${y}: ${n} is mandatory`);
        assert.ok(!K.labs.includes(n), `${fac}/${y}: ${n} is a lab`);
        assert.ok(!K.choiceSet.has(n), `${fac}/${y}: ${n} is a mandatory choice`);
      }
      // every listed elective (group / faculty list / specialization) is a known course
      for (const n of el) assert.ok(K.courses[n], `${fac}/${y}: ${n} not in courses`);
    }
  }
});

test('every catalog has source, totals that add up, and a track', () => {
  for (const fac of Object.keys(DATA)) {
    for (const y of K.available(fac)) {
      K.select(fac, y);
      assert.ok(K.source && K.source.url, `${fac}/${y} source`);
      assert.ok(K.track && K.trackName, `${fac}/${y} track`);
      const t = K.totals;
      assert.equal(t.total, t.mandatory + t.faculty + t.free, `${fac}/${y} totals`);
    }
  }
});

test('allCourses defaults to the selected faculty', () => {
  K.select('dds', null);
  const m = K.allCourses();
  assert.ok(m.has('00940345'));
  assert.ok(!m.has('00440102') || DATA.dds[K.year].courses['00440102']);
  K.select('ee', 5784);
  assert.ok(K.allCourses().has('00440102'));
});
