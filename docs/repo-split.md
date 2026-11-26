# One repository

HATS was one repository, then two for about a month, and is one again.

## The split, and why it was undone

On 23 Oct 2026 the runner moved to its own repository, `HATS-runner`, and this
one kept the services. The idea was a public runner and private services.

It did not hold. The services came to depend on the runner's packages
(`core`, `contracts`, `clients`, `auth`, `service-kit`, `speech-core`) by
sibling path, `file:../hats-runner/packages/*`, so neither repository built
alone. Docker builds and CI had to check out both side by side, a feature
such as team visits needed commits in both, and both ended up private anyway.

In Nov 2026 the two were merged back, with both histories, and the result
went back to `rockcat/HATS`:

- The runner kept its paths: `server/`, `apps/web`, `packages/*`.
- The shared packages are npm workspaces, linked as `@hats/*` from the root.
- The one part kept private, the Poppy In Your Pocket mobile app, moved to
  its own repository, `poppy-in-your-pocket`, and was filtered out of this
  history. It takes the avatar renderer, `apps/flutter/avatar_view`, from
  here by git.

## Building and running

| | Image | Built from | Compose file |
|---|---|---|---|
| The runner | `hats-runner` | `Dockerfile` | `docker-compose.yml` |
| The Node services | `hats-services` | `Dockerfile.services`, target `services` | `docker-compose.services.yml` |
| The Speech Service | `hats-speech` | `Dockerfile.services`, target `speech` | `docker-compose.services.yml` |

From source, `npm run dev` starts the runner and `npm run services` the
services. `.github/workflows/docker.yml` builds all three images.

## Two things that bite in a container

**No terminal.** The chat CLI closes the process when its input ends, which
is right at a terminal and wrong in a container, where there is no stdin at
all. The runner would start, restore its state and exit within the second,
looking exactly like a crash. `HATS_HEADLESS=1` is set in the image.

**Host paths in MCP configuration.** `runtime_data` is bind-mounted from the
host, and any MCP server configured with a Windows command or an absolute
Windows path cannot run inside a Linux container:

```text
Cannot find module '/app/C:\Users\…\google-workspace\dist\index.js'
spawn npx.cmd ENOENT
```

Those entries need container-appropriate equivalents. They are configuration,
not code, which is why no amount of fixing the image makes them work.
