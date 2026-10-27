/**
 * The tools the Team Runner adds to an agent's MCP tools.
 *
 * Read from @hats/core, which is where the runner reads them too, so the
 * library's tool preview lists the same tools the runner sends. How each
 * group is placed follows `addAgent` in the runner's orchestrator:
 *
 *   core      always sent, whatever the template chooses
 *   onDemand  the rest of the runner's own tools, found with search_tools
 *   personal  the board's everyday tools — placed with the agent's own MCP
 *             servers, so upfront by default but subject to the template's
 *             upfront selection
 *   shared    the rest of the board's tools, placed with the team's servers
 *   people    placed like `personal`, but only on a runner with face
 *             recognition set up, which the library cannot see
 */

import { getAllToolsForHat, getToolsForHat } from '@hats/core/tools/definitions';
import { kanbanTools, UPFRONT_KANBAN_TOOLS } from '@hats/core/tools/kanban';
import { peopleToolDefinitions } from '@hats/core/tools/people';
import type { ToolDefinition } from '@hats/core/tools/types';
import { HatType } from '@hats/core/hats/types';

/** A runner tool, with where it comes from for the preview to show. */
export interface BuiltinTool extends ToolDefinition {
  source: 'runner' | 'board' | 'people';
}

export interface BuiltinTools {
  core: BuiltinTool[];
  onDemand: BuiltinTool[];
  personal: BuiltinTool[];
  shared: BuiltinTool[];
  people: BuiltinTool[];
}

const HAT_VALUES = new Set<string>(Object.values(HatType));

const tagged = (source: BuiltinTool['source']) =>
  (t: { name: string; description: string; parameters?: ToolDefinition['parameters']; inputSchema?: ToolDefinition['parameters'] }): BuiltinTool =>
    ({ name: t.name, description: t.description, parameters: (t.parameters ?? t.inputSchema)!, source });

/** The runner's tools for an agent wearing these hats. Unknown hats are ignored. */
export function builtinTools(hats: string[]): BuiltinTools {
  const hatTypes = hats.filter((h) => HAT_VALUES.has(h)) as HatType[];
  const core = getToolsForHat(hatTypes);
  const coreNames = new Set(core.map((t) => t.name));
  const upfrontBoard = new Set<string>(UPFRONT_KANBAN_TOOLS);
  const board = kanbanTools().map(tagged('board'));

  return {
    core: core.map(tagged('runner')),
    onDemand: getAllToolsForHat(hatTypes).filter((t) => !coreNames.has(t.name)).map(tagged('runner')),
    personal: board.filter((t) => upfrontBoard.has(t.name)),
    shared: board.filter((t) => !upfrontBoard.has(t.name)),
    people: peopleToolDefinitions().map(tagged('people')),
  };
}
