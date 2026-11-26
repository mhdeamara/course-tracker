/* views/ai.js — the AI assistant: settings card (status, usage today, model choice, connection check).
 * Every AI call goes through the Supabase Edge Function "ai" (supabase/functions/ai); the API key lives only there. */
(function (CT) {
  'use strict';
  const { u, ui } = CT;
  const S = CT.store;
  const esc = u.esc;
  const V = {};
  CT.views = CT.views || {};
  CT.views.ai = V;

  V.MODELS = {
    'claude-haiku-5-5': 'Claude Haiku 5.5 — הכי זול ($0.10 / $0.50 למיליון טוקנים)',
    'claude-sonnet-5-5': 'Claude Sonnet 5.5 — מאוזן ($2 / $10)',
    'claude-opus-5-5': 'Claude Opus 5.5 — הכי חזק ($4 / $20)',
  };
  V.DEFAULTS = { extractModel: 'claude-sonnet-5-5', chatModel: 'claude-haiku-5-5' };
  V.settings = () => Object.assign({}, V.DEFAULTS, S.state.settings.ai || {});

  const C = () => CT.cloud;
  let info = { state: 'unknown' }; // unknown | loading | ok | error
  let busy = false;
  const rerender = () => { if (location.hash === '#/settings') CT.app.rerender(); };

  /** Call the Edge Function. Throws Error with a Hebrew message and .code. */
  V.call = async (body) => {
    try { return await C().ai(body); } catch (e) {
      const d = e.data || {};
      const offline = e instanceof TypeError;
      const noFn = !d.error && (e.status === 404 || (e.status === 400 && /not.?found|function/i.test(e.message || '')));
      const err = new Error((d.error && d.message) || (offline ? 'אין חיבור לאינטרנט — העוזר לא זמין, שאר האתר עובד כרגיל'
        : noFn ? 'פונקציית העוזר (ai) עוד לא הותקנה ב-Supabase. ההוראות ב-README.' : C().heMsg(e)));
      err.code = d.error || (offline ? 'offline' : noFn ? 'no-function' : 'server');
      err.retryAfter = d.retryAfter;
      throw err;
    }
  };

  async function loadUsage() {
    info = { state: 'loading' };
    try { info = Object.assign({ state: 'ok' }, await V.call({ action: 'usage' })); } catch (e) { info = { state: 'error', error: e.message }; }
    rerender();
  }
  V.refreshUsage = () => { if (C() && C().signedIn()) loadUsage(); };
  V.reset = () => { info = { state: 'unknown' }; };

  const money = (x) => { const n = Number(x) || 0; return n > 0 && n < 0.001 ? '<$0.001' : `$${n.toFixed(n < 0.1 ? 3 : 2)}`; };

  V.section = () => {
    const cloud = C();
    const set = V.settings();
    const head = '<h2>🤖 עוזר AI</h2>';
    const privacy = `<p class="small muted">כל בקשה לעוזר נשלחת לעיבוד אצל Anthropic (ספק מודל Claude) דרך שרת ה-Supabase שלך.
      לפי מדיניות Anthropic ל-API: התוכן לא משמש לאימון מודלים, ונמחק אצלם תוך 30 יום (תוכן שסומן כהפרת מדיניות עשוי להישמר עד שנתיים).
      מפתח ה-API נשמר רק כסוד בשרת — לא באתר, לא בדפדפן ולא בגיבוי.</p>`;
    if (!cloud || !cloud.enabled) return `<section class="card ai-card" id="ai">${head}<p class="muted">העוזר עובד דרך Supabase, שעוד לא הוגדר באתר הזה.</p></section>`;
    if (!cloud.signedIn()) return `<section class="card ai-card" id="ai">${head}<p class="muted">כדי להשתמש בעוזר צריך להתחבר לחשבון באתר (בסעיף "סנכרון בין מכשירים").</p>${privacy}</section>`;
    if (info.state === 'unknown') setTimeout(loadUsage, 0);

    let status;
    if (info.state === 'loading' || info.state === 'unknown') status = '<p class="small muted">בודק…</p>';
    else if (info.state === 'error') status = `<p class="small ai-error">⚠️ ${esc(info.error)}</p><button class="btn btn-small" data-action="ai-reload">נסה שוב</button>`;
    else {
      const t = info.today || {};
      const L = info.limits || {};
      const pct = L.dailyCostUsd ? Math.min(100, Math.round((t.costUsd / L.dailyCostUsd) * 100)) : 0;
      status = `${info.configured ? '<p class="small">✅ העוזר מוגדר בשרת.</p>'
        : '<p class="small ai-error">⚠️ העוזר עוד לא מוגדר: חסר הסוד <code dir="ltr">ANTHROPIC_API_KEY</code> ב-Supabase (ההוראות ב-README).</p>'}
        <div class="ai-usage">
          <div class="small">נוצל היום: <b dir="ltr">${money(t.costUsd)}</b> מתוך <b dir="ltr">${money(L.dailyCostUsd)}</b> · ${t.requests || 0} בקשות · ${t.extracts || 0}/${L.dailyExtracts || 0} גיליונות ציונים</div>
          ${ui.bar(pct, '', true)}
          <div class="small muted">מגבלות: עד ${L.perMinute} בקשות בדקה · קובץ עד ${Math.round((L.maxFileBytes || 0) / 1048576)}MB ו-${L.maxPdfPages} עמודים · הודעת צ'אט עד ${L.maxChatChars} תווים. היום מתחלף בחצות (שעון ישראל).</div>
        </div>`;
    }
    const sel = (name, cur) => `<select data-ai-pref="${name}">${Object.keys(V.MODELS).map((m) => `<option value="${m}"${m === cur ? ' selected' : ''}>${esc(V.MODELS[m])}</option>`).join('')}</select>`;
    return `<section class="card ai-card" id="ai">
      ${head}
      ${status}
      <div class="form-grid">
        <label class="field"><span>מודל לקריאת גיליונות ציונים</span>${sel('extractModel', set.extractModel)}</label>
        <label class="field"><span>מודל לצ'אט</span>${sel('chatModel', set.chatModel)}</label>
      </div>
      <p class="small muted">הערכה גסה: גיליון ציונים של 3 עמודים עולה כ-$0.05 ב-Sonnet (כ-$0.005 ב-Haiku); הודעת צ'אט כ-$0.001 ב-Haiku (כ-$0.02 ב-Sonnet).
        כדאי גם להגדיר תקרת הוצאה חודשית בחשבון Anthropic עצמו (ההוראות ב-README).</p>
      <div class="btn-row">
        <button class="btn" data-action="ai-ping"${busy || info.configured === false ? ' disabled' : ''}>${busy ? 'בודק…' : 'בדוק חיבור'}</button>
        <button class="btn btn-ghost" data-action="ai-reload">רענן נתוני שימוש</button>
      </div>
      ${privacy}
    </section>`;
  };

  V.onClick = async (a) => {
    switch (a.dataset.action) {
      case 'ai-reload': loadUsage(); break;
      case 'ai-ping':
        busy = true;
        rerender();
        try {
          const r = await V.call({ action: 'ping' });
          ui.toast(`✅ העוזר עובד (${esc(r.model)}, עלות הבדיקה ${money(r.costUsd)})`);
        } catch (e) { ui.toast(e.message, { error: true }); }
        busy = false;
        loadUsage();
        break;
      default: break;
    }
  };
  /* ---------- floating button (every screen) + quick panel. The chat will live in this panel (step C). ---------- */
  V.mountFab = () => {
    if (document.getElementById('ai-fab')) return;
    const b = document.createElement('button');
    b.id = 'ai-fab';
    b.className = 'ai-fab';
    b.type = 'button';
    b.title = 'עוזר AI (A)';
    b.setAttribute('aria-label', 'עוזר AI (קיצור: A)');
    b.textContent = '🤖';
    b.onclick = V.open;
    document.body.appendChild(b);
  };

  V.open = () => {
    if (document.querySelector('.ai-panel')) return;
    const cloud = C();
    const box = document.createElement('div');
    box.className = 'ai-panel';
    const toSettings = '<button class="btn btn-ghost" data-ai-go>להגדרות העוזר</button>';
    const soon = '<p class="small muted">בקרוב כאן: צ\'אט על הקורסים והמטלות שלך, וקריאת גיליון ציונים (PDF או תמונה).</p>';
    const paint = (status, buttons) => {
      box.innerHTML = `${status}${soon}<div class="btn-row">${buttons}${toSettings}</div>`;
      const go = box.querySelector('[data-ai-go]');
      go.onclick = () => { m.close(); location.hash = '#/settings'; setTimeout(() => { const el = document.getElementById('ai'); if (el) el.scrollIntoView({ block: 'start' }); }, 60); };
      const ping = box.querySelector('[data-ai-ping]');
      if (ping) ping.onclick = async () => {
        ping.disabled = true;
        ping.textContent = 'בודק…';
        try { const r = await V.call({ action: 'ping' }); ui.toast(`✅ העוזר עובד (${esc(r.model)}, עלות הבדיקה ${money(r.costUsd)})`); } catch (e) { ui.toast(e.message, { error: true }); }
        load();
      };
    };
    const load = async () => {
      if (!cloud || !cloud.enabled) return paint('<p class="muted">העוזר עובד דרך Supabase, שעוד לא הוגדר באתר הזה.</p>', '');
      if (!cloud.signedIn()) return paint('<p class="muted">כדי להשתמש בעוזר צריך להתחבר לחשבון באתר (בהגדרות ← "סנכרון בין מכשירים").</p>', '');
      paint('<p class="small muted">בודק…</p>', '');
      try {
        const r = await V.call({ action: 'usage' });
        info = Object.assign({ state: 'ok' }, r);
        const t = r.today || {};
        const L = r.limits || {};
        paint(`${r.configured ? '<p>✅ העוזר מוגדר ומוכן.</p>' : '<p class="ai-error">⚠️ חסר הסוד <code dir="ltr">ANTHROPIC_API_KEY</code> ב-Supabase (ההוראות ב-README).</p>'}
          <p class="small">נוצל היום: <b dir="ltr">${money(t.costUsd)}</b> מתוך <b dir="ltr">${money(L.dailyCostUsd)}</b> · ${t.requests || 0} בקשות</p>`,
          r.configured ? '<button class="btn btn-primary" data-ai-ping>בדוק חיבור</button>' : '');
      } catch (e) {
        paint(`<p class="ai-error">⚠️ ${esc(e.message)}</p>`, '');
      }
    };
    const m = ui.modal({ title: '🤖 עוזר AI', body: box });
    load();
  };

  V.onChange = (t) => {
    const k = t.dataset.aiPref;
    if (k && t.value in V.MODELS) S.commit('מודל לעוזר', (st) => { st.settings.ai = Object.assign({}, V.DEFAULTS, st.settings.ai || {}, { [k]: t.value }); });
  };
})(window.CT);
