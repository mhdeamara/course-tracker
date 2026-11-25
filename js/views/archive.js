/* views/archive.js — semester archive: move whole semesters/courses out of the dashboard without deleting. */
(function (CT) {
  'use strict';
  const { u, ui, stats } = CT;
  const S = CT.store;
  const esc = u.esc, icon = u.icon;
  const V = {};
  CT.views = CT.views || {};
  CT.views.archive = V;

  V.render = (root) => {
    const st = S.state;
    const groups = [...st.semesters, { id: '', name: 'ללא סמסטר' }].map((sem) => ({
      sem,
      active: st.courses.filter((c) => (c.semesterId || '') === sem.id && !c.archived),
      archived: st.courses.filter((c) => (c.semesterId || '') === sem.id && c.archived),
    })).filter((g) => g.active.length || g.archived.length);

    root.innerHTML = `
      <div class="archive">
        <h1>ארכיון</h1>
        <p class="muted">קורסים בארכיון לא מופיעים בדשבורד ובסטטיסטיקות, אבל כל הנתונים נשמרים ואפשר לשחזר אותם בכל רגע.</p>
        ${groups.map(({ sem, active, archived }) => `
          <section class="card arch-sem" data-sem="${sem.id}">
            <div class="section-head" style="margin-top:0">
              <h2>${esc(sem.name)}</h2>
              ${active.length ? `<button class="btn" data-action="archive-sem">${icon.archive} העבר את כל ${active.length} הקורסים לארכיון</button>` : ''}
            </div>
            ${archived.length ? `<ul class="arch-list">${archived.map((c) => {
              const p = stats.courseProgress(c);
              return `<li data-id="${c.id}" style="--c:${esc(c.color)}">
                ${ui.courseDot(c)} <a href="#/course/${c.id}" dir="auto">${esc(c.name)}</a>
                <span class="muted small">${c.number ? esc(c.number) + ' · ' : ''}${p.pct}% הושלם</span>
                <span class="arch-actions">
                  <button class="btn btn-small" data-action="restore">שחזר לדשבורד</button>
                  <button class="icon-btn" data-action="delete" aria-label="מחק לצמיתות">${icon.trash}</button>
                </span></li>`;
            }).join('')}</ul>` : '<p class="muted small">אין קורסים בארכיון מהסמסטר הזה.</p>'}
          </section>`).join('') || ui.empty('אין עדיין קורסים.')}
      </div>`;

    root.querySelector('.archive').addEventListener('click', async (e) => {
      const a = e.target.closest('[data-action]');
      if (!a) return;
      const id = a.closest('li') && a.closest('li').dataset.id;
      const semId = a.closest('[data-sem]').dataset.sem;
      if (a.dataset.action === 'archive-sem') {
        S.commit('העברת סמסטר לארכיון', (s) => s.courses.forEach((c) => { if ((c.semesterId || '') === semId) c.archived = true; }));
        ui.toast('הסמסטר הועבר לארכיון', { action: { label: 'בטל', fn: S.undo } });
      }
      if (a.dataset.action === 'restore') S.commit('שחזור קורס', () => { S.course(id).archived = false; });
      if (a.dataset.action === 'delete') {
        const c = S.course(id);
        if (!(await ui.confirm(`למחוק לצמיתות את "${c.name}"?`, 'מחק', true))) return;
        S.commit('מחיקת קורס', (s) => { s.courses = s.courses.filter((x) => x.id !== id); });
        ui.toast('נמחק', { action: { label: 'בטל', fn: S.undo } });
      }
    });
  };
})(window.CT);
