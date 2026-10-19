# Splitting the Team Runner

*Written 19 October 2026, while deciding where to cut.*

## What the runner is today

One process doing eight jobs:

1. **Running the team** — orchestrator, agents, LLM calls, MCP registry, tool
   execution, team state.
2. **Scheduling** — the agenda runner, meeting runner, meeting rooms,
   scheduled meetings.
3. **Project working data** — kanban board, human requests, email allowlist,
   outputs, telemetry history.
4. **Identity** — users, sessions, API keys, Google OAuth (shared and
   per-agent).
5. **Configuration** — MCP catalogue, providers, pricing, env.
6. **The Embodiment API** — the external contract other clients are built on.
7. **The dashboard** — about 5,000 lines of browser modules covering all of
   the above.
8. **Proxies** — speech, avatars, images.

`api-server.ts` constructs fifteen subsystems in one constructor. That is the
symptom; the cause is that four unrelated lifetimes share a process.

## The line is lifetime, not feature

"Split out Kanban and Calendar" sounds right and is half wrong, because each of
those names covers two different things.

**The meeting scheduler is not project data.** `agenda-runner.ts`,
`meeting-runner.ts`, `meeting-room.ts` and `scheduled-meetings.ts` live in the
orchestrator and drive agents. Firing a standup at 09:00 and running the
conversation *is* running the team. Moving it out splits the runner in half.
The per-agent `.ics` diaries added in October are the opposite: inert files
nobody acts on automatically.

**The board is genuinely both.** Tickets are data a UI reads, and also a work
queue the runner acts on:

```ts
// kanban-manager.ts
if (ticket.column === 'in_progress' && ticket.assignee) {
  await this.dispatchTicket(ticket);
}
```

So the useful grouping is by how long a thing should live, not by what it is
called:

| Lifetime | What | Where it should be |
| --- | --- | --- |
| **Ephemeral** — restarted constantly | live agents, orchestration, MCP registry, the scheduler, Embodiment API | Team Runner |
| **Durable** — should outlive a restart | board, diaries, human requests, allowlist, outputs, telemetry history | **Workspace** (missing) |
| **Configuration** — rarely changes | agent templates, project definitions, credentials | Agent Library (3010), Project Server (3020) |

The third row already exists. The gap is the second.

## So: how many parts?

Not three new ones. There are already six services; the system is short of a
**workspace**, not a third tier.

- **Team Runner** keeps agents, orchestration, scheduling and the Embodiment
  API. It sheds the dashboard and the project-data APIs.
- **Workspace** (new) owns the durable data and hosts the kanban and calendar
  MCP servers over HTTP, so agents reach them as MCP and a UI reads them
  directly.
- **Two UIs**, split the way the work splits: an ops console for managing the
  runner, and a project view for looking at the work.

The payoff is concrete rather than architectural: **restarting the runner stops
taking the board and calendar offline.** During a week of development that
happens many times a day.

## What will be awkward

- **Auth across two UIs.** Two front-ends need one session. This is the
  genuinely fiddly part of any split like this and should be designed before
  the second UI ships, not after.
- **The dispatch loop inverts.** Today the runner owns the board file and
  reads it. Afterwards it has to subscribe to board changes instead.
- **More processes.** Six becomes seven or eight. `npm run services` already
  manages this, but every extra one is another thing that can be down.

## The order to do it in

**Split the UI first, leave the server alone.** It is reversible — delete a
folder — and it finds the seam empirically rather than by argument: whatever
API surface the project view ends up calling *is* the workspace's API.

That surface, measured from the existing dashboard modules rather than
guessed:

```
/api/kanban/tickets                      board
/api/kanban/tickets/{id}
/api/kanban/tickets/{id}/comments
/api/scheduled-meetings                  calendar
/api/scheduled-meetings/{id}/launch
/api/scheduled-meetings/{id}/cancel
/api/meetings/{id}/minutes
/api/project/files                       outputs
/api/project/file?path=
/api/human-requests/answered             requests
/api/human-requests/{id}/respond
/api/email-allowlist                     allowlist
/api/telemetry                           cost and usage
```

Plus these live events: `kanban_update`, `scheduled_meetings_update`,
`requests_update`, `files_update`, `email_allowlist_update`,
`telemetry_update`, and the `meeting_*` family.

Thirteen endpoints and seven event types. That is the workspace's contract,
and it is small enough to be worth extracting.

## Status

- [x] Measure the surface (above).
- [x] Project view as its own app, against the existing runner API.
- [ ] Ops console — the dashboard minus the project panels.
- [ ] Shared sessions across both UIs.
- [ ] Workspace service owning the durable data.
- [ ] Invert the dispatch loop.
