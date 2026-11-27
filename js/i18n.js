/* i18n.js — UI language (Hebrew / English): dictionaries, t(), plurals, direction. Loaded first, in <head>, so the
 * page gets the right lang/dir before the first paint; the same pick() runs here and nowhere else.
 * Only interface text is translated. Stored values, ids, statuses, course names and Moodle content never change.
 * Pages not translated yet stay Hebrew/RTL in English mode: their containers are marked as "content" (see markContent). */
(function () {
  'use strict';
  const CT = (window.CT = window.CT || {});
  const KEY = 'ct.lang';
  const LANGS = ['he', 'en'];

  /* ---------- dictionaries: same keys and same {params} in both (tests/i18n.test.js checks) ---------- */
  const HE = {
    'app.name': 'הקורסים שלי',
    'lang.he': 'עברית',
    'lang.en': 'English',
    'lang.title': 'שפה',
    'lang.hint': 'שפת הממשק בלבד. שמות קורסים, תוכן מהמודל והנתונים שלך לא משתנים.',
    'lang.partial': 'חלק מהמסכים עדיין בעברית ויתורגמו בהדרגה.',
    'lang.switch': 'החלפה לאנגלית (English)',

    'a11y.skip': 'דלג לתוכן',
    'nav.main': 'ניווט ראשי',
    'nav.secondary': 'ניווט משני',
    'nav.expand': 'הרחבת התפריט',
    'nav.collapse': 'כיווץ התפריט',
    'nav.settings': 'הגדרות',
    'dest.today': 'היום',
    'dest.courses': 'קורסים',
    'dest.degree': 'התואר',
    'dest.ai': 'AI',
    'sub.overview': 'סקירה',
    'sub.schedule': 'מערכת שעות',
    'sub.xp': 'נקודות ויעדים',
    'sub.adhkar': 'אזכרות',
    'sub.courses': 'הקורסים שלי',
    'sub.moodle': 'המודל שלי',
    'sub.review': 'חזרה למבחן',
    'sub.archive': 'ארכיון',
    'sub.grades': 'ממוצע וציונים',
    'sub.catalog': 'תכנית לימודים',
    'sub.semesters': 'סמסטרים',
    'sub.stats': 'סטטיסטיקות',

    'hd.searchPh': 'חיפוש בקורסים, פריטים והערות…',
    'hd.searchLabel': 'חיפוש גלובלי (קיצור: /)',
    'hd.searchBtn': 'חיפוש (/)',
    'hd.sync': 'סנכרון',
    'hd.syncStatus': 'סנכרון: {status}',
    'hd.undo': 'ביטול פעולה אחרונה (Ctrl+Z)',
    'hd.undoTitle': 'ביטול (Ctrl+Z)',
    'hd.help': 'קיצורי מקלדת (?)',
    'hd.toLight': 'מעבר למצב בהיר',
    'hd.toDark': 'מעבר למצב כהה',
    'hd.more': 'עוד פעולות',
    'menu.light': 'מצב בהיר',
    'menu.dark': 'מצב כהה',
    'menu.undo': 'ביטול פעולה אחרונה',
    'menu.shortcuts': 'קיצורי מקלדת',

    'search.course': 'קורס',
    'search.item': 'פריט',
    'search.concept': 'מושג',
    'search.archived': '(ארכיון)',
    'search.none': 'לא נמצאו תוצאות',

    'backup.auto': 'שמירה אוטומטית פעילה',
    'backup.pending': 'שמירה אוטומטית ממתינה לאישור',
    'backup.never': 'עוד לא גובה',
    'backup.today': 'גיבוי אחרון היום',
    'backup.yesterday': 'גיבוי אחרון אתמול',
    'backup.days': { one: 'גיבוי אחרון לפני יום', two: 'גיבוי אחרון לפני יומיים', other: 'גיבוי אחרון לפני {n} ימים' },

    'sc.search': 'חיפוש',
    'sc.new': 'פריט חדש (בדף קורס) / קורס חדש (בדשבורד)',
    'sc.check': 'סימון V על השורה הנבחרת',
    'sc.moveKeys': '↑ ↓  או  j k',
    'sc.move': 'מעבר בין שורות',
    'sc.note': 'פתיחת/סגירת הערה',
    'sc.star': 'סימון ⭐ לחזרה לפני המבחן',
    'sc.status': 'בחירת סטטוס',
    'sc.edit': 'פרטי פריט ועריכה',
    'sc.reorder': 'הזזת שורה',
    'sc.delete': 'מחיקת שורה',
    'sc.timer': 'טיימר לימוד',
    'sc.ai': 'עוזר AI (גם כפתור 🤖 בפינה)',
    'sc.goKeys': 'g ואז d / s / r / t',
    'sc.go': 'מעבר לדשבורד / מערכת / חזרה / סטטיסטיקות',
    'sc.help': 'החלון הזה',
    'sc.esc': 'סגירת חלון / ביטול עריכה',
    'sc.layouts': 'הקיצורים עובדים גם כשהמקלדת על עברית.',
    'welcome': 'ברוך הבא! נטענו הקורסים של סמסטר ו. לחץ ? לקיצורי מקלדת.',

    'common.close': 'סגור',
    'common.ok': 'אישור',
    'common.confirm': 'אישור',
    'common.cancel': 'ביטול',
    'common.save': 'שמור',
    'common.progress': 'התקדמות',
    'common.ringDone': '{pct}% הושלמו',

    'lock.malformed': 'גרסת הנתונים לא תקינה',
    'lock.newer': 'נדרש עדכון גרסה',
    'lock.readonly': 'האתר במצב קריאה בלבד כדי להגן על הנתונים שלך.',
    'lock.storeFailed': 'לא הצלחתי לשמור עותק בדפדפן. כדאי להוריד גיבוי עכשיו.',
    'lock.update': 'עדכן עכשיו',
    'lock.download': 'הורד גיבוי',
    'lock.error': 'האתר במצב קריאה בלבד',
    'update.checking': 'בודק אם יש גרסה חדשה…',
    'update.offline': 'אין חיבור לאינטרנט. נסה שוב כשיש רשת.',
    'update.network': 'בדיקת העדכון נכשלה. נסה שוב מאוחר יותר.',
    'update.none': 'אין עדכון זמין כרגע. נסה שוב מאוחר יותר.',
    'update.timeout': 'העדכון לא הופעל. סגור את כל הלשוניות של האתר ופתח אותו מחדש.',
    'update.loop': 'האתר נטען מחדש לפני רגע ועדיין לא עודכן. סגור את כל הלשוניות של האתר ופתח אותו מחדש.',
    'update.reloading': 'טוען את הגרסה החדשה…',

    'sync.off': 'מקומי בלבד',
    'sync.signedOut': 'לא מחובר לסנכרון',
    'sync.syncing': 'מסנכרן…',
    'sync.synced': 'מסונכרן',
    'sync.offline': 'אין אינטרנט — יסונכרן אחר כך',
    'sync.error': 'שגיאת סנכרון',
    'sync.conflict': 'צריך לבחור גרסה',
    'conflict.titleFirst': 'יש כבר נתונים בענן',
    'conflict.titleBoth': 'הנתונים השתנו בשני מכשירים',
    'conflict.bodyFirst': 'בחשבון כבר שמורים נתונים, וגם במכשיר הזה יש נתונים. איזה עותק להשאיר?',
    'conflict.bodyBoth': 'מכשיר אחר שמר שינויים בזמן שגם כאן היו שינויים שעוד לא סונכרנו. איזה עותק להשאיר?',
    'conflict.courses': { one: 'קורס אחד', other: '{n} קורסים' },
    'conflict.done': { one: 'פריט אחד הושלם', other: '{n} פריטים הושלמו' },
    'conflict.cloud': '☁️ הענן',
    'conflict.device': '💻 המכשיר הזה',
    'conflict.unreadable': 'לא קריא',
    'conflict.updated': 'עודכן: {when}',
    'conflict.note': 'העותק שלא נבחר לא נמחק לגמרי: אם תבחר בענן, עותק של נתוני המכשיר יורד כקובץ גיבוי.',
    'conflict.keepDevice': 'השאר את המכשיר הזה',
    'conflict.keepCloud': 'השאר את הענן',
    'conflict.loadedBackup': 'נטענו הנתונים מהענן. עותק של נתוני המכשיר נשמר בהורדות.',
    'conflict.loaded': 'נטענו הנתונים מהענן',
    'conflict.changedAgain': 'הענן השתנה שוב — נסה "סנכרן עכשיו"',
    'conflict.saved': 'הנתונים מהמכשיר הזה נשמרו בענן',
    'conflict.unresolved': 'ההתנגשות לא נפתרה',

    'ai.privacy': 'כל בקשה לעוזר נשלחת לעיבוד אצל Anthropic (ספק מודל Claude) דרך שרת ה-Supabase שלך. לפי מדיניות Anthropic ל-API: התוכן לא משמש לאימון מודלים, ונמחק אצלם תוך 30 יום (תוכן שסומן כהפרת מדיניות עשוי להישמר עד שנתיים). מפתח ה-API נשמר רק כסוד בשרת — לא באתר, לא בדפדפן ולא בגיבוי.',
    'ai.notConfigured': 'העוזר עובד דרך Supabase, שעוד לא הוגדר באתר הזה.',
    'ai.signIn': 'כדי להשתמש בעוזר צריך להתחבר לחשבון באתר (בסעיף "סנכרון בין מכשירים").',
    'chat.privacy': 'העוזר רק קורא את הנתונים ולא משנה כלום. השאלות והנתונים שהוא קורא נשלחים לעיבוד אצל Anthropic. השיחה נשמרת רק במכשיר הזה.',

    'timer.chip': 'טיימר: {time}',
    'timer.open': 'טיימר לימוד (T)',
    'xp.chip': 'רמה {n}, {title}',

    'notif.title': 'התראות',
    'notif.bell': 'התראות',
    'notif.bellUnread': { one: 'התראות, אחת חדשה', other: 'התראות, {n} חדשות' },
    'notif.markAll': 'סמן הכול כנקרא',
    'notif.empty': 'אין התראות כרגע.',
    'notif.critNote': 'אזהרות קריטיות (נעילת גרסה, התנגשות סנכרון ושגיאות סנכרון) נשארות על המסך ולא נכנסות לכאן.',
    'notif.new': 'חדש',
    'notif.group.moodle': 'מודל',
    'notif.group.backup': 'גיבוי',
    'notif.group.account': 'חשבון',
    'notif.group.xp': 'נקודות',
    'notif.moodle.changes': 'עדכונים ממודל',
    'notif.moodle.new': { one: 'נוספה מטלה חדשה', other: 'נוספו {n} מטלות חדשות' },
    'notif.moodle.changed': { one: 'מטלה אחת השתנתה', other: '{n} מטלות השתנו' },
    'notif.moodle.gone': { one: 'מטלה אחת לא מופיעה יותר', other: '{n} מטלות לא מופיעות יותר' },
    'notif.moodle.restored': { one: 'מטלה אחת חזרה למודל', other: '{n} מטלות חזרו למודל' },
    'notif.moodle.error': 'סנכרון המטלות ממודל נכשל',
    'notif.moodle.inbox': { one: 'מטלה אחת ממודל מחכה לשיוך', other: '{n} מטלות ממודל מחכות לשיוך' },
    'notif.backup.permission': 'השמירה האוטומטית לקובץ ממתינה לאישור הדפדפן',
    'notif.backup.never': 'עוד לא גיבית את הנתונים',
    'notif.backup.days': { one: 'עבר יום מהגיבוי האחרון', two: 'עברו יומיים מהגיבוי האחרון', other: 'עברו {n} ימים מהגיבוי האחרון' },
    'notif.signin': 'התחבר כדי לסנכרן בין המחשב לטלפון',
    'notif.xp.pause': 'מצב השהיה — בלי ניכויים, והרצף מחכה לך',
    'notif.xp.until': 'עד {date}',
    'notif.xp.pen': { one: 'לא הגעת למינימום, וירדו {pts} נקודות מהיתרה', other: 'ב-{n} ימים לא הגעת למינימום, וירדו {pts} נקודות מהיתרה' },
    'notif.xp.penNote': 'הרמה וההישגים לא נפגעים — היום מתחילים מחדש',
    'notif.xp.riskMin': 'עוד לא הגעת למינימום של היום',
    'notif.xp.need': { one: 'פריט אחד או {min} דקות', other: '{n} פריטים או {min} דקות' },
    'notif.xp.freezes': { one: 'נשארה הקפאה אחת החודש', other: 'נשארו {n} הקפאות החודש' },
    'notif.xp.streak': { one: 'רצף של יום אחד מחכה לך היום', other: 'רצף של {n} ימים מחכה לך היום' },
    'notif.xp.small': 'משהו קטן מספיק',
    'xp.reason.exams': 'תקופת מבחנים',
    'xp.reason.sick': 'מחלה',
    'xp.reason.vacation': 'חופשה',
    'xp.reason.other': 'אחר',
    'notif.act.whatChanged': 'מה השתנה',
    'notif.act.seen': 'ראיתי',
    'notif.act.settings': 'להגדרות',
    'notif.act.assign': 'לשיוך',
    'notif.act.grant': 'אשר גישה',
    'notif.act.export': 'ייצא גיבוי',
    'notif.act.later': 'אחר כך',
    'notif.act.signin': 'להתחברות',
    'notif.act.resume': 'חזרה לשגרה',
    'notif.act.why': 'למה?',
    'notif.act.gotIt': 'הבנתי',
    'notif.act.five': 'רק 5 דקות',
  };

  const EN = {
    'app.name': 'My Courses',
    'lang.he': 'עברית',
    'lang.en': 'English',
    'lang.title': 'Language',
    'lang.hint': 'Interface language only. Course names, Moodle content and your data stay unchanged.',
    'lang.partial': 'Some screens are still in Hebrew and will be translated gradually.',
    'lang.switch': 'Switch to Hebrew (עברית)',

    'a11y.skip': 'Skip to content',
    'nav.main': 'Main navigation',
    'nav.secondary': 'Secondary navigation',
    'nav.expand': 'Expand menu',
    'nav.collapse': 'Collapse menu',
    'nav.settings': 'Settings',
    'dest.today': 'Today',
    'dest.courses': 'Courses',
    'dest.degree': 'Degree',
    'dest.ai': 'AI',
    'sub.overview': 'Overview',
    'sub.schedule': 'Schedule',
    'sub.xp': 'Points & goals',
    'sub.adhkar': 'Adhkar',
    'sub.courses': 'My courses',
    'sub.moodle': 'My Moodle',
    'sub.review': 'Exam review',
    'sub.archive': 'Archive',
    'sub.grades': 'GPA & grades',
    'sub.catalog': 'Study program',
    'sub.semesters': 'Semesters',
    'sub.stats': 'Statistics',

    'hd.searchPh': 'Search courses, items and notes…',
    'hd.searchLabel': 'Global search (shortcut: /)',
    'hd.searchBtn': 'Search (/)',
    'hd.sync': 'Sync',
    'hd.syncStatus': 'Sync: {status}',
    'hd.undo': 'Undo last action (Ctrl+Z)',
    'hd.undoTitle': 'Undo (Ctrl+Z)',
    'hd.help': 'Keyboard shortcuts (?)',
    'hd.toLight': 'Switch to light mode',
    'hd.toDark': 'Switch to dark mode',
    'hd.more': 'More actions',
    'menu.light': 'Light mode',
    'menu.dark': 'Dark mode',
    'menu.undo': 'Undo last action',
    'menu.shortcuts': 'Keyboard shortcuts',

    'search.course': 'Course',
    'search.item': 'Item',
    'search.concept': 'Concept',
    'search.archived': '(archived)',
    'search.none': 'No results',

    'backup.auto': 'Auto-save is on',
    'backup.pending': 'Auto-save is waiting for permission',
    'backup.never': 'Not backed up yet',
    'backup.today': 'Last backup today',
    'backup.yesterday': 'Last backup yesterday',
    'backup.days': { one: 'Last backup {n} day ago', other: 'Last backup {n} days ago' },

    'sc.search': 'Search',
    'sc.new': 'New item (course page) / new course (dashboard)',
    'sc.check': 'Check the selected row',
    'sc.moveKeys': '↑ ↓  or  j k',
    'sc.move': 'Move between rows',
    'sc.note': 'Open/close note',
    'sc.star': 'Mark ⭐ for exam review',
    'sc.status': 'Choose status',
    'sc.edit': 'Item details and editing',
    'sc.reorder': 'Move row',
    'sc.delete': 'Delete row',
    'sc.timer': 'Study timer',
    'sc.ai': 'AI assistant (also the 🤖 button in the corner)',
    'sc.goKeys': 'g then d / s / r / t',
    'sc.go': 'Go to dashboard / schedule / review / statistics',
    'sc.help': 'This window',
    'sc.esc': 'Close window / cancel editing',
    'sc.layouts': 'Shortcuts also work with a Hebrew keyboard layout.',
    'welcome': 'Welcome! Semester 6 courses were loaded. Press ? for keyboard shortcuts.',

    'common.close': 'Close',
    'common.ok': 'OK',
    'common.confirm': 'Confirm',
    'common.cancel': 'Cancel',
    'common.save': 'Save',
    'common.progress': 'Progress',
    'common.ringDone': '{pct}% complete',

    'lock.malformed': 'The data version is invalid',
    'lock.newer': 'An app update is required',
    'lock.readonly': 'The site is read-only to protect your data.',
    'lock.storeFailed': 'Could not save a copy in the browser. Download a backup now.',
    'lock.update': 'Update now',
    'lock.download': 'Download backup',
    'lock.error': 'The site is read-only',
    'update.checking': 'Checking for a new version…',
    'update.offline': 'No internet connection. Try again when you are online.',
    'update.network': 'The update check failed. Try again later.',
    'update.none': 'No update is available yet. Try again later.',
    'update.timeout': 'The update did not activate. Close all tabs of this site and open it again.',
    'update.loop': 'The site just reloaded and is still not updated. Close all tabs of this site and open it again.',
    'update.reloading': 'Loading the new version…',

    'sync.off': 'Local only',
    'sync.signedOut': 'Not signed in to sync',
    'sync.syncing': 'Syncing…',
    'sync.synced': 'Synced',
    'sync.offline': 'Offline — will sync later',
    'sync.error': 'Sync error',
    'sync.conflict': 'Choose a version',
    'conflict.titleFirst': 'There is already data in the cloud',
    'conflict.titleBoth': 'Data changed on two devices',
    'conflict.bodyFirst': 'Your account already has saved data, and this device has data too. Which copy should be kept?',
    'conflict.bodyBoth': 'Another device saved changes while this one had changes that were not synced yet. Which copy should be kept?',
    'conflict.courses': { one: '{n} course', other: '{n} courses' },
    'conflict.done': { one: '{n} item done', other: '{n} items done' },
    'conflict.cloud': '☁️ Cloud',
    'conflict.device': '💻 This device',
    'conflict.unreadable': 'Unreadable',
    'conflict.updated': 'Updated: {when}',
    'conflict.note': 'The copy you do not choose is not lost: if you choose the cloud, a copy of this device\'s data is downloaded as a backup file.',
    'conflict.keepDevice': 'Keep this device',
    'conflict.keepCloud': 'Keep the cloud',
    'conflict.loadedBackup': 'Loaded the data from the cloud. A copy of this device\'s data was saved to Downloads.',
    'conflict.loaded': 'Loaded the data from the cloud',
    'conflict.changedAgain': 'The cloud changed again — try "Sync now"',
    'conflict.saved': 'This device\'s data was saved to the cloud',
    'conflict.unresolved': 'The conflict was not resolved',

    'ai.privacy': 'Every request to the assistant is sent for processing to Anthropic (the provider of the Claude model) through your Supabase server. Under Anthropic\'s API policy, the content is not used to train models and is deleted within 30 days (content flagged as a policy violation may be kept for up to 2 years). The API key is stored only as a server secret — not in the site, the browser or the backup.',
    'ai.notConfigured': 'The assistant works through Supabase, which is not set up on this site yet.',
    'ai.signIn': 'To use the assistant, sign in to your account on the site (in the "סנכרון בין מכשירים" section).',
    'chat.privacy': 'The assistant only reads your data and never changes anything. Your questions and the data it reads are sent to Anthropic for processing. The conversation is stored only on this device.',

    'timer.chip': 'Timer: {time}',
    'timer.open': 'Study timer (T)',
    'xp.chip': 'Level {n}, {title}',

    'notif.title': 'Notifications',
    'notif.bell': 'Notifications',
    'notif.bellUnread': { one: 'Notifications, {n} unread', other: 'Notifications, {n} unread' },
    'notif.markAll': 'Mark all as read',
    'notif.empty': 'Nothing here right now.',
    'notif.critNote': 'Critical warnings (version lock, sync conflicts and sync errors) stay on screen and never move here.',
    'notif.new': 'New',
    'notif.group.moodle': 'Moodle',
    'notif.group.backup': 'Backup',
    'notif.group.account': 'Account',
    'notif.group.xp': 'Points',
    'notif.moodle.changes': 'Updates from Moodle',
    'notif.moodle.new': { one: '{n} new assignment', other: '{n} new assignments' },
    'notif.moodle.changed': { one: '{n} assignment changed', other: '{n} assignments changed' },
    'notif.moodle.gone': { one: '{n} assignment is no longer listed', other: '{n} assignments are no longer listed' },
    'notif.moodle.restored': { one: '{n} assignment is back in Moodle', other: '{n} assignments are back in Moodle' },
    'notif.moodle.error': 'Moodle assignment sync failed',
    'notif.moodle.inbox': { one: '{n} Moodle assignment needs a course', other: '{n} Moodle assignments need a course' },
    'notif.backup.permission': 'Automatic file backup is waiting for browser permission',
    'notif.backup.never': 'You have not backed up your data yet',
    'notif.backup.days': { one: '{n} day since the last backup', other: '{n} days since the last backup' },
    'notif.signin': 'Sign in to sync between your computer and phone',
    'notif.xp.pause': 'Paused — no deductions, and your streak is waiting',
    'notif.xp.until': 'until {date}',
    'notif.xp.pen': { one: 'You missed the daily minimum and {pts} points were deducted', other: 'You missed the daily minimum on {n} days and {pts} points were deducted' },
    'notif.xp.penNote': 'Your level and achievements are safe — today is a fresh start',
    'notif.xp.riskMin': 'You have not reached today\'s minimum yet',
    'notif.xp.need': { one: '{n} item or {min} minutes', other: '{n} items or {min} minutes' },
    'notif.xp.freezes': { one: '{n} freeze left this month', other: '{n} freezes left this month' },
    'notif.xp.streak': { one: 'Your {n}-day streak is waiting for you today', other: 'Your {n}-day streak is waiting for you today' },
    'notif.xp.small': 'Something small is enough',
    'xp.reason.exams': 'Exam period',
    'xp.reason.sick': 'Illness',
    'xp.reason.vacation': 'Vacation',
    'xp.reason.other': 'Other',
    'notif.act.whatChanged': 'What changed',
    'notif.act.seen': 'Seen',
    'notif.act.settings': 'Open settings',
    'notif.act.assign': 'Assign',
    'notif.act.grant': 'Allow access',
    'notif.act.export': 'Export backup',
    'notif.act.later': 'Later',
    'notif.act.signin': 'Sign in',
    'notif.act.resume': 'Resume',
    'notif.act.why': 'Why?',
    'notif.act.gotIt': 'Got it',
    'notif.act.five': 'Just 5 minutes',
  };
  const DICTS = { he: HE, en: EN };

  /* ---------- language choice: one rule for the first paint and for the module ----------
   * saved choice → it; any other local ct.* key (an existing user) → he; a browser with no Hebrew → en; otherwise he.
   * Unreadable storage counts as "cannot tell" → he. */
  const pick = ({ saved, hasData, langs } = {}) => {
    if (LANGS.includes(saved)) return saved;
    if (hasData) return 'he';
    const list = (langs || []).map((l) => String(l || '').toLowerCase()).filter(Boolean);
    if (list.length && !list.some((l) => /^(he|iw)(-|$)/.test(l))) return 'en';
    return 'he';
  };
  const storage = () => { try { return window.localStorage || null; } catch (e) { return null; } };
  function readEnv() {
    const env = { saved: null, hasData: true, langs: [] };
    try {
      const ls = storage();
      if (ls) {
        env.saved = ls.getItem(KEY);
        env.hasData = false;
        for (let i = 0; i < ls.length; i++) {
          const k = ls.key(i);
          if (k && k.startsWith('ct.') && k !== KEY) { env.hasData = true; break; }
        }
      }
    } catch (e) { env.hasData = true; }
    try {
      const n = typeof navigator !== 'undefined' ? navigator : null;
      env.langs = n ? (n.languages && n.languages.length ? Array.from(n.languages) : [n.language]) : [];
    } catch (e) { env.langs = []; }
    return env;
  }
  const save = (l) => { try { const ls = storage(); if (ls) ls.setItem(KEY, l); } catch (e) { /* private mode / blocked */ } };

  /* ---------- lookup ---------- */
  let cur = 'he';
  const warned = new Set();
  const warn = (msg) => { if (warned.has(msg)) return; warned.add(msg); try { console.warn('[i18n] ' + msg); } catch (e) { /* no console */ } };
  const rules = {};
  const pluralForm = (lang, n) => {
    try { return (rules[lang] = rules[lang] || new Intl.PluralRules(lang === 'he' ? 'he' : 'en')).select(Number(n)); } catch (e) { return Number(n) === 1 ? 'one' : 'other'; }
  };
  const lookup = (key) => {
    if (Object.prototype.hasOwnProperty.call(DICTS[cur], key)) return [cur, DICTS[cur][key]];
    const other = cur === 'he' ? 'en' : 'he';
    warn(`missing "${key}" in ${cur}`);
    if (Object.prototype.hasOwnProperty.call(DICTS[other], key)) return [other, DICTS[other][key]];
    return [cur, key];
  };
  /** Plain text (for textContent, setAttribute, toasts, Error messages). */
  const tx = (key, params) => {
    const p = params || {};
    let [lang, v] = lookup(key);
    if (v && typeof v === 'object') v = v[pluralForm(lang, p.n)] || v.other || '';
    return String(v).replace(/\{(\w+)\}/g, (m, name) => {
      if (p[name] == null) { warn(`missing param {${name}} for "${key}"`); return ''; }
      return String(p[name]);
    });
  };
  const ESC = { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' };
  const esc = (s) => String(s).replace(/[&<>"']/g, (c) => ESC[c]);
  /** HTML-safe text (dictionary text and every parameter escaped) — for innerHTML templates and attribute values. */
  const t = (key, params) => esc(tx(key, params));

  /* ---------- direction ---------- */
  const dirOf = (l) => (l === 'he' ? 'rtl' : 'ltr');
  /** Containers of not-yet-translated content (#main, overlays) stay Hebrew/RTL in English mode. */
  const markContent = (el) => {
    el.setAttribute('data-ct-content', '');
    if (cur === 'he') { el.removeAttribute('dir'); el.removeAttribute('lang'); } else { el.setAttribute('dir', 'rtl'); el.setAttribute('lang', 'he'); }
  };
  function apply() {
    if (typeof document === 'undefined') return;
    const html = document.documentElement;
    html.lang = cur;
    html.dir = dirOf(cur);
    document.title = tx('app.name');
    document.querySelectorAll('[data-i18n]').forEach((el) => { el.textContent = tx(el.getAttribute('data-i18n')); });
    document.querySelectorAll('[data-i18n-aria]').forEach((el) => { el.setAttribute('aria-label', tx(el.getAttribute('data-i18n-aria'))); });
    document.querySelectorAll('[data-ct-content]').forEach(markContent);
  }
  /* overlays added straight to <body> (modals, menus, chat, focus mode…) are content unless marked shell/localized */
  function observe() {
    if (typeof MutationObserver === 'undefined' || !document.body) return;
    new MutationObserver((recs) => recs.forEach((r) => r.addedNodes.forEach((n) => {
      if (n.nodeType !== 1 || n.tagName === 'SCRIPT' || n.hasAttribute('data-ct-shell') || n.hasAttribute('data-ct-localized') || n.hasAttribute('data-ct-content')) return;
      markContent(n);
    }))).observe(document.body, { childList: true });
  }

  /* ---------- public API ---------- */
  const listeners = [];
  const I = {
    KEY,
    LANGS,
    pick,
    t,
    tx,
    lang: () => cur,
    dir: () => dirOf(cur),
    /** Locale for display formatting only (dates/numbers); stored formats never change. */
    locale: () => (cur === 'he' ? 'he-IL' : 'en-GB'),
    /** Attributes for a translated block inside not-yet-translated content: ` lang="en" dir="ltr"`. */
    attrs: () => ` lang="${cur}" dir="${dirOf(cur)}"`,
    /** Marks an element as not-yet-translated content (RTL/Hebrew in English mode). */
    content: (el) => { if (el) markContent(el); return el; },
    /** Marks an element as translated UI in the current language. Its lang/dir are fixed now, so a dialog that is
     * open while the language changes keeps reading correctly in the language it was written in. */
    localized: (el) => { if (el) { el.setAttribute('data-ct-localized', ''); el.setAttribute('lang', cur); el.setAttribute('dir', dirOf(cur)); } return el; },
    /** Switch the interface language. UI only: no store commit, no cloud push. Returns true when it changed. */
    setLang: (l) => {
      if (!LANGS.includes(l)) return false;
      save(l);
      if (l === cur) return false;
      cur = l;
      apply();
      listeners.slice().forEach((fn) => { try { fn(cur); } catch (e) { console.error(e); } });
      return true;
    },
    onChange: (fn) => { listeners.push(fn); return () => { const i = listeners.indexOf(fn); if (i >= 0) listeners.splice(i, 1); }; },
    _dicts: DICTS,
  };
  CT.i18n = I;

  /* ---------- boot: decide once, remember the decision (so a first-run English user stays English) ---------- */
  const env = readEnv();
  cur = pick(env);
  if (env.saved !== cur) save(cur);
  apply();
  if (typeof document !== 'undefined') {
    if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', () => { apply(); observe(); });
    else { apply(); observe(); }
  }
})();
