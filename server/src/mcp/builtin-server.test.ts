import { describe, it, expect } from 'vitest';
import { existsSync } from 'fs';
import * as path from 'path';
import {
  BUILTIN_PREFIX, builtin, builtinServerCommand, expandBuiltin, isBuiltinMarker,
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

  it('points at a file that is really there', () => {
    // The whole bug: the catalogue named dist/mcp/kanban/server.js, which no
    // current build writes, and it worked only because a stale copy from an
    // older layout was still lying around.
    const { args } = builtinServerCommand('mcp/kanban/server');
    expect(existsSync(args[args.length - 1]!)).toBe(true);
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
