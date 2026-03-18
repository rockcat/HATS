import { v4 as uuidv4 } from 'uuid';
import { HatType } from '../hats/types.js';
import { getHatDefinition } from '../hats/definitions.js';
import { generateSystemPrompt } from '../prompt/generator.js';
import { CompletionRequest } from '../providers/types.js';
import { AgentConfig, AgentMessage, AgentState, AgentEvent } from './types.js';
import { transition } from './state-machine.js';

export class Agent {
  readonly id: string;
  readonly config: AgentConfig;
  private _state: AgentState;
  private systemPrompt: string;
  private conversationHistory: AgentMessage[];

  constructor(config: AgentConfig) {
    this.id = uuidv4();
    this.config = config;
    this._state = AgentState.Idle;
    this.conversationHistory = [];
    this.systemPrompt = this.buildSystemPrompt();
  }

  get state(): AgentState {
    return this._state;
  }

  get name(): string {
    return this.config.identity.name;
  }

  get hatType(): HatType {
    return this.config.hatType;
  }

  private buildSystemPrompt(): string {
    const hat = getHatDefinition(this.config.hatType);
    const prompt = generateSystemPrompt({
      name: this.config.identity.name,
      visualDescription: this.config.identity.visualDescription,
      backstory: this.config.identity.backstory,
      hatLabel: hat.label,
      thinkingStyle: hat.thinkingStyle,
      communicationTone: hat.communicationTone,
      directives: hat.directives,
      avoidances: hat.avoidances,
      teamRole: hat.teamRole,
      teamContext: this.config.teamContext,
    });
    return prompt.text;
  }

  private applyEvent(event: AgentEvent): void {
    this._state = transition(this._state, event);
  }

  async chat(
    message: string,
    externalHistory?: Array<{ role: 'user' | 'assistant'; content: string }>,
  ): Promise<string> {
    if (this._state === AgentState.Idle) {
      this.applyEvent('task_assigned');
    }

    const history = externalHistory ?? this.conversationHistory.map((m) => ({
      role: m.role,
      content: m.content,
    }));

    const req: CompletionRequest = {
      systemPrompt: this.systemPrompt,
      messages: [...history, { role: 'user', content: message }],
      model: this.config.model,
    };

    const response = await this.config.provider.complete(req);

    this.conversationHistory.push(
      { role: 'user', content: message, timestamp: new Date() },
      { role: 'assistant', content: response.content, timestamp: new Date() },
    );

    return response.content;
  }

  requestHelp(): void {
    this.applyEvent('blocked');
  }

  joinDiscussion(): void {
    this.applyEvent('discussion_invited');
  }

  endDiscussion(): void {
    this.applyEvent('discussion_ended');
  }

  completeTask(): void {
    this.applyEvent('task_complete');
  }

  receiveHelp(): void {
    this.applyEvent('help_received');
  }

  getHistory(): AgentMessage[] {
    return [...this.conversationHistory];
  }

  toJSON(): object {
    return {
      id: this.id,
      name: this.name,
      hatType: this.config.hatType,
      state: this._state,
      model: this.config.model,
      provider: this.config.provider.name,
      historyLength: this.conversationHistory.length,
    };
  }
}
