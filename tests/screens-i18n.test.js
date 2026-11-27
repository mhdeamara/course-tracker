// Translated screens: no hardcoded Hebrew interface text in the views, every key they use exists in both
// languages, and the built-in game content has a translation for every id — run with:  node tests/screens-i18n.test.js
'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const ROOT = path.join(__dirname, '..');
globalThis.window = globalThis;
const mem = new Map();
globalThis.localStorage = { getItem: (k) => (mem.has(k) ? mem.get(k) : null), setItem: (k, v) => mem.set(k, String(v)), removeItem: (k) => mem.delete(k), key: () => null, length: 0 };
Object.defineProperty(globalThis, 'navigator', { value: { languages: ['he-IL'], language: 'he-IL' }, configurable: true });
for (const f of ['js/utils.js', 'js/i18n.js', 'js/game.js']) require(path.join(ROOT, f));
const { i18n: I, game: G } = globalThis.CT;
const { he, en } = I._dicts;

// every screen route is translated, plus the shared overlays they open
const FILES = [...fs.readdirSync(path.join(ROOT, 'js/views')).map((f) => 'js/views/' + f), 'js/timer.js', 'js/ui.js', 'js/app.js'];

/* Hebrew allowed in code on purpose: the Hebrew keyboard layout for shortcuts, settings-search keywords, and
 * matching values that game.js stores in Hebrew (the stored data never changes; it is translated for display). */
const ALLOW = {
  'js/app.js': [/e\.key === '[֐-׿]'/, /\{ d: '', '[֐-׿]'/],
  'js/views/course.js': [/case '[֐-׿]'/, /e\.key === '[֐-׿]'/],
  'js/views/settings.js': [/\bkw: '/],
  'js/views/xp.js': [/'בזמן': 'onTime'/, /'הערה': 'note'/, /'זמן לימוד': 'study'/, /רצף ×/, /ש׳\)\?/, /const CAP = /],
};
const stripComments = (src) => src.replace(/\/\*[\s\S]*?\*\//g, (m) => m.replace(/[^\n]/g, ' ')).replace(/(^|[^:'"`\\])\/\/[^\n]*/g, '$1');

test('translated views contain no hardcoded Hebrew interface text', () => {
  const found = [];
  for (const f of FILES) {
    const lines = stripComments(fs.readFileSync(path.join(ROOT, f), 'utf8')).split('\n');
    lines.forEach((l, i) => {
      if (!/[֐-׿]/.test(l)) return;
      if ((ALLOW[f] || []).some((re) => re.test(l))) return;
      found.push(`${f}:${i + 1}: ${l.trim().slice(0, 90)}`);
    });
  }
  assert.deepEqual(found, []);
});

test('every literal key used by the views exists in Hebrew and English', () => {
  const missing = new Set();
  for (const f of FILES) {
    const src = fs.readFileSync(path.join(ROOT, f), 'utf8');
    for (const m of src.matchAll(/\b(?:t|tx|th|L|LX|I\.t|I\.tx|I\.th|I18N\.t|I18N\.tx|CT\.i18n\.t|CT\.i18n\.tx|CT\.i18n\.th)\(\s*'([a-zA-Z][\w.:-]*)'/g)) {
      const k = m[1];
      if (k.endsWith('.')) continue; // prefix completed at runtime (checked below where it matters)
      if (!(k in he) || !(k in en)) missing.add(`${f}: ${k}`);
    }
  }
  assert.deepEqual([...missing], []);
});

test('built-in game content: every challenge, achievement, unlock and level has both translations', () => {
  const need = [
    ...G.CHALLENGES.map((c) => 'game.ch.' + c.id),
    ...G.BADGES.flatMap((b) => ['game.ach.' + b.id + '.name', 'game.ach.' + b.id + '.desc']),
    ...G.UNLOCKS.map((x) => 'game.un.' + x.id),
    ...[...new Set(G.UNLOCKS.map((x) => x.kind))].map((k) => 'xpp.unk.' + k),
    ...G.LEVEL_NAMES.map((_, i) => 'xp.lvl.' + (i + 1)),
    ...Object.keys(G.DIFF_LABELS).map((n) => 'game.w.diff' + n),
  ];
  assert.deepEqual(need.filter((k) => !(k in he) || !(k in en)), []);
});

test('Hebrew translations of game content equal the texts game.js stores (stored ids and labels unchanged)', () => {
  G.CHALLENGES.forEach((c) => assert.equal(he['game.ch.' + c.id], c.name));
  G.BADGES.forEach((b) => { assert.equal(he['game.ach.' + b.id + '.name'], b.name); assert.equal(he['game.ach.' + b.id + '.desc'], b.desc); });
  G.LEVEL_NAMES.forEach((n, i) => assert.equal(he['xp.lvl.' + (i + 1)], n));
  G.UNLOCKS.forEach((x) => assert.equal(he['game.un.' + x.id], x.name.split(': ')[1]));
});

test('English game texts contain no Hebrew', () => {
  const bad = Object.keys(en).filter((k) => /^(game|xpp|tmr|fx|adkp|sch|rv|arc)\./.test(k)).filter((k) => /[֐-׿]/.test(JSON.stringify(en[k])));
  assert.deepEqual(bad, []);
});
