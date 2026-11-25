/* views/settings.js — backup & restore, semesters, default template, theme, data reset. */
(function (CT) {
  'use strict';
  const { u, ui } = CT;
  const S = CT.store, M = CT.model;
  const esc = u.esc, icon = u.icon;
  const V = {};
  CT.views = CT.views || {};
  CT.views.settings = V;

  V.render = (root) => {
    const st = S.state;
    const b = CT.backup;
    const last = st.settings.lastBackup;
    const autoState = !b.supported
      ? '<p class="muted">הדפדפן הזה לא תומך בשמירה אוטומטית לקובץ (נתמך ב-Chrome וב-Edge במחשב). השתמש בייצוא ידני.</p>'
      : b.status === 'granted'
        ? `<p>✅ פעיל — כל שינוי נשמר תוך 2 שניות לקובץ <b dir="ltr">${esc(b.handle && b.handle.name)}</b>.</p>
           <button class="btn" data-action="disconnect">הפסק שמירה אוטומטית</button>`
        : b.status === 'needs-permission'
          ? `<p>⏸️ מחובר לקובץ <b dir="ltr">${esc(b.handle && b.handle.name)}</b>, אבל הדפדפן מבקש אישור מחדש אחרי כל פתיחה.</p>
             <button class="btn btn-primary" data-action="regrant">אשר גישה</button> <button class="btn" data-action="disconnect">נתק</button>`
          : `<p class="muted">בחר קובץ (מומלץ בתוך תיקיית OneDrive) והמערכת תשמור אליו עותק אוטומטית בכל שינוי.</p>
             <button class="btn btn-primary" data-action="connect">${icon.download} בחר קובץ לשמירה אוטומטית</button>`;
    const counts = st.courses.reduce((a, c) => { a[c.semesterId] = (a[c.semesterId] || 0) + 1; return a; }, {});

    root.innerHTML = `
      <div class="settings">
        <h1>הגדרות</h1>
        ${syncSection()}

        <section class="card">
          <h2>💾 גיבוי ושחזור</h2>
          <p>הנתונים נשמרים בדפדפן הזה בלבד. גיבוי אחרון: <b>${last ? `${u.fmtDateFull(u.isoDate(new Date(last)))} (${u.relDays(u.isoDate(new Date(last))).replace('אתמול (באיחור)', 'אתמול').replace(/באיחור (\d+) ימים/, 'לפני $1 ימים')})` : 'אף פעם'}</b></p>
          <div class="btn-row">
            <button class="btn btn-primary" data-action="export">${icon.download} ייצוא גיבוי (JSON)</button>
            <button class="btn" data-action="import">${icon.upload} ייבוא גיבוי</button>
          </div>
          <h3>שמירה אוטומטית לקובץ</h3>
          ${autoState}
        </section>

        ${catalogSection()}

        <section class="card">
          <h2>📅 סמסטרים</h2>
          <p class="muted">תאריכי ההתחלה והסיום משמשים לחישוב "קצב צפוי" בסטטיסטיקות. הסמסטר המסומן הוא ברירת המחדל לקורסים חדשים.</p>
          <div class="sem-list">
            ${st.semesters.map((s) => `
              <div class="sem-row" data-id="${s.id}">
                <label class="radio" title="סמסטר ברירת מחדל"><input type="radio" name="active" ${s.id === st.settings.activeSemesterId ? 'checked' : ''} aria-label="סמסטר נוכחי"></label>
                <input name="name" dir="auto" value="${esc(s.name)}" aria-label="שם הסמסטר">
                <label class="field-inline">התחלה <input type="date" name="start" value="${esc(s.start)}"></label>
                <label class="field-inline">סיום לימודים <input type="date" name="end" value="${esc(s.end)}"></label>
                <label class="field-inline">תחילת מבחנים <input type="date" name="examStart" value="${esc(s.examStart || '')}"></label>
                <span class="muted small">${counts[s.id] || 0} קורסים</span>
                <button class="icon-btn" data-action="del-sem" aria-label="מחק סמסטר" ${counts[s.id] ? 'disabled title="יש קורסים בסמסטר"' : ''}>${icon.trash}</button>
              </div>`).join('')}
          </div>
          <button class="btn btn-ghost" data-action="add-sem">${icon.plus} סמסטר</button>
        </section>

        <section class="card">
          <h2>🧩 תבנית ברירת מחדל לקורס חדש</h2>
          <div class="tpl-head muted"><span>קטגוריה</span><span>כמות</span><span>תבנית שם</span><span></span></div>
          <div class="tpl-rows">${st.settings.template.map((t, i) => `
            <div class="tpl-row" data-i="${i}">
              <input name="name" dir="auto" value="${esc(t.name)}" aria-label="שם קטגוריה">
              <input name="count" type="number" min="0" value="${esc(t.count)}" aria-label="כמות">
              <input name="pattern" dir="auto" value="${esc(t.pattern)}" aria-label="תבנית שם">
              <button class="icon-btn" data-action="del-tpl" aria-label="הסר">${icon.trash}</button>
            </div>`).join('')}</div>
          <button class="btn btn-ghost" data-action="add-tpl">${icon.plus} שורה</button>
          <button class="btn btn-ghost" data-action="reset-tpl">אפס לברירת המחדל</button>
        </section>

        <section class="card">
          <h2>🎨 תצוגה ופומודורו</h2>
          <div class="form-grid">
            <label class="field"><span>ערכת צבעים</span>
              <select data-action="theme">
                ${[['auto', 'לפי המערכת'], ['light', 'בהיר'], ['dark', 'כהה']].map(([k, l]) => `<option value="${k}" ${CT.app.theme() === k ? 'selected' : ''}>${l}</option>`).join('')}
              </select></label>
            <label class="field"><span>פומודורו — דקות עבודה</span><input type="number" min="5" max="120" name="work" value="${st.settings.pomodoro.work}"></label>
            <label class="field"><span>פומודורו — דקות הפסקה</span><input type="number" min="1" max="60" name="brk" value="${st.settings.pomodoro.brk}"></label>
          </div>
          <button class="btn" data-action="help">${icon.keyboard} קיצורי מקלדת</button>
        </section>

        <section class="card">
          <h2>🧹 נתונים</h2>
          <div class="btn-row">
            <button class="btn btn-danger" data-action="reset">מחק הכול והתחל מחדש</button>
          </div>
        </section>
      </div>`;

    const el = root.querySelector('.settings');
    el.addEventListener('click', onClick);
    el.addEventListener('change', onChange);
    const form = el.querySelector('.login-form');
    if (form) form.addEventListener('submit', (e) => { e.preventDefault(); login('in', form); });
  };

  /* ---------- cloud sync panel ---------- */
  function syncSection() {
    const C = CT.cloud;
    if (!C || !C.enabled) {
      return `<section class="card"><h2>☁️ סנכרון בין מכשירים</h2>
        <p class="muted">הסנכרון עוד לא הוגדר — המערכת עובדת מקומית בלבד. להפעלה ממלאים את פרטי Supabase בקובץ <code dir="ltr">js/config.js</code> (ההוראות ב-README).</p></section>`;
    }
    const [cls, text] = C.label();
    if (!C.signedIn()) {
      return `<section class="card sync-card">
        <h2>☁️ סנכרון בין מכשירים</h2>
        <p>התחבר כדי שהנתונים יסונכרנו בין המחשב לטלפון.${C.error ? ` <span class="warn-line">${esc(C.error)}</span>` : ''}</p>
        <form class="login-form" autocomplete="on">
          <label class="field"><span>אימייל</span><input type="email" name="email" dir="ltr" autocomplete="email" required></label>
          <label class="field"><span>סיסמה</span><input type="password" name="password" dir="ltr" autocomplete="current-password" minlength="6" required></label>
          <div class="btn-row">
            <button class="btn btn-primary" type="submit">התחבר</button>
            <button class="btn" type="button" data-action="signup">הרשמה (פעם ראשונה)</button>
          </div>
          <p class="login-msg muted small" aria-live="polite"></p>
        </form>
      </section>`;
    }
    return `<section class="card sync-card">
      <h2>☁️ סנכרון בין מכשירים</h2>
      <p class="sync-state"><span class="sync-dot ${cls || 'warn'}"></span><b>${esc(text)}</b>
        ${C.lastSync ? `<span class="muted small">· לאחרונה ${C.lastSync.toLocaleTimeString('he-IL', { hour: '2-digit', minute: '2-digit' })}</span>` : ''}</p>
      ${C.error ? `<p class="warn-line">${esc(C.error)}</p>` : ''}
      <p class="muted">מחובר כ-<b dir="ltr">${esc(C.email())}</b>. כל שינוי נשמר בענן תוך שניות, ושינויים ממכשיר אחר מופיעים כאן תוך כחצי דקה.</p>
      <div class="btn-row">
        <button class="btn" data-action="sync-now">סנכרן עכשיו</button>
        <button class="btn btn-ghost" data-action="sign-out">התנתק</button>
      </div>
    </section>`;
  }

  async function login(mode, form) {
    const email = form.querySelector('[name=email]').value.trim();
    const pass = form.querySelector('[name=password]').value;
    const msg = form.querySelector('.login-msg');
    if (!email || pass.length < 6) { msg.textContent = 'צריך אימייל וסיסמה של 6 תווים לפחות'; return; }
    msg.textContent = mode === 'up' ? 'נרשם…' : 'מתחבר…';
    form.querySelectorAll('button').forEach((b) => { b.disabled = true; });
    try {
      if (mode === 'up') {
        const r = await CT.cloud.signUp(email, pass);
        if (r === 'confirm-email') {
          msg.textContent = '✉️ נשלח מייל אישור. לחץ על הקישור במייל, ואז חזור לכאן ולחץ "התחבר".';
          form.querySelectorAll('button').forEach((b) => { b.disabled = false; });
          return;
        }
      } else {
        await CT.cloud.signIn(email, pass);
      }
      ui.toast('מחובר — הסנכרון פעיל');
      CT.app.rerender();
    } catch (e) {
      msg.textContent = CT.cloud.heMsg(e);
      form.querySelectorAll('button').forEach((b) => { b.disabled = false; });
    }
  }

  async function onClick(e) {
    const a = e.target.closest('[data-action]');
    if (!a) return;
    const semId = a.closest('.sem-row') && a.closest('.sem-row').dataset.id;
    switch (a.dataset.action) {
      case 'signup': login('up', a.closest('form')); break;
      case 'sync-now': CT.cloud.syncNow(); break;
      case 'sign-out':
        if (!(await ui.confirm('להתנתק מהסנכרון במכשיר הזה? הנתונים נשארים גם כאן וגם בענן.', 'התנתק'))) return;
        await CT.cloud.signOut();
        CT.app.rerender();
        break;
      case 'export': CT.backup.exportFile(); break;
      case 'import': CT.backup.pickImport(); break;
      case 'connect': CT.backup.connect(); break;
      case 'regrant': CT.backup.regrant(); break;
      case 'disconnect': CT.backup.disconnect(); break;
      case 'add-sem': S.commit('הוספת סמסטר', (st) => st.semesters.push(M.newSemester())); break;
      case 'del-sem': S.commit('מחיקת סמסטר', (st) => { st.semesters = st.semesters.filter((s) => s.id !== semId); }); break;
      case 'add-tpl': S.commit('עריכת תבנית', (st) => st.settings.template.push({ name: '', count: 13, pattern: '{n}' })); break;
      case 'del-tpl': S.commit('עריכת תבנית', (st) => st.settings.template.splice(Number(a.closest('.tpl-row').dataset.i), 1)); break;
      case 'reset-tpl': S.commit('איפוס תבנית', (st) => { st.settings.template = JSON.parse(JSON.stringify(M.DEFAULT_TEMPLATE)); }); break;
      case 'help': CT.app.showHelp(); break;
      case 'reset':
        if (!(await ui.confirm('למחוק את כל הנתונים ולהתחיל מאפס?\nמומלץ לייצא גיבוי קודם. אפשר לבטל מיד עם Ctrl+Z.', 'מחק הכול', true))) return;
        S.replace(M.emptyState(), 'מחיקת כל הנתונים');
        S.commit('', (st) => { const sem = M.newSemester({ name: 'סמסטר נוכחי' }); st.semesters.push(sem); st.settings.activeSemesterId = sem.id; }, { undo: false });
        break;
      default: break;
    }
  }

  function catalogSection() {
    const C = CT.views.catalog;
    C.load();
    return `<section class="card">
      <h2>📘 תכנית לימודים</h2>
      <p class="small">שנת הקטלוג שלך היא בדרך כלל השנה שבה התחלת את התואר. הקטלוגים לא נדרסים — כל שנה נשמרת בנפרד.</p>
      <div class="btn-row"><label class="small">פקולטה: <b>${esc(CT.catalog.FACULTIES.ee)}</b>, מסלול הנדסת חשמל</label>
        <label class="small">שנת קטלוג: ${C.yearPicker()}</label></div>
      ${C.sourceHTML()}
    </section>`;
  }

  function onChange(e) {
    const t = e.target;
    if (t.matches('[data-action=cat-year]')) { CT.views.catalog.setYear(t.value); return; }
    const sem = t.closest('.sem-row');
    if (sem) {
      const id = sem.dataset.id;
      if (t.type === 'radio') S.commit('סמסטר נוכחי', (st) => { st.settings.activeSemesterId = id; });
      else S.commit('עריכת סמסטר', (st) => { st.semesters.find((s) => s.id === id)[t.name] = t.value.trim(); });
      return;
    }
    const tpl = t.closest('.tpl-row');
    if (tpl) {
      S.commit('עריכת תבנית', (st) => {
        const row = st.settings.template[Number(tpl.dataset.i)];
        row[t.name] = t.name === 'count' ? (parseInt(t.value, 10) || 0) : t.value;
      });
      return;
    }
    if (t.matches('[data-action=theme]')) CT.app.setTheme(t.value);
    if (t.name === 'work' || t.name === 'brk') {
      S.commit('הגדרות פומודורו', (st) => { st.settings.pomodoro[t.name] = Math.max(1, parseInt(t.value, 10) || 1); });
    }
  }
})(window.CT);
