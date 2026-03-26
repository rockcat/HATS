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

Install the `piper-tts` Python package:

```bash
pip install piper-tts
```

Download one or more voice models (`.onnx` + `.onnx.json`) from the [Piper voices page](https://rhasspy.github.io/piper-samples/) and place them in a directory (e.g. `piper_voices/`).

#### Server mode (recommended)

At startup the app spawns one `piper.http_server` Flask instance per voice on consecutive ports, keeping each model loaded in memory. Each agent can be assigned its own voice from a dropdown in the UI; the selection persists per-agent in the browser. If a previously selected voice is no longer present at startup the agent falls back to the first available voice.

```env
PIPER_VOICES_DIR=piper_voices        # directory containing .onnx files
PIPER_SERVER_PORT_START=5100         # first port; each voice gets the next port
PYTHON_BIN=python                    # python executable (default: "python")
```

`PIPER_VOICES_DIR` defaults to the directory of `PIPER_MODEL` if not set.

#### Subprocess mode (fallback)

If `PIPER_VOICES_DIR` is not set, a single voice can be used via subprocess. The model is loaded from disk on every sentence, which adds ~0.5 s latency per sentence.

```env
PIPER_BIN=piper/piper.exe            # native piper CLI binary
PIPER_MODEL=piper/voices/en_GB-cori-high.onnx
```

The companion `.onnx.json` file must sit next to the `.onnx` file (used to read the model's sample rate).

If neither `PIPER_VOICES_DIR` nor `PIPER_MODEL` is set, avatar speech is silently disabled and agents respond text-only.

### Rhubarb Lip Sync (optional — required for avatar lip sync)

[Rhubarb Lip Sync](https://github.com/DanielSWolf/rhubarb-lip-sync) extracts mouth-shape timing from audio to drive avatar visemes. Required alongside Piper TTS if you want lip-synced avatars.

1. Download a Rhubarb release for your platform from the [Rhubarb releases page](https://github.com/DanielSWolf/rhubarb-lip-sync/releases).
2. Set `RHUBARB_BIN` in `.env` to the path of the executable (defaults to `rhubarb`):

```env
RHUBARB_BIN=rhubarb/rhubarb
```

The phonetic recognizer is used by default — no additional dependencies (PocketSphinx, etc.) are required.

## Running

If using Piper server mode, start the Piper server first, then:

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
