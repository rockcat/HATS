# Two repositories

This repository is **private** and holds everything. The runner is published
from it as a **public** repository containing only the runner, its dashboard,
and the contract other things talk to it through.

It runs that way round deliberately. The alternative — keep this one public
and strip the rest out — means every push depends on a filter being exactly
right, and a filter that is wrong once publishes something that cannot be
unpublished. Building the public repo from scratch each time makes the
default "withheld" rather than "published".

## What goes

`docs/runner-public-paths.txt` is the list, and it is an allowlist. Anything
new is private until somebody adds it, because the two mistakes do not cost
the same: a file wrongly withheld is an inconvenience, a file wrongly
published is permanent.

| Public | Private |
| --- | --- |
| `server/` — the runner | `apps/agent-library`, `apps/project-server`, `apps/project-designer` |
| `apps/web/` — the dashboard it serves | `apps/companion`, `apps/poppyinyourpocket`, `apps/project-view` |
| `packages/contracts` — the Embodiment API | `apps/speech-service`, `apps/embodiment-test`, `apps/flutter` |
| `packages/clients` — clients for the services | `apps/electron`, `apps/admin`, `apps/agent_manager` |
| `packages/core` — the shared domain | `packages/ui-kit` |
| `packages/service-kit`, `packages/speech-core` | `runtime_data/projects`, `runtime_data/outputs` |

## Publishing

```sh
node scripts/export-runner.mjs --out ../hats-runner
```

It clones this repo, rewrites history to drop every non-public path from
every commit, cuts the result loose from this one, and then checks its own
work before saying it is done. Commits that touched nothing public disappear;
the rest keep their real messages and dates.

It never pushes. Adding a remote and publishing is a decision about a public
repository, and not one a script should take on anybody's behalf.

Three things it does that are easy to leave out and expensive to miss:

- **Drops `refs/original`.** `git filter-branch` keeps the pre-filter commits
  there. Left in place, every withheld file is still reachable in the pack —
  the repo looks filtered and pushes everything.
- **Removes the inherited `origin`.** The clone points at this private repo,
  so a plain `git push` in the export would push the public branch straight
  back into the private one.
- **Verifies across all of history, not the checked-out tree.** A push sends
  every reachable object. A withheld file surviving in one old commit is
  published exactly as surely as one sitting in HEAD, and a tree-only check
  would call that export clean.

## Keeping the boundary honest

`scripts/export-runner.test.ts` runs with the normal suite and asserts that
no published file imports a withheld one. That is the failure that matters
over time: somebody adds an import from the runner into one of the products,
nothing breaks here because both are present, and the public repo quietly
stops building for everybody who clones it.

The same tests assert that each product directory stays private and that no
credential file is ever matched by the allowlist.

## Why `packages/core` exists

The agent library, project server and speech service used to import straight
out of `server/src` — hat definitions, the prompt generator, the MCP
catalogue, the logger, the provider list. Nine modules, and every one a
reason those services could not live anywhere else.

They are shared domain rather than runner internals: the library offers hats
and MCP servers for selection, the designer previews a system prompt, and
none of them runs a team. They now live in `packages/core`, which imports
nothing from `server/` or `apps/` and is published with the runner.

## If the private repo ever drops the runner

It keeps a full copy today, so the services import `packages/core` by
relative path and nothing else is needed. If the runner is removed from here
later, the services consume it as a git dependency instead:

```json
"hats-runner": "github:<you>/hats-runner#main"
```

That needs the public repo's `package.json` to declare an `exports` map and a
`prepare` script to build on install, since a git dependency ships source
rather than a build. Not set up, because nothing needs it yet.
