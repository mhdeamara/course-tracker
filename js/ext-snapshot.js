/* ext-snapshot.js — the small, read-only picture of the data that the Chrome extension shows. Pure (no DOM).
 * Used by the site (js/ext-bridge.js hands it to the extension while the site is open — "local mode") and by the
 * extension itself when it reads the user's own cloud row ("connected mode"). A byte-identical copy lives in
 * extension/lib/ (tools/ext-sync.mjs copies it; tests/ext.test.js fails if the copies drift).
 *
 * Only what the popup needs goes in: course names/colors, item titles/dates/status, exams, class times, points
 * summary, adhkar windows. Never notes, links, iCal/Moodle data, sign-in tokens or AI settings. */
(function (CT) {
  'use strict';
  const u = CT.u;
  const X = {};
  X.V = 1;
  const MAX_ITEMS = 300;

  /** Same rule as the dashboard: active semester (or none), not archived, not a past "record" course, not finished. */
  X.activeCourses = (state) => {
    const st = state || {};
    const act = st.settings && st.settings.activeSemesterId;
    const known = act && (st.semesters || []).some((x) => x.id === act);
    return (st.courses || []).filter((c) => !c.archived && c.kind !== 'record'
      && (!known || !c.semesterId || c.semesterId === act)
      && !(c.outcome && c.outcome.type));
  };

  const str = (s, n = 160) => String(s == null ? '' : s).slice(0, n);

  X.build = (state, now = new Date()) => {
    const today = u.isoDate(now);
    const courses = X.activeCourses(state);
    const horizon = u.addDays(today, 30);
    const items = [];
    courses.forEach((c) => (c.categories || []).forEach((cat) => (cat.items || []).forEach((it) => {
      if (!it || !it.due) return;
      const done = it.status === 'done';
      // open items up to 30 days ahead (overdue included); done ones only when due today (shown ticked)
      if (done ? it.due !== today : it.due > horizon) return;
      items.push({ id: str(it.id, 40), t: str(it.title), c: str(c.id, 40), cat: str(cat.name, 60), due: it.due, s: it.status || 'todo' });
    })));
    items.sort((a, b) => a.due.localeCompare(b.due));
    const next = CT.stats ? CT.stats.nextActions(courses, today, 3).map((x) => ({ id: str(x.item.id, 40), t: str(x.item.title), c: str(x.course.id, 40), due: x.item.due || '', s: x.item.status || 'todo', why: str(x.reason, 80) })) : [];
    const examLimit = u.addDays(today, 180);
    const exams = courses.flatMap((c) => (c.exams || []).filter((e) => e && e.date && e.date >= today && e.date <= examLimit)
      .map((e) => ({ c: str(c.id, 40), l: str(e.label || 'מבחן', 60), d: e.date })))
      .sort((a, b) => a.d.localeCompare(b.d)).slice(0, 12);
    const slots = courses.flatMap((c) => (c.schedule || []).filter((s) => s && s.start && s.end)
      .map((s) => ({ c: str(c.id, 40), day: Number(s.day), from: str(s.start, 5), to: str(s.end, 5), ty: str(s.type, 12), room: str(s.room, 40) })));

    let game = null;
    const G = CT.game;
    if (G && state && state.game && G.cfg(state).enabled !== false) {
      const cfg = G.cfg(state), day = G.dayKey(now), sum = G.summary(state, now);
      const ds = G.dayStats(state.game.ledger || [], day);
      game = {
        day, level: sum.level.n, name: sum.level.name, pct: sum.level.pct, todayXP: sum.today, balance: G.balance(state),
        streak: sum.streak.days,
        goal: { items: cfg.goals.day.items, minutes: cfg.goals.day.minutes, doneItems: ds.items, doneMinutes: ds.minutes, met: G.goalMet(ds, cfg.goals.day) },
      };
    }

    let adhkar = null;
    const A = CT.adhkar;
    if (A && state && A.on(state)) {
      const cfg = A.cfg(state);
      const windows = {};
      for (let d = 0; d < 3; d++) { // windows depend on the date (prayer times): today and the next two days
        const day = u.addDays(today, d), at = u.parseDate(day);
        at.setHours(12, 0, 0, 0);
        const w = A.windows(cfg, at);
        windows[day] = { m: w.m, e: w.e };
      }
      adhkar = { notify: cfg.startToast !== false, windows, done: { m: A.isDone(state, 'm', today), e: A.isDone(state, 'e', today) } };
    }

    return {
      v: X.V, at: new Date(now).toISOString(), today,
      courses: courses.map((c) => ({ id: str(c.id, 40), n: str(c.name, 80), col: str(c.color, 20) })),
      items: items.slice(0, MAX_ITEMS), next, exams, slots, game, adhkar,
    };
  };

  CT.extSnapshot = X;
})(window.CT);
