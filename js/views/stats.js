/* views/stats.js — weekly progress, study-time chart (inline SVG), pace vs. semester calendar, streak. */
(function (CT) {
  'use strict';
  const { u, ui, stats } = CT;
  const S = CT.store, I = CT.i18n;
  const esc = u.esc, icon = u.icon;
  const t = (k, p) => I.t(k, p), th = (k, p) => I.th(k, p);
  const V = {};
  CT.views = CT.views || {};
  CT.views.stats = V;

  let weekOffset = 0;
  const r1 = (x) => Math.round(x * 10) / 10;

  V.render = (root) => {
    const st = S.state;
    const courses = S.activeCourses();
    const weekFrom = u.addDays(u.weekStart(), weekOffset * 7);
    const days = stats.minutesByDay(st.studyLog.filter((e) => courses.some((c) => c.id === e.courseId)), weekFrom, 7);
    const weekTotal = u.sum(days, (d) => d.total);
    const doneThisWeek = stats.completedSince(courses, u.weekStart()).length;
    const streak = stats.streak(st);
    const rate = stats.recentRate(courses);

    const paces = courses.map((c) => ({ c, p: stats.pace(c, S.semester(c.semesterId)) }));
    const withPace = paces.filter((x) => x.p.expected != null && x.p.total);
    const worst = withPace.slice().sort((a, b) => b.p.lag - a.p.lag)[0];
    const sem = S.semester(st.settings.activeSemesterId);
    const semLeft = sem && sem.end ? Math.max(0, u.daysUntil(sem.end)) : null;
    const totalOpen = u.sum(paces, (x) => x.p.open);
    const needed = semLeft ? totalOpen / Math.max(1, semLeft / 7) : null;
    const thisWeek = u.sum(stats.minutesByDay(st.studyLog, u.weekStart(), 7), (d) => d.total);

    root.innerHTML = `
      <div class="stats-page page-wide">
        <header class="pg-head"><h1>${t('st.title')}</h1></header>
        <div class="stat-cards">
          <div class="card stat"><b>${doneThisWeek}</b><span>${t('st.doneWeek')}</span></div>
          <div class="card stat"><b>${streak.days}</b><span>${t('st.streak')}${streak.days ? ` <span class="muted">· ${t(streak.today ? 'st.streakToday' : 'st.streakCont')}</span>` : ''}</span></div>
          <div class="card stat"><b>${esc(ui.minutes(thisWeek))}</b><span>${t('st.timeWeek')}</span></div>
          <div class="card stat"><b>${semLeft != null ? semLeft : '—'}</b><span>${sem ? th('st.daysLeftOf', { name: I.bdi(sem.name.split('—')[0].trim()) }) : t('st.daysLeft')}</span></div>
        </div>

        <section class="card">
          <h2 class="cat-h2">${t('st.pace')}</h2>
          ${semLeft != null ? `<p>${th('st.rate', { rate: I.html(`<b>${esc(r1(rate))}</b>`), n: totalOpen, need: I.html(`<b>${esc(r1(needed))}</b>`) })}
            <span class="${rate >= needed ? 'good' : 'meh'}">${t(rate >= needed ? 'st.rateOk' : 'st.rateLow')}</span></p>` : `<p class="muted">${t('st.noDates')} <a href="#/semesters">${t('gpa.semPage')}</a></p>`}
          ${worst && worst.p.lag > 5 ? `<p class="warn-line">${th('st.worst', { name: I.html(`<a href="#/course/${esc(worst.c.id)}" dir="auto"><b>${esc(worst.c.name)}</b></a>`), pct: worst.p.pct, exp: worst.p.expected })}</p>` : ''}
          ${paces.length ? `<div class="pace-table" role="table" aria-label="${t('st.paceTable')}">
            <div class="pace-row pace-head muted" role="row"><span role="columnheader">${t('gpa.course')}</span><span role="columnheader">${t('st.vsExpected')}</span><span role="columnheader">${t('st.gap')}</span><span role="columnheader">${t('st.open')}</span></div>
            ${paces.map(({ c, p }) => `
              <div class="pace-row" role="row" style="--c:${esc(c.color)}">
                <a href="#/course/${esc(c.id)}" role="cell">${ui.courseDot(c)} <span dir="auto">${esc(c.name)}</span></a>
                <div class="pace-bar" role="cell" aria-label="${t('st.barLabel', { pct: p.pct, exp: p.expected ?? '?' })}">
                  ${ui.bar(p.pct, '', true)}
                  ${p.expected != null ? `<span class="pace-mark" style="inset-inline-start:${p.expected}%" title="${t('st.expectedPct', { n: p.expected })}"></span>` : ''}
                </div>
                <span role="cell" dir="ltr" class="${p.lag > 10 ? 'bad' : p.lag > 0 ? 'meh' : 'good'}">${p.expected == null ? '—' : p.lag > 0 ? `−${p.lag}%` : `+${-p.lag}%`}</span>
                <span role="cell">${p.open}</span>
              </div>`).join('')}
          </div>
          <p class="muted small">${t('st.markNote')}</p>` : `<p class="muted">${t('st.noCourses')}</p>`}
        </section>

        <section class="card">
          <div class="section-head" style="margin-top:0">
            <h2 class="cat-h2">${t('st.hours', { from: ui.date(weekFrom), to: ui.date(u.addDays(weekFrom, 6)) })}</h2>
            <div class="toolbar-actions">
              <button class="btn btn-small" data-w="-1"><span class="ic-back" aria-hidden="true">${icon.chevSide}</span> ${t('st.prev')}</button>
              ${weekOffset ? `<button class="btn btn-small" data-w="0">${t('st.thisWeek')}</button>` : ''}
              <button class="btn btn-small" data-w="1" ${weekOffset >= 0 ? 'disabled' : ''}>${t('st.next')} <span class="ic-fwd" aria-hidden="true">${icon.chevSide}</span></button>
            </div>
          </div>
          ${weekTotal ? chartSVG(days, courses) : `<p class="muted">${t('st.noTime')}</p>`}
          ${weekTotal ? `<ul class="legend">${courses.map((c) => {
            const m = u.sum(days, (d) => d.byCourse[c.id] || 0);
            return m ? `<li>${ui.courseDot(c)} <span dir="auto">${esc(c.name)}</span> — <b>${esc(ui.minutes(m))}</b></li>` : '';
          }).join('')}<li class="muted">${t('st.total')} <b>${esc(ui.minutes(weekTotal))}</b></li></ul>` : ''}
        </section>
      </div>`;

    root.querySelector('.stats-page').addEventListener('click', (e) => {
      const b = e.target.closest('[data-w]');
      if (!b) return;
      const w = b.dataset.w;
      weekOffset = w === '0' ? 0 : Math.min(0, weekOffset + Number(w));
      CT.app.rerender();
      const again = root.querySelector(`[data-w="${w}"]:not([disabled])`) || root.querySelector('[data-w="-1"]');
      if (again) again.focus();
    });
  };

  /** Stacked bar chart in reading order: Sunday first (on the right in Hebrew, on the left in English). */
  function chartSVG(days, courses) {
    const W = 640, H = 220, pad = { t: 14, b: 28, l: 8, r: 36 };
    const rtl = I.dir() === 'rtl';
    const max = Math.max(60, ...days.map((d) => d.total));
    const step = max > 300 ? 120 : 60;
    const top = Math.ceil(max / step) * step;
    const bw = (W - pad.l - pad.r) / 7;
    const y = (m) => pad.t + (H - pad.t - pad.b) * (1 - m / top);
    const grid = [];
    for (let m = 0; m <= top; m += step) {
      grid.push(`<line x1="${pad.l}" x2="${W - pad.r}" y1="${y(m)}" y2="${y(m)}" class="grid"/>
        <text x="${W - pad.r + 6}" y="${y(m) + 4}" class="axis">${esc(I.tx('fmt.hShort', { h: m / 60 }))}</text>`);
    }
    const bars = days.map((d, i) => {
      const x = rtl ? W - pad.r - (i + 1) * bw + bw * 0.2 : pad.l + i * bw + bw * 0.2;
      let acc = 0;
      const segs = courses.filter((c) => d.byCourse[c.id]).map((c) => {
        const m = d.byCourse[c.id];
        const seg = `<rect x="${x}" y="${y(acc + m)}" width="${bw * 0.6}" height="${Math.max(0, y(acc) - y(acc + m))}" fill="${esc(c.color)}" rx="3"><title>${esc(I.iso(c.name))}: ${esc(ui.minutes(m))}</title></rect>`;
        acc += m;
        return seg;
      }).join('');
      const isToday = d.date === u.today();
      return `${segs}<text x="${x + bw * 0.3}" y="${H - 8}" text-anchor="middle" class="axis${isToday ? ' today' : ''}">${esc(ui.dayName(i, 'short'))}</text>`;
    }).join('');
    return `<svg class="chart" viewBox="0 0 ${W} ${H}" role="img" aria-label="${t('st.chartLabel')}">${grid.join('')}${bars}</svg>`;
  }
})(window.CT);
