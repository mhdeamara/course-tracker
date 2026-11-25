/* model.js — data shapes, defaults, templates and migrations. No DOM here. */
(function (CT) {
  'use strict';
  const u = CT.u;
  const m = {};

  m.VERSION = 1;

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
  }, extra);

  m.newSemester = (extra = {}) => Object.assign({ id: u.uid(), name: 'סמסטר חדש', start: '', end: '', examStart: '' }, extra);

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
    },
    meta: { createdAt: new Date().toISOString(), updatedAt: null },
  });

  /* ---------- first-run data: the semester ו courses with a standard structure ---------- */
  m.initialData = () => {
    const st = m.emptyState();
    const sem = m.newSemester({ name: 'סמסטר ו — חורף תשפ״ז', ...m.WINTER_5787 });
    st.semesters.push(sem);
    st.settings.activeSemesterId = sem.id;

    // Real courses (empty, standard structure — edit to match reality)
    const real = ['אימות פורמלי', 'הספק', 'מבוא למבני נתונים ואלגוריתמים', 'מעבדה 1ב', 'מעגלים אלקטרונים', 'פיזיקה קוונטית', 'שיטות הערכה'];
    real.forEach((name, i) => {
      const c = m.newCourse({ name, semesterId: sem.id, color: m.COLORS[i % m.COLORS.length] });
      if (name.startsWith('מעבדה')) c.categories = m.labCategories(6);
      else m.applyTemplate(c, m.DEFAULT_TEMPLATE);
      st.courses.push(c);
    });

    return st;
  };

  /* ---------- migrations / validation of loaded or imported data ---------- */
  m.migrate = (data) => {
    if (!data || typeof data !== 'object' || !Array.isArray(data.courses)) throw new Error('קובץ לא תקין: חסרה רשימת קורסים');
    const base = m.emptyState();
    const st = Object.assign(base, data);
    st.settings = Object.assign(m.emptyState().settings, data.settings || {});
    st.meta = Object.assign(m.emptyState().meta, data.meta || {});
    st.semesters = Array.isArray(st.semesters) ? st.semesters : [];
    // replace the placeholder dates from the first version with the official ones
    st.semesters.forEach((s) => {
      if (s.start === OLD_GUESS.start && s.end === OLD_GUESS.end) Object.assign(s, m.WINTER_5787);
    });
    st.studyLog = Array.isArray(st.studyLog) ? st.studyLog : [];
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
      ['links', 'exams', 'schedule', 'notebook', 'categories'].forEach((k) => { if (!Array.isArray(nc[k])) nc[k] = []; });
      nc.categories = nc.categories.map((cat) => ({
        id: cat.id || u.uid(), name: cat.name || 'קטגוריה',
        items: (cat.items || []).map((it) => Object.assign(m.newItem(''), it, { tags: Array.isArray(it.tags) ? it.tags : [] })),
      }));
      return nc;
    });
    st.version = m.VERSION;
    return st;
  };

  CT.model = m;
})(window.CT);
