# Personality

AI agent team with distinct personas based on De Bono's Six Thinking Hats. Agents collaborate in meetings, maintain a kanban board, and can be viewed through a web UI with 3D avatar support.

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

[Piper](https://github.com/rhasspy/piper) is a fast, local text-to-speech engine. Required only if you want avatars to speak aloud.

1. Download a Piper release for your platform from the [Piper releases page](https://github.com/rhasspy/piper/releases).
2. Extract and place the `piper` executable somewhere on your PATH, or set `PIPER_BIN` in `.env`.
3. Download a voice model (`.onnx` + `.onnx.json`) from the [Piper voices page](https://rhasspy.github.io/piper-samples/).
4. Set `PIPER_MODEL` in `.env` to the path of the `.onnx` file:

```env
PIPER_BIN=piper
PIPER_MODEL=/path/to/voice/en_US-lessac-medium.onnx
```

If `PIPER_MODEL` is not set, avatar speech is silently disabled and agents respond text-only.

### Rhubarb Lip Sync (optional — required for avatar lip sync)

[Rhubarb Lip Sync](https://github.com/DanielSWolf/rhubarb-lip-sync) extracts mouth-shape timing from audio to drive avatar visemes. Required alongside Piper TTS if you want lip-synced avatars.

1. Download a Rhubarb release for your platform from the [Rhubarb releases page](https://github.com/DanielSWolf/rhubarb-lip-sync/releases).
2. Extract and place the `rhubarb` executable somewhere on your PATH, or set `RHUBARB_BIN` in `.env`:

```env
RHUBARB_BIN=rhubarb
```

The phonetic recognizer is used by default — no additional dependencies (PocketSphinx, etc.) are required.

## Running

```bash
npm start
```

The web UI is available at `http://localhost:3000`.

## Project Structure

```
src/
  agent/          Agent execution loop
  api/            HTTP + WebSocket server
  human/          CLI interface
  mcp/            MCP tool servers (kanban, etc.)
  orchestrator/   Meeting orchestration and scheduling
  providers/      LLM provider adapters (Anthropic, OpenAI, Gemini)
  speech/         TTS + lip-sync pipeline (Piper + Rhubarb)
  tools/          Tool definitions available to agents
  webui/          Web UI (HTML/CSS/JS + Three.js avatar renderer)
projects/         Per-project data (kanban, meetings, agent state)
```
