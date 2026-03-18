export { HatType } from './hats/types.js';
export type { HatDefinition } from './hats/types.js';
export { hatDefinitions, getHatDefinition } from './hats/definitions.js';

export type { PromptContext, SystemPrompt } from './prompt/types.js';
export { generateSystemPrompt } from './prompt/generator.js';

export type { CompletionRequest, CompletionResponse, AIProvider } from './providers/types.js';
export { ProviderError } from './providers/types.js';
export { MockProvider } from './providers/mock.js';
export { AnthropicProvider } from './providers/anthropic.js';
export { OpenAIProvider } from './providers/openai.js';
export { GeminiProvider } from './providers/gemini.js';

export { AgentState } from './agent/types.js';
export type { AgentConfig, AgentMessage, AgentEvent } from './agent/types.js';
export { transition } from './agent/state-machine.js';
export { Agent } from './agent/agent.js';

export { AgentRegistry } from './registry/agent-registry.js';
