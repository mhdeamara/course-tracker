/* views/schedule.js — weekly timetable (Sun–Thu), colored by course, with "now" and "next" highlights. */
(function (CT) {
  'use strict';
  const { u, ui } = CT;
  const S = CT.store, M = CT.model;
  const esc = u.esc, icon = u.icon;
  const V = {};
  CT.views = CT.views || {};
  CT.views.schedule = V;

  const HOUR_PX = 54;

  /** All slots of active courses: [{slot, course}] */
  const allSlots = () => S.activeCourses().flatMap((c) => (c.schedule || []).map((slot) => ({ slot, course: c })));

  const nowInfo = () => {
    const d = new Date();
    return { day: d.getDay(), min: d.getHours() * 60 + d.getMinutes() };
  };

  /** Current slot and the next upcoming one (looks ahead up to a week). */
  V.nowNext = () => {
    const slots = allSlots();
    if (!slots.length) return { now: null, next: null };
    const { day, min } = nowInfo();
    const now = slots.find((x) => x.slot.day === day && u.timeToMin(x.slot.start) <= min && min < u.timeToMin(x.slot.end)) || null;
    let next = null;
    for (let k = 0; k < 7 && !next; k++) {
      const d = (day + k) % 7;
      const cands = slots.filter((x) => x.slot.day === d && (k > 0 || u.timeToMin(x.slot.start) > min))
        .sort((a, b) => u.timeToMin(a.slot.start) - u.timeToMin(b.slot.start));
      if (cands[0]) next = { ...cands[0], inDays: k };
    }
    return { now, next };
  };

  V.nowNextHTML = () => {
    const { now, next } = V.nowNext();
    if (!now && !next) return '';
    const line = (x, label) => `<div class="nn-row" style="--c:${esc(x.course.color)}">
      <span class="nn-label">${label}</span>
      <span><a href="#/course/${x.course.id}">${esc(x.course.name)}</a> · ${M.SLOT_TYPES[x.slot.type] || ''}
      <span class="muted small">${x.inDays === 1 ? 'מחר ' : x.inDays > 1 ? `יום ${u.DAYS[x.slot.day]} ` : ''}${esc(x.slot.start)}–${esc(x.slot.end)}${x.slot.room ? ' · ' + esc(x.slot.room) : ''}</span></span></div>`;
    return `<section class="card now-next"><h2>🕐 מערכת</h2>${now ? line(now, 'עכשיו') : ''}${next ? line(next, 'הבא') : ''}<a class="small" href="#/schedule">למערכת המלאה ←</a></section>`;
  };

  V.render = (root) => {
    const slots = allSlots();
    const days = [0, 1, 2, 3, 4];
    if (slots.some((x) => x.slot.day === 5)) days.push(5);
    const starts = slots.map((x) => u.timeToMin(x.slot.start));
    const ends = slots.map((x) => u.timeToMin(x.slot.end));
    const minH = Math.min(8, ...starts.map((m) => Math.floor(m / 60)));
    const maxH = Math.max(18, ...ends.map((m) => Math.ceil(m / 60)));
    const { day: today, min: nowMin } = nowInfo();
    const { now, next } = V.nowNext();
    const top = (m) => ((m - minH * 60) / 60) * HOUR_PX;

    const block = (x) => {
      const isNow = now && now.slot.id === x.slot.id, isNext = next && next.slot.id === x.slot.id;
      return `<button class="slot${isNow ? ' now' : ''}${isNext ? ' next' : ''}" data-id="${x.slot.id}" data-course="${x.course.id}"
        style="--c:${esc(x.course.color)};top:${top(u.timeToMin(x.slot.start))}px;height:${Math.max(22, top(u.timeToMin(x.slot.end)) - top(u.timeToMin(x.slot.start)) - 3)}px"
        aria-label="${esc(x.course.name)}, ${M.SLOT_TYPES[x.slot.type]}, יום ${u.DAYS[x.slot.day]} ${x.slot.start}–${x.slot.end}">
        <b dir="auto">${esc(x.course.name)}</b>
        <span>${M.SLOT_TYPES[x.slot.type] || ''} · ${esc(x.slot.start)}–${esc(x.slot.end)}</span>
        ${x.slot.room ? `<span dir="auto">${esc(x.slot.room)}</span>` : ''}
        ${isNow ? '<em>עכשיו</em>' : isNext ? '<em>הבא</em>' : ''}
      </button>`;
    };

    const hours = [];
    for (let h = minH; h < maxH; h++) hours.push(h);

    root.innerHTML = `
      <div class="schedule">
        <div class="section-head" style="margin-top:0">
          <h1>מערכת שעות</h1>
          <button class="btn btn-primary" data-action="add">${icon.plus} שיעור במערכת</button>
        </div>
        ${slots.length ? '' : '<p class="muted">עוד אין שיעורים במערכת. הוסף הרצאות, תרגולים ומעבדות — הם יופיעו גם בדשבורד ("עכשיו" ו"הבא בתור").</p>'}
        <div class="card sched-grid" style="--cols:${days.length}">
          <div class="sg-head"><span></span>${days.map((d) => `<span class="${d === today ? 'today' : ''}">${u.DAYS[d]}</span>`).join('')}</div>
          <div class="sg-body" style="height:${(maxH - minH) * HOUR_PX}px">
            <div class="sg-hours">${hours.map((h) => `<span style="top:${(h - minH) * HOUR_PX}px">${u.pad(h)}:00</span>`).join('')}</div>
            ${days.map((d) => `<div class="sg-day${d === today ? ' today' : ''}" data-day="${d}">
              ${hours.map((h) => `<i style="top:${(h - minH) * HOUR_PX}px"></i>`).join('')}
              ${d === today && nowMin >= minH * 60 && nowMin <= maxH * 60 ? `<div class="now-line" style="top:${top(nowMin)}px" aria-hidden="true"></div>` : ''}
              ${slots.filter((x) => x.slot.day === d).map(block).join('')}
            </div>`).join('')}
          </div>
        </div>
        <div class="sched-list">
          ${days.map((d) => {
            const ds = slots.filter((x) => x.slot.day === d).sort((a, b) => a.slot.start.localeCompare(b.slot.start));
            return `<section class="card${d === today ? ' today' : ''}"><h3>${u.DAYS[d]}${d === today ? ' · היום' : ''}</h3>
              ${ds.map((x) => `<button class="slot-row${now && now.slot.id === x.slot.id ? ' now' : ''}${next && next.slot.id === x.slot.id ? ' next' : ''}" data-id="${x.slot.id}" data-course="${x.course.id}" style="--c:${esc(x.course.color)}">
                <span class="nowrap">${esc(x.slot.start)}–${esc(x.slot.end)}</span><b dir="auto">${esc(x.course.name)}</b>
                <span class="muted small">${M.SLOT_TYPES[x.slot.type]}${x.slot.room ? ' · ' + esc(x.slot.room) : ''}</span></button>`).join('') || '<p class="muted small">אין שיעורים</p>'}
            </section>`;
          }).join('')}
        </div>
      </div>`;

    root.querySelector('.schedule').addEventListener('click', (e) => {
      if (e.target.closest('[data-action=add]')) return slotForm();
      const s = e.target.closest('[data-id]');
      if (s) slotForm(s.dataset.course, s.dataset.id);
    });
  };

  function slotForm(courseId, slotId) {
    const courses = S.activeCourses();
    if (!courses.length) { ui.toast('צריך קודם להוסיף קורס'); return; }
    const c = courseId && S.course(courseId);
    const s = (c && c.schedule.find((x) => x.id === slotId)) || { day: 0, start: '10:30', end: '12:30', type: 'lecture', room: '' };
    ui.modal({
      title: slotId ? 'עריכת שיעור' : 'שיעור חדש במערכת',
      body: `<div class="form-grid">
        <label class="field span-2"><span>קורס</span><select name="course">${courses.map((x) => `<option value="${x.id}" ${x.id === courseId ? 'selected' : ''}>${esc(x.name)}</option>`).join('')}</select></label>
        <label class="field"><span>סוג</span><select name="type">${Object.entries(M.SLOT_TYPES).map(([k, l]) => `<option value="${k}" ${k === s.type ? 'selected' : ''}>${l}</option>`).join('')}</select></label>
        <label class="field"><span>יום</span><select name="day">${[0, 1, 2, 3, 4, 5].map((d) => `<option value="${d}" ${d === s.day ? 'selected' : ''}>${u.DAYS[d]}</option>`).join('')}</select></label>
        <label class="field"><span>התחלה</span><input type="time" name="start" value="${esc(s.start)}" step="900"></label>
        <label class="field"><span>סיום</span><input type="time" name="end" value="${esc(s.end)}" step="900"></label>
        <label class="field span-2"><span>חדר / מקום</span><input name="room" dir="auto" value="${esc(s.room)}" placeholder="למשל: מאייר 280"></label>
      </div>`,
      actions: [
        slotId && { label: 'מחק', danger: true, fn: () => S.commit('מחיקת שיעור', () => { const cc = S.course(courseId); cc.schedule = cc.schedule.filter((x) => x.id !== slotId); }) },
        { label: 'ביטול' },
        {
          label: 'שמור', primary: true, fn: (m) => {
            const g = (n) => m.body.querySelector(`[name=${n}]`).value;
            if (u.timeToMin(g('end')) <= u.timeToMin(g('start'))) { ui.toast('שעת הסיום חייבת להיות אחרי ההתחלה', { error: true }); return false; }
            const data = { day: Number(g('day')), start: g('start'), end: g('end'), type: g('type'), room: g('room').trim() };
            S.commit(slotId ? 'עריכת שיעור' : 'הוספת שיעור', () => {
              if (slotId) { const old = S.course(courseId); old.schedule = old.schedule.filter((x) => x.id !== slotId); }
              S.course(g('course')).schedule.push({ id: slotId || u.uid(), ...data });
            });
            return true;
          },
        },
      ].filter(Boolean),
    });
  }

  // keep the "now" line fresh while the page is open
  setInterval(() => { if (/^#\/schedule/.test(location.hash) && !document.querySelector('.modal-backdrop')) CT.app.rerender(); }, 60000);
})(window.CT);
