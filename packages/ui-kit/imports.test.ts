/**
 * Every browser module must import the ui-kit helpers it calls.
 *
 * Nothing compiles these: a missing import is a ReferenceError the first time
 * that line runs, which in a UI can be days later. It has already happened
 * once — a patch script wrote `$$` into a String.replace replacement, where it
 * is the escape for a literal `$`, and shipped an editor that could not load a
 * template.
 */

import { describe, it, expect } from 'vitest';
import { readFileSync, readdirSync, statSync } from 'fs';
import { join } from 'path';

const HELPERS = [
  '$$', '$', 'el', 'clear', 'hatDots', 'guard', 'toastOk', 'toastError',
  'makeClient', 'debounce', 'trackHealth', 'relativeTime',
];

function browserModules(dir: string, out: string[] = []): string[] {
  for (const name of readdirSync(dir)) {
    if (name === 'node_modules' || name.startsWith('.')) continue;
    const path = join(dir, name);
    if (statSync(path).isDirectory()) browserModules(path, out);
    else if (name.endsWith('.js')) out.push(path);
  }
  return out;
}

/** Which helpers a module pulls in from the ui-kit. */
function imported(source: string): Set<string> {
  const names = new Set<string>();
  for (const match of source.matchAll(/import\s*\{([^}]*)\}\s*from\s*'\/ui-kit\/hats-ui\.js'/g)) {
    for (const part of match[1]!.split(',')) {
      const name = part.trim().split(/\s+as\s+/)[0];
      if (name) names.add(name);
    }
  }
  return names;
}

/** Which helpers it calls, ignoring the import lines themselves. */
function called(source: string): Set<string> {
  const body = source.replace(/import\s*\{[^}]*\}\s*from\s*'[^']*';/g, '');
  const names = new Set<string>();
  for (const helper of HELPERS) {
    const pattern = helper === '$' ? /(?<![\w$])\$\(/
      : helper === '$$' ? /(?<![\w$])\$\$\(/
      : new RegExp(`(?<![\\w$.])${helper}\\(`);
    if (pattern.test(body)) names.add(helper);
  }
  return names;
}

describe('ui-kit helper imports', () => {
  const files = [...browserModules('apps'), ...browserModules('packages')]
    .filter((f) => readFileSync(f, 'utf8').includes("from '/ui-kit/hats-ui.js'"));

  it('finds the front-ends to check', () => {
    expect(files.length).toBeGreaterThan(0);
  });

  it('every helper a module calls is one it imports', () => {
    const missing: string[] = [];
    for (const file of files) {
      const source = readFileSync(file, 'utf8');
      const have = imported(source);
      for (const helper of called(source)) {
        if (!have.has(helper)) missing.push(`${file}: calls ${helper}() but does not import it`);
      }
    }
    expect(missing).toEqual([]);
  });
});
