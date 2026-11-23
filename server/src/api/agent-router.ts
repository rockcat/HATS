import { IncomingMessage, ServerResponse } from 'http';
import { rm, mkdir, readdir } from 'fs/promises';
import * as path from 'path';
import { TeamOrchestrator } from '../orchestrator/orchestrator.js';
import { HumanRequest } from '../orchestrator/types.js';
import { HumanRequestStore } from './human-request-store.js';
import { StoredEvent } from '../store/event-store.js';
import { Board } from '../mcp/kanban/types.js';
import { MCPCatalogueEntry, isAgentMcp } from '../../../packages/core/src/mcp/mcp-catalogue.js';
import { getCatalogue } from '../../../packages/core/src/mcp/catalogue-store.js';
import { debugState } from '../providers/debug-state.js';
import { HatType } from '../../../packages/core/src/hats/types.js';
import { SPECIALISATION_DIRECTIVES, generateSystemPrompt } from '../../../packages/core/src/prompt/generator.js';
import { mergeHatDefinitions } from '../../../packages/core/src/hats/definitions.js';
import { personasByHat } from '../../../packages/core/src/hats/personas.js';
import { getPricingTable, FREE_PROVIDERS, reloadPricingFromFile } from '../providers/pricing.js';
import { getToolsForHat } from '../../../packages/core/src/tools/definitions.js';
import { AnthropicProvider } from '../providers/anthropic.js';
import { makeProvider, KNOWN_PROVIDERS, probeLocalLLM, getCachedModels, getModelCacheEntry, clearModelCache } from './providers.js';
import { EXTERNAL_PROVIDER } from '../agent/external-agent.js';
import { SCHEDULED_THREAD } from '../agent/agent.js';
import { AgentStatus } from './project-manager.js';
import { AgentDefinitionStore } from './agent-store.js';
import { ScheduledActionStore } from './scheduled-action-store.js';
import { propagateEdit, removeCopies, lastRunOf, isCopyOf } from './agenda-sync.js';
import { promptModeFrom, repeatFromRequest, type Repeat } from './agenda-store.js';
import { projectCopy, hasCopyOf, assignScheduledActions } from './project-agents.js';
import { parseLimits } from './agent-limits.js';
import { toolRows, selectorsFor } from '../tools/tool-listing.js';
import { Task } from '../orchestrator/types.js';

function labelForThread(key: string, tasks: Task[]): string {
  if (key === 'general') return 'general';
  if (key === SCHEDULED_THREAD) return 'Scheduled runs';
  const task = tasks.find(t => t.id === key);
  if (!task) return key;
  const m = task.description.match(/^Work on ticket (TKT-\d+): ([^\n]+)/);
  if (m) {
    const title = m[2].length > 35 ? m[2].slice(0, 35) + '…' : m[2];
    return `${m[1]}: ${title}`;
  }
  const first = task.description.split('\n')[0];
  return first.length > 45 ? first.slice(0, 45) + '…' : first;
}

/** Extract the original sender from the [TYPE from Name] prefix added by formatIncomingMessage. */
function extractMessageSender(role: string, content: string): string | undefined {
  if (role !== 'user') return undefined;
  const m = content.match(/^\[(?:TASK|MESSAGE|ESCALATION|MEETING INVITE|TASK COMPLETE) from ([^\]]+)\]/);
  return m ? m[1] : undefined;
}

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
  resolveMCPConfig(id: string, entry: import('../../../packages/core/src/mcp/mcp-catalogue.js').MCPCatalogueEntry): ReturnType<typeof import('../../../packages/core/src/mcp/mcp-catalogue.js').resolveConfig>;
  saveMCPEnabled(): Promise<void>;
  enabledMCPIds: Set<string>;
  getAgentStore(): AgentDefinitionStore | null;
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

  /**
   * Take an agent off the team: its open tickets go back to the backlog, its
   * activity is forgotten, and the dashboard is told. Throws when there is no
   * such agent.
   */
  async retireAgent(name: string): Promise<void> {
    const { agentFeeds, agentTicketMap, agentActivity, talkingTimers } = this.deps;
    const orch = this.deps.getOrchestrator();
    const agentId = orch.agentIdForName(name) ?? name;
    await orch.removeAgent(name);
    await this.returnTicketsToBacklog(name);
    agentActivity.delete(agentId); agentFeeds.delete(agentId);
    const timer = talkingTimers.get(agentId);
    if (timer) { clearTimeout(timer); talkingTimers.delete(agentId); }
    agentTicketMap.delete(agentId);
    this.teamChanged();
  }

  /** Tell the dashboard the team changed, and save it. */
  teamChanged(): void {
    this.deps.sseBroadcast({ type: 'agent_update', agents: this.deps.buildAgentStatuses() });
    this.deps.saveCurrentState().catch(() => {});
  }

  private async returnTicketsToBacklog(name: string): Promise<void> {
    if (!this.deps.getKanbanPath()) return;
    try {
      const board = await this.deps.readKanban();
      let changed = false;
      for (const ticket of Object.values(board.tickets)) {
        if (ticket.assignee?.toLowerCase() === name.toLowerCase() && (ticket.column === 'in_progress' || ticket.column === 'ready')) {
          ticket.column = 'backlog'; ticket.assignee = undefined; ticket.updatedAt = new Date().toISOString(); changed = true;
        }
      }
      if (changed) await this.deps.writeKanban(board);
    } catch { /* non-fatal */ }
  }

  async handleRoutes(pathname: string, method: string, url: URL, req: IncomingMessage, res: ServerResponse): Promise<boolean> {
    const { json, readBody, resolveAgentName, sseBroadcast, saveCurrentState, agentFeeds, humanRequestStore, agentTicketMap, agentActivity, talkingTimers, enabledMCPIds } = this.deps;
    const orch = this.deps.getOrchestrator();

    if (pathname.startsWith('/api/agents/') && pathname.endsWith('/feed')) {
      const name = decodeURIComponent(pathname.slice('/api/agents/'.length, -'/feed'.length));
      const id   = this.deps.resolveAgentName(name);
      const agent = orch.listAgents().find(a => a.name === id) ?? orch.findById(name);
      json(res, 200, (agent ? agentFeeds.get(agent.id) : null) ?? []);
      return true;
    }

    if (pathname.startsWith('/api/agents/') && pathname.endsWith('/threads')) {
      const name  = decodeURIComponent(pathname.slice('/api/agents/'.length, -'/threads'.length));
      const agent = orch.listAgents().find(a => a.name === resolveAgentName(name)) ?? orch.findById(name);
      if (!agent) { json(res, 404, { error: 'Agent not found' }); return true; }
      const tasks  = orch.listTasks();
      const summary = agent.getThreadSummary();
      const rich: Record<string, { count: number; label: string }> = {};
      for (const [key, count] of Object.entries(summary)) {
        rich[key] = { count, label: labelForThread(key, tasks) };
      }
      json(res, 200, rich);
      return true;
    }

    if (pathname.startsWith('/api/agents/') && pathname.endsWith('/history')) {
      const name    = decodeURIComponent(pathname.slice('/api/agents/'.length, -'/history'.length));
      const agent   = orch.listAgents().find(a => a.name === resolveAgentName(name)) ?? orch.findById(name);
      if (!agent) { json(res, 404, { error: 'Agent not found' }); return true; }
      const thread  = url.searchParams.get('thread') ?? 'general';
      const history = agent.getThreadHistory(thread);
      json(res, 200, history.map(m => ({
        role:      m.role,
        content:   m.content,
        timestamp: m.timestamp instanceof Date ? m.timestamp.toISOString() : m.timestamp,
        toolName:  m.toolName,
        from:      extractMessageSender(m.role, m.content),
      })));
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

    // Standalone prompt preview — no running agent required; all params from query string
    if (pathname === '/api/prompt-preview' && method === 'GET') {
      const hatParams = url.searchParams.getAll('hat') as HatType[];
      const nameParam = url.searchParams.get('name') ?? 'Agent';
      const specParam = url.searchParams.get('specialisation') ?? undefined;
      const backstory = url.searchParams.get('backstory') ?? undefined;
      const visualDescription = url.searchParams.get('visualDescription') ?? '';
      try {
        const hat    = mergeHatDefinitions(hatParams.length > 0 ? hatParams : ['white' as HatType]);
        const prompt = generateSystemPrompt({
          name: nameParam, visualDescription, backstory,
          hatLabel: hat.label, coreTrait: hat.coreTrait, thinkingStyle: hat.thinkingStyle,
          communicationTone: hat.communicationTone, directives: hat.directives,
          avoidances: hat.avoidances, teamRole: hat.teamRole,
          specialisation: specParam,
        });
        const toolsJson = JSON.stringify(getToolsForHat(hatParams.length > 0 ? hatParams : ['white' as HatType]));
        json(res, 200, { prompt: prompt.text, condensed: prompt.condensed, sections: prompt.sections, toolsChars: toolsJson.length });
      } catch (err) { json(res, 400, { error: (err as Error).message }); }
      return true;
    }

    if (pathname.match(/^\/api\/agents\/[^/]+\/prompt-preview$/) && method === 'GET') {
      const agentName = decodeURIComponent(pathname.slice('/api/agents/'.length, -'/prompt-preview'.length));
      const hatParams = url.searchParams.getAll('hat') as HatType[];
      const specParam = url.searchParams.get('specialisation') ?? undefined;
      const nameParam = url.searchParams.get('name') ?? undefined;
      const instructionsParam = url.searchParams.get('instructions') ?? undefined;
      try {
        const resolved = resolveAgentName(agentName);
        const agent    = orch.getAgent(resolved);
        if (!agent) { json(res, 404, { error: `Agent "${agentName}" not found` }); return true; }
        if (!agent.previewPrompt) { json(res, 400, { error: 'This agent has no prompt of its own' }); return true; }
        const hatTypes = hatParams.length > 0 ? hatParams : agent.hatType;
        const prompt   = agent.previewPrompt({ hatTypes, name: nameParam, specialisation: specParam, instructions: instructionsParam });
        const toolsJson2 = JSON.stringify(getToolsForHat(hatTypes));
        json(res, 200, {
          prompt: prompt.text, condensed: prompt.condensed, sections: prompt.sections, toolsChars: toolsJson2.length,
          promptMode: agent.config.promptMode ?? 'full',
        });
      } catch (err) { json(res, 400, { error: (err as Error).message }); }
      return true;
    }

    // Free-text instructions, and which prompt the agent is given
    if (pathname.match(/^\/api\/agents\/[^/]+\/prompt$/) && method === 'PATCH') {
      const agentName = decodeURIComponent(pathname.slice('/api/agents/'.length, -'/prompt'.length));
      const { instructions, promptMode } = JSON.parse(await readBody(req)) as { instructions?: string; promptMode?: string };
      if (promptMode !== undefined && promptMode !== 'full' && promptMode !== 'condensed') {
        json(res, 400, { error: 'promptMode must be "full" or "condensed"' }); return true;
      }
      try {
        orch.updateAgentPromptSettings(resolveAgentName(agentName), instructions?.trim() || undefined,
          promptMode === 'condensed' ? 'condensed' : undefined);
        sseBroadcast({ type: 'agent_update', agents: this.deps.buildAgentStatuses() });
        saveCurrentState().catch(() => {});
        json(res, 200, { ok: true });
      } catch (err) { json(res, 400, { error: (err as Error).message }); }
      return true;
    }

    // This project's copy only: it started with its template's limits, and the
    // library editor changes the template, which the copy no longer follows.
    if (pathname.match(/^\/api\/agents\/[^/]+\/limits$/) && method === 'PATCH') {
      const agentName = decodeURIComponent(pathname.slice('/api/agents/'.length, -'/limits'.length));
      try {
        const name  = resolveAgentName(agentName);
        const patch = parseLimits(JSON.parse(await readBody(req)) as Record<string, unknown>);
        if ('maxCostPerHour' in patch) orch.updateAgentMaxCostPerHour(name, patch.maxCostPerHour);
        if ('maxContextTokens' in patch) orch.updateAgentMaxContextTokens(name, patch.maxContextTokens);
        sseBroadcast({ type: 'agent_update', agents: this.deps.buildAgentStatuses() });
        saveCurrentState().catch(() => {});
        json(res, 200, { ok: true });
      } catch (err) { json(res, 400, { error: (err as Error).message }); }
      return true;
    }

    // Every tool this project's copy can reach, its size, and whether it is
    // sent in every call or found with search_tools.
    if (pathname.match(/^\/api\/agents\/[^/]+\/tools$/) && (method === 'GET' || method === 'PATCH')) {
      const agentName = decodeURIComponent(pathname.slice('/api/agents/'.length, -'/tools'.length));
      try {
        const name  = resolveAgentName(agentName);
        const agent = orch.getAgent(name);
        if (!agent) { json(res, 404, { error: `Agent "${agentName}" not found` }); return true; }
        // ?default=1 shows what the default selection would send, before choosing it.
        const asDefault = method === 'GET' && url.searchParams.get('default') === '1';
        const { available, split } = orch.agentToolSet(name, asDefault ? null : undefined);
        const rows = toolRows(getToolsForHat(agent.hatType), available, split);
        if (method === 'GET') {
          json(res, 200, { rows, custom: agent.config.upfrontTools !== undefined });
          return true;
        }
        // { upfront: [tool names] } to choose, or { upfront: null } for the default.
        const { upfront } = JSON.parse(await readBody(req)) as { upfront?: string[] | null };
        if (upfront !== null && !Array.isArray(upfront)) { json(res, 400, { error: 'upfront must be a list of tool names, or null' }); return true; }
        orch.updateAgentUpfrontTools(name, upfront === null ? undefined : selectorsFor(rows, upfront));
        saveCurrentState().catch(() => {});
        json(res, 200, { ok: true });
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
        await orch.renameAgent(resolved, newName.trim());
        // Maps are keyed by stable agent ID — no migration needed on rename.
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
        const resolved = resolveAgentName(agentName);
        orch.updateAgentMcpServers(resolved, servers ?? undefined);
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

    if (pathname === '/api/agents/external/callback' && method === 'POST') {
      try {
        const body = await readBody(req);
        const { agentId, messageId, response } =
          JSON.parse(body) as { agentId: string; messageId: string; response: string };
        if (!agentId || !messageId || typeof response !== 'string') {
          json(res, 400, { error: 'agentId, messageId and response are required' }); return true;
        }
        await orch.deliverExternalCallback(agentId, messageId, response);
        json(res, 200, { ok: true });
      } catch (err) {
        json(res, 400, { error: (err as Error).message });
      }
      return true;
    }

    if (pathname === '/api/agents' && method === 'POST') {
      const body = await readBody(req);
      const parsed = JSON.parse(body) as {
        name: string; hatTypes?: string[]; visualDescription?: string; specialisation?: string;
        backstory?: string; provider?: string; model?: string;
        externalEndpoint?: { url: string; authHeader?: string; callbackUrl?: string; mode?: string; timeoutMs?: number };
      };
      const { name, hatTypes: rawHatTypes, visualDescription, specialisation, backstory, provider: providerName, model, externalEndpoint } = parsed;
      if (!name?.trim()) { json(res, 400, { error: 'name is required' }); return true; }
      const validHats = new Set(['none', 'white', 'red', 'black', 'yellow', 'green', 'blue']);
      const hatTypes = rawHatTypes?.length ? rawHatTypes : ['none'];
      if (hatTypes.some(h => !validHats.has(h))) { json(res, 400, { error: `Invalid hat type in "${hatTypes}"` }); return true; }
      if (orch.listAgents().some(a => a.name.toLowerCase() === name.trim().toLowerCase())) {
        json(res, 409, { error: `Agent "${name}" already exists` }); return true;
      }
      const identity = { name: name.trim(), visualDescription: visualDescription?.trim() || 'a focused, capable team member', specialisation: specialisation?.trim() || undefined, backstory: backstory?.trim() || undefined };
      if (providerName === 'external' || externalEndpoint) {
        if (!externalEndpoint?.url) { json(res, 400, { error: 'externalEndpoint.url is required for external agents' }); return true; }
        orch.registerAgent({
          identity, hatType: hatTypes as HatType[],
          provider: { name: 'external', pricingPageUrl: '', complete: async () => { throw new Error(); } },
          model: 'external',
          externalEndpoint: { url: externalEndpoint.url, authHeader: externalEndpoint.authHeader, callbackUrl: externalEndpoint.callbackUrl, mode: (externalEndpoint.mode ?? 'sync') as 'sync' | 'callback', timeoutMs: externalEndpoint.timeoutMs },
        });
      } else {
        const provider = makeProvider(providerName ?? 'anthropic') ?? new AnthropicProvider();
        const resolvedModel = model?.trim() || (
          providerName === 'openai'   ? (process.env['OPENAI_MODEL']    ?? 'gpt-4.1-mini') :
          providerName === 'gemini'   ? (process.env['GEMINI_MODEL']    ?? 'gemini-2.5-flash') :
          providerName === 'ollama'   ? (process.env['OLLAMA_MODEL']    ?? 'llama3.2') :
          providerName === 'lmstudio' ? (process.env['LM_STUDIO_MODEL'] ?? '') :
                                        (process.env['ANTHROPIC_MODEL'] ?? 'claude-haiku-4-5-20251001')
        );
        orch.registerAgent({ identity, hatType: hatTypes as HatType[], provider, model: resolvedModel });
      }
      sseBroadcast({ type: 'agent_update', agents: this.deps.buildAgentStatuses() }); saveCurrentState().catch(() => {}); json(res, 201, { ok: true });
      return true;
    }

    if (pathname.match(/^\/api\/agents\/[^/]+$/) && method === 'DELETE') {
      const agentName = decodeURIComponent(pathname.slice('/api/agents/'.length));
      try {
        await this.retireAgent(resolveAgentName(agentName));
        json(res, 200, { ok: true });
      } catch (err) { json(res, 404, { error: (err as Error).message }); }
      return true;
    }

    if (pathname === '/api/mcp/tools' && method === 'GET') {
      json(res, 200, orch.getMCPToolSchemas());
      return true;
    }

    if (pathname === '/api/mcp/test-call' && method === 'POST') {
      const body = await readBody(req);
      const { serverName: _serverName, toolName, args, agentName } =
        JSON.parse(body) as { serverName?: string; toolName: string; args?: Record<string, unknown>; agentName?: string };
      if (!toolName?.trim()) { json(res, 400, { error: 'toolName is required' }); return true; }
      try {
        const result = await orch.callMcpToolRaw(toolName, args ?? {}, agentName || undefined);
        json(res, 200, { result });
      } catch (err) {
        json(res, 500, { error: (err as Error).message });
      }
      return true;
    }

    if (pathname === '/api/mcp/catalogue' && method === 'GET') {
      const catalogue = getCatalogue().map(entry => ({
        ...entry,
        enabled: orch.hasMCPServer(entry.id),
        envStatus: (entry.envVars ?? []).map(v => { const n = typeof v === 'string' ? v : v.name; return { name: n, present: !!process.env[n] }; }),
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
        await orch.addMCPServer({ name: id, config, toolArgMappings: entry.toolArgMappings });
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

    if (pathname === '/api/pricing' && method === 'GET') { json(res, 200, { pricing: getPricingTable(), freeProviders: [...FREE_PROVIDERS], contextWindows: (await import('../providers/pricing.js')).getContextWindowTable() }); return true; }

    if (pathname === '/api/pricing/refresh' && method === 'POST') {
      try {
        const { updatePricing } = await import('../tools/pricing-updater.js');
        const logs: string[] = [];
        // The ids each provider serves, so prices are saved under the keys
        // they are looked up by.
        const known = Object.fromEntries(await Promise.all(
          KNOWN_PROVIDERS.map(async p => [p.id, await getCachedModels(p).catch(() => [...p.models])] as const),
        ));
        const result = await updatePricing(msg => logs.push(msg), known);
        reloadPricingFromFile();
        json(res, 200, { ...result, log: logs });
      } catch (err) {
        json(res, 500, { error: (err as Error).message });
      }
      return true;
    }

    /**
     * What an agent remembers.
     *
     * Read from the running memory server rather than its file: the graph
     * lives in the server between writes, so the file lags behind.
     */
    if (pathname.match(/^\/api\/agents\/[^/]+\/memory$/) && method === 'GET') {
      const name = resolveAgentName(decodeURIComponent(pathname.split('/')[3] ?? ''));
      // resolveAgentName echoes an unknown name back, so check it is deployed:
      // otherwise a typo reads as "this agent remembers nothing".
      if (!orch.listAgents().some((a) => a.name === name)) {
        json(res, 404, { error: `No agent named "${name}"` }); return true;
      }
      json(res, 200, { agent: name, memory: await orch.readAgentMemory(name) });
      return true;
    }

    if (pathname === '/api/human-requests' && method === 'GET') { json(res, 200, { requests: this.deps.buildRequestsList() }); return true; }

    if (pathname.match(/^\/api\/human-requests\/[^/]+$/) && method === 'DELETE') {
      const reqId = decodeURIComponent(pathname.slice('/api/human-requests/'.length));
      const ok = await humanRequestStore.remove(reqId);
      if (!ok) { json(res, 404, { error: 'Request not found' }); return true; }
      sseBroadcast({ type: 'requests_update', requests: this.deps.buildRequestsList() });
      json(res, 200, { ok: true });
      return true;
    }

    // `/answered` kept as the path so an older dashboard build still works.
    if (pathname === '/api/human-requests/answered' && method === 'DELETE') {
      await humanRequestStore.clearResolved();
      sseBroadcast({ type: 'requests_update', requests: this.deps.buildRequestsList() });
      json(res, 200, { ok: true });
      return true;
    }

    /**
     * Close a request without answering it.
     *
     * The agent is told, because escalating puts it in `waiting_for_help` and
     * it stays there until it hears something. Deleting the row on its own
     * cleared the panel and left the agent stuck for good.
     */
    if (pathname.match(/^\/api\/human-requests\/[^/]+\/dismiss$/) && method === 'POST') {
      const reqId   = decodeURIComponent(pathname.slice('/api/human-requests/'.length, -'/dismiss'.length));
      const request = humanRequestStore.get(reqId);
      if (!request) { json(res, 404, { error: 'Request not found' }); return true; }
      if (request.status !== 'pending') { json(res, 409, { error: 'Already resolved' }); return true; }

      const body = await readBody(req);
      const { note } = (body ? JSON.parse(body) : {}) as { note?: string };
      await humanRequestStore.dismiss(reqId, note);

      const reason = note?.trim()
        ? `The human will not be answering. They said: ${note.trim()}`
        : 'The human will not be answering this one.';
      const replyContent = `You asked: "${request.message}"\n\n${reason}\n\n`
        + 'Carry on without an answer: use your own judgement, state the assumption you '
        + 'are making, and do not escalate the same question again. If you genuinely '
        + 'cannot proceed, say so and stop rather than waiting.';
      await orch.humanReply(request.agentName, replyContent);

      const ticketId = request.relatedTicketId ?? agentTicketMap.get(orch.agentIdForName(request.agentName) ?? request.agentName);
      if (ticketId) this.deps.updateKanbanColumn(ticketId, 'in_progress').catch(() => {});
      sseBroadcast({ type: 'requests_update', requests: this.deps.buildRequestsList() });
      sseBroadcast({ type: 'agent_update',   agents:   this.deps.buildAgentStatuses() });
      json(res, 200, { ok: true });
      return true;
    }

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
      const ticketId = request.relatedTicketId ?? agentTicketMap.get(orch.agentIdForName(request.agentName) ?? request.agentName);
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
      const savedCreds = orch.getPersonalMcpCredentials(resolved);
      const disabled   = orch.getDisabledPersonalMcpServers(resolved);
      const personalEntries: MCPCatalogueEntry[] = getCatalogue().filter(isAgentMcp);
      const result = personalEntries.map(e => ({
        id:          e.id,
        name:        e.name,
        description: e.description,
        url:         e.url,
        envVars:     e.envVars ?? [],
        notes:       e.notes,
        configured:  !!savedCreds[e.id],
        active:      !!savedCreds[e.id] && !disabled.has(e.id),
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
        hatType: hatTypes as import('../../../packages/core/src/hats/types.js').HatType[],
        model: resolvedModel, providerName: resolvedProvider,
        scheduledActionIds: [],
      });
      json(res, 201, def);
      return true;
    }

    // Add a copy of a library agent to the current project's running team
    if (pathname === '/api/project/add-agent' && method === 'POST') {
      const agentStore = this.deps.getAgentStore();
      if (!agentStore) { json(res, 503, { error: 'Agent store not ready' }); return true; }
      const body    = await readBody(req);
      const { agentId } = JSON.parse(body) as { agentId: string };
      const def = agentStore.get(agentId);
      if (!def) { json(res, 404, { error: 'Agent not found in library' }); return true; }
      const running = orch.listAgents();
      if (hasCopyOf(running, agentId) || running.some(a => a.name.toLowerCase() === def.identity.name.toLowerCase())) {
        json(res, 409, { error: 'Agent is already in this project' }); return true;
      }
      const isExternal = def.providerName === 'external' || !!def.externalEndpoint;
      const provider = isExternal ? EXTERNAL_PROVIDER : (makeProvider(def.providerName) ?? new AnthropicProvider());
      const agent = orch.registerAgent(projectCopy(def, provider));
      // The template's scheduled actions are where the copy's agenda starts.
      await assignScheduledActions(orch.getAgendaStore(), this.deps.getActionStore(), agent.name, def.scheduledActionIds ?? []);
      sseBroadcast({ type: 'agent_update', agents: this.deps.buildAgentStatuses() });
      saveCurrentState().catch(() => {});
      json(res, 200, { ok: true });
      return true;
    }

    if (pathname.match(/^\/api\/global-agents\/[^/]+\/scheduled-actions$/) && method === 'PUT') {
      const agentId    = decodeURIComponent(pathname.slice('/api/global-agents/'.length, -'/scheduled-actions'.length));
      const agentStore = this.deps.getAgentStore();
      if (!agentStore) { json(res, 503, { error: 'Agent store not ready' }); return true; }
      const def = agentStore.get(agentId);
      if (!def) { json(res, 404, { error: 'Agent not found' }); return true; }
      const body = await readBody(req);
      const { scheduledActionIds } = JSON.parse(body) as { scheduledActionIds: string[] };
      // The template only: agents already copied into projects keep their own.
      await agentStore.addOrUpdate({ ...def, scheduledActionIds: scheduledActionIds ?? [] });
      json(res, 200, { ok: true });
      return true;
    }

    // Set which scheduled actions one agent in this project runs
    if (pathname.match(/^\/api\/agents\/[^/]+\/scheduled-actions$/) && method === 'PUT') {
      const name  = decodeURIComponent(pathname.slice('/api/agents/'.length, -'/scheduled-actions'.length));
      const agent = orch.getAgent(resolveAgentName(name));
      if (!agent) { json(res, 404, { error: 'Agent not found' }); return true; }
      const { scheduledActionIds } = JSON.parse(await readBody(req)) as { scheduledActionIds?: string[] };
      await assignScheduledActions(orch.getAgendaStore(), this.deps.getActionStore(), agent.name, scheduledActionIds ?? []);
      saveCurrentState().catch(() => {});
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
        backstory?: string; specialisation?: string;
        provider?: string; model?: string;
        avatar?: string | null; voice?: string | null; speakerName?: string | null; background?: string | null;
        maxContextTokens?: number | null; maxCostPerHour?: number | null;
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
          ...(patch.avatar            !== undefined && { avatar: patch.avatar ?? undefined }),
          ...(patch.voice             !== undefined && { voice: patch.voice ?? undefined }),
          ...(patch.speakerName       !== undefined && { speakerName: patch.speakerName ?? undefined }),
          ...(patch.background        !== undefined && { background: patch.background ?? undefined }),
        },
        ...(patch.hatTypes          !== undefined && { hatType: patch.hatTypes as import('../../../packages/core/src/hats/types.js').HatType[] }),
        ...(patch.provider          !== undefined && { providerName: patch.provider }),
        ...(patch.model             !== undefined && { model: patch.model.trim() }),
        ...(patch.maxContextTokens  !== undefined && { maxContextTokens: patch.maxContextTokens ?? undefined }),
        ...(patch.maxCostPerHour    !== undefined && { maxCostPerHour: patch.maxCostPerHour ?? undefined }),
      };
      // The template only: agents already copied into projects keep their own settings.
      await store.addOrUpdate(updated);
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

    // Fire every copy of an action in this project now, to try it
    if (pathname.match(/^\/api\/scheduled-actions\/[^/]+\/run$/) && method === 'POST') {
      const actionId = decodeURIComponent(pathname.slice('/api/scheduled-actions/'.length, -'/run'.length));
      const action   = this.deps.getActionStore()?.get(actionId);
      if (!action) { json(res, 404, { error: 'Scheduled action not found' }); return true; }
      const copies = (orch.getAgendaStore()?.list() ?? []).filter(e => isCopyOf(e, action));
      if (!copies.length) { json(res, 404, { error: 'No agent in this project has this action — assign it first' }); return true; }
      const runs = [];
      for (const copy of copies) runs.push({ agentName: copy.agentName, ...await orch.runAgendaEntry(copy.id) });
      json(res, 200, runs);
      return true;
    }

    if (pathname === '/api/scheduled-actions' && method === 'GET') {
      // ?agent=Name narrows "last run" to that agent's own copy of each action.
      const store   = this.deps.getActionStore();
      const entries = orch.getAgendaStore()?.list(url.searchParams.get('agent') ?? undefined) ?? [];
      json(res, 200, (store?.list() ?? []).map(a => ({ ...a, ...lastRunOf(entries, a) })));
      return true;
    }

    if (pathname === '/api/scheduled-actions' && method === 'POST') {
      const store = this.deps.getActionStore();
      if (!store) { json(res, 503, { error: 'Action store not ready' }); return true; }
      const body = await readBody(req);
      const parsed = JSON.parse(body) as {
        label: string;
        description?: string;
        intervalMinutes?: number;
        cron?: string;
        type?: import('../store/team-snapshot.js').ScheduledActionType;
        mcpToolCall?: import('../store/team-snapshot.js').McpToolCallSpec;
        promptMode?: string | null;
      };
      if (!parsed.label?.trim()) { json(res, 400, { error: 'label is required' }); return true; }
      if (parsed.type === 'mcp_tool_call') {
        if (!parsed.mcpToolCall?.toolName) { json(res, 400, { error: 'mcpToolCall.toolName is required' }); return true; }
        if (!parsed.mcpToolCall?.messageTemplate) { json(res, 400, { error: 'mcpToolCall.messageTemplate is required' }); return true; }
      } else if (!parsed.description?.trim()) {
        json(res, 400, { error: 'description is required for prompt type' }); return true;
      }
      let repeat: Repeat;
      try { repeat = repeatFromRequest(parsed); } catch (err) { json(res, 400, { error: (err as Error).message }); return true; }
      const description = parsed.description?.trim() ?? `MCP: ${parsed.mcpToolCall?.toolName ?? ''}`;
      const def = await store.add({
        label: parsed.label.trim(),
        description,
        ...repeat,
        type: parsed.type,
        mcpToolCall: parsed.mcpToolCall,
        promptMode: promptModeFrom(parsed.promptMode),
      });
      json(res, 201, def);
      return true;
    }

    if (pathname.match(/^\/api\/scheduled-actions\/[^/]+$/) && method === 'PATCH') {
      const actionId = decodeURIComponent(pathname.slice('/api/scheduled-actions/'.length));
      const store    = this.deps.getActionStore();
      if (!store) { json(res, 503, { error: 'Action store not ready' }); return true; }
      const body = await readBody(req);
      const parsed = JSON.parse(body) as {
        label?: string;
        description?: string;
        intervalMinutes?: number | null;
        cron?: string | null;
        mcpToolCall?: import('../store/team-snapshot.js').McpToolCallSpec;
        promptMode?: string | null;
      };
      const patch: Record<string, unknown> = {};
      if (parsed.promptMode  !== undefined) patch['promptMode']  = promptModeFrom(parsed.promptMode);
      if (parsed.label       !== undefined) patch['label']       = parsed.label.trim();
      if (parsed.description !== undefined) patch['description'] = parsed.description.trim();
      if (parsed.mcpToolCall !== undefined) patch['mcpToolCall'] = parsed.mcpToolCall;
      // Either one changes how it repeats; sent together, the cron wins.
      if (parsed.intervalMinutes !== undefined || parsed.cron !== undefined) {
        try {
          const repeat = repeatFromRequest(parsed);
          patch['intervalSeconds'] = repeat.intervalSeconds;
          patch['cron'] = repeat.cron;
        } catch (err) { json(res, 400, { error: (err as Error).message }); return true; }
      }
      const before  = store.get(actionId);
      const updated = await store.update(actionId, patch as never);
      const agenda  = orch.getAgendaStore();
      if (before && updated && agenda) await propagateEdit(agenda, before, updated);
      json(res, updated ? 200 : 404, updated ?? { error: 'Action not found' });
      return true;
    }

    if (pathname.match(/^\/api\/scheduled-actions\/[^/]+$/) && method === 'DELETE') {
      const actionId = decodeURIComponent(pathname.slice('/api/scheduled-actions/'.length));
      const store    = this.deps.getActionStore();
      if (!store) { json(res, 503, { error: 'Action store not ready' }); return true; }
      const action = store.get(actionId);
      const ok = await store.remove(actionId);
      const agenda = orch.getAgendaStore();
      if (ok && action && agenda) await removeCopies(agenda, action);
      json(res, ok ? 200 : 404, ok ? { ok: true } : { error: 'Action not found' });
      return true;
    }

    return false;
  }
}
