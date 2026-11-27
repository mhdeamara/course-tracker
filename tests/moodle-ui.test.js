// Tests for the Moodle workspace's translated texts (js/views/moodle.js) and the code-based link check
// (js/moodle.js): category names, error texts by code (never raw), summaries, link problems, range keys.
// run with:  node --test tests/moodle-ui.test.js
'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
globalThis.window = globalThis;
Object.defineProperty(globalThis, 'localStorage', { value: { getItem: () => null, setItem() {}, removeItem() {} }, configurable: true, writable: true });
Object.defineProperty(globalThis, 'navigator', { value: { languages: ['he-IL'], language: 'he-IL', onLine: true }, configurable: true, writable: true });
globalThis.document = { addEventListener() {}, querySelectorAll: () => [], documentElement: { setAttribute() {} } };
globalThis.addEventListener = () => {};
require('../js/utils.js');
require('../js/i18n.js');
require('../js/ical.js');
require('../js/moodle.js');
require('../js/model.js');
require('../js/stats.js');
require('../js/ui.js');
const CT = globalThis.CT;
CT.store = { state: { courses: [], semesters: [], settings: {}, moodle: CT.moodle.emptyState ? CT.moodle.emptyState() : {} } };
require('../js/views/moodle.js');
const V = CT.views.moodle;
const Mo = CT.moodle;
const I = CT.i18n;
const inLang = (l, fn) => { I.setLang(l); try { return fn(); } finally { I.setLang('he'); } };

test('category names: built-in ones you did not rename are translated; your own names stay as typed', () => {
  const [hw] = Mo.defaultClasses();
  assert.equal(inLang('en', () => V.clsName(hw)), 'Assignments');
  assert.equal(inLang('he', () => V.clsName(hw)), hw.name);
  assert.equal(inLang('en', () => V.clsName(Object.assign({}, hw, { name: 'שלי' }))), 'שלי');
  assert.equal(inLang('en', () => V.clsName({ id: 'x1', name: 'Labs+' })), 'Labs+');
  assert.equal(inLang('en', () => V.clsName(null)), 'Unclassified');
  // every built-in category has a translation in both languages
  for (const c of Mo.defaultClasses()) for (const l of ['he', 'en']) assert.ok(I._dicts[l][`mo.cls.${c.id}`], `${l} mo.cls.${c.id}`);
});

test('sync errors are shown by code; unknown codes get the generic text and the stored message is never shown', () => {
  const stored = { code: 'link-rejected', message: 'הודעה ישנה מהשרת', at: '2026-11-27T10:00:00Z' };
  assert.match(inLang('en', () => V.errorText(stored)), /Moodle rejected the link/);
  assert.ok(!inLang('he', () => V.errorText(stored)).includes('הודעה ישנה'));
  const odd = { code: 'pg-42P01', message: 'relation "x" does not exist at …' };
  assert.equal(inLang('en', () => V.errorText(odd)), inLang('en', () => V.errorText({ code: 'server' })));
  assert.ok(!inLang('en', () => V.errorText(odd)).includes('relation'));
  assert.equal(V.errorText(null), '');
  // every code the server can store or send has a text in both languages
  for (const code of ['link-rejected', 'bad-link', 'no-link', 'too-big', 'moodle-down', 'timeout', 'rate-limit', 'not-signed-in', 'forbidden', 'server'])
    for (const l of ['he', 'en']) assert.ok(I._dicts[l][`mo.err.${code}`], `${l} mo.err.${code}`);
});

test('summaries follow the language and plural rules', () => {
  assert.equal(inLang('en', () => V.summary({ added: 1, updated: 3 })), '1 new · 3 updated');
  assert.equal(inLang('en', () => V.summary({})), 'No changes');
  assert.equal(inLang('he', () => V.summary({ added: 2 })), '2 חדשות');
  assert.equal(inLang('en', () => V.unseenText({ new: 2, changed: 0, gone: 1, restored: 0 })).split(' · ').length, 2);
});

test('link check returns a code (translated in the UI); the Hebrew wrapper is unchanged for older callers', () => {
  const ok = 'https://moodle25.technion.ac.il/calendar/export_execute.php?userid=1&authtoken=abc&preset_what=all&preset_time=custom';
  assert.equal(Mo.checkLinkCode(ok), null);
  assert.equal(Mo.checkLink(ok), null);
  const cases = { '': 'empty', 'not a link': 'not-url', 'http://moodle25.technion.ac.il/calendar/export_execute.php?userid=1&authtoken=a': 'not-https',
    'https://evil.example/calendar/export_execute.php?userid=1&authtoken=a': 'not-technion', 'https://moodle25.technion.ac.il/my/': 'not-export',
    'https://moodle25.technion.ac.il/calendar/export_execute.php?userid=1': 'missing-parts' };
  for (const [link, code] of Object.entries(cases)) {
    assert.equal(Mo.checkLinkCode(link), code, link);
    assert.ok(/[֐-׿]/.test(Mo.checkLink(link)), `Hebrew text for ${code}`);
    for (const l of ['he', 'en']) assert.ok(I._dicts[l][`mo.link.${code}`], `${l} mo.link.${code}`);
  }
  assert.equal(Mo.checkLinkCode('x'.repeat(601)), 'too-long');
});

test('link range: a key for every known preset, "other" and "unknown", each with label and text in both languages', () => {
  assert.equal(Mo.rangeInfo('custom', 'all').key, 'custom');
  assert.equal(Mo.rangeInfo('weeknow', 'all').warn, true);
  assert.equal(Mo.rangeInfo('strange', 'all').key, 'other');
  assert.equal(Mo.rangeInfo(null, null).key, 'unknown');
  for (const k of [...Object.keys(Mo.RANGES), 'other', 'unknown']) for (const l of ['he', 'en']) {
    assert.ok(I._dicts[l][`mo.range.${k}.label`] && I._dicts[l][`mo.range.${k}.text`], `${l} ${k}`);
  }
});
