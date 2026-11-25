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
        // before the first automatic upgrade to a newer schema: keep an untouched copy (only once)
        if ((Number(parsed.version) || 1) < CT.model.VERSION) {
          try { if (!localStorage.getItem(CT.model.BACKUP_KEY)) localStorage.setItem(CT.model.BACKUP_KEY, raw); } catch (_) { /* storage full: upgrade anyway */ }
        }
        s.state = CT.model.migrate(parsed);
        s.persist(true); // save any one-time upgrades (dates, colors, cleanup) right away
        return 'loaded';
      } catch (e) {
        console.error('Corrupt data, keeping a copy', e);
        try { localStorage.setItem(KEY + '.corrupt-' + Date.now(), raw); } catch (_) { /* ignore */ }
      }
    }
    s.state = CT.model.initialData();
    s.persist();
    return 'new';
  };

  /** Writes state to localStorage. `noAuto` skips the auto file-backup (used by the backup itself). */
  s.persist = (noAuto) => {
    s.state.meta.updatedAt = new Date().toISOString();
    try { localStorage.setItem(KEY, JSON.stringify(s.state)); } catch (e) {
      console.error(e);
      if (CT.ui) CT.ui.toast('השמירה בדפדפן נכשלה — כדאי לייצא גיבוי עכשיו', { error: true });
    }
    if (!noAuto && CT.backup) CT.backup.scheduleAutoSave();
    if (!noAuto && CT.cloud) CT.cloud.onLocalChange();
  };

  /**
   * Every change goes through commit(): snapshot for undo → mutate → save → re-render.
   * opts.silent: don't re-render (typing in notes). opts.coalesce: key — repeated edits
   * with the same key within 4s share one undo step. opts.undo=false: no undo snapshot.
   */
  s.commit = (label, fn, opts = {}) => {
    const now = Date.now();
    const same = opts.coalesce && s.lastCoalesce && s.lastCoalesce.key === opts.coalesce && now - s.lastCoalesce.t < 4000;
    if (opts.undo !== false && !same) {
      s.undoStack.push({ label, snap: JSON.stringify(s.state) });
      if (s.undoStack.length > UNDO_MAX) s.undoStack.shift();
    }
    s.lastCoalesce = opts.coalesce ? { key: opts.coalesce, t: now } : null;
    const result = fn(s.state);
    s.persist();
    if (!opts.silent) s.emit();
    return result;
  };

  /** Replace the whole state (import / reset) — undoable. */
  s.replace = (newState, label) => {
    s.undoStack.push({ label, snap: JSON.stringify(s.state) });
    s.state = newState;
    s.persist();
    s.emit();
  };

  s.undo = () => {
    const e = s.undoStack.pop();
    if (!e) { CT.ui.toast('אין פעולה לביטול'); return; }
    s.state = JSON.parse(e.snap);
    s.lastCoalesce = null;
    s.persist();
    s.emit();
    CT.ui.toast(`בוטל: ${e.label}`);
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
  s.setStatus = (itemId, status) => s.commit('שינוי סטטוס', () => {
    const f = s.findItem(itemId);
    if (!f) return;
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
