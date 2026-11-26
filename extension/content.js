/* content.js — runs only on the course-tracker site. It never reads the site's storage: it says hello, and the site
 * (js/ext-bridge.js) answers with a small snapshot, which goes to the extension's own storage. It also carries the
 * extension's requests (✓ / "רק 5 דקות" / adhkar) to the page, where the site's own code runs them. */
(() => {
  'use strict';
  if (window.__ctExt) return; // injected twice (manifest + registered script): run once
  window.__ctExt = true;
  const ORIGIN = location.origin;
  const toPage = (msg) => window.postMessage(Object.assign({ ct: true, from: 'extension' }, msg), ORIGIN);
  const waiting = new Map(); // req → resolve
  let seq = 0;

  const ask = (action) => new Promise((resolve) => {
    const req = `r${Date.now()}-${++seq}`;
    const t = setTimeout(() => { waiting.delete(req); resolve({ ok: false, err: 'האתר לא ענה (אולי עדיין נטען)' }); }, 8000);
    waiting.set(req, (res) => { clearTimeout(t); resolve(res); });
    toPage({ type: 'ext-action', req, action });
  });

  window.addEventListener('message', (e) => {
    if (e.source !== window || e.origin !== ORIGIN) return;
    const d = e.data;
    if (!d || d.ct !== true || d.from === 'extension') return;
    if (d.type === 'ext-ready') toPage({ type: 'ext-hello' });
    else if (d.type === 'ext-snapshot' && d.snap && d.snap.v === 1) {
      chrome.runtime.sendMessage({ type: 'snapshot', snap: d.snap }).catch(() => {});
    } else if (d.type === 'ext-action-result' && waiting.has(d.req)) {
      waiting.get(d.req)(d.res && typeof d.res === 'object' ? { ok: !!d.res.ok, err: String(d.res.err || '') } : { ok: false });
      waiting.delete(d.req);
    }
  });

  chrome.runtime.onMessage.addListener((msg, sender, reply) => {
    if (sender.id !== chrome.runtime.id || !msg || msg.type !== 'action') return false;
    ask(msg.action).then(reply);
    return true; // async reply
  });

  toPage({ type: 'ext-hello' });
  // an action asked for while the site was closed (the extension opened this tab for it)
  chrome.runtime.sendMessage({ type: 'pending' }).then((a) => { if (a && a.act) setTimeout(() => ask(a), 1200); }).catch(() => {});
})();
