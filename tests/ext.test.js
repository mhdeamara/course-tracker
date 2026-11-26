// Tests for the Chrome extension's data logic — run with:  node --test tests/ext.test.js
// What goes into the snapshot (and what never does), what the popup shows, the badge count, settings checks,
// the shared-module copies, the manifest's permissions, and a secrets scan of the extension folder.
'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
globalThis.window = globalThis;
require('../js/utils.js');
require('../js/game.js');
require('../js/stats.js');
require('../js/adhkar.js');
require('../js/ext-snapshot.js');
require('../extension/lib/view.js');
require('../extension/lib/settings.js');
const { u, game: G, adhkar: A, extSnapshot: X } = globalThis.CT;
const V = globalThis.CTView, CFG = globalThis.CTSettings;
const ROOT = path.join(__dirname, '..');

const at = (d, h = 10, m = 0, mo = 10) => new Date(2026, mo, d, h, m); // November 2026; the 26th is a Thursday
const item = (id, title, due, status = 'todo', extra = {}) => Object.assign({ id, title, due, status, note: '', link: '', tags: [], flag: false, completedAt: null }, extra);
function state() {
  const st = {
    version: 4, semesters: [{ id: 's1', name: 'חורף' }], studyLog: [],
    settings: { activeSemesterId: 's1', ai: { extractModel: 'x', chatModel: 'y' } },
    courses: [
      { id: 'c1', name: 'מבני נתונים', color: '#4f5bd5', semesterId: 's1',
        categories: [{ id: 'k1', name: 'תרגילי בית', items: [
          item('i1', 'ש״ב 3', '2026-11-26', 'todo', { note: 'סוד-בהערה', link: 'https://moodle.example/secret-link' }),
          item('i2', 'ש״ב 2', '2026-11-20'),
          item('i3', 'ש״ב 4', '2026-11-30', 'doing'),
          item('i4', 'ש״ב 1', '2026-11-26', 'done', { completedAt: at(26, 9).toISOString() }),
          item('i5', 'ש״ב 9', '2027-03-01'),
          item('i6', 'בלי תאריך', ''),
        ] }],
        exams: [{ id: 'e1', label: 'מועד א', date: '2026-12-10' }, { id: 'e0', label: 'ישן', date: '2026-10-01' }],
        schedule: [{ day: 4, start: '10:30', end: '12:30', type: 'lecture', room: 'טאוב 2' }, { day: 1, start: '08:30', end: '10:30', type: 'tutorial' }] },
      { id: 'c2', name: 'קורס ישן', color: '#000', semesterId: 's0', categories: [{ name: 'x', items: [item('o1', 'לא פעיל', '2026-11-26')] }] },
      { id: 'c3', name: 'בארכיון', archived: true, color: '#000', semesterId: 's1', categories: [{ name: 'x', items: [item('o2', 'בארכיון', '2026-11-26')] }] },
    ],
    moodle: { ics: 'https://moodle.example/calendar/export_execute.php?authtoken=SECRET' },
  };
  G.ensure(st, at(1));
  A.ensure(st);
  return st;
}

/* ---------- the snapshot ---------- */
test('snapshot: active courses only; open items up to 30 days ahead; done only when due today', () => {
  const snap = X.build(state(), at(26));
  assert.equal(snap.v, 1);
  assert.equal(snap.today, '2026-11-26');
  assert.deepEqual(snap.courses.map((c) => c.id), ['c1']);
  assert.deepEqual(snap.items.map((x) => x.id), ['i2', 'i1', 'i4', 'i3']);
  assert.deepEqual(snap.exams.map((e) => e.d), ['2026-12-10']);
  assert.equal(snap.slots.length, 2);
  assert.ok(snap.next.length >= 1 && snap.next[0].id === 'i2', 'the overdue one is the next action');
  assert.ok(snap.game && snap.game.goal.items > 0);
  assert.ok(snap.adhkar && Object.keys(snap.adhkar.windows).length === 3);
});

test('snapshot: never carries notes, links, Moodle/iCal data, AI settings or anything not shown', () => {
  const json = JSON.stringify(X.build(state(), at(26)));
  ['סוד-בהערה', 'secret-link', 'authtoken', 'SECRET', 'moodle', 'extractModel', 'ledger', 'note', 'link'].forEach((s) => assert.ok(!json.includes(s), s));
});

/* ---------- what the popup shows ---------- */
test('view: today (open first, then ticked), overdue, the next 7 days, exams, classes, badge', () => {
  const v = V.build(X.build(state(), at(26)), at(26, 11));
  assert.deepEqual(v.dueToday.map((x) => [x.id, x.s]), [['i1', 'todo'], ['i4', 'done']]);
  assert.deepEqual(v.overdue.map((x) => x.id), ['i2']);
  assert.deepEqual(v.soon.map((x) => [x.id, x.inDays]), [['i3', 4]]);
  assert.deepEqual(v.exams.map((e) => [e.l, e.inDays]), [['מועד א', 14]]);
  assert.deepEqual(v.classes.map((c) => c.from), ['10:30'], 'Thursday only');
  assert.equal(v.badge, 2, 'overdue + open today');
  assert.equal(V.badgeText(v.badge), '2');
  assert.equal(V.badgeText(0), '');
  assert.equal(V.badgeText(140), '99+');
});

test('view: an old snapshot is read against today — the badge moves at midnight without the site', () => {
  const snap = X.build(state(), at(26));
  const v = V.build(snap, at(27, 9));
  assert.equal(v.fresh, false);
  assert.deepEqual(v.overdue.map((x) => x.id), ['i2', 'i1'], 'yesterday\'s item is now overdue');
  assert.deepEqual(v.dueToday, [], 'yesterday\'s ticked item is gone');
  assert.equal(v.badge, 2);
  const later = V.build(snap, at(30, 9));
  assert.deepEqual(later.dueToday.map((x) => x.id), ['i3']);
  assert.equal(later.badge, 3);
});

test('view: the daily goal counts from the points day (04:00) and resets when the day changes', () => {
  const st = state();
  st.studyLog.push({ id: 'l1', date: '2026-11-26', minutes: 30 });
  G.reconcile(st, at(26, 10));
  const snap = X.build(st, at(26, 11));
  const v = V.build(snap, at(26, 23));
  assert.equal(v.game.goal.doneMinutes, 30);
  assert.ok(v.game.goal.pct > 0 && v.game.goal.pct <= 100);
  assert.equal(V.build(snap, at(27, 2)).game.goal.doneMinutes, 30, '02:00 is still the same points day');
  const next = V.build(snap, at(27, 5));
  assert.equal(next.game.goal.doneMinutes, 0);
  assert.equal(next.game.stale, true);
  st.game.cfg = { enabled: false };
  assert.equal(X.build(st, at(26)).game, null, 'points off → nothing shown');
});

test('view: adhkar — inside a window and not done; not when done; not outside the windows', () => {
  const st = state();
  st.adhkar.cfg = { mode: 'manual' }; // 04:30–11:30 and 15:30–20:30
  const snap = X.build(st, at(26, 8));
  assert.equal(V.adhkarDue(snap, at(26, 8)), 'm');
  assert.equal(V.adhkarDue(snap, at(26, 13)), null);
  assert.equal(V.adhkarDue(snap, at(26, 16)), 'e');
  assert.equal(V.adhkarDue(snap, at(28, 16)), 'e', 'two days later: windows are in the snapshot');
  assert.equal(V.adhkarDue(snap, at(30, 16)), null, 'beyond the snapshot: no guess');
  A.markDone(st, 'm', at(26, 7));
  assert.equal(V.adhkarDue(X.build(st, at(26, 8)), at(26, 9)), null);
  assert.equal(V.adhkarDue(X.build(st, at(26, 8)), at(27, 9)), 'm', 'done yesterday says nothing about today');
  st.adhkar.cfg = { enabled: false };
  assert.equal(X.build(st, at(26, 8)).adhkar, null);
});

test('view: empty / unknown snapshot and "updated" wording', () => {
  assert.equal(V.build(null).empty, true);
  assert.equal(V.build({ v: 2 }).empty, true);
  assert.equal(V.ago(new Date(Date.now() - 30e3).toISOString()), 'עכשיו');
  assert.equal(V.ago(new Date(Date.now() - 5 * 60e3).toISOString()), 'לפני 5 דק׳');
  assert.equal(V.ago(new Date(Date.now() - 26 * 3600e3).toISOString()), 'אתמול');
  assert.equal(V.ago('x'), 'אף פעם');
});

/* ---------- settings ---------- */
test('settings: only a public key is accepted; site and Supabase URLs are checked', () => {
  const jwt = (role) => `x.${Buffer.from(JSON.stringify({ role })).toString('base64url')}.y`;
  assert.ok(CFG.checkKey(jwt('anon')).key);
  assert.ok(CFG.checkKey('sb_publishable_abc_123').key);
  assert.ok(CFG.checkKey(jwt('service_role')).err);
  assert.ok(CFG.checkKey('sb_secret_abc').err);
  assert.ok(CFG.checkKey('').err);
  assert.ok(CFG.checkKey('hello').err);
  assert.equal(CFG.checkSbUrl('https://abc.supabase.co/rest/v1').url, 'https://abc.supabase.co');
  assert.ok(CFG.checkSbUrl('http://abc.supabase.co').err);
  assert.equal(CFG.checkSite('https://x.github.io/course-tracker/index.html#/x').url, 'https://x.github.io/course-tracker/');
  assert.equal(CFG.checkSite('http://127.0.0.1:8765/').url, 'http://127.0.0.1:8765/');
  assert.ok(CFG.checkSite('http://example.com/').err);
  assert.equal(CFG.pattern('http://127.0.0.1:8765/'), 'http://127.0.0.1/*');
  assert.equal(CFG.pattern(CFG.DEFAULT_SITE), 'https://mhdeamara.github.io/course-tracker/*');
  assert.ok(CFG.siteMatches(CFG.DEFAULT_SITE, 'https://mhdeamara.github.io/course-tracker/#/course/1'));
  assert.ok(!CFG.siteMatches(CFG.DEFAULT_SITE, 'https://mhdeamara.github.io/other/'));
  assert.ok(!CFG.siteMatches(CFG.DEFAULT_SITE, 'https://evil.example/course-tracker/'));
  const d = CFG.merge({});
  assert.equal(d.mode, 'local', 'local by default');
  assert.equal(d.sbUrl, '');
  assert.equal(CFG.cloudReady(d), false);
});

/* ---------- the package ---------- */
test('extension/lib holds exact copies of the shared site modules', () => {
  ['utils.js', 'game.js', 'stats.js', 'adhkar.js', 'ext-snapshot.js'].forEach((f) => {
    assert.ok(fs.readFileSync(path.join(ROOT, 'js', f)).equals(fs.readFileSync(path.join(ROOT, 'extension', 'lib', f))), `${f}: run node tools/ext-sync.mjs`);
  });
});

test('manifest: minimal permissions, only the site, nothing remote', () => {
  const m = JSON.parse(fs.readFileSync(path.join(ROOT, 'extension', 'manifest.json'), 'utf8'));
  assert.equal(m.manifest_version, 3);
  assert.deepEqual(m.permissions.slice().sort(), ['alarms', 'notifications', 'storage']);
  assert.deepEqual(m.host_permissions, ['https://mhdeamara.github.io/course-tracker/*']);
  assert.deepEqual(m.content_scripts.map((c) => c.matches), [['https://mhdeamara.github.io/course-tracker/*']]);
  assert.deepEqual(m.optional_permissions, ['scripting']);
  assert.ok(!m.content_security_policy, 'default (strict) extension CSP');
});

test('no secrets, keys, project URLs or remote code in the extension folder', () => {
  const files = [];
  const walk = (dir) => fs.readdirSync(dir, { withFileTypes: true }).forEach((e) => {
    const p = path.join(dir, e.name);
    if (e.isDirectory()) walk(p); else if (/\.(js|json|html|css|md)$/.test(e.name)) files.push(p);
  });
  walk(path.join(ROOT, 'extension'));
  assert.ok(files.length >= 10);
  const cfg = fs.readFileSync(path.join(ROOT, 'js', 'config.js'), 'utf8');
  const sbUrl = /supabaseUrl:\s*'([^']+)'/.exec(cfg)[1], sbKey = /supabaseKey:\s*'([^']+)'/.exec(cfg)[1];
  for (const f of files) {
    const t = fs.readFileSync(f, 'utf8');
    const rel = path.relative(ROOT, f);
    assert.ok(!/sb_secret_[A-Za-z0-9]/.test(t), `${rel}: secret key`);
    assert.ok(!/eyJ[A-Za-z0-9_-]{20,}\.[A-Za-z0-9_-]{20,}\./.test(t), `${rel}: JWT`);
    assert.ok(!/sk-ant-|ghp_[A-Za-z0-9]{20}|AIza[0-9A-Za-z_-]{20}/.test(t), `${rel}: API key`);
    assert.ok(!t.includes(sbUrl) && !t.includes(sbKey), `${rel}: the site's Supabase project (entered in options only)`);
    assert.ok(!/<script[^>]+src=["']https?:/i.test(t), `${rel}: remote script`);
    assert.ok(!/\beval\(|new Function\(/.test(t), `${rel}: eval`);
  }
});
