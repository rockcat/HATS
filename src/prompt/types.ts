export interface PromptContext {
  name: string;
  visualDescription: string;
  backstory?: string;
  hatLabel: string;
  thinkingStyle: string;
  communicationTone: string;
  directives: string[];
  avoidances: string[];
  teamRole: string;
  teamContext?: string;
  projectDir?: string;     // absolute path to current project folder
  specialisation?: string; // optional focus area (e.g. 'Marketing', 'Finance')
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
    teamRole?: string;
    closingAnchor: string;
  };
}
