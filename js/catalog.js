/* catalog.js — picks one study program out of catalogs/bundle.js (CT.catalogData) and exposes it as CT.catalog.
 * The data itself lives in catalogs/<faculty>/<year>.json and is checked by tools/validate-catalogs.js,
 * which is the only thing that writes the bundle. Pure data + small lookups, no DOM.
 * CT.catalog is one object that is refilled in place by cat.select(), so views can keep a reference to it. */
(function (CT) {
  'use strict';

  const YEAR_LABELS = {
    5780: 'תש״פ', 5781: 'תשפ״א', 5782: 'תשפ״ב', 5783: 'תשפ״ג', 5784: 'תשפ״ד',
    5785: 'תשפ״ה', 5786: 'תשפ״ו', 5787: 'תשפ״ז', 5788: 'תשפ״ח', 5789: 'תשפ״ט', 5790: 'תש״ץ',
  };
  const cat = { ready: false };
  /** Faculties come from the data only: a new catalogs/<faculty>/<year>.json (+ validator run) adds one.
   *  Name = facultyName of the newest catalog of that faculty. */
  cat.faculties = () => Object.entries(CT.catalogData || {}).map(([id, ys]) => {
    const newest = ys[Math.max(...Object.keys(ys).map(Number))] || {};
    return { id, name: newest.facultyName || id, track: newest.trackName || '' };
  }).sort((a, b) => (a.id === 'ee' ? -1 : b.id === 'ee' ? 1 : a.name.localeCompare(b.name, 'he')));
  Object.defineProperty(cat, 'FACULTIES', { enumerable: false, get: () => Object.fromEntries(cat.faculties().map((f) => [f.id, f.name])) });
  cat.yearLabel = (y) => YEAR_LABELS[y] || String(y);
  /** Academic years shown in the picker: a few before the oldest catalog up to one after the newest. */
  cat.pickerYears = (fac = 'ee') => {
    const ys = cat.available(fac);
    if (!ys.length) return [];
    const out = [];
    for (let y = Math.min(5780, ys[0]); y <= ys[ys.length - 1] + 1; y++) out.push(y);
    return out;
  };
  cat.available = (fac = 'ee') => Object.keys((CT.catalogData || {})[fac] || {}).map(Number).sort((a, b) => a - b);

  /** Load the catalog for (faculty, year). Missing year → nearest one (ties → the later), with a warning. */
  cat.select = (fac, year) => {
    const all = (CT.catalogData || {})[fac] || {};
    const ys = Object.keys(all).map(Number).sort((a, b) => a - b);
    // drop the previous selection's fields
    Object.keys(cat).forEach((k) => { if (typeof cat[k] !== 'function') delete cat[k]; });
    cat.ready = false;
    if (!ys.length) { cat.error = 'לא נמצאו קטלוגים (catalogs/bundle.js חסר — צריך להריץ node tools/validate-catalogs.js).'; return cat; }
    const wanted = year ? Number(year) : null;
    let shown = wanted;
    if (!wanted || !all[wanted]) {
      shown = !wanted ? ys[ys.length - 1]
        : ys.reduce((best, y) => (Math.abs(y - wanted) < Math.abs(best - wanted) || (Math.abs(y - wanted) === Math.abs(best - wanted) && y > best) ? y : best), ys[0]);
    }
    const d = all[shown];
    Object.assign(cat, JSON.parse(JSON.stringify(d)));
    cat.ready = true;
    cat.wantedYear = wanted;
    cat.fallback = !wanted ? 'none-chosen' : (wanted !== shown ? 'nearest' : null);
    cat.courses = {};
    Object.entries(d.courses).forEach(([num, c]) => { cat.courses[num] = Object.assign({ num }, c); });
    ['labs', 'groups', 'recommendedEarly', 'freeSuggested', 'facultyRules', 'freeRules', 'choices', 'facultyLists', 'specializations']
      .forEach((k) => { if (!Array.isArray(cat[k])) cat[k] = []; });
    cat.replacedBy = cat.replacedBy || {};
    cat.choiceSet = new Set();
    cat.choices.forEach((ch) => ch.nums.forEach((n) => cat.choiceSet.add(n)));
    cat.mandatorySet = new Set();
    cat.mandatory.forEach((s) => {
      s.nums.forEach((n) => cat.mandatorySet.add(n));
      Object.values(s.alt || {}).forEach((alts) => alts.forEach((n) => cat.mandatorySet.add(n)));
    });
    // course number → the knownIssue that mentions it (shown next to the course)
    cat.issueOf = {};
    (cat.knownIssues || []).forEach((k) => (k.nums || []).forEach((n) => { cat.issueOf[n] = k; }));
    // inverse of replacedBy, so a newer number in "my courses" can be pointed at
    cat.replaces = {};
    Object.entries(cat.replacedBy || {}).forEach(([a, b]) => { cat.replaces[b] = a; });
    return cat;
  };

  /** "קטלוג: הנדסת חשמל, תשפ״ו · עודכן: … · מקור: …" pieces for the UI. */
  cat.sourceInfo = () => {
    if (!cat.ready) return null;
    const s = cat.source || {};
    return {
      text: `${cat.trackName}, ${cat.label}`,
      updated: s.uploaded || s.pdfCreated || '',
      updatedNote: s.uploaded ? 'תאריך העלאה לאתר' : 'תאריך יצירת ה־PDF (תאריך ההעלאה לא ידוע)',
      retrieved: s.retrieved, url: s.url, page: s.page, title: s.title,
    };
  };
  /** Warning text when the catalog shown is not the one the user asked for. */
  cat.fallbackWarning = () => {
    if (!cat.ready || !cat.fallback) return '';
    if (cat.fallback === 'none-chosen') return `לא נבחרה שנת קטלוג — מוצג הקטלוג החדש ביותר (${cat.label}). בחר/י את שנת הקטלוג שלך (השנה שבה התחלת ללמוד) בהגדרות.`;
    return `אין אצלנו קטלוג ${cat.yearLabel(cat.wantedYear)}. הקטלוג המוצג הוא של ${cat.label}, ייתכן שהוא לא מעודכן או לא תואם לשנה שלך.`;
  };

  /** Every course in every catalog year of a faculty (for entering past semesters): number → {num, name, credits}.
   *  The chosen catalog wins; otherwise the newest year that lists the course. */
  cat.allCourses = (fac = cat.faculty || 'ee') => {
    const all = (CT.catalogData || {})[fac] || {};
    const map = new Map();
    Object.keys(all).map(Number).sort((a, b) => b - a).forEach((y) => {
      Object.entries(all[y].courses || {}).forEach(([num, c]) => { if (!map.has(num)) map.set(num, { num, name: c.name, credits: c.credits }); });
    });
    Object.entries(cat.courses || {}).forEach(([num, c]) => map.set(num, { num, name: c.name, credits: c.credits }));
    return map;
  };

  /** Course record by number (unknown numbers return a stub). */
  cat.get = (num) => cat.courses && cat.courses[num] || { num, name: num, credits: null };
  /** Groups that contain a course number. */
  cat.groupsOf = (num) => (cat.groups || []).filter((g) => g.nums.includes(num));
  /** Is this a course of the catalog's own faculty (by number prefix)? EE files have no facultyPrefixes → 004x. */
  cat.isFaculty = (num) => {
    const ps = cat.facultyPrefixes && cat.facultyPrefixes.length ? cat.facultyPrefixes : ['004'];
    return ps.some((p) => String(num).startsWith(p));
  };
  /** Faculty electives = own-faculty courses that are not mandatory + every course in a group, faculty list or
   *  specialization, minus labs and the mandatory "choose from list" courses. */
  cat.electives = () => {
    const set = new Set();
    Object.keys(cat.courses || {}).forEach((n) => { if (cat.isFaculty(n) && !cat.mandatorySet.has(n)) set.add(n); });
    (cat.groups || []).forEach((g) => g.nums.forEach((n) => set.add(n)));
    (cat.facultyLists || []).forEach((l) => l.nums.forEach((n) => set.add(n)));
    (cat.specializations || []).forEach((sp) => sp.parts.forEach((p) => p.nums.forEach((n) => set.add(n))));
    return [...set].filter((n) => !cat.labs.includes(n) && !cat.mandatorySet.has(n) && !cat.choiceSet.has(n)).sort();
  };

  CT.catalog = cat;
})(window.CT = window.CT || {});
