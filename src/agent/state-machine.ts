import { AgentState, AgentEvent } from './types.js';

type Transition = {
  [S in AgentState]?: Partial<Record<AgentEvent, AgentState>>;
};

const transitions: Transition = {
  [AgentState.Idle]: {
    task_assigned: AgentState.Working,
  },
  [AgentState.Working]: {
    task_complete: AgentState.Idle,
    blocked: AgentState.WaitingForHelp,
    discussion_invited: AgentState.InDiscussion,
  },
  [AgentState.WaitingForHelp]: {
    help_received: AgentState.Working,
    discussion_invited: AgentState.InDiscussion,
  },
  [AgentState.InDiscussion]: {
    discussion_ended: AgentState.Working,
    task_complete: AgentState.Idle,
  },
};

export function transition(state: AgentState, event: AgentEvent): AgentState {
  const stateTransitions = transitions[state];
  const nextState = stateTransitions?.[event];

  if (nextState === undefined) {
    throw new Error(
      `Invalid transition: cannot apply event "${event}" in state "${state}"`,
    );
  }

  return nextState;
}
