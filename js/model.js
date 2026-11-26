/* model.js — data shapes, defaults, templates and migrations. No DOM here. */
(function (CT) {
  'use strict';
  const u = CT.u;
  const m = {};

  m.VERSION = 4; // 2: semester year/term, course kind/outcome, GPA settings · 3: points ledger (state.game) · 4: adhkar (state.adhkar)
  m.BACKUP_KEY = `ct.backup.pre-v${m.VERSION}`; // untouched copy of the data, saved right before upgrading to this version
  m.OLD_BACKUP_KEYS = ['ct.backup.pre-v3', 'ct.backup.pre-v2'];

  m.TERMS = { winter: 'חורף', spring: 'אביב', summer: 'קיץ' };
  m.TERM_ORDER = ['winter', 'spring', 'summer'];
  /** How a finished course ended. */
  m.OUTCOMES = {
    graded: { label: 'עם ציון', short: 'הושלם' },
    pass: { label: 'עובר (ללא ציון מספרי)', short: 'עובר' },
    exempt: { label: 'פטור', short: 'פטור' },
    failed: { label: 'נכשל', short: 'נכשל' },
    withdrawn: { label: 'נטש / ביטל', short: 'נטש' },
  };
  m.REQ_CATS = { mandatory: 'חובה', faculty: 'בחירה פקולטית', lab: 'מעבדות', free: 'בחירה חופשית / אחר' };
  /** Default GPA rules — each one can be changed in settings. */
  m.DEFAULT_GPA = { repeat: 'last', failedInAvg: true, passGrade: 55, exemptCredits: true, decimals: 2 };

  m.STATUSES = {
    todo: { label: 'לא התחלתי', short: 'לא התחלתי' },
    doing: { label: 'בתהליך', short: 'בתהליך' },
    done: { label: 'הושלם', short: 'הושלם ✓' },
    review: { label: 'צריך לחזור', short: 'לחזור' },
  };
  m.STATUS_ORDER = ['todo', 'doing', 'done', 'review'];

  // Classic, muted palette: navy, burgundy, forest, ochre, plum, teal, rust, slate, olive, walnut
  m.COLORS = ['#2c4a7a', '#8c2f39', '#2f6b4f', '#b07d2b', '#6b4c7a', '#2a6f77', '#a4552c', '#4f5d6b', '#6d7a3a', '#7a5a45'];
  // first-version palette → mapped one-to-one onto the classic palette on load
  const OLD_COLORS = ['#4f7cff', '#e0663d', '#2f9e74', '#a35bd6', '#d6a21c', '#d1477a', '#2b9bb5', '#7a8a3a', '#8b6a4e', '#5b6cc9'];

  m.SLOT_TYPES = { lecture: 'הרצאה', tutorial: 'תרגול', lab: 'מעבדה', other: 'אחר' };

  // Official Technion dates, winter 2026/27 (senate secretariat, updated May 2026):
  // first day of classes 28.10.2026, last day 28.1.2027.
  m.WINTER_5787 = { start: '2026-10-28', end: '2027-01-28', examStart: '2027-02-01' };
  const OLD_GUESS = { start: '2026-10-18', end: '2027-01-22' }; // first-version placeholder

  m.DEFAULT_TEMPLATE = [
    { name: 'הרצאות', count: 13, pattern: 'הרצאה {n}' },
    { name: 'תרגולים', count: 13, pattern: 'תרגול {n}' },
    { name: 'שיעורי בית', count: 5, pattern: 'ש״ב {n}' },
  ];

  /* ---------- factories ---------- */
  m.newItem = (title, extra = {}) => Object.assign({
    id: u.uid(), title: title || 'פריט חדש', status: 'todo', note: '', due: '', link: '',
    tags: [], flag: false, completedAt: null, createdAt: new Date().toISOString(),
  }, extra);

  m.newCategory = (name, items = []) => ({ id: u.uid(), name: name || 'קטגוריה חדשה', items });

  m.newCourse = (extra = {}) => Object.assign({
    id: u.uid(), name: 'קורס חדש', number: '', semesterId: '', color: m.COLORS[0], staff: '', credits: '',
    links: [], description: '', categories: [], exams: [], schedule: [], notebook: [],
    grade: { components: [], target: 85 }, archived: false, sample: false,
    kind: 'full',        // 'full' = tracked with items; 'record' = past course, grade only
    outcome: null,       // null = in progress; else { type, grade, date, note, exemptCredits }
    reqCategory: '',     // '' = from the catalog by course number; else a key of m.REQ_CATS
    gpaExclude: false,   // leave out of the GPA and credit calculations
  }, extra);

  m.newSemester = (extra = {}) => Object.assign({ id: u.uid(), name: 'סמסטר חדש', year: null, term: null, start: '', end: '', examStart: '' }, extra);
  /** "חורף תשפ״ז" */
  m.semName = (term, year) => `${m.TERMS[term] || ''} ${year ? u.hebYear(year) : ''}`.trim();
  /** Sort key: academic year, then winter → spring → summer. Semesters without a year go last. */
  m.semKey = (s) => (s && s.year ? s.year * 10 + Math.max(0, m.TERM_ORDER.indexOf(s.term)) : 99999);
  m.sortedSemesters = (sems) => sems.slice().sort((a, b) => m.semKey(a) - m.semKey(b));
  /** Read the term and year out of a free-text name like "חורף תשפ״ז" or "אביב 5786". */
  m.parseSemName = (name) => {
    const s = String(name || '');
    const term = Object.keys(m.TERMS).find((k) => s.includes(m.TERMS[k])) || null;
    let year = null;
    const num = s.match(/5\d{3}/);
    if (num) year = Number(num[0]);
    else s.split(/[\s—–\-,()]+/).some((w) => { const y = u.parseHebYear(w); if (y && w.length > 2) year = y; return !!year; });
    return { term, year };
  };
  /** True once the course has a final outcome. */
  m.isFinished = (c) => !!(c && c.outcome && c.outcome.type);

  /** Generate `count` items from a pattern like "תרגול {n}" starting at `start`. */
  m.makeItems = (pattern, count, start = 1) => {
    const out = [];
    for (let i = 0; i < count; i++) {
      const n = start + i;
      out.push(m.newItem(pattern.includes('{n}') ? pattern.replace(/\{n\}/g, n) : `${pattern} ${n}`));
    }
    return out;
  };

  /** Adds template categories to a course (merges into existing categories with the same name). */
  m.applyTemplate = (course, template) => {
    template.forEach((t) => {
      if (!t.name || !(t.count > 0)) return;
      let cat = course.categories.find((c) => c.name === t.name);
      if (!cat) { cat = m.newCategory(t.name); course.categories.push(cat); }
      cat.items.push(...m.makeItems(t.pattern || `${t.name} {n}`, Number(t.count), cat.items.length + 1));
    });
    return course;
  };

  m.labCategories = (n = 6) => {
    const cats = [];
    for (let i = 1; i <= n; i++) {
      cats.push(m.newCategory(`ניסוי ${i}`, ['הכנה', 'ביצוע', 'דוח'].map((s) => m.newItem(`ניסוי ${i} — ${s}`))));
    }
    return cats;
  };

  m.emptyState = () => ({
    version: m.VERSION,
    semesters: [],
    courses: [],
    studyLog: [],
    settings: {
      template: JSON.parse(JSON.stringify(m.DEFAULT_TEMPLATE)),
      lastBackup: null, backupSnooze: null, activeSemesterId: '',
      pomodoro: { work: 25, brk: 5 },
      samplesRemoved: true,
      catalog: { faculty: 'ee', year: null }, // null = not chosen yet → newest catalog, with a warning
      gpa: Object.assign({}, m.DEFAULT_GPA),
      ai: { extractModel: 'claude-sonnet-5-5', chatModel: 'claude-haiku-5-5' }, // model choice only; no keys here
    },
    moodle: CT.moodle.emptyState(), // Moodle sync bookkeeping (no secrets: the calendar link is never stored here)
    meta: { createdAt: new Date().toISOString(), updatedAt: null },
  });

  /* ---------- first-run data: one empty semester; courses are added from the catalog page ---------- */
  m.initialData = () => {
    const st = m.emptyState();
    const sem = m.newSemester({ name: 'חורף תשפ״ז', year: 5787, term: 'winter', ...m.WINTER_5787 });
    st.semesters.push(sem);
    st.settings.activeSemesterId = sem.id;
    if (CT.game) CT.game.ensure(st);
    if (CT.adhkar) CT.adhkar.ensure(st);
    return st;
  };

  /* ---------- migrations / validation of loaded or imported data ---------- */
  m.migrate = (data) => {
    if (!data || typeof data !== 'object' || !Array.isArray(data.courses)) throw new Error('קובץ לא תקין: חסרה רשימת קורסים');
    const base = m.emptyState();
    const st = Object.assign(base, data);
    st.settings = Object.assign(m.emptyState().settings, data.settings || {});
    st.settings.gpa = Object.assign({}, m.DEFAULT_GPA, (data.settings && data.settings.gpa) || {});
    if (Number(data.version) > m.VERSION) st.meta.newerSchema = Number(data.version); // saved by a newer app version
    st.meta = Object.assign(m.emptyState().meta, data.meta || {});
    st.semesters = Array.isArray(st.semesters) ? st.semesters : [];
    // replace the placeholder dates from the first version with the official ones
    st.semesters.forEach((s) => {
      if (s.start === OLD_GUESS.start && s.end === OLD_GUESS.end) Object.assign(s, m.WINTER_5787);
      // v2: academic year + term, read once from the name when the fields are missing
      if (!('year' in s) || !('term' in s)) {
        const p = m.parseSemName(s.name);
        if (!('year' in s)) s.year = p.year;
        if (!('term' in s)) s.term = p.term;
      }
    });
    st.studyLog = Array.isArray(st.studyLog) ? st.studyLog : [];
    CT.moodle.ensure(st);
    // one-time cleanup: remove the sample courses that the first version created
    if (!(data.settings && data.settings.samplesRemoved)) { // check the raw data: defaults already set the flag
      const ids = new Set(st.courses.filter((c) => c.sample).map((c) => c.id));
      st.courses = st.courses.filter((c) => !c.sample);
      st.studyLog = st.studyLog.filter((e) => !e.sample && !ids.has(e.courseId));
      st.settings.samplesRemoved = true;
    }
    st.courses = st.courses.map((c) => {
      const nc = Object.assign(m.newCourse(), c);
      const oi = OLD_COLORS.indexOf(String(nc.color).toLowerCase());
      if (oi >= 0) nc.color = m.COLORS[oi];
      nc.grade = Object.assign({ components: [], target: 85 }, c.grade || {});
      if (nc.kind !== 'record') nc.kind = 'full';
      if (nc.outcome && !(nc.outcome.type in m.OUTCOMES)) nc.outcome = null;
      if (nc.outcome) {
        const g = nc.outcome.grade;
        nc.outcome = Object.assign({ date: '', note: '', exemptCredits: true }, nc.outcome,
          { grade: g === '' || g == null || !isFinite(Number(g)) ? null : Number(g) });
      }
      ['links', 'exams', 'schedule', 'notebook', 'categories'].forEach((k) => { if (!Array.isArray(nc[k])) nc[k] = []; });
      nc.categories = nc.categories.map((cat) => ({
        id: cat.id || u.uid(), name: cat.name || 'קטגוריה',
        items: (cat.items || []).map((it) => Object.assign(m.newItem(''), it, { tags: Array.isArray(it.tags) ? it.tags : [] })),
      }));
      return nc;
    });
    // v3: points ledger. The first time, everything already done becomes the starting line (earns nothing).
    if (CT.game) CT.game.ensure(st);
    // v4: adhkar settings and daily counters (st.adhkar). Nothing to convert: it starts empty.
    if (CT.adhkar) { CT.adhkar.ensure(st); CT.adhkar.prune(st); }
    st.version = Math.max(m.VERSION, Number(data.version) || 0);
    return st;
  };

  CT.model = m;
})(window.CT);
