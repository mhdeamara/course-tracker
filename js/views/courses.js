/* views/courses.js — "קורסים" (#/courses): the courses of one semester as cards (emblem, number, credits, progress by
 * category, the next task and the next exam), a semester picker with access to every past semester, and the course
 * actions (open, edit, colour, archive, delete). Grade-only records of a past semester are listed compactly.
 * Fully translated (CT.i18n); course names and numbers are shown exactly as stored. */
(function (CT) {
  'use strict';
  const { u, ui, stats } = CT;
  const S = CT.store, M = CT.model;
  const I18N = CT.i18n, t = I18N.t, tx = I18N.tx;
  const esc = u.esc, icon = u.icon;
  const V = {};
  CT.views = CT.views || {};
  CT.views.courses = V;

  const SEM_SHOWN = 4; // semesters in the picker; the rest are one click away ("all semesters")

  /** Semesters worth picking: the active one and every semester that has courses, newest first. */
  V.semesters = (st = S.state) => {
    const used = new Set(st.courses.map((c) => c.semesterId || ''));
    return M.sortedSemesters(st.semesters).reverse().filter((s) => s.id === st.settings.activeSemesterId || used.has(s.id));
  };

  /** What a card shows, as data (tested): progress per category, next task, next exam. */
  V.summary = (c, today = u.today()) => {
    const p = stats.courseProgress(c);
    const cats = c.categories.filter((cat) => cat.items.length).map((cat) => Object.assign({ name: cat.name }, stats.progress(cat.items)));
    const next = c.categories.flatMap((cat) => cat.items).filter((i) => i.status !== 'done' && i.due).sort((a, b) => a.due.localeCompare(b.due))[0] || null;
    const exam = (c.exams || []).filter((e) => e.date && e.date >= today).sort((a, b) => a.date.localeCompare(b.date))[0] || null;
    return { pct: p.pct, done: p.done, total: p.total, cats, next, exam };
  };

  V.render = (root, params = {}) => {
    const st = S.state;
    const sems = V.semesters(st);
    const semId = params.sem && S.semester(params.sem) ? params.sem : st.settings.activeSemesterId || (sems[0] && sems[0].id) || '';
    const sem = S.semester(semId);
    const all = st.courses.filter((c) => (c.semesterId || '') === (semId || '') && !c.archived);
    const tracked = all.filter((c) => c.kind !== 'record');
    const records = all.filter((c) => c.kind === 'record');
    const credits = u.sum(all, (c) => Number(c.credits) || 0);
    const archived = st.courses.filter((c) => c.archived).length;
    const shown = sems.slice(0, SEM_SHOWN);
    if (sem && !shown.some((s) => s.id === sem.id)) shown.push(sem);
    const isActive = semId && semId === st.settings.activeSemesterId;

    root.innerHTML = `
      <div class="courses-pg">
        <header class="cp-head">
          <h1>${t('cp.title')}</h1>
          <button class="btn btn-primary" data-act="new">${icon.plus}<span>${t('cp.new')}</span></button>
        </header>
        <div class="cp-bar">
          ${shown.length ? `<div class="cp-sems" role="group" aria-label="${t('cp.semester')}">${shown.map((s) => `<a class="cp-sem${s.id === semId ? ' is-on' : ''}" href="#/courses?sem=${esc(s.id)}"${s.id === semId ? ' aria-current="page"' : ''}><span dir="auto">${esc(s.name)}</span>${s.id === st.settings.activeSemesterId ? `<span class="cp-dot" title="${t('cp.activeSem')}" aria-label="${t('cp.activeSem')}"></span>` : ''}</a>`).join('')}</div>` : ''}
          <a class="cp-allsems" href="#/semesters">${icon.layers}<span>${t('cp.allSems')}</span></a>
        </div>
        ${all.length ? `<p class="cp-sum">${t('cp.summary', { n: all.length, c: ui.num(credits) })}${!isActive && sem ? ` · <button class="linkish" data-act="activate">${t('cp.makeActive')}</button>` : ''}</p>` : ''}
        ${tracked.length ? `<div class="cp-grid">${tracked.map(cardHTML).join('')}
          <button class="cp-add" data-act="new"><span class="cp-add-ic" aria-hidden="true">${icon.plus}</span><span>${t('cp.new')}</span></button></div>` : ''}
        ${records.length ? recordsHTML(records, sem) : ''}
        ${!all.length ? emptyHTML(sem) : ''}
        ${archived ? `<p class="cp-foot"><a href="#/archive">${icon.archive}<span>${t('cp.archived', { n: archived })}</span></a></p>` : ''}
      </div>`;
    root.querySelector('.courses-pg').addEventListener('click', (e) => onClick(e, semId));
  };

  function cardHTML(c) {
    const s = V.summary(c);
    const name = c.name || tx('cp.untitled');
    const meta = [c.number && `<span class="cc-num" dir="ltr">${esc(c.number)}</span>`, c.credits !== '' && c.credits != null && t('cp.credits', { n: ui.num(c.credits) })].filter(Boolean).join('<span aria-hidden="true"> · </span>');
    const meterLabel = tx('cp.meter', { pct: s.pct }) + (s.cats.length ? ': ' + s.cats.map((x) => `${x.name} ${x.done}/${x.total}`).join(', ') : '');
    const nd = s.next && u.daysUntil(s.next.due);
    const en = s.exam && u.daysUntil(s.exam.date);
    return `<article class="cc${M.isFinished(c) ? ' is-finished' : ''}" style="--c:${esc(c.color)}" data-id="${esc(c.id)}">
        <div class="cc-top">
          <span class="cc-art">${CT.art.svg(c)}</span>
          <div class="cc-id">
            <h3><a class="cc-link" href="#/course/${esc(c.id)}" dir="auto">${esc(name)}</a></h3>
            <p class="cc-meta">${meta || '&nbsp;'}${ui.outcomeBadge(c)}</p>
          </div>
          <button class="icon-btn cc-menu" data-act="menu" aria-label="${t('cp.menuFor', { name })}" aria-haspopup="menu">${icon.more}</button>
        </div>
        <div class="cc-prog">
          <div class="cc-meter" role="img" aria-label="${esc(meterLabel)}">${s.cats.length ? s.cats.map((x) => `<span style="flex:${x.total}"><i style="width:${x.pct}%"></i></span>`).join('') : '<span style="flex:1"></span>'}</div>
          <b class="cc-pct">${ui.num(s.pct)}%</b>
        </div>
        <ul class="cc-facts">
          <li class="cc-fact${nd != null && nd < 0 ? ' is-late' : ''}">${icon.flag}${s.next
            ? `<span class="cc-fact-t" dir="auto">${esc(s.next.title)}</span><span class="cc-when">${nd < 0 ? icon.alert : ''}${esc(ui.rel(s.next.due))}</span>`
            : `<span class="cc-fact-t muted">${s.total && s.done === s.total ? t('cp.allDone') : t('cp.noDeadlines')}</span>`}</li>
          ${s.exam ? `<li class="cc-fact${en <= 14 ? ' is-soon' : ''}">${icon.cap}<span class="cc-fact-t" dir="auto">${esc(s.exam.label || tx('td.exam'))}</span><span class="cc-when">${en === 0 ? t('rel.today') : t('td.inDays', { n: en })}</span></li>` : ''}
        </ul>
      </article>`;
  }

  function recordsHTML(list, sem) {
    return `<section class="card cp-records" aria-labelledby="rec-h">
        <div class="card-head"><h2 id="rec-h">${t('cp.records')}</h2>${sem ? `<a class="small" href="#/semesters/${esc(sem.id)}">${t('cp.editGrades')}</a>` : ''}</div>
        <ul class="rec-list">${list.map((c) => `<li style="--c:${esc(c.color)}"><a href="#/course/${esc(c.id)}" dir="auto">${esc(c.name)}</a>
          <span class="muted small">${c.number ? `<span dir="ltr">${esc(c.number)}</span> · ` : ''}${c.credits !== '' && c.credits != null ? t('cp.credits', { n: ui.num(c.credits) }) : ''}</span>
          <span class="rec-g">${ui.outcomeBadge(c) || '—'}</span></li>`).join('')}</ul>
      </section>`;
  }

  function emptyHTML(sem) {
    return `<div class="cp-empty">
        <span class="cp-empty-ic" aria-hidden="true">${icon.book}</span>
        <p><b>${sem ? t('cp.emptySem') : t('cp.emptyAll')}</b></p>
        <p class="muted small">${t('cp.emptyHint')}</p>
        <div class="btn-row"><button class="btn btn-primary" data-act="new">${icon.plus}<span>${t('cp.new')}</span></button>
          <a class="btn" href="#/catalog">${t('cp.fromCatalog')}</a></div>
      </div>`;
  }

  /* ---------- actions ---------- */
  function onClick(e, semId) {
    const a = e.target.closest('[data-act]');
    if (!a) return;
    const card = a.closest('.cc');
    const c = card && S.course(card.dataset.id);
    switch (a.dataset.act) {
      case 'new': CT.views.course.courseForm(null, { semesterId: semId }); break;
      case 'activate':
        S.commit(tx('cp.undoActive'), (st) => { st.settings.activeSemesterId = semId; });
        ui.toast(tx('cp.activeNow'));
        break;
      case 'menu': if (c) V.menu(a, c); break;
      default: break;
    }
  }

  /** Course actions (also used by the course page). */
  V.menu = (anchor, c) => {
    ui.menu(anchor, [
      { label: tx('cp.open'), icon: 'book', fn: () => { location.hash = `#/course/${c.id}`; } },
      { label: tx('cp.edit'), icon: 'edit', fn: () => CT.views.course.courseForm(c) },
      { label: tx('cp.color'), icon: 'sliders', fn: () => V.colorDialog(c, anchor) },
      '-',
      { label: tx(c.archived ? 'cp.unarchive' : 'cp.archive'), icon: 'archive', fn: () => V.archive(c) },
      { label: tx('cp.delete'), icon: 'trash', danger: true, fn: () => V.remove(c) },
    ], { localized: true });
  };

  V.archive = (c) => {
    const was = !!c.archived, name = c.name;
    S.commit(tx(was ? 'cp.unarchive' : 'cp.archive'), () => { S.course(c.id).archived = !was; });
    ui.toast(tx(was ? 'cp.unarchivedToast' : 'cp.archivedToast', { name }), { action: { label: tx('common.undo'), fn: S.undo } });
  };

  V.remove = async (c, after) => {
    if (!(await ui.confirm(tx('cp.deleteConfirm', { name: c.name }), tx('cp.deleteOk'), true, { localized: true }))) return;
    S.commit(tx('cp.delete'), (st) => { st.courses.splice(st.courses.findIndex((x) => x.id === c.id), 1); });
    if (after) after();
    ui.toast(tx('cp.deletedToast', { name: c.name }), { action: { label: tx('common.undo'), fn: S.undo } });
  };

  /** Colour only: the palette, or any colour. Keyboard: arrows move between swatches (radio group). */
  V.colorDialog = (c, back) => {
    const m = ui.modal({
      title: tx('cp.colorTitle'),
      localized: true,
      body: `<p class="muted small" dir="auto">${esc(c.name)}</p>
        <div class="swatches" role="radiogroup" aria-label="${t('cp.color')}">
          ${M.COLORS.map((col, i) => `<button type="button" class="swatch${col === c.color ? ' on' : ''}" style="background:${col}" data-color="${col}" role="radio" aria-checked="${col === c.color}" aria-label="${t('cp.colorN', { n: i + 1 })}" tabindex="${col === c.color || (!M.COLORS.includes(c.color) && i === 0) ? 0 : -1}"></button>`).join('')}
          <input type="color" name="color" value="${esc(c.color)}" aria-label="${t('cp.colorCustom')}">
        </div>`,
      actions: [{ label: tx('common.cancel') }, { label: tx('common.save'), primary: true, fn: (api) => {
        const v = api.body.querySelector('[name=color]').value;
        if (v && v !== c.color) S.commit(tx('cp.color'), () => { S.course(c.id).color = v; });
        return true;
      } }],
      onClose: () => { if (back && document.contains(back)) setTimeout(() => back.focus(), 0); },
    });
    const sws = [...m.body.querySelectorAll('.swatch')];
    const pickSw = (sw) => {
      sws.forEach((x) => { const on = x === sw; x.classList.toggle('on', on); x.setAttribute('aria-checked', on); x.tabIndex = on ? 0 : -1; });
      m.body.querySelector('[name=color]').value = sw.dataset.color;
      sw.focus();
    };
    m.body.addEventListener('click', (e) => { const sw = e.target.closest('.swatch'); if (sw) pickSw(sw); });
    m.body.addEventListener('keydown', (e) => {
      const i = sws.indexOf(document.activeElement);
      if (i < 0) return;
      const d = { ArrowRight: 1, ArrowDown: 1, ArrowLeft: -1, ArrowUp: -1 }[e.key];
      if (d) { e.preventDefault(); pickSw(sws[(i + (I18N.dir() === 'rtl' && /Left|Right/.test(e.key) ? -d : d) + sws.length) % sws.length]); }
    });
  };
})(window.CT);
