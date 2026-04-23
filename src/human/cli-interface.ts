import * as readline from 'readline';
import { log } from '../util/logger.js';
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

  // @ mention menu state
  private menuActive     = false;
  private menuAgents:    string[] = [];
  private menuIdx        = 0;
  private menuFilter     = '';
  private menuLineCount  = 0;
  private lineBeforeAt   = '';

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

    this.wireEscalation(orchestrator);
    this.setupAtMenu();
  }

  /** Update the orchestrator reference (e.g. after a project switch). */
  setOrchestrator(orchestrator: TeamOrchestrator): void {
    this.orchestrator = orchestrator;
    this.wireEscalation(orchestrator);
  }

  private wireEscalation(orchestrator: TeamOrchestrator): void {
    // Surface escalations to console
    orchestrator.onEscalation((from, message, urgency) => {
      const icon = urgency === 'high' ? '🔴' : '🟡';
      log.info(`\n${icon} ESCALATION from ${from}: ${message}`);
      log.info(`   Reply with: reply ${from}: your response`);
      this.rl.prompt();
    });
  }

  start(): void {
    if (this.running) return;
    this.running = true;

    log.info('\n━━━ Team Chat ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
    log.info('Type "help" for commands. Default target: ' + this.defaultAgent);
    log.info('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n');

    this.rl.prompt();

    this.rl.on('line', (line) => {
      this.handleLine(line.trim()).catch((err) => {
        log.error('Error:', err);
      }).finally(() => {
        this.rl.prompt();
      });
    });

    this.rl.on('close', () => {
      this.running = false;
      log.info('\nGoodbye.');
      process.exit(0);
    });
  }

  private async handleLine(line: string): Promise<void> {
    if (!line) return;

    // @AgentName message
    if (line.startsWith('@')) {
      const spaceIdx = line.indexOf(' ');
      if (spaceIdx === -1) { log.info('Usage: @AgentName message'); return; }
      const name = this.resolveAgentName(line.slice(1, spaceIdx));
      const message = line.slice(spaceIdx + 1);
      await this.orchestrator.humanMessage(name, message);
      return;
    }

    // task AgentName [project-name]: description
    if (line.startsWith('task ')) {
      const rest = line.slice(5);
      const colonIdx = rest.indexOf(':');
      if (colonIdx === -1) { log.info('Usage: task AgentName [project-name]: description'); return; }
      const beforeColon = rest.slice(0, colonIdx).trim();
      const task = rest.slice(colonIdx + 1).trim();
      // Optional project name in square brackets: "AgentName [project-name]"
      const bracketMatch = beforeColon.match(/^(\S+)\s+\[([^\]]+)\]$/);
      const name = this.resolveAgentName(bracketMatch ? bracketMatch[1] : beforeColon);
      const projectName = bracketMatch ? bracketMatch[2] : undefined;
      await this.orchestrator.humanAssignTask(name, task, undefined, projectName);
      const storedTask = this.orchestrator.listTasks().find(t => t.assignedTo === name && t.description === task);
      const folder = storedTask?.projectFolder ?? '?';
      log.info(`Task assigned to ${name}. Project folder: ${folder}`);
      return;
    }

    // reply AgentName: message
    if (line.startsWith('reply ')) {
      const rest = line.slice(6);
      const colonIdx = rest.indexOf(':');
      if (colonIdx === -1) { log.info('Usage: reply AgentName: message'); return; }
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

  // ── @ mention popup menu ─────────────────────────────────────────────────

  private setupAtMenu(): void {
    if (!process.stdin.isTTY) return;

    // Intercept readline's key handler so we can fully own keys while the menu
    // is open without readline also acting on them.
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const rl = this.rl as any;
    const orig: (s: string, key: unknown) => void = rl._ttyWrite.bind(rl);

    rl._ttyWrite = (s: string, key: unknown) => {
      if (this.menuActive) {
        this.menuHandleKey(s, key as Record<string, unknown>);
        return;
      }
      orig(s, key);
      // After readline has processed the char and updated its line buffer,
      // check if '@' was just typed and open the menu.
      if (s === '@') setImmediate(() => this.menuOpen());
    };
  }

  private menuOpen(): void {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const rl = this.rl as any;
    const line: string = rl.line ?? '';

    // Strip the '@' readline already added to its buffer
    const atIdx = line.lastIndexOf('@');
    this.lineBeforeAt = atIdx >= 0 ? line.slice(0, atIdx) : line;
    rl.line   = this.lineBeforeAt;
    rl.cursor = this.lineBeforeAt.length;
    rl._refreshLine();

    this.menuAgents    = this.orchestrator.listAgents().map(a => a.name);
    this.menuFilter    = '';
    this.menuIdx       = 0;
    this.menuActive    = true;
    this.menuLineCount = 0;
    this.menuRender();
  }

  private menuFiltered(): string[] {
    const f = this.menuFilter.toLowerCase();
    return this.menuAgents.filter(n => n.toLowerCase().startsWith(f));
  }

  private menuHandleKey(s: string, key: Record<string, unknown>): void {
    const filtered = this.menuFiltered();

    if (key?.name === 'return' || key?.name === 'enter' || s === '\t') {
      const selected = filtered[this.menuIdx];
      this.menuClose(selected ? `${this.lineBeforeAt}@${selected} ` : null);

    } else if (key?.name === 'escape' || (key?.ctrl && key?.name === 'c')) {
      this.menuClose(null);

    } else if (key?.name === 'up') {
      this.menuIdx = Math.max(0, this.menuIdx - 1);
      this.menuRender();

    } else if (key?.name === 'down') {
      this.menuIdx = Math.min(Math.max(0, filtered.length - 1), this.menuIdx + 1);
      this.menuRender();

    } else if (key?.name === 'backspace') {
      if (this.menuFilter.length > 0) {
        this.menuFilter = this.menuFilter.slice(0, -1);
        this.menuIdx    = 0;
        this.menuRender();
      } else {
        this.menuClose(null);
      }

    } else if (s && s >= ' ' && s < '\x7f') {
      this.menuFilter += s;
      this.menuIdx    = 0;
      this.menuRender();
    }
  }

  private menuRender(): void {
    const filtered = this.menuFiltered();

    // Erase previously drawn menu lines
    for (let i = 0; i < this.menuLineCount; i++) {
      process.stdout.write('\x1b[1A\x1b[2K');
    }

    const atLabel = this.menuFilter ? `@${this.menuFilter}` : '@';
    const hint    = `\x1b[2m  ${atLabel}  ↑↓ navigate · Enter select · Esc cancel\x1b[0m`;
    const lines   = [hint];

    if (filtered.length === 0) {
      lines.push('  \x1b[2m(no match)\x1b[0m');
    } else {
      for (let i = 0; i < filtered.length; i++) {
        const active = i === this.menuIdx;
        const arrow  = active ? '\x1b[32m▶\x1b[0m' : ' ';
        const name   = active
          ? `\x1b[1m${filtered[i]}\x1b[0m`
          : `\x1b[2m${filtered[i]}\x1b[0m`;
        lines.push(`  ${arrow} ${name}`);
      }
    }

    process.stdout.write('\n' + lines.join('\n') + '\n');
    this.menuLineCount = lines.length + 1; // +1 for the leading newline
  }

  private menuClose(result: string | null): void {
    // Clear the menu lines
    for (let i = 0; i < this.menuLineCount; i++) {
      process.stdout.write('\x1b[1A\x1b[2K');
    }
    this.menuLineCount = 0;
    this.menuActive    = false;

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const rl = this.rl as any;
    const line = result ?? this.lineBeforeAt;
    rl.line   = line;
    rl.cursor = line.length;
    rl._refreshLine();
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
      log.info('Usage: agent Name hat: description of skills');
      log.info('Hats:  white  red  black  yellow  green  blue');
      return;
    }

    const beforeColon = rest.slice(0, colonIdx).trim().split(/\s+/);
    const description = rest.slice(colonIdx + 1).trim();

    if (beforeColon.length < 2) {
      log.info('Usage: agent Name hat: description of skills');
      return;
    }

    const name    = beforeColon[0];
    const hatKey  = beforeColon[1].toLowerCase();
    const hatType = HAT_NAMES[hatKey];

    if (!hatType) {
      log.info(`Unknown hat "${hatKey}". Choose from: ${Object.keys(HAT_NAMES).join(', ')}`);
      return;
    }

    if (!description) {
      log.info('Please provide a description of the agent\'s skills.');
      return;
    }

    if (!this.providerFactory) {
      log.info('No provider factory configured — cannot create agents at runtime.');
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

    log.info(`Agent ${name} (${hatKey} hat) added to the team.`);
  }

  // ── load command ──────────────────────────────────────────────────────────

  private async loadTeam(path: string): Promise<void> {
    if (!this.providerFactory) {
      log.info('No provider factory configured — cannot load state.');
      return;
    }

    log.info(`Loading team state from ${path}…`);
    this.orchestrator.clearTeam();

    try {
      const mcpDefs = await this.orchestrator.loadState(path, this.providerFactory);
      for (const def of mcpDefs) {
        await this.orchestrator.addMCPServer(def);
      }
      this.showStatus();
      await this.resumeActiveTasks();
    } catch (err) {
      log.info(`Load failed: ${(err as Error).message}`);
    }
  }

  // ── resume ────────────────────────────────────────────────────────────────

  private async resumeActiveTasks(): Promise<void> {
    const active = this.orchestrator.listTasks().filter(t => t.status === 'active');
    if (active.length === 0) {
      log.info('No active tasks to resume.');
      return;
    }

    log.info(`\nResuming ${active.length} active task(s)…`);
    for (const task of active) {
      const name = this.resolveAgentName(task.assignedTo);
      const msg = `You have an active task to continue: ${task.description}${task.context ? `\n\nContext: ${task.context}` : ''}`;
      log.info(`  → ${name}: ${task.description.slice(0, 60)}`);
      await this.orchestrator.humanMessage(name, msg);
    }
  }

  // ── display helpers ───────────────────────────────────────────────────────

  private showStatus(): void {
    const agents = this.orchestrator.listAgents();
    if (agents.length === 0) { log.info('No agents.'); return; }
    log.info('\n── Team Status ──────────────────────────────');
    for (const agent of agents) {
      const info = agent.toJSON() as Record<string, unknown>;
      const spec = agent.config.identity.specialisation;
      const detail = spec ? `  ${spec}` : '';
      log.info(`  ${info['name']} (${String(info['hatType']).padEnd(6)} hat) — ${info['state']}${detail}`);
    }
    log.info('─────────────────────────────────────────────');
  }

  private showTasks(): void {
    const tasks = this.orchestrator.listTasks();
    if (tasks.length === 0) { log.info('No tasks.'); return; }
    log.info('\n── Tasks ────────────────────────────────────');
    for (const t of tasks) {
      const done = t.status === 'complete' ? ` ✓ ${t.summary?.slice(0, 40)}` : '';
      log.info(`  [${t.status.padEnd(8)}] ${t.assignedTo}: ${t.description.slice(0, 50)}${done}`);
    }
    log.info('─────────────────────────────────────────────');
  }

  private showMeetings(): void {
    const meetings = this.orchestrator.listMeetings();
    if (meetings.length === 0) { log.info('No meetings.'); return; }
    log.info('\n── Meetings ─────────────────────────────────');
    for (const m of meetings) {
      log.info(`  [${m.status}] "${m.topic}" — ${m.turns.length} turns`);
    }
    log.info('─────────────────────────────────────────────');
  }

  private showHelp(): void {
    const sp = this.statePath ?? './team-state.json';
    log.info(`
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
