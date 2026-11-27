/* views/moodle.js — Moodle: the workspace page (#/moodle: what needs you, what changed, every synced event by
 * category), the settings card (calendar link, .ics import, saved course choices, categories), the small tags on
 * synced items, and their dialogs. The logic lives in js/moodle.js. All interface text goes through CT.i18n; Moodle
 * content (event titles, Moodle course names) and your own names (courses, renamed categories) are shown as they are. */
(function (CT) {
  'use strict';
  const { u, ui } = CT;
  const S = CT.store, M = CT.model, Mo = CT.moodle, IC = CT.ical;
  const I = CT.i18n, t = I.t, tx = I.tx;
  const esc = u.esc, icon = u.icon;
  const V = {};
  CT.views = CT.views || {};
  CT.views.moodle = V;
  const MAX_BYTES = 5 * 1024 * 1024;
  const LOC = { localized: true };

  const mo = () => Mo.ensure(S.state);
  /** Date and time of a stored timestamp, in the interface language. */
  const fmtWhen = (iso) => {
    if (!iso) return '';
    const d = new Date(iso);
    if (isNaN(d)) return '';
    return `${ui.date(iso, 'short')} ${u.pad(d.getHours())}:${u.pad(d.getMinutes())}`;
  };
  const dueText = (due, time) => (due ? `${ui.date(due, 'wd')}${time ? ` · ${time === '24:00' ? tx('mo.midnight') : time}` : ''}` : tx('mo.noDate'));
  const timeAgo = (iso) => {
    const min = Math.round((Date.now() - new Date(iso).getTime()) / 60000);
    if (!(min >= 1)) return tx('mo.justNow');
    let rtf;
    try { rtf = new Intl.RelativeTimeFormat(I.locale(), { numeric: 'auto' }); } catch (e) { rtf = null; }
    const [v, unit] = min < 60 ? [min, 'minute'] : min < 1440 ? [Math.round(min / 60), 'hour'] : [Math.round(min / 1440), 'day'];
    return rtf ? rtf.format(-v, unit) : `${v} ${unit}`;
  };
  const targets = () => {
    const act = S.state.settings.activeSemesterId;
    return S.state.courses.filter((c) => c.kind !== 'record' && !c.archived)
      .sort((a, b) => (b.semesterId === act) - (a.semesterId === act) || a.name.localeCompare(b.name, 'he'));
  };
  const mergeOpts = (source) => ({ newItem: (x) => M.newItem(x), newCategory: (n) => M.newCategory(n), uid: u.uid, today: u.today(), source });

  /* ================= display names, error texts, summaries (translated; stored values never change) ================= */
  const DEFAULT_NAMES = Object.fromEntries(Mo.defaultClasses().map((c) => [c.id, c.name]));
  /** A category's name in the interface language: built-in categories you have not renamed are translated, your own
   *  names are shown as typed. Plain text. */
  V.clsName = (c) => (!c ? tx('mo.unclassified') : DEFAULT_NAMES[c.id] && DEFAULT_NAMES[c.id] === c.name ? tx(`mo.cls.${c.id}`) : c.name);
  const nameOf = (id) => V.clsName(Mo.classById(S.state, id));
  const bdi = (s) => `<bdi>${esc(s)}</bdi>`;

  /** Problems with a sync, by code → a translated sentence. Unknown codes get the generic text: raw server or
   *  internal messages are never shown. */
  const ERR_CODES = ['link-rejected', 'bad-link', 'no-link', 'too-big', 'no-function', 'moodle-down', 'timeout', 'rate-limit',
    'not-signed-in', 'offline', 'forbidden', 'table-missing', 'not-ical', 'file-too-big', 'read-failed', 'server'];
  V.errorText = (e) => (e ? tx(`mo.err.${ERR_CODES.includes(e.code) ? e.code : 'server'}`) : '');
  const errOf = (code) => Object.assign(new Error(tx(`mo.err.${ERR_CODES.includes(code) ? code : 'server'}`)), { code });

  /** Short summary of a merge() result: "2 new · 1 updated". */
  V.summary = (r) => {
    const parts = ['added', 'listed', 'unclassified', 'reclassified', 'updated', 'restored', 'gone', 'unassigned']
      .filter((k) => r && r[k]).map((k) => tx(`mo.s.${k}`, { n: r[k] }));
    return parts.length ? parts.join(' · ') : tx('mo.s.none');
  };
  /** Unseen changes as one line (the same texts as the notification center). */
  V.unseenText = (n) => ['new', 'changed', 'gone', 'restored'].filter((k) => n[k]).map((k) => tx(`notif.moodle.${k}`, { n: n[k] })).join(' · ');

  /* ================= tags on a course row ================= */
  let freshCache = { list: null, n: -1, set: new Set() };
  /** UIDs of "new" entries in the change list you have not marked as seen (cached per change list). */
  const freshUids = () => {
    const list = mo().changes || [];
    const n = list.filter((c) => !c.seen).length;
    if (freshCache.list !== list || freshCache.n !== n) freshCache = { list, n, set: new Set(list.filter((c) => !c.seen && c.kind === 'new').map((c) => c.uid)) };
    return freshCache.set;
  };
  V.badges = (it) => {
    const s = it.source;
    if (!s || s.kind !== 'moodle') return '';
    const time = s.dueTime ? ` · ${esc(s.dueTime)}` : '';
    const out = [];
    if (freshUids().has(s.uid)) out.push(`<span class="pill mm-new" title="${t('mb.newTitle')}">${t('mb.new')}</span>`);
    const tip = [t('mb.fromTitle'), s.dueTime && t(s.dueTime === '24:00' ? 'mb.dueMidnight' : 'mb.dueBy', { time: s.dueTime }), s.category && esc(s.category)].filter(Boolean).join(' · ');
    out.push(`<span class="tag moodle-tag" title="${tip}">${t('mb.from')}${time}</span>`);
    if (s.changed) out.push(`<button class="tag moodle-alert" data-action="moodle-changed" title="${t('mb.changedTitle')}">${t('mb.changed')}</button>`);
    if (s.gone) out.push(`<button class="tag moodle-alert" data-action="moodle-gone" title="${t('mb.goneTitle')}">${t('mb.gone')}</button>`);
    if (s.mergeWith) {
      const f = S.findItem(s.mergeWith);
      if (f) out.push(`<button class="tag moodle-merge" data-action="moodle-merge" title="${t('mb.mergeTitle')}">${t('mb.merge', { title: f.item.title })}</button>`);
    }
    return out.join('');
  };

  /** Click on one of the tags above (course page and the Moodle page): the update / missing / merge dialogs. */
  V.rowAction = (action, itemId, anchor) => {
    const f = S.findItem(itemId);
    if (!f || !f.item.source) return;
    const s = f.item.source;
    if (action === 'moodle-changed') {
      const c = s.changed || {};
      const rows = [];
      if (c.prevTitle !== s.title) rows.push(`<tr><th scope="row">${t('mo.d.name')}</th><td dir="auto">${esc(c.prevTitle)}</td><td dir="auto"><b>${esc(s.title)}</b></td></tr>`);
      if (c.prevDue !== s.due || (c.prevTime || '') !== (s.dueTime || '')) rows.push(`<tr><th scope="row">${t('mo.d.due')}</th><td>${esc(dueText(c.prevDue, c.prevTime))}</td><td><b>${esc(dueText(s.due, s.dueTime))}</b></td></tr>`);
      const differs = f.item.title !== s.title || f.item.due !== s.due;
      ui.modal({
        title: tx('mo.d.changedTitle'),
        localized: true,
        body: `<p dir="auto">${esc(f.item.title)}</p><table class="moodle-diff"><thead><tr><th></th><th>${t('mo.d.was')}</th><th>${t('mo.d.now')}</th></tr></thead><tbody>${rows.join('') || `<tr><td colspan="3">${t('mo.d.noDiff')}</td></tr>`}</tbody></table>
          ${c.at ? `<p class="small muted">${t('mo.d.checked', { when: fmtWhen(c.at) })}</p>` : ''}${differs ? `<p class="small">${t('mo.d.mine')}</p>` : ''}`,
        actions: [
          differs && { label: tx('mo.d.apply'), fn: () => S.commit(tx('mo.c.apply'), () => { const x = S.findItem(itemId).item; x.title = x.source.title; x.due = x.source.due; x.source.changed = null; }) },
          { label: tx('mo.d.seen'), primary: true, fn: () => S.commit(tx('mo.c.seenChange'), () => { S.findItem(itemId).item.source.changed = null; }) },
        ].filter(Boolean),
      });
    }
    if (action === 'moodle-gone') {
      ui.menu(anchor, [
        { label: tx('mo.d.keepPlain'), icon: 'check', fn: () => S.commit(tx('mo.c.unlink'), () => { delete S.findItem(itemId).item.source; }) },
        { label: tx('mo.d.keepMarked'), icon: 'calendar', fn: () => {} },
        '-',
        { label: tx('mo.d.delete'), icon: 'trash', danger: true, fn: () => CT.views.course.deleteItem(itemId) },
      ], LOC);
    }
    if (action === 'moodle-merge') {
      const ph = S.findItem(s.mergeWith);
      ui.menu(anchor, [
        ph && { label: tx('mo.d.mergeWith', { title: ph.item.title }), icon: 'check', fn: () => S.commit(tx('mo.c.merge'), () => {
          const x = S.findItem(itemId);
          if (x) Mo.mergeIntoPlaceholder(x.course, itemId);
        }) },
        { label: tx('mo.d.keepApart'), icon: 'close', fn: () => S.commit(tx('mo.c.keepApart'), () => { S.findItem(itemId).item.source.mergeWith = null; }) },
      ].filter(Boolean), LOC);
    }
  };

  /* ================= categories editor (in the settings card) ================= */
  let classesOpen = false;
  function classesHTML() {
    const m = mo();
    const rows = m.classes.map((c) => `<div class="mm-cls-row" data-cls="${esc(c.id)}">
        <div class="mm-cls-head">
          <input class="input mm-cls-name" data-f="name" value="${esc(c.name)}" aria-label="${t('mo.k.name')}" maxlength="40" dir="auto">
          <button class="icon-btn" data-action="moodle-cls-del" title="${t('mo.k.delete')}" aria-label="${t('mo.k.deleteNamed', { name: V.clsName(c) })}">${icon.trash}</button>
        </div>
        <label class="small">${t('mo.k.keywords')}
          <textarea class="input" data-f="keywords" rows="2" dir="auto">${esc((c.keywords || []).join(', '))}</textarea></label>
        <div class="mm-cls-opts small">
          <label><input type="checkbox" data-f="toCourse"${c.toCourse ? ' checked' : ''}> ${t('mo.k.toCourse')}</label>
          <input class="input input-sm" data-f="courseCat" value="${esc(c.courseCat || c.name)}" aria-label="${t('mo.k.courseCat')}" maxlength="40" dir="auto">
          <label><input type="checkbox" data-f="inAll"${c.inAll ? ' checked' : ''}> ${t('mo.k.inAll')}</label>
          <label><input type="checkbox" data-f="hidden"${c.hidden ? ' checked' : ''}> ${t('mo.k.hidden')}</label>
        </div>
      </div>`).join('');
    const rules = Mo.classRules(S.state);
    const rulesHTML = rules.map((r) => `<li><span dir="auto">${esc(r.pattern.replace(/#/g, 'N'))}</span> <span class="muted">· ${r.course ? `<span dir="auto">${esc(r.course)}</span>` : t('mo.k.noCourse')}</span> → <b>${bdi(nameOf(r.cls))}</b>
      <button class="btn btn-small btn-ghost" data-action="moodle-rule-forget" data-key="${esc(r.key)}">${t('mo.forget')}</button></li>`).join('');
    return `<details class="mm-classes"${classesOpen ? ' open' : ''} id="moodle-classes"><summary><b>${t('mo.k.title')}</b> <span class="muted small">${t('mo.k.counts', { n: m.classes.length, rules: rules.length })}</span></summary>
      <p class="small muted">${t('mo.k.help')}</p>
      <div class="mm-cls-list">${rows}</div>
      <div class="btn-row">
        <button class="btn btn-primary" data-action="moodle-cls-save">${t('mo.k.save')}</button>
        <input class="input input-sm" data-f="newname" placeholder="${t('mo.k.newName')}" aria-label="${t('mo.k.newName')}" maxlength="40" dir="auto">
        <button class="btn" data-action="moodle-cls-add">${icon.plus}<span>${t('mo.k.add')}</span></button>
        <button class="btn btn-ghost" data-action="moodle-cls-reset">${t('mo.k.reset')}</button>
      </div>
      ${rules.length ? `<h4>${t('mo.k.yours')}</h4><ul class="moodle-maps small">${rulesHTML}</ul>` : `<p class="small muted">${t('mo.k.noRules')}</p>`}
    </details>`;
  }
  /** Read the editor's fields; null (with a toast) when something is wrong. */
  function readClasses(box) {
    const m = mo();
    const out = [];
    const names = new Set();
    for (const row of box.querySelectorAll('.mm-cls-row')) {
      const old = m.classes.find((c) => c.id === row.dataset.cls);
      if (!old) continue;
      const f = (k) => row.querySelector(`[data-f="${k}"]`);
      const name = f('name').value.trim();
      if (!name || name === Mo.UNCLASSIFIED || name === tx('mo.unclassified')) { ui.toast(tx('mo.k.needName'), { error: true }); f('name').focus(); return null; }
      if (names.has(name)) { ui.toast(tx('mo.k.twice', { name }), { error: true }); f('name').focus(); return null; }
      names.add(name);
      out.push(Object.assign({}, old, {
        name, keywords: Mo.parseKeywords(f('keywords').value), courseCat: f('courseCat').value.trim() || name,
        toCourse: f('toCourse').checked, inAll: f('inAll').checked, hidden: f('hidden').checked,
      }));
    }
    return out;
  }
  const undoAction = () => ({ label: tx('common.undo'), fn: S.undo });
  async function classAction(act, a) {
    classesOpen = true;
    const box = a.closest('.mm-classes');
    const done = (n, what) => ui.toast(n ? `${what} · ${tx('mo.k.moved', { n })}` : what, { action: undoAction() });
    if (act === 'moodle-cls-save') {
      const list = readClasses(box);
      if (!list) return;
      const n = S.commit(tx('mo.c.classes'), (st) => { Mo.ensure(st).classes = list; return Mo.reclassifyAll(st, mergeOpts()); });
      done(n, tx('mo.k.saved'));
    } else if (act === 'moodle-cls-add') {
      const inp = box.querySelector('[data-f="newname"]');
      const name = inp.value.trim();
      if (!name) { inp.focus(); return; }
      const c = name === tx('mo.unclassified') ? null : S.commit(tx('mo.c.newClass'), (st) => Mo.addClass(st, name));
      if (!c) ui.toast(tx('mo.k.exists'), { error: true });
      else ui.toast(tx('mo.k.added', { name }));
    } else if (act === 'moodle-cls-del') {
      const id = a.closest('.mm-cls-row').dataset.cls;
      const c = Mo.classById(S.state, id);
      if (!c || !(await ui.confirm(tx('mo.k.delConfirm', { name: V.clsName(c) }), tx('mo.k.delOk'), true, LOC))) return;
      const n = S.commit(tx('mo.c.delClass'), (st) => Mo.removeClass(st, id, mergeOpts()));
      done(n, tx('mo.k.deleted', { name: V.clsName(c) }));
    } else if (act === 'moodle-cls-reset') {
      if (!(await ui.confirm(tx('mo.k.resetConfirm'), tx('mo.k.resetOk'), false, LOC))) return;
      const n = S.commit(tx('mo.c.resetClasses'), (st) => Mo.resetClasses(st, mergeOpts()));
      done(n, tx('mo.k.resetDone'));
    } else if (act === 'moodle-rule-forget') {
      const n = S.commit(tx('mo.c.forgetRule'), (st) => Mo.clearClass(st, a.dataset.key, mergeOpts()));
      done(n, tx('mo.k.forgotten'));
    }
  }

  /* ================= "not assigned" list (shown on the Moodle page) ================= */
  function inboxHTML() {
    const m = mo();
    if (!m.inbox.length) return '';
    const courses = targets();
    const courseOpts = `<option value="">${t('mo.i.pick')}</option>${courses.map((c) => `<option value="${esc(c.id)}">${esc(c.name)}${c.number ? ` (${esc(c.number)})` : ''}</option>`).join('')}`;
    const rows = m.inbox.map((x) => `
      <li class="moodle-inbox-row" data-uid="${esc(x.uid)}">
        <div class="mi-main">
          <b dir="auto">${esc(x.title)}</b>
          <span class="small muted">${esc(dueText(x.due, x.dueTime))} · ${x.category ? `${t('mo.i.inMoodle')} <span dir="auto">${esc(x.category)}</span>` : t('mo.i.noCourse')}</span>
        </div>
        <div class="mi-act">
          <select class="chip-select" aria-label="${t('mo.i.assignTo', { title: x.title })}">${courseOpts}</select>
          ${x.category ? `<label class="small"><input type="checkbox" checked> ${t('mo.i.all')} <bdi>${esc(x.category)}</bdi></label>` : ''}
          <button class="btn btn-small btn-primary" data-action="moodle-assign">${t('mo.i.assign')}</button>
          <button class="btn btn-small btn-ghost" data-action="moodle-ignore" title="${t('mo.i.ignoreTitle')}">${t('mo.i.ignore')}</button>
        </div>
      </li>`).join('');
    return `<section class="card mw-inbox" id="mw-inbox" aria-labelledby="mw-inbox-h">
      <h2 id="mw-inbox-h">${icon.inbox}<span>${t('mo.i.title')}</span> <span class="mm-count">${ui.num(m.inbox.length)}</span></h2>
      <p class="small muted">${t('mo.i.help')}</p>
      <ul class="mw-inbox-list">${rows}</ul>
    </section>`;
  }

  /* ================= settings card ================= */
  V.section = () => {
    const m = mo();
    const last = m.last;
    const maps = Object.keys(m.map).map((k) => {
      const c = S.course(m.map[k]);
      return `<li><span dir="auto">${esc(k)}</span> → ${c ? `<span dir="auto">${esc(c.name)}</span>` : `<i>${t('mo.deletedCourse')}</i>`} <button class="btn btn-small btn-ghost" data-action="moodle-unmap" data-key="${esc(k)}">${t('mo.forget')}</button></li>`;
    }).join('');
    const ignoredN = Object.keys(m.ignored).length;
    return `<section class="card moodle-card" id="moodle"${I.attrs()}>
      <h2 class="mw-card-h">${icon.inbox}<span>${t('mo.set.title')}</span> <a class="btn btn-small btn-ghost" href="#/moodle">${t('mo.set.open')}</a></h2>
      <p class="small muted">${t('mo.set.never')}</p>
      ${linkHTML()}
      <h3>${t('mo.set.fileTitle')}</h3>
      <ol class="small moodle-steps">
        <li>${t('mo.set.f1')} <span dir="ltr">…/calendar/export.php</span></li>
        <li>${t('mo.set.f2')}</li>
        <li>${t('mo.set.f3')}</li>
      </ol>
      <div class="btn-row">
        <button class="btn btn-primary" data-action="moodle-import">${icon.upload}<span>${t('mo.importFile')}</span></button>
      </div>
      <p class="small">${last ? t('mo.set.lastImport', { when: fmtWhen(last.at), what: V.summary(last) }) : t('mo.set.noImport')}</p>
      <p class="small muted">${t('mo.set.how')}</p>
      ${m.inbox.length ? `<p class="small moodle-error">${t('mo.set.inbox', { n: m.inbox.length })} <a class="btn btn-small" href="#/moodle" data-action="moodle-goto-inbox">${t('mo.set.toInbox')}</a></p>` : ''}
      ${maps ? `<details class="small"><summary>${t('mo.set.maps', { n: Object.keys(m.map).length })}</summary><ul class="moodle-maps">${maps}</ul></details>` : ''}
      ${classesHTML()}
      ${ignoredN ? `<p class="small muted">${t('mo.set.ignored', { n: ignoredN })} <button class="btn btn-small btn-ghost" data-action="moodle-unignore">${t('mo.set.unignore')}</button></p>` : ''}
    </section>`;
  };

  /* ================= the calendar link (needs an account on the site) ================= */
  const HAS_FEED = 'ct.moodle.hasFeed'; // "1" when this account has a saved link — a flag only, never the link
  const flag = (on) => { try { if (on) localStorage.setItem(HAS_FEED, '1'); else localStorage.removeItem(HAS_FEED); } catch (e) { /* ignore */ } };
  const hasFlag = () => { try { return localStorage.getItem(HAS_FEED) === '1'; } catch (e) { return false; } };
  let feed = { state: 'unknown' };   // unknown | loading | none | ok | error
  let editing = false;                // showing the paste box although a link is saved
  let busy = '';                      // 'check' | 'sync' | 'save' | 'auto' while a request runs
  let checked = null;                 // { events, list } from "check link", so importing it needs no second fetch
  const C = () => CT.cloud;
  const rerender = () => { if (/^#\/(settings|moodle)\b/.test(location.hash)) CT.app.rerender(); };
  const TABLE_MISSING = /moodle_feeds|relation .* does not exist|schema cache|PGRST20[0-9]/i;

  async function loadFeed() {
    feed = { state: 'loading' };
    try {
      const f = await C().moodleFeed();
      feed = f ? { state: 'ok', host: f.host, updatedAt: f.updated_at, preset: f.preset || null, what: f.what || null } : { state: 'none' };
      flag(!!f);
    } catch (e) {
      feed = { state: 'error', code: TABLE_MISSING.test(`${e.message} ${e.code}`) ? 'table-missing' : e instanceof TypeError ? 'offline' : 'server' };
    }
    rerender();
  }

  function linkHTML() {
    const cloud = C();
    const m = mo();
    if (!cloud || !cloud.enabled) return '';
    if (!cloud.signedIn()) return `<h3>${t('mo.l.title')}</h3><p class="small muted">${t('mo.l.signIn')}</p>`;
    if (feed.state === 'unknown') setTimeout(loadFeed, 0);
    const lastLine = m.lastLink ? `<p class="small">${t('mo.l.last', { when: fmtWhen(m.lastLink) })}${m.last && m.last.source === 'link' ? ` — ${esc(V.summary(m.last))}` : ''}</p>` : '';
    const errLine = m.linkError ? `<p class="small moodle-error" role="alert">${icon.alert}<span>${esc(V.errorText(m.linkError))}</span> <span class="muted">(${esc(fmtWhen(m.linkError.at))})</span></p>` : '';
    const paste = `
      <ol class="small moodle-steps">
        <li>${t('mo.l.s1')} <span dir="ltr">https://moodle…technion.ac.il/calendar/export.php</span></li>
        <li>${t('mo.set.f2')}</li>
        <li>${t('mo.l.s3')}</li>
      </ol>
      <p class="small moodle-secret">${t('mo.l.secret')}</p>
      <div class="moodle-link-row">
        <input class="moodle-link-input" type="url" inputmode="url" dir="ltr" autocomplete="off" autocapitalize="off" spellcheck="false"
          placeholder="https://moodle…technion.ac.il/calendar/export_execute.php?userid=…&amp;authtoken=…" aria-label="${t('mo.l.input')}">
        <button class="btn btn-primary" data-action="moodle-save-link"${busy ? ' disabled' : ''}>${busy === 'save' ? t('mo.l.saving') : t('mo.l.save')}</button>
        ${editing ? `<button class="btn btn-ghost" data-action="moodle-cancel-edit">${t('common.cancel')}</button>` : ''}
      </div>`;
    let body;
    if (feed.state === 'loading' || feed.state === 'unknown') body = `<p class="small muted">${t('mo.l.loading')}</p>`;
    else if (feed.state === 'error') body = `<p class="small moodle-error">${icon.alert}<span>${t(`mo.err.${feed.code}`)}</span></p><button class="btn btn-small" data-action="moodle-reload-feed">${t('mo.retry')}</button>`;
    else if (feed.state === 'none' || editing) body = paste;
    else {
      body = `<p class="small">${icon.link}<span>${t('mo.l.connected', { host: feed.host || 'moodle', when: fmtWhen(feed.updatedAt) })}</span></p>
        <div class="btn-row">
          <button class="btn" data-action="moodle-check"${busy ? ' disabled' : ''}>${busy === 'check' ? t('mo.l.checking') : t('mo.l.check')}</button>
          <button class="btn btn-primary" data-action="moodle-sync"${busy ? ' disabled' : ''}>${busy === 'sync' ? t('mo.refreshing') : t('mo.syncNow')}</button>
          <button class="btn btn-ghost" data-action="moodle-edit-link">${t('mo.l.replace')}</button>
          <button class="btn btn-ghost btn-danger" data-action="moodle-disconnect">${t('mo.l.disconnect')}</button>
        </div>
        <details class="small moodle-revoke"><summary>${t('mo.l.revokeQ')}</summary><p>${t('mo.l.revoke1')}</p><p>${t('mo.l.revoke2')}</p></details>
        ${checked ? `<p class="small">${icon.check}<span>${t('mo.l.ok', { n: checked.events })}</span> <button class="btn btn-small" data-action="moodle-import-checked">${t('mo.l.importNow')}</button></p>` : ''}
        <div class="moodle-prefs small">
          <label><input type="checkbox" data-moodle-pref="auto"${m.auto ? ' checked' : ''}> ${t('mo.l.auto')}</label>
          <label><input type="checkbox" data-moodle-pref="periodic"${m.periodic ? ' checked' : ''}> ${t('mo.l.periodic')}</label>
        </div>
        <p class="small muted">${m.serverCheckedAt ? t('mo.l.server', { when: fmtWhen(m.serverCheckedAt) }) : t('mo.l.serverOff')}</p>
        ${V.rangeHTML()}`;
    }
    return `<h3>${t('mo.l.title')}</h3>${body}${errLine}${lastLine}`;
  }

  /** Fetch through the Edge Function → { events }. Throws Error with a translated message and .code. */
  async function fetchEvents() {
    let res;
    try { res = await C().fetchMoodle(); } catch (e) {
      const d = e.data || {};
      const offline = e instanceof TypeError;
      const noFn = !d.error && (e.status === 404 || e.status === 400 && /not.?found|function/i.test(e.message || ''));
      throw errOf(d.error || (offline ? 'offline' : noFn ? 'no-function' : 'server'));
    }
    let parsed;
    try { parsed = IC.parse((res && res.ics) || ''); } catch (e) { throw errOf('link-rejected'); }
    return { events: parsed.events, hash: res && res.hash };
  }

  // problems only you can fix: they stay on screen (the Moodle page, Today, settings) until a sync succeeds
  const PERSIST_ERRORS = ['link-rejected', 'bad-link', 'no-link', 'too-big', 'no-function'];
  const setLinkError = (e, silent) => S.commit('', (st) => {
    Mo.ensure(st).linkError = e ? { code: e.code, message: e.message, at: new Date().toISOString() } : null;
  }, { undo: false, silent });

  /**
   * Sync through the saved link. manual: messages and the result dialog. Automatic: quiet — a toast only when
   * something changed, a lasting warning only for problems you must fix (an expired link).
   */
  V.syncLink = async ({ manual = false, events = null, inline = false } = {}) => {
    if (busy) return null;
    let hash = null;
    busy = manual ? 'sync' : 'auto';
    rerender();
    try {
      let evs = events;
      if (!evs) { const got = await fetchEvents(); evs = got.events; hash = got.hash || null; }
      checked = null;
      const stamp = (st) => Object.assign(Mo.ensure(st), { lastLink: new Date().toISOString(), linkError: null }, hash ? { lastHash: hash, serverAt: new Date().toISOString() } : {});
      let r = null;
      if (!evs.length) {
        S.commit('', stamp, { undo: false, silent: !manual });
        if (manual) ui.toast(tx('mo.empty'));
      } else if (manual && !inline) {
        r = V.importEvents(evs, 'link');
        S.commit('', stamp, { undo: false });
      } else {
        r = S.commit(tx(inline ? 'mo.c.refresh' : 'mo.c.auto'), (st) => { const out = Mo.merge(st, evs, mergeOpts('link')); stamp(st); return out; });
        if (inline || r.added || r.updated || r.gone || r.unassigned) ui.toast(tx('mo.toast', { what: V.summary(r) }), { action: undoAction() });
      }
      return r;
    } catch (e) {
      if (manual) ui.toast(e.message, { error: true });
      if (PERSIST_ERRORS.includes(e.code)) setLinkError(e, !manual);
      return null;
    } finally {
      busy = '';
      rerender();
    }
  };

  /* ---------- the scheduled refresh (server) ---------- */
  const SERVER_ERRORS = ['link-rejected', 'bad-link', 'too-big']; // codes the server stores with a snapshot
  const STALE_MIN = 180; // no server check for 3 hours → the schedule is not running; fall back to fetching from here
  let lastPull = 0;
  /**
   * Read the calendar the server fetched last (every 2 hours, while the site is closed too) and merge it when it
   * changed. Returns the snapshot row (or null). Quiet: a toast only when something changed.
   */
  V.pullSnapshot = async () => {
    if (busy || !C() || !C().signedIn()) return null;
    lastPull = Date.now();
    let row;
    try { row = await C().moodleSnapshot(); } catch (e) { return null; } // table not created yet: the live fetch still works
    if (!row) return null;
    const m = mo();
    if (row.error && SERVER_ERRORS.includes(row.error)) {
      if (!m.linkError || m.linkError.code !== row.error) S.commit('', (st) => { Mo.ensure(st).linkError = { code: row.error, message: tx(`mo.err.${row.error}`), at: row.checked_at }; }, { undo: false, silent: true });
    }
    if (row.hash && row.ics && row.hash !== m.lastHash) {
      let evs = null;
      try { evs = IC.parse(row.ics).events; } catch (e) { evs = null; }
      if (evs) {
        const r = S.commit(tx('mo.c.server'), (st) => {
          const out = Mo.merge(st, evs, mergeOpts('server'));
          Object.assign(Mo.ensure(st), { lastHash: row.hash, serverAt: row.fetched_at, serverCheckedAt: row.checked_at }, row.error ? {} : { linkError: null });
          return out;
        });
        if (r.changes && r.changes.length) ui.toast(tx('mo.toast', { what: V.unseenText(Mo.unseen(S.state)) }), { action: { label: tx('mo.whatChanged'), fn: () => { location.hash = '#/moodle'; } } });
      }
    } else if (row.checked_at !== m.serverCheckedAt) {
      S.commit('', (st) => { Object.assign(Mo.ensure(st), { serverCheckedAt: row.checked_at }, row.error ? {} : { linkError: null }); }, { undo: false, silent: true });
    }
    rerender();
    return row;
  };
  const stale = (row) => !row || !row.checked_at || Date.now() - new Date(row.checked_at).getTime() > STALE_MIN * 60000;

  /** Automatic refresh, started after the cloud data has loaded: read the server's latest calendar on opening and
   *  every 30 minutes. Only when the schedule has not run for 3 hours (not set up yet) does the site fetch from
   *  Moodle itself (on opening if > 30 min since the last fetch, hourly while open). */
  let autoTimer = null;
  V.startAuto = () => {
    if (autoTimer || !C() || !C().enabled) return;
    const due = (minutes) => { const x = mo().lastLink; return !x || Date.now() - new Date(x).getTime() > minutes * 60000; };
    const tick = async (opening) => {
      const m = mo();
      if (!C().signedIn() || !hasFlag() || !navigator.onLine || document.hidden || busy) return;
      if (!(opening ? m.auto : m.periodic)) return;
      if (!opening && Date.now() - lastPull < 30 * 60000) return;
      const row = await V.pullSnapshot();
      if (stale(row) && (opening ? due(30) : due(60))) V.syncLink({ manual: false });
    };
    tick(true);
    autoTimer = setInterval(() => tick(false), 5 * 60000);
    document.addEventListener('visibilitychange', () => { if (!document.hidden) tick(false); });
  };

  /** "Seen" on the Moodle notification (notification center) and on the Moodle page. */
  V.markSeen = () => S.commit('', (st) => Mo.markSeen(st), { undo: false });

  /** What the saved link asks Moodle for (settings + the page). */
  V.rangeHTML = () => {
    if (feed.state !== 'ok') return '';
    const r = Mo.rangeInfo(feed.preset, feed.what);
    const label = tx(`mo.range.${r.key}.label`, { preset: feed.preset || '' });
    const text = tx(`mo.range.${r.key}.text`);
    const hz = mo().horizon ? ` ${tx('mo.range.horizon', { date: ui.date(mo().horizon, 'full') })}` : '';
    return `<p class="small mw-range ${r.warn ? 'moodle-error' : 'muted'}">${r.warn ? icon.alert : icon.calendar}<span>${t('mo.range.is', { label })} ${esc(text)}${r.whatWarn ? ` ${t('mo.range.what')}` : ''}${esc(hz)}</span></p>`;
  };

  V.onChange = (x) => {
    const k = x.dataset.moodlePref;
    if (k) S.commit(tx('mo.c.prefs'), (st) => { Mo.ensure(st)[k] = x.checked; });
  };

  async function linkAction(action, a) {
    switch (action) {
      case 'moodle-save-link': {
        const input = document.querySelector('.moodle-link-input');
        const val = input ? input.value.trim() : '';
        const bad = Mo.checkLinkCode(val);
        if (bad) { ui.toast(tx(`mo.link.${bad}`), { error: true }); if (input) input.focus(); return; }
        busy = 'save';
        a.disabled = true;
        try {
          await C().saveMoodleLink(val);
          if (input) input.value = ''; // the link leaves the page right away
          editing = false;
          checked = null;
          flag(true);
          setLinkError(null, true);
          ui.toast(tx('mo.l.saved'));
          busy = '';
          await loadFeed();
        } catch (e) {
          busy = '';
          const all = `${e.message} ${e.code}`;
          ui.toast(TABLE_MISSING.test(all) ? tx('mo.err.table-missing') : /check constraint|23514/i.test(all) ? tx('mo.l.serverRejected')
            : e instanceof TypeError ? tx('mo.err.offline') : tx('mo.err.server'), { error: true });
          rerender();
        }
        return;
      }
      case 'moodle-check': {
        busy = 'check';
        rerender();
        try {
          const r = await fetchEvents();
          checked = { events: r.events.length, list: r.events };
          setLinkError(null, true);
        } catch (e) {
          checked = null;
          ui.toast(e.message, { error: true });
          if (PERSIST_ERRORS.includes(e.code)) setLinkError(e, true);
        }
        busy = '';
        rerender();
        return;
      }
      case 'moodle-import-checked': if (checked) V.syncLink({ manual: true, events: checked.list }); return;
      case 'moodle-sync': V.syncLink({ manual: true }); return;
      case 'moodle-edit-link': editing = true; rerender(); setTimeout(() => { const i = document.querySelector('.moodle-link-input'); if (i) i.focus(); }, 30); return;
      case 'moodle-cancel-edit': editing = false; rerender(); return;
      case 'moodle-reload-feed': loadFeed(); return;
      case 'moodle-disconnect':
        if (!(await ui.confirm(tx('mo.l.disconnectConfirm'), tx('mo.l.disconnect'), true, LOC))) return;
        try {
          await C().deleteMoodleLink();
          flag(false);
          checked = null;
          feed = { state: 'none' };
          setLinkError(null, false);
          S.commit('', (st) => Object.assign(Mo.ensure(st), { lastHash: null, serverAt: null, serverCheckedAt: null }), { undo: false, silent: true });
          ui.toast(tx('mo.l.disconnected'));
        } catch (e) { ui.toast(e instanceof TypeError ? tx('mo.err.offline') : tx('mo.err.server'), { error: true }); }
        return;
      default: break;
    }
  }
  /** After sign-in / sign-out: load the link status again. */
  V.resetFeed = () => { feed = { state: 'unknown' }; checked = null; editing = false; };

  /** Clicks inside the settings card and the Moodle page (settings.js forwards every data-action "moodle-…"). */
  V.onClick = async (a) => {
    const row = a.closest('.moodle-inbox-row');
    const uid = row && row.dataset.uid;
    if (/^moodle-(save-link|check|sync|import-checked|edit-link|cancel-edit|reload-feed|disconnect)$/.test(a.dataset.action)) { linkAction(a.dataset.action, a); return; }
    switch (a.dataset.action) {
      case 'moodle-import': V.pickFile(); break;
      case 'moodle-goto-inbox': V.showInbox(); break;
      case 'moodle-assign': {
        const sel = row.querySelector('select');
        const courseId = sel.value;
        if (!courseId) { ui.toast(tx('mo.i.pickFirst'), { error: true }); sel.focus(); return; }
        const box = row.querySelector('input[type=checkbox]');
        const n = S.commit(tx('mo.c.assign'), (st) => Mo.assign(st, uid, courseId, !!(box && box.checked), mergeOpts()));
        ui.toast(tx('mo.i.assigned', { n, course: S.course(courseId).name }), { action: undoAction() });
        break;
      }
      case 'moodle-ignore': S.commit(tx('mo.c.ignore'), (st) => Mo.ignore(st, uid)); break;
      case 'moodle-unmap': S.commit(tx('mo.c.unmap'), (st) => Mo.unmap(st, a.dataset.key)); break;
      case 'moodle-cls-save': case 'moodle-cls-add': case 'moodle-cls-del': case 'moodle-cls-reset': case 'moodle-rule-forget': classAction(a.dataset.action, a); break;
      case 'moodle-unignore': S.commit(tx('mo.c.unignore'), (st) => { Mo.ensure(st).ignored = {}; }); break;
      default: break;
    }
  };

  /* ================= manual .ics import ================= */
  V.pickFile = () => {
    const inp = document.createElement('input');
    inp.type = 'file';
    inp.accept = '.ics,text/calendar';
    inp.onchange = () => { if (inp.files[0]) V.importFile(inp.files[0]); };
    inp.click();
  };

  V.importFile = async (file) => {
    if (file.size > MAX_BYTES) { ui.toast(tx('mo.err.file-too-big'), { error: true }); return; }
    let parsed;
    try { parsed = IC.parse(await file.text()); } catch (e) {
      ui.toast(tx(e.message === 'not-ical' ? 'mo.err.not-ical' : 'mo.err.read-failed'), { error: true });
      return;
    }
    V.importEvents(parsed.events, 'file');
  };

  /** Shared by the file import and the manual link sync: merge, then show what changed. */
  V.importEvents = (events, source) => {
    if (!events.length) {
      ui.modal({ title: tx('mo.r.emptyTitle'), localized: true, body: `<p>${t('mo.r.empty')}</p>`, actions: [{ label: tx('common.close'), primary: true }] });
      return null;
    }
    const r = S.commit(tx('mo.c.import'), (st) => Mo.merge(st, events, mergeOpts(source)));
    const KEYS = ['added', 'listed', 'unclassified', 'reclassified', 'updated', 'restored', 'gone', 'unassigned', 'unchanged', 'skippedOpen', 'ignored', 'deletedByYou', 'invalid'];
    ui.modal({
      title: tx('mo.r.title'),
      localized: true,
      body: `<ul class="moodle-result">${KEYS.filter((k) => r[k]).map((k) => `<li>${t(`mo.r.${k}`, { n: r[k] })}</li>`).join('')}</ul>`,
      actions: [
        { label: tx('mo.r.undo'), fn: () => S.undo() },
        { label: tx(r.unassigned ? 'mo.r.toAssign' : 'common.close'), primary: true, fn: () => { if (r.unassigned) V.showInbox(); } },
      ],
    });
    return r;
  };

  /* ================= the Moodle page ================= */
  const page = { course: '', showDone: false, tab: 'all' };
  const TAB_NONE = '_none';
  const isDone = (it) => it.status === 'done';
  /** Urgency bucket of an open row: overdue · today/tomorrow · this week · later · no date. */
  const bucketOf = (r) => {
    if (!r.due) return 'nodate';
    const n = u.daysUntil(r.due);
    return n < 0 ? 'overdue' : n <= 1 ? 'soon' : n <= 7 ? 'week' : 'later';
  };
  const BUCKETS = [['overdue', 'alert'], ['soon', 'timer'], ['week', 'calendar'], ['later', 'layers'], ['nodate', 'info']];
  const sortKey = (r) => `${r.due || '9999-99-99'} ${r.time || '99:99'}`;

  /** Every synced event with a course, as page rows. Items on a course page have a check; sessions (tutorials,
   *  lectures) are calendar entries — no check, and once they are past they count as done. Unclassified stay open. */
  function collect() {
    const st = S.state;
    const fresh = freshUids();
    const out = [];
    Mo.records(st).forEach((rec, uid) => {
      if (rec.where === 'inbox') return;
      if (rec.where === 'item') {
        if (rec.course.archived) return;
        const s = rec.item.source;
        const cls = s.cls !== undefined ? s.cls : Mo.classify(st, s).cls;
        out.push({ uid, kind: 'item', item: rec.item, course: rec.course, cls, src: s, title: rec.item.title, due: rec.item.due, time: s.dueTime, link: rec.item.link, done: isDone(rec.item), isNew: fresh.has(uid) });
        return;
      }
      const e = rec.entry;
      const course = S.course(e.courseId);
      if (!course || course.archived) return;
      const session = !!Mo.classById(st, e.cls);
      out.push({ uid, kind: 'event', entry: e, course, cls: e.cls, src: e, title: e.title, due: e.due, time: e.dueTime, link: e.url, session, done: session && !!e.due && e.due < u.today(), isNew: fresh.has(uid) });
    });
    return out;
  }

  const clsOptions = (sel) => [...mo().classes.map((c) => [c.id, V.clsName(c)]), ['', tx('mo.unclassified')]]
    .map(([id, n]) => `<option value="${esc(id)}"${id === (sel || '') ? ' selected' : ''}>${esc(n)}</option>`).join('');
  const isManual = (src) => Object.prototype.hasOwnProperty.call(mo().classMap, Mo.patternKey(src.category, src.title));

  function pageRow(r) {
    const { course } = r;
    const n = r.due ? u.daysUntil(r.due) : null;
    const cl = r.done ? 'done' : n == null ? '' : n < 0 && !r.session ? 'overdue' : n >= 0 && n <= 1 ? 'soon' : '';
    const mark = r.kind === 'item'
      ? `<button class="check check-sm" role="checkbox" aria-checked="${r.done}" data-action="mm-toggle" aria-label="${t(r.done ? 'mo.p.unmark' : 'mo.p.mark', { title: r.title })}">${icon.check}</button>`
      : `<span class="mm-dot${r.session ? '' : ' mm-dot-q'}" title="${t(r.session ? 'mo.p.session' : 'mo.p.pickCls')}" aria-hidden="true">${r.session ? icon.calendar : '?'}</span>`;
    const href = r.kind === 'item' ? `#/course/${course.id}?item=${r.item.id}` : `#/course/${course.id}`;
    const tags = [
      r.isNew && r.kind === 'event' && `<span class="pill mm-new">${t('mb.new')}</span>`, // items get it from V.badges
      isManual(r.src) && `<span class="tag" title="${t('mo.p.manualTitle')}">${t('mo.p.manual')}</span>`,
      r.kind === 'item' ? V.badges(r.item).replace(/<span class="tag moodle-tag"[^>]*>[^<]*<\/span>/, '') : (r.entry.gone ? `<span class="tag moodle-alert">${t('mb.gone')}</span>` : ''),
    ].filter(Boolean).join('');
    return `<li class="${cl}" style="--c:${esc(course.color)}" data-id="${r.kind === 'item' ? esc(r.item.id) : ''}" data-uid="${esc(r.uid)}">
      ${mark}
      <a href="${href}" class="u-title"><span dir="auto">${esc(r.title)}</span>
        <span class="muted small">${ui.courseDot(course)} <span dir="auto">${esc(course.name)}</span> · ${esc(dueText(r.due, r.time))}${r.done && r.kind === 'item' ? ` · <b>${t('mo.p.submitted')}</b>` : ''}</span>
        ${tags ? `<span class="mm-tags">${tags}</span>` : ''}</a>
      <select class="chip-select mm-cls" data-mm-cls aria-label="${t('mo.p.clsOf', { title: r.title })}" title="${t('mo.p.clsTitle')}">${clsOptions(r.cls)}</select>
      <span class="u-when">${r.done ? (r.kind === 'item' ? icon.check : '') : r.due ? esc(ui.rel(r.due)) : ''}</span>
      ${r.link ? `<a class="icon-btn" href="${esc(u.safeUrl(r.link))}" target="_blank" rel="noopener noreferrer" title="${t('mo.p.openLink')}" aria-label="${t('mo.p.openNamed', { title: r.title })}">${icon.link}</a>` : ''}
    </li>`;
  }

  /** Connection state for the page header: ok · file (no link) · error · off (no account). */
  function connState() {
    const cloud = C();
    const m = mo();
    const signed = cloud && cloud.enabled && cloud.signedIn();
    if (m.linkError) return 'error';
    if (signed && hasFlag()) return 'ok';
    return signed ? 'file' : 'off';
  }

  V.render = (root) => {
    const m = mo();
    const conn = connState();
    const connected = conn === 'ok' || (conn === 'error' && C() && C().signedIn() && hasFlag());
    const all = collect();
    const courses = [...new Map(all.map(({ course }) => [course.id, course])).values()].sort((a, b) => a.name.localeCompare(b.name, 'he'));
    if (page.course && !courses.some((c) => c.id === page.course)) page.course = '';
    const hidden = new Set(m.classes.filter((c) => c.hidden).map((c) => c.id));
    if (page.tab !== 'all' && page.tab !== TAB_NONE && (!Mo.classById(S.state, page.tab) || hidden.has(page.tab))) page.tab = 'all';
    const inTab = (r, tab) => {
      if (tab === TAB_NONE) return !r.cls;
      if (tab !== 'all') return r.cls === tab;
      const c = Mo.classById(S.state, r.cls);
      return !c || (c.inAll && !c.hidden);
    };
    const byCourse = all.filter(({ course }) => !page.course || course.id === page.course);
    const openIn = (tab) => byCourse.filter((r) => !r.done && inTab(r, tab)).length;
    const shown = byCourse.filter((r) => inTab(r, page.tab));
    const open = shown.filter((r) => !r.done).sort((a, b) => sortKey(a).localeCompare(sortKey(b)));
    const done = shown.filter((r) => r.done).sort((a, b) => sortKey(b).localeCompare(sortKey(a)));
    const overdueN = open.filter((r) => !r.session && bucketOf(r) === 'overdue').length;
    const noneN = openIn(TAB_NONE);
    if (connected && feed.state === 'unknown') setTimeout(loadFeed, 0);
    const last = m.last;
    const lastAt = [m.serverAt, m.lastLink, last && last.at].filter(Boolean).sort().pop();
    const unseen = Mo.unseen(S.state);

    /* header: title, one connection chip, actions */
    const chip = `<span class="mw-conn is-${conn}">${icon[conn === 'ok' ? 'cloud' : conn === 'error' ? 'alert' : conn === 'file' ? 'upload' : 'info']}<span>${t(`mo.conn.${conn}`)}</span></span>`;
    const head = `<header class="mw-head">
        <div class="mw-title"><h1>${t('mo.p.title')}</h1>${chip}</div>
        <div class="toolbar-actions">
          ${connected ? `<button class="btn btn-primary" data-action="mm-refresh"${busy ? ' disabled' : ''}>${icon.refresh}<span>${busy === 'sync' ? t('mo.refreshing') : t('mo.syncNow')}</span></button>` : ''}
          <button class="btn" data-action="mm-import">${icon.upload}<span>${t('mo.importShort')}</span></button>
          <button class="icon-btn" data-action="mm-menu" aria-haspopup="menu" aria-label="${t('mo.p.more')}" title="${t('mo.p.more')}">${icon.more}</button>
        </div>
      </header>`;
    /* one status line: when it was updated, and the background refresh (the counts live in "what changed") */
    const status = `<p class="small mw-status">${icon.refresh}<span>${lastAt
      ? t('mo.p.updated', { when: fmtWhen(lastAt), ago: timeAgo(lastAt) }) + (last && last.source === 'file' && !m.lastLink ? ` · ${t('mo.p.fromFile')}` : '')
      : t('mo.p.never')}${busy === 'auto' ? ` · ${t('mo.p.bg')}` : ''}${connected ? ` · <span class="muted">${m.serverCheckedAt ? t('mo.p.server', { ago: timeAgo(m.serverCheckedAt) }) : t('mo.p.serverOff')}</span>` : ''}</span></p>`;
    const err = m.linkError ? `<div class="td-alert mw-alert" role="alert">${icon.alert}<div class="td-alert-t"><b>${t('td.moodleFailed')}</b><span class="small">${esc(V.errorText(m.linkError))}</span></div>
        <span class="td-alert-a">${connected ? `<button class="btn btn-small" data-action="mm-refresh"${busy ? ' disabled' : ''}>${icon.refresh}<span>${t('mo.retry')}</span></button>` : ''}
        <a class="btn btn-small btn-ghost" href="#/settings/moodle" data-action="mm-settings">${t('mo.p.settings')}</a></span></div>` : '';
    const how = conn === 'ok' || conn === 'error' ? '' : `<div class="card mm-connect">${icon.link}<p class="small">${t(conn === 'file' ? 'mo.p.connectLink' : 'mo.p.connectAccount')}</p>
        <a class="btn btn-small" href="#/settings/moodle" data-action="mm-settings">${t('mo.p.settings')}</a></div>`;
    const range = connected && feed.state === 'ok' && Mo.rangeInfo(feed.preset, feed.what).warn ? V.rangeHTML() : '';
    /* what needs you: unclassified events (the not-assigned list is its own card below) */
    const needs = noneN && page.tab !== TAB_NONE ? `<p class="small mm-unclassified">${icon.info}<span>${t('mo.p.unclassified', { n: noneN })}</span>
        <button class="btn btn-small" data-action="mm-tab" data-tab="${TAB_NONE}">${t('mo.p.classify')}</button></p>` : '';

    /* category tabs, grouped: coursework (goes to course pages) │ calendar (tutorials, lectures) │ unclassified */
    const visible = m.classes.filter((c) => !c.hidden);
    const tab = (id, name, extra = '') => {
      const n = openIn(id);
      return `<button role="tab" class="mm-tab${id === page.tab ? ' active' : ''}${extra}" aria-selected="${id === page.tab}" tabindex="${id === page.tab ? 0 : -1}" data-action="mm-tab" data-tab="${esc(id)}">${name}${n ? ` <span class="mm-count">${ui.num(n)}</span>` : ''}</button>`;
    };
    const work = visible.filter((c) => c.toCourse), cal = visible.filter((c) => !c.toCourse);
    const sep = '<span class="mm-tab-sep" aria-hidden="true"></span>';
    const tabsHTML = `<div class="mm-tabs" role="tablist" aria-label="${t('mo.p.cats')}">${tab('all', t('mo.p.all'))}
        ${work.length ? sep + work.map((c) => tab(c.id, bdi(V.clsName(c)))).join('') : ''}
        ${cal.length ? sep + cal.map((c) => tab(c.id, `${icon.calendar}${bdi(V.clsName(c))}`, ' mm-tab-cal')).join('') : ''}
        ${noneN || page.tab === TAB_NONE ? sep + tab(TAB_NONE, t('mo.unclassified'), ' mm-tab-none') : ''}</div>`;
    const groups = BUCKETS.map(([k, ic]) => {
      const rows = open.filter((r) => bucketOf(r) === k && !(k === 'overdue' && r.session));
      return rows.length ? `<section class="mm-group mm-${k}" aria-labelledby="mm-h-${k}"><h2 id="mm-h-${k}">${icon[ic]}<span>${t(`mo.b.${k}`)}</span> <span class="mm-count">${ui.num(rows.length)}</span></h2><ul class="urgent-list mm-list">${rows.map(pageRow).join('')}</ul></section>` : '';
    }).join('');
    const doneBox = page.showDone && done.length ? `<section class="mm-group mm-done" aria-labelledby="mm-h-done"><h2 id="mm-h-done">${icon.check}<span>${t('mo.b.done')}</span> <span class="mm-count">${ui.num(done.length)}</span></h2>
      <p class="small muted">${t('mo.p.doneNote')}</p><ul class="urgent-list mm-list">${done.map(pageRow).join('')}</ul></section>` : '';
    const tabName = page.tab === 'all' ? '' : page.tab === TAB_NONE ? tx('mo.unclassified') : nameOf(page.tab);
    const empty = all.length
      ? ui.empty(esc(tabName ? tx(page.course ? 'mo.p.emptyTabCourse' : 'mo.p.emptyTab', { tab: tabName }) : tx(page.course ? 'mo.p.emptyCourse' : 'mo.p.emptyAll')))
      : ui.empty(t('mo.p.none'));
    root.innerHTML = `<div class="mymoodle mw">
      ${head}
      ${status}${err}${how}${range}
      ${changesHTML(unseen)}
      ${inboxHTML()}
      ${needs}
      <section class="card mw-list" aria-label="${t('mo.p.listLabel')}">
        ${tabsHTML}
        <div class="mm-filters">
          <label class="small">${t('mo.p.course')} <select data-mm="course" class="chip-select"><option value="">${t('mo.p.allCourses')}</option>${courses.map((c) => `<option value="${esc(c.id)}"${c.id === page.course ? ' selected' : ''}>${esc(c.name)}</option>`).join('')}</select></label>
          <label class="small"><input type="checkbox" data-mm="done"${page.showDone ? ' checked' : ''}> ${t('mo.p.showDone', { n: done.length })}</label>
          <span class="small muted mm-totals">${t('mo.p.open', { n: open.length })}${overdueN ? ` · <b class="mm-overdue-n">${t('mo.p.overdue', { n: overdueN })}</b>` : ''}</span>
        </div>
        ${groups || empty}
        ${doneBox}
      </section>
    </div>`;
    const box = root.querySelector('.mymoodle');
    box.addEventListener('click', onPageClick);
    box.addEventListener('keydown', onTabKey);
    box.addEventListener('change', (e) => {
      if (e.target.matches('[data-mm-cls]')) { pickClass(e.target.closest('[data-uid]').dataset.uid, e.target.value); return; }
      const k = e.target.dataset.mm;
      if (k === 'course') page.course = e.target.value;
      if (k === 'done') page.showDone = e.target.checked;
      if (k) CT.app.rerender();
    });
  };

  /** Arrow keys move between category tabs (roving tabindex), in reading order for either direction. */
  function onTabKey(e) {
    const tabEl = e.target.closest && e.target.closest('.mm-tab');
    if (!tabEl || !['ArrowLeft', 'ArrowRight', 'Home', 'End'].includes(e.key)) return;
    const tabs = [...tabEl.parentElement.querySelectorAll('.mm-tab')];
    const i = tabs.indexOf(tabEl);
    const fwd = (e.key === 'ArrowLeft') === (I.dir() === 'rtl');
    const j = e.key === 'Home' ? 0 : e.key === 'End' ? tabs.length - 1 : (i + (fwd ? 1 : -1) + tabs.length) % tabs.length;
    e.preventDefault();
    page.tab = tabs[j].dataset.tab;
    CT.app.rerender();
    const again = document.querySelector(`.mm-tab[data-tab="${CSS.escape(page.tab)}"]`);
    if (again) again.focus();
  }

  /** Your category for an event (from the row's select): remembered for similar events, applied now. */
  function pickClass(uid, cls) {
    const before = Mo.records(S.state).get(uid);
    if (!before) return;
    const n = S.commit(tx('mo.c.classify'), (st) => Mo.setClass(st, uid, cls, mergeOpts()));
    const def = Mo.classById(S.state, cls);
    const msg = [tx('mo.p.classified', { name: nameOf(cls) })];
    if (def && def.toCourse) msg.push(tx('mo.p.classifiedWhere', { table: def.courseCat || def.name }));
    if (n > 1) msg.push(tx('mo.p.classifiedMore', { n: n - 1 }));
    ui.toast(msg.join(' · '), { action: undoAction() });
  }

  const KIND_ICON = { new: 'plus', changed: 'edit', gone: 'alert', restored: 'undo' };
  function changesHTML(n) {
    const list = mo().changes || [];
    if (!list.length) return '';
    const rows = list.slice(0, 30).map((c) => {
      const course = c.course && S.course(c.course);
      const prev = c.kind === 'changed' && (c.prevDue !== c.due || (c.prevTime || '') !== (c.dueTime || ''))
        ? ` <span class="muted">(${t('mo.ch.wasDue', { when: dueText(c.prevDue, c.prevTime) })})</span>` : '';
      const renamed = c.kind === 'changed' && c.prevTitle && c.prevTitle !== c.title ? ` <span class="muted">(${t('mo.ch.wasNamed')} <bdi>${esc(c.prevTitle)}</bdi>)</span>` : '';
      return `<li class="mm-ch mm-ch-${esc(c.kind)}${c.seen ? '' : ' unseen'}"><span class="mm-kind" title="${t(`mo.ch.${KIND_ICON[c.kind] ? c.kind : 'new'}`)}">${icon[KIND_ICON[c.kind] || 'info']}<span class="nc-sr">${t(`mo.ch.${KIND_ICON[c.kind] ? c.kind : 'new'}`)}</span></span>
        <span class="mm-ch-t"><span dir="auto">${esc(c.title)}</span>${renamed} · ${esc(dueText(c.due, c.dueTime))}${prev}
        <span class="muted"> · ${course ? `<span dir="auto">${esc(course.name)}</span>` : c.unassigned ? t('mo.ch.unassigned') : ''} · ${esc(timeAgo(c.at))}</span></span></li>`;
    }).join('');
    return `<details class="card mm-changes"${n.total ? ' open' : ''}><summary>${icon.bell}<b>${t('mo.ch.title')}</b> ${n.total ? `<span class="pill">${t('mo.ch.newN', { n: n.total })}</span>` : `<span class="muted small">(${ui.num(list.length)})</span>`}</summary>
      ${n.total ? `<p class="small mm-ch-sum"><span>${esc(V.unseenText(n))}</span> <button class="btn btn-small" data-action="mm-seen">${t('mo.ch.markSeen')}</button></p>` : ''}
      <ul class="mm-change-list small">${rows}</ul>
      <p class="small muted">${t('mo.ch.goneNote')}</p></details>`;
  }

  function pageMenu(anchor) {
    const m = mo();
    const un = Mo.unseen(S.state).total;
    ui.menu(anchor, [
      { label: tx('mo.menu.link'), icon: 'link', fn: () => V.showSettings() },
      { label: tx('mo.menu.classes'), icon: 'sliders', fn: () => { classesOpen = true; V.showSettings('moodle-classes'); } },
      { label: tx('mo.importFile'), icon: 'upload', fn: () => V.pickFile() },
      un && '-',
      un && { label: tx('mo.ch.markSeen'), icon: 'check', fn: () => V.markSeen() },
      Object.keys(m.ignored).length && { label: tx('mo.set.unignore'), icon: 'undo', fn: () => S.commit(tx('mo.c.unignore'), (st) => { Mo.ensure(st).ignored = {}; }) },
    ].filter(Boolean), LOC);
  }

  function onPageClick(e) {
    const a = e.target.closest('[data-action]');
    if (!a) return;
    const act = a.dataset.action;
    if (act === 'mm-settings') { e.preventDefault(); V.showSettings(); return; }
    if (!act.startsWith('mm-') && !act.startsWith('moodle-')) return;
    e.preventDefault();
    const id = a.closest('[data-id]') && a.closest('[data-id]').dataset.id;
    if (act === 'mm-refresh') V.syncLink({ manual: true, inline: true });
    else if (act === 'mm-import') V.pickFile();
    else if (act === 'mm-menu') pageMenu(a);
    else if (act === 'mm-seen') V.markSeen();
    else if (act === 'mm-tab') { page.tab = a.dataset.tab; CT.app.rerender(); }
    else if (act === 'mm-toggle') {
      const was = isDone(S.findItem(id).item);
      S.toggleDone(id);
      ui.toast(tx(was ? 'mo.p.unmarked' : 'mo.p.marked'), { action: undoAction() });
    } else if (/^moodle-(changed|gone|merge)$/.test(act)) V.rowAction(act, id, a);
    else V.onClick(a); // the not-assigned list
  }

  /** Go to the Moodle settings (the link, categories): the settings center opens its Moodle category at `id`. */
  V.showSettings = (id = 'moodle') => { CT.views.settings.goTo(id); };

  /** Go to the "not assigned" list on the Moodle page. */
  V.showInbox = () => {
    const go = () => {
      const el = document.getElementById('mw-inbox');
      if (!el) return;
      el.scrollIntoView({ block: 'start' });
      const f = el.querySelector('select');
      if (f) f.focus({ preventScroll: true });
    };
    if (!/^#\/moodle\b/.test(location.hash)) { location.hash = '#/moodle'; setTimeout(go, 60); } else go();
  };
})(window.CT);
