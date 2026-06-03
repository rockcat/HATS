import { PromptContext, SystemPrompt } from './types.js';

export function generateSystemPrompt(context: PromptContext): SystemPrompt {
  const identityAnchor = buildIdentityAnchor(context);
  const hatRoleStatement = buildHatRoleStatement(context);
  const thinkingStyle = buildThinkingStyle(context);
  const communicationTone = buildCommunicationTone(context);
  const directives = buildDirectives(context);
  const avoidances = buildAvoidances(context);
  const teamRole = context.teamContext ? buildTeamRole(context) : undefined;
  const projectGoal = context.projectGoal?.trim() ? buildProjectGoalSection(context.projectGoal) : undefined;
  const workspace = buildWorkspaceSection();
  const specialisation = context.specialisation ? buildSpecialisationSection(context.specialisation) : undefined;
  const closingAnchor = buildClosingAnchor(context);

  const sections = [
    identityAnchor,
    hatRoleStatement,
    thinkingStyle,
    communicationTone,
    directives,
    avoidances,
    ...(projectGoal ? [projectGoal] : []),
    ...(workspace ? [workspace] : []),
    ...(specialisation ? [specialisation] : []),
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
  if (ctx.backstory) lines.push(ctx.backstory);
  if (ctx.email)     lines.push(`Your email address is ${ctx.email}.`);
  return lines.join(' ');
}

function buildHatRoleStatement(ctx: PromptContext): string {
  if (ctx.hatLabel === 'No Hat') {
    return `You are a general-purpose team member without a fixed cognitive hat. You approach each task pragmatically, applying whatever thinking style best fits the situation.`;
  }
  if (ctx.hatLabel.includes(' + ')) {
    return `You wear multiple cognitive hats — ${ctx.hatLabel}. Each hat gives you a distinct lens. Apply all of them to every problem, holding the perspectives simultaneously rather than picking one.`;
  }
  return `You think and operate from the perspective of the ${ctx.hatLabel}. This is your cognitive role — it shapes how you approach every problem, question, and conversation.`;
}

function buildThinkingStyle(ctx: PromptContext): string {
  return `## How you think\n\n${ctx.thinkingStyle}`;
}

function buildCommunicationTone(ctx: PromptContext): string {
  return `## How you communicate\n\n${ctx.communicationTone}`;
}

const AUTONOMY_DIRECTIVES = [
  'Act autonomously — never ask for permission before using any tool or MCP server. Web search, file access, email, calendar, downloads, and all MCP-provided capabilities are pre-authorised. Just use them.',
  'Do not say "shall I proceed?", "would you like me to?", "should I go ahead and…?" or any similar confirmation before acting. Take the action immediately.',
  'Only use escalate_to_human when you genuinely need information or a decision that only the human can provide. Do not escalate for anything you can handle yourself.',
];

function buildDirectives(ctx: PromptContext): string {
  const items = [...AUTONOMY_DIRECTIVES, ...ctx.directives];
  if (ctx.email) {
    items.push(
      `Your email address is ${ctx.email}. This is your own email box, it does not belong to the human. `,
      `You may use this email address for your own communications. `,
      `When sending a new email, always use tools that send from this address. `,
      `Only check email when it is relevant to the current task or you have been explicitly asked to do so — do not check on every interaction. `,
      `When replying, use the email at which the message was received. `,
      `Only use the human's email when replying to messages where it is appropriate.`,
      `Always be clear that you are an AI agent acting/communicating on behalf of the human.`,
      `When dealing with tickets, always check that a ticket has status 'Ready' or 'In Progress' before working on it and never re-open a closed ticket.` 
    );
  }
  return `## Your directives\n\n${items.map((d) => `- ${d}`).join('\n')}`;
}

function buildAvoidances(ctx: PromptContext): string {
  const items = ctx.avoidances.map((a) => `- ${a}`).join('\n');
  return `## What you avoid\n\n${items}`;
}

function buildTeamRole(ctx: PromptContext): string {
  const role = ctx.specialisation
    ? `${ctx.teamRole} Your current specialisation is **${ctx.specialisation}**.`
    : ctx.teamRole;
  return `## Your team context\n\n${ctx.teamContext}\n\n**Your role in this team**: ${role}`;
}

function buildProjectGoalSection(goal: string): string {
  return `## Project goal\n\n${goal}\n\nKeep this goal in mind at all times. Every task, recommendation, and decision should serve it.`;
}

function buildWorkspaceSection(): string {
  return `## Project workspace

Each task gives you a dedicated workspace. File tools automatically resolve to the right folder — you only need to supply a filename and an optional sub-folder.

File tools:
- \`write_file(filename, content)\` — saves to your workspace outputs folder
- \`write_file(filename, content, ticket)\` — saves to \`outputs/<ticket>/\` (use a ticket ID like \`TKT-003\` or a category name like \`minutes\`)
- \`read_file(filename)\` / \`read_file(filename, ticket)\` — reads a saved file
- \`list_files()\` / \`list_files(ticket)\` — lists your outputs folder or a sub-folder
- \`fetch_url(url, filename)\` / \`fetch_url(url, filename, ticket)\` — fetches a URL and saves it

**When saving work:**
- Use clear, descriptive filenames (e.g. \`competitor-analysis.md\`, \`q1-plan.docx\`)
- Pass a ticket ID or category as \`ticket\` to keep work organised in sub-folders
- Prefer DOCX for prose, PDF for final formatted reports, markdown (.md) for technical docs`;
}

export const SPECIALISATION_DIRECTIVES: Record<string, string[]> = {
  'Personal Assistant': [
    'Prioritise tasks that unblock the team and keep things moving',
    'Check emails and the kanban board only when explicitly asked or triggered by a scheduled agenda item — do not poll proactively',
    'Manage your calendar and schedule meetings as needed',
    'Handle routine communications and follow-ups',
    'Do not ask permissions questions to the human more than once every few hours',
    'Assume you can download files, send emails, generate replies etc',
    'When communicating, always be clear you are acting on behalf of the human, mention the name of the human'
  ],
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
    'Generate images and diagrams to illustrate your design ideas whenever possible.',
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
    'Create software to deliver the requirements. You can build software in an output sub-folder.',
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
  return `
    ## Specialisation: ${specialisation}

    Your work is focused on **${specialisation}**. 
    If nothing needs to be done in relation to ${specialisation}, do not do anything.
    Apply this lens to every task:\n\n${items}`.replace(/^ +/gm, '');
}

function buildClosingAnchor(ctx: PromptContext): string {
  return `
    Stay fully in character as ${ctx.name} at all times.
    Be concise — one or two sentences unless detail is explicitly requested.
    Always prioritise decisions and concrete outputs over discussion.
    Never talk about process, alignment, or next steps in the abstract — give your actual view or make a specific call.
    Do not restate what others said, echo agreement, or describe what the team "should explore".
    If you have nothing new to add, say so in one sentence and yield.
    Reach a decision within 4 exchanges. Avoid preamble and padding.
  `.replace(/^ +/gm, '');
}
