import { IncomingMessage, ServerResponse } from 'http';
import { TeamOrchestrator } from '../orchestrator/orchestrator.js';
import { HumanRequest } from '../orchestrator/types.js';
import { StoredEvent } from '../store/event-store.js';
import { Board } from '../mcp/kanban/types.js';
import { MCP_CATALOGUE } from '../mcp/mcp-catalogue.js';
import { debugState } from '../providers/debug-state.js';
import { HatType } from '../hats/types.js';
import { SPECIALISATION_DIRECTIVES, generateSystemPrompt } from '../prompt/generator.js';
import { getHatDefinition } from '../hats/definitions.js';
import { getPricingTable, FREE_PROVIDERS } from '../providers/pricing.js';
import { AnthropicProvider } from '../providers/anthropic.js';
import { makeProvider, KNOWN_PROVIDERS, probeLocalLLM, getCachedModels, getModelCacheEntry, clearModelCache } from './providers.js';
import { AgentStatus } from './project-manager.js';

export interface AgentRouterDeps {
  getOrchestrator(): TeamOrchestrator;
  agentFeeds: Map<string, StoredEvent[]>;
  humanRequests: Map<string, HumanRequest>;
  agentTicketMap: Map<string, string>;
  agentActivity: Map<string, { activity: string; talkingTo?: string }>;
  talkingTimers: Map<string, ReturnType<typeof setTimeout>>;
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
    const { json, readBody, resolveAgentName, sseBroadcast, saveCurrentState, agentFeeds, humanRequests, agentTicketMap, agentActivity, talkingTimers, enabledMCPIds } = this.deps;
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
      const hatParam  = url.searchParams.get('hat') as HatType | null;
      const specParam = url.searchParams.get('specialisation') ?? undefined;
      const nameParam = url.searchParams.get('name') ?? undefined;
      try {
        const resolved = resolveAgentName(agentName);
        const agent    = orch.getAgent(resolved);
        if (!agent) { json(res, 404, { error: `Agent "${agentName}" not found` }); return true; }
        const hatType = hatParam ?? agent.hatType;
        const hat     = getHatDefinition(hatType);
        const prompt  = generateSystemPrompt({
          name: nameParam ?? agent.config.identity.name,
          visualDescription: agent.config.identity.visualDescription,
          backstory: agent.config.identity.backstory,
          hatLabel: hat.label, thinkingStyle: hat.thinkingStyle,
          communicationTone: hat.communicationTone, directives: hat.directives,
          avoidances: hat.avoidances, teamRole: hat.teamRole,
          teamContext: agent.config.teamContext, projectDir: agent.config.projectDir,
          projectGoal: agent.config.projectGoal,
          specialisation: specParam !== undefined ? specParam : agent.config.identity.specialisation,
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
      const { hatType } = JSON.parse(body) as { hatType: string };
      const validHats = ['white', 'red', 'black', 'yellow', 'green', 'blue'];
      if (!validHats.includes(hatType)) { json(res, 400, { error: `Invalid hat type "${hatType}"` }); return true; }
      try {
        orch.changeAgentHat(resolveAgentName(agentName), hatType as HatType);
        sseBroadcast({ type: 'agent_update', agents: this.deps.buildAgentStatuses() }); saveCurrentState().catch(() => {}); json(res, 200, { ok: true });
      } catch (err) { json(res, 404, { error: (err as Error).message }); }
      return true;
    }

    if (pathname === '/api/agents' && method === 'POST') {
      const body = await readBody(req);
      const { name, hatType, visualDescription, specialisation, backstory, provider: providerName, model } =
        JSON.parse(body) as { name: string; hatType: string; visualDescription?: string; specialisation?: string; backstory?: string; provider?: string; model?: string };
      if (!name?.trim()) { json(res, 400, { error: 'name is required' }); return true; }
      const validHats = ['white', 'red', 'black', 'yellow', 'green', 'blue'];
      if (!validHats.includes(hatType)) { json(res, 400, { error: `Invalid hat type "${hatType}"` }); return true; }
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
        hatType: hatType as HatType, provider, model: resolvedModel,
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
      const catalogue = MCP_CATALOGUE.map(entry => ({
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
      const entry = MCP_CATALOGUE.find(e => e.id === id);
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
      const request = humanRequests.get(reqId);
      if (!request) { json(res, 404, { error: 'Request not found' }); return true; }
      if (request.status === 'answered') { json(res, 409, { error: 'Already answered' }); return true; }
      const body = await readBody(req);
      const { response } = JSON.parse(body) as { response?: string };
      if (!response?.trim()) { json(res, 400, { error: 'Response is required' }); return true; }
      request.status = 'answered'; request.response = response.trim(); request.answeredAt = new Date().toISOString();
      await orch.humanReply(request.agentName, response.trim());
      const ticketId = request.relatedTicketId ?? agentTicketMap.get(request.agentName.toLowerCase());
      if (ticketId) this.deps.updateKanbanColumn(ticketId, 'in_progress').catch(() => {});
      sseBroadcast({ type: 'requests_update', requests: this.deps.buildRequestsList() });
      sseBroadcast({ type: 'agent_update',   agents:   this.deps.buildAgentStatuses() });
      json(res, 200, { ok: true });
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

    return false;
  }
}
