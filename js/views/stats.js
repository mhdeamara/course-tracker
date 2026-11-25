/* views/stats.js — weekly progress, study-time chart (inline SVG), pace vs. semester calendar, streak. */
(function (CT) {
  'use strict';
  const { u, ui, stats } = CT;
  const S = CT.store;
  const esc = u.esc;
  const V = {};
  CT.views = CT.views || {};
  CT.views.stats = V;

  let weekOffset = 0;

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

    root.innerHTML = `
      <div class="stats-page">
        <h1>סטטיסטיקות</h1>
        <div class="stat-cards">
          <div class="card stat"><b>${doneThisWeek}</b><span>פריטים הושלמו השבוע</span></div>
          <div class="card stat"><b>${streak.days}</b><span>ימי רצף ${streak.days ? (streak.today ? '— גם היום ✓' : '— אפשר להמשיך היום') : ''}</span></div>
          <div class="card stat"><b>${u.fmtMinutes(u.sum(stats.minutesByDay(st.studyLog, u.weekStart(), 7), (d) => d.total))}</b><span>זמן לימוד השבוע</span></div>
          <div class="card stat"><b>${semLeft != null ? semLeft : '—'}</b><span>ימים לסוף ${sem ? esc(sem.name.split('—')[0].trim()) : 'הסמסטר'}</span></div>
        </div>

        <section class="card">
          <h2>קצב התקדמות</h2>
          ${semLeft != null ? `<p>בשבועיים האחרונים השלמת בממוצע <b>${Math.round(rate * 10) / 10}</b> פריטים בשבוע.
            כדי לסיים את כל ${totalOpen} הפריטים הפתוחים עד סוף הסמסטר צריך בערך <b>${Math.round(needed * 10) / 10}</b> בשבוע.
            ${rate >= needed ? '👍 הקצב שלך מספיק.' : 'כדאי להגביר קצת — או לסמן פריטים שלא רלוונטיים כ"הושלם".'}</p>` : '<p class="muted">הגדר תאריכי התחלה וסיום לסמסטר (בהגדרות) כדי לראות קצב צפוי.</p>'}
          ${worst && worst.p.lag > 5 ? `<p class="warn-line">הקורס שהכי מפגר ביחס לקצב הצפוי: <a href="#/course/${worst.c.id}"><b>${esc(worst.c.name)}</b></a> (${worst.p.pct}% מול ${worst.p.expected}% צפוי).</p>` : ''}
          <div class="pace-table" role="table" aria-label="קצב לפי קורס">
            <div class="pace-row pace-head muted" role="row"><span>קורס</span><span>התקדמות מול צפוי</span><span>פער</span><span>פתוחים</span></div>
            ${paces.map(({ c, p }) => `
              <div class="pace-row" role="row" style="--c:${esc(c.color)}">
                <a href="#/course/${c.id}" dir="auto">${ui.courseDot(c)} ${esc(c.name)}</a>
                <div class="pace-bar" aria-label="${p.pct}% הושלמו, ${p.expected ?? '?'}% צפוי">
                  ${ui.bar(p.pct, '', true)}
                  ${p.expected != null ? `<span class="pace-mark" style="inset-inline-start:${p.expected}%" title="צפוי: ${p.expected}%"></span>` : ''}
                </div>
                <span class="${p.lag > 10 ? 'bad' : p.lag > 0 ? 'meh' : 'good'}">${p.expected == null ? '—' : p.lag > 0 ? `−${p.lag}%` : `+${-p.lag}%`}</span>
                <span>${p.open}</span>
              </div>`).join('')}
          </div>
          <p class="muted small">הקו האנכי = כמה היית "אמור" להשלים לפי הזמן שעבר בסמסטר (הנחה של קצב אחיד).</p>
        </section>

        <section class="card">
          <div class="section-head" style="margin-top:0">
            <h2>שעות לימוד — שבוע ${u.fmtDate(weekFrom)}–${u.fmtDate(u.addDays(weekFrom, 6))}</h2>
            <div class="toolbar-actions">
              <button class="btn btn-small" data-w="-1" aria-label="שבוע קודם">→ קודם</button>
              ${weekOffset ? '<button class="btn btn-small" data-w="0">השבוע</button>' : ''}
              <button class="btn btn-small" data-w="1" aria-label="שבוע הבא" ${weekOffset >= 0 ? 'disabled' : ''}>הבא ←</button>
            </div>
          </div>
          ${weekTotal ? chartSVG(days, courses) : '<p class="muted">אין זמן לימוד רשום בשבוע הזה. אפשר להפעיל טיימר (T) או להוסיף זמן ידנית.</p>'}
          ${weekTotal ? `<ul class="legend">${courses.map((c) => {
            const m = u.sum(days, (d) => d.byCourse[c.id] || 0);
            return m ? `<li>${ui.courseDot(c)} ${esc(c.name)} — <b>${u.fmtMinutes(m)}</b></li>` : '';
          }).join('')}<li class="muted">סה״כ: <b>${u.fmtMinutes(weekTotal)}</b></li></ul>` : ''}
        </section>
      </div>`;

    root.querySelector('.stats-page').addEventListener('click', (e) => {
      const b = e.target.closest('[data-w]');
      if (!b) return;
      weekOffset = b.dataset.w === '0' ? 0 : Math.min(0, weekOffset + Number(b.dataset.w));
      CT.app.rerender();
    });
  };

  /** Stacked bar chart, Sunday on the right (RTL). */
  function chartSVG(days, courses) {
    const W = 640, H = 220, pad = { t: 14, b: 28, l: 8, r: 36 };
    const max = Math.max(60, ...days.map((d) => d.total));
    const step = max > 300 ? 120 : 60;
    const top = Math.ceil(max / step) * step;
    const bw = (W - pad.l - pad.r) / 7;
    const y = (m) => pad.t + (H - pad.t - pad.b) * (1 - m / top);
    const grid = [];
    for (let m = 0; m <= top; m += step) {
      grid.push(`<line x1="${pad.l}" x2="${W - pad.r}" y1="${y(m)}" y2="${y(m)}" class="grid"/>
        <text x="${W - pad.r + 6}" y="${y(m) + 4}" class="axis">${m / 60}ש׳</text>`);
    }
    const bars = days.map((d, i) => {
      const x = W - pad.r - (i + 1) * bw + bw * 0.2; // RTL: day 0 on the right
      let acc = 0;
      const segs = courses.filter((c) => d.byCourse[c.id]).map((c) => {
        const m = d.byCourse[c.id];
        const seg = `<rect x="${x}" y="${y(acc + m)}" width="${bw * 0.6}" height="${Math.max(0, y(acc) - y(acc + m))}" fill="${esc(c.color)}" rx="3"><title>${esc(c.name)}: ${u.fmtMinutes(m)}</title></rect>`;
        acc += m;
        return seg;
      }).join('');
      const isToday = d.date === u.today();
      return `${segs}<text x="${x + bw * 0.3}" y="${H - 8}" text-anchor="middle" class="axis${isToday ? ' today' : ''}">${u.DAYS_SHORT[i]}</text>`;
    }).join('');
    return `<svg class="chart" viewBox="0 0 ${W} ${H}" role="img" aria-label="גרף שעות לימוד שבועי">${grid.join('')}${bars}</svg>`;
  }
})(window.CT);
