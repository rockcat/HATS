# HATS APIs

Everything the dashboard does, it does over HTTP, so scripts can do it too.
[visit-demo/seed.mjs](visit-demo/seed.mjs) is a working example: it creates
two teams on the Project Server, then signs in to each runner to upload a file
and add a ticket.

This page covers:

- what each service is for;
- how to sign in to a runner;
- the calls you will most likely need, with examples;
- where to find every route: a browsable docs page, and the OpenAPI documents.

For how the services fit together, see [SERVICES.md](SERVICES.md). To browse every route, open `/api-docs` on a runner.

## The services

```mermaid
flowchart LR
  script([Your script or app])
  subgraph runner [Team Runner :3001]
    dash["/api/* dashboard API"]
    emb["/api/embodiment/v1 public API"]
    ev["/events live stream"]
  end
  ps[Project Server :3020<br>/api/v1]
  lib[Agent Library :3010<br>/api/v1]
  rm[Runner manager<br>/api/v1]

  script -- X-API-Key or Bearer --> dash
  script -- X-API-Key --> emb
  script -- no sign-in --> ps
  runner --> ps
  runner --> lib
  dash -- "/api/runners/*" forwarded --> rm
```

| Service | Default address | Sign-in | Spec |
| --- | --- | --- | --- |
| **Team Runner**, dashboard API | `http://localhost:3001/api/…` | Yes | [runner.openapi.yaml](../packages/contracts/openapi/runner.openapi.yaml) |
| **Team Runner**, Embodiment API | `http://localhost:3001/api/embodiment/v1/…` | Yes | [embodiment.openapi.yaml](../packages/contracts/openapi/embodiment.openapi.yaml) |
| **Project Server** | `http://localhost:3020/api/v1/…` | No | [project-server.openapi.yaml](../packages/contracts/openapi/project-server.openapi.yaml) |
| **Agent Library** | `http://localhost:3010/api/v1/…` | No | [agent-library.openapi.yaml](../packages/contracts/openapi/agent-library.openapi.yaml) |

**Which API to use:**

- **Embodiment API:** a stable, versioned contract for apps that talk to agents,
  such as a phone app, a kiosk or an avatar. Use it when you are building
  something that should keep working as HATS changes. See
  [SERVICES.md](SERVICES.md#the-embodiment-api).
- **Dashboard API (`/api/…`):** what the dashboard itself uses. It covers
  everything, including the board, files, meetings, settings and users, but it
  is not versioned and can change with the dashboard. Use it for scripts and
  tools that live in this repository.
- **Project Server:** holds project definitions: the team, the goal and the
  settings. It also coordinates visits and moves between teams. A runner reads
  its project from here when it starts.

The Project Server and Agent Library ask for no sign-in. Keep them on a network
you trust.

## Signing in to a runner

Every `/api/*` route and `/events` needs a sign-in. Without one the runner
answers `401 {"error":"Not authenticated"}`. Only two routes are open: the
login itself, and the mobile pairing confirmation (`GET /api/auth/pair/…`).

There are two ways to sign in.

**1. An API key, sent as `X-API-Key`.** This is best for scripts and other
services. Create a key in the dashboard's Users panel, or with
[scripts/issue-api-key.mjs](../scripts/issue-api-key.mjs).

```bash
curl -H "X-API-Key: $HATS_API_KEY" http://localhost:3001/api/project
```

A key belongs to the runner that issued it. A second runner with its own data
folder will not know it, unless the runners share sign-in through an auth
service (`AUTH_SERVICE_URL`).

**2. A username and password, swapped for a session token.**

```bash
curl -X POST http://localhost:3001/api/auth/login \
  -H "Content-Type: application/json" \
  -d '{"username":"admin","password":"…"}'
# → {"ok":true,"token":"…","user":{…}}

curl -H "Authorization: Bearer <token>" http://localhost:3001/api/project
```

The login also sets a cookie, which is how the dashboard stays signed in.

Some routes are for admins only and answer `403` otherwise. These include
deciding on visits, moving agents, and creating users.

## Common tasks

The examples use `$RUNNER` for a runner's address (for example
`http://localhost:3001`) and `$AUTH` for one of the headers above.

### What is this runner running?

```bash
curl -H "$AUTH" $RUNNER/api/project
```

The answer includes the project's `id`, name and goal. `GET /api/projects`
lists every project the runner can see.

### Talk to an agent

```bash
curl -X POST -H "$AUTH" -H "Content-Type: application/json" $RUNNER/api/cli \
  -d '{"line":"@Poppy what is on the board today?","threadId":"general"}'
# → {"output":"→ Sent to Poppy"}
```

`/api/cli` takes the same lines as the dashboard's command box:

| Line | Does |
| --- | --- |
| `@Name message` | Sends a message to an agent. `threadId` picks the conversation and defaults to the agent's #general. |
| `task Name: description` | Gives an agent a task. `task Name [folder]: …` also names the project folder. |
| `reply Name: message` | Answers an agent that asked you a question. |
| `resume` | Restarts unfinished tasks and tickets. |

The call returns as soon as the message is accepted. The agent's reply comes
later, on `/events` (see below).

### Add a ticket to the board

```bash
curl -X POST -H "$AUTH" -H "Content-Type: application/json" $RUNNER/api/kanban/tickets \
  -d '{"title":"Fix the pricing page","description":"…","priority":"high",
       "column":"backlog","assignee":"Wren","tags":["web"]}'
# → 201 with the ticket, whose id is TKT-001, TKT-002, …
```

- Only `title` is required.
- `column` defaults to `backlog` and `priority` to `medium`.
- A ticket with the same title (ignoring case) is refused with `409`. The
  answer includes it as `existing`, which makes re-running a seed script safe.
- A ticket created in `in_progress` with an `assignee` is started straight away.

| To | Call |
| --- | --- |
| List every ticket | `GET /api/kanban/tickets` → `{tickets}` |
| Read the board by column | `GET /api/kanban?includeBacklog=true` |
| Change a ticket | `PATCH /api/kanban/tickets/{id}` with any of `title`, `description`, `priority`, `column`, `assignee`, `tags`, `blockedBy`, `longRunning`, `closedReason` |
| Comment on one | `POST /api/kanban/tickets/{id}/comments` with `{author?, text}` (the assignee is told) |

### Give the team a file

```bash
curl -X POST -H "$AUTH" -H "X-Filename: sales.csv" -H "Content-Type: text/csv" \
  --data-binary @sales.csv $RUNNER/api/project/upload
# → 201 {"ok":true,"path":"sources/sales.csv"}
```

The body is the raw file, not a form. The name comes from the `X-Filename`
header, and the file is saved under the project's `sources/` folder.

| To | Call |
| --- | --- |
| List the files | `GET /api/project/files` → `{sources, outputs, tickets}` |
| Download one | `GET /api/project/file?path=outputs/report.md` |
| Download them all | `GET /api/project/files.zip` |

### Follow what happens, live

`GET /events` is a [server-sent events](https://developer.mozilla.org/docs/Web/API/Server-sent_events)
stream. Each message is JSON with a `type`.

```bash
curl -N -H "$AUTH" $RUNNER/events
```

| Types | About |
| --- | --- |
| `init` | Everything, once, on connecting |
| `agent_update`, `agent_stream`, `cli_output` | Agents' state, and what they say |
| `kanban_update`, `board_update` | The board |
| `files_update` | Project files |
| `meeting_started`, `meeting_turn`, `meeting_human_turn`, `meeting_hand_raised`, `meeting_closed`, `scheduled_meetings_update` | Meetings |
| `requests_update` | Agents' questions for you |
| `team_news`, `telemetry_update`, `tools_update`, `catalogue_update`, `email_allowlist_update`, `google_auth_status` | Everything else |

This stream is internal and can change. If you need a stable stream, use the
Embodiment API's `GET /api/embodiment/v1/events`, which has a small fixed set
of event types.

### Create a team, on the Project Server

```bash
PS=http://localhost:3020
curl -X POST $PS/api/v1/projects -H "Content-Type: application/json" \
  -d '{"id":"website","name":"Website","goal":"Ship the new pricing page"}'
curl -X PATCH $PS/api/v1/projects/website -H "Content-Type: application/json" \
  -d '{"settings":{"visits":{"visitTo":["insights"]}}}'
curl -X POST $PS/api/v1/projects/website/team -H "Content-Type: application/json" \
  -d '{"agent":{ …a deployed agent… }}'
```

- Creating a project also creates its folder, with `sources/` and `outputs/`.
- `DELETE /api/v1/projects/{id}?purge=true` removes the definition and its
  folder.
- A deployed agent is described by
  [deployed-agent.schema.json](../packages/contracts/schemas/deployed-agent.schema.json), also served live
  at `/api/v1/schemas/deployedAgent`. `seed.mjs` builds one in its `TEAMS` list.
- A PATCH replaces a top-level field rather than merging into it. That is why
  `seed.mjs` reads the project's `settings` first and sends them back with its
  changes.

The runner running that project picks up the changes from the Project Server's
`/api/v1/events` stream.

## Reference: every route

Each API has an OpenAPI document listing every route with its parameters and
request bodies. There are two ways to read them.

**In the browser:** open `http://localhost:3001/api-docs` while signed in to the
dashboard. It is one page for all four APIs; choose one from the menu at the
top right. Add `?api=project-server`, `embodiment` or `agent-library` to the
address to open a specific one. For the runner's own API, **Try it out**
sends real requests, signed in as you.

The runner reads the Project Server's and Agent Library's documents from those
services when they are running. Otherwise it shows the copy that shipped with
it.

**As files:**

| API | Document | Served at |
| --- | --- | --- |
| Team Runner | [runner.openapi.yaml](../packages/contracts/openapi/runner.openapi.yaml) | `/api/openapi/runner.yaml` |
| Embodiment | [embodiment.openapi.yaml](../packages/contracts/openapi/embodiment.openapi.yaml) | `/api/openapi/embodiment.yaml` |
| Project Server | [project-server.openapi.yaml](../packages/contracts/openapi/project-server.openapi.yaml) | `:3020/api/v1/openapi.yaml` |
| Agent Library | [agent-library.openapi.yaml](../packages/contracts/openapi/agent-library.openapi.yaml) | `:3010/api/v1/openapi.yaml` |

Any OpenAPI tool can read these, for example to generate a client.

The Project Server document is missing three routes that runners use:

| Method | Path | Does |
| --- | --- | --- |
| POST | `/api/v1/moves` | Moves an agent to another team for good |
| GET | `/api/v1/moves/{id}/pack` | The moving agent's pack |
| POST | `/api/v1/moves/{id}/done` | The new team has it running |

The runner manager has its own routes: `/api/v1/teams`, used for
`discover_teams`, and `/api/v1/runners/heartbeat`, `/goodbye` and others, used
for the project switcher.

## Keeping the runner document right

`server/src/api/runner-openapi.test.ts` reads every route from the runner's
routers and compares them with `runner.openapi.yaml`. The test fails when:

- the code serves a route the document doesn't list;
- the code names a method the document leaves out for that route;
- the document lists a route that no router serves.

So a route can't be added, renamed or removed without updating the document.

The routes are read from source by
[route-inventory.ts](../server/src/api/route-inventory.ts), which understands
these forms:

```ts
pathname === '/api/x'
pathname.match(/^\/api\/x\/[^/]+\/y$/)
pathname.startsWith('/api/x/') && pathname.endsWith('/y')
pathname.startsWith('/api/x/')                    // → /api/x/{id}
const STEP = /^\/api\/x\/([^/]+)\/(a|b)$/;        // → /api/x/{id}/a and /b
```

A route written any other way is invisible to the test, so write new routes in
one of these forms.
