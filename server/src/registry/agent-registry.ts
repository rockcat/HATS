import { IAgent } from '../agent/iagent.js';
import { Agent } from '../agent/agent.js';
import { AgentConfig } from '../agent/types.js';
import { AgentState } from '../agent/types.js';
import { HatType } from '../hats/types.js';

export class AgentRegistry {
  private agents: Map<string, IAgent> = new Map();

  create(config: AgentConfig): Agent {
    const agent = new Agent(config);
    this.agents.set(agent.id, agent);
    return agent;
  }

  getById(id: string): IAgent | undefined {
    return this.agents.get(id);
  }

  getByName(name: string): IAgent | undefined {
    for (const agent of this.agents.values()) {
      if (agent.name === name) return agent;
    }
    return undefined;
  }

  listByHat(hatType: HatType): IAgent[] {
    return Array.from(this.agents.values()).filter((a) => a.hatType.includes(hatType));
  }

  listByState(state: AgentState): IAgent[] {
    return Array.from(this.agents.values()).filter((a) => a.state === state);
  }

  list(): IAgent[] {
    return Array.from(this.agents.values());
  }

  remove(id: string): boolean {
    return this.agents.delete(id);
  }

  clear(): void {
    this.agents.clear();
  }
}
