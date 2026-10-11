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

/**
 * An image carried alongside text, for a model that can see.
 *
 * A photo from the user's phone is the reason this exists: describing it in
 * words would mean something else had already done the looking.
 */
export interface ImageAttachment {
  /** An IANA type the model accepts: image/jpeg, image/png, image/webp, image/gif. */
  mediaType: string;
  /** The image itself, base64 with no data: prefix. */
  base64: string;
  /** Where it was kept, if anywhere, so the agent can refer back to it. */
  path?: string;
}

/**
 * What a tool produced.
 *
 * The text always stands on its own: a provider that cannot see images
 * drops them, and the agent must still be told what happened.
 */
export interface ToolOutcome {
  text: string;
  images?: ImageAttachment[];
}

export interface Message {
  role: 'user' | 'assistant' | 'tool';
  content: string;
  toolCalls?: ToolCall[];   // on assistant messages that called tools
  toolCallId?: string;      // on tool messages: which call this result belongs to
  toolName?: string;        // on tool messages: name of the tool called
  /** Images to show the model with this message. Dropped by a provider
   *  that cannot see, which is why the text must stand on its own. */
  images?: ImageAttachment[];
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
  pricingPageUrl: string;
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
