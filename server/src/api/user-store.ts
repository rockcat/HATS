import { pbkdf2Sync, randomBytes } from 'crypto';
import { mkdir, readFile, writeFile } from 'fs/promises';
import * as path from 'path';

const ITERATIONS = 100_000;
const KEY_LEN    = 64;
const DIGEST     = 'sha512' as const;

export interface ApiKey {
  id:        string;
  key:       string;
  label:     string;
  createdAt: string;
  lastUsed?: string;
}

export interface User {
  id:           string;
  username:     string;
  passwordHash: string;
  passwordSalt: string;
  role:         'admin' | 'user';
  apiKeys:      ApiKey[];
  createdAt:    string;
}

export interface PublicUser {
  id:       string;
  username: string;
  role:     'admin' | 'user';
  apiKeys:  Array<{ id: string; label: string; createdAt: string; lastUsed?: string }>;
  createdAt: string;
}

export class UserStore {
  private users: User[] = [];

  constructor(private readonly filePath: string) {}

  async load(): Promise<void> {
    try {
      this.users = JSON.parse(await readFile(this.filePath, 'utf-8')) as User[];
    } catch {
      this.users = [];
    }
  }

  private async persist(): Promise<void> {
    await mkdir(path.dirname(this.filePath), { recursive: true });
    await writeFile(this.filePath, JSON.stringify(this.users, null, 2), 'utf-8');
  }

  isEmpty(): boolean { return this.users.length === 0; }
  getAll():  User[]  { return this.users; }
  getById(id: string): User | undefined { return this.users.find(u => u.id === id); }

  toPublic(u: User): PublicUser {
    return {
      id: u.id, username: u.username, role: u.role, createdAt: u.createdAt,
      apiKeys: u.apiKeys.map(k => ({ id: k.id, label: k.label, createdAt: k.createdAt, lastUsed: k.lastUsed })),
    };
  }

  async createUser(username: string, password: string, role: 'admin' | 'user' = 'user'): Promise<User> {
    if (this.users.find(u => u.username.toLowerCase() === username.toLowerCase()))
      throw new Error(`User "${username}" already exists`);
    const salt = randomBytes(32).toString('hex');
    const user: User = {
      id: randomBytes(8).toString('hex'),
      username,
      passwordHash: pbkdf2Sync(password, salt, ITERATIONS, KEY_LEN, DIGEST).toString('hex'),
      passwordSalt: salt,
      role,
      apiKeys: [],
      createdAt: new Date().toISOString(),
    };
    this.users.push(user);
    await this.persist();
    return user;
  }

  async verifyPassword(username: string, password: string): Promise<User | null> {
    const u = this.users.find(u => u.username.toLowerCase() === username.toLowerCase());
    if (!u) return null;
    const hash = pbkdf2Sync(password, u.passwordSalt, ITERATIONS, KEY_LEN, DIGEST).toString('hex');
    return hash === u.passwordHash ? u : null;
  }

  getUserByApiKey(key: string): User | null {
    for (const u of this.users) {
      const k = u.apiKeys.find(k => k.key === key);
      if (k) { k.lastUsed = new Date().toISOString(); this.persist().catch(() => {}); return u; }
    }
    return null;
  }

  async createApiKey(userId: string, label = 'Mobile device'): Promise<ApiKey> {
    const u = this.getById(userId);
    if (!u) throw new Error('User not found');
    const key: ApiKey = {
      id: randomBytes(8).toString('hex'),
      key: randomBytes(32).toString('hex'),
      label,
      createdAt: new Date().toISOString(),
    };
    u.apiKeys.push(key);
    await this.persist();
    return key;
  }

  async revokeApiKey(userId: string, keyId: string): Promise<void> {
    const u = this.getById(userId);
    if (!u) throw new Error('User not found');
    u.apiKeys = u.apiKeys.filter(k => k.id !== keyId);
    await this.persist();
  }

  async updatePassword(userId: string, newPassword: string): Promise<void> {
    const u = this.getById(userId);
    if (!u) throw new Error('User not found');
    const salt = randomBytes(32).toString('hex');
    u.passwordHash = pbkdf2Sync(newPassword, salt, ITERATIONS, KEY_LEN, DIGEST).toString('hex');
    u.passwordSalt = salt;
    await this.persist();
  }

  async updateRole(userId: string, role: 'admin' | 'user'): Promise<void> {
    const u = this.getById(userId);
    if (!u) throw new Error('User not found');
    u.role = role;
    await this.persist();
  }

  async deleteUser(userId: string): Promise<void> {
    const idx = this.users.findIndex(u => u.id === userId);
    if (idx < 0) throw new Error('User not found');
    this.users.splice(idx, 1);
    await this.persist();
  }
}
