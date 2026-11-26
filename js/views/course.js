/* views/course.js — course page: header, category tables, items, notes, filters, bulk add, drag, course forms. */
(function (CT) {
  'use strict';
  const { u, ui, stats } = CT;
  const S = CT.store, M = CT.model;
  const esc = u.esc, icon = u.icon;
  const V = {};
  CT.views = CT.views || {};
  CT.views.course = V;

  // view-only state (not saved)
  const view = { courseId: null, tab: 'items', filter: 'all', tag: '', openNotes: new Set(), focusId: null };

  const FILTERS = [
    ['all', 'הכול'], ['open', 'לא הושלמו'], ['review', 'צריך לחזור'], ['flag', '⭐ לחזרה למבחן'], ['due', 'עם תאריך יעד'],
  ];
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
    if (!c) { root.innerHTML = ui.empty('הקורס לא נמצא. <a href="#/">חזרה לדשבורד</a>'); return; }
    if (view.courseId !== c.id) Object.assign(view, { courseId: c.id, tab: 'items', filter: 'all', tag: '', focusId: null });
    if (params.tab) view.tab = params.tab;
    if (params.item) Object.assign(view, { tab: 'items', filter: 'all', tag: '' }); // jumping to an item (search / dashboard)
    const tabs = [['items', 'פריטים']];
    if (CT.views.grades) tabs.push(['grades', 'ציונים']);
    if (CT.views.notebook) tabs.push(['notebook', 'מחברת מושגים']);
    if (!tabs.some((t) => t[0] === view.tab)) view.tab = 'items';

    const p = stats.courseProgress(c);
    const sem = S.semester(c.semesterId);
    const meta = [
      c.number && `<span dir="ltr">${esc(c.number)}</span>`, sem && esc(sem.name),
      c.credits && `${esc(c.credits)} נק״ז`, c.staff && `<span dir="auto">${esc(c.staff)}</span>`,
    ].filter(Boolean).join(' · ');
    const links = c.links.filter((l) => u.safeUrl(l.url)).map((l) =>
      `<a class="chip-link" href="${esc(u.safeUrl(l.url))}" target="_blank" rel="noopener noreferrer">${icon.link}<span dir="auto">${esc(l.label || l.url)}</span></a>`).join('');
    const exams = (c.exams || []).filter((e) => e.date).sort((a, b) => a.date.localeCompare(b.date)).map((e) => {
      const n = u.daysUntil(e.date);
      return `<span class="exam-chip${n < 0 ? ' past' : n <= 14 ? ' near' : ''}">${esc(e.label || 'מבחן')} · ${u.fmtDateFull(e.date)}${n >= 0 ? ` · <b>${n === 0 ? 'היום!' : `עוד ${n} ימים`}</b>` : ''}</span>`;
    }).join('');

    root.innerHTML = `
      <article class="course-page" style="--c:${esc(c.color)}">
        <header class="card course-head">
          <div class="course-head-top">
            <div class="course-ring">${ui.ring(p.pct, 76, 7)}</div>
            <div class="course-title">
              <h1 dir="auto">${esc(c.name)} ${ui.outcomeBadge(c)}${c.archived ? ' <span class="pill pill-muted">בארכיון</span>' : ''}</h1>
              ${meta ? `<div class="meta">${meta}</div>` : ''}
              ${M.isFinished(c) && (c.outcome.date || c.outcome.note) ? `<div class="meta small">${c.outcome.date ? `הסתיים ${u.fmtDateFull(c.outcome.date)}` : ''}${c.outcome.date && c.outcome.note ? ' · ' : ''}<span dir="auto">${esc(c.outcome.note || '')}</span></div>` : ''}
            </div>
            <div class="head-actions no-print">
              <button class="btn${M.isFinished(c) ? '' : ' btn-primary'}" data-action="finish">${icon.award}<span>${M.isFinished(c) ? 'עריכת הסיום' : 'סיים קורס'}</span></button>
              <button class="btn" data-action="edit-course">${icon.edit}<span>עריכת קורס</span></button>
              <button class="icon-btn" data-action="course-menu" aria-label="פעולות נוספות לקורס">${icon.more}</button>
            </div>
          </div>
          ${c.description ? `<p class="desc" dir="auto">${u.rich(c.description)}</p>` : ''}
          ${links ? `<div class="links no-print">${links}</div>` : ''}
          ${exams ? `<div class="exams">${exams}</div>` : ''}
          <div class="course-progress">
            ${c.categories.map((cat) => {
              const cp = stats.progress(cat.items);
              return `<div class="cp-item" title="${esc(cat.name)}: ${cp.done}/${cp.total}"><span class="cp-name" dir="auto">${esc(cat.name)}</span>${ui.bar(cp.pct, cat.name, true)}<span class="cp-num">${cp.done}/${cp.total}</span></div>`;
            }).join('')}
          </div>
        </header>
        ${tabs.length > 1 ? `<nav class="tabs no-print" role="tablist" aria-label="חלקי הקורס">
          ${tabs.map(([k, l]) => `<button role="tab" aria-selected="${view.tab === k}" class="tab${view.tab === k ? ' active' : ''}" data-action="tab" data-tab="${k}">${l}</button>`).join('')}
        </nav>` : ''}
        <div class="tab-panel"></div>
      </article>`;

    const panel = root.querySelector('.tab-panel');
    if (view.tab === 'grades') CT.views.grades.render(panel, c);
    else if (view.tab === 'notebook') CT.views.notebook.render(panel, c);
    else renderItems(panel, c);

    bindHead(root, c);
    if (params.item) highlightItem(root, params.item);
  };

  function renderItems(panel, c) {
    const tags = S.courseTags(c);
    const dragOk = !filtering();
    const cats = c.categories.map((cat) => {
      const rows = cat.items.filter(matches);
      if (filtering() && !rows.length) return '';
      const p = stats.progress(cat.items);
      return `
        <section class="card cat" data-id="${cat.id}">
          <header class="cat-head">
            ${dragOk ? `<button class="drag-handle no-print" aria-label="גרור כדי לסדר את הקטגוריה" title="גרירה לסידור">${icon.grip}</button>` : ''}
            <h2 class="cat-name" dir="auto" data-action="rename-cat" title="לחיצה כפולה לשינוי שם">${esc(cat.name)}</h2>
            <span class="muted nowrap cat-count">${p.done}/${p.total}</span>
            <div class="cat-bar">${ui.bar(p.pct, `התקדמות ב${cat.name}`, true)}</div>
            <span class="pct">${p.pct}%</span>
            <button class="icon-btn no-print" data-action="cat-menu" aria-label="פעולות לקטגוריה ${esc(cat.name)}">${icon.more}</button>
          </header>
          <div class="rows" data-cat="${cat.id}">
            ${rows.map((it) => rowHTML(it, dragOk)).join('') || '<div class="rows-empty muted">אין פריטים עדיין</div>'}
          </div>
          <form class="quick-add no-print" data-cat="${cat.id}">
            <input type="text" dir="auto" placeholder="+ פריט חדש ב${esc(cat.name)} (Enter)" aria-label="הוספת פריט ל${esc(cat.name)}">
          </form>
        </section>`;
    }).join('');

    panel.innerHTML = `
      <div class="toolbar no-print">
        <div class="chips" role="group" aria-label="סינון פריטים">
          ${FILTERS.map(([k, l]) => `<button class="chip${view.filter === k ? ' active' : ''}" aria-pressed="${view.filter === k}" data-action="filter" data-filter="${k}">${l}</button>`).join('')}
          ${tags.length ? `<select class="chip-select" data-action="tag-filter" aria-label="סינון לפי תגית">
            <option value="">כל התגיות</option>${tags.map((t) => `<option ${t === view.tag ? 'selected' : ''}>${esc(t)}</option>`).join('')}
          </select>` : ''}
        </div>
        <div class="toolbar-actions">
          <button class="btn" data-action="bulk-add" title="יצירת הרבה פריטים בבת אחת">${icon.plus}<span>פריטים בבת אחת</span></button>
          <button class="btn" data-action="add-cat">${icon.plus}<span>קטגוריה</span></button>
        </div>
      </div>
      <div class="cats">${cats || (filtering()
        ? ui.empty('אין פריטים שמתאימים לסינון.')
        : ui.empty(`אין עדיין קטגוריות בקורס.<br><button class="btn btn-primary" data-action="template">צור מבנה סטנדרטי</button>`))}</div>`;

    bindItems(panel, c);
    ui.justChecked = null;
    // restore keyboard focus after re-render
    if (view.focusId && (document.activeElement === document.body || !document.activeElement)) {
      const r = panel.querySelector(`.row[data-id="${view.focusId}"]`);
      if (r) r.focus({ preventScroll: true });
    }
  }

  function rowHTML(it, dragOk) {
    const open = view.openNotes.has(it.id);
    const done = it.status === 'done';
    const days = it.due ? u.daysUntil(it.due) : null;
    const dueCls = !it.due ? 'empty' : done ? '' : days < 0 ? 'overdue' : days <= 3 ? 'soon' : '';
    const firstLine = (it.note || '').split('\n')[0].slice(0, 120);
    const safeLink = u.safeUrl(it.link);
    return `
      <div class="row st-${it.status}${it.flag ? ' flagged' : ''}${ui.justChecked === it.id ? ' just-checked' : ''}" data-id="${it.id}" tabindex="0" aria-label="${esc(it.title)} — ${M.STATUSES[it.status].label}">
        <div class="row-main">
          ${dragOk ? `<button class="drag-handle no-print" tabindex="-1" aria-label="גרור לסידור">${icon.grip}</button>` : ''}
          <button class="check" role="checkbox" aria-checked="${done}" data-action="toggle" aria-label="סימון הושלם: ${esc(it.title)}" tabindex="-1">${icon.check}</button>
          <div class="row-title">
            <span class="title-text" data-action="edit-title" dir="auto">${esc(it.title)}</span>
            ${safeLink ? `<a class="row-link" href="${esc(safeLink)}" target="_blank" rel="noopener noreferrer" aria-label="פתח קישור" tabindex="-1">${icon.link}</a>` : ''}
            ${it.tags.map((t) => `<span class="tag" dir="auto">${esc(t)}</span>`).join('')}
            ${CT.views.moodle.badges(it)}
            ${(it.subs || []).length ? `<button class="subs-chip${it.subs.every((s) => s.done) ? ' all' : ''}" data-action="subs" tabindex="-1" aria-label="תתי-משימות: ${it.subs.filter((s) => s.done).length} מתוך ${it.subs.length}">☑ ${it.subs.filter((s) => s.done).length}/${it.subs.length}</button>` : ''}
            ${it.note && !open ? `<div class="note-snippet" data-action="toggle-note" dir="auto">${icon.note}${esc(firstLine)}</div>` : ''}
          </div>
          <div class="row-tools">
            <button class="icon-btn note-btn${it.note ? ' has-note' : ''}" data-action="toggle-note" aria-expanded="${open}" aria-label="${it.note ? 'הצג/ערוך הערה' : 'הוסף הערה'}" title="הערה (Enter)" tabindex="-1">${icon.note}</button>
            <button class="icon-btn flag-btn${it.flag ? ' on' : ''}" data-action="flag" aria-pressed="${it.flag}" aria-label="לחזור לפני המבחן" title="לחזור לפני המבחן (F)" tabindex="-1">${icon.star}</button>
            <button class="due-btn ${dueCls}" data-action="edit-due" title="${it.due ? u.relDays(it.due) : 'קביעת תאריך יעד'}" aria-label="${it.due ? 'תאריך יעד ' + u.fmtDateFull(it.due) : 'קביעת תאריך יעד'}" tabindex="-1">${it.due ? u.fmtDate(it.due) : icon.calendar}</button>
            <button class="pill st-${it.status}" data-action="status-menu" aria-label="סטטוס: ${M.STATUSES[it.status].label}. לשינוי" tabindex="-1">${M.STATUSES[it.status].label}</button>
            <button class="icon-btn" data-action="row-menu" aria-label="פעולות נוספות" tabindex="-1">${icon.more}</button>
          </div>
        </div>
        ${open ? `<div class="note-area">
          <textarea class="note-input" dir="auto" rows="2" data-id="${it.id}" placeholder="כתוב הערה... נשמר אוטומטית. נוסחאות: $x^2$ או $$\\int f\\,dx$$" aria-label="הערה ל${esc(it.title)}">${esc(it.note)}</textarea>
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

  /* ================= events ================= */
  function bindHead(root, c) {
    root.querySelector('.course-head').addEventListener('click', (e) => {
      const a = e.target.closest('[data-action]');
      if (!a) return;
      if (a.dataset.action === 'edit-course') V.courseForm(c);
      if (a.dataset.action === 'finish') V.finishDialog(c);
      if (a.dataset.action === 'course-menu') courseMenu(a, c);
    });
    const tabs = root.querySelector('.tabs');
    if (tabs) tabs.addEventListener('click', (e) => {
      const t = e.target.closest('[data-tab]');
      if (t) { view.tab = t.dataset.tab; V.render(root, { id: c.id }); }
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
        case 'filter': view.filter = a.dataset.filter; CT.app.rerender(); break;
        case 'bulk-add': V.bulkAdd(c); break;
        case 'add-cat': addCategory(c); break;
        case 'template': V.templateDialog(c); break;
        default: break;
      }
    });
    panel.addEventListener('dblclick', (e) => {
      const h = e.target.closest('[data-action="rename-cat"]');
      if (h) renameCat(h.closest('.cat').dataset.id);
    });
    panel.addEventListener('change', (e) => {
      if (e.target.matches('[data-action="tag-filter"]')) { view.tag = e.target.value; CT.app.rerender(); }
    });
    panel.addEventListener('submit', (e) => {
      e.preventDefault();
      const form = e.target.closest('.quick-add');
      const inp = form.querySelector('input');
      const title = inp.value.trim();
      if (!title) return;
      const catId = form.dataset.cat;
      S.commit('הוספת פריט', () => { S.findCat(catId).cat.items.push(M.newItem(title)); });
      const again = document.querySelector(`.quick-add[data-cat="${catId}"] input`);
      if (again) again.focus();
    });
    panel.addEventListener('focusin', (e) => {
      const r = e.target.closest('.row');
      if (r) view.focusId = r.dataset.id;
    });
    // notes: autosave while typing (silent → no re-render, so the cursor stays)
    panel.addEventListener('input', (e) => {
      if (!e.target.matches('.note-input')) return;
      const ta = e.target, id = ta.dataset.id;
      autosize(ta);
      S.commit('עריכת הערה', () => { const f = S.findItem(id); if (f) f.item.note = ta.value; }, { silent: true, coalesce: 'note:' + id });
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

    // drag & drop (rows inside a category, and categories themselves)
    if (!filtering()) {
      panel.querySelectorAll('.rows').forEach((rowsEl) => ui.sortable(rowsEl, {
        item: '.row', handle: '.drag-handle',
        onEnd: (ids) => S.commit('סידור פריטים', () => ui.reorder(S.findCat(rowsEl.dataset.cat).cat.items, ids)),
      }));
      const catsEl = panel.querySelector('.cats');
      ui.sortable(catsEl, {
        item: '.cat', handle: '.cat-head > .drag-handle',
        onEnd: (ids) => S.commit('סידור קטגוריות', () => ui.reorder(S.course(c.id).categories, ids)),
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
    S.commit('סימון לחזרה', () => { const f = S.findItem(id); f.item.flag = !f.item.flag; });
  }
  V.toggleFlag = toggleFlag;

  function editTitleInline(span, id) {
    const f = S.findItem(id);
    if (!f || !span.isConnected) return;
    const inp = document.createElement('input');
    inp.className = 'title-input';
    inp.dir = 'auto';
    inp.value = f.item.title;
    inp.setAttribute('aria-label', 'שם הפריט');
    span.replaceWith(inp);
    inp.focus();
    inp.select();
    let done = false;
    const finish = (save) => {
      if (done) return;
      done = true;
      const v = inp.value.trim();
      view.focusId = id;
      if (save && v && v !== f.item.title) S.commit('שינוי שם פריט', () => { S.findItem(id).item.title = v; });
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
      title: `תאריך יעד — ${f.item.title}`,
      body: `<label class="field"><span>תאריך</span><input type="date" value="${esc(f.item.due)}"></label>`,
      actions: [
        f.item.due && { label: 'הסר תאריך', fn: () => S.commit('הסרת תאריך יעד', () => { S.findItem(id).item.due = ''; }) },
        { label: 'ביטול' },
        { label: 'שמור', primary: true, fn: (m) => { const v = m.body.querySelector('input').value; S.commit('תאריך יעד', () => { S.findItem(id).item.due = v; }); } },
      ].filter(Boolean),
    });
  }

  V.itemDetails = (id) => {
    const f = S.findItem(id);
    if (!f) return;
    const it = f.item;
    ui.modal({
      title: 'פרטי פריט',
      wide: true,
      body: `
        <div class="form-grid">
          <label class="field span-2"><span>כותרת</span><input name="title" dir="auto" value="${esc(it.title)}"></label>
          <label class="field"><span>סטטוס</span><select name="status">${M.STATUS_ORDER.map((s) => `<option value="${s}" ${s === it.status ? 'selected' : ''}>${M.STATUSES[s].label}</option>`).join('')}</select></label>
          <label class="field"><span>תאריך יעד</span><input type="date" name="due" value="${esc(it.due)}"></label>
          <label class="field span-2"><span>קישור</span><input name="link" dir="ltr" placeholder="https://..." value="${esc(it.link)}"></label>
          <label class="field span-2"><span>תגיות (מופרדות בפסיק)</span><input name="tags" dir="auto" placeholder="קשה, הגשה, לשאול מתרגל" value="${esc(it.tags.join(', '))}"></label>
          <label class="check-field span-2"><input type="checkbox" name="flag" ${it.flag ? 'checked' : ''}> ⭐ לחזור לפני המבחן</label>
          ${CT.game ? `<label class="field"><span>קושי (לנקודות)</span><select name="diff">
            <option value="">אוטומטי (${CT.game.DIFF_LABELS[CT.game.difficulty({ title: it.title }, f.cat)]})</option>
            ${[1, 2, 3].map((d) => `<option value="${d}" ${Number(it.diff) === d ? 'selected' : ''}>${CT.game.DIFF_LABELS[d]}</option>`).join('')}
          </select></label>` : ''}
          <label class="field span-2"><span>הערה (תומך ב-LaTeX: $...$)</span><textarea name="note" dir="auto" rows="6">${esc(it.note)}</textarea></label>
        </div>
        ${it.completedAt ? `<p class="muted">הושלם ב-${u.fmtDateFull(u.isoDate(new Date(it.completedAt)))}</p>` : ''}`,
      actions: [
        { label: 'ביטול' },
        {
          label: 'שמור', primary: true, fn: (m) => {
            const g = (n) => m.body.querySelector(`[name="${n}"]`);
            S.commit('עריכת פריט', () => {
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
              x.tags = g('tags').value.split(/[,،]/).map((t) => t.trim()).filter(Boolean);
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
    S.commit('מחיקת פריט', () => { const x = S.findItem(id); x.cat.items.splice(x.cat.items.indexOf(x.item), 1); });
    ui.toast(`"${f.item.title}" נמחק`, { action: { label: 'בטל', fn: S.undo } });
  };

  V.moveItem = (id, dir) => S.commit('הזזת פריט', () => {
    const { cat, item } = S.findItem(id);
    const i = cat.items.indexOf(item), j = i + dir;
    if (j < 0 || j >= cat.items.length) return;
    cat.items.splice(i, 1);
    cat.items.splice(j, 0, item);
  });

  function rowMenu(anchor, id) {
    const f = S.findItem(id);
    const others = f.course.categories.filter((c) => c !== f.cat);
    ui.menu(anchor, [
      { label: 'פרטים ועריכה', icon: 'edit', hint: 'E', fn: () => V.itemDetails(id) },
      CT.focus && f.item.status !== 'done' && { label: 'רק 5 דקות', icon: 'timer', fn: () => CT.focus.start(id, 5) },
      CT.focus && f.item.status !== 'done' && { label: 'מצב מיקוד (פומודורו)', icon: 'timer', fn: () => CT.focus.start(id, S.state.settings.pomodoro.work || 25) },
      CT.focus && { label: 'תתי-משימות', icon: 'check', fn: () => CT.focus.openSubs(id) },
      { label: 'הזז למעלה', icon: 'up', hint: 'Alt+↑', fn: () => V.moveItem(id, -1) },
      { label: 'הזז למטה', icon: 'down', hint: 'Alt+↓', fn: () => V.moveItem(id, 1) },
      others.length && { label: 'העבר לקטגוריה…', icon: 'archive', fn: () => moveToCat(id) },
      { label: 'שכפל', icon: 'plus', fn: () => S.commit('שכפול פריט', () => {
        const x = S.findItem(id);
        x.cat.items.splice(x.cat.items.indexOf(x.item) + 1, 0, M.newItem(x.item.title + ' (עותק)', { tags: [...x.item.tags], note: x.item.note }));
      }) },
      '-',
      { label: 'מחק פריט', icon: 'trash', danger: true, hint: 'Del', fn: () => V.deleteItem(id) },
    ]);
  }

  function moveToCat(id) {
    const f = S.findItem(id);
    const opts = f.course.categories.filter((c) => c !== f.cat);
    ui.modal({
      title: 'העברה לקטגוריה',
      body: `<label class="field"><span>קטגוריית יעד</span><select>${opts.map((c) => `<option value="${c.id}">${esc(c.name)}</option>`).join('')}</select></label>`,
      actions: [{ label: 'ביטול' }, {
        label: 'העבר', primary: true, fn: (m) => {
          const to = m.body.querySelector('select').value;
          S.commit('העברת פריט', () => {
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
    const name = await ui.prompt('קטגוריה חדשה', '', 'שם הקטגוריה (למשל: מבחנים ובחנים, חומר נוסף)');
    if (name) S.commit('הוספת קטגוריה', () => S.course(c.id).categories.push(M.newCategory(name)));
  }
  async function renameCat(catId) {
    const { cat } = S.findCat(catId);
    const name = await ui.prompt('שינוי שם קטגוריה', cat.name);
    if (name && name !== cat.name) S.commit('שינוי שם קטגוריה', () => { S.findCat(catId).cat.name = name; });
  }
  function catMenu(anchor, c, catId) {
    const { cat } = S.findCat(catId);
    const idx = c.categories.indexOf(cat);
    const moveCat = (d) => S.commit('הזזת קטגוריה', () => {
      const cats = S.course(c.id).categories, i = cats.findIndex((x) => x.id === catId);
      if (i + d < 0 || i + d >= cats.length) return;
      cats.splice(i + d, 0, cats.splice(i, 1)[0]);
    });
    ui.menu(anchor, [
      { label: 'שינוי שם', icon: 'edit', fn: () => renameCat(catId) },
      { label: 'הוסף פריטים בבת אחת', icon: 'plus', fn: () => V.bulkAdd(c, catId) },
      { label: 'סמן הכול כהושלם', icon: 'check', fn: () => S.commit('סימון כל הקטגוריה', () => {
        S.findCat(catId).cat.items.forEach((i) => { if (i.status !== 'done') { i.status = 'done'; i.completedAt = new Date().toISOString(); } });
      }) },
      idx > 0 && { label: 'הזז למעלה', icon: 'up', fn: () => moveCat(-1) },
      idx < c.categories.length - 1 && { label: 'הזז למטה', icon: 'down', fn: () => moveCat(1) },
      '-',
      { label: 'מחק קטגוריה', icon: 'trash', danger: true, fn: async () => {
        if (cat.items.length && !(await ui.confirm(`למחוק את "${cat.name}" ואת ${cat.items.length} הפריטים שבה?`, 'מחק', true))) return;
        S.commit('מחיקת קטגוריה', () => { const cs = S.course(c.id).categories; cs.splice(cs.findIndex((x) => x.id === catId), 1); });
        ui.toast('הקטגוריה נמחקה', { action: { label: 'בטל', fn: S.undo } });
      } },
    ]);
  }

  /* ================= bulk add & template ================= */
  V.bulkAdd = (c, presetCatId) => {
    const catOpts = c.categories.map((cat) => `<option value="${cat.id}" ${cat.id === presetCatId ? 'selected' : ''}>${esc(cat.name)}</option>`).join('');
    const m = ui.modal({
      title: 'הוספת פריטים בבת אחת',
      body: `
        <div class="form-grid">
          <label class="field span-2"><span>קטגוריה</span>
            <select name="cat">${catOpts}<option value="__new">➕ קטגוריה חדשה…</option></select></label>
          <label class="field span-2" data-newcat hidden><span>שם הקטגוריה החדשה</span><input name="newcat" dir="auto" placeholder="למשל: תרגולים"></label>
          <label class="field"><span>כמות</span><input type="number" name="count" min="1" max="200" value="13"></label>
          <label class="field"><span>להתחיל מהמספר</span><input type="number" name="start" min="0" value="1"></label>
          <label class="field span-2"><span>תבנית שם ({n} = מספר)</span><input name="pattern" dir="auto" value="תרגול {n}"></label>
          <label class="field"><span>תאריך יעד לראשון (רשות)</span><input type="date" name="due"></label>
          <label class="field"><span>כל כמה ימים</span><input type="number" name="every" min="1" value="7"></label>
        </div>
        <p class="muted preview-line" aria-live="polite"></p>`,
      actions: [{ label: 'ביטול' }, {
        label: 'צור', primary: true, fn: (api) => {
          const g = (n) => api.body.querySelector(`[name="${n}"]`);
          const count = Math.min(200, Math.max(1, parseInt(g('count').value, 10) || 0));
          const start = parseInt(g('start').value, 10) || 1;
          const pattern = g('pattern').value.trim() || 'פריט {n}';
          const due = g('due').value, every = parseInt(g('every').value, 10) || 7;
          let catId = g('cat').value;
          const newName = g('newcat').value.trim();
          if (catId === '__new' && !newName) { g('newcat').focus(); return false; }
          S.commit(`הוספת ${count} פריטים`, () => {
            const course = S.course(c.id);
            let cat;
            if (catId === '__new') { cat = M.newCategory(newName); course.categories.push(cat); } else cat = course.categories.find((x) => x.id === catId);
            const items = M.makeItems(pattern, count, start);
            if (due) items.forEach((it, i) => { it.due = u.addDays(due, i * every); });
            cat.items.push(...items);
          });
          ui.toast(`נוצרו ${count} פריטים`, { action: { label: 'בטל', fn: S.undo } });
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
      const names = M.makeItems(g('pattern').value || 'פריט {n}', Math.min(count, 3), start).map((x) => x.title);
      m.body.querySelector('.preview-line').textContent = `ייווצרו ${count} פריטים: ${names.join(', ')}${count > 3 ? ', …' : ''}${cat ? ` (ב"${cat.name}")` : ''}`;
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
    const rowT = (t) => `<div class="tpl-row">
        <input name="name" dir="auto" value="${esc(t.name)}" aria-label="שם קטגוריה">
        <input name="count" type="number" min="0" value="${esc(t.count)}" aria-label="כמות">
        <input name="pattern" dir="auto" value="${esc(t.pattern)}" aria-label="תבנית שם">
        <button class="icon-btn" data-del aria-label="הסר שורה">${icon.trash}</button></div>`;
    const m = ui.modal({
      title: 'החלת מבנה סטנדרטי',
      wide: true,
      body: `<p class="muted">כל שורה יוצרת קטגוריה עם פריטים ממוספרים. אם הקטגוריה כבר קיימת — הפריטים יתווספו אליה.</p>
        <div class="tpl-head muted"><span>קטגוריה</span><span>כמות</span><span>תבנית שם</span><span></span></div>
        <div class="tpl-rows">${tpl.map(rowT).join('')}</div>
        <button class="btn btn-ghost" data-add>${icon.plus} שורה</button>
        <label class="check-field"><input type="checkbox" name="save"> שמור כתבנית ברירת המחדל לקורסים הבאים</label>`,
      actions: [{ label: 'ביטול' }, {
        label: 'החל על הקורס', primary: true, fn: (api) => {
          const rows = [...api.body.querySelectorAll('.tpl-row')].map((r) => ({
            name: r.querySelector('[name=name]').value.trim(),
            count: parseInt(r.querySelector('[name=count]').value, 10) || 0,
            pattern: r.querySelector('[name=pattern]').value.trim(),
          })).filter((r) => r.name);
          S.commit('החלת תבנית', (st) => {
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
  V.courseForm = (existing) => {
    const st = S.state;
    const c = existing || M.newCourse({ semesterId: st.settings.activeSemesterId, color: M.COLORS[st.courses.length % M.COLORS.length] });
    const isNew = !existing;
    const linkRow = (l = {}) => `<div class="list-row"><input name="lbl" dir="auto" placeholder="שם (Moodle, Piazza…)" value="${esc(l.label)}" aria-label="שם הקישור"><input name="url" dir="ltr" placeholder="https://" value="${esc(l.url)}" aria-label="כתובת"><button class="icon-btn" data-del aria-label="הסר">${icon.trash}</button></div>`;
    const examRow = (x = {}) => `<div class="list-row" data-id="${esc(x.id || '')}"><input name="lbl" dir="auto" placeholder="מועד א׳ / בוחן / הגשת פרויקט" value="${esc(x.label)}" aria-label="שם"><input name="date" type="date" value="${esc(x.date)}" aria-label="תאריך"><button class="icon-btn" data-del aria-label="הסר">${icon.trash}</button></div>`;
    const m = ui.modal({
      title: isNew ? 'קורס חדש' : 'עריכת קורס',
      wide: true,
      body: `
        <div class="form-grid">
          <label class="field span-2"><span>שם הקורס</span><input name="name" dir="auto" value="${isNew ? '' : esc(c.name)}" placeholder="למשל: אותות ומערכות" required></label>
          <label class="field"><span>מספר קורס</span><input name="number" dir="ltr" value="${esc(c.number)}" placeholder="00440131"></label>
          <label class="field"><span>נקודות זכות</span><input name="credits" type="number" step="0.5" min="0" value="${esc(c.credits)}"></label>
          <label class="field"><span>סמסטר</span><select name="semester">${st.semesters.map((s) => `<option value="${s.id}" ${s.id === c.semesterId ? 'selected' : ''}>${esc(s.name)}</option>`).join('')}<option value="">— ללא —</option></select></label>
          <div class="field"><span>צבע</span><div class="swatches" role="radiogroup" aria-label="צבע הקורס">
            ${M.COLORS.map((col) => `<button type="button" class="swatch${col === c.color ? ' on' : ''}" style="background:${col}" data-color="${col}" role="radio" aria-checked="${col === c.color}" aria-label="צבע ${col}"></button>`).join('')}
            <input type="color" name="color" value="${esc(c.color)}" aria-label="צבע מותאם">
          </div></div>
          <label class="field span-2"><span>מרצה / מתרגל</span><input name="staff" dir="auto" value="${esc(c.staff)}"></label>
          <label class="field span-2"><span>תיאור קצר</span><textarea name="description" dir="auto" rows="2">${esc(c.description)}</textarea></label>
          <div class="field span-2"><span>קישורים שימושיים</span><div class="list" data-list="links">${c.links.map(linkRow).join('')}</div><button type="button" class="btn btn-ghost" data-add="links">${icon.plus} קישור</button></div>
          <div class="field span-2"><span>מבחנים, בחנים והגשות גדולות (לספירה לאחור)</span><div class="list" data-list="exams">${(c.exams || []).map(examRow).join('')}</div><button type="button" class="btn btn-ghost" data-add="exams">${icon.plus} מועד</button></div>
          ${isNew ? `<label class="check-field span-2"><input type="checkbox" name="tpl" checked> צור מבנה סטנדרטי (${st.settings.template.map((t) => `${t.count} ${t.name}`).join(', ')})</label>` : ''}
        </div>`,
      actions: [{ label: 'ביטול' }, {
        label: isNew ? 'צור קורס' : 'שמור', primary: true, fn: (api) => {
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
            S.commit('קורס חדש', (s2) => s2.courses.push(nc));
            location.hash = `#/course/${nc.id}`;
          } else {
            S.commit('עריכת קורס', () => Object.assign(S.course(c.id), fields));
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
    const typeSel = Object.entries(M.OUTCOMES).map(([k, d]) => `<option value="${k}" ${(o.type || 'graded') === k ? 'selected' : ''}>${d.label}</option>`).join('');
    const m = ui.modal({
      title: isNew ? `סיום קורס — ${c.name}` : `עריכת סיום — ${c.name}`,
      body: `<div class="form-grid">
        <label class="field"><span>סוג הסיום</span><select name="type">${typeSel}</select></label>
        <label class="field" data-show="grade"><span>ציון סופי (0–100)</span><input name="grade" type="number" min="0" max="100" step="any" inputmode="decimal" value="${u.isNum(o.grade) ? o.grade : (isNew && suggested != null ? suggested : '')}"></label>
        <label class="field"><span>תאריך סיום</span><input name="date" type="date" value="${esc(o.date || u.today())}"></label>
        <label class="field"><span>הערה</span><input name="note" dir="auto" value="${esc(o.note || '')}" placeholder="מועד ב׳, עם בונוס…"></label>
        <label class="check-field span-2" data-show="exempt"><input type="checkbox" name="exemptCredits" ${(o.exemptCredits ?? rules.exemptCredits) ? 'checked' : ''}> הפטור מקנה נקודות זכות</label>
      </div>
      ${suggested != null ? `<p class="small finish-suggest" data-show="grade">לפי רכיבי הציון שהזנת בקורס: <b>${suggested}</b>
        <button type="button" class="btn btn-small btn-ghost" data-fill>מלא</button><br><span class="muted">הציון הרשמי הוא מה שקובע — אפשר לדרוס ידנית.</span></p>`
        : (calc.remaining && calc.remaining.length && c.grade.components.length ? `<p class="muted small">חסרים ציונים ב־${calc.remaining.length} רכיבים, לכן אין הצעה מהחישוב.</p>` : '')}
      <p class="muted small">קורס שהסתיים יוצא מ"מה דחוף" ומהספירה לאחור, אבל נשאר זמין ואפשר לבטל את הסיום בכל רגע.</p>`,
      actions: [
        ...(isNew ? [] : [{ label: 'ביטול הסיום', danger: true, fn: () => {
          S.commit('ביטול סיום קורס', () => { S.course(c.id).outcome = null; });
          ui.toast('הקורס חזר להיות פעיל', { action: { label: 'בטל', fn: S.undo } });
        } }]),
        { label: 'סגור' },
        { label: isNew ? 'סיים קורס' : 'שמור', primary: true, fn: (api) => {
          const g = (n) => api.body.querySelector(`[name=${n}]`);
          const type = g('type').value;
          const raw = g('grade').value.trim();
          const grade = raw === '' ? null : Number(raw);
          if (type === 'graded' && !(grade >= 0 && grade <= 100)) { g('grade').focus(); ui.toast('צריך ציון בין 0 ל־100 (או לבחור סוג סיום אחר)', { error: true }); return false; }
          if (type === 'failed' && grade != null && !(grade >= 0 && grade <= 100)) { g('grade').focus(); return false; }
          const outcome = {
            type, grade: type === 'graded' || type === 'failed' ? grade : null,
            date: g('date').value, note: g('note').value.trim(), exemptCredits: g('exemptCredits').checked,
            fromCalc: suggested != null && grade === suggested,
          };
          S.commit(isNew ? 'סיום קורס' : 'עריכת סיום', () => { S.course(c.id).outcome = outcome; });
          ui.toast(isNew ? `"${c.name}" סומן כהושלם` : 'הסיום עודכן', { action: { label: 'בטל', fn: S.undo } });
          return true;
        } },
      ],
    });
    const sync = () => {
      const t = m.body.querySelector('[name=type]').value;
      m.body.querySelectorAll('[data-show=grade]').forEach((el) => { el.hidden = !(t === 'graded' || t === 'failed'); });
      m.body.querySelectorAll('[data-show=exempt]').forEach((el) => { el.hidden = t !== 'exempt'; });
    };
    m.body.querySelector('[name=type]').addEventListener('change', sync);
    const fill = m.body.querySelector('[data-fill]');
    if (fill) fill.onclick = () => { m.body.querySelector('[name=grade]').value = suggested; };
    sync();
  };

  function courseMenu(anchor, c) {
    ui.menu(anchor, [
      { label: 'החלת מבנה סטנדרטי', icon: 'plus', fn: () => V.templateDialog(c) },
      { label: 'רשימת חזרה למבחן', icon: 'star', fn: () => { location.hash = `#/review?course=${c.id}`; } },
      { label: 'הדפסה / PDF', icon: 'print', fn: () => V.print(c) },
      '-',
      { label: c.archived ? 'שחזור מהארכיון' : 'העברה לארכיון', icon: 'archive', fn: () => {
        S.commit(c.archived ? 'שחזור קורס' : 'העברה לארכיון', () => { S.course(c.id).archived = !c.archived; });
        ui.toast(c.archived ? 'הקורס חזר לדשבורד' : 'הקורס הועבר לארכיון', { action: { label: 'בטל', fn: S.undo } });
      } },
      { label: 'מחיקת קורס', icon: 'trash', danger: true, fn: async () => {
        if (!(await ui.confirm(`למחוק לגמרי את "${c.name}"?\n(אפשר לבטל מיד אחר כך עם Ctrl+Z)`, 'מחק', true))) return;
        S.commit('מחיקת קורס', (st) => { st.courses.splice(st.courses.findIndex((x) => x.id === c.id), 1); });
        location.hash = '#/';
        ui.toast('הקורס נמחק', { action: { label: 'בטל', fn: S.undo } });
      } },
    ]);
  }

  /** Print the course: all items with notes, no filters. */
  V.print = (c) => {
    const prev = { filter: view.filter, tag: view.tag, tab: view.tab };
    Object.assign(view, { filter: 'all', tag: '', tab: 'items' });
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
      case 'Delete': focusRow(rows[i + 1] || rows[i - 1]); V.deleteItem(id); return true;
      default: return false;
    }
  };
})(window.CT);
