// ── Building the public runner repo ──────────────────────────────────────────
//
// This repository is private and holds everything. The runner is published
// from it as a separate, public repository containing only the paths listed
// in docs/runner-public-paths.txt.
//
// An allowlist, and deliberately so. A blocklist publishes anything nobody
// remembered to exclude, and the cost of the two mistakes is not symmetric: a
// file wrongly withheld is an inconvenience, a file wrongly published cannot
// be unpublished.
//
// History is rewritten rather than squashed, so the public repo carries the
// real commit history of the files it contains — but only of those files.
// Commits that touched nothing public are dropped.
//
//   node scripts/export-runner.mjs --out ../hats-runner
//   node scripts/export-runner.mjs --out ../hats-runner --no-history
//
// Nothing is pushed. The script prints the remote commands and stops: adding
// a remote and pushing is a decision about a public repository, and it is not
// one a script should make on anybody's behalf.

import { execFileSync, execSync } from 'child_process';
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'fs';
import * as path from 'path';

const toPosix = (p) => p.split(path.sep).join('/');

const HERE = path.resolve(path.dirname(new URL(import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, '$1')), '..');
const ALLOWLIST = path.join(HERE, 'docs', 'runner-public-paths.txt');

function parseArgs(argv) {
  const args = { out: null, history: true, force: false };
  for (let i = 0; i < argv.length; i++) {
    if (argv[i] === '--out') args.out = argv[++i];
    else if (argv[i] === '--no-history') args.history = false;
    else if (argv[i] === '--force') args.force = true;
  }
  return args;
}

/** Path prefixes that make up the public repo. */
export function readAllowlist(file = ALLOWLIST) {
  return readFileSync(file, 'utf8')
    .split('\n')
    .map((line) => line.trim())
    .filter((line) => line && !line.startsWith('#'));
}

/** Is this tracked path published? A trailing slash means the whole subtree. */
export function isPublic(file, allowlist) {
  return allowlist.some((entry) => (entry.endsWith('/') ? file.startsWith(entry) : file === entry));
}

/** Every tracked path that is not published. */
export function privatePaths(tracked, allowlist) {
  return tracked.filter((file) => !isPublic(file, allowlist));
}

const git = (args, cwd = HERE) =>
  execFileSync('git', args, { cwd, encoding: 'utf8', maxBuffer: 1024 * 1024 * 256 });

function main() {
  const args = parseArgs(process.argv.slice(2));
  if (!args.out) {
    console.error('Where to?  node scripts/export-runner.mjs --out ../hats-runner');
    process.exit(1);
  }

  const out = path.resolve(args.out);
  if (existsSync(out)) {
    if (!args.force) {
      console.error(`${out} already exists. Pass --force to replace it.`);
      process.exit(1);
    }
    rmSync(out, { recursive: true, force: true });
  }

  // A dirty tree would export a state that is not in any commit, which is
  // exactly the kind of thing nobody can reconstruct afterwards.
  if (git(['status', '--porcelain']).trim()) {
    console.error('Working tree is not clean. Commit or stash first.');
    process.exit(1);
  }

  const allowlist = readAllowlist();
  const tracked = git(['ls-files']).trim().split('\n');
  const withheld = privatePaths(tracked, allowlist);

  console.log(`publishing ${tracked.length - withheld.length} files, withholding ${withheld.length}`);

  mkdirSync(path.dirname(out), { recursive: true });
  console.log(`cloning into ${out} …`);
  git(['clone', '--no-local', '--no-hardlinks', HERE, out], path.dirname(out));

  if (args.history) {
    rewriteHistory(out, allowlist);
  } else {
    flatten(out, withheld);
  }

  // Belt and braces. The filter above is the mechanism; this is the check
  // that it worked, run against what is actually in the result.
  const left = git(['ls-files'], out).trim().split('\n').filter(Boolean);
  const leaked = privatePaths(left, allowlist);
  if (leaked.length) {
    console.error(`\nREFUSING: ${leaked.length} private path(s) survived the filter:`);
    for (const file of leaked.slice(0, 20)) console.error(`   ${file}`);
    process.exit(1);
  }

  console.log(`\n${left.length} files, no private paths present.`);
  console.log(`
Nothing has been pushed. To publish:

   cd ${out}
   git remote add origin git@github.com:<you>/hats-runner.git
   git push --force origin main

Check it first — a push to a public repository is not reversible:

   git -C ${out} ls-files | less
   git -C ${out} log --oneline | head
`);
}

/**
 * One allowlist entry as an anchored regex, regex characters taken literally.
 *
 * Without the escaping, `.gitignore` matches `agitignore` and `package.json`
 * matches `packagexjson` — harmless here, but the same unescaped dot in a
 * future entry is how something unintended gets published.
 */
export function keepPattern(entry) {
  const literal = entry.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  return entry.endsWith('/') ? `^${literal}` : `^${literal}$`;
}

/** Drop every non-public path from every commit, keeping the rest of history. */
function rewriteHistory(out, allowlist) {
  console.log('rewriting history (this takes a few minutes) …');

  // The filter lives in files rather than on the command line. filter-branch
  // evals the index-filter through sh, and a regex full of quotes does not
  // survive that on Windows — the first attempt died inside the eval with an
  // unterminated string, part-way through rewriting.
  const work = path.join(out, '.git', 'hats-export');
  mkdirSync(work, { recursive: true });

  const patterns = path.join(work, 'keep.txt');
  writeFileSync(patterns, `${allowlist.map(keepPattern).join('\n')}\n`);

  // -z the whole way through: a filename may contain a newline, and splitting
  // on one would delete the wrong path from every commit in the history.
  const script = path.join(work, 'filter.sh');
  writeFileSync(script, [
    '#!/bin/sh',
    'git ls-files -z \\',
    `  | grep -z -v -E -f "${toPosix(patterns)}" \\`,
    '  | xargs -0 -r git rm --cached -q --ignore-unmatch --',
    '',
  ].join('\n'));

  // An index-filter rather than a tree-filter: it rewrites the index without
  // checking each commit out, which is the difference between minutes and
  // hours over a few hundred commits.
  execSync(
    `git filter-branch --force --index-filter 'sh "${toPosix(script)}"' --prune-empty -- --all`,
    { cwd: out, stdio: 'inherit', env: { ...process.env, FILTER_BRANCH_SQUELCH_WARNING: '1' } },
  );

  // filter-branch leaves the originals behind; without this the objects stay
  // reachable and the "private" files are still in the pack it would push.
  execSync('git for-each-ref --format="%(refname)" refs/original | xargs -r -n1 git update-ref -d',
    { cwd: out, stdio: 'inherit' });
  execSync('git reflog expire --expire=now --all && git gc --prune=now --aggressive',
    { cwd: out, stdio: 'inherit' });
}

/** One commit, no history. */
function flatten(out, withheld) {
  console.log('flattening to a single commit …');
  for (const file of withheld) {
    try { rmSync(path.join(out, file), { force: true }); } catch { /* already gone */ }
  }
  execSync('git rm -r --cached -q . && git add -A', { cwd: out, stdio: 'pipe' });
  execFileSync('git', ['commit', '-q', '-m', 'HATS runner'], { cwd: out });
}

if (process.argv[1] && import.meta.url.endsWith(path.basename(process.argv[1]))) main();
