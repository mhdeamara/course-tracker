/* options.js — the settings page. Saves to chrome.storage.local "settings". Sign-in goes through the service worker. */
(() => {
  'use strict';
  const CFG = self.CTSettings;
  const $ = (id) => document.getElementById(id);
  let s = null, auth = null;

  const say = (id, text, cls = '') => { const el = $(id); el.textContent = text; el.className = `status ${cls}`; };
  const save = async (patch) => { s = CFG.merge(Object.assign({}, s, patch)); await chrome.storage.local.set({ settings: s }); };
  const send = (m) => chrome.runtime.sendMessage(m).catch((e) => ({ ok: false, err: e.message }));

  function paint() {
    const ready = CFG.cloudReady(s);
    document.querySelectorAll('input[name=mode]').forEach((r) => { r.checked = r.value === s.mode; });
    $('mode-connected').disabled = !ready;
    say('mode-status', ready ? '' : 'מצב מחובר נפתח אחרי ששומרים פרויקט Supabase למטה.', 'muted');
    $('site').value = s.siteUrl;
    $('sb-url').value = s.sbUrl;
    $('sb-key').value = s.sbKey;
    $('login').disabled = !ready;
    $('signed-in').hidden = !auth;
    $('signed-out').hidden = !!auth;
    $('who').textContent = auth && auth.user ? auth.user.email : '';
    document.querySelectorAll('[data-show]').forEach((c) => { c.checked = !!s.show[c.dataset.show]; });
    $('adhkar-notify').checked = !!s.adhkarNotify;
  }

  /** A site other than the default needs host access + a registered content script (asked for here, once). */
  async function useSite(url) {
    if (url === CFG.DEFAULT_SITE) {
      try { await chrome.scripting.unregisterContentScripts({ ids: ['ct-site'] }); } catch (e) { /* none registered */ }
      await save({ siteUrl: url });
      return true;
    }
    const pattern = CFG.pattern(url);
    const ok = await chrome.permissions.request({ permissions: ['scripting'], origins: [pattern] });
    if (!ok) return false;
    try { await chrome.scripting.unregisterContentScripts({ ids: ['ct-site'] }); } catch (e) { /* none registered */ }
    await chrome.scripting.registerContentScripts([{ id: 'ct-site', matches: [pattern], js: ['content.js'], runAt: 'document_idle' }]);
    await save({ siteUrl: url });
    return true;
  }

  document.addEventListener('change', async (e) => {
    const t = e.target;
    if (t.name === 'mode') { await save({ mode: t.value }); if (t.value === 'connected' && auth) send({ type: 'refresh' }); paint(); }
    else if (t.dataset.show) { await save({ show: Object.assign({}, s.show, { [t.dataset.show]: t.checked }) }); }
    else if (t.id === 'adhkar-notify') { await save({ adhkarNotify: t.checked }); }
  });

  document.addEventListener('click', async (e) => {
    const b = e.target.closest('button');
    if (!b) return;
    if (b.id === 'site-save' || b.id === 'site-reset') {
      const r = CFG.checkSite(b.id === 'site-reset' ? CFG.DEFAULT_SITE : $('site').value);
      if (r.err) { say('site-status', r.err, 'err'); return; }
      const ok = await useSite(r.url);
      if (ok) await chrome.storage.local.remove('snapLocal'); // a different site: start fresh
      say('site-status', ok ? 'נשמר. פתחו את האתר פעם אחת כדי שהתוסף יקבל נתונים.' : 'בלי ההרשאה התוסף לא יכול לקבל נתונים מהכתובת הזאת.', ok ? 'ok' : 'err');
      paint();
    }
    if (b.id === 'sb-save') {
      const u = CFG.checkSbUrl($('sb-url').value), k = CFG.checkKey($('sb-key').value);
      if (u.err || k.err) { say('sb-status', u.err || k.err, 'err'); return; }
      await save({ sbUrl: u.url, sbKey: k.key });
      say('sb-status', 'נשמר. עכשיו אפשר להתחבר.', 'ok');
      paint();
    }
    if (b.id === 'sb-clear') {
      if (auth) await send({ type: 'signout' });
      auth = null;
      await save({ sbUrl: '', sbKey: '', mode: 'local' });
      say('sb-status', 'נמחק. חזרה למצב מקומי.', 'ok');
      paint();
    }
    if (b.id === 'signin') {
      b.disabled = true;
      say('login-status', 'מתחבר…');
      const r = await send({ type: 'signin', email: $('email').value, password: $('password').value });
      $('password').value = '';
      b.disabled = false;
      if (!r || !r.ok) { say('login-status', (r && r.err) || 'ההתחברות נכשלה', 'err'); return; }
      ({ auth } = await chrome.storage.local.get('auth'));
      s = CFG.merge((await chrome.storage.local.get('settings')).settings); // the service worker switched to connected mode
      say('login-status', r.warn ? `מחובר, אבל: ${r.warn}` : 'מחובר. הנתונים נטענו.', r.warn ? 'err' : 'ok');
      paint();
    }
    if (b.id === 'signout') {
      await send({ type: 'signout' });
      auth = null;
      say('login-status', 'התנתקת.', 'ok');
      paint();
    }
  });

  (async () => {
    const d = await chrome.storage.local.get(['settings', 'auth']);
    s = CFG.merge(d.settings);
    auth = d.auth || null;
    paint();
  })();
})();
