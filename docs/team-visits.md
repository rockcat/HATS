# Agents visiting other teams

**Status:** phase 0 is built. Of phase 1, the first step is built: `home` on
agents, the visit policy, tags and summary in the Designer, team cards in
report-ins, and `discover_teams`. The rest of phase 1, and phase 2, are
design.

Every agent belongs to a **home team**. When its work needs tools or knowledge
its home team lacks, it can **visit** another team that has them, do that
piece of work there, and come home with the result.

A visit always serves the home team's work. It starts from a ticket on the
home team's board, which is the **reason** for going, and it ends by
delivering a **result** to that ticket. No reason, no visit; no visit ends
without a result, even if the result is "this could not be done, because…".

Teams say what they offer and whom they host. Visits happen only between
teams that have approved each other, and an agent copes when its host lacks
something its home has. Moving an agent permanently to another team is still
possible, but only an admin can do it.

It is built in three phases:

| Phase | Covers | Depends on |
| --- | --- | --- |
| 0. Change notices and announcements | Team changes reach runners in about a second, and the team is told who joined, left, went visiting or came back | Nothing |
| 1. Local network | Teams in one installation, on one or more machines, discover each other and host visits | Phase 0 |
| 2. Internet | Teams in separate installations, run by different people, do the same | Phase 1 |

Phase 1's protocol is shaped so that phase 2 extends it rather than replacing
it: the same visit record, states, travel pack and result, with the
coordination split between two installations instead of held by one.

## Terms

- **Team**: one project and the runner holding it. Teams, not runners, are
  what policies and cards name, because runners are started and stopped.
- **Installation**: one set of services (Agent Template Library, Project
  Server, auth service, runner manager) and the runners that use them.
- **Home team**: the team an agent belongs to. It is set when the agent is
  created and changed only by an admin.
- **Host team**: the team an agent is visiting.
- **Visit**: a stay at a host team to do one piece of home-team work.
- **Reason**: the home-team ticket a visit serves, and the result it needs.
- **Result**: what the visit produced, delivered to that ticket.
- **Travel pack**: what the agent takes with it, out and back.
- **Team card**: a short public description of a team, used to find it.
- **Move**: a permanent change of home team, by an admin.

## What exists today

| Piece | Where | Used for |
| --- | --- | --- |
| Live team sync | `hats-runner/server/src/project/project-sync.ts`, `team-reconcile.ts` | A runner applies changes to its project's saved team within 5 seconds, without restarting agents. Leaving home, arriving and returning are each one such change. |
| Runner registry | `apps/runner-manager` | Every runner reports in every 30 seconds with its project and address. Becomes the team-card registry. |
| Agent bundle | `hats-runner/server/src/agent-transfer/` | Captures an agent's settings, threads, own folder (memory, calendar), agenda and avatar; credentials optional. Becomes the travel pack. Restore always issues a new id. |
| The board | Each project's kanban | Tickets are the reasons for visits, and where results are delivered. |
| Removing an agent cleanly | `AgentRouter.retireAgent` | Returns its open tickets to the backlog. Used for permanent moves. |
| Per-agent credentials kept local | `AgentDefinitionStore.secretsFor` | Personal MCP logins never enter the shared project definition. They stay at home. |
| Embeddings | `hats-runner/server/src/people/embedder.ts` | Available for searching cards by meaning. |

Today, calling a tool the agent does not have returns `Unknown tool: <name>`
(`tool-executor.ts`) or `Tool <name> not connected.` (`agent.ts`). Phase 1
replaces both with a useful explanation.

---

## Phase 0: change notices and announcements

Built: the stream is `apps/project-server/src/routes/events.ts`; the runner
follows it in `project-sync.ts`; the news is written in `team-news.ts`, held
by each agent with `notice()`, and shown on the dashboard by
`apps/web/modules/team-news.js`.

### Push instead of polling

The Project Server publishes a stream, `GET /api/v1/events` (server-sent
events), carrying `{ type: "project_changed", id, revision }` on every save.
Each runner subscribes for its own project and pulls the new revision
immediately. The 5-second check stays as a fallback, slowed to 60 seconds,
for when the stream drops.

### Telling the team

Today a member added in the Designer simply appears. Instead, applying a
change emits team events:

- `member_joined` and `member_left`: name, hats, specialisation.
- `member_changed`: name and what changed, for a rename, new hats or a new
  model.
- From phase 1: `member_visiting` and `member_returned` at home, and
  `visitor_arrived` and `visitor_left` at the host, each with the reason.

Each agent holds them and reads them at the start of its next turn, as "Team
news since your last turn", so the team knows who is here and why without
anyone being woken: telling every agent at once would cost a model call
each. They are recorded in the team's event log as `team_news`, and shown on
the dashboard as a notice.

---

## Phase 1: local network

One installation. Its teams may run on several machines, but they share one
Project Server, one auth service and one runner manager.

### Home teams

Every member's saved definition records its `home`. While the agent is away:

- its home keeps its place: the member stays in the home team's definition,
  marked `away` with the visit id, and its name stays reserved;
- its scheduled actions are suspended, not cancelled, and resume on return;
- its home-team tickets stay assigned to it, the reason ticket shown as
  being worked on at the host team;
- the home dashboard shows it as visiting, with the reason, and offers
  **Recall**.

An agent visits one team at a time, and cannot visit onwards from a host.

### The reason and the result

An agent asks to visit with:

```text
request_visit(team, ticket, purpose, expected_result)
```

- `ticket` must be a home-team ticket assigned to the agent and not closed.
  That is what makes the visit the home team's work.
- `purpose` says what it will do there; `expected_result` says what it will
  bring back.
- The host sees all of it before approving, so the host admin knows why a
  visitor wants to come.

At the host, the visit gets a ticket on the host's board, linked to the home
ticket, so the host team can see what its visitor is doing and help.

A visit ends by delivering a result to the home ticket:

| Field | Holds |
| --- | --- |
| `outcome` | `done`, `partial` or `failed` |
| `summary` | What was done, and what was learned |
| `outputs` | Files and other artefacts, attached to the ticket |
| `remaining` | What is still to do, for `partial` and `failed` |
| `reason` | Why it is not `done`, when it is not |

A failed visit with a clear reason is a result. It tells the home team
something it needs to know.

### When a visit ends

Whichever comes first:

1. **The result is ready.** The agent calls `finish_visit(result)`.
2. **The reason is gone.** The home ticket is closed or reassigned at home.
3. **The time limit passes.** Set by the home team's policy, and capped by
   the host's.
4. **The budget is spent.** A visit spends from the agent's own hourly cost
   limit, charged to its home team, with an optional cap per visit.
5. **Home recalls it.** An admin of the home team clicks Recall.
6. **The host ends it.** An admin of the host team ends the visit, or the
   host runner stops.

In cases 2 to 6 the agent is given a short time to write its result before
it leaves; whatever it has by then is delivered as `partial` or `failed`.

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
| `hosting` | Whether it currently accepts visitors, from its policy |
| `dashboard` | Its runner's address |

A card is a few hundred tokens at most. Full tool schemas stay on the team.

### Policy: who may visit where

Each project's saved settings gain a visit policy, edited in the Designer:

```json
"visits": {
  "visitTo":     ["research", "ops"],
  "hostFrom":    ["research"],
  "approval":    "admin",
  "maxHours":    4,
  "memoryHome":  "summary"
}
```

- `visitTo` and `hostFrom` are empty by default, so nothing moves unless
  allowed. `"*"` means any team in the installation and has to be chosen on
  purpose.
- A visit from A to B needs B in A's `visitTo` **and** A in B's `hostFrom`.
- `approval` is the host's: `auto` (any allowed visit goes ahead) or `admin`
  (an admin of the host approves each one).
- `maxHours` caps visits, out from this team or into it.
- `memoryHome` is the host's rule for what visitors take home from it: `all`,
  `summary` (only what is in the result) or `none`.
- The Project Server checks the policy when a visit is requested **and again
  on arrival**, since either team's policy may change in between.

The policy lives in the project, not in a runner's settings. So it applies to
whichever runner holds the project, and it is checked in one place.

Agents can only ask to visit. Changing an agent's home is a **move**, which
only an admin can make: from the home team's dashboard, between teams that
allow it, by the same steps without a return.

### Discovery

Agents get one tool, `discover_teams(intent)`. The runner asks the runner
manager, which:

1. keeps only teams this agent could visit: in its home's `visitTo`, with its
   home in their `hostFrom`, and hosting;
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

A visit request adds what the purpose needs. Then:

- **Before going.** The request is checked against the host's card. A
  missing `required` tool refuses the visit. A missing `preferred` tool is
  listed in the request's preview, and the agent decides.
- **On arrival.** The agent's first message at the host says what it has and
  what it lost: "Available here: … Not available here: web-search (your home
  has it)."
- **During work.** Calling a tool the agent does not have returns an
  explanation, never an error that ends the turn: "web-search is not
  available on this team. Your home team has it: note it in your result's
  remaining work." Saved tool preferences naming servers this team lacks are
  ignored rather than failing.
- **Models.** If the agent's model provider is not on the host's card, it
  runs on the host's default model and the arrival message says so, unless
  `models.required` is set, which refuses the visit.
- **Asking instead of visiting.** Often an agent only needs one answer from
  another team. A later tool, `ask_team(team, question)`, sends a request to
  a member there, under the same policy. It is usually the better choice,
  and the visit tool's description says so.

### The travel pack

Built from the existing agent bundle.

**Going out:**

- the agent's settings and memory;
- the reason: the home ticket, its history summarised, the purpose and the
  expected result;
- not its credentials, which stay at home and are reattached on return;
- not its raw threads, which stay at home with its place.

The agent keeps its identity: the pack carries its instance id, where a
restored bundle would get a new one. The home keeps a copy of the outgoing
pack until the agent is back.

**Coming home:**

- the result;
- what it learned there, filtered by the host's `memoryHome`, merged into
  its home memory and tagged with where it came from.

### The visit itself

The Project Server coordinates, since it holds both teams' projects. Each
visit is a record with an id, so every step can be retried without creating
a second copy of the agent.

```text
requested ─► approved ─► packed ─► visiting ─► returning ─► home
     │           │          │
     └───────────┴──────────┴──► cancelled   (the agent never left)
```

1. **Request.** The agent calls `request_visit`. The home runner checks the
   ticket and its own policy, then asks the Project Server, which checks both
   policies and the requirements, and records the visit as `requested`.
2. **Approve.** Automatic, or by an admin of the host from its dashboard.
3. **Pack.** The home runner lets the agent finish its current turn, stops
   giving it new work, suspends its scheduled actions, and uploads its
   outgoing pack.
4. **Arrive.** In one write, the Project Server marks the member `away` at
   home and adds it to the host as a visitor. Both runners apply the change
   through the live sync: the host embodies the agent from its pack and opens
   the linked host ticket; the home retires the live agent but keeps its
   place. The visit is `visiting`.
5. **Return.** When the visit ends, the host runner gives the agent its time
   to write a result, then uploads the returning pack. The visit is
   `returning`.
6. **Home.** In one write, the Project Server removes the visitor from the
   host and clears `away` at home. The home runner embodies the agent from
   its place and the returning pack, merges its memory, resumes its
   scheduled actions, and attaches the result to the home ticket. The host
   closes its linked ticket. The visit is `home`, and its packs are deleted.

Up to step 4, cancelling leaves the agent at home, which resumes it. If the
host runner stops during a visit and does not come back within the time
limit, the home restores the agent from the outgoing pack it kept. Whatever
the agent learned at the host is lost, and the result is `failed`, with the
reason "the host team stopped".

### Securing it on a network

Teams on other machines talk to the services over the network, so:

- **Report-ins are authenticated.** Today the runner manager accepts them
  without a login, safe only because its port is not published. Each runner
  gets a runner token, issued by the manager to runners it launches and set
  in `.env` for others.
- **Traffic is encrypted**, through a reverse proxy with TLS in front of the
  services.
- Every visit is recorded on the Project Server, with its reason and result,
  and visible in both teams' dashboards.

---

## Phase 2: internet

Separate installations, possibly run by different people, connected over the
internet. They share no Project Server, sign-in or registry. Home teams
matter most here: an agent visiting another organisation stays yours, you can
recall it, and the host cannot keep it.

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
`/.well-known/hats/teams.json`, filtered to the teams that host visitors from
that peer, in the manner of A2A's `agent.json`. Gateways fetch their peers'
cards periodically, and `discover_teams` searches local and peer cards alike.
There is no central registry and no hub to run.

### The visit across installations

The same record, states, packs and result, with coordination split between
the two gateways instead of held by one Project Server:

1. **Offer.** The home gateway sends a signed offer: the agent's card, the
   reason, its requirements and the visit id.
2. **Reserve.** The host gateway checks the peer, its policy and the
   requirements, gets approval, and replies with a signed reservation.
3. **Go.** The home packs the agent and sends the pack; the host confirms
   receipt and the agent arrives. The home marks it `away`.
4. **Return.** When the visit ends, the host sends the result and the
   returning pack, filtered by its `memoryHome`, and confirms the visitor
   has left.
5. **Home.** The home confirms receipt and clears `away`.

Each step is idempotent by visit id, and each has a timeout. A recall is a
signed message from the home gateway, which the host must act on within its
grace period. If the host stops answering, the home restores the agent from
the outgoing pack after the time limit, as in phase 1.

### Data crossing between owners

- **Outgoing:** the home admin sees exactly what leaves before it goes. With
  `approval` set to `admin`, the home approves visits to peers too, not only
  the host approving incoming ones. The reason's ticket history goes as a
  summary, reviewed rather than sent raw.
- **Returning:** the host's `memoryHome` decides what comes back. Between
  organisations, `summary` is the sensible default: the result is what the
  home asked for, and the host's other data stays with the host.
- A team can allow a peer's agents to `ask_team` while refusing visits, which
  keeps everyone's agents and data at home.
- **Cost:** a visitor runs on the host's model keys. The host's policy caps
  what a visit may spend, and the visit record shows what it cost.

---

## Open questions

1. **Pausing an agent.** Packing needs an agent that finishes its turn and
   then takes no new work. The runner has cost-idling and disengaging, but no
   "travelling" state yet.
2. **The reason changing.** If the home ticket is edited while the agent is
   away, is the visitor told, and may it change its purpose?
3. **Outputs.** How large may a result's outputs be, and are they always
   files on the ticket, or can they be changes to the home team's own tools
   (a database row, a document)?
4. **Helping at the host.** May a visitor take other host tickets while it
   is there, or only its own linked one?
5. **Card freshness.** Cards update with report-ins every 30 seconds. The
   request re-checks `hosting`, and arrival re-checks the policy; is that
   enough?
6. **Phase 2 cost.** Should a visit across installations always run on the
   host's model keys, or may the home pay with its own?
7. **Phase 2 key rotation and revocation**: how a peer replaces a key, and
   how an installation withdraws trust from one.

## Order of work

1. Phase 0: change notices, then team announcements. *Built.*
2. Phase 1: `home` on every agent, team cards in report-ins, the visit policy
   in the Designer, and `discover_teams` (read-only, so safe to ship first).
   *Built.* `home` is recorded but nothing sets it yet: until visits exist,
   every agent's home is the project holding it. The runner manager answers
   `GET /api/v1/teams` without a sign-in, as it does report-ins, until step 4
   authenticates both. Until then `discover_teams` tells the agent to take
   what it found to the human.
3. Phase 1: requirements and the missing-tool messages. Useful on their own,
   since a tool can disappear from a team without any visit.
4. Phase 1: the visit record, reason and result, travel packs, approval,
   recall and the return; then permanent moves for admins; then
   authenticated report-ins.
5. Phase 2.
