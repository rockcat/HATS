#!/usr/bin/env node
/**
 * Release the version in package.json.
 *
 *   npm run release              tag v<version>, push it, make a GitHub release
 *   npm run release -- --dry-run check everything, change nothing
 *
 * Bump the version first if it has not been already, e.g. `npm version minor
 * --no-git-tag-version`, and commit it. This releases whatever package.json says.
 *
 * Pushing the tag is the release: .github/workflows/docker.yml builds the
 * images for a v* tag and publishes them as :<version> and :<major.minor>,
 * which installations pin with HATS_VERSION in their .env.
 */

import { spawnSync } from 'child_process';
import { readFileSync } from 'fs';
import * as path from 'path';
import { fileURLToPath } from 'url';

const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const BRANCH = 'main';
const REMOTE = 'origin';
const DRY_RUN = process.argv.includes('--dry-run');

/** Run a command in the repo root. Returns its trimmed stdout; throws on failure unless `allowFail`. */
function run(cmd, args, { allowFail = false, inherit = false } = {}) {
  const result = spawnSync(cmd, args, {
    cwd: REPO_ROOT,
    encoding: 'utf-8',
    stdio: inherit ? 'inherit' : 'pipe',
    // npm and npx are .cmd files on Windows, which need a shell to start.
    shell: process.platform === 'win32' && (cmd === 'npm' || cmd === 'npx'),
  });
  if (result.error && !allowFail) throw result.error;
  if (result.status !== 0 && !allowFail) {
    throw new Error(`${cmd} ${args.join(' ')} failed${result.stderr ? `:\n${result.stderr.trim()}` : ''}`);
  }
  return { ok: result.status === 0, out: (result.stdout ?? '').trim() };
}

const git = (...args) => run('git', args).out;

/** A step that changes something: printed, and skipped in a dry run. */
function act(description, cmd, args) {
  console.log(`${DRY_RUN ? '[dry run] would ' : ''}${description}`);
  if (!DRY_RUN) run(cmd, args, { inherit: true });
}

function fail(message) {
  console.error(`\n${message}`);
  process.exit(1);
}

// ── What is being released ──────────────────────────────────────────────────

const { version } = JSON.parse(readFileSync(path.join(REPO_ROOT, 'package.json'), 'utf-8'));
if (!/^\d+\.\d+\.\d+$/.test(version ?? '')) fail(`package.json version "${version}" is not of the form 1.2.3.`);
const tag = `v${version}`;
console.log(`Releasing ${tag}${DRY_RUN ? ' (dry run)' : ''}\n`);

// ── Checks ──────────────────────────────────────────────────────────────────

const branch = git('rev-parse', '--abbrev-ref', 'HEAD');
if (branch !== BRANCH) fail(`On "${branch}". Releases are made from ${BRANCH}.`);

if (git('status', '--porcelain')) fail('There are uncommitted changes. Commit or stash them first.');

git('fetch', REMOTE, BRANCH, '--tags');
const behind = Number(git('rev-list', '--count', `HEAD..${REMOTE}/${BRANCH}`));
if (behind > 0) fail(`${BRANCH} is ${behind} commit(s) behind ${REMOTE}. Pull first.`);
const ahead = Number(git('rev-list', '--count', `${REMOTE}/${BRANCH}..HEAD`));

if (run('git', ['rev-parse', '-q', '--verify', `refs/tags/${tag}`], { allowFail: true }).ok) {
  fail(`${tag} already exists. Bump the version in package.json first, e.g.:\n  npm version patch --no-git-tag-version`);
}
console.log(`✓ on ${BRANCH}, clean, ${ahead} commit(s) to push, ${tag} is new`);

console.log('\nRunning the tests…');
if (!run('npx', ['vitest', 'run'], { allowFail: true, inherit: true }).ok) fail('Tests failed. Nothing was released.');
console.log('✓ tests pass\n');

// ── Release ─────────────────────────────────────────────────────────────────

if (ahead > 0) act(`push ${ahead} commit(s) to ${REMOTE}/${BRANCH}`, 'git', ['push', REMOTE, BRANCH]);
act(`tag ${tag}`, 'git', ['tag', '-a', tag, '-m', `HATS ${version}`]);
act(`push ${tag}, which builds and publishes the images`, 'git', ['push', REMOTE, tag]);

// The GitHub release is a page of notes; the tag above is what matters, so
// a missing or signed-out gh only means doing this by hand.
if (run('gh', ['auth', 'status'], { allowFail: true }).ok) {
  act(`create the GitHub release ${tag} with generated notes`, 'gh', ['release', 'create', tag, '--title', `HATS ${version}`, '--generate-notes', '--verify-tag']);
} else {
  console.log(`gh is not installed or not signed in: create the GitHub release for ${tag} by hand if you want one.`);
}

console.log(DRY_RUN
  ? `\nDry run finished. Run without --dry-run to release ${tag}.`
  : `\nReleased ${tag}. The images build in GitHub Actions; installations get them with HATS_VERSION=${version}.`);
