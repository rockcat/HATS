# HATS Services

*Implements `docs/Architecture Update.md` (29 Aug 2026).*

This describes how HATS is split into separable services behind formal APIs.
For what happens **inside** the Team Runner process — the orchestrator, agents,
MCP registry and render pipeline — see [ARCHITECTURE.md](ARCHITECTURE.md).

HATS is five applications around three formal contracts. Each application owns
one thing and reaches the others only through a published API.

```
┌──────────────────┐   AgentTemplate    ┌──────────────────┐
│  Agent Template Library   │───────────────────▶│ Project Designer │
│  API + UI :3010  │                    │     UI :3030     │
└──────────────────┘                    └────────┬─────────┘
                                                 │ ProjectDefinition
                                                 ▼
┌──────────────────┐  ProjectDefinition ┌──────────────────┐
│   Team Runner    │◀──────────────────▶│  Project Server  │
│  :3001 + dash    │                    │    API :3020     │
└────────┬─────────┘                    └──────────────────┘
         │ Embodiment API
         ▼
┌──────────────────┐        ┌──────────────────┐
│ Embodiment Test  │        │  Speech Service  │
│     UI :3040     │        │    API :3050     │
└──────────────────┘        └──────────────────┘
                             owns the Piper TTS
                             servers; the runner
                             and library ask it
```

## The applications

### Agent Template Library — `apps/agent-library`, port 3010

Owns agent templates and nothing else: no projects, no orchestration, no running
agents. Ships its own UI for browsing, authoring and previewing the system prompt
a template produces.

Storage is one JSON file per template under
`runtime_data/agent-library/templates/`, so a template is readable, diffable and
hand-editable. Every write is schema-validated before it reaches disk; a file
that fails validation is reported at startup and skipped rather than silently
accepted.

On first start it imports any legacy `projects/agents.json` and renames the
source to `.migrated` so the import cannot repeat.

### Project Server — `apps/project-server`, port 3020

Owns project definitions: objective, team roster, shared MCP servers, and the
pointer to which project is *active*. Creating a project also creates its working
folder (`sources/`, `outputs/`) so the runner has somewhere to work.

Deploying an agent resolves the template from the Agent Template Library and stores a
fully-resolved copy, so the runner never needs the library to start a team.

Writes are optimistically concurrent: pass `expectedRevision` and a stale write
is rejected with 409 rather than clobbering someone else's edit. This is what
stops the Designer and a running team overwriting each other.

### Project Designer — `apps/project-designer`, port 3030

A UI with no state of its own. It reads templates from the Agent Template Library, writes
definitions to the Project Server, and reaches both through its own reverse proxy
(`/proxy/library`, `/proxy/projects`) so the browser only ever talks to one
origin.

It shows template **drift** — when the library has moved past the revision a
deployed agent was built from — and offers a one-click resync.

It also sets the team's **shared MCP servers**, which the old operator
dashboard used to own. The browser picks catalogue ids; the Project Server
expands them into the `mcpServers` list the runner starts, so a transport
config never reaches a page and a catalogue change reaches every project
without editing a stored document. Each entry shows whether this machine has
the environment variables the server needs, because a server with a missing
key starts and then fails.

Which of those servers a given agent may use is picked from the same list in
the agent dialog. Both were free-text boxes, which meant typing ids that had
to match exactly and gave no way to see that they did.

## What the model is shown, and what it has to look for

Every tool an agent can reach is either **upfront** — in the tool list of
every request — or **searchable**, found with `search_tools` and loaded with
`get_tool`. It is a straight trade: upfront costs a schema on every call,
searchable costs a round trip and the risk of a query that misses.

By default an agent gets all of its own personal servers upfront and the
team's servers by search. That default exists because the alternative failed
in practice: an agent with a mailbox it had to discover reported that it could
not read mail.

It is only a default. A template's `tools.upfrontTools` names exactly what
goes in front of the model — a whole server (`email-imap`) or one tool
(`email-imap:get_email`), personal or shared alike. An empty list sends
nothing upfront; an absent one keeps the default. This matters because a
server can be much larger than an agent needs: the IMAP one offers around
fifty tools, of which an assistant uses perhaps five.

The Agent Template Library edits this as a checkbox list of real tool names. It starts
no MCP servers, so it cannot ask one what it offers — instead the runner
records each server's tools into the shared MCP catalogue when it connects,
and the library reads them from there. A server that has never run shows no
tool list, and only the whole server can be chosen until it has.

### Team Runner — `server/src/`, port 3001

Everything it did before, minus what now belongs to the two services above. It
loads the active project definition from the Project Server, embodies the team,
runs meetings, tasks, the kanban board and MCP tools, and writes runtime changes
to the team back into the project definition.

It also serves the **Embodiment API**, the public contract described below.

The operator dashboard is unchanged and still lives at `http://localhost:3001`.

### Speech Service — `apps/speech-service`, port 3050

Owns text-to-speech: it discovers the Piper voice models, spawns one TTS server
per model, and renders text to audio with Rhubarb viseme timings.

It is a service rather than a library because it runs processes — see
[Why speech is a service](#why-speech-is-a-service) below.

### Embodiment API Test — `apps/embodiment-test`, port 3040

A deliberately minimal client that drives a team through the Embodiment API and
nothing else: roster, live state, conversation, voice and face. Its third panel
logs every request and every stream event, so the API is the visible output. If
this app can drive a team, so can any third party.

It reads the Agent Template Library for one thing only — so the roster lists every agent
that exists rather than just the handful the current project is running. A row
the runner has deployed is marked **live** and can be talked to; the rest still
show their avatar and play their voice. Both upstreams are optional, and neither
knows the other exists: the merge happens in the browser, on `templateId` where
the runner reports one and on the agent name otherwise.

Rendering an agent needs more than the model file. `/agents/{id}/avatar` returns
a GLB or VRM with no camera in it, so the roster carries an `appearance` block —
camera, rotation, field of view and scale, from the runner's avatar catalogue.
Without it a client can download the model and still have no idea where to put
the camera.

## Two places a voice can come from

An Embodiment client can let the server speak, or speak for itself. Both are
supported today and **neither needs a server change**, because speech over
this API is something a client asks for rather than something the runner
pushes: `agent_speech` is only broadcast in response to
`POST /agents/{id}/speech`. A client that wants the platform voice simply
never calls it, and reads the text off `agent_message` instead.

| | Server (Piper) | Device (Android / iOS) |
| --- | --- | --- |
| Lip sync | Real phoneme timings from Rhubarb | Approximate — see below |
| Latency | A round trip per sentence | Immediate |
| Offline | No | Yes |
| Voice | The one the operator configured, same on every client | Whatever the handset has |
| Cost | Server CPU and audio over the wire | Free |

The catch is lip sync, and it is worth being plain about. Piper gives audio
*and* phoneme timings. `AVSpeechSynthesizer` and Android's `TextToSpeech`
give audio and, at best, **word boundaries as they are spoken** —
`willSpeakRangeOfSpeechString` and `onRangeStart` respectively. Nothing
phoneme-level, and no way to get it.

So a device-speaking client has three options, in ascending order of effort:

1. **Send no visemes.** The renderer already falls back to a simple
   open-and-close oscillation, which reads as talking without matching.
2. **Drive the mouth from word boundaries**, opening on each word.
3. **Estimate mouth shapes from spelling** — which letters a word contains,
   spread across the time it takes to say it. `apps/poppyinyourpocket`
   does this in `lib/services/viseme_estimator.dart`: vowels hold the shape,
   consonants pass through, digraphs count once. English spelling is a poor
   guide to English sound, so it looks like an approximation under scrutiny —
   but it is markedly better than a mouth flapping at a fixed rate.

Whichever a client picks, the viseme format is the same one
`/agents/{id}/speech` returns, so the renderer does not care where the
timings came from.

## The contracts

`packages/contracts` holds the JSON Schemas, the OpenAPI documents and the
TypeScript mirrors. See [its README](../packages/contracts/README.md) for how to
change one.

| | Schema | Served live at |
| --- | --- | --- |
| Agent Template | `agent-template.schema.json` | `:3010/api/v1/schemas/agentTemplate` |
| Deployed Agent | `deployed-agent.schema.json` | `:3020/api/v1/schemas/deployedAgent` |
| Project Definition | `project.schema.json` | `:3020/api/v1/schemas/project` |

| API | Spec | Served live at |
| --- | --- | --- |
| Agent Template Library | `agent-library.openapi.yaml` | `:3010/api/v1/openapi.yaml` |
| Project Server | `project-server.openapi.yaml` | `:3020/api/v1/openapi.yaml` |
| Embodiment | `embodiment.openapi.yaml` | `:3001/api/embodiment/v1/openapi.yaml` |

## The Embodiment API

The contract between a running team and anything that wants to talk to it.
"Embodiment" is the whole surface of an agent as a presence: identity and hats,
live state, conversation threads, its face (GLB avatar, background) and its voice
(synthesised speech with viseme timings for lip sync).

```
GET  /api/embodiment/v1/agents                    the roster
GET  /api/embodiment/v1/agents/{id}               one agent
GET  /api/embodiment/v1/agents/{id}/threads       conversation threads
GET  /api/embodiment/v1/agents/{id}/messages      read a thread
POST /api/embodiment/v1/agents/{id}/messages      say something (202, async)
POST /api/embodiment/v1/agents/{id}/tasks         assign durable work
POST /api/embodiment/v1/agents/{id}/speech        speak in the agent's voice
GET  /api/embodiment/v1/agents/{id}/avatar        the GLB or VRM model
GET  /api/embodiment/v1/agents/{id}/background    the scene behind it
GET  /api/embodiment/v1/events                    SSE — everything, live
```

`{id}` is the deployed agent's `instanceId`; an agent's name is also accepted.

**Every endpoint is authenticated** — the runner guards all of `/api/*`.
Third-party clients send a static API key as `X-API-Key`, created in the
dashboard's Users tab or issued by the mobile pairing flow. A browser client
already signed into the dashboard may send its session token as a Bearer
token instead. The test harness reads its key from `HATS_API_KEY` and attaches
it server-side, so the secret never reaches the browser.

Messaging is asynchronous. `POST .../messages` accepts and returns immediately;
the reply arrives on `/events` as an `agent_message` and is appended to the
thread. Clients that prefer polling can read the thread instead, but the stream
is the intended path.

The stream vocabulary is deliberately narrower than the orchestrator's internal
event log — `hello`, `agent_state`, `agent_message`, `agent_speech`,
`project_update`, `heartbeat`. `src/embodiment/event-mapper.ts` translates
internal events into it, so the runner can grow new internal events without
changing what external clients see.

## Running it

```bash
npm run services      # library, project server, designer, embodiment test, speech
npm start             # the Team Runner, in another terminal
```

Or everything at once:

```bash
npm run services:all
```

Individually: `npm run agent-library`, `npm run project-server`,
`npm run project-designer`, `npm run embodiment-test`, `npm run speech-service`.

### First run

1. Open the Agent Template Library at <http://localhost:3010> and create a few agents.
2. Open the Project Designer at <http://localhost:3030>, create a project, set a
   goal, deploy agents into the team, and click **Set active**.
3. `npm start` — the runner loads the active project and embodies the team.
4. Open the Embodiment test harness at <http://localhost:3040> and talk to them.

## Service independence

Only the Team Runner needs a running team. The other three are independent of
it and of each other's runtime:

| Service | Depends on |
| --- | --- |
| Agent Template Library | nothing — templates, MCP catalogue, credentials and voice models are all on disk |
| Project Server | the Agent Template Library, and only to resolve a templateId when deploying. It reads the MCP catalogue file, as the runner and the library do |
| Project Designer | the Agent Template Library and Project Server, proxied |
| Embodiment API Test | the Team Runner — that is its whole purpose. It also reads the Agent Template Library, so the roster shows every agent and not just the deployed team; without it the roster is simply the live team |
| Speech Service | nothing — it owns the Piper processes |
| Team Runner | the Project Server, Agent Template Library and Speech Service, all optional |

Anything that needs a *running* agent — chat, speech synthesis — belongs to the
runner and is reached through `packages/ui-kit/embodiment-client.js`, the shared
browser client for the Embodiment API. A front-end that does not need a live
team simply does not import it, and so cannot acquire a dependency on the
runner by accident.

Voice and speaker *selection* is not such a case: it only reads the Piper model
files, so the Agent Template Library offers it with no service running at all. *Hearing*
a voice does need synthesis, which is the Speech Service's job.

### Why speech is a service

Piper binds a port per voice model. If both the Team Runner and the Agent
Library spawned their own, they would collide or double the memory — so exactly
one process owns them. `apps/speech-service` does, and everything else asks it.

Synthesis streams NDJSON, one chunk per sentence, flushed as each is rendered.
That preserves the property the avatars depend on: audio and lip movement start
on the first sentence rather than when the whole utterance is ready.

`packages/speech-core` holds what both sides need — the chunk and viseme types,
the Rhubarb-to-ARKit map, and voice model discovery — with no process spawning,
so a consumer that only wants to *name* voices imports it without pulling in
Piper or Rhubarb.

## Graceful degradation

Nothing in the split is mandatory. The runner probes both services at startup:

- **Project Server unreachable** → reads the project from the local folder, as before.
- **Agent Template Library unreachable** → falls back to the local `projects/agents.json`.
- **`--standalone` or `HATS_STANDALONE=1`** → skips both probes entirely.

So a single-machine install still works with nothing else started, and the split
is an upgrade rather than a new requirement.

## Where state lives

| State | Owner | Location |
| --- | --- | --- |
| Agent templates | Agent Template Library | `runtime_data/agent-library/templates/` |
| Project definitions | Project Server | `runtime_data/project-server/definitions/` |
| Active project pointer | Project Server | `runtime_data/project-server/active-project.json` |
| Conversation history, tasks, meetings | Team Runner | `<project>/team-state.json` |
| Users, sessions and API keys | Team Runner | `runtime_data/data/users.json` |
| Event log | Team Runner | `<project>/team-events.jsonl` |
| Kanban board | Team Runner | `<project>/kanban-board.json` |
| Per-agent MCP credentials | Team Runner | `<projects root>/agent-credentials.json` |

Credentials never leave the runner. `LibraryAgentStore` holds them back from the
Agent Template Library and keeps them in a local sidecar file, because a shared library is
the wrong place for a secret.

## Shared packages

| Package | What it is |
| --- | --- |
| `packages/contracts` | Schemas, OpenAPI documents, types, validators, factories |
| `packages/service-kit` | The HTTP shell each service runs in: router, SSE hub, JSON store, proxy, meta routes |
| `packages/clients` | Typed clients for the Agent Template Library and Project Server |
| `packages/ui-kit` | Shared CSS and browser helpers, served at `/ui-kit` by each UI |

These are plain source directories imported by relative path — there is no
workspace linking. `server/tsconfig.json` compiles the server together with the
packages it imports, so the built entry point is
`server/dist/server/src/team-runner.js`. `npm start` and every service run straight
off TypeScript through `tsx`.
