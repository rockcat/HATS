import { Agent } from '../agent/agent.js';
import { AgentConfig } from '../agent/types.js';
import { AgentState } from '../agent/types.js';
import { HatType } from '../hats/types.js';

export class AgentRegistry {
  private agents: Map<string, Agent> = new Map();

  create(config: AgentConfig): Agent {
    const agent = new Agent(config);
    this.agents.set(agent.id, agent);
    return agent;
  }

  getById(id: string): Agent | undefined {
    return this.agents.get(id);
  }

  getByName(name: string): Agent | undefined {
    for (const agent of this.agents.values()) {
      if (agent.name === name) return agent;
    }
    return undefined;
  }

  listByHat(hatType: HatType): Agent[] {
    return Array.from(this.agents.values()).filter((a) => a.hatType === hatType);
  }

  listByState(state: AgentState): Agent[] {
    return Array.from(this.agents.values()).filter((a) => a.state === state);
  }

  list(): Agent[] {
    return Array.from(this.agents.values());
  }

  remove(id: string): boolean {
    return this.agents.delete(id);
  }

  clear(): void {
    this.agents.clear();
  }
}
