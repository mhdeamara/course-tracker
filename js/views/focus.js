/* views/focus.js — help to start: "רק 5 דקות", a minimal focus screen, and subtasks.
 * Starting earns points (game.js, "start"), the minutes go to the study log like the timer's, and each
 * subtask checked off earns a little. The running session lives in localStorage ('ct.focus') so a reload keeps it. */
(function (CT) {
  'use strict';
  const { u, ui, store: S } = CT;
  const esc = u.esc, icon = u.icon;
  const KEY = 'ct.focus';
  const F = {};

  let f = null; // { itemId, startedAt, acc, running, target (minutes), asked }
  let el = null;
  let timer = null;

  const load = () => { try { f = JSON.parse(localStorage.getItem(KEY)); } catch (e) { f = null; } };
  const save = () => { try { if (f) localStorage.setItem(KEY, JSON.stringify(f)); else localStorage.removeItem(KEY); } catch (e) { /* ignore */ } };
  const elapsed = () => (f ? f.acc + (f.running ? Date.now() - f.startedAt : 0) : 0);
  const left = () => f.target * 60000 - elapsed();
  const mmss = (ms) => { const s = Math.max(0, Math.round(ms / 1000)); return `${u.pad(Math.floor(s / 60))}:${u.pad(s % 60)}`; };
  const motionOk = () => !(CT.app && CT.app.reducedMotion && CT.app.reducedMotion());

  /* ---------- subtasks (shared by the focus screen and the subtasks window) ---------- */
  F.subsHTML = (item) => {
    const subs = item.subs || [];
    const done = subs.filter((x) => x.done).length;
    return `<div class="subs" data-item="${esc(item.id)}">
        ${subs.length ? `<p class="subs-count muted small">${done}/${subs.length} תתי-משימות</p>` : '<p class="muted small subs-count">פרקו את זה לצעדים קטנים — כל צעד שמסמנים שווה נקודות.</p>'}
        <ul class="subs-list">${subs.map((x) => `<li class="sub${x.done ? ' done' : ''}">
            <label><input type="checkbox" data-sub="${esc(x.id)}" ${x.done ? 'checked' : ''}><span dir="auto">${esc(x.t)}</span></label>
            <button class="icon-btn" data-subdel="${esc(x.id)}" aria-label="מחק תת-משימה: ${esc(x.t)}">${icon.trash}</button></li>`).join('')}</ul>
        <form class="sub-add" data-subadd><input name="t" dir="auto" maxlength="140" placeholder="צעד קטן הבא… (Enter)" aria-label="תת-משימה חדשה" autocomplete="off"><button class="btn btn-small">${icon.plus}<span>הוסף</span></button></form>
      </div>`;
  };

  /** Wires a container that holds subsHTML(); `redraw` repaints it after each change. */
  F.bindSubs = (root, redraw) => {
    root.addEventListener('change', (e) => {
      const cb = e.target.closest('[data-sub]');
      if (!cb) return;
      const id = cb.closest('.subs').dataset.item;
      S.commit(cb.checked ? 'סימון תת-משימה' : 'ביטול תת-משימה', () => {
        const x = S.findItem(id);
        const sb = x && (x.item.subs || []).find((s) => s.id === cb.dataset.sub);
        if (sb) sb.done = cb.checked;
        if (x && cb.checked && x.item.status === 'todo') x.item.status = 'doing';
      });
      redraw();
    });
    root.addEventListener('click', (e) => {
      const del = e.target.closest('[data-subdel]');
      if (!del) return;
      const id = del.closest('.subs').dataset.item;
      S.commit('מחיקת תת-משימה', () => {
        const x = S.findItem(id);
        if (x) x.item.subs = (x.item.subs || []).filter((s) => s.id !== del.dataset.subdel);
      });
      redraw();
    });
    root.addEventListener('submit', (e) => {
      const form = e.target.closest('[data-subadd]');
      if (!form) return;
      e.preventDefault();
      const t = form.t.value.trim();
      if (!t) return;
      const id = form.closest('.subs').dataset.item;
      S.commit('הוספת תת-משימה', () => {
        const x = S.findItem(id);
        if (x) (x.item.subs = x.item.subs || []).push({ id: u.uid(), t, done: false });
      });
      redraw();
      const again = root.querySelector(`.subs[data-item="${id}"] [data-subadd] input`);
      if (again) again.focus();
    });
  };

  /** Subtasks in a small window (from the course page). */
  F.openSubs = (itemId) => {
    const x = S.findItem(itemId);
    if (!x) return;
    const m = ui.modal({ title: `תתי-משימות · ${x.item.title}`, body: '<div class="subs-box"></div>', actions: [{ label: 'סגור', primary: true }] });
    const box = m.body.querySelector('.subs-box');
    const draw = () => { const y = S.findItem(itemId); if (y) box.innerHTML = F.subsHTML(y.item); };
    draw();
    F.bindSubs(box, draw);
    const inp = box.querySelector('[data-subadd] input');
    if (inp) inp.focus();
  };

  /* ---------- focus session ---------- */
  /** "רק 5 דקות" (or any length): marks the start (points), opens the focus screen. */
  F.start = (itemId, minutes = 5) => {
    const x = S.findItem(itemId);
    if (!x) return;
    if (f && f.itemId !== itemId) finish(false); // one session at a time: save the previous one first
    S.commit('התחלת סשן מיקוד', (st) => {
      const y = S.findItem(itemId);
      if (y.item.status === 'todo') y.item.status = 'doing';
      if (CT.game) {
        const gm = CT.game.ensure(st);
        gm.starts.push({ id: u.uid(), itemId, d: CT.game.dayKey(), label: y.item.title });
        if (gm.starts.length > 500) gm.starts.splice(0, gm.starts.length - 500);
      }
    });
    if (!f || f.itemId !== itemId) f = { itemId, startedAt: Date.now(), acc: 0, running: true, target: minutes, asked: false };
    else Object.assign(f, { running: true, startedAt: Date.now(), target: Math.max(f.target, minutes) });
    save();
    open();
  };

  /** Ends the session: logs the minutes (≥ 1) to the study log. `markDone` also checks the item off. */
  function finish(markDone) {
    if (!f) return;
    const x = S.findItem(f.itemId);
    const min = Math.floor(elapsed() / 60000);
    f = null; save();
    clearInterval(timer); timer = null;
    if (x && min >= 1 && CT.timer) CT.timer.log(x.course.id, min);
    if (x && markDone && x.item.status !== 'done') {
      if (CT.ui) CT.ui.justChecked = x.item.id;
      S.toggleDone(x.item.id);
    }
    close();
    if (x && min >= 1) ui.toast(`נרשמו ${u.fmtMinutes(min)} ל${x.course.name}`);
  }

  function close() {
    if (!el) return;
    document.removeEventListener('keydown', onKey);
    const prev = el; el = null;
    prev.classList.add('out');
    setTimeout(() => prev.remove(), 200);
    if (F.prevFocus && F.prevFocus.focus) F.prevFocus.focus();
  }

  function ring(pct) {
    const r = 54, c = 2 * Math.PI * r;
    return `<svg class="fx-ring" viewBox="0 0 120 120" aria-hidden="true">
        <circle cx="60" cy="60" r="${r}" class="fx-ring-bg"/>
        <circle cx="60" cy="60" r="${r}" class="fx-ring-fg" stroke-dasharray="${c}" stroke-dashoffset="${c * (1 - pct)}"/></svg>`;
  }

  function draw(full) {
    if (!el || !f) return;
    const x = S.findItem(f.itemId);
    if (!x) { finish(false); return; }
    const over = left() <= 0;
    if (over && f.running && !f.asked) {
      f.asked = true; f.acc = elapsed(); f.running = false; f.startedAt = null; save();
      if (CT.app && CT.app.sound && CT.app.sound()) chime();
    }
    const pct = Math.min(1, elapsed() / (f.target * 60000));
    const time = el.querySelector('.fx-time');
    if (!full && time) {
      time.textContent = mmss(left());
      el.querySelector('.fx-ring-wrap').innerHTML = ring(pct);
      return;
    }
    const it = x.item;
    el.innerHTML = `
      <div class="fx-box" style="--c:${esc(x.course.color)}">
        <button class="icon-btn fx-close" data-fx="exit" aria-label="יציאה ממצב מיקוד (Esc)">${icon.close}</button>
        <p class="fx-course"><span class="dot"></span><span dir="auto">${esc(x.course.name)}</span> · ${esc(x.cat.name)}</p>
        <h2 class="fx-title" id="fx-title" dir="auto">${esc(it.title)}</h2>
        <div class="fx-clock">
          <div class="fx-ring-wrap">${ring(pct)}</div>
          <div class="fx-time" dir="ltr" aria-live="off">${mmss(left())}</div>
        </div>
        ${f.asked ? `<p class="fx-msg" role="status">${f.target <= 5 ? 'עברו 5 דקות — התחלת, וזה החלק הקשה. להמשיך עוד קצת?' : 'הזמן נגמר. כל הכבוד על הריכוז!'}</p>` : `<p class="fx-msg muted">${f.running ? (f.target <= 5 ? 'רק 5 דקות. אחר כך מחליטים.' : 'זמן ריכוז. הטלפון יכול לחכות.') : 'מושהה'}</p>`}
        <div class="fx-btns">
          ${f.asked
            ? `<button class="btn btn-primary btn-lg" data-fx="more" data-min="10">עוד 10 דקות</button><button class="btn btn-lg" data-fx="more" data-min="25">עוד 25</button>`
            : f.running ? `<button class="btn btn-lg" data-fx="pause">${icon.pause}<span>השהה</span></button>` : `<button class="btn btn-primary btn-lg" data-fx="resume">${icon.play}<span>המשך</span></button>`}
          <button class="btn btn-lg ${f.asked ? '' : 'btn-primary'}" data-fx="done">${icon.check}<span>סיימתי את זה</span></button>
          <button class="btn btn-ghost btn-lg" data-fx="exit">${f.asked ? 'מספיק לעכשיו' : 'יציאה'}</button>
        </div>
        <details class="fx-subs"${(it.subs || []).length ? ' open' : ''}><summary>תתי-משימות${(it.subs || []).length ? ` · ${(it.subs || []).filter((s) => s.done).length}/${it.subs.length}` : ''}</summary>
          <div class="fx-subs-body">${F.subsHTML(it)}</div></details>
      </div>`;
  }

  function chime() {
    try {
      const ctx = new (window.AudioContext || window.webkitAudioContext)();
      [523.25, 783.99].forEach((hz, i) => {
        const o = ctx.createOscillator(), g = ctx.createGain();
        o.frequency.value = hz; o.connect(g).connect(ctx.destination);
        const t = ctx.currentTime + i * 0.15;
        g.gain.setValueAtTime(0.0001, t); g.gain.exponentialRampToValueAtTime(0.1, t + 0.02); g.gain.exponentialRampToValueAtTime(0.0001, t + 0.4);
        o.start(t); o.stop(t + 0.42);
      });
      setTimeout(() => ctx.close(), 1000);
    } catch (e) { /* no audio */ }
  }

  function onKey(e) {
    if (e.key === 'Escape' && !(e.target.closest && e.target.closest('input'))) { e.preventDefault(); finish(false); }
    if (e.key === 'Tab' && el) { // keep keyboard focus inside the focus screen
      const items = [...el.querySelectorAll('button, input, summary, [href]')].filter((n) => !n.disabled && n.offsetParent);
      if (!items.length) return;
      const first = items[0], last = items[items.length - 1];
      if (e.shiftKey && document.activeElement === first) { e.preventDefault(); last.focus(); }
      else if (!e.shiftKey && document.activeElement === last) { e.preventDefault(); first.focus(); }
    }
  }

  function open() {
    if (!f) return;
    if (!el) {
      F.prevFocus = document.activeElement;
      el = document.createElement('div');
      el.className = 'focus-screen' + (motionOk() ? '' : ' still');
      el.setAttribute('role', 'dialog');
      el.setAttribute('aria-modal', 'true');
      el.setAttribute('aria-labelledby', 'fx-title');
      document.body.appendChild(el);
      el.addEventListener('click', onClick);
      F.bindSubs(el, () => draw(true));
      document.addEventListener('keydown', onKey);
    }
    draw(true);
    const first = el.querySelector('[data-fx="pause"], [data-fx="more"], [data-fx="resume"]');
    if (first) first.focus();
    clearInterval(timer);
    timer = setInterval(() => draw(false), 1000);
  }

  function onClick(e) {
    const b = e.target.closest('[data-fx]');
    if (!b) return;
    const a = b.dataset.fx;
    if (a === 'exit') return finish(false);
    if (a === 'done') return finish(true);
    if (a === 'pause') { f.acc = elapsed(); f.running = false; f.startedAt = null; }
    if (a === 'resume') { f.running = true; f.startedAt = Date.now(); }
    if (a === 'more') { f.target = Math.ceil(elapsed() / 60000) + Number(b.dataset.min); f.asked = false; f.running = true; f.startedAt = Date.now(); }
    save(); draw(true);
    const next = el && el.querySelector('[data-fx="pause"], [data-fx="resume"]');
    if (next) next.focus();
  }

  /** A session that was running before a reload comes back. */
  F.init = () => { load(); if (f && S.findItem(f.itemId)) open(); else { f = null; save(); } };
  F.active = () => !!f;

  CT.focus = F;
})(window.CT);
