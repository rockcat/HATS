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

export const TEAMS_TOOL_NAMES = [DISCOVER_TEAMS.name] as const;
