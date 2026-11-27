/* views/catalog.js — the faculty study program: mandatory courses by semester, specialization groups,
 * faculty electives, labs and free electives. Shows what is already in "my courses" and adds courses in one click. */
(function (CT) {
  'use strict';
  const { u, ui } = CT;
  const S = CT.store, M = CT.model, K = CT.catalog;
  const esc = u.esc, icon = u.icon;
  const V = {};
  CT.views = CT.views || {};
  CT.views.catalog = V;

  /** Tabs depend on what the chosen catalog has (groups, specializations, labs). */
  const tabs = () => [
    ['mandatory', 'חובה'],
    K.groups.length && ['groups', K.groupsTitle || 'קבוצות התמחות'],
    K.specializations.length && ['specs', K.specializationsTitle || 'התמחות'],
    ['electives', 'בחירה פקולטית'],
    K.labs.length && ['labs', 'מעבדות'],
    ['free', 'בחירה חופשית'],
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
  const matches = (num) => {
    if (!view.q) return true;
    const c = K.get(num);
    return u.norm(c.name).includes(u.norm(view.q)) || num.includes(view.q.replace(/\D/g, '') || '\u0000');
  };

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
    if (p.all) { have = taken.length; need = p.nums.length; unit = 'מקצועות'; done = have >= need; }
    else if (p.minCount != null) { have = taken.length; need = p.minCount; unit = 'מקצועות'; done = have >= need; }
    else { have = pts; need = p.minCredits || 0; unit = 'נק׳'; done = have >= need; }
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
  const meter = (label, val, max, color) => {
    const pct = Math.min(100, Math.round((val / max) * 100));
    return `<div class="cat-meter" style="--c:${color}"><div class="cat-meter-top"><span>${label}</span><b>${+val.toFixed(1)} / ${max}</b></div>${ui.bar(pct, label)}</div>`;
  };

  /* ---------- rows ---------- */
  function row(num, my, opts = {}) {
    const c = K.get(num);
    const have = my.get(num);
    const groups = opts.noGroups ? [] : K.groupsOf(num);
    const must = opts.group && (opts.group.must || []).some((o) => o.includes(num));
    const core = opts.group && (opts.group.core || []).includes(num);
    const star = opts.starred && opts.starred.includes(num);
    return `<li class="cat-row${have ? ' have' : ''}" data-num="${num}">
      <span class="cat-num" dir="ltr">${num}</span>
      <span class="cat-name" dir="auto">${u.highlight ? u.highlight(c.name, view.q) : esc(c.name)}${must ? ' <span class="pill pill-muted cat-must">חובה בקבוצה</span>' : ''}${core ? ' <span class="pill pill-muted cat-must">ליבה</span>' : ''}${star ? ' <span class="pill pill-muted cat-must">★</span>' : ''}${K.replacedBy[num] ? ` <span class="muted small" title="לפי השוואת קטלוגים — לא מאומת">(בקטלוג מאוחר יותר: ${K.replacedBy[num]}${my.has(K.replacedBy[num]) ? ' — אצלך' : ''})</span>` : ''}</span>
      ${groups.length ? `<span class="cat-groups">${groups.map((g) => `<span class="cat-g" title="${esc(g.name)}">${g.n}</span>`).join('')}</span>` : '<span></span>'}
      <span class="cat-cr"${K.issueOf[num] ? ` title="${esc(K.issueOf[num].text)}"` : ''}>${cr(c.credits)}${K.issueOf[num] ? '<span class="cat-q">?</span>' : ''}<span class="muted small"> נק׳</span></span>
      ${have
        ? `<a class="btn btn-small cat-in" href="#/course/${have.id}" style="--c:${esc(have.color)}">${icon.check} אצלי</a>`
        : `<button class="btn btn-small" data-action="add">${icon.plus} הוסף</button>`}
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
      return `<section class="card cat-sem">
        <div class="cat-sem-head"><h2>סמסטר ${s.sem}</h2><span class="muted small">${+pts.toFixed(1)} נק׳ · ${done}/${s.nums.length} אצלי</span></div>
        ${body}
        ${s.labs ? `<p class="small cat-note">+ ${s.labs} נק׳ מקצועות מעבדה מתוך הרשימה (לשונית „מעבדות”).</p>` : ''}
        ${s.choice ? `<p class="small cat-note">+ לפחות ${s.choice.credits} נק׳ מתוך „${esc((K.choices.find((c) => c.id === s.choice.id) || {}).name || '')}” (למטה).</p>` : ''}
        ${(s.notes || []).map((t) => `<p class="small muted cat-note">${esc(t)}</p>`).join('')}
      </section>`;
    }).join('');
    const choices = K.choices.map((ch) => {
      const body = list(ch.nums, my, { noGroups: true });
      if (!body && view.q) return '';
      const have = choiceTaken(ch, my);
      return `<section class="card cat-sem">
        <div class="cat-sem-head"><h2>${esc(ch.name)}</h2><span class="muted small">${+have.toFixed(1)} / ${ch.credits} נק׳ אצלי</span></div>
        ${ch.note ? `<p class="small muted cat-note">${esc(ch.note)}</p>` : ''}${body}</section>`;
    }).join('');
    return `<div class="cat-grid">${blocks + choices || ui.empty('אין תוצאות.')}</div>`;
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
      return `<section class="card cat-group${gs.done ? ' done' : ''}${pick ? ' picked' : ''}" data-group="${g.id}">
        <button class="cat-group-head" data-action="toggle-group" aria-expanded="${open}">
          <span class="cat-gnum">${g.n}</span>
          <span class="cat-gtitle"><b>${esc(g.name)}</b>
            <span class="muted small">${g.needDouble ? `בודדת ${g.need} מקצועות · כפולה ${g.needDouble}` : `${g.need} מקצועות להשלמה`}${g.minCore ? ` · לפחות ${g.minCore} ליבה` : ''}${g.honors ? ' · למצטיינים' : ''}${pick ? ' · <b>בחרת</b>' : ''}</span></span>
          <span class="cat-gprog" style="--c:var(--${gs.done ? 'st-done' : 'accent'})">${ui.bar(pct, g.name, true)}<span class="small">${gs.taken.length}/${g.need}${gs.done ? ' ✓' : ''}${gs.doubleDone ? ' (כפולה)' : ''}</span></span>
          <span class="cat-chev">${open ? '▴' : '▾'}</span>
        </button>
        ${open ? `<div class="cat-group-body">
          <p class="small cat-rule">${esc(g.rule)}${gs.mustOk ? '' : ' <span class="cat-warn">— עוד לא כל מקצועות החובה של הקבוצה אצלך</span>'}</p>
          <button class="btn btn-ghost btn-small" data-action="pick-group">${pick ? 'הסר מהקבוצות שבחרתי' : 'בחר קבוצה זו'}</button>
          <ul class="cat-list">${nums.map((n) => row(n, my, { group: g })).join('')}</ul>
        </div>` : ''}
      </section>`;
    }).join('');
    return `<p class="muted small">צריך להשלים לפחות ${K.minGroups || 3} ${esc(K.groupsTitle || 'קבוצות התמחות')} בתוך הבחירה הפקולטית${K.groups.some((g) => g.needDouble) ? ' (קבוצה כפולה נספרת כשתיים)' : ''}. המספר בעיגול ליד כל מקצוע = הקבוצות שהוא שייך אליהן. אפשר לסמן את הקבוצות שבחרת — הן יוצגו ראשונות (גם בהגדרות).</p>
      ${K.optNote ? `<p class="muted small">${esc(K.optNote)}</p>` : ''}
      <div class="toolbar-actions" style="margin-bottom:12px"><button class="btn btn-ghost btn-small" data-action="expand-all">פתח הכול</button><button class="btn btn-ghost btn-small" data-action="collapse-all">סגור הכול</button></div>
      ${cards || ui.empty('אין תוצאות.')}`;
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
        return `<h3 class="cat-h2">${esc(p.name)} — ${+ps.have.toFixed(1)} / ${ps.need} ${ps.unit}${p.minStarred ? ` · ★ ${ps.star}/${p.minStarred}` : ''}${ps.done ? ' ✓' : ''}</h3>
          ${p.rule ? `<p class="small muted">${esc(p.rule)}</p>` : ''}${p.minStarred ? `<p class="small muted">לפחות ${p.minStarred} מקצועות מסומנים ב־★.</p>` : ''}${l}`;
      }).join('');
      return `<section class="card cat-group${st.done === st.of ? ' done' : ''}${pick ? ' picked' : ''}" data-spec="${esc(sp.id)}">
        <div class="cat-sem-head"><h2>${esc(sp.name)}${pick ? ' <span class="pill pill-muted">בחרת</span>' : ''}</h2>
          <span class="muted small">${st.done}/${st.of} חלקים הושלמו</span>
          <button class="btn btn-ghost btn-small" data-action="pick-spec">${pick ? 'בטל בחירה' : 'בחר התמחות זו'}</button></div>
        ${sp.note ? `<p class="small muted">${esc(sp.note)}</p>` : ''}${parts}</section>`;
    }).join('');
    return `<p class="muted small">צריך לבחור לפחות ${K.minSpecializations || 1} ${esc(K.specializationsTitle || 'התמחות')}. ההתקדמות מחושבת לפי מספרי הקורסים אצלך.</p>${cards || ui.empty('אין תוצאות.')}`;
  }

  function electivesTab(my) {
    const all = K.electives();
    const inList = new Set(K.facultyLists.flatMap((l) => l.nums));
    const sections = K.facultyLists.length
      ? K.facultyLists.map((l) => {
        const have = l.nums.filter((n) => my.has(n)).reduce((a, n) => a + (Number(K.get(n).credits) || 0), 0);
        return [`${l.name}${l.minCredits ? ` — ${+have.toFixed(1)} / ${l.minCredits} נק׳` : ''}`, l.nums, l.note, l.starred];
      }).concat([['מקצועות נוספים של הפקולטה ושל הקבוצות', all.filter((n) => !inList.has(n))]])
      : [
        ['מקצועות הפקולטה', all.filter((n) => K.isFaculty(n))],
        ['מקצועות מפקולטות אחרות שבקבוצות ההתמחות', all.filter((n) => !K.isFaculty(n))],
      ];
    const body = sections.map(([t, nums, note, starred]) => {
      const l = list(nums, my, { starred });
      return l ? `<section class="card"><h2 class="cat-h2">${esc(t)}</h2>${note ? `<p class="small muted">${esc(note)}</p>` : ''}${l}</section>` : '';
    }).join('');
    return `<ul class="cat-rules">${K.facultyRules.map((r) => `<li>${esc(r)}</li>`).join('')}</ul>
      ${K.recommendedEarly.length ? `<p class="muted small">מומלצים כבר בסמסטרים 1–2: ${K.recommendedEarly.map((n) => esc(K.get(n).name)).join(', ')}.</p>` : ''}
      ${body || ui.empty('אין תוצאות.')}`;
  }

  function labsTab(my) {
    const pts = K.labs.filter((n) => my.has(n)).length;
    return `<p class="small">${esc(K.labRule)}</p><p class="muted small">אצלך כרגע: ${pts} נק׳ מעבדה.</p>
      <section class="card">${list(K.labs, my, { noGroups: true }) || ui.empty('אין תוצאות.')}</section>`;
  }

  function freeTab(my) {
    return `<section class="card"><h2 class="cat-h2">בחירה כלל־טכניונית — ${K.totals.free} נק׳</h2>
        <ul class="cat-rules">${K.freeRules.map((r) => `<li>${esc(r)}</li>`).join('')}</ul></section>
      <section class="card"><h2 class="cat-h2">מומלצים בקטלוג</h2>${K.freeNote ? `<p class="muted small">${esc(K.freeNote)}</p>` : ''}${list(K.freeSuggested, my, { noGroups: true }) || '<p class="muted small">אין המלצה בקטלוג הזה.</p>'}
        <p class="muted small cat-note">כל מקצוע אחר בטכניון — דרך „קורס חדש” עם המספר שלו.</p>
        <button class="btn" data-action="custom">${icon.plus} קורס חדש</button></section>`;
  }

  /* ---------- render ---------- */
  /** Load the catalog chosen in settings (or the nearest one). */
  V.load = () => {
    const cs = S.state.settings.catalog || {};
    return K.select(cs.faculty || 'ee', cs.year || null);
  };
  /** Header block: source line, fallback warning, unverified data. Also used by settings. */
  V.sourceHTML = () => {
    const si = K.sourceInfo();
    if (!si) return '';
    const warn = K.fallbackWarning();
    const issues = (K.knownIssues || []).map((k) => k.text).concat(K.verify || []);
    return `<p class="small cat-source">קטלוג: ${esc(si.text)} · עודכן: <span dir="ltr" title="${esc(si.updatedNote)}">${esc(si.updated)}</span>${si.updated && !K.source.uploaded ? '*' : ''} · מקור: <a href="${esc(si.url)}" target="_blank" rel="noopener">${esc(si.title)}</a> · נשלף: <span dir="ltr">${esc(si.retrieved)}</span></p>
      ${warn ? `<p class="cat-alert" role="alert">⚠ ${esc(warn)}</p>` : ''}
      ${issues.length ? `<details class="cat-issues"><summary>⚠ ${issues.length} נתונים לא מאומתים / אי-התאמות בקטלוג הזה</summary><ul>${issues.map((t) => `<li>${esc(t)}</li>`).join('')}</ul>
        <p class="muted small">פרטים ב־catalogs/${esc(K.faculty)}/${K.year}.fixes.md. לא תוקן שום נתון בלי תיעוד — כדאי לוודא מול מזכירות הפקולטה.</p></details>` : ''}`;
  };
  V.yearPicker = (cls = '') => {
    const cs = S.state.settings.catalog || {};
    const have = new Set(K.available(cs.faculty || 'ee'));
    return `<select data-action="cat-year" class="chip-select ${cls}" aria-label="שנת קטלוג">
      <option value="" ${cs.year ? '' : 'selected'}>— לא נבחרה (החדש ביותר) —</option>
      ${K.pickerYears(cs.faculty || 'ee').map((y) => `<option value="${y}" ${Number(cs.year) === y ? 'selected' : ''}>${K.yearLabel(y)}${have.has(y) ? '' : ' (אין קטלוג — יוצג הקרוב)'}</option>`).join('')}</select>`;
  };
  V.setYear = (val) => {
    S.commit('שנת קטלוג', (s) => { s.settings.catalog = Object.assign({}, s.settings.catalog, { faculty: (s.settings.catalog || {}).faculty || 'ee', year: val ? Number(val) : null }); });
  };
  /** Another faculty: its own year list, and the group / specialization choices of the old one no longer apply. */
  V.setFaculty = (fac) => {
    if (!K.faculties().some((f) => f.id === fac)) return;
    S.commit('פקולטה', (s) => { s.settings.catalog = { faculty: fac, year: null, groups: [], spec: '' }; });
  };
  V.facultyPicker = (cls = '') => {
    const cur = (S.state.settings.catalog || {}).faculty || 'ee';
    return `<select data-action="cat-fac" class="chip-select ${cls}" aria-label="פקולטה">${K.faculties().map((f) => `<option value="${esc(f.id)}" ${f.id === cur ? 'selected' : ''}>${esc(f.name)}</option>`).join('')}</select>`;
  };
  V.toggleGroup = (id) => {
    S.commit('בחירת קבוצה', (s) => {
      const c = s.settings.catalog = Object.assign({ faculty: 'ee', year: null }, s.settings.catalog);
      const g = new Set(Array.isArray(c.groups) ? c.groups : []);
      if (g.has(id)) g.delete(id); else g.add(id);
      c.groups = [...g];
    });
  };
  V.setSpec = (id) => {
    S.commit('בחירת התמחות', (s) => { s.settings.catalog = Object.assign({ faculty: 'ee', year: null }, s.settings.catalog, { spec: id || '' }); });
  };
  /** Settings block: chosen groups (checkboxes) and specialization (select) for the current catalog. */
  /** A group's progress from your courses (for the settings center). */
  V.groupStatus = (g) => groupState(g, mine());
  V.picksHTML = () => {
    if (!K.ready) return '';
    const p = picks();
    const my = mine();
    const g = K.groups.length ? `<div class="small"><b>${esc(K.groupsTitle || 'קבוצות התמחות')} שבחרתי</b> (בחירה חופשית — ההתקדמות מחושבת בכל מקרה):
      <div class="btn-row" style="flex-wrap:wrap">${K.groups.map((x) => { const st = groupState(x, my); return `<label class="small"><input type="checkbox" data-action="cat-group" value="${esc(x.id)}" ${p.groups.includes(x.id) ? 'checked' : ''}> ${x.n}. ${esc(x.name)} <span class="muted">(${st.taken.length}/${x.need}${st.done ? ' ✓' : ''})</span></label>`; }).join('')}</div></div>` : '';
    const sp = K.specializations.length ? `<label class="small">${esc(K.specializationsTitle || 'התמחות')}: <select data-action="cat-spec" class="chip-select"><option value="">— לא נבחרה —</option>${K.specializations.map((x) => `<option value="${esc(x.id)}" ${x.id === p.spec ? 'selected' : ''}>${esc(x.name)}</option>`).join('')}</select></label>` : '';
    return g + sp;
  };

  V.render = (root) => {
    const st = S.state;
    V.load();
    if (!K.ready) { root.innerHTML = `<div class="catalog"><h1>תכנית הלימודים</h1>${ui.empty(esc(K.error || 'אין קטלוג'))}</div>`; return; }
    const my = mine();
    const sum = summary(my);
    if (!view.semId || !st.semesters.some((s) => s.id === view.semId)) view.semId = st.settings.activeSemesterId || (st.semesters[0] && st.semesters[0].id) || '';
    if (!tabs().some(([k]) => k === view.tab)) view.tab = 'mandatory';
    const tabFn = { mandatory: mandatoryTab, groups: groupsTab, specs: specsTab, electives: electivesTab, labs: labsTab, free: freeTab }[view.tab];

    root.innerHTML = `
      <div class="catalog">
        <div class="cat-head">
          <div><h1>תכנית הלימודים</h1><p class="muted small">${esc(K.facultyName)} · מסלול ${esc(K.trackName)} (<span dir="ltr">${esc(K.track)}</span>) · ${K.totals.total} נק׳ לתואר. כדאי לוודא מול הקטלוג הרשמי לפני רישום.</p></div>
          <label class="small cat-sem-pick">פקולטה: ${V.facultyPicker()}</label>
          <label class="small cat-sem-pick">שנת קטלוג: ${V.yearPicker()}</label>
        </div>
        ${V.sourceHTML()}
        <div class="card cat-summary">
          ${meter(sum.labNeed ? `חובה (כולל ${sum.labNeed} נק׳ מעבדה)` : 'חובה', sum.mand, K.totals.mandatory, 'var(--accent)')}
          ${meter('בחירה פקולטית', sum.fac, K.totals.faculty, 'var(--accent-2)')}
          ${K.groups.length ? meter(`${esc(K.groupsTitle || 'קבוצות התמחות')} שהושלמו`, sum.groupsDone, K.minGroups || 3, 'var(--gold)') : ''}
          ${K.specializations.length ? (sum.spec ? meter(`התמחות: ${esc(sum.specName)} — חלקים שהושלמו`, sum.spec.done, sum.spec.of, 'var(--gold)') : '<p class="small muted">לא נבחרה התמחות — אפשר לבחור בלשונית „התמחות” או בהגדרות.</p>') : ''}
          <p class="muted small cat-sum-note">נספר לפי מספרי הקורסים אצלך (בכל הסמסטרים, כולל ארכיון) — לא לפי ציון.</p>
        </div>
        <div class="toolbar">
          <div class="search cat-search">${icon.search}<input type="search" data-action="q" placeholder="חיפוש לפי שם או מספר…" value="${esc(view.q)}" aria-label="חיפוש בקטלוג"></div>
          <label class="small cat-sem-pick">הוספה לסמסטר:
            <select data-action="sem" class="chip-select">${st.semesters.map((s) => `<option value="${s.id}" ${s.id === view.semId ? 'selected' : ''}>${esc(s.name)}</option>`).join('')}<option value="" ${view.semId ? '' : 'selected'}>— ללא —</option></select></label>
        </div>
        <div class="tabs" role="tablist" style="--c:var(--accent)">${tabs().map(([k, l]) => `<button class="tab${view.tab === k ? ' active' : ''}" role="tab" aria-selected="${view.tab === k}" data-tab="${k}">${l}</button>`).join('')}</div>
        <div class="cat-panel">${tabFn(my)}</div>
      </div>`;

    const box = root.querySelector('.catalog');
    box.addEventListener('click', (e) => {
      const t = e.target.closest('[data-tab]');
      if (t) { view.tab = t.dataset.tab; V.render(root); return; }
      const a = e.target.closest('[data-action]');
      if (!a) return;
      const act = a.dataset.action;
      if (act === 'add') addCourse(a.closest('[data-num]').dataset.num);
      if (act === 'toggle-group') {
        const id = a.closest('[data-group]').dataset.group;
        if (view.open.has(id)) view.open.delete(id); else view.open.add(id);
        V.render(root);
      }
      if (act === 'pick-group') { V.toggleGroup(a.closest('[data-group]').dataset.group); return; }
      if (act === 'pick-spec') { const id = a.closest('[data-spec]').dataset.spec; V.setSpec(id === picks().spec ? '' : id); return; }
      if (act === 'expand-all') { K.groups.forEach((g) => view.open.add(g.id)); V.render(root); }
      if (act === 'collapse-all') { view.open.clear(); V.render(root); }
      if (act === 'custom') CT.views.course.courseForm();
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
    S.commit(`הוספת ${k.name}`, (s) => {
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
    ui.toast(`"${k.name}" נוסף${sem ? ` ל${sem.name}` : ''}`, { action: { label: 'פתח', fn: () => { location.hash = `#/course/${newId}`; } } });
  }
})(window.CT);
