/* views/dashboard.js — "היום": the home screen. What matters now first (the next action, today, what's urgent);
 * notices, exams, classes, the semester and the course cards are one click away. */
(function (CT) {
  'use strict';
  const { u, ui, stats } = CT;
  const S = CT.store;
  const esc = u.esc, icon = u.icon;
  const V = {};
  CT.views = CT.views || {};
  CT.views.dashboard = V;

  const URGENT_SHOWN = 5;
  let pick = 0;               // which suggestion "הפעולה הבאה" shows ("משהו אחר" moves to the next)
  let urgentAll = false;      // "הצג הכל" in the urgent list
  const OPEN_KEY = 'ct.dash.open';
  const openSet = () => { try { return new Set(JSON.parse(localStorage.getItem(OPEN_KEY)) || ['courses']); } catch (e) { return new Set(['courses']); } };
  const saveOpen = (set) => { try { localStorage.setItem(OPEN_KEY, JSON.stringify([...set])); } catch (e) { /* ignore */ } };

  /** Extra cards other modules put on the home screen (the points engine adds its own). Each returns HTML or ''. */
  V.slots = { side: [], top: [] };

  V.render = (root) => {
    const st = S.state;
    const courses = S.activeCourses();
    const urgent = stats.urgent(courses, 7);
    const exams = stats.upcomingExams(courses).slice(0, 6);
    const actions = stats.nextActions(courses);
    const notices = bannersHTML();
    const opened = openSet();
    const nowNext = CT.views.schedule ? CT.views.schedule.nowNextHTML() : '';
    const extraTop = V.slots.top.map((f) => f()).join('');
    const extraSide = V.slots.side.map((f) => f()).join('');

    root.innerHTML = `
      <div class="dash">
        ${headHTML(courses, urgent)}
        ${noticesHTML(notices)}
        ${extraTop}
        <div class="today-grid">
          ${nextHTML(actions)}
          <div class="today-side">${extraSide}${todayHTML(st, courses)}</div>
        </div>
        <section class="card urgent" aria-labelledby="urgent-h">
          <div class="card-head"><h2 id="urgent-h">מה דחוף</h2><span class="muted small">7 הימים הקרובים${urgent.length ? ` · ${urgent.length}` : ''}</span></div>
          ${urgent.length ? `<ul class="urgent-list">${(urgentAll ? urgent : urgent.slice(0, URGENT_SHOWN)).map(urgentRow).join('')}</ul>
            ${urgent.length > URGENT_SHOWN ? `<button class="btn btn-ghost btn-small more-btn" data-action="urgent-all">${urgentAll ? 'הצג פחות' : `הצג את כל ה-${urgent.length}`}</button>` : ''}`
            : `<p class="muted calm">${icon.check} אין מטלות עם תאריך יעד בשבוע הקרוב.</p>`}
        </section>
        ${(exams.length || nowNext) ? moreHTML('soon', '⏳ מבחנים ומערכת', exams.length ? `${exams.length} מבחנים קרובים · הקרוב בעוד ${u.daysUntil(exams[0].exam.date)} ימים` : 'שיעורים היום', opened, `
          <div class="dash-two">
            ${exams.length ? `<section aria-label="ספירה לאחור"><ul class="countdown">${exams.map(({ exam, course }) => {
              const n = u.daysUntil(exam.date);
              return `<li style="--c:${esc(course.color)}">
                <span class="cd-num">${n === 0 ? 'היום' : `${n}<small>${n === 1 ? 'יום' : 'ימים'}</small>`}</span>
                <span class="cd-text"><a href="#/course/${course.id}" dir="auto">${esc(course.name)}</a>
                <span class="muted small">${esc(exam.label || 'מבחן')} · ${u.fmtDateFull(exam.date)}</span></span></li>`;
            }).join('')}</ul></section>` : ''}
            ${nowNext}
          </div>`) : ''}
        ${semesterHTML(courses, opened)}
        ${moreHTML('courses', '📚 הקורסים שלי', `${S.semesterCourses().length} קורסים`, opened, `
          <div class="course-grid">
            ${S.semesterCourses().map(cardHTML).join('') || ui.empty('אין קורסים פעילים. <a class="btn btn-primary" href="#/catalog">בחר מתכנית הלימודים</a> <button class="btn" data-action="new-course">קורס ידני</button>')}
          </div>
          <div class="btn-row"><button class="btn" data-action="new-course">${icon.plus}<span>קורס חדש</span></button></div>`)}
      </div>`;

    const dash = root.querySelector('.dash');
    dash.addEventListener('click', onClick);
    dash.querySelectorAll('details[data-k]').forEach((d) => d.addEventListener('toggle', () => {
      const set = openSet();
      if (d.open) set.add(d.dataset.k); else set.delete(d.dataset.k);
      saveOpen(set);
    }));
  };

  const greeting = () => {
    const h = new Date().getHours();
    return h < 5 ? 'לילה טוב' : h < 12 ? 'בוקר טוב' : h < 17 ? 'צהריים טובים' : h < 21 ? 'ערב טוב' : 'לילה טוב';
  };

  /** Date, greeting, one calm line about the week. */
  function headHTML(courses, urgent) {
    const dateStr = new Intl.DateTimeFormat('he-IL', { weekday: 'long', day: 'numeric', month: 'long' }).format(new Date());
    const overdue = urgent.filter((x) => x.item.due < u.today()).length;
    const soon = urgent.length - overdue;
    const sub = !courses.length ? 'בוא נתחיל — הוסף את הקורס הראשון.'
      : overdue ? `${overdue === 1 ? 'מטלה אחת מחכה' : `${overdue} מטלות מחכות`} מהימים הקודמים${soon ? `, ועוד ${soon} השבוע` : ''}. צעד אחד בכל פעם.`
        : soon ? `${soon === 1 ? 'מטלה אחת' : `${soon} מטלות`} עם דדליין בשבוע הקרוב. הכול בשליטה.`
          : 'אין דדליינים השבוע — זמן טוב להתקדם בהרצאות ובתרגולים.';
    return `<header class="today-head">
        <p class="today-date">${dateStr}</p>
        <h1>${greeting()}</h1>
        <p class="today-sub">${sub}</p>
      </header>`;
  }

  /** The one big suggestion. */
  function nextHTML(actions) {
    if (!actions.length) {
      return `<section class="card next-card next-empty" aria-labelledby="next-h">
        <p class="next-kicker" id="next-h">הפעולה הבאה</p>
        <h2 class="next-title">אין כרגע משהו פתוח 🎉</h2>
        <p class="muted">כל הפריטים בקורסים הפעילים הושלמו. אפשר להוסיף קורס או לנוח.</p>
      </section>`;
    }
    const a = actions[pick % actions.length];
    const { item, course, cat } = a;
    const due = item.due ? ` · ${u.relDays(item.due)}` : '';
    return `<section class="card next-card" style="--c:${esc(course.color)}" aria-labelledby="next-h" data-id="${esc(item.id)}">
        <p class="next-kicker" id="next-h">הפעולה הבאה</p>
        <h2 class="next-title" dir="auto">${esc(item.title)}</h2>
        <p class="next-meta">${ui.courseDot(course)} <a href="#/course/${course.id}?item=${item.id}">${esc(course.name)}</a> · ${esc(cat.name)}${esc(due)}</p>
        <p class="next-why">${esc(a.reason)}</p>
        <div class="next-actions">
          <button class="btn btn-primary btn-lg" data-action="next-done" data-id="${esc(item.id)}">${icon.check}<span>סיימתי</span></button>
          ${CT.focus ? `<button class="btn btn-lg" data-action="next-five" data-id="${esc(item.id)}">${icon.timer || ''}<span>רק 5 דקות</span></button>` : ''}
          <a class="btn btn-ghost" href="#/course/${course.id}?item=${item.id}">פתח</a>
          ${actions.length > 1 ? `<button class="btn btn-ghost" data-action="next-other" aria-label="הצע משהו אחר">משהו אחר <span class="muted small">${(pick % actions.length) + 1}/${actions.length}</span></button>` : ''}
        </div>
      </section>`;
  }

  /** Today at a glance (until the points engine adds its goal ring). */
  function todayHTML(st, courses) {
    const doneToday = stats.completedSince(courses, u.today()).length;
    const minToday = u.sum(st.studyLog.filter((e) => e.date === u.today()), (e) => e.minutes);
    const streak = stats.streak(st);
    return `<section class="card today-card" aria-label="היום">
        <div class="today-stat"><b>${doneToday}</b><span>הושלמו היום</span></div>
        <div class="today-stat"><b>${minToday ? u.fmtMinutes(minToday) : '0'}</b><span>לימוד היום</span></div>
        <div class="today-stat"><b>${streak.days}</b><span>${streak.days === 1 ? 'יום רצף' : 'ימי רצף'}</span></div>
      </section>`;
  }

  /** A collapsible section; open state is remembered on this device. */
  function moreHTML(key, title, hint, opened, body) {
    return `<details class="card dash-more" data-k="${key}"${opened.has(key) ? ' open' : ''}>
        <summary><span class="dm-title">${title}</span><span class="muted small dm-hint">${esc(hint)}</span><span class="dm-chev" aria-hidden="true">${icon.chev}</span></summary>
        <div class="dm-body">${body}</div>
      </details>`;
  }

  function semesterHTML(courses, opened) {
    const st = S.state;
    const sem = S.semester(st.settings.activeSemesterId);
    if (!sem || !sem.start || !sem.end) return '';
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
    const all = courses.flatMap((c) => c.categories.flatMap((cat) => cat.items));
    const tot = stats.progress(all);
    const weekDone = stats.completedSince(courses, u.weekStart()).length;
    const weekMin = u.sum(st.studyLog.filter((e) => e.date >= u.weekStart()), (e) => e.minutes);
    return moreHTML('sem', '📅 הסמסטר', passed < 0 ? 'טרם התחיל' : `שבוע ${week} מתוך ${weeks}`, opened, `
      <div class="sem-box" style="--c:var(--accent)">
        <div class="hero-sem-top"><span>${esc(sem.name)}</span><b>${passed < 0 ? 'טרם התחיל' : `שבוע ${week} מתוך ${weeks}`}</b></div>
        ${ui.bar(pct, 'התקדמות הסמסטר')}
        <span class="muted small">${line}</span>
      </div>
      <div class="hero-tiles">
        <div class="tile"><span class="tile-ic" aria-hidden="true">🎯</span><b>${tot.pct}%</b><span>התקדמות כוללת</span></div>
        <div class="tile"><span class="tile-ic" aria-hidden="true">✅</span><b>${weekDone}</b><span>הושלמו השבוע</span></div>
        <div class="tile"><span class="tile-ic" aria-hidden="true">⏱️</span><b>${weekMin ? u.fmtMinutes(weekMin) : '0'}</b><span>לימוד השבוע</span></div>
        <div class="tile"><span class="tile-ic" aria-hidden="true">📊</span><b>${tot.open}</b><span>פריטים פתוחים</span></div>
      </div>`);
  }

  /** Notices (sync, Moodle, backup): the first one is shown, the rest fold under "עוד". */
  function noticesHTML(list) {
    if (!list.length) return '';
    if (list.length === 1) return `<div class="notices">${list[0]}</div>`;
    return `<div class="notices">${list[0]}<details class="notices-more"><summary>עוד ${list.length - 1 === 1 ? 'הודעה אחת' : `${list.length - 1} הודעות`}</summary>${list.slice(1).join('')}</details></div>`;
  }

  function bannersHTML() {
    const b = CT.backup;
    const out = [];
    const C = CT.cloud;
    if (C && C.status === 'conflict') {
      out.push(`<div class="banner banner-warn" role="status">⚠️ הנתונים השתנו בשני מכשירים ועדיין לא נבחרה גרסה.
        <button class="btn btn-small btn-primary" data-action="sync-now">פתור עכשיו</button></div>`);
    }
    if (CT.views.moodle && CT.views.moodle.bannerHTML) { const mb = CT.views.moodle.bannerHTML(); if (mb) out.push(mb); }
    const inboxN = S.state.moodle && S.state.moodle.inbox ? S.state.moodle.inbox.length : 0;
    const linkErr = S.state.moodle && S.state.moodle.linkError;
    if (linkErr) {
      out.push(`<div class="banner banner-warn" role="status">⚠️ סנכרון המטלות ממודל נכשל: ${u.esc(linkErr.message)}
        <a class="btn btn-small btn-primary" href="#/settings">להגדרות</a></div>`);
    }
    if (inboxN) {
      out.push(`<div class="banner banner-info" role="status">📥 ${inboxN === 1 ? 'מטלה אחת ממודל מחכה' : `${inboxN} מטלות ממודל מחכות`} לשיוך לקורס.
        <button class="btn btn-small btn-primary" data-action="moodle-inbox">לשיוך</button></div>`);
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
    if (C && C.enabled && !C.signedIn() && C.status !== 'conflict') {
      out.push(`<div class="banner banner-info" role="status">☁️ התחבר כדי לסנכרן בין המחשב לטלפון.
        <a class="btn btn-small btn-primary" href="#/settings">להתחברות</a></div>`);
    }
    return out;
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
            <h3 dir="auto">${esc(c.name)} ${ui.outcomeBadge(c)}</h3>
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

  /** Mark done from the home screen, with the check animation and undo. */
  function done(id) {
    const f = S.findItem(id);
    if (!f) return;
    S.toggleDone(id);
    if (CT.views.dashboard.afterDone) CT.views.dashboard.afterDone(id);
    ui.toast(`✓ ${f.item.title}`, { action: { label: 'בטל', fn: S.undo } });
  }

  async function onClick(e) {
    const a = e.target.closest('[data-action]');
    if (!a) return;
    if (a.tagName === 'SUMMARY') return;
    e.preventDefault();
    switch (a.dataset.action) {
      case 'toggle': case 'next-done': done(a.dataset.id); break;
      case 'next-other': pick++; CT.app.rerender(); break;
      case 'next-five': if (CT.focus) CT.focus.start(a.dataset.id, 5); break;
      case 'urgent-all': urgentAll = !urgentAll; CT.app.rerender(); break;
      case 'new-course': CT.views.course.courseForm(); break;
      case 'export': CT.backup.exportFile(); break;
      case 'snooze': CT.backup.snooze(); break;
      case 'regrant': CT.backup.regrant(); break;
      case 'sync-now': CT.cloud.syncNow(); break;
      case 'moodle-inbox': CT.views.moodle.showInbox(); break;
      case 'moodle-seen': CT.views.moodle.markSeen(); break;
      default: break;
    }
  }

})(window.CT);
