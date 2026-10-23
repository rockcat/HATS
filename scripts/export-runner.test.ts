// ── That the public repo stays public, and the private one stays private ─────
//
// The split is only as good as the allowlist, and an allowlist decays the
// moment somebody adds a file. These are the two ways it decays:
//
//   * A new private path is imported by the runner, so the public repo no
//     longer builds on its own.
//   * A path that should be public is left off the list, so the public repo
//     is missing something it needs.
//
// Both fail here rather than in a clone of the published repo.

import { describe, it, expect } from 'vitest';
import { execFileSync } from 'child_process';
import { readFileSync } from 'fs';
import * as path from 'path';
// @ts-expect-error - plain JS module
import { isPublic, privatePaths, readAllowlist } from './export-runner.mjs';

const ROOT = path.resolve(import.meta.dirname, '..');
const allowlist: string[] = readAllowlist(path.join(ROOT, 'docs', 'runner-public-paths.txt'));

const tracked = () => execFileSync('git', ['ls-files'], {
  cwd: ROOT, encoding: 'utf8', maxBuffer: 1024 * 1024 * 64,
}).trim().split('\n');

describe('reading the allowlist', () => {
  it('ignores comments and blank lines', () => {
    expect(allowlist.every((entry) => entry && !entry.startsWith('#'))).toBe(true);
  });

  it('lists the runner and its dashboard', () => {
    expect(allowlist).toContain('server/');
    expect(allowlist).toContain('apps/web/');
  });

  it('lists the API contract, which is the point of publishing at all', () => {
    expect(allowlist).toContain('packages/contracts/');
  });
});

describe('deciding what is published', () => {
  it('takes a trailing slash to mean the whole subtree', () => {
    expect(isPublic('server/src/team-runner.ts', ['server/'])).toBe(true);
    expect(isPublic('server/src/deep/nested/file.ts', ['server/'])).toBe(true);
  });

  it('matches a file entry exactly', () => {
    expect(isPublic('package.json', ['package.json'])).toBe(true);
    expect(isPublic('apps/companion/package.json', ['package.json'])).toBe(false);
  });

  it('does not let a prefix leak a sibling directory', () => {
    // "apps/web" without the slash would publish apps/web-admin too.
    expect(isPublic('apps/web-private/secret.ts', ['apps/web/'])).toBe(false);
  });

  it('withholds anything not named', () => {
    // The safe direction. A file wrongly withheld is an inconvenience; a file
    // wrongly published cannot be unpublished.
    expect(isPublic('apps/companion/public/app.js', allowlist)).toBe(false);
    expect(isPublic('apps/poppyinyourpocket/lib/main.dart', allowlist)).toBe(false);
    expect(isPublic('some/file/nobody/thought/about.ts', allowlist)).toBe(false);
  });
});

describe('the products stay private', () => {
  const mustBePrivate = [
    'apps/companion/', 'apps/poppyinyourpocket/', 'apps/project-view/',
    'apps/agent-library/', 'apps/project-server/', 'apps/project-designer/',
    'apps/speech-service/', 'apps/embodiment-test/', 'apps/flutter/',
    'apps/electron/', 'apps/admin/', 'packages/ui-kit/',
  ];

  for (const prefix of mustBePrivate) {
    it(`withholds ${prefix}`, () => {
      const published = tracked().filter((f) => f.startsWith(prefix) && isPublic(f, allowlist));
      expect(published).toEqual([]);
    });
  }

  it('withholds the runtime data of real projects', () => {
    const published = tracked()
      .filter((f) => f.startsWith('runtime_data/projects/') || f.startsWith('runtime_data/outputs/'))
      .filter((f) => isPublic(f, allowlist));
    expect(published).toEqual([]);
  });

  it('never publishes a credential file', () => {
    const published = tracked()
      .filter((f) => /google-tokens|google-agent-tokens|users\.json|^\.env$/.test(f))
      .filter((f) => isPublic(f, allowlist));
    expect(published).toEqual([]);
  });
});

describe('the public repo is self-contained', () => {
  /** Every relative import in a file, resolved against the repo root. */
  function importsOf(file: string): string[] {
    const source = readFileSync(path.join(ROOT, file), 'utf8');
    const found: string[] = [];
    for (const match of source.matchAll(/(?:from\s+['"]|import\(['"])(\.[^'"]+)['"]/g)) {
      const resolved = path.relative(ROOT, path.resolve(path.dirname(path.join(ROOT, file)), match[1]!))
        .split(path.sep).join('/');
      found.push(resolved);
    }
    return found;
  }

  it('has no published file importing a withheld one', () => {
    // The failure this catches: somebody adds `import … from
    // '../../apps/companion/…'` to the runner, and the public repo stops
    // building for everybody who clones it.
    const published = tracked().filter((f) => isPublic(f, allowlist) && /\.(ts|js|mjs)$/.test(f));

    const broken: string[] = [];
    for (const file of published) {
      for (const target of importsOf(file)) {
        // Written as .js, on disk as .ts.
        const candidates = [target, target.replace(/\.js$/, '.ts'), `${target}.ts`, `${target}/index.ts`];
        if (candidates.some((c) => isPublic(c, allowlist))) continue;
        // Only complain about something that actually exists and is tracked.
        if (!candidates.some((c) => tracked().includes(c))) continue;
        broken.push(`${file} → ${target}`);
      }
    }

    expect(broken).toEqual([]);
  });
});
