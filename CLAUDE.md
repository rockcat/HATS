# HATS

One repository for the whole system:

- the Team Runner: the server in `server/src/`, its dashboard in `apps/web/`;
- the services, one folder each in `apps/` (Agent Template Library, Project
  Server, runner manager, auth, speech and the rest);
- the shared packages in `packages/`, npm workspaces imported as `@hats/*`.

See `docs/README.md` to start, `docs/SERVICES.md` for how the parts fit
together, and `docs/repo-split.md` for why this was two repositories for a
while and is one again.

The mobile app, Poppy In Your Pocket, is private and lives in its own
repository. Keep it out of this one.

## APIs: keep the documents in step with the code

Every HTTP route is documented in an OpenAPI file in
`packages/contracts/openapi/`. When you add, rename or remove a route, or change
what it takes or returns, update its document in the same commit.

- **Runner routes** (`server/src/api/`, and the routers in `packages/auth/src/`)
  → `runner.openapi.yaml`. `server/src/api/runner-openapi.test.ts` fails if a
  route or method is in the code but not the document, or the other way round.
  It reads routes from source with `server/src/api/route-inventory.ts`, which
  only understands the forms listed at the top of that file. Write new routes
  in one of those forms, or the test cannot see them.
- **Embodiment API** (`server/src/embodiment/`) → `embodiment.openapi.yaml`. It
  is a public, versioned contract: don't break it; add instead.
- **Project Server and Agent Library** → their own documents. Change one only
  alongside the service it describes.
- Every operation needs a unique `operationId`. `packages/contracts` tests check
  this.
- Request bodies in the document should match the `JSON.parse(...) as {...}`
  type in the handler. The test checks paths and methods, not bodies, so check
  bodies yourself.
- If a change alters a call shown in `docs/API.md` (sign-in, `/api/cli`,
  tickets, uploads, `/events`, creating a team), update its example there too.

Every API can be browsed at `/api-docs` on a running runner, and tried out
there for the runner's own routes.

## Checks before committing

```bash
npx vitest run       # all tests, including the API document check
npm run typecheck
```

`npm run typecheck` already reports errors in some older test files. Make sure
your change adds none.
