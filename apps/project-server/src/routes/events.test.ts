import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { mkdtemp, rm } from 'fs/promises';
import { tmpdir } from 'os';
import * as path from 'path';
import type { AddressInfo } from 'net';
import { startService, type RunningService } from '@hats/service-kit/index';
import { ProjectStore, type ProjectChange } from '../project-store.js';
import { eventRoutes } from './events.js';

let dir = '';
let store: ProjectStore;
let service: RunningService;
let base = '';

beforeAll(async () => {
  dir = await mkdtemp(path.join(tmpdir(), 'hats-events-'));
  store = new ProjectStore({
    definitionsDir: path.join(dir, 'definitions'),
    projectsRoot: path.join(dir, 'projects'),
    activeFile: path.join(dir, 'active.json'),
  });
  await store.load();
  service = await startService({ name: 'EventsTest', port: 0, routes: eventRoutes(store) });
  base = `http://127.0.0.1:${(service.server.address() as AddressInfo).port}`;
});

afterAll(async () => {
  service.server.closeAllConnections?.();
  service.server.close();
  await rm(dir, { recursive: true, force: true });
});

/** Open the stream and collect its events until `count` have arrived. */
async function listen(query: string, count: number, act: () => Promise<void>): Promise<ProjectChange[]> {
  const controller = new AbortController();
  const res = await fetch(`${base}/api/v1/events${query}`, { signal: controller.signal });
  expect(res.headers.get('content-type')).toContain('text/event-stream');
  const reader = res.body!.getReader();
  const decoder = new TextDecoder();
  const events: ProjectChange[] = [];
  let buffer = '';

  const reading = (async () => {
    while (events.length < count) {
      const { value, done } = await reader.read();
      if (done) break;
      buffer += decoder.decode(value, { stream: true });
      let end: number;
      while ((end = buffer.indexOf('\n\n')) >= 0) {
        const frame = buffer.slice(0, end);
        buffer = buffer.slice(end + 2);
        const data = frame.split('\n').find((l) => l.startsWith('data: '));
        if (data) events.push(JSON.parse(data.slice(6)) as ProjectChange);
      }
    }
  })();

  await act();
  await Promise.race([reading, new Promise((r) => setTimeout(r, 2_000))]);
  controller.abort();
  return events;
}

describe('GET /api/v1/events', () => {
  it('announces a saved project with its new revision, and a removed one', async () => {
    const events = await listen('', 3, async () => {
      const created = await store.create({ id: 'alpha', name: 'Alpha' });
      await store.update('alpha', { goal: 'ship it' }, created.revision);
      await store.remove('alpha', false);
    });
    expect(events).toEqual([
      { type: 'project_changed', id: 'alpha', revision: 1 },
      { type: 'project_changed', id: 'alpha', revision: 2 },
      { type: 'project_removed', id: 'alpha' },
    ]);
  });

  it('sends only the named project\'s events when asked', async () => {
    const events = await listen('?project=Beta', 1, async () => {
      await store.create({ id: 'gamma', name: 'Gamma' });
      await store.create({ id: 'beta', name: 'Beta' });
    });
    expect(events).toEqual([{ type: 'project_changed', id: 'beta', revision: 1 }]);
  });
});

describe('forProject', () => {
  it('sends a visit event to both of its teams, and nobody else', async () => {
    const { forProject } = await import('./events.js');
    const change = { type: 'visit_changed' as const, id: 'v1', home: 'ops', host: 'Billing', state: 'approved' as const };
    expect(forProject(change, 'OPS')).toBe(true);
    expect(forProject(change, 'billing')).toBe(true);
    expect(forProject(change, 'research')).toBe(false);
  });
});
