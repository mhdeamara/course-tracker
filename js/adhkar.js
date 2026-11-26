/* adhkar.js — أذكار: settings, time windows (set by hand, or from prayer times computed on this device with no
 * network request), daily counters and completion, and when a gentle reminder is due. No DOM here.
 * The texts live in data/adhkar.json. Nothing here touches the points system unless the user turns it on,
 * and a dhikr that was not done never costs anything. */
(function (CT) {
  'use strict';
  const u = CT.u;
  const A = {};

  A.DEFAULTS = {
    enabled: true,
    mode: 'auto', // 'auto' = from prayer times (morning: Fajr → Dhuhr, evening: Asr → Isha) · 'manual' = the hours below
    // (the hours below are also the fallback when the times can't be computed, e.g. 'custom' without coordinates)
    morning: { from: '04:30', to: '11:30' },
    evening: { from: '15:30', to: '20:30' },
    city: 'haifa', lat: null, lng: null, // lat/lng are used when city is 'custom'
    method: 'egypt', asr: 'shafii',
    startToast: true, // a gentle note when a window starts while the site is open
    general: { every: 30, quietFrom: '22:00', quietTo: '08:00' }, // a random general dhikr every N minutes (0 = off)
    sound: false, vibrate: true, font: 1, // reading screen: text size factor 0.8–2
    points: false, // link to the points system (off; never deductions)
  };
  A.FREQS = [0, 30, 60, 120, 180];
  A.PERIODS = { m: 'morning', e: 'evening', g: 'general' };

  /* Coordinates (degrees). Times use this device's clock and time zone. */
  A.CITIES = {
    haifa: { name: 'חיפה', lat: 32.794, lng: 34.989 },
    akka: { name: 'עכו', lat: 32.927, lng: 35.083 },
    nazareth: { name: 'נצרת', lat: 32.702, lng: 35.298 },
    sakhnin: { name: 'סח׳נין', lat: 32.864, lng: 35.297 },
    ummalfahm: { name: 'אום אל-פחם', lat: 32.519, lng: 35.153 },
    tayibe: { name: 'טייבה', lat: 32.266, lng: 35.009 },
    telaviv: { name: 'תל אביב-יפו', lat: 32.085, lng: 34.782 },
    jerusalem: { name: 'ירושלים', lat: 31.778, lng: 35.235 },
    beersheba: { name: 'באר שבע', lat: 31.252, lng: 34.791 },
    rahat: { name: 'רהט', lat: 31.393, lng: 34.754 },
    custom: { name: 'מיקום אחר (קו רוחב/אורך)', lat: null, lng: null },
  };
  /* Twilight angles. Isha either by angle or a fixed number of minutes after Maghrib. */
  A.METHODS = {
    egypt: { name: 'הרשות המצרית למדידות', fajr: 19.5, isha: 17.5 },
    mwl: { name: 'הליגה המוסלמית העולמית (MWL)', fajr: 18, isha: 17 },
    umm: { name: 'אום אל-קורא (מכה)', fajr: 18.5, ishaMin: 90 },
    karachi: { name: 'האוניברסיטה למדעים אסלאמיים, קראצ׳י', fajr: 18, isha: 18 },
    isna: { name: 'ISNA (צפון אמריקה)', fajr: 15, isha: 15 },
  };
  A.ASR = { shafii: { name: 'שאפעי, מאלכי, חנבלי (צל = גובה)', f: 1 }, hanafi: { name: 'חנפי (צל = פעמיים הגובה)', f: 2 } };

  const isObj = (x) => x && typeof x === 'object' && !Array.isArray(x);
  const merge = (a, b) => {
    const out = Array.isArray(a) ? a.slice() : Object.assign({}, a);
    Object.keys(b || {}).forEach((k) => { out[k] = isObj(a[k]) && isObj(b[k]) ? merge(a[k], b[k]) : b[k]; });
    return out;
  };

  /* ---------- state ---------- */
  /** st.adhkar = { cfg (only what differs from the defaults), days: { 'YYYY-MM-DD': { m|e|g: { c: {id: n}, done, at } } }, pointsFrom } */
  A.ensure = (st) => {
    if (!isObj(st.adhkar)) st.adhkar = {};
    const a = st.adhkar;
    if (!isObj(a.cfg)) a.cfg = {};
    if (!isObj(a.days)) a.days = {};
    if (typeof a.pointsFrom !== 'string') a.pointsFrom = '';
    return a;
  };
  A.cfg = (st) => merge(A.DEFAULTS, (st && st.adhkar && st.adhkar.cfg) || {});
  A.on = (st) => A.cfg(st).enabled !== false;
  /** Change one setting by path ("general.every"); keeps only overrides. */
  A.set = (st, path, value, today = u.today()) => {
    const a = A.ensure(st);
    const keys = path.split('.');
    let o = a.cfg;
    keys.slice(0, -1).forEach((k) => { if (!isObj(o[k])) o[k] = {}; o = o[k]; });
    o[keys[keys.length - 1]] = value;
    if (path === 'points') a.pointsFrom = value ? today : ''; // never retroactive
  };
  A.reset = (st) => { A.ensure(st).cfg = {}; st.adhkar.pointsFrom = ''; };

  /* ---------- time ---------- */
  A.dayKey = (now = new Date()) => u.isoDate(new Date(now));
  A.toMin = (hhmm) => { const m = /^(\d{1,2}):(\d{2})$/.exec(String(hhmm || '')); return m ? Math.min(1439, Number(m[1]) * 60 + Number(m[2])) : null; };
  A.fmt = (min) => (min == null || !isFinite(min) ? '—' : `${u.pad(Math.floor((((Math.round(min) % 1440) + 1440) % 1440) / 60))}:${u.pad(((Math.round(min) % 60) + 60) % 60)}`);
  const minutesOf = (d) => d.getHours() * 60 + d.getMinutes() + d.getSeconds() / 60;

  /* ---------- prayer times, computed locally (standard solar-position formulas) ---------- */
  const rad = (x) => (x * Math.PI) / 180, deg = (x) => (x * 180) / Math.PI;
  const fix = (a, b) => { const r = a - b * Math.floor(a / b); return r < 0 ? r + b : r; };
  const julian = (y, m, d) => {
    if (m <= 2) { y -= 1; m += 12; }
    const A_ = Math.floor(y / 100), B = 2 - A_ + Math.floor(A_ / 4);
    return Math.floor(365.25 * (y + 4716)) + Math.floor(30.6001 * (m + 1)) + d + B - 1524.5;
  };
  /** Sun declination (deg) and equation of time (hours) for a Julian day. */
  const sun = (jd) => {
    const D = jd - 2451545.0;
    const g = fix(357.529 + 0.98560028 * D, 360);
    const q = fix(280.459 + 0.98564736 * D, 360);
    const L = fix(q + 1.915 * Math.sin(rad(g)) + 0.020 * Math.sin(rad(2 * g)), 360);
    const e = 23.439 - 0.00000036 * D;
    const RA = fix(deg(Math.atan2(Math.cos(rad(e)) * Math.sin(rad(L)), Math.cos(rad(L)))) / 15, 24);
    return { decl: deg(Math.asin(Math.sin(rad(e)) * Math.sin(rad(L)))), eqt: q / 15 - RA };
  };
  /**
   * Prayer times for a date at lat/lng, in minutes after local midnight.
   * tz: hours from UTC (default: this device's offset on that date). Each time is refined once with the sun's
   * position at that moment. Returns null fields when the sun never reaches the angle (far north in summer).
   */
  A.prayerTimes = (date, lat, lng, methodKey = 'egypt', asrKey = 'shafii', tz) => {
    const M = A.METHODS[methodKey] || A.METHODS.egypt;
    const f = (A.ASR[asrKey] || A.ASR.shafii).f;
    const d = new Date(date);
    if (tz == null) tz = -new Date(d.getFullYear(), d.getMonth(), d.getDate(), 12).getTimezoneOffset() / 60;
    const jd0 = julian(d.getFullYear(), d.getMonth() + 1, d.getDate()) - lng / 360;
    const noonAt = (h) => { const s = sun(jd0 + h / 24); return 12 - s.eqt; };
    const timeAt = (h, angleFn, dir) => { // h = first guess (hours, local solar)
      const s = sun(jd0 + h / 24);
      const noon = 12 - s.eqt;
      const a = angleFn(s.decl);
      const c = (-Math.sin(rad(a)) - Math.sin(rad(s.decl)) * Math.sin(rad(lat))) / (Math.cos(rad(s.decl)) * Math.cos(rad(lat)));
      if (c < -1 || c > 1) return null;
      return noon + dir * deg(Math.acos(c)) / 15;
    };
    const refine = (guess, angleFn, dir) => { const t1 = timeAt(guess, angleFn, dir); return t1 == null ? null : timeAt(t1, angleFn, dir); };
    const asrAngle = (decl) => -deg(Math.atan(1 / (f + Math.tan(rad(Math.abs(lat - decl)))))); // altitude as a negative "depression"
    const solar = {
      fajr: refine(5, () => M.fajr, -1),
      sunrise: refine(6, () => 0.833, -1),
      dhuhr: noonAt(12),
      asr: refine(15, asrAngle, 1),
      maghrib: refine(18, () => 0.833, 1),
      isha: M.isha != null ? refine(19, () => M.isha, 1) : null,
    };
    if (M.ishaMin != null && solar.maghrib != null) solar.isha = solar.maghrib + M.ishaMin / 60;
    const out = {};
    Object.keys(solar).forEach((k) => { out[k] = solar[k] == null ? null : (solar[k] + tz - lng / 15) * 60; });
    out.dhuhr += 1; // a minute after the zenith, as timetables do
    return out;
  };

  /** Where the times are computed for (null when "custom" has no coordinates yet). */
  A.place = (cfg) => {
    if (cfg.city === 'custom') return isFinite(cfg.lat) && isFinite(cfg.lng) && cfg.lat !== null && cfg.lng !== null ? { lat: Number(cfg.lat), lng: Number(cfg.lng) } : null;
    return A.CITIES[cfg.city] || A.CITIES.haifa;
  };

  /** Today's windows in minutes: { m: [from, to], e: [from, to], auto, times }. Falls back to the hand-set hours. */
  A.windows = (cfg, now = new Date()) => {
    const manual = { m: [A.toMin(cfg.morning.from), A.toMin(cfg.morning.to)], e: [A.toMin(cfg.evening.from), A.toMin(cfg.evening.to)], auto: false };
    if (cfg.mode !== 'auto') return manual;
    const p = A.place(cfg);
    if (!p) return manual;
    const t = A.prayerTimes(now, p.lat, p.lng, cfg.method, cfg.asr);
    if ([t.fajr, t.dhuhr, t.asr, t.isha].some((x) => x == null)) return manual;
    return { m: [Math.round(t.fajr), Math.round(t.dhuhr)], e: [Math.round(t.asr), Math.round(t.isha)], auto: true, times: t };
  };
  const inside = (min, [a, b]) => (a == null || b == null ? false : a <= b ? min >= a && min < b : min >= a || min < b);
  /** 'm' | 'e' | null — which window the moment is in. */
  A.period = (cfg, now = new Date()) => {
    const w = A.windows(cfg, now), min = minutesOf(new Date(now));
    return inside(min, w.m) ? 'm' : inside(min, w.e) ? 'e' : null;
  };
  /** Quiet hours for the general reminders (can wrap past midnight). */
  A.quiet = (cfg, now = new Date()) => {
    const a = A.toMin(cfg.general.quietFrom), b = A.toMin(cfg.general.quietTo);
    if (a == null || b == null || a === b) return false;
    return inside(minutesOf(new Date(now)), [a, b]);
  };

  /* ---------- content helpers (doc = data/adhkar.json) ---------- */
  A.group = (doc, p) => {
    const g = doc && doc.groups && doc.groups[A.PERIODS[p] || p];
    if (!g) return [];
    const byId = new Map(doc.items.map((x) => [x.id, x]));
    return g.items.map((id) => byId.get(id)).filter(Boolean);
  };

  /* ---------- daily progress ---------- */
  A.rec = (st, day, p, create) => {
    const a = A.ensure(st);
    if (!a.days[day]) { if (!create) return null; a.days[day] = {}; }
    if (!a.days[day][p]) { if (!create) return null; a.days[day][p] = { c: {}, done: false, at: '' }; }
    return a.days[day][p];
  };
  /** One tap: +1 up to the target. Returns { n, full, groupDone }. Completing every item marks the group done. */
  A.tap = (st, doc, p, id, now = new Date()) => {
    const day = A.dayKey(now);
    const items = A.group(doc, p);
    const it = items.find((x) => x.id === id);
    if (!it) return null;
    const r = A.rec(st, day, p, true);
    const n = Math.min(it.count, (r.c[id] || 0) + 1);
    r.c[id] = n;
    const all = items.every((x) => (r.c[x.id] || 0) >= x.count);
    const wasDone = r.done;
    if (all && p !== 'g') { r.done = true; r.at = r.at || new Date(now).toISOString(); }
    return { n, full: n >= it.count, groupDone: all && !wasDone && p !== 'g' };
  };
  /** Mark the morning/evening as done without counting (said it from memory, in the mosque...). */
  A.markDone = (st, p, now = new Date()) => { const r = A.rec(st, A.dayKey(now), p, true); r.done = true; r.at = r.at || new Date(now).toISOString(); };
  A.resetDay = (st, p, now = new Date()) => { const a = A.ensure(st); const d = a.days[A.dayKey(now)]; if (d) delete d[p]; };
  A.progress = (st, doc, p, now = new Date()) => {
    const items = A.group(doc, p);
    const r = A.rec(st, A.dayKey(now), p, false) || { c: {}, done: false };
    const full = items.filter((x) => (r.c[x.id] || 0) >= x.count).length;
    return { done: !!r.done, full, total: items.length, counts: r.c };
  };
  A.isDone = (st, p, day) => { const r = A.rec(st, day, p, false); return !!(r && r.done); };
  /** Consecutive days the period was done, up to today (today counts only once it is done). */
  A.streak = (st, p, today = u.today()) => {
    let d = A.isDone(st, p, today) ? today : u.addDays(today, -1), n = 0;
    while (n < 3660 && A.isDone(st, p, d)) { n++; d = u.addDays(d, -1); }
    return n;
  };
  /** Keep the last `keep` days only (counters are small but add up over a year). */
  A.prune = (st, today = u.today(), keep = 120) => {
    const a = A.ensure(st), cut = u.addDays(today, -keep);
    Object.keys(a.days).forEach((d) => { if (d < cut) delete a.days[d]; });
  };

  /* ---------- reminders (decisions only; the view shows them) ---------- */
  /**
   * What is due right now. mem (per device): { seen: {m: day, e: day}, lastGen: ms, muted: day }.
   * - a window start note, once per window per day, only when not done yet
   * - a general dhikr every `general.every` minutes, outside quiet hours, unless muted for today
   * The caller decides whether now is a good moment (focus screen, timer, pause mode) and defers otherwise.
   */
  A.due = (st, mem, now = new Date()) => {
    const cfg = A.cfg(st);
    const out = [];
    if (cfg.enabled === false) return out;
    const day = A.dayKey(now), t = new Date(now).getTime();
    const p = A.period(cfg, now);
    if (p && cfg.startToast && (mem.seen || {})[p] !== day && !A.isDone(st, p, day)) out.push({ type: 'period', p });
    const every = Number(cfg.general.every) || 0;
    if (every > 0 && mem.muted !== day && !A.quiet(cfg, now) && mem.lastGen && t - mem.lastGen >= every * 60000) out.push({ type: 'general' });
    return out;
  };
  /** A general dhikr for this moment — varies through the day, never the same twice in a row. */
  A.pickGeneral = (doc, lastId, rnd = Math.random) => {
    const g = A.group(doc, 'g');
    if (!g.length) return null;
    const pool = g.length > 1 ? g.filter((x) => x.id !== lastId) : g;
    return pool[Math.floor(rnd() * pool.length) % pool.length];
  };

  /* ---------- optional link to the points system (off by default) ---------- */
  /** Days (from the day it was turned on) whose morning/evening was completed: [{ k, day, p }]. */
  A.pointKeys = (st) => {
    const a = st && st.adhkar;
    if (!a || !a.pointsFrom || !A.cfg(st).points || A.cfg(st).enabled === false) return [];
    const out = [];
    Object.keys(a.days || {}).forEach((day) => {
      if (day < a.pointsFrom) return;
      ['m', 'e'].forEach((p) => { if (a.days[day][p] && a.days[day][p].done) out.push({ k: `adk:${day}:${p}`, day, p }); });
    });
    return out;
  };

  CT.adhkar = A;
})(window.CT);
