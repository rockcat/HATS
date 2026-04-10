import { GoogleGenerativeAI } from '@google/generative-ai';
import { log } from '../util/logger.js';
import { AIProvider, CompletionRequest, CompletionResponse, ProviderError } from './types.js';
import { debugState } from './debug-state.js';

export class GeminiProvider implements AIProvider {
  readonly name = 'gemini';
  private client: GoogleGenerativeAI;

  constructor(apiKey?: string) {
    this.client = new GoogleGenerativeAI(apiKey ?? process.env['GEMINI_API_KEY'] ?? '');
  }

  async complete(req: CompletionRequest): Promise<CompletionResponse> {
    if (debugState.logPrompts) {
      const label = req.agentName ? `[${req.agentName}]` : '[agent]';
      const bar   = '═'.repeat(60);
      log.info(`\n${bar}`);
      log.info(`${label} provider=gemini  url=https://generativelanguage.googleapis.com`);
      log.info(`${label} model=${req.model}  msgs=${req.messages.length}  tools=${req.tools?.length ?? 0}`);
      log.info(`SYSTEM: ${req.systemPrompt.slice(0, 400)}${req.systemPrompt.length > 400 ? '…' : ''}`);
      for (const m of req.messages) {
        const body = String(m.content ?? '').replace(/\s+/g, ' ').slice(0, 300);
        log.info(`  ${m.role.padEnd(9)} ${body}`);
      }
      log.info(bar);
    }

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

      const label = req.agentName ? `[${req.agentName}]` : '[agent]';
      log.info(`${label} → gemini (${req.model})`);
      const chat = model.startChat({ history });
      const result = await chat.sendMessage(lastMessage?.content ?? '');
      const response = result.response;
      log.info(`${label} ← gemini (${response.usageMetadata?.promptTokenCount ?? 0}in/${response.usageMetadata?.candidatesTokenCount ?? 0}out)`);

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
