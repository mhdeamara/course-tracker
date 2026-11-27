/* timer.js — optional Pomodoro / stopwatch that logs study minutes per course into state.studyLog.
 * The running timer lives in localStorage ('ct.timer') so it survives a page reload. */
(function (CT) {
  'use strict';
  const { u, ui } = CT;
  const S = CT.store;
  const esc = u.esc, icon = u.icon, I = CT.i18n;
  const L = (k, p) => I.t(k, p), LX = (k, p) => I.tx(k, p);
  const KEY = 'ct.timer';
  const T = {};
  CT.timer = T;

  let t = null;          // { courseId, mode: 'pomo'|'free', phase: 'work'|'break', running, startedAt, acc }
  let panel = null;      // open modal api
  const baseTitle = () => CT.i18n.tx('app.name'); // follows the interface language

  const load = () => { try { t = JSON.parse(localStorage.getItem(KEY)); } catch (e) { t = null; } };
  const save = () => { try { localStorage.setItem(KEY, JSON.stringify(t)); } catch (e) { /* ignore */ } };
  const fresh = () => ({ courseId: (S.activeCourses()[0] || {}).id || '', mode: 'pomo', phase: 'work', running: false, startedAt: null, acc: 0 });
  const elapsed = () => (t ? t.acc + (t.running ? Date.now() - t.startedAt : 0) : 0);
  const target = () => { const p = S.state.settings.pomodoro; return (t.phase === 'work' ? p.work : p.brk) * 60000; };
  const mmss = (ms) => { const s = Math.max(0, Math.round(ms / 1000)); return `${u.pad(Math.floor(s / 60))}:${u.pad(s % 60)}`; };
  const display = () => (t.mode === 'pomo' ? mmss(target() - elapsed()) : mmss(elapsed()));
  const active = () => t && (t.running || t.acc > 0);
  /** True while the timer is counting (work or break) — reminders wait until it stops. */
  T.busy = () => !!(t && t.running);

  T.log = (courseId, minutes, date = u.today()) => {
    minutes = Math.round(minutes);
    if (!courseId || minutes < 1) return;
    S.commit(LX('tmr.u.log'), (st) => st.studyLog.push({ id: u.uid(), courseId, date, minutes }));
  };

  function beep() {
    try {
      const ctx = new (window.AudioContext || window.webkitAudioContext)();
      [0, 0.25, 0.5].forEach((d) => {
        const o = ctx.createOscillator(), g = ctx.createGain();
        o.frequency.value = 880; o.connect(g); g.connect(ctx.destination);
        g.gain.setValueAtTime(0.0001, ctx.currentTime + d);
        g.gain.exponentialRampToValueAtTime(0.2, ctx.currentTime + d + 0.02);
        g.gain.exponentialRampToValueAtTime(0.0001, ctx.currentTime + d + 0.2);
        o.start(ctx.currentTime + d); o.stop(ctx.currentTime + d + 0.22);
      });
    } catch (e) { /* audio not available */ }
  }

  function tick() {
    if (!t) return;
    if (t.running && t.mode === 'pomo' && elapsed() >= target()) {
      const p = S.state.settings.pomodoro;
      beep();
      if (t.phase === 'work') {
        T.log(t.courseId, p.work);
        Object.assign(t, { phase: 'break', acc: 0, startedAt: Date.now(), running: true });
        ui.toast(LX('tmr.sessionDone', { work: ui.minutes(p.work), brk: ui.minutes(p.brk) }), { ms: 8000 });
      } else {
        Object.assign(t, { phase: 'work', acc: 0, startedAt: null, running: false });
        ui.toast(LX('tmr.breakOver'), { ms: 8000 });
      }
      save();
    }
    T.renderChip();
    if (panel) drawPanel();
    document.title = t.running ? `${display()} · ${baseTitle()}` : baseTitle();
  }

  T.init = () => { load(); setInterval(tick, 1000); tick(); };

  T.renderChip = () => {
    const slot = document.getElementById('timer-slot');
    if (!slot) return;
    if (active()) {
      const c = S.course(t.courseId);
      slot.innerHTML = `<button class="timer-chip${t.running ? ' running' : ''}${t.phase === 'break' ? ' break' : ''}" style="--c:${esc(c ? c.color : 'var(--accent)')}" aria-label="${CT.i18n.t('timer.chip', { time: display() })}">
        ${icon.timer} <span dir="ltr">${display()}</span></button>`;
    } else {
      const label = CT.i18n.t('timer.open');
      slot.innerHTML = `<button class="icon-btn" aria-label="${label}" title="${label}">${icon.timer}</button>`;
    }
    slot.firstElementChild.onclick = T.open;
  };

  /* ---------- actions ---------- */
  const start = () => { if (!t.courseId) { ui.toast(LX('tmr.pickCourse')); return; } t.running = true; t.startedAt = Date.now(); save(); tick(); };
  const pause = () => { t.acc = elapsed(); t.running = false; t.startedAt = null; save(); tick(); };
  const stop = () => {
    const ms = elapsed();
    if (t.phase === 'work' && ms >= 60000) {
      T.log(t.courseId, ms / 60000);
      const cn = (S.course(t.courseId) || {}).name;
      ui.toast(cn ? LX('tmr.logged', { min: ui.minutes(Math.round(ms / 60000)), name: I.iso(cn) }) : LX('tmr.loggedNo', { min: ui.minutes(Math.round(ms / 60000)) }));
    }
    Object.assign(t, { phase: 'work', running: false, startedAt: null, acc: 0 });
    save(); tick();
  };

  /* ---------- panel ---------- */
  T.open = () => {
    if (!t) t = fresh();
    if (!S.course(t.courseId) || S.course(t.courseId).archived) t.courseId = (S.activeCourses()[0] || {}).id || '';
    panel = ui.modal({ title: LX('tmr.title'), localized: true, body: '<div class="timer-panel"></div>', onClose: () => { panel = null; } });
    drawPanel(true);
    panel.body.addEventListener('click', onPanelClick);
    panel.body.addEventListener('change', onPanelChange);
  };

  function drawPanel(full) {
    const box = panel.body.querySelector('.timer-panel');
    const p = S.state.settings.pomodoro;
    if (!full && box.dataset.ready) {
      box.querySelector('.timer-big').textContent = display();
      box.querySelector('.timer-phase').textContent = phaseText();
      box.querySelector('.timer-btns').innerHTML = btns();
      return;
    }
    const courses = S.activeCourses();
    const todayLog = S.state.studyLog.filter((e) => e.date === u.today());
    box.dataset.ready = '1';
    box.innerHTML = `
      <div class="form-grid">
        <label class="field"><span>${L('gpa.course')}</span><select name="course" ${t.running ? 'disabled' : ''}>${courses.map((c) => `<option value="${esc(c.id)}" ${c.id === t.courseId ? 'selected' : ''}>${esc(c.name)}</option>`).join('')}</select></label>
        <label class="field"><span>${L('tmr.mode')}</span><select name="mode" ${active() ? 'disabled' : ''}>
          <option value="pomo" ${t.mode === 'pomo' ? 'selected' : ''}>${L('tmr.pomo', { work: p.work, brk: p.brk })}</option>
          <option value="free" ${t.mode === 'free' ? 'selected' : ''}>${L('tmr.free')}</option></select></label>
      </div>
      <div class="timer-big" dir="ltr" aria-live="off">${display()}</div>
      <div class="timer-phase muted">${phaseText()}</div>
      <div class="timer-btns">${btns()}</div>
      <details class="manual">
        <summary>${L('tmr.manual')}</summary>
        <div class="manual-row">
          <input type="number" name="mmin" min="1" max="600" placeholder="${L('tmr.minutes')}" aria-label="${L('tmr.minutes')}">
          <input type="date" name="mdate" value="${u.today()}" aria-label="${L('tmr.date')}">
          <button class="btn" data-a="manual">${L('tmr.add')}</button>
        </div>
      </details>
      ${todayLog.length ? `<h3>${L('rel.today')}</h3><ul class="log-list">${todayLog.map((e) => {
        const c = S.course(e.courseId);
        return `<li>${c ? ui.courseDot(c) + ' <span dir="auto">' + esc(c.name) + '</span>' : L('tmr.deleted')} · ${esc(ui.minutes(e.minutes))} <button class="icon-btn" data-a="dellog" data-id="${esc(e.id)}" aria-label="${L('tmr.delLog')}">${icon.trash}</button></li>`;
      }).join('')}</ul>` : ''}`;
  }

  const phaseText = () => LX(t.mode === 'free' ? (t.running ? 'tmr.ph.counting' : active() ? 'tmr.ph.paused' : 'tmr.ph.ready')
    : t.phase === 'break' ? 'tmr.ph.break' : t.running ? 'tmr.ph.focus' : active() ? 'tmr.ph.paused' : 'tmr.ph.readySession');

  const btns = () => {
    if (t.running) return `<button class="btn" data-a="pause">${icon.pause} ${L('tmr.pauseBtn')}</button><button class="btn btn-primary" data-a="stop">${icon.stop} ${L('tmr.stop')}</button>`;
    if (active()) return `<button class="btn btn-primary" data-a="start">${icon.play} ${L('tmr.resume')}</button><button class="btn" data-a="stop">${icon.stop} ${L('tmr.stop')}</button>`;
    return `<button class="btn btn-primary" data-a="start">${icon.play} ${L('tmr.start')}</button>`;
  };

  function onPanelClick(e) {
    const a = e.target.closest('[data-a]');
    if (!a) return;
    const act = a.dataset.a;
    if (act === 'start') start();
    if (act === 'pause') pause();
    if (act === 'stop') { stop(); drawPanel(true); }
    if (act === 'manual') {
      const min = Number(panel.body.querySelector('[name=mmin]').value);
      const date = panel.body.querySelector('[name=mdate]').value || u.today();
      if (!(min > 0)) return;
      T.log(t.courseId, min, date);
      ui.toast(LX('tmr.added', { min: ui.minutes(min) }));
      drawPanel(true);
    }
    if (act === 'dellog') {
      S.commit(LX('tmr.u.del'), (st) => { st.studyLog = st.studyLog.filter((x) => x.id !== a.dataset.id); });
      drawPanel(true);
    }
    if (act !== 'manual' && act !== 'dellog') drawPanel(true);
  }
  function onPanelChange(e) {
    if (e.target.name === 'course') t.courseId = e.target.value;
    if (e.target.name === 'mode') t.mode = e.target.value;
    save(); tick();
  }
})(window.CT);
