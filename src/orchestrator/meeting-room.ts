import { writeFile, mkdir } from 'fs/promises';
import * as path from 'path';
import { Meeting, MeetingTurn } from './types.js';
import { Agent } from '../agent/agent.js';
import { EventStore } from '../store/event-store.js';
import { renderMarkdown } from '../human/markdown.js';
import { log } from '../util/logger.js';

const MAX_ROUNDS = 6;

export type HumanResponder = (transcript: MeetingTurn[], topic: string) => Promise<string | null>;

/**
 * Runs a meeting as a round-table.
 *
 * Each participant (agent or human) takes a turn in sequence.
 * The facilitator (Blue Hat) opens and closes.
 * Returns when the facilitator calls report_task_complete or MAX_ROUNDS is reached.
 */
export class MeetingRoom {
  private closed = false;
  private humanInterjects: string[] = [];

  constructor(
    private meeting: Meeting,
    private agents: Map<string, Agent>,
    private store: EventStore,
    private humanResponder: HumanResponder,
    private projectDir?: string | null,
  ) {}

  /** Called by orchestrator when human types something mid-meeting. */
  injectHumanMessage(text: string): void {
    this.humanInterjects.push(text);
  }

  /** Signal from facilitator's tool call that the meeting should close. */
  close(): void {
    this.closed = true;
  }

  async run(): Promise<void> {
    const { meeting } = this;

    // Facilitator opens with the agenda
    const facilitator = this.agents.get(meeting.facilitator);
    if (!facilitator) return;

    const openingPrompt = buildOpeningPrompt(meeting);
    const openingResponse = await facilitator.meetingTurn(openingPrompt);
    await this.recordTurn(meeting.facilitator, openingResponse);

    // Round-table loop
    for (let round = 0; round < MAX_ROUNDS && !this.closed; round++) {
      const transcript = buildTranscriptText(meeting.turns);

      for (const participant of meeting.participants) {
        if (this.closed) break;

        // Prepend any human interjects into this turn's prompt
        let prompt = transcript;
        if (this.humanInterjects.length > 0) {
          prompt += '\n\n[Human interjection]: ' + this.humanInterjects.splice(0).join('\n');
        }

        if (participant === 'human') {
          const reply = await this.humanResponder(meeting.turns, meeting.topic);
          if (reply) {
            await this.recordTurn('human', reply);
          }
        } else {
          const agent = this.agents.get(participant);
          if (!agent) continue;
          const response = await agent.meetingTurn(
            `${prompt}\n\nYour turn. State your concrete position, decision, or specific action — not what "we should explore" or how "we should approach" it. No process talk, no agreement echo, no preamble. one or two sentences max.`,
          );
          await this.recordTurn(participant, response);
        }
      }

      // Facilitator summarises after each round and decides whether to close
      if (!this.closed) {
        const summary = await facilitator.meetingTurn(
          `${buildTranscriptText(meeting.turns)}\n\n` +
          `As facilitator: state what has been decided and what is still unresolved. If there is enough to act on, close now with report_task_complete listing concrete action items and owners. If not, name the single specific question still blocking a decision. No summaries of who said what. one or two sentences.`,
        );
        await this.recordTurn(meeting.facilitator, summary);
      }
    }

    // Close meeting
    meeting.status = 'closed';
    meeting.closedAt = new Date().toISOString();

    await this.store.append('meeting_closed', {
      meetingId: meeting.id,
      topic: meeting.topic,
      turns: meeting.turns.length,
    });

    // Save minutes to outputs/minutes/
    if (this.projectDir) {
      await this.saveMinutes().catch(err =>
        log.error(`[Meeting] Failed to save minutes: ${(err as Error).message}`),
      );
    }

    // Return all agents to working state
    for (const participant of [meeting.facilitator, ...meeting.participants]) {
      if (participant !== 'human') {
        this.agents.get(participant)?.markDiscussionEnded();
      }
    }
  }

  private async saveMinutes(): Promise<void> {
    const { meeting } = this;
    const dir = path.join(this.projectDir!, 'outputs', 'minutes');
    await mkdir(dir, { recursive: true });
    const slug = meeting.topic.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/-+/g, '-').slice(0, 50);
    const date = new Date().toISOString().slice(0, 10);
    const filename = `${date}-${slug}.md`;
    const filepath = path.join(dir, filename);
    await writeFile(filepath, buildMinutesMarkdown(meeting), 'utf-8');
    meeting.minutesPath = filepath;
    log.info(`[Meeting] Minutes saved: ${filepath}`);
  }

  private async recordTurn(participant: string, content: string): Promise<void> {
    const turn: MeetingTurn = {
      participant,
      content,
      ts: new Date().toISOString(),
    };
    this.meeting.turns.push(turn);

    await this.store.append('meeting_turn', {
      meetingId: this.meeting.id,
      participant,
      content,
    });

    log.info(`\n\x1b[1m[${this.meeting.topic}] ${participant}\x1b[0m\n${renderMarkdown(content)}`);
  }
}

function buildOpeningPrompt(meeting: Meeting): string {
  const participants = meeting.participants.join(', ');
  return (
    `Facilitate this meeting. Topic: "${meeting.topic}". ` +
    (meeting.agenda ? `Agenda: ${meeting.agenda}. ` : '') +
    `Participants: ${participants}. ` +
    `State the problem in one sentence and your opening position or recommendation. No pleasantries, no agenda recap. Drive toward a decision immediately.`
  );
}

function buildTranscriptText(turns: MeetingTurn[]): string {
  if (turns.length === 0) return '(No turns yet)';
  return turns.map((t) => `${t.participant}: ${t.content}`).join('\n\n');
}

export function buildMinutesMarkdown(meeting: Meeting): string {
  const allParticipants = [meeting.facilitator, ...meeting.participants.filter(p => p !== meeting.facilitator)];
  const date = meeting.closedAt
    ? new Date(meeting.closedAt).toLocaleString(undefined, { dateStyle: 'long', timeStyle: 'short' })
    : new Date().toLocaleString(undefined, { dateStyle: 'long', timeStyle: 'short' });

  const lines: string[] = [
    `# Meeting Minutes: ${meeting.topic}`,
    '',
    `**Date:** ${date}`,
    `**Facilitator:** ${meeting.facilitator}`,
    `**Participants:** ${allParticipants.join(', ')}`,
    ...(meeting.agenda ? [`**Agenda:** ${meeting.agenda}`] : []),
    '',
    '---',
    '',
    '## Transcript',
    '',
  ];

  for (const turn of meeting.turns) {
    const time = new Date(turn.ts).toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit' });
    lines.push(`**${turn.participant}** _(${time})_`);
    lines.push('');
    lines.push(turn.content);
    lines.push('');
  }

  lines.push('---');
  lines.push('');
  lines.push(`_Minutes generated automatically · ${meeting.turns.length} turns_`);

  return lines.join('\n');
}
