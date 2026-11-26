// Export a project to one zip, and import one.
//
//   GET  /api/projects/:id/export[?credentials=true]   → application/zip
//   POST /api/projects/import[?as=<new id>]             ← application/zip
//
// Both are admin-only: an export can carry an agent's mail password, and an
// import writes into the library, the credentials file and the data directory.

import type { IncomingMessage, ServerResponse } from 'http';
import { log } from '../../../packages/core/src/logger.js';
import { ArchiveError } from '../project/project-archive.js';
import {
  exportProject, importProject, TransferConflict, TransferNotFound, type TransferDeps,
} from '../project/project-transfer.js';
import { AgentLibraryClient } from '../../../packages/clients/src/agent-library-client.js';
import { ProjectServerClient } from '../../../packages/clients/src/project-server-client.js';
import { runtimeDir } from '../../../packages/core/src/runtime-dir.js';
import type { AgentDefinitionStore } from './agent-store.js';
import type { ScheduledActionStore } from './scheduled-action-store.js';

/** Long enough for a large template or definition; these are local services. */
const SERVICE_TIMEOUT_MS = 30_000;

/** What a transfer needs from a running runner, or null if it lacks any of it. */
export function transferDepsFrom(source: {
  projectServerUrl: string | null;
  agentLibraryUrl: string | null;
  projectsRoot: string | null;
  agentStore: AgentDefinitionStore | null;
  actionStore: ScheduledActionStore | null;
}): TransferDeps | null {
  const { projectServerUrl, agentLibraryUrl, projectsRoot, agentStore, actionStore } = source;
  if (!projectServerUrl || !agentLibraryUrl || !projectsRoot || !actionStore) return null;
  if (!agentStore?.secretsFor || !agentStore.setSecrets) return null;
  return {
    projectsRoot,
    dataRoot: runtimeDir(),
    projectServer: new ProjectServerClient(projectServerUrl, SERVICE_TIMEOUT_MS),
    library: new AgentLibraryClient(agentLibraryUrl, SERVICE_TIMEOUT_MS),
    secrets: {
      get: (id) => agentStore.secretsFor!(id),
      set: (id, secrets) => agentStore.setSecrets!(id, secrets),
    },
    actions: actionStore,
  };
}

export interface ProjectTransferRouterDeps {
  /** Null when the runner has no Project Server or Agent Library to move a project between. */
  getTransfer(): TransferDeps | null;
  getProjectId(): string;
  saveCurrentState(): Promise<void>;
  /** Re-read the library so imported agents appear without a restart. */
  reloadAgents(): Promise<void>;
  /** True if the request comes from an admin. */
  isAdmin(req: IncomingMessage): boolean;
  json(res: ServerResponse, status: number, body: unknown): void;
  readBodyBuffer(req: IncomingMessage): Promise<Buffer>;
}

const EXPORT = /^\/api\/projects\/([^/]+)\/export$/;

export class ProjectTransferRouter {
  constructor(private readonly deps: ProjectTransferRouterDeps) {}

  async handleRoutes(pathname: string, method: string, url: URL, req: IncomingMessage, res: ServerResponse): Promise<boolean> {
    const exportMatch = method === 'GET' ? EXPORT.exec(pathname) : null;
    const isImport = method === 'POST' && pathname === '/api/projects/import';
    if (!exportMatch && !isImport) return false;

    const { json } = this.deps;
    if (!this.deps.isAdmin(req)) {
      json(res, 403, { error: 'Only an admin can export or import a project' });
      return true;
    }
    const transfer = this.deps.getTransfer();
    if (!transfer) {
      json(res, 503, { error: 'Moving projects needs the Project Server and Agent Library' });
      return true;
    }

    try {
      if (exportMatch) await this.export(transfer, decodeURIComponent(exportMatch[1]!), url, res);
      else await this.import(transfer, url, req, res);
    } catch (err) {
      const status = err instanceof TransferNotFound ? 404
        : err instanceof TransferConflict ? 409
        : err instanceof ArchiveError ? 400
        : 500;
      if (status === 500) log.error(`[Transfer] ${(err as Error).stack ?? err}`);
      json(res, status, { error: (err as Error).message });
    }
    return true;
  }

  private async export(transfer: TransferDeps, id: string, url: URL, res: ServerResponse): Promise<void> {
    // The running project's state is in memory until it is saved.
    if (id === this.deps.getProjectId()) await this.deps.saveCurrentState();

    const includeCredentials = url.searchParams.get('credentials') === 'true';
    const { bytes, manifest } = await exportProject(transfer, id, { includeCredentials });
    log.info(`[Transfer] Exported ${id}: ${manifest.agents.length} agent(s), ${(bytes.length / 1e6).toFixed(1)} MB`
      + (includeCredentials ? ', with credentials' : ''));

    res.writeHead(200, {
      'Content-Type': 'application/zip',
      'Content-Length': bytes.length,
      'Content-Disposition': `attachment; filename="${id.replace(/[^A-Za-z0-9_-]/g, '_')}.hats.zip"`,
    });
    res.end(Buffer.from(bytes.buffer, bytes.byteOffset, bytes.byteLength));
  }

  private async import(transfer: TransferDeps, url: URL, req: IncomingMessage, res: ServerResponse): Promise<void> {
    const body = await this.deps.readBodyBuffer(req);
    if (body.length === 0) { this.deps.json(res, 400, { error: 'Send the exported zip as the request body' }); return; }

    const as = url.searchParams.get('as') ?? undefined;
    const report = await importProject(transfer, new Uint8Array(body), as !== undefined ? { as } : {});
    await this.deps.reloadAgents();
    log.info(`[Transfer] Imported ${report.projectId}`);
    this.deps.json(res, 201, report);
  }
}
