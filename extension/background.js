/* background.js — the extension's service worker: keeps the badge right, refreshes connected mode every few minutes,
 * routes the popup's actions to the open site, and (optionally) notifies when an adhkar window starts while the
 * site is closed. Talks only to the course-tracker site and — in connected mode — to the Supabase project the user
 * entered. Nothing else. */
self.window = self; // the shared site modules attach to window.CT
importScripts('lib/utils.js', 'lib/game.js', 'lib/stats.js', 'lib/adhkar.js', 'lib/ext-snapshot.js', 'lib/view.js', 'lib/settings.js', 'lib/cloud.js');

const CFG = self.CTSettings, VIEW = self.CTView, CLOUD = self.CTCloud;
const CLOUD_EVERY_MIN = 10;

const load = async () => {
  const d = await chrome.storage.local.get(['settings', 'snapLocal', 'snapCloud', 'auth', 'cloudAt', 'notified']);
  d.settings = CFG.merge(d.settings);
  return d;
};
/** The snapshot to show: local mode → what the site handed over; connected → whichever is newer. */
const pick = (d) => {
  const loc = d.snapLocal && d.snapLocal.snap, cl = d.settings.mode === 'connected' ? d.snapCloud && d.snapCloud.snap : null;
  if (!cl) return loc || null;
  if (!loc) return cl;
  return Date.parse(cl.at) >= Date.parse(loc.at) ? cl : loc;
};

async function updateBadge() {
  const d = await load();
  const v = VIEW.build(pick(d), new Date());
  await chrome.action.setBadgeText({ text: VIEW.badgeText(v.badge || 0) });
  await chrome.action.setBadgeBackgroundColor({ color: v.overdue && v.overdue.length ? '#c93a51' : '#4f5bd5' });
  const parts = [];
  if (v.overdue && v.overdue.length) parts.push(`${v.overdue.length} באיחור`);
  if (v.dueToday) parts.push(`${v.dueToday.filter((x) => x.s !== 'done').length} להיום`);
  await chrome.action.setTitle({ title: `מעקב קורסים${parts.length ? ' — ' + parts.join(' · ') : ''}` });
}

async function refreshCloud(force) {
  const d = await load();
  const s = d.settings;
  if (s.mode !== 'connected' || !CFG.cloudReady(s) || !d.auth) return { ok: false, skipped: true };
  if (!force && d.cloudAt && Date.now() - d.cloudAt < CLOUD_EVERY_MIN * 60000) return { ok: true, skipped: true };
  try {
    const auth = await CLOUD.fresh(s, d.auth);
    if (auth !== d.auth) await chrome.storage.local.set({ auth });
    const row = await CLOUD.fetchState(s, auth);
    if (!row) throw new Error('אין עדיין נתונים בענן לחשבון הזה');
    const snap = self.CT.extSnapshot.build(row.state, new Date());
    await chrome.storage.local.set({ snapCloud: { snap, updated: row.updated_at }, cloudAt: Date.now(), cloudErr: '' });
    return { ok: true };
  } catch (e) {
    const err = e.message || 'שגיאה';
    await chrome.storage.local.set({ cloudErr: err, cloudAt: Date.now() });
    if (e.status === 401 || e.status === 400) await chrome.storage.local.remove('auth'); // the session ended: sign in again
    return { ok: false, err };
  }
}

/* ---------- the site tab ---------- */
const siteTab = async (s) => {
  try {
    const tabs = await chrome.tabs.query({ url: CFG.pattern(s.siteUrl) });
    return tabs.sort((a, b) => (b.active - a.active) || (b.lastAccessed || 0) - (a.lastAccessed || 0))[0] || null;
  } catch (e) { return null; }
};
async function openSite(focus = true) {
  const { settings: s } = await load();
  const tab = await siteTab(s);
  if (tab) {
    if (focus) { await chrome.tabs.update(tab.id, { active: true }); await chrome.windows.update(tab.windowId, { focused: true }); }
    return tab;
  }
  return chrome.tabs.create({ url: s.siteUrl, active: focus });
}
/** Run ✓ / "רק 5 דקות" / adhkar in the site itself (same code path as a click there). */
async function runAction(action) {
  const { settings: s } = await load();
  const focus = action.act !== 'done';
  const tab = await siteTab(s);
  if (tab) {
    try {
      const res = await chrome.tabs.sendMessage(tab.id, { type: 'action', action });
      if (focus) await openSite(true);
      return res || { ok: false, err: 'אין תשובה מהאתר' };
    } catch (e) { /* the tab was opened before the extension was installed: reload it with the action pending */
      await chrome.storage.session.set({ pending: { action, at: Date.now() } });
      await chrome.tabs.reload(tab.id);
      if (focus) await openSite(true);
      return { ok: true, queued: true };
    }
  }
  await chrome.storage.session.set({ pending: { action, at: Date.now() } });
  await chrome.tabs.create({ url: s.siteUrl, active: focus });
  return { ok: true, queued: true };
}

/* ---------- adhkar: a notification when a window starts and the site is closed ---------- */
async function adhkarCheck() {
  const d = await load();
  const s = d.settings;
  if (!s.adhkarNotify) return;
  const snap = pick(d);
  if (!snap || !snap.adhkar || !snap.adhkar.notify) return;
  const now = new Date(), p = VIEW.adhkarDue(snap, now);
  if (!p) return;
  const key = `${VIEW.iso(now)}:${p}`;
  if (d.notified === key) return;
  await chrome.storage.local.set({ notified: key }); // once per window per day
  if (await siteTab(s)) return; // the open site shows its own card (and knows about focus time)
  chrome.notifications.create(`adk:${p}`, {
    type: 'basic', iconUrl: 'icons/icon-128.png',
    title: p === 'm' ? 'أذكار الصباح' : 'أذكار المساء',
    message: `אזכרות ה${p === 'm' ? 'בוקר' : 'ערב'} — אפשר להתחיל כשנוח. לחיצה פותחת את מסך הקריאה.`,
    priority: 0,
  });
}
chrome.notifications.onClicked.addListener((id) => {
  const m = /^adk:(m|e)$/.exec(id);
  chrome.notifications.clear(id);
  if (m) runAction({ act: 'adhkar', p: m[1] });
});

/* ---------- timing ---------- */
const tick = async () => { await refreshCloud(false); await updateBadge(); await adhkarCheck(); };
const setup = () => chrome.alarms.create('tick', { periodInMinutes: 5, delayInMinutes: 0.1 });
chrome.runtime.onInstalled.addListener(() => { setup(); updateBadge(); });
chrome.runtime.onStartup.addListener(() => { setup(); tick(); });
chrome.alarms.onAlarm.addListener((a) => { if (a.name === 'tick') tick(); });
chrome.storage.onChanged.addListener((ch, area) => {
  if (area === 'local' && (ch.snapLocal || ch.snapCloud || ch.settings)) updateBadge();
});

/* ---------- messages ---------- */
chrome.runtime.onMessage.addListener((msg, sender, reply) => {
  if (sender.id !== chrome.runtime.id || !msg) return false;
  // the site's content script vs. the extension's own pages (popup / options — the options page is a tab too)
  const fromPage = !String(sender.url || '').startsWith(chrome.runtime.getURL(''));
  (async () => {
    const d = await load();
    const s = d.settings;
    if (fromPage) {
      if (!CFG.siteMatches(s.siteUrl, sender.url || '')) return null; // only the configured site
      if (msg.type === 'snapshot' && msg.snap && msg.snap.v === 1 && typeof msg.snap.at === 'string') {
        await chrome.storage.local.set({ snapLocal: { snap: msg.snap, recv: Date.now() } });
        return { ok: true };
      }
      if (msg.type === 'pending') {
        const { pending } = await chrome.storage.session.get('pending');
        await chrome.storage.session.remove('pending');
        return pending && Date.now() - pending.at < 120000 ? pending.action : null;
      }
      return null;
    }
    switch (msg.type) {
      case 'action': return runAction(msg.action || {});
      case 'open-site': await openSite(true); return { ok: true };
      case 'refresh': { const r = await refreshCloud(true); await updateBadge(); return r; }
      case 'signin': {
        if (!CFG.cloudReady(s)) return { ok: false, err: 'קודם צריך לשמור כתובת Supabase ומפתח ציבורי' };
        try {
          const auth = await CLOUD.signIn(s, String(msg.email || '').trim(), String(msg.password || ''));
          // signing in means "use my account": switch to connected mode first, then load
          await chrome.storage.local.set({ auth, cloudErr: '', cloudAt: 0, settings: Object.assign({}, s, { mode: 'connected' }) });
          const r = await refreshCloud(true);
          await updateBadge();
          return { ok: true, email: auth.user.email, warn: r.ok ? '' : r.err || 'הנתונים לא נטענו' };
        } catch (e) { return { ok: false, err: e.message }; }
      }
      case 'signout':
        await CLOUD.signOut(s, d.auth);
        await chrome.storage.local.remove(['auth', 'snapCloud', 'cloudAt', 'cloudErr']);
        await updateBadge();
        return { ok: true };
      case 'badge': await updateBadge(); return { ok: true };
      default: return null;
    }
  })().then(reply, (e) => reply({ ok: false, err: e.message }));
  return true;
});
