/* ical.js — a small iCalendar (.ics, RFC 5545) reader for Moodle's calendar export.
 * Pure functions, no DOM and no app state, so tests/ical.test.js can run it in Node.
 *
 * Handles: CRLF or LF line ends, folded lines, TEXT escapes (\n \, \; \\), quoted parameters,
 * VEVENT and VTODO (nested VALARM is skipped), and date-times in UTC ("…Z"), with a TZID, floating, or
 * date-only. Every time is converted to Israel time (Asia/Jerusalem), the time zone the app works in. */
(function (root) {
  'use strict';
  const I = {};
  I.TZ = 'Asia/Jerusalem';
  const pad = (n) => String(n).padStart(2, '0');

  /** Text → logical lines (folded lines joined). */
  I.unfold = (text) => String(text || '').replace(/^﻿/, '').replace(/\r\n?/g, '\n').replace(/\n[ \t]/g, '').split('\n');

  /** "NAME;P1=a;P2=\"b;c\":value" → { name, params, value } (null for a line without a colon). */
  I.parseLine = (line) => {
    let inQ = false, colon = -1;
    for (let i = 0; i < line.length; i++) {
      const ch = line[i];
      if (ch === '"') inQ = !inQ;
      else if (ch === ':' && !inQ) { colon = i; break; }
    }
    if (colon < 0) return null;
    const head = line.slice(0, colon), value = line.slice(colon + 1);
    const parts = [];
    let cur = '';
    inQ = false;
    for (const ch of head) {
      if (ch === '"') { inQ = !inQ; continue; }
      if (ch === ';' && !inQ) { parts.push(cur); cur = ''; } else cur += ch;
    }
    parts.push(cur);
    const params = {};
    parts.slice(1).forEach((p) => { const eq = p.indexOf('='); if (eq > 0) params[p.slice(0, eq).toUpperCase()] = p.slice(eq + 1); });
    return { name: parts[0].toUpperCase(), params, value };
  };

  /** TEXT value unescape. */
  I.unescape = (s) => String(s || '').replace(/\\([\\;,nN])/g, (m, c) => (c === 'n' || c === 'N' ? '\n' : c));
  /** A comma-separated TEXT list (CATEGORIES) — commas escaped with "\," stay inside one value. */
  I.splitList = (s) => {
    const out = [];
    let cur = '';
    for (let i = 0; i < s.length; i++) {
      if (s[i] === '\\' && i + 1 < s.length) { cur += s[i] + s[i + 1]; i++; continue; }
      if (s[i] === ',') { out.push(cur); cur = ''; } else cur += s[i];
    }
    out.push(cur);
    return out.map((x) => I.unescape(x).trim()).filter(Boolean);
  };

  /* ---------- time zones ---------- */
  const fmtCache = {};
  function partsIn(tz, ms) {
    const f = fmtCache[tz] || (fmtCache[tz] = new Intl.DateTimeFormat('en-US', {
      timeZone: tz, hourCycle: 'h23', year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', second: '2-digit',
    }));
    const o = {};
    f.formatToParts(new Date(ms)).forEach((p) => { o[p.type] = p.value; });
    return { y: +o.year, mo: +o.month, d: +o.day, h: +o.hour % 24, mi: +o.minute, s: +o.second };
  }
  const validTz = (tz) => { try { partsIn(tz, 0); return true; } catch (e) { return false; } };
  /** A wall-clock time in `tz` → UTC milliseconds (two passes cover DST changes). */
  function wallToUtc(w, tz) {
    const asUtc = Date.UTC(w.y, w.mo - 1, w.d, w.h, w.mi, w.s);
    let ms = asUtc;
    for (let k = 0; k < 2; k++) {
      const p = partsIn(tz, ms);
      ms += asUtc - Date.UTC(p.y, p.mo - 1, p.d, p.h, p.mi, p.s);
    }
    return ms;
  }

  /**
   * A DTSTART / DUE value → { date: 'YYYY-MM-DD', time: 'HH:MM' | null, ms } in Israel time.
   * Returns null when the value cannot be read.
   */
  I.parseDate = (value, params = {}) => {
    const v = String(value || '').trim();
    const m = v.match(/^(\d{4})(\d{2})(\d{2})(?:T(\d{2})(\d{2})(\d{2})?(Z)?)?$/);
    if (!m) return null;
    const w = { y: +m[1], mo: +m[2], d: +m[3], h: +(m[4] || 0), mi: +(m[5] || 0), s: +(m[6] || 0) };
    if (w.mo < 1 || w.mo > 12 || w.d < 1 || w.d > 31 || w.h > 23 || w.mi > 59) return null;
    if (!m[4] || String(params.VALUE || '').toUpperCase() === 'DATE') {
      return { date: `${m[1]}-${m[2]}-${m[3]}`, time: null, ms: Date.UTC(w.y, w.mo - 1, w.d) };
    }
    let tz = params.TZID ? String(params.TZID).replace(/^\//, '') : I.TZ;
    if (!validTz(tz)) tz = I.TZ; // unknown zone name: read it as Israel time
    const ms = m[7] ? Date.UTC(w.y, w.mo - 1, w.d, w.h, w.mi, w.s) : wallToUtc(w, tz);
    const p = partsIn(I.TZ, ms);
    return { date: `${p.y}-${pad(p.mo)}-${pad(p.d)}`, time: `${pad(p.h)}:${pad(p.mi)}`, ms };
  };

  /**
   * .ics text → { events: [...], calendarName }.
   * Each event: { kind, uid, summary, description, categories[], url, due, start, lastModified }
   * where due = DUE (VTODO) or DTSTART (VEVENT) — Moodle puts the deadline in DTSTART.
   * Throws Error('not-ical') when the text is not an iCalendar file.
   */
  I.parse = (text) => {
    const lines = I.unfold(text);
    if (!lines.some((l) => /^BEGIN:VCALENDAR\s*$/i.test(l))) throw new Error('not-ical');
    const events = [];
    let cur = null, depth = 0, calendarName = '';
    lines.forEach((raw) => {
      const line = raw.replace(/\s+$/, '');
      if (!line) return;
      const p = I.parseLine(line);
      if (!p) return;
      if (p.name === 'BEGIN') {
        const what = p.value.toUpperCase();
        if (!cur && (what === 'VEVENT' || what === 'VTODO')) { cur = { kind: what, props: {} }; depth = 0; } else if (cur) depth++;
        return;
      }
      if (p.name === 'END') {
        if (cur && depth > 0) { depth--; return; }
        if (cur && (p.value.toUpperCase() === cur.kind)) { events.push(finish(cur)); cur = null; }
        return;
      }
      if (!cur) { if (p.name === 'X-WR-CALNAME') calendarName = I.unescape(p.value); return; }
      if (depth > 0) return; // inside VALARM etc.
      (cur.props[p.name] = cur.props[p.name] || []).push(p);
    });
    return { events, calendarName };
  };

  function finish(c) {
    const one = (n) => (c.props[n] ? c.props[n][0] : null);
    const text = (n) => (one(n) ? I.unescape(one(n).value).trim() : '');
    const date = (n) => (one(n) ? I.parseDate(one(n).value, one(n).params) : null);
    const cats = [];
    (c.props.CATEGORIES || []).forEach((p) => cats.push(...I.splitList(p.value)));
    const start = date('DTSTART');
    const lm = date('LAST-MODIFIED');
    return {
      kind: c.kind,
      uid: one('UID') ? one('UID').value.trim() : '',
      summary: text('SUMMARY'),
      description: text('DESCRIPTION'),
      categories: cats,
      url: one('URL') ? one('URL').value.trim() : '',
      start,
      due: date('DUE') || start,
      lastModified: lm ? new Date(lm.ms).toISOString() : '',
    };
  }

  root.CT = root.CT || {};
  root.CT.ical = I;
})(typeof window !== 'undefined' ? window : globalThis);
