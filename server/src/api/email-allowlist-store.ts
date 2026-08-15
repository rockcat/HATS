import { readFile, writeFile } from 'fs/promises';

export interface EmailAllowlistEntry {
  email: string;
  status: 'pending' | 'approved' | 'rejected';
  requestedBy: string;
  reason?: string;
  requestedAt: string;
  approvedAt?: string;
  /** Set when the requesting agent has been notified of the approval/rejection — prevents re-reporting. */
  notifiedAt?: string;
}

export class EmailAllowlistStore {
  filePath: string | null;
  private entries = new Map<string, EmailAllowlistEntry>();

  constructor(filePath: string | null) {
    this.filePath = filePath;
  }

  async load(): Promise<void> {
    if (!this.filePath) return;
    try {
      const raw   = await readFile(this.filePath, 'utf-8');
      const items = JSON.parse(raw) as EmailAllowlistEntry[];
      this.entries.clear();
      for (const e of items) this.entries.set(e.email.toLowerCase(), e);
    } catch { /* file doesn't exist yet — start empty */ }
  }

  async switchTo(filePath: string): Promise<void> {
    this.filePath = filePath;
    this.entries.clear();
    await this.load();
  }

  list(): EmailAllowlistEntry[] {
    const order: Record<EmailAllowlistEntry['status'], number> = { approved: 0, pending: 1, rejected: 2 };
    return [...this.entries.values()].sort(
      (a, b) => (order[a.status] - order[b.status]) || a.email.localeCompare(b.email),
    );
  }

  get(email: string): EmailAllowlistEntry | undefined {
    return this.entries.get(email.toLowerCase());
  }

  isApproved(email: string): boolean {
    return this.entries.get(email.toLowerCase())?.status === 'approved';
  }

  /** Synchronous check used by tool-executor intercept. */
  isBlocked(email: string): boolean {
    return !this.isApproved(email);
  }

  async add(entry: EmailAllowlistEntry): Promise<void> {
    this.entries.set(entry.email.toLowerCase(), { ...entry, email: entry.email.toLowerCase() });
    await this.save();
  }

  async approve(email: string): Promise<EmailAllowlistEntry | undefined> {
    const entry = this.entries.get(email.toLowerCase());
    if (!entry) return undefined;
    entry.status    = 'approved';
    entry.approvedAt = new Date().toISOString();
    await this.save();
    return entry;
  }

  async reject(email: string): Promise<EmailAllowlistEntry | undefined> {
    const entry = this.entries.get(email.toLowerCase());
    if (!entry) return undefined;
    entry.status = 'rejected';
    await this.save();
    return entry;
  }

  async markNotified(emails: string[]): Promise<void> {
    const now = new Date().toISOString();
    let changed = false;
    for (const e of emails) {
      const entry = this.entries.get(e.toLowerCase());
      if (entry && !entry.notifiedAt) { entry.notifiedAt = now; changed = true; }
    }
    if (changed) await this.save();
  }

  async delete(email: string): Promise<boolean> {
    const deleted = this.entries.delete(email.toLowerCase());
    if (deleted) await this.save();
    return deleted;
  }

  private async save(): Promise<void> {
    if (!this.filePath) return;
    await writeFile(this.filePath, JSON.stringify(this.list(), null, 2), 'utf-8');
  }
}
