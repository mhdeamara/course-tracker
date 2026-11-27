/* views/archive.js — semester archive: move whole semesters/courses out of the dashboard without deleting. */
(function (CT) {
  'use strict';
  const { u, ui, stats } = CT;
  const S = CT.store, I = CT.i18n;
  const esc = u.esc, icon = u.icon;
  const t = (k, p) => I.t(k, p), tx = (k, p) => I.tx(k, p);
  const V = {};
  CT.views = CT.views || {};
  CT.views.archive = V;

  V.render = (root) => {
    const st = S.state;
    const groups = [...st.semesters, { id: '', name: '' }].map((sem) => ({
      sem,
      active: st.courses.filter((c) => (c.semesterId || '') === sem.id && !c.archived),
      archived: st.courses.filter((c) => (c.semesterId || '') === sem.id && c.archived),
    })).filter((g) => g.active.length || g.archived.length);

    root.innerHTML = `
      <div class="archive page-wide">
        <header class="pg-head"><h1>${t('arc.title')}</h1>
        <p class="muted">${t('arc.intro')}</p></header>
        ${groups.map(({ sem, active, archived }) => `
          <section class="card arch-sem" data-sem="${esc(sem.id)}">
            <div class="section-head" style="margin-top:0">
              <h2>${sem.id ? `<span dir="auto">${esc(sem.name)}</span>` : t('gpa.noSem')}</h2>
              ${active.length ? `<button class="btn" data-action="archive-sem">${icon.archive} ${t('arc.archiveAll', { n: active.length })}</button>` : ''}
            </div>
            ${archived.length ? `<ul class="arch-list">${archived.map((c) => {
              const p = stats.courseProgress(c);
              return `<li data-id="${esc(c.id)}" style="--c:${esc(c.color)}">
                ${ui.courseDot(c)} <a href="#/course/${esc(c.id)}" dir="auto">${esc(c.name)}</a>
                <span class="muted small">${c.number ? `<span dir="ltr">${esc(c.number)}</span> · ` : ''}${t('arc.pct', { n: p.pct })}</span>
                <span class="arch-actions">
                  <button class="btn btn-small" data-action="restore">${t('arc.restore')}</button>
                  <button class="icon-btn" data-action="delete" aria-label="${t('arc.deleteName', { name: I.iso(c.name) })}">${icon.trash}</button>
                </span></li>`;
            }).join('')}</ul>` : `<p class="muted small">${t('arc.noneHere')}</p>`}
          </section>`).join('') || ui.empty(t('cp.emptyAll'))}
      </div>`;

    root.querySelector('.archive').addEventListener('click', async (e) => {
      const a = e.target.closest('[data-action]');
      if (!a) return;
      const id = a.closest('li') && a.closest('li').dataset.id;
      const semId = a.closest('[data-sem]').dataset.sem;
      if (a.dataset.action === 'archive-sem') {
        S.commit(tx('arc.u.sem'), (s) => s.courses.forEach((c) => { if ((c.semesterId || '') === semId) c.archived = true; }));
        ui.toast(tx('arc.semDone'), { action: { label: tx('common.undo'), fn: S.undo } });
      }
      if (a.dataset.action === 'restore') S.commit(tx('arc.u.restore'), () => { S.course(id).archived = false; });
      if (a.dataset.action === 'delete') {
        const c = S.course(id);
        if (!(await ui.confirm(tx('arc.deleteQ', { name: I.iso(c.name) }), tx('cp.deleteOk'), true, { localized: true }))) return;
        S.commit(tx('sem.u.delCourse'), (s) => { s.courses = s.courses.filter((x) => x.id !== id); });
        ui.toast(tx('sem.deleted'), { action: { label: tx('common.undo'), fn: S.undo } });
      }
    });
  };
})(window.CT);
