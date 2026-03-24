import * as readline from 'readline';
import { TeamOrchestrator, ProviderFactory } from '../orchestrator/orchestrator.js';
import { HatType } from '../hats/types.js';
import { DEFAULT_MODEL, DEFAULT_PROVIDER } from '../providers/default-provider.js';

const HAT_NAMES: Record<string, HatType> = {
  white:  HatType.White,
  red:    HatType.Red,
  black:  HatType.Black,
  yellow: HatType.Yellow,
  green:  HatType.Green,
  blue:   HatType.Blue,
};

/**
 * Simple CLI for the human team lead.
 *
 * Commands:
 *   @AgentName message          — send a direct message to an agent
 *   task AgentName: text        — assign a task to an agent
 *   reply AgentName: text       — reply to an agent's escalation
 *   agent Name hat: description — add a new agent to the team
 *   status                      — show all agents and their states
 *   tasks                       — list all tasks
 *   meetings                    — list all meetings
 *   save [path]                 — save team state
 *   load [path]                 — load team state (replaces current team)
 *   help                        — show this help
 *   exit                        — shut down
 *
 * Default (no prefix): sends to defaultAgent
 */
export class CLIInterface {
  private rl: readline.Interface;
  private orchestrator: TeamOrchestrator;
  private defaultAgent: string;
  private statePath: string | null;
  private providerFactory: ProviderFactory | null;
  private running = false;
  private meetingInputResolvers: Map<string, (input: string | null) => void> = new Map();

  constructor(
    orchestrator: TeamOrchestrator,
    defaultAgent = 'Blue',
    statePath: string | null = null,
    providerFactory: ProviderFactory | null = null,
  ) {
    this.orchestrator    = orchestrator;
    this.defaultAgent    = defaultAgent;
    this.statePath       = statePath;
    this.providerFactory = providerFactory;

    this.rl = readline.createInterface({
      input: process.stdin,
      output: process.stdout,
      prompt: '\n> ',
      completer: (line: string) => this.completer(line),
    });

    // Surface escalations to console
    orchestrator.onEscalation((from, message, urgency) => {
      const icon = urgency === 'high' ? '🔴' : '🟡';
      console.log(`\n${icon} ESCALATION from ${from}: ${message}`);
      console.log(`   Reply with: reply ${from}: your response`);
      this.rl.prompt();
    });
  }

  start(): void {
    if (this.running) return;
    this.running = true;

    console.log('\n━━━ Team CLI ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
    console.log('Type "help" for commands. Default target: ' + this.defaultAgent);
    console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n');

    this.rl.prompt();

    this.rl.on('line', (line) => {
      this.handleLine(line.trim()).catch((err) => {
        console.error('Error:', err);
      }).finally(() => {
        this.rl.prompt();
      });
    });

    this.rl.on('close', () => {
      this.running = false;
      console.log('\nGoodbye.');
      process.exit(0);
    });
  }

  private async handleLine(line: string): Promise<void> {
    if (!line) return;

    // @AgentName message
    if (line.startsWith('@')) {
      const spaceIdx = line.indexOf(' ');
      if (spaceIdx === -1) { console.log('Usage: @AgentName message'); return; }
      const name = this.resolveAgentName(line.slice(1, spaceIdx));
      const message = line.slice(spaceIdx + 1);
      await this.orchestrator.humanMessage(name, message);
      return;
    }

    // task AgentName [project-name]: description
    if (line.startsWith('task ')) {
      const rest = line.slice(5);
      const colonIdx = rest.indexOf(':');
      if (colonIdx === -1) { console.log('Usage: task AgentName [project-name]: description'); return; }
      const beforeColon = rest.slice(0, colonIdx).trim();
      const task = rest.slice(colonIdx + 1).trim();
      // Optional project name in square brackets: "AgentName [project-name]"
      const bracketMatch = beforeColon.match(/^(\S+)\s+\[([^\]]+)\]$/);
      const name = this.resolveAgentName(bracketMatch ? bracketMatch[1] : beforeColon);
      const projectName = bracketMatch ? bracketMatch[2] : undefined;
      await this.orchestrator.humanAssignTask(name, task, undefined, projectName);
      const storedTask = this.orchestrator.listTasks().find(t => t.assignedTo === name && t.description === task);
      const folder = storedTask?.projectFolder ?? '?';
      console.log(`Task assigned to ${name}. Project folder: ${folder}`);
      return;
    }

    // reply AgentName: message
    if (line.startsWith('reply ')) {
      const rest = line.slice(6);
      const colonIdx = rest.indexOf(':');
      if (colonIdx === -1) { console.log('Usage: reply AgentName: message'); return; }
      const name = this.resolveAgentName(rest.slice(0, colonIdx).trim());
      const message = rest.slice(colonIdx + 1).trim();
      await this.orchestrator.humanReply(name, message);
      return;
    }

    // agent Name hat: description
    // e.g.  agent Marcus blue: Senior risk analyst specialising in fintech
    if (line.startsWith('agent ')) {
      await this.addAgent(line.slice(6).trim());
      return;
    }

    if (line === 'status') { this.showStatus(); return; }
    if (line === 'tasks')  { this.showTasks();  return; }
    if (line === 'meetings') { this.showMeetings(); return; }
    if (line === 'resume') { await this.resumeActiveTasks(); return; }
    if (line === 'help')   { this.showHelp();   return; }

    if (line === 'save' || line.startsWith('save ')) {
      const path = line.length > 5 ? line.slice(5).trim() : (this.statePath ?? './team-state.json');
      await this.orchestrator.saveState(path);
      return;
    }

    if (line === 'load' || line.startsWith('load ')) {
      const path = line.length > 5 ? line.slice(5).trim() : (this.statePath ?? './team-state.json');
      await this.loadTeam(path);
      return;
    }

    if (line === 'exit' || line === 'quit') {
      this.rl.close();
      return;
    }

    // Default: send to default agent
    await this.orchestrator.humanMessage(this.defaultAgent, line);
  }

  // ── tab completer ─────────────────────────────────────────────────────────

  private completer(line: string): [string[], string] {
    const agentNames = this.orchestrator.listAgents().map(a => a.name);

    if (line.startsWith('@')) {
      const prefix = line.slice(1).toLowerCase();
      const hits = agentNames
        .filter(n => n.toLowerCase().startsWith(prefix))
        .map(n => `@${n}`);
      return [hits.length ? hits : agentNames.map(n => `@${n}`), line];
    }

    return [[], line];
  }

  /** Resolve an agent name case-insensitively; returns the canonical name or the original if not found. */
  private resolveAgentName(input: string): string {
    const lower = input.toLowerCase();
    const match = this.orchestrator.listAgents().find(a => a.name.toLowerCase() === lower);
    return match ? match.name : input;
  }

  // ── agent command ─────────────────────────────────────────────────────────

  private async addAgent(rest: string): Promise<void> {
    // rest = "Name hat: description"
    const colonIdx = rest.indexOf(':');
    if (colonIdx === -1) {
      console.log('Usage: agent Name hat: description of skills');
      console.log('Hats:  white  red  black  yellow  green  blue');
      return;
    }

    const beforeColon = rest.slice(0, colonIdx).trim().split(/\s+/);
    const description = rest.slice(colonIdx + 1).trim();

    if (beforeColon.length < 2) {
      console.log('Usage: agent Name hat: description of skills');
      return;
    }

    const name    = beforeColon[0];
    const hatKey  = beforeColon[1].toLowerCase();
    const hatType = HAT_NAMES[hatKey];

    if (!hatType) {
      console.log(`Unknown hat "${hatKey}". Choose from: ${Object.keys(HAT_NAMES).join(', ')}`);
      return;
    }

    if (!description) {
      console.log('Please provide a description of the agent\'s skills.');
      return;
    }

    if (!this.providerFactory) {
      console.log('No provider factory configured — cannot create agents at runtime.');
      return;
    }

    // Default to same model as an existing agent, fall back to gpt-5-mini
    const existingAgent = this.orchestrator.listAgents()[0];
    const providerName = existingAgent?.config.provider.name ?? DEFAULT_PROVIDER;
    const model = existingAgent?.config.model ?? DEFAULT_MODEL;
    const provider = this.providerFactory(providerName);

    this.orchestrator.registerAgent({
      identity: {
        name,
        visualDescription: description,
        specialisation: description,
      },
      hatType,
      provider,
      model,
    });

    console.log(`Agent ${name} (${hatKey} hat) added to the team.`);
  }

  // ── load command ──────────────────────────────────────────────────────────

  private async loadTeam(path: string): Promise<void> {
    if (!this.providerFactory) {
      console.log('No provider factory configured — cannot load state.');
      return;
    }

    console.log(`Loading team state from ${path}…`);
    this.orchestrator.clearTeam();

    try {
      const mcpDefs = await this.orchestrator.loadState(path, this.providerFactory);
      for (const def of mcpDefs) {
        await this.orchestrator.addMCPServer(def);
      }
      this.showStatus();
      await this.resumeActiveTasks();
    } catch (err) {
      console.log(`Load failed: ${(err as Error).message}`);
    }
  }

  // ── resume ────────────────────────────────────────────────────────────────

  private async resumeActiveTasks(): Promise<void> {
    const active = this.orchestrator.listTasks().filter(t => t.status === 'active');
    if (active.length === 0) {
      console.log('No active tasks to resume.');
      return;
    }

    console.log(`\nResuming ${active.length} active task(s)…`);
    for (const task of active) {
      const name = this.resolveAgentName(task.assignedTo);
      const msg = `You have an active task to continue: ${task.description}${task.context ? `\n\nContext: ${task.context}` : ''}`;
      console.log(`  → ${name}: ${task.description.slice(0, 60)}`);
      await this.orchestrator.humanMessage(name, msg);
    }
  }

  // ── display helpers ───────────────────────────────────────────────────────

  private showStatus(): void {
    const agents = this.orchestrator.listAgents();
    if (agents.length === 0) { console.log('No agents.'); return; }
    console.log('\n── Team Status ──────────────────────────────');
    for (const agent of agents) {
      const info = agent.toJSON() as Record<string, unknown>;
      const spec = agent.config.identity.specialisation;
      const detail = spec ? `  ${spec}` : '';
      console.log(`  ${info['name']} (${String(info['hatType']).padEnd(6)} hat) — ${info['state']}${detail}`);
    }
    console.log('─────────────────────────────────────────────');
  }

  private showTasks(): void {
    const tasks = this.orchestrator.listTasks();
    if (tasks.length === 0) { console.log('No tasks.'); return; }
    console.log('\n── Tasks ────────────────────────────────────');
    for (const t of tasks) {
      const done = t.status === 'complete' ? ` ✓ ${t.summary?.slice(0, 40)}` : '';
      console.log(`  [${t.status.padEnd(8)}] ${t.assignedTo}: ${t.description.slice(0, 50)}${done}`);
    }
    console.log('─────────────────────────────────────────────');
  }

  private showMeetings(): void {
    const meetings = this.orchestrator.listMeetings();
    if (meetings.length === 0) { console.log('No meetings.'); return; }
    console.log('\n── Meetings ─────────────────────────────────');
    for (const m of meetings) {
      console.log(`  [${m.status}] "${m.topic}" — ${m.turns.length} turns`);
    }
    console.log('─────────────────────────────────────────────');
  }

  private showHelp(): void {
    const sp = this.statePath ?? './team-state.json';
    console.log(`
Commands:
  @AgentName message             — DM a specific agent
  task AgentName: text           — assign a task (auto-creates project folder)
  task AgentName [name]: text    — assign a task with an explicit project name
  reply AgentName: text          — reply to escalation
  agent Name hat: description    — add a new agent (hat: white/red/black/yellow/green/blue)
  status                         — show agent states
  tasks                          — list tasks
  meetings                       — list meetings
  resume                         — re-deliver active tasks to idle agents
  save                           — save state to ${sp}
  save <path>                    — save state to a custom path
  load                           — load state from ${sp} (replaces current team)
  load <path>                    — load state from a custom path
  help                           — this help
  exit                           — quit

Default (no prefix): sends to ${this.defaultAgent}
    `.trim());
  }
}
