/* views/dashboard.js — home: backup banners, "what's urgent", exam countdowns, today's classes, course cards. */
(function (CT) {
  'use strict';
  const { u, ui, stats } = CT;
  const S = CT.store;
  const esc = u.esc, icon = u.icon;
  const V = {};
  CT.views = CT.views || {};
  CT.views.dashboard = V;

  V.render = (root) => {
    const st = S.state;
    const courses = S.activeCourses();
    const urgent = stats.urgent(courses, 7);
    const exams = stats.upcomingExams(courses).slice(0, 6);
    const weekDone = stats.completedSince(courses, u.weekStart()).length;
    const streak = stats.streak(st);

    root.innerHTML = `
      <div class="dash">
        ${bannersHTML()}
        ${heroHTML(courses, urgent, weekDone, streak)}
        <div class="dash-top">
          <section class="card urgent" aria-labelledby="urgent-h">
            <h2 id="urgent-h">🔥 מה דחוף <span class="muted small">(7 הימים הקרובים)</span></h2>
            ${urgent.length ? `<ul class="urgent-list">${urgent.map(urgentRow).join('')}</ul>` : '<p class="muted">אין מטלות עם תאריך יעד בשבוע הקרוב. 🎉</p>'}
          </section>
          <div class="dash-side">
            ${exams.length ? `<section class="card" aria-labelledby="exams-h">
              <h2 id="exams-h">⏳ ספירה לאחור</h2>
              <ul class="countdown">${exams.map(({ exam, course }) => {
                const n = u.daysUntil(exam.date);
                return `<li style="--c:${esc(course.color)}">
                  <span class="cd-num">${n === 0 ? 'היום' : `${n}<small>${n === 1 ? 'יום' : 'ימים'}</small>`}</span>
                  <span class="cd-text"><a href="#/course/${course.id}" dir="auto">${esc(course.name)}</a>
                  <span class="muted small">${esc(exam.label || 'מבחן')} · ${u.fmtDateFull(exam.date)}</span></span></li>`;
              }).join('')}</ul>
            </section>` : ''}
            ${CT.views.schedule ? CT.views.schedule.nowNextHTML() : ''}
          </div>
        </div>

        <div class="section-head">
          <h2>הקורסים שלי</h2>
          <div class="toolbar-actions">
            <button class="btn btn-primary" data-action="new-course">${icon.plus}<span>קורס חדש</span></button>
          </div>
        </div>
        <div class="course-grid">
          ${courses.map(cardHTML).join('') || ui.empty('אין קורסים פעילים. <button class="btn btn-primary" data-action="new-course">הוסף קורס</button>')}
        </div>
      </div>`;

    root.querySelector('.dash').addEventListener('click', onClick);
    // nothing in the side column yet (no exams / classes) → let "what's urgent" use the full width
    if (!root.querySelector('.dash-side').children.length) root.querySelector('.dash-top').classList.add('solo');
  };

  function bannersHTML() {
    const b = CT.backup;
    const out = [];
    const C = CT.cloud;
    if (C && C.enabled && !C.signedIn()) {
      out.push(`<div class="banner banner-info" role="status">☁️ התחבר כדי לסנכרן בין המחשב לטלפון.
        <a class="btn btn-small btn-primary" href="#/settings">להתחברות</a></div>`);
    } else if (C && C.status === 'conflict') {
      out.push(`<div class="banner banner-warn" role="status">⚠️ הנתונים השתנו בשני מכשירים ועדיין לא נבחרה גרסה.
        <button class="btn btn-small btn-primary" data-action="sync-now">פתור עכשיו</button></div>`);
    }
    if (b.status === 'needs-permission') {
      out.push(`<div class="banner banner-info" role="status">💾 השמירה האוטומטית לקובץ ממתינה לאישור הדפדפן.
        <button class="btn btn-small btn-primary" data-action="regrant">אשר גישה לקובץ</button></div>`);
    } else if (b.needsReminder()) {
      const d = b.daysSinceBackup();
      out.push(`<div class="banner banner-warn" role="status">🗂️ ${d == null ? 'עוד לא גיבית את הנתונים.' : `עברו ${d} ימים מאז הגיבוי האחרון.`} כדאי לייצא גיבוי (לוקח שנייה).
        <span class="banner-actions"><button class="btn btn-small btn-primary" data-action="export">ייצא גיבוי</button>
        <button class="btn btn-small btn-ghost" data-action="snooze">אחר כך</button></span></div>`);
    }
    return out.join('');
  }

  const greeting = () => {
    const h = new Date().getHours();
    return h < 5 ? 'לילה טוב' : h < 12 ? 'בוקר טוב' : h < 17 ? 'צהריים טובים' : h < 21 ? 'ערב טוב' : 'לילה טוב';
  };

  /** Top banner: greeting, date, semester week progress and four summary tiles. */
  function heroHTML(courses, urgent, weekDone, streak) {
    const st = S.state;
    const dateStr = new Intl.DateTimeFormat('he-IL', { weekday: 'long', day: 'numeric', month: 'long' }).format(new Date());
    const overdue = urgent.filter((x) => x.item.due < u.today()).length;
    const soon = urgent.length - overdue;
    const sub = !courses.length ? 'בוא נתחיל — הוסף את הקורס הראשון.'
      : overdue ? `יש ${overdue === 1 ? 'מטלה אחת' : `${overdue} מטלות`} באיחור${soon ? ` ועוד ${soon} השבוע` : ''}. אפשר לסגור את זה היום 💪`
        : soon ? `${soon === 1 ? 'מטלה אחת' : `${soon} מטלות`} עם דדליין בשבוע הקרוב. הכול בשליטה.`
          : 'אין דדליינים השבוע — זמן טוב להשלים הרצאות ותרגולים.';

    const all = courses.flatMap((c) => c.categories.flatMap((cat) => cat.items));
    const tot = stats.progress(all);
    const weekMin = u.sum(st.studyLog.filter((e) => e.date >= u.weekStart()), (e) => e.minutes);

    const sem = S.semester(st.settings.activeSemesterId);
    let semHTML = '';
    if (sem && sem.start && sem.end) {
      const total = u.daysBetween(sem.start, sem.end);
      const passed = u.daysBetween(sem.start, u.today());
      const weeks = Math.ceil((total + 1) / 7);
      const week = u.clamp(Math.floor(passed / 7) + 1, 1, weeks);
      const pct = u.clamp(Math.round((passed / total) * 100), 0, 100);
      const left = u.daysUntil(sem.end);
      const toExams = sem.examStart ? u.daysUntil(sem.examStart) : null;
      const line = passed < 0 ? `הסמסטר מתחיל בעוד ${-passed} ימים`
        : left < 0 ? (toExams != null && toExams >= 0 ? `הלימודים הסתיימו · תקופת המבחנים בעוד ${toExams} ימים` : 'הלימודים הסתיימו — בהצלחה במבחנים! 🍀')
          : `עוד ${left} ימי לימודים${toExams != null ? ` · מבחנים בעוד ${toExams} ימים` : ''}`;
      semHTML = `
        <div class="hero-sem">
          <div class="hero-sem-top"><span>${esc(sem.name)}</span><b>${passed < 0 ? 'טרם התחיל' : `שבוע ${week} מתוך ${weeks}`}</b></div>
          ${ui.bar(pct, 'התקדמות הסמסטר')}
          <span class="hero-sem-line">${line}</span>
        </div>`;
    }

    return `
      <section class="hero">
        <div class="hero-main">
          <div class="hero-text">
            <p class="hero-date">${dateStr}</p>
            <h1>${greeting()} 👋</h1>
            <p class="hero-sub">${sub}</p>
          </div>
          ${semHTML}
        </div>
        <div class="hero-tiles">
          <div class="tile"><span class="tile-ic" aria-hidden="true">🎯</span><b>${tot.pct}%</b><span>התקדמות כוללת</span></div>
          <div class="tile"><span class="tile-ic" aria-hidden="true">✅</span><b>${weekDone}</b><span>הושלמו השבוע</span></div>
          <div class="tile"><span class="tile-ic" aria-hidden="true">${streak.days >= 3 ? '🔥' : '🌱'}</span><b>${streak.days}</b><span>${streak.days === 1 ? 'יום רצף' : 'ימי רצף'}</span></div>
          <div class="tile"><span class="tile-ic" aria-hidden="true">⏱️</span><b>${weekMin ? u.fmtMinutes(weekMin) : '0'}</b><span>לימוד השבוע</span></div>
        </div>
      </section>`;
  }

  function urgentRow({ item, course }) {
    const n = u.daysUntil(item.due);
    return `<li class="${n < 0 ? 'overdue' : n <= 1 ? 'soon' : ''}" style="--c:${esc(course.color)}">
      <button class="check check-sm" role="checkbox" aria-checked="false" data-action="toggle" data-id="${item.id}" aria-label="סמן כהושלם: ${esc(item.title)}">${icon.check}</button>
      <a href="#/course/${course.id}?item=${item.id}" class="u-title"><span dir="auto">${esc(item.title)}</span>
        <span class="muted small">${ui.courseDot(course)} ${esc(course.name)}</span></a>
      <span class="u-when">${u.relDays(item.due)}</span>
    </li>`;
  }

  function cardHTML(c) {
    const p = stats.courseProgress(c);
    const next = stats.nextTask(c);
    const exam = stats.nextExam(c);
    const n = exam && u.daysUntil(exam.date);
    return `
      <a class="card course-card" href="#/course/${c.id}" style="--c:${esc(c.color)}">
        <div class="cc-top">
          <div class="cc-title">
            <h3 dir="auto">${esc(c.name)}</h3>
            <span class="muted small">${[c.number && `<span dir="ltr">${esc(c.number)}</span>`, c.credits && `${esc(c.credits)} נק״ז`].filter(Boolean).join(' · ') || '&nbsp;'}</span>
          </div>
          ${ui.ring(p.pct)}
        </div>
        <div class="cc-meta">
          <span class="cc-chip">${p.open ? `${p.done}/${p.total} הושלמו` : '✓ הכול הושלם'}</span>
          ${exam ? `<span class="cc-chip${n <= 14 ? ' warn' : ''}">⏳ ${n === 0 ? 'מבחן היום' : `${n} ימים ל${esc(exam.label || 'מבחן')}`}</span>` : ''}
        </div>
        <div class="cc-next ${next && next.item.due < u.today() ? 'overdue' : ''}">${next
          ? `<span class="muted">הבא:</span> <span dir="auto">${esc(next.item.title)}</span> · ${u.relDays(next.item.due)}`
          : '<span class="muted">אין דדליינים קרובים</span>'}</div>
      </a>`;
  }

  async function onClick(e) {
    const a = e.target.closest('[data-action]');
    if (!a) return;
    e.preventDefault();
    switch (a.dataset.action) {
      case 'toggle': S.toggleDone(a.dataset.id); ui.toast('סומן כהושלם ✓', { action: { label: 'בטל', fn: S.undo } }); break;
      case 'new-course': CT.views.course.courseForm(); break;
      case 'export': CT.backup.exportFile(); break;
      case 'snooze': CT.backup.snooze(); break;
      case 'regrant': CT.backup.regrant(); break;
      case 'sync-now': CT.cloud.syncNow(); break;
      default: break;
    }
  }

})(window.CT);
