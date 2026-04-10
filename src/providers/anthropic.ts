import Anthropic from '@anthropic-ai/sdk';
import { log } from '../util/logger.js';
import {
  AIProvider, CompletionRequest, CompletionResponse, ProviderError,
  Message, ToolCall,
} from './types.js';
import { withRetry } from './retry.js';
import { debugState } from './debug-state.js';

export class AnthropicProvider implements AIProvider {
  readonly name = 'anthropic';
  private client: Anthropic;

  constructor(apiKey?: string) {
    this.client = new Anthropic({ apiKey: apiKey ?? process.env['ANTHROPIC_API_KEY'] });
  }

  async complete(req: CompletionRequest): Promise<CompletionResponse> {
    return withRetry(() => this.doComplete(req));
  }

  private async doComplete(req: CompletionRequest): Promise<CompletionResponse> {
    if (debugState.logPrompts) {
      const label  = req.agentName ? `[${req.agentName}]` : '[agent]';
      const url    = (this.client as any).baseURL ?? 'https://api.anthropic.com';
      const bar    = '═'.repeat(60);
      log.info(`\n${bar}`);
      log.info(`${label} provider=anthropic  url=${url}`);
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
        name: t.name,
        description: t.description,
        input_schema: t.parameters,
      }));

      const label = req.agentName ? `[${req.agentName}]` : '[agent]';
      log.info(`${label} → anthropic (${req.model})`);
      const response = await this.client.messages.create({
        model: req.model,
        max_tokens: req.maxTokens ?? 8192,
        system: req.systemPrompt,
        messages: toAnthropicMessages(req.messages),
        ...(tools && tools.length > 0 ? { tools } : {}),
        ...(req.temperature !== undefined ? { temperature: req.temperature } : {}),
      });
      log.info(`${label} ← anthropic (${response.usage.input_tokens}in/${response.usage.output_tokens}out)`);

      // Extract text content
      const content = response.content
        .filter((b) => b.type === 'text')
        .map((b) => (b as { type: 'text'; text: string }).text)
        .join('');

      // Extract tool calls
      const toolCalls: ToolCall[] = response.content
        .filter((b) => b.type === 'tool_use')
        .map((b) => {
          const block = b as { type: 'tool_use'; id: string; name: string; input: Record<string, unknown> };
          return { id: block.id, name: block.name, arguments: block.input };
        });

      return {
        content,
        toolCalls: toolCalls.length > 0 ? toolCalls : undefined,
        inputTokens: response.usage.input_tokens,
        outputTokens: response.usage.output_tokens,
        stopReason: response.stop_reason ?? 'end_turn',
        raw: response,
      };
    } catch (err) {
      const error = err as { status?: number; message?: string };
      throw new ProviderError(error.message ?? 'Anthropic API error', this.name, error.status);
    }
  }
}

function toAnthropicMessages(messages: Message[]): Anthropic.MessageParam[] {
  const result: Anthropic.MessageParam[] = [];
  let i = 0;

  while (i < messages.length) {
    const msg = messages[i]!;

    if (msg.role === 'tool') {
      // Batch ALL consecutive tool results into a single user message.
      // Anthropic requires: one user message with N tool_result blocks
      // immediately following the assistant message that had N tool_use blocks.
      const toolResults: Anthropic.ToolResultBlockParam[] = [];
      while (i < messages.length && messages[i]!.role === 'tool') {
        toolResults.push({
          type: 'tool_result',
          tool_use_id: messages[i]!.toolCallId ?? '',
          content: messages[i]!.content,
        });
        i++;
      }
      result.push({ role: 'user', content: toolResults });
    } else if (msg.role === 'user') {
      result.push({ role: 'user', content: msg.content });
      i++;
    } else {
      // assistant
      if (msg.toolCalls && msg.toolCalls.length > 0) {
        const blocks: Anthropic.ContentBlock[] = [];
        if (msg.content) blocks.push({ type: 'text', text: msg.content, citations: [] });
        for (const tc of msg.toolCalls) {
          blocks.push({ type: 'tool_use', id: tc.id, name: tc.name, input: tc.arguments });
        }
        result.push({ role: 'assistant', content: blocks });
      } else {
        result.push({ role: 'assistant', content: msg.content });
      }
      i++;
    }
  }

  return result;
}
