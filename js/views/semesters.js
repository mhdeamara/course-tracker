/* views/semesters.js — all semesters (past and present) on a timeline, a light read/edit view per semester,
 * and quick entry of a past semester: pick courses from the catalog (or type one in), give each a grade, save once.
 * Courses entered this way are kind:'record' — no lectures / tasks, they only count for grades and credits. */
(function (CT) {
  'use strict';
  const { u, ui } = CT;
  const S = CT.store, M = CT.model, G = CT.gpa;
  const esc = u.esc, icon = u.icon;
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
      <div class="semesters">
        <h1>סמסטרים</h1>
        <p class="muted small">כל הסמסטרים, כולל שנים קודמות. הדשבורד, "מה דחוף" והספירה לאחור מתייחסים רק לסמסטר הפעיל. סמסטר ישן נפתח בתצוגה מקוצרת: רשימת קורסים וציונים, בלי משימות.</p>
        <section class="card sem-add">
          <h2 class="cat-h2">הוספת סמסטר</h2>
          <form class="sem-add-form" data-form="add">
            <label class="field"><span>מועד</span><select name="term">${M.TERM_ORDER.map((t) => `<option value="${t}">${M.TERMS[t]}</option>`).join('')}</select></label>
            <label class="field"><span>שנה אקדמית (עברית)</span>
              <span class="year-input"><input name="year" type="number" min="5600" max="5999" step="1" value="${y0}" required aria-describedby="year-heb"><b id="year-heb" class="year-heb">${u.hebYear(y0)}</b></span></label>
            <button class="btn btn-primary" type="submit">${icon.plus} הוסף</button>
          </form>
          <p class="muted small">שנה אקדמית לפי השנה העברית: תשפ״ז = 5787 (2026/27). חורף ואביב של אותה שנה אקדמית — אותו מספר. אין הגבלה לאחור.</p>
        </section>
        ${[...byYear.entries()].map(([year, list]) => `
          <section class="sem-year">
            <h2 class="sem-year-title">${year ? `${u.hebYear(year)} <span class="muted small" dir="ltr">${year - 3761}/${String(year - 3760).slice(2)}</span>` : 'ללא שנה (לעדכן)'}</h2>
            <ul class="semx-list">${list.map((s) => {
              const cs = coursesOf(s.id);
              const p = per.get(s.id);
              const active = s.id === st.settings.activeSemesterId;
              return `<li class="card sem-item${active ? ' active' : ''}" data-id="${s.id}">
                <a class="sem-name" href="#/semesters/${s.id}"><b>${esc(s.name)}</b>${active ? ' <span class="pill">פעיל</span>' : ''}</a>
                <span class="sem-stats small">${cs.length} קורסים · ${p ? `${fmt(p.earned)} נק״ז · ממוצע ${fmt(p.avg)}` : 'אין ציונים'}</span>
                <span class="sem-actions">
                  ${active ? '' : '<button class="btn btn-small btn-ghost" data-action="activate">הפוך לפעיל</button>'}
                  <a class="btn btn-small" href="#/semesters/${s.id}?quick=1">הזנה מהירה</a>
                </span></li>`;
            }).join('')}</ul>
          </section>`).join('') || ui.empty('אין עדיין סמסטרים.')}
      </div>`;
  }

  /* ================= one semester ================= */
  function semesterHTML(sem) {
    const st = S.state;
    const cs = coursesOf(sem.id);
    const calc = G.compute(cs, st.semesters, rules());
    const p = calc.perSemester[0];
    const active = sem.id === st.settings.activeSemesterId;
    const outcomeOptions = (c) => `<option value="" ${M.isFinished(c) ? '' : 'selected'}>— בתהליך —</option>` +
      Object.entries(M.OUTCOMES).map(([k, d]) => `<option value="${k}" ${c.outcome && c.outcome.type === k ? 'selected' : ''}>${d.label}</option>`).join('');
    const rows = cs.map((c) => {
      const o = c.outcome || {};
      const needsGrade = o.type === 'graded' || o.type === 'failed';
      return `<tr data-id="${c.id}">
        <td><a href="#/course/${c.id}" dir="auto">${esc(c.name)}</a>${c.kind === 'record' ? '' : ' <span class="muted small">(מעקב מלא)</span>'}</td>
        <td dir="ltr" class="num">${esc(c.number)}</td>
        <td><input class="cell-in" data-f="credits" type="number" step="0.5" min="0" value="${esc(c.credits)}" aria-label="נקודות זכות"></td>
        <td><select class="cell-in" data-f="type" aria-label="סוג סיום">${outcomeOptions(c)}</select></td>
        <td><input class="cell-in" data-f="grade" type="number" min="0" max="100" step="1" value="${u.isNum(o.grade) ? o.grade : ''}" ${needsGrade ? '' : 'disabled'} aria-label="ציון"></td>
        <td><button class="icon-btn" data-action="del-course" aria-label="מחק את ${esc(c.name)}">${icon.trash}</button></td>
      </tr>`;
    }).join('');
    const draft = drafts[sem.id] || [];
    return `
      <div class="semesters sem-detail" data-sem="${sem.id}">
        <a class="muted small" href="#/semesters">← כל הסמסטרים</a>
        <div class="section-head" style="margin-top:6px">
          <h1>${esc(sem.name)} ${active ? '<span class="pill">פעיל</span>' : ''}</h1>
          <div class="toolbar-actions">
            ${active ? '' : '<button class="btn" data-action="activate">הפוך לסמסטר הפעיל</button>'}
            <button class="btn btn-ghost" data-action="edit-sem">${icon.edit} עריכה</button>
            <button class="icon-btn" data-action="del-sem" aria-label="מחיקת הסמסטר" ${cs.length ? 'disabled title="יש קורסים בסמסטר"' : ''}>${icon.trash}</button>
          </div>
        </div>
        <div class="stat-cards">
          <div class="card stat"><b>${fmt(p && p.avg)}</b><span>ממוצע הסמסטר</span></div>
          <div class="card stat"><b>${fmt(p ? p.earned : 0)}</b><span>נק״ז שנצברו</span></div>
          <div class="card stat"><b>${cs.length}</b><span>קורסים</span></div>
        </div>
        <section class="card">
          <h2 class="cat-h2">קורסים</h2>
          ${cs.length ? `<div class="table-wrap"><table class="sem-table">
            <thead><tr><th>קורס</th><th>מספר</th><th>נק״ז</th><th>סיום</th><th>ציון</th><th></th></tr></thead>
            <tbody>${rows}</tbody></table></div>` : '<p class="muted">אין עדיין קורסים בסמסטר הזה.</p>'}
          <p class="muted small">שינויים נשמרים מיד (אפשר לבטל עם Ctrl+Z). לפרטים מלאים — לחיצה על שם הקורס.</p>
        </section>

        <section class="card quick" id="quick">
          <h2 class="cat-h2">הזנה מהירה</h2>
          <p class="muted small">חיפוש בכל קטלוגי הפקולטה לפי שם או מספר → הוספה לטבלה → ציון לכל קורס → שמירה אחת. הקורסים נשמרים בלי הרצאות ומשימות.</p>
          <div class="search cat-search">${icon.search}<input type="search" data-action="q" placeholder="שם או מספר קורס…" value="${esc(view.q)}" aria-label="חיפוש קורס להוספה"></div>
          <ul class="quick-results" role="listbox"></ul>
          <button class="btn btn-ghost btn-small" data-action="manual">${icon.plus} קורס שלא בקטלוג (הכרה / מעבר ממוסד אחר)</button>
          ${draft.length ? `<div class="table-wrap"><table class="sem-table draft-table">
            <thead><tr><th>קורס</th><th>מספר</th><th>נק״ז</th><th>סיום</th><th>ציון</th><th></th></tr></thead>
            <tbody>${draft.map((d, i) => `<tr data-i="${i}">
              <td><input class="cell-in" data-d="name" dir="auto" value="${esc(d.name)}" aria-label="שם"></td>
              <td><input class="cell-in" data-d="number" dir="ltr" value="${esc(d.number)}" aria-label="מספר"></td>
              <td><input class="cell-in" data-d="credits" type="number" step="0.5" min="0" value="${esc(d.credits)}" aria-label="נקודות זכות"></td>
              <td><select class="cell-in" data-d="type" aria-label="סוג סיום">${Object.entries(M.OUTCOMES).map(([k, x]) => `<option value="${k}" ${d.type === k ? 'selected' : ''}>${x.label}</option>`).join('')}</select></td>
              <td><input class="cell-in" data-d="grade" type="number" min="0" max="100" step="1" value="${esc(d.grade)}" aria-label="ציון" ${d.type === 'graded' || d.type === 'failed' ? '' : 'disabled'}></td>
              <td><button class="icon-btn" data-action="draft-del" aria-label="הסר שורה">${icon.close}</button></td></tr>`).join('')}</tbody></table></div>
            ${draft.some((d) => d.dup) ? '<p class="small cat-warn">שורות מסומנות: הקורס כבר קיים בסמסטר הזה.</p>' : ''}
            <div class="btn-row"><button class="btn btn-primary" data-action="draft-save">שמור ${draft.length} קורסים</button>
            <button class="btn btn-ghost" data-action="draft-clear">נקה</button></div>` : ''}
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
      yr.addEventListener('input', () => { add.querySelector('.year-heb').textContent = u.hebYear(yr.value) || '?'; });
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
    if (!(year >= 5600 && year <= 5999)) { ui.toast('שנה לא תקינה (למשל 5786 = תשפ״ו)', { error: true }); return; }
    const exists = S.state.semesters.find((s) => s.year === year && s.term === term);
    if (exists) { ui.toast(`${exists.name} כבר קיים`); location.hash = `#/semesters/${exists.id}`; return; }
    let id = '';
    S.commit('הוספת סמסטר', (st) => { const s = M.newSemester({ name: M.semName(term, year), term, year }); st.semesters.push(s); id = s.id; });
    ui.toast('הסמסטר נוסף', { action: { label: 'פתח', fn: () => { location.hash = `#/semesters/${id}?quick=1`; } } });
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
    ul.innerHTML = hits.map((c) => `<li><button class="quick-hit" data-action="pick" data-num="${c.num}" ${have.has(c.num) ? 'disabled' : ''}>
        <span dir="ltr" class="cat-num">${c.num}</span> <span dir="auto">${u.highlight(c.name, q)}</span>
        <span class="muted small">${c.credits == null ? '? נק׳' : `${c.credits} נק׳`}${have.has(c.num) ? ' · כבר ברשימה' : ''}</span></button></li>`).join('')
      || '<li class="muted small">לא נמצא בקטלוג. אפשר להוסיף ידנית.</li>';
  }

  async function onClick(e, root, sem) {
    const a = e.target.closest('[data-action]');
    if (!a) return;
    const act = a.dataset.action;
    const li = a.closest('[data-id]');
    if (act === 'activate') {
      const id = sem ? sem.id : li.dataset.id;
      S.commit('סמסטר פעיל', (st) => { st.settings.activeSemesterId = id; });
      ui.toast('הדשבורד מציג עכשיו את הסמסטר הזה');
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
    if (act === 'draft-del') { drafts[sem.id].splice(Number(a.closest('tr').dataset.i), 1); V.render(root, { id: sem.id }); }
    if (act === 'draft-clear') { drafts[sem.id] = []; V.render(root, { id: sem.id }); }
    if (act === 'draft-save') saveDraft(root, sem);
    if (act === 'del-course') {
      const c = S.course(a.closest('tr').dataset.id);
      if (!(await ui.confirm(`למחוק את "${c.name}" מהסמסטר?`, 'מחק', true))) return;
      S.commit('מחיקת קורס', (st) => { st.courses = st.courses.filter((x) => x.id !== c.id); });
      ui.toast('נמחק', { action: { label: 'בטל', fn: S.undo } });
    }
    if (act === 'edit-sem') editSemester(sem);
    if (act === 'del-sem') {
      if (!(await ui.confirm(`למחוק את הסמסטר "${sem.name}"?`, 'מחק', true))) return;
      S.commit('מחיקת סמסטר', (st) => {
        st.semesters = st.semesters.filter((s) => s.id !== sem.id);
        if (st.settings.activeSemesterId === sem.id) st.settings.activeSemesterId = '';
      });
      location.hash = '#/semesters';
    }
  }

  function saveDraft(root, sem) {
    const rows = (drafts[sem.id] || []).filter((d) => String(d.name).trim());
    const bad = rows.find((d) => (d.type === 'graded') && !(d.grade !== '' && Number(d.grade) >= 0 && Number(d.grade) <= 100));
    if (bad) { ui.toast(`חסר ציון (0–100) ל"${bad.name}". אפשר לבחור סוג סיום אחר אם אין ציון.`, { error: true }); return; }
    if (!rows.length) { ui.toast('אין שורות לשמירה'); return; }
    S.commit(`הזנת ${rows.length} קורסים ל${sem.name}`, (st) => {
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
    ui.toast(`נשמרו ${rows.length} קורסים`, { action: { label: 'בטל', fn: S.undo } });
  }

  function onChange(e, sem) {
    const t = e.target;
    if (!sem) return;
    if (t.closest('.draft-table') && t.dataset.d === 'type') {
      drafts[sem.id][Number(t.closest('tr').dataset.i)].type = t.value;
      CT.app.rerender();
      return;
    }
    const tr = t.closest('tr[data-id]');
    if (!tr || !t.dataset.f) return;
    const id = tr.dataset.id;
    S.commit('עריכת ציון', (st) => {
      const c = st.courses.find((x) => x.id === id);
      if (t.dataset.f === 'credits') c.credits = t.value === '' ? '' : Number(t.value);
      if (t.dataset.f === 'type') {
        if (!t.value) c.outcome = null;
        else c.outcome = Object.assign({ grade: null, date: '', note: '', exemptCredits: st.settings.gpa.exemptCredits }, c.outcome || {}, { type: t.value });
        if (c.outcome && !(t.value === 'graded' || t.value === 'failed')) c.outcome.grade = null;
      }
      if (t.dataset.f === 'grade' && c.outcome) c.outcome.grade = t.value === '' ? null : u.clamp(Number(t.value), 0, 100);
    }, { coalesce: `sem-${id}-${t.dataset.f}` });
  }

  function editSemester(sem) {
    ui.modal({
      title: 'עריכת סמסטר',
      body: `<div class="form-grid">
        <label class="field"><span>מועד</span><select name="term"><option value="">—</option>${M.TERM_ORDER.map((t) => `<option value="${t}" ${sem.term === t ? 'selected' : ''}>${M.TERMS[t]}</option>`).join('')}</select></label>
        <label class="field"><span>שנה אקדמית (5786 = תשפ״ו)</span><input name="year" type="number" min="5600" max="5999" value="${esc(sem.year || '')}"></label>
        <label class="field span-2"><span>שם לתצוגה</span><input name="name" dir="auto" value="${esc(sem.name)}"></label>
        <label class="field"><span>תחילת הלימודים</span><input name="start" type="date" value="${esc(sem.start)}"></label>
        <label class="field"><span>סוף הלימודים</span><input name="end" type="date" value="${esc(sem.end)}"></label>
        <label class="field"><span>תחילת המבחנים</span><input name="examStart" type="date" value="${esc(sem.examStart)}"></label>
      </div><p class="muted small">התאריכים משמשים רק לסמסטר הפעיל (שבוע נוכחי, ספירה לאחור). לסמסטר ישן אפשר להשאיר ריק.</p>`,
      actions: [{ label: 'ביטול' }, { label: 'שמור', primary: true, fn: (api) => {
        const g = (n) => api.body.querySelector(`[name=${n}]`).value.trim();
        const year = g('year') ? Number(g('year')) : null;
        const term = g('term') || null;
        const auto = M.semName(sem.term, sem.year);
        S.commit('עריכת סמסטר', () => {
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
