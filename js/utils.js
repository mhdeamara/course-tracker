/* utils.js — small pure helpers shared by every module (dates, escaping, icons). */
window.CT = window.CT || {};
(function (CT) {
  'use strict';
  const u = {};

  u.uid = () => Date.now().toString(36) + Math.random().toString(36).slice(2, 8);
  u.esc = (s) => String(s == null ? '' : s).replace(/[&<>"']/g, (c) => (
    { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  u.isNum = (v) => typeof v === 'number' && isFinite(v);
  u.clamp = (v, a, b) => Math.min(b, Math.max(a, v));
  u.sum = (arr, f = (x) => x) => arr.reduce((s, x) => s + (Number(f(x)) || 0), 0);
  u.debounce = (fn, ms) => { let t; return (...a) => { clearTimeout(t); t = setTimeout(() => fn(...a), ms); }; };
  u.norm = (s) => String(s || '').toLowerCase().replace(/[֑-ׇ]/g, ''); // strips niqqud

  /* ---------- dates: stored as 'YYYY-MM-DD' strings (local time) ---------- */
  u.pad = (n) => String(n).padStart(2, '0');
  u.isoDate = (d = new Date()) => `${d.getFullYear()}-${u.pad(d.getMonth() + 1)}-${u.pad(d.getDate())}`;
  u.today = () => u.isoDate(new Date());
  u.parseDate = (iso) => {
    if (!iso) return null;
    const [y, m, d] = String(iso).slice(0, 10).split('-').map(Number);
    return new Date(y, m - 1, d);
  };
  u.addDays = (iso, n) => { const d = u.parseDate(iso); d.setDate(d.getDate() + n); return u.isoDate(d); };
  u.daysBetween = (a, b) => Math.round((u.parseDate(b) - u.parseDate(a)) / 86400000);
  u.daysUntil = (iso) => u.daysBetween(u.today(), iso);
  u.weekStart = (iso = u.today()) => u.addDays(iso, -u.parseDate(iso).getDay()); // Sunday
  u.fmtDate = (iso) => { if (!iso) return ''; const d = u.parseDate(iso); return `${d.getDate()}/${d.getMonth() + 1}`; };
  u.fmtDateFull = (iso) => { if (!iso) return ''; const d = u.parseDate(iso); return `${d.getDate()}/${d.getMonth() + 1}/${d.getFullYear()}`; };
  u.relDays = (iso) => {
    const n = u.daysUntil(iso);
    if (n === 0) return 'היום';
    if (n === 1) return 'מחר';
    if (n === -1) return 'אתמול (באיחור)';
    if (n < 0) return `באיחור ${-n} ימים`;
    return `בעוד ${n} ימים`;
  };
  /** Hebrew year (5787) → "תשפ״ז" (thousands omitted, 15/16 written טו/טז). */
  u.hebYear = (n) => {
    n = Number(n);
    if (!(n > 0)) return '';
    let r = n % 1000;
    const H = [[400, 'ת'], [300, 'ש'], [200, 'ר'], [100, 'ק'], [90, 'צ'], [80, 'פ'], [70, 'ע'], [60, 'ס'], [50, 'נ'], [40, 'מ'], [30, 'ל'], [20, 'כ'], [10, 'י'], [9, 'ט'], [8, 'ח'], [7, 'ז'], [6, 'ו'], [5, 'ה'], [4, 'ד'], [3, 'ג'], [2, 'ב'], [1, 'א']];
    let out = '';
    while (r > 0) {
      if (r === 15) { out += 'טו'; break; }
      if (r === 16) { out += 'טז'; break; }
      const [v, ch] = H.find(([x]) => x <= r);
      out += ch; r -= v;
    }
    return out.length === 1 ? out + '׳' : out.slice(0, -1) + '״' + out.slice(-1);
  };
  /** "תשפ״ז" / 'תשפ"ז' / "5787" → 5787 (null if not recognised). */
  u.parseHebYear = (s) => {
    s = String(s || '').trim();
    if (/^5\d{3}$/.test(s)) return Number(s);
    const clean = s.replace(/[״"׳']/g, '');
    if (!/^[א-ת]+$/.test(clean)) return null;
    for (let y = 5600; y < 6000; y++) if (u.hebYear(y).replace(/[״׳]/g, '') === clean) return y;
    return null;
  };
  u.DAYS = ['ראשון', 'שני', 'שלישי', 'רביעי', 'חמישי', 'שישי', 'שבת'];
  u.DAYS_SHORT = ['א׳', 'ב׳', 'ג׳', 'ד׳', 'ה׳', 'ו׳', 'ש׳'];
  u.timeToMin = (t) => { if (!t) return 0; const [h, m] = t.split(':').map(Number); return h * 60 + (m || 0); };
  u.minToTime = (m) => `${u.pad(Math.floor(m / 60))}:${u.pad(m % 60)}`;
  u.fmtMinutes = (m) => {
    m = Math.round(m);
    if (m < 60) return `${m} דק׳`;
    const h = Math.floor(m / 60), r = m % 60;
    return r ? `${h} ש׳ ${r} דק׳` : `${h} ש׳`;
  };

  /* ---------- text ---------- */
  u.safeUrl = (url) => {
    url = String(url || '').trim();
    if (!url) return '';
    if (!/^[a-z][a-z0-9+.-]*:/i.test(url)) url = 'https://' + url;
    return /^(https?|mailto|file):/i.test(url) ? url : '';
  };
  u.highlight = (text, q) => {
    const t = u.esc(text);
    if (!q) return t;
    const re = new RegExp(u.esc(q).replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'gi');
    return t.replace(re, (m) => `<mark>${m}</mark>`);
  };
  /** Rich text for notes: escapes HTML, renders $..$ / $$..$$ with local KaTeX, links URLs. */
  u.rich = (text) => {
    if (!text) return '';
    const parts = String(text).split(/(\$\$[\s\S]+?\$\$|\$[^$\n]+?\$)/g);
    return parts.map((p, i) => {
      if (i % 2 === 1) {
        const display = p.startsWith('$$');
        const tex = display ? p.slice(2, -2) : p.slice(1, -1);
        if (window.katex) {
          try {
            return `<span class="math${display ? ' math-block' : ''}" dir="ltr">${window.katex.renderToString(tex, { displayMode: display, throwOnError: false, output: 'html' })}</span>`;
          } catch (e) { /* fall through to plain text */ }
        }
        return `<code dir="ltr">${u.esc(p)}</code>`;
      }
      return u.esc(p)
        .replace(/(https?:\/\/[^\s<]+)/g, '<a href="$1" target="_blank" rel="noopener noreferrer" dir="ltr">$1</a>')
        .replace(/\n/g, '<br>');
    }).join('');
  };

  /* ---------- icons (inline SVG, no external libraries) ---------- */
  const svg = (p, extra = '') => `<svg class="ic" viewBox="0 0 24 24" aria-hidden="true" focusable="false" ${extra}>${p}</svg>`;
  u.icon = {
    check: svg('<path d="M5 12.5l4.2 4.2L19 7" class="check-path"/>'),
    grip: svg('<circle cx="9" cy="6" r="1.4"/><circle cx="15" cy="6" r="1.4"/><circle cx="9" cy="12" r="1.4"/><circle cx="15" cy="12" r="1.4"/><circle cx="9" cy="18" r="1.4"/><circle cx="15" cy="18" r="1.4"/>', 'data-fill'),
    note: svg('<path d="M5 4h10l4 4v12H5z"/><path d="M15 4v4h4M8 12h8M8 16h5"/>'),
    star: svg('<path d="M12 3.5l2.6 5.3 5.9.9-4.3 4.1 1 5.8L12 16.9 6.8 19.6l1-5.8-4.3-4.1 5.9-.9z"/>'),
    more: svg('<circle cx="5" cy="12" r="1.6"/><circle cx="12" cy="12" r="1.6"/><circle cx="19" cy="12" r="1.6"/>', 'data-fill'),
    plus: svg('<path d="M12 5v14M5 12h14"/>'),
    trash: svg('<path d="M4 7h16M9 7V4h6v3M6 7l1 13h10l1-13"/>'),
    edit: svg('<path d="M4 20h4L19 9l-4-4L4 16z"/>'),
    search: svg('<circle cx="11" cy="11" r="6.5"/><path d="M20 20l-4.2-4.2"/>'),
    sun: svg('<circle cx="12" cy="12" r="4"/><path d="M12 2v2M12 20v2M2 12h2M20 12h2M4.9 4.9l1.4 1.4M17.7 17.7l1.4 1.4M4.9 19.1l1.4-1.4M17.7 6.3l1.4-1.4"/>'),
    moon: svg('<path d="M20 14.5A8 8 0 019.5 4a8 8 0 1010.5 10.5z"/>'),
    timer: svg('<circle cx="12" cy="13" r="7.5"/><path d="M12 9v4l2.5 2M9.5 2.5h5"/>'),
    print: svg('<path d="M7 9V3h10v6M7 17H4v-7h16v7h-3M7 14h10v7H7z"/>'),
    link: svg('<path d="M10 14a4 4 0 005.7 0l3-3a4 4 0 00-5.7-5.7l-1 1M14 10a4 4 0 00-5.7 0l-3 3a4 4 0 005.7 5.7l1-1"/>'),
    close: svg('<path d="M6 6l12 12M18 6L6 18"/>'),
    archive: svg('<path d="M3 5h18v4H3zM5 9v10h14V9M10 13h4"/>'),
    calendar: svg('<rect x="3.5" y="5" width="17" height="15" rx="2"/><path d="M3.5 10h17M8 3v4M16 3v4"/>'),
    chart: svg('<path d="M4 20V10M10 20V4M16 20v-7M21 20H3"/>'),
    home: svg('<path d="M4 11l8-7 8 7v9h-5v-6H9v6H4z"/>'),
    gear: svg('<circle cx="12" cy="12" r="3"/><path d="M19.4 15a1.7 1.7 0 00.3 1.8l.1.1a2 2 0 11-2.8 2.8l-.1-.1a1.7 1.7 0 00-1.8-.3 1.7 1.7 0 00-1 1.5V21a2 2 0 11-4 0v-.1a1.7 1.7 0 00-1.1-1.5 1.7 1.7 0 00-1.8.3l-.1.1a2 2 0 11-2.8-2.8l.1-.1a1.7 1.7 0 00.3-1.8 1.7 1.7 0 00-1.5-1H3a2 2 0 110-4h.1a1.7 1.7 0 001.5-1.1 1.7 1.7 0 00-.3-1.8l-.1-.1a2 2 0 112.8-2.8l.1.1a1.7 1.7 0 001.8.3H9a1.7 1.7 0 001-1.5V3a2 2 0 114 0v.1a1.7 1.7 0 001 1.5 1.7 1.7 0 001.8-.3l.1-.1a2 2 0 112.8 2.8l-.1.1a1.7 1.7 0 00-.3 1.8V9a1.7 1.7 0 001.5 1H21a2 2 0 110 4h-.1a1.7 1.7 0 00-1.5 1z"/>'),
    book: svg('<path d="M4 5a2 2 0 012-2h13v16H6a2 2 0 00-2 2zM4 21V5M8 7h7"/>'),
    flag: svg('<path d="M5 21V4M5 4h11l-2 4 2 4H5"/>'),
    undo: svg('<path d="M9 14L4 9l5-5"/><path d="M4 9h10a6 6 0 010 12h-3"/>'),
    up: svg('<path d="M12 19V5M6 11l6-6 6 6"/>'),
    down: svg('<path d="M12 5v14M6 13l6 6 6-6"/>'),
    play: svg('<path d="M7 4l13 8-13 8z"/>', 'data-fill'),
    pause: svg('<path d="M7 4h4v16H7zM13 4h4v16h-4z"/>', 'data-fill'),
    stop: svg('<rect x="6" y="6" width="12" height="12" rx="1.5"/>', 'data-fill'),
    keyboard: svg('<rect x="2.5" y="6" width="19" height="12" rx="2"/><path d="M6 10h.01M10 10h.01M14 10h.01M18 10h.01M7 14h10"/>'),
    download: svg('<path d="M12 4v11M7 10l5 5 5-5M5 20h14"/>'),
    upload: svg('<path d="M12 20V9M7 14l5-5 5 5M5 4h14"/>'),
    menu: svg('<path d="M4 7h16M4 12h16M4 17h16"/>'),
    layers: svg('<path d="M12 3l9 5-9 5-9-5z"/><path d="M3 13l9 5 9-5"/>'),
    award: svg('<circle cx="12" cy="9" r="5.5"/><path d="M8.5 13.5L7 21l5-2.5 5 2.5-1.5-7.5"/>'),
  };

  CT.u = u;
})(window.CT);
