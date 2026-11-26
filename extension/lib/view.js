/* view.js — what the popup shows and what the badge counts, from a snapshot (see ext-snapshot.js) and the clock.
 * Pure: no DOM, no chrome.* — unit-tested in tests/ext.test.js. Works on an old snapshot too: dates are compared
 * with today's date, so the badge and the "overdue" list are right even if the site wasn't opened since yesterday. */
(function (root) {
  'use strict';
  const pad = (n) => String(n).padStart(2, '0');
  const iso = (d) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
  const parse = (s) => { const [y, m, d] = String(s).split('-').map(Number); return new Date(y, m - 1, d); };
  const addDays = (s, n) => { const d = parse(s); d.setDate(d.getDate() + n); return iso(d); };
  const daysBetween = (a, b) => Math.round((parse(b) - parse(a)) / 86400000);
  const toMin = (t) => { const m = /^(\d{1,2}):(\d{2})$/.exec(String(t || '')); return m ? Number(m[1]) * 60 + Number(m[2]) : null; };
  const inside = (min, w) => {
    if (!Array.isArray(w) || w[0] == null || w[1] == null) return false;
    const [a, b] = w;
    return a <= b ? min >= a && min < b : min >= a || min < b;
  };
  /** The points system's day starts at 04:00 (same as game.js). */
  const gameDay = (now) => iso(new Date(now.getTime() - 4 * 3600e3));

  const V = {};
  V.iso = iso;
  V.addDays = addDays;

  /** "לפני 3 דק׳" style age of the snapshot. */
  V.ago = (atIso, now = new Date()) => {
    const t = Date.parse(atIso);
    if (!isFinite(t)) return 'אף פעם';
    const min = Math.max(0, Math.floor((now.getTime() - t) / 60000));
    if (min < 1) return 'עכשיו';
    if (min < 60) return `לפני ${min} דק׳`;
    const h = Math.round(min / 60);
    if (h < 24) return h === 1 ? 'לפני שעה' : `לפני ${h} שעות`;
    const d = Math.round(h / 24);
    return d === 1 ? 'אתמול' : `לפני ${d} ימים`;
  };

  V.build = (snap, now = new Date()) => {
    if (!snap || snap.v !== 1) return { empty: true, badge: 0 };
    const today = iso(now);
    const fresh = snap.today === today; // things only true "as of" the snapshot day (done today, goal, next action)
    const course = new Map((snap.courses || []).map((c) => [c.id, c]));
    const withCourse = (x) => Object.assign({}, x, { course: course.get(x.c) || { n: '', col: '' } });
    const items = (snap.items || []).map(withCourse);
    const open = items.filter((x) => x.s !== 'done');
    const week = addDays(today, 7);

    const dueToday = items.filter((x) => x.due === today && (x.s !== 'done' || fresh))
      .sort((a, b) => (a.s === 'done') - (b.s === 'done'));
    const overdue = open.filter((x) => x.due < today);
    const soon = open.filter((x) => x.due > today && x.due <= week).map((x) => Object.assign(x, { inDays: daysBetween(today, x.due) }));
    const exams = (snap.exams || []).filter((e) => e.d >= today).map((e) => Object.assign(withCourse(e), { inDays: daysBetween(today, e.d) })).slice(0, 5);
    const classes = (snap.slots || []).filter((s) => s.day === now.getDay()).map(withCourse)
      .sort((a, b) => (toMin(a.from) || 0) - (toMin(b.from) || 0));
    const openIds = new Set(open.map((x) => x.id));
    const next = (snap.next || []).filter((x) => x.s !== 'done' && (!(snap.items || []).some((y) => y.id === x.id) || openIds.has(x.id))).map(withCourse);

    let game = null;
    if (snap.game) {
      const same = snap.game.day === gameDay(now);
      const g = snap.game.goal || {};
      const di = same ? g.doneItems || 0 : 0, dm = same ? g.doneMinutes || 0 : 0;
      const pct = Math.min(100, Math.round(Math.max(g.items ? di / g.items : 0, g.minutes ? dm / g.minutes : 0) * 100));
      game = { level: snap.game.level, name: snap.game.name, pct: snap.game.pct, balance: snap.game.balance, todayXP: same ? snap.game.todayXP : 0,
        streak: snap.game.streak, goal: { items: g.items, minutes: g.minutes, doneItems: di, doneMinutes: dm, pct, met: same ? !!g.met : false }, stale: !same };
    }

    return {
      empty: false, fresh, today,
      dueToday, overdue, soon, exams, classes, next, game,
      adhkar: V.adhkarDue(snap, now),
      badge: overdue.length + dueToday.filter((x) => x.s !== 'done').length,
    };
  };

  /** 'm' | 'e' | null: the adhkar window we're in now, if it isn't known to be done today. */
  V.adhkarDue = (snap, now = new Date()) => {
    const a = snap && snap.adhkar;
    if (!a) return null;
    const today = iso(now);
    const w = a.windows && a.windows[today];
    if (!w) return null;
    const min = now.getHours() * 60 + now.getMinutes();
    const p = inside(min, w.m) ? 'm' : inside(min, w.e) ? 'e' : null;
    if (!p) return null;
    if (snap.today === today && a.done && a.done[p]) return null;
    return p;
  };

  V.badgeText = (n) => (n > 0 ? (n > 99 ? '99+' : String(n)) : '');

  root.CTView = V;
})(typeof self !== 'undefined' ? self : globalThis);
