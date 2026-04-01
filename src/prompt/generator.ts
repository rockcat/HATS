import { PromptContext, SystemPrompt } from './types.js';

export function generateSystemPrompt(context: PromptContext): SystemPrompt {
  const identityAnchor = buildIdentityAnchor(context);
  const hatRoleStatement = buildHatRoleStatement(context);
  const thinkingStyle = buildThinkingStyle(context);
  const communicationTone = buildCommunicationTone(context);
  const directives = buildDirectives(context);
  const avoidances = buildAvoidances(context);
  const teamRole = context.teamContext ? buildTeamRole(context) : undefined;
  const workspace = context.projectDir ? buildWorkspaceSection(context) : undefined;
  const specialisation = context.specialisation ? buildSpecialisationSection(context.specialisation) : undefined;
  const closingAnchor = buildClosingAnchor(context);

  const sections = [
    identityAnchor,
    hatRoleStatement,
    thinkingStyle,
    communicationTone,
    directives,
    avoidances,
    ...(teamRole ? [teamRole] : []),
    ...(workspace ? [workspace] : []),
    ...(specialisation ? [specialisation] : []),
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

function buildWorkspaceSection(ctx: PromptContext): string {
  const dir = ctx.projectDir!;
  return `## Project workspace

Your project folder is: \`${dir}\`

Two sub-folders are always available:
- \`${dir}/sources/\` — materials provided by the human team lead: uploaded documents, web research, reference files. Read these when starting a task.
- \`${dir}/outputs/\` — where you save final deliverables. Always save completed work here.

**When completing a task that produces a document, report, plan, or analysis:**
- Save the result to \`${dir}/outputs/\` (or a relevant sub-folder such as \`outputs/marketing/\`, \`outputs/reports/\`, \`outputs/code/\`)
- Prefer DOCX for prose documents, PDF for final formatted reports, markdown (.md) for technical docs
- Use clear, descriptive filenames (e.g. \`q1-marketing-plan.docx\`, \`competitor-analysis.md\`)
- Create sub-folders freely to keep outputs organised

Always check \`sources/\` for relevant materials before starting work.`;
}

export const SPECIALISATION_DIRECTIVES: Record<string, string[]> = {
  'Marketing': [
    'Apply brand thinking: every output should reinforce a clear, consistent identity.',
    'Frame ideas in terms of audience segments, messaging, and channels.',
    'Think in campaigns — consider awareness, consideration, and conversion stages.',
    'Evaluate ideas against market positioning and competitive differentiation.',
    'Prioritise content strategy, storytelling, and engagement metrics.',
  ],
  'Business Development': [
    'Identify partnership, licensing, and expansion opportunities in every context.',
    'Frame recommendations around deal structure, value exchange, and strategic fit.',
    'Think in terms of pipelines: prospecting, qualification, negotiation, close.',
    'Evaluate proposals against long-term growth potential, not just immediate gain.',
    'Consider ecosystem effects — how relationships compound over time.',
  ],
  'Sales': [
    'Focus on customer acquisition, conversion rates, and revenue targets.',
    'Frame recommendations around the buyer journey and objection handling.',
    'Think in terms of pipeline health: lead volume, win rate, deal velocity.',
    'Prioritise what moves deals forward — clarity, urgency, and value proof.',
    'Consider CRM hygiene, follow-up cadence, and forecast accuracy.',
  ],
  'Market Research': [
    'Prioritise evidence: cite sources, distinguish primary from secondary data.',
    'Identify gaps in the available information before drawing conclusions.',
    'Frame findings with confidence levels — what is known vs. inferred.',
    'Think in terms of sample quality, methodology, and bias.',
    'Summarise trends with supporting data points, not assertions alone.',
  ],
  'Customer Experience': [
    'Map every recommendation against the full customer journey.',
    'Prioritise satisfaction, retention, and NPS-driving interactions.',
    'Identify friction points and moments of delight in processes.',
    'Think about support workflows, onboarding, and escalation paths.',
    'Frame outcomes in terms of customer lifetime value and loyalty.',
  ],
  'UI Design': [
    'Apply visual hierarchy, spacing, and typography principles to every design recommendation.',
    'Prioritise usability and accessibility — designs must work for all users.',
    'Think in components and design systems, not one-off solutions.',
    'Frame feedback in terms of user flow, affordance, and clarity.',
    'Reference established design patterns and explain when to deviate.',
  ],
  'Web Development': [
    'Prioritise code quality, maintainability, and performance.',
    'Frame technical recommendations with trade-offs: build vs. buy, complexity vs. flexibility.',
    'Think in terms of web standards, browser compatibility, and security.',
    'Consider testing strategy, CI/CD, and deployment implications.',
    'Flag technical debt and propose incremental improvements.',
  ],
  'Team Leadership': [
    'Focus on team alignment, motivation, and psychological safety.',
    'Frame recommendations in terms of goal clarity, accountability, and feedback loops.',
    'Think about delegation, role clarity, and individual growth paths.',
    'Identify communication breakdowns and propose structural fixes.',
    'Prioritise decisions that build long-term team capability over short-term output.',
  ],
  'Finance': [
    'Anchor every recommendation in numbers: costs, ROI, margins, and cash flow.',
    'Identify financial risks and quantify their potential impact.',
    'Think in terms of budgets, forecasts, and variance analysis.',
    'Frame trade-offs using financial models or back-of-envelope calculations.',
    'Prioritise decisions that improve financial sustainability and predictability.',
  ],
};

function buildSpecialisationSection(specialisation: string): string {
  const directives = SPECIALISATION_DIRECTIVES[specialisation];
  if (!directives) return '';
  const items = directives.map((d) => `- ${d}`).join('\n');
  return `## Specialisation: ${specialisation}\n\nYour work is focused on **${specialisation}**. Apply this lens to every task:\n\n${items}`;
}

function buildClosingAnchor(ctx: PromptContext): string {
  return `
    Stay fully in character as ${ctx.name} at all times.
    Be concise — 2–4 sentences unless detail is explicitly requested.
    Always prioritise decisions and concrete outputs over discussion.
    Never talk about process, alignment, or next steps in the abstract — give your actual view or make a specific call.
    Do not restate what others said, echo agreement, or describe what the team "should explore".
    If you have nothing new to add, say so in one sentence and yield.
    Reach a decision within 4 exchanges. Avoid preamble and padding.
  `;
}
