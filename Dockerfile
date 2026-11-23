# syntax=docker/dockerfile:1

# Ordered so an edit to the source reruns only the compile, which takes
# seconds. Both installs depend on package*.json alone, so they are reused
# until a dependency changes. (Pruning dev dependencies after the compile
# instead re-resolved and audited the whole tree on every edit: three of the
# build's four minutes.)
#
# No system packages: the runner has no native addons. The ones that needed
# Cairo, Mesa, SDL and a compiler belong to packages/avatar-camera, which is
# not part of this image.

# ─── Stage 1: production dependencies ────────────────────────────────────────
FROM node:24-slim AS prod-deps
WORKDIR /build
COPY package*.json ./
# The cache mount keeps npm's downloads between builds.
RUN --mount=type=cache,target=/root/.npm npm ci --omit=dev --no-audit --no-fund


# ─── Stage 2: builder ────────────────────────────────────────────────────────
FROM node:24-slim AS builder
WORKDIR /build

# Every dependency, for the compiler.
COPY package*.json ./
RUN --mount=type=cache,target=/root/.npm npm ci --no-audit --no-fund

# Source files. packages/ holds the shared contracts and service clients the
# server imports, so it is part of the compilation unit.
COPY server/tsconfig.json ./server/tsconfig.json
COPY server/src/          ./server/src/
COPY packages/            ./packages/
COPY apps/web/            ./apps/web/
COPY scripts/             ./scripts/

# Compile TypeScript → server/dist/. The image runs the compiled code, and
# built-in MCP servers use it too once server/dist exists.
RUN npm run build


# ─── Stage 3: runner ─────────────────────────────────────────────────────────
FROM node:24-slim AS runner
WORKDIR /app

# Production dependencies only, from their own stage, so this layer is reused
# until a dependency changes. three, which the dashboard's browser loads from
# /nm/, is not one: the runner fetches it from the Agent Template Library.
COPY --from=prod-deps /build/node_modules ./node_modules
COPY --from=builder /build/server/dist  ./server/dist
COPY --from=builder /build/scripts      ./scripts
# tsc emits only .js, but the compiled code finds these assets relative to its
# own location — dist mirrors the repo, so they must sit beside it in dist:
#   contracts/src/validate.ts → ../schemas, contracts/src/openapi.ts → ../openapi
#   api-server.ts (static UI) → apps/web
COPY --from=builder /build/packages/contracts/schemas ./server/dist/packages/contracts/schemas
COPY --from=builder /build/packages/contracts/openapi ./server/dist/packages/contracts/openapi
COPY --from=builder /build/apps/web     ./server/dist/apps/web
COPY package.json ./

# runtime_data/ is always mounted — never bake project data into the image.
# What the repository ships there (the MCP catalogue and model pricing — see
# .dockerignore; the avatars come with the services) is carried as defaults
# instead, and copied into the data
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
