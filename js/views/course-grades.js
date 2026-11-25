/* views/course-grades.js — "ציונים" tab: grade components, weighted grade, "what do I need on the final". */
(function (CT) {
  'use strict';
  const { u, ui } = CT;
  const S = CT.store;
  const esc = u.esc, icon = u.icon;
  const V = {};
  CT.views = CT.views || {};
  CT.views.grades = V;

  const fmt = (n, d = 1) => (u.isNum(n) ? (Math.round(n * 10 ** d) / 10 ** d).toString() : '—');

  V.render = (panel, c) => {
    const comps = c.grade.components;
    panel.innerHTML = `
      <div class="grades">
        <section class="card">
          <h2>רכיבי הציון</h2>
          <p class="muted small">משקל באחוזים מהציון הסופי. ציון ריק = עוד לא נבדק. "חובה לעבור" = רכיב עם ציון סף (למשל מבחן סופי ≥ 55). "בונוס" = רכיב רשות שמוסיף נקודות מעל.</p>
          <div class="grade-table" role="table" aria-label="רכיבי ציון">
            <div class="gt-row gt-head muted" role="row">
              <span role="columnheader">רכיב</span><span role="columnheader">משקל %</span><span role="columnheader">ציון</span>
              <span role="columnheader">חובה לעבור</span><span role="columnheader">סף</span><span role="columnheader">בונוס</span><span></span>
            </div>
            ${comps.map((x) => `
              <div class="gt-row" role="row" data-id="${x.id}">
                <input name="name" dir="auto" value="${esc(x.name)}" aria-label="שם הרכיב" placeholder="שם הרכיב">
                <label class="gt-cell"><span class="gt-lbl">משקל %</span><input name="weight" type="number" min="0" max="100" step="0.5" value="${esc(x.weight)}" aria-label="משקל באחוזים"></label>
                <label class="gt-cell"><span class="gt-lbl">ציון</span><input name="score" type="number" min="0" max="120" step="0.5" value="${u.isNum(x.score) ? x.score : ''}" placeholder="—" aria-label="ציון"></label>
                <label class="gt-check"><span class="gt-lbl">חובה לעבור</span><input type="checkbox" name="mustPass" ${x.mustPass ? 'checked' : ''} aria-label="חובה לעבור"></label>
                <label class="gt-cell"><span class="gt-lbl">סף</span><input name="passMin" type="number" min="0" max="100" value="${esc(x.passMin)}" aria-label="ציון סף" ${x.mustPass ? '' : 'disabled'}></label>
                <label class="gt-check"><span class="gt-lbl">בונוס</span><input type="checkbox" name="bonus" ${x.bonus ? 'checked' : ''} aria-label="בונוס"></label>
                <button class="icon-btn" data-action="del" aria-label="מחק רכיב">${icon.trash}</button>
              </div>`).join('')}
          </div>
          <div class="btn-row">
            <button class="btn btn-ghost" data-action="add">${icon.plus} רכיב</button>
            ${comps.length ? '' : `<button class="btn btn-ghost" data-action="preset">מילוי מהיר: ש״ב 10% · בוחן 20% · סופי 70%</button>`}
          </div>
        </section>
        <section class="card grade-summary" aria-live="polite"></section>
      </div>`;
    drawSummary(panel, c.id);

    const el = panel.querySelector('.grades');
    el.addEventListener('input', (e) => {
      const row = e.target.closest('.gt-row');
      if (row && row.dataset.id) {
        const t = e.target;
        S.commit('עריכת ציונים', () => {
          const comp = S.course(c.id).grade.components.find((x) => x.id === row.dataset.id);
          if (t.type === 'checkbox') comp[t.name] = t.checked;
          else if (t.name === 'name') comp.name = t.value;
          else comp[t.name] = t.value === '' ? (t.name === 'score' ? null : 0) : Number(t.value);
        }, { silent: true, coalesce: 'grade:' + c.id });
        if (t.name === 'mustPass') row.querySelector('[name=passMin]').disabled = !t.checked;
      }
      if (e.target.name === 'target') {
        S.commit('ציון יעד', () => { S.course(c.id).grade.target = Number(e.target.value) || 0; }, { silent: true, coalesce: 'target:' + c.id });
      }
      drawSummary(panel, c.id);
    });
    el.addEventListener('click', (e) => {
      const a = e.target.closest('[data-action]');
      if (!a) return;
      const id = a.closest('.gt-row') && a.closest('.gt-row').dataset.id;
      const mk = (name, weight, extra = {}) => Object.assign({ id: u.uid(), name, weight, score: null, mustPass: false, passMin: 55, bonus: false }, extra);
      if (a.dataset.action === 'add') S.commit('הוספת רכיב ציון', () => S.course(c.id).grade.components.push(mk('', 0)));
      if (a.dataset.action === 'del') S.commit('מחיקת רכיב ציון', () => {
        const g = S.course(c.id).grade; g.components = g.components.filter((x) => x.id !== id);
      });
      if (a.dataset.action === 'preset') S.commit('רכיבי ציון', () => {
        S.course(c.id).grade.components = [mk('שיעורי בית', 10), mk('בוחן', 20), mk('מבחן סופי', 70, { mustPass: true })];
      });
    });
  };

  function drawSummary(panel, courseId) {
    const c = S.course(courseId);
    const r = CT.grades.compute(c.grade);
    const box = panel.querySelector('.grade-summary');
    const typingTarget = document.activeElement && document.activeElement.name === 'target' && box.contains(document.activeElement);
    const warn = [];
    if (c.grade.components.length && !r.weightsOk) warn.push(`סכום המשקלים (בלי בונוס) הוא ${fmt(r.totalW)}% ולא 100%.`);
    r.failed.forEach((x) => warn.push(`⚠️ ${x.name}: ${x.score} — מתחת לסף ${x.passMin}. ברכיב חובה זה בדרך כלל אומר כישלון בקורס.`));

    let needHTML = '';
    if (r.final != null) {
      needHTML = `<div class="big-result"><span>ציון סופי מחושב</span><b>${fmt(r.final)}</b></div>`;
    } else if (r.needed) {
      const names = r.remaining.map((x) => x.name || 'רכיב').join(', ');
      const n = r.needed;
      needHTML = n.impossible
        ? `<div class="big-result bad"><span>כדי להגיע ל-${esc(c.grade.target)} צריך ${fmt(n.raw)} ב${esc(names)}</span><b>לא אפשרי</b><span class="muted small">המקסימום האפשרי כרגע: ${fmt(r.maxPossible)}</span></div>`
        : n.secured
          ? `<div class="big-result good"><span>היעד ${esc(c.grade.target)} כמעט מובטח 🎉</span><b>${n.minPass ? `≥ ${fmt(n.minPass, 0)}` : '✓'}</b><span class="muted small">${n.minPass ? `מספיק לעבור את הסף ב${esc(names)}` : 'כבר צברת מספיק נקודות'}</span></div>`
          : `<div class="big-result"><span>כדי לקבל ${esc(c.grade.target)} בקורס צריך לפחות</span><b>${fmt(n.value)}</b><span class="muted small">ב${esc(names)}${r.remaining.length > 1 ? ' (בממוצע)' : ''}</span></div>`;
    }

    box.innerHTML = `
      <h2>חישוב</h2>
      <div class="grade-stats">
        <div><span class="muted small">ממוצע ברכיבים שנבדקו</span><b>${fmt(r.avgSoFar)}</b></div>
        <div><span class="muted small">נקודות שנצברו</span><b>${fmt(r.pts)}<small> / ${fmt(r.gradedW)}</small></b></div>
        <div><span class="muted small">בונוס</span><b>+${fmt(r.bonusPts)}</b></div>
        <div><span class="muted small">מקסימום אפשרי</span><b>${fmt(r.maxPossible)}</b></div>
      </div>
      <label class="field target-field"><span>ציון יעד בקורס</span><input type="number" name="target" min="0" max="100" value="${esc(c.grade.target)}"></label>
      ${needHTML}
      ${warn.map((w) => `<p class="warn-line">${esc(w)}</p>`).join('')}`;
    // the summary is redrawn while typing in the target field — put the cursor back
    if (typingTarget) box.querySelector('[name=target]').focus();
  }
})(window.CT);
