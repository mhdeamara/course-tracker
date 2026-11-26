/* ext-bridge.js — talks to the course-tracker Chrome extension, if one is installed. Does nothing otherwise.
 *
 *  - The extension's content script says hello (window.postMessage, same page only). From then on, after every
 *    change and once a minute, this sends it a small snapshot (js/ext-snapshot.js) — never the full data.
 *  - The extension can ask for two things: mark an item done, or start "רק 5 דקות" on it; and open the adhkar
 *    reading screen. They run through the site's own code (store.commit → points, log, undo, cloud sync), exactly
 *    like a click here, so nothing is counted twice and the cloud row is only ever written by the site.
 * Messages are accepted only from this same window and origin (the content script shares the page's window). */
(function (CT) {
  'use strict';
  const S = CT.store;
  let on = false, timer = null;

  const post = (msg) => window.postMessage(Object.assign({ ct: true }, msg), location.origin);
  const send = () => {
    if (!on || !CT.extSnapshot) return;
    try { post({ type: 'ext-snapshot', snap: CT.extSnapshot.build(S.state) }); } catch (e) { console.warn('ext snapshot', e); }
  };
  const soon = () => { clearTimeout(timer); timer = setTimeout(send, 800); };

  const run = (a) => {
    const id = String(a.id || '');
    if (a.act === 'done') {
      const f = S.findItem(id);
      if (!f) return { ok: false, err: 'הפריט לא נמצא (אולי נמחק)' };
      if (f.item.status !== 'done') { if (CT.ui) CT.ui.justChecked = id; S.setStatus(id, 'done'); }
      return { ok: true };
    }
    if (a.act === 'five') {
      if (!S.findItem(id) || !CT.focus) return { ok: false, err: 'הפריט לא נמצא' };
      CT.focus.start(id, 5);
      return { ok: true };
    }
    if (a.act === 'adhkar') {
      if (!CT.views || !CT.views.adhkar || !CT.adhkar || !CT.adhkar.on(S.state)) return { ok: false, err: 'האזכרות כבויות' };
      CT.views.adhkar.open(a.p === 'e' ? 'e' : 'm');
      return { ok: true };
    }
    return { ok: false, err: 'פעולה לא מוכרת' };
  };

  window.addEventListener('message', (e) => {
    if (e.source !== window || e.origin !== location.origin) return;
    const d = e.data;
    if (!d || d.ct !== true || d.from !== 'extension') return;
    if (d.type === 'ext-hello') { on = true; send(); return; }
    if (d.type === 'ext-action') {
      let res;
      try { res = run(d.action || {}); } catch (err) { res = { ok: false, err: 'שגיאה באתר' }; }
      post({ type: 'ext-action-result', req: d.req, res });
      soon();
    }
  });

  S.subscribe(soon);
  setInterval(() => { if (on && !document.hidden) send(); }, 60000); // the goal / time windows move with the clock
  post({ type: 'ext-ready' }); // a content script that loaded first answers with hello
})(window.CT);
