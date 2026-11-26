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
  let freshCache = { list: null, n: -1, set: new Set() };
  /** UIDs of "new" entries in the change list you have not marked as seen (cached per change list). */
  const freshUids = () => {
    const list = mo().changes || [];
    const n = list.filter((c) => !c.seen).length;
    if (freshCache.list !== list || freshCache.n !== n) freshCache = { list, n, set: new Set(list.filter((c) => !c.seen && c.kind === 'new').map((c) => c.uid)) };
    return freshCache.set;
  };
  V.badges = (it) => {
    const s = it.source;
    if (!s || s.kind !== 'moodle') return '';
    const time = s.dueTime ? ` · ${s.dueTime}` : '';
    const out = [];
    if (freshUids().has(s.uid)) out.push('<span class="pill mm-new" title="נוסף בסנכרון האחרון ממודל">חדש</span>');
    out.push(`<span class="tag moodle-tag" title="מטלה ממודל${s.dueTime ? ` · להגשה עד ${s.dueTime === '24:00' ? '24:00 (חצות)' : s.dueTime}` : ''}${s.category ? ` · ${esc(s.category)}` : ''}">ממודל${time}</span>`);
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

  /* ================= categories editor (in the settings card) ================= */
  let classesOpen = false;
  function classesHTML() {
    const m = mo();
    const rows = m.classes.map((c) => `<div class="mm-cls-row" data-cls="${esc(c.id)}">
        <div class="mm-cls-head">
          <input class="input mm-cls-name" data-f="name" value="${esc(c.name)}" aria-label="שם הקטגוריה" maxlength="40">
          <button class="btn btn-small btn-ghost" data-action="moodle-cls-del" title="מחק את הקטגוריה">${icon.trash}</button>
        </div>
        <label class="small">מילות מפתח (מופרדות בפסיק, עברית או אנגלית)
          <textarea class="input" data-f="keywords" rows="2" dir="auto">${esc((c.keywords || []).join(', '))}</textarea></label>
        <div class="mm-cls-opts small">
          <label><input type="checkbox" data-f="toCourse"${c.toCourse ? ' checked' : ''}> להוסיף לדף הקורס, לטבלה</label>
          <input class="input input-sm" data-f="courseCat" value="${esc(c.courseCat || c.name)}" aria-label="שם הטבלה בדף הקורס" maxlength="40">
          <label><input type="checkbox" data-f="inAll"${c.inAll ? ' checked' : ''}> להציג ב„הכל”</label>
          <label><input type="checkbox" data-f="hidden"${c.hidden ? ' checked' : ''}> להסתיר לגמרי</label>
        </div>
      </div>`).join('');
    const rules = Mo.classRules(S.state);
    const rulesHTML = rules.map((r) => `<li><span dir="auto">${esc(r.pattern.replace(/#/g, 'N'))}</span> <span class="muted">· ${r.course ? `<span dir="auto">${esc(r.course)}</span>` : 'בלי קורס'}</span> ← <b>${esc(Mo.className(S.state, r.cls))}</b>
      <button class="btn btn-small btn-ghost" data-action="moodle-rule-forget" data-key="${esc(r.key)}">שכח</button></li>`).join('');
    return `<details class="mm-classes"${classesOpen ? ' open' : ''} id="moodle-classes"><summary><b>קטגוריות וכללי סיווג</b> <span class="muted small">(${m.classes.length} קטגוריות · ${rules.length} בחירות שלך)</span></summary>
      <p class="small muted">כל אירוע ממודל מסווג לפי מילות המפתח בשמו. אירוע שמתאים לשתי קטגוריות, או לאף אחת, <b>לא מנוחש</b> — הוא נכנס ל„לא מסווג” ואתה בוחר.
        בחירה שלך נשמרת לפי הקורס ושם האירוע (בלי מספרים), חלה גם על אירועים דומים, וגוברת תמיד על הכללים. כשאין מילת מפתח, אירוע שמודל עצמו מנסח „יש להגיש את …” נחשב מטלה.</p>
      <div class="mm-cls-list">${rows}</div>
      <div class="btn-row">
        <button class="btn btn-primary" data-action="moodle-cls-save">שמור קטגוריות</button>
        <input class="input input-sm" data-f="newname" placeholder="שם קטגוריה חדשה" aria-label="שם קטגוריה חדשה" maxlength="40">
        <button class="btn" data-action="moodle-cls-add">${icon.plus || '+'} הוסף</button>
        <button class="btn btn-ghost" data-action="moodle-cls-reset">החזר ברירות מחדל</button>
      </div>
      ${rules.length ? `<h4>הבחירות שלך</h4><ul class="moodle-maps small">${rulesHTML}</ul>` : '<p class="small muted">עוד לא בחרת קטגוריה לאף אירוע. בוחרים בדף „המודל שלי”, בתיבה שליד כל אירוע.</p>'}
    </details>`;
  }
  /** Read the editor's fields; null (with a toast) when something is wrong. */
  function readClasses(box) {
    const m = mo();
    const out = [];
    const names = new Set();
    for (const row of box.querySelectorAll('.mm-cls-row')) {
      const old = m.classes.find((c) => c.id === row.dataset.cls);
      if (!old) continue;
      const f = (k) => row.querySelector(`[data-f="${k}"]`);
      const name = f('name').value.trim();
      if (!name || name === Mo.UNCLASSIFIED) { ui.toast('לכל קטגוריה צריך שם (ולא „לא מסווג”)', { error: true }); f('name').focus(); return null; }
      if (names.has(name)) { ui.toast(`השם „${name}” מופיע פעמיים`, { error: true }); f('name').focus(); return null; }
      names.add(name);
      out.push(Object.assign({}, old, {
        name, keywords: Mo.parseKeywords(f('keywords').value), courseCat: f('courseCat').value.trim() || name,
        toCourse: f('toCourse').checked, inAll: f('inAll').checked, hidden: f('hidden').checked,
      }));
    }
    return out;
  }
  async function classAction(act, a) {
    classesOpen = true;
    const box = a.closest('.mm-classes');
    const done = (n, what) => ui.toast(`${what}${n ? ` · ${n} אירועים הועברו למקום החדש` : ''}`, { action: { label: 'בטל', fn: S.undo } });
    if (act === 'moodle-cls-save') {
      const list = readClasses(box);
      if (!list) return;
      const n = S.commit('עדכון קטגוריות ממודל', (st) => { Mo.ensure(st).classes = list; return Mo.reclassifyAll(st, mergeOpts()); });
      done(n, 'הקטגוריות נשמרו');
    } else if (act === 'moodle-cls-add') {
      const inp = box.querySelector('[data-f="newname"]');
      const name = inp.value.trim();
      if (!name) { inp.focus(); return; }
      const c = S.commit('קטגוריה חדשה', (st) => Mo.addClass(st, name));
      if (!c) ui.toast('כבר יש קטגוריה בשם הזה', { error: true });
      else ui.toast(`נוספה „${name}” — הוסף לה מילות מפתח ושמור`);
    } else if (act === 'moodle-cls-del') {
      const id = a.closest('.mm-cls-row').dataset.cls;
      const c = Mo.classById(S.state, id);
      if (!c || !(await ui.confirm(`למחוק את „${c.name}”? האירועים שלה יסווגו מחדש לפי הכללים (או „לא מסווג”). פריטים בדף הקורס נשארים במקומם.`, 'מחק', true))) return;
      const n = S.commit('מחיקת קטגוריה', (st) => Mo.removeClass(st, id, mergeOpts()));
      done(n, `„${c.name}” נמחקה`);
    } else if (act === 'moodle-cls-reset') {
      if (!(await ui.confirm('להחזיר את הקטגוריות ומילות המפתח לברירת המחדל? הבחירות הידניות שלך נשמרות (חוץ מבחירות בקטגוריות שלא יהיו קיימות).', 'החזר', false))) return;
      const n = S.commit('ברירות מחדל לקטגוריות', (st) => Mo.resetClasses(st, mergeOpts()));
      done(n, 'הקטגוריות חזרו לברירת המחדל');
    } else if (act === 'moodle-rule-forget') {
      const n = S.commit('שכחת סיווג ידני', (st) => Mo.clearClass(st, a.dataset.key, mergeOpts()));
      done(n, 'הבחירה נשכחה — האירועים חוזרים לכללים האוטומטיים');
    }
  }

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
      <p class="small muted">כל אירוע מסווג לקטגוריה (מטלות, תרגילי הכנה, בחנים, מעבדות…) ונכנס לטבלה המתאימה בדף הקורס עם התג <span class="tag moodle-tag">ממודל</span>; תרגולים והרצאות מוצגים רק ב„המודל שלי”. ייבוא חוזר לא יוצר כפילויות;
        שינוי במודל מסומן "עודכן ממודל", ומטלה שנעלמה מסומנת ולא נמחקת. הסימון V, ההערות, התגיות והכוכב שלך לא נדרסים לעולם.</p>
      ${m.inbox.length ? `<h3>לא משויך (${m.inbox.length})</h3>
        <p class="small muted">לא מצאתי לאיזה קורס שייכות המטלות האלה. בחר קורס — הבחירה נשמרת לייבואים הבאים.</p>
        <div class="moodle-inbox">${inbox}</div>` : ''}
      ${maps ? `<details class="small"><summary>שיוכים שמורים (${Object.keys(m.map).length})</summary><ul class="moodle-maps">${maps}</ul></details>` : ''}
      ${classesHTML()}
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
  const rerender = () => { if (/^#\/(settings|moodle)\b/.test(location.hash)) CT.app.rerender(); };
  const TABLE_MISSING = /moodle_feeds|relation .* does not exist|schema cache|PGRST20[0-9]/i;

  async function loadFeed() {
    feed = { state: 'loading' };
    try {
      const f = await C().moodleFeed();
      feed = f ? { state: 'ok', host: f.host, updatedAt: f.updated_at, preset: f.preset || null, what: f.what || null } : { state: 'none' };
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
        הוא נשמר מוצפן (Supabase Vault) בחשבון שלך בלבד, לא במכשיר, לא בגיבוי ולא בקוד. שים לב: את הקישור אי אפשר לבטל בעצמך במודל — ראה למטה.</p>
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
        <details class="small moodle-revoke"><summary>איך מבטלים את הקישור גם בצד של מודל?</summary>
        <p>"נתק" מוחק את הקישור מהחשבון שלך כאן (כולל מ-Vault). אבל הקישור עצמו ממשיך לעבוד במודל: המפתח שבו מחושב מהמשתמש שלך במודל,
        ו"קבל כתובת לוח שנה" מחזיר שוב את אותו קישור — אין במודל כפתור שמבטל אותו.</p>
        <p>אם הקישור דלף: פנה לתמיכת המודל של הטכניון ובקש לאפס את מפתח ייצוא לוח השנה של המשתמש שלך (זה דורש מנהל מערכת).
        עד אז, מי שמחזיק בקישור יכול לראות רק את לוח השנה שלך (מועדים ושמות מטלות) — לא את הקורסים, הציונים או ההגשות.</p></details>
        ${checked ? `<p class="small">✅ הקישור תקין: ${checked.events} אירועים בלוח. <button class="btn btn-small" data-action="moodle-import-checked">ייבא אותם עכשיו</button></p>` : ''}
        <div class="moodle-prefs small">
          <label><input type="checkbox" data-moodle-pref="auto"${m.auto ? ' checked' : ''}> עדכון בכל כניסה לאתר</label>
          <label><input type="checkbox" data-moodle-pref="periodic"${m.periodic ? ' checked' : ''}> עדכון כל 30 דקות כשהאתר פתוח</label>
        </div>
        <p class="small muted">🕑 השרת מרענן את הקישור לבד כל שעתיים, גם כשהאתר סגור${m.serverCheckedAt ? ` (בדיקה אחרונה: ${esc(fmtWhen(m.serverCheckedAt))})` : ' — עוד לא רץ: צריך להריץ את supabase/moodle.sql ולפרוס מחדש את moodle-ical'}.</p>
        ${V.rangeHTML()}`;
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
      const err = new Error((d.error && d.message) || (offline ? 'אין חיבור לאינטרנט — האתר ממשיך עם המטלות שסונכרנו לאחרונה'
        : noFn ? 'פונקציית הסנכרון (moodle-ical) עוד לא הותקנה ב-Supabase. ההוראות ב-README.' : C().heMsg(e)));
      err.code = d.error || (offline ? 'offline' : noFn ? 'no-function' : 'server');
      throw err;
    }
    let parsed;
    try { parsed = I.parse((res && res.ics) || ''); } catch (e) { throw Object.assign(new Error('מודל לא החזיר לוח שנה תקין. העתק את הקישור שוב ממודל'), { code: 'link-rejected' }); }
    return { events: parsed.events, hash: res && res.hash };
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
  V.syncLink = async ({ manual = false, events = null, inline = false } = {}) => {
    if (busy) return null;
    let hash = null;
    if (manual) { busy = 'sync'; rerender(); } else { busy = 'auto'; rerender(); }
    try {
      let evs = events;
      if (!evs) { const got = await fetchEvents(); evs = got.events; hash = got.hash || null; }
      checked = null;
      const stamp = (st) => Object.assign(Mo.ensure(st), { lastLink: new Date().toISOString(), linkError: null }, hash ? { lastHash: hash, serverAt: new Date().toISOString() } : {});
      let r = null;
      if (!evs.length) {
        S.commit('', stamp, { undo: false, silent: !manual });
        if (manual) ui.toast('הלוח במודל ריק כרגע — אין אירועים בטווח הזמן של הקישור');
      } else if (manual && !inline) {
        r = V.importEvents(evs, 'link');
        S.commit('', stamp, { undo: false });
      } else {
        r = S.commit(inline ? 'רענון ממודל' : 'סנכרון אוטומטי ממודל', (st) => { const out = Mo.merge(st, evs, mergeOpts('link')); stamp(st); return out; });
        if (inline || r.added || r.updated || r.gone || r.unassigned) ui.toast(`מודל: ${Mo.summary(r)}`, { action: { label: 'בטל', fn: S.undo } });
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

  /* ---------- the scheduled refresh (server) ---------- */
  // error codes the server stores with a snapshot → the message shown here
  const SERVER_ERRORS = {
    'link-rejected': 'מודל דחה את הקישור ברענון האוטומטי. העתק אותו שוב ממודל והדבק בהגדרות',
    'bad-link': 'הקישור השמור לא תקין. העתק אותו שוב ממודל והדבק בהגדרות',
    'too-big': 'הלוח שמודל מחזיר גדול מדי. הפק קישור עם טווח קצר יותר',
  };
  const STALE_MIN = 180; // no server check for 3 hours → the schedule is not running; fall back to fetching from here
  let lastPull = 0;
  /**
   * Read the calendar the server fetched last (every 2 hours, while the site is closed too) and merge it when it
   * changed. Returns the snapshot row (or null). Quiet: a toast only when something changed.
   */
  V.pullSnapshot = async () => {
    if (busy || !C() || !C().signedIn()) return null;
    lastPull = Date.now();
    let row;
    try { row = await C().moodleSnapshot(); } catch (e) { return null; } // table not created yet: the live fetch still works
    if (!row) return null;
    const m = mo();
    if (row.error && SERVER_ERRORS[row.error]) {
      if (!m.linkError || m.linkError.code !== row.error) S.commit('', (st) => { Mo.ensure(st).linkError = { code: row.error, message: SERVER_ERRORS[row.error], at: row.checked_at }; }, { undo: false, silent: true });
    }
    if (row.hash && row.ics && row.hash !== m.lastHash) {
      let evs = null;
      try { evs = I.parse(row.ics).events; } catch (e) { evs = null; }
      if (evs) {
        const r = S.commit('רענון אוטומטי ממודל', (st) => {
          const out = Mo.merge(st, evs, mergeOpts('server'));
          Object.assign(Mo.ensure(st), { lastHash: row.hash, serverAt: row.fetched_at, serverCheckedAt: row.checked_at }, row.error ? {} : { linkError: null });
          return out;
        });
        if (r.changes && r.changes.length) ui.toast(`מודל: ${Mo.unseenText(Mo.unseen(S.state))}`, { action: { label: 'מה השתנה', fn: () => { location.hash = '#/moodle'; } } });
      }
    } else if (row.checked_at !== m.serverCheckedAt) {
      S.commit('', (st) => { Object.assign(Mo.ensure(st), { serverCheckedAt: row.checked_at }, row.error ? {} : { linkError: null }); }, { undo: false, silent: true });
    }
    rerender();
    return row;
  };
  const stale = (row) => !row || !row.checked_at || Date.now() - new Date(row.checked_at).getTime() > STALE_MIN * 60000;

  /** Automatic refresh, started after the cloud data has loaded: read the server's latest calendar on opening and
   *  every 30 minutes. Only when the schedule has not run for 3 hours (not set up yet) does the site fetch from
   *  Moodle itself (on opening if > 30 min since the last fetch, hourly while open). */
  let autoTimer = null;
  V.startAuto = () => {
    if (autoTimer || !C() || !C().enabled) return;
    const due = (minutes) => { const t = mo().lastLink; return !t || Date.now() - new Date(t).getTime() > minutes * 60000; };
    const tick = async (opening) => {
      const m = mo();
      if (!C().signedIn() || !hasFlag() || !navigator.onLine || document.hidden || busy) return;
      if (!(opening ? m.auto : m.periodic)) return;
      if (!opening && Date.now() - lastPull < 30 * 60000) return;
      const row = await V.pullSnapshot();
      if (stale(row) && (opening ? due(30) : due(60))) V.syncLink({ manual: false });
    };
    tick(true);
    autoTimer = setInterval(() => tick(false), 5 * 60000);
    document.addEventListener('visibilitychange', () => { if (!document.hidden) tick(false); });
  };

  /** Dashboard banner: unseen changes from Moodle. */
  V.bannerHTML = () => {
    const n = Mo.unseen(S.state);
    if (!n.total) return '';
    return `<div class="banner banner-info" role="status">📥 ממודל: ${esc(Mo.unseenText(n))}.
      <a class="btn btn-small btn-primary" href="#/moodle">מה השתנה</a>
      <button class="btn btn-small btn-ghost" data-action="moodle-seen">ראיתי</button></div>`;
  };
  V.markSeen = () => S.commit('', (st) => Mo.markSeen(st), { undo: false });

  /** "טווח הקישור" notice (settings + the page). */
  V.rangeHTML = () => {
    if (feed.state !== 'ok') return '';
    const r = Mo.rangeInfo(feed.preset, feed.what);
    const hz = mo().horizon ? ` האירוע הרחוק ביותר שהגיע: <b>${esc(u.fmtDateFull(mo().horizon))}</b>.` : '';
    return `<p class="small ${r.warn ? 'moodle-error' : 'muted'}">${r.warn ? '⚠️ ' : '📆 '}טווח הקישור: <b>${esc(r.label)}</b>. ${esc(r.text)}${r.whatWarn ? ` ${esc(r.whatWarn)}` : ''}${hz}</p>`;
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
          S.commit('', (st) => Object.assign(Mo.ensure(st), { lastHash: null, serverAt: null, serverCheckedAt: null }), { undo: false, silent: true });
          ui.toast('הקישור נמחק מהחשבון שלך (גם מ-Vault). במודל עצמו הוא עדיין עובד — אם הוא דלף, בקש מתמיכת המודל לאפס אותו');
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
      case 'moodle-cls-save': case 'moodle-cls-add': case 'moodle-cls-del': case 'moodle-cls-reset': case 'moodle-rule-forget': classAction(a.dataset.action, a); break;
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
          ${line(r.added, 'פריטים חדשים נוספו לדפי הקורסים')}
          ${line(r.listed, 'אירועים חדשים נוספו ל„המודל שלי” בלבד (תרגולים, הרצאות או לא מסווגים)')}
          ${line(r.unclassified, 'לא סווגו בביטחון — מחכים לבחירה שלך ב„המודל שלי”')}
          ${line(r.reclassified, 'סווגו מחדש והועברו לטבלה המתאימה')}
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

  /* ================= "המודל שלי" page ================= */
  const page = { course: '', showDone: false, tab: 'all' };
  const TAB_NONE = '_none';
  const isDone = (it) => it.status === 'done';
  const timeAgo = (iso) => {
    const min = Math.round((Date.now() - new Date(iso).getTime()) / 60000);
    if (min < 1) return 'עכשיו';
    if (min < 60) return `לפני ${min} דק׳`;
    const h = Math.round(min / 60);
    return h < 24 ? `לפני ${h} שע׳` : `לפני ${Math.round(h / 24)} ימים`;
  };
  /** Urgency bucket of an open row: overdue · today/tomorrow · this week · later · no date. */
  const bucketOf = (r) => {
    if (!r.due) return 'nodate';
    const n = u.daysUntil(r.due);
    return n < 0 ? 'overdue' : n <= 1 ? 'soon' : n <= 7 ? 'week' : 'later';
  };
  const BUCKETS = [
    ['overdue', '🔴 באיחור'], ['soon', '⏰ היום ומחר'], ['week', '📅 בשבוע הקרוב'], ['later', 'בהמשך'], ['nodate', 'בלי תאריך'],
  ];
  const sortKey = (r) => `${r.due || '9999-99-99'} ${r.time || '99:99'}`;

  /** Every synced event with a course, as page rows. Items on a course page have a V; sessions (תרגולים, הרצאות)
   *  are calendar entries — no V, and once they are past they count as done. Unclassified events stay open. */
  function collect() {
    const st = S.state;
    const fresh = freshUids();
    const out = [];
    Mo.records(st).forEach((rec, uid) => {
      if (rec.where === 'inbox') return;
      if (rec.where === 'item') {
        if (rec.course.archived) return;
        const s = rec.item.source;
        const cls = s.cls !== undefined ? s.cls : Mo.classify(st, s).cls;
        out.push({ uid, kind: 'item', item: rec.item, course: rec.course, cls, src: s, title: rec.item.title, due: rec.item.due, time: s.dueTime, link: rec.item.link, done: isDone(rec.item), isNew: fresh.has(uid) });
        return;
      }
      const e = rec.entry;
      const course = S.course(e.courseId);
      if (!course || course.archived) return;
      const session = !!Mo.classById(st, e.cls);
      out.push({ uid, kind: 'event', entry: e, course, cls: e.cls, src: e, title: e.title, due: e.due, time: e.dueTime, link: e.url, session, done: session && !!e.due && e.due < u.today(), isNew: fresh.has(uid) });
    });
    return out;
  }

  const clsOptions = (sel) => [...mo().classes.map((c) => [c.id, c.name]), ['', Mo.UNCLASSIFIED]]
    .map(([id, n]) => `<option value="${esc(id)}"${id === (sel || '') ? ' selected' : ''}>${esc(n)}</option>`).join('');
  const isManual = (src) => Object.prototype.hasOwnProperty.call(mo().classMap, Mo.patternKey(src.category, src.title));

  function pageRow(r) {
    const { course } = r;
    const n = r.due ? u.daysUntil(r.due) : null;
    const cl = r.done ? 'done' : n == null ? '' : n < 0 && !r.session ? 'overdue' : n >= 0 && n <= 1 ? 'soon' : '';
    const when = r.due ? `${u.fmtDateFull(r.due)}${r.time ? ` · ${r.time}` : ''}` : 'בלי תאריך';
    const mark = r.kind === 'item'
      ? `<button class="check check-sm" role="checkbox" aria-checked="${r.done}" data-action="mm-toggle" aria-label="${r.done ? 'בטל סימון' : 'סמן שהגשתי'}: ${esc(r.title)}">${icon.check}</button>`
      : `<span class="mm-dot${r.session ? '' : ' mm-dot-q'}" title="${r.session ? 'אירוע בלוח של מודל — אין מה לסמן' : 'לא סווג — בחר קטגוריה'}">${r.session ? '•' : '?'}</span>`;
    const href = r.kind === 'item' ? `#/course/${course.id}?item=${r.item.id}` : `#/course/${course.id}`;
    const tags = [
      r.isNew && r.kind === 'event' && '<span class="pill mm-new">חדש</span>', // items get it from V.badges
      isManual(r.src) && '<span class="tag" title="סיווג שבחרת — נשמר גם לאירועים דומים ולא נדרס בסנכרון">✋ ידני</span>',
      r.kind === 'item' ? V.badges(r.item).replace(/<span class="tag moodle-tag"[^>]*>[^<]*<\/span>/, '') : (r.entry.gone ? '<span class="tag moodle-alert">לא מופיע יותר במודל</span>' : ''),
    ].filter(Boolean).join('');
    return `<li class="${cl}" style="--c:${esc(course.color)}" data-id="${r.kind === 'item' ? esc(r.item.id) : ''}" data-uid="${esc(r.uid)}">
      ${mark}
      <a href="${href}" class="u-title"><span dir="auto">${esc(r.title)}</span>
        <span class="muted small">${ui.courseDot(course)} ${esc(course.name)} · ${esc(when)}${r.done && r.kind === 'item' ? ' · <b>סימנתי שהגשתי</b>' : ''}</span>
        <span class="mm-tags">${tags}</span></a>
      <select class="chip-select mm-cls" data-mm-cls aria-label="קטגוריה של ${esc(r.title)}" title="קטגוריה (הבחירה נשמרת גם לאירועים דומים)">${clsOptions(r.cls)}</select>
      <span class="u-when">${r.done ? (r.kind === 'item' ? '✓' : '') : r.due ? u.relDays(r.due) : ''}</span>
      ${r.link ? `<a class="icon-btn" href="${esc(r.link)}" target="_blank" rel="noopener noreferrer" title="פתח במודל" aria-label="פתח במודל">${icon.link}</a>` : ''}
    </li>`;
  }

  V.render = (root) => {
    const m = mo();
    const cloud = C();
    const connected = cloud && cloud.enabled && cloud.signedIn() && hasFlag();
    const all = collect();
    const courses = [...new Map(all.map(({ course }) => [course.id, course])).values()].sort((a, b) => a.name.localeCompare(b.name, 'he'));
    if (page.course && !courses.some((c) => c.id === page.course)) page.course = '';
    const hidden = new Set(m.classes.filter((c) => c.hidden).map((c) => c.id));
    if (page.tab !== 'all' && page.tab !== TAB_NONE && (!Mo.classById(S.state, page.tab) || hidden.has(page.tab))) page.tab = 'all';
    const inTab = (r, tab) => {
      if (tab === TAB_NONE) return !r.cls;
      if (tab !== 'all') return r.cls === tab;
      const c = Mo.classById(S.state, r.cls);
      return !c || (c.inAll && !c.hidden);
    };
    const byCourse = all.filter(({ course }) => !page.course || course.id === page.course);
    const openIn = (tab) => byCourse.filter((r) => !r.done && inTab(r, tab)).length;
    const shown = byCourse.filter((r) => inTab(r, page.tab));
    const open = shown.filter((r) => !r.done).sort((a, b) => sortKey(a).localeCompare(sortKey(b)));
    const done = shown.filter((r) => r.done).sort((a, b) => sortKey(b).localeCompare(sortKey(a)));
    const overdueN = open.filter((r) => !r.session && bucketOf(r) === 'overdue').length;
    const noneN = openIn(TAB_NONE);
    if (connected && feed.state === 'unknown') setTimeout(loadFeed, 0);
    const last = m.last;
    const lastAt = [m.serverAt, m.lastLink, last && last.at].filter(Boolean).sort().pop();
    const counts = last ? [last.added && `<b>${last.added}</b> חדשות`, last.listed && `${last.listed} אירועים חדשים`, last.updated && `<b>${last.updated}</b> עודכנו`, last.gone && `${last.gone} לא מופיעות יותר`].filter(Boolean).join(' · ') : '';
    const status = `<p class="small mm-status">${lastAt ? `עודכן לאחרונה: <b>${esc(fmtWhen(lastAt))}</b> <span class="muted">(${esc(timeAgo(lastAt))}${last && last.source === 'file' && !m.lastLink ? ', מקובץ' : ''})</span>${counts ? ` · ברענון האחרון: ${counts}` : last ? ' · ברענון האחרון: אין שינויים' : ''}` : 'עוד לא עודכן ממודל.'}
      ${busy === 'auto' ? ' · <span class="muted">מרענן ברקע…</span>' : ''}
      ${connected ? `<br><span class="muted">רענון אוטומטי בשרת כל שעתיים${m.serverCheckedAt ? ` · בדיקה אחרונה ${esc(timeAgo(m.serverCheckedAt))}` : ' · עוד לא פעיל (צריך להריץ את supabase/moodle.sql)'}</span>` : ''}</p>`;
    const err = m.linkError ? `<p class="small moodle-error" role="alert">⚠️ ${esc(m.linkError.message)} <a href="#/settings" data-action="mm-settings">להגדרות</a></p>` : '';
    const how = connected ? '' : `<div class="card mm-connect"><p class="small">${cloud && cloud.enabled && cloud.signedIn()
      ? 'עוד לא חיברת קישור לוח שנה של מודל. <a href="#/settings" data-action="mm-settings">לחיבור בהגדרות</a> — או ייבא קובץ ‎.ics‎ ידנית.'
      : 'רענון אוטומטי דורש חשבון באתר וקישור לוח שנה של מודל (בהגדרות). בלי זה — ייבוא קובץ ‎.ics‎ ידני עובד תמיד.'}</p>
      <button class="btn" data-action="mm-import">${icon.upload} ייבוא קובץ ‎.ics‎</button></div>`;
    const tabs = [['all', 'הכל'], ...m.classes.filter((c) => !c.hidden).map((c) => [c.id, c.name]), ...(noneN || page.tab === TAB_NONE ? [[TAB_NONE, Mo.UNCLASSIFIED]] : [])];
    const tabsHTML = `<div class="mm-tabs" role="tablist" aria-label="קטגוריות">${tabs.map(([id, name]) => {
      const n = openIn(id);
      return `<button role="tab" class="mm-tab${id === page.tab ? ' active' : ''}${id === TAB_NONE ? ' mm-tab-none' : ''}" aria-selected="${id === page.tab}" data-action="mm-tab" data-tab="${esc(id)}">${esc(name)}${n ? ` <span class="mm-count">${n}</span>` : ''}</button>`;
    }).join('')}</div>`;
    const groups = BUCKETS.map(([k, label]) => {
      const rows = open.filter((r) => bucketOf(r) === k && !(k === 'overdue' && r.session));
      return rows.length ? `<section class="card mm-group mm-${k}"><h2>${label} <span class="muted small">(${rows.length})</span></h2><ul class="urgent-list mm-list">${rows.map(pageRow).join('')}</ul></section>` : '';
    }).join('');
    const doneBox = page.showDone && done.length ? `<section class="card mm-group mm-done"><h2>✓ הוגש או עבר <span class="muted small">(${done.length})</span></h2>
      <p class="small muted">הסימון V הוא שלך — לוח השנה של מודל לא מוסר סטטוס הגשה. תרגולים והרצאות שעברו מופיעים כאן.</p><ul class="urgent-list mm-list">${done.map(pageRow).join('')}</ul></section>` : '';
    const tabName = page.tab === 'all' ? '' : page.tab === TAB_NONE ? Mo.UNCLASSIFIED : Mo.className(S.state, page.tab);
    const empty = all.length ? ui.empty(`אין פריטים פתוחים${tabName ? ` ב„${esc(tabName)}”` : ''}${page.course ? ' בקורס הזה' : ''}. 🎉`) : ui.empty('עוד אין מטלות ממודל.');
    root.innerHTML = `<div class="mymoodle">
      <div class="section-head">
        <h1>המודל שלי</h1>
        <div class="toolbar-actions">
          ${connected ? `<button class="btn btn-primary" data-action="mm-refresh"${busy ? ' disabled' : ''}>${icon.undo}<span>${busy === 'sync' ? 'מרענן…' : 'רענן עכשיו'}</span></button>` : ''}
          <a class="btn btn-ghost" href="#/settings" data-action="mm-settings">${icon.gear}<span>הגדרות</span></a>
        </div>
      </div>
      ${status}${err}${how}${connected ? V.rangeHTML() : ''}
      ${changesHTML()}
      ${m.inbox.length ? `<p class="small moodle-error">${m.inbox.length} מטלות לא שויכו לקורס. <button class="btn btn-small" data-action="mm-inbox">לשיוך</button></p>` : ''}
      ${noneN && page.tab !== TAB_NONE ? `<p class="small mm-unclassified">❔ ${noneN === 1 ? 'אירוע אחד לא סווג' : `${noneN} אירועים לא סווגו`} בביטחון — בחר קטגוריה, והבחירה תישמר גם לאירועים דומים. <button class="btn btn-small" data-action="mm-tab" data-tab="${TAB_NONE}">לסיווג</button></p>` : ''}
      ${tabsHTML}
      <div class="mm-filters">
        <label class="small">קורס: <select data-mm="course" class="chip-select"><option value="">כל הקורסים</option>${courses.map((c) => `<option value="${esc(c.id)}"${c.id === page.course ? ' selected' : ''}>${esc(c.name)}</option>`).join('')}</select></label>
        <label class="small"><input type="checkbox" data-mm="done"${page.showDone ? ' checked' : ''}> הצג גם מה שהוגש או עבר (${done.length})</label>
        <span class="small muted">${open.length} פתוחים${overdueN ? ` · <b class="mm-overdue-n">${overdueN} באיחור</b>` : ''}</span>
        <a href="#/settings" class="small" data-action="mm-classes">ניהול קטגוריות</a>
      </div>
      ${groups || empty}
      ${doneBox}
    </div>`;
    const box = root.querySelector('.mymoodle');
    box.addEventListener('click', onPageClick);
    box.addEventListener('change', (e) => {
      if (e.target.matches('[data-mm-cls]')) { pickClass(e.target.closest('[data-uid]').dataset.uid, e.target.value); return; }
      const k = e.target.dataset.mm;
      if (k === 'course') page.course = e.target.value;
      if (k === 'done') page.showDone = e.target.checked;
      if (k) CT.app.rerender();
    });
  };

  /** Your class for an event (from the row's select): remembered for similar events, applied now. */
  function pickClass(uid, cls) {
    const before = Mo.records(S.state).get(uid);
    if (!before) return;
    const n = S.commit('סיווג אירוע ממודל', (st) => Mo.setClass(st, uid, cls, mergeOpts()));
    const name = Mo.className(S.state, cls);
    const def = Mo.classById(S.state, cls);
    const where = def && def.toCourse ? ` (בדף הקורס: „${def.courseCat || def.name}”)` : '';
    ui.toast(`סווג כ„${name}”${where}${n > 1 ? ` · גם ${n - 1} אירועים דומים` : ''} — נשמר לסנכרונים הבאים`, { action: { label: 'בטל', fn: S.undo } });
  }

  const KIND = { new: '🆕 חדשה', changed: '✏️ השתנתה', gone: '👻 לא מופיעה יותר במודל', restored: '↩️ חזרה למודל' };
  function changesHTML() {
    const list = mo().changes || [];
    if (!list.length) return '';
    const n = Mo.unseen(S.state);
    const rows = list.slice(0, 30).map((c) => {
      const course = c.course && S.course(c.course);
      const due = c.due ? `${u.fmtDateFull(c.due)}${c.dueTime ? ` ${c.dueTime}` : ''}` : 'בלי תאריך';
      const prev = c.kind === 'changed' && (c.prevDue !== c.due || (c.prevTime || '') !== (c.dueTime || ''))
        ? ` <span class="muted">(היה ${esc(c.prevDue ? `${u.fmtDateFull(c.prevDue)}${c.prevTime ? ` ${c.prevTime}` : ''}` : 'בלי תאריך')})</span>` : '';
      const renamed = c.kind === 'changed' && c.prevTitle && c.prevTitle !== c.title ? ` <span class="muted">(היה „${esc(c.prevTitle)}”)</span>` : '';
      return `<li class="${c.seen ? '' : 'unseen'}"><span class="mm-kind">${KIND[c.kind] || ''}</span>
        <span dir="auto">${esc(c.title)}</span>${renamed} · ${esc(due)}${prev}
        <span class="muted small"> · ${course ? esc(course.name) : c.unassigned ? 'לא משויך' : ''} · ${esc(timeAgo(c.at))}</span></li>`;
    }).join('');
    return `<details class="card mm-changes"${n.total ? ' open' : ''}><summary><b>מה השתנה</b> ${n.total ? `<span class="pill">${n.total} חדש</span>` : `<span class="muted small">(${list.length})</span>`}</summary>
      ${n.total ? `<p class="small">${esc(Mo.unseenText(n))}. <button class="btn btn-small" data-action="mm-seen">סמן שראיתי</button></p>` : ''}
      <ul class="mm-change-list small">${rows}</ul>
      <p class="small muted">מטלה שנעלמה ממודל לא נמחקת — היא מסומנת "לא מופיעה יותר במודל" ואתה מחליט מה לעשות בה.</p></details>`;
  }

  function onPageClick(e) {
    const a = e.target.closest('[data-action]');
    if (!a) return;
    const act = a.dataset.action;
    if (act === 'mm-settings') { e.preventDefault(); V.showSettings(); return; }
    if (!act.startsWith('mm-') && !act.startsWith('moodle-')) return;
    e.preventDefault();
    const id = a.closest('[data-id]') && a.closest('[data-id]').dataset.id;
    if (act === 'mm-refresh') V.syncLink({ manual: true, inline: true });
    else if (act === 'mm-import') V.pickFile();
    else if (act === 'mm-inbox') V.showInbox();
    else if (act === 'mm-seen') V.markSeen();
    else if (act === 'mm-tab') { page.tab = a.dataset.tab; CT.app.rerender(); }
    else if (act === 'mm-classes') { classesOpen = true; V.showSettings('moodle-classes'); }
    else if (act === 'mm-toggle') {
      const was = isDone(S.findItem(id).item);
      S.toggleDone(id);
      ui.toast(was ? 'הסימון בוטל' : 'סומן שהגשת ✓', { action: { label: 'בטל', fn: S.undo } });
    } else if (/^moodle-(changed|gone|merge)$/.test(act)) V.rowAction(act, id, a);
  }

  /** Go to the Moodle card in settings. */
  V.showSettings = (id = 'moodle') => {
    const go = () => { const el = document.getElementById(id); if (el) el.scrollIntoView({ block: 'start' }); };
    if (location.hash !== '#/settings') { location.hash = '#/settings'; setTimeout(go, 60); } else go();
  };

  /** Go to the settings card and scroll to the "לא משויך" list. */
  V.showInbox = () => {
    const go = () => { const el = document.getElementById('moodle'); if (el) el.scrollIntoView({ block: 'start' }); };
    if (location.hash !== '#/settings') { location.hash = '#/settings'; setTimeout(go, 60); } else go();
  };
})(window.CT);
