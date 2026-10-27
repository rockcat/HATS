export interface PromptContext {
  name: string;
  visualDescription: string;
  backstory?: string;
  hatLabel: string;
  /** The hat in a phrase — what the condensed prompt says instead of the thinking style. */
  coreTrait?: string;
  /** Free text the user adds to this agent's prompt, used as written. */
  instructions?: string;
  /**
   * Whether this agent has a board to write to.
   *
   * Telling an agent to raise a ticket when it has no ticketing tool just
   * teaches it that its tools do not work.
   */
  hasTicketing?: boolean;
  thinkingStyle: string;
  communicationTone: string;
  directives: string[];
  avoidances: string[];
  teamRole: string;
  teamContext?: string;
  projectDir?: string;     // absolute path to current project folder
  projectGoal?: string;    // optional goal statement — injected into every prompt
  specialisation?: string; // optional focus area (e.g. 'Marketing', 'Finance')
  email?: string;          // agent's own email address
}

/** Which system prompt an agent is given: the full one, or the condensed one for small models. */
export type PromptMode = 'full' | 'condensed';

export interface SystemPrompt {
  text: string;
  /** The same prompt cut down for small local models. */
  condensed: string;
  sections: {
    identityAnchor: string;
    hatRoleStatement: string;
    thinkingStyle: string;
    communicationTone: string;
    directives: string;
    avoidances: string;
    instructions?: string;
    specialisation?: string;
    teamRole?: string;
    closingAnchor: string;
  };
}
