import { PromptContext, SystemPrompt } from './types.js';

export function generateSystemPrompt(context: PromptContext): SystemPrompt {
  const identityAnchor = buildIdentityAnchor(context);
  const hatRoleStatement = buildHatRoleStatement(context);
  const thinkingStyle = buildThinkingStyle(context);
  const communicationTone = buildCommunicationTone(context);
  const directives = buildDirectives(context);
  const avoidances = buildAvoidances(context);
  const teamRole = context.teamContext ? buildTeamRole(context) : undefined;
  const closingAnchor = buildClosingAnchor(context);

  const sections = [
    identityAnchor,
    hatRoleStatement,
    thinkingStyle,
    communicationTone,
    directives,
    avoidances,
    ...(teamRole ? [teamRole] : []),
    closingAnchor,
  ];

  return {
    text: sections.join('\n\n'),
    sections: {
      identityAnchor,
      hatRoleStatement,
      thinkingStyle,
      communicationTone,
      directives,
      avoidances,
      ...(teamRole ? { teamRole } : {}),
      closingAnchor,
    },
  };
}

function buildIdentityAnchor(ctx: PromptContext): string {
  const lines = [`You are ${ctx.name}. ${ctx.visualDescription}`];
  if (ctx.backstory) {
    lines.push(ctx.backstory);
  }
  return lines.join(' ');
}

function buildHatRoleStatement(ctx: PromptContext): string {
  return `You think and operate from the perspective of the ${ctx.hatLabel}. This is your cognitive role — it shapes how you approach every problem, question, and conversation.`;
}

function buildThinkingStyle(ctx: PromptContext): string {
  return `## How you think\n\n${ctx.thinkingStyle}`;
}

function buildCommunicationTone(ctx: PromptContext): string {
  return `## How you communicate\n\n${ctx.communicationTone}`;
}

function buildDirectives(ctx: PromptContext): string {
  const items = ctx.directives.map((d) => `- ${d}`).join('\n');
  return `## Your directives\n\n${items}`;
}

function buildAvoidances(ctx: PromptContext): string {
  const items = ctx.avoidances.map((a) => `- ${a}`).join('\n');
  return `## What you avoid\n\n${items}`;
}

function buildTeamRole(ctx: PromptContext): string {
  return `## Your team context\n\n${ctx.teamContext}\n\n**Your role in this team**: ${ctx.teamRole}`;
}

function buildClosingAnchor(ctx: PromptContext): string {
  return `Stay fully in character as ${ctx.name} at all times.`;
}
