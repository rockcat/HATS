import { AIProvider, CompletionRequest, CompletionResponse } from './types.js';

export interface MockResponse {
  content: string;
  inputTokens?: number;
  outputTokens?: number;
  stopReason?: string;
}

export class MockProvider implements AIProvider {
  readonly name = 'mock';
  private responses: MockResponse[];
  private callIndex = 0;
  public calls: CompletionRequest[] = [];

  constructor(responses: MockResponse[] | MockResponse = { content: 'Mock response.' }) {
    this.responses = Array.isArray(responses) ? responses : [responses];
  }

  async complete(req: CompletionRequest): Promise<CompletionResponse> {
    this.calls.push(req);
    const response = this.responses[this.callIndex % this.responses.length];
    this.callIndex++;
    return {
      content: response.content,
      inputTokens: response.inputTokens ?? 10,
      outputTokens: response.outputTokens ?? 5,
      stopReason: response.stopReason ?? 'end_turn',
      raw: response,
    };
  }

  reset(): void {
    this.callIndex = 0;
    this.calls = [];
  }
}
