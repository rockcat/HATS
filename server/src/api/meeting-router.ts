import { IncomingMessage, ServerResponse } from 'http';
import { TeamOrchestrator } from '../orchestrator/orchestrator.js';
import { MeetingType } from '../orchestrator/types.js';
import { log } from '../util/logger.js';

export interface MeetingRouterDeps {
  getOrchestrator(): TeamOrchestrator;
  pendingHumanTurns: Map<string, (input: string | null) => void>;
  pendingTurnAcks: Map<string, () => void>;
  sseBroadcast(data: object): void;
  json(res: ServerResponse, status: number, body: unknown): void;
  readBody(req: IncomingMessage): Promise<string>;
  resolveAgentName(input: string): string;
}

export class MeetingRouter {
  private deps: MeetingRouterDeps;

  constructor(deps: MeetingRouterDeps) {
    this.deps = deps;
  }

  async launchDueMeetings(): Promise<void> {
    const orch = this.deps.getOrchestrator();
    const due = orch.listScheduledMeetings().filter(m => {
      return m.status === 'scheduled' && new Date(m.scheduledFor) <= new Date();
    });
    for (const m of due) {
      try {
        log.info(`[API] Auto-launching scheduled meeting "${m.topic}" (${m.id})`);
        await orch.launchScheduledMeeting(m.id);
        this.deps.sseBroadcast({ type: 'scheduled_meetings_update', meetings: orch.listScheduledMeetings() });
      } catch (err) {
        log.warn(`[API] Failed to launch meeting ${m.id}:`, (err as Error).message);
      }
    }
  }

  async handleRoutes(pathname: string, method: string, req: IncomingMessage, res: ServerResponse): Promise<boolean> {
    const { json, readBody, resolveAgentName, sseBroadcast, pendingHumanTurns, pendingTurnAcks } = this.deps;
    const orch = this.deps.getOrchestrator();

    if (pathname === '/api/meetings/start' && method === 'POST') {
      const body   = await readBody(req);
      const fields = JSON.parse(body) as { topic?: string; agenda?: string; facilitator?: string; participants?: string[] };
      if (!fields.topic?.trim())       { json(res, 400, { error: 'topic is required' }); return true; }
      if (!fields.facilitator?.trim()) { json(res, 400, { error: 'facilitator is required' }); return true; }
      const facilitator  = resolveAgentName(fields.facilitator);
      const participants = (fields.participants ?? []).filter((p: string) => p !== facilitator);
      const topic        = fields.topic.trim();
      const agenda       = fields.agenda?.trim();
      const now          = new Date().toISOString();
      try {
        void orch.launchImpromptuMeeting(facilitator, participants, topic, agenda);
        orch.recordImpromptuInCalendar({ topic, agenda, facilitator, participants, startedAt: now })
          .then(() => {
            sseBroadcast({ type: 'scheduled_meetings_update', meetings: orch.listScheduledMeetings() });
          }).catch(() => {});
        json(res, 201, { ok: true });
      } catch (err) {
        json(res, 400, { error: (err as Error).message });
      }
      return true;
    }

    if (pathname === '/api/scheduled-meetings' && method === 'GET') {
      json(res, 200, orch.listScheduledMeetings());
      return true;
    }

    if (pathname === '/api/scheduled-meetings' && method === 'POST') {
      const body   = await readBody(req);
      const fields = JSON.parse(body) as {
        type: string; topic: string; agenda?: string;
        facilitator: string; participants: string[]; scheduledFor: string;
      };
      if (!fields.topic?.trim())       { json(res, 400, { error: 'topic is required' }); return true; }
      if (!fields.facilitator?.trim()) { json(res, 400, { error: 'facilitator is required' }); return true; }
      if (!fields.scheduledFor)        { json(res, 400, { error: 'scheduledFor is required' }); return true; }
      const validTypes = ['standup', 'sprint_planning', 'retro', 'review', 'ad_hoc'];
      if (!validTypes.includes(fields.type)) { json(res, 400, { error: `Invalid type "${fields.type}"` }); return true; }
      const when = new Date(fields.scheduledFor);
      if (isNaN(when.getTime())) { json(res, 400, { error: 'Invalid scheduledFor date' }); return true; }
      try {
        const meeting = await orch.createScheduledMeeting({
          type: fields.type as MeetingType,
          topic: fields.topic.trim(),
          agenda: fields.agenda?.trim(),
          facilitator: resolveAgentName(fields.facilitator),
          participants: fields.participants ?? [],
          scheduledFor: when.toISOString(),
          createdBy: 'human',
        });
        sseBroadcast({ type: 'scheduled_meetings_update', meetings: orch.listScheduledMeetings() });
        json(res, 201, meeting);
      } catch (err) {
        json(res, 400, { error: (err as Error).message });
      }
      return true;
    }

    if (pathname.match(/^\/api\/scheduled-meetings\/[^/]+\/cancel$/) && method === 'POST') {
      const id = pathname.replace('/api/scheduled-meetings/', '').replace('/cancel', '');
      try {
        await orch.cancelScheduledMeeting(id);
        sseBroadcast({ type: 'scheduled_meetings_update', meetings: orch.listScheduledMeetings() });
        json(res, 200, { ok: true });
      } catch (err) {
        json(res, 400, { error: (err as Error).message });
      }
      return true;
    }

    if (pathname.match(/^\/api\/scheduled-meetings\/[^/]+$/) && method === 'DELETE') {
      const id      = pathname.replace('/api/scheduled-meetings/', '');
      const deleted = await orch.deleteScheduledMeeting(id);
      if (deleted) {
        sseBroadcast({ type: 'scheduled_meetings_update', meetings: orch.listScheduledMeetings() });
        json(res, 200, { ok: true });
      } else {
        json(res, 404, { error: 'Meeting not found' });
      }
      return true;
    }

    if (pathname.match(/^\/api\/scheduled-meetings\/[^/]+\/launch$/) && method === 'POST') {
      const id = pathname.replace('/api/scheduled-meetings/', '').replace('/launch', '');
      try {
        await orch.launchScheduledMeeting(id);
        sseBroadcast({ type: 'scheduled_meetings_update', meetings: orch.listScheduledMeetings() });
        json(res, 200, { ok: true });
      } catch (err) {
        json(res, 400, { error: (err as Error).message });
      }
      return true;
    }

    if (pathname.match(/^\/api\/meetings\/[^/]+\/minutes$/) && method === 'GET') {
      const meetingId = pathname.split('/')[3];
      const meeting   = orch.getMeeting(meetingId);
      if (!meeting) { json(res, 404, { error: 'Meeting not found' }); return true; }
      if (meeting.status !== 'closed') { json(res, 409, { error: 'Meeting is still in progress' }); return true; }
      if (meeting.minutesPath) {
        try {
          const { readFile } = await import('fs/promises');
          const md = await readFile(meeting.minutesPath, 'utf-8');
          json(res, 200, { markdown: md });
        } catch {
          const { buildMinutesMarkdown } = await import('../orchestrator/meeting-room.js');
          json(res, 200, { markdown: buildMinutesMarkdown(meeting) });
        }
      } else {
        const { buildMinutesMarkdown } = await import('../orchestrator/meeting-room.js');
        json(res, 200, { markdown: buildMinutesMarkdown(meeting) });
      }
      return true;
    }

    if (pathname.startsWith('/api/meetings/') && pathname.endsWith('/cancel') && method === 'POST') {
      const meetingId = pathname.split('/')[3];
      const resolver  = pendingHumanTurns.get(meetingId);
      if (resolver) { pendingHumanTurns.delete(meetingId); resolver(null); }
      const ackResolver = pendingTurnAcks.get(meetingId);
      if (ackResolver) { pendingTurnAcks.delete(meetingId); ackResolver(); }
      const cancelled = orch.cancelActiveMeeting(meetingId);
      json(res, cancelled ? 200 : 404, { ok: cancelled });
      return true;
    }

    if (pathname.startsWith('/api/meetings/') && pathname.endsWith('/human-turn') && method === 'POST') {
      const meetingId = pathname.split('/')[3];
      const body      = await readBody(req);
      const { content } = JSON.parse(body) as { content?: string };
      const resolver  = pendingHumanTurns.get(meetingId);
      if (resolver) {
        pendingHumanTurns.delete(meetingId);
        resolver(content?.trim() || null);
        json(res, 200, { ok: true });
      } else {
        json(res, 404, { error: 'No pending human turn' });
      }
      return true;
    }

    if (pathname.startsWith('/api/meetings/') && pathname.endsWith('/turn-ack') && method === 'POST') {
      const meetingId   = pathname.split('/')[3];
      const ackResolver = pendingTurnAcks.get(meetingId);
      if (ackResolver) { pendingTurnAcks.delete(meetingId); ackResolver(); }
      json(res, 200, { ok: true });
      return true;
    }

    if (pathname.startsWith('/api/meetings/') && pathname.endsWith('/raise-hand') && method === 'POST') {
      const meetingId = pathname.split('/')[3];
      const body      = await readBody(req);
      const { participant, raised } = JSON.parse(body) as { participant: string; raised: boolean };
      if (!participant?.trim()) { json(res, 400, { error: 'participant is required' }); return true; }
      orch.raiseHandInMeeting(meetingId, participant.trim(), !!raised);
      sseBroadcast({ type: 'meeting_hand_raised', meetingId, participant: participant.trim(), raised: !!raised });
      json(res, 200, { ok: true });
      return true;
    }

    if (pathname.startsWith('/api/meetings/') && pathname.endsWith('/human-interject') && method === 'POST') {
      const meetingId = pathname.split('/')[3];
      const body      = await readBody(req);
      const { content } = JSON.parse(body) as { content?: string };
      if (!content?.trim()) { json(res, 400, { error: 'content is required' }); return true; }
      orch.humanMeetingInterjection(meetingId, content.trim());
      json(res, 200, { ok: true });
      return true;
    }

    return false;
  }
}
