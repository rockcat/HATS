// ── The calendar an agent carries ─────────────────────────────────────────────
//
// A built-in MCP server, one instance per agent, over that agent's own .ics
// file. Where the kanban board is the team's shared memory of work, this is
// one agent's memory of time.
//
// Invitations need an email account, and tools are only offered when one is
// configured: an agent handed `invite` with no way to send it would keep
// calling it and keep being told no.

import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { CallToolRequestSchema, ListToolsRequestSchema } from '@modelcontextprotocol/sdk/types.js';
import { CalendarStore, newUid } from './store.js';
import { parseCalendar } from './icalendar.js';
import { sendInvitation, sendReply, type MailAccount, type Mailer } from './invitation.js';
import type { CalendarEvent, Participation } from './types.js';
import { log } from '../util/logger.js';

const RESPONSES: Participation[] = ['ACCEPTED', 'DECLINED', 'TENTATIVE'];

/** Read the agent's mail account from the environment, if it has one. */
export function mailAccountFromEnv(env: NodeJS.ProcessEnv = process.env): MailAccount | null {
  const address = env['MCP_EMAIL_ADDRESS'];
  const host = env['MCP_EMAIL_SMTP_HOST'];
  const password = env['MCP_EMAIL_PASSWORD'];
  if (!address || !host || !password) return null;

  const port = Number(env['MCP_EMAIL_SMTP_PORT'] ?? 587);
  return {
    address,
    ...(env['MCP_EMAIL_FULL_NAME'] ? { displayName: env['MCP_EMAIL_FULL_NAME'] } : {}),
    host,
    port,
    // 465 is implicit TLS; 587 upgrades with STARTTLS, which nodemailer does
    // for itself when secure is false.
    secure: (env['MCP_EMAIL_SMTP_TLS'] ?? '').toLowerCase() === 'true' || port === 465,
    user: env['MCP_EMAIL_USERNAME'] || address,
    password,
  };
}

const asDate = (value: unknown, what: string): Date => {
  const date = new Date(String(value));
  if (Number.isNaN(date.getTime())) throw new Error(`${what} is not a date I can read: "${String(value)}".`);
  return date;
};

const describe = (event: CalendarEvent): string => {
  const window = `${event.start.toISOString()} → ${event.end.toISOString()}`;
  const guests = (event.attendees ?? [])
    .map((a) => `${a.name ?? a.email} (${a.status.toLowerCase()})`)
    .join(', ');
  return [
    `${event.summary} [${event.uid}]`,
    `  ${window}${event.status === 'CANCELLED' ? '  — CANCELLED' : ''}`,
    event.location ? `  at ${event.location}` : '',
    guests ? `  with ${guests}` : '',
  ].filter(Boolean).join('\n');
};

const listing = (events: CalendarEvent[], empty: string) =>
  events.length === 0 ? empty : events.map(describe).join('\n\n');

/** Build the tool list, which depends on whether mail is configured. */
export function toolsFor(hasMail: boolean) {
  const tools = [
    {
      name: 'list_events',
      description: 'List events in your calendar. Defaults to the next seven days. '
        + 'Use this before agreeing to anything, so you do not double-book yourself.',
      inputSchema: {
        type: 'object',
        properties: {
          from: { type: 'string', description: 'ISO instant to list from. Defaults to now.' },
          to:   { type: 'string', description: 'ISO instant to list until. Defaults to seven days after "from".' },
        },
      },
    },
    {
      name: 'create_event',
      description: hasMail
        ? 'Put something in your calendar. If you name attendees, an invitation is emailed to them '
          + 'and their replies update the event as they arrive.'
        : 'Put something in your calendar. This agent has no email account, so attendees cannot be invited.',
      inputSchema: {
        type: 'object',
        properties: {
          summary:     { type: 'string', description: 'What the event is, in a few words.' },
          start:       { type: 'string', description: 'ISO instant it starts, e.g. 2026-10-20T14:00:00Z.' },
          end:         { type: 'string', description: 'ISO instant it ends. Defaults to an hour after the start.' },
          description: { type: 'string', description: 'Longer detail, agenda, or context.' },
          location:    { type: 'string', description: 'Where it happens.' },
          attendees:   {
            type: 'array', items: { type: 'string' },
            description: 'Email addresses to invite. Each is sent a real calendar invitation.',
          },
        },
        required: ['summary', 'start'],
      },
    },
    {
      name: 'update_event',
      description: 'Change an event you organise. Anyone invited is told about the change.',
      inputSchema: {
        type: 'object',
        properties: {
          uid:         { type: 'string', description: 'The event id, from list_events.' },
          summary:     { type: 'string' },
          start:       { type: 'string', description: 'New ISO start instant.' },
          end:         { type: 'string', description: 'New ISO end instant.' },
          description: { type: 'string' },
          location:    { type: 'string' },
        },
        required: ['uid'],
      },
    },
    {
      name: 'cancel_event',
      description: 'Call off an event you organise. Anyone invited is told it is cancelled. '
        + 'Use this rather than deleting, so it disappears from their calendar too.',
      inputSchema: {
        type: 'object',
        properties: { uid: { type: 'string', description: 'The event id, from list_events.' } },
        required: ['uid'],
      },
    },
    {
      name: 'find_free_time',
      description: 'Find the first free slot of a given length in your own calendar. '
        + 'Use it before proposing a time to somebody.',
      inputSchema: {
        type: 'object',
        properties: {
          minutes: { type: 'number', description: 'How long you need.' },
          from:    { type: 'string', description: 'ISO instant to search from. Defaults to now.' },
          to:      { type: 'string', description: 'ISO instant to search until. Defaults to seven days after "from".' },
        },
        required: ['minutes'],
      },
    },
    {
      name: 'receive_invitation',
      description: 'File an invitation that arrived by email. Pass the raw iCalendar text — '
        + "the email tools' extract_calendar gives you it. "
        + 'A REQUEST is added to your calendar as unanswered; a REPLY records somebody\'s answer '
        + 'to an event you organise; a CANCEL removes it.',
      inputSchema: {
        type: 'object',
        properties: { ics: { type: 'string', description: 'The raw iCalendar text from the email.' } },
        required: ['ics'],
      },
    },
  ];

  if (!hasMail) return tools;

  return [...tools, {
    name: 'respond_to_invitation',
    description: 'Accept or decline an invitation in your calendar. The organiser is emailed your answer. '
      + 'Check list_events for a clash first — accepting two things at once helps nobody.',
    inputSchema: {
      type: 'object',
      properties: {
        uid:      { type: 'string', description: 'The event id, from list_events.' },
        response: { type: 'string', enum: RESPONSES, description: 'Your answer.' },
      },
      required: ['uid', 'response'],
    },
  }];
}

export interface CalendarServerOptions {
  store: CalendarStore;
  account: MailAccount | null;
  /** Built lazily so a calendar with no mail account opens no connection. */
  mailer?: () => Mailer;
}

/** Handle one tool call. Separated from the transport so it can be tested. */
export async function handleCall(
  options: CalendarServerOptions, name: string, args: Record<string, unknown>,
): Promise<string> {
  const { store, account } = options;
  const mailer = () => options.mailer?.() ?? null;

  switch (name) {
    case 'list_events': {
      const from = args['from'] ? asDate(args['from'], 'from') : new Date();
      const to = args['to'] ? asDate(args['to'], 'to') : new Date(from.getTime() + 7 * 864e5);
      const events = await store.between(from, to);
      return listing(events, `Nothing in your calendar between ${from.toISOString()} and ${to.toISOString()}.`);
    }

    case 'create_event': {
      const start = asDate(args['start'], 'start');
      const end = args['end'] ? asDate(args['end'], 'end') : new Date(start.getTime() + 3_600_000);
      if (end <= start) throw new Error('The event ends before it starts.');

      const invited = (args['attendees'] as string[] | undefined) ?? [];
      const event: CalendarEvent = {
        uid: newUid(),
        summary: String(args['summary']),
        start, end,
        ...(args['description'] ? { description: String(args['description']) } : {}),
        ...(args['location'] ? { location: String(args['location']) } : {}),
        ...(account ? { organiser: { email: account.address, ...(account.displayName ? { name: account.displayName } : {}) } } : {}),
        attendees: invited.map((email) => ({ email, status: 'NEEDS-ACTION' as const })),
        sequence: 0,
        status: 'CONFIRMED',
      };

      await store.put(event);
      if (invited.length === 0) return `Added to your calendar.\n\n${describe(event)}`;

      const post = mailer();
      if (!post || !account) {
        return `Added to your calendar, but this agent has no email account, so nobody was invited.\n\n${describe(event)}`;
      }
      const sent = await sendInvitation(post, account, event, 'REQUEST');
      return `Added to your calendar and invited ${sent.join(', ')}.\n\n${describe(event)}`;
    }

    case 'update_event': {
      const uid = String(args['uid']);
      const existing = await store.find(uid);
      if (!existing) return `No event with id ${uid}. Use list_events to see what you have.`;

      const start = args['start'] ? asDate(args['start'], 'start') : existing.start;
      // Moving a meeting keeps its length. Changing only the start used to
      // leave the old end behind, which is either a backwards event or a
      // silently much longer one.
      const end = args['end']
        ? asDate(args['end'], 'end')
        : new Date(start.getTime() + (existing.end.getTime() - existing.start.getTime()));

      // Checked before anything is written, so a rejected change leaves the
      // calendar as it was.
      if (end <= start) throw new Error('That change would end the event before it starts.');

      const changes: Partial<CalendarEvent> = {
        start, end,
        ...(args['summary'] ? { summary: String(args['summary']) } : {}),
        ...(args['description'] ? { description: String(args['description']) } : {}),
        ...(args['location'] ? { location: String(args['location']) } : {}),
      };
      const updated = await store.update(uid, changes);
      if (!updated) return `No event with id ${uid}. Use list_events to see what you have.`;

      const post = mailer();
      if (!post || !account || (updated.attendees ?? []).length === 0) {
        return `Updated.\n\n${describe(updated)}`;
      }
      const sent = await sendInvitation(post, account, updated, 'REQUEST');
      return `Updated, and told ${sent.join(', ')}.\n\n${describe(updated)}`;
    }

    case 'cancel_event': {
      const uid = String(args['uid']);
      const cancelled = await store.cancel(uid);
      if (!cancelled) return `No event with id ${uid}. Use list_events to see what you have.`;

      const post = mailer();
      if (!post || !account || (cancelled.attendees ?? []).length === 0) {
        return `Cancelled "${cancelled.summary}".`;
      }
      const sent = await sendInvitation(post, account, cancelled, 'CANCEL');
      return `Cancelled "${cancelled.summary}" and told ${sent.join(', ')}.`;
    }

    case 'find_free_time': {
      const minutes = Number(args['minutes']);
      if (!Number.isFinite(minutes) || minutes <= 0) throw new Error('How many minutes do you need?');
      const from = args['from'] ? asDate(args['from'], 'from') : new Date();
      const to = args['to'] ? asDate(args['to'], 'to') : new Date(from.getTime() + 7 * 864e5);

      const slot = await store.freeSlot(from, to, minutes, account?.address);
      return slot
        ? `Free from ${slot.start.toISOString()} to ${slot.end.toISOString()}.`
        : `No free ${minutes}-minute slot between ${from.toISOString()} and ${to.toISOString()}.`;
    }

    case 'receive_invitation': {
      const { method, events } = parseCalendar(String(args['ics'] ?? ''));
      if (events.length === 0) return 'That does not contain a calendar event I can read.';
      const event = events[0]!;

      if (method === 'REPLY') {
        const answer = event.attendees?.[0];
        if (!answer) return 'That reply does not say who answered.';
        const updated = await store.recordResponse(event.uid, answer.email, answer.status);
        return updated
          ? `${answer.name ?? answer.email} ${answer.status.toLowerCase()} "${updated.summary}".`
          : `A reply arrived for an event not in your calendar (${event.uid}).`;
      }

      if (method === 'CANCEL') {
        const existing = await store.find(event.uid);
        if (!existing) return 'That cancellation is for an event not in your calendar.';
        await store.cancel(event.uid);
        return `"${existing.summary}" has been cancelled by the organiser.`;
      }

      // REQUEST, or a plain published event.
      const existing = await store.find(event.uid);
      await store.put(event);
      return existing
        ? `Updated "${event.summary}" in your calendar.\n\n${describe(event)}`
        : `Added "${event.summary}" to your calendar, unanswered.\n\n${describe(event)}`
          + (account ? '\n\nUse respond_to_invitation to accept or decline.' : '');
    }

    case 'respond_to_invitation': {
      const uid = String(args['uid']);
      const response = String(args['response']).toUpperCase() as Participation;
      if (!RESPONSES.includes(response)) throw new Error(`Answer with one of: ${RESPONSES.join(', ')}.`);

      const event = await store.find(uid);
      if (!event) return `No event with id ${uid}. Use list_events to see what you have.`;
      if (!account) return 'This agent has no email account, so it cannot answer an invitation.';

      await store.recordResponse(uid, account.address, response);
      // Declining leaves it in the calendar, marked: it is still useful to
      // know what was asked and what was said.
      const post = mailer();
      const organiser = post ? await sendReply(post, account, event, response) : null;
      return organiser
        ? `Told ${organiser} you ${response.toLowerCase()} "${event.summary}".`
        : `Recorded that you ${response.toLowerCase()} "${event.summary}", but there was no organiser to tell.`;
    }

    default:
      throw new Error(`Unknown tool: ${name}`);
  }
}

export async function startCalendarServer(
  calendarPath: string, account: MailAccount | null, mailer?: () => Mailer,
): Promise<void> {
  const store = new CalendarStore(calendarPath);
  await store.load();
  const options: CalendarServerOptions = { store, account, ...(mailer ? { mailer } : {}) };

  const server = new Server({ name: 'calendar', version: '1.0.0' }, { capabilities: { tools: {} } });

  server.setRequestHandler(ListToolsRequestSchema, async () => ({ tools: toolsFor(!!account) }));

  server.setRequestHandler(CallToolRequestSchema, async (request) => {
    const { name, arguments: args } = request.params;
    try {
      const text = await handleCall(options, name, (args ?? {}) as Record<string, unknown>);
      return { content: [{ type: 'text', text }] };
    } catch (err) {
      return { content: [{ type: 'text', text: (err as Error).message }], isError: true };
    }
  });

  await server.connect(new StdioServerTransport());
  log.info(`[Calendar] serving ${calendarPath}${account ? ` as ${account.address}` : ' (no email account)'}`);
}

// Entry point when run directly as an MCP server.
import { pathToFileURL } from 'url';
import { createTransport } from 'nodemailer';

if (import.meta.url === pathToFileURL(process.argv[1] ?? '').href) {
  const file = process.env['CALENDAR_FILE_PATH'] ?? process.argv[2] ?? 'calendar.ics';
  const account = mailAccountFromEnv();
  // Built lazily: a calendar with no mail account should open no connection,
  // and one that never sends an invitation should not either.
  const mailer = account
    ? () => createTransport({
        host: account.host,
        port: account.port,
        secure: account.secure,
        auth: { user: account.user, pass: account.password },
      }) as unknown as Mailer
    : undefined;

  startCalendarServer(file, account, mailer).catch((err) => log.error(err));
}
