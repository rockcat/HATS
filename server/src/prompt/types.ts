export interface PromptContext {
  name: string;
  visualDescription: string;
  backstory?: string;
  hatLabel: string;
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

export interface SystemPrompt {
  text: string;
  sections: {
    identityAnchor: string;
    hatRoleStatement: string;
    thinkingStyle: string;
    communicationTone: string;
    directives: string;
    avoidances: string;
    specialisation?: string;
    teamRole?: string;
    closingAnchor: string;
  };
}
