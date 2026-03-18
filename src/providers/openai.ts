import OpenAI from 'openai';
import { AIProvider, CompletionRequest, CompletionResponse, ProviderError } from './types.js';

export class OpenAIProvider implements AIProvider {
  readonly name = 'openai';
  private client: OpenAI;

  constructor(apiKey?: string) {
    this.client = new OpenAI({ apiKey: apiKey ?? process.env['OPENAI_API_KEY'] });
  }

  async complete(req: CompletionRequest): Promise<CompletionResponse> {
    try {
      const response = await this.client.chat.completions.create({
        model: req.model,
        max_tokens: req.maxTokens ?? 1024,
        messages: [
          { role: 'system', content: req.systemPrompt },
          ...req.messages,
        ],
        ...(req.temperature !== undefined ? { temperature: req.temperature } : {}),
      });

      const choice = response.choices[0];
      if (!choice) throw new Error('No choices returned from OpenAI');

      return {
        content: choice.message.content ?? '',
        inputTokens: response.usage?.prompt_tokens ?? 0,
        outputTokens: response.usage?.completion_tokens ?? 0,
        stopReason: choice.finish_reason ?? 'stop',
        raw: response,
      };
    } catch (err) {
      if (err instanceof ProviderError) throw err;
      const error = err as { status?: number; message?: string };
      throw new ProviderError(
        error.message ?? 'OpenAI API error',
        this.name,
        error.status,
      );
    }
  }
}
