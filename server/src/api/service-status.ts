/**
 * Which external services the runner can reach right now.
 *
 * Every one of them is optional — the runner falls back to local files without
 * the Agent Library or Project Server, stays silent without the Speech Service,
 * and only needs a local model server if an agent is pointed at one. That is
 * what makes a missing service easy to miss, so the dashboard shows each one.
 */

import { IncomingMessage, ServerResponse } from 'http';
import { AgentLibraryClient } from '../../../packages/clients/src/agent-library-client.js';
import { ProjectServerClient } from '../../../packages/clients/src/project-server-client.js';
import { KNOWN_PROVIDERS } from '../../../packages/core/src/providers.js';

const PROBE_TIMEOUT_MS = 3_000;
const CACHE_MS = 10_000;

export interface ServiceTarget {
  id: string;
  label: string;
  /** Null when the runner was told not to use this service (standalone). */
  url: string | null;
  /** A page a person can open for it, if it has one. */
  openUrl?: string | null;
  probe(url: string): Promise<boolean>;
}

export interface ServiceStatus {
  id: string;
  label: string;
  url: string | null;
  openUrl: string | null;
  enabled: boolean;
  connected: boolean;
}

export interface ServiceUrls {
  agentLibraryUrl: string | null;
  projectServerUrl: string | null;
  speechServiceUrl: string;
}

/** An OpenAI-compatible model server is up when it lists its models. */
async function modelServerAnswers(baseUrl: string): Promise<boolean> {
  try {
    const res = await fetch(`${baseUrl.replace(/\/$/, '')}/models`, { signal: AbortSignal.timeout(PROBE_TIMEOUT_MS) });
    return res.ok;
  } catch {
    return false;
  }
}

/**
 * The Project Server is API-only; the page for projects is the Project Designer.
 * Without PROJECT_DESIGNER_URL it is assumed to sit beside the Project Server,
 * on PROJECT_DESIGNER_PORT (3030 by default).
 */
export function designerUrl(projectServerUrl: string | null, env: Record<string, string | undefined>): string | null {
  if (env['PROJECT_DESIGNER_URL']) return env['PROJECT_DESIGNER_URL'];
  if (!projectServerUrl) return null;
  try {
    const u = new URL(projectServerUrl);
    u.port = env['PROJECT_DESIGNER_PORT'] ?? '3030';
    u.pathname = '/';
    return u.toString();
  } catch {
    return null;
  }
}

/**
 * The services to show. Local model servers appear only when configured: the
 * provider list gives every one a default URL, and a dot that is always red
 * for a server nobody runs would only teach people to ignore the row.
 */
export function serviceTargets(
  urls: ServiceUrls,
  speechProbe: () => Promise<boolean>,
  env: Record<string, string | undefined>,
): ServiceTarget[] {
  const targets: ServiceTarget[] = [
    {
      id: 'agent-library', label: 'Agent Library', url: urls.agentLibraryUrl,
      openUrl: env['AGENT_LIBRARY_PUBLIC_URL'] ?? urls.agentLibraryUrl,
      probe: (url) => new AgentLibraryClient(url, PROBE_TIMEOUT_MS).isHealthy(),
    },
    {
      id: 'project-server', label: 'Project Designer', url: urls.projectServerUrl,
      openUrl: designerUrl(urls.projectServerUrl, env),
      probe: (url) => new ProjectServerClient(url, PROBE_TIMEOUT_MS).isHealthy(),
    },
    { id: 'speech', label: 'Speech', url: urls.speechServiceUrl, probe: () => speechProbe() },
  ];

  for (const provider of KNOWN_PROVIDERS) {
    if (!('baseUrlEnvKey' in provider)) continue;
    const url = env[provider.baseUrlEnvKey];
    if (!url) continue;
    targets.push({
      id: provider.id, label: provider.label.replace(/\s*\(local\)$/, ''), url,
      probe: modelServerAnswers,
    });
  }
  return targets;
}

export async function probeServices(targets: ServiceTarget[]): Promise<ServiceStatus[]> {
  return Promise.all(targets.map(async (t) => ({
    id: t.id,
    label: t.label,
    url: t.url,
    openUrl: t.url !== null ? (t.openUrl ?? null) : null,
    enabled: t.url !== null,
    connected: t.url !== null && await t.probe(t.url).catch(() => false),
  })));
}

export interface ServiceStatusRouterDeps {
  targets(): ServiceTarget[];
  json(res: ServerResponse, status: number, body: unknown): void;
}

export class ServiceStatusRouter {
  private deps: ServiceStatusRouterDeps;
  private cached: { at: number; result: Promise<ServiceStatus[]> } | null = null;

  constructor(deps: ServiceStatusRouterDeps) {
    this.deps = deps;
  }

  async handleRoutes(pathname: string, method: string, _req: IncomingMessage, res: ServerResponse): Promise<boolean> {
    if (pathname !== '/api/services' || method !== 'GET') return false;

    // Every open dashboard polls this; share one round of probes between them.
    if (!this.cached || Date.now() - this.cached.at > CACHE_MS) {
      this.cached = { at: Date.now(), result: probeServices(this.deps.targets()) };
    }
    this.deps.json(res, 200, await this.cached.result);
    return true;
  }
}
