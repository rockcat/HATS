import Anthropic from '@anthropic-ai/sdk';
import { AIProvider, CompletionRequest, CompletionResponse, ProviderError } from './types.js';

export class AnthropicProvider implements AIProvider {
  readonly name = 'anthropic';
  private client: Anthropic;

  constructor(apiKey?: string) {
    this.client = new Anthropic({ apiKey: apiKey ?? process.env['ANTHROPIC_API_KEY'] });
  }

  async complete(req: CompletionRequest): Promise<CompletionResponse> {
    try {
      const response = await this.client.messages.create({
        model: req.model,
        max_tokens: req.maxTokens ?? 1024,
        system: req.systemPrompt,
        messages: req.messages,
        ...(req.temperature !== undefined ? { temperature: req.temperature } : {}),
      });

      const content = response.content
        .filter((block) => block.type === 'text')
        .map((block) => (block as { type: 'text'; text: string }).text)
        .join('');

      return {
        content,
        inputTokens: response.usage.input_tokens,
        outputTokens: response.usage.output_tokens,
        stopReason: response.stop_reason ?? 'end_turn',
        raw: response,
      };
    } catch (err) {
      const error = err as { status?: number; message?: string };
      throw new ProviderError(
        error.message ?? 'Anthropic API error',
        this.name,
        error.status,
      );
    }
  }
}
