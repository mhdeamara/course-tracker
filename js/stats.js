/* stats.js — derived numbers: progress, urgent tasks, pace, study time, streak. Pure functions. */
(function (CT) {
  'use strict';
  const u = CT.u;
  const st = {};

  const allItems = (course) => course.categories.flatMap((cat) => cat.items.map((item) => ({ item, cat, course })));

  st.progress = (items) => {
    const total = items.length;
    const done = items.filter((i) => i.status === 'done').length;
    return { total, done, open: total - done, pct: total ? Math.round((done / total) * 100) : 0 };
  };
  st.courseProgress = (course) => st.progress(course.categories.flatMap((c) => c.items));

  /** Earliest not-done item that has a due date (overdue included). */
  st.nextTask = (course) => allItems(course)
    .filter((x) => x.item.status !== 'done' && x.item.due)
    .sort((a, b) => a.item.due.localeCompare(b.item.due))[0] || null;

  /** Items due within `days` days or overdue, across active courses. */
  st.urgent = (courses, days = 7) => {
    const limit = u.addDays(u.today(), days);
    return courses.flatMap(allItems)
      .filter((x) => x.item.status !== 'done' && x.item.due && x.item.due <= limit)
      .sort((a, b) => a.item.due.localeCompare(b.item.due));
  };

  st.nextExam = (course) => (course.exams || [])
    .filter((e) => e.date && e.date >= u.today())
    .sort((a, b) => a.date.localeCompare(b.date))[0] || null;

  st.upcomingExams = (courses) => courses.flatMap((c) => (c.exams || [])
    .filter((e) => e.date && e.date >= u.today()).map((e) => ({ exam: e, course: c })))
    .sort((a, b) => a.exam.date.localeCompare(b.exam.date));

  /** Items completed since `sinceIso` (date string). */
  st.completedSince = (courses, sinceIso) => courses.flatMap(allItems)
    .filter((x) => x.item.status === 'done' && x.item.completedAt && u.isoDate(new Date(x.item.completedAt)) >= sinceIso);

  /** Pace vs. semester calendar: expected % = share of semester elapsed. */
  st.pace = (course, semester) => {
    const p = st.courseProgress(course);
    if (!semester || !semester.start || !semester.end) return { ...p, expected: null, lag: null };
    const total = u.daysBetween(semester.start, semester.end);
    const elapsed = u.clamp(u.daysBetween(semester.start, u.today()), 0, total);
    const expected = total > 0 ? Math.round((elapsed / total) * 100) : 0;
    const daysLeft = Math.max(0, total - elapsed);
    const weeksLeft = daysLeft / 7;
    return {
      ...p, expected, lag: expected - p.pct, daysLeft,
      perWeekNeeded: weeksLeft > 0 ? p.open / weeksLeft : null,
    };
  };

  /** Items done per week over the last 14 days. */
  st.recentRate = (courses) => st.completedSince(courses, u.addDays(u.today(), -13)).length / 2;

  /* ---------- study log ---------- */
  st.minutesByDay = (log, fromIso, days = 7) => {
    const out = [];
    for (let i = 0; i < days; i++) {
      const d = u.addDays(fromIso, i);
      const entries = log.filter((e) => e.date === d);
      const byCourse = {};
      entries.forEach((e) => { byCourse[e.courseId] = (byCourse[e.courseId] || 0) + e.minutes; });
      out.push({ date: d, total: u.sum(entries, (e) => e.minutes), byCourse });
    }
    return out;
  };

  /** Consecutive days (ending today, or yesterday if nothing yet today) with study time or a completed item. */
  st.streak = (state) => {
    const active = new Set(state.studyLog.filter((e) => e.minutes > 0).map((e) => e.date));
    state.courses.forEach((c) => c.categories.forEach((cat) => cat.items.forEach((i) => {
      if (i.completedAt) active.add(u.isoDate(new Date(i.completedAt)));
    })));
    let d = u.today();
    if (!active.has(d)) d = u.addDays(d, -1);
    let n = 0;
    while (active.has(d)) { n++; d = u.addDays(d, -1); }
    return { days: n, today: active.has(u.today()) };
  };

  /**
   * "הפעולה הבאה": open items ranked by what makes most sense now, each with a short reason. Order:
   * overdue (oldest first) → due today / tomorrow → already started → due this week → marked "צריך לחזור" →
   * the next item in line in each category (courses that are furthest behind first). At most `limit`, no repeats.
   */
  st.nextActions = (courses, today = u.today(), limit = 5) => {
    const open = courses.flatMap(allItems).filter((x) => x.item.status !== 'done');
    const out = [];
    const seen = new Set();
    // reason: Hebrew text (kept for older callers); why: { k, p } i18n key for the translated screens
    const add = (list, reason, why) => list.forEach((x) => {
      if (out.length >= limit || seen.has(x.item.id)) return;
      seen.add(x.item.id);
      const w = typeof why === 'function' ? why(x) : why;
      out.push(Object.assign({ reason: typeof reason === 'function' ? reason(x) : reason, why: w }, x));
    });
    const byDue = (a, b) => a.item.due.localeCompare(b.item.due);
    const dated = open.filter((x) => x.item.due).sort(byDue);
    const inDays = (x) => u.daysBetween(today, x.item.due);
    add(dated.filter((x) => x.item.due < today), (x) => (inDays(x) === -1 ? 'היה להגשה אתמול — עוד אפשר לסגור' : 'באיחור — כדאי לסגור ראשון'),
      (x) => ({ k: inDays(x) === -1 ? 'why.yesterday' : 'why.overdue', p: {} }));
    add(dated.filter((x) => inDays(x) >= 0 && inDays(x) <= 1), (x) => (inDays(x) === 0 ? 'להגשה היום' : 'להגשה מחר'),
      (x) => ({ k: inDays(x) === 0 ? 'why.today' : 'why.tomorrow', p: {} }));
    add(open.filter((x) => x.item.status === 'doing'), 'כבר התחלת — קל להמשיך', { k: 'why.doing', p: {} });
    add(dated.filter((x) => inDays(x) >= 2 && inDays(x) <= 7), (x) => `דדליין בעוד ${inDays(x)} ימים`, (x) => ({ k: 'why.week', p: { n: inDays(x) } }));
    add(open.filter((x) => x.item.status === 'review'), 'סימנת שצריך לחזור לזה', { k: 'why.review', p: {} });
    const behind = courses.slice().sort((a, b) => st.courseProgress(a).pct - st.courseProgress(b).pct);
    behind.forEach((course) => course.categories.forEach((cat) => {
      const first = cat.items.find((i) => i.status !== 'done');
      if (first) add([{ item: first, cat, course }], `הבא בתור ב${cat.name}`, { k: 'why.next', p: { cat: cat.name } });
    }));
    return out;
  };

  /**
   * "היום" → upcoming: open dated items (overdue + the next `days` days) and exams (the next `examDays` days) in one
   * list, sorted by date. Each thing appears once: an item that is the same event as an exam of its course (same date,
   * one title contains the other — e.g. a Moodle "בוחן" next to the course's own quiz date) is shown only as the exam.
   */
  st.agenda = (courses, today = u.today(), days = 7, examDays = 21) => {
    const limit = u.addDays(today, days), exLimit = u.addDays(today, examDays);
    const norm = (s) => String(s || '').replace(/["'׳״`\s.\-–—_()]/g, '').toLowerCase();
    const out = [];
    const seen = new Set();
    const exams = courses.flatMap((c) => (c.exams || []).filter((e) => e.date && e.date >= today && e.date <= exLimit).map((e) => ({ kind: 'exam', date: e.date, exam: e, course: c })));
    const sameAsExam = (x) => exams.some((e) => e.course.id === x.course.id && e.date === x.item.due
      && norm(e.exam.label) && (norm(x.item.title).includes(norm(e.exam.label)) || norm(e.exam.label).includes(norm(x.item.title))));
    courses.flatMap(allItems)
      .filter((x) => x.item.status !== 'done' && x.item.due && x.item.due <= limit && !sameAsExam(x))
      .forEach((x) => { if (!seen.has(x.item.id)) { seen.add(x.item.id); out.push(Object.assign({ kind: 'item', date: x.item.due }, x)); } });
    exams.forEach((e) => {
      const key = `${e.course.id}|${e.exam.id || ''}|${e.exam.label || ''}|${e.date}`;
      if (!seen.has(key)) { seen.add(key); out.push(e); }
    });
    return out.sort((a, b) => a.date.localeCompare(b.date) || (a.kind === b.kind ? 0 : a.kind === 'exam' ? -1 : 1));
  };

  st.allItems = allItems;
  CT.stats = st;
})(window.CT);
