# HATS v0.01 — Release Notes

**July 2026** · First public release of HATS (hat-agents), a multi-agent AI platform built on Edward de Bono's Six Thinking Hats framework. Each agent wears a distinct hat and brings a specific cognitive role to the team.

---

## Multi-agent team orchestration

- **Six Thinking Hats personas** — each agent has a distinct thinking style, communication tone, and directives drawn from de Bono's framework (Blue, White, Red, Yellow, Green, Black)
- **Randomised team composition** — teams of four agents are assembled with diverse hat roles to prevent groupthink
- **Kanban board** — shared backlog with backlog, ready, in-progress, blocked, review, and closed columns; tickets auto-created on human escalation
- **Task dispatch** — agents pick up tickets and work them autonomously; blocked tickets surface to the human with full context
- **Waiting state** — idle agents disengage cleanly rather than generating unsolicited chatter
- **Persistent state** — full team and conversation state saves on shutdown and restores on next launch
- **Multi-project support** — switch between named projects; each has its own team, kanban, and workspace
- **Project goal injection** — a configurable goal statement is woven into every agent's system prompt

## AI provider support

- **Anthropic Claude** — full model range including Haiku 4.5, Sonnet, and Opus; streaming and tool use
- **OpenAI / GPT** — all chat-completion-compatible models
- **Google Gemini** — via the GenerativeAI SDK
- **Ollama & LM Studio** — local inference; live model list fetched on connect; offline detection
- **Per-agent model selection** — mix providers freely within a team
- **Tool search pattern** — agents fetch rarely-used tools on demand to keep context windows lean
- **Token logging** — every LLM call logs prompt and generated token counts (`4.1k prompt / 71 gen`)
- **Hourly cost budget** — per-agent cost cap; agent idles when the limit is reached until the next hour

## Meetings & live collaboration

- **Hand-based discussion flow** — four-phase meeting structure; agents raise hands to speak, preventing everyone talking at once
- **Human participation** — join any meeting as a participant; interject at any point and agents hear you immediately
- **Broadcast interrupts** — a human message stops all agents' current work and redirects them
- **Meeting minutes** — transcripts auto-saved to `outputs/minutes/`; viewable from the calendar tab
- **Scheduled meetings** — plan standups, retros, and reviews in advance via the calendar
- **Paced playback** — LLM turns are paced to speech synthesis so meetings feel like real conversations
- **Markdown transcripts** — meeting turns render with full markdown formatting

## Avatars & voice

- **GLB avatar support** — load any GLB or VRM 3D model as an agent's avatar, with spring physics simulation
- **Idle animations** — breathing, head sway, and eye blink idle behaviour; additional idle tracks played from GLB if present
- **Lip sync** — morph-target-based lip sync driven by speech audio; works in both the meeting stage and agent config panel
- **A-pose correction** — VRM models with A-pose arms are automatically adjusted to a natural rest position on load
- **DALL-E 3 backgrounds** — generate a unique background scene for each agent with a single click
- **Auto-assign on load** — avatars and backgrounds are assigned to agents automatically when a project opens
- **Piper TTS voices** — en_GB medium voices downloaded from HuggingFace during setup; streaming sentence-by-sentence so speech starts before the full response is ready
- **Pre-fetched synthesis** — next speaker's audio is synthesised during current playback to eliminate inter-speaker gaps

## Integrations & MCP

- **Email (IMAP/SMTP)** — agents read and send email from their own address; allowlist controls who they can contact
- **Google Calendar & Microsoft 365** — calendar awareness and event management
- **Social channels** — WhatsApp, Twitter/X, Threads, and LinkedIn MCP servers
- **Per-agent MCP selection** — choose which shared MCP servers each agent can access; personal MCP credentials per agent
- **Scheduled MCP actions** — trigger MCP tool calls on a timer, with a condition expression and message template
- **MCP catalogue** — curated server list with descriptions, source links, and credential schemas
- **Agent agenda** — recurring and one-off tasks fire automatically; prompt and MCP-tool-call types both supported
- **Email suppression mode** — development flag to intercept outbound email calls and log to console instead of sending

## Web interface & tooling

- **Kanban board** — filterable by user and tag; orange border distinguishes human-assigned tickets; review column for sign-off before close
- **Agent cards** — hat badge, live state, talking indicator, cost bar; click to open the agent config modal
- **Agent config modal** — live-updating system prompt preview with section highlighting; model, provider, specialisation, and MCP controls
- **Agent library** — reusable agent definitions shared across projects; built-in Claude Code singleton
- **Requests tab** — human escalations surface here with full context; reply inline and the agent resumes
- **Threaded conversations** — Slack-style thread viewer per agent; one thread per task, readable history preserved across restarts
- **@ mention popup** — autocomplete agent names in the CLI input and web compose box
- **Project files panel** — browse, preview, and download agent outputs directly from the UI
- **Telemetry modal** — hourly cost bar chart, token totals, and provider breakdown
- **External agents** — delegate to any HTTP endpoint or run Claude Code as a subprocess agent with session persistence
- **Node.js setup wizard** — cross-platform first-run wizard handles dependencies, env configuration, and voice downloads

---

*© 2026 Ely House 25 Ltd · Non-commercial licence*
