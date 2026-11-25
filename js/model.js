/* model.js — data shapes, defaults, templates, sample data and migrations. No DOM here. */
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

  m.COLORS = ['#4f7cff', '#e0663d', '#2f9e74', '#a35bd6', '#d6a21c', '#d1477a', '#2b9bb5', '#7a8a3a', '#8b6a4e', '#5b6cc9'];

  m.SLOT_TYPES = { lecture: 'הרצאה', tutorial: 'תרגול', lab: 'מעבדה', other: 'אחר' };

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

  m.newSemester = (extra = {}) => Object.assign({ id: u.uid(), name: 'סמסטר חדש', start: '', end: '' }, extra);

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
    },
    meta: { createdAt: new Date().toISOString(), updatedAt: null },
  });

  /* ---------- first-run data: real semester ו courses + clearly-marked sample courses ---------- */
  m.initialData = () => {
    const st = m.emptyState();
    const sem = m.newSemester({ name: 'סמסטר ו — חורף תשפ״ז', start: '2026-10-18', end: '2027-01-22' });
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

    // Sample courses (marked sample:true, removable with one click)
    const today = u.today();
    const daysAgo = (n) => new Date(Date.now() - n * 86400000).toISOString();
    const markDone = (items, n, startAgo = 30) => items.slice(0, n).forEach((it, i) => {
      it.status = 'done'; it.completedAt = daysAgo(Math.max(0, startAgo - i * Math.ceil(startAgo / n)));
    });

    const sig = m.newCourse({
      name: 'אותות ומערכות (דוגמה)', number: '00440131', semesterId: sem.id, color: '#4f7cff', sample: true,
      staff: 'מרצה: פרופ׳ דוגמה · מתרגל: מר דוגמה', credits: 4,
      description: 'קורס לדוגמה — אפשר למחוק בלחיצה אחת מההגדרות או מהדשבורד.',
      links: [{ label: 'Moodle', url: 'https://moodle.technion.ac.il' }],
      exams: [{ id: u.uid(), label: 'מועד א׳', date: u.addDays(today, 23) }, { id: u.uid(), label: 'מועד ב׳', date: u.addDays(today, 60) }],
    });
    m.applyTemplate(sig, m.DEFAULT_TEMPLATE);
    const [lec, tut, hw] = sig.categories;
    markDone(lec.items, 6, 35); markDone(tut.items, 5, 32); markDone(hw.items, 2, 20);
    tut.items[2].note = 'התמרת פורייה של מלבן: $\\mathcal{F}\\{\\mathrm{rect}(t)\\} = \\mathrm{sinc}(f)$\nלחזור על תכונת ההזזה.';
    tut.items[2].flag = true;
    tut.items[5].status = 'review'; tut.items[5].note = 'קונבולוציה גרפית — לא הבנתי עד הסוף את ההיפוך.';
    lec.items[6].status = 'doing';
    hw.items[2].due = u.addDays(today, 3); hw.items[2].status = 'doing'; hw.items[2].tags = ['הגשה'];
    hw.items[3].due = u.addDays(today, 17);
    sig.grade = {
      target: 85,
      components: [
        { id: u.uid(), name: 'שיעורי בית', weight: 10, score: 92, mustPass: false, passMin: 55, bonus: false },
        { id: u.uid(), name: 'בוחן אמצע', weight: 20, score: 78, mustPass: false, passMin: 55, bonus: false },
        { id: u.uid(), name: 'מבחן סופי', weight: 70, score: null, mustPass: true, passMin: 55, bonus: false },
        { id: u.uid(), name: 'תרגיל רשות (בונוס)', weight: 3, score: null, mustPass: false, passMin: 0, bonus: true },
      ],
    };
    sig.schedule = [
      { id: u.uid(), day: 0, start: '10:30', end: '12:30', type: 'lecture', room: 'מאייר 280' },
      { id: u.uid(), day: 2, start: '14:30', end: '16:30', type: 'tutorial', room: 'מאייר 351' },
    ];
    sig.notebook = [
      { id: u.uid(), title: 'התמרת פורייה', body: '$$X(f) = \\int_{-\\infty}^{\\infty} x(t)\\, e^{-j2\\pi f t}\\, dt$$' },
      { id: u.uid(), title: 'משפט פרסבל', body: 'אנרגיה נשמרת בין התחומים:\n$$\\int |x(t)|^2 dt = \\int |X(f)|^2 df$$' },
    ];

    const alg = m.newCourse({
      name: 'אלגברה 2מ (דוגמה)', number: '01040168', semesterId: sem.id, color: '#2f9e74', sample: true, credits: 3.5,
      exams: [{ id: u.uid(), label: 'מועד א׳', date: u.addDays(today, 30) }],
    });
    m.applyTemplate(alg, [
      { name: 'הרצאות', count: 13, pattern: 'הרצאה {n}' },
      { name: 'תרגולים', count: 13, pattern: 'תרגול {n}' },
      { name: 'תרגילי בית', count: 6, pattern: 'תרגיל בית {n}' },
    ]);
    markDone(alg.categories[0].items, 3, 25); markDone(alg.categories[1].items, 2, 20);
    alg.categories[2].items[1].due = u.addDays(today, -1);
    alg.categories[2].items[2].due = u.addDays(today, 6);
    alg.schedule = [{ id: u.uid(), day: 1, start: '08:30', end: '10:30', type: 'lecture', room: 'אולמן 200' }];

    const lab = m.newCourse({ name: 'מעבדה 1א (דוגמה)', semesterId: sem.id, color: '#e0663d', sample: true, credits: 1.5 });
    lab.categories = m.labCategories(6);
    markDone(lab.categories[0].items, 3, 28);
    markDone(lab.categories[1].items, 2, 14);
    lab.categories[1].items[2].due = u.addDays(today, 2);
    lab.schedule = [{ id: u.uid(), day: 3, start: '13:30', end: '17:30', type: 'lab', room: 'מאייר 4xx' }];

    st.courses.push(sig, alg, lab);

    // a few study-log entries so the stats page is not empty
    [[sig, 1, 50], [sig, 2, 75], [alg, 2, 40], [lab, 4, 90], [sig, 5, 25]].forEach(([c, ago, min]) => {
      st.studyLog.push({ id: u.uid(), courseId: c.id, date: u.addDays(today, -ago), minutes: min, sample: true });
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
    st.studyLog = Array.isArray(st.studyLog) ? st.studyLog : [];
    st.courses = st.courses.map((c) => {
      const nc = Object.assign(m.newCourse(), c);
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
