/* backup.js — export/import JSON, 7-day reminder, optional auto-save to a file (File System Access API). */
(function (CT) {
  'use strict';
  const u = CT.u;
  const b = {};
  const DB = 'ct-fs', STORE = 'handles';

  b.supported = typeof window.showSaveFilePicker === 'function';
  b.handle = null;
  b.status = 'none'; // none | granted | needs-permission | error
  b.lastWrite = null;

  /* ---------- tiny IndexedDB wrapper (file handles can't live in localStorage) ---------- */
  const idb = () => new Promise((res, rej) => {
    const r = indexedDB.open(DB, 1);
    r.onupgradeneeded = () => r.result.createObjectStore(STORE);
    r.onsuccess = () => res(r.result);
    r.onerror = () => rej(r.error);
  });
  const idbOp = async (mode, fn) => {
    const db = await idb();
    return new Promise((res, rej) => {
      const req = fn(db.transaction(STORE, mode).objectStore(STORE));
      req.onsuccess = () => res(req.result);
      req.onerror = () => rej(req.error);
    });
  };

  b.serialize = () => JSON.stringify({ app: 'course-tracker', exportedAt: new Date().toISOString(), data: CT.store.state }, null, 2);

  const markBackedUp = () => {
    CT.store.state.settings.lastBackup = new Date().toISOString();
    CT.store.persist(true);
  };

  /* ---------- manual export / import ---------- */
  b.exportFile = () => {
    const blob = new Blob([b.serialize()], { type: 'application/json' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = `course-tracker-backup-${u.today()}.json`;
    document.body.appendChild(a);
    a.click();
    setTimeout(() => { URL.revokeObjectURL(a.href); a.remove(); }, 1000);
    markBackedUp();
    CT.store.emit();
    CT.ui.toast('הגיבוי ירד לתיקיית ההורדות');
  };

  /** The untouched copy saved right before the automatic schema upgrade (null if there was no upgrade). */
  b.preUpgradeRaw = () => { try { return localStorage.getItem(CT.model.BACKUP_KEY); } catch (e) { return null; } };
  b.exportPreUpgrade = () => {
    const raw = b.preUpgradeRaw();
    if (!raw) { CT.ui.toast('אין גיבוי משדרוג'); return; }
    const a = document.createElement('a');
    a.href = URL.createObjectURL(new Blob([raw], { type: 'application/json' }));
    a.download = 'course-tracker-before-upgrade-v2.json';
    document.body.appendChild(a);
    a.click();
    setTimeout(() => { URL.revokeObjectURL(a.href); a.remove(); }, 1000);
    CT.ui.toast('הגיבוי שלפני השדרוג ירד לתיקיית ההורדות');
  };

  b.importFile = async (file) => {
    try {
      const obj = JSON.parse(await file.text());
      const data = CT.model.migrate(obj.data || obj);
      const n = data.courses.length;
      const ok = await CT.ui.confirm(`לשחזר מהגיבוי? (${n} קורסים)\nהנתונים הנוכחיים יוחלפו — אפשר לבטל עם Ctrl+Z.`, 'שחזר');
      if (!ok) return;
      CT.store.replace(data, 'ייבוא גיבוי');
      CT.ui.toast('הגיבוי שוחזר', { action: { label: 'בטל', fn: CT.store.undo } });
    } catch (e) {
      CT.ui.toast('לא הצלחתי לקרוא את הקובץ: ' + e.message, { error: true });
    }
  };

  b.pickImport = () => {
    const inp = document.createElement('input');
    inp.type = 'file';
    inp.accept = '.json,application/json';
    inp.onchange = () => inp.files[0] && b.importFile(inp.files[0]);
    inp.click();
  };

  /* ---------- reminder ---------- */
  b.needsReminder = () => {
    const st = CT.store.state.settings;
    if (b.status === 'granted') return false;
    if (CT.cloud && CT.cloud.signedIn()) return false; // the cloud copy is the backup
    if (st.backupSnooze && Date.now() < Date.parse(st.backupSnooze)) return false;
    const last = st.lastBackup || CT.store.state.meta.createdAt;
    return Date.now() - Date.parse(last) > 7 * 86400000;
  };
  b.daysSinceBackup = () => {
    const last = CT.store.state.settings.lastBackup;
    return last ? Math.floor((Date.now() - Date.parse(last)) / 86400000) : null;
  };
  b.snooze = () => CT.store.commit('', (st) => { st.settings.backupSnooze = new Date(Date.now() + 86400000).toISOString(); }, { undo: false });

  /* ---------- automatic file backup ---------- */
  b.init = async () => {
    if (!b.supported) return;
    try {
      const h = await idbOp('readonly', (s) => s.get('backup'));
      if (!h) return;
      b.handle = h;
      const p = await h.queryPermission({ mode: 'readwrite' });
      b.status = p === 'granted' ? 'granted' : 'needs-permission';
    } catch (e) { console.warn('backup init', e); }
  };

  b.connect = async () => {
    try {
      const h = await window.showSaveFilePicker({
        suggestedName: 'course-tracker-data.json',
        types: [{ description: 'JSON', accept: { 'application/json': ['.json'] } }],
      });
      b.handle = h;
      await idbOp('readwrite', (s) => s.put(h, 'backup'));
      b.status = 'granted';
      await b.writeNow();
      CT.ui.toast('שמירה אוטומטית לקובץ הופעלה');
    } catch (e) {
      if (e.name !== 'AbortError') CT.ui.toast('לא הצלחתי לחבר קובץ: ' + e.message, { error: true });
    }
    CT.store.emit();
  };

  b.regrant = async () => {
    if (!b.handle) return;
    try {
      const p = await b.handle.requestPermission({ mode: 'readwrite' });
      b.status = p === 'granted' ? 'granted' : 'needs-permission';
      if (b.status === 'granted') { await b.writeNow(); CT.ui.toast('השמירה האוטומטית פעילה'); }
    } catch (e) { CT.ui.toast('אין הרשאה לקובץ', { error: true }); }
    CT.store.emit();
  };

  b.disconnect = async () => {
    b.handle = null;
    b.status = 'none';
    try { await idbOp('readwrite', (s) => s.delete('backup')); } catch (e) { /* ignore */ }
    CT.store.emit();
  };

  b.writeNow = async () => {
    if (!b.handle || b.status !== 'granted') return;
    try {
      const w = await b.handle.createWritable();
      await w.write(b.serialize());
      await w.close();
      b.lastWrite = new Date();
      markBackedUp();
    } catch (e) {
      console.warn('auto backup failed', e);
      b.status = 'needs-permission';
      CT.store.emit();
    }
  };

  b.scheduleAutoSave = u.debounce(() => { b.writeNow(); }, 2000);

  CT.backup = b;
})(window.CT);
