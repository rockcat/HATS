// ── Knowing who you are talking to, as the model sees it ─────────────────────
//
// Definitions only; the runner's people/tools.ts runs them and explains why
// the descriptions say what they do.

import type { ToolDefinition } from './types.js';

/** Every tool this module offers. The one list, so nothing drifts. */
export const PEOPLE_TOOL_NAMES = ['identify_person', 'remember_person',
  'forget_person', 'list_people'] as const;

/** One tool, in the shape both the MCP server and the agent tool list want. */
export interface PeopleTool {
  name: string;
  description: string;
  inputSchema: ToolDefinition['parameters'];
}

/** Tool definitions, shaped by what this runner can actually do. */
export function peopleToolDefinitions(): PeopleTool[] {
  return [
    {
      name: 'identify_person',
      description:
        'Work out who you are looking at. Call it with no arguments and the '
        + "user's device will look through its camera for you. "
        + 'Answers one of four ways, and they mean different things: you know them; '
        + 'you are unsure between a few people, so ask which; you do not know them, '
        + 'so you may ask their name and offer to remember them; or there is nobody '
        + 'on file to compare against yet. Never use a name you were not given — '
        + 'calling somebody by the wrong name is worse than asking.',
      inputSchema: {
        type: 'object',
        properties: {
          vector: {
            type: 'array', items: { type: 'number' },
            description: 'Only if you already have an embedding. Normally leave this out.',
          },
          image_base64: {
            type: 'string',
            description: 'A photo instead. Needs a face model on the runner; usually leave this out.',
          },
        },
      },
    },
    {
      name: 'remember_person',
      description:
        "Store somebody's face against their name, so you recognise them next time. "
        + 'Give just their name and consent — the camera is used for the face. '
        + 'Ask them first and only call this once they have said yes — a face is '
        + 'personal data and this refuses without consent. Use the same name you '
        + 'were given; calling again for somebody you already know adds another '
        + 'angle of their face, which makes recognition better.',
      inputSchema: {
        type: 'object',
        properties: {
          name:     { type: 'string', description: 'What they want to be called.' },
          consent:  { type: 'boolean', description: 'They agreed, in so many words, to be remembered.' },
          vector:   { type: 'array', items: { type: 'number' }, description: 'Their face embedding.' },
          image_base64: { type: 'string', description: 'Or a photo, if the device cannot embed.' },
          primary:  { type: 'boolean', description: 'This is the main user of this agent.' },
          notes:    { type: 'string', description: 'Anything worth keeping about them.' },
        },
        required: ['name', 'consent'],
      },
    },
    {
      name: 'forget_person',
      description:
        'Delete somebody and their face entirely. Do this whenever asked, without '
        + 'argument — it is their face and their right. It cannot be undone, and '
        + 'you will not recognise them afterwards.',
      inputSchema: {
        type: 'object',
        properties: { name: { type: 'string', description: 'Their name, or their id.' } },
        required: ['name'],
      },
    },
    {
      name: 'list_people',
      description: 'Everybody you have been introduced to, without their face data. '
        + 'Use it to check a name before asking again.',
      inputSchema: { type: 'object', properties: {} },
    },
  ];
}
