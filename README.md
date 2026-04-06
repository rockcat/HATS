# HATS

HATS is an AI-powered team collaboration platform that fields a crew of distinct, opinionated agents — each embodying a different thinking style — to
plan work, debate decisions, run meetings, and execute tasks alongside human team leads.

Inspired by Edward de Bono's Six Thinking Hats framework, HATS assembles teams of AI agents that genuinely disagree with each other in productive
ways, surfacing blind spots that a single AI assistant would never find.

Every HATS agent wears a hat that defines how it thinks:

- White Hat — The analyst. Evidence-first, assumption-aware, gap-finding.
- Red Hat — The empath. Surfaces emotional impact and human consequences before decisions are locked in.
- Black Hat — The critic. Stress-tests plans, quantifies risk, demands mitigation.
- Yellow Hat — The optimist. Finds upside, champions promising ideas, maintains momentum.
- Green Hat — The creative. Generates alternatives, breaks patterns, reframes constraints.
- Blue Hat — The organiser. Runs the agenda, tracks decisions, synthesises conclusions.

Agents are assigned hat types, models, voices, and 3D avatars. Any of the three leading LLM providers — Anthropic Claude, OpenAI GPT, and Google
Gemini — can power any agent, with real-time token and cost telemetry tracked per agent and per model.
The system also supports Ollama and LM Studio for local agent provision.

## Live Meetings with Faces and Voices

When a meeting starts, HATS opens a stage of animated 3D avatars rendered in real time using Three.js. Each agent speaks aloud via Piper TTS with
per-agent voice models. Lip sync is driven by Rhubarb, mapping phonetic audio timing to ARKit visemes so mouths move in sync with speech.

Five meeting types are supported — Standup, Sprint Planning, Retrospective, Review, and Ad Hoc — all schedulable in advance via a built-in calendar or
launched instantly on demand. Humans participate directly, taking turns in the conversation. The full transcript can be downloaded as Markdown when
the meeting ends.

## A Kanban Board That Works Itself

HATS includes a six-column Kanban board — Backlog, Ready, In Progress, Blocked, Review, Done — with full drag-and-drop. When a ticket moves to In
Progress, it is automatically dispatched to the assigned agent as a live task. When a blocker is resolved, dependent tickets are automatically
unblocked and advanced. Tickets assigned to the human team lead are highlighted in orange so nothing falls through the cracks.

Agents interact with the board through the Kanban MCP server, creating, moving, and commenting on tickets as part of their normal workflow.

## MCP and Tools

Through the Model Context Protocol \(MCP), HATS ships integrations across five categories:


|Category|Tools|
|-|-|
|Productivity|Kanban, Memory (knowledge graph), Slack|
|Files & Documents|Filesystem, Excel, Word, PDF, PowerPoint|
|Web|Brave Search, Puppeteer/Chrome|
|Databases|SQLite, PostgreSQL|
|Development|GitHub|

All servers are togglable from the UI and report live connection status and credential requirements.

## Project-Scoped, Multi-Team

Every HATS project is isolated — its own Kanban board, meeting calendar, agent configurations, sources/ and outputs/ file folders, telemetry log, and
state snapshot. Projects can be created, switched, and loaded without restarting. A project goal set by the team lead is automatically injected into
every agent's system prompt to keep all thinking anchored to the objective.

## The Dashboard

The HATS web UI is a four-panel dashboard:

- Agents — Live status, communication overlay, add/configure agents
- Active Board — Kanban columns with real-time updates and drag-and-drop
- Tools — MCP server controls, CLI, file upload/download, tool explorer
- Backlog & Calendar — Unstarted tickets and weekly/daily/agenda calendar views

A persistent progress bar below the header shows the project goal alongside a three-segment ticket progress indicator (Done / Active / Backlog) that
updates live as work moves through the board.


HATS is built on Node.js with a TypeScript backend, Three.js avatar rendering, and a plain
HTML/CSS/JS frontend requiring no build step.


# Installation

## Prerequisites

### Node.js

Node.js 20+ is required.

```bash
npm install
```

### API Keys

Copy `.env.example` to `.env` and fill in at least one LLM provider key:

```bash
cp .env.example .env
```

| Variable | Description |
|---|---|
| `ANTHROPIC_API_KEY` | Anthropic Claude (default provider) |
| `OPENAI_API_KEY` | OpenAI GPT models |
| `GEMINI_API_KEY` | Google Gemini models |
| `BRAVE_API_KEY` | Brave Search (optional, for web search tool) |

### Piper TTS (optional — required for avatar speech)

Piper runs in one of two modes. **Server mode** (recommended) keeps voice models loaded in memory and supports one voice per agent. **Subprocess mode** is a simpler fallback using a single voice loaded on demand.

Download one or more voice models (`.onnx` + `.onnx.json`) from the [Piper voices page](https://rhasspy.github.io/piper-samples/) and place them in `piper_voices/`.

#### Server mode (recommended)

Requires the `piper-tts` Python package. At startup the app automatically spawns one Flask server per voice model on consecutive ports — you do not need to start anything manually.

```bash
pip install piper-tts
```

```env
PIPER_VOICES_DIR=piper_voices        # directory containing .onnx files
PIPER_SERVER_PORT_START=5100         # first port; each voice gets the next port
PYTHON_BIN=python                    # python executable (default: "python")
```

Each agent can be assigned its own voice from a dropdown in the UI. If a previously selected voice is no longer present at startup the agent falls back to the first available voice.

#### Subprocess mode (fallback)

Uses the native [Piper binary](https://github.com/rhasspy/piper/releases). The model is loaded from disk on every sentence, which adds ~0.5 s latency per sentence.

1. Download the Piper release for your platform from the [Piper releases page](https://github.com/rhasspy/piper/releases).
2. Extract to `piper/` in the project root (so the binary is at `piper/piper.exe` on Windows).

```env
PIPER_BIN=piper/piper.exe            # path to native piper binary
PIPER_MODEL=piper_voices/en_GB-cori-high.onnx
```

The companion `.onnx.json` file must sit next to the `.onnx` file.

If neither `PIPER_VOICES_DIR` nor `PIPER_MODEL` is set, avatar speech is silently disabled and agents respond text-only.

### Rhubarb Lip Sync (optional — required for avatar lip sync)

[Rhubarb Lip Sync](https://github.com/DanielSWolf/rhubarb-lip-sync) extracts mouth-shape timing from audio to drive avatar visemes. Required alongside Piper TTS if you want lip-synced avatars.

1. Download a Rhubarb release for your platform from the [Rhubarb releases page](https://github.com/DanielSWolf/rhubarb-lip-sync/releases).
2. Set `RHUBARB_BIN` in `.env` to the path of the executable (defaults to `rhubarb`):

```env
RHUBARB_BIN=rhubarb/rhubarb
```

The phonetic recognizer is used by default — no additional dependencies (PocketSphinx, etc.) are required.

## Quick start

```bash
# 1. Clone and install
git clone <repo-url>
cd HATS
npm install

# 2. Configure
cp .env.example .env
# Edit .env and add at least one LLM provider API key

# 3. Run
npm start
```

The web UI is available at `http://localhost:3001`.

Alternatively, run the setup script which checks all dependencies:

```bash
# macOS / Linux / Git Bash on Windows
bash scripts/setup.sh

# Windows Command Prompt
scripts\setup.bat
```

## Project structure

```
src/
  agent/          Agent execution loop and state machine
  api/            HTTP + SSE + WebSocket server (port 3001)
  hats/           Six Thinking Hat definitions and directives
  human/          CLI interface for terminal interaction
  mcp/            MCP tool servers (kanban, filesystem, etc.)
  orchestrator/   Team coordination, meetings, task dispatch
  prompt/         System prompt generation
  providers/      LLM adapters (Anthropic, OpenAI, Gemini, Ollama, LM Studio)
  speech/         TTS + lip-sync pipeline (Piper + Rhubarb)
  store/          Event log, telemetry, and snapshot storage
  tools/          Tool schema definitions available to agents
  util/           Shared utilities (logger, etc.)
  webui/          Web UI — HTML/CSS/JS + Three.js avatar renderer
avatars/          GLB avatar models and avatars.json catalogue
projects/         Per-project runtime data (kanban, meetings, agent state)
scripts/          Setup scripts (setup.sh, setup.bat)
tools/            Developer utilities (glb-viewer.mjs)
```

## Development

```bash
npm test          # run tests (vitest)
npm run test:watch  # watch mode
npm run build     # compile TypeScript to dist/
```

No build step is required to run the app — `npm start` uses `tsx` to run TypeScript directly.
