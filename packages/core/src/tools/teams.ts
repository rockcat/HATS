// ── Tools for working with other teams ───────────────────────────────────────
//
// Offered only on a runner with a runner manager, and only to a team whose
// visit policy lets its agents visit somewhere. See docs/team-visits.md in
// the HATS repository.

import type { ToolDefinition } from './types.js';

export const DISCOVER_TEAMS: ToolDefinition = {
  name: 'discover_teams',
  description:
    'Find another team in this installation that has tools or expertise your team lacks. '
    + 'Describe what you need; you get up to three teams you could visit, best match first, '
    + 'with what each offers. Use it when your work needs something nobody on your team can do.',
  parameters: {
    type: 'object',
    properties: {
      intent: {
        type: 'string',
        description: 'What you need, in a sentence, e.g. "the EU customers\' invoice history".',
      },
    },
    required: ['intent'],
  },
};

export const REQUEST_VISIT: ToolDefinition = {
  name: 'request_visit',
  description:
    'Ask to visit another team, to do one piece of your work there with what it has and your team lacks. '
    + 'A visit is for a ticket on your board that is assigned to you: say what you will do there and what '
    + 'you will bring back. Find teams with discover_teams first. You leave when the other team agrees and '
    + 'your turn ends; your tickets and schedule wait for you here. Often asking someone there a question '
    + 'is enough, and a visit is not needed.',
  parameters: {
    type: 'object',
    properties: {
      team: { type: 'string', description: 'The team to visit, as discover_teams named it.' },
      ticket: { type: 'string', description: 'Your ticket the visit is for, e.g. "TKT-012".' },
      purpose: { type: 'string', description: 'What you will do there.' },
      expected_result: { type: 'string', description: 'What you will bring back.' },
    },
    required: ['team', 'ticket', 'purpose', 'expected_result'],
  },
};

export const FINISH_VISIT: ToolDefinition = {
  name: 'finish_visit',
  description:
    'End your visit and go home with your result. Call it once the work you came for is done, or when it '
    + 'cannot be done: a clear reason why is a result too. You leave when this turn ends.',
  parameters: {
    type: 'object',
    properties: {
      outcome: { type: 'string', enum: ['done', 'partial', 'failed'], description: 'How far you got.' },
      summary: { type: 'string', description: 'What you did and what you found, for your home team.' },
      remaining: { type: 'string', description: 'What is still to do, if it is not done.' },
      reason: { type: 'string', description: 'Why it is not done, if it is not.' },
    },
    required: ['outcome', 'summary'],
  },
};

export const TEAMS_TOOL_NAMES = [DISCOVER_TEAMS.name, REQUEST_VISIT.name, FINISH_VISIT.name] as const;
