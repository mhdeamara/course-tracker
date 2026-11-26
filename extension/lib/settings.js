/* settings.js — the extension's settings (chrome.storage.local "settings") and their checks. No secrets here:
 * the Supabase URL and the public anon/publishable key are typed in by the user on the options page. */
(function (root) {
  'use strict';
  const S = {};
  S.DEFAULT_SITE = 'https://mhdeamara.github.io/course-tracker/';
  S.DEFAULTS = {
    mode: 'local', // 'local' = only what the open site hands over; 'connected' = also read your own cloud row
    siteUrl: S.DEFAULT_SITE,
    sbUrl: '', sbKey: '', // connected mode only — your own project's URL and public anon/publishable key
    show: { today: true, urgent: true, exams: true, points: true },
    adhkarNotify: true, // a notification when a morning/evening window starts while the site is closed
  };

  S.merge = (s) => {
    const x = Object.assign({}, S.DEFAULTS, s || {});
    x.show = Object.assign({}, S.DEFAULTS.show, (s && s.show) || {});
    return x;
  };
  /** "https://host/path/" → "https://host/path/*" (a match pattern; the port is dropped, patterns match any port). */
  S.pattern = (siteUrl) => {
    const u = new URL(siteUrl);
    let path = u.pathname.endsWith('/') ? u.pathname : u.pathname.replace(/[^/]*$/, '');
    return `${u.protocol}//${u.hostname}${path}*`;
  };
  /** Normalized site URL, or an error message. Only https (or http on this computer). */
  S.checkSite = (raw) => {
    let u;
    try { u = new URL(String(raw || '').trim()); } catch (e) { return { err: 'כתובת לא תקינה' }; }
    const local = u.hostname === 'localhost' || u.hostname === '127.0.0.1';
    if (u.protocol !== 'https:' && !(u.protocol === 'http:' && local)) return { err: 'רק https (או http על המחשב הזה)' };
    u.hash = ''; u.search = '';
    if (!u.pathname.endsWith('/')) u.pathname = u.pathname.replace(/[^/]*$/, '');
    return { url: u.href };
  };
  S.siteMatches = (siteUrl, url) => {
    try {
      const a = new URL(siteUrl), b = new URL(url);
      return a.protocol === b.protocol && a.host === b.host && b.pathname.startsWith(a.pathname);
    } catch (e) { return false; }
  };
  /** The Supabase project URL, or an error. */
  S.checkSbUrl = (raw) => {
    let u;
    try { u = new URL(String(raw || '').trim()); } catch (e) { return { err: 'כתובת לא תקינה' }; }
    if (u.protocol !== 'https:') return { err: 'צריך כתובת https' };
    return { url: u.origin };
  };
  /** Only a public key is accepted. A secret / service_role key is refused and never stored. */
  S.checkKey = (raw) => {
    const k = String(raw || '').trim();
    if (!k) return { err: 'חסר מפתח' };
    if (/^sb_secret_/i.test(k)) return { err: 'זה מפתח סודי (secret). צריך את המפתח הציבורי: anon / publishable' };
    const parts = k.split('.');
    if (parts.length === 3) {
      try {
        const p = JSON.parse(atob(parts[1].replace(/-/g, '+').replace(/_/g, '/')));
        if (p.role && p.role !== 'anon') return { err: `זה מפתח ${p.role}. צריך את המפתח הציבורי (anon)` };
      } catch (e) { return { err: 'מפתח לא תקין' }; }
      return { key: k };
    }
    if (/^sb_publishable_[A-Za-z0-9_-]+$/.test(k)) return { key: k };
    return { err: 'מפתח לא מוכר: צריך anon (JWT) או sb_publishable_…' };
  };
  S.cloudReady = (s) => !!(s.sbUrl && s.sbKey && S.checkSbUrl(s.sbUrl).url && S.checkKey(s.sbKey).key);

  root.CTSettings = S;
})(typeof self !== 'undefined' ? self : globalThis);
