# E2E Docker Container Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Run the main Playwright e2e suite (`packages/client/playwright.config.ts`) in a Docker container that is fully isolated from the host's dev/prod stacks, backed by a disposable, real Valkey instance instead of the developer's local one.

**Architecture:** `test-server.ts` switches from in-memory storage to the real Valkey-backed `ValkeyOps` implementation (adding a test-only `clear()` for resets). A new `docker-compose.e2e.yml` runs an ephemeral `valkey` service plus an `e2e` service (built from a new `packages/client/e2e.Dockerfile`) that installs Chromium and runs `pnpm --filter client test:e2e` — Playwright's existing `webServer` entries start `test-server` and the Vite preview inside that same container, so no new process-orchestration script is needed.

**Tech Stack:** Node 22, pnpm workspaces, Playwright 1.61.0, iovalkey, Docker Compose.

## Global Constraints

- Playwright version is pinned to 1.61.0 everywhere (matches `@playwright/test` in `packages/client/package.json:49` and the version already pinned in `packages/browser-automation/Dockerfile:51`).
- Default `VALKEY_URL` is `redis://localhost:6379` (existing convention in `packages/server/src/storage/valkey.ts`).
- `packages/server/src/index.ts` (the production entry) is never modified and never imports `test-server.ts` — test-only routes must never leak to production.
- `packages/client/e2e/nginx-smoke.spec.ts` / `playwright.nginx.config.ts` are out of scope — untouched.
- No GitHub Actions / CI pipeline changes in this plan.
- `docker-compose.e2e.yml` must be its own isolated Compose project — no shared network or ports with `docker-compose.yml` or `docker-compose.dev.yml`.
- The e2e image uses `node:22-bookworm-slim` + a pinned `npx playwright@1.61.0 install --with-deps chromium`, matching the existing pattern in `packages/browser-automation/Dockerfile:37-56` (not the official `mcr.microsoft.com/playwright` image — stay consistent with what's already in this repo).
- Valkey in the e2e stack has no persistent volume (`tmpfs`-backed data dir) — it must never survive past the container's lifetime.

---

### Task 1: Add `createValkeyTestOps` to `storage/valkey.ts`

**Files:**
- Modify: `packages/server/src/storage/valkey.ts`
- Test: `packages/server/src/storage/valkey.test.ts` (new)

**Interfaces:**
- Consumes: `iovalkey`'s default export `Valkey` (already imported in this file).
- Produces: `export type ValkeyTestOps = ValkeyOps & { clear(): Promise<void> }` and `export function createValkeyTestOps(url?: string): ValkeyTestOps` — Task 2 imports both from `./storage/valkey`.

- [ ] **Step 1: Refactor `createValkeyOps` to share a `buildOps` helper, and add `createValkeyTestOps`**

Replace the full contents of `packages/server/src/storage/valkey.ts` with:

```ts
import Valkey from 'iovalkey'

export type ValkeyOps = {
  get(key: string): Promise<string | null>
  set(key: string, value: string, ttlMs?: number): Promise<void>
  del(key: string): Promise<void>
  scanKeys(matchPrefix: string): Promise<string[]>
  publish(channel: string, message: string): Promise<void>
}

function buildOps(client: Valkey): ValkeyOps {
  return {
    async get(key) {
      return client.get(key)
    },
    async set(key, value, ttlMs) {
      if (ttlMs != null) await client.set(key, value, 'PX', ttlMs)
      else await client.set(key, value)
    },
    async del(key) {
      await client.del(key)
    },
    async scanKeys(matchPrefix) {
      const escaped = matchPrefix.replace(/[*?[\]\\]/g, '\\$&')
      const found: string[] = []
      let cursor = '0'
      do {
        const [next, batch] = await client.scan(cursor, 'MATCH', `${escaped}*`, 'COUNT', 100)
        cursor = next
        found.push(...batch)
      } while (cursor !== '0')
      return found
    },
    async publish(channel, message) {
      await client.publish(channel, message)
    },
  }
}

export function createValkeyOps(
  url = process.env.VALKEY_URL ?? 'redis://localhost:6379',
): ValkeyOps {
  return buildOps(new Valkey(url))
}

export type ValkeyTestOps = ValkeyOps & { clear(): Promise<void> }

/** Same as createValkeyOps plus a destructive clear() for e2e test resets.
 *  Only test-server.ts may use this — the production entry never does. */
export function createValkeyTestOps(
  url = process.env.VALKEY_URL ?? 'redis://localhost:6379',
): ValkeyTestOps {
  const client = new Valkey(url)
  return {
    ...buildOps(client),
    async clear() {
      await client.flushdb()
    },
  }
}

/** Subscribe to a channel on a dedicated connection. Returns a teardown function. */
export function createValkeySubscriber(
  channel: string,
  onMessage: (message: string) => void,
  url = process.env.VALKEY_URL ?? 'redis://localhost:6379',
): () => void {
  const client = new Valkey(url)
  void client.subscribe(channel)
  client.on('message', (_channel, message) => onMessage(message))
  return () => {
    void client.unsubscribe(channel)
    client.disconnect()
  }
}
```

This is a pure refactor for `createValkeyOps` (identical behavior, now built on the shared `buildOps` helper) plus the new `createValkeyTestOps` export. `createValkeySubscriber` is unchanged.

- [ ] **Step 2: Write the env-gated integration test**

Create `packages/server/src/storage/valkey.test.ts`:

```ts
import { describe, expect, it } from 'vitest'

import { createValkeyTestOps } from './valkey'

// Real Valkey tests are opt-in: they need a reachable Valkey instance. Run
// with VALKEY_IT=1 (and VALKEY_URL if not the default) once one is up, e.g.
// via `pnpm docker:up` or `docker run --rm -p 6379:6379 valkey/valkey:8-alpine`.
const run = process.env['VALKEY_IT'] === '1'

describe.skipIf(!run)('createValkeyTestOps (real Valkey)', () => {
  it('round-trips set/get and removes on del', async () => {
    const ops = createValkeyTestOps()
    await ops.set('valkey-test:k', '1')
    expect(await ops.get('valkey-test:k')).toBe('1')
    await ops.del('valkey-test:k')
    expect(await ops.get('valkey-test:k')).toBeNull()
  })

  it('clear() empties the whole database', async () => {
    const ops = createValkeyTestOps()
    await ops.set('valkey-test:a', 'x')
    await ops.set('valkey-test:b', 'y')
    await ops.clear()
    expect(await ops.scanKeys('valkey-test:')).toEqual([])
  })
})
```

- [ ] **Step 3: Run the test file without the gate — confirm both cases are skipped, not failing**

Run: `pnpm --filter server exec vitest run src/storage/valkey.test.ts`
Expected: `Test Files  1 skipped (1)` / `Tests  2 skipped (2)`, exit code 0.

- [ ] **Step 4: (Optional, if a local Valkey is reachable) run the test for real**

Run: `VALKEY_IT=1 pnpm --filter server exec vitest run src/storage/valkey.test.ts`
Expected: `Test Files  1 passed (1)` / `Tests  2 passed (2)`.
Skip this step if no local Valkey is running (e.g. `pnpm docker:up` hasn't been started) — Task 5's full docker run exercises this code path anyway.

- [ ] **Step 5: Typecheck**

Run: `pnpm --filter server exec tsc --noEmit -p tsconfig.json`
Expected: no errors.

- [ ] **Step 6: Commit**

```bash
git add packages/server/src/storage/valkey.ts packages/server/src/storage/valkey.test.ts
git commit -m "feat(server): add createValkeyTestOps for e2e-only storage resets"
```

---

### Task 2: Wire `test-server.ts` to the Valkey-backed ops

**Files:**
- Modify: `packages/server/src/test-server.ts`

**Interfaces:**
- Consumes: `createValkeyTestOps`, `createValkeySubscriber` from `./storage/valkey` (Task 1). `AppDeps`/`TestControls` from `./app` (unchanged: `testControls.reset: () => Promise<void> | void`).
- Produces: no new exports — this is an entry-point script, imported by nothing.

- [ ] **Step 1: Replace the contents of `packages/server/src/test-server.ts`**

```ts
import { createApp } from './app'
import { createValkeySubscriber, createValkeyTestOps } from './storage/valkey'
import { productionWidgetServerRegistry } from './widgets/production-registry'

// Dedicated e2e entry. Running this bundle (vs dist/index.cjs) IS the
// test-mode gate: it exposes /api/test/* control routes and a settable clock.
// Storage and pub/sub are the real Valkey-backed implementations (same as
// production), so e2e tests exercise the real system end to end; only the
// test-only control routes and clock stay app-only. Requires VALKEY_URL to be
// reachable (docker-compose.e2e.yml provides a disposable instance). The
// production entry (index.ts) never imports this file, so test routes can't
// leak to prod.
const ops = createValkeyTestOps()
let currentNow = Date.now()

const { server } = createApp({
  ops,
  subscribe: (onMessage) => createValkeySubscriber('storage:events', onMessage),
  now: () => currentNow,
  widgetRegistry: productionWidgetServerRegistry,
  testControls: {
    setNow: (ms) => {
      currentNow = ms
    },
    reset: async () => {
      await ops.clear()
      currentNow = Date.now()
    },
  },
})

const port = Number(process.env.PORT ?? 8787)
server.listen(port, () => {
  console.log(`test storage-api listening on :${port}`)
})
```

- [ ] **Step 2: Typecheck and build**

Run: `pnpm --filter server exec tsc --noEmit -p tsconfig.json && pnpm --filter server build`
Expected: no errors; `packages/server/dist/test-server.cjs` is produced.

- [ ] **Step 3: (Optional, if a local Valkey is reachable) smoke-test the entry manually**

```bash
VALKEY_URL=redis://localhost:6379 PORT=8797 node packages/server/dist/test-server.cjs &
sleep 1
curl -i -X POST http://localhost:8797/api/test/reset
curl -i -X POST http://localhost:8797/api/test/time -H 'content-type: application/json' -d '{"iso":"2026-06-16T12:00:00+02:00"}'
curl -i http://localhost:8797/api/time
kill %1
```

Expected: both POSTs return `204`, the final GET returns the pinned time. Skip if no local Valkey is running — Task 5's full docker run exercises this end to end.

- [ ] **Step 4: Commit**

```bash
git add packages/server/src/test-server.ts
git commit -m "feat(server): back the e2e test-server with real Valkey storage"
```

---

### Task 3: Containerize the e2e runner

**Files:**
- Create: `packages/client/e2e.Dockerfile`
- Create: `docker-compose.e2e.yml`
- Modify: `package.json` (root)

**Interfaces:**
- Consumes: `pnpm --filter client test:e2e` (existing script, unchanged), `VALKEY_URL` env var (Task 1/2).
- Produces: `docker compose -f docker-compose.e2e.yml` service names `valkey` and `e2e`; root scripts `test:e2e:docker` and `test:e2e:docker:down`.

- [ ] **Step 1: Create `packages/client/e2e.Dockerfile`**

```dockerfile
# syntax=docker/dockerfile:1

# Runs the main Playwright e2e suite (packages/client/e2e, playwright.config.ts)
# fully isolated from the host: no bind mounts, no shared network/ports with
# docker-compose.yml or docker-compose.dev.yml. Chromium + its OS deps are
# installed explicitly and pinned to the workspace's Playwright version, same
# approach as packages/browser-automation/Dockerfile.
FROM node:22-bookworm-slim
WORKDIR /app
ENV PLAYWRIGHT_BROWSERS_PATH=/ms-playwright
ENV PLAYWRIGHT_SKIP_BROWSER_DOWNLOAD=1

RUN corepack enable \
    && apt-get update \
    && apt-get install -y --no-install-recommends fonts-liberation \
    && npx -y playwright@1.61.0 install --with-deps chromium \
    && chmod -R 755 /ms-playwright \
    && npm cache clean --force \
    && rm -rf /var/lib/apt/lists/*

COPY . .
RUN --mount=type=cache,id=pnpm-store,target=/pnpm-store \
    pnpm install --frozen-lockfile --store-dir /pnpm-store

CMD ["pnpm", "--filter", "client", "test:e2e"]
```

- [ ] **Step 2: Create `docker-compose.e2e.yml`**

```yaml
# Fully isolated run of the main Playwright e2e suite. Its own Compose
# project, so it never shares a network or port with docker-compose.yml or
# docker-compose.dev.yml even if either is running on the same host. Valkey
# has no persistent volume — every run starts from a clean, disposable
# database. Run with:
#   pnpm test:e2e:docker       -> docker compose -f docker-compose.e2e.yml up --build ...
#   pnpm test:e2e:docker:down  -> tear it down
services:
  valkey:
    image: valkey/valkey:8-alpine
    tmpfs:
      - /data
    healthcheck:
      test: ['CMD', 'valkey-cli', 'ping']
      interval: 5s
      timeout: 3s
      retries: 5

  e2e:
    build:
      context: .
      dockerfile: packages/client/e2e.Dockerfile
    depends_on:
      valkey:
        condition: service_healthy
    environment:
      VALKEY_URL: redis://valkey:6379
      CI: 'true'
    volumes:
      - ./packages/client/test-results:/app/packages/client/test-results
      - ./packages/client/playwright-report:/app/packages/client/playwright-report
```

- [ ] **Step 3: Add root package.json scripts**

In `package.json`, add two entries to `"scripts"` right after `"docker:dev:logs"`:

```json
    "docker:dev:logs": "docker compose -f docker-compose.dev.yml logs -f",
    "test:e2e:docker": "docker compose -f docker-compose.e2e.yml up --build --exit-code-from e2e --abort-on-container-exit",
    "test:e2e:docker:down": "docker compose -f docker-compose.e2e.yml down -v"
```

(`"docker:dev:logs"` is the last existing entry in `"scripts"` — insert the two new lines directly after it, keeping it as the line above.)

- [ ] **Step 4: Build the image (build-only check, no run yet)**

Run: `docker compose -f docker-compose.e2e.yml build e2e`
Expected: image builds successfully (this step alone doesn't need a live Valkey).

- [ ] **Step 5: Commit**

```bash
git add packages/client/e2e.Dockerfile docker-compose.e2e.yml package.json
git commit -m "build(e2e): containerize the main Playwright e2e suite"
```

---

### Task 4: Document the new workflow

**Files:**
- Modify: `CLAUDE.md`

**Interfaces:**
- Consumes: nothing (documentation only).
- Produces: nothing (documentation only).

- [ ] **Step 1: Update the Commands section in `CLAUDE.md`**

Find this block:

```
pnpm test:e2e                  # board Playwright e2e against the assembled production-style Vite output
pnpm --filter client test:e2e:nginx # with docker compose up --build -d running, smoke-test the actual nginx image
```

Replace it with:

```
pnpm test:e2e                  # board Playwright e2e against the assembled production-style Vite output; needs a reachable Valkey at VALKEY_URL (e.g. `pnpm docker:up`)
pnpm test:e2e:docker            # same suite, fully isolated: ephemeral Valkey + browsers in one container, torn down after
pnpm --filter client test:e2e:nginx # with docker compose up --build -d running, smoke-test the actual nginx image
```

- [ ] **Step 2: Commit**

```bash
git add CLAUDE.md
git commit -m "docs: document the containerized e2e workflow"
```

---

### Task 5: End-to-end verification

**Files:**
- None (verification only).

**Interfaces:**
- Consumes: everything from Tasks 1-4.
- Produces: nothing.

- [ ] **Step 1: Confirm isolation while a competing local stack is up**

```bash
pnpm docker:up
```

Expected: `docker-compose.yml` stack starts, occupying ports 6379/8080 with real local data (or existing data if already present).

- [ ] **Step 2: Run the containerized e2e suite while that stack is still up**

```bash
pnpm test:e2e:docker
```

Expected: exits `0`; all specs in `packages/client/e2e/widget-interactions.spec.ts`, `packages/client/e2e/ofelia-duty.spec.ts`, and `packages/client/e2e/widget-build-artifacts.spec.ts` pass — in particular `ofelia-duty.spec.ts`'s `/api/test/reset` + `/api/test/time` calls succeed against the ephemeral Valkey, proving Task 1/2's storage swap works end to end.

- [ ] **Step 3: Tear down and confirm no leaked state**

```bash
pnpm test:e2e:docker:down
pnpm test:e2e:docker
```

Expected: second run also exits `0` from a clean slate — the `tmpfs` Valkey volume does not persist across `down -v`.

- [ ] **Step 4: Tear down the competing local stack**

```bash
pnpm docker:down
```

Expected: `docker-compose.yml` stack stops; its Valkey data (the named `valkey_data` volume) is untouched by anything the e2e run did.

- [ ] **Step 5: Confirm the existing host-run path still works with the new Valkey dependency**

```bash
pnpm docker:up   # or: pnpm docker:dev, whichever provides a local valkey on redis://localhost:6379
pnpm test:e2e
```

Expected: exits `0`. This confirms the pre-existing `pnpm --filter client test:e2e` path (no Docker for the test run itself) still passes now that `test-server.ts` requires a reachable `VALKEY_URL` instead of pure in-memory storage — document this new local prerequisite if it isn't already obvious from Task 4's `CLAUDE.md` update.
