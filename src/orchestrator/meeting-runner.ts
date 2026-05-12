import { v4 as uuidv4 } from 'uuid';
import { log } from '../util/logger.js';
import { renderMarkdown } from '../human/markdown.js';
import { Agent } from '../agent/agent.js';
import { EventStore } from '../store/event-store.js';
import { MeetingRoom } from './meeting-room.js';
import { Meeting, MeetingTurn, TeamMessage } from './types.js';

export interface MeetingRunnerContext {
  meetings: Map<string, Meeting>;
  activeMeetingRooms: Map<string, MeetingRoom>;
  agents: Map<string, Agent>;
  store: EventStore;
  projectDir: string | null;
  onMeetingTurnPaced: ((meetingId: string, participant: string) => Promise<void>) | null;
  onHumanMeetingTurn: ((meetingId: string, turns: MeetingTurn[], topic: string) => Promise<string | null>) | null;
}

export async function startMeeting(
  ctx: MeetingRunnerContext,
  facilitatorName: string,
  participants: string[],
  topic: string,
  agenda?: string,
): Promise<string> {
  const meetingId = uuidv4();
  const meeting: Meeting = {
    id: meetingId,
    topic,
    agenda,
    facilitator: facilitatorName,
    participants,
    status: 'open',
    turns: [],
    createdAt: new Date().toISOString(),
  };
  ctx.meetings.set(meetingId, meeting);

  await ctx.store.append('meeting_started', {
    meetingId,
    facilitator: facilitatorName,
    participants,
    topic,
    agenda,
  });

  log.info(`\n━━━ MEETING: ${topic} ━━━`);
  log.info(`Participants: ${[facilitatorName, ...participants].join(', ')}\n`);

  const agentsByName = new Map<string, Agent>();
  for (const agent of ctx.agents.values()) {
    agentsByName.set(agent.name, agent);
  }

  const room = new MeetingRoom(
    meeting,
    agentsByName,
    ctx.store,
    (transcript: MeetingTurn[], meetingTopic: string) =>
      getHumanMeetingInput(ctx, meetingId, transcript, meetingTopic),
    ctx.projectDir,
    ctx.onMeetingTurnPaced
      ? (id, participant) => ctx.onMeetingTurnPaced!(id, participant)
      : undefined,
  );

  ctx.activeMeetingRooms.set(meetingId, room);

  room.run().then(() => {
    ctx.activeMeetingRooms.delete(meetingId);
  }).catch((err) => {
    log.error(`[Meeting ${meetingId}] error:`, err);
    ctx.activeMeetingRooms.delete(meetingId);
  });

  return meetingId;
}

export async function getHumanMeetingInput(
  ctx: Pick<MeetingRunnerContext, 'onHumanMeetingTurn'>,
  meetingId: string,
  turns: MeetingTurn[],
  topic: string,
): Promise<string | null> {
  if (ctx.onHumanMeetingTurn) {
    return ctx.onHumanMeetingTurn(meetingId, turns, topic);
  }
  return null;
}

export interface ResponseHandlerContext {
  store: EventStore;
  deliverToAgent(name: string, msg: TeamMessage): void;
  buildMessage(from: string, to: string, type: TeamMessage['type'], content: string, extras?: Partial<TeamMessage>): TeamMessage;
}

export function makeResponseHandler(ctx: ResponseHandlerContext) {
  return async (agentName: string, incomingMessage: TeamMessage, response: string): Promise<void> => {
    await ctx.store.append('agent_response', {
      from: agentName,
      inReplyTo: incomingMessage.id,
      content: response,
    });

    if (incomingMessage.from === 'human') {
      log.info(`\n\x1b[1m${agentName}\x1b[0m\n${renderMarkdown(response)}`);
    } else if (incomingMessage.from !== agentName) {
      const replyMsg = ctx.buildMessage(agentName, incomingMessage.from, 'direct', response);
      ctx.deliverToAgent(incomingMessage.from, replyMsg);
    }
  };
}
