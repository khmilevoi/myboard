# E2E Docker Container Design

## Problem

The main Playwright e2e suite (`packages/client/playwright.config.ts`) starts its
own `test-server` and Vite preview via `webServer` entries, but
`reuseExistingServer: !process.env['CI']` means a locally running dev or
production stack (`docker-compose.dev.yml` / `docker-compose.yml`, ports
8787/5173/8080) gets reused instead of a fresh server. When that happens, the
suite runs against the developer's real local Valkey data instead of a clean
state, causing collisions and flaky/incorrect results.

We want a container that runs the main e2e suite in full isolation from the
host's dev/prod stack, while still exercising the real storage engine and SSE
fan-out (not the in-memory stand-in), backed by a temporary, disposable
database.

## Non-goals

- The `nginx-smoke.spec.ts` suite (`playwright.nginx.config.ts`) is out of
  scope; it already has its own manual `docker compose up --build -d` +
  `test:e2e:nginx` workflow and is not touched here.
- No GitHub Actions / CI pipeline is being added in this change. The container
  is built to work equally well from a future CI job, but wiring that up is a
  separate task.
- No change to `index.ts` (the production server entry). It still never
  imports `test-server.ts` or exposes `/api/test/*`.

## Design

### 1. `test-server.ts` becomes Valkey-backed

`packages/server/src/test-server.ts` currently uses `createMemoryOps()` /
`createMemoryPubSub()` (see `packages/server/src/test/memory-ops.ts`). This
change swaps those for the same primitives the production entry uses:

- `createValkeyOps()` and `createValkeySubscriber('storage:events', onMessage)`
  from `packages/server/src/storage/valkey.ts`, both already parameterized by
  `VALKEY_URL` (default `redis://localhost:6379`).
- `createValkeyOps` gains a `clear()` method (implemented via `FLUSHDB` on the
  underlying client) so the existing `testControls.reset()` handler
  (`ops.clear()`) keeps working unchanged. This is safe because `test-server`
  only ever runs against a dedicated, disposable Valkey instance — never the
  developer's or production's.
- The `/api/test/time` and `/api/test/reset` routes in
  `packages/server/src/app.ts` are unchanged; `ofelia-duty.spec.ts` keeps
  working exactly as before, just against real storage now.

Net effect: `test-server` and `index.ts` now share the same storage/pub-sub
code paths. The only remaining difference is the two test-only control routes,
which is an intentional, already-existing seam (production never imports
`test-server.ts`).

### 2. `docker-compose.e2e.yml`

A new compose file, sibling to `docker-compose.yml` / `docker-compose.dev.yml`,
run as its own Compose project so it gets its own network — no port or network
collision with the dev/prod stacks even if they're running concurrently on the
same host.

Services:

- **`valkey`** — `valkey/valkey:8-alpine`. No named/persistent volume; data
  directory is `tmpfs`-backed so it never survives past the container's
  lifetime. Healthcheck via `valkey-cli ping`.
- **`e2e`** — built from a new `e2e.Dockerfile` at the repo root, based on
  `mcr.microsoft.com/playwright:v1.61.0-<tag>` (tag to be confirmed at
  implementation time — matches the `@playwright/test` version pinned in
  `packages/client/package.json` and the Playwright version already pinned in
  `packages/browser-automation/Dockerfile`). The whole repo is `COPY`'d in and
  `pnpm install --frozen-lockfile` runs at image-build time. Default command:
  `pnpm --filter client test:e2e`.
  - `environment: VALKEY_URL=redis://valkey:6379`, `CI=true` (the latter for
    clarity/consistency with a future CI run; in a fresh container there's
    nothing to reuse regardless).
  - `depends_on: valkey (condition: service_healthy)`.
  - Playwright's existing `webServer` entries in `playwright.config.ts` start
    `test-server` (port 8787) and the Vite preview (port 4173) _inside_ this
    container — no new process-orchestration script needed.
  - Volumes: bind-mount `packages/client/test-results` and
    `packages/client/playwright-report` out to the host so failure artifacts
    (screenshots, traces) are inspectable after the container exits.

### 3. Root scripts

```json
"test:e2e:docker": "docker compose -f docker-compose.e2e.yml up --build --exit-code-from e2e --abort-on-container-exit",
"test:e2e:docker:down": "docker compose -f docker-compose.e2e.yml down -v"
```

`--exit-code-from e2e --abort-on-container-exit` makes the command's exit code
reflect the test run's pass/fail, and tears the stack down once the `e2e`
service finishes.

## Testing / verification plan

- Run `pnpm test:e2e:docker` while `docker-compose.dev.yml` (or
  `docker-compose.yml`) is up on the same host with real local data in Valkey.
  Confirm the e2e run is unaffected — it neither reads nor writes to that
  Valkey instance.
- Confirm `ofelia-duty.spec.ts` (the suite exercising `/api/test/reset` and
  `/api/test/time`) passes against the Valkey-backed `test-server`, matching
  prior in-memory behavior.
- Run `pnpm test:e2e:docker` twice back-to-back with
  `pnpm test:e2e:docker:down` between runs; confirm the second run starts from
  a clean slate (this is mostly moot since `beforeEach` already calls
  `/api/test/reset`, but confirms the `tmpfs` volume doesn't leak state).
- Confirm `pnpm --filter client test:e2e` (the existing host-run path) still
  passes unmodified, since it also now depends on a reachable Valkey at
  `VALKEY_URL` (default `redis://localhost:6379`) instead of pure in-memory
  storage — developers running it locally will need the existing
  `docker-compose.dev.yml` valkey service (or `pnpm docker:up`) running first.
