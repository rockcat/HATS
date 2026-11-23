// ── Docker, over its socket ──────────────────────────────────────────────────
//
// Only the handful of Engine API calls the manager needs, over Node's own
// http, so there is no client library to keep up with. Unversioned paths:
// the engine answers them with its current API version.
//
// Whoever holds this socket can do anything on the host, which is why the
// manager only ever starts containers from one image, with the settings
// runner-spec.ts builds, and only for a signed-in admin.

import { request } from 'http';
import type { ManagedContainer } from './types.js';
import { LABELS, STOP_TIMEOUT_S } from './runner-spec.js';

export class DockerError extends Error {
  constructor(readonly status: number, message: string) { super(message); }
}

export class Docker {
  constructor(private readonly socketPath = '/var/run/docker.sock') {}

  private call<T>(method: string, path: string, body?: unknown): Promise<T> {
    const payload = body === undefined ? undefined : JSON.stringify(body);
    return new Promise((resolve, reject) => {
      const req = request({
        socketPath: this.socketPath, method, path,
        headers: payload ? { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(payload) } : {},
      }, (res) => {
        const chunks: Buffer[] = [];
        res.on('data', (c: Buffer) => chunks.push(c));
        res.on('end', () => {
          const text = Buffer.concat(chunks).toString('utf8');
          const status = res.statusCode ?? 0;
          if (status >= 400) {
            let message = text;
            try { message = (JSON.parse(text) as { message?: string }).message ?? text; } catch { /* plain text */ }
            reject(new DockerError(status, message));
            return;
          }
          try { resolve((text ? JSON.parse(text) : undefined) as T); } catch { resolve(undefined as T); }
        });
      });
      req.on('error', (err) => reject(new DockerError(0, `Docker is not reachable at ${this.socketPath}: ${err.message}`)));
      if (payload) req.write(payload);
      req.end();
    });
  }

  /**
   * Where this container's data folder is on the host, and the network it is
   * on. A launched runner binds the same host folder and joins the same
   * network, so nothing about the installation has to be configured twice.
   */
  async self(containerId: string, dataDir: string): Promise<{ hostData: string; network: string }> {
    const info = await this.call<{
      Mounts?: Array<{ Source: string; Destination: string }>;
      NetworkSettings?: { Networks?: Record<string, unknown> };
    }>('GET', `/containers/${encodeURIComponent(containerId)}/json`);
    const mount = info.Mounts?.find((m) => m.Destination.replace(/\/$/, '') === dataDir.replace(/\/$/, ''));
    const network = Object.keys(info.NetworkSettings?.Networks ?? {})[0];
    if (!mount) throw new DockerError(0, `${dataDir} is not mounted from the host, so a runner could not share it.`);
    if (!network) throw new DockerError(0, 'This container is on no network a runner could join.');
    return { hostData: mount.Source, network };
  }

  /** Every runner container this manager started, running or not. */
  async runners(): Promise<ManagedContainer[]> {
    const filters = encodeURIComponent(JSON.stringify({ label: [`${LABELS.managed}=1`] }));
    const list = await this.call<Array<{ Id: string; State: string; Labels: Record<string, string> }>>(
      'GET', `/containers/json?all=1&filters=${filters}`);
    return list.map((c) => ({
      id: c.Id,
      project: c.Labels[LABELS.project] ?? '',
      port: Number(c.Labels[LABELS.port] ?? 0),
      running: c.State === 'running',
    })).filter((c) => c.project && c.port);
  }

  async create(name: string, spec: Record<string, unknown>): Promise<string> {
    const made = await this.call<{ Id: string }>('POST', `/containers/create?name=${encodeURIComponent(name)}`, spec);
    return made.Id;
  }

  start(id: string): Promise<void> { return this.call('POST', `/containers/${encodeURIComponent(id)}/start`); }
  /**
   * Ask the container to stop, killing it after `STOP_TIMEOUT_S`. A runner
   * spends up to 20 seconds letting turns in progress finish before it saves,
   * so this must be longer. A container stopped this way stays stopped
   * whatever its restart policy, until it is started again.
   */
  stop(id: string): Promise<void> {
    return this.call('POST', `/containers/${encodeURIComponent(id)}/stop?t=${STOP_TIMEOUT_S}`);
  }
  remove(id: string): Promise<void> { return this.call('DELETE', `/containers/${encodeURIComponent(id)}?force=true`); }
}
