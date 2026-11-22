# syntax=docker/dockerfile:1

# ─── The HATS services ───────────────────────────────────────────────────────
#
# One image for all of them. They share a dependency tree and a source tree,
# and differ only in which file they start, so seven Dockerfiles would be
# seven copies of this one drifting apart. Compose picks the service with a
# command.
#
# The build context is the directory holding BOTH repositories, not this one:
#
#   workspace/
#     HATS/           ← this repository
#     hats-runner/    ← the shared libraries live here
#
# because package.json depends on them by relative path
# (file:../hats-runner/packages/core and friends). Copying that layout into
# the image is what lets `npm ci` resolve them. When the libraries are
# published to a registry this goes away and the context becomes this
# directory alone.
#
# Build from the parent:  docker build -f HATS/Dockerfile ..
# Or just: docker compose build

# ─── Stage 1: dependencies ───────────────────────────────────────────────────
FROM node:22-slim AS deps
WORKDIR /workspace

# The libraries first, and only their manifests and sources. They carry no
# native code, so there is nothing to compile and no build toolchain needed.
COPY hats-runner/packages/core/        ./hats-runner/packages/core/
COPY hats-runner/packages/contracts/   ./hats-runner/packages/contracts/
COPY hats-runner/packages/clients/     ./hats-runner/packages/clients/
COPY hats-runner/packages/service-kit/ ./hats-runner/packages/service-kit/
COPY hats-runner/packages/speech-core/ ./hats-runner/packages/speech-core/
COPY hats-runner/packages/auth/        ./hats-runner/packages/auth/

# Then the manifests, so this layer is cached until a dependency changes
# rather than on every source edit.
# A library's own dependencies have to be installed beside it, not in the
# consumer. Node resolves a symlinked package from where it really is, so it
# walks up from hats-runner/packages/<lib>/ and never reaches HATS/node_modules
# — the first build of this looked fine and then died on `Cannot find package
# 'ajv' imported from .../contracts/src/validate.ts`.
RUN for lib in /workspace/hats-runner/packages/*/; do \
      if [ -f "$lib/package-lock.json" ]; then \
        echo "installing dependencies of $(basename "$lib")" && \
        (cd "$lib" && npm ci --omit=dev --no-audit --no-fund); \
      fi; \
    done

COPY HATS/package.json HATS/package-lock.json ./HATS/
WORKDIR /workspace/HATS
RUN npm ci --omit=dev


# ─── Stage 2: the services ───────────────────────────────────────────────────
FROM node:22-slim AS services-base
WORKDIR /workspace/HATS

COPY --from=deps /workspace/hats-runner /workspace/hats-runner
COPY --from=deps /workspace/HATS/node_modules ./node_modules
COPY HATS/package.json ./
COPY HATS/apps/     ./apps/
COPY HATS/packages/ ./packages/
COPY HATS/scripts/  ./scripts/

# Every service reads it, none of them should be baked with it: runtime_data
# holds projects, avatars and voices, which belong to the installation rather
# than the image.
VOLUME ["/workspace/HATS/runtime_data"]
ENV NODE_ENV=production \
    RUNTIME_DIR=/workspace/HATS/runtime_data

# 3010 library · 3020 projects · 3030 designer · 3040 embodiment
# 3060 companion · 3070 project view · 3080 runner manager · 3090 auth
EXPOSE 3010 3020 3030 3040 3060 3070 3080 3090

# Overridden per service by compose. The library is the one most things need.
CMD ["node", "--import", "tsx/esm", "apps/agent-library/src/main.ts"]


# ─── Stage 2b: the services, with the default avatars ────────────────────────
#
# The Agent Template Library copies these into the data folder on startup
# wherever they are missing, and every runner reads them from there or from
# the library, so there is one copy however many runners there are. Speech is
# built from the stage above instead: it never touches an avatar.
FROM services-base AS services

COPY hats-runner/runtime_data/avatars/ ./defaults/avatars/
ENV HATS_DEFAULTS_DIR=/workspace/HATS/defaults


# ─── Stage 3: the speech service ─────────────────────────────────────────────
#
# Its own stage because it is the only one that is not just Node: it spawns
# `python -m piper.http_server` per voice model. Putting Piper in the shared
# image would make six services carry a Python runtime they never call.
FROM services-base AS speech

RUN apt-get update && apt-get install -y --no-install-recommends \
      python3 python3-pip ffmpeg \
    && rm -rf /var/lib/apt/lists/*

# --break-system-packages is required on Debian 12 and later, where the
# system Python refuses pip installs without it.
RUN pip3 install --no-cache-dir --break-system-packages piper-tts flask

# voice-manager.ts spawns this; without it the default "python" is not on PATH
# in a slim image and every voice fails to start with ENOENT.
ENV PYTHON_BIN=python3 \
    PIPER_VOICES_DIR=/workspace/HATS/runtime_data/piper_voices

# Only the service itself. The Piper servers it spawns listen on 5100
# upwards, but nothing outside this container talks to them.
EXPOSE 3050

CMD ["node", "--import", "tsx/esm", "apps/speech-service/src/main.ts"]
