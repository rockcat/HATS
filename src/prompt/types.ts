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
