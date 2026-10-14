// ── Starting an MCP server that lives in this repo ────────────────────────────
//
// Two of them do: the kanban board and the calendar. Unlike every other entry
// in the catalogue they are not fetched with npx — they are our own code, and
// how to run it depends on how this process was started.
//
// The runner itself runs from TypeScript source through tsx (`npm run dev`
// and `npm start` both do), so in normal use there is no compiled output at
// all. A packaged build is the other way round: compiled output, and tsx may
// not be installed. Pointing a catalogue entry at one of those and hoping is
// what went wrong before — kanban named `dist/mcp/kanban/server.js`, a path no
// current build writes, and it kept working only because a stale copy from an
// older layout happened to still be sitting there. The next person to clean
// `dist/` would have found the board gone with no obvious reason.
//
// So the path is decided when the server is started, not written down: the
// compiled file if it is there, the source through tsx if it is not.

import { existsSync } from 'fs';
import * as path from 'path';
import { fileURLToPath } from 'url';

/** Marks a catalogue entry as one of ours. Followed by a path under server/src. */
export const BUILTIN_PREFIX = 'builtin:';

/** Name a built-in server for the catalogue, e.g. builtin('mcp/kanban/server'). */
export const builtin = (modulePath: string): string => BUILTIN_PREFIX + modulePath;

export const isBuiltinMarker = (value: unknown): value is string =>
  typeof value === 'string' && value.startsWith(BUILTIN_PREFIX);

/**
 * The directory that holds `server/`, found by walking up from this module.
 *
 * Not `process.cwd()`: that is right when the runner is started from the repo
 * root and silently wrong the moment anything starts it elsewhere — a failure
 * that only shows up on someone else's machine.
 *
 * And not "the first package.json above here" either, which is the obvious
 * version and is wrong: `server/` has a package.json of its own, so the walk
 * stopped one level too early and produced `…/server/server/src/…`. The thing
 * being looked for is a directory containing `server`, so that is what the
 * walk looks for.
 */
function repoRoot(): string {
  let dir = path.dirname(fileURLToPath(import.meta.url));
  for (let up = 0; up < 12; up++) {
    if (existsSync(path.join(dir, 'server', 'src')) || existsSync(path.join(dir, 'server', 'dist'))) {
      return dir;
    }
    const parent = path.dirname(dir);
    if (parent === dir) break;
    dir = parent;
  }
  return process.cwd();
}

/**
 * How to run one of our own MCP servers.
 *
 * @param modulePath  path under `server/src`, without an extension,
 *                    e.g. `mcp/kanban/server`
 */
export function builtinServerCommand(
  modulePath: string, exists: (p: string) => boolean = existsSync,
): { command: string; args: string[] } {
  const root = repoRoot();
  const compiled = path.join(root, 'server', 'dist', 'server', 'src', `${modulePath}.js`);
  if (exists(compiled)) return { command: 'node', args: [compiled] };

  // No build: run the source. tsx is a dependency of this repo, so it is there
  // whenever the source is.
  return {
    command: 'node',
    args: ['--import', 'tsx/esm', path.join(root, 'server', 'src', `${modulePath}.ts`)],
  };
}

/**
 * Expand a `builtin:` marker into a real command.
 *
 * Anything after the marker in `args` is kept and appended — that is how the
 * kanban board file and the project directory reach their servers.
 */
export function expandBuiltin(
  config: { command?: string; args?: string[] },
  exists?: (p: string) => boolean,
): { command?: string; args?: string[] } | null {
  const marker = config.args?.[0];
  if (!isBuiltinMarker(marker)) return null;

  const { command, args } = builtinServerCommand(marker.slice(BUILTIN_PREFIX.length), exists);
  return { ...config, command, args: [...args, ...(config.args ?? []).slice(1)] };
}
