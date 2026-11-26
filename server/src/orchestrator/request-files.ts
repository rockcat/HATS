/**
 * The project files a request to the human is about — a draft to approve, a
 * report to read. Named by the agent in `files`, or written into its message
 * as a path; either way the dashboard shows each as a link to open it.
 */

/** Paths inside the project's own folders, as an agent writes them in a message. */
const MENTIONED = /(?:^|[\s(`'"[])\.?\/?((?:outputs|sources|TKT-[\w-]+)\/[^\s`'"()[\]<>]+\.[A-Za-z0-9]+)/gi;

/** A path as the project file API takes it, or null for one that leaves the project. */
export function projectRelative(raw: string): string | null {
  const p = raw.trim().replace(/\\/g, '/').replace(/^\.?\/+/, '').replace(/[.,;:!?]+$/, '');
  if (!p || p.split('/').includes('..') || /^[A-Za-z]:/.test(p)) return null;
  return p;
}

/** The files a request names and mentions, each once, in the order given. */
export function requestFiles(named: unknown, message: string): string[] {
  const given = Array.isArray(named) ? named.filter((f): f is string => typeof f === 'string') : [];
  const mentioned = [...message.matchAll(MENTIONED)].map(m => m[1]!);
  const out: string[] = [];
  for (const raw of [...given, ...mentioned]) {
    const p = projectRelative(raw);
    if (p && !out.includes(p)) out.push(p);
  }
  return out;
}
