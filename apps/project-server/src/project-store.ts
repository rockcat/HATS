/**
 * Storage for project definitions.
 *
 * Definitions are validated on every write and every read-back. The store also
 * owns the "active project" pointer that tells the Team Runner what to load,
 * and creates each project's working folder so the runner has somewhere to put
 * its board, transcripts and outputs.
 */

import { mkdir, rm } from 'fs/promises';
import * as path from 'path';
import { JsonStore, readJsonFile, writeJsonFile } from '@hats/service-kit/json-store';
import {
  createProject, reviseProject, summariseProject,
  type CreateProjectInput,
} from '@hats/contracts/factories';
import { validateProject } from '@hats/contracts/validate';
import type { ProjectDefinition, ProjectSummary } from '@hats/contracts/types';

export class RevisionConflictError extends Error {
  readonly expected: number;
  readonly actual: number;
  constructor(expected: number, actual: number) {
    super(`Project has moved on: expected revision ${expected}, stored revision is ${actual}`);
    this.name = 'RevisionConflictError';
    this.expected = expected;
    this.actual = actual;
  }
}

export class ValidationError extends Error {
  readonly details: Array<{ path: string; message: string }>;
  constructor(details: Array<{ path: string; message: string }>) {
    super('Project failed schema validation');
    this.name = 'ValidationError';
    this.details = details;
  }
}

export interface ProjectStoreOptions {
  definitionsDir: string;
  projectsRoot: string;
  activeFile: string;
}

export class ProjectStore {
  private readonly store: JsonStore<ProjectDefinition>;
  private readonly projectsRoot: string;
  private readonly activeFile: string;
  private readonly invalid: Array<{ file: string; reason: string }> = [];
  private activeId: string | null = null;

  constructor(options: ProjectStoreOptions) {
    this.projectsRoot = options.projectsRoot;
    this.activeFile = options.activeFile;
    this.store = new JsonStore<ProjectDefinition>({
      dir: options.definitionsDir,
      keyOf: (p) => p.id,
      onInvalid: (file, reason) => this.invalid.push({ file, reason }),
    });
  }

  async load(): Promise<void> {
    await this.store.load();
    for (const project of this.store.list()) {
      const result = validateProject(project);
      if (!result.valid) {
        this.invalid.push({
          file: `${project.id}.json`,
          reason: result.errors.map((e) => `${e.path} ${e.message}`).join('; '),
        });
      }
    }
    const active = await readJsonFile<{ id: string | null }>(this.activeFile, { id: null });
    this.activeId = active.id && this.store.has(active.id) ? active.id : null;
    if (!this.activeId) {
      // Fall back to the most recently updated project so a fresh runner still boots.
      const [first] = this.listSummaries();
      this.activeId = first?.id ?? null;
    }
  }

  get invalidRecords(): ReadonlyArray<{ file: string; reason: string }> { return this.invalid; }
  get size(): number { return this.store.size; }
  get activeProjectId(): string | null { return this.activeId; }

  listSummaries(): ProjectSummary[] {
    return this.store.list()
      .sort((a, b) => b.updatedAt.localeCompare(a.updatedAt))
      .map((p) => summariseProject(p, p.id === this.activeId));
  }

  get(id: string): ProjectDefinition | undefined { return this.store.get(id); }

  has(id: string): boolean { return this.store.has(id); }

  projectDir(id: string): string { return path.join(this.projectsRoot, id); }

  async create(input: CreateProjectInput): Promise<ProjectDefinition> {
    const project = createProject(input);
    await this.ensureProjectFolders(project.id);
    const saved = await this.persist(project);
    if (!this.activeId) await this.setActive(saved.id);
    return saved;
  }

  /**
   * Replace or merge a definition. `expectedRevision` makes the write
   * conditional so two editors cannot silently overwrite each other.
   */
  async update(
    id: string,
    next: Partial<ProjectDefinition>,
    expectedRevision?: number,
  ): Promise<ProjectDefinition | undefined> {
    const current = this.store.get(id);
    if (!current) return undefined;
    if (expectedRevision !== undefined && expectedRevision !== current.revision) {
      throw new RevisionConflictError(expectedRevision, current.revision);
    }
    return this.persist(reviseProject(current, next));
  }

  async remove(id: string, purge: boolean): Promise<boolean> {
    const removed = await this.store.remove(id);
    if (!removed) return false;
    if (purge) await rm(this.projectDir(id), { recursive: true, force: true }).catch(() => {});
    if (this.activeId === id) {
      const [next] = this.listSummaries();
      await this.setActive(next?.id ?? null);
    }
    return true;
  }

  async setActive(id: string | null): Promise<boolean> {
    if (id !== null && !this.store.has(id)) return false;
    this.activeId = id;
    await writeJsonFile(this.activeFile, { id, selectedAt: new Date().toISOString() });
    return true;
  }

  async ensureProjectFolders(id: string): Promise<void> {
    const dir = this.projectDir(id);
    await mkdir(path.join(dir, 'sources'), { recursive: true });
    await mkdir(path.join(dir, 'outputs', 'minutes'), { recursive: true });
  }

  private async persist(project: ProjectDefinition): Promise<ProjectDefinition> {
    const result = validateProject(project);
    if (!result.valid) throw new ValidationError(result.errors);
    return this.store.put(project);
  }
}
