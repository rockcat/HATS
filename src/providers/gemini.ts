import { GoogleGenerativeAI } from '@google/generative-ai';
import { AIProvider, CompletionRequest, CompletionResponse, ProviderError } from './types.js';

export class GeminiProvider implements AIProvider {
  readonly name = 'gemini';
  private client: GoogleGenerativeAI;

  constructor(apiKey?: string) {
    this.client = new GoogleGenerativeAI(apiKey ?? process.env['GEMINI_API_KEY'] ?? '');
  }

  async complete(req: CompletionRequest): Promise<CompletionResponse> {
    try {
      const model = this.client.getGenerativeModel({
        model: req.model,
        systemInstruction: req.systemPrompt,
        generationConfig: {
          maxOutputTokens: req.maxTokens ?? 1024,
          ...(req.temperature !== undefined ? { temperature: req.temperature } : {}),
        },
      });

      // Build history (all but the last user message)
      const messages = req.messages;
      const history = messages.slice(0, -1).map((m) => ({
        role: m.role === 'assistant' ? 'model' : 'user',
        parts: [{ text: m.content }],
      }));
      const lastMessage = messages[messages.length - 1];

      const chat = model.startChat({ history });
      const result = await chat.sendMessage(lastMessage?.content ?? '');
      const response = result.response;

      return {
        content: response.text(),
        inputTokens: response.usageMetadata?.promptTokenCount ?? 0,
        outputTokens: response.usageMetadata?.candidatesTokenCount ?? 0,
        stopReason: response.candidates?.[0]?.finishReason ?? 'STOP',
        raw: response,
      };
    } catch (err) {
      const error = err as { status?: number; message?: string };
      throw new ProviderError(
        error.message ?? 'Gemini API error',
        this.name,
        error.status,
      );
    }
  }
}
