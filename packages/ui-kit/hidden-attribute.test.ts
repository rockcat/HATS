/**
 * `hidden` must actually hide.
 *
 * The browser's own rule is `[hidden] { display: none }` — an attribute
 * selector, so exactly the same specificity as a class selector. An author
 * stylesheet wins that tie. So a perfectly ordinary rule like
 *
 *     .chooser { display: grid; }
 *
 * silently defeats `hidden` on every `.chooser`, and the element stays on
 * screen while the code that set `hidden = true` believes it is gone.
 *
 * It shipped exactly once and cost an afternoon: the Companion's agent picker
 * stayed painted over the conversation it had just opened, so choosing an
 * agent looked like a dead button. The handler was running the whole time.
 *
 * Nothing compiles CSS, so this checks the thing mechanically: for every
 * element that starts `hidden` in a page, no stylesheet beside it may set
 * `display` on one of that element's classes without a `[hidden]` guard.
 */

import { describe, it, expect } from 'vitest';
import { readFileSync, readdirSync, statSync } from 'fs';
import { join } from 'path';

/** Every public/ directory that has both a page and a stylesheet. */
function appDirs(root: string): string[] {
  const found: string[] = [];
  const walk = (dir: string, depth = 0) => {
    if (depth > 3) return;
    for (const name of readdirSync(dir)) {
      if (name === 'node_modules' || name.startsWith('.')) continue;
      const path = join(dir, name);
      if (!statSync(path).isDirectory()) continue;
      const files = readdirSync(path);
      if (files.some((f) => f.endsWith('.html')) && files.some((f) => f.endsWith('.css'))) {
        found.push(path);
      }
      walk(path, depth + 1);
    }
  };
  walk(root);
  return found;
}

/** Classes on elements that carry a bare `hidden` attribute. */
function hiddenClasses(html: string): Set<string> {
  const classes = new Set<string>();
  for (const tag of html.match(/<[a-z]+\b[^>]*>/gi) ?? []) {
    if (!/\shidden(\s|>|$)/i.test(tag)) continue;
    const classAttr = /\sclass="([^"]*)"/i.exec(tag)?.[1] ?? '';
    for (const name of classAttr.split(/\s+/).filter(Boolean)) classes.add(name);
  }
  return classes;
}

/**
 * Does this stylesheet neutralise `hidden` for everything?
 *
 * It needs `!important`: without it the rule merely ties with a class
 * selector and the later one wins, which is the whole problem.
 */
const hasGuard = (css: string) =>
  /\[hidden\]\s*\{[^}]*display\s*:\s*none\s*!important/.test(css);

/**
 * Classes guarded one at a time, as `.login-overlay[hidden] { display: none }`.
 *
 * Equally correct and more surgical than the blanket rule — class plus
 * attribute outranks class alone, so no `!important` is needed. The dashboard
 * does it this way throughout, and a check that did not recognise it would
 * report thirteen faults in code that works.
 */
export function guardedClasses(css: string): Set<string> {
  const guarded = new Set<string>();
  for (const match of css.matchAll(/([^{}]+)\{([^}]*)\}/g)) {
    const selector = match[1] ?? '';
    if (!selector.includes('[hidden]')) continue;
    if (!/display\s*:\s*none/.test(match[2] ?? '')) continue;
    for (const name of selector.match(/\.[A-Za-z][\w-]*(?=\[hidden\])/g) ?? []) {
      guarded.add(name.slice(1));
    }
  }
  return guarded;
}

/** Classes this stylesheet gives a `display` to, ignoring guarded rules. */
function classesGivenDisplay(css: string): Set<string> {
  const given = new Set<string>();
  // Each rule: everything up to `{`, then the body.
  for (const match of css.matchAll(/([^{}]+)\{([^}]*)\}/g)) {
    const selector = match[1] ?? '';
    const body = match[2] ?? '';
    if (!/(^|[\s;])display\s*:/.test(body)) continue;
    if (/display\s*:\s*none/.test(body)) continue;   // hiding is never the bug
    if (selector.includes('[hidden]') || selector.includes(':not([hidden])')) continue;

    for (const name of selector.match(/\.[A-Za-z][\w-]*/g) ?? []) given.add(name.slice(1));
  }
  return given;
}

describe('an element that starts hidden really is hidden', () => {
  const dirs = appDirs('apps');

  it('finds the pages to check', () => {
    expect(dirs.length).toBeGreaterThan(0);
  });

  it('no stylesheet gives a display to a class used with hidden', () => {
    const problems: string[] = [];

    for (const dir of dirs) {
      const files = readdirSync(dir);
      const html = files.filter((f) => f.endsWith('.html'))
        .map((f) => readFileSync(join(dir, f), 'utf8')).join('\n');
      const needed = hiddenClasses(html);
      if (needed.size === 0) continue;

      for (const sheet of files.filter((f) => f.endsWith('.css'))) {
        const css = readFileSync(join(dir, sheet), 'utf8');
        if (hasGuard(css)) continue;
        const guarded = guardedClasses(css);

        for (const name of classesGivenDisplay(css)) {
          if (!needed.has(name) || guarded.has(name)) continue;
          problems.push(
            `${join(dir, sheet)}: .${name} sets display, but an element with that `
            + 'class starts hidden — the attribute will do nothing. Add '
            + '`[hidden] { display: none !important; }`.',
          );
        }
      }
    }

    expect(problems).toEqual([]);
  });
});

describe('the check itself', () => {
  it('spots a class that defeats hidden', () => {
    expect(hiddenClasses('<div class="chooser panel" hidden></div>')).toEqual(
      new Set(['chooser', 'panel']),
    );
    expect(classesGivenDisplay('.chooser { display: grid; }')).toEqual(new Set(['chooser']));
  });

  it('is not upset by a rule that hides', () => {
    // `.view { display: none }` is the normal way to do tabs, not a fault.
    expect(classesGivenDisplay('.view { display: none; }')).toEqual(new Set());
  });

  it('accepts a rule written to respect hidden', () => {
    expect(classesGivenDisplay('.chooser:not([hidden]) { display: grid; }')).toEqual(new Set());
  });

  it('recognises the blanket guard', () => {
    expect(hasGuard('[hidden] { display: none !important; }')).toBe(true);
    expect(hasGuard('[hidden] { display: none; }')).toBe(false); // ties again, no good
  });

  it('recognises a per-class guard, which is equally correct', () => {
    // Class plus attribute outranks class alone, so no !important needed.
    expect(guardedClasses('.login-overlay[hidden] { display: none; }'))
      .toEqual(new Set(['login-overlay']));
  });

  it('does not count a per-class rule that fails to hide', () => {
    expect(guardedClasses('.panel[hidden] { opacity: 0.5; }')).toEqual(new Set());
  });

  it('ignores an element that is not hidden', () => {
    expect(hiddenClasses('<div class="chooser"></div>')).toEqual(new Set());
  });

  it('does not mistake a word containing "hidden" for the attribute', () => {
    expect(hiddenClasses('<div class="x" data-unhidden="1"></div>')).toEqual(new Set());
  });
});
