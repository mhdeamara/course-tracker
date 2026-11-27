/* views/gpa.js — GPA & grades: cumulative and per-semester averages, trend chart (inline SVG), progress to the
 * degree (totals from the chosen catalog), filters, a "what if" calculator and "which average do I need".
 * All math lives in js/gpa.js; this file only collects inputs and draws. */
(function (CT) {
  'use strict';
  const { u, ui } = CT;
  const S = CT.store, M = CT.model, G = CT.gpa, I = CT.i18n;
  const esc = u.esc;
  const t = (k, p) => I.t(k, p), tx = (k, p) => I.tx(k, p), th = (k, p) => I.th(k, p);
  const V = {};
  CT.views = CT.views || {};
  CT.views.gpa = V;

  // view-only state (not saved): filters and what-if inputs
  const view = { sem: '', cats: new Set(Object.keys(M.REQ_CATS)), hyp: {}, target: '', remaining: '' };

  const rules = () => S.state.settings.gpa;
  const dec = () => (rules().decimals ?? 2);
  const fmt = (x) => (x == null ? '—' : String(+x.toFixed(dec())));
  /** Requirement category label (the stored key never changes). */
  V.catLabel = (k) => (M.REQ_CATS[k] ? tx('req.' + k) : String(k || ''));

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
    const pts = trend.filter((p) => p.cumulative != null || p.semesterAvg != null);
    if (pts.length < 2) return `<p class="muted small">${t('gpa.trendEmpty')}</p>`;
    const W = 640, H = 240, L = 44, R = 56, T = 16, B = 50;
    const vals = pts.flatMap((p) => [p.cumulative, p.semesterAvg]).filter((v) => v != null);
    const lo = Math.max(0, Math.floor((Math.min(...vals) - 3) / 5) * 5), hi = Math.min(100, Math.ceil((Math.max(...vals) + 3) / 5) * 5);
    const rtl = I.dir() === 'rtl';
    // reading order: the oldest semester comes first (right in Hebrew, left in English)
    const x = (i) => (rtl ? W - R - (i * (W - L - R)) / (pts.length - 1) : L + 8 + (i * (W - L - R)) / (pts.length - 1));
    const y = (v) => T + ((hi - v) * (H - T - B)) / Math.max(1, hi - lo);
    const line = (k) => pts.map((p, i) => (p[k] == null ? null : `${x(i).toFixed(1)},${y(p[k]).toFixed(1)}`)).filter(Boolean).join(' ');
    const ticks = [];
    for (let v = lo; v <= hi; v += (hi - lo > 20 ? 10 : 5)) ticks.push(v);
    const axX = rtl ? L - 6 : L - 6;
    return `<svg class="trend" viewBox="0 0 ${W} ${H}" role="img" aria-label="${t('gpa.trendLabel')}">
      ${ticks.map((v) => `<line x1="${L}" x2="${W - R + (rtl ? 0 : 8)}" y1="${y(v)}" y2="${y(v)}" class="grid"/><text x="${axX}" y="${y(v) + 4}" class="ax" text-anchor="end">${v}</text>`).join('')}
      <polyline points="${line('semesterAvg')}" class="ln-sem"/>
      <polyline points="${line('cumulative')}" class="ln-cum"/>
      ${pts.map((p, i) => `${p.semesterAvg != null ? `<circle cx="${x(i)}" cy="${y(p.semesterAvg)}" r="3.5" class="pt-sem"><title>${esc(I.iso(p.semester.name))}: ${fmt(p.semesterAvg)}</title></circle>` : ''}
        ${p.cumulative != null ? `<circle cx="${x(i)}" cy="${y(p.cumulative)}" r="4.5" class="pt-cum"><title>${t('gpa.cumAfter', { name: I.iso(p.semester.name), n: fmt(p.cumulative) })}</title></circle>` : ''}
        <text x="${x(i)}" y="${H - B + 18}" class="ax" text-anchor="middle" direction="${rtl ? 'rtl' : 'ltr'}">${esc(p.semester.name.replace(/\s+/, ' '))}</text>`).join('')}
    </svg>
    <div class="trend-legend small"><span class="lg lg-cum"></span> ${t('gpa.legendCum')} <span class="lg lg-sem"></span> ${t('gpa.legendSem')}</div>`;
  }

  const statusLabel = (r) => tx(r.status === 'superseded' ? 'gpa.st.superseded' : r.inAvg ? (r.earns ? 'gpa.st.inAvg' : 'gpa.st.inAvgNoCr') : r.earns ? 'gpa.st.creditsOnly' : 'gpa.st.notCounted');

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
    const filtered = !!view.sem || view.cats.size < Object.keys(M.REQ_CATS).length;

    // degree progress by requirement category (always unfiltered)
    const byCat = {};
    all.rows.forEach((r) => { if (r.earns) { const k = V.reqCat(r.course); byCat[k] = (byCat[k] || 0) + r.cls.credits; } });
    const T = K.ready ? K.totals : null;
    const pct = (a, b) => (b ? Math.min(100, Math.round((a / b) * 100)) : 0);
    const finished = res.rows.slice().sort((a, b) => (a.key[0] - b.key[0]) || a.key[1].localeCompare(b.key[1]));
    const semName = (id) => (S.semester(id) || { name: '—' }).name;
    const totalPct = T ? pct(all.earned, T.total) : 0;

    root.innerHTML = `
      <div class="gpa-page page-wide">
        <header class="pg-head">
          <h1>${t('gpa.title')}</h1>
          <p class="small muted gpa-disclaimer">${t('gpa.disclaimer')} <a href="#/settings/degree">${t('gpa.rulesLink')}</a></p>
        </header>

        <div class="gpa-hero">
          <div class="card gpa-kpi gpa-main">
            <span class="kpi-l">${t(filtered ? 'gpa.avgFiltered' : 'gpa.avgCum')}</span>
            <b class="kpi-v" dir="ltr">${fmt(res.avg)}</b>
            <span class="kpi-s small muted">${t('gpa.avgCredits', { n: fmt(res.avgCredits) })}</span>
          </div>
          <div class="card gpa-kpi">
            <span class="kpi-l">${t(filtered ? 'gpa.earnedFiltered' : 'gpa.earned')}</span>
            <b class="kpi-v" dir="ltr">${fmt(res.earned)}</b>
            <span class="kpi-s small muted">${t('gpa.finishedN', { n: res.count })}</span>
          </div>
          ${T ? `<div class="card gpa-kpi gpa-kpi-ring">
            ${ui.ring ? ui.ring(totalPct, 56) : ''}
            <span><span class="kpi-l">${t('gpa.toDegree')}</span><b class="kpi-v kpi-v-sm" dir="ltr">${fmt(all.earned)} / ${T.total}</b></span>
          </div>` : ''}
        </div>

        <div class="card gpa-filters" role="group" aria-label="${t('gpa.filters')}">
          <label class="small">${t('gpa.semester')} <select data-f="sem" class="chip-select"><option value="">${t('gpa.allSems')}</option>${sems.map((s) => `<option value="${esc(s.id)}" ${view.sem === s.id ? 'selected' : ''}>${esc(s.name)}</option>`).join('')}</select></label>
          <span class="small gpa-cats">${Object.keys(M.REQ_CATS).map((k) => `<label class="check-inline"><input type="checkbox" data-cat="${k}" ${view.cats.has(k) ? 'checked' : ''}> ${esc(V.catLabel(k))}</label>`).join('')}</span>
          <span class="muted small">${K.ready ? th('gpa.catBy', { label: I.bdi(K.label) }) : t('gpa.catByNone')}</span>
        </div>

        <div class="gpa-grid">
          <section class="card">
            <h2 class="cat-h2">${t('gpa.progress')}</h2>
            ${T ? `<div class="gpa-cat-bars">
                ${[['mandatory', T.mandatory], ['faculty', T.faculty], ['free', T.free]].map(([k, need]) => `<div class="cat-meter" style="--c:var(--accent-2)"><div class="cat-meter-top"><span>${esc(V.catLabel(k))}</span><b dir="ltr">${fmt(byCat[k] || 0)} / ${need}</b></div>${ui.bar(pct(byCat[k] || 0, need), V.catLabel(k), true)}</div>`).join('')}
                <div class="cat-meter" style="--c:var(--gold)"><div class="cat-meter-top"><span>${esc(V.catLabel('lab'))}</span><b dir="ltr">${fmt(byCat.lab || 0)}</b></div>${K.labRule ? `<span class="muted small" dir="rtl" lang="he">${esc(K.labRule)}</span>` : ''}</div>
              </div>
              <p class="muted small">${th('gpa.byCatalog', { track: I.bdi(K.trackName), label: I.bdi(K.label), n: T.total })} ${K.fallback ? `<b>${CT.views.catalog.fallbackHTML()}</b>` : ''} ${t('gpa.estimate')}</p>`
              : `<p class="muted">${t('gpa.noCatalog')}</p>`}
          </section>

          <section class="card">
            <h2 class="cat-h2">${t('gpa.trend')}</h2>
            ${trendSVG(res.trend)}
          </section>
        </div>

        <section class="card">
          <h2 class="cat-h2">${t('gpa.bySem')}</h2>
          ${res.perSemester.length ? `<div class="table-wrap"><table class="sem-table">
            <thead><tr><th scope="col">${t('gpa.semester')}</th><th scope="col">${t('gpa.avg')}</th><th scope="col">${t('gpa.earnedCol')}</th><th scope="col">${t('gpa.coursesCol')}</th><th scope="col">${t('gpa.cumAfterCol')}</th></tr></thead>
            <tbody>${res.perSemester.map((p) => `<tr><td>${p.semester.id ? `<a href="#/semesters/${esc(p.semester.id)}" dir="auto">${esc(p.semester.name)}</a>` : t('gpa.noSem')}</td>
              <td><b>${fmt(p.avg)}</b></td><td>${fmt(p.earned)}</td><td>${p.count}</td>
              <td>${fmt((res.trend.find((x) => x.semester === p.semester) || {}).cumulative)}</td></tr>`).join('')}</tbody></table></div>
            <p class="muted small">${t('gpa.bySemNote')}</p>` : `<p class="muted">${t('gpa.noneFinished')} <a href="#/semesters">${t('gpa.semPage')}</a></p>`}
        </section>

        <div class="gpa-grid">
          <section class="card">
            <h2 class="cat-h2">${t('gpa.whatIf')}</h2>
            ${open.length ? `<p class="muted small">${t('gpa.whatIfHint', { n: fmt(openCredits) })}</p>
              <div class="whatif">${open.map((c) => `<label class="whatif-row"><span><span dir="auto">${esc(c.name)}</span> <span class="muted small">${c.credits ? t('cp.credits', { n: c.credits }) : t('gpa.noCredits')} · <bdi>${esc(semName(c.semesterId))}</bdi></span></span>
                <input type="number" min="0" max="100" step="1" data-hyp="${esc(c.id)}" value="${esc(view.hyp[c.id] ?? '')}" placeholder="${t('gpa.gradePh')}" aria-label="${t('gpa.gradeFor', { name: I.iso(c.name) })}"></label>`).join('')}</div>
              <p class="whatif-result" aria-live="polite">${hasHyp ? `${t('gpa.expected')} <b>${fmt(hypRes.avg)}</b> ${res.avg != null && hypRes.avg != null ? `<span class="${hypRes.avg >= res.avg ? 'up' : 'down'}" dir="ltr">(${hypRes.avg >= res.avg ? '+' : ''}${fmt(hypRes.avg - res.avg)})</span>` : ''} · ${t('gpa.creditsN', { n: fmt(hypRes.earned) })}` : `<span class="muted">${t('gpa.fillGrades')}</span>`}
              ${hasHyp ? `<button class="btn btn-small btn-ghost" data-action="clear-hyp">${t('gpa.clear')}</button>` : ''}</p>` : `<p class="muted">${t('gpa.noOpen')}</p>`}
          </section>

          <section class="card">
            <h2 class="cat-h2">${t('gpa.needQ')}</h2>
            <div class="whatif-req">
              <label class="field"><span>${t('gpa.target')}</span><input type="number" min="0" max="100" step="0.1" data-f="target" value="${esc(view.target)}" placeholder="${t('gpa.targetPh')}"></label>
              <label class="field"><span>${t('gpa.remaining')}</span><input type="number" min="0" step="0.5" data-f="remaining" value="${esc(view.remaining)}" placeholder="${fmt(openCredits)}"></label>
            </div>
            <p class="whatif-result" aria-live="polite">${req ? (req.impossible ? th('gpa.impossible', { need: I.html(`<b>${esc(fmt(req.need))}</b>`), n: fmt(remaining) })
              : req.secured ? t('gpa.secured')
                : th('gpa.need', { need: I.html(`<b>${esc(fmt(req.need))}</b>`), n: fmt(remaining) }))
              : `<span class="muted">${t('gpa.needHint')}</span>`}</p>
          </section>
        </div>

        <section class="card">
          <h2 class="cat-h2">${t('gpa.finished')}</h2>
          ${finished.length ? `<div class="table-wrap"><table class="sem-table gpa-table">
            <thead><tr><th scope="col" title="${t('gpa.includeTitle')}">${t('gpa.include')}</th><th scope="col">${t('gpa.course')}</th><th scope="col">${t('gpa.semester')}</th><th scope="col">${t('gpa.creditsCol')}</th><th scope="col">${t('gpa.category')}</th><th scope="col">${t('gpa.outcome')}</th><th scope="col">${t('gpa.grade')}</th><th scope="col">${t('gpa.inCalc')}</th></tr></thead>
            <tbody>${finished.map((r) => { const c = r.course; return `<tr data-id="${esc(c.id)}" class="${r.status === 'superseded' ? 'superseded' : ''}">
              <td><input type="checkbox" data-f="include" checked aria-label="${t('gpa.includeName', { name: I.iso(c.name) })}"></td>
              <td><a href="#/course/${esc(c.id)}" dir="auto">${esc(c.name)}</a>${r.repeated ? ` <span class="pill pill-muted">${t('gpa.repeated')}</span>` : ''}</td>
              <td class="small"><bdi>${esc(semName(c.semesterId))}</bdi></td>
              <td>${r.cls.missingCredits ? `<span class="cat-q" title="${t('gpa.missingCredits')}">?</span>` : fmt(r.cls.credits)}</td>
              <td><select class="cell-in" data-f="reqCategory" aria-label="${t('gpa.category')}"><option value="">${t('gpa.auto', { cat: V.catLabel(V.reqCat(Object.assign({}, c, { reqCategory: '' }))) })}</option>${Object.keys(M.REQ_CATS).map((k) => `<option value="${k}" ${c.reqCategory === k ? 'selected' : ''}>${esc(V.catLabel(k))}</option>`).join('')}</select></td>
              <td>${ui.outcomeBadge(c)}</td>
              <td>${r.cls.grade == null ? '—' : fmt(r.cls.grade)}</td>
              <td class="small">${esc(statusLabel(r))}</td></tr>`; }).join('')}</tbody></table></div>` : `<p class="muted">${t('gpa.noneFiltered')}</p>`}
          ${st.courses.some((c) => c.gpaExclude) ? `<p class="small">${t('gpa.excluded')} ${st.courses.filter((c) => c.gpaExclude).map((c) => `<button class="btn btn-small btn-ghost" data-action="reinclude" data-id="${esc(c.id)}" title="${t('gpa.reinclude')}"><bdi>${esc(c.name)}</bdi> ↩</button>`).join(' ')}</p>` : ''}
        </section>
      </div>`;

    const box = root.querySelector('.gpa-page');
    box.addEventListener('change', (e) => {
      const el = e.target;
      if (el.dataset.f === 'sem') { view.sem = el.value; V.render(root); return; }
      if (el.dataset.cat) { if (el.checked) view.cats.add(el.dataset.cat); else view.cats.delete(el.dataset.cat); V.render(root); root.querySelector(`[data-cat="${el.dataset.cat}"]`).focus(); return; }
      const tr = el.closest('tr[data-id]');
      if (tr && el.dataset.f === 'include') S.commit(tx('gpa.u.exclude'), (s) => { s.courses.find((c) => c.id === tr.dataset.id).gpaExclude = true; });
      if (tr && el.dataset.f === 'reqCategory') S.commit(tx('gpa.u.category'), (s) => { s.courses.find((c) => c.id === tr.dataset.id).reqCategory = el.value; });
    });
    // what-if inputs: recompute on typing without losing focus
    const keepFocus = (sel) => { V.render(root); const el = root.querySelector(sel); if (el) { el.focus(); const v = el.value; el.value = ''; el.value = v; } };
    box.addEventListener('input', u.debounce((e) => {
      const el = e.target;
      if (el.dataset.hyp) { view.hyp[el.dataset.hyp] = el.value; keepFocus(`[data-hyp="${CSS.escape(el.dataset.hyp)}"]`); }
      if (el.dataset.f === 'target' || el.dataset.f === 'remaining') { view[el.dataset.f] = el.value; keepFocus(`[data-f="${el.dataset.f}"]`); }
    }, 300));
    box.addEventListener('click', (e) => {
      const a = e.target.closest('[data-action]');
      if (!a) return;
      if (a.dataset.action === 'clear-hyp') { view.hyp = {}; V.render(root); }
      if (a.dataset.action === 'reinclude') S.commit(tx('gpa.u.reinclude'), (s) => { s.courses.find((c) => c.id === a.dataset.id).gpaExclude = false; });
    });
  };
})(window.CT);
