/* views/ai.js — the AI page (#/ai): the conversation (views/chat.js) next to the assistant's status, today's usage and
 * limits, model choice and the connection check; the short AI card in settings; the floating button. Usage and status
 * are loaded once and shared with the quick panel. Every AI call goes through the Supabase Edge Function "ai"
 * (supabase/functions/ai); the API key lives only there. Provider details come from js/ai-provider.js. */
(function (CT) {
  'use strict';
  const { u, ui } = CT;
  const S = CT.store;
  const I = CT.i18n, t = I.t, tx = I.tx;
  const P = CT.aiProvider;
  const esc = u.esc, icon = u.icon;
  const V = {};
  CT.views = CT.views || {};
  CT.views.ai = V;

  V.DEFAULTS = P.defaults;
  V.settings = () => Object.assign({}, P.defaults, S.state.settings.ai || {});

  const C = () => CT.cloud;
  let info = { state: 'unknown' }; // unknown | loading | ok | error (+ the server's "usage" answer)
  let loading = null;
  let busy = false;
  // codes with their own text in aie.*; anything else is shown as the generic server error
  const KNOWN = ['bad-request', 'too-big', 'not-signed-in', 'not-yet', 'ai-not-configured', 'daily-cost', 'daily-extracts', 'per-minute', 'ai-key',
    'ai-busy', 'ai-down', 'ai-bad-request', 'ai-refused', 'server', 'message-too-long', 'chat-too-long', 'offline', 'no-function', 'method'];

  /** US-dollar amounts in the interface locale; amounts under a tenth of a cent as "< 0.001". */
  V.money = (x) => {
    const n = Number(x) || 0;
    const f = (v, d) => { try { return new Intl.NumberFormat(I.locale(), { style: 'currency', currency: 'USD', minimumFractionDigits: d, maximumFractionDigits: d }).format(v); } catch (e) { return `$${v.toFixed(d)}`; } };
    return n > 0 && n < 0.001 ? `< ${f(0.001, 3)}` : f(n, n < 0.1 ? 3 : 2);
  };

  /** Call the Edge Function. Throws Error with a translated message and .code (raw server text is never shown). */
  V.call = async (body) => {
    try { return await C().ai(body); } catch (e) {
      const d = e.data || {};
      const offline = e instanceof TypeError;
      const noFn = !d.error && (e.status === 404 || (e.status === 400 && /not.?found|function/i.test(e.message || '')));
      const code = d.error || (offline ? 'offline' : noFn ? 'no-function' : 'server');
      const err = new Error(tx(`aie.${KNOWN.includes(code) ? code : 'server'}`, { n: (info.limits && info.limits.maxChatChars) || 2000, secret: P.keySecret }));
      err.code = code;
      err.retryAfter = d.retryAfter;
      throw err;
    }
  };

  /* ---------- status and usage (shared by the page, the panel and the settings card) ---------- */
  async function loadUsage() {
    info = { state: 'loading' };
    paintStatus();
    try { info = Object.assign({ state: 'ok', at: Date.now() }, await V.call({ action: 'usage' })); } catch (e) { info = { state: 'error', code: e.code }; }
    paintStatus();
    if (CT.views.chat) CT.views.chat.refresh();
    return info;
  }
  /** Usage and status, loaded once (again after an error or a reset). */
  V.ensureUsage = () => {
    if (info.state === 'ok' || info.state === 'error') return Promise.resolve(info);
    if (!loading) loading = loadUsage().finally(() => { loading = null; });
    return loading;
  };
  V.usage = () => info;
  V.refreshUsage = () => { if (C() && C().signedIn()) loadUsage(); };
  /** After an answer: add its cost to today's numbers on screen (the server keeps the real count). */
  V.noteSpend = (cost) => {
    if (info.state !== 'ok' || !info.today) return;
    info.today = Object.assign({}, info.today, { costUsd: (Number(info.today.costUsd) || 0) + (Number(cost) || 0), requests: (info.today.requests || 0) + 1 });
    paintStatus();
  };
  /** After sign-in / sign-out: forget usage numbers and the chat on this device. */
  V.reset = () => {
    info = { state: 'unknown' };
    if (CT.views.chat) { CT.views.chat.close({ restore: false }); CT.views.chat.forget(); CT.views.chat.check(); }
  };

  /** ok · checking · off (no cloud) · signin · setup (not configured) · offline · error */
  function statusOf() {
    const cloud = C();
    if (!cloud || !cloud.enabled) return 'off';
    if (!cloud.signedIn()) return 'signin';
    if (typeof navigator !== 'undefined' && navigator.onLine === false) return 'offline';
    if (info.state === 'ok') return info.configured === false ? 'setup' : 'ok';
    if (info.state === 'error') return info.code === 'offline' ? 'offline' : 'error';
    return 'checking';
  }
  const STATUS_ICON = { ok: 'check', checking: 'refresh', off: 'info', signin: 'cloud', setup: 'alert', offline: 'cloud', error: 'alert' };
  const chipHTML = (s) => `<span class="ai-status is-${s}">${icon[STATUS_ICON[s]]}<span>${t(`ai.st.${s}`)}</span></span>`;

  function usageHTML() {
    if (info.state !== 'ok') return '';
    const d = info.today || {};
    const L = info.limits || {};
    const pct = L.dailyCostUsd ? Math.min(100, Math.round(((Number(d.costUsd) || 0) / L.dailyCostUsd) * 100)) : 0;
    const over = L.dailyCostUsd && Number(d.costUsd) >= L.dailyCostUsd;
    return `<div class="ai-usage${over ? ' is-over' : ''}">
        <div class="ai-usage-top"><span>${t('ai.u.today')}</span><b><bdi>${esc(V.money(d.costUsd))}</bdi> / <bdi>${esc(V.money(L.dailyCostUsd))}</bdi></b></div>
        <div class="ai-meter" role="meter" aria-valuemin="0" aria-valuemax="100" aria-valuenow="${pct}" aria-label="${t('ai.u.meter', { pct })}"><span style="inline-size:${pct}%"></span></div>
        ${over ? `<p class="small ai-error">${icon.alert}<span>${t('aie.daily-cost')}</span></p>` : ''}
        <dl class="ai-kv small">
          <div><dt>${t('ai.u.requests')}</dt><dd>${esc(ui.num(d.requests || 0))}</dd></div>
          <div><dt>${t('ai.u.extracts')}</dt><dd>${esc(ui.num(d.extracts || 0))} / ${esc(ui.num(L.dailyExtracts || 0))}</dd></div>
          <div><dt>${t('ai.u.perMinute')}</dt><dd>${esc(ui.num(L.perMinute || 0))}</dd></div>
          <div><dt>${t('ai.u.message')}</dt><dd>${t('ai.u.chars', { n: ui.num(L.maxChatChars || 0) })}</dd></div>
          <div><dt>${t('ai.u.file')}</dt><dd>${t('ai.u.fileVal', { mb: ui.num(Math.round((L.maxFileBytes || 0) / 1048576)), pages: ui.num(L.maxPdfPages || 0) })}</dd></div>
        </dl>
        <p class="small muted">${t('ai.u.reset')}</p>
      </div>`;
  }

  function modelsHTML() {
    const set = V.settings();
    const ids = P.modelIds(info.state === 'ok' ? info.models : null);
    const opt = (id, cur) => {
      const m = P.model(id);
      const extra = m ? ` · ${tx(`ai.tier.${m.tier}`)} · ${V.money(m.price.input)} / ${V.money(m.price.output)}` : '';
      return `<option value="${esc(id)}"${id === cur ? ' selected' : ''}>${esc(P.label(id) + extra)}</option>`;
    };
    const sel = (name, cur) => `<select data-ai-pref="${name}">${(ids.includes(cur) ? ids : [cur, ...ids]).map((id) => opt(id, cur)).join('')}</select>`;
    return `<div class="ai-models">
        <label class="field"><span>${t('ai.m.chat')}</span>${sel('chatModel', set.chatModel)}</label>
        <label class="field"><span>${t('ai.m.extract')}</span>${sel('extractModel', set.extractModel)}</label>
        <p class="small muted">${t('ai.m.price')}</p>
      </div>`;
  }

  function sideHTML() {
    const s = statusOf();
    const signed = s !== 'off' && s !== 'signin';
    return `<section class="card ai-side-card" aria-labelledby="ai-st-h">
        <h2 id="ai-st-h">${t('ai.side.status')}</h2>
        ${chipHTML(s)}
        ${s === 'setup' ? `<p class="small">${t('aie.ai-not-configured', { secret: P.keySecret })}</p>` : ''}
        ${s === 'error' ? `<p class="small ai-error">${esc(tx(`aie.${KNOWN.includes(info.code) ? info.code : 'server'}`, { n: 2000, secret: P.keySecret }))}</p>` : ''}
        ${s === 'signin' ? `<p class="small">${t('ai.signIn')}</p><a class="btn btn-small" href="#/settings">${t('aic.toSettings')}</a>` : ''}
        ${s === 'off' ? `<p class="small">${t('ai.notConfigured')}</p>` : ''}
        ${usageHTML()}
        ${signed ? `<div class="btn-row">
          <button class="btn btn-small" data-action="ai-ping"${busy || s !== 'ok' ? ' disabled' : ''}>${icon.refresh}<span>${busy ? t('ai.checking') : t('ai.ping')}</span></button>
          <button class="btn btn-small btn-ghost" data-action="ai-reload"${info.state === 'loading' ? ' disabled' : ''}>${t('ai.reload')}</button>
        </div>` : ''}
      </section>
      <section class="card ai-side-card" aria-labelledby="ai-m-h"><h2 id="ai-m-h">${t('ai.side.models')}</h2>${modelsHTML()}</section>
      <section class="card ai-side-card ai-privacy" aria-labelledby="ai-p-h"><h2 id="ai-p-h">${t('ai.side.privacy')}</h2>
        <p class="small">${icon.info}<span>${t('aic.readOnly')}</span></p>
        <p class="small muted">${t('ai.privacy', { provider: P.name })}</p></section>`;
  }

  /** Redraw what shows the status (the page's side column or the settings card) without touching the conversation. */
  function paintStatus() {
    const side = document.querySelector('.aiw-side');
    if (side) {
      const a = document.activeElement;
      const pref = a && side.contains(a) ? a.getAttribute('data-ai-pref') || a.getAttribute('data-action') : null;
      side.innerHTML = sideHTML();
      const back = pref && side.querySelector(`[data-ai-pref="${pref}"], [data-action="${pref}"]`);
      if (back) back.focus({ preventScroll: true });
    }
    const card = document.getElementById('ai');
    if (card && location.hash === '#/settings') card.outerHTML = V.section();
  }

  /* ---------- the page ---------- */
  V.render = (root) => {
    if (CT.views.chat.isOpen()) CT.views.chat.close({ restore: false }); // one surface at a time: the page takes over
    root.innerHTML = `<div class="aiw">
        <section class="card aiw-chat" aria-label="${t('aic.title')}"></section>
        <aside class="aiw-side" aria-label="${t('ai.side.label')}">${sideHTML()}</aside>
      </div>`;
    CT.views.chat.mount(root.querySelector('.aiw-chat'));
    const side = root.querySelector('.aiw-side');
    side.addEventListener('click', (e) => { const a = e.target.closest('[data-action^="ai-"]'); if (a) V.onClick(a); });
    side.addEventListener('change', (e) => { if (e.target.dataset.aiPref) V.onChange(e.target); });
    if (C() && C().enabled && C().signedIn() && info.state === 'unknown') V.ensureUsage();
  };

  /* ---------- the card in settings: status and a way to the page ---------- */
  V.section = () => {
    const s = statusOf();
    if ((s === 'checking') && info.state === 'unknown' && C() && C().signedIn()) setTimeout(V.ensureUsage, 0);
    return `<section class="card ai-card" id="ai"${I.attrs()}>
      <h2 class="mw-card-h">${icon.spark}<span>${t('ai.set.title')}</span> <a class="btn btn-small btn-ghost" href="#/ai">${t('ai.set.open')}</a></h2>
      ${chipHTML(s)}
      ${s === 'signin' ? `<p class="small muted">${t('ai.signIn')}</p>` : s === 'off' ? `<p class="small muted">${t('ai.notConfigured')}</p>` : ''}
      <p class="small muted">${t('ai.privacy', { provider: P.name })}</p>
    </section>`;
  };

  V.onClick = async (a) => {
    switch (a.dataset.action) {
      case 'ai-reload': loadUsage(); break;
      case 'ai-ping':
        busy = true;
        paintStatus();
        try {
          const r = await V.call({ action: 'ping' });
          ui.toast(tx('ai.pingOk', { model: P.label(r.model), cost: V.money(r.costUsd) }));
        } catch (e) { ui.toast(e.message, { error: true }); }
        busy = false;
        loadUsage();
        break;
      default: break;
    }
  };

  V.onChange = (x) => {
    const k = x.dataset.aiPref;
    if ((k === 'chatModel' || k === 'extractModel') && P.modelIds(info.state === 'ok' ? info.models : null).includes(x.value)) {
      S.commit(tx('ai.c.model'), (st) => { st.settings.ai = Object.assign({}, P.defaults, st.settings.ai || {}, { [k]: x.value }); });
    }
  };

  /* ---------- floating button (every screen but the AI page) + the quick panel ---------- */
  const fabState = (b) => {
    b.hidden = /^#\/ai(\b|\?|$)/.test(location.hash);
    b.title = `${tx('aic.title')} (A)`;
    b.setAttribute('aria-label', tx('aic.fab'));
  };
  V.mountFab = () => {
    if (document.getElementById('ai-fab')) return;
    const b = document.createElement('button');
    b.id = 'ai-fab';
    b.className = 'ai-fab';
    b.type = 'button';
    b.setAttribute('data-ct-shell', '');
    b.innerHTML = icon.spark;
    b.setAttribute('aria-expanded', 'false');
    b.setAttribute('aria-haspopup', 'dialog');
    b.onclick = () => CT.views.chat.toggle();
    fabState(b);
    document.body.appendChild(b);
    window.addEventListener('hashchange', () => fabState(b));
    I.onChange(() => fabState(b));
  };
  /** The A key and the floating button open the quick panel (on the AI page: focus its field). */
  V.open = () => CT.views.chat.open();
})(window.CT);
