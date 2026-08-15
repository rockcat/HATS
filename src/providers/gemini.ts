import { GoogleGenerativeAI } from '@google/generative-ai';
import { log } from '../util/logger.js';
import { AIProvider, CompletionRequest, CompletionResponse, ProviderError } from './types.js';
import { debugState, writePromptLog, tk } from './debug-state.js';

export class GeminiProvider implements AIProvider {
  readonly name = 'gemini';
  readonly pricingPageUrl = 'https://ai.google.dev/gemini-api/docs/pricing';
  private client: GoogleGenerativeAI;

  constructor(apiKey?: string) {
    this.client = new GoogleGenerativeAI(apiKey ?? process.env['GEMINI_API_KEY'] ?? '');
  }

  async complete(req: CompletionRequest): Promise<CompletionResponse> {
    if (debugState.logPrompts) {
      const label     = req.agentName ? `[${req.agentName}]` : '[agent]';
      const bar       = '═'.repeat(80);
      const ts        = new Date().toISOString().replace('T', ' ').slice(0, 23);
      const sysChars  = req.systemPrompt.length;
      const msgChars  = req.messages.reduce((n, m) => n + String(m.content ?? '').length, 0);
      const estTokens = Math.round((sysChars + msgChars) / 4);
      const lines: string[] = [
        `\n${bar}`,
        `${ts} ${label} provider=gemini  url=https://generativelanguage.googleapis.com`,
        `${label} model=${req.model}  msgs=${req.messages.length}  tools=${req.tools?.length ?? 0}  ~${estTokens.toLocaleString()} tokens`,
        `── SYSTEM (${sysChars} chars) ──`,
        req.systemPrompt,
        `── MESSAGES ──`,
      ];
      for (const m of req.messages) {
        lines.push(`[${m.role}]`);
        lines.push(String(m.content ?? ''));
      }
      lines.push(bar);
      writePromptLog(lines);
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
      log.info(`${label} ← gemini (${tk(response.usageMetadata?.promptTokenCount ?? 0)} prompt / ${tk(response.usageMetadata?.candidatesTokenCount ?? 0)} gen)`);
      if (debugState.logPrompts) {
        const ts  = new Date().toISOString().replace('T', ' ').slice(0, 23);
        const inp = response.usageMetadata?.promptTokenCount ?? 0;
        const out = response.usageMetadata?.candidatesTokenCount ?? 0;
        writePromptLog([`${ts} ${label} ← gemini  input=${inp} output=${out} total=${inp + out}`]);
      }

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
