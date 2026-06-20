import { AgentStore } from '../api/agent-store.js';
import { AgentDefinition } from './team-snapshot.js';
import { HatType } from '../hats/types.js';

export const BUILTIN_CLAUDE_CODE_ID = 'builtin-claude-code';

const CLAUDE_CODE_DEF: AgentDefinition = {
  id: BUILTIN_CLAUDE_CODE_ID,
  identity: {
    name: 'Claude Code',
    visualDescription: 'AI coding assistant powered by Claude',
    specialisation: 'software development, code review, debugging',
  },
  hatType: [HatType.Green],
  model: 'claude-code',
  providerName: 'external',
  scheduledActionIds: [],
  externalEndpoint: {
    mode: 'subprocess',
    command: 'claude',
    args: ['-p'],
    inputMode: 'stdin',
    timeoutMs: 120_000,
  },
};

export async function seedBuiltIns(store: AgentStore): Promise<void> {
  if (!store.has(BUILTIN_CLAUDE_CODE_ID)) {
    await store.addOrUpdate(CLAUDE_CODE_DEF);
  }
}
