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
    const { command, args } = builtinServerCommand('mcp/kanban/server', always);

    expect(command).toBe('node');
    expect(args).toHaveLength(1);
    expect(args[0]).toMatch(/server[\\/]dist[\\/]server[\\/]src[\\/]mcp[\\/]kanban[\\/]server\.js$/);
  });

  it('runs the source through tsx when it has not', () => {
    // The normal case: npm run dev and npm start both run the runner itself
    // from source, so there is no compiled output at all.
    const { command, args } = builtinServerCommand('mcp/kanban/server', never);

    expect(command).toBe('node');
    expect(args.slice(0, 2)).toEqual(['--import', 'tsx/esm']);
    expect(args[2]).toMatch(/server[\\/]src[\\/]mcp[\\/]kanban[\\/]server\.ts$/);
  });

  it('gives an absolute path either way', () => {
    // A relative path is right only when the runner was started from the repo
    // root, and silently wrong the moment anything starts it elsewhere.
    for (const exists of [always, never]) {
      const { args } = builtinServerCommand('mcp/kanban/server', exists);
      expect(path.isAbsolute(args[args.length - 1]!)).toBe(true);
    }
  });

  // "…and the file is really there" is asserted in the runner repository,
  // not here. The built-in servers are its modules under server/src, which
  // this repository no longer contains — only the marker that names them.
  // Asserting their existence here would fail for the right reason, which is
  // not a useful test.

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
    // This is how the board file and the project directory reach their server.
    const expanded = expandBuiltin(
      { command: 'node', args: [builtin('mcp/kanban/server'), 'board.json'] }, always);

    expect(expanded?.args?.[expanded.args.length - 1]).toBe('board.json');
  });

  it('puts the appended argument after the tsx flags, not among them', () => {
    const expanded = expandBuiltin(
      { command: 'node', args: [builtin('mcp/kanban/server'), 'board.json'] }, never);

    expect(expanded?.args?.slice(0, 2)).toEqual(['--import', 'tsx/esm']);
    expect(expanded?.args?.[3]).toBe('board.json');
  });
});

describe('through resolveConfig, which is what actually runs', () => {
  it('turns a built-in entry into something runnable', () => {
    const resolved = resolveConfig({
      transport: 'stdio', command: 'node', args: [builtin('mcp/kanban/server')],
    });

    expect(resolved.transport).toBe('stdio');
    const args = (resolved as { args: string[] }).args;
    // The marker is gone and a path has taken its place. Whether that path
    // exists depends on the runner being present, which is the runner
    // repository's business to assert.
    expect(args.some((a) => a.startsWith(BUILTIN_PREFIX))).toBe(false);
    expect(path.isAbsolute(args[args.length - 1]!)).toBe(true);
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
    // paige.json still says dist/mcp/kanban/server.js. Trusting it means the
    // catalogue can be fixed and the board still start from a stale file,
    // because this path never consults the catalogue at all.
    const saved = { transport: 'stdio', command: 'node', args: ['dist/mcp/kanban/server.js'] };
    const fixed = repointBuiltinServer('kanban', saved, '/projects/paige/kanban-board.json');

    expect(fixed).not.toBeNull();
    expect(fixed!.args.some((a) => a.includes('dist/mcp/kanban'))).toBe(false);
    // That the replacement path exists is asserted in the runner repository,
    // which is where the file it names lives.
    expect(fixed!.args.some((a) => path.isAbsolute(a))).toBe(true);
  });

  it('puts this project\'s board file on the end', () => {
    const saved = { transport: 'stdio', args: ['dist/mcp/kanban/server.js', 'someone-elses.json'] };
    const fixed = repointBuiltinServer('kanban', saved, '/projects/paige/board.json');

    expect(fixed!.args[fixed!.args.length - 1]).toBe('/projects/paige/board.json');
    expect(fixed!.args).not.toContain('someone-elses.json');
  });

  it('also covers the calendar', () => {
    const fixed = repointBuiltinServer('calendar', { transport: 'stdio', args: ['old/path.js'] });
    expect(fixed).not.toBeNull();
    expect(fixed!.args.some((a) => a.includes('old/path.js'))).toBe(false);
  });

  it('leaves a server that is not ours completely alone', () => {
    // Rewriting someone's brave-search or filesystem entry would be a bug.
    expect(repointBuiltinServer('brave-search', {
      transport: 'stdio', args: ['-y', '@modelcontextprotocol/server-brave-search'],
    })).toBeNull();
  });

  it('leaves an http server alone, built-in name or not', () => {
    expect(repointBuiltinServer('kanban', { transport: 'http' })).toBeNull();
  });
});
