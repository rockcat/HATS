import { describe, it, expect } from 'vitest';
import { cleanSnapshot, SNAPSHOT_FILE } from './snapshot-scrub.js';

const env = { BRAVE_API_KEY: 'brave-secret-1' };
const saved = JSON.stringify({
  version: 2,
  agentIds: ['copy-1'],
  agents: {
    'copy-1': {
      id: 'copy-1', templateId: 'tpl', identity: { name: 'Poppy', avatar: 'max.glb' },
      personalMcpCredentials: { 'email-imap': { MCP_EMAIL_PASSWORD: 'hunter22' } },
    },
  },
  mcpServers: [{ name: 'brave-search', config: { transport: 'stdio', command: 'npx', env: { BRAVE_API_KEY: 'brave-secret-1' } } }],
});

describe('a saved team state, cleaned to leave the machine', () => {
  it('holds no credentials and none of the runner\'s keys', () => {
    const { text } = cleanSnapshot(saved, { env });
    expect(text).not.toContain('hunter22');
    expect(text).not.toContain('brave-secret-1');
  });

  it('hands back what it took, by agent', () => {
    const { credentials } = cleanSnapshot(saved, { env });
    expect(credentials['copy-1']?.['email-imap']?.['MCP_EMAIL_PASSWORD']).toBe('hunter22');
  });

  it('says which agents it holds and where they came from', () => {
    expect(cleanSnapshot(saved, { env }).agents).toEqual([
      { id: 'copy-1', templateId: 'tpl', identity: { name: 'Poppy', avatar: 'max.glb' } },
    ]);
  });

  it('leaves a file that is not JSON alone', () => {
    expect(cleanSnapshot('not json').text).toBe('not json');
  });

  it('covers copies kept beside the current one', () => {
    expect(SNAPSHOT_FILE.test('team-state.json')).toBe(true);
    expect(SNAPSHOT_FILE.test('team-state.before-xmas-restore.json')).toBe(true);
    expect(SNAPSHOT_FILE.test('tkt-1/team-state.json')).toBe(false);
  });
});
