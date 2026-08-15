import { v4 as uuidv4 } from 'uuid';
import { EventStore } from '../store/event-store.js';
import { MeetingStore } from './meeting-store.js';
import { ScheduledMeeting, MeetingType } from './types.js';

export interface ScheduledMeetingContext {
  store: EventStore;
  scheduledMeetingStore: MeetingStore;
  findByName(name: string): { name: string } | undefined;
  startMeeting(facilitatorName: string, participants: string[], topic: string, agenda?: string): Promise<string>;
}

export async function createScheduledMeeting(
  ctx: ScheduledMeetingContext,
  data: {
    type: MeetingType; topic: string; agenda?: string;
    facilitator: string; participants: string[];
    scheduledFor: string; createdBy: string;
  },
): Promise<ScheduledMeeting> {
  const meeting: ScheduledMeeting = {
    id: uuidv4(),
    ...data,
    status: 'scheduled',
    createdAt: new Date().toISOString(),
  };
  await ctx.scheduledMeetingStore.add(meeting);
  await ctx.store.append('meeting_scheduled', {
    id: meeting.id,
    topic: data.topic,
    scheduledFor: data.scheduledFor,
    facilitator: data.facilitator,
  });
  return meeting;
}

export async function recordImpromptuInCalendar(
  store: MeetingStore,
  data: {
    topic: string; agenda?: string; facilitator: string;
    participants: string[]; startedAt: string;
  },
): Promise<void> {
  const now = data.startedAt;
  const meeting: ScheduledMeeting = {
    id: uuidv4(),
    type: 'ad_hoc',
    topic: data.topic,
    agenda: data.agenda,
    facilitator: data.facilitator,
    participants: data.participants,
    scheduledFor: now,
    status: 'launched',
    createdBy: 'human',
    createdAt: now,
    launchedAt: now,
  };
  await store.add(meeting);
}

export function listScheduledMeetings(store: MeetingStore): ScheduledMeeting[] {
  return store.list();
}

export async function cancelScheduledMeeting(store: MeetingStore, id: string): Promise<void> {
  const meeting = store.get(id);
  if (!meeting) throw new Error(`Scheduled meeting "${id}" not found`);
  if (meeting.status !== 'scheduled') throw new Error(`Meeting "${id}" is already ${meeting.status}`);
  meeting.status = 'cancelled';
  meeting.cancelledAt = new Date().toISOString();
  await store.update(meeting);
}

export async function deleteScheduledMeeting(store: MeetingStore, id: string): Promise<boolean> {
  return store.delete(id);
}

export async function updateScheduledMeeting(store: MeetingStore, meeting: ScheduledMeeting): Promise<void> {
  await store.update(meeting);
}

export async function launchScheduledMeeting(ctx: ScheduledMeetingContext, id: string): Promise<void> {
  const scheduled = ctx.scheduledMeetingStore.get(id);
  if (!scheduled) throw new Error(`Scheduled meeting "${id}" not found`);
  if (scheduled.status !== 'scheduled') return;
  if (!ctx.findByName(scheduled.facilitator)) throw new Error(`Facilitator "${scheduled.facilitator}" not found`);

  const meetingId = await ctx.startMeeting(
    scheduled.facilitator,
    scheduled.participants,
    scheduled.topic,
    scheduled.agenda,
  );
  scheduled.status = 'launched';
  scheduled.launchedAt = new Date().toISOString();
  scheduled.meetingId = meetingId;
  await ctx.scheduledMeetingStore.update(scheduled);
}
