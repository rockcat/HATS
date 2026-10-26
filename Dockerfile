# syntax=docker/dockerfile:1

# ─── Stage 1: builder ────────────────────────────────────────────────────────
FROM node:24-slim AS builder
WORKDIR /build

# Build-time deps for native Node addons:
#   @napi-rs/canvas → Cairo + Pango
#   gl              → Mesa OpenGL (headless rendering)
#   @kmamal/sdl     → SDL2
#
# python-is-python3 because gl publishes prebuilt binaries for Node 22 but
# not 24, so on 24 it compiles ANGLE from source — and ANGLE's gyp files
# call `python`, which Debian does not provide. Without it the build dies
# with "python: not found" deep inside node-gyp.
RUN apt-get update && apt-get install -y --no-install-recommends \
      python3 python-is-python3 build-essential pkg-config \
      libcairo2-dev libpango1.0-dev libjpeg-dev libgif-dev \
      libgl1-mesa-dev libglu1-mesa-dev libxi-dev libxext-dev \
      libsdl2-dev \
    && rm -rf /var/lib/apt/lists/*

# Install deps first — this layer is cached until package*.json changes
COPY package*.json ./
RUN npm ci

# Source files. packages/ holds the shared contracts and service clients the
# server imports, so it is part of the compilation unit.
COPY server/tsconfig.json ./server/tsconfig.json
COPY server/src/          ./server/src/
COPY packages/            ./packages/
COPY apps/web/            ./apps/web/
COPY scripts/             ./scripts/

# Compile TypeScript → server/dist/
RUN npm run build


# ─── Stage 2: runner ─────────────────────────────────────────────────────────
FROM node:24-slim AS runner
WORKDIR /app

# Runtime shared libraries (not -dev headers)
RUN apt-get update && apt-get install -y --no-install-recommends \
      libcairo2 libpango-1.0-0 libpangocairo-1.0-0 libjpeg62-turbo libgif7 \
      libgl1-mesa-glx libglu1-mesa libxi6 libxext6 \
      libsdl2-2.0-0 \
      ffmpeg \
    && rm -rf /var/lib/apt/lists/*

# node_modules carries compiled .node files AND tsx (needed for the
# kanban MCP subprocess: node --import tsx/esm scripts/kanban-mcp.ts)
COPY --from=builder /build/node_modules ./node_modules
COPY --from=builder /build/server/dist  ./server/dist
COPY --from=builder /build/scripts      ./scripts
# tsc emits only .js, but the compiled code finds these assets relative to its
# own location — dist mirrors the repo, so they must sit beside it in dist:
#   contracts/src/validate.ts → ../schemas, contracts/src/openapi.ts → ../openapi
#   api-server.ts (static UI) and glb-renderer.ts (imports) → apps/web
COPY --from=builder /build/packages/contracts/schemas ./server/dist/packages/contracts/schemas
COPY --from=builder /build/packages/contracts/openapi ./server/dist/packages/contracts/openapi
COPY --from=builder /build/apps/web     ./server/dist/apps/web
COPY package.json ./

# runtime_data/ is always mounted — never bake project data into the image.
# What the repository ships there (avatars, backgrounds, model pricing — see
# .dockerignore) is carried as defaults instead, and copied into the data
# directory on startup wherever it is missing: a new installation starts with
# them and an existing one keeps its own.
COPY runtime_data/ ./defaults/
VOLUME ["/app/runtime_data"]

# Speech, the Agent Library and the Project Server are separate services — see
# the *_URL settings in docker-compose.yml. The runner only talks to them, and
# falls back to local files when the library or project server is not there.
EXPOSE 3001

# Headless: no terminal is attached, so no chat CLI — it would read EOF and exit.
#
# Everything that must outlive the container goes under the mounted data
# directory; anything else here is lost when it is recreated.
#   HATS_SETTINGS_FILE  what the Settings panel saves (it wrote /app/.env,
#                       which nothing reloaded — a setting lasted one run)
#   XDG_STATE_HOME      MCP servers' own state — email-mcp keeps scheduled
#   XDG_CACHE_HOME      sends and its mail cache there, under ~/.local/state
#                       and ~/.cache by default
ENV NODE_ENV=production \
    RUNTIME_DIR=/app/runtime_data \
    HATS_DEFAULTS_DIR=/app/defaults \
    HATS_HEADLESS=1 \
    HATS_SETTINGS_FILE=/app/runtime_data/config/settings.env \
    XDG_STATE_HOME=/app/runtime_data/state \
    XDG_CACHE_HOME=/app/runtime_data/cache

# The compilation root is the repo (the server imports packages/), so the
# emitted entry point keeps its server/src/ path inside dist.
CMD ["node", "server/dist/server/src/team-runner.js"]
