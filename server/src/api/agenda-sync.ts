/**
 * Keeping agents' agenda entries in step with the global scheduled actions.
 *
 * Assigning a global action to an agent copies it into that agent's agenda,
 * because the agenda is what actually fires. The copy used to be cut loose at
 * that point: unticking the action left it running, editing the action changed
 * nothing an agent did, and deleting it left every copy behind. Each entry now
 * remembers the action it came from, and these keep the two in step.
 *
 * Entries written before that link existed carry no actionId. They are matched
 * by label, the same key AgendaStore.add already treats as identity, and get
 * linked the first time they are seen.
 */

import type { AgendaEntry, AgendaStore } from './agenda-store.js';
import type { ScheduledActionDef } from '../store/team-snapshot.js';

const sameLabel = (a: string, b: string): boolean => a.trim().toLowerCase() === b.trim().toLowerCase();

/** Whether an agenda entry is this action's copy. */
export function isCopyOf(entry: AgendaEntry, action: Pick<ScheduledActionDef, 'id' | 'label'>): boolean {
  return entry.actionId ? entry.actionId === action.id : sameLabel(entry.label, action.label);
}

export interface AssignmentPlan {
  add: ScheduledActionDef[];
  link: { entryId: string; actionId: string }[];
  remove: string[];
}

/**
 * What to change in one agent's agenda so it holds exactly the assigned actions.
 * Entries the agent scheduled for itself are left alone.
 */
export function planAssignment(
  entries: AgendaEntry[],
  actions: ScheduledActionDef[],
  assignedIds: string[],
): AssignmentPlan {
  const assigned = new Set(assignedIds);
  const plan: AssignmentPlan = { add: [], link: [], remove: [] };

  for (const action of actions.filter((a) => assigned.has(a.id))) {
    const copy = entries.find((e) => isCopyOf(e, action));
    if (!copy) plan.add.push(action);
    else if (!copy.actionId) plan.link.push({ entryId: copy.id, actionId: action.id });
  }

  const known = new Map(actions.map((a) => [a.id, a]));
  for (const entry of entries) {
    if (entry.actionId) {
      // Unassigned, or the action itself has since been deleted.
      if (!assigned.has(entry.actionId) || !known.has(entry.actionId)) plan.remove.push(entry.id);
      continue;
    }
    const source = actions.find((a) => isCopyOf(entry, a));
    if (source && !assigned.has(source.id)) plan.remove.push(entry.id);
  }
  return plan;
}

export async function applyAssignment(agenda: AgendaStore, agentName: string, plan: AssignmentPlan): Promise<void> {
  for (const id of plan.remove) await agenda.remove(id);
  for (const { entryId, actionId } of plan.link) await agenda.update(entryId, { actionId });
  for (const action of plan.add) {
    await agenda.add({
      agentName,
      label: action.label,
      description: action.description,
      intervalSeconds: action.intervalSeconds,
      type: action.type,
      mcpToolCall: action.mcpToolCall,
      actionId: action.id,
    });
  }
}

/**
 * Carry an edited action into every agent's copy. `before` is the action as it
 * was, so a legacy copy is still found by its old label after a rename. Each
 * copy keeps its own enabled state.
 */
export async function propagateEdit(agenda: AgendaStore, before: ScheduledActionDef, after: ScheduledActionDef): Promise<number> {
  const copies = agenda.list().filter((e) => isCopyOf(e, before));
  for (const copy of copies) {
    await agenda.update(copy.id, {
      label: after.label,
      description: after.description,
      intervalSeconds: after.intervalSeconds,
      type: after.type,
      mcpToolCall: after.mcpToolCall,
      actionId: after.id,
    });
  }
  return copies.length;
}

/** The most recent run of any agent's copy of an action, and whose it was. */
export function lastRunOf(
  entries: AgendaEntry[],
  action: Pick<ScheduledActionDef, 'id' | 'label'>,
): { lastRunAt: number; lastRunBy: string } | null {
  let latest: AgendaEntry | null = null;
  for (const e of entries) {
    if (e.lastRunAt && isCopyOf(e, action) && (!latest || e.lastRunAt > latest.lastRunAt!)) latest = e;
  }
  return latest ? { lastRunAt: latest.lastRunAt!, lastRunBy: latest.agentName } : null;
}

/** Remove every agent's copy of a deleted action. */
export async function removeCopies(agenda: AgendaStore, action: ScheduledActionDef): Promise<number> {
  const copies = agenda.list().filter((e) => isCopyOf(e, action));
  for (const copy of copies) await agenda.remove(copy.id);
  return copies.length;
}
