# Agents moving between teams

**Status:** design. Nothing here is built yet except where it says "exists".

An agent can find another team that has the tools or knowledge it needs, ask
to move there, and carry on its work after arriving. Teams say what they offer
and who they accept. Moves happen only between teams that have approved each
other, and an agent copes when its new team lacks something its old one had.

It is built in three phases:

| Phase | Covers | Depends on |
| --- | --- | --- |
| 0. Change notices and announcements | Team changes reach runners in about a second, and the team is told who joined or left | Nothing |
| 1. Local network | Teams in one installation, on one or more machines, discover each other and move agents | Phase 0 |
| 2. Internet | Teams in separate installations, run by different people, do the same | Phase 1 |

Phase 1's protocol is shaped so that phase 2 extends it rather than replacing
it: the same transfer records, states and travel pack, with the coordination
split between two installations instead of held by one.

## Terms

- **Team**: one project and the runner holding it. Teams, not runners, are
  what policies and cards name, because runners are started and stopped.
- **Installation**: one set of services (Agent Template Library, Project
  Server, auth service, runner manager) and the runners that use them.
- **Transfer**: one agent moving from a **source** team to a **target** team.
- **Travel pack**: what the agent takes with it.
- **Team card**: a short public description of a team, used to find it.

## What exists today

| Piece | Where | Used for |
| --- | --- | --- |
| Live team sync | `hats-runner/server/src/project/project-sync.ts`, `team-reconcile.ts` | A runner applies changes to its project's saved team within 5 seconds, without restarting agents. A transfer's commit is one such change. |
| Runner registry | `apps/runner-manager` | Every runner reports in every 30 seconds with its project and address. Becomes the team-card registry. |
| Agent bundle | `hats-runner/server/src/agent-transfer/` | Captures an agent's settings, threads, own folder (memory, calendar), agenda and avatar; credentials optional. Becomes the travel pack. Restore always issues a new id. |
| Removing an agent cleanly | `AgentRouter.retireAgent` | Returns its open tickets to the backlog. Used when an agent leaves. |
| Per-agent credentials kept local | `AgentDefinitionStore.secretsFor` | Personal MCP logins never enter the shared project definition. They do not travel. |
| Embeddings | `hats-runner/server/src/people/embedder.ts` | Available for searching cards by meaning. |

Today, calling a tool the agent does not have returns `Unknown tool: <name>`
(`tool-executor.ts`) or `Tool <name> not connected.` (`agent.ts`). Phase 1
replaces both with a useful explanation.

---

## Phase 0: change notices and announcements

### Push instead of polling

The Project Server publishes a stream, `GET /api/v1/events` (server-sent
events), carrying `{ type: "project_changed", id, revision }` on every save.
Each runner subscribes for its own project and pulls the new revision
immediately. The 5-second check stays as a fallback, slowed to 60 seconds,
for when the stream drops.

### Telling the team

Today a member added in the Designer simply appears. Instead, applying a
change emits team events:

- `member_joined`: name, hats, specialisation, and where it came from (the
  Designer, or a transfer from another team).
- `member_left`: name, and where it went, if anywhere.
- `member_changed`: name and what changed, for a rename, new hats or a new
  model.

They are posted to the team's general thread, so the other agents learn who
arrived and what they are for, and shown on the dashboard as a notice.

---

## Phase 1: local network

One installation. Its teams may run on several machines, but they share one
Project Server, one auth service and one runner manager.

### Team cards

Each runner builds its team's card from the project definition and its live
state, and sends it with its report-in. The runner manager keeps the latest
card for each team.

| Field | From |
| --- | --- |
| `team` | Project id |
| `name`, `summary` | Project name; one or two sentences, defaulting to the goal |
| `tags` | Set in the Designer, such as `billing`, `postgres`, `research` |
| `members` | Names, hats and specialisations |
| `tools` | Each team MCP server's name and one-line description: not tool schemas |
| `models` | Model providers this team can run |
| `accepting` | Whether it currently accepts members, from its policy |
| `dashboard` | Its runner's address |

A card is a few hundred tokens at most. Full tool schemas stay on the team.

### Policy: who may move where

Each project's saved settings gain a transfer policy, edited in the Designer:

```json
"transfer": {
  "sendTo":     ["research", "ops"],
  "acceptFrom": ["research"],
  "approval":   "admin"
}
```

- Both lists are empty by default, so nothing moves unless allowed. `"*"`
  means any team in the installation and has to be chosen on purpose.
- A move from A to B needs B in A's `sendTo` **and** A in B's `acceptFrom`.
- `approval` is `auto` (any allowed move goes ahead) or `admin` (an admin of
  the target team approves each one).
- The Project Server checks the policy when a transfer is requested **and
  again at commit**, since either team's policy may change in between.

The policy lives in the project, not in a runner's settings. So it applies to
whichever runner holds the project, and it is checked in one place.

### Discovery

Agents get one tool, `discover_teams(intent)`. The runner asks the runner
manager, which:

1. keeps only teams this agent could move to: in its team's `sendTo`, with
   its team in their `acceptFrom`, and accepting;
2. ranks them against `intent` by tags and words, or by meaning where
   embeddings are configured;
3. returns the top three cards.

An agent never sees a team it cannot reach. That saves tokens, and removes
the target a prompt injection would try to steer it towards.

### Requirements, and missing tools and models

A member's saved definition gains what it depends on, set in the Designer:

```json
"needs": {
  "tools":  { "required": ["postgres"], "preferred": ["web-search"] },
  "models": { "required": false }
}
```

An agent can add `preferred` entries when it asks to move. Then:

- **Before moving.** The transfer request is checked against the target's
  card. A missing `required` tool refuses the move. A missing `preferred`
  tool is listed in the request's preview, and the agent decides.
- **On arrival.** The agent's first message on the new team says what it has
  and what it lost: "Available here: … Not available here: web-search (you
  had it on research)."
- **During work.** Calling a tool the agent does not have returns an
  explanation, never an error that ends the turn: "web-search is not
  available on this team. Research has it: ask a member there, or mark this
  step blocked." Saved tool preferences naming servers this team lacks are
  ignored rather than failing.
- **Models.** If the agent's model provider is not on the target's card, it
  runs on the target's default model and the arrival message says so, unless
  `models.required` is set, which refuses the move.
- **Asking instead of moving.** Often an agent only needs one answer from
  another team. A later tool, `ask_team(team, question)`, sends a request to
  a member there. It respects the same policy and is usually the better
  choice.

### The travel pack

Built from the existing agent bundle, with three differences:

- **Credentials never travel.** On arrival the agent has the target team's
  tools plus any logins granted there.
- **Threads travel as a summary**, not raw history: open work, its plan, and
  what it was waiting on. Raw history is large and carries the source team's
  context into the target.
- **The agent keeps its identity.** Restore normally issues a new id. A
  transfer keeps the instance id, and records the transfer id it arrived by.

Memory travels whole in phase 1: both teams belong to the same owner. Phase 2
narrows this.

### The transfer itself

The Project Server coordinates, since it holds both teams' projects. Each
transfer is a record with an id, so every step can be retried without
creating a second copy of the agent.

```text
requested ─► approved ─► packed ─► committed ─► arrived
     │           │          │
     └───────────┴──────────┴──► cancelled   (the agent stays where it was)
```

1. **Request.** The agent calls `request_transfer(team, reason)`. The source
   runner checks its own policy, then asks the Project Server, which checks
   both policies and the agent's requirements, and records the transfer as
   `requested`.
2. **Approve.** Automatic, or by an admin of the target team from its
   dashboard. The transfer becomes `approved`.
3. **Pack.** The source runner lets the agent finish its current turn, stops
   giving it new work, returns its open tickets to the backlog, and uploads
   its travel pack. The transfer becomes `packed`. The agent is still on the
   source team, paused, until the commit.
4. **Commit.** In one write, the Project Server removes the member from the
   source team and adds it to the target team. The transfer becomes
   `committed`. Both runners apply the change through the live sync: the
   target embodies the agent from its travel pack, and the source retires the
   paused agent.
5. **Arrive.** The target runner confirms. The transfer becomes `arrived`,
   both teams are told (phase 0's events), and the travel pack is deleted.

Up to the commit, cancelling leaves the agent on its source team, which
resumes it. After the commit, a target that fails to embody the agent retries
from the travel pack, which the Project Server keeps until `arrived`.

### Securing it on a network

Teams on other machines talk to the services over the network, so:

- **Report-ins are authenticated.** Today the runner manager accepts them
  without a login, safe only because its port is not published. Each runner
  gets a runner token, issued by the manager to runners it launches and set
  in `.env` for others.
- **Traffic is encrypted**, through a reverse proxy with TLS in front of the
  services.
- Every transfer is recorded on the Project Server and visible in both teams'
  dashboards.

---

## Phase 2: internet

Separate installations, possibly run by different people, connected over the
internet. They share no Project Server, sign-in or registry, so four things
change.

### Installation identity and peers

- Each installation has a signing key pair, created at install.
- Each keeps a **peer list**: a name, a gateway address and the public key it
  trusts for that peer. It is set up by an admin, never learned automatically.
- Policies name remote teams as `team@peer`, such as `research@acme`.

### The gateway

Each installation exposes one public endpoint, a new **gateway** service
behind a reverse proxy or a tunnel. Home and office networks do not accept
incoming connections, and runners themselves are never exposed. All traffic
between installations goes gateway to gateway, signed and over TLS.

### Discovery

Each gateway publishes its signed team cards at
`/.well-known/hats/teams.json`, filtered to the teams that accept members
from that peer, in the manner of A2A's `agent.json`. Gateways fetch their
peers' cards periodically, and `discover_teams` searches local and peer cards
alike. There is no central registry and no hub to run.

### The transfer across installations

The same record and states, with coordination split between the two gateways
instead of held by one Project Server:

1. **Offer.** The source gateway sends a signed offer: the agent's card, its
   requirements and the transfer id.
2. **Reserve.** The target gateway checks the peer, its policy and the
   requirements, gets approval, and replies with a signed reservation.
3. **Pack and send.** The source packs the agent as in phase 1 and sends the
   pack. The target stores it and confirms receipt.
4. **Release.** The source commits: the member leaves the source team.
5. **Arrive.** The target commits: the member joins, and it confirms.

Each step is idempotent by transfer id, and each has a timeout. Before the
release, either side can cancel and the agent stays home. After it, the
target holds the pack and retries until the agent arrives.

### Data leaving the installation

A travel pack crossing to another owner may carry the source team's data.

- The source admin sees exactly what leaves before it goes. With `approval`
  set to `admin`, the source approves outgoing moves to peers too, not only
  the target approving incoming ones.
- Memory is filtered: entries tagged as belonging to the source team stay
  behind, and the summary of open work is reviewed rather than sent raw.
- A team's policy can allow peers to ask its members questions
  (`ask_team`) while refusing transfers, which keeps the agents and their
  memory at home.

---

## Open questions

1. **Pausing an agent.** Step 3 needs an agent that finishes its turn and
   then takes no new work. The runner has cost-idling and disengaging, but no
   "travelling" state yet.
2. **Who may ask to move.** Should any agent be able to call
   `request_transfer`, or only those whose definition allows it?
3. **Scheduled actions.** Do an agent's scheduled actions travel with it,
   stay behind cancelled, or move only if the target accepts them?
4. **Coming back.** Is a return an ordinary transfer, or does the source keep
   a place for a while?
5. **Card freshness.** Phase 1 cards update with report-ins every 30
   seconds. Is that fast enough for `accepting` to be trusted, or should the
   request step re-check it? (The design re-checks at commit regardless.)
6. **Phase 2 key rotation and revocation**: how a peer replaces a key, and
   how an installation withdraws trust from one.

## Order of work

1. Phase 0: change notices, then team announcements.
2. Phase 1: team cards in report-ins, the policy in the Designer, and
   `discover_teams` (read-only, so safe to ship first).
3. Phase 1: requirements and the missing-tool messages. Useful on their own,
   since a tool can disappear from a team without any transfer.
4. Phase 1: the transfer record, travel pack, approval and commit; then
   authenticated report-ins.
5. Phase 2.
