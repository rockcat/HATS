# syntax=docker/dockerfile:1

# ─── Stage 1: builder ────────────────────────────────────────────────────────
FROM node:22-slim AS builder
WORKDIR /build

# Build-time deps for native Node addons:
#   @napi-rs/canvas → Cairo + Pango
#   gl              → Mesa OpenGL (headless rendering)
#   @kmamal/sdl     → SDL2
RUN apt-get update && apt-get install -y --no-install-recommends \
      python3 build-essential pkg-config \
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
FROM node:22-slim AS runner
WORKDIR /app

# Runtime shared libraries (not -dev headers)
RUN apt-get update && apt-get install -y --no-install-recommends \
      python3 python3-pip \
      libcairo2 libpango-1.0-0 libpangocairo-1.0-0 libjpeg62-turbo libgif7 \
      libgl1-mesa-glx libglu1-mesa libxi6 libxext6 \
      libsdl2-2.0-0 \
      ffmpeg \
    && rm -rf /var/lib/apt/lists/*

# Piper TTS Python package (flask = HTTP server shim)
# --break-system-packages required on Debian 12+ / bookworm
RUN pip3 install --no-cache-dir --break-system-packages piper-tts flask

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
# The volume must contain at minimum: avatars/, config/, data/
VOLUME ["/app/runtime_data"]

EXPOSE 3001
# Piper TTS servers (one per voice model, starting at PIPER_SERVER_PORT_START)
EXPOSE 5100-5120

ENV NODE_ENV=production \
    RUNTIME_DIR=/app/runtime_data

# The compilation root is the repo (the server imports packages/), so the
# emitted entry point keeps its server/src/ path inside dist.
CMD ["node", "server/dist/server/src/team-runner.js"]
