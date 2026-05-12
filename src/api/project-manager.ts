import { IncomingMessage, ServerResponse } from 'http';
import { spawn } from 'child_process';
import { readFile, writeFile, mkdir, readdir, stat } from 'fs/promises';
import * as path from 'path';
import { TeamOrchestrator } from '../orchestrator/orchestrator.js';
import { TelemetryStore } from '../store/telemetry-store.js';
import { readEnvFile, writeEnvFile } from './env-manager.js';
import { listFilesRecursive } from './api-utils.js';
import { log } from '../util/logger.js';

export interface AgentStatus {
  name: string; hatType: string; state: string; activity: string;
  talkingTo?: string; model?: string; provider?: string;
  specialisation?: string; visualDescription?: string; backstory?: string;
  avatar?: string; voice?: string; speakerName?: string; enabledMcpServers?: string[];
}

export interface ProjectManagerDeps {
  getOrchestrator(): TeamOrchestrator;
  getProjectDir(): string | null;
  setProjectDir(dir: string | null): void;
  getProjectId(): string;
  setProjectId(id: string): void;
  getProjectsRoot(): string | null;
  getEnvPath(): string;
  switchProject(newId: string): Promise<void>;
  buildAgentStatuses(): AgentStatus[];
  readTickets(): Promise<unknown[]>;
  saveCurrentState(): Promise<void>;
  avatarsDir: string;
  backgroundsDir: string;
  sseBroadcast(data: object): void;
  json(res: ServerResponse, status: number, body: unknown): void;
  readBody(req: IncomingMessage): Promise<string>;
  readBodyBuffer(req: IncomingMessage): Promise<Buffer>;
}

export class ProjectManager {
  private deps: ProjectManagerDeps;
  telemetry: TelemetryStore | null = null;

  constructor(deps: ProjectManagerDeps) {
    this.deps = deps;
  }

  metaFilePath(): string | null {
    const dir = this.deps.getProjectDir();
    return dir ? path.join(dir, 'project-meta.json') : null;
  }

  async readProjectMeta(): Promise<Record<string, string>> {
    const fp = this.metaFilePath();
    if (!fp) return {};
    try { return JSON.parse(await readFile(fp, 'utf-8')) as Record<string, string>; }
    catch { return {}; }
  }

  async writeProjectMeta(meta: Record<string, string>): Promise<void> {
    const fp = this.metaFilePath();
    if (!fp) return;
    await writeFile(fp, JSON.stringify(meta, null, 2), 'utf-8');
  }

  async getProjectMeta(key: string): Promise<string | undefined> {
    return (await this.readProjectMeta())[key];
  }

  async setProjectMeta(key: string, value: string): Promise<void> {
    const meta = await this.readProjectMeta();
    meta[key] = value;
    await this.writeProjectMeta(meta);
  }

  async getProjectGoal(): Promise<string> {
    return (await this.getProjectMeta('goal')) ?? '';
  }

  async setProjectGoal(goal: string): Promise<void> {
    await this.setProjectMeta('goal', goal);
  }

  async ensureProjectFolders(dir: string): Promise<void> {
    await mkdir(path.join(dir, 'sources'), { recursive: true });
    await mkdir(path.join(dir, 'outputs'), { recursive: true });
    await mkdir(path.join(dir, 'outputs', 'minutes'), { recursive: true });
  }

  async initTelemetryStore(filePath: string): Promise<void> {
    this.telemetry = new TelemetryStore(filePath);
    await this.telemetry.init().catch((err: Error) =>
      log.warn('[API] Telemetry init error:', err.message),
    );
    const orch = this.deps.getOrchestrator();
    orch.setTelemetryRecorder((entry) => {
      if (!this.telemetry) return;
      this.telemetry.record({ ts: new Date().toISOString(), ...entry }).then(() => {
        this.deps.sseBroadcast({ type: 'telemetry_update', summary: this.telemetry!.getSummary() });
      }).catch(() => {});
    });
  }

  async assignDefaultVisuals(): Promise<void> {
    const { avatarsDir, backgroundsDir } = this.deps;
    let avatarFiles: string[] = [];
    try {
      const avatarsJsonPath = path.join(avatarsDir, 'avatars.json');
      const raw    = await readFile(avatarsJsonPath, 'utf-8');
      const parsed = JSON.parse(raw);
      const catalogue: { file: string }[] = parsed.avatars ?? [];
      const valid: { file: string }[] = [];
      for (const entry of catalogue) {
        try { await stat(path.join(avatarsDir, entry.file)); valid.push(entry); }
        catch { log.warn(`[API] Avatar GLB missing, removing from catalogue: ${entry.file}`); }
      }
      if (valid.length < catalogue.length) {
        parsed.avatars = valid;
        await writeFile(avatarsJsonPath, JSON.stringify(parsed, null, 4), 'utf-8');
      }
      avatarFiles = valid.map(a => a.file);
    } catch { /* no avatars — skip */ }

    let backgroundFiles: string[] = [];
    try {
      await mkdir(backgroundsDir, { recursive: true });
      const entries = await readdir(backgroundsDir);
      backgroundFiles = entries.filter(f => /\.(png|jpg|jpeg|webp)$/i.test(f));
    } catch { /* no backgrounds — skip */ }

    if (avatarFiles.length === 0 && backgroundFiles.length === 0) return;

    const orch    = this.deps.getOrchestrator();
    const agents  = orch.listAgents();
    let changed   = false;
    const usedAvatars = new Set<string>(agents.map(a => a.config.identity.avatar).filter((v): v is string => !!v));
    const usedBgs     = new Set<string>(agents.map(a => a.config.identity.background).filter((v): v is string => !!v));
    const nextFrom = (pool: string[], used: Set<string>): string => {
      const unused = pool.filter(x => !used.has(x));
      return unused.length > 0 ? unused[Math.floor(Math.random() * unused.length)] : pool[Math.floor(Math.random() * pool.length)];
    };
    for (const agent of agents) {
      if (!agent.config.identity.avatar && avatarFiles.length > 0) {
        const file = nextFrom(avatarFiles, usedAvatars);
        orch.updateAgentAvatar(agent.name, file);
        usedAvatars.add(file);
        changed = true;
      }
      if (!agent.config.identity.background && backgroundFiles.length > 0) {
        const file = nextFrom(backgroundFiles, usedBgs);
        orch.updateAgentBackground(agent.name, file);
        usedBgs.add(file);
        changed = true;
      }
    }
    if (changed) {
      log.info('[API] Assigned default avatars/backgrounds to agents');
      await this.deps.saveCurrentState().catch(() => {});
    }
  }

  async handleRoutes(pathname: string, method: string, url: URL, req: IncomingMessage, res: ServerResponse): Promise<boolean> {
    const { json, readBody, readBodyBuffer, sseBroadcast, avatarsDir, backgroundsDir } = this.deps;
    const orch = this.deps.getOrchestrator();

    if (pathname === '/api/project/open-folder' && method === 'POST') {
      const dir = this.deps.getProjectDir();
      if (!dir) { json(res, 400, { error: 'No project folder is set' }); return true; }
      const { platform } = process;
      const [cmd, args] =
        platform === 'win32'  ? ['explorer.exe', [dir]] :
        platform === 'darwin' ? ['open',          [dir]] :
                                ['xdg-open',      [dir]];
      spawn(cmd, args, { detached: true, stdio: 'ignore' }).unref();
      json(res, 200, { ok: true });
      return true;
    }

    if (pathname === '/api/project' && method === 'GET') {
      json(res, 200, { id: this.deps.getProjectId(), dir: this.deps.getProjectDir(), root: this.deps.getProjectsRoot() });
      return true;
    }

    if (pathname === '/api/project/switch' && method === 'POST') {
      if (!this.deps.getProjectsRoot()) { json(res, 503, { error: 'Project switching not configured' }); return true; }
      const body = await readBody(req);
      const { id } = JSON.parse(body) as { id: string };
      if (!id?.trim()) { json(res, 400, { error: 'id is required' }); return true; }
      try {
        await this.deps.switchProject(id.trim());
        const agents  = this.deps.buildAgentStatuses();
        const tickets = await this.deps.readTickets().catch(() => []);
        const meta    = await this.readProjectMeta();
        const project = { id: this.deps.getProjectId(), dir: this.deps.getProjectDir(), goal: meta['goal'] ?? '', humanName: meta['humanName'] ?? 'Human' };
        json(res, 200, { ok: true, id: this.deps.getProjectId(), agents, tickets, project });
      } catch (err) {
        json(res, 500, { error: (err as Error).message });
      }
      return true;
    }

    if (pathname === '/api/project/goal' && method === 'GET') {
      json(res, 200, { goal: await this.getProjectGoal() });
      return true;
    }

    if (pathname === '/api/project/goal' && method === 'PUT') {
      const body    = await readBody(req);
      const { goal } = JSON.parse(body) as { goal: string };
      const trimmed = (goal ?? '').trim();
      await this.setProjectGoal(trimmed);
      orch.setProjectGoal(trimmed || null);
      json(res, 200, { ok: true });
      return true;
    }

    if (pathname === '/api/project/human-name' && method === 'GET') {
      json(res, 200, { humanName: (await this.getProjectMeta('humanName')) ?? 'Human' });
      return true;
    }

    if (pathname === '/api/project/human-name' && method === 'PUT') {
      const body = await readBody(req);
      const { humanName } = JSON.parse(body) as { humanName: string };
      const name = (humanName ?? '').trim() || 'Human';
      await this.setProjectMeta('humanName', name);
      orch.setHumanName(name);
      json(res, 200, { ok: true });
      return true;
    }

    if (pathname === '/api/projects' && method === 'GET') {
      const root = this.deps.getProjectsRoot();
      if (!root) { json(res, 200, []); return true; }
      try {
        const { readdir: rd } = await import('fs/promises');
        const { statSync } = await import('fs');
        const entries  = await rd(root);
        const projects = entries.filter(name => {
          try { return statSync(path.join(root, name)).isDirectory(); } catch { return false; }
        }).map(name => ({ id: name, dir: path.join(root, name), active: name === this.deps.getProjectId() }));
        json(res, 200, projects);
      } catch {
        json(res, 200, []);
      }
      return true;
    }

    if (pathname === '/api/env' && method === 'GET') {
      json(res, 200, await readEnvFile(this.deps.getEnvPath()));
      return true;
    }

    if (pathname === '/api/env' && method === 'POST') {
      const body    = await readBody(req);
      const updates = JSON.parse(body) as Record<string, string>;
      await writeEnvFile(this.deps.getEnvPath(), updates);
      for (const [key, value] of Object.entries(updates)) process.env[key] = value;
      json(res, 200, { ok: true });
      return true;
    }

    if (pathname === '/api/project/files' && method === 'GET') {
      const dir = this.deps.getProjectDir();
      if (!dir) { json(res, 404, { error: 'No project loaded' }); return true; }
      try {
        const sources = await listFilesRecursive(path.join(dir, 'sources'), dir, 'sources');
        const outputs = await listFilesRecursive(path.join(dir, 'outputs'), dir, 'outputs');
        json(res, 200, { sources, outputs });
      } catch {
        json(res, 200, { sources: [], outputs: [] });
      }
      return true;
    }

    if (pathname === '/api/project/upload' && method === 'POST') {
      const dir = this.deps.getProjectDir();
      if (!dir) { json(res, 503, { error: 'No project loaded' }); return true; }
      const rawFilename = req.headers['x-filename'] as string | undefined;
      if (!rawFilename?.trim()) { json(res, 400, { error: 'X-Filename header required' }); return true; }
      const filename = path.basename(decodeURIComponent(rawFilename)).replace(/[\\/:*?"<>|]/g, '_');
      if (!filename) { json(res, 400, { error: 'Invalid filename' }); return true; }
      const destPath = path.join(dir, 'sources', filename);
      try {
        const chunks: Buffer[] = [];
        for await (const chunk of req) chunks.push(chunk as Buffer);
        await writeFile(destPath, Buffer.concat(chunks));
        json(res, 201, { ok: true, path: `sources/${filename}` });
        const sources = await listFilesRecursive(path.join(dir, 'sources'), dir, 'sources');
        const outputs = await listFilesRecursive(path.join(dir, 'outputs'), dir, 'outputs');
        sseBroadcast({ type: 'files_update', sources, outputs });
      } catch (err) {
        json(res, 500, { error: (err as Error).message });
      }
      return true;
    }

    if (pathname === '/api/project/file' && method === 'GET') {
      const dir = this.deps.getProjectDir();
      if (!dir) { json(res, 404, { error: 'No project loaded' }); return true; }
      const rel = url.searchParams.get('path') ?? '';
      if (!rel || rel.includes('..')) { json(res, 400, { error: 'Invalid path' }); return true; }
      const abs = path.join(dir, rel);
      if (!abs.startsWith(dir + path.sep) && abs !== dir) { json(res, 403, { error: 'Forbidden' }); return true; }
      try {
        const data = await readFile(abs);
        const ext  = path.extname(abs).toLowerCase().slice(1);
        const mimeMap: Record<string, string> = {
          pdf: 'application/pdf', txt: 'text/plain', md: 'text/plain',
          png: 'image/png', jpg: 'image/jpeg', jpeg: 'image/jpeg', gif: 'image/gif',
          webp: 'image/webp', svg: 'image/svg+xml',
          json: 'application/json', csv: 'text/csv',
        };
        const mime   = mimeMap[ext] ?? 'application/octet-stream';
        const inline = ['pdf', 'txt', 'md', 'png', 'jpg', 'jpeg', 'gif', 'webp', 'svg'].includes(ext);
        res.writeHead(200, {
          'Content-Type': mime,
          'Content-Disposition': `${inline ? 'inline' : 'attachment'}; filename="${path.basename(abs)}"`,
          'Content-Length': data.length,
        });
        res.end(data);
      } catch {
        json(res, 404, { error: 'File not found' });
      }
      return true;
    }

    if (pathname === '/api/images/backgrounds' && method === 'GET') {
      try {
        await mkdir(backgroundsDir, { recursive: true });
        const files  = await readdir(backgroundsDir);
        const images = files.filter(f => /\.(png|jpg|jpeg|webp)$/i.test(f)).sort();
        json(res, 200, { backgrounds: images });
      } catch {
        json(res, 200, { backgrounds: [] });
      }
      return true;
    }

    if (pathname === '/api/images/generate' && method === 'POST') {
      const apiKey = process.env['OPENAI_API_KEY'];
      if (!apiKey) { json(res, 400, { error: 'OPENAI_API_KEY not configured' }); return true; }
      const body = await readBody(req);
      const { prompt, name } = JSON.parse(body) as { prompt?: string; name?: string };
      if (!prompt?.trim()) { json(res, 400, { error: 'prompt is required' }); return true; }
      const slug = (name ?? '').trim().toLowerCase().replace(/\s+/g, '-').replace(/[^a-z0-9_-]/g, '');
      if (!slug) { json(res, 400, { error: 'name is required' }); return true; }
      await mkdir(backgroundsDir, { recursive: true });
      const filename = `${slug}.png`;
      const destPath = path.join(backgroundsDir, filename);
      const existing = await readdir(backgroundsDir).catch(() => [] as string[]);
      if (existing.includes(filename)) { json(res, 409, { error: `A background named "${slug}" already exists` }); return true; }
      try {
        const response = await fetch('https://api.openai.com/v1/images/generations', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${apiKey}` },
          body: JSON.stringify({ model: 'dall-e-3', prompt: prompt.trim(), n: 1, size: '1792x1024', response_format: 'b64_json' }),
        });
        if (!response.ok) { const err = await response.text(); json(res, 502, { error: `OpenAI error: ${err}` }); return true; }
        const data = await response.json() as { data: Array<{ b64_json: string }> };
        const b64  = data.data[0]?.b64_json;
        if (!b64) { json(res, 502, { error: 'No image data returned' }); return true; }
        await writeFile(destPath, Buffer.from(b64, 'base64'));
        json(res, 200, { filename });
      } catch (err) {
        json(res, 500, { error: (err as Error).message });
      }
      return true;
    }

    if (pathname === '/api/telemetry') {
      if (this.telemetry) {
        json(res, 200, { summary: this.telemetry.getSummary(), records: this.telemetry.getAll() });
      } else {
        json(res, 200, { summary: null, records: [] });
      }
      return true;
    }

    void readBodyBuffer; // suppress unused warning
    return false;
  }
}
