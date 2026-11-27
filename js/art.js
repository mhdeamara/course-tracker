/* art.js — small course emblems, generated locally as inline SVG. No images, no network, no user text inside.
 *
 * The motif follows the subject (keywords in the course name, Hebrew or English): signals → waves, electronics →
 * a circuit, data structures → a tree, probability → a bell curve, physics → an orbit, and so on. A course with no
 * match gets a geometric motif. Small details (mirroring, an accent mark) come from a hash of the course number or
 * id, so the same course always looks the same and two courses with the same subject still differ.
 * Colour comes from CSS (currentColor = the course colour), so themes and dark mode work unchanged. */
(function (CT) {
  'use strict';
  const A = {};

  const hash = (s) => { let h = 2166136261; for (let i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 16777619); } return h >>> 0; };

  // first match wins: more specific subjects first (a "lab" in electronics is a lab)
  const RULES = [
    ['lab', /מעבד|\blab/i],
    ['logic', /אימות|לוגיק|ספרתי|verif|formal|digital|logic/i],
    ['power', /הספק|אנרגי|מכונות|power|energy/i],
    ['wave', /אותות|תקשורת|(?<!מע)גלים|signal|communic|wave/i], // "מעגלים" (circuits) contains "גלים" (waves)
    ['circuit', /מעגל|אלקטרונ|התקנ|מוליכ|circuit|electron|vlsi|device/i],
    ['tree', /נתונים|אלגוריתמ|מבני|תכנות|מחשב|data\s*struct|algorithm|program|comput/i],
    ['dist', /הסתבר|סטטיסט|הערכה|אקראי|probab|statist|estimat|random/i],
    ['orbit', /פיזיק|קוונט|מצב מוצק|physic|quantum/i],
    ['matrix', /אלגברה|לינארי|ליניארי|מטריצ|algebra|linear|matri/i],
    ['integral', /חדו|חשבון|אינפי|משוואות|אנליזה|calculus|differential|analysis/i],
  ];
  const GENERIC = ['facets', 'grid', 'rings'];

  /** Which motif a course gets (exported for tests and for anyone who wants to label it). */
  A.motif = (c) => {
    const name = String((c && c.name) || '');
    const r = RULES.find(([, re]) => re.test(name));
    if (r) return r[0];
    return GENERIC[hash(String((c && (c.number || c.id)) || name)) % GENERIC.length];
  };

  const P = {
    wave: () => '<path d="M6 30c5-10 10-10 15 0s10 10 15 0 10-10 15 0 8 8 8 8" class="a-s"/><path d="M6 42c5-6 10-6 15 0s10 6 15 0 10-6 15 0" class="a-s a-soft"/><circle cx="48" cy="16" r="5" class="a-f a-soft"/>',
    circuit: () => '<path d="M6 22h14l4-6 6 12 6-12 4 6h18" class="a-s"/><path d="M14 22v22h36V22M32 44v12" class="a-s a-soft"/><circle cx="14" cy="44" r="3" class="a-f"/><circle cx="50" cy="44" r="3" class="a-f"/><rect x="26" y="40" width="12" height="8" rx="2" class="a-f a-soft"/>',
    tree: () => '<path d="M32 14L18 32M32 14l14 18M18 32l-7 16M18 32l7 16M46 32l7 16" class="a-s a-soft"/><circle cx="32" cy="14" r="5" class="a-f"/><circle cx="18" cy="32" r="4.5" class="a-f"/><circle cx="46" cy="32" r="4.5" class="a-f"/><circle cx="11" cy="48" r="3.5" class="a-f a-soft"/><circle cx="25" cy="48" r="3.5" class="a-f a-soft"/><circle cx="53" cy="48" r="3.5" class="a-f a-soft"/>',
    dist: () => '<path d="M6 50c10 0 14-32 26-32s16 32 26 32" class="a-f a-faint"/><path d="M6 50c10 0 14-32 26-32s16 32 26 32" class="a-s"/><path d="M32 18v32" class="a-s a-dash"/><rect x="12" y="44" width="5" height="6" rx="1" class="a-f a-soft"/><rect x="45" y="40" width="5" height="10" rx="1" class="a-f a-soft"/>',
    orbit: () => '<ellipse cx="32" cy="32" rx="24" ry="9" class="a-s a-soft"/><ellipse cx="32" cy="32" rx="24" ry="9" transform="rotate(60 32 32)" class="a-s a-soft"/><ellipse cx="32" cy="32" rx="24" ry="9" transform="rotate(-60 32 32)" class="a-s a-soft"/><circle cx="32" cy="32" r="5" class="a-f"/><circle cx="54" cy="29" r="2.6" class="a-f"/>',
    matrix: () => '<path d="M14 12h-4v40h4M50 12h4v40h-4" class="a-s"/>' + [0, 1, 2].map((r) => [0, 1, 2].map((q) => `<circle cx="${20 + q * 12}" cy="${20 + r * 12}" r="${r === q ? 3.6 : 2.4}" class="a-f${r === q ? '' : ' a-soft'}"/>`).join('')).join(''),
    integral: () => '<path d="M10 52h46M14 56V8" class="a-s a-soft"/><path d="M14 46c8 0 10-26 20-26s12 18 20 18" class="a-s"/><path d="M22 52V39M28 52V27M34 52V21M40 52V24" class="a-s a-faint-s"/>',
    lab: () => '<rect x="8" y="12" width="48" height="34" rx="6" class="a-s"/><path d="M14 33l6-8 6 12 6-16 6 10 6-4 6 4" class="a-s"/><path d="M24 54h16M32 46v8" class="a-s a-soft"/>',
    logic: () => '<path d="M14 16h14a16 16 0 010 32H14z" class="a-s"/><path d="M4 24h10M4 40h10M44 32h14" class="a-s a-soft"/><path d="M50 26l6 6-6 6" class="a-s"/><circle cx="24" cy="32" r="3" class="a-f a-soft"/>',
    power: () => '<path d="M36 6L18 34h12l-4 24 20-30H34z" class="a-f a-soft"/><path d="M36 6L18 34h12l-4 24 20-30H34z" class="a-s"/>',
    facets: () => '<path d="M32 8l22 14v20L32 56 10 42V22z" class="a-s"/><path d="M32 8v48M10 22l44 20M54 22L10 42" class="a-s a-faint-s"/><circle cx="32" cy="32" r="4" class="a-f"/>',
    grid: () => [0, 1, 2, 3].map((r) => [0, 1, 2, 3].map((q) => `<rect x="${10 + q * 12}" y="${10 + r * 12}" width="8" height="8" rx="2" class="a-f${(r + q) % 3 ? ' a-faint' : ''}"/>`).join('')).join(''),
    rings: () => '<circle cx="26" cy="30" r="16" class="a-s"/><circle cx="40" cy="36" r="12" class="a-s a-soft"/><circle cx="40" cy="36" r="3.5" class="a-f"/>',
  };

  /**
   * The emblem for a course as an inline SVG string (decorative: aria-hidden). Same course → same SVG.
   * Only the motif name and numbers derived from the hash go into the markup; nothing typed by the user.
   */
  A.svg = (c) => {
    const m = A.motif(c);
    const h = hash(String((c && (c.number || c.id || c.name)) || ''));
    const flip = h & 1 ? ' transform="translate(64 0) scale(-1 1)"' : '';
    const dot = (h >>> 1) % 4; // a small accent mark in one of the corners
    const dx = dot & 1 ? 54 : 10, dy = dot & 2 ? 54 : 10;
    return `<svg class="c-art" viewBox="0 0 64 64" aria-hidden="true" focusable="false" data-motif="${m}">` +
      `<g${flip}>${P[m]()}</g><circle cx="${dx}" cy="${dy}" r="1.8" class="a-f a-soft"/></svg>`;
  };

  CT.art = A;
})(window.CT = window.CT || {});
