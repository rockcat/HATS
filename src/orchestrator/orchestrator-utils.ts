import { v4 as uuidv4 } from 'uuid';
import { TeamMessage } from './types.js';

export function buildMessage(
  from: string,
  to: string,
  type: TeamMessage['type'],
  content: string,
  extras: Partial<TeamMessage> = {},
): TeamMessage {
  return {
    id: uuidv4(),
    ts: new Date().toISOString(),
    type,
    from,
    to,
    content,
    ...extras,
  };
}

export function toProjectSlug(text: string): string {
  return text
    .toLowerCase()
    .replace(/[^a-z0-9\s-]/g, '')
    .trim()
    .split(/\s+/)
    .slice(0, 5)
    .join('-')
    .replace(/-+/g, '-')
    .replace(/^-|-$/g, '')
    .slice(0, 60) || 'project';
}
