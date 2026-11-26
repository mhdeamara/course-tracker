/* views/chat.js — the AI chat panel (opened by the 🤖 button or the A key).
 *
 * How a question is answered:
 *   1. The question goes to the Edge Function "ai" (action "chat"), which adds its own fixed instructions and the
 *      fixed list of read-only tools, and asks Claude.
 *   2. When Claude asks for a tool (e.g. "list_items"), the tool runs HERE, on the data in this browser
 *      (js/agent-tools.js), and only its result is sent back. Up to MAX_ROUNDS rounds per question.
 *   3. The answer is shown with chips that say what the assistant read.
 * The conversation is kept only on this device (localStorage), never in the cloud or in the backup, and is wiped on
 * "שיחה חדשה", on sign-out and when another account signs in. This version can only read; it changes nothing. */
(function (CT) {
  'use strict';
  const { u } = CT;
  const S = CT.store;
  const esc = u.esc;
  const V = {};
  CT.views = CT.views || {};
  CT.views.chat = V;

  const KEY = 'ct.ai.chat';
  const MAX_STORED = 80;     // messages kept on this device
  const SEND_LAST = 24;      // messages sent with each question (older ones are left out)
  const MAX_SEND_CHARS = 100_000;
  const MAX_ROUNDS = 6;      // tool rounds per question
  const MAX_CHARS = 2000;
  const SUGGESTIONS = ['מה יש לי לעשות השבוע?', 'אילו מטלות באיחור?', 'מה הממוצע שלי ונקודות הזכות?', 'מתי המבחנים שלי?'];

  const read = () => { try { const d = JSON.parse(localStorage.getItem(KEY) || 'null'); return d && Array.isArray(d.msgs) ? d.msgs : []; } catch (e) { return []; } };
  const save = () => { try { localStorage.setItem(KEY, JSON.stringify({ v: 1, msgs: msgs.slice(-MAX_STORED) })); } catch (e) { /* private mode: keep in memory only */ } };
  let msgs = read();
  let busy = false;
  let error = '';
  let gate = null;  // null = ok to chat; otherwise a message shown instead of the input
  let el = null;

  const typed = (m) => m && m.role === 'user' && Array.isArray(m.content) && m.content.some((b) => b.type === 'text');
  const short = (model) => (/haiku/.test(model) ? 'Haiku' : /sonnet/.test(model) ? 'Sonnet' : /opus/.test(model) ? 'Opus' : model || '');
  const money = (x) => { const n = Number(x) || 0; return n > 0 && n < 0.001 ? '<$0.001' : `$${n.toFixed(n < 0.1 ? 3 : 2)}`; };

  /** Wipe the conversation (new chat, sign-out, other account). */
  V.forget = () => {
    msgs = [];
    error = '';
    try { localStorage.removeItem(KEY); } catch (e) { /* ignore */ }
    if (el) paint();
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

  function chip(b) {
    const label = CT.agentTools.LABELS[b.name] || b.name;
    const dm = (iso) => (/^\d{4}-\d{2}-\d{2}$/.test(iso || '') ? `${iso.slice(8, 10)}/${iso.slice(5, 7)}` : '');
    const i = b.input || {};
    const arg = i.course || i.query || (i.from || i.to ? [dm(i.from) || '…', dm(i.to) || '…'].join(' עד ') : '');
    return `<span class="chat-chip" title="העוזר קרא נתונים מהאתר (בלי לשנות כלום)">🔎 ${esc(label)}${arg ? `: ${esc(String(arg).slice(0, 40))}` : ''}</span>`;
  }

  function logHTML() {
    if (!msgs.length) {
      return `<div class="chat-empty">
        <p><b>שלום!</b> אפשר לשאול על הקורסים, המטלות, המבחנים, המערכת והממוצע שלך.</p>
        <div class="chat-suggest">${SUGGESTIONS.map((s) => `<button type="button" class="chat-sug" data-sug="${esc(s)}">${esc(s)}</button>`).join('')}</div>
        <p class="small muted">העוזר רק קורא את הנתונים ולא משנה כלום. השאלות והנתונים שהוא קורא נשלחים לעיבוד אצל Anthropic.
          השיחה נשמרת רק במכשיר הזה.</p></div>`;
    }
    const parts = [];
    let chips = [];
    let turnCost = 0;
    msgs.forEach((m, i) => {
      if (m.role === 'user') {
        if (!typed(m)) return; // tool results are not shown
        const t = m.content.filter((b) => b.type === 'text').map((b) => b.text).join('\n');
        parts.push(`<div class="chat-msg chat-user" dir="auto">${esc(t).replace(/\n/g, '<br>')}</div>`);
        chips = [];
        turnCost = 0;
        return;
      }
      turnCost += Number(m._cost) || 0;
      (m.content || []).forEach((b) => { if (b.type === 'tool_use') chips.push(chip(b)); });
      const text = (m.content || []).filter((b) => b.type === 'text').map((b) => b.text).join('\n').trim();
      const last = i === msgs.length - 1 || typed(msgs[i + 1]);
      if (!last) return; // intermediate steps of a tool loop: only their chips are shown
      parts.push(`<div class="chat-msg chat-bot">
        ${chips.length ? `<div class="chat-chips">${[...new Set(chips)].map((c) => { const k = chips.filter((x) => x === c).length; return k > 1 ? c.replace('</span>', ` ×${k}</span>`) : c; }).join('')}</div>` : ''}
        <div class="chat-text" dir="auto">${fmt(text || '…')}</div>
        ${m._note ? `<div class="small ai-error">${esc(m._note)}</div>` : ''}
        <div class="chat-meta">${esc(short(m._model))}${turnCost ? ` · ${money(turnCost)}` : ''}</div></div>`);
    });
    if (busy) parts.push('<div class="chat-msg chat-bot chat-wait" aria-label="העוזר כותב"><span></span><span></span><span></span></div>');
    return parts.join('');
  }

  function paint() {
    if (!el) return;
    const log = el.querySelector('.chat-log');
    log.innerHTML = gate ? `<div class="chat-empty"><p>${gate}</p></div>` : logHTML();
    el.querySelector('.chat-err').textContent = error;
    el.querySelector('.chat-err').hidden = !error;
    const form = el.querySelector('.chat-form');
    form.hidden = !!gate;
    form.querySelector('textarea').disabled = busy;
    form.querySelector('button').disabled = busy;
    el.querySelector('.chat-model').textContent = short(CT.views.ai.settings().chatModel);
    log.scrollTop = log.scrollHeight;
  }

  /** The conversation as the server accepts it: no "_" fields, the last SEND_LAST messages, starting at a typed question. */
  function payload() {
    const clean = msgs.map((m) => ({ role: m.role, content: m.content }));
    let start = Math.max(0, clean.length - SEND_LAST);
    while (start < clean.length && !typed(clean[start])) start += 1;
    let out = clean.slice(start);
    while (JSON.stringify(out).length > MAX_SEND_CHARS) {
      let next = 1;
      while (next < out.length && !typed(out[next])) next += 1;
      if (next >= out.length) break;
      out = out.slice(next);
    }
    return out;
  }

  async function ask(text) {
    const q = String(text || '').trim();
    if (!q || busy || gate) return;
    if (q.length > MAX_CHARS) { error = `ההודעה ארוכה מדי (עד ${MAX_CHARS} תווים)`; paint(); return; }
    const start = msgs.length;
    const model = CT.views.ai.settings().chatModel;
    error = '';
    msgs.push({ role: 'user', content: [{ type: 'text', text: q }] });
    busy = true;
    paint();
    try {
      let round = 0;
      for (;;) {
        const r = await CT.views.ai.call({ action: 'chat', model, messages: payload() });
        const content = Array.isArray(r.content) ? r.content : [];
        if (r.stopReason === 'refusal') throw Object.assign(new Error('המודל סירב לענות על השאלה הזו. נסה לנסח אחרת.'), { code: 'ai-refused' });
        const a = { role: 'assistant', content, _cost: r.costUsd, _model: r.model };
        const uses = content.filter((b) => b.type === 'tool_use');
        if (r.stopReason === 'tool_use' && uses.length && round < MAX_ROUNDS) {
          msgs.push(a);
          const results = uses.map((b) => {
            const out = CT.agentTools.run(S.state, b.name, b.input, { today: u.today() });
            return Object.assign({ type: 'tool_result', tool_use_id: b.id, content: out.content }, out.isError ? { is_error: true } : {});
          });
          msgs.push({ role: 'user', content: results });
          round += 1;
          paint();
          continue;
        }
        // final answer (or cut short): keep no unanswered tool requests in the history
        a.content = content.filter((b) => b.type !== 'tool_use');
        if (!a.content.some((b) => b.type === 'text' && b.text.trim())) a.content.push({ type: 'text', text: uses.length ? 'עצרתי: השאלה דרשה יותר מדי שלבים. נסה לשאול על משהו מצומצם יותר.' : '…' });
        if (r.stopReason === 'max_tokens') a._note = 'התשובה נקטעה כי הייתה ארוכה מדי.';
        msgs.push(a);
        break;
      }
    } catch (e) {
      msgs = msgs.slice(0, start); // nothing half-done stays in the history
      error = e.message || 'שגיאה';
      if (el) el.querySelector('textarea').value = q;
    }
    busy = false;
    save();
    paint();
    if (el && !error) el.querySelector('textarea').focus();
  }

  async function check() {
    const cloud = CT.cloud;
    if (!cloud || !cloud.enabled) { gate = 'העוזר עובד דרך Supabase, שעוד לא הוגדר באתר הזה.'; return; }
    if (!cloud.signedIn()) { gate = 'כדי להשתמש בעוזר צריך להתחבר לחשבון באתר: הגדרות ← "סנכרון בין מכשירים".'; return; }
    gate = null;
    try {
      const r = await CT.views.ai.call({ action: 'usage' });
      if (!r.configured) gate = 'העוזר עוד לא הוגדר: חסר הסוד <code dir="ltr">ANTHROPIC_API_KEY</code> ב-Supabase (ההוראות ב-README).';
    } catch (e) {
      if (e.code === 'no-function' || e.code === 'offline') gate = esc(e.message); // otherwise let the question itself report the problem
    }
  }

  V.isOpen = () => !!el;
  V.close = () => {
    if (!el) return;
    el.remove();
    el = null;
    const fab = document.getElementById('ai-fab');
    if (fab) { fab.setAttribute('aria-expanded', 'false'); fab.focus(); }
  };
  V.toggle = () => (el ? V.close() : V.open());
  V.open = async () => {
    if (el) { el.querySelector('textarea').focus(); return; }
    el = document.createElement('aside');
    el.className = 'chat-panel';
    el.setAttribute('role', 'dialog');
    el.setAttribute('aria-label', 'עוזר AI');
    el.innerHTML = `
      <header class="chat-head">
        <b>🤖 עוזר AI</b><span class="chat-model small muted"></span>
        <span class="chat-head-actions">
          <button type="button" class="btn btn-small btn-ghost" data-c="new" title="מחיקת השיחה מהמכשיר">שיחה חדשה</button>
          <button type="button" class="icon-btn" data-c="settings" aria-label="הגדרות העוזר" title="הגדרות העוזר (מודל, שימוש היום)">⚙️</button>
          <button type="button" class="icon-btn" data-c="close" aria-label="סגור">${u.icon.close}</button>
        </span>
      </header>
      <div class="chat-log" aria-live="polite"></div>
      <div class="chat-err small ai-error" role="alert" hidden></div>
      <form class="chat-form">
        <textarea rows="2" maxlength="${MAX_CHARS}" dir="auto" placeholder="שאל על הקורסים, המטלות או הממוצע…" aria-label="שאלה לעוזר"></textarea>
        <button type="submit" class="btn btn-primary">שלח</button>
      </form>`;
    document.body.appendChild(el);
    const fab = document.getElementById('ai-fab');
    if (fab) fab.setAttribute('aria-expanded', 'true');
    const ta = el.querySelector('textarea');
    el.querySelector('.chat-form').onsubmit = (e) => { e.preventDefault(); const t = ta.value; ta.value = ''; ask(t); };
    ta.addEventListener('keydown', (e) => { if (e.key === 'Enter' && !e.shiftKey && !e.isComposing) { e.preventDefault(); el.querySelector('.chat-form').requestSubmit(); } });
    el.addEventListener('keydown', (e) => { if (e.key === 'Escape') { e.stopPropagation(); V.close(); } });
    el.addEventListener('click', async (e) => {
      const sug = e.target.closest('[data-sug]');
      if (sug) { ask(sug.dataset.sug); return; }
      const b = e.target.closest('[data-c]');
      if (!b) return;
      if (b.dataset.c === 'close') V.close();
      if (b.dataset.c === 'settings') { V.close(); location.hash = '#/settings'; setTimeout(() => { const s = document.getElementById('ai'); if (s) s.scrollIntoView({ block: 'start' }); }, 60); }
      if (b.dataset.c === 'new' && !busy && msgs.length && (await CT.ui.confirm('למחוק את השיחה מהמכשיר ולהתחיל שיחה חדשה?', 'שיחה חדשה'))) V.forget();
    });
    gate = null;
    paint();
    ta.focus();
    await check();
    paint();
  };
})(window.CT);
