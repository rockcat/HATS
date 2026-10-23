# Two repositories

The runner lives in its own public repository, `hats-runner`, and runs here
as a container. This repository holds the services and clients that talk to
it. It does not contain the runner and does not build it.

## How this came about, and why the first attempt was wrong

The split started as an *export*: this repository held everything, and the
public runner repo was generated from it by filtering history. That model
lasted about an hour. The runner repo was pushed, its image crashed on boot,
and the fix was written there — in the generated repository, which the next
export would have overwritten without a word.

A generated repository cannot be worked in, and a repository people work in
cannot be generated. So the direction is now fixed: **`hats-runner` owns the
runner.** Changes to it are made there. Nothing here regenerates it, and the
export tooling that used to has been removed rather than left lying about
waiting to destroy somebody's afternoon.

## Running it

```sh
npm run runner:build     # docker build -t hats-runner:latest ../hats-runner
npm run runner           # docker compose up -d runner
npm run runner:logs
npm run runner:stop
```

`runner:build` exists only because the image is not published to a registry
yet. Once it is, set `HATS_RUNNER_IMAGE` and drop the build step entirely —
at that point this repository never compiles a line of the runner.

The services here still run from source:

```sh
npm run services         # library, projects, designer, embodiment, speech
npm run companion
npm run project-view
```

The runner reaches them through `host.docker.internal`, because inside a
container `localhost` is the container. Each is optional: with no project
server the runner falls back to local disk, and with no agent library it uses
its own bundled `agents.json`, so `npm run runner` alone is a working system.

## Two things that bite in a container

**No terminal.** The chat CLI closes the process when its input ends, which
is right at a terminal and wrong in a container, where there is no stdin at
all — the runner would start, restore its state and exit within the second,
looking exactly like a crash. `HATS_HEADLESS=1` is set in both the image and
the compose file.

**Host paths in MCP configuration.** `runtime_data` is bind-mounted from the
host, and any MCP server configured with a Windows command or an absolute
Windows path cannot run inside a Linux container:

```text
Cannot find module '/app/C:\Users\…\google-workspace\dist\index.js'
spawn npx.cmd ENOENT
```

Those entries need container-appropriate equivalents. They are configuration,
not code, which is why no amount of fixing the image makes them work.

## The shared packages

Both repositories need these, and they are currently duplicated:

| | here | runner |
| --- | --- | --- |
| `packages/core` | 12 files | 54 files |
| `packages/contracts` | 7 | 8 |
| `packages/clients` | 3 | 5 |
| `packages/service-kit` | 16 | 1 |
| `packages/speech-core` | 4 | 1 |
| `packages/ui-kit` | 5 | — |

Ownership is not uniform. `core` is plainly the runner's; `service-kit` and
`ui-kit` are plainly this repository's; `contracts` is the API contract and
arguably belongs on both sides of the boundary by definition.

They have already drifted once — `repoRootFrom` was fixed in the runner repo
and had to be copied back here. Until this is resolved, a change to a shared
package has to be made in both places, and nothing will tell you when it has
not been.

The intended resolution is an npm git dependency on the runner repository for
`core`, `contracts` and `clients`, leaving `service-kit`, `speech-core` and
`ui-kit` here. That needs an `exports` map and a `prepare` build script in
`hats-runner`, because a git dependency ships source rather than a build.
Not done yet.
