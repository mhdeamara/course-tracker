// Served copies of the app for the browser suites: the working tree, or any commit (e.g. the production one), always
// with an empty CT_CONFIG so the copy has no cloud connection.
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { REPO } from './env.mjs';

export const WORKTREE = 'WORKTREE';

/** Empty `dir` (the folder itself stays, so a server keeps serving it). */
export function clear(dir) {
  fs.mkdirSync(dir, { recursive: true });
  for (const f of fs.readdirSync(dir)) fs.rmSync(path.join(dir, f), { recursive: true, force: true });
}

/** Replace the contents of `dir` with release `rev` (a git revision, or WORKTREE for the current files incl. new ones).
 * `without`: files to leave out, to simulate an incomplete upload. */
export function deploy(dir, rev, { without = [] } = {}) {
  clear(dir);
  if (rev === WORKTREE) {
    const files = execFileSync('git', ['-C', REPO, 'ls-files', '--cached', '--others', '--exclude-standard', '-z'], { maxBuffer: 1 << 26 })
      .toString().split('\0').filter(Boolean);
    for (const f of files) {
      const src = path.join(REPO, f);
      if (!fs.existsSync(src)) continue; // deleted in the working tree
      fs.mkdirSync(path.dirname(path.join(dir, f)), { recursive: true });
      fs.copyFileSync(src, path.join(dir, f));
    }
  } else {
    const tar = execFileSync('git', ['-C', REPO, 'archive', '--format=tar', rev], { maxBuffer: 1 << 28 });
    execFileSync('tar', ['-xf', '-'], { input: tar, cwd: dir }); // cwd, not -C: GNU tar reads "C:..." as a remote host
  }
  fs.writeFileSync(path.join(dir, 'js', 'config.js'), 'window.CT_CONFIG = {};\n'); // cloud off
  without.forEach((f) => fs.rmSync(path.join(dir, f), { force: true }));
}
