/**
 * The condensed system prompt.
 *
 * Built from the same context as the full prompt, at a fraction of the size,
 * for small local models: they have little context to spare and follow a few
 * plain rules better than pages of nuance. The full prompt's sections each
 * shrink to a line or two — the hat to its core trait, lists to their first
 * few items, the workspace and board guides to one rule each.
 */

import { SPECIALISATION_DIRECTIVES } from './specialisations.js';
import type { PromptContext } from './types.js';

/** How many items of each list survive. */
const KEEP = 3;

export function generateCondensedPrompt(ctx: PromptContext): string {
  const who = ctx.specialisation ? `${ctx.name}, ${ctx.specialisation} specialist` : ctx.name;
  const intro = [`You are ${who}.`, ctx.backstory?.trim()].filter(Boolean).join(' ');
  const role = ctx.hatLabel === 'No Hat'
    ? 'Role: general-purpose team member — use whatever approach fits the task.'
    : `Role: ${ctx.hatLabel} — ${ctx.coreTrait ?? ctx.thinkingStyle.split('. ')[0]}.`;

  const rules = [
    'Act without asking permission. Use escalate_to_human only for what only the human can decide.',
    ...ctx.directives.slice(0, KEEP),
    ...(ctx.avoidances.length ? [`Avoid: ${ctx.avoidances.slice(0, 2).map(trimStop).join('; ')}.`] : []),
    ...(ctx.specialisation ? (SPECIALISATION_DIRECTIVES[ctx.specialisation] ?? []).slice(0, KEEP) : []),
    ...(ctx.email ? [`Your email is ${ctx.email} — yours, not the human's. Say you are an AI acting for the human.`] : []),
    ...(ctx.hasTicketing ? ['The board is your memory: list_tickets before starting, create_ticket for new work, add_comment for decisions, move_ticket as status changes.'] : []),
    'Files: write_file / read_file / list_files work in outputs/; pass a ticket ID for a sub-folder, ticket="sources" for inputs.',
  ];

  const parts = [
    intro,
    role,
    `Rules:\n${rules.map(r => `- ${r}`).join('\n')}`,
    ctx.projectGoal?.trim() && `Goal: ${ctx.projectGoal.trim()}`,
    ctx.teamContext?.trim() && `Team:\n${ctx.teamContext.trim()}`,
    ctx.instructions?.trim(),
    'Be brief and decisive: give your view or a concrete output, not discussion. Stay in character.',
  ];
  return parts.filter(Boolean).join('\n\n');
}

function trimStop(s: string): string {
  return s.trim().replace(/[.\s]+$/, '');
}
