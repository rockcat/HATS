import { writeFile, mkdir } from 'fs/promises';
import * as path from 'path';
import { Meeting, MeetingTurn } from './types.js';
import { Agent } from '../agent/agent.js';
import { EventStore } from '../store/event-store.js';
import { renderMarkdown } from '../human/markdown.js';
import { log } from '../util/logger.js';
import { RAISE_HAND } from '../tools/definitions.js';

export type HumanResponder = (transcript: MeetingTurn[], topic: string) => Promise<string | null>;

/**
 * Runs a meeting using a 4-phase structure:
 *   1. Facilitator opening (problem + position, no pleasantries)
 *   2. Opening remarks from each participant (can raise hand to re-enter)
 *   3. Facilitated hand-based discussion (facilitator nominates speakers by name)
 *   4. Closing (facilitator summarises, final comment round, report_task_complete)
 */
export class MeetingRoom {
  private closed = false;
  private humanInterjects: string[] = [];
  private raisedHands: Set<string> = new Set();

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

  /** Raise or lower a participant's hand. Called by orchestrator when agent uses raise_hand tool, or via API for human. */
  raiseHand(name: string, raised = true): void {
    if (raised) {
      this.raisedHands.add(name);
    } else {
      this.raisedHands.delete(name);
    }
  }

  async run(): Promise<void> {
    try {
      await this.runPhases();
    } finally {
      await this.wrapUp();
    }
  }

  private async runPhases(): Promise<void> {
    const { meeting } = this;
    const facilitator = this.agents.get(meeting.facilitator);
    if (!facilitator) return;

    // ── Phase 1: Facilitator opens ─────────────────────────────────────────
    const openingResponse = await facilitator.meetingTurn(buildOpeningPrompt(meeting));
    await this.recordTurn(meeting.facilitator, openingResponse);

    // ── Phase 2: Opening remarks from each participant ─────────────────────
    for (const participant of meeting.participants) {
      if (this.closed) break;
      if (participant === 'human') {
        const reply = await this.humanResponder(meeting.turns, meeting.topic);
        if (reply) await this.recordTurn('human', reply);
      } else {
        const agent = this.agents.get(participant);
        if (!agent) continue;
        const prompt =
          `${buildTranscriptText(meeting.turns)}\n\n` +
          `Give your opening remark: your position or the key point you're bringing. ` +
          `One or two sentences. If you want to speak again later, call raise_hand.`;
        const response = await agent.meetingTurn(prompt, [RAISE_HAND]);
        await this.recordTurn(participant, response);
      }
    }

    // ── Phase 3: Hand-based discussion ────────────────────────────────────
    while (!this.closed) {
      const raised = [...this.raisedHands];
      if (raised.length === 0) break;

      // Facilitator nominates the next speaker
      const facilitatorPrompt =
        `${buildTranscriptText(meeting.turns)}\n\n` +
        `Hands raised: ${raised.join(', ')}.\n` +
        `Call one by saying only their name. Or say DONE to move to closing.`;
      const nomination = await facilitator.meetingTurn(facilitatorPrompt);
      await this.recordTurn(meeting.facilitator, nomination);

      if (this.closed) break;

      // Parse who was nominated
      const nominated = findNominatedSpeaker(nomination, raised);
      if (!nominated) break;

      this.raisedHands.delete(nominated);

      // Nominated participant speaks
      if (nominated === 'human') {
        const reply = await this.humanResponder(meeting.turns, meeting.topic);
        if (reply) await this.recordTurn('human', reply);
      } else {
        const agent = this.agents.get(nominated);
        if (agent) {
          const prompt =
            `${buildTranscriptText(meeting.turns)}\n\n` +
            `You've been called to speak. State your point clearly in one or two sentences. ` +
            `Call raise_hand if you want to speak again later.`;
          const response = await agent.meetingTurn(prompt, [RAISE_HAND]);
          await this.recordTurn(nominated, response);
        }
      }
    }

    // ── Phase 4: Closing ──────────────────────────────────────────────────
    // Facilitator summary (may call report_task_complete here, setting this.closed)
    if (!this.closed) {
      const summaryPrompt =
        `${buildTranscriptText(meeting.turns)}\n\n` +
        `Summarise the decisions and action items with owners in two or three sentences. ` +
        `Then offer participants one final chance to comment.`;
      const summaryResponse = await facilitator.meetingTurn(summaryPrompt);
      await this.recordTurn(meeting.facilitator, summaryResponse);
    }

    // Human always gets a final say — even if facilitator already called report_task_complete
    if (meeting.participants.includes('human')) {
      const reply = await this.humanResponder(meeting.turns, meeting.topic);
      if (reply) await this.recordTurn('human', reply);
    }

    // Agent final comments (skip if facilitator already closed)
    if (!this.closed) {
      for (const participant of meeting.participants) {
        if (this.closed || participant === 'human') continue;
        const agent = this.agents.get(participant);
        if (agent) {
          const prompt =
            `${buildTranscriptText(meeting.turns)}\n\n` +
            `Final comment only — one sentence, or respond with "Nothing to add." to pass.`;
          const response = await agent.meetingTurn(prompt);
          await this.recordTurn(participant, response);
        }
      }
    }

    // Facilitator explicit close (only if not already closed by report_task_complete)
    if (!this.closed) {
      const closePrompt =
        `${buildTranscriptText(meeting.turns)}\n\n` +
        `Close this meeting now by calling report_task_complete with a concise summary of all decisions and action items.`;
      const closeResponse = await facilitator.meetingTurn(closePrompt);
      await this.recordTurn(meeting.facilitator, closeResponse);
    }

  }

  private async wrapUp(): Promise<void> {
    const { meeting } = this;
    if (meeting.status === 'closed') return; // guard against double-call

    meeting.status = 'closed';
    meeting.closedAt = new Date().toISOString();

    await this.store.append('meeting_closed', {
      meetingId: meeting.id,
      topic: meeting.topic,
      turns: meeting.turns.length,
    }).catch(() => {});

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

/** Find the first participant name mentioned in the facilitator's nomination response. Returns null if DONE or no match. */
function findNominatedSpeaker(response: string, candidates: string[]): string | null {
  if (/\bdone\b/i.test(response) || /\bclose\b/i.test(response) || /\bno more\b/i.test(response)) return null;
  for (const name of candidates) {
    if (new RegExp(`\\b${name}\\b`, 'i').test(response)) return name;
  }
  return null;
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
