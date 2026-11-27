/* views/schedule.js — weekly timetable (Sun–Thu), colored by course, with "now" and "next" highlights. */
(function (CT) {
  'use strict';
  const { u, ui } = CT;
  const S = CT.store, M = CT.model, I = CT.i18n;
  const esc = u.esc, icon = u.icon;
  const t = (k, p) => I.t(k, p), tx = (k, p) => I.tx(k, p);
  const V = {};
  CT.views = CT.views || {};
  CT.views.schedule = V;

  const HOUR_PX = 54;
  const typeLabel = (k) => (M.SLOT_TYPES[k] ? tx('slot.' + k) : '');
  const day = (d) => ui.dayName(d, 'long');

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
    const { day: dd, min } = nowInfo();
    const now = slots.find((x) => x.slot.day === dd && u.timeToMin(x.slot.start) <= min && min < u.timeToMin(x.slot.end)) || null;
    let next = null;
    for (let k = 0; k < 7 && !next; k++) {
      const d = (dd + k) % 7;
      const cands = slots.filter((x) => x.slot.day === d && (k > 0 || u.timeToMin(x.slot.start) > min))
        .sort((a, b) => u.timeToMin(a.slot.start) - u.timeToMin(b.slot.start));
      if (cands[0]) next = { ...cands[0], inDays: k };
    }
    return { now, next };
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
    const time = (s) => `<span dir="ltr">${esc(s.start)}–${esc(s.end)}</span>`;

    const block = (x) => {
      const isNow = now && now.slot.id === x.slot.id, isNext = next && next.slot.id === x.slot.id;
      return `<button class="slot${isNow ? ' now' : ''}${isNext ? ' next' : ''}" data-id="${esc(x.slot.id)}" data-course="${esc(x.course.id)}"
        style="--c:${esc(x.course.color)};top:${top(u.timeToMin(x.slot.start))}px;height:${Math.max(22, top(u.timeToMin(x.slot.end)) - top(u.timeToMin(x.slot.start)) - 3)}px"
        aria-label="${t('sch.slotLabel', { name: I.iso(x.course.name), type: typeLabel(x.slot.type), day: day(x.slot.day), from: x.slot.start, to: x.slot.end })}">
        <b dir="auto">${esc(x.course.name)}</b>
        <span>${esc(typeLabel(x.slot.type))} · ${time(x.slot)}</span>
        ${x.slot.room ? `<span dir="auto">${esc(x.slot.room)}</span>` : ''}
        ${isNow ? `<em>${t('td.now')}</em>` : isNext ? `<em>${t('sch.next')}</em>` : ''}
      </button>`;
    };

    const hours = [];
    for (let h = minH; h < maxH; h++) hours.push(h);

    root.innerHTML = `
      <div class="schedule page-wide">
        <div class="section-head" style="margin-top:0">
          <h1>${t('sch.title')}</h1>
          <button class="btn btn-primary" data-action="add">${icon.plus} ${t('sch.add')}</button>
        </div>
        ${slots.length ? '' : `<p class="muted">${t('sch.empty')}</p>`}
        <div class="card sched-grid" style="--cols:${days.length}">
          <div class="sg-head"><span></span>${days.map((d) => `<span class="${d === today ? 'today' : ''}">${esc(day(d))}</span>`).join('')}</div>
          <div class="sg-body" style="height:${(maxH - minH) * HOUR_PX}px">
            <div class="sg-hours" dir="ltr">${hours.map((h) => `<span style="top:${(h - minH) * HOUR_PX}px">${u.pad(h)}:00</span>`).join('')}</div>
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
            return `<section class="card${d === today ? ' today' : ''}"><h3>${esc(day(d))}${d === today ? ` · ${t('rel.today')}` : ''}</h3>
              ${ds.map((x) => `<button class="slot-row${now && now.slot.id === x.slot.id ? ' now' : ''}${next && next.slot.id === x.slot.id ? ' next' : ''}" data-id="${esc(x.slot.id)}" data-course="${esc(x.course.id)}" style="--c:${esc(x.course.color)}">
                <span class="nowrap">${time(x.slot)}</span><b dir="auto">${esc(x.course.name)}</b>
                <span class="muted small">${esc(typeLabel(x.slot.type))}${x.slot.room ? ` · <span dir="auto">${esc(x.slot.room)}</span>` : ''}</span></button>`).join('') || `<p class="muted small">${t('sch.none')}</p>`}
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
    if (!courses.length) { ui.toast(tx('sch.needCourse')); return; }
    const c = courseId && S.course(courseId);
    const s = (c && c.schedule.find((x) => x.id === slotId)) || { day: 0, start: '10:30', end: '12:30', type: 'lecture', room: '' };
    ui.modal({
      title: tx(slotId ? 'sch.editTitle' : 'sch.newTitle'),
      localized: true,
      body: `<div class="form-grid">
        <label class="field span-2"><span>${t('gpa.course')}</span><select name="course">${courses.map((x) => `<option value="${esc(x.id)}" ${x.id === courseId ? 'selected' : ''}>${esc(x.name)}</option>`).join('')}</select></label>
        <label class="field"><span>${t('sch.type')}</span><select name="type">${Object.keys(M.SLOT_TYPES).map((k) => `<option value="${k}" ${k === s.type ? 'selected' : ''}>${esc(typeLabel(k))}</option>`).join('')}</select></label>
        <label class="field"><span>${t('sch.day')}</span><select name="day">${[0, 1, 2, 3, 4, 5].map((d) => `<option value="${d}" ${d === s.day ? 'selected' : ''}>${esc(day(d))}</option>`).join('')}</select></label>
        <label class="field"><span>${t('sch.start')}</span><input type="time" name="start" value="${esc(s.start)}" step="900"></label>
        <label class="field"><span>${t('sch.end')}</span><input type="time" name="end" value="${esc(s.end)}" step="900"></label>
        <label class="field span-2"><span>${t('sch.room')}</span><input name="room" dir="auto" value="${esc(s.room)}" placeholder="${t('sch.roomPh')}"></label>
      </div>`,
      actions: [
        slotId && { label: tx('cp.deleteOk'), danger: true, fn: () => S.commit(tx('sch.u.del'), () => { const cc = S.course(courseId); cc.schedule = cc.schedule.filter((x) => x.id !== slotId); }) },
        { label: tx('common.cancel') },
        {
          label: tx('common.save'), primary: true, fn: (m) => {
            const g = (n) => m.body.querySelector(`[name=${n}]`).value;
            if (u.timeToMin(g('end')) <= u.timeToMin(g('start'))) { ui.toast(tx('sch.badTime'), { error: true }); return false; }
            const data = { day: Number(g('day')), start: g('start'), end: g('end'), type: g('type'), room: g('room').trim() };
            S.commit(tx(slotId ? 'sch.u.edit' : 'sch.u.add'), () => {
              if (slotId) { const old = S.course(courseId); old.schedule = old.schedule.filter((x) => x.id !== slotId); }
              S.course(g('course')).schedule.push({ id: slotId || u.uid(), ...data });
            });
            return true;
          },
        },
      ].filter(Boolean),
    });
  }

  // keep the "now" line fresh while the page is open (not while a dialog is open or a control has focus)
  setInterval(() => {
    if (!/^#\/schedule/.test(location.hash) || document.querySelector('.modal-backdrop')) return;
    const a = document.activeElement;
    const sel = a && a.closest && a.closest('#main') && a.dataset && a.dataset.id ? `[data-id="${CSS.escape(a.dataset.id)}"]${a.classList.contains('slot') ? '.slot' : '.slot-row'}` : null;
    CT.app.rerender();
    const back = sel && document.querySelector(sel);
    if (back) back.focus({ preventScroll: true });
  }, 60000);
})(window.CT);
