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
      <h3>ייבוא קובץ ‎.ics‎ (עובד גם בלי חשבון באתר)</h3>
      <ol class="small moodle-steps">
        <li>במודל: <b>לוח שנה</b> ← בתחתית העמוד <b>ייצוא לוח שנה</b> (או "Import or export calendars" ← "Export calendar").</li>
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

  /** Clicks inside the settings card (settings.js forwards every data-action that starts with "moodle-"). */
  V.onClick = async (a) => {
    const row = a.closest('.moodle-inbox-row');
    const uid = row && row.dataset.uid;
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

  /** Shared by the file import and (later) the link sync. */
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
