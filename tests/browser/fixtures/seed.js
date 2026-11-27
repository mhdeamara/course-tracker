// Synthetic demo data for UI screenshots (no real user data). Runs inside the page after CT has loaded.
(() => {
  const S = CT.store, M = CT.model, u = CT.u;
  const d = (n) => new Date(Date.now() + n * 864e5).toISOString().slice(0, 10);
  const iso = (n) => new Date(Date.now() + n * 864e5).toISOString();
  S.state = M.initialData();
  const st = S.state;
  const cur = st.semesters[0];
  const p1 = M.newSemester({ name: 'חורף תשפ״ו', year: 5786, term: 'winter' });
  const p2 = M.newSemester({ name: 'אביב תשפ״ו', year: 5786, term: 'spring' });
  st.semesters.push(p1, p2);
  st.settings.catalog = { faculty: 'ee', year: 5787 };
  st.settings.lastBackup = iso(-10); // shows the backup reminder like a real user would see it
  // past semesters: grade-only records
  const past = [
    ['חדו״א 1', '01040031', 5.5, 82, p1], ['פיזיקה 1', '01140071', 3.5, 77, p1], ['מבוא למדעי המחשב', '02340114', 4, 91, p1],
    ['אלגברה ליניארית', '01040016', 5.5, 74, p2], ['פיזיקה 2', '01140075', 3.5, 85, p2], ['מערכות ספרתיות', '00440252', 5, 88, p2],
  ];
  past.forEach(([name, number, credits, grade, sem], i) => st.courses.push(M.newCourse({
    name, number, credits: String(credits), semesterId: sem.id, color: M.COLORS[(i + 4) % 10], kind: 'record',
    outcome: { type: 'graded', grade, date: '', note: '', exemptCredits: true },
  })));
  // current semester: tracked courses
  const now = [['אותות ומערכות', '00440131'], ['מעגלים אלקטרוניים', '00440137'], ['מבני נתונים', '00440268'], ['הסתברות', '00940412'], ['מעבדה בחשמל 1', '00440157']];
  const days = [0, 1, 2, 3, 4];
  now.forEach(([name, number], i) => {
    const c = M.applyTemplate(M.newCourse({ name, number, semesterId: cur.id, color: M.COLORS[i], credits: i === 4 ? '1' : '4' }), M.DEFAULT_TEMPLATE);
    c.categories.forEach((k) => k.items.forEach((it, j) => {
      if (j < 3 + i) { it.status = 'done'; it.completedAt = iso(-(j + 1)); }
      else if (j === 3 + i) it.status = 'review';
    }));
    const hw = c.categories[2] ? c.categories[2].items : [];
    hw.forEach((h) => { h.status = 'todo'; h.completedAt = null; });
    if (hw[0]) hw[0].due = d(-1 - (i % 2));
    if (hw[1]) { hw[1].due = d(i + 1); hw[1].note = 'שאלה 3 — לבדוק עם המתרגל'; }
    if (hw[2]) hw[2].due = d(i + 6);
    c.exams.push({ id: u.uid(), label: 'מועד א', date: d(60 + i * 4) }, { id: u.uid(), label: 'מועד ב', date: d(90 + i * 4) });
    c.schedule.push({ id: u.uid(), day: days[i], start: '10:30', end: '12:30', type: 'lecture', room: 'מאייר 280' },
      { id: u.uid(), day: (i + 2) % 5, start: '14:30', end: '16:30', type: 'tutorial', room: 'טאוב 2' });
    c.grade = { components: [{ id: u.uid(), name: 'תרגילי בית', weight: 20, score: 90 }, { id: u.uid(), name: 'בוחן', weight: 10, score: 80 }, { id: u.uid(), name: 'מבחן', weight: 70, score: '' }], target: 85 };
    c.links = [{ id: u.uid(), label: 'מודל', url: 'https://moodle.example.invalid/course' }];
    st.courses.push(c);
  });
  st.settings.activeSemesterId = cur.id;
  st.studyLog.push({ id: u.uid(), courseId: st.courses[6].id, date: d(0), minutes: 50 }, { id: u.uid(), courseId: st.courses[7].id, date: d(-1), minutes: 30 },
    { id: u.uid(), courseId: st.courses[8].id, date: d(-2), minutes: 75 });
  // Moodle: a synthetic calendar export, merged through the real code path
  const dt = (n, h) => d(n).replace(/-/g, '') + 'T' + h + '00Z';
  const ev = (uid, sum, n, cat) => `BEGIN:VEVENT\r\nUID:${uid}@demo\r\nSUMMARY:${sum}\r\nDTSTART:${dt(n, '2059')}\r\nDTEND:${dt(n, '2059')}\r\nCATEGORIES:${cat}\r\nEND:VEVENT\r\n`;
  const ics = 'BEGIN:VCALENDAR\r\nVERSION:2.0\r\n' +
    ev(1, 'תרגיל בית 4 is due', 3, 'אותות ומערכות - 00440131') + ev(2, 'דוח הכנה 2 is due', 5, 'מעבדה בחשמל 1 - 00440157') +
    ev(3, 'תרגול 6', 1, 'מבני נתונים - 00440268') + ev(4, 'בוחן אמצע is due', 9, 'הסתברות - 00940412') +
    ev(5, 'הרצאה 7', 2, 'מעגלים אלקטרוניים - 00440137') + ev(6, 'Survey closes', 4, 'קורס לא מוכר - 99999999') + 'END:VCALENDAR\r\n';
  try {
    const evs = CT.ical.parse(ics).events;
    CT.moodle.merge(st, evs, { newItem: (t) => M.newItem(t), newCategory: (n) => M.newCategory(n), uid: u.uid, today: u.today(), source: 'file' });
  } catch (e) { console.warn('moodle demo', e); }
  if (CT.game) CT.game.reconcile(st);
  const tu = (id, name, input) => ({ type: 'tool_use', id, name, input });
  localStorage.setItem('ct.ai.chat', JSON.stringify({ v: 1, msgs: [
    { role: 'user', content: [{ type: 'text', text: 'מה יש לי לעשות השבוע?' }] },
    { role: 'assistant', content: [tu('t1', 'get_overview', {}), tu('t2', 'list_items', { dueWithinDays: 7 })], _cost: 0.0004 },
    { role: 'user', content: [{ type: 'tool_result', tool_use_id: 't1', content: '{}' }, { type: 'tool_result', tool_use_id: 't2', content: '{}' }] },
    { role: 'assistant', content: [{ type: 'text', text: `השבוע יש לך 5 מטלות פתוחות:
- **ש״ב 1** באותות ומערכות — באיחור מאתמול
- **ש״ב 2** במעגלים — ביום ראשון
- **דוח הכנה 2** במעבדה — בעוד 5 ימים

כדאי להתחיל מהמטלה שבאיחור.` }], _cost: 0.0006, _model: 'claude-haiku-5-5' },
  ] }));
  S.undoStack = [];
  S.persist(true);
  return 'seeded ' + st.courses.length;
})()
