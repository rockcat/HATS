# One data directory

Everything the installation accumulates lives in a single directory outside
the repository, named by `HATS_DATA`:

```
F:\workspace\
  HATS\          the runner and the services — runtime_data holds only shipped defaults
  hats-data\     THE data       — mounted by the runner and every service
    projects\          team state, events, kanban, agent-credentials.json
    project-server\    project definitions
    avatars\           GLB and VRM models, backgrounds
    piper_voices\      TTS voice models
    config\            the MCP catalogue
    data\              model pricing, Google tokens, users
```

Set it in `.env`:

```
HATS_DATA=F:/workspace/hats-data
```

When it is unset, `docker-compose.yml` (the runner) falls back to the
repository's own `runtime_data`, so a standalone runner on its own machine
still works, and `docker-compose.services.yml` to `../hats-data`.

## Why outside both repositories

It was inside them, and both had one. They diverged, and the way we found out
was an agent losing her email login.

`agent-credentials.json` is deliberately a runner-local sidecar — a shared
Agent Template Library and a shared project store are the wrong place for a secret —
so the runner reads it from whatever data directory it has mounted. The
runner container was mounting the copy in its own repository, which had been
created from nothing the day before:

```
HATS\runtime_data\projects\agent-credentials.json    20,668 bytes, 38 entries
hats-runner\runtime_data\projects\...                   476 bytes,  2 entries
```

Poppy was in both. In one she had `email-imap`, `google-workspace`,
`google-calendar-personal` and `memory`; in the other, nothing but a team
context. Nothing was lost and nothing was misfiled — the runner was simply
reading the wrong one, and no error says so. The project definitions arrived
over HTTP from the project server and were correct, so the team assembled
perfectly and quietly had no credentials.

The same divergence had reached further than that:

| | HATS | runner |
| --- | --- | --- |
| `projects/paige/team-events.jsonl` | 27,993,281 | 6,652 |
| `projects/paige/team-state.json` | 110,542 | 14,068 |
| `projects/` | 644 files | 11 files |
| `piper_voices/` | 27 files | none |

## Merging the two

The HATS copy was the base, being a superset of everything. Two files came
from the runner's, because there "newest" and "biggest" disagreed and newest
was right:

- `data/google-tokens.json` — the runner had refreshed it. The HATS copy had
  expired three days earlier.
- `projects/agents.json` — two agents rather than one.

Everything else in the runner's copy was a stub it had written itself against
an empty directory.

## Avatars

They used to be committed, 136MB of them, and duplicated in both repositories
with identical content. They are installation assets rather than source — a
deployment chooses its avatars the way it chooses its voices — so they live
here now and `runtime_data/` is ignored wholesale.

They remain in the git history, so a fresh clone is still large. Removing
them from history is a rewrite and a separate decision.

`runtime_data/outputs/` went the same way: it held work agents produced, not
code.

## Backing up

One directory. `projects/` and `data/` are the irreplaceable parts —
`piper_voices/` can be fetched again with `scripts/download-voices.mjs`, and
`avatars/` is static.

Note that `data/` holds live OAuth tokens and `projects/agent-credentials.json`
holds mail passwords. Back it up somewhere that fact is acceptable.
