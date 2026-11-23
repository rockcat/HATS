import { describe, expect, it, vi } from 'vitest';
import { createDeployedAgent } from '../../../packages/contracts/src/factories.js';
import type { DeployedAgent, ProjectDefinition } from '../../../packages/contracts/src/types.js';
import type { IAgent } from '../agent/iagent.js';
import type { TeamOrchestrator } from '../orchestrator/orchestrator.js';
import { applyDefinition, changedSections, diffTeam } from './team-reconcile.js';

const member = (name: string, extra: Partial<DeployedAgent> = {}): DeployedAgent =>
  createDeployedAgent({ instanceId: `id-${name.toLowerCase()}`, name, hats: ['white'], ...extra });

/** A running agent with only the fields the mapper reads. */
const agent = (name: string, extra: { id?: string; model?: string; specialisation?: string } = {}): IAgent => ({
  id: extra.id ?? `id-${name.toLowerCase()}`,
  name,
  hatType: ['white'],
  config: {
    identity: { name, ...(extra.specialisation && { specialisation: extra.specialisation }) },
    provider: { name: 'anthropic' },
    model: extra.model ?? member(name).model.model,
  },
} as unknown as IAgent);

/** A team holding `agents`, recording what is done to it. */
function fakeTeam(agents: IAgent[]) {
  const team = [...agents];
  const orch = {
    listAgents: () => team,
    getAgentStore: () => undefined,
    registerAgent: vi.fn((config: { id: string; identity: { name: string } }) => {
      team.push(agent(config.identity.name, { id: config.id }));
    }),
    removeAgent: vi.fn(async (name: string) => { team.splice(team.findIndex((a) => a.name === name), 1); }),
    renameAgent: vi.fn(async (from: string, to: string) => { (team.find((a) => a.name === from) as { name: string }).name = to; }),
    changeAgentHat: vi.fn(),
    updateAgentConfig: vi.fn(),
    updateAgentSpecialisation: vi.fn(),
    updateAgentIdentity: vi.fn(),
    updateAgentAvatar: vi.fn(),
    updateAgentBackground: vi.fn(),
    updateAgentVoice: vi.fn(),
    updateAgentEmail: vi.fn(),
    updateAgentMaxContextTokens: vi.fn(),
    updateAgentMaxCostPerHour: vi.fn(),
    updateAgentMcpServers: vi.fn(),
    updateAgentDisabledPersonalMcp: vi.fn(),
    updateAgentUpfrontTools: vi.fn(),
    getProjectGoal: vi.fn(() => 'old goal'),
    setProjectGoal: vi.fn(),
    getHumanName: vi.fn(() => 'Boss'),
    setHumanName: vi.fn(),
  };
  return { orch, team, asOrchestrator: orch as unknown as TeamOrchestrator };
}

const definition = (team: DeployedAgent[], extra: Partial<ProjectDefinition> = {}): ProjectDefinition =>
  ({ id: 'p', name: 'P', humanName: 'Boss', team, revision: 2, goal: 'old goal', ...extra }) as ProjectDefinition;

const providerFactory = ((name: string) => ({ name })) as never;

describe('diffTeam', () => {
  it('finds members that joined and left', () => {
    const changes = diffTeam([member('Ann'), member('Bo')], [member('Ann'), member('Cy')]);
    expect(changes.added.map((a) => a.name)).toEqual(['Bo']);
    expect(changes.removed).toEqual(['Cy']);
    expect(changes.changed).toEqual([]);
  });

  it('treats a disabled member as one that left', () => {
    const changes = diffTeam([member('Ann', { enabled: false })], [member('Ann')]);
    expect(changes.removed).toEqual(['Ann']);
    expect(changes.added).toEqual([]);
  });

  it('matches a renamed member by its instance id', () => {
    const changes = diffTeam([member('Annie', { instanceId: 'id-ann' })], [member('Ann')]);
    expect(changes.added).toEqual([]);
    expect(changes.removed).toEqual([]);
    expect(changes.changed[0]!.from.name).toBe('Ann');
  });

  it('matches a member saved under a second id by its name', () => {
    const changes = diffTeam([member('Ann', { instanceId: 'other' })], [member('Ann')]);
    expect(changes.added).toEqual([]);
    expect(changes.removed).toEqual([]);
  });

  it('does not count empty fields or hat order as a change', () => {
    const live = member('Ann', { hats: ['white', 'red'], identity: { specialisation: 'design' } });
    const wanted = member('Ann', {
      hats: ['red', 'white'],
      identity: { specialisation: 'design', email: '' },
      limits: {},
    });
    expect(changedSections(live, wanted)).toEqual([]);
  });

  it('names the parts that changed', () => {
    const live = member('Ann');
    const wanted = member('Ann', { model: { provider: 'openai', model: 'gpt-x' }, limits: { maxCostPerHour: 2 } });
    expect(changedSections(live, wanted)).toEqual(['model', 'limits']);
  });
});

describe('applyDefinition', () => {
  it('adds, removes and updates the live team to match', async () => {
    const { orch, team, asOrchestrator } = fakeTeam([agent('Ann'), agent('Cy')]);
    const retire = vi.fn((name: string) => orch.removeAgent(name));
    const wanted = [
      member('Annie', { instanceId: 'id-ann', identity: { specialisation: 'research' } }),
      member('Bo'),
    ];

    const changes = await applyDefinition(asOrchestrator, definition(wanted, { goal: 'new goal' }), [], { providerFactory, retire });

    expect(retire).toHaveBeenCalledWith('Cy');
    expect(orch.renameAgent).toHaveBeenCalledWith('Ann', 'Annie');
    expect(orch.updateAgentSpecialisation).toHaveBeenCalledWith('Annie', 'research');
    expect(orch.updateAgentConfig).not.toHaveBeenCalled();
    expect(team.map((a) => a.name).sort()).toEqual(['Annie', 'Bo']);
    expect(orch.setProjectGoal).toHaveBeenCalledWith('new goal');
    expect(changes.added.map((a) => a.name)).toEqual(['Bo']);
  });

  it('changes nothing when the team already matches', async () => {
    const { orch, asOrchestrator } = fakeTeam([agent('Ann')]);
    const retire = vi.fn();
    await applyDefinition(asOrchestrator, definition([member('Ann')]), [], { providerFactory, retire });
    expect(retire).not.toHaveBeenCalled();
    expect(orch.registerAgent).not.toHaveBeenCalled();
    expect(orch.renameAgent).not.toHaveBeenCalled();
    expect(orch.setProjectGoal).not.toHaveBeenCalled();
  });

  it('carries on past a member that fails to apply', async () => {
    const { orch, asOrchestrator } = fakeTeam([agent('Ann'), agent('Cy')]);
    orch.renameAgent.mockRejectedValueOnce(new Error('taken'));
    const retire = vi.fn(async () => {});
    await applyDefinition(asOrchestrator,
      definition([member('Annie', { instanceId: 'id-ann' }), member('Cy', { limits: { maxCostPerHour: 1 } })]),
      [], { providerFactory, retire });
    expect(orch.updateAgentMaxCostPerHour).toHaveBeenCalledWith('Cy', 1);
  });
});
