import OpenAI from 'openai';
import { log } from '../util/logger.js';
import {
  AIProvider, CompletionRequest, CompletionResponse, ProviderError,
  Message, ToolCall,
} from './types.js';
import { withRetry } from './retry.js';
import { debugState } from './debug-state.js';

export class OpenAIProvider implements AIProvider {
  readonly name: string;
  private client: OpenAI;

  constructor(apiKey?: string, baseURL?: string, name = 'openai') {
    this.name = name;
    this.client = new OpenAI({
      apiKey: apiKey ?? process.env['OPENAI_API_KEY'],
      ...(baseURL ? { baseURL } : {}),
    });
  }

  async complete(req: CompletionRequest): Promise<CompletionResponse> {
    return withRetry(() => this.doComplete(req));
  }

  private async doComplete(req: CompletionRequest): Promise<CompletionResponse> {
    if (debugState.logPrompts) {
      const label = req.agentName ? `[${req.agentName}]` : '[agent]';
      const url   = this.client.baseURL;
      const bar   = '═'.repeat(60);
      log.info(`\n${bar}`);
      log.info(`${label} provider=${this.name}  url=${url}`);
      log.info(`${label} model=${req.model}  msgs=${req.messages.length}  tools=${req.tools?.length ?? 0}`);
      log.info(`SYSTEM: ${req.systemPrompt.slice(0, 400)}${req.systemPrompt.length > 400 ? '…' : ''}`);
      for (const m of req.messages) {
        const body = String(m.content ?? '').replace(/\s+/g, ' ').slice(0, 300);
        const tc   = m.toolCalls ? ` [${m.toolCalls.map(c => c.name).join(',')}]` : '';
        log.info(`  ${m.role.padEnd(9)} ${body}${tc}`);
      }
      log.info(bar);
    }

    try {
      const tools = req.tools?.map((t) => ({
        type: 'function' as const,
        function: {
          name: t.name,
          description: t.description,
          parameters: t.parameters ? sanitizeSchemaForOpenAI(t.parameters as Record<string, unknown>) : undefined,
        },
      }));

      const response = await this.client.chat.completions.create({
        model: req.model,
        max_tokens: req.maxTokens ?? 8192,
        messages: [
          { role: 'system', content: req.systemPrompt },
          ...toOpenAIMessages(req.messages),
        ],
        ...(tools && tools.length > 0 ? { tools } : {}),
        ...(req.temperature !== undefined ? { temperature: req.temperature } : {}),
      });

      const choice = response.choices[0];
      if (!choice) throw new Error('No choices returned');

      const toolCalls: ToolCall[] = (choice.message.tool_calls ?? []).map((tc) => ({
        id: tc.id,
        name: tc.function.name,
        arguments: JSON.parse(tc.function.arguments) as Record<string, unknown>,
      }));

      return {
        content: choice.message.content ?? '',
        toolCalls: toolCalls.length > 0 ? toolCalls : undefined,
        inputTokens: response.usage?.prompt_tokens ?? 0,
        outputTokens: response.usage?.completion_tokens ?? 0,
        stopReason: choice.finish_reason ?? 'stop',
        raw: response,
      };
    } catch (err) {
      if (err instanceof ProviderError) throw err;
      const error = err as { status?: number; message?: string };
      throw new ProviderError(error.message ?? 'OpenAI API error', this.name, error.status);
    }
  }
}

/** Local Ollama via OpenAI-compatible endpoint */
export class OllamaProvider extends OpenAIProvider {
  constructor(baseURL?: string) {
    super('ollama', baseURL ?? process.env['OLLAMA_BASE_URL'] ?? 'http://localhost:11434/v1', 'ollama');
  }
}

/** LM Studio via OpenAI-compatible endpoint */
export class LMStudioProvider extends OpenAIProvider {
  constructor(baseURL?: string) {
    super('lm-studio', baseURL ?? process.env['LM_STUDIO_BASE_URL'] ?? 'http://localhost:1234/v1', 'lmstudio');
  }
}

/**
 * Recursively sanitise a JSON Schema to be compatible with the OpenAI API.
 * OpenAI rejects: tuple `items` arrays, union `type` arrays, and several
 * JSON Schema keywords that are not part of its supported subset.
 */
function sanitizeSchemaForOpenAI(schema: Record<string, unknown>): Record<string, unknown> {
  if (!schema || typeof schema !== 'object' || Array.isArray(schema)) return schema;

  const out: Record<string, unknown> = { ...schema };

  // type: ["string", "null"] → "string"  (OpenAI only accepts a string type)
  if (Array.isArray(out['type'])) {
    const types = (out['type'] as string[]).filter((t) => t !== 'null');
    out['type'] = types.length > 0 ? types[0] : 'string';
  }

  // items: [{...}, {...}]  (tuple validation) → items: first element schema
  if (Array.isArray(out['items'])) {
    const tuple = out['items'] as Record<string, unknown>[];
    out['items'] = tuple.length > 0 ? sanitizeSchemaForOpenAI(tuple[0]) : {};
  } else if (out['items'] && typeof out['items'] === 'object') {
    out['items'] = sanitizeSchemaForOpenAI(out['items'] as Record<string, unknown>);
  }

  // Recurse into properties
  if (out['properties'] && typeof out['properties'] === 'object') {
    out['properties'] = Object.fromEntries(
      Object.entries(out['properties'] as Record<string, unknown>).map(([k, v]) => [
        k,
        sanitizeSchemaForOpenAI(v as Record<string, unknown>),
      ]),
    );
  }

  // Recurse into anyOf / oneOf / allOf
  for (const key of ['anyOf', 'oneOf', 'allOf'] as const) {
    if (Array.isArray(out[key])) {
      out[key] = (out[key] as Record<string, unknown>[]).map(sanitizeSchemaForOpenAI);
    }
  }

  return out;
}

function toOpenAIMessages(messages: Message[]): OpenAI.ChatCompletionMessageParam[] {
  return messages.map((msg): OpenAI.ChatCompletionMessageParam => {
    if (msg.role === 'user') {
      return { role: 'user', content: msg.content };
    }
    if (msg.role === 'assistant') {
      if (msg.toolCalls && msg.toolCalls.length > 0) {
        return {
          role: 'assistant',
          content: msg.content || null,
          tool_calls: msg.toolCalls.map((tc) => ({
            id: tc.id,
            type: 'function' as const,
            function: { name: tc.name, arguments: JSON.stringify(tc.arguments) },
          })),
        };
      }
      return { role: 'assistant', content: msg.content };
    }
    return {
      role: 'tool',
      tool_call_id: msg.toolCallId ?? '',
      content: msg.content,
    };
  });
}
