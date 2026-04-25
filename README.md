# HATS — AI agents that disagree to make better decisions

Don't ask one AI, start running a team.

Run meetings, plan work, and stress-test ideas with a team of AI agents that think differently — and challenge each other on purpose.

Most AI tools give you one answer.
HATS gives you a panel of perspectives.

## What makes HATS different?

HATS is inspired by the Six Thinking Hats framework — but implemented as a real multi-agent system with structured disagreement.

Each agent has a role:

⚪ White Hat — facts, gaps, assumptions

🔴 Red Hat — human impact, intuition

⚫ Black Hat — risks, failure modes

🟡 Yellow Hat — upside, opportunity

🟢 Green Hat — creativity, alternatives

🔵 Blue Hat — facilitation, synthesis


**They don’t just respond — they debate.**

## Why this matters

LLMs tend to:

- agree with you
- sound confident even when wrong
- miss blind spots

HATS fixes that by:

- introducing structured conflict
- forcing multiple perspectives
- simulating real team dynamics

### Example use cases
- Run a product planning meeting
- Stress-test a startup idea
- Explore trade-offs in architecture decisions
-Replace async brainstorming sessions

## Watch 6 AI agents plan a startup and argue about it

(put video here — this is critical)

## Architecture highlights

- Multi-agent orchestration
- Per-agent model selection:
- OpenAI / Claude / Gemini
- Local support via Ollama / LM Studio
- Token + cost tracking per agent
- Voice + 3D avatar support

## Live Meetings with Faces and Voices

When a meeting starts, HATS opens a stage of animated 3D avatars rendered in real time using Three.js. Each agent speaks aloud via Piper TTS with
per-agent voice models. Lip sync is driven by Rhubarb, mapping phonetic audio timing to ARKit visemes so mouths move in sync with speech.

![Agent Config[]](docs/images/agent_config.png)

Five meeting types are supported — Standup, Sprint Planning, Retrospective, Review, and Ad Hoc — all schedulable in advance via a built-in calendar or
launched instantly on demand. Humans participate directly, taking turns in the conversation. The full transcript can be downloaded as Markdown when
the meeting ends.

[![Demo Video]](https://example.com/video)

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

![Dashboard[]](docs/images/dashboard.png)


HATS is built on Node.js with a TypeScript backend, Three.js avatar rendering, and a plain
HTML/CSS/JS frontend requiring no build step.


# Installation

## Setup scripts
The scripts folder contains two scripts: `setup.bat` for Windows and `setup.sh` fro linux/MacOs. These perform some of the tasks below. 

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
rhubarb/          Install rhubarb in here
piper_voices/     Install voices for piper tts in here
```

## Development

```bash
npm test          # run tests (vitest)
npm run test:watch  # watch mode
npm run build     # compile TypeScript to dist/
```

No build step is required to run the app — `npm start` uses `tsx` to run TypeScript directly.
