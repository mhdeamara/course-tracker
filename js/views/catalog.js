/* views/catalog.js — the faculty study program: mandatory courses by semester, specialization groups,
 * faculty electives, labs and free electives. Shows what is already in "my courses" and adds courses in one click.
 * The interface is translated; catalog content (course, group and rule texts) is Hebrew source data and is shown
 * as it is, isolated as Hebrew/RTL (`he()` / lang="he"). */
(function (CT) {
  'use strict';
  const { u, ui } = CT;
  const S = CT.store, M = CT.model, K = CT.catalog, I = CT.i18n;
  const esc = u.esc, icon = u.icon;
  const t = (k, p) => I.t(k, p), tx = (k, p) => I.tx(k, p), th = (k, p) => I.th(k, p);
  const V = {};
  CT.views = CT.views || {};
  CT.views.catalog = V;

  /** Catalog source text (Hebrew): escaped and isolated. `tag` lets block text keep its own element. */
  const he = (s, tag = 'span') => `<${tag} lang="he" dir="rtl">${esc(s == null ? '' : s)}</${tag}>`;
  const heT = (s) => I.html(he(s)); // the same, as a trusted markup parameter for th()

  /** Tabs depend on what the chosen catalog has (groups, specializations, labs). Catalog titles stay as written. */
  const tabs = () => [
    ['mandatory', t('ctl.tab.mandatory')],
    K.groups.length && ['groups', K.groupsTitle ? he(K.groupsTitle) : t('ctl.tab.groups')],
    K.specializations.length && ['specs', K.specializationsTitle ? he(K.specializationsTitle) : t('ctl.tab.specs')],
    ['electives', t('req.faculty')],
    K.labs.length && ['labs', t('req.lab')],
    ['free', t('ctl.tab.free')],
  ].filter(Boolean);
  /** The user's own choices for this catalog (settings): chosen groups / specialization. */
  const picks = () => {
    const cs = S.state.settings.catalog || {};
    return { groups: Array.isArray(cs.groups) ? cs.groups : [], spec: cs.spec || '' };
  };
  const view = { tab: 'mandatory', q: '', open: new Set(), semId: null };

  /** Normalize a course number: digits only; old 6-digit numbers (044131) → 8 digits (00440131). */
  V.normNum = (n) => {
    const d = String(n || '').replace(/\D/g, '');
    return d.length === 6 ? `0${d.slice(0, 3)}0${d.slice(3)}` : d;
  };
  /** Map: course number → my course (any semester, archived too). */
  const mine = () => {
    const map = new Map();
    S.state.courses.forEach((c) => { const n = V.normNum(c.number); if (n && !map.has(n)) map.set(n, c); });
    return map;
  };
  const isLab = (num) => K.labs.includes(num) || (K.faculty === 'ee' && (num === '00440157' || num === '00440158'));
  const cr = (x) => (x == null ? '—' : String(x));
  const r1 = (x) => +x.toFixed(1);
  const matches = (num) => {
    if (!view.q) return true;
    const c = K.get(num);
    return u.norm(c.name).includes(u.norm(view.q)) || num.includes(view.q.replace(/\D/g, '') || '\u0000');
  };
  const none = () => ui.empty(t('ctl.noResults'));

  /* ---------- progress summary (from course numbers in "my courses") ---------- */
  function summary(my) {
    const nums = [...my.keys()];
    const credits = (n) => Number(K.get(n).credits ?? my.get(n).credits) || 0;
    let mand = nums.filter((n) => K.mandatorySet.has(n)).reduce((s, n) => s + credits(n), 0);
    // "choose N credits from this list" counts toward the mandatory part up to N
    K.choices.forEach((ch) => { mand += Math.min(ch.credits, choiceTaken(ch, my)); });
    const labPts = nums.filter((n) => K.labs.includes(n)).reduce((s, n) => s + credits(n), 0);
    const elect = new Set(K.electives());
    const labNeed = mandLabs();
    const fac = nums.filter((n) => elect.has(n)).reduce((s, n) => s + credits(n), 0) + Math.max(0, Math.min(labPts, K.labMax || labPts) - labNeed);
    // a double group counts as two
    const groupsDone = K.groups.reduce((a, g) => { const st = groupState(g, my); return a + (st.doubleDone ? 2 : st.done ? 1 : 0); }, 0);
    const sp = K.specializations.find((x) => x.id === picks().spec);
    return { mand: mand + Math.min(labNeed, labPts), fac, groupsDone, labNeed, spec: sp ? specState(sp, my) : null, specName: sp && sp.name };
  }
  const choiceTaken = (ch, my) => ch.nums.filter((n) => my.has(n)).reduce((a, n) => a + (Number(K.get(n).credits ?? my.get(n).credits) || 0), 0);
  /** Specialization progress: every part is all-of / at-least-N courses / at-least-N credits (+ starred). */
  function partState(p, my) {
    const taken = p.nums.filter((n) => my.has(n));
    const pts = taken.reduce((a, n) => a + (Number(K.get(n).credits) || 0), 0);
    const star = (p.starred || []).filter((n) => my.has(n)).length;
    let done, have, need, unit;
    if (p.all) { have = taken.length; need = p.nums.length; unit = 'courses'; done = have >= need; }
    else if (p.minCount != null) { have = taken.length; need = p.minCount; unit = 'courses'; done = have >= need; }
    else { have = pts; need = p.minCredits || 0; unit = 'credits'; done = have >= need; }
    if (p.minStarred) done = done && star >= p.minStarred;
    return { taken, have, need, unit, star, done };
  }
  const specState = (sp, my) => { const ps = sp.parts.map((p) => partState(p, my)); return { parts: ps, done: ps.filter((x) => x.done).length, of: ps.length }; };
  const mandLabs = () => K.mandatory.reduce((a, s) => a + (s.labs || 0), 0);
  function groupState(g, my) {
    const taken = g.nums.filter((n) => my.has(n));
    const mustOk = (g.must || []).every((opts) => opts.some((n) => my.has(n))) && (!g.minCore || (g.core || []).filter((n) => my.has(n)).length >= g.minCore);
    return { taken, mustOk, done: mustOk && taken.length >= g.need, doubleDone: g.needDouble && mustOk && taken.length >= g.needDouble };
  }
  /** `label` is safe HTML (translated text, or isolated catalog text); `aria` is its plain-text form. */
  const meter = (label, aria, val, max, color) => {
    const pct = max ? Math.min(100, Math.round((val / max) * 100)) : 0;
    return `<div class="cat-meter" style="--c:${color}"><div class="cat-meter-top"><span>${label}</span><b dir="ltr">${r1(val)} / ${max}</b></div>${ui.bar(pct, aria)}</div>`;
  };

  /* ---------- rows ---------- */
  function row(num, my, opts = {}) {
    const c = K.get(num);
    const have = my.get(num);
    const groups = opts.noGroups ? [] : K.groupsOf(num);
    const must = opts.group && (opts.group.must || []).some((o) => o.includes(num));
    const core = opts.group && (opts.group.core || []).includes(num);
    const star = opts.starred && opts.starred.includes(num);
    const repl = K.replacedBy[num];
    return `<li class="cat-row${have ? ' have' : ''}" data-num="${esc(num)}">
      <span class="cat-num" dir="ltr">${esc(num)}</span>
      <span class="cat-name"><span lang="he" dir="rtl">${u.highlight(c.name, view.q)}</span>${must ? ` <span class="pill pill-muted cat-must">${t('ctl.mustInGroup')}</span>` : ''}${core ? ` <span class="pill pill-muted cat-must">${t('ctl.core')}</span>` : ''}${star ? ' <span class="pill pill-muted cat-must" aria-label="★">★</span>' : ''}${repl ? ` <span class="muted small" title="${t('ctl.replacedTitle')}">(${th('ctl.replaced', { num: I.ltr(repl) })}${my.has(repl) ? ` — ${t('ctl.yours')}` : ''})</span>` : ''}</span>
      ${groups.length ? `<span class="cat-groups">${groups.map((g) => `<span class="cat-g" title="${esc(g.name)}" lang="he">${esc(g.n)}</span>`).join('')}</span>` : '<span></span>'}
      <span class="cat-cr"${K.issueOf[num] ? ` title="${esc(I.iso(K.issueOf[num].text))}"` : ''}>${cr(c.credits)}${K.issueOf[num] ? '<span class="cat-q">?</span>' : ''}<span class="muted small"> ${t('ctl.cr')}</span></span>
      ${have
        ? `<a class="btn btn-small cat-in" href="#/course/${esc(have.id)}" style="--c:${esc(have.color)}">${icon.check} ${t('ctl.mine')}</a>`
        : `<button class="btn btn-small" data-action="add" aria-label="${t('ctl.addName', { name: I.iso(c.name) })}">${icon.plus} ${t('ctl.add')}</button>`}
    </li>`;
  }
  const list = (nums, my, opts) => {
    const shown = nums.filter(matches);
    return shown.length ? `<ul class="cat-list">${shown.map((n) => row(n, my, opts)).join('')}</ul>` : '';
  };

  /* ---------- tabs ---------- */
  function mandatoryTab(my) {
    const blocks = K.mandatory.map((s) => {
      const body = list(s.nums, my, { noGroups: true });
      if (!body && view.q) return '';
      const pts = s.nums.reduce((a, n) => a + (K.get(n).credits || 0), 0) + (s.labs || 0) + ((s.choice || {}).credits || 0);
      const done = s.nums.filter((n) => my.has(n)).length;
      const choice = s.choice ? (K.choices.find((c) => c.id === s.choice.id) || {}).name || '' : '';
      return `<section class="card cat-sem">
        <div class="cat-sem-head"><h2>${t('ctl.semN', { n: s.sem })}</h2><span class="muted small">${t('ctl.semStats', { pts: r1(pts), done, of: s.nums.length })}</span></div>
        ${body}
        ${s.labs ? `<p class="small cat-note">${t('ctl.plusLabs', { n: s.labs })}</p>` : ''}
        ${s.choice ? `<p class="small cat-note">${th('ctl.plusChoice', { n: s.choice.credits, name: heT(choice) })}</p>` : ''}
        ${(s.notes || []).map((x) => he(x, 'p').replace('<p ', '<p class="small muted cat-note" ')).join('')}
      </section>`;
    }).join('');
    const choices = K.choices.map((ch) => {
      const body = list(ch.nums, my, { noGroups: true });
      if (!body && view.q) return '';
      const have = choiceTaken(ch, my);
      return `<section class="card cat-sem">
        <div class="cat-sem-head"><h2>${he(ch.name)}</h2><span class="muted small">${t('ctl.choiceHave', { have: r1(have), n: ch.credits })}</span></div>
        ${ch.note ? he(ch.note, 'p').replace('<p ', '<p class="small muted cat-note" ') : ''}${body}</section>`;
    }).join('');
    return `<div class="cat-grid">${blocks + choices || none()}</div>`;
  }

  function groupsTab(my) {
    const chosen = picks().groups;
    const ordered = chosen.length ? [...K.groups.filter((g) => chosen.includes(g.id)), ...K.groups.filter((g) => !chosen.includes(g.id))] : K.groups;
    const cards = ordered.map((g) => {
      const gs = groupState(g, my);
      const hit = !view.q || u.norm(g.name).includes(u.norm(view.q)) || g.nums.some(matches);
      if (!hit) return '';
      const open = view.open.has(g.id) || !!view.q;
      const nums = view.q && !u.norm(g.name).includes(u.norm(view.q)) ? g.nums.filter(matches) : g.nums;
      const pct = Math.min(100, Math.round((gs.taken.length / g.need) * 100));
      const pick = chosen.includes(g.id);
      const meta = [g.needDouble ? t('ctl.gSingleDouble', { n: g.need, d: g.needDouble }) : t('ctl.gNeed', { n: g.need }),
        g.minCore && t('ctl.gCore', { n: g.minCore }), g.honors && t('ctl.gHonors'), pick && `<b>${t('ctl.chosen')}</b>`].filter(Boolean).join(' · ');
      return `<section class="card cat-group${gs.done ? ' done' : ''}${pick ? ' picked' : ''}" data-group="${esc(g.id)}">
        <button class="cat-group-head" data-action="toggle-group" aria-expanded="${open}">
          <span class="cat-gnum" lang="he">${esc(g.n)}</span>
          <span class="cat-gtitle"><b lang="he" dir="rtl">${esc(g.name)}</b>
            <span class="muted small">${meta}</span></span>
          <span class="cat-gprog" style="--c:var(--${gs.done ? 'st-done' : 'accent'})">${ui.bar(pct, g.name, true)}<span class="small" dir="ltr">${gs.taken.length}/${g.need}${gs.done ? ' ✓' : ''}</span>${gs.doubleDone ? `<span class="small"> (${t('ctl.double')})</span>` : ''}</span>
          <span class="cat-chev" aria-hidden="true">${icon.chev}</span>
        </button>
        ${open ? `<div class="cat-group-body">
          <p class="small cat-rule">${he(g.rule)}${gs.mustOk ? '' : ` <span class="cat-warn">— ${t('ctl.mustMissing')}</span>`}</p>
          <button class="btn btn-ghost btn-small" data-action="pick-group" aria-pressed="${pick}">${t(pick ? 'ctl.unpickGroup' : 'ctl.pickGroup')}</button>
          <ul class="cat-list">${nums.map((n) => row(n, my, { group: g })).join('')}</ul>
        </div>` : ''}
      </section>`;
    }).join('');
    const title = K.groupsTitle ? heT(K.groupsTitle) : tx('ctl.tab.groups');
    return `<p class="muted small">${th('ctl.groupsIntro', { n: K.minGroups || 3, title })}${K.groups.some((g) => g.needDouble) ? ` ${t('ctl.doubleCounts')}` : ''} ${t('ctl.groupsHint')}</p>
      ${K.optNote ? he(K.optNote, 'p').replace('<p ', '<p class="muted small" ') : ''}
      <div class="toolbar-actions" style="margin-bottom:12px"><button class="btn btn-ghost btn-small" data-action="expand-all">${t('ctl.expandAll')}</button><button class="btn btn-ghost btn-small" data-action="collapse-all">${t('ctl.collapseAll')}</button></div>
      ${cards || none()}`;
  }

  function specsTab(my) {
    const chosen = picks().spec;
    const cards = K.specializations.map((sp) => {
      const st = specState(sp, my);
      const pick = sp.id === chosen;
      const parts = sp.parts.map((p, i) => {
        const ps = st.parts[i];
        const l = list(p.nums, my, { noGroups: true, starred: p.starred });
        if (!l && view.q) return '';
        return `<h3 class="cat-h2">${he(p.name)} — <span dir="ltr">${r1(ps.have)} / ${ps.need}</span> ${t(ps.unit === 'credits' ? 'ctl.uCredits' : 'ctl.uCourses')}${p.minStarred ? ` · <span dir="ltr">★ ${ps.star}/${p.minStarred}</span>` : ''}${ps.done ? ' ✓' : ''}</h3>
          ${p.rule ? he(p.rule, 'p').replace('<p ', '<p class="small muted" ') : ''}${p.minStarred ? `<p class="small muted">${t('ctl.minStarred', { n: p.minStarred })}</p>` : ''}${l}`;
      }).join('');
      return `<section class="card cat-group${st.done === st.of ? ' done' : ''}${pick ? ' picked' : ''}" data-spec="${esc(sp.id)}">
        <div class="cat-sem-head"><h2>${he(sp.name)}${pick ? ` <span class="pill pill-muted">${t('ctl.chosen')}</span>` : ''}</h2>
          <span class="muted small">${t('ctl.partsDone', { done: st.done, of: st.of })}</span>
          <button class="btn btn-ghost btn-small" data-action="pick-spec" aria-pressed="${pick}">${t(pick ? 'ctl.unpickSpec' : 'ctl.pickSpec')}</button></div>
        ${sp.note ? he(sp.note, 'p').replace('<p ', '<p class="small muted" ') : ''}${parts}</section>`;
    }).join('');
    const title = K.specializationsTitle ? heT(K.specializationsTitle) : tx('ctl.tab.specs');
    return `<p class="muted small">${th('ctl.specsIntro', { n: K.minSpecializations || 1, title })}</p>${cards || none()}`;
  }

  function electivesTab(my) {
    const all = K.electives();
    const inList = new Set(K.facultyLists.flatMap((l) => l.nums));
    // [title HTML, numbers, note, starred]
    const sections = K.facultyLists.length
      ? K.facultyLists.map((l) => {
        const have = l.nums.filter((n) => my.has(n)).reduce((a, n) => a + (Number(K.get(n).credits) || 0), 0);
        return [`${he(l.name)}${l.minCredits ? ` — <span dir="ltr">${r1(have)} / ${l.minCredits}</span> ${t('ctl.cr')}` : ''}`, l.nums, l.note, l.starred];
      }).concat([[t('ctl.moreFaculty'), all.filter((n) => !inList.has(n))]])
      : [
        [t('ctl.facultyCourses'), all.filter((n) => K.isFaculty(n))],
        [t('ctl.otherFaculties'), all.filter((n) => !K.isFaculty(n))],
      ];
    const body = sections.map(([title, nums, note, starred]) => {
      const l = list(nums, my, { starred });
      return l ? `<section class="card"><h2 class="cat-h2">${title}</h2>${note ? he(note, 'p').replace('<p ', '<p class="small muted" ') : ''}${l}</section>` : '';
    }).join('');
    return `<ul class="cat-rules" lang="he" dir="rtl">${K.facultyRules.map((r) => `<li>${esc(r)}</li>`).join('')}</ul>
      ${K.recommendedEarly.length ? `<p class="muted small">${th('ctl.early', { list: heT(K.recommendedEarly.map((n) => K.get(n).name).join(', ')) })}</p>` : ''}
      ${body || none()}`;
  }

  function labsTab(my) {
    const pts = K.labs.filter((n) => my.has(n)).length;
    return `${K.labRule ? he(K.labRule, 'p').replace('<p ', '<p class="small" ') : ''}<p class="muted small">${t('ctl.labsHave', { n: pts })}</p>
      <section class="card">${list(K.labs, my, { noGroups: true }) || none()}</section>`;
  }

  function freeTab(my) {
    return `<section class="card"><h2 class="cat-h2">${t('ctl.freeTitle', { n: K.totals.free })}</h2>
        <ul class="cat-rules" lang="he" dir="rtl">${K.freeRules.map((r) => `<li>${esc(r)}</li>`).join('')}</ul></section>
      <section class="card"><h2 class="cat-h2">${t('ctl.suggested')}</h2>${K.freeNote ? he(K.freeNote, 'p').replace('<p ', '<p class="muted small" ') : ''}${list(K.freeSuggested, my, { noGroups: true }) || `<p class="muted small">${t('ctl.noSuggested')}</p>`}
        <p class="muted small cat-note">${t('ctl.anyOther')}</p>
        <button class="btn" data-action="custom">${icon.plus} ${t('cp.new')}</button></section>`;
  }

  /* ---------- render ---------- */
  /** Load the catalog chosen in settings (or the nearest one). */
  V.load = () => {
    const cs = S.state.settings.catalog || {};
    return K.select(cs.faculty || 'ee', cs.year || null);
  };
  /** The "this is not your catalog year" warning in the interface language (safe HTML; '' when not needed). */
  V.fallbackHTML = () => {
    if (!K.ready || !K.fallback) return '';
    return K.fallback === 'none-chosen' ? th('set.cat.fbNone', { label: I.bdi(K.label) })
      : th('set.cat.fbOther', { want: I.bdi(K.yearLabel(K.wantedYear)), label: I.bdi(K.label) });
  };
  /** Header block: source line, fallback warning, unverified data. */
  V.sourceHTML = () => {
    const si = K.sourceInfo();
    if (!si) return '';
    const warn = V.fallbackHTML();
    const issues = (K.knownIssues || []).map((k) => k.text).concat(K.verify || []);
    const updated = I.html(`<span dir="ltr" title="${t(K.source.uploaded ? 'ctl.updUploaded' : 'ctl.updPdf')}">${esc(si.updated)}</span>${si.updated && !K.source.uploaded ? '*' : ''}`);
    return `<p class="small cat-source">${th('ctl.source', { text: heT(si.text), updated, link: I.html(`<a href="${esc(u.safeUrl ? u.safeUrl(si.url) : si.url)}" target="_blank" rel="noopener">${he(si.title)}</a>`), got: I.ltr(si.retrieved) })}</p>
      ${warn ? `<p class="cat-alert" role="alert">${icon.alert} ${warn}</p>` : ''}
      ${issues.length ? `<details class="cat-issues"><summary>${icon.alert} ${t('ctl.issues', { n: issues.length })}</summary><ul lang="he" dir="rtl">${issues.map((x) => `<li>${esc(x)}</li>`).join('')}</ul>
        <p class="muted small">${th('ctl.issuesNote', { file: I.ltr(`catalogs/${K.faculty}/${K.year}.fixes.md`) })}</p></details>` : ''}`;
  };
  V.yearPicker = (cls = '') => {
    const cs = S.state.settings.catalog || {};
    const have = new Set(K.available(cs.faculty || 'ee'));
    return `<select data-action="cat-year" class="chip-select ${cls}" aria-label="${t('ctl.year')}">
      <option value="" ${cs.year ? '' : 'selected'}>${t('ctl.yearNone')}</option>
      ${K.pickerYears(cs.faculty || 'ee').map((y) => `<option value="${y}" ${Number(cs.year) === y ? 'selected' : ''}>${esc(K.yearLabel(y))}${have.has(y) ? '' : ` ${t('ctl.yearMissing')}`}</option>`).join('')}</select>`;
  };
  V.setYear = (val) => {
    S.commit(tx('ctl.u.year'), (s) => { s.settings.catalog = Object.assign({}, s.settings.catalog, { faculty: (s.settings.catalog || {}).faculty || 'ee', year: val ? Number(val) : null }); });
  };
  /** Another faculty: its own year list, and the group / specialization choices of the old one no longer apply. */
  V.setFaculty = (fac) => {
    if (!K.faculties().some((f) => f.id === fac)) return;
    S.commit(tx('ctl.u.faculty'), (s) => { s.settings.catalog = { faculty: fac, year: null, groups: [], spec: '' }; });
  };
  V.facultyPicker = (cls = '') => {
    const cur = (S.state.settings.catalog || {}).faculty || 'ee';
    return `<select data-action="cat-fac" class="chip-select ${cls}" aria-label="${t('ctl.faculty')}">${K.faculties().map((f) => `<option value="${esc(f.id)}" ${f.id === cur ? 'selected' : ''}>${esc(f.name)}</option>`).join('')}</select>`;
  };
  V.toggleGroup = (id) => {
    S.commit(tx('ctl.u.group'), (s) => {
      const c = s.settings.catalog = Object.assign({ faculty: 'ee', year: null }, s.settings.catalog);
      const g = new Set(Array.isArray(c.groups) ? c.groups : []);
      if (g.has(id)) g.delete(id); else g.add(id);
      c.groups = [...g];
    });
  };
  V.setSpec = (id) => {
    S.commit(tx('ctl.u.spec'), (s) => { s.settings.catalog = Object.assign({ faculty: 'ee', year: null }, s.settings.catalog, { spec: id || '' }); });
  };
  /** A group's progress from your courses (for the settings center). */
  V.groupStatus = (g) => groupState(g, mine());

  V.render = (root) => {
    const st = S.state;
    V.load();
    if (!K.ready) { root.innerHTML = `<div class="catalog page-wide"><h1>${t('ctl.title')}</h1>${ui.empty(t('ctl.noCatalog'))}</div>`; return; }
    const my = mine();
    const sum = summary(my);
    if (!view.semId || !st.semesters.some((s) => s.id === view.semId)) view.semId = st.settings.activeSemesterId || (st.semesters[0] && st.semesters[0].id) || '';
    if (!tabs().some(([k]) => k === view.tab)) view.tab = 'mandatory';
    const tabFn = { mandatory: mandatoryTab, groups: groupsTab, specs: specsTab, electives: electivesTab, labs: labsTab, free: freeTab }[view.tab];
    const gTitle = K.groupsTitle ? he(K.groupsTitle) : t('ctl.tab.groups');

    root.innerHTML = `
      <div class="catalog page-wide">
        <div class="cat-head">
          <div><h1>${t('ctl.title')}</h1><p class="muted small">${th('ctl.headLine', { fac: heT(K.facultyName), track: heT(K.trackName), id: I.ltr(K.track), n: K.totals.total })} ${t('ctl.verify')}</p></div>
          <label class="small cat-sem-pick">${t('ctl.faculty')} ${V.facultyPicker()}</label>
          <label class="small cat-sem-pick">${t('ctl.year')} ${V.yearPicker()}</label>
        </div>
        ${V.sourceHTML()}
        <div class="card cat-summary">
          ${meter(sum.labNeed ? t('ctl.mMandLabs', { n: sum.labNeed }) : t('req.mandatory'), sum.labNeed ? tx('ctl.mMandLabs', { n: sum.labNeed }) : tx('req.mandatory'), sum.mand, K.totals.mandatory, 'var(--accent)')}
          ${meter(t('req.faculty'), tx('req.faculty'), sum.fac, K.totals.faculty, 'var(--accent-2)')}
          ${K.groups.length ? meter(th('ctl.mGroups', { title: I.html(gTitle) }), tx('ctl.mGroups', { title: K.groupsTitle || tx('ctl.tab.groups') }), sum.groupsDone, K.minGroups || 3, 'var(--gold)') : ''}
          ${K.specializations.length ? (sum.spec ? meter(th('ctl.mSpec', { name: heT(sum.specName) }), tx('ctl.mSpec', { name: sum.specName }), sum.spec.done, sum.spec.of, 'var(--gold)') : `<p class="small muted">${t('ctl.noSpec')}</p>`) : ''}
          <p class="muted small cat-sum-note">${t('ctl.sumNote')}</p>
        </div>
        <div class="toolbar">
          <div class="search cat-search">${icon.search}<input type="search" data-action="q" placeholder="${t('ctl.searchPh')}" value="${esc(view.q)}" aria-label="${t('ctl.search')}"></div>
          <label class="small cat-sem-pick">${t('ctl.addTo')}
            <select data-action="sem" class="chip-select">${st.semesters.map((s) => `<option value="${esc(s.id)}" ${s.id === view.semId ? 'selected' : ''}>${esc(s.name)}</option>`).join('')}<option value="" ${view.semId ? '' : 'selected'}>${t('ctl.noSem')}</option></select></label>
        </div>
        <div class="tabs" role="tablist" aria-label="${t('ctl.title')}" style="--c:var(--accent)">${tabs().map(([k, l]) => `<button class="tab${view.tab === k ? ' active' : ''}" role="tab" id="ctl-tab-${k}" aria-controls="ctl-panel" aria-selected="${view.tab === k}" tabindex="${view.tab === k ? 0 : -1}" data-tab="${k}">${l}</button>`).join('')}</div>
        <div class="cat-panel" id="ctl-panel" role="tabpanel" aria-labelledby="ctl-tab-${view.tab}">${tabFn(my)}</div>
      </div>`;

    const box = root.querySelector('.catalog');
    box.addEventListener('click', (e) => {
      const tb = e.target.closest('[data-tab]');
      if (tb) { view.tab = tb.dataset.tab; V.render(root); root.querySelector(`[data-tab="${view.tab}"]`).focus(); return; }
      const a = e.target.closest('[data-action]');
      if (!a) return;
      const act = a.dataset.action;
      if (act === 'add') addCourse(a.closest('[data-num]').dataset.num);
      if (act === 'toggle-group') {
        const id = a.closest('[data-group]').dataset.group;
        if (view.open.has(id)) view.open.delete(id); else view.open.add(id);
        V.render(root);
        const h = root.querySelector(`[data-group="${CSS.escape(id)}"] [data-action=toggle-group]`);
        if (h) h.focus();
      }
      if (act === 'pick-group') { V.toggleGroup(a.closest('[data-group]').dataset.group); return; }
      if (act === 'pick-spec') { const id = a.closest('[data-spec]').dataset.spec; V.setSpec(id === picks().spec ? '' : id); return; }
      if (act === 'expand-all') { K.groups.forEach((g) => view.open.add(g.id)); V.render(root); }
      if (act === 'collapse-all') { view.open.clear(); V.render(root); }
      if (act === 'custom') CT.views.course.courseForm();
    });
    // tabs: arrow keys move between them (reading direction), Home/End jump
    box.querySelector('[role=tablist]').addEventListener('keydown', (e) => {
      const all = [...box.querySelectorAll('[role=tab]')];
      const i = all.indexOf(document.activeElement);
      if (i < 0) return;
      const fwd = I.dir() === 'rtl' ? 'ArrowLeft' : 'ArrowRight', back = I.dir() === 'rtl' ? 'ArrowRight' : 'ArrowLeft';
      let j = null;
      if (e.key === fwd) j = (i + 1) % all.length; else if (e.key === back) j = (i - 1 + all.length) % all.length;
      else if (e.key === 'Home') j = 0; else if (e.key === 'End') j = all.length - 1;
      if (j == null) return;
      e.preventDefault();
      all[j].click();
    });
    box.querySelector('[data-action=sem]').addEventListener('change', (e) => { view.semId = e.target.value; });
    box.querySelector('[data-action=cat-year]').addEventListener('change', (e) => V.setYear(e.target.value));
    box.querySelector('[data-action=cat-fac]').addEventListener('change', (e) => V.setFaculty(e.target.value));
    const q = box.querySelector('[data-action=q]');
    q.addEventListener('input', u.debounce(() => {
      view.q = q.value.trim();
      box.querySelector('.cat-panel').innerHTML = tabFn(mine());
    }, 150));
  };

  /** Create a course from the catalog in the chosen semester, with the standard template (or lab experiments). */
  function addCourse(num) {
    const k = K.get(num);
    const st = S.state;
    let newId = '';
    S.commit(tx('ctl.u.add', { name: I.iso(k.name) }), (s) => {
      const c = M.newCourse({
        name: k.name, number: num, credits: k.credits == null ? '' : k.credits,
        semesterId: view.semId, color: M.COLORS[s.courses.length % M.COLORS.length],
      });
      if (isLab(num)) c.categories = M.labCategories(num.startsWith('004501') ? 4 : 6);
      else M.applyTemplate(c, s.settings.template && s.settings.template.length ? s.settings.template : M.DEFAULT_TEMPLATE);
      s.courses.push(c);
      newId = c.id;
    });
    const sem = st.semesters.find((s) => s.id === view.semId);
    ui.toast(sem ? tx('ctl.addedTo', { name: I.iso(k.name), sem: I.iso(sem.name) }) : tx('ctl.added', { name: I.iso(k.name) }), { action: { label: tx('sem.open'), fn: () => { location.hash = `#/course/${newId}`; } } });
  }
})(window.CT);
