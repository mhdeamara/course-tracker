/* views/course.js — the course workspace: header (emblem, details, progress, exams), Items / Grades / Notebook tabs,
 * categories with their progress, items (completed ones folded per category), notes, filters, bulk add, drag, and the
 * course dialogs (create / edit / finish). Frequent actions stay on the row; the rest are in the row's menu.
 * Fully translated (CT.i18n); course names, items, notes and Moodle content are shown exactly as stored. */
(function (CT) {
  'use strict';
  const { u, ui, stats } = CT;
  const S = CT.store, M = CT.model;
  const I18N = CT.i18n, t = I18N.t, tx = I18N.tx;
  const esc = u.esc, icon = u.icon;
  const V = {};
  CT.views = CT.views || {};
  CT.views.course = V;

  // view-only state (not saved): filter, open notes, folded "completed" groups, quick-add drafts per category
  const view = { courseId: null, tab: 'items', filter: 'all', tag: '', openNotes: new Set(), focusId: null, showDone: new Set(), drafts: {} };

  const FILTERS = [['all', 'cw.f.all'], ['open', 'cw.f.open'], ['review', 'cw.f.review'], ['flag', 'cw.f.flag'], ['due', 'cw.f.due']];
  const matches = (it) => {
    if (view.tag && !it.tags.includes(view.tag)) return false;
    switch (view.filter) {
      case 'open': return it.status !== 'done';
      case 'review': return it.status === 'review';
      case 'flag': return it.flag;
      case 'due': return !!it.due;
      default: return true;
    }
  };
  const filtering = () => view.filter !== 'all' || !!view.tag;

  /* ================= rendering ================= */
  V.render = (root, params = {}) => {
    const c = S.course(params.id);
    if (!c) { root.innerHTML = ui.empty(`${t('cw.notFound')} <a href="#/courses">${t('cw.toCourses')}</a>`); return; }
    if (view.courseId !== c.id) Object.assign(view, { courseId: c.id, tab: 'items', filter: 'all', tag: '', focusId: null, showDone: new Set() });
    view.tab = params.tab || 'items'; // the address holds the tab (setTab writes it), so links and reloads agree
    if (params.item) {
      Object.assign(view, { tab: 'items', filter: 'all', tag: '' }); // jumping to an item (search / home / notifications)
      const f = S.findItem(params.item);
      if (f && f.item.status === 'done') view.showDone.add(f.cat.id); // unfold its group so it can be shown
    }
    const tabs = [['items', 'cw.tab.items']];
    if (CT.views.grades) tabs.push(['grades', 'cw.tab.grades']);
    if (CT.views.notebook) tabs.push(['notebook', 'cw.tab.notebook']);
    if (!tabs.some((x) => x[0] === view.tab)) view.tab = 'items';

    const p = stats.courseProgress(c);
    const sem = S.semester(c.semesterId);
    const meta = [
      c.number && `<span class="cw-num" dir="ltr">${esc(c.number)}</span>`, sem && `<span dir="auto">${esc(sem.name)}</span>`,
      c.credits !== '' && c.credits != null && t('cp.credits', { n: ui.num(c.credits) }), c.staff && `<span dir="auto">${esc(c.staff)}</span>`,
    ].filter(Boolean).join('<span aria-hidden="true"> · </span>');
    const exams = (c.exams || []).filter((e) => e.date).sort((a, b) => a.date.localeCompare(b.date)).map((e) => {
      const n = u.daysUntil(e.date);
      return `<span class="cw-exam${n < 0 ? ' is-past' : n <= 14 ? ' is-near' : ''}">${icon.cap}<span dir="auto">${esc(e.label || tx('td.exam'))}</span><span class="muted">${esc(ui.date(e.date, 'short'))}</span>${n >= 0 ? `<b>${n === 0 ? t('rel.today') : t('td.inDays', { n })}</b>` : ''}</span>`;
    }).join('');
    const finishedLine = M.isFinished(c) && (c.outcome.date || c.outcome.note)
      ? `<p class="cw-meta small">${c.outcome.date ? t('cw.finishedOn', { date: ui.date(c.outcome.date, 'full') }) : ''}${c.outcome.date && c.outcome.note ? ' · ' : ''}<span dir="auto">${esc(c.outcome.note || '')}</span></p>` : '';

    root.innerHTML = `
      <article class="cw" style="--c:${esc(c.color)}">
        <header class="card cw-head">
          <span class="cw-art">${CT.art.svg(c)}</span>
          <div class="cw-id">
            <div class="cw-title-row">
              <h1 dir="auto">${esc(c.name)}</h1>
              <button class="icon-btn cw-switch no-print" data-action="switch" aria-label="${t('cw.switch')}" aria-haspopup="menu" title="${t('cw.switch')}">${icon.chev}</button>
            </div>
            <p class="cw-meta">${meta}${ui.outcomeBadge(c)}${c.archived ? `<span class="pill pill-muted">${t('cw.archived')}</span>` : ''}</p>
            ${finishedLine}
          </div>
          <div class="cw-ring">${ui.ring(p.pct, 60, 6)}</div>
          <div class="cw-actions no-print">
            <button class="btn" data-action="bulk-add">${icon.plus}<span>${t('cw.items')}</span></button>
            <button class="icon-btn" data-action="course-menu" aria-label="${t('cw.more')}" aria-haspopup="menu">${icon.more}</button>
          </div>
          ${exams ? `<div class="cw-exams">${exams}</div>` : ''}
        </header>
        <div class="cw-bar no-print">
          ${tabs.length > 1 ? `<div class="cw-tabs" role="tablist" aria-label="${t('cw.tabs')}">
            ${tabs.map(([k, l]) => `<button role="tab" id="tab-${k}" aria-selected="${view.tab === k}" aria-controls="cw-panel" tabindex="${view.tab === k ? 0 : -1}" class="cw-tab${view.tab === k ? ' is-on' : ''}" data-tab="${k}">${t(l)}</button>`).join('')}
          </div>` : ''}
          ${view.tab === 'items' ? filtersHTML(c) : ''}
        </div>
        <div class="tab-panel" id="cw-panel" role="tabpanel" aria-labelledby="tab-${view.tab}"></div>
      </article>`;

    const panel = root.querySelector('.tab-panel');
    if (view.tab === 'grades') CT.views.grades.render(panel, c);
    else if (view.tab === 'notebook') CT.views.notebook.render(panel, c);
    else renderItems(panel, c);

    bindHead(root, c);
    if (params.item) highlightItem(root, params.item);
  };

  function filtersHTML(c) {
    const tags = S.courseTags(c);
    return `<div class="cw-filters" role="group" aria-label="${t('cw.filter')}">
        ${FILTERS.map(([k, l]) => `<button class="cw-f${view.filter === k ? ' is-on' : ''}" aria-pressed="${view.filter === k}" data-action="filter" data-filter="${k}">${k === 'flag' ? icon.star : ''}<span>${t(l)}</span></button>`).join('')}
        ${tags.length ? `<select class="chip-select" data-action="tag-filter" aria-label="${t('cw.tagFilter')}">
          <option value="">${t('cw.allTags')}</option>${tags.map((x) => `<option ${x === view.tag ? 'selected' : ''}>${esc(x)}</option>`).join('')}
        </select>` : ''}
      </div>`;
  }

  function renderItems(panel, c) {
    const dragOk = !filtering();
    const cats = c.categories.map((cat) => {
      const rows = cat.items.filter(matches);
      if (filtering() && !rows.length) return '';
      const open = rows.filter((it) => it.status !== 'done');
      const done = rows.filter((it) => it.status === 'done');
      const showDone = view.showDone.has(cat.id);
      const p = stats.progress(cat.items);
      const draft = view.drafts[cat.id] || '';
      return `
        <section class="card cat" data-id="${cat.id}" aria-labelledby="cat-${cat.id}">
          <header class="cat-head">
            ${dragOk ? `<button class="drag-handle no-print" aria-label="${t('cw.dragCat')}" title="${t('cw.dragCat')}">${icon.grip}</button>` : ''}
            <h2 class="cat-name" id="cat-${cat.id}" dir="auto" data-action="rename-cat" title="${t('cw.renameHint')}">${esc(cat.name)}</h2>
            <span class="cat-count" aria-label="${t('cw.catCount', { done: p.done, total: p.total })}">${ui.num(p.done)}/${ui.num(p.total)}</span>
            <div class="cat-bar">${ui.bar(p.pct, tx('cw.catProgress', { name: cat.name }), true)}</div>
            <button class="icon-btn no-print" data-action="cat-menu" aria-label="${t('cw.catMenu', { name: cat.name })}" aria-haspopup="menu">${icon.more}</button>
          </header>
          <div class="rows" data-cat="${cat.id}">
            ${open.map((it) => rowHTML(it, dragOk)).join('') || (done.length ? `<p class="rows-empty muted small">${icon.check}<span>${t('cw.catAllDone')}</span></p>` : `<p class="rows-empty muted small">${t('cw.catEmpty')}</p>`)}
          </div>
          ${done.length ? `<button class="done-toggle no-print" data-action="toggle-done" aria-expanded="${showDone}" aria-controls="done-${cat.id}">
              ${icon.chev}<span>${t('cw.doneCount', { n: done.length })}</span></button>
            <div class="rows rows-done" id="done-${cat.id}" data-cat="${cat.id}"${showDone ? '' : ' hidden'}>${showDone ? done.map((it) => rowHTML(it, dragOk)).join('') : ''}</div>` : ''}
          <form class="quick-add no-print" data-cat="${cat.id}">
            ${icon.plus}<input type="text" dir="auto" value="${esc(draft)}" placeholder="${t('cw.quickAdd')}" aria-label="${t('cw.quickAddLabel', { name: cat.name })}" data-keep="qa-${cat.id}">
          </form>
        </section>`;
    }).join('');

    panel.innerHTML = `
      <div class="cw-body">
        <div class="cw-main">
          <div class="cats">${cats || (filtering()
            ? ui.empty(t('cw.noMatch'))
            : ui.empty(`${t('cw.noCats')}<br><button class="btn btn-primary" data-action="template">${t('cw.makeTemplate')}</button>`))}</div>
          <div class="cw-add no-print"><button class="btn btn-ghost" data-action="add-cat">${icon.plus}<span>${t('cw.addCat')}</span></button></div>
        </div>
        ${asideHTML(c)}
      </div>`;

    bindItems(panel, c);
    ui.justChecked = null;
    // restore keyboard focus after re-render
    if (view.focusId && (document.activeElement === document.body || !document.activeElement)) {
      const r = panel.querySelector(`.row[data-id="${view.focusId}"]`);
      if (r) r.focus({ preventScroll: true });
    }
  }

  /** Side column (stacks under the items on phones): grade estimate, weekly hours, links and description. */
  function asideHTML(c) {
    const parts = [];
    const comps = c.grade && c.grade.components || [];
    if (comps.length && CT.grades) {
      const r = CT.grades.compute(c.grade);
      const big = r.final != null ? r.final : r.avgSoFar;
      parts.push(`<section class="card cw-side-card" aria-labelledby="gs-h">
          <div class="card-head"><h2 id="gs-h">${t(r.final != null ? 'cw.gradeFinal' : 'cw.gradeSoFar')}</h2><button class="linkish small" data-action="tab-grades">${t('cw.tab.grades')}</button></div>
          <p class="cw-big"><b>${u.isNum(big) ? ui.num(big, 1) : '—'}</b>${c.grade.target ? `<span class="muted small">${t('cw.target', { n: ui.num(c.grade.target) })}</span>` : ''}</p>
          <ul class="cw-kv">${comps.map((x) => `<li><span dir="auto">${esc(x.name || tx('cw.component'))}</span><span class="muted small">${ui.num(Number(x.weight) || 0)}%</span><b>${u.isNum(x.score) ? ui.num(x.score) : '—'}</b></li>`).join('')}</ul>
        </section>`);
    }
    const slots = (c.schedule || []).slice().sort((a, b) => a.day - b.day || u.timeToMin(a.start) - u.timeToMin(b.start));
    if (slots.length) {
      parts.push(`<section class="card cw-side-card" aria-labelledby="hr-h">
          <div class="card-head"><h2 id="hr-h">${t('cw.hours')}</h2><a class="small" href="#/schedule">${t('td.schedule')}</a></div>
          <ul class="cw-kv">${slots.map((s) => `<li><span>${esc(M.SLOT_TYPES[s.type] ? tx('slot.' + s.type) : '')} · ${esc(ui.dayName(s.day, 'short'))}</span><span class="muted small" dir="auto">${esc(s.room || '')}</span><b dir="ltr">${esc(s.start)}–${esc(s.end)}</b></li>`).join('')}</ul>
        </section>`);
    }
    const links = (c.links || []).filter((l) => u.safeUrl(l.url));
    if (links.length || c.description) {
      parts.push(`<section class="card cw-side-card" aria-labelledby="ln-h">
          <div class="card-head"><h2 id="ln-h">${t('cw.about')}</h2></div>
          ${c.description ? `<p class="cw-desc" dir="auto">${u.rich(c.description)}</p>` : ''}
          ${links.length ? `<div class="cw-links">${links.map((l) => `<a class="chip-link" href="${esc(u.safeUrl(l.url))}" target="_blank" rel="noopener noreferrer">${icon.link}<span dir="auto">${esc(l.label || l.url)}</span></a>`).join('')}</div>` : ''}
        </section>`);
    }
    return parts.length ? `<aside class="cw-aside" aria-label="${t('cw.asideLabel')}">${parts.join('')}</aside>` : '';
  }

  function rowHTML(it, dragOk) {
    const open = view.openNotes.has(it.id);
    const done = it.status === 'done';
    const days = it.due ? u.daysUntil(it.due) : null;
    const dueCls = done ? '' : days < 0 ? ' is-late' : days <= 3 ? ' is-soon' : '';
    const firstLine = (it.note || '').split('\n')[0].slice(0, 120);
    const safeLink = u.safeUrl(it.link);
    const subs = it.subs || [];
    const subsDone = subs.filter((s) => s.done).length;
    const showStatus = it.status === 'doing' || it.status === 'review';
    const meta = [
      it.due ? `<button class="due-chip${dueCls}" data-action="edit-due" title="${esc(ui.date(it.due, 'full'))}" aria-label="${t('cw.dueLabel', { date: ui.date(it.due, 'full') })}" tabindex="-1">${dueCls === ' is-late' ? icon.alert : icon.calendar}<span>${esc(done ? ui.date(it.due, 'short') : ui.rel(it.due))}</span></button>` : '',
      showStatus ? `<button class="pill st-${it.status}" data-action="status-menu" aria-label="${t('cw.statusLabel', { status: ui.statusLabel(it.status) })}" tabindex="-1">${esc(ui.statusLabel(it.status))}</button>` : '',
      subs.length ? `<button class="subs-chip${subsDone === subs.length ? ' all' : ''}" data-action="subs" tabindex="-1" aria-label="${t('cw.subs', { n: subsDone, m: subs.length })}">${icon.check}${ui.num(subsDone)}/${ui.num(subs.length)}</button>` : '',
      it.tags.map((x) => `<span class="tag" dir="auto">${esc(x)}</span>`).join(''),
      CT.views.moodle.badges(it),
      it.note && !open ? `<span class="note-snippet" data-action="toggle-note" dir="auto">${icon.note}<span>${esc(firstLine)}</span></span>` : '',
    ].filter(Boolean).join('');
    return `
      <div class="row st-${it.status}${it.flag ? ' flagged' : ''}${ui.justChecked === it.id ? ' just-checked' : ''}" data-id="${it.id}" tabindex="0" aria-label="${esc(it.title)} — ${esc(ui.statusLabel(it.status))}">
        <div class="row-main">
          ${dragOk ? `<button class="drag-handle no-print" tabindex="-1" aria-label="${t('cw.dragItem')}">${icon.grip}</button>` : ''}
          <button class="check" role="checkbox" aria-checked="${done}" data-action="toggle" aria-label="${t('cw.markDone', { title: it.title })}" tabindex="-1">${icon.check}</button>
          <div class="row-title">
            <span class="title-line"><span class="title-text" data-action="edit-title" dir="auto">${esc(it.title)}</span>${safeLink ? `<a class="row-link" href="${esc(safeLink)}" target="_blank" rel="noopener noreferrer" aria-label="${t('cw.openLink')}" tabindex="-1">${icon.link}</a>` : ''}</span>
            ${meta ? `<span class="row-meta">${meta}</span>` : ''}
          </div>
          <div class="row-tools">
            <button class="icon-btn opt note-btn${it.note ? ' has-note on' : ''}" data-action="toggle-note" aria-expanded="${open}" aria-label="${t(it.note ? 'cw.noteEdit' : 'cw.noteAdd')}" title="${t('cw.noteTitle')}" tabindex="-1">${icon.note}</button>
            <button class="icon-btn opt flag-btn${it.flag ? ' on' : ''}" data-action="flag" aria-pressed="${it.flag}" aria-label="${t('cw.flag')}" title="${t('cw.flagTitle')}" tabindex="-1">${icon.star}</button>
            ${it.due ? '' : `<button class="icon-btn opt due-btn" data-action="edit-due" aria-label="${t('cw.dueSet')}" title="${t('cw.dueSet')}" tabindex="-1">${icon.calendar}</button>`}
            ${showStatus ? '' : `<button class="icon-btn opt st-btn" data-action="status-menu" aria-label="${t('cw.statusLabel', { status: ui.statusLabel(it.status) })}" title="${t('cw.statusTitle')}" tabindex="-1"><span class="st-dot st-${it.status}"></span></button>`}
            <button class="icon-btn" data-action="row-menu" aria-label="${t('cw.rowMenu', { title: it.title })}" aria-haspopup="menu" tabindex="-1">${icon.more}</button>
          </div>
        </div>
        ${open ? `<div class="note-area">
          <textarea class="note-input" dir="auto" rows="2" data-id="${it.id}" placeholder="${t('cw.notePh')}" aria-label="${t('cw.noteFor', { title: it.title })}">${esc(it.note)}</textarea>
          <div class="note-preview"${/\$/.test(it.note) ? '' : ' hidden'}>${u.rich(it.note)}</div>
        </div>` : ''}
        ${it.note ? `<div class="note-print" dir="auto">${u.rich(it.note)}</div>` : ''}
      </div>`;
  }

  function highlightItem(root, itemId) {
    const r = root.querySelector(`.row[data-id="${itemId}"]`);
    if (!r) return;
    r.scrollIntoView({ block: 'center' });
    r.classList.add('flash');
    r.focus({ preventScroll: true });
  }

  /** Selected tab goes into the address (replace, no new history entry), so reload and links keep it. */
  function setTab(root, c, tab, focus) {
    view.tab = tab;
    const h = `#/course/${c.id}${tab === 'items' ? '' : `?tab=${tab}`}`;
    if (location.hash !== h) {
      history.replaceState(null, '', h);
      if (CT.app) { CT.app.lastRoute = h; CT.app.lastPath = h.split('?')[0]; }
    }
    V.render(root, { id: c.id, tab });
    if (focus) { const b = root.querySelector(`[data-tab="${tab}"]`); if (b) b.focus(); }
  }

  /* ================= events ================= */
  function bindHead(root, c) {
    root.querySelector('.cw-head').addEventListener('click', (e) => {
      const a = e.target.closest('[data-action]');
      if (!a) return;
      if (a.dataset.action === 'course-menu') courseMenu(a, c);
      if (a.dataset.action === 'switch') switchMenu(a, c);
      if (a.dataset.action === 'bulk-add') V.bulkAdd(c);
    });
    const bar = root.querySelector('.cw-bar');
    bar.addEventListener('click', (e) => {
      const tb = e.target.closest('[data-tab]');
      if (tb) { setTab(root, c, tb.dataset.tab, true); return; }
      const f = e.target.closest('[data-action="filter"]');
      if (f) { view.filter = f.dataset.filter; CT.app.rerender(); const b = document.querySelector(`.cw-f[data-filter="${view.filter}"]`); if (b) b.focus(); }
    });
    bar.addEventListener('change', (e) => {
      if (e.target.matches('[data-action="tag-filter"]')) { view.tag = e.target.value; CT.app.rerender(); }
    });
    // tabs: arrow keys move between them (WAI-ARIA tabs pattern)
    bar.addEventListener('keydown', (e) => {
      const tb = e.target.closest('[role=tab]');
      if (!tb) return;
      const all = [...bar.querySelectorAll('[role=tab]')];
      const i = all.indexOf(tb);
      const rtl = getComputedStyle(bar).direction === 'rtl';
      const step = { ArrowRight: rtl ? -1 : 1, ArrowLeft: rtl ? 1 : -1, Home: -i, End: all.length - 1 - i }[e.key];
      if (step === undefined) return;
      e.preventDefault();
      e.stopPropagation();
      setTab(root, c, all[(i + step + all.length) % all.length].dataset.tab, true);
    });
  }

  function bindItems(panel, c) {
    panel.addEventListener('click', (e) => {
      const a = e.target.closest('[data-action]');
      if (!a) return;
      const row = a.closest('.row');
      const id = row && row.dataset.id;
      const catEl = a.closest('.cat');
      const catId = catEl && catEl.dataset.id;
      switch (a.dataset.action) {
        case 'toggle': S.toggleDone(id); break;
        case 'toggle-note': toggleNote(id); break;
        case 'flag': toggleFlag(id); break;
        case 'subs': if (CT.focus) CT.focus.openSubs(id); break;
        case 'status-menu': ui.statusMenu(a, id); break;
        case 'edit-due': editDue(id); break;
        case 'row-menu': rowMenu(a, id); break;
        case 'moodle-changed': case 'moodle-gone': case 'moodle-merge': CT.views.moodle.rowAction(a.dataset.action, id, a); break;
        case 'edit-title': if (e.detail === 1) setTimeout(() => editTitleInline(a, id), 0); break;
        case 'cat-menu': catMenu(a, c, catId); break;
        case 'toggle-done': {
          if (view.showDone.has(catId)) view.showDone.delete(catId); else view.showDone.add(catId);
          CT.app.rerender();
          const b = document.querySelector(`.cat[data-id="${catId}"] .done-toggle`);
          if (b) b.focus();
          break;
        }
        case 'add-cat': addCategory(c); break;
        case 'template': V.templateDialog(c); break;
        case 'tab-grades': setTab(panel.closest('.cw').parentElement, c, 'grades', true); break;
        default: break;
      }
    });
    panel.addEventListener('dblclick', (e) => {
      const h = e.target.closest('[data-action="rename-cat"]');
      if (h) renameCat(h.closest('.cat').dataset.id);
    });
    panel.addEventListener('submit', (e) => {
      e.preventDefault();
      const form = e.target.closest('.quick-add');
      const inp = form.querySelector('input');
      const title = inp.value.trim();
      if (!title) return;
      const catId = form.dataset.cat;
      delete view.drafts[catId];
      S.commit(tx('cw.u.addItem'), () => { S.findCat(catId).cat.items.push(M.newItem(title)); });
      const again = document.querySelector(`.quick-add[data-cat="${catId}"] input`);
      if (again) again.focus();
    });
    panel.addEventListener('focusin', (e) => {
      const r = e.target.closest('.row');
      if (r) view.focusId = r.dataset.id;
    });
    panel.addEventListener('input', (e) => {
      // quick-add text survives re-renders (another item checked, a sync) until it is added
      if (e.target.matches('.quick-add input')) { view.drafts[e.target.closest('.quick-add').dataset.cat] = e.target.value; return; }
      // notes: autosave while typing (silent → no re-render, so the cursor stays)
      if (!e.target.matches('.note-input')) return;
      const ta = e.target, id = ta.dataset.id;
      autosize(ta);
      S.commit(tx('cw.u.note'), () => { const f = S.findItem(id); if (f) f.item.note = ta.value; }, { silent: true, coalesce: 'note:' + id });
      const row = ta.closest('.row');
      row.querySelector('.note-btn').classList.toggle('has-note', !!ta.value.trim());
      updatePreview(ta);
    });
    panel.addEventListener('keydown', (e) => {
      if (e.target.matches('.note-input') && e.key === 'Escape') {
        e.preventDefault();
        const row = e.target.closest('.row');
        view.openNotes.delete(row.dataset.id);
        view.focusId = row.dataset.id;
        CT.app.rerender();
        const r = document.querySelector(`.row[data-id="${row.dataset.id}"]`);
        if (r) r.focus();
      }
    });
    panel.querySelectorAll('.note-input').forEach(autosize);

    // drag & drop: rows inside a category (open and completed groups separately), and the categories themselves
    if (!filtering()) {
      panel.querySelectorAll('.rows').forEach((rowsEl) => ui.sortable(rowsEl, {
        item: '.row', handle: '.drag-handle',
        onEnd: (ids) => S.commit(tx('cw.u.order'), () => ui.reorderSome(S.findCat(rowsEl.dataset.cat).cat.items, ids)),
      }));
      const catsEl = panel.querySelector('.cats');
      ui.sortable(catsEl, {
        item: '.cat', handle: '.cat-head > .drag-handle',
        onEnd: (ids) => S.commit(tx('cw.u.catOrder'), () => ui.reorder(S.course(c.id).categories, ids)),
      });
    }
  }

  const autosize = (ta) => { ta.style.height = 'auto'; ta.style.height = Math.min(ta.scrollHeight + 2, 420) + 'px'; };
  const updatePreview = u.debounce((ta) => {
    const pv = ta.parentElement && ta.parentElement.querySelector('.note-preview');
    if (!pv) return;
    pv.hidden = !/\$/.test(ta.value);
    pv.innerHTML = u.rich(ta.value);
  }, 250);

  /* ================= item actions ================= */
  function toggleNote(id) {
    const opening = !view.openNotes.has(id);
    if (opening) view.openNotes.add(id); else view.openNotes.delete(id);
    view.focusId = id;
    CT.app.rerender();
    if (opening) {
      const ta = document.querySelector(`.note-input[data-id="${id}"]`);
      if (ta) { ta.focus(); ta.setSelectionRange(ta.value.length, ta.value.length); }
    }
  }
  V.toggleNote = toggleNote;

  function toggleFlag(id) {
    S.commit(tx('cw.u.flag'), () => { const f = S.findItem(id); f.item.flag = !f.item.flag; });
  }
  V.toggleFlag = toggleFlag;

  function editTitleInline(span, id) {
    const f = S.findItem(id);
    if (!f || !span.isConnected) return;
    const inp = document.createElement('input');
    inp.className = 'title-input';
    inp.dir = 'auto';
    inp.value = f.item.title;
    inp.setAttribute('aria-label', tx('cw.itemName'));
    span.replaceWith(inp);
    inp.focus();
    inp.select();
    let done = false;
    const finish = (save) => {
      if (done) return;
      done = true;
      const v = inp.value.trim();
      view.focusId = id;
      if (save && v && v !== f.item.title) S.commit(tx('cw.u.rename'), () => { S.findItem(id).item.title = v; });
      else CT.app.rerender();
    };
    inp.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') { e.preventDefault(); finish(true); }
      if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); finish(false); }
      e.stopPropagation();
    });
    inp.addEventListener('blur', () => finish(true));
  }

  function editDue(id) {
    const f = S.findItem(id);
    ui.modal({
      title: tx('cw.dueTitle', { title: f.item.title }),
      localized: true,
      body: `<label class="field"><span>${t('cw.date')}</span><input type="date" value="${esc(f.item.due)}"></label>`,
      actions: [
        f.item.due && { label: tx('cw.dueRemove'), fn: () => S.commit(tx('cw.u.dueRemove'), () => { S.findItem(id).item.due = ''; }) },
        { label: tx('common.cancel') },
        { label: tx('common.save'), primary: true, fn: (m) => { const v = m.body.querySelector('input').value; S.commit(tx('cw.u.due'), () => { S.findItem(id).item.due = v; }); } },
      ].filter(Boolean),
    });
  }
  V.editDue = editDue;

  V.itemDetails = (id) => {
    const f = S.findItem(id);
    if (!f) return;
    const it = f.item;
    ui.modal({
      title: tx('cw.details'),
      localized: true,
      wide: true,
      body: `
        <div class="form-grid">
          <label class="field span-2"><span>${t('cw.d.title')}</span><input name="title" dir="auto" value="${esc(it.title)}"></label>
          <label class="field"><span>${t('cw.d.status')}</span><select name="status">${M.STATUS_ORDER.map((s) => `<option value="${s}" ${s === it.status ? 'selected' : ''}>${esc(ui.statusLabel(s))}</option>`).join('')}</select></label>
          <label class="field"><span>${t('cw.d.due')}</span><input type="date" name="due" value="${esc(it.due)}"></label>
          <label class="field span-2"><span>${t('cw.d.link')}</span><input name="link" dir="ltr" placeholder="https://..." value="${esc(it.link)}"></label>
          <label class="field span-2"><span>${t('cw.d.tags')}</span><input name="tags" dir="auto" placeholder="${t('cw.d.tagsPh')}" value="${esc(it.tags.join(', '))}"></label>
          <label class="check-field span-2"><input type="checkbox" name="flag" ${it.flag ? 'checked' : ''}> ${t('cw.flag')}</label>
          ${CT.game ? `<label class="field"><span>${t('cw.d.diff')}</span><select name="diff">
            <option value="">${t('cw.d.diffAuto', { level: tx('cw.diff.' + CT.game.difficulty({ title: it.title }, f.cat)) })}</option>
            ${[1, 2, 3].map((d) => `<option value="${d}" ${Number(it.diff) === d ? 'selected' : ''}>${t('cw.diff.' + d)}</option>`).join('')}
          </select></label>` : ''}
          <label class="field span-2"><span>${t('cw.d.note')}</span><textarea name="note" dir="auto" rows="6">${esc(it.note)}</textarea></label>
        </div>
        ${it.completedAt ? `<p class="muted">${t('cw.d.completed', { date: ui.date(it.completedAt, 'full') })}</p>` : ''}`,
      actions: [
        { label: tx('common.cancel') },
        {
          label: tx('common.save'), primary: true, fn: (m) => {
            const g = (n) => m.body.querySelector(`[name="${n}"]`);
            S.commit(tx('cw.u.edit'), () => {
              const x = S.findItem(id).item;
              x.title = g('title').value.trim() || x.title;
              if (g('status').value !== x.status) {
                if (g('status').value === 'done' && x.status === 'review') x.fromReview = true;
                else if (g('status').value !== 'done') delete x.fromReview;
                x.status = g('status').value;
                x.completedAt = x.status === 'done' ? new Date().toISOString() : null;
              }
              x.due = g('due').value;
              x.link = g('link').value.trim();
              x.tags = g('tags').value.split(/[,،]/).map((s) => s.trim()).filter(Boolean);
              x.flag = g('flag').checked;
              x.note = g('note').value;
              if (g('diff')) { if (g('diff').value) x.diff = Number(g('diff').value); else delete x.diff; }
            });
          },
        },
      ],
    });
  };

  V.deleteItem = (id) => {
    const f = S.findItem(id);
    if (!f) return;
    S.commit(tx('cw.u.delete'), () => { const x = S.findItem(id); x.cat.items.splice(x.cat.items.indexOf(x.item), 1); });
    ui.toast(tx('cw.deleted', { title: f.item.title }), { action: { label: tx('common.undo'), fn: S.undo } });
  };

  V.moveItem = (id, dir) => S.commit(tx('cw.u.move'), () => {
    const { cat, item } = S.findItem(id);
    const i = cat.items.indexOf(item), j = i + dir;
    if (j < 0 || j >= cat.items.length) return;
    cat.items.splice(i, 1);
    cat.items.splice(j, 0, item);
  });

  function rowMenu(anchor, id) {
    const f = S.findItem(id);
    const others = f.course.categories.filter((c) => c !== f.cat);
    const row = anchor.closest('.row');
    ui.menu(anchor, [
      { label: tx('cw.m.details'), icon: 'edit', hint: 'E', fn: () => V.itemDetails(id) },
      { label: tx('cw.m.status'), icon: 'check', hint: 'S', fn: () => ui.statusMenu(row ? row.querySelector('[data-action="status-menu"]') || anchor : anchor, id) },
      { label: tx(f.item.due ? 'cw.m.dueChange' : 'cw.dueSet'), icon: 'calendar', fn: () => editDue(id) },
      { label: tx(f.item.note ? 'cw.noteEdit' : 'cw.noteAdd'), icon: 'note', hint: 'Enter', fn: () => toggleNote(id) },
      { label: tx(f.item.flag ? 'cw.m.unflag' : 'cw.flag'), icon: 'star', hint: 'F', fn: () => toggleFlag(id) },
      '-',
      CT.focus && f.item.status !== 'done' && { label: tx('td.five'), icon: 'timer', fn: () => CT.focus.start(id, 5) },
      CT.focus && f.item.status !== 'done' && { label: tx('cw.m.focus'), icon: 'timer', fn: () => CT.focus.start(id, S.state.settings.pomodoro.work || 25) },
      CT.focus && { label: tx('cw.m.subs'), icon: 'check', fn: () => CT.focus.openSubs(id) },
      { label: tx('cw.m.up'), icon: 'up', hint: 'Alt+↑', fn: () => V.moveItem(id, -1) },
      { label: tx('cw.m.down'), icon: 'down', hint: 'Alt+↓', fn: () => V.moveItem(id, 1) },
      others.length && { label: tx('cw.m.moveTo'), icon: 'archive', fn: () => moveToCat(id) },
      { label: tx('cw.m.duplicate'), icon: 'plus', fn: () => S.commit(tx('cw.u.duplicate'), () => {
        const x = S.findItem(id);
        x.cat.items.splice(x.cat.items.indexOf(x.item) + 1, 0, M.newItem(tx('cw.copyOf', { title: x.item.title }), { tags: [...x.item.tags], note: x.item.note }));
      }) },
      '-',
      { label: tx('cw.m.delete'), icon: 'trash', danger: true, hint: 'Del', fn: () => V.deleteItem(id) },
    ], { localized: true });
  }

  function moveToCat(id) {
    const f = S.findItem(id);
    const opts = f.course.categories.filter((c) => c !== f.cat);
    ui.modal({
      title: tx('cw.moveTitle'),
      localized: true,
      body: `<label class="field"><span>${t('cw.moveTarget')}</span><select>${opts.map((c) => `<option value="${c.id}">${esc(c.name)}</option>`).join('')}</select></label>`,
      actions: [{ label: tx('common.cancel') }, {
        label: tx('cw.moveOk'), primary: true, fn: (m) => {
          const to = m.body.querySelector('select').value;
          S.commit(tx('cw.u.moveTo'), () => {
            const x = S.findItem(id);
            x.cat.items.splice(x.cat.items.indexOf(x.item), 1);
            S.findCat(to).cat.items.push(x.item);
          });
        },
      }],
    });
  }

  /* ================= categories ================= */
  async function addCategory(c) {
    const name = await ui.prompt(tx('cw.newCat'), '', tx('cw.newCatLabel'), { localized: true });
    if (name) S.commit(tx('cw.u.addCat'), () => S.course(c.id).categories.push(M.newCategory(name)));
  }
  async function renameCat(catId) {
    const { cat } = S.findCat(catId);
    const name = await ui.prompt(tx('cw.renameCat'), cat.name, '', { localized: true });
    if (name && name !== cat.name) S.commit(tx('cw.u.renameCat'), () => { S.findCat(catId).cat.name = name; });
  }
  function catMenu(anchor, c, catId) {
    const { cat } = S.findCat(catId);
    const idx = c.categories.indexOf(cat);
    const moveCat = (d) => S.commit(tx('cw.u.catOrder'), () => {
      const cats = S.course(c.id).categories, i = cats.findIndex((x) => x.id === catId);
      if (i + d < 0 || i + d >= cats.length) return;
      cats.splice(i + d, 0, cats.splice(i, 1)[0]);
    });
    ui.menu(anchor, [
      { label: tx('cw.c.rename'), icon: 'edit', fn: () => renameCat(catId) },
      { label: tx('cw.c.bulk'), icon: 'plus', fn: () => V.bulkAdd(c, catId) },
      { label: tx('cw.c.allDone'), icon: 'check', fn: () => S.commit(tx('cw.u.allDone'), () => {
        S.findCat(catId).cat.items.forEach((i) => { if (i.status !== 'done') { i.status = 'done'; i.completedAt = new Date().toISOString(); } });
      }) },
      idx > 0 && { label: tx('cw.m.up'), icon: 'up', fn: () => moveCat(-1) },
      idx < c.categories.length - 1 && { label: tx('cw.m.down'), icon: 'down', fn: () => moveCat(1) },
      '-',
      { label: tx('cw.c.delete'), icon: 'trash', danger: true, fn: async () => {
        if (cat.items.length && !(await ui.confirm(tx('cw.c.deleteConfirm', { name: cat.name, n: cat.items.length }), tx('cp.deleteOk'), true, { localized: true }))) return;
        S.commit(tx('cw.u.deleteCat'), () => { const cs = S.course(c.id).categories; cs.splice(cs.findIndex((x) => x.id === catId), 1); });
        ui.toast(tx('cw.c.deleted'), { action: { label: tx('common.undo'), fn: S.undo } });
      } },
    ], { localized: true });
  }

  /* ================= bulk add & template ================= */
  V.bulkAdd = (c, presetCatId) => {
    const catOpts = c.categories.map((cat) => `<option value="${cat.id}" ${cat.id === presetCatId ? 'selected' : ''}>${esc(cat.name)}</option>`).join('');
    const m = ui.modal({
      title: tx('cw.b.title'),
      localized: true,
      body: `
        <div class="form-grid">
          <label class="field span-2"><span>${t('cw.b.cat')}</span>
            <select name="cat">${catOpts}<option value="__new">${t('cw.b.newCatOpt')}</option></select></label>
          <label class="field span-2" data-newcat hidden><span>${t('cw.b.newCat')}</span><input name="newcat" dir="auto" placeholder="${t('cw.b.newCatPh')}"></label>
          <label class="field"><span>${t('cw.b.count')}</span><input type="number" name="count" min="1" max="200" value="13"></label>
          <label class="field"><span>${t('cw.b.start')}</span><input type="number" name="start" min="0" value="1"></label>
          <label class="field span-2"><span>${t('cw.b.pattern', { n: '{n}' })}</span><input name="pattern" dir="auto" value="${t('cw.b.patternDefault', { n: '{n}' })}"></label>
          <label class="field"><span>${t('cw.b.due')}</span><input type="date" name="due"></label>
          <label class="field"><span>${t('cw.b.every')}</span><input type="number" name="every" min="1" value="7"></label>
        </div>
        <p class="muted preview-line" aria-live="polite"></p>`,
      actions: [{ label: tx('common.cancel') }, {
        label: tx('cw.b.create'), primary: true, fn: (api) => {
          const g = (n) => api.body.querySelector(`[name="${n}"]`);
          const count = Math.min(200, Math.max(1, parseInt(g('count').value, 10) || 0));
          const start = parseInt(g('start').value, 10) || 1;
          const pattern = g('pattern').value.trim() || tx('cw.b.patternFallback', { n: '{n}' });
          const due = g('due').value, every = parseInt(g('every').value, 10) || 7;
          const catId = g('cat').value;
          const newName = g('newcat').value.trim();
          if (catId === '__new' && !newName) { g('newcat').focus(); return false; }
          S.commit(tx('cw.u.bulk', { n: count }), () => {
            const course = S.course(c.id);
            let cat;
            if (catId === '__new') { cat = M.newCategory(newName); course.categories.push(cat); } else cat = course.categories.find((x) => x.id === catId);
            const items = M.makeItems(pattern, count, start);
            if (due) items.forEach((it, i) => { it.due = u.addDays(due, i * every); });
            cat.items.push(...items);
          });
          ui.toast(tx('cw.b.done', { n: count }), { action: { label: tx('common.undo'), fn: S.undo } });
          return true;
        },
      }],
    });
    const g = (n) => m.body.querySelector(`[name="${n}"]`);
    const refresh = () => {
      const isNew = g('cat').value === '__new';
      m.body.querySelector('[data-newcat]').hidden = !isNew;
      const cat = c.categories.find((x) => x.id === g('cat').value);
      const count = Math.max(1, parseInt(g('count').value, 10) || 1);
      const start = parseInt(g('start').value, 10) || 1;
      const names = M.makeItems(g('pattern').value || tx('cw.b.patternFallback', { n: '{n}' }), Math.min(count, 3), start).map((x) => x.title);
      m.body.querySelector('.preview-line').textContent = tx(cat ? 'cw.b.previewIn' : 'cw.b.preview', { n: count, names: names.join(', ') + (count > 3 ? ', …' : ''), cat: cat ? cat.name : '' });
    };
    const syncStart = () => {
      const cat = c.categories.find((x) => x.id === g('cat').value);
      g('start').value = cat ? cat.items.length + 1 : 1;
      if (cat) {
        const guess = cat.items[0] && cat.items[0].title.replace(/\d+/, '{n}');
        if (guess && guess.includes('{n}')) g('pattern').value = guess;
      }
    };
    g('cat').addEventListener('change', () => { syncStart(); refresh(); });
    m.body.addEventListener('input', refresh);
    if (c.categories.length) syncStart(); else g('cat').value = '__new';
    refresh();
  };

  V.templateDialog = (c) => {
    const tpl = CT.store.state.settings.template;
    const rowT = (x) => `<div class="tpl-row">
        <input name="name" dir="auto" value="${esc(x.name)}" aria-label="${t('cw.t.cat')}">
        <input name="count" type="number" min="0" value="${esc(x.count)}" aria-label="${t('cw.b.count')}">
        <input name="pattern" dir="auto" value="${esc(x.pattern)}" aria-label="${t('cw.t.pattern')}">
        <button class="icon-btn" data-del aria-label="${t('cw.t.remove')}">${icon.trash}</button></div>`;
    const m = ui.modal({
      title: tx('cw.t.title'),
      localized: true,
      wide: true,
      body: `<p class="muted">${t('cw.t.hint', { n: '{n}' })}</p>
        <div class="tpl-head muted"><span>${t('cw.t.cat')}</span><span>${t('cw.b.count')}</span><span>${t('cw.t.pattern')}</span><span></span></div>
        <div class="tpl-rows">${tpl.map(rowT).join('')}</div>
        <button class="btn btn-ghost" data-add>${icon.plus} ${t('cw.t.row')}</button>
        <label class="check-field"><input type="checkbox" name="save"> ${t('cw.t.save')}</label>`,
      actions: [{ label: tx('common.cancel') }, {
        label: tx('cw.t.apply'), primary: true, fn: (api) => {
          const rows = [...api.body.querySelectorAll('.tpl-row')].map((r) => ({
            name: r.querySelector('[name=name]').value.trim(),
            count: parseInt(r.querySelector('[name=count]').value, 10) || 0,
            pattern: r.querySelector('[name=pattern]').value.trim(),
          })).filter((r) => r.name);
          S.commit(tx('cw.u.template'), (st) => {
            M.applyTemplate(S.course(c.id), rows);
            if (api.body.querySelector('[name=save]').checked) st.settings.template = rows;
          });
        },
      }],
    });
    m.body.addEventListener('click', (e) => {
      if (e.target.closest('[data-del]')) e.target.closest('.tpl-row').remove();
      if (e.target.closest('[data-add]')) m.body.querySelector('.tpl-rows').insertAdjacentHTML('beforeend', rowT({ name: '', count: 13, pattern: '{n}' }));
    });
  };

  /* ================= course create / edit ================= */
  /** `preset.semesterId`: the semester a new course goes into (the courses page passes the one on screen). */
  V.courseForm = (existing, preset = {}) => {
    const st = S.state;
    const c = existing || M.newCourse({ semesterId: preset.semesterId != null && preset.semesterId !== '' ? preset.semesterId : st.settings.activeSemesterId, color: M.COLORS[st.courses.length % M.COLORS.length] });
    const isNew = !existing;
    const linkRow = (l = {}) => `<div class="list-row"><input name="lbl" dir="auto" placeholder="${t('cw.f2.linkPh')}" value="${esc(l.label)}" aria-label="${t('cw.f2.linkName')}"><input name="url" dir="ltr" placeholder="https://" value="${esc(l.url)}" aria-label="${t('cw.f2.linkUrl')}"><button class="icon-btn" data-del aria-label="${t('cw.f2.remove')}">${icon.trash}</button></div>`;
    const examRow = (x = {}) => `<div class="list-row" data-id="${esc(x.id || '')}"><input name="lbl" dir="auto" placeholder="${t('cw.f2.examPh')}" value="${esc(x.label)}" aria-label="${t('cw.f2.examName')}"><input name="date" type="date" value="${esc(x.date)}" aria-label="${t('cw.date')}"><button class="icon-btn" data-del aria-label="${t('cw.f2.remove')}">${icon.trash}</button></div>`;
    const m = ui.modal({
      title: tx(isNew ? 'cw.f2.new' : 'cw.f2.edit'),
      localized: true,
      wide: true,
      body: `
        <div class="form-grid">
          <label class="field span-2"><span>${t('cw.f2.name')}</span><input name="name" dir="auto" value="${isNew ? '' : esc(c.name)}" placeholder="${t('cw.f2.namePh')}" required></label>
          <label class="field"><span>${t('cw.f2.number')}</span><input name="number" dir="ltr" value="${esc(c.number)}" placeholder="00440131"></label>
          <label class="field"><span>${t('cw.f2.credits')}</span><input name="credits" type="number" step="0.5" min="0" value="${esc(c.credits)}"></label>
          <label class="field"><span>${t('cw.f2.semester')}</span><select name="semester">${st.semesters.map((s) => `<option value="${s.id}" ${s.id === c.semesterId ? 'selected' : ''}>${esc(s.name)}</option>`).join('')}<option value="">${t('cw.f2.noSemester')}</option></select></label>
          <div class="field"><span>${t('cp.color')}</span><div class="swatches" role="radiogroup" aria-label="${t('cp.color')}">
            ${M.COLORS.map((col, i) => `<button type="button" class="swatch${col === c.color ? ' on' : ''}" style="background:${col}" data-color="${col}" role="radio" aria-checked="${col === c.color}" aria-label="${t('cp.colorN', { n: i + 1 })}"></button>`).join('')}
            <input type="color" name="color" value="${esc(c.color)}" aria-label="${t('cp.colorCustom')}">
          </div></div>
          <label class="field span-2"><span>${t('cw.f2.staff')}</span><input name="staff" dir="auto" value="${esc(c.staff)}"></label>
          <label class="field span-2"><span>${t('cw.f2.desc')}</span><textarea name="description" dir="auto" rows="2">${esc(c.description)}</textarea></label>
          <div class="field span-2"><span>${t('cw.f2.links')}</span><div class="list" data-list="links">${c.links.map(linkRow).join('')}</div><button type="button" class="btn btn-ghost" data-add="links">${icon.plus} ${t('cw.f2.link')}</button></div>
          <div class="field span-2"><span>${t('cw.f2.exams')}</span><div class="list" data-list="exams">${(c.exams || []).map(examRow).join('')}</div><button type="button" class="btn btn-ghost" data-add="exams">${icon.plus} ${t('cw.f2.exam')}</button></div>
          ${isNew ? `<label class="check-field span-2"><input type="checkbox" name="tpl" checked> <span>${t('cw.f2.tpl')} <span class="muted small" dir="auto">(${esc(st.settings.template.map((x) => `${x.count} ${x.name}`).join(', '))})</span></span></label>` : ''}
        </div>`,
      actions: [{ label: tx('common.cancel') }, {
        label: tx(isNew ? 'cw.f2.create' : 'common.save'), primary: true, fn: (api) => {
          const g = (n) => api.body.querySelector(`[name="${n}"]`);
          const name = g('name').value.trim();
          if (!name) { g('name').focus(); return false; }
          const links = [...api.body.querySelectorAll('[data-list=links] .list-row')].map((r) => ({ label: r.querySelector('[name=lbl]').value.trim(), url: r.querySelector('[name=url]').value.trim() })).filter((l) => l.url);
          const exams = [...api.body.querySelectorAll('[data-list=exams] .list-row')].map((r) => ({ id: r.dataset.id || u.uid(), label: r.querySelector('[name=lbl]').value.trim(), date: r.querySelector('[name=date]').value })).filter((x) => x.date || x.label);
          const fields = {
            name, number: g('number').value.trim(), credits: g('credits').value, semesterId: g('semester').value,
            color: g('color').value, staff: g('staff').value.trim(), description: g('description').value.trim(), links, exams,
          };
          if (isNew) {
            const nc = Object.assign(c, fields);
            if (g('tpl').checked) M.applyTemplate(nc, st.settings.template);
            S.commit(tx('cw.u.newCourse'), (s2) => s2.courses.push(nc));
            location.hash = `#/course/${nc.id}`;
          } else {
            S.commit(tx('cw.u.editCourse'), () => Object.assign(S.course(c.id), fields));
          }
          return true;
        },
      }],
    });
    m.body.addEventListener('click', (e) => {
      const sw = e.target.closest('[data-color]');
      if (sw) {
        m.body.querySelectorAll('.swatch').forEach((x) => { x.classList.toggle('on', x === sw); x.setAttribute('aria-checked', x === sw); });
        m.body.querySelector('[name=color]').value = sw.dataset.color;
      }
      const add = e.target.closest('[data-add]');
      if (add) m.body.querySelector(`[data-list="${add.dataset.add}"]`).insertAdjacentHTML('beforeend', add.dataset.add === 'links' ? linkRow() : examRow());
      const del = e.target.closest('[data-del]');
      if (del) del.closest('.list-row').remove();
    });
  };

  /* ================= finish course: final grade / outcome ================= */
  V.finishDialog = (c) => {
    const o = c.outcome || {};
    const calc = CT.grades.compute(c.grade);
    const suggested = u.isNum(calc.final) ? +calc.final.toFixed(2) : null;
    const rules = S.state.settings.gpa;
    const isNew = !M.isFinished(c);
    const typeSel = Object.keys(M.OUTCOMES).map((k) => `<option value="${k}" ${(o.type || 'graded') === k ? 'selected' : ''}>${esc(ui.outcomeLabel(k))}</option>`).join('');
    const m = ui.modal({
      title: tx(isNew ? 'cw.fin.title' : 'cw.fin.editTitle', { name: c.name }),
      localized: true,
      body: `<div class="form-grid">
        <label class="field"><span>${t('cw.fin.type')}</span><select name="type">${typeSel}</select></label>
        <label class="field" data-show="grade"><span>${t('cw.fin.grade')}</span><input name="grade" type="number" min="0" max="100" step="any" inputmode="decimal" value="${u.isNum(o.grade) ? o.grade : (isNew && suggested != null ? suggested : '')}"></label>
        <label class="field"><span>${t('cw.fin.date')}</span><input name="date" type="date" value="${esc(o.date || u.today())}"></label>
        <label class="field"><span>${t('cw.fin.note')}</span><input name="note" dir="auto" value="${esc(o.note || '')}" placeholder="${t('cw.fin.notePh')}"></label>
        <label class="check-field span-2" data-show="exempt"><input type="checkbox" name="exemptCredits" ${(o.exemptCredits ?? rules.exemptCredits) ? 'checked' : ''}> ${t('cw.fin.exempt')}</label>
      </div>
      ${suggested != null ? `<p class="small finish-suggest" data-show="grade">${t('cw.fin.suggest')} <b>${ui.num(suggested)}</b>
        <button type="button" class="btn btn-small btn-ghost" data-fill>${t('cw.fin.fill')}</button><br><span class="muted">${t('cw.fin.official')}</span></p>`
        : (calc.remaining && calc.remaining.length && c.grade.components.length ? `<p class="muted small">${t('cw.fin.missing', { n: calc.remaining.length })}</p>` : '')}
      <p class="muted small">${t('cw.fin.note2')}</p>`,
      actions: [
        ...(isNew ? [] : [{ label: tx('cw.fin.undo'), danger: true, fn: () => {
          S.commit(tx('cw.fin.undo'), () => { S.course(c.id).outcome = null; });
          ui.toast(tx('cw.fin.undone'), { action: { label: tx('common.undo'), fn: S.undo } });
        } }]),
        { label: tx('common.close') },
        { label: tx(isNew ? 'cw.fin.ok' : 'common.save'), primary: true, fn: (api) => {
          const g = (n) => api.body.querySelector(`[name=${n}]`);
          const type = g('type').value;
          const raw = g('grade').value.trim();
          const grade = raw === '' ? null : Number(raw);
          if (type === 'graded' && !(grade >= 0 && grade <= 100)) { g('grade').focus(); ui.toast(tx('cw.fin.needGrade'), { error: true }); return false; }
          if (type === 'failed' && grade != null && !(grade >= 0 && grade <= 100)) { g('grade').focus(); return false; }
          const outcome = {
            type, grade: type === 'graded' || type === 'failed' ? grade : null,
            date: g('date').value, note: g('note').value.trim(), exemptCredits: g('exemptCredits').checked,
            fromCalc: suggested != null && grade === suggested,
          };
          S.commit(tx(isNew ? 'cw.fin.ok' : 'cw.u.finishEdit'), () => { S.course(c.id).outcome = outcome; });
          ui.toast(isNew ? tx('cw.fin.doneToast', { name: c.name }) : tx('cw.fin.updated'), { action: { label: tx('common.undo'), fn: S.undo } });
          return true;
        } },
      ],
    });
    const sync = () => {
      const ty = m.body.querySelector('[name=type]').value;
      m.body.querySelectorAll('[data-show=grade]').forEach((el) => { el.hidden = !(ty === 'graded' || ty === 'failed'); });
      m.body.querySelectorAll('[data-show=exempt]').forEach((el) => { el.hidden = ty !== 'exempt'; });
    };
    m.body.querySelector('[name=type]').addEventListener('change', sync);
    const fill = m.body.querySelector('[data-fill]');
    if (fill) fill.onclick = () => { m.body.querySelector('[name=grade]').value = suggested; };
    sync();
  };

  function courseMenu(anchor, c) {
    const P = CT.views.courses;
    ui.menu(anchor, [
      { label: tx('cp.edit'), icon: 'edit', fn: () => V.courseForm(c) },
      { label: tx(M.isFinished(c) ? 'cw.m.finishEdit' : 'cw.m.finish'), icon: 'award', fn: () => V.finishDialog(c) },
      P && { label: tx('cp.color'), icon: 'sliders', fn: () => P.colorDialog(c, anchor) },
      { label: tx('cw.m.template'), icon: 'plus', fn: () => V.templateDialog(c) },
      { label: tx('cw.m.review'), icon: 'star', fn: () => { location.hash = `#/review?course=${c.id}`; } },
      { label: tx('cw.m.print'), icon: 'print', fn: () => V.print(c) },
      '-',
      P && { label: tx(c.archived ? 'cp.unarchive' : 'cp.archive'), icon: 'archive', fn: () => P.archive(c) },
      P && { label: tx('cp.delete'), icon: 'trash', danger: true, fn: () => P.remove(c, () => { location.hash = '#/courses'; }) },
    ], { localized: true });
  }

  /** Jump to another course of the same semester (or to the overview). */
  function switchMenu(anchor, c) {
    const list = S.state.courses.filter((x) => (x.semesterId || '') === (c.semesterId || '') && x.kind !== 'record' && !x.archived);
    ui.menu(anchor, [
      ...list.map((x) => ({ label: x.name, dot: x.color, active: x.id === c.id, fn: () => { location.hash = `#/course/${x.id}`; } })),
      '-',
      { label: tx('cw.allCourses'), icon: 'layers', fn: () => { location.hash = '#/courses'; } },
    ], { localized: true });
  }

  /** Print the course: all items with notes, no filters. */
  V.print = (c) => {
    const prev = { filter: view.filter, tag: view.tag, tab: view.tab, showDone: new Set(view.showDone) };
    Object.assign(view, { filter: 'all', tag: '', tab: 'items', showDone: new Set(c.categories.map((x) => x.id)) });
    if (location.hash !== `#/course/${c.id}`) location.hash = `#/course/${c.id}`;
    CT.app.rerender();
    setTimeout(() => { window.print(); Object.assign(view, prev); CT.app.rerender(); }, 150);
  };

  /* ================= keyboard on rows (called by app.js) ================= */
  V.onKey = (e) => {
    const row = document.activeElement && document.activeElement.closest && document.activeElement.closest('.row');
    if (e.key === 'n' || e.key === 'מ') { // 'מ' = same key on a Hebrew layout
      const cat = (row && row.closest('.cat')) || document.querySelector('.cat');
      const inp = cat && cat.querySelector('.quick-add input');
      if (inp) { e.preventDefault(); inp.focus(); return true; }
      return false;
    }
    if (!row || document.activeElement !== row) return false;
    const id = row.dataset.id;
    view.focusId = id; // the row keeps focus after the re-render this key causes
    const rows = [...document.querySelectorAll('.row')];
    const i = rows.indexOf(row);
    const focusRow = (r) => { if (r) { r.focus(); view.focusId = r.dataset.id; } };
    if (e.altKey && (e.key === 'ArrowUp' || e.key === 'ArrowDown')) { V.moveItem(id, e.key === 'ArrowUp' ? -1 : 1); return true; }
    switch (e.key) {
      case ' ': S.toggleDone(id); return true;
      case 'Enter': toggleNote(id); return true;
      case 'ArrowDown': case 'j': case 'ח': focusRow(rows[i + 1]); return true;
      case 'ArrowUp': case 'k': case 'ל': focusRow(rows[i - 1]); return true;
      case 'f': case 'כ': toggleFlag(id); return true;
      case 'e': case 'ק': V.itemDetails(id); return true;
      case 's': case 'ד': ui.statusMenu(row.querySelector('[data-action="status-menu"]'), id); return true;
      case 'm': case 'צ': case 'ContextMenu': rowMenu(row.querySelector('[data-action="row-menu"]'), id); return true;
      case 'Delete': focusRow(rows[i + 1] || rows[i - 1]); V.deleteItem(id); return true;
      default: return false;
    }
  };
})(window.CT);
