/* moodle.js — turns Moodle calendar events (from CT.ical.parse) into course items, without duplicates.
 * Pure functions on a plain state object ({ courses, moodle, settings }), no DOM, so tests/ical.test.js can run
 * it in Node. The caller wraps merge() in CT.store.commit, which gives undo.
 *
 * Rules:
 *  - The event UID is the identity: an item remembers it in item.source.uid, so importing again never duplicates.
 *  - item.source keeps the values last seen in Moodle (title, due, time, link). When Moodle changes them, the item is
 *    updated only where you did not edit it yourself, and source.changed keeps the previous values until you
 *    dismiss it ("עודכן ממודל").
 *  - Status (V), notes, tags and the star are never touched.
 *  - An event that is no longer in the feed is never deleted: it is marked source.gone ("לא מופיע יותר במודל").
 *    Only events due today or later, up to the last date the feed covers, can be marked: Moodle's export covers a
 *    window of dates, so older events simply age out of it.
 *  - An event whose course is not found goes to moodle.inbox ("לא משויך"). Your choice there is remembered
 *    (moodle.map by Moodle course name, or moodle.uidMap for one event).
 *  - A synced item you deleted is not created again (moodle.known lists every UID that became an item). */
(function (root) {
  'use strict';
  const Mo = {};
  const HW_NAME = 'שיעורי בית';

  Mo.emptyState = () => ({ map: {}, uidMap: {}, ignored: {}, known: {}, inbox: [], last: null });
  Mo.ensure = (st) => {
    if (!st.moodle || typeof st.moodle !== 'object') st.moodle = {};
    const empty = Mo.emptyState();
    Object.keys(empty).forEach((k) => { if (!(k in st.moodle)) st.moodle[k] = empty[k]; }); // in place: callers hold a reference
    ['map', 'uidMap', 'ignored', 'known'].forEach((k) => { if (!st.moodle[k] || typeof st.moodle[k] !== 'object' || Array.isArray(st.moodle[k])) st.moodle[k] = {}; });
    if (!Array.isArray(st.moodle.inbox)) st.moodle.inbox = [];
    return st.moodle;
  };

  /* ---------- reading an event ---------- */
  // "opens" events are not deadlines (approved rule: import due dates and closing times, skip openings)
  const OPENS = /(\bopens?\b|(^|[\s:(\-–])(נפתח|נפתחת|פתיחת|פתיחה|פותח|פותחת)($|[\s:).\-–]))/i;
  // Moodle appends these to the activity name; the item shows the name alone
  const SUFFIX = /\s*(?:[-–:]\s*)?(?:is due|is due to be graded|closes|due|נסגר|נסגרת|סגירה|להגשה|יש להגיש|מועד הגשה|תאריך הגשה)\s*$/i;
  const PREFIX = /^\s*(?:מועד הגשה|תאריך הגשה|הגשת|הגשה)\s*[:\-–]\s*/;

  Mo.isOpening = (ev) => OPENS.test(ev.summary || '');
  Mo.cleanTitle = (s) => {
    const t = String(s || '').replace(SUFFIX, '').replace(PREFIX, '').trim();
    return t || String(s || '').trim() || 'מטלה ממודל';
  };
  /** Course number → 8 digits (old 6-digit 044131 → 00440131); '' when there is none. */
  Mo.normNum = (n) => {
    const d = String(n || '').replace(/\D/g, '');
    if (d.length === 8) return d;
    if (d.length === 6) return `0${d.slice(0, 3)}0${d.slice(3)}`;
    return '';
  };
  /** Course numbers written in a text: 8-digit 0XXX0YYY, or 6-digit XXXYYY not part of a longer number. */
  Mo.numbersIn = (text) => {
    const s = String(text || '');
    const out = new Set();
    (s.match(/(?<!\d)0\d{3}0\d{3}(?!\d)/g) || []).forEach((x) => out.add(x));
    (s.match(/(?<!\d)\d{6}(?!\d)/g) || []).forEach((x) => out.add(Mo.normNum(x)));
    return [...out];
  };
  const normName = (s) => String(s || '').toLowerCase().replace(/[֑-ׇ]/g, '').replace(/["'״׳`\-–_.,:()[\]]/g, ' ').replace(/\s+/g, ' ').trim();
  /** The Moodle course of an event, as text: its CATEGORIES (Moodle puts the course short name there). */
  Mo.courseKey = (ev) => (ev.categories && ev.categories.length ? ev.categories.join(', ') : '');

  /** A Moodle link for the event: its URL, or the calendar day on the Moodle site the UID came from. */
  Mo.eventUrl = (ev) => {
    if (/^https?:\/\//i.test(ev.url || '')) return ev.url;
    const m = String(ev.uid || '').match(/^(\d+)@(moodle\d*\.technion\.ac\.il)$/i);
    if (m && ev.due && ev.due.ms) return `https://${m[2].toLowerCase()}/calendar/view.php?view=day&time=${Math.floor(ev.due.ms / 1000)}#event_${m[1]}`;
    return '';
  };

  /**
   * Deadline as the item stores it. Midnight (00:00) means "by the end of the previous day", so the item's date is the
   * day before and the time shows as 24:00 — otherwise the countdown would give a day too many.
   */
  Mo.deadline = (ev) => {
    const d = ev.due;
    if (!d) return { due: '', dueTime: '' };
    if (d.time === '00:00') {
      const p = new Date(Date.UTC(+d.date.slice(0, 4), +d.date.slice(5, 7) - 1, +d.date.slice(8, 10) - 1));
      return { due: p.toISOString().slice(0, 10), dueTime: '24:00' };
    }
    return { due: d.date, dueTime: d.time || '' };
  };

  /** What sync compares and stores for one event. */
  Mo.snapshot = (ev) => Object.assign({ uid: ev.uid, title: Mo.cleanTitle(ev.summary), rawTitle: ev.summary || '', url: Mo.eventUrl(ev), category: Mo.courseKey(ev) }, Mo.deadline(ev));

  /* ---------- finding the course ---------- */
  const candidates = (st) => {
    const act = st.settings && st.settings.activeSemesterId;
    return st.courses.filter((c) => c.kind !== 'record' && !c.archived)
      .sort((a, b) => (b.semesterId === act) - (a.semesterId === act));
  };

  /** The course for an event, or null. Order: your choice for this event → your choice for its Moodle course → course
   *  number in the Moodle course name or title → unique course-name match. */
  Mo.matchCourse = (st, ev) => {
    const mo = Mo.ensure(st);
    const byId = (id) => st.courses.find((c) => c.id === id) || null;
    if (mo.uidMap[ev.uid] && byId(mo.uidMap[ev.uid])) return byId(mo.uidMap[ev.uid]);
    const key = Mo.courseKey(ev);
    if (key && mo.map[key] && byId(mo.map[key])) return byId(mo.map[key]);
    const list = candidates(st);
    const nums = Mo.numbersIn(`${key} ${ev.summary || ''}`);
    for (const n of nums) {
      const hit = list.find((c) => Mo.normNum(c.number) === n);
      if (hit) return hit;
    }
    const k = normName(key);
    if (k) {
      const hits = list.filter((c) => { const nm = normName(c.name); return nm.length >= 4 && (k.includes(nm) || (k.length >= 4 && nm.includes(k))); });
      if (hits.length === 1) return hits[0];
    }
    return null;
  };

  /* ---------- items ---------- */
  const fallbackUid = () => Date.now().toString(36) + Math.random().toString(36).slice(2, 8);
  function newItem(snap, opts) {
    const base = opts.newItem ? opts.newItem(snap.title) : {
      id: (opts.uid || fallbackUid)(), title: snap.title, status: 'todo', note: '', due: '', link: '', tags: [], flag: false, completedAt: null, createdAt: new Date().toISOString(),
    };
    return Object.assign(base, {
      title: snap.title, due: snap.due, link: snap.url,
      source: { kind: 'moodle', uid: snap.uid, title: snap.title, rawTitle: snap.rawTitle, due: snap.due, dueTime: snap.dueTime, url: snap.url, category: snap.category, changed: null, gone: null, mergeWith: null },
    });
  }
  /** The course's homework category (created when missing). */
  Mo.hwCategory = (course, opts = {}) => {
    let cat = course.categories.find((c) => c.name.trim() === HW_NAME)
      || course.categories.find((c) => /שיעורי בית|תרגילי בית|הגשות|ש״ב|ש"ב/.test(c.name));
    if (!cat) {
      cat = opts.newCategory ? opts.newCategory(HW_NAME) : { id: (opts.uid || fallbackUid)(), name: HW_NAME, items: [] };
      course.categories.push(cat);
    }
    return cat;
  };
  const firstNum = (s) => { const m = String(s || '').match(/\d+/); return m ? Number(m[0]) : null; };
  /** A placeholder like "ש״ב 3" in the same category with the same number → suggest merging (never automatic). */
  function placeholderFor(cat, item) {
    const n = firstNum(item.title);
    if (n == null) return null;
    const hits = cat.items.filter((x) => x !== item && !x.source && firstNum(x.title) === n);
    return hits.length === 1 ? hits[0] : null;
  }
  Mo.syncedItems = (st) => {
    const out = new Map();
    st.courses.forEach((course) => course.categories.forEach((cat) => cat.items.forEach((item) => {
      if (item.source && item.source.kind === 'moodle' && item.source.uid) out.set(item.source.uid, { course, cat, item });
    })));
    return out;
  };
  function addToCourse(st, course, snap, opts) {
    const cat = Mo.hwCategory(course, opts);
    const item = newItem(snap, opts);
    cat.items.push(item);
    const ph = placeholderFor(cat, item);
    if (ph) item.source.mergeWith = ph.id;
    st.moodle.known[snap.uid] = true;
    return item;
  }

  /**
   * Bring the events into the state. Mutates `st`; returns counts:
   * { total, added, updated, restored, gone, unassigned, unchanged, skippedOpen, ignored, deletedByYou, invalid }.
   * opts: { today: 'YYYY-MM-DD', now: ISO string, newItem(title), newCategory(name), uid() }
   */
  Mo.merge = (st, events, opts = {}) => {
    const mo = Mo.ensure(st);
    const today = opts.today || new Date().toISOString().slice(0, 10);
    const now = opts.now || new Date().toISOString();
    const r = { total: events.length, added: 0, updated: 0, restored: 0, gone: 0, unassigned: 0, unchanged: 0, skippedOpen: 0, ignored: 0, deletedByYou: 0, invalid: 0 };
    const synced = Mo.syncedItems(st);
    const seen = new Set();
    let lastDue = '';
    const inbox = new Map(mo.inbox.map((x) => [x.uid, x]));

    events.forEach((ev) => {
      if (!ev.uid) { r.invalid++; return; }
      if (seen.has(ev.uid)) return; // the same UID twice in one file
      seen.add(ev.uid);
      if (Mo.isOpening(ev)) { r.skippedOpen++; return; }
      const snap = Mo.snapshot(ev);
      if (snap.due && snap.due > lastDue) lastDue = snap.due;
      if (mo.ignored[ev.uid]) { r.ignored++; return; }

      const hit = synced.get(ev.uid);
      if (hit) {
        const { item } = hit;
        const s = item.source;
        if (s.gone) { s.gone = null; r.restored++; }
        const diff = s.title !== snap.title || s.due !== snap.due || (s.dueTime || '') !== (snap.dueTime || '');
        if (diff) {
          const prev = s.changed || { prevTitle: s.title, prevDue: s.due, prevTime: s.dueTime || '' };
          if (item.title === s.title) item.title = snap.title; // only where you did not rename it
          if (item.due === s.due) item.due = snap.due;           // only where you did not move it
          s.changed = Object.assign(prev, { at: now });
          r.updated++;
        } else if (!s.gone) r.unchanged++;
        if (s.url !== snap.url) { if (!item.link || item.link === s.url) item.link = snap.url; }
        Object.assign(s, { title: snap.title, rawTitle: snap.rawTitle, due: snap.due, dueTime: snap.dueTime, url: snap.url, category: snap.category });
        return;
      }
      if (mo.known[ev.uid]) { r.deletedByYou++; return; }
      const course = Mo.matchCourse(st, ev);
      if (course) {
        addToCourse(st, course, snap, opts);
        inbox.delete(ev.uid);
        r.added++;
      } else {
        inbox.set(ev.uid, Object.assign(inbox.get(ev.uid) || {}, snap, { description: String(ev.description || '').slice(0, 300) }));
        r.unassigned++;
      }
    });

    // gone from the feed: mark (never delete) — only deadlines from today up to the last date this feed covers
    synced.forEach(({ item }, uid) => {
      const s = item.source;
      if (seen.has(uid) || s.gone || !s.due || !lastDue) return;
      if (s.due >= today && s.due <= lastDue) { s.gone = { at: now }; r.gone++; }
    });
    // unassigned events that left the feed are dropped from the list (nothing of yours is lost)
    mo.inbox = [...inbox.values()].filter((x) => seen.has(x.uid)).sort((a, b) => String(a.due).localeCompare(String(b.due)));
    mo.last = Object.assign({ at: now, source: opts.source || 'file' }, r);
    return r;
  };

  /** Assign an unassigned event to a course. remember=true: every event of the same Moodle course goes there too,
   *  now and in later syncs. Returns how many items were created. */
  Mo.assign = (st, uid, courseId, remember, opts = {}) => {
    const mo = Mo.ensure(st);
    const entry = mo.inbox.find((x) => x.uid === uid);
    const course = st.courses.find((c) => c.id === courseId);
    if (!entry || !course) return 0;
    const key = entry.category;
    if (remember && key) mo.map[key] = courseId; else mo.uidMap[uid] = courseId;
    const take = mo.inbox.filter((x) => x.uid === uid || (remember && key && x.category === key));
    take.forEach((x) => addToCourse(st, course, x, opts));
    const ids = new Set(take.map((x) => x.uid));
    mo.inbox = mo.inbox.filter((x) => !ids.has(x.uid));
    return take.length;
  };
  /** Never import this event again. */
  Mo.ignore = (st, uid) => {
    const mo = Mo.ensure(st);
    mo.ignored[uid] = true;
    mo.inbox = mo.inbox.filter((x) => x.uid !== uid);
  };
  /** Forget a remembered Moodle-course → course choice. */
  Mo.unmap = (st, key) => { delete Mo.ensure(st).map[key]; };

  /** Merge a synced item into the placeholder it was matched with ("ש״ב 3"). Your data on both is kept. */
  Mo.mergeIntoPlaceholder = (course, itemId) => {
    for (const cat of course.categories) {
      const item = cat.items.find((x) => x.id === itemId);
      if (!item || !item.source || !item.source.mergeWith) continue;
      const ph = cat.items.find((x) => x.id === item.source.mergeWith);
      if (!ph || ph.source) { item.source.mergeWith = null; return null; }
      ph.source = Object.assign({}, item.source, { mergeWith: null });
      ph.due = item.due || ph.due;
      if (!ph.link) ph.link = item.link;
      if (item.status === 'done' && ph.status !== 'done') { ph.status = 'done'; ph.completedAt = item.completedAt || ph.completedAt; }
      if (item.note) ph.note = ph.note ? `${ph.note}\n${item.note}` : item.note;
      ph.tags = [...new Set([...(ph.tags || []), ...(item.tags || [])])];
      ph.flag = ph.flag || item.flag;
      cat.items.splice(cat.items.indexOf(item), 1);
      return ph;
    }
    return null;
  };

  /** Short Hebrew summary of a merge() result. */
  Mo.summary = (r) => {
    const parts = [];
    if (r.added) parts.push(`${r.added} חדשות`);
    if (r.updated) parts.push(`${r.updated} עודכנו`);
    if (r.restored) parts.push(`${r.restored} חזרו למודל`);
    if (r.gone) parts.push(`${r.gone} לא מופיעות יותר`);
    if (r.unassigned) parts.push(`${r.unassigned} לא משויכות`);
    if (!parts.length) parts.push('אין שינויים');
    return parts.join(' · ');
  };

  root.CT = root.CT || {};
  root.CT.moodle = Mo;
})(typeof window !== 'undefined' ? window : globalThis);
