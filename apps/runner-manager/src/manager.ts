// ── Starting and stopping runners ────────────────────────────────────────────

import { mkdir, readFile } from 'fs/promises';
import * as path from 'path';
import type { Docker } from './docker.js';
import { Registry, freePort } from './registry.js';
import { containerName, parseEnvFile, projectProblem, runnerSpec } from './runner-spec.js';
import type { RunnerInfo } from './types.js';

export interface ManagerOptions {
  docker: Pick<Docker, 'self' | 'runners' | 'create' | 'start' | 'stop' | 'remove'>;
  registry: Registry;
  /** This container's id: Docker names it after it unless told otherwise. */
  selfId: string;
  /** The shared data folder, as this container sees it. */
  dataDir: string;
  /** The runner image, the same one the installation's own runner uses. */
  image: string;
  ports: { from: number; to: number };
  /** The installation's .env, mounted read-only, or null for none. */
  envFile: string | null;
  /** Fixed for every runner: where the services are, and how to report in. */
  overrides: Record<string, string>;
  /** Project ids and names from the Project Server. */
  listProjects: () => Promise<Array<{ id: string; name: string }>>;
}

export class LaunchError extends Error {
  constructor(readonly status: number, message: string) { super(message); }
}

/** One row of the dashboard's project list: a project, and its runner if any. */
export interface ProjectRow { id: string; name: string; runner: RunnerInfo | null }

export class RunnerManager {
  constructor(private readonly o: ManagerOptions) {}

  async runners(): Promise<RunnerInfo[]> {
    return this.o.registry.list(await this.o.docker.runners().catch(() => []));
  }

  /**
   * Every project, with its runner. A runner whose project the Project Server
   * does not know (a source checkout's local project, say) is listed too.
   */
  async overview(): Promise<ProjectRow[]> {
    const [runners, projects] = await Promise.all([this.runners(), this.o.listProjects().catch(() => [])]);
    const byProject = new Map(runners.map((r) => [r.project.toLowerCase(), r]));
    const rows: ProjectRow[] = projects.map((p) => {
      const runner = byProject.get(p.id.toLowerCase()) ?? null;
      byProject.delete(p.id.toLowerCase());
      return { id: p.id, name: p.name, runner };
    });
    for (const r of byProject.values()) rows.push({ id: r.project, name: r.project, runner: r });
    return rows.sort((a, b) => a.name.localeCompare(b.name));
  }

  async launch(project: string): Promise<RunnerInfo> {
    const problem = projectProblem(project);
    if (problem) throw new LaunchError(400, problem);

    const runners = await this.runners();
    const existing = runners.find((r) => r.project.toLowerCase() === project.toLowerCase());
    // A stopped runner of this manager's is replaced. Any other would leave
    // two runners writing one project's state if the first came back.
    if (existing?.managed && existing.status === 'stopped') {
      await this.remove(project);
    } else if (existing?.status === 'unreachable') {
      throw new LaunchError(409, `${project} has a runner on port ${existing.port} that is not answering. Start that one again instead.`);
    } else if (existing) {
      throw new LaunchError(409, `${project} already has a runner, on port ${existing.port}.`);
    }
    const others = runners.filter((r) => r !== existing);
    const port = freePort(others.map((r) => r.port), this.o.ports.from, this.o.ports.to);
    if (port === null) throw new LaunchError(503, `No free port between ${this.o.ports.from} and ${this.o.ports.to}.`);

    const { hostData, network } = await this.o.docker.self(this.o.selfId, this.o.dataDir);
    // Made here rather than left to Docker, which would create them as root.
    for (const dir of [['runners', project], ['projects', project], ['avatars']]) {
      await mkdir(path.join(this.o.dataDir, ...dir), { recursive: true });
    }
    const settings = this.o.envFile ? parseEnvFile(await readFile(this.o.envFile, 'utf8').catch(() => '')) : {};

    const id = await this.o.docker.create(containerName(project), runnerSpec({
      project, port, image: this.o.image, hostData, network, settings, overrides: this.o.overrides,
    }));
    await this.o.docker.start(id);
    return { project, port, status: 'starting', managed: true };
  }

  /** Stop and remove a runner this manager started. Its data folder stays. */
  async remove(project: string): Promise<void> {
    const container = (await this.o.docker.runners()).find((c) => c.project.toLowerCase() === project.toLowerCase());
    if (!container) throw new LaunchError(404, `No runner this manager started is running ${project}.`);
    await this.o.docker.remove(container.id);
    this.o.registry.forget(project);
  }
}
