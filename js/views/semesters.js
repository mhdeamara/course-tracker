/* views/semesters.js — all semesters (past and present) on a timeline, a light read/edit view per semester,
 * and quick entry of a past semester: pick courses from the catalog (or type one in), give each a grade, save once.
 * Courses entered this way are kind:'record' — no lectures / tasks, they only count for grades and credits.
 * Semester names are stored values (shown as they are); terms and outcomes are labelled in the interface language. */
(function (CT) {
  'use strict';
  const { u, ui } = CT;
  const S = CT.store, M = CT.model, G = CT.gpa, I = CT.i18n;
  const esc = u.esc, icon = u.icon;
  const t = (k, p) => I.t(k, p), tx = (k, p) => I.tx(k, p), th = (k, p) => I.th(k, p);
  const V = {};
  CT.views = CT.views || {};
  CT.views.semesters = V;

  // unsaved quick-entry rows per semester (kept while navigating, cleared on save)
  const drafts = {};
  const view = { q: '' };

  const rules = () => S.state.settings.gpa;
  const fmt = (x) => (x == null ? '—' : String(+x.toFixed(rules().decimals ?? 2)));
  const coursesOf = (semId) => S.state.courses.filter((c) => (c.semesterId || '') === semId);
  /** Academic year guess for "now": the year starts in Tishrei, so from September on it's the next Hebrew year. */
  const currentYear = () => { const d = new Date(); return d.getFullYear() + 3760 + (d.getMonth() >= 8 ? 1 : 0); };
  const termLabel = (k) => (M.TERMS[k] ? tx('term.' + k) : '');
  const gregYears = (y) => `${y - 3761}/${String(y - 3760).slice(2)}`;
  const activePill = () => `<span class="pill">${t('sem.active')}</span>`;
  const outcomeOpts = (sel) => Object.keys(M.OUTCOMES).map((k) => `<option value="${k}" ${sel === k ? 'selected' : ''}>${esc(ui.outcomeLabel(k))}</option>`).join('');

  /* ================= list / timeline ================= */
  function listHTML() {
    const st = S.state;
    const sems = M.sortedSemesters(st.semesters).reverse(); // newest first
    const calc = G.compute(st.courses, st.semesters, rules());
    const per = new Map(calc.perSemester.map((p) => [p.semester.id, p]));
    const byYear = new Map();
    sems.forEach((s) => { const k = s.year || 0; if (!byYear.has(k)) byYear.set(k, []); byYear.get(k).push(s); });
    const y0 = currentYear();
    return `
      <div class="semesters page-wide">
        <header class="pg-head">
          <h1>${t('sem.title')}</h1>
          <p class="muted small">${t('sem.intro')}</p>
        </header>
        <div class="sem-layout">
          <div class="sem-timeline">
            ${[...byYear.entries()].map(([year, list]) => `
              <section class="sem-year">
                <h2 class="sem-year-title">${year ? `<span lang="he">${u.hebYear(year)}</span> <span class="muted small" dir="ltr">${gregYears(year)}</span>` : t('sem.noYear')}</h2>
                <ul class="semx-list">${list.map((s) => {
                  const cs = coursesOf(s.id);
                  const p = per.get(s.id);
                  const active = s.id === st.settings.activeSemesterId;
                  return `<li class="card sem-item${active ? ' active' : ''}" data-id="${esc(s.id)}">
                    <a class="sem-name" href="#/semesters/${esc(s.id)}"><b dir="auto">${esc(s.name)}</b>${active ? ` ${activePill()}` : ''}</a>
                    <span class="sem-stats small">${t('sem.courses', { n: cs.length })} · ${p ? t('sem.stats', { cr: fmt(p.earned), avg: fmt(p.avg) }) : t('sem.noGrades')}</span>
                    <span class="sem-actions">
                      ${active ? '' : `<button class="btn btn-small btn-ghost" data-action="activate">${t('sem.makeActive')}</button>`}
                      <a class="btn btn-small" href="#/semesters/${esc(s.id)}?quick=1">${t('sem.quick')}</a>
                    </span></li>`;
                }).join('')}</ul>
              </section>`).join('') || ui.empty(t('sem.none'))}
          </div>
          <section class="card sem-add">
            <h2 class="cat-h2">${t('sem.add')}</h2>
            <form class="sem-add-form" data-form="add">
              <label class="field"><span>${t('sem.term')}</span><select name="term">${M.TERM_ORDER.map((k) => `<option value="${k}">${esc(termLabel(k))}</option>`).join('')}</select></label>
              <label class="field"><span>${t('sem.yearHeb')}</span>
                <span class="year-input"><input name="year" type="number" min="5600" max="5999" step="1" value="${y0}" required aria-describedby="year-heb"><b id="year-heb" class="year-heb"><span lang="he">${u.hebYear(y0)}</span> <span class="muted small" dir="ltr">${gregYears(y0)}</span></b></span></label>
              <button class="btn btn-primary" type="submit">${icon.plus} ${t('sem.addBtn')}</button>
            </form>
            <p class="muted small">${th('sem.yearHint', { heb: I.html(`<span lang="he">${esc(u.hebYear(5787))}</span>`) })}</p>
          </section>
        </div>
      </div>`;
  }

  /* ================= one semester ================= */
  const HEAD = () => `<thead><tr><th scope="col">${t('gpa.course')}</th><th scope="col">${t('sem.number')}</th><th scope="col">${t('gpa.creditsCol')}</th><th scope="col">${t('gpa.outcome')}</th><th scope="col">${t('gpa.grade')}</th><th scope="col"><span class="sr-only">${t('sem.actions')}</span></th></tr></thead>`;
  function semesterHTML(sem) {
    const st = S.state;
    const cs = coursesOf(sem.id);
    const calc = G.compute(cs, st.semesters, rules());
    const p = calc.perSemester[0];
    const active = sem.id === st.settings.activeSemesterId;
    const outcomeOptions = (c) => `<option value="" ${M.isFinished(c) ? '' : 'selected'}>${t('sem.inProgress')}</option>` + outcomeOpts(c.outcome && c.outcome.type);
    const rows = cs.map((c) => {
      const o = c.outcome || {};
      const needsGrade = o.type === 'graded' || o.type === 'failed';
      const nm = I.iso(c.name);
      return `<tr data-id="${esc(c.id)}">
        <td><a href="#/course/${esc(c.id)}" dir="auto">${esc(c.name)}</a>${c.kind === 'record' ? '' : ` <span class="muted small">(${t('sem.tracked')})</span>`}</td>
        <td dir="ltr" class="num">${esc(c.number)}</td>
        <td><input class="cell-in" data-f="credits" type="number" step="0.5" min="0" value="${esc(c.credits)}" aria-label="${t('sem.creditsOf', { name: nm })}"></td>
        <td><select class="cell-in" data-f="type" aria-label="${t('sem.outcomeOf', { name: nm })}">${outcomeOptions(c)}</select></td>
        <td><input class="cell-in" data-f="grade" type="number" min="0" max="100" step="1" value="${u.isNum(o.grade) ? o.grade : ''}" ${needsGrade ? '' : 'disabled'} aria-label="${t('sem.gradeOf', { name: nm })}"></td>
        <td><button class="icon-btn" data-action="del-course" aria-label="${t('sem.delCourse', { name: nm })}">${icon.trash}</button></td>
      </tr>`;
    }).join('');
    const draft = drafts[sem.id] || [];
    return `
      <div class="semesters sem-detail page-wide" data-sem="${esc(sem.id)}">
        <a class="pg-back muted small" href="#/semesters"><span class="ic-back" aria-hidden="true">${icon.chevSide}</span> ${t('sem.all')}</a>
        <div class="section-head" style="margin-top:6px">
          <h1><span dir="auto">${esc(sem.name)}</span> ${active ? activePill() : ''}</h1>
          <div class="toolbar-actions">
            ${active ? '' : `<button class="btn" data-action="activate">${t('sem.makeActiveLong')}</button>`}
            <button class="btn btn-ghost" data-action="edit-sem">${icon.edit} ${t('sem.edit')}</button>
            <button class="icon-btn" data-action="del-sem" aria-label="${t('sem.delSem')}" ${cs.length ? `disabled title="${t('sem.hasCourses')}"` : ''}>${icon.trash}</button>
          </div>
        </div>
        <div class="stat-cards">
          <div class="card stat"><b>${fmt(p && p.avg)}</b><span>${t('sem.avg')}</span></div>
          <div class="card stat"><b>${fmt(p ? p.earned : 0)}</b><span>${t('gpa.earned')}</span></div>
          <div class="card stat"><b>${cs.length}</b><span>${t('gpa.coursesCol')}</span></div>
        </div>
        <section class="card">
          <h2 class="cat-h2">${t('gpa.coursesCol')}</h2>
          ${cs.length ? `<div class="table-wrap"><table class="sem-table">${HEAD()}<tbody>${rows}</tbody></table></div>` : `<p class="muted">${t('sem.empty')}</p>`}
          <p class="muted small">${t('sem.saved')}</p>
        </section>

        <section class="card quick" id="quick">
          <h2 class="cat-h2">${t('sem.quick')}</h2>
          <p class="muted small">${t('sem.quickHint')}</p>
          <div class="search cat-search">${icon.search}<input type="search" data-action="q" placeholder="${t('sem.searchPh')}" value="${esc(view.q)}" aria-label="${t('sem.searchLabel')}"></div>
          <ul class="quick-results" aria-live="polite"></ul>
          <button class="btn btn-ghost btn-small" data-action="manual">${icon.plus} ${t('sem.manual')}</button>
          ${draft.length ? `<div class="table-wrap"><table class="sem-table draft-table">${HEAD()}
            <tbody>${draft.map((d, i) => `<tr data-i="${i}"${d.dup ? ' class="dup"' : ''}>
              <td><input class="cell-in" data-d="name" dir="auto" value="${esc(d.name)}" aria-label="${t('sem.dName')}"></td>
              <td><input class="cell-in" data-d="number" dir="ltr" value="${esc(d.number)}" aria-label="${t('sem.number')}"></td>
              <td><input class="cell-in" data-d="credits" type="number" step="0.5" min="0" value="${esc(d.credits)}" aria-label="${t('gpa.creditsCol')}"></td>
              <td><select class="cell-in" data-d="type" aria-label="${t('gpa.outcome')}">${outcomeOpts(d.type)}</select></td>
              <td><input class="cell-in" data-d="grade" type="number" min="0" max="100" step="1" value="${esc(d.grade)}" aria-label="${t('gpa.grade')}" ${d.type === 'graded' || d.type === 'failed' ? '' : 'disabled'}></td>
              <td><button class="icon-btn" data-action="draft-del" aria-label="${t('sem.dRemove')}">${icon.close}</button></td></tr>`).join('')}</tbody></table></div>
            ${draft.some((d) => d.dup) ? `<p class="small cat-warn">${t('sem.dup')}</p>` : ''}
            <div class="btn-row"><button class="btn btn-primary" data-action="draft-save">${t('sem.saveN', { n: draft.length })}</button>
            <button class="btn btn-ghost" data-action="draft-clear">${t('gpa.clear')}</button></div>` : ''}
        </section>
      </div>`;
  }

  /* ================= render + events ================= */
  V.render = (root, params = {}) => {
    const sem = params.id && S.semester(params.id);
    root.innerHTML = sem ? semesterHTML(sem) : listHTML();
    const box = root.querySelector('.semesters');
    box.addEventListener('click', (e) => onClick(e, root, sem));
    box.addEventListener('change', (e) => onChange(e, sem));
    const add = box.querySelector('[data-form=add]');
    if (add) {
      const yr = add.querySelector('[name=year]');
      yr.addEventListener('input', () => {
        const y = Number(yr.value);
        add.querySelector('.year-heb').innerHTML = y >= 5600 && y <= 5999 ? `<span lang="he">${esc(u.hebYear(y))}</span> <span class="muted small" dir="ltr">${esc(gregYears(y))}</span>` : '?';
      });
      add.addEventListener('submit', (e) => { e.preventDefault(); addSemester(add); });
    }
    if (sem) {
      const q = box.querySelector('[data-action=q]');
      const draw = () => drawResults(box, sem, q.value.trim());
      q.addEventListener('input', u.debounce(() => { view.q = q.value; draw(); }, 120));
      draw();
      box.querySelectorAll('.draft-table [data-d]').forEach((inp) => inp.addEventListener('input', () => {
        const d = drafts[sem.id][Number(inp.closest('tr').dataset.i)];
        d[inp.dataset.d] = inp.value;
      }));
      if (params.quick) setTimeout(() => { q.focus(); box.querySelector('#quick').scrollIntoView({ block: 'start' }); }, 0);
    }
  };

  function addSemester(form) {
    const term = form.querySelector('[name=term]').value;
    const year = Number(form.querySelector('[name=year]').value);
    if (!(year >= 5600 && year <= 5999)) { ui.toast(tx('sem.badYear', { heb: u.hebYear(5786) }), { error: true }); return; }
    const exists = S.state.semesters.find((s) => s.year === year && s.term === term);
    if (exists) { ui.toast(tx('sem.exists', { name: I.iso(exists.name) })); location.hash = `#/semesters/${exists.id}`; return; }
    let id = '';
    S.commit(tx('sem.u.add'), (st) => { const s = M.newSemester({ name: M.semName(term, year), term, year }); st.semesters.push(s); id = s.id; });
    ui.toast(tx('sem.added'), { action: { label: tx('sem.open'), fn: () => { location.hash = `#/semesters/${id}?quick=1`; } } });
  }

  function drawResults(box, sem, q) {
    const ul = box.querySelector('.quick-results');
    if (!q) { ul.innerHTML = ''; return; }
    CT.views.catalog.load();
    const nq = u.norm(q), dq = q.replace(/\D/g, '');
    const hits = [...CT.catalog.allCourses().values()]
      .filter((c) => u.norm(c.name).includes(nq) || (dq.length >= 3 && (c.num.includes(dq) || c.num.includes(G.normNum(dq)))))
      .slice(0, 12);
    const have = new Set(coursesOf(sem.id).map((c) => G.normNum(c.number)).concat((drafts[sem.id] || []).map((d) => G.normNum(d.number))));
    ul.innerHTML = hits.map((c) => `<li><button class="quick-hit" data-action="pick" data-num="${esc(c.num)}" ${have.has(c.num) ? 'disabled' : ''}>
        <span dir="ltr" class="cat-num">${esc(c.num)}</span> <span dir="rtl" lang="he">${u.highlight(c.name, q)}</span>
        <span class="muted small">${c.credits == null ? t('sem.crUnknown') : t('cp.credits', { n: c.credits })}${have.has(c.num) ? ` · ${t('sem.inList')}` : ''}</span></button></li>`).join('')
      || `<li class="muted small">${t('sem.notFound')}</li>`;
  }

  async function onClick(e, root, sem) {
    const a = e.target.closest('[data-action]');
    if (!a) return;
    const act = a.dataset.action;
    const li = a.closest('[data-id]');
    if (act === 'activate') {
      const id = sem ? sem.id : li.dataset.id;
      S.commit(tx('sem.u.active'), (st) => { st.settings.activeSemesterId = id; });
      ui.toast(tx('sem.activeNow'));
    }
    if (!sem) return;
    if (act === 'pick') {
      const c = CT.catalog.allCourses().get(a.dataset.num);
      (drafts[sem.id] = drafts[sem.id] || []).push({ name: c.name, number: c.num, credits: c.credits == null ? '' : c.credits, type: 'graded', grade: '' });
      V.render(root, { id: sem.id });
      const inputs = root.querySelectorAll('.draft-table [data-d=grade]');
      if (inputs.length) inputs[inputs.length - 1].focus();
    }
    if (act === 'manual') {
      (drafts[sem.id] = drafts[sem.id] || []).push({ name: '', number: '', credits: '', type: 'graded', grade: '' });
      V.render(root, { id: sem.id });
      const names = root.querySelectorAll('.draft-table [data-d=name]');
      names[names.length - 1].focus();
    }
    if (act === 'draft-del') { drafts[sem.id].splice(Number(a.closest('tr').dataset.i), 1); V.render(root, { id: sem.id }); const m = root.querySelector('[data-action=manual]'); if (m) m.focus(); }
    if (act === 'draft-clear') { drafts[sem.id] = []; V.render(root, { id: sem.id }); const m = root.querySelector('[data-action=manual]'); if (m) m.focus(); }
    if (act === 'draft-save') saveDraft(root, sem);
    if (act === 'del-course') {
      const c = S.course(a.closest('tr').dataset.id);
      if (!(await ui.confirm(tx('sem.delCourseQ', { name: I.iso(c.name) }), tx('cp.deleteOk'), true, { localized: true }))) return;
      S.commit(tx('sem.u.delCourse'), (st) => { st.courses = st.courses.filter((x) => x.id !== c.id); });
      ui.toast(tx('sem.deleted'), { action: { label: tx('common.undo'), fn: S.undo } });
    }
    if (act === 'edit-sem') editSemester(sem);
    if (act === 'del-sem') {
      if (!(await ui.confirm(tx('sem.delSemQ', { name: I.iso(sem.name) }), tx('cp.deleteOk'), true, { localized: true }))) return;
      S.commit(tx('sem.u.delSem'), (st) => {
        st.semesters = st.semesters.filter((s) => s.id !== sem.id);
        if (st.settings.activeSemesterId === sem.id) st.settings.activeSemesterId = '';
      });
      location.hash = '#/semesters';
    }
  }

  function saveDraft(root, sem) {
    const rows = (drafts[sem.id] || []).filter((d) => String(d.name).trim());
    const bad = rows.find((d) => (d.type === 'graded') && !(d.grade !== '' && Number(d.grade) >= 0 && Number(d.grade) <= 100));
    if (bad) { ui.toast(tx('sem.needGrade', { name: I.iso(bad.name) }), { error: true }); return; }
    if (!rows.length) { ui.toast(tx('sem.noRows')); return; }
    S.commit(tx('sem.u.quick', { n: rows.length, name: I.iso(sem.name) }), (st) => {
      rows.forEach((d) => {
        st.courses.push(M.newCourse({
          name: String(d.name).trim(), number: String(d.number || '').trim(), credits: d.credits === '' ? '' : Number(d.credits),
          semesterId: sem.id, kind: 'record', color: M.COLORS[st.courses.length % M.COLORS.length],
          outcome: { type: d.type, grade: d.grade === '' ? null : Number(d.grade), date: '', note: '', exemptCredits: st.settings.gpa.exemptCredits },
        }));
      });
    });
    drafts[sem.id] = [];
    view.q = '';
    ui.toast(tx('sem.savedN', { n: rows.length }), { action: { label: tx('common.undo'), fn: S.undo } });
  }

  function onChange(e, sem) {
    const el = e.target;
    if (!sem) return;
    if (el.closest('.draft-table') && el.dataset.d === 'type') {
      const i = el.closest('tr').dataset.i;
      drafts[sem.id][Number(i)].type = el.value;
      CT.app.rerender();
      const back = document.querySelector(`.draft-table tr[data-i="${i}"] [data-d=type]`);
      if (back) back.focus();
      return;
    }
    const tr = el.closest('tr[data-id]');
    if (!tr || !el.dataset.f) return;
    const id = tr.dataset.id;
    S.commit(tx('sem.u.grade'), (st) => {
      const c = st.courses.find((x) => x.id === id);
      if (el.dataset.f === 'credits') c.credits = el.value === '' ? '' : Number(el.value);
      if (el.dataset.f === 'type') {
        if (!el.value) c.outcome = null;
        else c.outcome = Object.assign({ grade: null, date: '', note: '', exemptCredits: st.settings.gpa.exemptCredits }, c.outcome || {}, { type: el.value });
        if (c.outcome && !(el.value === 'graded' || el.value === 'failed')) c.outcome.grade = null;
      }
      if (el.dataset.f === 'grade' && c.outcome) c.outcome.grade = el.value === '' ? null : u.clamp(Number(el.value), 0, 100);
    }, { coalesce: `sem-${id}-${el.dataset.f}` });
  }

  function editSemester(sem) {
    ui.modal({
      title: tx('sem.editTitle'),
      localized: true,
      body: `<div class="form-grid">
        <label class="field"><span>${t('sem.term')}</span><select name="term"><option value="">—</option>${M.TERM_ORDER.map((k) => `<option value="${k}" ${sem.term === k ? 'selected' : ''}>${esc(termLabel(k))}</option>`).join('')}</select></label>
        <label class="field"><span>${th('sem.yearEx', { heb: I.html(`<span lang="he">${esc(u.hebYear(5786))}</span>`) })}</span><input name="year" type="number" min="5600" max="5999" value="${esc(sem.year || '')}"></label>
        <label class="field span-2"><span>${t('sem.name')}</span><input name="name" dir="auto" value="${esc(sem.name)}"></label>
        <label class="field"><span>${t('sem.start')}</span><input name="start" type="date" value="${esc(sem.start)}"></label>
        <label class="field"><span>${t('sem.end')}</span><input name="end" type="date" value="${esc(sem.end)}"></label>
        <label class="field"><span>${t('sem.examStart')}</span><input name="examStart" type="date" value="${esc(sem.examStart)}"></label>
      </div><p class="muted small">${t('sem.datesHint')}</p>`,
      actions: [{ label: tx('common.cancel') }, { label: tx('common.save'), primary: true, fn: (api) => {
        const g = (n) => api.body.querySelector(`[name=${n}]`).value.trim();
        const year = g('year') ? Number(g('year')) : null;
        const term = g('term') || null;
        const auto = M.semName(sem.term, sem.year);
        S.commit(tx('sem.u.edit'), () => {
          const s = S.semester(sem.id);
          Object.assign(s, { term, year, start: g('start'), end: g('end'), examStart: g('examStart') });
          // keep a custom name; refresh the automatic one when term/year changed
          s.name = g('name') && g('name') !== auto ? g('name') : (M.semName(term, year) || g('name') || s.name);
        });
        return true;
      } }],
    });
  }
})(window.CT);
