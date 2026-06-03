import { createServer, IncomingMessage, ServerResponse } from 'http';
import { readFile, writeFile } from 'fs/promises';
import * as fs from 'fs';
import * as path from 'path';
import { fileURLToPath } from 'url';
import { WebSocketServer, WebSocket } from 'ws';
import { TeamOrchestrator } from '../orchestrator/orchestrator.js';
import { StoredEvent } from '../store/event-store.js';
import { resolveConfig, MCPCatalogueEntry } from '../mcp/mcp-catalogue.js';
import { getCatalogue } from '../mcp/catalogue-store.js';
import { isSpeechAvailable } from '../speech/pipeline.js';
import { VoiceManager } from '../speech/voice-manager.js';
import { log } from '../util/logger.js';
import { KanbanManager } from './kanban-manager.js';
import { MeetingRouter } from './meeting-router.js';
import { SpeechRouter } from './speech-router.js';
import { ProjectManager, AgentStatus } from './project-manager.js';
import { AgentRouter } from './agent-router.js';
import { handleCLICommand } from './cli-handler.js';
import { buildAgentStatuses, readBody, readBodyBuffer } from './api-utils.js';
import { HumanRequestStore } from './human-request-store.js';
import { EmailAllowlistStore } from './email-allowlist-store.js';
import { EmailAllowlistRouter } from './email-allowlist-router.js';
import { MCPCatalogueRouter } from './mcp-catalogue-router.js';
import { handleOrchestratorEvent, bufferAgentFeedEvent } from './event-handler.js';
import { executeProjectSwitch } from './project-switcher.js';
import { AgentStore } from './agent-store.js';
import { ScheduledActionStore } from './scheduled-action-store.js';
import { GoogleTokenStore } from './google-token-store.js';
import { GoogleOAuthRouter } from './google-oauth-router.js';

const __dirname  = path.dirname(fileURLToPath(import.meta.url));
const PUBLIC_DIR = path.join(__dirname, '..', 'webui', 'public');

const MIME: Record<string, string> = {
  '.html': 'text/html; charset=utf-8',
  '.css':  'text/css',
  '.js':   'application/javascript',
  '.ico':  'image/x-icon',
  '.png':  'image/png',
  '.svg':  'image/svg+xml',
  '.glb':  'model/gltf-binary',
  '.json': 'application/json',
};

const AVATARS_DIR     = path.join(process.cwd(), 'avatars');
const BACKGROUNDS_DIR = path.join(process.cwd(), 'avatars', 'backgrounds');
const NM_DIR          = path.join(process.cwd(), 'node_modules');

function serveFile(filePath: string, dir: string, res: ServerResponse, defaultMime = 'application/octet-stream', extra?: Record<string, string>): void {
  if (!filePath.startsWith(dir)) { res.writeHead(403); res.end('Forbidden'); return; }
  fs.readFile(filePath, (err, data) => {
    if (err) { res.writeHead(404); res.end('Not found'); return; }
    res.writeHead(200, { 'Content-Type': MIME[path.extname(filePath)] ?? defaultMime, ...extra });
    res.end(data);
  });
}

export type ProjectLoader = (projectDir: string, kanbanFile: string, stateFile: string) => Promise<TeamOrchestrator>;

export interface APIServerConfig {
  port?:            number;
  kanbanPath?:      string;
  requestsPath?:    string;
  allowlistPath?:   string;
  mcpEnabledPath?:  string;
  meetingsPath?:    string;
  envPath?:         string;
  projectId?:       string;
  projectDir?:      string;
  projectsRoot?:    string;
  projectLoader?:   ProjectLoader;
  agentStore?:      AgentStore;
  actionStore?:     ScheduledActionStore;
  googleTokensPath?: string;
}

export class APIServer {
  private server;
  private wss: WebSocketServer;
  private orchestrator: TeamOrchestrator;
  private port: number;
  private mcpEnabledPath: string;
  private envPath: string;
  private projectId: string;
  private projectDir: string | null;
  private projectsRoot: string | null;
  private projectLoader: ProjectLoader | null;
  private agentStore: AgentStore | null;
  private actionStore: ScheduledActionStore | null;
  private projectSwitchCallback: ((orchestrator: TeamOrchestrator) => void) | null = null;
  private enabledMCPIds: Set<string> = new Set();
  private meetingsPath: string | null;
  private meetingScheduler: ReturnType<typeof setInterval> | null = null;
  private sseClients: ServerResponse[] = [];
  private agentActivity = new Map<string, { activity: string; talkingTo?: string }>();
  private talkingTimers = new Map<string, ReturnType<typeof setTimeout>>();
  private agentTicketMap = new Map<string, string>();
  private humanRequestStore: HumanRequestStore;
  private emailAllowlistStore: EmailAllowlistStore;
  private emailAllowlistRouter: EmailAllowlistRouter;
  private agentFeeds = new Map<string, StoredEvent[]>();
  private readonly FEED_LIMIT = 200;
  private nudgeScheduler: ReturnType<typeof setInterval> | null = null;
  private unsubscribeEvents: (() => void) | null = null;
  private speechInterest = new Map<WebSocket, { agentName: string; voiceUrl: string | null; speakerId: number | null }>();
  private voiceManager = new VoiceManager();
  private pendingHumanTurns = new Map<string, (input: string | null) => void>();
  private pendingTurnAcks = new Map<string, () => void>();

  // Service objects
  private kanbanManager: KanbanManager;
  private meetingRouter: MeetingRouter;
  private speechRouter: SpeechRouter;
  private projectManager: ProjectManager;
  private agentRouter: AgentRouter;
  private mcpCatalogueRouter: MCPCatalogueRouter;
  private googleTokenStore: GoogleTokenStore;
  private googleOAuthRouter: GoogleOAuthRouter;
  private googleRefreshTimer: ReturnType<typeof setInterval> | null = null;
  private readonly GOOGLE_HTTP_MCP_IDS = new Set(['google-gmail', 'google-calendar', 'google-drive', 'google-chat', 'google-contacts']);

  constructor(orchestrator: TeamOrchestrator, config: APIServerConfig = {}) {
    this.orchestrator  = orchestrator;
    this.port          = config.port ?? 3001;
    this.mcpEnabledPath = config.mcpEnabledPath ?? './mcp-enabled.json';
    this.meetingsPath   = config.meetingsPath ?? null;
    this.envPath        = config.envPath ?? './.env';
    this.projectId      = config.projectId ?? 'default';
    this.projectDir     = config.projectDir ?? null;
    this.projectsRoot   = config.projectsRoot ?? null;
    this.projectLoader  = config.projectLoader ?? null;
    this.agentStore     = config.agentStore  ?? null;
    this.actionStore    = config.actionStore ?? null;
    this.humanRequestStore   = new HumanRequestStore(config.requestsPath ?? null);
    this.emailAllowlistStore = new EmailAllowlistStore(config.allowlistPath ?? null);

    // eslint-disable-next-line @typescript-eslint/no-this-alias
    const self = this;
    this.kanbanManager = new KanbanManager(config.kanbanPath ?? null, {
      getOrchestrator:  () => self.orchestrator,
      agentTicketMap:   self.agentTicketMap,
      agentActivity:    self.agentActivity,
      resolveAgentName: (n) => self.resolveAgentName(n),
      agentIdForName:   (n) => self.orchestrator.agentIdForName(n) ?? n,
      sseBroadcast: (d) => self.sseBroadcast(d),
      json: (r, s, b) => self.json(r, s, b),
      readBody,
    });
    this.meetingRouter = new MeetingRouter({
      getOrchestrator: () => self.orchestrator,
      pendingHumanTurns: self.pendingHumanTurns,
      pendingTurnAcks:   self.pendingTurnAcks,
      sseBroadcast: (d) => self.sseBroadcast(d),
      json: (r, s, b) => self.json(r, s, b),
      readBody,
      resolveAgentName: (n) => self.resolveAgentName(n),
    });
    this.speechRouter = new SpeechRouter({
      voiceManager: self.voiceManager,
      json: (r, s, b) => self.json(r, s, b),
      readBody,
      readBodyBuffer,
    });
    this.projectManager = new ProjectManager({
      getOrchestrator:  () => self.orchestrator,
      getProjectDir:    () => self.projectDir,
      setProjectDir:    (d) => { self.projectDir = d; },
      getProjectId:     () => self.projectId,
      setProjectId:     (id) => { self.projectId = id; },
      getProjectsRoot:  () => self.projectsRoot,
      getEnvPath:       () => self.envPath,
      switchProject:    (id) => self.switchProject(id),
      buildAgentStatuses: () => self.buildAgentStatuses(),
      readTickets:      () => self.kanbanManager.readTickets(),
      saveCurrentState: () => self.saveCurrentState(),
      avatarsDir:       AVATARS_DIR,
      backgroundsDir:   BACKGROUNDS_DIR,
      sseBroadcast: (d) => self.sseBroadcast(d),
      json: (r, s, b) => self.json(r, s, b),
      readBody,
      readBodyBuffer,
    });
    this.agentRouter = new AgentRouter({
      getOrchestrator:    () => self.orchestrator,
      agentFeeds:         self.agentFeeds,
      humanRequestStore:  self.humanRequestStore,
      agentTicketMap:     self.agentTicketMap,
      agentActivity:      self.agentActivity,
      talkingTimers:      self.talkingTimers,
      getProjectDir:      () => self.projectDir,
      getKanbanPath:      () => self.kanbanManager.kanbanPath,
      readKanban:         () => self.kanbanManager.readKanban(),
      writeKanban:        (b) => self.kanbanManager.writeKanban(b),
      buildAgentStatuses: () => self.buildAgentStatuses(),
      buildRequestsList:  () => self.buildRequestsList(),
      updateKanbanColumn: (id, col) => self.kanbanManager.updateKanbanColumn(id, col),
      saveCurrentState:   () => self.saveCurrentState(),
      resolveAgentName:   (n) => self.resolveAgentName(n),
      resolveMCPConfig:   (id, entry) => self.resolveMCPConfig(id, entry),
      saveMCPEnabled:     () => self.saveMCPEnabled(),
      enabledMCPIds:      self.enabledMCPIds,
      getAgentStore:      () => self.agentStore,
      getActionStore:     () => self.actionStore,
      sseBroadcast: (d) => self.sseBroadcast(d),
      json: (r, s, b) => self.json(r, s, b),
      readBody,
      avatarsDir: AVATARS_DIR,
    });
    this.mcpCatalogueRouter = new MCPCatalogueRouter({
      json:         (r, s, b) => self.json(r, s, b),
      readBody,
      sseBroadcast: (d) => self.sseBroadcast(d),
    });
    this.emailAllowlistRouter = new EmailAllowlistRouter({
      store:        self.emailAllowlistStore,
      sseBroadcast: (d) => self.sseBroadcast(d),
      json:         (r, s, b) => self.json(r, s, b),
      readBody,
      onStatusChange: (entry) => {
        const verb = entry.status === 'approved' ? 'approved' : 'rejected';
        const detail = entry.status === 'approved'
          ? `You may now send emails to ${entry.email}.`
          : `Do not contact ${entry.email}.`;
        self.orchestrator.humanMessage(
          entry.requestedBy,
          `Your email permission request for ${entry.email} has been ${verb}. ${detail}`,
        ).catch(() => {});
      },
    });

    const tokensPath = config.googleTokensPath ?? path.join(process.cwd(), 'data', 'google-tokens.json');
    this.googleTokenStore = new GoogleTokenStore(tokensPath);
    this.googleOAuthRouter = new GoogleOAuthRouter(this.googleTokenStore, this.port);
    this.googleOAuthRouter.onAuthenticated(async () => {
      await this.reconnectGoogleMCPs();
      this.sseBroadcast({ type: 'google_auth_status', authenticated: true });
    });

    this.server = createServer((req, res) => {
      this.handleRequest(req, res).catch((err) => {
        log.error('[API] Request error:', err);
        if (!res.headersSent) {
          res.writeHead(500, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ error: (err as Error).message ?? 'Internal error' }));
        }
      });
    });
    this.wss = new WebSocketServer({ server: this.server });
    this.wss.on('connection', (ws) => this.handleWsConnection(ws));
  }

  onProjectSwitch(cb: (orchestrator: TeamOrchestrator) => void): void {
    this.projectSwitchCallback = cb;
  }

  async start(): Promise<void> {
    this.voiceManager.start().catch((err: Error) => log.warn('[API] VoiceManager start error:', err.message));

    if (this.projectDir) {
      await this.projectManager.ensureProjectFolders(this.projectDir);
      this.orchestrator.setProjectDir(this.projectDir);
      const goal = await this.projectManager.getProjectGoal();
      if (goal) this.orchestrator.setProjectGoal(goal);
      const humanName = await this.projectManager.getProjectMeta('humanName');
      if (humanName) this.orchestrator.setHumanName(humanName);
    }

    const telemetryPath = this.projectDir
      ? path.join(this.projectDir, 'telemetry.jsonl')
      : path.join(process.cwd(), 'data', 'telemetry.jsonl');
    await this.projectManager.initTelemetryStore(telemetryPath);

    this.unsubscribeEvents = this.orchestrator.onEvent((ev) => {
      this.handleOrchestratorEvent(ev);
      this.wsBroadcast(ev);
    });

    this.orchestrator.setHumanMeetingTurnHandler(async (meetingId, _turns, topic) => {
      this.sseBroadcast({ type: 'meeting_human_turn', meetingId, topic });
      return new Promise<string | null>((resolve) => {
        this.pendingHumanTurns.set(meetingId, resolve);
        setTimeout(() => { if (this.pendingHumanTurns.delete(meetingId)) resolve(null); }, 30 * 60 * 1000);
      });
    });

    this.orchestrator.setMeetingTurnPacer(async (meetingId: string, _participant: string) => {
      return new Promise<void>((resolve) => {
        this.pendingTurnAcks.set(meetingId, resolve);
        setTimeout(() => { if (this.pendingTurnAcks.delete(meetingId)) resolve(); }, 3 * 60 * 1000);
      });
    });

    await this.humanRequestStore.load();
    await this.emailAllowlistStore.load();
    this.orchestrator.setEmailAllowlistStore(this.emailAllowlistStore);
    await this.googleTokenStore.load();
    await this.googleTokenStore.syncToEnv();
    // Refresh Google access token every 45 minutes
    this.googleRefreshTimer = setInterval(async () => {
      const ok = await this.googleTokenStore.syncToEnv();
      if (ok) await this.reconnectGoogleMCPs();
    }, 45 * 60 * 1000);
    this.loadMCPEnabled().catch(() => {});
    if (this.meetingsPath) this.orchestrator.initMeetingStore(this.meetingsPath).catch(() => {});

    this.meetingScheduler = setInterval(() => this.meetingRouter.launchDueMeetings().catch(() => {}), 60_000);

    if (this.projectDir) this.projectManager.assignDefaultVisuals().catch(() => {});
    if (this.kanbanManager.kanbanPath) this.kanbanManager.dispatchUnstartedTickets().catch(() => {});

    this.nudgeScheduler = setInterval(() => this.kanbanManager.nudgeStaleTickets().catch(() => {}), 30 * 60 * 1000);
    if (this.kanbanManager.kanbanPath) this.kanbanManager.watchKanban(this.kanbanManager.kanbanPath);

    this.server.listen(this.port, () => {
      log.info(`[API] UI    http://localhost:${this.port}`);
      log.info(`[API] REST  http://localhost:${this.port}/api`);
      log.info(`[API] WS    ws://localhost:${this.port}/ws`);
      if (isSpeechAvailable() || this.voiceManager.getVoices().length > 0) {
        const voices = this.voiceManager.getVoices();
        if (voices.length > 0)
          log.info(`[API] Speech TTS — ${voices.length} voice(s): ${voices.map(v => v.name).join(', ')}`);
        else
          log.info(`[API] Speech TTS enabled (model: ${process.env['PIPER_MODEL'] ?? 'server'})`);
      }
    });
  }

  stop(): void {
    this.unsubscribeEvents?.();
    this.kanbanManager.closeWatcher();
    if (this.meetingScheduler)    { clearInterval(this.meetingScheduler);    this.meetingScheduler    = null; }
    if (this.nudgeScheduler)      { clearInterval(this.nudgeScheduler);      this.nudgeScheduler      = null; }
    if (this.googleRefreshTimer)  { clearInterval(this.googleRefreshTimer);  this.googleRefreshTimer  = null; }
    this.orchestrator.stopAgendaRunner();
    this.voiceManager.stop();
    this.wss.close();
    this.server.close();
  }

  async shutdown(): Promise<void> {
    this.stop();
    await this.saveCurrentState();
  }

  // ── WebSocket ──────────────────────────────────────────────────────────────

  private handleWsConnection(ws: WebSocket): void {
    const snapshot = { agents: this.buildAgentStatuses(), tasks: this.orchestrator.listTasks(), meetings: this.orchestrator.listMeetings() };
    ws.send(JSON.stringify({ type: 'snapshot', data: snapshot }));
    ws.on('message', (raw) => {
      try {
        const msg = JSON.parse(raw.toString()) as { type: string; name?: string; voice?: string; speakerName?: string };
        if (msg.type === 'set_speech_agent') {
          if (msg.name) {
            const voice    = this.voiceManager.resolveVoice(msg.voice);
            const voiceUrl = voice?.url ?? process.env['PIPER_SERVER_URL'] ?? null;
            let speakerId: number | null = voice?.speakerId ?? null;
            if (msg.speakerName && voice) {
              const found = voice.speakers.find(s => s.name === msg.speakerName);
              if (found) speakerId = found.id;
            }
            this.speechInterest.set(ws, { agentName: msg.name, voiceUrl, speakerId });
          } else {
            this.speechInterest.delete(ws);
          }
        }
      } catch { /* ignore malformed */ }
    });
    ws.on('close', () => this.speechInterest.delete(ws));
    ws.on('error', () => {});
  }

  private wsBroadcast(event: StoredEvent): void {
    const msg = JSON.stringify({ type: 'event', data: event });
    for (const client of this.wss.clients) {
      if (client.readyState === WebSocket.OPEN) client.send(msg);
    }
  }

  // ── SSE ───────────────────────────────────────────────────────────────────

  private async sseInit(res: ServerResponse): Promise<void> {
    res.writeHead(200, { 'Content-Type': 'text/event-stream', 'Cache-Control': 'no-cache', 'Connection': 'keep-alive', 'Access-Control-Allow-Origin': '*' });
    const agents   = this.buildAgentStatuses();
    const tickets  = this.kanbanManager.kanbanPath ? await this.kanbanManager.readTickets() : [];
    const meta     = await this.projectManager.readProjectMeta();
    const project  = { id: this.projectId, dir: this.projectDir, goal: meta['goal'] ?? '', humanName: meta['humanName'] ?? 'Human' };
    const requests  = this.buildRequestsList();
    const allowlist = this.emailAllowlistStore.list();
    res.write(`data: ${JSON.stringify({ type: 'init', agents, tickets, project, requests, allowlist })}\n\n`);
    this.sseClients.push(res);
  }

  private sseBroadcast(data: object): void {
    const msg = `data: ${JSON.stringify(data)}\n\n`;
    for (let i = this.sseClients.length - 1; i >= 0; i--) {
      try { this.sseClients[i].write(msg); }
      catch { this.sseClients.splice(i, 1); }
    }
  }

  // ── Orchestrator events ───────────────────────────────────────────────────

  private agentIdForName(name: string): string {
    return this.orchestrator.agentIdForName(name) ?? name;
  }

  private handleOrchestratorEvent(ev: StoredEvent): void {
    handleOrchestratorEvent(ev, {
      agentActivity:        this.agentActivity,
      talkingTimers:        this.talkingTimers,
      pendingHumanTurns:    this.pendingHumanTurns,
      pendingTurnAcks:      this.pendingTurnAcks,
      humanRequestStore:    this.humanRequestStore,
      emailAllowlistStore:  this.emailAllowlistStore,
      agentTicketMap:       this.agentTicketMap,
      kanban:               this.kanbanManager,
      getOrchestrator:      () => this.orchestrator,
      agentIdForName:       (n) => this.agentIdForName(n),
      speechInterest:       this.speechInterest,
      voiceManager:         this.voiceManager,
      sseBroadcast:         (d) => this.sseBroadcast(d),
      buildAgentStatuses:   () => this.buildAgentStatuses(),
    });
    bufferAgentFeedEvent(ev, this.agentFeeds, this.FEED_LIMIT, (d) => this.sseBroadcast(d), (n) => this.agentIdForName(n));
  }

  private buildRequestsList() { return this.humanRequestStore.list(); }
  private buildAgentStatuses(): AgentStatus[]  { return buildAgentStatuses(this.orchestrator, this.agentActivity); }

  // ── HTTP routing ──────────────────────────────────────────────────────────

  private async handleRequest(req: IncomingMessage, res: ServerResponse): Promise<void> {
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Methods', 'GET, POST, PATCH, DELETE, OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
    if (req.method === 'OPTIONS') { res.writeHead(204); res.end(); return; }

    const url      = new URL(req.url ?? '/', `http://localhost:${this.port}`);
    const pathname = url.pathname;
    const method   = req.method ?? 'GET';

    if (pathname === '/events' && method === 'GET') {
      await this.sseInit(res);
      req.on('close', () => { const i = this.sseClients.indexOf(res); if (i >= 0) this.sseClients.splice(i, 1); });
      return;
    }

    if (method !== 'GET' && method !== 'POST' && method !== 'PATCH' && method !== 'DELETE' && method !== 'PUT') {
      this.json(res, 405, { error: 'Method not allowed' }); return;
    }

    if (pathname === '/api/cli' && method === 'POST') {
      const body = await readBody(req);
      const { line } = JSON.parse(body) as { line: string };
      const output = await handleCLICommand(line?.trim() ?? '', {
        orchestrator: this.orchestrator,
        agentTicketMap: this.agentTicketMap,
        updateKanbanColumn: (id, col) => this.kanbanManager.updateKanbanColumn(id, col),
        dispatchUnstartedTickets: () => this.kanbanManager.dispatchUnstartedTickets(),
        resolveAgentName: (n) => this.resolveAgentName(n),
      });
      this.json(res, 200, { output });
      return;
    }

    if (await this.kanbanManager.handleRoutes(pathname, method, url, req, res))       return;
    if (await this.meetingRouter.handleRoutes(pathname, method, req, res))            return;
    if (await this.speechRouter.handleRoutes(pathname, method, req, res))             return;
    if (await this.projectManager.handleRoutes(pathname, method, url, req, res))      return;
    if (await this.agentRouter.handleRoutes(pathname, method, url, req, res))         return;
    if (await this.mcpCatalogueRouter.handleRoutes(pathname, method, req, res))       return;
    if (await this.emailAllowlistRouter.handleRoutes(pathname, method, req, res))     return;
    if (await this.googleOAuthRouter.handleRoutes(pathname, method, req, res))        return;

    // ── Agent agenda ────────────────────────────────────────────────────────
    if (pathname === '/api/agenda' && method === 'GET') {
      const agentName = url.searchParams.get('agent') ?? undefined;
      const store = this.orchestrator.getAgendaStore();
      this.json(res, 200, store ? store.list(agentName) : []);
      return;
    }
    if (pathname === '/api/agenda' && method === 'POST') {
      const body = JSON.parse(await readBody(req)) as { agentName: string; label: string; description: string; intervalMinutes?: number; delayMinutes?: number };
      const store = this.orchestrator.getAgendaStore();
      if (!store) { this.json(res, 503, { error: 'Agenda store not ready' }); return; }
      if (!body.agentName || !body.label || !body.description) {
        this.json(res, 400, { error: 'agentName, label, and description are required' }); return;
      }
      const intervalSeconds = (body.intervalMinutes && body.intervalMinutes > 0) ? Math.round(body.intervalMinutes * 60) : null;
      const delaySeconds    = body.delayMinutes != null ? Math.round(body.delayMinutes * 60) : undefined;
      const entry = await store.add({ agentName: body.agentName, label: body.label, description: body.description, intervalSeconds, delaySeconds });
      this.json(res, 201, entry);
      return;
    }
    if (pathname.startsWith('/api/agenda/') && method === 'DELETE') {
      const id = pathname.slice('/api/agenda/'.length);
      const store = this.orchestrator.getAgendaStore();
      const ok = store ? await store.remove(id) : false;
      this.json(res, ok ? 200 : 404, ok ? { ok: true } : { error: 'Not found' });
      return;
    }
    if (pathname.startsWith('/api/agenda/') && method === 'PATCH') {
      const id    = pathname.slice('/api/agenda/'.length);
      const body  = JSON.parse(await readBody(req)) as Partial<import('./agenda-store.js').AgendaEntry>;
      const store = this.orchestrator.getAgendaStore();
      if (!store) { this.json(res, 503, { error: 'Agenda store not ready' }); return; }
      const updated = await store.update(id, body);
      this.json(res, updated ? 200 : 404, updated ?? { error: 'Not found' });
      return;
    }

    if (pathname.startsWith('/api/')) { this.json(res, 404, { error: 'Not found' }); return; }

    if (pathname.startsWith('/nm/')) {
      serveFile(path.join(NM_DIR, pathname.slice(4)), NM_DIR, res, 'application/javascript', { 'Cache-Control': 'public, max-age=86400' });
      return;
    }
    if (pathname.startsWith('/avatars/'))     { serveFile(path.join(AVATARS_DIR,     pathname.slice(9)),  AVATARS_DIR,     res); return; }
    if (pathname.startsWith('/backgrounds/')) { serveFile(path.join(BACKGROUNDS_DIR, pathname.slice(13)), BACKGROUNDS_DIR, res, 'image/png'); return; }
    serveFile(path.join(PUBLIC_DIR, pathname === '/' ? 'index.html' : pathname.slice(1)), PUBLIC_DIR, res);
  }

  // ── Shared helpers ────────────────────────────────────────────────────────

  private json(res: ServerResponse, status: number, body: unknown): void {
    res.writeHead(status, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify(body));
  }

  private resolveMCPConfig(id: string, entry: MCPCatalogueEntry) {
    const config = resolveConfig(entry.config, this.projectDir);
    if (id === 'kanban' && this.kanbanManager.kanbanPath && config.transport === 'stdio') {
      return { ...config, args: [...(config.args ?? []), this.kanbanManager.kanbanPath] };
    }
    if (id === 'filesystem' && this.projectDir && config.transport === 'stdio') {
      return { ...config, args: [...(config.args ?? []), this.projectDir] };
    }
    return config;
  }

  private async reconnectGoogleMCPs(): Promise<void> {
    for (const id of this.GOOGLE_HTTP_MCP_IDS) {
      if (!this.enabledMCPIds.has(id)) continue;
      const entry = getCatalogue().find(e => e.id === id);
      if (!entry) continue;
      try {
        if (this.orchestrator.hasMCPServer(id)) await this.orchestrator.removeMCPServer(id);
        const config = this.resolveMCPConfig(id, entry);
        await this.orchestrator.addMCPServer({ name: id, config });
        log.info(`[MCP] Reconnected "${id}" with fresh Google token`);
      } catch (err) {
        log.warn(`[MCP] Failed to reconnect "${id}":`, (err as Error).message);
      }
    }
  }

  private async loadMCPEnabled(): Promise<void> {
    try {
      const raw  = await readFile(this.mcpEnabledPath, 'utf-8');
      const data = JSON.parse(raw) as { ids: string[] };
      for (const id of data.ids ?? []) {
        const entry = getCatalogue().find(e => e.id === id);
        if (!entry || this.orchestrator.hasMCPServer(id)) continue;
        try {
          const config = this.resolveMCPConfig(id, entry);
          await this.orchestrator.addMCPServer({ name: id, config });
          this.enabledMCPIds.add(id);
        } catch (err) {
          log.warn(`[MCP] Failed to reconnect "${id}":`, (err as Error).message);
        }
      }
    } catch { /* file doesn't exist yet */ }
  }

  private async saveMCPEnabled(): Promise<void> {
    await writeFile(this.mcpEnabledPath, JSON.stringify({ ids: Array.from(this.enabledMCPIds) }, null, 2), 'utf-8');
  }

  private async saveCurrentState(): Promise<void> {
    if (!this.projectDir) return;
    await this.orchestrator.saveState(path.join(this.projectDir, 'team-state.json'));
  }

  private resolveAgentName(input: string): string {
    const lower = input.toLowerCase();
    const match = this.orchestrator.listAgents().find(a => a.name.toLowerCase() === lower);
    return match ? match.name : input;
  }

  // ── Project switching ─────────────────────────────────────────────────────

  private async switchProject(newId: string): Promise<void> {
    if (!this.projectLoader || !this.projectsRoot) throw new Error('Project loader not configured');
    await executeProjectSwitch(newId, {
      projectLoader:        this.projectLoader,
      projectsRoot:         this.projectsRoot,
      projectDir:           this.projectDir,
      orchestrator:         this.orchestrator,
      kanbanManager:        this.kanbanManager,
      humanRequestStore:    this.humanRequestStore,
      emailAllowlistStore:  this.emailAllowlistStore,
      projectManager:       this.projectManager,
      enabledMCPIds:    this.enabledMCPIds,
      agentActivity:    this.agentActivity,
      agentFeeds:       this.agentFeeds,
      agentTicketMap:   this.agentTicketMap,
      talkingTimers:    this.talkingTimers,
      unsubscribeEvents: this.unsubscribeEvents,
      onStateChange: (u) => {
        if (u.orchestrator     !== undefined) this.orchestrator     = u.orchestrator;
        if (u.projectDir       !== undefined) this.projectDir       = u.projectDir;
        if (u.projectId        !== undefined) this.projectId        = u.projectId;
        if (u.mcpEnabledPath   !== undefined) this.mcpEnabledPath   = u.mcpEnabledPath;
        if (u.meetingsPath     !== undefined) this.meetingsPath     = u.meetingsPath;
        if ('unsubscribeEvents' in u)         this.unsubscribeEvents = u.unsubscribeEvents ?? null;
      },
      subscribeToOrchestrator: (o) => o.onEvent((ev) => { this.handleOrchestratorEvent(ev); this.wsBroadcast(ev); }),
      loadMCPEnabled:     () => this.loadMCPEnabled(),
      buildAgentStatuses: () => this.buildAgentStatuses(),
      sseBroadcast:       (d) => this.sseBroadcast(d),
      projectSwitchCallback: this.projectSwitchCallback,
      agentStore: this.agentStore,
    });
  }
}
