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
 *
 * Compiled, this module sits at `<root>/server/dist/packages/core/src/mcp`, and
 * dist mirrors the repo — so `server/dist` holds a `server/src` of its own, full
 * of .js, and the walk stopped there. The image only has `server/dist`, so the
 * fallback then named `server/dist/server/src/….ts`, which exists nowhere. The
 * walk starts above dist instead.
 */
export function repoRootFrom(here: string, exists: (p: string) => boolean = existsSync): string {
  const dist = here.lastIndexOf(`${path.sep}server${path.sep}dist${path.sep}`);
  let dir = dist >= 0 ? here.slice(0, dist) : here;
  for (let up = 0; up < 12; up++) {
    if (exists(path.join(dir, 'server', 'src')) || exists(path.join(dir, 'server', 'dist'))) {
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
  const root = repoRootFrom(path.dirname(fileURLToPath(import.meta.url)));
  const compiled = path.join(root, 'server', 'dist', 'server', 'src', `${modulePath}.js`);
  if (exists(compiled)) return { command: 'node', args: [compiled] };

  // No build: run the source. tsx is a dependency of this repo, so it is there
  // whenever the source is.
  return {
    command: 'node',
    args: ['--import', 'tsx/esm', path.join(root, 'server', 'src', `${modulePath}.ts`)],
  };
}

/** Servers that live in this repo, by the name a saved definition calls them. */
const BUILTIN_BY_NAME: Record<string, string> = {
  kanban: 'mcp/kanban/server',
  calendar: 'calendar/server',
};

/**
 * Repoint a saved server definition at the built-in it names.
 *
 * A project definition or a saved state carries whatever path was right on the
 * day it was written, and ours move: a definition saved before the build
 * layout changed still names `dist/mcp/kanban/server.js`. Trusting it means
 * the catalogue can be fixed and the board still start from a stale file,
 * because this path never consults the catalogue at all.
 *
 * `dataPath` replaces any file argument that was saved with it — a board path
 * from somebody else's checkout is no use here.
 *
 * Returns null when this is not one of ours, leaving the definition alone.
 */
export function repointBuiltinServer(
  name: string,
  config: { transport?: string; args?: string[] },
  dataPath?: string,
): { command: string; args: string[] } | null {
  const modulePath = BUILTIN_BY_NAME[name];
  if (!modulePath || config.transport !== 'stdio') return null;

  const { command, args } = builtinServerCommand(modulePath);
  const kept = dataPath
    ? [dataPath]
    : (config.args ?? []).filter((a) => a.endsWith('.json') && !isBuiltinMarker(a));
  return { command, args: [...args, ...kept] };
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
