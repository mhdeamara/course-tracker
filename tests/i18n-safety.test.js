// Security tests for the translation helpers (js/i18n.js): t() escapes everything; th() inserts markup only for
// values wrapped with I.html()/I.bdi()/I.ltr() (a trusted-markup boundary, not a sanitizer); plain strings, imported
// text and server text are always escaped, whatever they contain; I.iso() isolates user text for plain-text places
// (toasts, titles, aria-label) without changing the stored value. Rendered-DOM checks run in the browser suite.
// run with:  node --test tests/i18n-safety.test.js
'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
globalThis.window = globalThis;
Object.defineProperty(globalThis, 'localStorage', { value: { getItem: () => null, setItem() {}, removeItem() {} }, configurable: true, writable: true });
Object.defineProperty(globalThis, 'navigator', { value: { languages: ['he-IL'], language: 'he-IL', onLine: true }, configurable: true, writable: true });
require('../js/i18n.js');
const I = globalThis.CT.i18n;

const PAYLOADS = [
  '<img src=x onerror=alert(1)>',
  '"><script>alert(1)</script>',
  "'><svg onload=alert(1)>",
  '<a href="javascript:alert(1)">x</a>',
  '&lt;img src=x onerror=alert(1)&gt;', // already-escaped text must not be decoded back
  '\u0001' + '0' + '\u0002', // th()'s own placeholder, smuggled in a parameter
  '{name}', // a parameter that looks like a placeholder
  '‮gnp.exe', // bidi override (display concern, see iso())
];
// any markup that could run: a tag opening, or an attribute quote breaking out
const unsafe = (s) => /<(?!\/?(bdi|span)\b)[a-z!/]/i.test(s) || /<(bdi|span)[^>]*\son\w+=/i.test(s);
const KEY = 'set.cat.track'; // "Track: {name} ({id})"

test('t(): every payload comes out as inert text', () => {
  for (const p of PAYLOADS) {
    const out = I.t(KEY, { name: p, id: p });
    assert.ok(!/[<>"]/.test(out.replace(/&lt;|&gt;|&quot;|&amp;|&#39;/g, '')), `${JSON.stringify(p)} → ${out}`);
  }
});

test('th(): a plain string parameter is escaped exactly like t()', () => {
  for (const p of PAYLOADS) {
    const a = I.th(KEY, { name: p, id: 'x' });
    const b = I.t(KEY, { name: p.replace(/[\u0001\u0002]/g, ''), id: 'x' });
    assert.equal(a, b, JSON.stringify(p));
    assert.ok(!unsafe(a), a);
  }
});

test('th(): the placeholder cannot be smuggled in to pull in another parameter\'s markup', () => {
  const out = I.th(KEY, { name: '\u00010\u0002', id: I.html('<b>trusted</b>') });
  assert.equal((out.match(/<b>trusted<\/b>/g) || []).length, 1, out);
});

test('th(): look-alike objects and strings are not trusted; only I.html() values are', () => {
  const fake = { markup: '<img src=x onerror=1>', toString() { return '<img src=x onerror=1>'; } };
  assert.ok(!unsafe(I.th(KEY, { name: fake, id: 'x' })));
  const frozen = Object.freeze({ markup: '<img src=x onerror=1>' });
  assert.ok(!unsafe(I.th(KEY, { name: frozen, id: 'x' })));
  // the trusted path works
  assert.match(I.th(KEY, { name: I.html('<i>ok</i>'), id: 'x' }), /<i>ok<\/i>/);
});

test('I.bdi()/I.ltr(): user text inside trusted markup stays escaped (they escape before wrapping)', () => {
  for (const p of PAYLOADS) {
    for (const out of [I.th(KEY, { name: I.bdi(p), id: I.ltr(p) }), I.th(KEY, { name: I.bdi(p, 'ltr'), id: 'x' })]) {
      assert.ok(!unsafe(out), `${JSON.stringify(p)} → ${out}`);
      assert.match(out, /<bdi( dir="ltr")?>/);
    }
  }
  assert.equal(String(I.bdi('a', 'evil" onclick="x')), '<bdi dir="rtl">a</bdi>'); // the direction is one of two constants
  assert.equal(String(I.ltr(null)), '<span dir="ltr"></span>');
});

test('numbers keep plural rules; null/undefined parameters stay "missing", not the text "null"', () => {
  I.setLang('en');
  try {
    assert.equal(I.th('set.cat.issues', { n: 1 }), '1 unverified entry in this catalog');
    assert.equal(I.th(KEY, { name: null, id: 'x' }), I.t(KEY, { name: null, id: 'x' }));
  } finally { I.setLang('he'); }
});

test('iso(): user text is isolated for plain-text places; its own direction controls are not shown', () => {
  const name = 'קורס‮ evil ⁦x⁩‏';
  const out = I.iso(name);
  assert.equal(out[0], '⁨');
  assert.equal(out[out.length - 1], '⁩');
  assert.ok(!/[‪-‮⁦⁧‎‏]/.test(out));
  assert.equal(out.slice(1, -1), 'קורס evil x');
  assert.equal(name, 'קורס‮ evil ⁦x⁩‏', 'the original value is untouched');
  assert.equal(I.iso(null), '⁨⁩');
});

test('call-site audit: every th() markup parameter goes through I.html / I.bdi / I.ltr (or a numeric value)', () => {
  const dir = path.join(__dirname, '..', 'js');
  const files = [...fs.readdirSync(dir).map((f) => path.join(dir, f)), ...fs.readdirSync(path.join(dir, 'views')).map((f) => path.join(dir, 'views', f))]
    .filter((f) => f.endsWith('.js') && !f.endsWith('i18n.js'));
  let calls = 0;
  for (const f of files) {
    const src = fs.readFileSync(f, 'utf8');
    // a th() call whose parameter value is a raw template/quoted string carrying markup
    for (const m of src.matchAll(/\bth\(\s*'[\w.]+'\s*,\s*\{([^}]*)\}/g)) {
      calls++;
      assert.ok(!/:\s*[`'"]\s*</.test(m[1]), `${path.basename(f)}: raw markup string passed to th(): ${m[0].slice(0, 120)}`);
    }
  }
  assert.ok(calls > 0);
});
