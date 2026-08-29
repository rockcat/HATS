/** Typed client for the Agent Library API. */

import { HttpClient } from './http-client.js';
import type { AgentTemplate, AgentTemplateInput } from '../../contracts/src/types.js';

const BASE = '/api/v1';

export class AgentLibraryClient {
  private readonly http: HttpClient;

  constructor(baseUrl: string, timeoutMs?: number) {
    this.http = new HttpClient({ service: 'Agent Library', baseUrl, ...(timeoutMs !== undefined && { timeoutMs }) });
  }

  get baseUrl(): string { return this.http.baseUrl; }

  isHealthy(): Promise<boolean> { return this.http.isHealthy(`${BASE}/health`); }

  async listTemplates(query: { q?: string; hat?: string; tag?: string } = {}): Promise<AgentTemplate[]> {
    const params = new URLSearchParams();
    for (const [key, value] of Object.entries(query)) if (value) params.set(key, value);
    const suffix = params.toString() ? `?${params}` : '';
    const result = await this.http.get<{ templates: AgentTemplate[] }>(`${BASE}/agent-templates${suffix}`);
    return result?.templates ?? [];
  }

  getTemplate(id: string): Promise<AgentTemplate | undefined> {
    return this.http.get<AgentTemplate>(`${BASE}/agent-templates/${encodeURIComponent(id)}`);
  }

  createTemplate(input: AgentTemplateInput): Promise<AgentTemplate | undefined> {
    return this.http.post<AgentTemplate>(`${BASE}/agent-templates`, input);
  }

  updateTemplate(id: string, patch: Partial<AgentTemplateInput>): Promise<AgentTemplate | undefined> {
    return this.http.patch<AgentTemplate>(`${BASE}/agent-templates/${encodeURIComponent(id)}`, patch);
  }

  deleteTemplate(id: string): Promise<void> {
    return this.http.del(`${BASE}/agent-templates/${encodeURIComponent(id)}`).then(() => undefined);
  }
}
