/* grades.js — weighted grade math. Pure functions, no DOM.
 * Component: { name, weight (% of final), score (0–100 or null = not yet graded),
 *              mustPass (must reach passMin to pass the course), bonus (adds weight×score on top, optional) } */
(function (CT) {
  'use strict';
  const { isNum, sum } = CT.u;
  const g = {};

  g.compute = (grade) => {
    const comps = (grade && grade.components) || [];
    const main = comps.filter((c) => !c.bonus);
    const bonus = comps.filter((c) => c.bonus);
    const graded = main.filter((c) => isNum(c.score));
    const remaining = main.filter((c) => !isNum(c.score));
    const totalW = sum(main, (c) => c.weight);
    const gradedW = sum(graded, (c) => c.weight);
    const remW = sum(remaining, (c) => c.weight);
    const pts = sum(graded, (c) => (c.weight * c.score) / 100);             // points already "in the bank"
    const bonusPts = sum(bonus.filter((c) => isNum(c.score)), (c) => (c.weight * c.score) / 100);
    const failed = main.filter((c) => c.mustPass && isNum(c.score) && c.score < (isNum(c.passMin) ? c.passMin : 55));

    const r = {
      totalW, gradedW, remW, pts, bonusPts, failed,
      weightsOk: Math.abs(totalW - 100) < 0.01,
      avgSoFar: gradedW ? (pts / gradedW) * 100 : null,          // average over what's graded
      final: remaining.length ? null : Math.min(100, pts + bonusPts), // full grade once all graded
      remaining, needed: null,
    };

    // "what do I need in the remaining components (assumed equal score) to reach the target?"
    const target = Number(grade && grade.target);
    if (remaining.length && remW > 0 && isNum(target) && target > 0) {
      const x = ((target - pts - bonusPts) / remW) * 100;
      const minPass = Math.max(0, ...remaining.filter((c) => c.mustPass).map((c) => (isNum(c.passMin) ? c.passMin : 55)));
      r.needed = {
        raw: x,
        value: Math.max(x, minPass, 0),
        minPass,
        impossible: x > 100,
        secured: x <= minPass,
      };
    }
    // best / worst case projections
    r.maxPossible = Math.min(100, pts + bonusPts + remW);
    return r;
  };

  CT.grades = g;
})(window.CT);
