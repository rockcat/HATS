# Running several projects at once

A runner holds one project at a time. To have several projects working at the
same time, run one runner per project. All of them use the same services: the
Agent Template Library, the Project Server and the Speech Service. Those run
once, exactly as they do for a single runner.

```
  browser :3001 ──> runner (evan)  ──┐
  browser :3002 ──> runner (paige) ──┼──> Agent Template Library :3010
  browser :3003 ──> runner (…)     ──┤    Project Server         :3020
                                     └──> Speech Service         :3050
```

## From the dashboard

On an installation made with `install.sh`, the services include a runner
manager and an auth service, and the runner is told where both are
(`RUNNER_MANAGER_URL`, `AUTH_SERVICE_URL`). Then:

- **The project badge lists every project with its runner.** Choosing a
  running one opens that runner's dashboard.
- **A project with no runner has a Launch button**, for admins. The runner
  manager starts a runner for it on the next free port in `RUNNER_PORTS`
  (3101–3199 by default), following every rule below. It waits for the runner
  to report in, then opens it. A stopped runner it started can be launched
  again the same way.
- **One sign-in works on every runner.** Users, sessions and API keys live in
  the auth service, in `data/users.json`: the file the runner used before, so
  existing logins and keys carry on.

The runner manager needs the Docker socket to start runners, which gives it
full control of Docker on that machine. It only ever starts runner
containers, and only for an admin. Without the socket it still lists runners.

Every runner reports in, including ones written by hand as below, so they
appear in the list too. Launched runners keep their data under
`data/runners/<project>`; removing one leaves that folder in place.

## Rules each runner must follow

| Rule | Why | How |
|---|---|---|
| Its own port, the same inside the container as outside | Each runner is a separate dashboard, and Google sign-in returns to `localhost:<the runner's port>`. | `TEAM_RUNNER_PORT: 3002` and `ports: ["3002:3002"]` |
| One fixed project | Two runners on one project would overwrite each other's team state and board. | `TEAM_PROJECT` and `HATS_PROJECT_LOCKED=1` |
| Its own data folder | Every runner writes logins, Google tokens, the MCP catalogue, telemetry and global scheduled actions. Runners sharing one folder lose each other's changes. | A folder per runner, such as `./runners/paige` |
| Its project's folder, mounted from the shared data folder | The project's files stay where they are, and nothing is copied. | A second volume onto `/app/runtime_data/projects/<project>` |

`HATS_PROJECT_LOCKED` stops a runner switching to another project, from the
dashboard or the API. The project badge then shows the project's name but
does not open the switcher.

## From a checkout of this repository

`docker-compose.multi.yml` runs two runners, for `evan` on port 3001 and for
`paige` on port 3002. Stop the single runner first, since both use port 3001:

```bash
docker compose down
docker compose -f docker-compose.multi.yml up -d --build
```

It uses your existing `.env`, including `HATS_DATA`, which is where the
projects are, and the services already running on this machine.

To add a project, copy one of the runner blocks, then change:

- the service name, such as `runner-rhoda`
- the port, in both `TEAM_RUNNER_PORT` and `ports`, such as `3003` and `"3003:3003"`
- `TEAM_PROJECT`, such as `Rhoda`, matching the project's folder name
- the project name in both volume paths

Then run `docker compose -f docker-compose.multi.yml up -d` again.

## On an installation made with install.sh

The installed `docker-compose.yml` already runs the services and one runner,
`hats`. Add the other runners in a `docker-compose.override.yml` beside it.
Compose reads that file automatically, and `install.sh` leaves it alone.

```yaml
x-runner: &runner
  image: ghcr.io/rockcat/hats-runner:${HATS_VERSION:-latest}
  platform: ${HATS_PLATFORM:-linux/amd64}
  restart: unless-stopped
  env_file: [.env]
  extra_hosts: ["host.docker.internal:host-gateway"]
  depends_on:
    agent-library: { condition: service_healthy }
    project-server: { condition: service_healthy }

x-runner-env: &runner-env
  NODE_ENV: production
  RUNTIME_DIR: /app/runtime_data
  AGENT_LIBRARY_URL: http://agent-library:3010
  PROJECT_SERVER_URL: http://project-server:3020
  SPEECH_SERVICE_URL: http://speech-service:3050
  HATS_PROJECT_LOCKED: "1"

services:
  # The installed runner, kept on its own project.
  hats:
    environment:
      TEAM_PROJECT: evan
      HATS_PROJECT_LOCKED: "1"

  runner-paige:
    <<: *runner
    ports: ["3002:3002"]
    environment: { <<: *runner-env, TEAM_RUNNER_PORT: 3002, TEAM_PROJECT: paige }
    volumes:
      - ./runners/paige:/app/runtime_data
      - ${HATS_DATA:-./data}/projects/paige:/app/runtime_data/projects/paige
```

Then run `docker compose up -d`.

## What is shared and what is not

| Shared by every runner | Separate for each runner |
|---|---|
| Agent templates, in the library | Dashboard logins and API keys, unless the runners share the auth service |
| Project definitions, in the Project Server | Google connections, which need setting up on each runner |
| Voices, from the Speech Service | The MCP catalogue and the tools found on servers |
| `.env`: model keys, admin login, Brave key | Global scheduled actions |
| The project's own files, board and history | Telemetry and costs |

Each project agent keeps its own settings and limits, so this changes nothing
for agents.

## Things to know

- **Google sign-in** returns to `http://localhost:<the runner's port>/api/auth/google/callback`.
  Add each runner's callback to your Google OAuth client's authorised redirect
  URIs, for example `http://localhost:3002/api/auth/google/callback`. This
  is why each runner uses the same port inside its container as outside.
- **Phone pairing** uses `HATS_PUBLIC_URL` when it is set. Set it per runner,
  in its `environment`, so each one's QR code names its own port.
- **Two runners editing the same agent template at the same moment**: the
  last save wins. Each runner's own copy of an agent is unaffected.
- **Opening a project on a second runner while another has it open** is what
  the lock prevents. Do not give two runners the same `TEAM_PROJECT`.
- **Memory and cost** grow with each runner. Every runner is a full process,
  and its agents spend against their own hourly budgets.
