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

  st.allItems = allItems;
  CT.stats = st;
})(window.CT);
