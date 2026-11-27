/* views/chat.js — the AI chat: one conversation, shown on two surfaces — the quick panel (the floating button or the
 * A key) and the AI page (#/ai). Both draw the same state from this module: the history, the request in flight, the
 * draft you are typing, errors and the "can't chat now" gate. A question is sent once, whichever surface you use, and
 * switching between them (or the language) never sends it again or loses what you typed.
 *
 * How a question is answered:
 *   1. The question goes to the Edge Function "ai" (action "chat"), which adds its own fixed instructions and the
 *      fixed list of read-only tools, and asks the model.
 *   2. When the model asks for a tool (e.g. "list_items"), the tool runs HERE, on the data in this browser
 *      (js/agent-tools.js), and only its result is sent back. Up to MAX_ROUNDS rounds per question.
 *   3. The answer is shown with chips that say what the assistant read.
 * The conversation is kept only on this device (localStorage), never in the cloud or in the backup, and is wiped on
 * "new chat", on sign-out and when another account signs in (an answer still on its way is then dropped). This version
 * can only read; it changes nothing. Provider details (message format, model names) come from js/ai-provider.js. */
(function (CT) {
  'use strict';
  const { u } = CT;
  const S = CT.store;
  const I = CT.i18n, t = I.t, tx = I.tx;
  const P = CT.aiProvider, W = P.wire;
  const esc = u.esc, icon = u.icon;
  const V = {};
  CT.views = CT.views || {};
  CT.views.chat = V;

  const KEY = 'ct.ai.chat';
  const MAX_STORED = 80;     // messages kept on this device
  const SEND_LAST = 24;      // messages sent with each question (older ones are left out)
  const MAX_SEND_CHARS = 100_000;
  const MAX_ROUNDS = 6;      // tool rounds per question
  const MAX_CHARS = 2000;
  // suggested questions, each answered by one of the existing read-only tools (shown only if that tool exists)
  const SUGGEST = [['week', 'list_items'], ['overdue', 'list_items'], ['exams', 'list_items'], ['gpa', 'get_gpa'], ['schedule', 'get_schedule'], ['overview', 'get_overview']];
  // error codes with their own text (server codes of supabase/functions/ai + the ones made here)
  const ERR = ['bad-request', 'too-big', 'not-signed-in', 'not-yet', 'ai-not-configured', 'daily-cost', 'daily-extracts', 'per-minute', 'ai-key',
    'ai-busy', 'ai-down', 'ai-bad-request', 'ai-refused', 'server', 'message-too-long', 'chat-too-long', 'offline', 'no-function', 'method'];

  const read = () => { try { const d = JSON.parse(localStorage.getItem(KEY) || 'null'); return d && Array.isArray(d.msgs) ? d.msgs : []; } catch (e) { return []; } };
  const save = () => { try { localStorage.setItem(KEY, JSON.stringify({ v: 1, msgs: msgs.slice(-MAX_STORED) })); } catch (e) { /* private mode: keep in memory only */ } };
  let msgs = read();
  /** Shared state of both surfaces. gate: why chatting is not possible now (no-cloud · sign-in · not-configured ·
   *  no-function) or null. gen: bumped when the conversation is wiped, so a late answer is dropped. */
  const st = { busy: false, error: null, gate: null, draft: '', gen: 0, quotaDay: null, refocus: null };
  const surfaces = new Set(); // { root, kind: 'panel' | 'page' }
  let panel = null;           // the quick panel element while open
  let opener = null;          // what had focus when the panel opened (focus goes back there)

  /** Error text for a code (never the raw server or internal message). */
  V.errorText = (code) => tx(`aie.${ERR.includes(code) ? code : 'server'}`, { n: MAX_CHARS, secret: P.keySecret });
  const money = (x) => (CT.views.ai && CT.views.ai.money ? CT.views.ai.money(x) : `$${(Number(x) || 0).toFixed(3)}`);
  const offline = () => typeof navigator !== 'undefined' && navigator.onLine === false;
  const quota = () => st.quotaDay === u.today();

  /** Wipe the conversation (new chat, sign-out, other account). An answer still on its way is dropped. */
  V.forget = () => {
    msgs = [];
    st.error = null;
    st.busy = false;
    st.gen += 1;
    try { localStorage.removeItem(KEY); } catch (e) { /* ignore */ }
    paint();
  };

  /** Tiny, safe text formatting for answers: escape everything, then **bold**, `code`, and "- " bullets. No links, no HTML. */
  function fmt(text) {
    const inline = (s) => esc(s).replace(/\*\*([^*\n]+)\*\*/g, '<b>$1</b>').replace(/`([^`\n]+)`/g, '<code dir="ltr">$1</code>');
    const out = [];
    let list = null;
    String(text || '').split('\n').forEach((line) => {
      const b = line.match(/^\s*(?:[-•*]|\d+[.)])\s+(.*)$/);
      if (b) { if (!list) { list = []; out.push(list); } list.push(b[1]); return; }
      list = null;
      if (line.trim()) out.push(line.replace(/^#+\s*/, ''));
    });
    return out.map((x) => (Array.isArray(x) ? `<ul>${x.map((li) => `<li>${inline(li)}</li>`).join('')}</ul>` : `<p>${inline(x)}</p>`)).join('');
  }

  /** "Read: assignments and dates · 1 Dec – 7 Dec" — what a tool call read (translated; the arguments are data). */
  function chip(c) {
    const known = CT.agentTools && CT.agentTools.LABELS[c.name];
    const label = known ? tx(`aic.tool.${c.name}`) : tx('aic.tool.other');
    const i = c.input || {};
    const day = (iso) => (/^\d{4}-\d{2}-\d{2}$/.test(iso || '') ? CT.ui.date(iso, 'short') : '');
    const arg = i.course || i.query || (i.from || i.to ? `${day(i.from) || '…'} – ${day(i.to) || '…'}` : '');
    return `<span class="chat-chip" title="${t('aic.chipTitle')}">${icon.search}<span>${esc(label)}${arg ? `: <bdi>${esc(String(arg).slice(0, 40))}</bdi>` : ''}</span></span>`;
  }

  function emptyHTML() {
    const sug = SUGGEST.filter(([, tool]) => CT.agentTools && CT.agentTools.LABELS[tool]).map(([k]) => tx(`aic.sug.${k}`));
    return `<div class="chat-empty">
      <div class="chat-hello">${icon.spark}<div><b>${t('aic.hello')}</b><p class="small muted">${t('aic.helloSub')}</p></div></div>
      <div class="chat-suggest" role="list">${sug.map((s) => `<button type="button" role="listitem" class="chat-sug" data-sug="${esc(s)}">${esc(s)}</button>`).join('')}</div>
      <p class="small muted chat-privacy">${icon.info}<span>${t('chat.privacy', { provider: P.name })}</span></p></div>`;
  }

  function gateHTML() {
    const act = st.gate === 'sign-in' ? `<a class="btn btn-small btn-primary" href="#/settings/account" data-c="settings">${t('aic.toSettings')}</a>` : '';
    return `<div class="chat-empty chat-gate">${icon[st.gate === 'sign-in' ? 'cloud' : 'alert']}<p>${t(`aic.gate.${st.gate}`, { secret: P.keySecret })}</p>${act}</div>`;
  }

  function logHTML() {
    if (!msgs.length) return st.busy ? waitHTML() : emptyHTML();
    const parts = [];
    let chips = [];
    let turnCost = 0;
    msgs.forEach((m, i) => {
      if (m.role === 'user') {
        if (!W.isTyped(m)) return; // tool results are not shown
        parts.push(`<div class="chat-msg chat-user" dir="auto">${esc(W.text(m)).replace(/\n/g, '<br>')}</div>`);
        chips = [];
        turnCost = 0;
        return;
      }
      turnCost += Number(m._cost) || 0;
      W.toolCalls(m.content).forEach((c) => chips.push(chip(c)));
      const text = W.text(m).trim();
      const last = i === msgs.length - 1 || W.isTyped(msgs[i + 1]);
      if (!last) return; // intermediate steps of a tool loop: only their chips are shown
      const uniq = [...new Set(chips)].map((c) => { const k = chips.filter((x) => x === c).length; return k > 1 ? c.replace(/<\/span><\/span>$/, ` ×${k}</span></span>`) : c; });
      const note = m._note === 'cut' ? tx('aic.cut') : m._note ? String(m._note) : '';
      parts.push(`<div class="chat-msg chat-bot">
        ${uniq.length ? `<div class="chat-chips">${uniq.join('')}</div>` : ''}
        <div class="chat-text" dir="auto">${fmt(text || '…')}</div>
        ${note ? `<div class="small ai-error" dir="auto">${esc(note)}</div>` : ''}
        <div class="chat-meta">${esc(P.short(m._model))}${turnCost ? ` · ${esc(money(turnCost))}` : ''}</div></div>`);
    });
    if (st.busy) parts.push(waitHTML());
    return parts.join('');
  }
  const waitHTML = () => {
    // while tools run, say so (the chips of this question are already on screen)
    const last = msgs[msgs.length - 1];
    const reading = last && last.role === 'user' && !W.isTyped(last);
    return `<div class="chat-msg chat-bot chat-wait" role="status"><span class="chat-dots" aria-hidden="true"><span></span><span></span><span></span></span><span class="chat-wait-t">${t(reading ? 'aic.reading' : 'aic.thinking')}</span></div>`;
  };

  /* ---------- surfaces ---------- */
  function surfaceHTML(kind) {
    const id = `chat-in-${kind}`;
    return `<header class="chat-head">
        <span class="chat-mark" aria-hidden="true">${icon.spark}</span>
        <span class="chat-title-wrap"><b class="chat-title">${t('aic.title')}</b><span class="chat-model small muted"></span></span>
        <span class="chat-head-actions">
          <button type="button" class="btn btn-small btn-ghost chat-new" data-c="new" title="${t('aic.newTitle')}">${icon.plus}<span>${t('aic.new')}</span></button>
          ${kind === 'panel' ? `<a class="icon-btn" href="#/ai" data-c="expand" aria-label="${t('aic.expand')}" title="${t('aic.expand')}">${icon.expand}</a>
          <button type="button" class="icon-btn" data-c="close" aria-label="${t('common.close')}" title="${t('common.close')}">${icon.close}</button>` : ''}
        </span>
      </header>
      <div class="chat-log" role="log" aria-live="polite" aria-label="${t('aic.log')}" tabindex="0"></div>
      <div class="chat-note small" role="status" hidden></div>
      <div class="chat-err small ai-error" role="alert" hidden></div>
      <form class="chat-form">
        <label class="nc-sr" for="${id}">${t('aic.input')}</label>
        <textarea id="${id}" rows="2" maxlength="${MAX_CHARS}" dir="auto" data-keep="ai-draft-${kind}" enterkeyhint="send" placeholder="${t('aic.ph')}"></textarea>
        <button type="submit" class="btn btn-primary chat-send" aria-label="${t('aic.send')}" title="${t('aic.send')}">${icon.send}</button>
      </form>
      <p class="chat-foot small muted">${icon.info}<span>${t('aic.readOnly')}</span></p>`;
  }

  const canSend = () => !st.busy && !st.gate && !offline() && !quota();

  function paintOne(s) {
    const r = s.root;
    const log = r.querySelector('.chat-log');
    const atEnd = log.scrollHeight - log.scrollTop - log.clientHeight < 40;
    const html = st.gate ? gateHTML() : logHTML();
    if (s.html !== html) { log.innerHTML = html; s.html = html; if (atEnd || st.busy) log.scrollTop = log.scrollHeight; }
    const note = r.querySelector('.chat-note');
    const n = st.gate ? '' : offline() ? tx('aic.offline') : quota() ? tx('aic.quota') : '';
    // one message per problem: the offline / daily-limit notice already says what such an error would say
    const code = st.error && st.error.code;
    const shown = code && !(n && (code === 'offline' || code === 'daily-cost'));
    const err = r.querySelector('.chat-err');
    err.textContent = shown ? V.errorText(code) : '';
    err.hidden = !shown;
    note.textContent = n;
    note.hidden = !n;
    const form = r.querySelector('.chat-form');
    form.hidden = !!st.gate;
    const ta = form.querySelector('textarea');
    if (ta.value !== st.draft && document.activeElement !== ta) ta.value = st.draft;
    form.querySelector('button').disabled = !canSend();
    r.querySelector('.chat-new').disabled = st.busy || !msgs.length;
    const model = CT.views.ai ? CT.views.ai.settings().chatModel : '';
    r.querySelector('.chat-model').textContent = model ? P.short(model) : '';
    r.classList.toggle('is-busy', st.busy);
  }
  function paint() {
    surfaces.forEach((s) => { if (!s.root.isConnected) surfaces.delete(s); });
    surfaces.forEach(paintOne);
  }
  V.refresh = paint;

  function wire(root, kind) {
    const ta = root.querySelector('textarea');
    const form = root.querySelector('.chat-form');
    form.onsubmit = (e) => { e.preventDefault(); if (canSend()) ask(ta.value); };
    ta.addEventListener('input', () => {
      st.draft = ta.value;
      surfaces.forEach((s) => { if (s.root !== root) { const x = s.root.querySelector('textarea'); if (x) x.value = st.draft; } });
      if (st.error && st.error.code === 'message-too-long' && ta.value.length <= MAX_CHARS) { st.error = null; paint(); }
    });
    ta.addEventListener('keydown', (e) => {
      if (e.key === 'Enter' && !e.shiftKey && !e.isComposing) { e.preventDefault(); form.requestSubmit(); }
    });
    // remember that the field had focus, so a re-render (store change, language) can give it back
    ta.addEventListener('focus', () => { st.refocus = { kind, start: ta.selectionStart, end: ta.selectionEnd }; });
    ta.addEventListener('blur', () => setTimeout(() => { if (ta.isConnected && st.refocus && st.refocus.kind === kind) st.refocus = null; }, 0));
    ta.addEventListener('select', () => { if (st.refocus) Object.assign(st.refocus, { start: ta.selectionStart, end: ta.selectionEnd }); });
    ta.addEventListener('keyup', () => { if (st.refocus) Object.assign(st.refocus, { start: ta.selectionStart, end: ta.selectionEnd }); });
    root.addEventListener('click', async (e) => {
      const sug = e.target.closest('[data-sug]');
      if (sug) { if (canSend()) ask(sug.dataset.sug); return; }
      const b = e.target.closest('[data-c]');
      if (!b) return;
      const c = b.dataset.c;
      if (c === 'close') V.close();
      else if (c === 'expand') { e.preventDefault(); V.close({ restore: false }); location.hash = '#/ai'; }
      else if (c === 'settings') { if (kind === 'panel') V.close({ restore: false }); }
      else if (c === 'new' && !st.busy && msgs.length
        && (await CT.ui.confirm(tx('aic.newConfirm'), tx('aic.new'), false, { localized: true }))) V.forget();
    });
  }
  function focusInput(root, sel) {
    const ta = root && root.querySelector('textarea');
    if (!ta || ta.closest('[hidden]')) return;
    ta.focus({ preventScroll: true });
    if (sel && typeof sel.start === 'number') { try { ta.setSelectionRange(sel.start, sel.end); } catch (e) { /* ignore */ } }
  }

  /** The AI page puts the conversation in `root` (re-rendered with the page; state and draft stay here). */
  V.mount = (root) => {
    surfaces.forEach((s) => { if (s.kind === 'page') surfaces.delete(s); });
    root.innerHTML = surfaceHTML('page');
    const s = { root, kind: 'page' };
    surfaces.add(s);
    wire(root, 'page');
    paintOne(s);
    const log = root.querySelector('.chat-log');
    log.scrollTop = log.scrollHeight;
    if (st.refocus && st.refocus.kind === 'page') focusInput(root, st.refocus);
    check().then(paint);
  };

  /* ---------- the conversation ---------- */
  /** The conversation as the server accepts it: no "_" fields, the last SEND_LAST messages, starting at a typed question. */
  function payload() {
    const clean = msgs.map((m) => ({ role: m.role, content: m.content }));
    let start = Math.max(0, clean.length - SEND_LAST);
    while (start < clean.length && !W.isTyped(clean[start])) start += 1;
    let out = clean.slice(start);
    while (JSON.stringify(out).length > MAX_SEND_CHARS) {
      let next = 1;
      while (next < out.length && !W.isTyped(out[next])) next += 1;
      if (next >= out.length) break;
      out = out.slice(next);
    }
    return out;
  }

  /** Ask a question. Returns false when nothing was sent (empty, too long, offline, over the daily limit, or a
   *  question is already on its way — one request at a time for both surfaces). */
  async function ask(text) {
    const q = String(text || '').trim();
    if (!q || st.busy || st.gate) return false;
    if (q.length > MAX_CHARS) { st.error = { code: 'message-too-long' }; paint(); return false; }
    if (offline()) { st.error = { code: 'offline' }; paint(); return false; }
    if (quota()) { st.error = { code: 'daily-cost' }; paint(); return false; }
    const gen = st.gen;
    const start = msgs.length;
    const model = CT.views.ai.settings().chatModel;
    const hadFocus = !!document.activeElement && [...surfaces].some((s) => s.root.contains(document.activeElement));
    st.error = null;
    st.draft = '';
    surfaces.forEach((s) => { const x = s.root.querySelector('textarea'); if (x) x.value = ''; });
    msgs.push(W.userText(q));
    st.busy = true;
    paint();
    try {
      let round = 0;
      for (;;) {
        const r = await CT.views.ai.call({ action: 'chat', model, messages: payload() });
        if (gen !== st.gen) return false; // the conversation was wiped meanwhile (sign-out, other account)
        if (CT.views.ai.noteSpend) CT.views.ai.noteSpend(r.costUsd);
        const content = Array.isArray(r.content) ? r.content : [];
        const stop = W.stop(r);
        if (stop === 'refused') throw Object.assign(new Error('refused'), { code: 'ai-refused' });
        const a = { role: 'assistant', content, _cost: r.costUsd, _model: r.model };
        const calls = W.toolCalls(content);
        if (stop === 'tools' && calls.length && round < MAX_ROUNDS) {
          msgs.push(a);
          const results = calls.map((c) => {
            const out = CT.agentTools.run(S.state, c.name, c.input, { today: u.today() });
            return { id: c.id, content: out.content, isError: !!out.isError };
          });
          msgs.push(W.toolResults(results));
          round += 1;
          paint();
          continue;
        }
        // final answer (or cut short): keep no unanswered tool requests in the history
        a.content = W.withoutToolCalls(content);
        if (!W.text(a).trim()) a.content.push(W.textBlock(calls.length ? tx('aic.tooManySteps') : '…'));
        if (stop === 'cut') a._note = 'cut';
        msgs.push(a);
        break;
      }
    } catch (e) {
      if (gen !== st.gen) return false;
      msgs = msgs.slice(0, start); // nothing half-done stays in the history
      st.error = { code: e.code || 'server' };
      if (e.code === 'daily-cost') st.quotaDay = u.today();
      if (!st.draft) { // the question comes back to the field (also a focused one: nothing was typed meanwhile)
        st.draft = q;
        surfaces.forEach((s) => { const x = s.root.querySelector('textarea'); if (x) x.value = q; });
      }
    } finally {
      if (gen === st.gen) { st.busy = false; save(); paint(); }
    }
    if (gen === st.gen && hadFocus) {
      const s = [...surfaces].find((x) => x.kind === 'panel') || [...surfaces][0];
      if (s) focusInput(s.root, { start: st.draft.length, end: st.draft.length });
    }
    return !st.error;
  }
  V.ask = ask;
  /** For tests and the page: a read-only view of the shared state. */
  V.state = () => ({ busy: st.busy, error: st.error && st.error.code, gate: st.gate, draft: st.draft, count: msgs.length, gen: st.gen, surfaces: surfaces.size });

  async function check() {
    const cloud = CT.cloud;
    if (!cloud || !cloud.enabled) { st.gate = 'no-cloud'; return; }
    if (!cloud.signedIn()) { st.gate = 'sign-in'; return; }
    st.gate = null;
    const info = await CT.views.ai.ensureUsage();
    if (info.state === 'ok' && info.configured === false) st.gate = 'not-configured';
    else if (info.state === 'error' && info.code === 'no-function') st.gate = 'no-function';
  }
  V.check = () => check().then(paint);

  /* ---------- the quick panel ---------- */
  const visible = (el) => !!el && el.isConnected && el.getClientRects().length > 0 && !el.closest('[hidden]');
  V.isOpen = () => !!panel;
  /** Close the panel. Focus goes back to what opened it, or — when that is gone or hidden (the floating button is
   *  hidden on phones) — to the AI destination in the navigation, so keyboard and screen-reader users are not lost. */
  V.close = ({ restore = true } = {}) => {
    if (!panel) return;
    const was = panel;
    panel = null;
    surfaces.forEach((s) => { if (s.root === was) surfaces.delete(s); });
    if (st.refocus && st.refocus.kind === 'panel') st.refocus = null;
    was.remove();
    const fab = document.getElementById('ai-fab');
    if (fab) fab.setAttribute('aria-expanded', 'false');
    if (!restore) { opener = null; return; }
    const target = [opener, fab, ...document.querySelectorAll('[data-dest="ai"]')].find(visible) || document.getElementById('main');
    opener = null;
    if (target) { if (target.id === 'main' && !target.hasAttribute('tabindex')) target.setAttribute('tabindex', '-1'); target.focus({ preventScroll: true }); }
  };
  V.toggle = () => (panel ? V.close() : V.open());
  /** Open the panel (A key, floating button). On the AI page the page's own field gets focus instead. */
  V.open = async () => {
    const pageSurface = [...surfaces].find((s) => s.kind === 'page' && s.root.isConnected);
    if (pageSurface) { focusInput(pageSurface.root, { start: st.draft.length, end: st.draft.length }); return; }
    if (panel) { focusInput(panel); return; }
    opener = document.activeElement && document.activeElement !== document.body ? document.activeElement : null;
    panel = document.createElement('aside');
    panel.className = 'chat-panel';
    panel.setAttribute('role', 'dialog');
    panel.setAttribute('aria-modal', 'false');
    buildPanel();
    document.body.appendChild(panel);
    const fab = document.getElementById('ai-fab');
    if (fab) fab.setAttribute('aria-expanded', 'true');
    paint();
    focusInput(panel, { start: st.draft.length, end: st.draft.length });
    await check();
    paint();
  };
  function buildPanel() {
    I.localized(panel);
    panel.setAttribute('aria-label', tx('aic.title'));
    panel.innerHTML = surfaceHTML('panel');
    surfaces.forEach((s) => { if (s.kind === 'panel') surfaces.delete(s); });
    surfaces.add({ root: panel, kind: 'panel' });
    wire(panel, 'panel');
    panel.addEventListener('keydown', onPanelKey);
  }
  function onPanelKey(e) { if (e.key === 'Escape') { e.stopPropagation(); V.close(); } }

  // a language switch redraws the open panel in the new language, keeping the draft, the caret and the request
  I.onChange(() => {
    if (!panel) return;
    const had = st.refocus && st.refocus.kind === 'panel' ? Object.assign({}, st.refocus) : null;
    panel.removeEventListener('keydown', onPanelKey);
    buildPanel();
    paint();
    if (had) focusInput(panel, had);
  });
  if (typeof window !== 'undefined' && window.addEventListener) {
    window.addEventListener('online', () => paint());
    window.addEventListener('offline', () => paint());
  }
})(window.CT);
