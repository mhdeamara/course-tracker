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
    const hasSample = st.courses.some((c) => c.sample);

    root.innerHTML = `
      <div class="dash">
        ${bannersHTML()}
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
                return `<li style="--c:${esc(course.color)}"><span class="cd-num">${n === 0 ? 'היום' : n}</span>
                  <span class="cd-text">${n === 0 ? '' : n === 1 ? 'יום ל' : 'ימים ל'}${esc(exam.label || 'מבחן')} ב<a href="#/course/${course.id}">${esc(course.name)}</a>
                  <span class="muted small">${u.fmtDateFull(exam.date)}</span></span></li>`;
              }).join('')}</ul>
            </section>` : ''}
            ${CT.views.schedule ? CT.views.schedule.nowNextHTML() : ''}
            <section class="card mini-stats">
              <div><b>${weekDone}</b><span>הושלמו השבוע</span></div>
              <div><b>${streak.days}</b><span>${streak.days === 1 ? 'יום רצף' : 'ימי רצף'} ${streak.days >= 3 ? '🌱' : ''}</span></div>
              <div><b>${u.fmtMinutes(u.sum(st.studyLog.filter((e) => e.date >= u.weekStart()), (e) => e.minutes))}</b><span>זמן לימוד השבוע</span></div>
            </section>
          </div>
        </div>

        <div class="section-head">
          <h2>הקורסים שלי</h2>
          <div class="toolbar-actions">
            ${hasSample ? `<button class="btn btn-ghost" data-action="clear-sample">${icon.trash}<span>נקה נתוני דוגמה</span></button>` : ''}
            <button class="btn btn-primary" data-action="new-course">${icon.plus}<span>קורס חדש</span></button>
          </div>
        </div>
        <div class="course-grid">
          ${courses.map(cardHTML).join('') || ui.empty('אין קורסים פעילים. <button class="btn btn-primary" data-action="new-course">הוסף קורס</button>')}
        </div>
      </div>`;

    root.querySelector('.dash').addEventListener('click', onClick);
  };

  function bannersHTML() {
    const b = CT.backup;
    const out = [];
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
        <div class="cc-head">
          <h3 dir="auto">${esc(c.name)}</h3>
          ${c.number ? `<span class="muted small" dir="ltr">${esc(c.number)}</span>` : ''}
        </div>
        <div class="cc-progress"><span class="cc-pct">${p.pct}%</span>${ui.bar(p.pct, `התקדמות ב${c.name}`)}</div>
        <div class="cc-meta">
          <span>${p.open ? `${p.open} פתוחים` : '✓ הכול הושלם'}</span>
          ${exam ? `<span class="${n <= 14 ? 'warn' : ''}">⏳ ${n === 0 ? 'מבחן היום' : `${n} ימים ל${esc(exam.label || 'מבחן')}`}</span>` : ''}
        </div>
        ${next ? `<div class="cc-next ${next.item.due < u.today() ? 'overdue' : ''}">הבא: <span dir="auto">${esc(next.item.title)}</span> · ${u.relDays(next.item.due)}</div>` : ''}
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
      case 'clear-sample': V.clearSample(); break;
      default: break;
    }
  }

  V.clearSample = async () => {
    const n = S.state.courses.filter((c) => c.sample).length;
    if (!(await ui.confirm(`למחוק את ${n} קורסי הדוגמה? הקורסים האמיתיים שלך לא ייפגעו.`, 'נקה', true))) return;
    S.commit('ניקוי נתוני דוגמה', (st) => {
      const ids = new Set(st.courses.filter((c) => c.sample).map((c) => c.id));
      st.courses = st.courses.filter((c) => !c.sample);
      st.studyLog = st.studyLog.filter((e) => !e.sample && !ids.has(e.courseId));
    });
    ui.toast('נתוני הדוגמה נמחקו', { action: { label: 'בטל', fn: S.undo } });
  };
})(window.CT);
