/* store.js — single source of truth: load/save to localStorage, change notifications, undo. */
(function (CT) {
  'use strict';
  const KEY = 'ct.data.v1';
  const UNDO_MAX = 40;
  const s = { state: null, undoStack: [], listeners: [], lastCoalesce: null };

  s.load = () => {
    let raw = null;
    try { raw = localStorage.getItem(KEY); } catch (e) { console.warn('localStorage unavailable', e); }
    if (raw) {
      try {
        const parsed = JSON.parse(raw);
        // saved by a newer app version, or a malformed schema version: read-only, the stored text is never touched
        const cls = CT.model.classify(parsed);
        if (cls !== 'ok' && CT.guard) {
          s.state = CT.guard.lockLocal(raw, parsed, cls);
          return 'locked';
        }
        // before the first automatic upgrade to a newer schema: keep an untouched copy (only once)
        if ((Number(parsed.version) || 1) < CT.model.VERSION) {
          try { if (!localStorage.getItem(CT.model.BACKUP_KEY)) localStorage.setItem(CT.model.BACKUP_KEY, raw); } catch (_) { /* storage full: upgrade anyway */ }
        }
        s.state = CT.model.migrate(parsed);
        if (CT.game) CT.game.reconcile(s.state);
        s.persist(true); // save any one-time upgrades (dates, colors, cleanup) right away
        return restoreLock() || 'loaded';
      } catch (e) {
        console.error('Corrupt data, keeping a copy', e);
        let kept = false;
        try { localStorage.setItem(KEY + '.corrupt-' + Date.now(), raw); kept = true; } catch (_) { /* storage full */ }
        // no copy could be kept: never write over the only one — read-only instead
        if (!kept && CT.guard) { s.state = CT.guard.lockLocal(raw, undefined, 'malformed'); return 'locked'; }
        try { localStorage.removeItem(KEY); } catch (_) { /* the write below then fails the same way */ }
      }
    }
    s.state = CT.model.initialData();
    s.persist();
    return restoreLock() || 'new';
  };
  /** A lock from the cloud in an earlier run (newer data, kept per account): show that copy, read-only. Works offline. */
  function restoreLock() {
    const view = CT.guard ? CT.guard.restore(s.state) : null;
    if (!view) return null;
    s.state = view;
    return 'locked';
  }

  /** Writes state to localStorage. `noAuto` skips the auto file-backup (used by the backup itself).
   *  Returns false when nothing was written: read-only lock, or another tab saved data this version must not overwrite. */
  s.persist = (noAuto) => {
    const G = CT.guard;
    if (G && G.locked()) { G.nudge(); return false; }
    if (G) { // write boundary: what is stored now may come from a newer app in another tab
      let cur = null;
      try { cur = localStorage.getItem(KEY); } catch (e) { /* unavailable: the write below fails the same way */ }
      if (cur) {
        const r = G.classifyRaw(cur);
        if (r.cls !== 'ok') { s.state = G.lockLocal(cur, r.data, r.cls); s.emit(); return false; }
      }
    }
    s.state.meta.updatedAt = new Date().toISOString();
    try { localStorage.setItem(KEY, JSON.stringify(s.state)); } catch (e) {
      console.error(e);
      if (CT.ui) CT.ui.toast(CT.i18n ? CT.i18n.tx('store.saveFailed') : 'השמירה בדפדפן נכשלה — כדאי לייצא גיבוי עכשיו', { error: true });
    }
    if (!noAuto && CT.backup) CT.backup.scheduleAutoSave();
    if (!noAuto && CT.cloud) CT.cloud.onLocalChange();
    return true;
  };
  /** Read-only lock: throw before anything changes (callers' follow-ups — toasts, "בטל" — don't run either). */
  const guardWrite = () => {
    if (CT.guard && CT.guard.locked()) { CT.guard.nudge(); throw CT.guard.lockedError(); }
  };

  /**
   * Every change goes through commit(): snapshot for undo → mutate → save → re-render.
   * opts.silent: don't re-render (typing in notes). opts.coalesce: key — repeated edits
   * with the same key within 4s share one undo step. opts.undo=false: no undo snapshot.
   */
  s.commit = (label, fn, opts = {}) => {
    guardWrite();
    const now = Date.now();
    const same = opts.coalesce && s.lastCoalesce && s.lastCoalesce.key === opts.coalesce && now - s.lastCoalesce.t < 4000;
    if (opts.undo !== false && !same) {
      s.undoStack.push({ label, snap: JSON.stringify(s.state) });
      if (s.undoStack.length > UNDO_MAX) s.undoStack.shift();
    }
    s.lastCoalesce = opts.coalesce ? { key: opts.coalesce, t: now } : null;
    const result = fn(s.state);
    const awards = CT.game ? CT.game.sync(s.state) : null; // points follow the change (see game.js)
    s.persist();
    if (!opts.silent) s.emit();
    if (awards && CT.game.notify) CT.game.notify(awards);
    return result;
  };

  /** Replace the whole state (import / reset) — undoable. */
  s.replace = (newState, label) => {
    guardWrite();
    s.undoStack.push({ label, snap: JSON.stringify(s.state) });
    s.state = newState;
    if (CT.game) CT.game.reconcile(s.state);
    s.persist();
    s.emit();
  };

  s.undo = () => {
    if (CT.guard && CT.guard.locked()) { CT.guard.nudge(); return; }
    const e = s.undoStack.pop();
    if (!e) { CT.ui.toast(CT.i18n ? CT.i18n.tx('store.nothingToUndo') : 'אין פעולה לביטול'); return; }
    const cur = s.state;
    s.state = JSON.parse(e.snap);
    if (CT.game && CT.game.carry) CT.game.carry(cur, s.state); // redemptions are final: undo never refunds them
    s.lastCoalesce = null;
    s.persist();
    s.emit();
    CT.ui.toast(CT.i18n ? CT.i18n.tx('common.undone', { label: e.label || '' }) : `בוטל: ${e.label}`);
  };

  s.subscribe = (fn) => s.listeners.push(fn);
  s.emit = () => s.listeners.forEach((fn) => fn(s.state));

  /* ---------- lookups ---------- */
  s.course = (id) => s.state.courses.find((c) => c.id === id);
  /** Courses of the active semester (and ones without a semester): not archived, not past "record" courses. */
  s.semesterCourses = () => {
    const act = s.state.settings.activeSemesterId;
    const known = act && s.state.semesters.some((x) => x.id === act);
    return s.state.courses.filter((c) => !c.archived && c.kind !== 'record' && (!known || !c.semesterId || c.semesterId === act));
  };
  /** What the dashboard's urgent list, countdown, timetable, review and timer use: active semester, not finished. */
  s.activeCourses = () => s.semesterCourses().filter((c) => !CT.model.isFinished(c));
  s.semester = (id) => s.state.semesters.find((x) => x.id === id);
  s.findItem = (itemId) => {
    for (const course of s.state.courses) {
      for (const cat of course.categories) {
        const item = cat.items.find((i) => i.id === itemId);
        if (item) return { course, cat, item };
      }
    }
    return null;
  };
  s.findCat = (catId) => {
    for (const course of s.state.courses) {
      const cat = course.categories.find((c) => c.id === catId);
      if (cat) return { course, cat };
    }
    return null;
  };
  s.courseTags = (course) => {
    const set = new Set();
    course.categories.forEach((c) => c.items.forEach((i) => i.tags.forEach((t) => set.add(t))));
    return [...set].sort();
  };

  /* ---------- common mutations ---------- */
  s.setStatus = (itemId, status) => s.commit(CT.i18n ? CT.i18n.tx('store.u.status') : 'שינוי סטטוס', () => {
    const f = s.findItem(itemId);
    if (!f) return;
    if (status === 'done' && f.item.status === 'review') f.item.fromReview = true; // closing a "צריך לחזור" earns a bonus
    else if (status !== 'done') delete f.item.fromReview;
    f.item.status = status;
    f.item.completedAt = status === 'done' ? (f.item.completedAt || new Date().toISOString()) : null;
  });
  s.toggleDone = (itemId) => {
    const f = s.findItem(itemId);
    if (!f) return;
    const next = f.item.status === 'done' ? 'todo' : 'done';
    if (next === 'done' && CT.ui) CT.ui.justChecked = itemId;
    s.setStatus(itemId, next);
  };

  CT.store = s;
})(window.CT);
