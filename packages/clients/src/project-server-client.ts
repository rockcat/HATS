/** Typed client for the Project Server API. */

import { HttpClient } from './http-client.js';
import { watchEvents, type Watch, type WatchOptions } from './event-stream.js';
import type { DeployedAgent, ProjectChange, ProjectDefinition, ProjectSummary } from '../../contracts/src/types.js';

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

  /**
   * Be told the moment project `id` is saved or removed. The stream is kept
   * open, reconnecting when it drops; `onState` says whether it is open.
   */
  watchProject(id: string, onChange: (change: ProjectChange) => void, options: WatchOptions = {}): Watch {
    const url = `${this.baseUrl.replace(/\/$/, '')}${BASE}/events?project=${encodeURIComponent(id)}`;
    return watchEvents(url, (event) => {
      if (event.event !== 'project_changed' && event.event !== 'project_removed') return;
      try { onChange(JSON.parse(event.data) as ProjectChange); } catch { /* not a change */ }
    }, options);
  }

  async getActive(): Promise<ActiveProjectResponse> {
    const result = await this.http.get<ActiveProjectResponse>(`${BASE}/active`);
    return result ?? { activeProjectId: null, project: null };
  }

  setActive(id: string): Promise<{ project: ProjectDefinition } | undefined> {
    return this.http.put<{ project: ProjectDefinition }>(`${BASE}/active`, { id });
  }

  /** The server also accepts a whole team and its servers, which is how an import arrives. */
  createProject(
    input: { id?: string; name: string } & Partial<Pick<ProjectDefinition,
      'description' | 'goal' | 'humanName' | 'team' | 'mcpServers' | 'settings'>>,
  ): Promise<ProjectDefinition | undefined> {
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
