import { describe, it, expect } from 'vitest';
import { existsSync } from 'fs';
import * as path from 'path';
import {
  BUILTIN_PREFIX, builtin, builtinServerCommand, expandBuiltin, isBuiltinMarker,
  repointBuiltinServer, repoRootFrom,
} from './builtin-server.js';
import { resolveConfig } from './mcp-catalogue.js';

const never = () => false;
const always = () => true;

describe('naming one of our own servers', () => {
  it('marks it so it can be told from an npx package', () => {
    expect(builtin('mcp/kanban/server')).toBe(`${BUILTIN_PREFIX}mcp/kanban/server`);
    expect(isBuiltinMarker(builtin('calendar/server'))).toBe(true);
  });

  it('does not mistake an ordinary argument for one', () => {
    expect(isBuiltinMarker('-y')).toBe(false);
    expect(isBuiltinMarker('@modelcontextprotocol/server-memory')).toBe(false);
    expect(isBuiltinMarker(undefined)).toBe(false);
  });
});

describe('deciding how to start it', () => {
  it('uses the compiled file when the checkout has been built', () => {
    const { command, args } = builtinServerCommand('calendar/server', always);

    expect(command).toBe('node');
    expect(args).toHaveLength(1);
    expect(args[0]).toMatch(/server[\\/]dist[\\/]server[\\/]src[\\/]calendar[\\/]server\.js$/);
  });

  it('runs the source through tsx when it has not', () => {
    // The normal case: npm run dev and npm start both run the runner itself
    // from source, so there is no compiled output at all.
    const { command, args } = builtinServerCommand('calendar/server', never);

    expect(command).toBe('node');
    expect(args.slice(0, 2)).toEqual(['--import', 'tsx/esm']);
    expect(args[2]).toMatch(/server[\\/]src[\\/]calendar[\\/]server\.ts$/);
  });

  it('gives an absolute path either way', () => {
    // A relative path is right only when the runner was started from the repo
    // root, and silently wrong the moment anything starts it elsewhere.
    for (const exists of [always, never]) {
      const { args } = builtinServerCommand('calendar/server', exists);
      expect(path.isAbsolute(args[args.length - 1]!)).toBe(true);
    }
  });

  it('points at a file that is really there', () => {
    // The whole bug: the catalogue named dist/mcp/kanban/server.js, which no
    // current build writes, and it worked only because a stale copy from an
    // older layout was still lying around.
    const { args } = builtinServerCommand('diary/server');
    expect(existsSync(args[args.length - 1]!)).toBe(true);
  });

  it('finds the root from inside the compiled output, not dist\'s mirror of it', () => {
    // The Docker image: only server/dist, and dist mirrors the repo, so
    // server/dist has a server/src of its own. Stopping there named
    // server/dist/server/dist/…, and then a .ts file that is not shipped.
    const app = path.resolve('/app');
    const dist = path.join(app, 'server', 'dist');
    const present = new Set([path.join(dist, 'server', 'src'), dist]);
    const here = path.join(dist, 'packages', 'core', 'src', 'mcp');

    expect(repoRootFrom(here, (p) => present.has(p))).toBe(app);
  });

  it('finds the root from the source tree', () => {
    const repo = path.resolve('/repo');
    const present = new Set([path.join(repo, 'server', 'src')]);
    const here = path.join(repo, 'packages', 'core', 'src', 'mcp');

    expect(repoRootFrom(here, (p) => present.has(p))).toBe(repo);
  });

  it('points at a real file for the calendar too', () => {
    const { args } = builtinServerCommand('calendar/server');
    expect(existsSync(args[args.length - 1]!)).toBe(true);
  });
});

describe('expanding the marker in a config', () => {
  it('leaves an ordinary server alone', () => {
    const npx = { command: 'npx', args: ['-y', '@modelcontextprotocol/server-memory'] };
    expect(expandBuiltin(npx)).toBeNull();
  });

  it('leaves a server with no arguments alone', () => {
    expect(expandBuiltin({ command: 'node', args: [] })).toBeNull();
  });

  it('keeps whatever follows the marker', () => {
    // This is how a data file and the project directory reach their server.
    const expanded = expandBuiltin(
      { command: 'node', args: [builtin('calendar/server'), 'calendar.json'] }, always);

    expect(expanded?.args?.[expanded.args.length - 1]).toBe('calendar.json');
  });

  it('puts the appended argument after the tsx flags, not among them', () => {
    const expanded = expandBuiltin(
      { command: 'node', args: [builtin('calendar/server'), 'calendar.json'] }, never);

    expect(expanded?.args?.slice(0, 2)).toEqual(['--import', 'tsx/esm']);
    expect(expanded?.args?.[3]).toBe('calendar.json');
  });
});

describe('through resolveConfig, which is what actually runs', () => {
  it('turns a built-in entry into something runnable', () => {
    const resolved = resolveConfig({
      transport: 'stdio', command: 'node', args: [builtin('calendar/server')],
    });

    expect(resolved.transport).toBe('stdio');
    const args = (resolved as { args: string[] }).args;
    expect(args.some((a) => a.startsWith(BUILTIN_PREFIX))).toBe(false);
    expect(existsSync(args[args.length - 1]!)).toBe(true);
  });

  it('still expands the placeholders an ordinary entry uses', () => {
    const resolved = resolveConfig({
      transport: 'stdio', command: 'npx', args: ['-y', 'server', '{PROJECT_DIR}'],
    }, '/projects/paige');

    expect((resolved as { args: string[] }).args).toContain('/projects/paige');
  });
});

describe('repointing a saved server definition', () => {
  it('rescues a definition written before the build layout moved', () => {
    // A saved definition names whatever path was right on the day. Trusting
    // it means the catalogue can be fixed and the server still start from a
    // stale file, because this path never consults the catalogue at all.
    const saved = { transport: 'stdio', command: 'node', args: ['dist/calendar/server.js'] };
    const fixed = repointBuiltinServer('calendar', saved, '/projects/paige/calendar.json');

    expect(fixed).not.toBeNull();
    expect(fixed!.args.some((a) => a.includes('dist/calendar'))).toBe(false);
    expect(existsSync(fixed!.args[fixed!.args.length - 2] ?? fixed!.args[0]!)
      || existsSync(fixed!.args[0]!)).toBe(true);
  });

  it('puts this project\'s data file on the end', () => {
    const saved = { transport: 'stdio', args: ['dist/calendar/server.js', 'someone-elses.json'] };
    const fixed = repointBuiltinServer('calendar', saved, '/projects/paige/calendar.json');

    expect(fixed!.args[fixed!.args.length - 1]).toBe('/projects/paige/calendar.json');
    expect(fixed!.args).not.toContain('someone-elses.json');
  });

  it('also covers the diary', () => {
    const fixed = repointBuiltinServer('diary', { transport: 'stdio', args: ['old/path.js'] });
    expect(fixed).not.toBeNull();
    expect(fixed!.args.some((a) => a.includes('old/path.js'))).toBe(false);
  });

  it('no longer counts the board as one: it runs inside the runner', () => {
    expect(repointBuiltinServer('kanban', { transport: 'stdio', args: ['dist/mcp/kanban/server.js'] })).toBeNull();
  });

  it('leaves a server that is not ours completely alone', () => {
    // Rewriting someone's brave-search or filesystem entry would be a bug.
    expect(repointBuiltinServer('brave-search', {
      transport: 'stdio', args: ['-y', '@modelcontextprotocol/server-brave-search'],
    })).toBeNull();
  });

  it('leaves an http server alone, built-in name or not', () => {
    expect(repointBuiltinServer('calendar', { transport: 'http' })).toBeNull();
  });
});
