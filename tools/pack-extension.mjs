// pack-extension.mjs — a clean ZIP of the Chrome extension, to share without the Web Store.
//   node tools/pack-extension.mjs [output.zip]
// Packs only what is committed in git under extension/ (git archive), so nothing stray or local gets in.
// Stops if: the shared modules in extension/lib differ from js/, extension/ has uncommitted changes, or a
// secret / key / the site's own Supabase project shows up in any packed file.
import { execFileSync } from 'node:child_process';
import { mkdirSync } from 'node:fs';
import { join, dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const git = (...a) => execFileSync('git', a, { cwd: root, encoding: 'utf8' });
const fail = (m) => { console.error('✖ ' + m); process.exit(1); };

execFileSync(process.execPath, [join(root, 'tools', 'ext-sync.mjs'), '--check'], { stdio: 'inherit' });
if (git('status', '--porcelain', '--', 'extension').trim()) fail('extension/ has uncommitted changes — commit first (the ZIP is built from git).');

const files = git('ls-files', '--', 'extension').split('\n').filter(Boolean);
const cfg = git('show', 'HEAD:js/config.js');
const own = [/supabaseUrl:\s*'([^']+)'/.exec(cfg), /supabaseKey:\s*'([^']+)'/.exec(cfg)].filter(Boolean).map((m) => m[1]).filter(Boolean);
const bad = [
  [/sb_secret_[A-Za-z0-9]/, 'Supabase secret key'],
  [/eyJ[A-Za-z0-9_-]{20,}\.[A-Za-z0-9_-]{20,}\./, 'JWT'],
  [/sk-ant-|ghp_[A-Za-z0-9]{20}|AIza[0-9A-Za-z_-]{20}|xox[bp]-/, 'API key'],
  [/-----BEGIN [A-Z ]*PRIVATE KEY-----/, 'private key'],
  [/export_execute\.php|authtoken=/i, 'iCal link'],
];
for (const f of files) {
  if (!/\.(js|json|html|css|md|txt)$/.test(f)) continue;
  const t = git('show', `HEAD:${f}`);
  for (const [re, what] of bad) if (re.test(t)) fail(`${f}: looks like a ${what}`);
  for (const s of own) if (t.includes(s)) fail(`${f}: contains the site's own Supabase project — it belongs in the options page, not the code`);
}

const version = JSON.parse(git('show', 'HEAD:extension/manifest.json')).version;
const out = resolve(process.argv[2] || join(root, 'dist', `course-tracker-extension-${version}.zip`));
mkdirSync(dirname(out), { recursive: true });
git('archive', '--format=zip', '--prefix=course-tracker-extension/', '-o', out, 'HEAD:extension');
console.log(`✓ ${files.length} files checked, no secrets → ${out}`);
