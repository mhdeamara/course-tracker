/* notify.js — notification center model. Pure logic, no DOM.
 *
 * Notifications are derived from existing state every time (nothing is stored as history): Moodle updates, Moodle
 * items waiting for a course, Moodle sync errors, backup reminders and permissions, the sign-in reminder and
 * points (XP) notices. Each one has a stable id built from what it is about, so the same situation keeps the same id
 * across renders (dedupe + read state) and a new situation gets a new id (unread again).
 * Read state is per device and per account: localStorage 'ct.notif.<account>' = { id: readAtISO }. Marking read only
 * clears the unread dot — an unresolved issue stays listed until it is resolved (or its own action dismisses it).
 * Critical warnings (schema lock, sync conflict, sync errors, privacy) are never notifications.
 * Texts are i18n keys ({ k, p }) or raw content ({ raw }) that the view renders with dir="auto". */
(function (CT) {
  'use strict';
  const N = {};
  const GROUPS = ['moodle', 'backup', 'account', 'xp'];
  const PREFIX = 'ct.notif.';
  const MAX_READ = 200;

  /* small stable hash for ids built from lists (djb2) */
  const hash = (s) => { let h = 5381; for (let i = 0; i < s.length; i++) h = ((h << 5) + h + s.charCodeAt(i)) | 0; return (h >>> 0).toString(36); };
  const k = (key, p) => ({ k: key, p: p || {} });

  /**
   * ctx: {
   *   moodle: { unseen: { new, changed, gone, restored, total }, lastChangeAt, error: { code, message, at } | null, inbox: [{ uid, title }] },
   *   backup: { status, remind, days },            // days: whole days since the last backup, null = never
   *   cloud:  { enabled, signedIn, status },
   *   xp:     null | { type: 'pause', reason, to } | { type: 'pen', count, points, lastId, day } | { type: 'risk', penOn, minItems, minMinutes, freezesLeft, streak, day, itemId }
   * }
   * Returns notifications sorted by group, deduplicated by id.
   */
  N.derive = (ctx = {}) => {
    const out = [];
    const mo = ctx.moodle || {};
    const un = mo.unseen || {};
    if (un.total) {
      const parts = ['new', 'changed', 'gone', 'restored'].filter((x) => un[x]).map((x) => k('notif.moodle.' + x, { n: un[x] }));
      out.push({ id: `moodle-changes:${mo.lastChangeAt || ''}:${un.total}`, group: 'moodle', icon: 'inbox', sev: 'info',
        title: k('notif.moodle.changes'), sub: parts, at: mo.lastChangeAt || null,
        actions: [{ k: 'notif.act.whatChanged', act: 'moodle-open', primary: true }, { k: 'notif.act.seen', act: 'moodle-seen' }] });
    }
    if (mo.error) {
      out.push({ id: `moodle-error:${mo.error.code || ''}:${mo.error.at || ''}`, group: 'moodle', icon: 'alert', sev: 'warn',
        title: k('notif.moodle.error'), sub: mo.error.message ? [{ raw: String(mo.error.message) }] : [], at: mo.error.at || null,
        actions: [{ k: 'notif.act.settings', act: 'settings', arg: 'moodle', primary: true }] });
    }
    const inbox = mo.inbox || [];
    if (inbox.length) {
      out.push({ id: `moodle-inbox:${hash(inbox.map((x) => x.uid).sort().join('|'))}`, group: 'moodle', icon: 'inbox', sev: 'info',
        title: k('notif.moodle.inbox', { n: inbox.length }), sub: inbox.slice(0, 2).map((x) => ({ raw: String(x.title || '') })).concat(inbox.length > 2 ? [{ raw: '…' }] : []),
        at: null, actions: [{ k: 'notif.act.assign', act: 'moodle-inbox', primary: true }] });
    }

    const b = ctx.backup || {};
    if (b.status === 'needs-permission') {
      out.push({ id: 'backup-permission', group: 'backup', icon: 'download', sev: 'info', title: k('notif.backup.permission'), sub: [], at: null,
        actions: [{ k: 'notif.act.grant', act: 'regrant', primary: true }] });
    } else if (b.remind) {
      const never = b.days == null;
      out.push({ id: `backup-remind:${never ? 'never' : b.lastKey || b.days}`, group: 'backup', icon: 'download', sev: 'warn',
        title: never ? k('notif.backup.never') : k('notif.backup.days', { n: b.days }), sub: [], at: null,
        actions: [{ k: 'notif.act.export', act: 'export', primary: true }, { k: 'notif.act.later', act: 'snooze' }] });
    }

    const c = ctx.cloud || {};
    if (c.enabled && !c.signedIn && c.status !== 'conflict') {
      out.push({ id: 'signin', group: 'account', icon: 'cloud', sev: 'info', title: k('notif.signin'), sub: [], at: null,
        actions: [{ k: 'notif.act.signin', act: 'settings', arg: 'account', primary: true }] });
    }

    const x = ctx.xp;
    if (x && x.type === 'pause') {
      const sub = [];
      if (x.reason) sub.push(k('xp.reason.' + x.reason));
      if (x.to) sub.push(k('notif.xp.until', { date: x.to }) /* the view formats {date} for the locale */);
      out.push({ id: `xp-pause:${x.from || ''}`, group: 'xp', icon: 'pause', sev: 'info', title: k('notif.xp.pause'), sub, at: null,
        actions: [{ k: 'notif.act.resume', act: 'xp-resume' }] });
    } else if (x && x.type === 'pen') {
      out.push({ id: `xp-pen:${x.lastId}`, group: 'xp', icon: 'flag', sev: 'warn', title: k('notif.xp.pen', { n: x.count, pts: x.points }),
        sub: [k('notif.xp.penNote')], at: x.day || null,
        actions: [{ k: 'notif.act.why', act: 'xp-log' }, { k: 'notif.act.gotIt', act: 'xp-pen-seen', arg: x.lastId }] });
    } else if (x && x.type === 'risk') {
      const sub = x.penOn
        ? [k('notif.xp.need', { n: x.minItems, min: x.minMinutes })].concat(x.freezesLeft ? [k('notif.xp.freezes', { n: x.freezesLeft })] : [])
        : [k('notif.xp.small')];
      out.push({ id: `xp-risk:${x.day}:${x.penOn ? 'min' : 'streak'}`, group: 'xp', icon: 'timer', sev: 'info',
        title: x.penOn ? k('notif.xp.riskMin') : k('notif.xp.streak', { n: x.streak }), sub, at: null,
        actions: x.itemId ? [{ k: 'notif.act.five', act: 'xp-five', arg: x.itemId, primary: true }] : [] });
    }

    const seen = new Set();
    return out.filter((n) => (seen.has(n.id) ? false : (seen.add(n.id), true)))
      .sort((a, z) => GROUPS.indexOf(a.group) - GROUPS.indexOf(z.group));
  };
  N.GROUPS = GROUPS;

  /* ---------- read state: per device, per account ---------- */
  N.key = (account) => PREFIX + (account ? String(account) : 'local');
  N.readMap = (storage, account) => {
    try {
      const v = JSON.parse(storage.getItem(N.key(account)) || '{}');
      return v && typeof v === 'object' && !Array.isArray(v) ? v : {};
    } catch (e) { return {}; }
  };
  N.unread = (list, map) => list.filter((n) => !Object.prototype.hasOwnProperty.call(map, n.id));
  /**
   * Marks `ids` read. Entries for notifications that no longer exist are dropped (so a situation that ends and comes
   * back later is new again); `current` is the full current list. Never throws (blocked storage = nothing remembered).
   */
  N.markRead = (storage, account, ids, current, now = new Date()) => {
    const map = N.readMap(storage, account);
    const live = new Set((current || []).map((n) => n.id));
    const next = {};
    Object.keys(map).filter((id) => live.has(id)).forEach((id) => { next[id] = map[id]; });
    (ids || []).forEach((id) => { if (live.has(id) && !next[id]) next[id] = now.toISOString(); });
    const keys = Object.keys(next).sort((a, z) => String(next[z]).localeCompare(String(next[a]))).slice(0, MAX_READ);
    const out = {};
    keys.forEach((id) => { out[id] = next[id]; });
    try { storage.setItem(N.key(account), JSON.stringify(out)); } catch (e) { /* ignore */ }
    return out;
  };

  /**
   * Display time for a real timestamp (never invented): an ISO date-time → relative ("12 min ago"), a date
   * (YYYY-MM-DD) → relative day ("yesterday") within a week, else a short date. null/invalid → ''.
   */
  N.when = (at, locale = 'he-IL', now = new Date()) => {
    if (!at) return '';
    const dateOnly = /^\d{4}-\d{2}-\d{2}$/.test(at);
    const t = dateOnly ? new Date(at + 'T12:00:00') : new Date(at);
    if (isNaN(t)) return '';
    let rtf;
    try { rtf = new Intl.RelativeTimeFormat(locale, { numeric: 'auto' }); } catch (e) { rtf = null; }
    const day = (d) => Math.floor(new Date(d.getFullYear(), d.getMonth(), d.getDate()).getTime() / 864e5);
    const dd = day(t) - day(now);
    if (!dateOnly && rtf) {
      const s = Math.round((t - now) / 1000);
      if (Math.abs(s) < 60) return rtf.format(0, 'second');
      if (Math.abs(s) < 3600) return rtf.format(Math.round(s / 60), 'minute');
      if (Math.abs(s) < 86400 && dd === 0) return rtf.format(Math.round(s / 3600), 'hour');
    }
    if (rtf && Math.abs(dd) <= 6) return rtf.format(dd, 'day');
    try { return t.toLocaleDateString(locale, { day: 'numeric', month: 'short' }); } catch (e) { return at.slice(0, 10); }
  };

  CT.notify = N;
})(window.CT = window.CT || {});
