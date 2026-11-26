// ── An agent's own limits in this project ──────────────────────────────────────
//
// A project agent starts with its template's limits; these change the copy
// alone. Raising the hourly budget past what it has spent wakes a paused agent.

const el = id => document.getElementById(id);

/** A field's value as the limits route takes it: a number, or null for none. */
export function limitValue(raw) {
  const text = String(raw ?? '').trim();
  return text === '' ? null : Number(text);
}

/** Fill the limit fields for this agent. */
export function bindAgentLimits(agent) {
  const cost = el('agent-config-max-cost');
  const context = el('agent-config-max-context');
  if (cost) cost.value = agent?.maxCostPerHour != null ? String(agent.maxCostPerHour) : '';
  if (context) context.value = agent?.maxContextTokens != null ? String(agent.maxContextTokens) : '';
}

/** Save what is in the fields; part of the Configure panel's Apply. */
export async function saveAgentLimits(name) {
  const r = await fetch(`/api/agents/${encodeURIComponent(name)}/limits`, {
    method: 'PATCH', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      maxCostPerHour: limitValue(el('agent-config-max-cost')?.value),
      maxContextTokens: limitValue(el('agent-config-max-context')?.value),
    }),
  });
  if (!r.ok) throw new Error((await r.json().catch(() => ({}))).error ?? 'Could not save the limits');
  return r;
}
