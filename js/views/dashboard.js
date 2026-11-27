/* views/dashboard.js — "היום": the home screen. The next action, one list of what is coming up (assignments and exams
 * together, each once), today's classes and today's progress. Non-critical notices live in the notification center;
 * only a sync conflict and a failed Moodle sync are shown here, because they need action. Fully translated (CT.i18n). */
(function (CT) {
  'use strict';
  const { u, ui, stats } = CT;
  const S = CT.store, M = CT.model;
  const I18N = CT.i18n, t = I18N.t, tx = I18N.tx;
  const esc = u.esc, icon = u.icon;
  const V = {};
  CT.views = CT.views || {};
  CT.views.dashboard = V;

  const AGENDA_SHOWN = 6;
  let pick = 0;            // which suggestion "next action" shows ("another" moves on)
  let agendaAll = false;   // "show all" in the upcoming list

  /** Cards other modules add to the daily-progress card (points goal, adhkar). Each returns HTML or ''. */
  V.slots = { daily: [] };

  V.render = (root) => {
    const st = S.state;
    const courses = S.activeCourses();
    const agenda = stats.agenda(courses);
    const actions = stats.nextActions(courses);
    root.innerHTML = `
      <div class="today">
        ${headHTML(courses, agenda)}
        ${alertsHTML()}
        <div class="td-grid">
          <div class="td-main">
            ${nextHTML(actions)}
            ${agendaHTML(agenda)}
          </div>
          <aside class="td-side" aria-label="${t('td.sideLabel')}">
            ${classesHTML()}
            ${dailyHTML(st, courses)}
          </aside>
        </div>
      </div>`;
    root.querySelector('.today').addEventListener('click', onClick);
  };

  /* ---------- head: date, greeting, one calm line, semester week + nearest exam ---------- */
  const greeting = () => {
    const h = new Date().getHours();
    return tx(h < 5 ? 'td.greet.night' : h < 12 ? 'td.greet.morning' : h < 17 ? 'td.greet.noon' : h < 21 ? 'td.greet.evening' : 'td.greet.night');
  };

  function headHTML(courses, agenda) {
    const items = agenda.filter((x) => x.kind === 'item');
    const overdue = items.filter((x) => x.date < u.today()).length;
    const soon = items.length - overdue;
    const sub = !courses.length ? t('td.sub.empty')
      : overdue ? (soon ? t('td.sub.overdueSoon', { n: overdue, m: soon }) : t('td.sub.overdue', { n: overdue }))
        : soon ? t('td.sub.soon', { n: soon }) : t('td.sub.calm');
    const chips = [];
    const sem = S.semester(S.state.settings.activeSemesterId);
    if (sem && sem.start && sem.end) {
      const total = u.daysBetween(sem.start, sem.end), passed = u.daysBetween(sem.start, u.today());
      const weeks = Math.ceil((total + 1) / 7);
      if (passed < 0) chips.push(`<span class="td-chip">${icon.calendar}${t('td.semStarts', { n: -passed })}</span>`);
      else if (u.daysUntil(sem.end) >= 0) chips.push(`<span class="td-chip">${icon.calendar}${t('td.week', { n: u.clamp(Math.floor(passed / 7) + 1, 1, weeks), m: weeks })}</span>`);
    }
    const ex = stats.upcomingExams(courses)[0];
    if (ex) {
      const n = u.daysUntil(ex.exam.date);
      chips.push(`<a class="td-chip td-exam" href="#/course/${esc(ex.course.id)}" style="--c:${esc(ex.course.color)}">${icon.cap}<span>${n === 0 ? t('td.examToday') : t('td.examIn', { n })}</span><span class="td-chip-sub" dir="auto">${esc(ex.course.name)}</span></a>`);
    }
    return `<header class="td-head">
        <div class="td-hello">
          <p class="td-date">${esc(ui.date(u.today(), 'long'))}</p>
          <h1>${esc(greeting())}</h1>
          <p class="td-sub">${sub}</p>
        </div>
        ${chips.length ? `<div class="td-chips">${chips.join('')}</div>` : ''}
      </header>`;
  }

  /* ---------- the only on-screen alerts: sync conflict, failed Moodle sync (both need action) ---------- */
  function alertsHTML() {
    const out = [];
    const C = CT.cloud;
    if (C && C.status === 'conflict') {
      out.push(`<div class="td-alert" role="status">${icon.alert}<div class="td-alert-t"><b>${t('td.conflict')}</b></div>
        <span class="td-alert-a"><button class="btn btn-small btn-primary" data-action="sync-now">${t('td.resolve')}</button></span></div>`);
    }
    const err = S.state.moodle && S.state.moodle.linkError;
    if (err) {
      out.push(`<div class="td-alert" role="alert">${icon.alert}<div class="td-alert-t"><b>${t('td.moodleFailed')}</b>${err.message ? `<span class="muted small" dir="auto">${esc(err.message)}</span>` : ''}</div>
        <span class="td-alert-a"><button class="btn btn-small" data-action="moodle-retry">${icon.refresh}<span>${t('td.retry')}</span></button>
        <a class="btn btn-small btn-ghost" href="#/settings">${t('td.settings')}</a></span></div>`);
    }
    return out.length ? `<div class="td-alerts">${out.join('')}</div>` : '';
  }

  /* ---------- next action ---------- */
  function nextHTML(actions) {
    if (!actions.length) {
      return `<section class="card td-next is-empty" aria-labelledby="next-h">
        <p class="td-kicker" id="next-h">${t('td.next')}</p>
        <h2 class="td-next-title">${t('td.nextNone')}</h2>
        <p class="muted small">${t('td.nextNoneSub')}</p>
      </section>`;
    }
    const a = actions[pick % actions.length];
    const { item, course, cat } = a;
    const late = item.due && item.due < u.today();
    const why = a.why ? tx(a.why.k, a.why.p) : a.reason;
    return `<section class="card td-next" style="--c:${esc(course.color)}" aria-labelledby="next-h" data-id="${esc(item.id)}">
        <div class="td-next-top">
          <p class="td-kicker" id="next-h">${t('td.next')}</p>
          <span class="td-why${late ? ' is-late' : ''}">${late ? icon.alert : ''}<span dir="auto">${esc(why)}</span></span>
        </div>
        <h2 class="td-next-title" dir="auto">${esc(item.title)}</h2>
        <p class="td-next-meta">${ui.courseDot(course)}<a href="#/course/${esc(course.id)}?item=${esc(item.id)}" dir="auto">${esc(course.name)}</a><span aria-hidden="true">·</span><span dir="auto">${esc(cat.name)}</span>${item.due ? `<span aria-hidden="true">·</span><span>${esc(ui.rel(item.due))}</span>` : ''}</p>
        <div class="td-next-actions">
          <button class="btn btn-primary" data-action="next-done" data-id="${esc(item.id)}">${icon.check}<span>${t('td.done')}</span></button>
          ${CT.focus ? `<button class="btn" data-action="next-five" data-id="${esc(item.id)}">${icon.timer}<span>${t('td.five')}</span></button>` : ''}
          <a class="btn btn-ghost" href="#/course/${esc(course.id)}?item=${esc(item.id)}">${t('td.open')}</a>
          ${actions.length > 1 ? `<button class="btn btn-ghost td-other" data-action="next-other" aria-label="${t('td.otherLabel', { i: (pick % actions.length) + 1, n: actions.length })}">${t('td.other')} <span class="muted small" aria-hidden="true">${ui.num((pick % actions.length) + 1)}/${ui.num(actions.length)}</span></button>` : ''}
        </div>
      </section>`;
  }

  /* ---------- upcoming: assignments and exams in one list ---------- */
  function agendaHTML(list) {
    const shown = agendaAll ? list : list.slice(0, AGENDA_SHOWN);
    const row = (x) => {
      const n = u.daysUntil(x.date);
      const when = x.kind === 'exam'
        ? (n === 0 ? tx('rel.today') : tx('td.inDays', { n }))
        : ui.rel(x.date);
      const late = x.kind === 'item' && n < 0;
      const lead = x.kind === 'exam'
        ? `<span class="ag-ic" aria-hidden="true">${icon.cap}</span>`
        : `<button class="check check-sm" role="checkbox" aria-checked="false" data-action="toggle" data-id="${esc(x.item.id)}" aria-label="${t('td.markDone', { title: x.item.title })}">${icon.check}</button>`;
      const title = x.kind === 'exam' ? (x.exam.label || tx('td.exam')) : x.item.title;
      const href = x.kind === 'exam' ? `#/course/${esc(x.course.id)}` : `#/course/${esc(x.course.id)}?item=${esc(x.item.id)}`;
      return `<li class="ag-row${x.kind === 'exam' ? ' is-exam' : ''}${late ? ' is-late' : n <= 1 ? ' is-soon' : ''}" style="--c:${esc(x.course.color)}">
        ${lead}
        <a class="ag-t" href="${href}"><span class="ag-title" dir="auto">${esc(title)}</span>
          <span class="ag-sub">${ui.courseDot(x.course)}<span dir="auto">${esc(x.course.name)}</span>${x.kind === 'exam' ? `<span aria-hidden="true">·</span><span>${t('td.exam')}</span>` : ''}</span></a>
        <span class="ag-when">${late ? icon.alert : ''}<span>${esc(when)}</span><span class="ag-date">${esc(ui.date(x.date, 'wd'))}</span></span>
      </li>`;
    };
    return `<section class="card td-agenda" aria-labelledby="ag-h">
        <div class="card-head"><h2 id="ag-h">${t('td.upcoming')}</h2>${list.length ? `<span class="td-count" aria-label="${t('td.upcomingCount', { n: list.length })}">${ui.num(list.length)}</span>` : ''}</div>
        ${list.length ? `<ul class="ag-list">${shown.map(row).join('')}</ul>
          ${list.length > AGENDA_SHOWN ? `<button class="btn btn-ghost btn-small td-more" data-action="agenda-all" aria-expanded="${agendaAll}">${agendaAll ? t('td.less') : t('td.all', { n: list.length })}</button>` : ''}`
          : `<p class="td-calm">${icon.check}<span>${t('td.nothingSoon')}</span></p>`}
      </section>`;
  }

  /* ---------- today's classes (or the next one) ---------- */
  function classesHTML() {
    const slots = S.activeCourses().flatMap((c) => (c.schedule || []).map((slot) => ({ slot, course: c })));
    if (!slots.length) return '';
    const d = new Date(), day = d.getDay(), min = d.getHours() * 60 + d.getMinutes();
    const today = slots.filter((x) => x.slot.day === day).sort((a, b) => u.timeToMin(a.slot.start) - u.timeToMin(b.slot.start));
    const type = (s) => (M.SLOT_TYPES[s.type] ? tx('slot.' + s.type) : '');
    const row = (x, label) => {
      const now = x.slot.day === day && u.timeToMin(x.slot.start) <= min && min < u.timeToMin(x.slot.end);
      const past = x.slot.day === day && u.timeToMin(x.slot.end) <= min;
      return `<li class="cl-row${now ? ' is-now' : ''}${past ? ' is-past' : ''}" style="--c:${esc(x.course.color)}">
        <span class="cl-time" dir="ltr">${esc(x.slot.start)}</span>
        <a class="cl-t" href="#/course/${esc(x.course.id)}"><b dir="auto">${esc(x.course.name)}</b>
          <span class="muted small">${[label, type(x.slot), x.slot.room && `<span dir="auto">${esc(x.slot.room)}</span>`, now && t('td.now')].filter(Boolean).join(' · ')}</span></a>
      </li>`;
    };
    let body;
    if (today.length) body = `<ul class="cl-list">${today.map((x) => row(x, '')).join('')}</ul>`;
    else {
      const nx = CT.views.schedule ? CT.views.schedule.nowNext().next : null;
      body = nx ? `<p class="muted small">${t('td.noClasses')}</p><ul class="cl-list">${row(nx, esc(nx.inDays === 1 ? tx('rel.tomorrow') : ui.dayName(nx.slot.day)))}</ul>` : `<p class="muted small">${t('td.noClasses')}</p>`;
    }
    return `<section class="card td-classes" aria-labelledby="cl-h">
        <div class="card-head"><h2 id="cl-h">${t('td.classes')}</h2><a class="small" href="#/schedule">${t('td.schedule')}</a></div>
        ${body}
      </section>`;
  }

  /* ---------- today's progress: points goal + adhkar when on, otherwise plain numbers ---------- */
  function dailyHTML(st, courses) {
    const parts = V.slots.daily.map((f) => { try { return f(); } catch (e) { console.error(e); return ''; } }).filter(Boolean);
    const xpOn = CT.views.xp && CT.views.xp.dailyHTML && parts.length && /class="td-goal/.test(parts.join(''));
    let plain = '';
    if (!xpOn) {
      const doneToday = stats.completedSince(courses, u.today()).length;
      const minToday = u.sum(st.studyLog.filter((e) => e.date === u.today()), (e) => e.minutes);
      const streak = stats.streak(st).days;
      plain = `<div class="td-stats">
          <div><b>${ui.num(doneToday)}</b><span>${t('td.doneToday')}</span></div>
          <div><b>${ui.num(minToday)}</b><span>${t('td.minutesToday')}</span></div>
          <div><b>${ui.num(streak)}</b><span>${t('td.streakDays', { n: streak })}</span></div>
        </div>`;
    }
    return `<section class="card td-daily" aria-labelledby="dy-h">
        <h2 id="dy-h" class="td-daily-h">${t('td.daily')}</h2>
        ${plain}${parts.join('')}
      </section>`;
  }

  /* ---------- actions ---------- */
  function done(id) {
    const f = S.findItem(id);
    if (!f) return;
    S.toggleDone(id);
    if (V.afterDone) V.afterDone(id);
    ui.toast(tx('td.doneToast', { title: f.item.title }), { action: { label: tx('common.undo'), fn: S.undo } });
  }

  function onClick(e) {
    const a = e.target.closest('[data-action]');
    if (!a) return;
    e.preventDefault();
    switch (a.dataset.action) {
      case 'toggle': case 'next-done': done(a.dataset.id); break;
      case 'next-other': pick++; CT.app.rerender(); { const b = document.querySelector('.td-other'); if (b) b.focus(); } break;
      case 'next-five': if (CT.focus) CT.focus.start(a.dataset.id, 5); break;
      case 'agenda-all': agendaAll = !agendaAll; CT.app.rerender(); { const b = document.querySelector('.td-more'); if (b) b.focus(); } break;
      case 'sync-now': CT.cloud.syncNow(); break;
      case 'moodle-retry': if (CT.views.moodle && CT.views.moodle.syncLink) CT.views.moodle.syncLink({ manual: true }); break;
      default: break;
    }
  }
})(window.CT);
