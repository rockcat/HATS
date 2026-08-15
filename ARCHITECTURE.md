# HATS — System Architecture

## Process map

HATS runs as a **single Node.js process** launched by `team-runner.ts`. Everything lives in that process except for MCP servers, which are spawned as child processes or connected via HTTP.

```
┌─────────────────────────────── Node.js process (team-runner.ts) ───────────────────────┐
│                                                                                        │
│   ┌─────────────────────────────────────────────────────────┐                          │
│   │                                                         │                          │
│   │                   TeamOrchestrator                      │                          │
│   │                                                         │                          │
│   │  agents[]   tasks[]   meetings[]   scheduledMeetings[]  │                          │
│   │                                                         │                          │
│   │   AgendaRunner          MeetingRoom(s)                  │                          │
│   │   (interval timers)     (active meeting state)          │                          │
│   │                                                         │                          │
│   └───────────┬─────────────────────────┬───────────────────┘                          │
│               │                         │                                              │
│        sends messages            dispatches tasks                                      │
│               │                         │                                              │
│   ┌───────────▼───────────┐   ┌─────────▼──────────-─┐                                 │
│   │    Agent (local LLM)  │   │  ExternalAgent       │                                 │
│   │                       │   │  (HTTP or subprocess)│                                 │
│   │  - Hat persona        │   │  - Claude Code       │                                 │
│   │  - conversation hist. │   │  - Remote HTTP svc.  │                                 │
│   │  - per-agent MCP      │   └──────────────────────┘                                 │
│   └───────────────────────┘                                                            │
│                                                                                        │
│   ┌──────────────────────────────────────────────────────────────────────────────┐     │
│   │                              APIServer (port 3001)                           │     │
│   │                                                                              │     │
│   │   HTTP REST /api/*    SSE /events    WebSocket /ws    Static /               │     │
│   │                                                                              │     │
│   │   KanbanManager   MeetingRouter   SpeechRouter   ProjectManager              │     │
│   │   AgentRouter     MCPCatalogueRouter   EmailAllowlistRouter                  │     │
│   │   GoogleOAuthRouter                                                          │     │
│   └──────────────────────────────────────────────────────────────────────────────┘     │
│                                                                                        │
│   ┌───────────────────┐     ┌──────────────────────┐                                   │
│   │  CLIInterface     │     │  VoiceManager        │                                   │
│   │  (stdin/stdout)   │     │  (Piper TTS voices)  │                                   │
│   └───────────────────┘     └──────────────────────┘                                   │
│                                                                                        │
└────────────────────────────────────────────────────────────────────────────────────────┘
```

---

## Component responsibilities

| Component | File | Role |
|---|---|---|
| `TeamOrchestrator` | `src/orchestrator/orchestrator.ts` | Central coordinator — owns agents, tasks, meetings, event bus |
| `Agent` | `src/agent/agent.ts` | Local LLM agent with hat persona, conversation history, MCP tool access |
| `ExternalAgent` | `src/agent/external-agent.ts` | Delegates to an HTTP endpoint or Claude Code subprocess |
| `AgendaRunner` | `src/orchestrator/agenda-runner.ts` | Fires scheduled tasks/MCP-tool-calls on interval timers |
| `MeetingRoom` | `src/orchestrator/meeting-room.ts` | Manages a single live meeting: hand queue, turn pacing, minutes |
| `APIServer` | `src/api/api-server.ts` | HTTP/WS/SSE server — serves the web UI and all REST endpoints |
| `MCPRegistry` | `src/mcp/mcp-registry.ts` | Manages a set of connected MCP servers; namespaces their tools |
| `CLIInterface` | `src/human/cli-interface.ts` | Terminal input loop for the human operator |
| `VoiceManager` | `src/speech/voice-manager.ts` | Discovers Piper voice files; synthesises speech on demand |
| `KanbanManager` | `src/api/kanban-manager.ts` | Reads/writes `kanban-board.json`; dispatches tickets to agents; watches for file changes |
| `EventStore` | `src/store/event-store.ts` | Append-only JSONL log of all orchestrator events |

---

## Data flow: human message → agent response

```
Human types in browser or CLI
        │
        ▼
APIServer  POST /api/cli  (or direct CLI input)
        │
        ▼
TeamOrchestrator.humanMessage(agentName, text)
        │
        ├── logs to EventStore (team-events.jsonl)
        │
        ▼
Agent.receiveMessage(msg)
        │
        ├── builds system prompt (hat persona + project goal + MCP tool list)
        ├── appends to conversation history
        │
        ▼
AIProvider.complete(request)        ←── external HTTP call to LLM API
        │
        ▼
Response text / tool calls
        │
        ├── if tool call → ToolExecutor dispatches to MCPRegistry
        │       │
        │       └── MCP server (stdio child process or HTTP) → tool result
        │               │
        │               └── result fed back into conversation; LLM loops
        │
        ├── if escalation tool → HumanRequestStore + SSE to browser
        │
        └── final text → EventStore + SSE broadcast → browser thread viewer
```

---

## Real-time connections (browser ↔ server)

| Channel | Path | Direction | Purpose |
|---|---|---|---|
| SSE | `GET /events` | server → browser | Agent activity, kanban changes, meeting state, speech events |
| WebSocket | `ws://…/ws` | bidirectional | Full event stream + speech audio chunks |
| REST | `/api/*` | browser → server | Commands (send message, create ticket, configure agent, etc.) |
| Static | `/` | server → browser | Web UI HTML/JS/CSS files |
| Avatars | `/avatars/` | server → browser | GLB/VRM 3D model files and background images |

The browser never writes directly to any file. All mutations go through the REST API.

---

## Storage: all flat files, no database

```
projects/
  last-project.json           ← which project was open last
  agents.json                 ← global agent library (shared across projects)
  scheduled-actions.json      ← system-level scheduled actions

  <project-id>/
    team-state.json           ← full agent snapshots (restored on restart)
    team-events.jsonl         ← append-only event log
    kanban-board.json         ← ticket board
    meetings.json             ← scheduled meetings
    agent-agenda.json         ← per-agent recurring tasks
    human-requests.json       ← pending human escalations
    email-allowlist.json      ← approved/blocked email contacts
    mcp-enabled.json          ← which MCP servers are active
    telemetry.jsonl           ← per-call token and cost log
    project.json              ← project goal, human name, etc.

    outputs/                  ← agent file outputs
      minutes/                ← meeting transcripts
      <ticket-id>/            ← files produced per ticket

data/
  google-tokens.json          ← OAuth access + refresh tokens

avatars/
  *.glb / *.vrm               ← 3D avatar models
  backgrounds/                ← DALL-E generated background images

config/
  mcp-catalogue.json          ← available MCP servers and their connection specs

.env                          ← API keys and provider configuration
```

No SQL, no Redis, no object storage. A project directory is self-contained and portable — copy it to move a project.

---

## MCP servers: how tools reach agents

Agents do not call external APIs directly. All tool access goes through MCP servers, which the orchestrator connects to at startup or when enabled by the human operator.

```
Agent calls tool  →  MCPRegistry  →  MCP client (SDK)  →  MCP server process/HTTP
                                                                    │
                                    ┌───────────────────────────────┘
                                    │
                     ┌──────────────▼──────────────────────────────────────┐
                     │  Shared MCP servers (all agents)                    │
                     │                                                     │
                     │  kanban (stdio, internal)  — ticket CRUD            │
                     │  filesystem (stdio, npx)   — project file R/W       │
                     │  email (stdio or HTTP)      — IMAP/SMTP             │
                     │  google-gmail (HTTP + OAuth) — Gmail                │
                     │  google-calendar (HTTP + OAuth) — Calendar          │
                     │  microsoft-365 (HTTP)       — Outlook + Calendar    │
                     │  whatsapp (HTTP)            — WhatsApp Business     │
                     │  twitter-x (HTTP)           — Twitter/X             │
                     │  linkedin (HTTP)            — LinkedIn              │
                     │  brave-search (HTTP)        — web search            │
                     │  excel, docx, … (stdio)     — file format tools     │
                     └─────────────────────────────────────────────────────┘

                     ┌─────────────────────────────────────────────────────┐
                     │  Personal MCP servers (per-agent)                   │
                     │                                                     │
                     │  Each agent can have its own credentials and its    │
                     │  own subset of MCP servers (e.g. its own email      │
                     │  account). Stored in the agent's config snapshot.   │
                     └─────────────────────────────────────────────────────┘
```

MCP transport types supported:
- **stdio** — child process, message via stdin/stdout (kanban, filesystem, email)
- **HTTP (Streamable)** — direct HTTP calls with auth headers (Google, Microsoft, social)
- **SSE** — event-stream based (legacy, still supported)

The kanban MCP is always started automatically. All others are opt-in via the web UI catalogue.

---

## AI provider connections

All LLM calls are outbound HTTPS from the Node.js process:

```
TeamOrchestrator
    │
    └── Agent
            │
            ├── AnthropicProvider  → api.anthropic.com
            ├── OpenAIProvider     → api.openai.com
            ├── GeminiProvider     → generativelanguage.googleapis.com
            ├── OllamaProvider     → localhost:11434  (local, no key needed)
            └── LMStudioProvider   → localhost:1234   (local, no key needed)
```

Provider is selected per-agent and stored in `team-state.json`. Agents on the same team can use different providers.

---

## Avatar and voice pipeline

Avatars and voice run entirely client-side (3D rendering) or server-side (TTS synthesis):

```
Browser
  Three.js / WebGL
    └── GLB or VRM model (fetched from /avatars/)
          ├── Idle animator (breathing, head sway, blink)
          ├── Lip sync (morph targets driven by phoneme timeline)
          └── DALL-E background (fetched from /backgrounds/)

Server (VoiceManager)
  Piper TTS binary (local)
    └── synthesises speech sentence-by-sentence
          └── audio chunks streamed over WebSocket to browser
```

TTS is optional: if no Piper voices are installed the system runs silently.

---

## Meeting flow

```
Human or scheduler triggers meeting
        │
        ▼
TeamOrchestrator.startMeeting(facilitator, participants, topic)
        │
        ▼
MeetingRoom
  Phase 1 — Opening (facilitator sets agenda)
  Phase 2 — Discussion (agents raise hand to speak; ordered queue)
  Phase 3 — Synthesis (facilitator summarises)
  Phase 4 — Action items
        │
        ├── Each turn: agent LLM call → text → EventStore + SSE
        ├── Human turn: SSE signals browser → human types reply → resolves promise
        ├── TTS: each turn text → VoiceManager → audio → WebSocket → browser
        └── Minutes auto-saved to outputs/minutes/<id>.md on close
```

Meetings can be scheduled in advance via `meetings.json`; the API server polls every 60 s and launches any due meetings.

---

## Minimum deployable system

The smallest working HATS instance requires only:

| Requirement | Notes |
|---|---|
| Node.js 20+ | No Docker, no separate database process |
| `.env` with one LLM API key | `ANTHROPIC_API_KEY`, `OPENAI_API_KEY`, `GEMINI_API_KEY`, or point to a local Ollama/LM Studio |
| `config/mcp-catalogue.json` | Already in the repo |

Run with:
```bash
node --env-file=.env --import tsx/esm team-runner.ts
```

Then open `http://localhost:3001` in a browser.

**What you get in the minimum deployment:**
- 4-agent team (1 Blue Hat + 3 random hats)
- Kanban board (kanban MCP starts automatically as a child process)
- REST API + Web UI + SSE + WebSocket
- Full state persistence across restarts
- CLI interface in the same terminal

**What is optional and can be added later:**
- External MCP servers (email, calendar, social — requires credentials in `.env`)
- Piper TTS + avatars (requires voice model download and GLB/VRM files)
- External agents / Claude Code integration (requires `ANTHROPIC_API_KEY` and a CLAUDE.md in the project dir)
- Google OAuth (requires `GOOGLE_CLIENT_ID` + `GOOGLE_CLIENT_SECRET` in `.env`)
- DALL-E backgrounds (requires `OPENAI_API_KEY`)

Everything optional degrades gracefully — the system runs without it and the web UI hides unavailable features.

---

## Running the system

### Basic start

```bash
node --env-file=.env --import tsx/esm team-runner.ts
```

Or via npm:

```bash
npm start
```

The server starts on port 3001. Open `http://localhost:3001` in a browser. The terminal becomes the CLI interface.

---

### Selecting a project

Project selection is resolved in this priority order (first match wins):

1. **Positional argument** — explicit, always wins:

   ```bash
   node --env-file=.env --import tsx/esm team-runner.ts my-project
   ```

2. **npm `--project` flag** — useful with `npm start`:

   ```bash
   npm start --project=my-project
   ```

3. **`TEAM_PROJECT` env var** — honoured only if the value is not `"default"` (to avoid overriding the last-opened project):

   ```bash
   TEAM_PROJECT=my-project node --env-file=.env --import tsx/esm team-runner.ts
   ```

4. **`projects/last-project.json`** — automatically written on every start; reopens whichever project was open last with no arguments needed.

5. **Fallback** — `"default"`, creating `projects/default/` on first run.

Projects can also be switched at runtime via the web UI without restarting.

---

### Environment variables

All variables are read from `.env` (passed via `--env-file=.env`). Copy `.env.example` as a starting point.

#### LLM providers — at least one key required

| Variable | Default | Notes |
|---|---|---|
| `ANTHROPIC_API_KEY` | — | Required for Anthropic Claude agents |
| `ANTHROPIC_MODEL` | `claude-haiku-4-5-20251001` | Default model for new agents on the Anthropic provider |
| `OPENAI_API_KEY` | — | Required for OpenAI agents and DALL-E background generation |
| `OPENAI_MODEL` | `gpt-4.1-mini` | Default model for new agents on the OpenAI provider |
| `GEMINI_API_KEY` | — | Required for Gemini agents |
| `GEMINI_MODEL` | `gemini-2.5-flash` | Default model for new agents on the Gemini provider |
| `OLLAMA_BASE_URL` | `http://localhost:11434/v1` | Point at any OpenAI-compatible local server |
| `OLLAMA_MODEL` | — | Model name to use with Ollama |
| `LM_STUDIO_BASE_URL` | `http://localhost:1234/v1` | LM Studio endpoint |
| `LM_STUDIO_MODEL` | — | Model name to use with LM Studio |

#### Project layout

| Variable | Default | Notes |
|---|---|---|
| `PROJECTS_ROOT` | `./projects` | Root directory for all project folders |
| `TEAM_PROJECT` | `default` | Starting project (see priority rules above) |

#### Voice / TTS

| Variable | Default | Notes |
|---|---|---|
| `PIPER_BIN` | `piper/piper.exe` | Path to the Piper TTS binary |
| `PIPER_VOICES_DIR` | `piper_voices` | Directory containing downloaded `.onnx` voice files |
| `PIPER_MODEL` | — | Single voice model name if using a Piper HTTP server instead of the binary |
| `PIPER_SERVER_URL` | — | URL of a running Piper HTTP server (alternative to the local binary) |
| `PIPER_SERVER_PORT_START` | `5100` | First port for spawned per-voice Piper HTTP server instances |
| `RHUBARB_BIN` | `rhubarb/rhubarb` | Path to the Rhubarb lip-sync binary (optional; enables phoneme-accurate sync) |

#### Integrations

| Variable | Notes |
|---|---|
| `BRAVE_API_KEY` | Enables the Brave web-search MCP tool |
| `GOOGLE_CLIENT_ID` | Required for Gmail / Google Calendar OAuth |
| `GOOGLE_CLIENT_SECRET` | Required for Gmail / Google Calendar OAuth |

---

### CLI flags

Flags are passed after the project name (or in place of it):

| Flag | Effect |
|---|---|
| `--no-email` | Intercepts all outbound email MCP tool calls and logs them to the console instead of sending. Useful during development to prevent agents accidentally sending real email. Sets `HATS_NO_EMAIL=1`. |

Example — open a specific project with email suppressed:

```bash
node --env-file=.env --import tsx/esm team-runner.ts staging --no-email
```

---

### Debug / diagnostics

Prompt logging is toggled at runtime via the web UI Settings tab, or via the REST API:

```bash
# Enable
curl -X POST http://localhost:3001/api/debug/logging \
  -H "Content-Type: application/json" \
  -d '{"enabled": true}'

# Disable
curl -X POST http://localhost:3001/api/debug/logging \
  -H "Content-Type: application/json" \
  -d '{"enabled": false}'
```

When enabled, every LLM request and response is written to `prompt-debug.log` in the project root and echoed to stdout. The log includes system prompt, full message history, token counts, and raw model output. Disable before sharing logs — they contain the full contents of agent conversations.

---

### Graceful shutdown

Press `Ctrl+C`. The process catches `SIGINT`, saves `team-state.json` for the active project, and exits cleanly. State is also auto-saved 3 seconds after any agent response, so a hard kill loses at most 3 seconds of history.

---

## LLM usage, concurrency, and spend control

### Per-agent provider and model assignment

Each agent has its own provider and model, set at registration time and stored in `team-state.json` so they survive restarts. A team can mix providers freely:

```text
Agent "Amara"  (Blue Hat)   →  AnthropicProvider  claude-haiku-4-5-20251001
Agent "Finn"   (Green Hat)  →  OpenAIProvider     gpt-4.1-mini
Agent "Yuki"   (White Hat)  →  GeminiProvider     gemini-2.5-flash
Agent "Mara"   (Black Hat)  →  OllamaProvider     llama3.2  (local, free)
```

The default model for new agents is controlled by `ANTHROPIC_MODEL` (or the equivalent env var for other providers). Per-agent model changes made in the web UI are written back to `team-state.json` immediately and take effect on the next message.

---

### Concurrency and rate-limit control

All LLM calls across the entire team share a single **semaphore** in the orchestrator. This prevents API bursts when multiple agents respond at the same time.

| Parameter | Default | How to change |
|---|---|---|
| Max simultaneous LLM calls | 2 | `OrchestratorConfig.llmConcurrency` (code-level; not yet exposed as env var) |
| Minimum gap between call starts | 3 000 ms | `OrchestratorConfig.llmCallIntervalMs` (code-level) |

Agents queue behind the semaphore transparently — a third agent wanting to call the LLM while two are already in-flight will wait until one finishes and the 3-second interval has elapsed.

The Brave web search MCP has its own independent throttle: one request per second, enforced by a queued delay chain in `tool-executor.ts`.

---

### Hourly spend budget

Each agent can have a `maxCostPerHour` limit (USD). When the agent's spend in the current one-hour window hits the limit it stops processing messages and logs a warning:

```text
[Finn] hourly cost budget exceeded ($0.0842) — idling for 47 min
```

The agent automatically resumes when the hour window resets. Messages that arrived while it was idle are not dropped — they remain in the inbox and are processed on resume. The budget is set per-agent in the web UI agent config panel or directly in `team-state.json`.

Local providers (Ollama, LM Studio) always report zero cost and are never subject to the hourly limit.

---

### Telemetry and cost tracking

Every LLM call is recorded to `projects/<id>/telemetry.jsonl`:

```json
{ "id": "tel-42", "ts": "2026-08-13T10:04:22.000Z", "agent": "Finn",
  "provider": "openai", "model": "gpt-4.1-mini",
  "promptLength": 18432, "inputTokens": 4823, "outputTokens": 312, "cost": 0.000245 }
```

The web UI Telemetry modal shows:

- **Hourly cost bar chart** — spend per hour, coloured by agent
- **Total tokens** — input and output, lifetime totals
- **Cost by agent** and **cost by model** breakdowns
- **Per-agent cost bar** on each agent card (current hour vs budget)

Cost figures use `data/model-pricing.json` when present, falling back to hardcoded rates in `src/providers/pricing.ts`. The file can be updated without restarting — call `reloadPricingFromFile()` or restart the server.

**Unknown models** — if a model has no pricing entry, HATS uses a conservative fallback rate ($1.00 input / $3.00 output per million tokens) so telemetry still accumulates rather than silently showing $0.

---

### Context window management

Each agent maintains per-thread conversation history. To keep prompt sizes under control, history is trimmed on every call:

| Setting | Behaviour |
|---|---|
| `maxContextTokens` set | Oldest messages are dropped (keeping at least 2) until the estimated character count fits within `maxContextTokens × 4 chars` |
| `maxContextTokens` not set | History is hard-capped at the last 20 messages |

The limit is set per-agent in the web UI. If not set, the model's known context window from `pricing.ts` is shown as a reference but not automatically enforced — the agent just stops getting older history after 20 turns.

Tool call / tool result pairs are always kept together and sanitised before submission so the LLM never receives an orphaned tool result without its originating call.

---

## Conversation history and threads

### Thread model

Each agent maintains multiple named conversation threads simultaneously. A thread is simply a keyed list of messages (`AgentMessage[]`) stored inside the agent:

```text
agent.threads  Map<threadKey, AgentMessage[]>

  "general"            ← direct human ↔ agent chat
  "a1b2c3d4-…"         ← task thread (key = task UUID)
  "a1b2c3d4-…"         ← another task, running in parallel
```

The **active thread** at any moment is determined by what the agent is currently doing:

- If the agent has an active task, its thread key is the task's UUID.
- If no task is active (idle, waiting, general chat), the key is `"general"`.

Each LLM call reads history from the active thread and writes the response back into it. Tasks running in parallel do not share history — each sees only the messages from its own thread.

---

### Thread lifecycle

```text
Human sends direct message
  → key = "general"

Human (or Blue Hat) assigns a task
  → new task UUID generated
  → agent.activeTaskId = UUID
  → new thread created at that key

  optionally: sourceThreadId supplied
    → the N most recent messages from that source thread
      are copied into the new task thread as context seed

Task completes
  → agent.activeTaskId cleared
  → key falls back to "general"
  → task thread is retained in memory and survives snapshots
```

When the human sends a message from the web UI thread viewer while a specific thread is open, `threadId` is set on the message so it lands in that thread rather than `"general"`.

---

### Seeding task threads from existing threads

When a task is dispatched from a kanban ticket, the thread that originated the ticket is passed as `sourceThreadId`. The agent copies context from that thread into the new task thread before starting work:

```text
Human chats with Finn about a problem  →  messages land in "general"
Finn creates a ticket via the kanban MCP
  └── ticket.threadId = "general"   (auto-injected by tool-executor)

Later: ticket dispatched to agent Morgan
  sourceThreadId = "general"  (from Finn's conversation)
  sourceThreadLimit = 6       (last 6 messages only, to keep context lean)

Morgan's task thread starts pre-populated with the 6 most recent
messages from the original discussion, giving her the context she
needs without copying the entire chat history.
```

If the ticket was previously worked on (`lastTaskId` set), dispatch uses that prior task thread as the seed instead, with no message limit — giving the agent full continuity from the last work session.

---

### Persistence

Threads are saved as part of the team state snapshot on shutdown (and auto-saved every 3 seconds after any agent response):

```json
{
  "version": 2,
  "agentThreads": {
    "<agentId>": {
      "general":      [ { "role": "user", "content": "…", "timestamp": "…" }, … ],
      "<taskUUID>":   [ … ],
      "<taskUUID2>":  [ … ]
    }
  }
}
```

On restart, all threads are restored into the agent exactly as they were. The snapshot format is versioned (`version: 2`); older v1 snapshots carried only a single `history` array and are migrated automatically on load.

---

### Thread viewer in the web UI

The web UI shows a Slack-style thread viewer for each agent. The panel has two columns:

- **Left** — thread list: one row per thread, labelled by content rather than raw UUID:
  - `general` — the standing chat
  - `TKT-007: Redesign onboarding flow` — task threads derived from ticket titles
  - Other tasks show the first line of the task description (truncated to 45 chars)
- **Right** — the selected thread's message history, rendered with markdown

Multi-hat responses (where an agent's internal hats debate before synthesising) are collapsed by default — only the **Synthesis** paragraph is shown. The full hat-by-hat reasoning is available under an expandable "Thinking…" disclosure, so the thread stays readable while the reasoning remains accessible.

The thread list endpoint (`GET /api/agents/{name}/threads`) returns message counts and human-readable labels. The history endpoint (`GET /api/agents/{name}/history?thread={key}`) returns the messages for a specific thread.

---

### Thread routing rules (precedence)

When an incoming message arrives at an agent, the thread it lands in is determined in this order:

| Priority | Condition | Target thread |
| --- | --- | --- |
| 1 | Message has explicit `threadId` | That thread key |
| 2 | Message is `direct` or `human_reply` from `human` | `"general"` |
| 3 | Message is a `task` | New thread at task UUID (with optional seed copy) |
| 4 | Anything else | Agent's current `activeTaskId`, or `"general"` if none |
