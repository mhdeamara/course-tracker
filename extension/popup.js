/* popup.js — the window that opens from the toolbar icon. Reads the last snapshot from chrome.storage.local and draws
 * it (lib/view.js decides what goes where). Every string from the data is escaped. */
(() => {
  'use strict';
  const V = self.CTView, CFG = self.CTSettings;
  const $ = (id) => document.getElementById(id);
  const esc = (s) => String(s == null ? '' : s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const DAYS = ['א׳', 'ב׳', 'ג׳', 'ד׳', 'ה׳', 'ו׳', 'ש׳'];
  const color = (c) => (/^#[0-9a-f]{3,8}$/i.test(c || '') ? c : '');
  const dmy = (iso) => { const [y, m, d] = iso.split('-'); return `${Number(d)}.${Number(m)}`; };
  let data = null, firstNext = null;

  const msg = (text, ms = 2600) => {
    const m = $('msg'); m.textContent = text; m.hidden = false;
    clearTimeout(msg.t); msg.t = setTimeout(() => { m.hidden = true; }, ms);
  };
  const send = (m) => chrome.runtime.sendMessage(m).catch((e) => ({ ok: false, err: e.message }));

  const pick = (d) => {
    const loc = d.snapLocal && d.snapLocal.snap, cl = d.settings.mode === 'connected' ? d.snapCloud && d.snapCloud.snap : null;
    if (!cl) return loc || null;
    if (!loc) return cl;
    return Date.parse(cl.at) >= Date.parse(loc.at) ? cl : loc;
  };

  const row = (x, { tick = false, when = '', late = false } = {}) => `
    <li class="row${late ? ' late' : ''}${x.s === 'done' ? ' done' : ''}" data-id="${esc(x.id)}">
      ${tick ? `<button class="tick" data-act="done" data-id="${esc(x.id)}" ${x.s === 'done' ? 'disabled aria-label="הושלם"' : `aria-label="לסמן ${esc(x.t)} כהושלם" title="לסמן כהושלם"`}>✓</button>` : ''}
      <span class="dot" style="--c:${esc(color(x.course.col))}"></span>
      <span class="t"><b title="${esc(x.t)}">${esc(x.t)}</b><span>${esc(x.course.n)}${x.cat ? ' · ' + esc(x.cat) : ''}</span></span>
      ${when ? `<span class="when">${esc(when)}</span>` : ''}
    </li>`;

  const ring = (pct, met, label) => {
    const r = 22, c = 2 * Math.PI * r, off = c * (1 - Math.min(100, pct) / 100);
    return `<svg class="ring${met ? ' met' : ''}" width="56" height="56" viewBox="0 0 56 56" role="img" aria-label="${esc(label)}">
      <circle class="bg" cx="28" cy="28" r="${r}" fill="none" stroke-width="6"></circle>
      <circle class="fg" cx="28" cy="28" r="${r}" fill="none" stroke-width="6" stroke-linecap="round" stroke-dasharray="${c.toFixed(1)}" stroke-dashoffset="${off.toFixed(1)}" transform="rotate(-90 28 28)"></circle>
      <text x="28" y="32" text-anchor="middle">${met ? '✓' : `${pct}%`}</text></svg>`;
  };

  function render() {
    const d = data, s = d.settings, show = s.show;
    const snap = pick(d);
    const now = new Date();
    const v = V.build(snap, now);
    $('refresh').hidden = s.mode !== 'connected';
    const src = snap && d.snapCloud && d.snapCloud.snap === snap ? 'מהענן' : 'מהאתר';
    $('updated').textContent = snap ? `עודכן ${V.ago(snap.at, now)} · ${src}` : '';
    const main = $('main');
    firstNext = null;
    if (v.empty) {
      main.innerHTML = `<div class="card empty"><b>עוד אין נתונים</b>
        <p class="muted">${s.mode === 'connected' && !d.auth ? 'מצב מחובר: צריך להתחבר בהגדרות.' : 'פתחו את האתר פעם אחת, והתוסף יקבל ממנו את המטלות.'}</p>
        ${d.cloudErr && s.mode === 'connected' ? `<p class="err small">${esc(d.cloudErr)}</p>` : ''}</div>`;
      $('five').hidden = true;
      return;
    }
    const parts = [];
    if (v.adhkar) {
      parts.push(`<section class="card adk"><span><span lang="ar" dir="rtl">${v.adhkar === 'm' ? 'أذكار الصباح' : 'أذكار المساء'}</span><br><span class="muted small">עכשיו בחלון הזמן</span></span>
        <button class="btn" data-act="adhkar" data-p="${v.adhkar}">להתחיל</button></section>`);
    }
    if (show.urgent && v.overdue.length) {
      parts.push(`<section class="card late-box"><h2>באיחור <span class="count">${v.overdue.length}</span></h2><ul class="list">
        ${v.overdue.slice(0, 6).map((x) => row(x, { tick: true, late: true, when: dmy(x.due) })).join('')}</ul>
        ${v.overdue.length > 6 ? `<p class="note">ועוד ${v.overdue.length - 6} באתר</p>` : ''}</section>`);
    }
    if (show.today) {
      const next = v.next[0];
      if (next) firstNext = next;
      const items = v.dueToday.length ? `<ul class="list">${v.dueToday.map((x) => row(x, { tick: true })).join('')}</ul>` : '<p class="note">אין משהו שמוגש היום.</p>';
      const nextHTML = next && !v.dueToday.some((x) => x.id === next.id) && !v.overdue.some((x) => x.id === next.id)
        ? `<div class="row next" style="border-top:1px solid var(--border);margin-top:4px;padding-top:7px">
            <span class="dot" style="--c:${esc(color(next.course.col))}"></span>
            <span class="t"><span class="why">הפעולה הבאה · ${esc(next.why)}</span><b title="${esc(next.t)}">${esc(next.t)}</b></span></div>` : '';
      const classes = v.classes.length ? `<p class="note" style="margin:6px 0 0">היום במערכת: ${v.classes.map((c) => `${esc(c.course.n)} ${esc(c.from)}`).join(' · ')}</p>` : '';
      parts.push(`<section class="card"><h2>היום${v.fresh ? '' : ' <span class="count small muted">(לפי הנתונים האחרונים)</span>'}</h2>${items}${nextHTML}${classes}</section>`);
    }
    if (show.urgent && v.soon.length) {
      parts.push(`<section class="card"><h2>7 הימים הקרובים <span class="count">${v.soon.length}</span></h2><ul class="list">
        ${v.soon.slice(0, 8).map((x) => row(x, { tick: true, when: x.inDays === 1 ? 'מחר' : `${DAYS[new Date(x.due + 'T12:00').getDay()]} · ${x.inDays} ימים` })).join('')}</ul>
        ${v.soon.length > 8 ? `<p class="note">ועוד ${v.soon.length - 8} באתר</p>` : ''}</section>`);
    }
    if (show.exams && v.exams.length) {
      parts.push(`<section class="card"><h2>מבחנים</h2>${v.exams.map((e) => `<div class="exam">
        <span class="n${e.inDays <= 14 ? ' warn' : ''}">${e.inDays === 0 ? 'היום' : `${e.inDays}<small>${e.inDays === 1 ? 'יום' : 'ימים'}</small>`}</span>
        <span class="t"><b>${esc(e.course.n)}</b><br><span class="muted small">${esc(e.l)} · ${dmy(e.d)}</span></span></div>`).join('')}</section>`);
    }
    if (show.points && v.game) {
      const g = v.game, goal = g.goal;
      parts.push(`<section class="card pts">
        ${ring(goal.pct, goal.met, `יעד יומי: ${goal.pct}%`)}
        <div style="flex:1"><b>רמה ${esc(g.level)} · ${esc(g.name)}</b>
          <div class="bar" aria-hidden="true"><i style="width:${Math.max(0, Math.min(100, Number(g.pct) || 0))}%"></i></div>
          <span class="muted small">יעד היום: ${goal.doneItems}/${goal.items} פריטים או ${goal.doneMinutes}/${goal.minutes} דק׳ · +${esc(g.todayXP)} היום · ${esc(g.balance)} נק׳</span>
          ${g.stale ? '<br><span class="muted small">היום עוד לא נפתח האתר — ההתקדמות מתעדכנת כשפותחים אותו</span>' : ''}
        </div></section>`);
    }
    if (s.mode === 'connected' && d.cloudErr) parts.push(`<p class="err small">${esc(d.cloudErr)}</p>`);
    main.innerHTML = parts.join('') || '<div class="card empty muted">אין מה להציג לפי הבחירה בהגדרות.</div>';
    $('five').hidden = !firstNext;
  }

  document.addEventListener('click', async (e) => {
    const b = e.target.closest('button');
    if (!b) return;
    if (b.id === 'open') { await send({ type: 'open-site' }); window.close(); return; }
    if (b.id === 'opts') { chrome.runtime.openOptionsPage(); window.close(); return; }
    if (b.id === 'refresh') {
      b.disabled = true;
      const r = await send({ type: 'refresh' });
      b.disabled = false;
      msg(r && r.ok ? 'עודכן מהענן' : (r && r.err) || 'לא הצלחתי לרענן');
      return;
    }
    if (b.id === 'five' && firstNext) { await send({ type: 'action', action: { act: 'five', id: firstNext.id } }); window.close(); return; }
    if (b.dataset.act === 'adhkar') { await send({ type: 'action', action: { act: 'adhkar', p: b.dataset.p } }); window.close(); return; }
    if (b.dataset.act === 'done') {
      b.disabled = true;
      const li = b.closest('.row');
      const r = await send({ type: 'action', action: { act: 'done', id: b.dataset.id } });
      if (r && r.ok) {
        li.classList.add('done');
        msg(r.queued ? 'נשלח לאתר (נפתח ברקע) — יסומן שם, עם הנקודות' : 'סומן כהושלם באתר ✓');
      } else { b.disabled = false; msg((r && r.err) || 'לא הצלחתי לסמן'); }
    }
  });

  const load = async () => {
    data = await chrome.storage.local.get(['settings', 'snapLocal', 'snapCloud', 'auth', 'cloudErr']);
    data.settings = CFG.merge(data.settings);
    render();
  };
  chrome.storage.onChanged.addListener((ch, area) => { if (area === 'local') load(); });
  load().then(() => { if (data.settings.mode === 'connected' && data.auth) send({ type: 'refresh' }); });
})();
