export interface ToolDefinition {
  name: string;
  description: string;
  parameters: {
    type: 'object';
    properties: Record<string, {
      type: string;
      description: string;
      enum?: string[];
      items?: { type: string };
    }>;
    required?: string[];
  };
}

export interface ToolCall {
  id: string;
  name: string;
  arguments: Record<string, unknown>;
}

export interface Message {
  role: 'user' | 'assistant' | 'tool';
  content: string;
  toolCalls?: ToolCall[];   // on assistant messages that called tools
  toolCallId?: string;      // on tool messages: which call this result belongs to
  toolName?: string;        // on tool messages: name of the tool called
}

export interface CompletionRequest {
  systemPrompt: string;
  messages: Message[];
  model: string;
  tools?: ToolDefinition[];
  maxTokens?: number;
  temperature?: number;
  agentName?: string;   // for debug logging only
}

export interface CompletionResponse {
  content: string;           // text content (may be empty when only tool calls returned)
  toolCalls?: ToolCall[];    // present when the model wants to call tools
  inputTokens: number;
  outputTokens: number;
  stopReason: string;
  raw: unknown;
}

export interface AIProvider {
  name: string;
  complete(req: CompletionRequest): Promise<CompletionResponse>;
}

export class ProviderError extends Error {
  constructor(
    message: string,
    public readonly providerName: string,
    public readonly statusCode?: number,
  ) {
    super(message);
    this.name = 'ProviderError';
  }
}
