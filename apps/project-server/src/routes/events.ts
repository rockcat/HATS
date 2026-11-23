/**
 * Telling runners the moment a project changes.
 *
 *   GET /api/v1/events[?project=<id>]   a stream of server-sent events
 *
 * Each event names a project and, when it was saved, its new revision:
 * enough for a runner to fetch it again, so the stream never carries a
 * definition itself. With `project`, only that project's events are sent.
 */

import { get, SseHub, type Route } from '@hats/service-kit/index';
import type { ProjectChange, ProjectStore } from '../project-store.js';

const BASE = '/api/v1';

/** Whether `change` concerns `project`: a visit concerns both its teams. */
export function forProject(change: ProjectChange, project: string): boolean {
  const p = project.toLowerCase();
  if (change.type === 'visit_changed') return change.home.toLowerCase() === p || change.host.toLowerCase() === p;
  return change.id.toLowerCase() === p;
}

export function eventRoutes(store: ProjectStore): Route[] {
  const hub = new SseHub<ProjectChange, string>(forProject);
  store.onChange((change) => hub.broadcast(change));

  return [
    get(`${BASE}/events`, ({ res, query }) => {
      hub.subscribe(res, query.get('project')?.trim() || null);
    }),
  ];
}
