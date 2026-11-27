// Tests for the settings center (js/views/settings.js): categories and search entries are translated in both
// languages, the search finds a setting in either language, sign-in errors are shown by code (never the server's
// text), HTML-safe translation with markup parameters (CT.i18n.th), and every legacy link still opens a category.
// run with:  node --test tests/settings.test.js
'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
globalThis.window = globalThis;
Object.defineProperty(globalThis, 'localStorage', { value: { getItem: () => null, setItem() {}, removeItem() {} }, configurable: true, writable: true });
Object.defineProperty(globalThis, 'navigator', { value: { languages: ['he-IL'], language: 'he-IL', onLine: true }, configurable: true, writable: true });
globalThis.document = { addEventListener() {}, querySelectorAll: () => [], querySelector: () => null, documentElement: { setAttribute() {} } };
globalThis.addEventListener = () => {};
require('../js/utils.js');
require('../js/i18n.js');
require('../js/model.js');
require('../js/ui.js');
const CT = globalThis.CT;
CT.store = { state: { courses: [], semesters: [], settings: {} } };
CT.views = CT.views || {};
require('../js/views/settings.js');
const V = CT.views.settings;
const I = CT.i18n;
const inLang = (l, fn) => { I.setLang(l); try { return fn(); } finally { I.setLang('he'); } };
const ids = (hits) => hits.map((e) => e.id);

test('every category and every searchable setting has a label in both languages', () => {
  assert.deepEqual(V.CATS, ['appearance', 'language', 'account', 'moodle', 'ai', 'study', 'degree', 'xp', 'adhkar', 'data']);
  for (const l of ['he', 'en']) {
    for (const c of V.CATS) assert.ok(I._dicts[l]['set.c.' + c], `${l} set.c.${c}`);
    for (const e of V.entries()) {
      assert.ok(I._dicts[l]['set.s.' + e.id], `${l} set.s.${e.id}`);
      assert.ok(V.CATS.includes(e.cat), e.id);
      assert.ok(e.sel, e.id);
    }
  }
});

test('search: finds a setting in Hebrew or English, whatever the interface language; all words must match', () => {
  for (const lang of ['he', 'en']) {
    inLang(lang, () => {
      assert.ok(ids(V.search('ממוצע')).includes('gpa'), `${lang}: Hebrew → GPA`);
      assert.ok(ids(V.search('GPA')).includes('gpa'), `${lang}: English → GPA`);
      assert.ok(ids(V.search('backup')).includes('export'), `${lang}: backup → export`);
      assert.ok(ids(V.search('גיבוי')).includes('export'), `${lang}: גיבוי → export`);
      assert.ok(ids(V.search('dark')).includes('theme'));
      assert.ok(ids(V.search('כהה')).includes('theme'));
      assert.ok(ids(V.search('פומודורו')).includes('pomodoro'));
    });
  }
  assert.deepEqual(V.search(''), []);
  assert.deepEqual(V.search('   '), []);
  assert.deepEqual(V.search('zzqqxx'), []);
  assert.deepEqual(ids(V.search('moodle categories')), ['moodleClasses']);
  // geresh / quotes are ignored (צ׳אט = צאט)
  assert.ok(ids(V.search('צאט')).includes('ai'));
});

test('sign-in errors: a code for each known case; anything else is the generic text, never the server message', () => {
  assert.equal(V.authCode(new Error('Invalid login credentials')), 'bad-login');
  assert.equal(V.authCode(new Error('Email not confirmed')), 'unconfirmed');
  assert.equal(V.authCode(new Error('User already registered')), 'exists');
  assert.equal(V.authCode(new Error('Signups not allowed for this instance')), 'signup-closed');
  assert.equal(V.authCode(new Error('Password should be at least 6 characters')), 'weak');
  assert.equal(V.authCode(new TypeError('Failed to fetch')), 'offline');
  assert.equal(V.authCode(new Error('duplicate key value violates unique constraint "x" at pg …')), 'server');
  for (const code of ['bad-login', 'unconfirmed', 'exists', 'signup-closed', 'weak', 'offline', 'server']) {
    for (const l of ['he', 'en']) assert.ok(I._dicts[l]['set.acc.err.' + code], `${l} ${code}`);
  }
});

test('th(): the dictionary text is escaped, markup parameters stay markup, numbers keep plural rules', () => {
  const out = inLang('en', () => I.th('set.cat.track', { name: I.html('<bdi>Electrical &amp; Computer</bdi>'), id: I.ltr('ee') }));
  assert.equal(out, 'Track: <bdi>Electrical &amp; Computer</bdi> (<span dir="ltr">ee</span>)');
  assert.equal(inLang('en', () => I.th('set.cat.issues', { n: 1 })), '1 unverified entry in this catalog');
  assert.equal(inLang('en', () => I.th('set.cat.issues', { n: 3 })), '3 unverified entries in this catalog');
  // t() escapes parameters (user text): a semester name can never inject markup
  assert.equal(inLang('en', () => I.t('set.sem.activeOf', { name: '<img src=x onerror=1>' })), 'Active semester: &lt;img src=x onerror=1&gt;');
});

test('older links (cards on the long page) each open their category', () => {
  const src = fs.readFileSync(path.join(__dirname, '..', 'js', 'views', 'settings.js'), 'utf8');
  for (const a of ['lang-card', 'moodle', 'moodle-classes', 'ai', 'adhkar-settings']) assert.match(src, new RegExp(`'?${a}'?: '`), a);
  // every page that sends you to settings names a category
  for (const f of ['js/views/moodle.js', 'js/views/chat.js', 'js/views/ai.js', 'js/views/adhkar.js', 'js/views/xp.js', 'js/views/gpa.js']) {
    const s = fs.readFileSync(path.join(__dirname, '..', f), 'utf8');
    assert.ok(!/href="#\/settings"/.test(s), `${f} links to #/settings without a category`);
  }
});

test('settings UI text goes through i18n (no Hebrew literals in the settings module)', () => {
  const src = fs.readFileSync(path.join(__dirname, '..', 'js', 'views', 'settings.js'), 'utf8')
    .split('\n').filter((line) => !/^\s*(\/\/|\*|\/\*)/.test(line) && !/kw: '/.test(line)).join('\n');
  assert.ok(!/[֐-׿]/.test(src), 'Hebrew text in settings.js outside comments and search keywords');
});
