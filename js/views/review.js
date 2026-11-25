/* views/review.js — exam review list: every item flagged ⭐ or marked "צריך לחזור", with its notes. Printable. */
(function (CT) {
  'use strict';
  const { u, ui } = CT;
  const S = CT.store, M = CT.model;
  const esc = u.esc, icon = u.icon;
  const V = {};
  CT.views = CT.views || {};
  CT.views.review = V;

  let withNotebook = false;

  V.render = (root, params = {}) => {
    const courses = S.activeCourses();
    const sel = params.course && S.course(params.course) ? params.course : '';
    const list = (sel ? [S.course(sel)] : courses).map((c) => ({
      c,
      cats: c.categories.map((cat) => ({ cat, items: cat.items.filter((i) => i.flag || i.status === 'review') })).filter((x) => x.items.length),
    })).filter((x) => x.cats.length || (withNotebook && x.c.notebook.length));
    const total = u.sum(list, (x) => u.sum(x.cats, (y) => y.items.length));

    root.innerHTML = `
      <div class="review">
        <div class="section-head" style="margin-top:0">
          <h1>⭐ רשימת חזרה למבחן</h1>
          <div class="toolbar-actions no-print">
            <select data-action="course" aria-label="בחירת קורס" class="chip-select">
              <option value="">כל הקורסים</option>
              ${courses.map((c) => `<option value="${c.id}" ${c.id === sel ? 'selected' : ''}>${esc(c.name)}</option>`).join('')}
            </select>
            <label class="check-field"><input type="checkbox" data-action="nb" ${withNotebook ? 'checked' : ''}> כולל מחברת מושגים</label>
            <button class="btn" data-action="print">${icon.print} הדפסה / PDF</button>
          </div>
        </div>
        <p class="muted no-print">פריטים שסימנת ⭐ ("לחזור לפני המבחן") או שהסטטוס שלהם "צריך לחזור". סמן ⭐ בכל שורה בדף הקורס (או מקש F).</p>
        <p class="print-only">${esc(sel ? S.course(sel).name : 'כל הקורסים')} · ${u.fmtDateFull(u.today())} · ${total} פריטים</p>
        ${list.map(({ c, cats }) => `
          <section class="card rv-course" style="--c:${esc(c.color)}">
            <h2>${ui.courseDot(c)} <a href="#/course/${c.id}">${esc(c.name)}</a></h2>
            ${cats.map(({ cat, items }) => `
              <h3 class="muted">${esc(cat.name)}</h3>
              <ul class="rv-list">${items.map((it) => `
                <li data-id="${it.id}">
                  <div class="rv-head">
                    <span class="rv-title" dir="auto">${it.flag ? '⭐ ' : ''}${esc(it.title)}</span>
                    ${ui.statusPill(it.status)}
                    <span class="rv-actions no-print">
                      <button class="btn btn-small" data-action="done" title="סמן שחזרתי — הסטטוס יהפוך להושלם וה-⭐ יוסר">✓ חזרתי</button>
                      <a class="btn btn-small btn-ghost" href="#/course/${c.id}?item=${it.id}">פתח</a>
                    </span>
                  </div>
                  ${it.note ? `<div class="rv-note" dir="auto">${u.rich(it.note)}</div>` : ''}
                </li>`).join('')}</ul>`).join('')}
            ${withNotebook && c.notebook.length ? `<h3 class="muted">מחברת מושגים</h3>
              <div class="rv-nb">${c.notebook.map((n) => `<div class="rv-nb-item"><b dir="auto">${esc(n.title)}</b><div dir="auto">${u.rich(n.body)}</div></div>`).join('')}</div>` : ''}
          </section>`).join('') || ui.empty('אין פריטים לחזרה. 🎯<br>בדף קורס, לחץ על ⭐ בשורה כדי להוסיף אותה לכאן.')}
      </div>`;

    const el = root.querySelector('.review');
    el.addEventListener('change', (e) => {
      if (e.target.dataset.action === 'course') location.hash = e.target.value ? `#/review?course=${e.target.value}` : '#/review';
      if (e.target.dataset.action === 'nb') { withNotebook = e.target.checked; CT.app.rerender(); }
    });
    el.addEventListener('click', (e) => {
      const a = e.target.closest('[data-action]');
      if (!a) return;
      if (a.dataset.action === 'print') window.print();
      if (a.dataset.action === 'done') {
        const id = a.closest('li').dataset.id;
        S.commit('סימון חזרה', () => {
          const it = S.findItem(id).item;
          it.flag = false;
          it.status = 'done';
          it.completedAt = it.completedAt || new Date().toISOString();
        });
        ui.toast('הוסר מרשימת החזרה', { action: { label: 'בטל', fn: S.undo } });
      }
    });
  };
  V.statuses = M.STATUSES;
})(window.CT);
