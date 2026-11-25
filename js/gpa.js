/* gpa.js — grade average and credit math. Pure functions, no DOM, no app state: everything comes in as
 * arguments, so tests/gpa.test.js can run it in Node.
 *
 * Rules (all from settings, see DEFAULTS):
 *   repeat       'last' | 'best' | 'all' — which attempt of a repeated course counts
 *   failedInAvg  a failing numeric grade still enters the average (with 0 earned credits)
 *   passGrade    lowest passing grade
 *   exemptCredits default for "exempt": earns credits (can be overridden per course)
 * Pass/fail, exempt and withdrawn never enter the average. This is a personal estimate, not the official GPA. */
(function (root) {
  'use strict';
  const G = {};
  G.DEFAULTS = { repeat: 'last', failedInAvg: true, passGrade: 55, exemptCredits: true, decimals: 2 };
  const TERM_ORDER = ['winter', 'spring', 'summer'];
  const isNum = (v) => typeof v === 'number' && isFinite(v);
  const toNum = (v) => (v === '' || v == null ? NaN : Number(v));

  /** Course number → 8 digits (old 6-digit 044131 → 00440131); '' when there is none. */
  G.normNum = (n) => {
    const d = String(n || '').replace(/\D/g, '');
    return d.length === 6 ? `0${d.slice(0, 3)}0${d.slice(3)}` : d;
  };
  G.semKey = (s) => (s && s.year ? s.year * 10 + Math.max(0, TERM_ORDER.indexOf(s.term)) : 99999);
  G.round = (x, d = 2) => (isNum(x) ? Math.round(x * 10 ** d) / 10 ** d : null);

  /** One attempt on its own: does it enter the average, does it earn credits? */
  G.classify = (outcome, credits, rules) => {
    const r = Object.assign({}, G.DEFAULTS, rules);
    const cr = toNum(credits);
    const c = { credits: isNum(cr) && cr >= 0 ? cr : 0, missingCredits: !(isNum(cr) && cr >= 0), grade: null, inAvg: false, earns: false, attempt: true };
    const o = outcome || {};
    const g = toNum(o.grade);
    switch (o.type) {
      case 'graded':
        if (!isNum(g)) { c.note = 'אין ציון'; c.attempt = false; break; }
        c.grade = g;
        c.earns = g >= r.passGrade;
        c.inAvg = c.earns || !!r.failedInAvg;
        break;
      case 'failed':
        c.grade = isNum(g) ? g : null;
        c.inAvg = isNum(g) && !!r.failedInAvg;
        break;
      case 'pass': c.earns = true; break;
      case 'exempt': c.earns = o.exemptCredits == null ? !!r.exemptCredits : !!o.exemptCredits; break;
      case 'withdrawn': c.attempt = false; break;
      default: c.attempt = false; // not finished
    }
    return c;
  };

  /**
   * courses:   [{ id, number, credits, semesterId, outcome, gpaExclude }]
   * semesters: [{ id, name, year, term }]
   * opts.include(course) → false to leave a course out (filters)
   * opts.hypothetical  { courseId: grade } → unfinished course treated as finished with that grade ("what if")
   */
  G.compute = (courses, semesters, rules, opts = {}) => {
    const r = Object.assign({}, G.DEFAULTS, rules);
    const semById = new Map((semesters || []).map((s) => [s.id, s]));
    const hyp = opts.hypothetical || {};
    const rows = [];
    (courses || []).forEach((course, idx) => {
      if (course.gpaExclude) return;
      if (opts.include && !opts.include(course)) return;
      let outcome = course.outcome;
      let hypothetical = false;
      if ((!outcome || !outcome.type) && isNum(toNum(hyp[course.id]))) { outcome = { type: 'graded', grade: toNum(hyp[course.id]) }; hypothetical = true; }
      if (!outcome || !outcome.type) return;
      const cls = G.classify(outcome, course.credits, r);
      const sem = semById.get(course.semesterId);
      rows.push({ course, cls, hypothetical, semId: sem ? sem.id : '', key: [G.semKey(sem), String(outcome.date || ''), idx], status: 'counted', inAvg: cls.inAvg, earns: cls.earns });
    });
    const order = (a, b) => (a.key[0] - b.key[0]) || a.key[1].localeCompare(b.key[1]) || (a.key[2] - b.key[2]);

    // repeated courses: same course number, more than one real attempt (withdrawn / ungraded do not count as attempts)
    const byNum = new Map();
    rows.forEach((row) => {
      const n = G.normNum(row.course.number);
      if (!n || !row.cls.attempt) return;
      if (!byNum.has(n)) byNum.set(n, []);
      byNum.get(n).push(row);
    });
    byNum.forEach((att) => {
      if (att.length < 2) return;
      att.sort(order);
      att.forEach((x) => { x.repeated = true; });
      if (r.repeat === 'all') {
        // every attempt's grade is averaged; the credits are earned once
        const earning = att.filter((x) => x.cls.earns);
        att.forEach((x) => { x.earns = false; });
        if (earning.length) earning[earning.length - 1].earns = true;
        return;
      }
      let keep;
      if (r.repeat === 'best') {
        const graded = att.filter((x) => isNum(x.cls.grade));
        keep = graded.length ? graded.reduce((b, x) => (x.cls.grade > b.cls.grade ? x : b)) : att[att.length - 1];
      } else keep = att[att.length - 1]; // 'last'
      att.forEach((x) => { if (x !== keep) { x.status = 'superseded'; x.inAvg = false; x.earns = false; } });
    });

    const total = (list) => {
      let gc = 0, c = 0, earned = 0, n = 0;
      list.forEach((x) => {
        if (x.inAvg && isNum(x.cls.grade)) { gc += x.cls.grade * x.cls.credits; c += x.cls.credits; }
        if (x.earns) earned += x.cls.credits;
        if (x.status === 'counted') n += 1;
      });
      return { avg: c > 0 ? gc / c : null, sumGC: gc, avgCredits: c, earned, count: n };
    };
    const all = total(rows);

    // per semester: what happened in that semester (every attempt there), credits as resolved above
    const semIds = [...new Set(rows.map((x) => x.semId))];
    const sorted = semIds.map((id) => semById.get(id) || { id: '', name: 'ללא סמסטר' }).sort((a, b) => G.semKey(a) - G.semKey(b));
    const perSemester = sorted.map((s) => {
      const list = rows.filter((x) => x.semId === (s.id || ''));
      let gc = 0, c = 0;
      list.forEach((x) => { if (x.cls.inAvg && isNum(x.cls.grade)) { gc += x.cls.grade * x.cls.credits; c += x.cls.credits; } });
      const t = total(list);
      return { semester: s, avg: c > 0 ? gc / c : null, avgCredits: c, earned: t.earned, count: list.length };
    });
    // cumulative average after each semester (same repeat rules, only what was known by then)
    const trend = opts.noTrend ? [] : sorted.map((s) => {
      const upTo = G.semKey(s);
      const prefix = (courses || []).filter((c) => G.semKey(semById.get(c.semesterId)) <= upTo);
      const res = G.compute(prefix, semesters, r, { include: opts.include, hypothetical: hyp, noTrend: true });
      const own = perSemester.find((p) => p.semester === s);
      return { semester: s, cumulative: res.avg, semesterAvg: own ? own.avg : null };
    });

    return Object.assign(all, { rows, perSemester, trend, rules: r });
  };

  /**
   * Average needed in the remaining credits to reach `target`:
   *   (target × (C + R) − S) / R, where S = Σ grade×credits so far, C = credits in the average, R = remaining credits.
   */
  G.required = (sumGC, avgCredits, target, remainingCredits) => {
    const R = Number(remainingCredits), T = Number(target);
    if (!(R > 0) || !isNum(T)) return null;
    const need = (T * (avgCredits + R) - sumGC) / R;
    return { need, impossible: need > 100, secured: need <= 0 };
  };

  root.CT = root.CT || {};
  root.CT.gpa = G;
})(typeof window !== 'undefined' ? window : globalThis);
