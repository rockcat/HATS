import { readFile, writeFile } from 'fs/promises';
import { HumanRequest } from '../orchestrator/types.js';

export class HumanRequestStore {
  filePath: string | null;
  private requests = new Map<string, HumanRequest>();

  constructor(filePath: string | null) {
    this.filePath = filePath;
  }

  async load(): Promise<void> {
    if (!this.filePath) return;
    try {
      const raw   = await readFile(this.filePath, 'utf-8');
      const items = JSON.parse(raw) as HumanRequest[];
      this.requests.clear();
      for (const r of items) this.requests.set(r.id, r);
    } catch { /* file doesn't exist yet — start empty */ }
  }

  /** Switch to a new project's file, clearing in-memory state. */
  async switchTo(filePath: string): Promise<void> {
    this.filePath = filePath;
    this.requests.clear();
    await this.load();
  }

  list(): HumanRequest[] {
    const all     = [...this.requests.values()];
    const pending = all
      .filter(r => r.status === 'pending')
      .sort((a, b) =>
        (b.urgency === 'high' ? 1 : 0) - (a.urgency === 'high' ? 1 : 0) ||
        a.createdAt.localeCompare(b.createdAt),
      );
    const answered = all
      .filter(r => r.status === 'answered')
      .sort((a, b) => (b.answeredAt ?? '').localeCompare(a.answeredAt ?? ''));
    return [...pending, ...answered];
  }

  get(id: string): HumanRequest | undefined {
    return this.requests.get(id);
  }

  /** Add a request. The Map.set is synchronous so list() reflects it immediately. */
  async add(request: HumanRequest): Promise<void> {
    this.requests.set(request.id, request);
    await this.save();
  }

  async respond(id: string, response: string): Promise<HumanRequest | undefined> {
    const request = this.requests.get(id);
    if (!request) return undefined;
    request.status      = 'answered';
    request.response    = response;
    request.answeredAt  = new Date().toISOString();
    await this.save();
    return request;
  }

  async remove(id: string): Promise<boolean> {
    const deleted = this.requests.delete(id);
    if (deleted) await this.save();
    return deleted;
  }

  async clearAnswered(): Promise<void> {
    for (const [id, r] of this.requests) {
      if (r.status === 'answered') this.requests.delete(id);
    }
    await this.save();
  }

  async clear(): Promise<void> {
    this.requests.clear();
    await this.save();
  }

  private async save(): Promise<void> {
    if (!this.filePath) return;
    await writeFile(this.filePath, JSON.stringify(this.list(), null, 2), 'utf-8');
  }
}
