#!/usr/bin/env node
/* validate-catalogs.js — checks every catalogs/<faculty>/<year>.json and, only if all pass,
 * writes catalogs/bundle.js (what the app loads; works on file:// and offline).
 *
 *   node tools/validate-catalogs.js           validate + write bundle
 *   node tools/validate-catalogs.js --check   validate only (exit code 1 on errors)
 *
 * A mismatch is never fixed here. It is either an ERROR (stops the bundle) or, if a human already
 * looked at it and recorded it in the catalog's "knownIssues", a WARNING that is shown in the app.
 */
'use strict';
const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..');
const DIR = path.join(ROOT, 'catalogs');
const CHECK_ONLY = process.argv.includes('--check');

// Technion course numbers: 8 digits = 0 + 3-digit unit + 0 + 3 digits (old 6-digit XXXYYY -> 0XXX0YYY)
const NUM_RE = /^0\d{3}0\d{3}$/;
const MAX_CREDITS = 10;
const MAX_SEM = 8;
const EPS = 1e-6;

const errors = [];
const warnings = [];
const bundle = {};

function listCatalogs() {
  const out = [];
  if (!fs.existsSync(DIR)) return out;
  for (const fac of fs.readdirSync(DIR)) {
    const fdir = path.join(DIR, fac);
    if (!fs.statSync(fdir).isDirectory()) continue;
    for (const f of fs.readdirSync(fdir)) {
      const m = f.match(/^(\d{4})\.json$/);
      if (m) out.push({ fac, year: Number(m[1]), file: path.join(fdir, f) });
    }
  }
  return out.sort((a, b) => a.fac.localeCompare(b.fac) || a.year - b.year);
}

function check(entry) {
  const tag = `${entry.fac}/${entry.year}`;
  const text = fs.readFileSync(entry.file, 'utf8');
  let c;
  try { c = JSON.parse(text); } catch (e) { errors.push(`${tag}: JSON לא תקין — ${e.message}`); return; }

  const issues = c.knownIssues || [];
  const known = (kind, num) => issues.find((k) => k.check === kind && (!num || (k.nums || []).includes(num)));
  const used = new Set();
  const fail = (kind, num, msg) => {
    const k = known(kind, num);
    if (k) { used.add(k.id); warnings.push(`${tag}: ${msg}  [ידוע: ${k.id}]`); }
    else errors.push(`${tag}: ${msg}`);
  };

  // --- metadata ---------------------------------------------------------------
  if (c.year !== entry.year) errors.push(`${tag}: שדה year (${c.year}) לא תואם לשם הקובץ`);
  if (c.faculty !== entry.fac) errors.push(`${tag}: שדה faculty (${c.faculty}) לא תואם לתיקייה`);
  const s = c.source || {};
  for (const k of ['url', 'retrieved', 'title']) if (!s[k]) errors.push(`${tag}: חסר source.${k}`);
  if (!s.uploaded && !s.pdfCreated) errors.push(`${tag}: חסר תאריך מסמך (source.uploaded או source.pdfCreated)`);

  const courses = c.courses || {};
  // --- duplicate course keys in the raw file (JSON.parse silently keeps the last one) ---
  const seen = new Map();
  for (const m of text.matchAll(/^\s*"(\d{8})":\s*\{/gm)) seen.set(m[1], (seen.get(m[1]) || 0) + 1);
  for (const [n, k] of seen) if (k > 1) errors.push(`${tag}: הקורס ${n} מופיע ${k} פעמים ברשימת הקורסים`);

  // --- course numbers & credits ----------------------------------------------
  for (const [n, rec] of Object.entries(courses)) {
    if (!NUM_RE.test(n)) fail('invalid-number', n, `מספר קורס לא תקין: ${n} (${rec.name})`);
    if (!rec.name || !String(rec.name).trim()) errors.push(`${tag}: לקורס ${n} אין שם`);
    const cr = rec.credits;
    if (cr == null) fail('missing-credits', n, `חסרות נקודות זכות: ${n} ${rec.name}`);
    else if (typeof cr !== 'number' || cr < 0 || cr > MAX_CREDITS || Math.abs(cr * 2 - Math.round(cr * 2)) > EPS)
      fail('bad-credits', n, `נקודות זכות לא סבירות: ${n} ${rec.name} = ${cr}`);
    else if (cr === 0 && !rec.note) fail('bad-credits', n, `0 נקודות בלי הסבר (note): ${n} ${rec.name}`);
  }
  const ref = (n, where) => { if (!courses[n]) errors.push(`${tag}: ${where} מפנה לקורס ${n} שלא קיים ברשימת הקורסים`); };

  // --- mandatory by semester ---------------------------------------------------
  const sems = new Set();
  const mandSeen = new Map();
  let mandTotal = 0;
  let peTotal = 0;
  for (const sem of c.mandatory || []) {
    if (!Number.isInteger(sem.sem) || sem.sem < 1 || sem.sem > MAX_SEM) errors.push(`${tag}: סמסטר לא קיים: ${sem.sem}`);
    if (sems.has(sem.sem)) errors.push(`${tag}: סמסטר ${sem.sem} מופיע פעמיים`);
    sems.add(sem.sem);
    let sum = sem.labs || 0;
    for (const n of sem.nums || []) {
      ref(n, `חובה סמסטר ${sem.sem}`);
      if (n !== c.pe) {
        if (mandSeen.has(n)) errors.push(`${tag}: קורס החובה ${n} מופיע גם בסמסטר ${mandSeen.get(n)} וגם בסמסטר ${sem.sem}`);
        mandSeen.set(n, sem.sem);
      }
      const cr = (courses[n] || {}).credits || 0;
      sum += cr;
      if (n === c.pe) peTotal += cr;
    }
    for (const [n, alts] of Object.entries(sem.alt || {})) {
      if (!(sem.nums || []).includes(n)) errors.push(`${tag}: חלופה ל־${n} בסמסטר ${sem.sem}, אבל ${n} לא בסמסטר`);
      for (const a of alts) {
        ref(a, `חלופה בסמסטר ${sem.sem}`);
        if (courses[a] && courses[n] && courses[a].credits !== courses[n].credits)
          fail('alt-credits', a, `החלופה ${a} (${courses[a].credits}) שונה בנקודות מ־${n} (${courses[n].credits})`);
      }
    }
    if (sem.statedCredits != null && Math.abs(sum - sem.statedCredits) > EPS)
      fail('semester-sum', null, `סמסטר ${sem.sem}: סכום המקצועות ${sum} ≠ הסכום המודפס ${sem.statedCredits}`);
    mandTotal += sum;
  }
  const t = c.totals || {};
  const mandNoPE = mandTotal - peTotal;
  if (Math.abs(mandNoPE - t.mandatory) > EPS)
    fail('mandatory-sum', null, `סכום טבלאות החובה (${mandNoPE}, בלי חינוך גופני) ≠ סך החובה המוצהר (${t.mandatory})`);

  // --- totals ------------------------------------------------------------------
  for (const k of ['total', 'mandatory', 'faculty', 'free'])
    if (typeof t[k] !== 'number') errors.push(`${tag}: חסר totals.${k}`);
  if (Math.abs(t.total - (t.mandatory + t.faculty + t.free)) > EPS)
    fail('totals', null, `סה״כ ${t.total} ≠ חובה ${t.mandatory} + פקולטית ${t.faculty} + כלל־טכניונית ${t.free}`);

  // --- labs ---------------------------------------------------------------------
  const labSet = new Set();
  for (const n of c.labs || []) {
    ref(n, 'רשימת המעבדות');
    if (labSet.has(n)) errors.push(`${tag}: מעבדה ${n} מופיעה פעמיים`);
    labSet.add(n);
  }

  // --- groups -------------------------------------------------------------------
  const ids = new Set();
  for (const g of c.groups || []) {
    const gt = `קבוצה ${g.n} (${g.name})`;
    if (ids.has(g.id)) errors.push(`${tag}: מזהה קבוצה כפול ${g.id}`);
    ids.add(g.id);
    const gs = new Set();
    for (const n of g.nums || []) {
      ref(n, gt);
      if (gs.has(n)) errors.push(`${tag}: ${gt}: הקורס ${n} מופיע פעמיים`);
      gs.add(n);
    }
    if (!(g.need > 0) || g.need > gs.size) errors.push(`${tag}: ${gt}: need=${g.need} לא סביר מול ${gs.size} מקצועות`);
    if (g.needDouble != null && (g.needDouble <= g.need || g.needDouble > gs.size))
      errors.push(`${tag}: ${gt}: needDouble=${g.needDouble} לא סביר`);
    for (const opt of g.must || []) for (const n of opt)
      if (!gs.has(n)) errors.push(`${tag}: ${gt}: מקצוע מחייב ${n} לא ברשימת הקבוצה`);
  }

  // --- other references -----------------------------------------------------------
  for (const n of c.freeSuggested || []) ref(n, 'בחירה חופשית מומלצת');
  for (const n of c.recommendedEarly || []) ref(n, 'בחירה פקולטית מומלצת');
  for (const [a, b] of Object.entries(c.replacedBy || {})) {
    if (!NUM_RE.test(b)) fail('invalid-number', b, `replacedBy: מספר לא תקין ${b}`);
    ref(a, 'replacedBy');
  }

  // knownIssues that no longer match anything (except ones with no automatic check) — tell, don't hide
  for (const k of issues) if (k.check && k.check !== 'none' && !used.has(k.id))
    warnings.push(`${tag}: knownIssue "${k.id}" כבר לא מתרחש — אפשר להסיר אותו מהקובץ`);

  (bundle[entry.fac] = bundle[entry.fac] || {})[entry.year] = c;
}

const list = listCatalogs();
if (!list.length) { console.error('לא נמצאו קטלוגים ב־catalogs/<faculty>/<year>.json'); process.exit(1); }
list.forEach(check);

console.log(`נבדקו ${list.length} קטלוגים: ${list.map((e) => `${e.fac}/${e.year}`).join(', ')}`);
if (warnings.length) { console.log(`\nאזהרות (${warnings.length}) — אי-התאמות ידועות שתועדו ב־knownIssues:`); warnings.forEach((w) => console.log('  ! ' + w)); }
if (errors.length) {
  console.log(`\nשגיאות (${errors.length}) — לא נכתב bundle. לבדוק מול ה־PDF, להחליט, ולתעד ב־<year>.fixes.md:`);
  errors.forEach((e) => console.log('  ✗ ' + e));
  process.exit(1);
}
console.log('\n✓ אין שגיאות.');
if (!CHECK_ONLY) {
  const out = path.join(DIR, 'bundle.js');
  const body = '/* Generated by tools/validate-catalogs.js — do not edit. Edit catalogs/<faculty>/<year>.json and re-run. */\n' +
    'window.CT = window.CT || {};\nwindow.CT.catalogData = ' + JSON.stringify(bundle) + ';\n';
  fs.writeFileSync(out, body);
  console.log(`נכתב ${path.relative(ROOT, out)} (${(body.length / 1024).toFixed(0)}KB)`);
}
