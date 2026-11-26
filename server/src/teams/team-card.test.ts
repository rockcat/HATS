import { describe, expect, it } from 'vitest';
import { buildTeamCard, configuredProviders } from './team-card.js';

const member = (name: string, hats: string[], specialisation?: string) =>
  ({ name, hatType: hats, config: { identity: { ...(specialisation && { specialisation }) } } });

describe('buildTeamCard', () => {
  it('describes the team, its members and its tools, without schemas', () => {
    const card = buildTeamCard({
      definition: {
        id: 'billing', name: 'Billing', goal: 'Keep invoices right.',
        settings: { summary: 'Invoices and payments.', tags: ['billing', 'stripe'],
          visits: { visitTo: ['research'], hostFrom: ['*'], approval: 'auto' } },
        mcpServers: [{ name: 'postgres', config: { transport: 'stdio' } }, { name: 'stripe', config: { transport: 'stdio' } }],
      },
      members: [member('Ann', ['white'], 'reconciliation'), member('Bo', ['black', 'red'])],
      describeServer: (name) => (name === 'postgres' ? 'Query the billing database.' : undefined),
      env: { ANTHROPIC_API_KEY: 'k' },
      dashboard: 'http://billing.local:3101',
    });

    expect(card).toEqual({
      team: 'billing', name: 'Billing', summary: 'Invoices and payments.', tags: ['billing', 'stripe'],
      members: [
        { name: 'Ann', hats: ['white'], specialisation: 'reconciliation' },
        { name: 'Bo', hats: ['black', 'red'] },
      ],
      tools: [{ name: 'postgres', description: 'Query the billing database.' }, { name: 'stripe' }],
      models: ['anthropic'],
      hosting: true,
      approval: 'auto',
      visits: { visitTo: ['research'], hostFrom: ['*'] },
      dashboard: 'http://billing.local:3101',
    });
  });

  it('falls back to the goal, hosts nobody and waits for an admin by default', () => {
    const card = buildTeamCard({
      definition: { id: 'ops', name: 'Ops', goal: 'Keep things running.' },
      members: [], env: {},
    });
    expect(card).toMatchObject({
      summary: 'Keep things running.', tags: [], tools: [], models: [],
      hosting: false, approval: 'admin', visits: { visitTo: [], hostFrom: [] },
    });
  });
});

describe('configuredProviders', () => {
  it('lists providers with a key, and never the local servers', () => {
    expect(configuredProviders({ OPENAI_API_KEY: 'k', OLLAMA_BASE_URL: 'http://x' })).toEqual(['openai']);
  });
});
