#!/usr/bin/env bash
# Install HATS on this machine from the published images.
#
# Needs only Docker (with the compose plugin) and curl. Creates the
# installation folder, fetches the compose file, writes .env, signs in to
# GitHub Container Registry, downloads voices, and starts everything. Safe to
# run again: it updates the compose file and images, and leaves .env and the
# data folder alone.
#
#   bash install.sh                        installs into ~/hats
#   HATS_DIR=/opt/hats HATS_VERSION=0.1.3 bash install.sh
#
# The images are private. You need a GitHub personal access token (classic)
# with the read:packages and repo scopes:
#   https://github.com/settings/tokens/new?scopes=read:packages,repo
# Set GITHUB_USER and GITHUB_TOKEN to skip the prompts. Set HATS_VOICES to a
# space-separated list to choose voices, HATS_NO_START=1 to only install.

set -euo pipefail

DIR="${HATS_DIR:-$HOME/hats}"
VERSION="${HATS_VERSION:-latest}"
REF="${HATS_REF:-main}"
REPO='rockcat/HATS-agents'
VOICES="${HATS_VOICES:-en_GB-semaine-medium en_GB-vctk-medium en_GB-alan-medium en_GB-jenny_dioco-medium en_GB-northern_english_male-medium en_GB-southern_english_female-low}"

step() { printf '\n== %s\n' "$1"; }
fail() { printf '%s\n' "$1" >&2; exit 1; }

# ── Docker ───────────────────────────────────────────────────────────────────
step 'Checking Docker'
command -v docker >/dev/null || fail 'Docker is not installed: https://docs.docker.com/engine/install/'
command -v curl >/dev/null || fail 'curl is not installed.'
docker info >/dev/null 2>&1 || fail 'Docker is installed but not running, or this user may not use it.'
docker compose version >/dev/null 2>&1 || fail 'This Docker has no "docker compose". Install the compose plugin.'

# ── GitHub credentials ───────────────────────────────────────────────────────
step 'GitHub sign-in (for the private images)'
USER_NAME="${GITHUB_USER:-}"
[ -n "$USER_NAME" ] || read -rp 'GitHub username: ' USER_NAME
TOKEN="${GITHUB_TOKEN:-}"
if [ -z "$TOKEN" ]; then read -rsp 'GitHub token (read:packages, repo): ' TOKEN; echo; fi

# ── Files ────────────────────────────────────────────────────────────────────
step "Installing into $DIR"
mkdir -p "$DIR/data/piper_voices"

repo_file() {
  curl -fsSL -H "Authorization: Bearer $TOKEN" -H 'Accept: application/vnd.github.raw' \
    "https://api.github.com/repos/$REPO/contents/$1?ref=$REF" -o "$2" \
    || fail "Could not download $1 from $REPO. Check the token has the repo scope."
}

COMPOSE="$DIR/docker-compose.yml"
[ -f "$COMPOSE" ] && cp "$COMPOSE" "$COMPOSE.previous"
repo_file deploy/docker-compose.yml "$COMPOSE"
echo 'docker-compose.yml: up to date'

ENV_FILE="$DIR/.env"
if [ -f "$ENV_FILE" ]; then
  echo '.env: kept as it is'
else
  repo_file deploy/.env.example "$ENV_FILE"
  chmod 600 "$ENV_FILE"
  read -rp 'Anthropic API key (Enter to fill in later): ' ANTHROPIC
  read -rp 'Password for the dashboard admin (Enter for "changeme"): ' ADMIN_PASSWORD
  # Through a small awk script rather than sed, so a key with / or & in it
  # cannot break the substitution.
  awk -v a="$ANTHROPIC" -v p="$ADMIN_PASSWORD" -v v="$VERSION" '
    /^ANTHROPIC_API_KEY=/   && a != "" { print "ANTHROPIC_API_KEY=" a; next }
    /^HATS_ADMIN_PASSWORD=/ && p != "" { print "HATS_ADMIN_PASSWORD=" p; next }
    /^HATS_VERSION=/                   { print "HATS_VERSION=" v; next }
    { print }' "$ENV_FILE" > "$ENV_FILE.tmp" && mv "$ENV_FILE.tmp" "$ENV_FILE"
  echo ".env: written. Add your other keys to $ENV_FILE"
fi

# ── Voices ───────────────────────────────────────────────────────────────────
# Piper voices are named <lang>_<REGION>-<name>-<quality>, which is also
# their path in the published collection.
step 'Voices'
for voice in $VOICES; do
  IFS=- read -r locale name quality extra <<< "$voice"
  if [ -z "$quality" ] || [ -n "$extra" ]; then echo "  $voice is not a Piper voice name, skipped"; continue; fi
  base="https://huggingface.co/rhasspy/piper-voices/resolve/main/${locale%%_*}/$locale/$name/$quality/$voice"
  for ext in .onnx.json .onnx; do
    dest="$DIR/data/piper_voices/$voice$ext"
    [ -f "$dest" ] && continue
    echo "  downloading $voice$ext"
    curl -fsSL "$base$ext" -o "$dest" || { rm -f "$dest"; echo "  could not download $voice$ext"; }
  done
done

# ── Images ───────────────────────────────────────────────────────────────────
step 'Signing in to ghcr.io and pulling images'
printf '%s' "$TOKEN" | docker login ghcr.io -u "$USER_NAME" --password-stdin \
  || fail 'GitHub Container Registry refused the token. It needs the read:packages scope.'
docker compose -f "$COMPOSE" pull || fail 'Could not pull the images.'

if [ -n "${HATS_NO_START:-}" ]; then
  echo "Installed. Start it with: docker compose -f $COMPOSE up -d"; exit 0
fi

step 'Starting'
docker compose -f "$COMPOSE" up -d || fail 'Could not start the containers.'

echo 'Waiting for the runner...'
for _ in $(seq 60); do
  # Any HTTP reply at all means it is up: /api/ needs a login, so 401 is fine.
  code=$(curl -s -o /dev/null -w '%{http_code}' --max-time 3 http://localhost:3001/api/state || true)
  [ "$code" != "000" ] && break
  sleep 3
done
[ "$code" != "000" ] || fail "The runner has not answered after 3 minutes. See: docker compose -f $COMPOSE logs hats"

cat <<EOF

HATS is running.

  Dashboard          http://localhost:3001
  Agent Library      http://localhost:3010
  Project Designer   http://localhost:3030
  Project View       http://localhost:3070

To bring a project from another machine, export it there:
  node --env-file=.env scripts/project-transfer.mjs export <project> [--credentials]
then put the zip in $DIR/data and run:
  docker compose -f $COMPOSE exec hats node scripts/project-transfer.mjs import /app/runtime_data/<project>.hats.zip

Update later by running this script again.
EOF
