#!/usr/bin/env bash
# HATS setup script — run once on a new machine.
# Works in Git Bash on Windows.

set -euo pipefail

RED='\033[0;31m'; YELLOW='\033[1;33m'; GREEN='\033[0;32m'; NC='\033[0m'

ok()   { echo -e "  ${GREEN}✔${NC} $*"; }
warn() { echo -e "  ${YELLOW}!${NC} $*"; }
fail() { echo -e "  ${RED}✘${NC} $*"; }

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"
cd "$ROOT"

echo ""
echo "=== HATS setup ==="
echo ""

# ── Node.js ──────────────────────────────────────────────────────────────────
echo "── Node.js"
if ! command -v node &>/dev/null; then
  fail "node not found. Install Node.js 20+ from https://nodejs.org"
  exit 1
fi

NODE_MAJOR=$(node -e "process.stdout.write(String(process.versions.node.split('.')[0]))")
if (( NODE_MAJOR < 20 )); then
  fail "Node.js ${NODE_MAJOR} found — need 20+. Update at https://nodejs.org"
  exit 1
fi
ok "Node.js $(node --version)"

# ── npm install ───────────────────────────────────────────────────────────────
echo ""
echo "── npm install"
npm install
ok "dependencies installed"

# ── .env ─────────────────────────────────────────────────────────────────────
echo ""
echo "── .env"
if [[ ! -f "$ROOT/.env" ]]; then
  cp "$ROOT/.env.example" "$ROOT/.env"
  warn ".env created from .env.example — fill in your API keys"
else
  ok ".env already exists"
fi

# Warn about unfilled placeholder keys
UNFILLED=$(grep -E '=your_.*_here' "$ROOT/.env" | cut -d= -f1 || true)
if [[ -n "$UNFILLED" ]]; then
  warn "These keys still have placeholder values in .env:"
  while IFS= read -r key; do
    warn "  $key"
  done <<< "$UNFILLED"
fi

# ── Piper TTS ────────────────────────────────────────────────────────────────
echo ""
echo "── Piper TTS (optional — required for avatar speech)"

# Check for native binary (subprocess / default mode)
PIPER_BIN_PATH="${PIPER_BIN:-piper/piper}"
if [[ -f "$ROOT/$PIPER_BIN_PATH" ]] || [[ -f "$ROOT/${PIPER_BIN_PATH}.exe" ]]; then
  ok "piper binary found at $PIPER_BIN_PATH"
else
  warn "piper binary not found at $ROOT/$PIPER_BIN_PATH"
  warn "  Download from https://github.com/rhasspy/piper/releases"
  warn "  and extract to $ROOT/piper/"

  # Also check for Python server mode as an alternative
  PYTHON_BIN="${PYTHON_BIN:-python}"
  if command -v "$PYTHON_BIN" &>/dev/null; then
    if "$PYTHON_BIN" -c "import piper" &>/dev/null 2>&1; then
      ok "piper-tts Python package found (server mode available)"
    else
      warn "piper-tts Python package not installed either"
      warn "  For server mode run: pip install piper-tts"
    fi
  else
    warn "  (Python not found — server mode also unavailable)"
  fi
fi

# ── Piper voices ──────────────────────────────────────────────────────────────
VOICES_DIR="${PIPER_VOICES_DIR:-$ROOT/piper_voices}"
if [[ -d "$VOICES_DIR" ]]; then
  VOICE_COUNT=$(find "$VOICES_DIR" -name "*.onnx" | wc -l)
  if (( VOICE_COUNT > 0 )); then
    ok "$VOICE_COUNT voice model(s) found in $VOICES_DIR"
  else
    warn "No .onnx voice models found in $VOICES_DIR"
    warn "  Download voices from https://rhasspy.github.io/piper-samples/"
  fi
else
  warn "Piper voices directory not found: $VOICES_DIR"
  warn "  Create it and download .onnx voices from https://rhasspy.github.io/piper-samples/"
fi

# ── Rhubarb ───────────────────────────────────────────────────────────────────
echo ""
echo "── Rhubarb lip sync (optional — required for avatar lip sync)"
RHUBARB_BIN="${RHUBARB_BIN:-rhubarb/rhubarb}"
if [[ ! -f "$ROOT/$RHUBARB_BIN" ]] && ! command -v rhubarb &>/dev/null; then
  warn "rhubarb not found — lip sync will be disabled"
  warn "  Download from https://github.com/DanielSWolf/rhubarb-lip-sync/releases"
  warn "  and place the executable at $ROOT/rhubarb/rhubarb (or rhubarb.exe on Windows)"
else
  ok "rhubarb found"
fi

# ── Summary ───────────────────────────────────────────────────────────────────
echo ""
echo "=== Done ==="
echo ""
echo "Run the app:  npm start"
echo "Web UI at:    http://localhost:3001"
echo ""
