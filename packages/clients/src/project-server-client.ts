/** Typed client for the Project Server API. */

import { HttpClient } from './http-client.js';
import type { DeployedAgent, ProjectDefinition, ProjectSummary } from '../../contracts/src/types.js';

const BASE = '/api/v1';

export interface ActiveProjectResponse {
  activeProjectId: string | null;
  project: ProjectDefinition | null;
}

export class ProjectServerClient {
  private readonly http: HttpClient;

  constructor(baseUrl: string, timeoutMs?: number) {
    this.http = new HttpClient({ service: 'Project Server', baseUrl, ...(timeoutMs !== undefined && { timeoutMs }) });
  }

  get baseUrl(): string { return this.http.baseUrl; }

  isHealthy(): Promise<boolean> { return this.http.isHealthy(`${BASE}/health`); }

  async listProjects(): Promise<ProjectSummary[]> {
    const result = await this.http.get<{ projects: ProjectSummary[] }>(`${BASE}/projects`);
    return result?.projects ?? [];
  }

  getProject(id: string): Promise<ProjectDefinition | undefined> {
    return this.http.get<ProjectDefinition>(`${BASE}/projects/${encodeURIComponent(id)}`);
  }

  async getActive(): Promise<ActiveProjectResponse> {
    const result = await this.http.get<ActiveProjectResponse>(`${BASE}/active`);
    return result ?? { activeProjectId: null, project: null };
  }

  setActive(id: string): Promise<{ project: ProjectDefinition } | undefined> {
    return this.http.put<{ project: ProjectDefinition }>(`${BASE}/active`, { id });
  }

  createProject(input: { id?: string; name: string; goal?: string; humanName?: string }): Promise<ProjectDefinition | undefined> {
    return this.http.post<ProjectDefinition>(`${BASE}/projects`, input);
  }

  /** Partial update of the project header fields. */
  patchProject(
    id: string,
    patch: Partial<Pick<ProjectDefinition, 'name' | 'description' | 'goal' | 'humanName' | 'settings' | 'mcpServers'>>,
    expectedRevision?: number,
  ): Promise<ProjectDefinition | undefined> {
    return this.http.patch<ProjectDefinition>(
      `${BASE}/projects/${encodeURIComponent(id)}`,
      { ...patch, ...(expectedRevision !== undefined && { expectedRevision }) },
    );
  }

  /** Replace the whole team roster — used by the runner after agents are added or removed live. */
  replaceProject(
    id: string,
    definition: Partial<ProjectDefinition>,
    expectedRevision?: number,
  ): Promise<ProjectDefinition | undefined> {
    return this.http.put<ProjectDefinition>(
      `${BASE}/projects/${encodeURIComponent(id)}`,
      { ...definition, ...(expectedRevision !== undefined && { expectedRevision }) },
    );
  }

  deployAgent(
    projectId: string,
    body: { templateId?: string; name?: string; projectRole?: string; agent?: DeployedAgent },
  ): Promise<DeployedAgent | undefined> {
    return this.http.post<DeployedAgent>(`${BASE}/projects/${encodeURIComponent(projectId)}/team`, body);
  }

  patchDeployedAgent(
    projectId: string,
    instanceId: string,
    patch: Partial<DeployedAgent>,
  ): Promise<DeployedAgent | undefined> {
    return this.http.patch<DeployedAgent>(
      `${BASE}/projects/${encodeURIComponent(projectId)}/team/${encodeURIComponent(instanceId)}`,
      patch,
    );
  }

  removeDeployedAgent(projectId: string, instanceId: string): Promise<void> {
    return this.http
      .del(`${BASE}/projects/${encodeURIComponent(projectId)}/team/${encodeURIComponent(instanceId)}`)
      .then(() => undefined);
  }
}
