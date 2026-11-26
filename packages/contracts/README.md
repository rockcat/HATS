# @hats/contracts

The formal interfaces between the HATS services. Everything in here is a
contract that more than one application depends on — change it deliberately.

```
schemas/     JSON Schema (draft 2020-12) — the runtime source of truth
openapi/     OpenAPI 3.1 documents, one per service
src/types.ts TypeScript mirrors of the schemas
src/factories.ts  Constructors that produce valid documents
src/validate.ts   Ajv-backed validators
```

## The three documents

| Document | Schema | Owner | Meaning |
| --- | --- | --- | --- |
| **Agent Template** | `agent-template.schema.json` | Agent Template Library | A reusable agent, independent of any project. |
| **Deployed Agent** | `deployed-agent.schema.json` | Project Server | That agent as it exists inside one project — fully resolved. |
| **Project Definition** | `project.schema.json` | Project Server | Objective, team roster and shared tools. No runtime state. |

A deployed agent is a *copy*, not a reference. Deleting a template never breaks a
running project; it just means the project can no longer be re-synced from it.
`templateRevision` records which revision the copy was taken from, which is how
the Project Designer shows drift.

## The four APIs

| Service | Document | Default |
| --- | --- | --- |
| Agent Template Library | `openapi/agent-library.openapi.yaml` | `http://localhost:3010` |
| Project Server | `openapi/project-server.openapi.yaml` | `http://localhost:3020` |
| Embodiment API | `openapi/embodiment.openapi.yaml` | `http://localhost:3001/api/embodiment/v1` |
| Team Runner (dashboard) | `openapi/runner.openapi.yaml` | `http://localhost:3001/api` |

Each service serves its own spec live at `<base>/openapi.yaml` (and
`/openapi.json`), and every schema at `<base>/schemas/{name}`. Point a code
generator at a running service and it will match what that service actually does.

The Team Runner's document is the exception: it is served at
`/api/openapi/runner.yaml`, and `server/src/api/runner-openapi.test.ts` fails
when it and the runner's routes disagree. `/api-docs` on a runner shows all
four in one page.

## Changing a contract

1. Edit the JSON Schema — it is what validates at runtime.
2. Mirror the change in `src/types.ts`.
3. Update the affected OpenAPI document.
4. Add or update the example in the schema's `examples` array.
5. Run `npm test` — `contracts.test.ts` checks the examples validate, the
   TypeScript enums match the schema enums, and every operation has a unique
   `operationId`.

Bump `schemaVersion` only for a breaking change, and add a migration where
documents are loaded.

## Validation

Services validate on the way in *and* on the way out of storage:

```ts
import { validateProject } from '@hats/contracts';

const result = validateProject(document);
if (!result.valid) return badRequest(res, 'Invalid project', result.errors);
```

Errors come back as `{ path, message }` pairs and are returned to clients in the
`details` array of the standard error body, so a UI can point at the bad field.
