// ext-sync.mjs — copy the site's pure modules into the extension (it can't load files outside its folder).
//   node tools/ext-sync.mjs          → copy
//   node tools/ext-sync.mjs --check  → exit 1 if a copy differs (tests and the pack script use this)
import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
export const SHARED = ['utils.js', 'game.js', 'stats.js', 'adhkar.js', 'ext-snapshot.js'];
const check = process.argv.includes('--check');
let bad = 0;
for (const f of SHARED) {
  const src = readFileSync(join(root, 'js', f));
  const dst = join(root, 'extension', 'lib', f);
  const same = existsSync(dst) && Buffer.compare(src, readFileSync(dst)) === 0;
  if (same) continue;
  if (check) { console.error(`extension/lib/${f} differs from js/${f} — run: node tools/ext-sync.mjs`); bad++; }
  else { writeFileSync(dst, src); console.log(`copied js/${f} → extension/lib/${f}`); }
}
if (bad) process.exit(1);
if (check) console.log('extension/lib is in sync');
