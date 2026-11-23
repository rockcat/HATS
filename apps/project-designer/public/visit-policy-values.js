/**
 * The visit-policy form's values, merged into a project's settings. Plain
 * data in and out, so it is tested without a page.
 */

export const ANY = '*';

/**
 * `settings` with the form's values merged in. Settings the form does not
 * show (speech, meetings) come back as they were, because the Project Server
 * replaces settings whole.
 *
 * @param {{ summary: string, tags: string, visitTo: string[], hostFrom: string[],
 *           approval: string, memoryHome: string, maxHours: string }} form
 * @param {Record<string, unknown>} [settings]
 */
export function mergeVisitPolicy(form, settings = {}) {
  const tags = [...new Set(form.tags.split(',').map((t) => t.trim()).filter(Boolean))].slice(0, 20);
  const maxHours = Number(form.maxHours);
  // "Any team" stands for all of them; listing others beside it says nothing more.
  const list = (teams) => (teams.includes(ANY) ? [ANY] : teams);

  const next = { ...settings };
  const summary = form.summary.trim();
  if (summary) next.summary = summary; else delete next.summary;
  if (tags.length) next.tags = tags; else delete next.tags;
  next.visits = {
    visitTo: list(form.visitTo),
    hostFrom: list(form.hostFrom),
    approval: form.approval || 'admin',
    memoryHome: form.memoryHome || 'summary',
    ...(maxHours > 0 && { maxHours }),
  };
  return next;
}
