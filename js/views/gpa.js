/* views/gpa.js — "ממוצע וציונים": cumulative and per-semester averages, trend chart (inline SVG), progress to the
 * degree (totals from the chosen catalog), filters, a "what if" calculator and "which average do I need".
 * All math lives in js/gpa.js; this file only collects inputs and draws. */
(function (CT) {
  'use strict';
  const { u, ui } = CT;
  const S = CT.store, M = CT.model, G = CT.gpa;
  const esc = u.esc;
  const V = {};
  CT.views = CT.views || {};
  CT.views.gpa = V;

  // view-only state (not saved): filters and what-if inputs
  const view = { sem: '', cats: new Set(Object.keys(M.REQ_CATS)), hyp: {}, target: '', remaining: '' };

  const rules = () => S.state.settings.gpa;
  const dec = () => (rules().decimals ?? 2);
  const fmt = (x) => (x == null ? '—' : String(+x.toFixed(dec())));

  /** Requirement category of a course: manual override, else from the chosen catalog by number. */
  V.reqCat = (c) => {
    if (c.reqCategory && M.REQ_CATS[c.reqCategory]) return c.reqCategory;
    const K = CT.catalog;
    const n = G.normNum(c.number);
    if (!K.ready || !n) return 'free';
    if (K.labs.includes(n)) return 'lab';
    if (K.mandatorySet.has(n)) return 'mandatory';
    if (K.electives().includes(n) || K.isFaculty(n)) return 'faculty';
    return 'free';
  };

  const include = (c) => (!view.sem || c.semesterId === view.sem) && view.cats.has(V.reqCat(c));

  /* ---------- trend chart (inline SVG, no libraries) ---------- */
  function trendSVG(trend) {
    const pts = trend.filter((t) => t.cumulative != null || t.semesterAvg != null);
    if (pts.length < 2) return '<p class="muted small">הגרף יופיע כשיהיו ציונים משני סמסטרים לפחות.</p>';
    const W = 640, H = 240, L = 44, R = 56, T = 16, B = 50;
    const vals = pts.flatMap((t) => [t.cumulative, t.semesterAvg]).filter((v) => v != null);
    const lo = Math.max(0, Math.floor((Math.min(...vals) - 3) / 5) * 5), hi = Math.min(100, Math.ceil((Math.max(...vals) + 3) / 5) * 5);
    const x = (i) => W - R - (i * (W - L - R)) / (pts.length - 1); // RTL: oldest semester on the right
    const y = (v) => T + ((hi - v) * (H - T - B)) / Math.max(1, hi - lo);
    const line = (k) => pts.map((t, i) => (t[k] == null ? null : `${x(i).toFixed(1)},${y(t[k]).toFixed(1)}`)).filter(Boolean).join(' ');
    const ticks = [];
    for (let v = lo; v <= hi; v += (hi - lo > 20 ? 10 : 5)) ticks.push(v);
    return `<svg class="trend" viewBox="0 0 ${W} ${H}" role="img" aria-label="מגמת הממוצע לאורך הסמסטרים">
      ${ticks.map((v) => `<line x1="${L}" x2="${W - R}" y1="${y(v)}" y2="${y(v)}" class="grid"/><text x="${L - 6}" y="${y(v) + 4}" class="ax" text-anchor="end">${v}</text>`).join('')}
      <polyline points="${line('semesterAvg')}" class="ln-sem"/>
      <polyline points="${line('cumulative')}" class="ln-cum"/>
      ${pts.map((t, i) => `${t.semesterAvg != null ? `<circle cx="${x(i)}" cy="${y(t.semesterAvg)}" r="3.5" class="pt-sem"><title>${esc(t.semester.name)}: ${fmt(t.semesterAvg)}</title></circle>` : ''}
        ${t.cumulative != null ? `<circle cx="${x(i)}" cy="${y(t.cumulative)}" r="4.5" class="pt-cum"><title>מצטבר אחרי ${esc(t.semester.name)}: ${fmt(t.cumulative)}</title></circle>` : ''}
        <text x="${x(i)}" y="${H - B + 18}" class="ax" text-anchor="middle">${esc(t.semester.name.replace(/\s+/, ' '))}</text>`).join('')}
    </svg>
    <div class="trend-legend small"><span class="lg lg-cum"></span> ממוצע מצטבר <span class="lg lg-sem"></span> ממוצע הסמסטר</div>`;
  }

  /* ---------- render ---------- */
  V.render = (root) => {
    const st = S.state;
    CT.views.catalog.load();
    const K = CT.catalog;
    const sems = M.sortedSemesters(st.semesters);
    const all = G.compute(st.courses, st.semesters, rules());               // everything (for degree progress)
    const res = G.compute(st.courses, st.semesters, rules(), { include }); // filtered
    const open = st.courses.filter((c) => !M.isFinished(c) && !c.gpaExclude && include(c));
    const hypRes = G.compute(st.courses, st.semesters, rules(), { include, hypothetical: view.hyp });
    const hasHyp = Object.values(view.hyp).some((v) => v !== '' && v != null);
    const openCredits = u.sum(open, (c) => Number(c.credits) || 0);
    const remaining = view.remaining !== '' ? Number(view.remaining) : openCredits;
    const req = view.target !== '' ? G.required(res.sumGC, res.avgCredits, Number(view.target), remaining) : null;

    // degree progress by requirement category (always unfiltered)
    const byCat = {};
    all.rows.forEach((r) => { if (r.earns) { const k = V.reqCat(r.course); byCat[k] = (byCat[k] || 0) + r.cls.credits; } });
    const T = K.ready ? K.totals : null;
    const pct = (a, b) => (b ? Math.min(100, Math.round((a / b) * 100)) : 0);
    const finished = res.rows.slice().sort((a, b) => (a.key[0] - b.key[0]) || a.key[1].localeCompare(b.key[1]));
    const semName = (id) => (S.semester(id) || { name: '—' }).name;
    const statusLabel = (r) => (r.status === 'superseded' ? 'חזרה — לא נספר' : r.inAvg ? (r.earns ? 'בממוצע' : 'בממוצע · ללא נק״ז') : r.earns ? 'נק״ז בלבד' : 'לא נספר');

    root.innerHTML = `
      <div class="gpa-page">
        <h1>ממוצע וציונים</h1>
        <p class="small gpa-disclaimer">ⓘ זו הערכה לצורכי מעקב אישי בלבד. הממוצע הרשמי הוא זה שמופיע במערכת האקדמית של הטכניון.
          כללי החישוב (קורס חוזר, נכשל, ציון עובר, פטור) — <a href="#/settings/degree">בהגדרות</a>.</p>

        <div class="card gpa-filters">
          <label class="small">סמסטר: <select data-f="sem" class="chip-select"><option value="">כל הסמסטרים</option>${sems.map((s) => `<option value="${s.id}" ${view.sem === s.id ? 'selected' : ''}>${esc(s.name)}</option>`).join('')}</select></label>
          <span class="small gpa-cats">${Object.entries(M.REQ_CATS).map(([k, l]) => `<label class="check-inline"><input type="checkbox" data-cat="${k}" ${view.cats.has(k) ? 'checked' : ''}> ${l}</label>`).join('')}</span>
          <span class="muted small">הקטגוריה נקבעת לפי ${K.ready ? `קטלוג ${esc(K.label)}` : 'הקטלוג'} ומספר הקורס, ואפשר לשנות לכל קורס בטבלה למטה.</span>
        </div>

        <div class="stat-cards">
          <div class="card stat gpa-main"><b>${fmt(res.avg)}</b><span>ממוצע ${view.sem || view.cats.size < 4 ? '(מסונן)' : 'מצטבר'} משוקלל</span></div>
          <div class="card stat"><b>${fmt(res.earned)}</b><span>נק״ז שנצברו${view.sem || view.cats.size < 4 ? ' (מסונן)' : ''}</span></div>
          <div class="card stat"><b>${fmt(res.avgCredits)}</b><span>נק״ז שנכנסות לממוצע</span></div>
          <div class="card stat"><b>${res.count}</b><span>קורסים שהסתיימו</span></div>
        </div>

        <section class="card">
          <h2 class="cat-h2">התקדמות לתואר</h2>
          ${T ? `<div class="cat-meter" style="--c:var(--accent)"><div class="cat-meter-top"><span>סה״כ</span><b>${fmt(all.earned)} / ${T.total}</b></div>${ui.bar(pct(all.earned, T.total), 'התקדמות לתואר')}</div>
            <div class="gpa-cat-bars">
              ${[['mandatory', T.mandatory], ['faculty', T.faculty], ['free', T.free]].map(([k, need]) => `<div class="cat-meter" style="--c:var(--accent-2)"><div class="cat-meter-top"><span>${M.REQ_CATS[k]}</span><b>${fmt(byCat[k] || 0)} / ${need}</b></div>${ui.bar(pct(byCat[k] || 0, need), M.REQ_CATS[k], true)}</div>`).join('')}
              <div class="cat-meter" style="--c:var(--gold)"><div class="cat-meter-top"><span>מעבדות</span><b>${fmt(byCat.lab || 0)}</b></div><span class="muted small">${esc(K.labRule || '')}</span></div>
            </div>
            <p class="muted small">לפי ${esc(K.trackName)}, קטלוג ${esc(K.label)} (${T.total} נק״ז). ${K.fallback ? `<b>${esc(K.fallbackWarning())}</b>` : ''} חלוקה לקטגוריות היא הערכה — לא בודקת קבוצות התמחות או כללי מעבדות.</p>`
            : '<p class="muted">אין קטלוג טעון.</p>'}
        </section>

        <section class="card">
          <h2 class="cat-h2">לפי סמסטר</h2>
          ${res.perSemester.length ? `<div class="table-wrap"><table class="sem-table">
            <thead><tr><th>סמסטר</th><th>ממוצע</th><th>נק״ז שנצברו</th><th>קורסים</th><th>מצטבר אחריו</th></tr></thead>
            <tbody>${res.perSemester.map((p) => `<tr><td>${p.semester.id ? `<a href="#/semesters/${p.semester.id}">${esc(p.semester.name)}</a>` : esc(p.semester.name)}</td>
              <td><b>${fmt(p.avg)}</b></td><td>${fmt(p.earned)}</td><td>${p.count}</td>
              <td>${fmt((res.trend.find((t) => t.semester === p.semester) || {}).cumulative)}</td></tr>`).join('')}</tbody></table></div>
            <p class="muted small">ממוצע סמסטר = כל הציונים שניתנו באותו סמסטר. המצטבר מחיל את כלל הקורס החוזר.</p>` : '<p class="muted">אין עדיין קורסים שהסתיימו. מסיימים קורס בדף הקורס, או מזינים סמסטר ישן ב<a href="#/semesters">דף הסמסטרים</a>.</p>'}
        </section>

        <section class="card">
          <h2 class="cat-h2">מגמה</h2>
          ${trendSVG(res.trend)}
        </section>

        <section class="card">
          <h2 class="cat-h2">"מה אם"</h2>
          ${open.length ? `<p class="muted small">ציון משוער לקורסים שעוד לא הסתיימו (${fmt(openCredits)} נק״ז). קורסים בלי נק״ז לא משפיעים.</p>
            <div class="whatif">${open.map((c) => `<label class="whatif-row"><span dir="auto">${esc(c.name)} <span class="muted small">${c.credits ? `${esc(c.credits)} נק״ז` : 'אין נק״ז'} · ${esc(semName(c.semesterId))}</span></span>
              <input type="number" min="0" max="100" step="1" data-hyp="${c.id}" value="${esc(view.hyp[c.id] ?? '')}" placeholder="ציון" aria-label="ציון משוער ל${esc(c.name)}"></label>`).join('')}</div>
            <p class="whatif-result">${hasHyp ? `ממוצע צפוי: <b>${fmt(hypRes.avg)}</b> ${res.avg != null && hypRes.avg != null ? `<span class="${hypRes.avg >= res.avg ? 'up' : 'down'}">(${hypRes.avg >= res.avg ? '+' : ''}${fmt(hypRes.avg - res.avg)})</span>` : ''} · נק״ז: ${fmt(hypRes.earned)}` : '<span class="muted">מלא ציונים כדי לראות את הממוצע הצפוי.</span>'}
            ${hasHyp ? '<button class="btn btn-small btn-ghost" data-action="clear-hyp">נקה</button>' : ''}</p>` : '<p class="muted">אין קורסים פתוחים (בסינון הנוכחי).</p>'}
          <h3 class="whatif-h">איזה ממוצע צריך בשאר הקורסים?</h3>
          <div class="whatif-req">
            <label class="field"><span>ממוצע יעד</span><input type="number" min="0" max="100" step="0.1" data-f="target" value="${esc(view.target)}" placeholder="למשל 88"></label>
            <label class="field"><span>נק״ז שנשארו</span><input type="number" min="0" step="0.5" data-f="remaining" value="${esc(view.remaining)}" placeholder="${fmt(openCredits)}"></label>
          </div>
          <p class="whatif-result">${req ? (req.impossible ? `צריך <b>${fmt(req.need)}</b> בממוצע — מעל 100, כלומר לא אפשרי עם ${fmt(remaining)} נק״ז.`
            : req.secured ? 'היעד כבר מובטח — גם ציונים נמוכים בשאר לא יורידו אותך מתחתיו (בכפוף לכלל הנכשלים).'
              : `צריך ממוצע <b>${fmt(req.need)}</b> ב־${fmt(remaining)} הנק״ז שנשארו.`)
            : '<span class="muted">מלא יעד. ברירת המחדל לנק״ז שנשארו = הקורסים הפתוחים, ואפשר להקליד מספר אחר (למשל מה שנשאר לתואר).</span>'}</p>
        </section>

        <section class="card">
          <h2 class="cat-h2">קורסים שהסתיימו</h2>
          ${finished.length ? `<div class="table-wrap"><table class="sem-table gpa-table">
            <thead><tr><th title="לכלול בחישוב">כלול</th><th>קורס</th><th>סמסטר</th><th>נק״ז</th><th>קטגוריה</th><th>סיום</th><th>ציון</th><th>בחישוב</th></tr></thead>
            <tbody>${finished.map((r) => { const c = r.course; return `<tr data-id="${c.id}" class="${r.status === 'superseded' ? 'superseded' : ''}">
              <td><input type="checkbox" data-f="include" checked aria-label="לכלול את ${esc(c.name)}"></td>
              <td><a href="#/course/${c.id}" dir="auto">${esc(c.name)}</a>${r.repeated ? ' <span class="pill pill-muted">חוזר</span>' : ''}</td>
              <td class="small">${esc(semName(c.semesterId))}</td>
              <td>${r.cls.missingCredits ? '<span class="cat-q" title="חסרות נקודות זכות">?</span>' : fmt(r.cls.credits)}</td>
              <td><select class="cell-in" data-f="reqCategory" aria-label="קטגוריה"><option value="">אוטומטי (${M.REQ_CATS[V.reqCat(Object.assign({}, c, { reqCategory: '' }))]})</option>${Object.entries(M.REQ_CATS).map(([k, l]) => `<option value="${k}" ${c.reqCategory === k ? 'selected' : ''}>${l}</option>`).join('')}</select></td>
              <td>${ui.outcomeBadge(c)}</td>
              <td>${r.cls.grade == null ? '—' : fmt(r.cls.grade)}</td>
              <td class="small">${statusLabel(r)}</td></tr>`; }).join('')}</tbody></table></div>` : '<p class="muted">אין קורסים בסינון הנוכחי.</p>'}
          ${st.courses.some((c) => c.gpaExclude) ? `<p class="small">הוצאו מהחישוב: ${st.courses.filter((c) => c.gpaExclude).map((c) => `<button class="btn btn-small btn-ghost" data-action="reinclude" data-id="${c.id}">${esc(c.name)} ↩</button>`).join(' ')}</p>` : ''}
        </section>
      </div>`;

    const box = root.querySelector('.gpa-page');
    box.addEventListener('change', (e) => {
      const t = e.target;
      if (t.dataset.f === 'sem') { view.sem = t.value; V.render(root); return; }
      if (t.dataset.cat) { if (t.checked) view.cats.add(t.dataset.cat); else view.cats.delete(t.dataset.cat); V.render(root); return; }
      const tr = t.closest('tr[data-id]');
      if (tr && t.dataset.f === 'include') S.commit('הוצאה מחישוב הממוצע', (s) => { s.courses.find((c) => c.id === tr.dataset.id).gpaExclude = true; });
      if (tr && t.dataset.f === 'reqCategory') S.commit('קטגוריית קורס', (s) => { s.courses.find((c) => c.id === tr.dataset.id).reqCategory = t.value; });
    });
    // what-if inputs: recompute on typing without losing focus
    const keepFocus = (sel) => { V.render(root); const el = root.querySelector(sel); if (el) { el.focus(); const v = el.value; el.value = ''; el.value = v; } };
    box.addEventListener('input', u.debounce((e) => {
      const t = e.target;
      if (t.dataset.hyp) { view.hyp[t.dataset.hyp] = t.value; keepFocus(`[data-hyp="${t.dataset.hyp}"]`); }
      if (t.dataset.f === 'target' || t.dataset.f === 'remaining') { view[t.dataset.f] = t.value; keepFocus(`[data-f="${t.dataset.f}"]`); }
    }, 300));
    box.addEventListener('click', (e) => {
      const a = e.target.closest('[data-action]');
      if (!a) return;
      if (a.dataset.action === 'clear-hyp') { view.hyp = {}; V.render(root); }
      if (a.dataset.action === 'reinclude') S.commit('החזרה לחישוב הממוצע', (s) => { s.courses.find((c) => c.id === a.dataset.id).gpaExclude = false; });
    });
  };
})(window.CT);
