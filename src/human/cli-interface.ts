import * as readline from 'readline';
import { TeamOrchestrator } from '../orchestrator/orchestrator.js';

/**
 * Simple CLI for the human team lead.
 *
 * Commands:
 *   @AgentName message      — send a direct message to an agent
 *   task AgentName: text    — assign a task to an agent
 *   reply AgentName: text   — reply to an agent's escalation
 *   status                  — show all agents and their states
 *   tasks                   — list all tasks
 *   meetings                — list all meetings
 *   help                    — show this help
 *   exit                    — shut down
 *
 * Default (no prefix): sends to Blue Hat
 */
export class CLIInterface {
  private rl: readline.Interface;
  private orchestrator: TeamOrchestrator;
  private defaultAgent: string;
  private running = false;
  private meetingInputResolvers: Map<string, (input: string | null) => void> = new Map();

  constructor(orchestrator: TeamOrchestrator, defaultAgent = 'Blue') {
    this.orchestrator = orchestrator;
    this.defaultAgent = defaultAgent;

    this.rl = readline.createInterface({
      input: process.stdin,
      output: process.stdout,
      prompt: '\n> ',
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
      const name = line.slice(1, spaceIdx);
      const message = line.slice(spaceIdx + 1);
      await this.orchestrator.humanMessage(name, message);
      return;
    }

    // task AgentName: description
    if (line.startsWith('task ')) {
      const rest = line.slice(5);
      const colonIdx = rest.indexOf(':');
      if (colonIdx === -1) { console.log('Usage: task AgentName: description'); return; }
      const name = rest.slice(0, colonIdx).trim();
      const task = rest.slice(colonIdx + 1).trim();
      await this.orchestrator.humanAssignTask(name, task);
      console.log(`Task assigned to ${name}.`);
      return;
    }

    // reply AgentName: message
    if (line.startsWith('reply ')) {
      const rest = line.slice(6);
      const colonIdx = rest.indexOf(':');
      if (colonIdx === -1) { console.log('Usage: reply AgentName: message'); return; }
      const name = rest.slice(0, colonIdx).trim();
      const message = rest.slice(colonIdx + 1).trim();
      await this.orchestrator.humanReply(name, message);
      return;
    }

    if (line === 'status') {
      this.showStatus();
      return;
    }

    if (line === 'tasks') {
      this.showTasks();
      return;
    }

    if (line === 'meetings') {
      this.showMeetings();
      return;
    }

    if (line === 'help') {
      this.showHelp();
      return;
    }

    if (line === 'exit' || line === 'quit') {
      this.rl.close();
      return;
    }

    // Default: send to Blue Hat
    await this.orchestrator.humanMessage(this.defaultAgent, line);
  }

  private showStatus(): void {
    console.log('\n── Team Status ──────────────────────────────');
    for (const agent of this.orchestrator.listAgents()) {
      const info = agent.toJSON() as Record<string, unknown>;
      console.log(`  ${info['name']} (${info['provider']}) — ${info['state']}`);
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
    console.log(`
Commands:
  @AgentName message        — DM a specific agent
  task AgentName: text      — assign a task
  reply AgentName: text     — reply to escalation
  status                    — show agent states
  tasks                     — list tasks
  meetings                  — list meetings
  help                      — this help
  exit                      — quit

Default (no prefix): sends to ${this.defaultAgent}
    `.trim());
  }
}
