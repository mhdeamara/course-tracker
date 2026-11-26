/* game.js — points (XP) ledger and levels. Pure logic, no DOM.
 *
 * The ledger (state.game.ledger) is the only source of truth: totals, today's points and the level are
 * always computed from it, never stored. Every award has a key (e.g. "item:<id>"). A key is awarded at most
 * once while it is "active"; un-checking an item appends a reversal ("rev") that cancels it exactly, so
 * toggling V back and forth never earns twice. Undo restores the whole state, ledger included.
 * Things that existed before the points system started are listed in state.game.base and never earn.
 * A day runs from 04:00 to 04:00, so late-night work counts for the day it belongs to.
 */
(function (CT) {
  'use strict';
  const u = CT.u;
  const g = {};

  g.VERSION = 1;
  g.DAY_START_HOUR = 4;

  /** Default values; state.game.cfg holds only the user's overrides. */
  g.DEFAULTS = {
    enabled: true,
    pts: {
      easy: 6, normal: 12, hard: 20, // finishing an item, by difficulty
      onTime: 5, // done on or before its due date
      early: 5, earlyDays: 2, // extra when done at least `earlyDays` days before the due date
      per10min: 4, // study time (timer or manual log): points per 10 minutes
      note: 3, noteMinChars: 20, // first note of at least `noteMinChars` characters on an item
      review: 5, // closing something that was marked "צריך לחזור"
      course: 100, // finishing a course (graded / pass / exemption)
      start: 3, // "רק 5 דקות": starting is what counts (once per item per day)
      sub: 2, // each subtask checked off
    },
    caps: { item: 400, study: 60, note: 15, start: 15, sub: 30 }, // most points per day for each kind
    streak: [[3, 1.1], [7, 1.2], [14, 1.3], [30, 1.5]], // [days in a row, multiplier] for finished items
  };

  /** Ledger entry types that count as earned XP (later stages add more: goals, badges…). */
  g.EARN_TYPES = new Set(['item', 'review', 'study', 'note', 'course', 'start', 'sub', 'rev']);

  g.LEVEL_NAMES = ['צעדים ראשונים', 'בתנופה', 'התמדה', 'קצב יציב', 'מיקוד', 'שיטתיות', 'עומק', 'שליטה', 'מצוינות', 'מומחיות', 'מאסטר', 'אגדה'];

  const isObj = (x) => x && typeof x === 'object' && !Array.isArray(x);
  const merge = (a, b) => {
    const out = Array.isArray(a) ? a.slice() : Object.assign({}, a);
    if (!isObj(b)) return out;
    Object.keys(b).forEach((k) => { out[k] = isObj(a[k]) ? merge(a[k], b[k]) : b[k]; });
    return out;
  };

  /** The day an instant belongs to (04:00 → 04:00), as YYYY-MM-DD. */
  g.dayKey = (when = new Date()) => u.isoDate(new Date(new Date(when).getTime() - g.DAY_START_HOUR * 3600e3));

  g.cfg = (st) => merge(g.DEFAULTS, (st.game && st.game.cfg) || {});

  /* ---------- difficulty ---------- */
  const HARD_RE = /שיעורי\s*בית|ש[״"']ב|תרגיל\s*בית|תרגילי\s*בית|עבוד|פרויקט|פרוייקט|מעבד|ניסוי|דו[״"']?ח|הכנה|בוחן|hw|homework|lab|project/i;
  /** 1 = easy, 2 = normal, 3 = hard. Manual choice (item.diff) wins; otherwise homework / labs / projects are hard. */
  g.difficulty = (item, cat) => {
    const d = Number(item && item.diff);
    if (d === 1 || d === 2 || d === 3) return d;
    return HARD_RE.test(`${(cat && cat.name) || ''} ${(item && item.title) || ''}`) ? 3 : 2;
  };
  g.DIFF_LABELS = { 1: 'קל', 2: 'רגיל', 3: 'קשה' };

  /* ---------- levels ---------- */
  /** XP needed to reach level n (1-based): steps of 150, 225, 300, … */
  g.levelStart = (n) => (n <= 1 ? 0 : 150 * (n - 1) + 37.5 * (n - 1) * (n - 2));
  g.levelName = (n) => (n <= g.LEVEL_NAMES.length ? g.LEVEL_NAMES[n - 1] : `${g.LEVEL_NAMES[g.LEVEL_NAMES.length - 1]} ${n - g.LEVEL_NAMES.length + 1}`);
  g.levelOf = (xp) => {
    let n = 1;
    while (g.levelStart(n + 1) <= xp) n++;
    const from = g.levelStart(n), to = g.levelStart(n + 1);
    return { n, name: g.levelName(n), from, to, into: xp - from, need: to - from, pct: Math.round(((xp - from) / (to - from)) * 100) };
  };

  /* ---------- setup / migration ---------- */
  /** Keys of everything that would earn right now — used once, so existing progress is the starting line. */
  function currentKeys(st, cfg) {
    const keys = [];
    st.courses.forEach((c) => {
      if (eligibleCourse(c)) keys.push('course:' + c.id);
      c.categories.forEach((cat) => cat.items.forEach((it) => {
        if (it.status === 'done') keys.push('item:' + it.id);
        if (it.status === 'done' && it.fromReview) keys.push('review:' + it.id);
        if (noteOk(it, cfg)) keys.push('note:' + it.id);
        (it.subs || []).forEach((sb) => { if (sb.done) keys.push(`sub:${it.id}:${sb.id}`); });
      }));
    });
    (st.studyLog || []).forEach((e) => { if (e.id) keys.push('study:' + e.id); });
    return keys;
  }

  /** Makes sure state.game exists and is well-formed. The first time, everything already done becomes the baseline. */
  g.ensure = (st, now = new Date()) => {
    const fresh = !isObj(st.game);
    const gm = fresh ? {} : st.game;
    gm.v = g.VERSION;
    if (!Array.isArray(gm.ledger)) gm.ledger = [];
    if (!Array.isArray(gm.base)) gm.base = [];
    if (!isObj(gm.cfg)) gm.cfg = {};
    if (!Array.isArray(gm.starts)) gm.starts = []; // "רק 5 דקות" starts: { id, itemId, d, label }
    if (!gm.since) gm.since = new Date(now).toISOString();
    st.game = gm;
    if (fresh) gm.base = currentKeys(st, g.cfg(st));
    return gm;
  };

  /* ---------- derived numbers ---------- */
  /** Last entry per key (what state each award is in) + keys ever seen. */
  function keyIndex(ledger) {
    const last = new Map(), net = new Map();
    ledger.forEach((e) => { last.set(e.k, e); net.set(e.k, (net.get(e.k) || 0) + e.p); });
    return { last, net };
  }

  /** Earned XP so far (awards minus reversals), never below 0. */
  g.earned = (st) => Math.max(0, u.sum(((st.game && st.game.ledger) || []).filter((e) => g.EARN_TYPES.has(e.t)), (e) => e.p));

  /** XP the level is based on: the highest the earned total has ever been, so a level is never lost. */
  g.levelXP = (st) => {
    let run = 0, peak = 0;
    ((st.game && st.game.ledger) || []).forEach((e) => {
      if (!g.EARN_TYPES.has(e.t)) return;
      run += e.p; if (run > peak) peak = run;
    });
    return peak;
  };

  /** Points earned on a given day (net of that day's reversals). */
  g.dayXP = (st, day = g.dayKey()) => Math.max(0, u.sum(((st.game && st.game.ledger) || []).filter((e) => e.d === day && g.EARN_TYPES.has(e.t)), (e) => e.p));

  /** Days in a row (ending today, or yesterday if nothing yet today) with at least one point earned. */
  g.streak = (st, today = g.dayKey()) => {
    const days = new Set();
    ((st.game && st.game.ledger) || []).forEach((e) => { if (e.p > 0 && e.t !== 'rev') days.add(e.d); });
    let d = today;
    if (!days.has(d)) d = u.addDays(d, -1);
    let n = 0;
    while (days.has(d)) { n++; d = u.addDays(d, -1); }
    return { days: n, today: days.has(today) };
  };

  g.multiplier = (cfg, streakDays) => {
    let m = 1;
    (cfg.streak || []).forEach(([days, x]) => { if (streakDays >= days) m = x; });
    return m;
  };

  g.summary = (st, now = new Date()) => {
    const today = g.dayKey(now);
    const xp = g.levelXP(st);
    return { earned: g.earned(st), today: g.dayXP(st, today), level: g.levelOf(xp), levelXP: xp, streak: g.streak(st, today) };
  };

  /* ---------- awarding ---------- */
  const eligibleCourse = (c) => !!(c && c.outcome && ['graded', 'pass', 'exempt'].includes(c.outcome.type));
  const noteOk = (it, cfg) => String(it.note || '').trim().length >= cfg.pts.noteMinChars;

  /** Positive points already given today for a cap group. */
  const usedToday = (ledger, type, day) => u.sum(ledger.filter((e) => e.t === type && e.d === day && e.p > 0), (e) => e.p);

  /** Points for finishing an item, with the reasons shown to the user. */
  g.itemPoints = (cfg, item, cat, day, streakDays) => {
    const diff = g.difficulty(item, cat);
    let p = cfg.pts[['easy', 'normal', 'hard'][diff - 1]];
    const why = [g.DIFF_LABELS[diff]];
    if (item.due && day <= item.due) {
      p += cfg.pts.onTime; why.push('בזמן');
      if (u.daysBetween(day, item.due) >= cfg.pts.earlyDays) { p += cfg.pts.early; why.push('מוקדם'); }
    }
    const mult = g.multiplier(cfg, streakDays);
    if (mult > 1) { p = Math.round(p * mult); why.push(`רצף ×${mult}`); }
    return { p, why };
  };

  /**
   * Brings the ledger in line with the state: awards what was newly done, reverses what was undone.
   * Returns the entries it added (for feedback). Safe to call after every change; does nothing twice.
   */
  g.reconcile = (st, now = new Date()) => {
    if (!isObj(st.game)) g.ensure(st, now);
    const cfg = g.cfg(st);
    const gm = st.game;
    if (cfg.enabled === false) return [];
    const L = gm.ledger;
    const base = new Set(gm.base);
    const { last, net } = keyIndex(L);
    const at = new Date(now).toISOString();
    const day = g.dayKey(now);
    const added = [];
    const isActive = (k) => last.has(k) && last.get(k).t !== 'rev';
    const push = (e) => { const x = Object.assign({ id: u.uid(), at, d: day }, e); L.push(x); last.set(x.k, x); net.set(x.k, (net.get(x.k) || 0) + x.p); added.push(x); };
    const capped = (type, raw) => {
      const cap = cfg.caps[type];
      if (!(cap >= 0)) return { p: raw, capped: false };
      const room = Math.max(0, cap - usedToday(L, type, day));
      return { p: Math.min(raw, room), capped: raw > room };
    };
    const award = (k, type, raw, why, label) => {
      const c = capped(type, raw);
      push({ k, t: type, p: c.p, why: c.capped ? why.concat('תקרה יומית') : why, label });
    };
    const reverse = (k, label) => push({ k, t: 'rev', p: -(net.get(k) || 0), why: ['בוטל'], label });
    // Desired state: which keys should be active now.
    const want = new Map(); // key → { type, make() }
    let streakDays = null;
    const streakNow = () => {
      if (streakDays == null) { const s = g.streak(st, day); streakDays = s.today ? s.days : s.days + 1; }
      return streakDays;
    };

    st.courses.forEach((c) => {
      if (eligibleCourse(c)) want.set('course:' + c.id, () => award('course:' + c.id, 'course', cfg.pts.course, ['סיום קורס'], c.name));
      c.categories.forEach((cat) => cat.items.forEach((it) => {
        if (it.status === 'done') {
          want.set('item:' + it.id, () => { const r = g.itemPoints(cfg, it, cat, day, streakNow()); award('item:' + it.id, 'item', r.p, r.why, it.title); });
          if (it.fromReview) want.set('review:' + it.id, () => award('review:' + it.id, 'review', cfg.pts.review, ['סגרת "צריך לחזור"'], it.title));
        }
        if (noteOk(it, cfg)) want.set('note:' + it.id, () => award('note:' + it.id, 'note', cfg.pts.note, ['הערה'], it.title));
        (it.subs || []).forEach((sb) => {
          const k = `sub:${it.id}:${sb.id}`;
          if (sb.done) want.set(k, () => award(k, 'sub', cfg.pts.sub, ['תת-משימה'], sb.t || it.title));
        });
      }));
    });
    (gm.starts || []).forEach((x) => { // one per item per day, however many times it is started
      const k = `start:${x.itemId}:${x.d}`;
      if (!want.has(k)) want.set(k, () => award(k, 'start', cfg.pts.start, ['רק 5 דקות'], x.label));
    });
    (st.studyLog || []).forEach((e) => {
      if (!e.id || !(e.minutes > 0)) return;
      want.set('study:' + e.id, () => award('study:' + e.id, 'study', Math.floor((e.minutes * cfg.pts.per10min) / 10), [u.fmtMinutes(e.minutes)], 'זמן לימוד'));
    });

    // Reverse what is active but no longer true (notes are never taken back once written).
    last.forEach((e, k) => {
      if (e.t !== 'rev' && !want.has(k) && !k.startsWith('note:')) reverse(k, e.label);
    });
    // Award what is true but not active yet. Baseline keys never earn; a note earns once, ever.
    want.forEach((make, k) => {
      if (base.has(k) || isActive(k)) return;
      if (k.startsWith('note:') && last.has(k)) return;
      make();
    });
    return added;
  };

  /** reconcile() + level before/after, for feedback. Returns null when nothing changed. */
  g.sync = (st, now = new Date()) => {
    const before = g.levelOf(g.levelXP(st)).n;
    const added = g.reconcile(st, now);
    if (!added.length) return null;
    return { added, levelBefore: before, level: g.levelOf(g.levelXP(st)) };
  };

  CT.game = g;
})(window.CT);
