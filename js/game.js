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
    extras: true, // goals, daily challenge and badges
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
      adk: 5, // adhkar morning / evening completed — only if linked in the adhkar settings (off by default)
      goalDay: 15, goalWeek: 50, // reaching the daily / weekly goal
      challenge: 10, // the daily challenge
      badge: 10, // each new badge
    },
    caps: { item: 400, study: 60, note: 15, start: 15, sub: 30 },
    /** A goal is reached with items OR minutes; both together = a perfect day / week. */
    goals: { day: { items: 2, minutes: 45 }, week: { items: 10, minutes: 300 } },
    /**
     * Deductions for a day below the minimum — OFF until turned on. They lower the spendable balance only
     * (never the level, never below 0), never apply to the first `graceDays` days, paused days or frozen days,
     * and are capped per day and per week. Only the last `lookback` days are checked, so a long absence
     * doesn't pile up.
     */
    penalty: { enabled: false, minItems: 1, minMinutes: 25, amount: 15, capDay: 15, capWeek: 45, graceDays: 7, freezesPerMonth: 2, lookback: 7 },
    reminders: 'low', // in-site nudges: 'off' | 'low' (once a day) | 'normal' (every ~2 hours while open, up to 3 a day) // most points per day for each kind
    streak: [[3, 1.1], [7, 1.2], [14, 1.3], [30, 1.5]], // [days in a row, multiplier] for finished items
  };

  /** Ledger entry types that count as earned XP (later stages add more: goals, badges…). */
  g.EARN_TYPES = new Set(['item', 'review', 'study', 'note', 'course', 'start', 'sub', 'goal', 'chal', 'badge', 'rev', 'adk']);
  /** Keys that follow the state and are taken back when it changes. Notes, badges and redemptions stay. */
  const REVERSIBLE = /^(item|review|study|course|start|sub):/;

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
    if (!Array.isArray(gm.prizes)) gm.prizes = []; // personal prizes: { id, name, cost }
    if (!isObj(gm.look)) gm.look = {}; // chosen in-site rewards: { accent, frame, title, sound }
    if (!Array.isArray(gm.starts)) gm.starts = [];
    if (!Array.isArray(gm.pauses)) gm.pauses = []; // { id, from, to ('' = still paused), reason }
    if (!Array.isArray(gm.freezes)) gm.freezes = []; // days a streak freeze covered // "רק 5 דקות" starts: { id, itemId, d, label }
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
    const gm = st.game || {};
    const neutral = (d) => g.pausedOn(gm, d) || (gm.freezes || []).includes(d);
    let d = today;
    if (!days.has(d)) d = u.addDays(d, -1);
    let n = 0;
    for (let guard = 0; guard < 800 && (days.has(d) || neutral(d)); guard++) { if (days.has(d)) n++; d = u.addDays(d, -1); }
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
    const extra = { df: diff };
    if (item.due && day > item.due) extra.lt = u.daysBetween(item.due, day);
    if (item.due && day <= item.due) {
      extra.ot = 1;
      p += cfg.pts.onTime; why.push('בזמן');
      if (u.daysBetween(day, item.due) >= cfg.pts.earlyDays) { p += cfg.pts.early; why.push('מוקדם'); }
    }
    const mult = g.multiplier(cfg, streakDays);
    if (mult > 1) { p = Math.round(p * mult); why.push(`רצף ×${mult}`); }
    return { p, why, extra };
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
    const penalties = g.settlePenalties(st, cfg, now); // past days only; final entries
    const base = new Set(gm.base);
    const { last, net } = keyIndex(L);
    const at = new Date(now).toISOString();
    const day = g.dayKey(now);
    const added = penalties.slice();
    const isActive = (k) => last.has(k) && last.get(k).t !== 'rev';
    const sem = (st.settings && st.settings.activeSemesterId) || '';
    const push = (e) => { const x = Object.assign({ id: u.uid(), at, d: day, sem }, e); L.push(x); last.set(x.k, x); net.set(x.k, (net.get(x.k) || 0) + x.p); added.push(x); };
    const capped = (type, raw) => {
      const cap = cfg.caps[type];
      if (!(cap >= 0)) return { p: raw, capped: false };
      const room = Math.max(0, cap - usedToday(L, type, day));
      return { p: Math.min(raw, room), capped: raw > room };
    };
    const award = (k, type, raw, why, label, extra) => {
      const c = capped(type, raw);
      push(Object.assign({ k, t: type, p: c.p, why: c.capped ? why.concat('תקרה יומית') : why, label }, extra || {}));
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
      if (eligibleCourse(c)) want.set('course:' + c.id, () => award('course:' + c.id, 'course', cfg.pts.course, ['סיום קורס'], c.name, { cid: c.id }));
      c.categories.forEach((cat) => cat.items.forEach((it) => {
        if (it.status === 'done') {
          want.set('item:' + it.id, () => { const r = g.itemPoints(cfg, it, cat, day, streakNow()); award('item:' + it.id, 'item', r.p, r.why, it.title, Object.assign({ cat: cat.name }, r.extra)); });
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
      want.set('study:' + e.id, () => award('study:' + e.id, 'study', Math.floor((e.minutes * cfg.pts.per10min) / 10), [u.fmtMinutes(e.minutes)], 'זמן לימוד', { m: e.minutes }));
    });

    // Adhkar: only when the user linked them (off by default), from that day on; never a deduction.
    if (CT.adhkar) CT.adhkar.pointKeys(st).forEach((x) => {
      want.set(x.k, () => award(x.k, 'adk', cfg.pts.adk, [x.p === 'm' ? 'أذكار الصباح' : 'أذكار المساء'], 'אזכרות'));
    });

    // Reverse what is active but no longer true (notes are never taken back once written).
    last.forEach((e, k) => {
      if (e.t !== 'rev' && !want.has(k) && REVERSIBLE.test(k)) reverse(k, e.label);
    });
    // Award what is true but not active yet. Baseline keys never earn; a note earns once, ever.
    want.forEach((make, k) => {
      if (base.has(k) || isActive(k)) return;
      if (k.startsWith('note:') && last.has(k)) return;
      make();
    });

    // Goals and the daily challenge: only today / this week are open; past days are settled.
    if (cfg.extras === false) return added;
    const flag = (k, on, type, pts, why, label) => {
      if (on && !isActive(k)) award(k, type, pts, why, label);
      else if (!on && isActive(k)) reverse(k, label);
    };
    const ds = g.dayStats(L, day), ws = g.weekStats(L, day);
    const G = cfg.goals;
    flag(`goal:d:${day}`, g.goalMet(ds, G.day), 'goal', cfg.pts.goalDay, ['יעד יומי'], 'יעד יומי');
    flag(`goal:w:${u.weekStart(day)}`, g.goalMet(ws, G.week), 'goal', cfg.pts.goalWeek, ['יעד שבועי'], 'יעד שבועי');
    const ch = g.challenge(day);
    flag(`chal:${day}`, ch.test(ds), 'chal', cfg.pts.challenge, ['אתגר יומי'], ch.name);

    // Badges: once earned, kept for good.
    const ctx = g.badgeContext(st, cfg);
    g.BADGES.forEach((b) => {
      const k = 'badge:' + b.id;
      if (!last.has(k) && b.test(ctx)) award(k, 'badge', cfg.pts.badge, ['הישג חדש'], b.name, { icon: b.icon });
    });
    return added;
  };

  /* ---------- pause, streak freezes, deductions ---------- */
  g.pausedOn = (gm, day) => (gm.pauses || []).some((x) => x.from <= day && (!x.to || day <= x.to));
  g.activePause = (gm, day = g.dayKey()) => (gm.pauses || []).find((x) => x.from <= day && (!x.to || day <= x.to)) || null;
  g.PAUSE_REASONS = { exams: 'תקופת מבחנים', sick: 'מחלה', vacation: 'חופשה', other: 'אחר' };

  /** The minimum for a day (items OR minutes). */
  g.minimumMet = (s, pen) => s.items >= pen.minItems || s.minutes >= pen.minMinutes;

  /**
   * Looks at each finished day not yet settled (up to yesterday): met the minimum → nothing; paused → nothing;
   * a freeze left this month → the freeze covers it; otherwise a capped deduction. Each day is settled once.
   */
  g.settlePenalties = (st, cfg, now = new Date()) => {
    const gm = st.game, pen = cfg.penalty || {};
    const today = g.dayKey(now), yesterday = u.addDays(today, -1);
    if (!pen.enabled || !gm.penaltyFrom) return [];
    const graceEnd = u.addDays(g.dayKey(gm.since), pen.graceDays || 0);
    let from = [gm.penaltyFrom, graceEnd, gm.penChecked ? u.addDays(gm.penChecked, 1) : '', u.addDays(today, -(pen.lookback || 7))].sort().pop();
    const out = [];
    for (let d = from; d <= yesterday; d = u.addDays(d, 1)) {
      if (g.pausedOn(gm, d) || g.minimumMet(g.dayStats(gm.ledger, d), pen)) continue;
      const month = d.slice(0, 7);
      if (gm.freezes.filter((x) => x.startsWith(month)).length < (pen.freezesPerMonth || 0)) { gm.freezes.push(d); continue; }
      const wk = u.weekStart(d);
      const weekUsed = -u.sum(gm.ledger.filter((e) => e.t === 'pen' && u.weekStart(e.d) === wk), (e) => e.p);
      const amt = Math.max(0, Math.min(pen.amount, pen.capDay, pen.capWeek - weekUsed, g.balance(st)));
      if (amt <= 0) continue;
      const e = { id: u.uid(), k: 'pen:' + d, t: 'pen', p: -amt, at: new Date(now).toISOString(), d, sem: (st.settings && st.settings.activeSemesterId) || '', why: ['מתחת למינימום היומי'], label: 'מינימום יומי' };
      gm.ledger.push(e);
      out.push(e);
    }
    if (yesterday >= from || !gm.penChecked) gm.penChecked = [gm.penChecked || '', yesterday].sort().pop();
    return out;
  };

  /** Turning deductions on never reaches back: the first day that can count is today. */
  g.setPenalties = (st, on, now = new Date()) => {
    const gm = g.ensure(st);
    gm.cfg.penalty = Object.assign({}, gm.cfg.penalty, { enabled: !!on });
    if (on) { gm.penaltyFrom = g.dayKey(now); gm.penChecked = u.addDays(g.dayKey(now), -1); } else delete gm.penaltyFrom;
  };
  /** Pause (exams / sickness / vacation): no deductions, the streak waits. `until` '' = until resumed. */
  g.pause = (st, reason, until = '', now = new Date()) => {
    const gm = g.ensure(st);
    gm.pauses.push({ id: u.uid(), from: g.dayKey(now), to: until || '', reason: reason || 'other' });
  };
  g.resume = (st, now = new Date()) => {
    const gm = g.ensure(st), today = g.dayKey(now);
    // a pause that started today is simply dropped; an older one ends yesterday
    gm.pauses = gm.pauses.filter((x) => !(x.from === today && (!x.to || x.to >= today)));
    gm.pauses.forEach((x) => { if (x.from < today && (!x.to || x.to >= today)) x.to = u.addDays(today, -1); });
  };

  /** Today, before the day ends: is the minimum still missing? (for the gentle "at risk" note) */
  g.atRisk = (st, now = new Date()) => {
    const gm = st.game, cfg = g.cfg(st), pen = cfg.penalty;
    const day = g.dayKey(now);
    if (!gm || cfg.enabled === false) return null;
    if (g.activePause(gm, day)) return null;
    const s = g.dayStats(gm.ledger, day);
    const streak = g.streak(st, day);
    const penOn = pen.enabled && gm.penaltyFrom && day >= gm.penaltyFrom;
    if (g.minimumMet(s, pen)) return null;
    if (!penOn && streak.days < 3) return null;
    const month = day.slice(0, 7);
    const freezesLeft = Math.max(0, (pen.freezesPerMonth || 0) - gm.freezes.filter((x) => x.startsWith(month)).length);
    return { penOn, streak: streak.days, freezesLeft, need: pen, s };
  };

  /* ---------- day / week numbers, goals, challenge ---------- */
  /** Award entries that still count (not reversed later). */
  g.activeEntries = (L) => {
    const last = new Map();
    L.forEach((e) => last.set(e.k, e));
    return L.filter((e) => e.t !== 'rev' && g.EARN_TYPES.has(e.t) && last.get(e.k) === e);
  };
  const statsOf = (entries) => ({
    items: entries.filter((e) => e.t === 'item').length,
    hard: entries.filter((e) => e.t === 'item' && e.df === 3).length,
    minutes: u.sum(entries.filter((e) => e.t === 'study'), (e) => e.m || 0),
    notes: entries.filter((e) => e.t === 'note').length,
    starts: entries.filter((e) => e.t === 'start').length,
    subs: entries.filter((e) => e.t === 'sub').length,
    reviews: entries.filter((e) => e.t === 'review').length,
    late: entries.filter((e) => e.t === 'item' && e.lt > 0).length,
    pomos: entries.filter((e) => e.t === 'study' && (e.m || 0) >= 20).length,
  });
  g.dayStats = (L, day) => statsOf(g.activeEntries(L).filter((e) => e.d === day));
  g.weekStats = (L, day) => {
    const from = u.weekStart(day), to = u.addDays(from, 6);
    return statsOf(g.activeEntries(L).filter((e) => e.d >= from && e.d <= to));
  };
  g.goalMet = (s, goal) => s.items >= goal.items || s.minutes >= goal.minutes;
  g.goalPerfect = (s, goal) => s.items >= goal.items && s.minutes >= goal.minutes;

  /** One small challenge per day, the same all day (picked from the date). */
  g.CHALLENGES = [
    { id: 'three', name: 'לסיים 3 פריטים היום', test: (s) => s.items >= 3 },
    { id: 'hard', name: 'לסיים פריט אחד קשה (ש״ב, מעבדה, פרויקט)', test: (s) => s.hard >= 1 },
    { id: 'study30', name: 'ללמוד 30 דקות', test: (s) => s.minutes >= 30 },
    { id: 'note', name: 'לכתוב הערה מסכמת על פריט', test: (s) => s.notes >= 1 },
    { id: 'start', name: 'להתחיל משהו ב"רק 5 דקות"', test: (s) => s.starts >= 1 },
    { id: 'subs', name: 'לסמן 3 תתי-משימות', test: (s) => s.subs >= 3 },
  ];
  g.challenge = (day) => {
    let h = 0;
    for (const ch of String(day)) h = (h * 31 + ch.charCodeAt(0)) % 9973;
    return g.CHALLENGES[h % g.CHALLENGES.length];
  };

  /* ---------- badges ---------- */
  /** Everything the badge rules look at, computed once from the ledger (and a little from the state). */
  g.badgeContext = (st, cfg) => {
    const L = st.game.ledger;
    const A = g.activeEntries(L);
    const byDay = new Map();
    A.forEach((e) => { if (!byDay.has(e.d)) byDay.set(e.d, []); byDay.get(e.d).push(e); });
    const perDay = [...byDay.entries()].map(([d, es]) => Object.assign({ d }, statsOf(es)));
    const weeks = new Map();
    A.forEach((e) => { const w = u.weekStart(e.d); if (!weeks.has(w)) weeks.set(w, []); weeks.get(w).push(e); });
    const perWeek = [...weeks.values()].map(statsOf);
    const days = [...new Set(L.filter((e) => e.p > 0 && e.t !== 'rev' && g.EARN_TYPES.has(e.t)).map((e) => e.d))].sort();
    let maxStreak = 0, run = 0, maxGap = 0;
    days.forEach((d, i) => {
      const gap = i ? u.daysBetween(days[i - 1], d) : 1;
      run = gap === 1 ? run + 1 : 1;
      if (gap > maxGap) maxGap = gap;
      maxStreak = Math.max(maxStreak, run);
    });
    const count = (t, f = () => true) => A.filter((e) => e.t === t && f(e)).length;
    return { st, cfg, A, perDay, perWeek, maxStreak, maxGap, count, earned: g.earned(st) };
  };

  const COURSES_OF = (st, semId) => st.courses.filter((c) => c.semesterId === semId && c.kind !== 'record' && !c.archived);
  /** All 25. `secret` ones show as "?" until earned. */
  g.BADGES = [
    { id: 'first', icon: '👣', name: 'צעד ראשון', desc: 'לסיים פריט ראשון', test: (c) => c.count('item') >= 1 },
    { id: 'tutorial', icon: '✏️', name: 'תרגול ראשון', desc: 'לסיים תרגול', test: (c) => c.count('item', (e) => /תרגול|tutorial/i.test(`${e.cat || ''} ${e.label || ''}`)) >= 1 },
    { id: 'streak3', icon: '🔥', name: '3 ימים ברצף', desc: '3 ימים רצופים עם נקודות', test: (c) => c.maxStreak >= 3 },
    { id: 'streak7', icon: '🔥', name: 'שבוע ברצף', desc: '7 ימים רצופים עם נקודות', test: (c) => c.maxStreak >= 7 },
    { id: 'streak14', icon: '🔥', name: 'שבועיים ברצף', desc: '14 ימים רצופים עם נקודות', test: (c) => c.maxStreak >= 14 },
    { id: 'streak30', icon: '🌋', name: 'חודש ברצף', desc: '30 ימים רצופים עם נקודות', test: (c) => c.maxStreak >= 30 },
    { id: 'clean-week', icon: '🧹', name: 'שבוע נקי', desc: 'שבוע עם 3 פריטים ומעלה, ואף אחד לא באיחור', test: (c) => c.perWeek.some((w) => w.items >= 3 && w.late === 0) },
    { id: 'ten-day', icon: '🔟', name: 'עשר ביום', desc: 'לסיים 10 פריטים ביום אחד', test: (c) => c.perDay.some((d) => d.items >= 10) },
    { id: 'hw5', icon: '📬', name: 'מגיש בזמן', desc: '5 פריטים קשים (ש״ב, מעבדות) שהושלמו בזמן', test: (c) => c.count('item', (e) => e.df === 3 && e.ot) >= 5 },
    { id: 'early', icon: '🐦', name: 'ציפור מוקדמת', desc: 'לסיים משהו יומיים ויותר לפני הדדליין', test: (c) => c.count('item', (e) => (e.why || []).includes('מוקדם')) >= 1 },
    { id: 'course', icon: '🎓', name: 'קורס מאחוריך', desc: 'לסיים קורס', test: (c) => c.count('course') >= 1 },
    { id: 'grade90', icon: '🏆', name: '90 ומעלה', desc: 'לסיים קורס עם ציון 90 ומעלה', test: (c) => c.A.some((e) => e.t === 'course' && c.st.courses.some((x) => x.id === e.cid && x.outcome && x.outcome.type === 'graded' && Number(x.outcome.grade) >= 90)) },
    { id: 'semester', icon: '🗓️', name: 'סמסטר סגור', desc: 'לסיים את כל הקורסים של סמסטר', test: (c) => (c.st.semesters || []).some((sm) => { const cs = COURSES_OF(c.st, sm.id); return cs.length > 0 && cs.every((x) => x.outcome && x.outcome.type) && c.A.some((e) => e.t === 'course' && cs.some((x) => x.id === e.cid)); }) },
    { id: 'long', icon: '⏳', name: 'סשן ארוך', desc: 'סשן לימוד של 90 דקות ומעלה', test: (c) => c.count('study', (e) => (e.m || 0) >= 90) >= 1 },
    { id: 'pomo5', icon: '🍅', name: 'צלף', desc: '5 סשנים של 20 דקות ומעלה ביום אחד', test: (c) => c.perDay.some((d) => d.pomos >= 5) },
    { id: 'back', icon: '🌱', name: 'חזרה לעניינים', desc: 'לחזור לצבור נקודות אחרי שבוע הפסקה', secret: true, test: (c) => c.maxGap >= 8 },
    { id: 'perfect-day', icon: '☀️', name: 'יום מושלם', desc: 'להשיג ביום אחד גם את יעד הפריטים וגם את יעד הזמן', test: (c) => c.perDay.some((d) => g.goalPerfect(d, c.cfg.goals.day)) },
    { id: 'perfect-week', icon: '🌈', name: 'שבוע מושלם', desc: 'להשיג בשבוע אחד גם את יעד הפריטים וגם את יעד הזמן', test: (c) => c.perWeek.some((w) => g.goalPerfect(w, c.cfg.goals.week)) },
    { id: 'five10', icon: '⏱️', name: 'רק 5 דקות ×10', desc: 'להתחיל 10 פעמים ב"רק 5 דקות"', test: (c) => c.count('start') >= 10 },
    { id: 'review-zero', icon: '🔁', name: 'אין מה לחזור', desc: 'לסגור "צריך לחזור" עד שלא נשאר אף אחד', test: (c) => c.count('review') >= 1 && !c.st.courses.some((x) => !x.archived && x.categories.some((k) => k.items.some((i) => i.status === 'review'))) },
    { id: 'writer', icon: '📝', name: 'כותב', desc: '10 הערות על פריטים', test: (c) => c.count('note') >= 10 },
    { id: 'split', icon: '🧩', name: 'פירקתי את זה', desc: 'לסמן תת-משימה ראשונה', test: (c) => c.count('sub') >= 1 },
    { id: 'night', icon: '🦉', name: 'ינשוף לילה', desc: 'לסיים פריט בין חצות ל-4 לפנות בוקר', secret: true, test: (c) => c.A.some((e) => e.t === 'item' && new Date(e.at).getHours() < 4) },
    { id: 'comeback', icon: '💪', name: 'קאמבק', desc: 'לסגור משהו שהיה באיחור של שבוע ויותר', secret: true, test: (c) => c.count('item', (e) => e.lt >= 7) >= 1 },
    { id: 'k1', icon: '💎', name: 'מועדון האלף', desc: 'לצבור 1,000 נקודות', test: (c) => c.earned >= 1000 },
  ];
  g.badgesEarned = (st) => {
    const out = new Map();
    ((st.game && st.game.ledger) || []).forEach((e) => { if (e.t === 'badge') out.set(e.k.slice(6), e); });
    return out;
  };

  /* ---------- seasons (one per semester) ---------- */
  /** XP earned while a semester was the active one. The level and badges carry over; the season starts at 0. */
  g.seasonXP = (st, semId) => Math.max(0, u.sum(((st.game && st.game.ledger) || []).filter((e) => e.sem === semId && g.EARN_TYPES.has(e.t)), (e) => e.p));

  /* ---------- spending: personal prizes ---------- */
  g.spent = (st) => -u.sum(((st.game && st.game.ledger) || []).filter((e) => e.t === 'redeem'), (e) => e.p);
  g.penalties = (st) => -u.sum(((st.game && st.game.ledger) || []).filter((e) => e.t === 'pen'), (e) => e.p);
  /** Points available to spend: earned − redeemed − deductions, never below 0. */
  g.balance = (st) => Math.max(0, g.earned(st) - g.spent(st) - g.penalties(st));
  /** Redeems a personal prize (logged for good, never refunded). Returns the entry, or null if not enough points. */
  g.redeem = (st, prizeId, now = new Date()) => {
    const pr = (st.game.prizes || []).find((x) => x.id === prizeId);
    if (!pr || !(pr.cost > 0) || g.balance(st) < pr.cost) return null;
    const e = { id: u.uid(), k: 'redeem:' + u.uid(), t: 'redeem', p: -pr.cost, at: new Date(now).toISOString(), d: g.dayKey(now), sem: (st.settings && st.settings.activeSemesterId) || '', why: ['מימוש פרס'], label: pr.name };
    st.game.ledger.push(e);
    return e;
  };

  /** Final entries (redemptions, deductions) survive an undo: copied from the state being left into the restored one. */
  g.FINAL_TYPES = new Set(['redeem', 'pen']);
  g.carry = (from, to) => {
    if (!from || !from.game || !to) return;
    const gm = g.ensure(to);
    const have = new Set(gm.ledger.map((e) => e.id));
    from.game.ledger.forEach((e) => { if (g.FINAL_TYPES.has(e.t) && !have.has(e.id)) gm.ledger.push(e); });
  };

  /* ---------- in-site rewards, unlocked by level (spending nothing) ---------- */
  g.UNLOCKS = [
    { id: 'accent:teal', kind: 'accent', value: 'teal', name: 'צבע: טורקיז', level: 2 },
    { id: 'frame:dashed', kind: 'frame', value: 'dashed', name: 'מסגרת: מקווקו', level: 3 },
    { id: 'sound:bell', kind: 'sound', value: 'bell', name: 'צליל: פעמון', level: 3 },
    { id: 'accent:rose', kind: 'accent', value: 'rose', name: 'צבע: ורוד', level: 4 },
    { id: 'frame:double', kind: 'frame', value: 'double', name: 'מסגרת: כפולה', level: 5 },
    { id: 'accent:amber', kind: 'accent', value: 'amber', name: 'צבע: ענבר', level: 6 },
    { id: 'sound:xylo', kind: 'sound', value: 'xylo', name: 'צליל: קסילופון', level: 6 },
    { id: 'frame:glow', kind: 'frame', value: 'glow', name: 'מסגרת: זוהרת', level: 7 },
    { id: 'accent:forest', kind: 'accent', value: 'forest', name: 'צבע: ירוק יער', level: 8 },
    { id: 'frame:gold', kind: 'frame', value: 'gold', name: 'מסגרת: זהב', level: 10 },
  ];
  /** Titles: the name of any level reached. */
  g.titles = (st) => {
    const n = g.levelOf(g.levelXP(st)).n;
    return Array.from({ length: n }, (_, i) => g.levelName(i + 1));
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
