import { IncomingMessage, ServerResponse } from 'http';
import { rm, mkdir, readdir } from 'fs/promises';
import * as path from 'path';
import { TeamOrchestrator } from '../orchestrator/orchestrator.js';
import { HumanRequest } from '../orchestrator/types.js';
import { HumanRequestStore } from './human-request-store.js';
import { StoredEvent } from '../store/event-store.js';
import { Board } from '../mcp/kanban/types.js';
import { MCPCatalogueEntry } from '../mcp/mcp-catalogue.js';
import { getCatalogue } from '../mcp/catalogue-store.js';
import { debugState } from '../providers/debug-state.js';
import { HatType } from '../hats/types.js';
import { SPECIALISATION_DIRECTIVES, generateSystemPrompt } from '../prompt/generator.js';
import { mergeHatDefinitions } from '../hats/definitions.js';
import { personasByHat } from '../hats/personas.js';
import { getPricingTable, FREE_PROVIDERS } from '../providers/pricing.js';
import { AnthropicProvider } from '../providers/anthropic.js';
import { makeProvider, KNOWN_PROVIDERS, probeLocalLLM, getCachedModels, getModelCacheEntry, clearModelCache } from './providers.js';
import { AgentStatus } from './project-manager.js';
import { AgentStore } from './agent-store.js';
import { ScheduledActionStore } from './scheduled-action-store.js';

export interface AgentRouterDeps {
  getOrchestrator(): TeamOrchestrator;
  agentFeeds: Map<string, StoredEvent[]>;
  humanRequestStore: HumanRequestStore;
  agentTicketMap: Map<string, string>;
  agentActivity: Map<string, { activity: string; talkingTo?: string }>;
  talkingTimers: Map<string, ReturnType<typeof setTimeout>>;
  getProjectDir(): string | null;
  getKanbanPath(): string | null;
  readKanban(): Promise<Board>;
  writeKanban(board: Board): Promise<void>;
  buildAgentStatuses(): AgentStatus[];
  buildRequestsList(): HumanRequest[];
  updateKanbanColumn(id: string, col: string): Promise<void>;
  saveCurrentState(): Promise<void>;
  resolveAgentName(input: string): string;
  resolveMCPConfig(id: string, entry: import('../mcp/mcp-catalogue.js').MCPCatalogueEntry): ReturnType<typeof import('../mcp/mcp-catalogue.js').resolveConfig>;
  saveMCPEnabled(): Promise<void>;
  enabledMCPIds: Set<string>;
  getAgentStore(): AgentStore | null;
  getActionStore(): ScheduledActionStore | null;
  sseBroadcast(data: object): void;
  json(res: ServerResponse, status: number, body: unknown): void;
  readBody(req: IncomingMessage): Promise<string>;
  avatarsDir: string;
}

export class AgentRouter {
  private deps: AgentRouterDeps;

  constructor(deps: AgentRouterDeps) {
    this.deps = deps;
  }

  async handleRoutes(pathname: string, method: string, url: URL, req: IncomingMessage, res: ServerResponse): Promise<boolean> {
    const { json, readBody, resolveAgentName, sseBroadcast, saveCurrentState, agentFeeds, humanRequestStore, agentTicketMap, agentActivity, talkingTimers, enabledMCPIds } = this.deps;
    const orch = this.deps.getOrchestrator();

    if (pathname.startsWith('/api/agents/') && pathname.endsWith('/feed')) {
      const name = decodeURIComponent(pathname.slice('/api/agents/'.length, -'/feed'.length));
      json(res, 200, agentFeeds.get(name.toLowerCase()) ?? []);
      return true;
    }

    if (pathname === '/api/team') { json(res, 200, { agents: this.deps.buildAgentStatuses(), tasks: orch.listTasks(), meetings: orch.listMeetings() }); return true; }
    if (pathname === '/api/agents' && method !== 'POST' && method !== 'DELETE') { json(res, 200, this.deps.buildAgentStatuses()); return true; }
    if (pathname === '/api/tasks')   { json(res, 200, orch.listTasks()); return true; }
    if (pathname === '/api/meetings' && !pathname.includes('/api/meetings/')) { json(res, 200, orch.listMeetings()); return true; }
    if (pathname === '/api/tools')   { json(res, 200, orch.getToolInfo()); return true; }

    if (pathname === '/api/events') {
      const limit  = parseInt(url.searchParams.get('limit') ?? '100', 10);
      const since  = url.searchParams.get('since') ?? undefined;
      const events = await orch.readEvents(since);
      json(res, 200, events.slice(-limit));
      return true;
    }

    if (pathname.match(/^\/api\/agents\/[^/]+\/prompt-preview$/) && method === 'GET') {
      const agentName = decodeURIComponent(pathname.slice('/api/agents/'.length, -'/prompt-preview'.length));
      const hatParams = url.searchParams.getAll('hat') as HatType[];
      const specParam = url.searchParams.get('specialisation') ?? undefined;
      const nameParam = url.searchParams.get('name') ?? undefined;
      try {
        const resolved = resolveAgentName(agentName);
        const agent    = orch.getAgent(resolved);
        if (!agent) { json(res, 404, { error: `Agent "${agentName}" not found` }); return true; }
        const hatTypes = hatParams.length > 0 ? hatParams : agent.hatType;
        const hat      = mergeHatDefinitions(hatTypes);
        const prompt   = generateSystemPrompt({
          name: nameParam ?? agent.config.identity.name,
          visualDescription: agent.config.identity.visualDescription,
          backstory: agent.config.identity.backstory,
          hatLabel: hat.label, thinkingStyle: hat.thinkingStyle,
          communicationTone: hat.communicationTone, directives: hat.directives,
          avoidances: hat.avoidances, teamRole: hat.teamRole,
          teamContext: agent.config.teamContext, projectDir: agent.config.projectDir,
          projectGoal: agent.config.projectGoal,
          specialisation: specParam !== undefined ? specParam : agent.config.identity.specialisation,
          email: agent.config.identity.email,
        });
        json(res, 200, { prompt: prompt.text });
      } catch (err) { json(res, 400, { error: (err as Error).message }); }
      return true;
    }

    if (pathname.match(/^\/api\/agents\/[^/]+\/config$/) && method === 'PATCH') {
      const agentName = decodeURIComponent(pathname.slice('/api/agents/'.length, -'/config'.length));
      const body = await readBody(req);
      const { provider: providerName, model } = JSON.parse(body) as { provider: string; model: string };
      if (!model?.trim()) { json(res, 400, { error: 'model is required' }); return true; }
      const provider = makeProvider(providerName);
      if (!provider) { json(res, 400, { error: `Unknown provider "${providerName}"` }); return true; }
      try {
        orch.updateAgentConfig(resolveAgentName(agentName), provider, model.trim());
        sseBroadcast({ type: 'agent_update', agents: this.deps.buildAgentStatuses() });
        saveCurrentState().catch(() => {});
        json(res, 200, { ok: true });
      } catch (err) { json(res, 404, { error: (err as Error).message }); }
      return true;
    }

    if (pathname.match(/^\/api\/agents\/[^/]+\/name$/) && method === 'PATCH') {
      const oldName = decodeURIComponent(pathname.slice('/api/agents/'.length, -'/name'.length));
      const body = await readBody(req);
      const { name: newName } = JSON.parse(body) as { name: string };
      if (!newName?.trim()) { json(res, 400, { error: 'name is required' }); return true; }
      try {
        const resolved = resolveAgentName(oldName);
        orch.renameAgent(resolved, newName.trim());
        const ticket = agentTicketMap.get(resolved.toLowerCase());
        if (ticket) { agentTicketMap.delete(resolved.toLowerCase()); agentTicketMap.set(newName.trim().toLowerCase(), ticket); }
        const activity = agentActivity.get(resolved);
        if (activity) { agentActivity.delete(resolved); agentActivity.set(newName.trim(), activity); }
        sseBroadcast({ type: 'agent_update', agents: this.deps.buildAgentStatuses() });
        saveCurrentState().catch(() => {});
        json(res, 200, { ok: true, name: newName.trim() });
      } catch (err) { json(res, 400, { error: (err as Error).message }); }
      return true;
    }

    if (pathname.match(/^\/api\/agents\/[^/]+\/specialisation$/) && method === 'PATCH') {
      const agentName = decodeURIComponent(pathname.slice('/api/agents/'.length, -'/specialisation'.length));
      const body = await readBody(req);
      const { specialisation } = JSON.parse(body) as { specialisation?: string };
      try {
        orch.updateAgentSpecialisation(resolveAgentName(agentName), specialisation?.trim() || undefined);
        sseBroadcast({ type: 'agent_update', agents: this.deps.buildAgentStatuses() });
        saveCurrentState().catch(() => {});
        json(res, 200, { ok: true });
      } catch (err) { json(res, 400, { error: (err as Error).message }); }
      return true;
    }

    if (pathname.match(/^\/api\/agents\/[^/]+\/voice$/) && method === 'PATCH') {
      const agentName = decodeURIComponent(pathname.slice('/api/agents/'.length, -'/voice'.length));
      const body = await readBody(req);
      const { voice, speakerName } = JSON.parse(body) as { voice?: string; speakerName?: string };
      try {
        orch.updateAgentVoice(resolveAgentName(agentName), voice?.trim() || undefined, speakerName?.trim() || undefined);
        sseBroadcast({ type: 'agent_update', agents: this.deps.buildAgentStatuses() }); saveCurrentState().catch(() => {}); json(res, 200, { ok: true });
      } catch (err) { json(res, 400, { error: (err as Error).message }); }
      return true;
    }

    if (pathname.match(/^\/api\/agents\/[^/]+\/email$/) && method === 'PATCH') {
      const agentName = decodeURIComponent(pathname.slice('/api/agents/'.length, -'/email'.length));
      const body = await readBody(req);
      const { email } = JSON.parse(body) as { email?: string };
      try {
        orch.updateAgentEmail(resolveAgentName(agentName), email?.trim() || undefined);
        sseBroadcast({ type: 'agent_update', agents: this.deps.buildAgentStatuses() }); saveCurrentState().catch(() => {}); json(res, 200, { ok: true });
      } catch (err) { json(res, 400, { error: (err as Error).message }); }
      return true;
    }

    if (pathname.match(/^\/api\/agents\/[^/]+\/mcp-servers$/) && method === 'PATCH') {
      const agentName = decodeURIComponent(pathname.slice('/api/agents/'.length, -'/mcp-servers'.length));
      const body = await readBody(req);
      const { servers } = JSON.parse(body) as { servers: string[] | null };
      try {
        orch.updateAgentMcpServers(resolveAgentName(agentName), servers ?? undefined);
        sseBroadcast({ type: 'agent_update', agents: this.deps.buildAgentStatuses() }); saveCurrentState().catch(() => {}); json(res, 200, { ok: true });
      } catch (err) { json(res, 400, { error: (err as Error).message }); }
      return true;
    }

    if (pathname.match(/^\/api\/agents\/[^/]+\/avatar$/) && method === 'PATCH') {
      const agentName = decodeURIComponent(pathname.slice('/api/agents/'.length, -'/avatar'.length));
      const body = await readBody(req);
      const { avatar } = JSON.parse(body) as { avatar?: string };
      try {
        orch.updateAgentAvatar(resolveAgentName(agentName), avatar?.trim() || undefined);
        sseBroadcast({ type: 'agent_update', agents: this.deps.buildAgentStatuses() }); saveCurrentState().catch(() => {}); json(res, 200, { ok: true });
      } catch (err) { json(res, 400, { error: (err as Error).message }); }
      return true;
    }

    if (pathname.match(/^\/api\/agents\/[^/]+\/background$/) && method === 'PATCH') {
      const agentName = decodeURIComponent(pathname.slice('/api/agents/'.length, -'/background'.length));
      const body = await readBody(req);
      const { background } = JSON.parse(body) as { background?: string };
      try {
        orch.updateAgentBackground(resolveAgentName(agentName), background?.trim() || undefined);
        sseBroadcast({ type: 'agent_update', agents: this.deps.buildAgentStatuses() }); saveCurrentState().catch(() => {}); json(res, 200, { ok: true });
      } catch (err) { json(res, 400, { error: (err as Error).message }); }
      return true;
    }

    if (pathname.match(/^\/api\/agents\/[^/]+\/hat$/) && method === 'PATCH') {
      const agentName = decodeURIComponent(pathname.slice('/api/agents/'.length, -'/hat'.length));
      const body = await readBody(req);
      const { hatTypes } = JSON.parse(body) as { hatTypes: string[] };
      const validHats = new Set(['none', 'white', 'red', 'black', 'yellow', 'green', 'blue']);
      const normalized = (hatTypes?.length ? hatTypes : ['none']);
      if (normalized.some(h => !validHats.has(h))) { json(res, 400, { error: `Invalid hat type in "${normalized}"` }); return true; }
      try {
        orch.changeAgentHat(resolveAgentName(agentName), normalized as HatType[]);
        sseBroadcast({ type: 'agent_update', agents: this.deps.buildAgentStatuses() }); saveCurrentState().catch(() => {}); json(res, 200, { ok: true });
      } catch (err) { json(res, 404, { error: (err as Error).message }); }
      return true;
    }

    if (pathname === '/api/agents' && method === 'POST') {
      const body = await readBody(req);
      const { name, hatTypes: rawHatTypes, visualDescription, specialisation, backstory, provider: providerName, model } =
        JSON.parse(body) as { name: string; hatTypes?: string[]; visualDescription?: string; specialisation?: string; backstory?: string; provider?: string; model?: string };
      if (!name?.trim()) { json(res, 400, { error: 'name is required' }); return true; }
      const validHats = new Set(['none', 'white', 'red', 'black', 'yellow', 'green', 'blue']);
      const hatTypes = rawHatTypes?.length ? rawHatTypes : ['none'];
      if (hatTypes.some(h => !validHats.has(h))) { json(res, 400, { error: `Invalid hat type in "${hatTypes}"` }); return true; }
      if (orch.listAgents().some(a => a.name.toLowerCase() === name.trim().toLowerCase())) {
        json(res, 409, { error: `Agent "${name}" already exists` }); return true;
      }
      const provider = makeProvider(providerName ?? 'anthropic') ?? new AnthropicProvider();
      const resolvedModel = model?.trim() || (
        providerName === 'openai'   ? (process.env['OPENAI_MODEL']    ?? 'gpt-4.1-mini') :
        providerName === 'gemini'   ? (process.env['GEMINI_MODEL']    ?? 'gemini-2.5-flash') :
        providerName === 'ollama'   ? (process.env['OLLAMA_MODEL']    ?? 'llama3.2') :
        providerName === 'lmstudio' ? (process.env['LM_STUDIO_MODEL'] ?? '') :
                                      (process.env['ANTHROPIC_MODEL'] ?? 'claude-haiku-4-5-20251001')
      );
      orch.registerAgent({
        identity: { name: name.trim(), visualDescription: visualDescription?.trim() || 'a focused, capable team member', specialisation: specialisation?.trim() || undefined, backstory: backstory?.trim() || undefined },
        hatType: hatTypes as HatType[], provider, model: resolvedModel,
      });
      sseBroadcast({ type: 'agent_update', agents: this.deps.buildAgentStatuses() }); saveCurrentState().catch(() => {}); json(res, 201, { ok: true });
      return true;
    }

    if (pathname.match(/^\/api\/agents\/[^/]+$/) && method === 'DELETE') {
      const agentName = decodeURIComponent(pathname.slice('/api/agents/'.length));
      try {
        const resolved = resolveAgentName(agentName);
        orch.removeAgent(resolved);
        const kanbanPath = this.deps.getKanbanPath();
        if (kanbanPath) {
          try {
            const board = await this.deps.readKanban();
            let changed = false;
            for (const ticket of Object.values(board.tickets)) {
              if (ticket.assignee?.toLowerCase() === resolved.toLowerCase() && (ticket.column === 'in_progress' || ticket.column === 'ready')) {
                ticket.column = 'backlog'; ticket.assignee = undefined; ticket.updatedAt = new Date().toISOString(); changed = true;
              }
            }
            if (changed) await this.deps.writeKanban(board);
          } catch { /* non-fatal */ }
        }
        agentActivity.delete(resolved); agentFeeds.delete(resolved.toLowerCase());
        const timer = talkingTimers.get(resolved);
        if (timer) { clearTimeout(timer); talkingTimers.delete(resolved); }
        agentTicketMap.delete(resolved.toLowerCase());
        sseBroadcast({ type: 'agent_update', agents: this.deps.buildAgentStatuses() }); saveCurrentState().catch(() => {}); json(res, 200, { ok: true });
      } catch (err) { json(res, 404, { error: (err as Error).message }); }
      return true;
    }

    if (pathname === '/api/mcp/catalogue' && method === 'GET') {
      const catalogue = getCatalogue().map(entry => ({
        ...entry,
        enabled: orch.hasMCPServer(entry.id),
        envStatus: (entry.envVars ?? []).map(v => ({ name: v, present: !!process.env[v] })),
      }));
      json(res, 200, catalogue);
      return true;
    }

    if (pathname === '/api/mcp/enable' && method === 'POST') {
      const body = await readBody(req);
      const { id } = JSON.parse(body) as { id: string };
      const entry = getCatalogue().find(e => e.id === id);
      if (!entry) { json(res, 404, { error: `Unknown MCP server "${id}"` }); return true; }
      if (orch.hasMCPServer(id)) { enabledMCPIds.add(id); json(res, 200, { ok: true }); return true; }
      try {
        const config = this.deps.resolveMCPConfig(id, entry);
        await orch.addMCPServer({ name: id, config });
        enabledMCPIds.add(id);
        await this.deps.saveMCPEnabled();
        sseBroadcast({ type: 'tools_update', tools: orch.getToolInfo() });
        json(res, 200, { ok: true });
      } catch (err) { json(res, 500, { error: (err as Error).message }); }
      return true;
    }

    if (pathname === '/api/mcp/disable' && method === 'POST') {
      const body = await readBody(req);
      const { id } = JSON.parse(body) as { id: string };
      try {
        await orch.removeMCPServer(id); enabledMCPIds.delete(id); await this.deps.saveMCPEnabled();
        sseBroadcast({ type: 'tools_update', tools: orch.getToolInfo() }); json(res, 200, { ok: true });
      } catch (err) { json(res, 500, { error: (err as Error).message }); }
      return true;
    }

    if (pathname === '/api/debug/logging') {
      if (method === 'POST') { const body = await readBody(req); const { enabled } = JSON.parse(body) as { enabled: boolean }; debugState.logPrompts = enabled; }
      json(res, 200, { logPrompts: debugState.logPrompts }); return true;
    }

    if (pathname === '/api/specialisations') { json(res, 200, { specialisations: Object.keys(SPECIALISATION_DIRECTIVES) }); return true; }

    if (pathname === '/api/avatars') {
      try { const raw = await (await import('fs/promises')).readFile(`${this.deps.avatarsDir}/avatars.json`, 'utf-8'); json(res, 200, JSON.parse(raw)); }
      catch { json(res, 404, { avatars: [] }); }
      return true;
    }

    if (pathname === '/api/pricing' && method === 'GET') { json(res, 200, { pricing: getPricingTable(), freeProviders: [...FREE_PROVIDERS] }); return true; }

    if (pathname === '/api/human-requests' && method === 'GET') { json(res, 200, { requests: this.deps.buildRequestsList() }); return true; }

    if (pathname.match(/^\/api\/human-requests\/[^/]+\/respond$/) && method === 'POST') {
      const reqId   = decodeURIComponent(pathname.slice('/api/human-requests/'.length, -'/respond'.length));
      const request = humanRequestStore.get(reqId);
      if (!request) { json(res, 404, { error: 'Request not found' }); return true; }
      if (request.status === 'answered') { json(res, 409, { error: 'Already answered' }); return true; }
      const body = await readBody(req);
      const { response } = JSON.parse(body) as { response?: string };
      if (!response?.trim()) { json(res, 400, { error: 'Response is required' }); return true; }
      await humanRequestStore.respond(reqId, response.trim());
      const replyContent = `You asked: "${request.message}"\n\nHuman's answer: ${response.trim()}\n\nNow continue your work based on this answer.`;
      await orch.humanReply(request.agentName, replyContent);
      const ticketId = request.relatedTicketId ?? agentTicketMap.get(request.agentName.toLowerCase());
      if (ticketId) this.deps.updateKanbanColumn(ticketId, 'in_progress').catch(() => {});
      sseBroadcast({ type: 'requests_update', requests: this.deps.buildRequestsList() });
      sseBroadcast({ type: 'agent_update',   agents:   this.deps.buildAgentStatuses() });
      json(res, 200, { ok: true });
      return true;
    }

    if (pathname === '/api/project/clear' && method === 'POST') {
      const dir = this.deps.getProjectDir();
      if (!dir) { json(res, 503, { error: 'No project loaded' }); return true; }
      try {
        // Stop all running agents first to prevent race conditions with saveCurrentState
        orch.stopAllAgents();

        // Clear agent histories and in-memory tasks
        orch.clearProject();

        // Persist the cleared state — agents preserved, histories/tasks gone
        await saveCurrentState();

        // Clear kanban board
        await this.deps.writeKanban({ tickets: {}, nextSeq: 1 });

        // Clear human requests
        await humanRequestStore.clear();

        // Delete and recreate sources/ and outputs/ folders
        for (const sub of ['sources', 'outputs']) {
          await rm(path.join(dir, sub), { recursive: true, force: true });
          await mkdir(path.join(dir, sub), { recursive: true });
        }
        await mkdir(path.join(dir, 'outputs', 'minutes'), { recursive: true });

        // Delete all TKT-* ticket work folders
        const entries = await readdir(dir, { withFileTypes: true });
        await Promise.all(
          entries
            .filter(e => e.isDirectory() && /^TKT-/i.test(e.name))
            .map(e => rm(path.join(dir, e.name), { recursive: true, force: true })),
        );

        // Broadcast refreshed state
        const agents   = this.deps.buildAgentStatuses();
        const requests = this.deps.buildRequestsList();
        sseBroadcast({ type: 'board_update',    board:    { tickets: {}, nextSeq: 1 } });
        sseBroadcast({ type: 'agent_update',    agents });
        sseBroadcast({ type: 'requests_update', requests });
        sseBroadcast({ type: 'files_update',    sources: [], outputs: [], tickets: [] });
        json(res, 200, { ok: true });
      } catch (err) {
        json(res, 500, { error: (err as Error).message });
      }
      return true;
    }

    if (pathname === '/api/providers' && method === 'GET') {
      const providers = await Promise.all(KNOWN_PROVIDERS.map(async p => {
        const pp = p as typeof p & { baseUrlEnvKey?: string; defaultBaseUrl?: string };
        const baseUrl = pp.baseUrlEnvKey ? (process.env[pp.baseUrlEnvKey] || pp.defaultBaseUrl || '') : undefined;
        let available: boolean;
        if (p.envKey) { available = !!process.env[p.envKey]; }
        else if (baseUrl) { available = await probeLocalLLM(baseUrl); }
        else { available = false; }
        const cached = getModelCacheEntry(p.id);
        const models = (cached && (Date.now() - cached.ts) < (p.id === 'ollama' || p.id === 'lmstudio' ? 5 * 60 * 1000 : 24 * 60 * 60 * 1000)) ? cached.models : [...p.models];
        return { ...p, models, available, defaultModel: process.env[p.modelEnvKey] ?? models[0] ?? '', baseUrl };
      }));
      json(res, 200, providers);
      return true;
    }

    if (pathname === '/api/providers/models' && method === 'GET') {
      if (url.searchParams.get('refresh') === 'true') { for (const p of KNOWN_PROVIDERS) clearModelCache(p.id); }
      const results = await Promise.all(KNOWN_PROVIDERS.map(async p => ({ id: p.id, models: await getCachedModels(p) })));
      json(res, 200, results);
      return true;
    }

    // ── Personal MCP endpoints ─────────────────────────────────────────────

    if (pathname.match(/^\/api\/agents\/[^/]+\/personal-mcp$/) && method === 'GET') {
      const agentName = decodeURIComponent(pathname.slice('/api/agents/'.length, -'/personal-mcp'.length));
      const resolved  = resolveAgentName(agentName);
      const agent     = orch.getAgent(resolved);
      if (!agent) { json(res, 404, { error: `Agent "${agentName}" not found` }); return true; }
      const savedCreds   = orch.getPersonalMcpCredentials(resolved);
      const personalEntries: MCPCatalogueEntry[] = getCatalogue().filter(e => e.personal);
      const result = personalEntries.map(e => ({
        id:          e.id,
        name:        e.name,
        description: e.description,
        url:         e.url,
        envVars:     e.envVars ?? [],
        notes:       e.notes,
        configured:  !!savedCreds[e.id],
        credentials: savedCreds[e.id] ?? {},
      }));
      json(res, 200, result);
      return true;
    }

    if (pathname.match(/^\/api\/agents\/[^/]+\/personal-mcp\/[^/]+$/) && method === 'PUT') {
      const parts     = pathname.split('/');
      const serverId  = decodeURIComponent(parts[parts.length - 1]);
      const agentName = decodeURIComponent(parts.slice(3, -2).join('/'));
      const body      = await readBody(req);
      const { credentials } = JSON.parse(body) as { credentials: Record<string, string> };
      if (!credentials || typeof credentials !== 'object') { json(res, 400, { error: 'credentials object required' }); return true; }
      try {
        await orch.enablePersonalMcp(resolveAgentName(agentName), serverId, credentials);
        await saveCurrentState();
        sseBroadcast({ type: 'agent_update', agents: this.deps.buildAgentStatuses() });
        json(res, 200, { ok: true });
      } catch (err) { json(res, 400, { error: (err as Error).message }); }
      return true;
    }

    if (pathname.match(/^\/api\/agents\/[^/]+\/personal-mcp\/[^/]+$/) && method === 'DELETE') {
      const parts    = pathname.split('/');
      const serverId = decodeURIComponent(parts[parts.length - 1]);
      const agentName = decodeURIComponent(parts.slice(3, -2).join('/'));
      try {
        await orch.disablePersonalMcp(resolveAgentName(agentName), serverId);
        await saveCurrentState();
        sseBroadcast({ type: 'agent_update', agents: this.deps.buildAgentStatuses() });
        json(res, 200, { ok: true });
      } catch (err) { json(res, 400, { error: (err as Error).message }); }
      return true;
    }

    if (pathname === '/api/personas' && method === 'GET') {
      json(res, 200, personasByHat);
      return true;
    }

    if (pathname.match(/^\/api\/agents\/[^/]+\/identity$/) && method === 'PATCH') {
      const agentName = decodeURIComponent(pathname.slice('/api/agents/'.length, -'/identity'.length));
      const body = await readBody(req);
      const { visualDescription, backstory } = JSON.parse(body) as { visualDescription?: string; backstory?: string };
      try {
        orch.updateAgentIdentity(
          resolveAgentName(agentName),
          visualDescription !== undefined ? (visualDescription.trim() || undefined) : undefined,
          backstory !== undefined ? (backstory.trim() || undefined) : undefined,
        );
        sseBroadcast({ type: 'agent_update', agents: this.deps.buildAgentStatuses() });
        saveCurrentState().catch(() => {});
        json(res, 200, { ok: true });
      } catch (err) { json(res, 404, { error: (err as Error).message }); }
      return true;
    }

    // ── Global agent library ───────────────────────────────────────────────

    if (pathname === '/api/global-agents' && method === 'GET') {
      const store = this.deps.getAgentStore();
      json(res, 200, store ? store.list() : []);
      return true;
    }

    if (pathname === '/api/global-agents' && method === 'POST') {
      const store = this.deps.getAgentStore();
      if (!store) { json(res, 503, { error: 'Agent store not ready' }); return true; }
      const body = await readBody(req);
      const { name, hatTypes: rawHatTypes, visualDescription, specialisation, backstory, provider: providerName, model } =
        JSON.parse(body) as { name: string; hatTypes?: string[]; visualDescription?: string; specialisation?: string; backstory?: string; provider?: string; model?: string };
      if (!name?.trim()) { json(res, 400, { error: 'name is required' }); return true; }
      const validHats = new Set(['none', 'white', 'red', 'black', 'yellow', 'green', 'blue']);
      const hatTypes  = rawHatTypes?.length ? rawHatTypes : ['none'];
      if (hatTypes.some(h => !validHats.has(h))) { json(res, 400, { error: `Invalid hat type` }); return true; }
      const resolvedProvider = providerName ?? 'anthropic';
      const resolvedModel    = model?.trim() || (process.env['ANTHROPIC_MODEL'] ?? 'claude-haiku-4-5-20251001');
      const { v4: uuidv4 } = await import('uuid');
      const def = await store.addOrUpdate({
        id: uuidv4(),
        identity: { name: name.trim(), visualDescription: visualDescription?.trim() || 'a focused, capable team member', specialisation: specialisation?.trim() || undefined, backstory: backstory?.trim() || undefined },
        hatType: hatTypes as import('../hats/types.js').HatType[],
        model: resolvedModel, providerName: resolvedProvider,
        scheduledActionIds: [],
      });
      json(res, 201, def);
      return true;
    }

    // Add a global agent into the current project's running team
    if (pathname === '/api/project/add-agent' && method === 'POST') {
      const agentStore = this.deps.getAgentStore();
      if (!agentStore) { json(res, 503, { error: 'Agent store not ready' }); return true; }
      const body    = await readBody(req);
      const { agentId } = JSON.parse(body) as { agentId: string };
      const def = agentStore.get(agentId);
      if (!def) { json(res, 404, { error: 'Agent not found in library' }); return true; }
      if (orch.listAgents().some(a => a.id === agentId)) {
        json(res, 409, { error: 'Agent is already in this project' }); return true;
      }
      const provider = makeProvider(def.providerName) ?? new AnthropicProvider();
      orch.registerAgent({ id: def.id, identity: def.identity, hatType: def.hatType, provider, model: def.model, enabledMcpServers: def.enabledMcpServers, personalMcpCredentials: def.personalMcpCredentials });
      sseBroadcast({ type: 'agent_update', agents: this.deps.buildAgentStatuses() });
      saveCurrentState().catch(() => {});
      json(res, 200, { ok: true });
      return true;
    }

    if (pathname.match(/^\/api\/global-agents\/[^/]+\/scheduled-actions$/) && method === 'PUT') {
      const agentId    = decodeURIComponent(pathname.slice('/api/global-agents/'.length, -'/scheduled-actions'.length));
      const agentStore = this.deps.getAgentStore();
      const actionStore = this.deps.getActionStore();
      if (!agentStore) { json(res, 503, { error: 'Agent store not ready' }); return true; }
      const def = agentStore.get(agentId);
      if (!def) { json(res, 404, { error: 'Agent not found' }); return true; }
      const body = await readBody(req);
      const { scheduledActionIds } = JSON.parse(body) as { scheduledActionIds: string[] };
      const ids = scheduledActionIds ?? [];
      await agentStore.addOrUpdate({ ...def, scheduledActionIds: ids });
      // Seed runtime agenda entries for newly assigned actions
      if (actionStore) {
        const agendaStore = orch.getAgendaStore();
        const agent       = orch.listAgents().find(a => a.id === agentId);
        if (agendaStore && agent) {
          const existing = agendaStore.list(agent.name).map(e => (e as { actionId?: string }).actionId).filter(Boolean);
          for (const actionId of ids) {
            if (existing.includes(actionId)) continue;
            const actionDef = actionStore.get(actionId);
            if (!actionDef) continue;
            await agendaStore.add({
              agentName: agent.name,
              label: actionDef.label,
              description: actionDef.description,
              intervalSeconds: actionDef.intervalSeconds,
            } as Parameters<typeof agendaStore.add>[0]);
          }
        }
      }
      json(res, 200, { ok: true });
      return true;
    }

    if (pathname.match(/^\/api\/global-agents\/[^/]+$/) && method === 'PATCH') {
      const agentId = decodeURIComponent(pathname.slice('/api/global-agents/'.length));
      const store   = this.deps.getAgentStore();
      if (!store) { json(res, 503, { error: 'Agent store not ready' }); return true; }
      const def = store.get(agentId);
      if (!def) { json(res, 404, { error: 'Agent not found' }); return true; }
      const body = await readBody(req);
      const patch = JSON.parse(body) as {
        name?: string; hatTypes?: string[]; visualDescription?: string;
        backstory?: string; specialisation?: string; email?: string;
        provider?: string; model?: string;
      };
      const validHats = new Set(['none', 'white', 'red', 'black', 'yellow', 'green', 'blue']);
      if (patch.hatTypes && patch.hatTypes.some(h => !validHats.has(h))) {
        json(res, 400, { error: 'Invalid hat type' }); return true;
      }
      const updated = {
        ...def,
        identity: {
          ...def.identity,
          ...(patch.name              !== undefined && { name: patch.name.trim() }),
          ...(patch.visualDescription !== undefined && { visualDescription: patch.visualDescription.trim() || undefined }),
          ...(patch.backstory         !== undefined && { backstory: patch.backstory.trim() || undefined }),
          ...(patch.specialisation    !== undefined && { specialisation: patch.specialisation.trim() || undefined }),
          ...(patch.email             !== undefined && { email: patch.email.trim() || undefined }),
        },
        ...(patch.hatTypes  !== undefined && { hatType: patch.hatTypes as import('../hats/types.js').HatType[] }),
        ...(patch.provider  !== undefined && { providerName: patch.provider }),
        ...(patch.model     !== undefined && { model: patch.model.trim() }),
      };
      await store.addOrUpdate(updated);
      // Sync name change to running agent if in current project
      if (patch.name) {
        const runningAgent = orch.listAgents().find(a => a.id === agentId);
        if (runningAgent && patch.name.trim() !== runningAgent.name) {
          try { orch.renameAgent(runningAgent.name, patch.name.trim()); } catch { /* non-fatal */ }
        }
      }
      if (patch.hatTypes) {
        const runningAgent = orch.listAgents().find(a => a.id === agentId);
        if (runningAgent) orch.changeAgentHat(runningAgent.name, updated.hatType);
      }
      saveCurrentState().catch(() => {});
      sseBroadcast({ type: 'agent_update', agents: this.deps.buildAgentStatuses() });
      json(res, 200, updated);
      return true;
    }

    if (pathname.match(/^\/api\/global-agents\/[^/]+$/) && method === 'DELETE') {
      const agentId = decodeURIComponent(pathname.slice('/api/global-agents/'.length));
      const store   = this.deps.getAgentStore();
      if (!store) { json(res, 503, { error: 'Agent store not ready' }); return true; }
      const ok = await store.remove(agentId);
      json(res, ok ? 200 : 404, ok ? { ok: true } : { error: 'Agent not found in library' });
      return true;
    }

    // ── Global scheduled actions ───────────────────────────────────────────

    if (pathname === '/api/scheduled-actions' && method === 'GET') {
      const store = this.deps.getActionStore();
      json(res, 200, store ? store.list() : []);
      return true;
    }

    if (pathname === '/api/scheduled-actions' && method === 'POST') {
      const store = this.deps.getActionStore();
      if (!store) { json(res, 503, { error: 'Action store not ready' }); return true; }
      const body = await readBody(req);
      const { label, description, intervalMinutes } = JSON.parse(body) as { label: string; description: string; intervalMinutes?: number };
      if (!label?.trim() || !description?.trim()) {
        json(res, 400, { error: 'label and description are required' }); return true;
      }
      const intervalSeconds = (intervalMinutes && intervalMinutes > 0) ? Math.round(intervalMinutes * 60) : null;
      const def = await store.add({ label: label.trim(), description: description.trim(), intervalSeconds });
      json(res, 201, def);
      return true;
    }

    if (pathname.match(/^\/api\/scheduled-actions\/[^/]+$/) && method === 'PATCH') {
      const actionId = decodeURIComponent(pathname.slice('/api/scheduled-actions/'.length));
      const store    = this.deps.getActionStore();
      if (!store) { json(res, 503, { error: 'Action store not ready' }); return true; }
      const body = await readBody(req);
      const { label, description, intervalMinutes } = JSON.parse(body) as { label?: string; description?: string; intervalMinutes?: number | null };
      const patch: Record<string, unknown> = {};
      if (label       !== undefined) patch['label']           = label.trim();
      if (description !== undefined) patch['description']     = description.trim();
      if (intervalMinutes !== undefined) {
        patch['intervalSeconds'] = (intervalMinutes && intervalMinutes > 0) ? Math.round(intervalMinutes * 60) : null;
      }
      const updated = await store.update(actionId, patch as never);
      json(res, updated ? 200 : 404, updated ?? { error: 'Action not found' });
      return true;
    }

    if (pathname.match(/^\/api\/scheduled-actions\/[^/]+$/) && method === 'DELETE') {
      const actionId = decodeURIComponent(pathname.slice('/api/scheduled-actions/'.length));
      const store    = this.deps.getActionStore();
      if (!store) { json(res, 503, { error: 'Action store not ready' }); return true; }
      const ok = await store.remove(actionId);
      json(res, ok ? 200 : 404, ok ? { ok: true } : { error: 'Action not found' });
      return true;
    }

    return false;
  }
}
