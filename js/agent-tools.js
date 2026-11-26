/* agent-tools.js — what the AI chat can READ from your data. Pure functions over the app state, no DOM, no network.
 * They run in the browser: the server only relays the model's tool requests, it never sees your data unless a tool
 * result is sent back to the model as part of the conversation.
 *
 * This version is read-only. There is no tool here that changes, deletes or exports anything, and none that touches
 * settings, the Moodle link, accounts or keys.
 *
 * The tool names and input schemas must match CHAT_TOOLS in supabase/functions/ai/handler.ts (tests check both).
 * Tested in Node: node tests/agent-tools.test.js */
(function (root) {
  'use strict';
  const T = {};
  const MAX_RESULT_CHARS = 12000;
  const STATUS = { todo: 'לא התחלתי', doing: 'בתהליך', done: 'הושלם', review: 'צריך לחזור' };
  const OUTCOME = { graded: 'הושלם עם ציון', pass: 'עובר', exempt: 'פטור', failed: 'נכשל', withdrawn: 'נטש / ביטל' };
  const TERMS = { winter: 'חורף', spring: 'אביב', summer: 'קיץ' };
  const SLOT = { lecture: 'הרצאה', tutorial: 'תרגול', lab: 'מעבדה', other: 'אחר' };
  const DAYS = ['ראשון', 'שני', 'שלישי', 'רביעי', 'חמישי', 'שישי', 'שבת'];

  /** Hebrew labels for the "what the assistant did" chips. */
  T.LABELS = {
    get_overview: 'קרא סקירה כללית',
    list_courses: 'קרא את רשימת הקורסים',
    get_course: 'קרא פרטי קורס',
    list_items: 'קרא מטלות ותאריכים',
    get_gpa: 'קרא ממוצע ונקודות זכות',
    get_schedule: 'קרא את מערכת השעות',
    search: 'חיפש בנתונים',
  };

  const isoOk = (s) => typeof s === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(s);
  const addDays = (iso, n) => { const d = new Date(`${iso}T12:00:00Z`); d.setUTCDate(d.getUTCDate() + n); return d.toISOString().slice(0, 10); };
  const norm = (s) => String(s == null ? '' : s).toLowerCase().replace(/[֑-ׇ"'״׳`.\-_/\\()]/g, '').replace(/\s+/g, ' ').trim();
  const clip = (s, n) => { const t = String(s == null ? '' : s); return t.length > n ? `${t.slice(0, n)}…` : t; };
  const num = (v) => (v === '' || v == null || !isFinite(Number(v)) ? null : Number(v));
  const r2 = (x) => (typeof x === 'number' && isFinite(x) ? Math.round(x * 100) / 100 : null);

  const semOf = (st, c) => (st.semesters || []).find((s) => s.id === c.semesterId) || null;
  const semLabel = (s) => (s ? (s.name || `${TERMS[s.term] || ''} ${s.year || ''}`.trim()) : '');
  const activeSem = (st) => (st.semesters || []).find((s) => s.id === (st.settings && st.settings.activeSemesterId)) || null;
  const items = (c) => (c.categories || []).flatMap((cat) => (cat.items || []).map((it) => ({ it, cat, c })));
  const progress = (c) => {
    const all = items(c);
    const done = all.filter((x) => x.it.status === 'done').length;
    return { done, total: all.length, pct: all.length ? Math.round((done / all.length) * 100) : 0 };
  };
  const courseStatus = (c) => (c.outcome && c.outcome.type ? (OUTCOME[c.outcome.type] || c.outcome.type) : 'בלימוד');
  const itemOut = (x, withNote) => {
    const o = { course: x.c.name, category: x.cat.name, title: x.it.title, status: STATUS[x.it.status] || x.it.status };
    if (x.it.due) o.due = x.it.due;
    if (x.it.flag) o.starred = true;
    if (withNote && x.it.note) o.note = clip(x.it.note, 300);
    return o;
  };
  const courseBrief = (st, c, today) => {
    const p = progress(c);
    const next = items(c).filter((x) => x.it.status !== 'done' && x.it.due).sort((a, b) => a.it.due.localeCompare(b.it.due))[0];
    const exam = (c.exams || []).filter((e) => e.date && e.date >= today).sort((a, b) => a.date.localeCompare(b.date))[0];
    const o = { id: c.id, name: c.name, number: c.number || '', credits: num(c.credits), semester: semLabel(semOf(st, c)), status: courseStatus(c) };
    if (c.outcome && c.outcome.type) o.final_grade = num(c.outcome.grade);
    if (c.kind !== 'record' && p.total) o.progress = `${p.done}/${p.total} (${p.pct}%)`;
    if (next) o.next_due = { title: next.it.title, due: next.it.due };
    if (exam) o.next_exam = { label: exam.label || 'מבחן', date: exam.date };
    return o;
  };

  /** Find one course by id, number or (part of the) name. */
  T.findCourse = (st, q) => {
    const all = st.courses || [];
    const s = String(q == null ? '' : q).trim();
    if (!s) return { error: 'חסר שם או מספר קורס' };
    const byId = all.find((c) => c.id === s);
    if (byId) return { course: byId };
    const digits = s.replace(/\D/g, '');
    if (digits.length >= 5) {
      const byNum = all.filter((c) => String(c.number || '').replace(/\D/g, '').replace(/^0+/, '') === digits.replace(/^0+/, ''));
      if (byNum.length) return { course: byNum.sort((a, b) => (a.outcome ? 1 : 0) - (b.outcome ? 1 : 0))[0] };
    }
    const n = norm(s);
    const exact = all.filter((c) => norm(c.name) === n);
    if (exact.length === 1) return { course: exact[0] };
    const part = all.filter((c) => norm(c.name).includes(n) || (n.length >= 3 && n.includes(norm(c.name)) && norm(c.name).length >= 3));
    if (part.length === 1) return { course: part[0] };
    if (part.length > 1) return { error: 'יותר מקורס אחד מתאים', candidates: part.slice(0, 10).map((c) => `${c.name}${c.number ? ` (${c.number})` : ''}`) };
    return { error: 'לא נמצא קורס כזה', candidates: all.slice(0, 30).map((c) => c.name) };
  };

  /* ---------- the tools ---------- */
  const tools = {};

  tools.get_overview = (st, input, ctx) => {
    const today = ctx.today;
    const sem = activeSem(st);
    const active = (st.courses || []).filter((c) => !(c.outcome && c.outcome.type) && !c.archived && c.kind !== 'record');
    const open = active.flatMap(items).filter((x) => x.it.status !== 'done');
    const overdue = open.filter((x) => x.it.due && x.it.due < today).sort((a, b) => a.it.due.localeCompare(b.it.due));
    const week = open.filter((x) => x.it.due && x.it.due >= today && x.it.due <= addDays(today, 7)).sort((a, b) => a.it.due.localeCompare(b.it.due));
    const exams = active.flatMap((c) => (c.exams || []).filter((e) => e.date && e.date >= today).map((e) => ({ course: c.name, label: e.label || 'מבחן', date: e.date })))
      .sort((a, b) => a.date.localeCompare(b.date)).slice(0, 8);
    return {
      today, weekday: DAYS[new Date(`${today}T12:00:00Z`).getUTCDay()],
      current_semester: sem ? { name: semLabel(sem), start: sem.start || '', end: sem.end || '', exams_start: sem.examStart || '' } : null,
      active_courses: active.map((c) => courseBrief(st, c, today)),
      overdue: overdue.slice(0, 20).map((x) => itemOut(x)),
      due_next_7_days: week.slice(0, 30).map((x) => itemOut(x)),
      starred_for_review: open.filter((x) => x.it.flag).length,
      upcoming_exams: exams,
    };
  };

  tools.list_courses = (st, input, ctx) => {
    const which = (input && input.which) || 'current';
    const sem = activeSem(st);
    let list = st.courses || [];
    if (which === 'current') list = list.filter((c) => !(c.outcome && c.outcome.type) && !c.archived);
    else if (which === 'finished') list = list.filter((c) => c.outcome && c.outcome.type);
    else if (which === 'current_semester') list = list.filter((c) => sem && c.semesterId === sem.id);
    return { which, count: list.length, courses: list.map((c) => courseBrief(st, c, ctx.today)) };
  };

  tools.get_course = (st, input, ctx) => {
    const f = T.findCourse(st, input && input.course);
    if (f.error) return f;
    const c = f.course;
    const out = courseBrief(st, c, ctx.today);
    if (c.staff) out.staff = clip(c.staff, 300);
    if (c.description) out.description = clip(c.description, 500);
    out.categories = (c.categories || []).map((cat) => ({
      name: cat.name,
      items: (cat.items || []).map((it) => itemOut({ it, cat, c }, true)).map((o) => { delete o.course; delete o.category; return o; }),
    }));
    out.exams = (c.exams || []).filter((e) => e.date || e.label).map((e) => ({ label: e.label || 'מבחן', date: e.date || '' }));
    out.schedule = (c.schedule || []).map((s) => ({ type: SLOT[s.type] || s.type || '', day: DAYS[s.day] || '', start: s.start || '', end: s.end || '', room: s.room || '' }));
    const comps = (c.grade && c.grade.components) || [];
    if (comps.length) {
      out.grade_components = comps.map((g) => ({ name: g.name, weight: num(g.weight), score: num(g.score), must_pass: !!g.mustPass, bonus: !!g.bonus }));
      out.grade_target = num(c.grade.target);
    }
    if ((c.notebook || []).length) out.notebook_titles = c.notebook.slice(0, 40).map((n) => clip(n.title, 80)).filter(Boolean);
    return out;
  };

  tools.list_items = (st, input, ctx) => {
    const i = input || {};
    const status = ['open', 'done', 'all'].includes(i.status) ? i.status : 'open';
    const from = isoOk(i.from) ? i.from : null;
    const to = isoOk(i.to) ? i.to : null;
    let pool = st.courses || [];
    if (i.course) {
      const f = T.findCourse(st, i.course);
      if (f.error) return f;
      pool = [f.course];
    } else pool = pool.filter((c) => !(c.outcome && c.outcome.type) && !c.archived);
    let list = pool.flatMap(items);
    if (status === 'open') list = list.filter((x) => x.it.status !== 'done');
    if (status === 'done') list = list.filter((x) => x.it.status === 'done');
    if (i.starred_only) list = list.filter((x) => x.it.flag);
    if (from || to || i.with_due_date_only) list = list.filter((x) => x.it.due && (!from || x.it.due >= from) && (!to || x.it.due <= to));
    list.sort((a, b) => (a.it.due || '9999').localeCompare(b.it.due || '9999'));
    const limit = Math.min(Math.max(Number(i.limit) || 40, 1), 100);
    return { status, from, to, total: list.length, shown: Math.min(limit, list.length), items: list.slice(0, limit).map((x) => itemOut(x)) };
  };

  tools.get_gpa = (st) => {
    const G = root.CT && root.CT.gpa;
    if (!G) return { error: 'חישוב הממוצע לא זמין' };
    const res = G.compute(st.courses || [], st.semesters || [], (st.settings && st.settings.gpa) || {});
    const pending = (st.courses || []).filter((c) => !(c.outcome && c.outcome.type) && !c.gpaExclude);
    return {
      gpa: r2(res.avg), credits_in_average: r2(res.avgCredits), credits_earned: r2(res.earned), finished_courses: res.count,
      per_semester: res.perSemester.map((p) => ({ semester: semLabel(p.semester), average: r2(p.avg), credits_earned: r2(p.earned), courses: p.count })),
      cumulative_trend: res.trend.map((t) => ({ semester: semLabel(t.semester), cumulative: r2(t.cumulative) })),
      courses_in_progress: pending.length, credits_in_progress: r2(pending.reduce((s, c) => s + (num(c.credits) || 0), 0)),
      rules: { repeated_course: res.rules.repeat, failed_counts_in_average: res.rules.failedInAvg, pass_grade: res.rules.passGrade },
      note: 'מחושב לפי הציונים הסופיים שהוזנו באתר ולפי הכללים שבהגדרות הממוצע',
    };
  };

  tools.get_schedule = (st) => {
    const sem = activeSem(st);
    const list = (st.courses || []).filter((c) => !(c.outcome && c.outcome.type) && !c.archived)
      .flatMap((c) => (c.schedule || []).map((s) => ({ course: c.name, type: SLOT[s.type] || s.type || '', dayIndex: Number(s.day), start: s.start || '', end: s.end || '', room: s.room || '' })))
      .sort((a, b) => (a.dayIndex - b.dayIndex) || a.start.localeCompare(b.start))
      .map((x) => ({ day: DAYS[x.dayIndex] || '', start: x.start, end: x.end, course: x.course, type: x.type, room: x.room }));
    return { semester: semLabel(sem), slots: list };
  };

  tools.search = (st, input) => {
    const q = norm(input && input.query);
    if (q.length < 2) return { error: 'צריך לפחות 2 תווים לחיפוש' };
    const hits = [];
    (st.courses || []).forEach((c) => {
      if (norm(c.name).includes(q) || norm(c.number).includes(q)) hits.push({ kind: 'קורס', course: c.name, text: c.name });
      items(c).forEach((x) => {
        if (norm(x.it.title).includes(q)) hits.push({ kind: 'פריט', course: c.name, text: x.it.title, status: STATUS[x.it.status], due: x.it.due || undefined });
        else if (norm(x.it.note).includes(q)) hits.push({ kind: 'הערה', course: c.name, item: x.it.title, text: clip(x.it.note, 300) });
      });
      (c.notebook || []).forEach((n) => {
        if (norm(n.title).includes(q) || norm(n.body).includes(q)) hits.push({ kind: 'מחברת', course: c.name, text: clip(n.title, 80), body: clip(n.body, 300) });
      });
    });
    return { query: input.query, total: hits.length, results: hits.slice(0, 30) };
  };

  T.NAMES = Object.keys(tools);

  /** Run one tool. Returns { content: string (JSON), isError }. Never throws. */
  T.run = (state, name, input, ctx) => {
    const fn = Object.prototype.hasOwnProperty.call(tools, name) ? tools[name] : null;
    if (!fn) return { content: JSON.stringify({ error: `אין כלי בשם ${name}` }), isError: true };
    const c = Object.assign({ today: new Date().toISOString().slice(0, 10) }, ctx || {});
    let out;
    try { out = fn(state || {}, input && typeof input === 'object' ? input : {}, c); } catch (e) { return { content: JSON.stringify({ error: 'שגיאה בקריאת הנתונים' }), isError: true }; }
    let text = JSON.stringify(out);
    if (text.length > MAX_RESULT_CHARS) {
      const full = text;
      let n = MAX_RESULT_CHARS - 300;
      do { // escaping inside JSON makes the cut text longer, so shrink until it fits
        text = JSON.stringify({ truncated: true, note: 'התוצאה ארוכה מדי ונחתכה. אפשר לצמצם (קורס אחד, טווח תאריכים).', partial: full.slice(0, n) });
        n = Math.floor(n * 0.8);
      } while (text.length > MAX_RESULT_CHARS);
    }
    return { content: text, isError: !!(out && out.error) };
  };

  root.CT = root.CT || {};
  root.CT.agentTools = T;
})(typeof window !== 'undefined' ? window : globalThis);
