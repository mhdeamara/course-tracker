// i18n: dictionary parity, interpolation, plurals, escaping, fallback, and the language-choice rule.
const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');

const FILE = path.join(__dirname, '..', 'js', 'i18n.js');
function makeStorage(init = {}, { broken = false } = {}) {
  const m = new Map(Object.entries(init));
  if (broken) return { get length() { throw new Error('blocked'); }, key() { throw new Error('blocked'); }, getItem() { throw new Error('blocked'); }, setItem() { throw new Error('blocked'); } };
  return { m, get length() { return m.size; }, key: (i) => [...m.keys()][i] ?? null, getItem: (k) => (m.has(k) ? m.get(k) : null), setItem: (k, v) => m.set(k, String(v)), removeItem: (k) => m.delete(k) };
}
/** Load a fresh copy of the module with a given storage and browser language list. */
function load({ ls = makeStorage(), langs = ['he-IL'] } = {}) {
  delete require.cache[require.resolve(FILE)];
  globalThis.window = globalThis;
  delete globalThis.CT;
  Object.defineProperty(globalThis, 'localStorage', { value: ls, configurable: true, writable: true });
  Object.defineProperty(globalThis, 'navigator', { value: { languages: langs, language: langs[0] }, configurable: true, writable: true });
  require(FILE);
  return { I: globalThis.CT.i18n, ls };
}
const quiet = (fn) => { const w = console.warn; const out = []; console.warn = (m) => out.push(m); try { fn(); } finally { console.warn = w; } return out; };
const params = (v) => [...new Set((typeof v === 'object' ? Object.values(v).join(' ') : v).match(/\{\w+\}/g) || [])].sort();

test('both dictionaries have the same keys, the same params and the same plural shape', () => {
  const { I } = load();
  const { he, en } = I._dicts;
  assert.deepEqual(Object.keys(en).sort(), Object.keys(he).sort());
  for (const k of Object.keys(he)) {
    assert.deepEqual(params(en[k]), params(he[k]), `params of ${k}`);
    assert.equal(typeof en[k], typeof he[k], `shape of ${k}`);
    if (typeof he[k] === 'object') { assert.ok(he[k].other && en[k].other, `plural ${k} needs "other"`); }
    else { assert.ok(he[k].length && en[k].length, `empty ${k}`); }
  }
});

test('interpolation; missing params become empty and never throw', () => {
  const { I } = load();
  I.setLang('en');
  assert.equal(I.tx('hd.syncStatus', { status: 'Synced' }), 'Sync: Synced');
  assert.equal(I.tx('xp.chip', { n: 3, title: 'מתחיל' }), 'Level 3, מתחיל');
  let out;
  const warns = quiet(() => { out = I.tx('hd.syncStatus'); });
  assert.equal(out, 'Sync: ');
  assert.equal(warns.length, 1);
  assert.doesNotThrow(() => quiet(() => I.tx('timer.chip', null)));
});

test('t() escapes parameters and text for innerHTML / attributes; tx() stays raw', () => {
  const { I } = load();
  I.setLang('en');
  assert.equal(I.t('hd.syncStatus', { status: '<img src=x onerror=1>"' }), 'Sync: &lt;img src=x onerror=1&gt;&quot;');
  assert.equal(I.t('conflict.changedAgain'), 'The cloud changed again — try &quot;Sync now&quot;');
  assert.equal(I.tx('conflict.changedAgain'), 'The cloud changed again — try "Sync now"');
});

test('plurals: English one/other, Hebrew one/two/other', () => {
  const { I } = load();
  I.setLang('en');
  assert.equal(I.tx('backup.days', { n: 1 }), 'Last backup 1 day ago');
  assert.equal(I.tx('backup.days', { n: 5 }), 'Last backup 5 days ago');
  assert.equal(I.tx('conflict.courses', { n: 0 }), '0 courses');
  I.setLang('he');
  assert.equal(I.tx('backup.days', { n: 1 }), 'גיבוי אחרון לפני יום');
  assert.equal(I.tx('backup.days', { n: 2 }), 'גיבוי אחרון לפני יומיים');
  assert.equal(I.tx('backup.days', { n: 12 }), 'גיבוי אחרון לפני 12 ימים');
  assert.equal(I.tx('conflict.courses', { n: 2 }), '2 קורסים'); // no "two" form → "other"
});

test('fallback: missing key → other language → the key itself, with one warning', () => {
  const { I } = load();
  I.setLang('en');
  I._dicts.he['test.onlyHe'] = 'רק בעברית';
  let a, b;
  const warns = quiet(() => { a = I.tx('test.onlyHe'); I.tx('test.onlyHe'); b = I.tx('no.such.key'); });
  assert.equal(a, 'רק בעברית');
  assert.equal(b, 'no.such.key');
  assert.equal(warns.length, 2, 'one warning per missing key');
  delete I._dicts.he['test.onlyHe'];
});

test('language choice: saved → existing data → browser language → Hebrew', () => {
  const { I } = load();
  assert.equal(I.pick({ saved: 'en', hasData: true, langs: ['he'] }), 'en');
  assert.equal(I.pick({ saved: 'he', hasData: false, langs: ['en-US'] }), 'he');
  assert.equal(I.pick({ saved: 'fr', hasData: true, langs: ['en-US'] }), 'he', 'invalid saved value is ignored');
  assert.equal(I.pick({ saved: null, hasData: false, langs: ['en-US', 'fr'] }), 'en');
  assert.equal(I.pick({ saved: null, hasData: false, langs: ['en-US', 'he-IL'] }), 'he');
  assert.equal(I.pick({ saved: null, hasData: false, langs: ['iw'] }), 'he');
  assert.equal(I.pick({ saved: null, hasData: false, langs: [] }), 'he', 'unknown browser language → Hebrew');
  assert.equal(I.pick({ saved: null, hasData: false, langs: ['hel'] }), 'en', '"hel" is not Hebrew');
});

test('boot: existing user → Hebrew; new English browser → English (and remembered)', () => {
  let r = load({ ls: makeStorage({ 'ct.data.v1': '{}' }), langs: ['en-US'] });
  assert.equal(r.I.lang(), 'he');
  r = load({ ls: makeStorage({}), langs: ['en-US'] });
  assert.equal(r.I.lang(), 'en');
  assert.equal(r.ls.getItem('ct.lang'), 'en', 'the first decision is saved, so data written later does not flip it');
  r = load({ ls: makeStorage({ 'ct.lang': 'xx', 'ct.theme': 'dark' }), langs: ['en-US'] });
  assert.equal(r.I.lang(), 'he', 'invalid saved value + existing settings → Hebrew');
  assert.equal(r.ls.getItem('ct.lang'), 'he');
  r = load({ ls: makeStorage({ 'ct.lang': 'en', 'ct.data.v1': '{}' }), langs: ['he'] });
  assert.equal(r.I.lang(), 'en');
});

test('boot: blocked storage never throws and falls back to Hebrew; switching still works', () => {
  const { I } = load({ ls: makeStorage({}, { broken: true }), langs: ['en-US'] });
  assert.equal(I.lang(), 'he');
  assert.equal(I.setLang('en'), true);
  assert.equal(I.lang(), 'en');
  assert.equal(I.dir(), 'ltr');
});

test('setLang: validates, notifies listeners once, and touches only ct.lang', () => {
  const ls = makeStorage({ 'ct.data.v1': '{"x":1}' });
  const { I } = load({ ls });
  const seen = [];
  const off = I.onChange((l) => seen.push(l));
  assert.equal(I.setLang('fr'), false);
  assert.equal(I.setLang('he'), false, 'same language: no change event');
  assert.equal(I.setLang('en'), true);
  assert.equal(I.dir(), 'ltr');
  assert.equal(I.locale(), 'en-GB');
  off();
  I.setLang('he');
  assert.deepEqual(seen, ['en']);
  assert.equal(I.dir(), 'rtl');
  assert.deepEqual([...ls.m.keys()].sort(), ['ct.data.v1', 'ct.lang']);
  assert.equal(ls.getItem('ct.data.v1'), '{"x":1}', 'academic data is never touched');
});
