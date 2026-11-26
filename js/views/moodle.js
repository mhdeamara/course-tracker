/* views/moodle.js — Moodle assignments: the settings card (manual .ics import, the "לא משויך" list, remembered
 * course choices), the small tags on synced items, and their actions. The logic lives in js/moodle.js. */
(function (CT) {
  'use strict';
  const { u, ui } = CT;
  const S = CT.store, M = CT.model, Mo = CT.moodle, I = CT.ical;
  const esc = u.esc, icon = u.icon;
  const V = {};
  CT.views = CT.views || {};
  CT.views.moodle = V;
  const MAX_BYTES = 5 * 1024 * 1024;

  const mo = () => Mo.ensure(S.state);
  const fmtWhen = (iso) => {
    if (!iso) return '';
    const d = new Date(iso);
    return `${u.fmtDateFull(u.isoDate(d))} ${u.pad(d.getHours())}:${u.pad(d.getMinutes())}`;
  };
  const dueText = (due, time) => (due ? `${u.fmtDateFull(due)}${time ? ` ${time}` : ''}` : 'בלי תאריך');
  const targets = () => {
    const act = S.state.settings.activeSemesterId;
    return S.state.courses.filter((c) => c.kind !== 'record' && !c.archived)
      .sort((a, b) => (b.semesterId === act) - (a.semesterId === act) || a.name.localeCompare(b.name, 'he'));
  };
  const mergeOpts = (source) => ({ newItem: (t) => M.newItem(t), newCategory: (n) => M.newCategory(n), uid: u.uid, today: u.today(), source });

  /* ================= tags on a course row ================= */
  V.badges = (it) => {
    const s = it.source;
    if (!s || s.kind !== 'moodle') return '';
    const time = s.dueTime ? ` · ${s.dueTime}` : '';
    const out = [`<span class="tag moodle-tag" title="מטלה ממודל${s.dueTime ? ` · להגשה עד ${s.dueTime === '24:00' ? '24:00 (חצות)' : s.dueTime}` : ''}${s.category ? ` · ${esc(s.category)}` : ''}">ממודל${time}</span>`];
    if (s.changed) out.push(`<button class="tag moodle-alert" data-action="moodle-changed" title="המועד או השם השתנו במודל — לחץ לפרטים">עודכן ממודל</button>`);
    if (s.gone) out.push(`<button class="tag moodle-alert" data-action="moodle-gone" title="האירוע כבר לא מופיע בלוח של מודל — לחץ להחלטה">לא מופיע יותר במודל</button>`);
    if (s.mergeWith) {
      const f = S.findItem(s.mergeWith);
      if (f) out.push(`<button class="tag moodle-merge" data-action="moodle-merge" title="נראה כמו אותה מטלה">למזג עם „${esc(f.item.title)}”?</button>`);
    }
    return out.join('');
  };

  /** Click on one of the tags above (called from the course view). */
  V.rowAction = (action, itemId, anchor) => {
    const f = S.findItem(itemId);
    if (!f || !f.item.source) return;
    const s = f.item.source;
    if (action === 'moodle-changed') {
      const c = s.changed || {};
      const rows = [];
      if (c.prevTitle !== s.title) rows.push(`<tr><th>שם</th><td dir="auto">${esc(c.prevTitle)}</td><td dir="auto"><b>${esc(s.title)}</b></td></tr>`);
      if (c.prevDue !== s.due || (c.prevTime || '') !== (s.dueTime || '')) rows.push(`<tr><th>הגשה</th><td>${esc(dueText(c.prevDue, c.prevTime))}</td><td><b>${esc(dueText(s.due, s.dueTime))}</b></td></tr>`);
      const mine = (f.item.title !== s.title || f.item.due !== s.due)
        ? '<p class="small">שינית את השם או התאריך של הפריט בעצמך, ולכן הם לא עודכנו אוטומטית. אפשר לעדכן אותם ידנית.</p>' : '';
      ui.modal({
        title: 'עודכן ממודל',
        body: `<p dir="auto">${esc(f.item.title)}</p><table class="moodle-diff"><thead><tr><th></th><th>היה</th><th>עכשיו במודל</th></tr></thead><tbody>${rows.join('') || '<tr><td colspan="3">אין הבדל</td></tr>'}</tbody></table>
          <p class="small muted">נבדק ב-${esc(fmtWhen(c.at))}</p>${mine}`,
        actions: [
          (f.item.title !== s.title || f.item.due !== s.due) && { label: 'החל את הערכים של מודל', fn: () => S.commit('עדכון ממודל', () => { const x = S.findItem(itemId).item; x.title = x.source.title; x.due = x.source.due; x.source.changed = null; }) },
          { label: 'ראיתי', primary: true, fn: () => S.commit('אישור עדכון ממודל', () => { S.findItem(itemId).item.source.changed = null; }) },
        ].filter(Boolean),
      });
    }
    if (action === 'moodle-gone') {
      ui.menu(anchor, [
        { label: 'השאר כפריט רגיל (בלי קשר למודל)', icon: 'check', fn: () => S.commit('ניתוק פריט ממודל', () => { delete S.findItem(itemId).item.source; }) },
        { label: 'השאר מסומן', icon: 'calendar', fn: () => {} },
        '-',
        { label: 'מחק את הפריט', icon: 'trash', danger: true, fn: () => CT.views.course.deleteItem(itemId) },
      ]);
    }
    if (action === 'moodle-merge') {
      const ph = S.findItem(s.mergeWith);
      ui.menu(anchor, [
        ph && { label: `מזג עם „${ph.item.title}” (הסטטוס וההערות שלו נשמרים)`, icon: 'check', fn: () => S.commit('מיזוג מטלה ממודל', () => {
          const x = S.findItem(itemId);
          if (x) Mo.mergeIntoPlaceholder(x.course, itemId);
        }) },
        { label: 'אלה מטלות שונות — השאר נפרד', icon: 'close', fn: () => S.commit('ביטול הצעת מיזוג', () => { S.findItem(itemId).item.source.mergeWith = null; }) },
      ]);
    }
  };

  /* ================= settings card ================= */
  V.section = () => {
    const m = mo();
    const last = m.last;
    const courses = targets();
    const courseOpts = (sel) => `<option value="">בחר קורס…</option>${courses.map((c) => `<option value="${esc(c.id)}"${c.id === sel ? ' selected' : ''}>${esc(c.name)}${c.number ? ` (${esc(c.number)})` : ''}</option>`).join('')}`;
    const inbox = m.inbox.map((x) => `
      <div class="moodle-inbox-row" data-uid="${esc(x.uid)}">
        <div class="mi-main">
          <b dir="auto">${esc(x.title)}</b>
          <span class="small muted">${esc(dueText(x.due, x.dueTime))}${x.category ? ` · במודל: <span dir="auto">${esc(x.category)}</span>` : ' · בלי קורס במודל (אירוע אישי או כללי)'}</span>
        </div>
        <select aria-label="שייך לקורס">${courseOpts('')}</select>
        ${x.category ? `<label class="small"><input type="checkbox" checked> גם כל שאר המטלות של „<span dir="auto">${esc(x.category)}</span>”</label>` : ''}
        <button class="btn btn-small btn-primary" data-action="moodle-assign">שייך</button>
        <button class="btn btn-small btn-ghost" data-action="moodle-ignore" title="לא לייבא את האירוע הזה שוב">התעלם</button>
      </div>`).join('');
    const maps = Object.keys(m.map).map((k) => {
      const c = S.course(m.map[k]);
      return `<li><span dir="auto">${esc(k)}</span> ← ${c ? esc(c.name) : '<i>קורס שנמחק</i>'} <button class="btn btn-small btn-ghost" data-action="moodle-unmap" data-key="${esc(k)}">שכח</button></li>`;
    }).join('');
    const ignoredN = Object.keys(m.ignored).length;
    return `<section class="card moodle-card" id="moodle">
      <h2>📥 סנכרון מטלות ממודל</h2>
      <p class="small">המערכת לעולם לא מבקשת את שם המשתמש או הסיסמה של הטכניון ולא מתחברת למודל בשמך. היא קוראת רק את ייצוא לוח השנה של מודל.</p>
      ${linkHTML()}
      <h3>ייבוא קובץ ‎.ics‎ (עובד גם בלי חשבון באתר)</h3>
      <ol class="small moodle-steps">
        <li>במודל: <b>לוח שנה</b> ← בתחתית העמוד <b>ייצוא לוח שנה</b>, או ישירות <span dir="ltr">…/calendar/export.php</span> באתר המודל.</li>
        <li>אירועים: <b>כל האירועים</b> (או "אירועים הקשורים לקורסים"). טווח: <b>אירועים אחרונים ו-60 הימים הבאים</b>.</li>
        <li>לוחצים <b>ייצוא</b>, שומרים את הקובץ, ובוחרים אותו כאן.</li>
      </ol>
      <div class="btn-row">
        <button class="btn btn-primary" data-action="moodle-import">${icon.upload} ייבוא קובץ ‎.ics‎</button>
      </div>
      <p class="small">${last ? `ייבוא אחרון: <b>${esc(fmtWhen(last.at))}</b> — ${esc(Mo.summary(last))}` : 'עוד לא יובאו מטלות.'}</p>
      <p class="small muted">כל מטלה נכנסת לקטגוריה "שיעורי בית" של הקורס עם התג <span class="tag moodle-tag">ממודל</span>. ייבוא חוזר לא יוצר כפילויות;
        שינוי במודל מסומן "עודכן ממודל", ומטלה שנעלמה מסומנת ולא נמחקת. הסימון V, ההערות, התגיות והכוכב שלך לא נדרסים לעולם.</p>
      ${m.inbox.length ? `<h3>לא משויך (${m.inbox.length})</h3>
        <p class="small muted">לא מצאתי לאיזה קורס שייכות המטלות האלה. בחר קורס — הבחירה נשמרת לייבואים הבאים.</p>
        <div class="moodle-inbox">${inbox}</div>` : ''}
      ${maps ? `<details class="small"><summary>שיוכים שמורים (${Object.keys(m.map).length})</summary><ul class="moodle-maps">${maps}</ul></details>` : ''}
      ${ignoredN ? `<p class="small muted">${ignoredN} אירועים מוסתרים לתמיד. <button class="btn btn-small btn-ghost" data-action="moodle-unignore">החזר אותם בייבוא הבא</button></p>` : ''}
    </section>`;
  };

  /* ================= the calendar link (needs an account on the site) ================= */
  const HAS_FEED = 'ct.moodle.hasFeed'; // "1" when this account has a saved link — a flag only, never the link
  const flag = (on) => { try { if (on) localStorage.setItem(HAS_FEED, '1'); else localStorage.removeItem(HAS_FEED); } catch (e) { /* ignore */ } };
  const hasFlag = () => { try { return localStorage.getItem(HAS_FEED) === '1'; } catch (e) { return false; } };
  let feed = { state: 'unknown' };   // unknown | loading | none | ok | error
  let editing = false;                // showing the paste box although a link is saved
  let busy = '';                      // 'check' | 'sync' | 'save' while a request runs
  let checked = null;                 // { events, list } from "בדוק קישור", so importing it needs no second fetch
  const C = () => CT.cloud;
  const rerender = () => { if (location.hash === '#/settings') CT.app.rerender(); };
  const TABLE_MISSING = /moodle_feeds|relation .* does not exist|schema cache|PGRST20[0-9]/i;

  async function loadFeed() {
    feed = { state: 'loading' };
    try {
      const f = await C().moodleFeed();
      feed = f ? { state: 'ok', host: f.host, updatedAt: f.updated_at } : { state: 'none' };
      flag(!!f);
    } catch (e) {
      feed = { state: 'error', error: TABLE_MISSING.test(`${e.message} ${e.code}`) ? 'הטבלה moodle_feeds עוד לא נוצרה ב-Supabase. הרץ את supabase/moodle.sql (הוראות ב-README).' : C().heMsg(e) };
    }
    rerender();
  }

  function linkHTML() {
    const cloud = C();
    const m = mo();
    if (!cloud || !cloud.enabled) return '';
    if (!cloud.signedIn()) {
      return `<h3>סנכרון אוטומטי דרך קישור</h3>
        <p class="small muted">כדי שהאתר יביא את המטלות לבד צריך להתחבר לחשבון באתר (בסעיף "סנכרון בין מכשירים" למעלה). בלי חשבון — ייבוא קובץ ‎.ics‎ למטה עובד תמיד.</p>`;
    }
    if (feed.state === 'unknown') setTimeout(loadFeed, 0);
    const lastLine = m.lastLink ? `<p class="small">סונכרן לאחרונה: <b>${esc(fmtWhen(m.lastLink))}</b>${m.last && m.last.source === 'link' ? ` — ${esc(Mo.summary(m.last))}` : ''}</p>` : '';
    const errLine = m.linkError ? `<p class="small moodle-error" role="alert">⚠️ ${esc(m.linkError.message)} <span class="muted">(${esc(fmtWhen(m.linkError.at))})</span></p>` : '';
    const paste = `
      <ol class="small moodle-steps">
        <li>במודל: <b>לוח שנה</b> ← בתחתית העמוד <b>ייצוא לוח שנה</b>. לא מוצא? פותחים ישירות <span dir="ltr">https://moodle…technion.ac.il/calendar/export.php</span> (עם הכתובת של המודל שלך).</li>
        <li>אירועים: <b>כל האירועים</b> (או "אירועים הקשורים לקורסים"). טווח: <b>אירועים אחרונים ו-60 הימים הבאים</b>.</li>
        <li>לוחצים <b>קבל כתובת לוח שנה</b> (Get calendar URL), מעתיקים את הקישור ומדביקים כאן.</li>
      </ol>
      <p class="small moodle-secret">🔒 הקישור הוא <b>מפתח סודי</b>: מי שמחזיק בו רואה את לוח השנה שלך במודל. אל תשתף אותו ואל תדביק אותו בהערות.
        הוא נשמר רק בחשבון שלך ב-Supabase (רק אתה יכול לקרוא אותו), לא במכשיר, לא בגיבוי ולא בקוד. אם הוא דלף — מפיקים חדש במודל, והישן מפסיק לעבוד.</p>
      <div class="moodle-link-row">
        <input class="moodle-link-input" type="url" inputmode="url" dir="ltr" autocomplete="off" autocapitalize="off" spellcheck="false"
          placeholder="https://moodle…technion.ac.il/calendar/export_execute.php?userid=…&amp;authtoken=…" aria-label="קישור לוח השנה של מודל">
        <button class="btn btn-primary" data-action="moodle-save-link"${busy ? ' disabled' : ''}>${busy === 'save' ? 'שומר…' : 'שמור קישור'}</button>
        ${editing ? '<button class="btn btn-ghost" data-action="moodle-cancel-edit">ביטול</button>' : ''}
      </div>`;
    let body;
    if (feed.state === 'loading' || feed.state === 'unknown') body = '<p class="small muted">בודק אם שמור קישור…</p>';
    else if (feed.state === 'error') body = `<p class="small moodle-error">⚠️ ${esc(feed.error)}</p><button class="btn btn-small" data-action="moodle-reload-feed">נסה שוב</button>`;
    else if (feed.state === 'none' || editing) body = paste;
    else {
      body = `<p class="small">🔗 מחובר ל-<b dir="ltr">${esc(feed.host || 'moodle')}</b> · הקישור נשמר ב-${esc(fmtWhen(feed.updatedAt))} <span class="muted">(הקישור עצמו לא מוצג)</span></p>
        <div class="btn-row">
          <button class="btn" data-action="moodle-check"${busy ? ' disabled' : ''}>${busy === 'check' ? 'בודק…' : 'בדוק קישור'}</button>
          <button class="btn btn-primary" data-action="moodle-sync"${busy ? ' disabled' : ''}>${busy === 'sync' ? 'מסנכרן…' : 'סנכרן עכשיו'}</button>
          <button class="btn btn-ghost" data-action="moodle-edit-link">החלף קישור</button>
          <button class="btn btn-ghost btn-danger" data-action="moodle-disconnect">נתק</button>
        </div>
        ${checked ? `<p class="small">✅ הקישור תקין: ${checked.events} אירועים בלוח. <button class="btn btn-small" data-action="moodle-import-checked">ייבא אותם עכשיו</button></p>` : ''}
        <div class="moodle-prefs small">
          <label><input type="checkbox" data-moodle-pref="auto"${m.auto ? ' checked' : ''}> סנכרון אוטומטי בכל כניסה לאתר (אם עברו יותר מ-30 דקות)</label>
          <label><input type="checkbox" data-moodle-pref="periodic"${m.periodic ? ' checked' : ''}> רענון כל שעה כשהאתר פתוח</label>
        </div>`;
    }
    return `<h3>סנכרון אוטומטי דרך קישור</h3>${body}${errLine}${lastLine}`;
  }

  /** Fetch through the Edge Function → { events }. Throws Error with a Hebrew message and .code. */
  async function fetchEvents() {
    let res;
    try { res = await C().fetchMoodle(); } catch (e) {
      const d = e.data || {};
      const offline = e instanceof TypeError;
      const noFn = !d.error && (e.status === 404 || e.status === 400 && /not.?found|function/i.test(e.message || ''));
      const err = new Error(d.message || (offline ? 'אין חיבור לאינטרנט — האתר ממשיך עם המטלות שסונכרנו לאחרונה'
        : noFn ? 'פונקציית הסנכרון (moodle-ical) עוד לא הותקנה ב-Supabase. ההוראות ב-README.' : C().heMsg(e)));
      err.code = d.error || (offline ? 'offline' : noFn ? 'no-function' : 'server');
      throw err;
    }
    let parsed;
    try { parsed = I.parse((res && res.ics) || ''); } catch (e) { throw Object.assign(new Error('מודל לא החזיר לוח שנה תקין. הפק קישור חדש במודל'), { code: 'link-rejected' }); }
    return { events: parsed.events };
  }

  // problems only you can fix: they stay on screen (settings + dashboard) until a sync succeeds
  const PERSIST_ERRORS = ['link-rejected', 'bad-link', 'no-link', 'too-big', 'no-function'];
  const setLinkError = (e, silent) => S.commit('', (st) => {
    Mo.ensure(st).linkError = e ? { code: e.code, message: e.message, at: new Date().toISOString() } : null;
  }, { undo: false, silent });

  /**
   * Sync through the saved link. manual: messages and the result dialog. Automatic: quiet — a toast only when
   * something changed, a lasting warning only for problems you must fix (an expired link).
   */
  V.syncLink = async ({ manual = false, events = null } = {}) => {
    if (busy) return null;
    if (manual) { busy = 'sync'; rerender(); } else busy = 'auto';
    try {
      const evs = events || (await fetchEvents()).events;
      checked = null;
      const stamp = (st) => Object.assign(Mo.ensure(st), { lastLink: new Date().toISOString(), linkError: null });
      let r = null;
      if (!evs.length) {
        S.commit('', stamp, { undo: false, silent: !manual });
        if (manual) ui.toast('הלוח במודל ריק כרגע — אין אירועים בטווח הזמן של הקישור');
      } else if (manual) {
        r = V.importEvents(evs, 'link');
        S.commit('', stamp, { undo: false });
      } else {
        r = S.commit('סנכרון אוטומטי ממודל', (st) => { const out = Mo.merge(st, evs, mergeOpts('link')); stamp(st); return out; });
        if (r.added || r.updated || r.gone || r.unassigned) ui.toast(`מודל: ${Mo.summary(r)}`, { action: { label: 'בטל', fn: S.undo } });
      }
      return r;
    } catch (e) {
      if (manual) ui.toast(e.message, { error: true });
      if (PERSIST_ERRORS.includes(e.code)) setLinkError(e, !manual);
      return null;
    } finally {
      busy = '';
      rerender();
    }
  };

  /** Automatic sync, started after the cloud data has loaded: on opening (> 30 min since the last link sync, on any
   *  device — the time is part of the synced data) and every hour while the site is open. */
  let autoTimer = null;
  V.startAuto = () => {
    if (autoTimer || !C() || !C().enabled) return;
    const due = (minutes) => { const t = mo().lastLink; return !t || Date.now() - new Date(t).getTime() > minutes * 60000; };
    const tick = (opening) => {
      const m = mo();
      if (!C().signedIn() || !hasFlag() || !navigator.onLine || document.hidden || busy) return;
      if (opening ? (m.auto && due(30)) : (m.periodic && due(60))) V.syncLink({ manual: false });
    };
    tick(true);
    autoTimer = setInterval(() => tick(false), 5 * 60000);
    document.addEventListener('visibilitychange', () => { if (!document.hidden) tick(false); });
  };

  V.onChange = (t) => {
    const k = t.dataset.moodlePref;
    if (k) S.commit('הגדרות סנכרון ממודל', (st) => { Mo.ensure(st)[k] = t.checked; });
  };

  async function linkAction(action, a) {
    switch (action) {
      case 'moodle-save-link': {
        const input = document.querySelector('.moodle-link-input');
        const val = input ? input.value.trim() : '';
        const bad = Mo.checkLink(val);
        if (bad) { ui.toast(bad, { error: true }); if (input) input.focus(); return; }
        busy = 'save';
        a.disabled = true;
        try {
          await C().saveMoodleLink(val);
          if (input) input.value = ''; // the link leaves the page right away
          editing = false;
          checked = null;
          flag(true);
          setLinkError(null, true);
          ui.toast('הקישור נשמר בחשבון שלך. לחץ "בדוק קישור" כדי לוודא שהוא עובד');
          busy = '';
          await loadFeed();
        } catch (e) {
          busy = '';
          ui.toast(TABLE_MISSING.test(`${e.message} ${e.code}`) ? 'הטבלה moodle_feeds עוד לא נוצרה ב-Supabase. הרץ את supabase/moodle.sql'
            : /check constraint|23514/i.test(`${e.message} ${e.code}`) ? 'השרת דחה את הקישור: זה לא קישור ייצוא של מודל הטכניון' : C().heMsg(e), { error: true });
          rerender();
        }
        return;
      }
      case 'moodle-check': {
        busy = 'check';
        rerender();
        try {
          const r = await fetchEvents();
          checked = { events: r.events.length, list: r.events };
          setLinkError(null, true);
        } catch (e) {
          checked = null;
          ui.toast(e.message, { error: true });
          if (PERSIST_ERRORS.includes(e.code)) setLinkError(e, true);
        }
        busy = '';
        rerender();
        return;
      }
      case 'moodle-import-checked': if (checked) V.syncLink({ manual: true, events: checked.list }); return;
      case 'moodle-sync': V.syncLink({ manual: true }); return;
      case 'moodle-edit-link': editing = true; rerender(); setTimeout(() => { const i = document.querySelector('.moodle-link-input'); if (i) i.focus(); }, 30); return;
      case 'moodle-cancel-edit': editing = false; rerender(); return;
      case 'moodle-reload-feed': loadFeed(); return;
      case 'moodle-disconnect':
        if (!(await ui.confirm('לנתק את הקישור למודל? הקישור יימחק מהחשבון שלך. המטלות שכבר יובאו נשארות.', 'נתק', true))) return;
        try {
          await C().deleteMoodleLink();
          flag(false);
          checked = null;
          feed = { state: 'none' };
          setLinkError(null, false);
          ui.toast('הקישור נמחק מהחשבון. מומלץ גם להפיק קישור חדש במודל, כדי שהישן יפסיק לעבוד');
        } catch (e) { ui.toast(C().heMsg(e), { error: true }); }
        return;
      default: break;
    }
  }
  /** After sign-in / sign-out: load the link status again. */
  V.resetFeed = () => { feed = { state: 'unknown' }; checked = null; editing = false; };

  /** Clicks inside the settings card (settings.js forwards every data-action that starts with "moodle-"). */
  V.onClick = async (a) => {
    const row = a.closest('.moodle-inbox-row');
    const uid = row && row.dataset.uid;
    if (/^moodle-(save-link|check|sync|import-checked|edit-link|cancel-edit|reload-feed|disconnect)$/.test(a.dataset.action)) { linkAction(a.dataset.action, a); return; }
    switch (a.dataset.action) {
      case 'moodle-import': V.pickFile(); break;
      case 'moodle-assign': {
        const courseId = row.querySelector('select').value;
        if (!courseId) { ui.toast('בחר קורס קודם', { error: true }); row.querySelector('select').focus(); return; }
        const box = row.querySelector('input[type=checkbox]');
        const n = S.commit('שיוך מטלה ממודל', (st) => Mo.assign(st, uid, courseId, !!(box && box.checked), mergeOpts()));
        ui.toast(n > 1 ? `${n} מטלות שויכו ל${S.course(courseId).name}` : `המטלה שויכה ל${S.course(courseId).name}`, { action: { label: 'בטל', fn: S.undo } });
        break;
      }
      case 'moodle-ignore': S.commit('הסתרת אירוע ממודל', (st) => Mo.ignore(st, uid)); break;
      case 'moodle-unmap': S.commit('שכחת שיוך', (st) => Mo.unmap(st, a.dataset.key)); break;
      case 'moodle-unignore': S.commit('החזרת אירועים מוסתרים', (st) => { Mo.ensure(st).ignored = {}; }); break;
      default: break;
    }
  };

  /* ================= manual .ics import ================= */
  V.pickFile = () => {
    const inp = document.createElement('input');
    inp.type = 'file';
    inp.accept = '.ics,text/calendar';
    inp.onchange = () => { if (inp.files[0]) V.importFile(inp.files[0]); };
    inp.click();
  };

  V.importFile = async (file) => {
    if (file.size > MAX_BYTES) { ui.toast('הקובץ גדול מדי (מעל 5MB) — זה לא נראה כמו ייצוא של לוח השנה של מודל', { error: true }); return; }
    let parsed;
    try { parsed = I.parse(await file.text()); } catch (e) {
      ui.toast(e.message === 'not-ical' ? 'זה לא קובץ לוח שנה (.ics). במודל: לוח שנה ← ייצוא לוח שנה ← ייצוא.' : 'לא הצלחתי לקרוא את הקובץ', { error: true });
      return;
    }
    V.importEvents(parsed.events, 'file');
  };

  /** Shared by the file import and the manual link sync: merge, then show what changed. */
  V.importEvents = (events, source) => {
    if (!events.length) {
      ui.modal({ title: 'הקובץ ריק', body: '<p>אין בקובץ אף אירוע. במודל, בדוק שבחרת <b>כל האירועים</b> וטווח זמן שכולל את המטלות (למשל "אירועים אחרונים ו-60 הימים הבאים").</p>', actions: [{ label: 'סגור', primary: true }] });
      return null;
    }
    const r = S.commit('ייבוא מטלות ממודל', (st) => Mo.merge(st, events, mergeOpts(source)));
    const line = (n, txt) => (n ? `<li>${n} ${txt}</li>` : '');
    ui.modal({
      title: 'ייבוא ממודל',
      body: `<ul class="moodle-result">
          ${line(r.added, 'מטלות חדשות נוספו לקורסים')}
          ${line(r.updated, 'עודכנו (מסומנות "עודכן ממודל")')}
          ${line(r.restored, 'חזרו להופיע במודל')}
          ${line(r.gone, 'כבר לא מופיעות במודל (מסומנות, לא נמחקו)')}
          ${line(r.unassigned, 'לא שויכו לקורס — מחכות לבחירה שלך בהגדרות')}
          ${line(r.unchanged, 'ללא שינוי')}
          ${line(r.skippedOpen, 'אירועי "נפתח" דולגו (אלה לא מועדי הגשה)')}
          ${line(r.ignored, 'מוסתרות לפי בחירתך')}
          ${line(r.deletedByYou, 'מחקת בעבר — לא נוספו שוב')}
          ${line(r.invalid, 'אירועים פגומים (בלי מזהה) דולגו')}
        </ul>`,
      actions: [
        { label: 'בטל את הייבוא', fn: () => S.undo() },
        { label: r.unassigned ? 'לשיוך' : 'סגור', primary: true, fn: () => { if (r.unassigned) V.showInbox(); } },
      ],
    });
    return r;
  };

  /** Go to the settings card and scroll to the "לא משויך" list. */
  V.showInbox = () => {
    const go = () => { const el = document.getElementById('moodle'); if (el) el.scrollIntoView({ block: 'start' }); };
    if (location.hash !== '#/settings') { location.hash = '#/settings'; setTimeout(go, 60); } else go();
  };
})(window.CT);
