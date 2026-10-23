/**
 * Where the Team Runner gets its project definition from.
 *
 * Preferred source is the Project Server. When it is not running — or the
 * operator has asked for standalone mode — the runner falls back to the local
 * project folder exactly as it behaved before the split, so a single-machine
 * install still works with nothing else started.
 */

import * as path from 'path';
import { ProjectServerClient } from '../../../packages/clients/src/project-server-client.js';
import type { ProjectDefinition } from '../../../packages/contracts/src/types.js';
import { log } from '../../../packages/core/src/logger.js';

export interface ProjectSourceOptions {
  /** Base URL of the Project Server, or null to stay standalone. */
  projectServerUrl: string | null;
  /** Explicit project id from CLI/env; when absent the server's active project wins. */
  requestedProjectId?: string | undefined;
  projectsRoot: string;
  /** Used when no project server is available. */
  fallbackProjectId: string;
}

export interface ResolvedProjectSource {
  projectId: string;
  projectName: string;
  projectDir: string;
  source: 'project-server' | 'local';
  /** Present only when the definition came from the Project Server. */
  definition: ProjectDefinition | null;
  client: ProjectServerClient | null;
}

export async function resolveProjectSource(options: ProjectSourceOptions): Promise<ResolvedProjectSource> {
  const local = (id: string): ResolvedProjectSource => ({
    projectId: id,
    projectName: id,
    projectDir: path.join(options.projectsRoot, id),
    source: 'local',
    definition: null,
    client: null,
  });

  if (!options.projectServerUrl) {
    log.info('[Project] Standalone mode — reading the project from local disk');
    return local(options.requestedProjectId ?? options.fallbackProjectId);
  }

  const client = new ProjectServerClient(options.projectServerUrl);
  if (!(await client.isHealthy())) {
    log.warn(`[Project] Project Server at ${options.projectServerUrl} is not answering — falling back to local disk`);
    return local(options.requestedProjectId ?? options.fallbackProjectId);
  }

  try {
    const definition = options.requestedProjectId
      ? await client.getProject(options.requestedProjectId)
      : (await client.getActive()).project ?? undefined;

    if (!definition) {
      const what = options.requestedProjectId ? `project "${options.requestedProjectId}"` : 'an active project';
      log.warn(`[Project] Project Server has no ${what} — falling back to local disk`);
      return local(options.requestedProjectId ?? options.fallbackProjectId);
    }

    log.info(`[Project] Loaded "${definition.name}" (rev ${definition.revision}, ${definition.team.length} agent(s)) from ${options.projectServerUrl}`);
    return {
      projectId: definition.id,
      projectName: definition.name,
      projectDir: path.join(options.projectsRoot, definition.id),
      source: 'project-server',
      definition,
      client,
    };
  } catch (err) {
    log.warn(`[Project] Could not read from the Project Server: ${(err as Error).message} — falling back to local disk`);
    return local(options.requestedProjectId ?? options.fallbackProjectId);
  }
}
