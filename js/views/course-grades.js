/* views/course-grades.js — Grades tab: grade components, weighted grade, "what do I need on the final". Translated (CT.i18n). */
(function (CT) {
  'use strict';
  const { u, ui } = CT;
  const S = CT.store;
  const esc = u.esc, icon = u.icon;
  const t = CT.i18n.t, tx = CT.i18n.tx;
  const V = {};
  CT.views = CT.views || {};
  CT.views.grades = V;

  const fmt = (n, d = 1) => (u.isNum(n) ? ui.num(Math.round(n * 10 ** d) / 10 ** d) : '—');

  V.render = (panel, c) => {
    const comps = c.grade.components;
    panel.innerHTML = `
      <div class="grades">
        <section class="card">
          <h2>${t('gr.title')}</h2>
          <p class="muted small">${t('gr.hint')}</p>
          <div class="grade-table" role="table" aria-label="${t('gr.table')}">
            <div class="gt-row gt-head muted" role="row">
              <span role="columnheader">${t('gr.comp')}</span><span role="columnheader">${t('gr.weight')}</span><span role="columnheader">${t('gr.score')}</span>
              <span role="columnheader">${t('gr.must')}</span><span role="columnheader">${t('gr.min')}</span><span role="columnheader">${t('gr.bonus')}</span><span></span>
            </div>
            ${comps.map((x) => `
              <div class="gt-row" role="row" data-id="${x.id}">
                <input name="name" dir="auto" value="${esc(x.name)}" aria-label="${t('gr.compName')}" placeholder="${t('gr.compName')}">
                <label class="gt-cell"><span class="gt-lbl">${t('gr.weight')}</span><input name="weight" type="number" min="0" max="100" step="0.5" value="${esc(x.weight)}" aria-label="${t('gr.weightLabel')}"></label>
                <label class="gt-cell"><span class="gt-lbl">${t('gr.score')}</span><input name="score" type="number" min="0" max="120" step="0.5" value="${u.isNum(x.score) ? x.score : ''}" placeholder="—" aria-label="${t('gr.score')}"></label>
                <label class="gt-check"><span class="gt-lbl">${t('gr.must')}</span><input type="checkbox" name="mustPass" ${x.mustPass ? 'checked' : ''} aria-label="${t('gr.must')}"></label>
                <label class="gt-cell"><span class="gt-lbl">${t('gr.min')}</span><input name="passMin" type="number" min="0" max="100" value="${esc(x.passMin)}" aria-label="${t('gr.minLabel')}" ${x.mustPass ? '' : 'disabled'}></label>
                <label class="gt-check"><span class="gt-lbl">${t('gr.bonus')}</span><input type="checkbox" name="bonus" ${x.bonus ? 'checked' : ''} aria-label="${t('gr.bonus')}"></label>
                <button class="icon-btn" data-action="del" aria-label="${t('gr.del')}">${icon.trash}</button>
              </div>`).join('')}
          </div>
          <div class="btn-row">
            <button class="btn btn-ghost" data-action="add">${icon.plus} ${t('gr.add')}</button>
            ${comps.length ? '' : `<button class="btn btn-ghost" data-action="preset">${t('gr.preset')}</button>`}
          </div>
        </section>
        <section class="card grade-summary" aria-live="polite"></section>
      </div>`;
    drawSummary(panel, c.id);

    const el = panel.querySelector('.grades');
    el.addEventListener('input', (e) => {
      const row = e.target.closest('.gt-row');
      if (row && row.dataset.id) {
        const el2 = e.target;
        S.commit(tx('gr.u.edit'), () => {
          const comp = S.course(c.id).grade.components.find((x) => x.id === row.dataset.id);
          if (el2.type === 'checkbox') comp[el2.name] = el2.checked;
          else if (el2.name === 'name') comp.name = el2.value;
          else comp[el2.name] = el2.value === '' ? (el2.name === 'score' ? null : 0) : Number(el2.value);
        }, { silent: true, coalesce: 'grade:' + c.id });
        if (el2.name === 'mustPass') row.querySelector('[name=passMin]').disabled = !el2.checked;
      }
      if (e.target.name === 'target') {
        S.commit(tx('gr.u.target'), () => { S.course(c.id).grade.target = Number(e.target.value) || 0; }, { silent: true, coalesce: 'target:' + c.id });
      }
      drawSummary(panel, c.id);
    });
    el.addEventListener('click', (e) => {
      const a = e.target.closest('[data-action]');
      if (!a) return;
      const id = a.closest('.gt-row') && a.closest('.gt-row').dataset.id;
      const mk = (name, weight, extra = {}) => Object.assign({ id: u.uid(), name, weight, score: null, mustPass: false, passMin: 55, bonus: false }, extra);
      if (a.dataset.action === 'add') S.commit(tx('gr.u.add'), () => S.course(c.id).grade.components.push(mk('', 0)));
      if (a.dataset.action === 'del') S.commit(tx('gr.u.del'), () => {
        const g = S.course(c.id).grade; g.components = g.components.filter((x) => x.id !== id);
      });
      if (a.dataset.action === 'preset') S.commit(tx('gr.u.preset'), () => {
        S.course(c.id).grade.components = [mk(tx('gr.p.hw'), 10), mk(tx('gr.p.quiz'), 20), mk(tx('gr.p.final'), 70, { mustPass: true })];
      });
    });
  };

  function drawSummary(panel, courseId) {
    const c = S.course(courseId);
    const r = CT.grades.compute(c.grade);
    const box = panel.querySelector('.grade-summary');
    const typingTarget = document.activeElement && document.activeElement.name === 'target' && box.contains(document.activeElement);
    const warn = [];
    if (c.grade.components.length && !r.weightsOk) warn.push(tx('gr.wSum', { n: fmt(r.totalW) }));
    r.failed.forEach((x) => warn.push(tx('gr.below', { name: x.name || tx('gr.comp'), score: fmt(x.score), min: fmt(x.passMin, 0) })));

    let needHTML = '';
    if (r.final != null) {
      needHTML = `<div class="big-result"><span>${t('gr.final')}</span><b>${fmt(r.final)}</b></div>`;
    } else if (r.needed) {
      const names = r.remaining.map((x) => x.name || tx('gr.comp')).join(', ');
      const n = r.needed;
      needHTML = n.impossible
        ? `<div class="big-result bad"><span>${t('gr.needRaw', { target: fmt(c.grade.target, 0), n: fmt(n.raw), names })}</span><b>${t('gr.impossible')}</b><span class="muted small">${t('gr.maxNow', { n: fmt(r.maxPossible) })}</span></div>`
        : n.secured
          ? `<div class="big-result good"><span>${t('gr.secured', { target: fmt(c.grade.target, 0) })}</span><b>${n.minPass ? `≥ ${fmt(n.minPass, 0)}` : '✓'}</b><span class="muted small">${n.minPass ? t('gr.passIn', { names }) : t('gr.enough')}</span></div>`
          : `<div class="big-result"><span>${t('gr.need', { target: fmt(c.grade.target, 0) })}</span><b>${fmt(n.value)}</b><span class="muted small">${t(r.remaining.length > 1 ? 'gr.inAvg' : 'gr.in', { names })}</span></div>`;
    }

    box.innerHTML = `
      <h2>${t('gr.calc')}</h2>
      <div class="grade-stats">
        <div><span class="muted small">${t('gr.avg')}</span><b>${fmt(r.avgSoFar)}</b></div>
        <div><span class="muted small">${t('gr.pts')}</span><b>${fmt(r.pts)}<small> / ${fmt(r.gradedW)}</small></b></div>
        <div><span class="muted small">${t('gr.bonus')}</span><b>+${fmt(r.bonusPts)}</b></div>
        <div><span class="muted small">${t('gr.max')}</span><b>${fmt(r.maxPossible)}</b></div>
      </div>
      <label class="field target-field"><span>${t('gr.target')}</span><input type="number" name="target" min="0" max="100" value="${esc(c.grade.target)}"></label>
      ${needHTML}
      ${warn.map((w) => `<p class="warn-line">${esc(w)}</p>`).join('')}`;
    // the summary is redrawn while typing in the target field — put the cursor back
    if (typingTarget) box.querySelector('[name=target]').focus();
  }
})(window.CT);
