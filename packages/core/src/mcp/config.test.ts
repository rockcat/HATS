import { describe, it, expect } from 'vitest';
import { interpolateArgs } from './config.js';
import { resolveConfig } from './mcp-catalogue.js';
import { BUILTIN_CATALOGUE } from './catalogue-store.js';

const sftp = BUILTIN_CATALOGUE.find((e) => e.id === 'sftp-ssh')!;

describe('a server that takes its settings as flags', () => {
  it('gets the values when it starts', () => {
    const args = interpolateArgs(['--host=${SSH_HOST}', '--password=${SSH_PASSWORD}', '-y'], {
      SSH_HOST: 'box.example', SSH_PASSWORD: 'pw',
    });
    expect(args).toEqual(['--host=box.example', '--password=pw', '-y']);
  });

  it('gets a blank flag for a value nobody set', () => {
    expect(interpolateArgs(['--key=${SSH_KEY}'], {})).toEqual(['--key=']);
  });

  it('keeps the placeholders in the config that is saved', () => {
    const resolved = resolveConfig(sftp.config);
    expect(resolved.transport === 'stdio' && resolved.args).toContain('--password=${SSH_PASSWORD}');
  });
});
