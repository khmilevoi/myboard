# Headed e2e run with Dockerized Valkey Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add `pnpm test:e2e:docker:headed`, which runs the board's Playwright e2e suite in headed mode (a visible Chromium window) against a disposable, Dockerized Valkey instance.

**Architecture:** A new `tsx` orchestrator script (`scripts/test-e2e-docker-headed.ts`) starts only the ephemeral `valkey` service from `docker-compose.e2e.yml` (its port now published to the host), waits for it to become healthy, spawns `playwright test --headed` on the host with `VALKEY_URL`/`ALLOW_TEST_DB_RESET` injected, forwards its exit code, and always tears the Valkey container down afterward. No changes to `packages/client/e2e.Dockerfile`, `playwright.config.ts`, or the existing `test:e2e:docker` flow.

**Tech Stack:** `tsx` (already a workspace dependency, used by `scripts/codegen.ts`), Node's built-in `node:child_process`, Docker Compose v5 (`up -d --wait`, `down -v`), Vitest for the infra assertions in `scripts/infra.test.ts`.

## Global Constraints

- Cross-platform (Windows/PowerShell + POSIX): no shell string interpolation of env vars (`VAR=1 cmd` is not portable) — inject env via `child_process` options instead.
- The Valkey port mapping and package.json script name are locked in as verbatim string content; the infra tests assert on those exact strings, matching the existing pattern in `scripts/infra.test.ts`.
- Always tear down the Valkey container on exit (success, failure, or Playwright crash) so no stray container/port is left behind.

---

### Task 1: Publish the Valkey port in `docker-compose.e2e.yml`

**Files:**

- Modify: `docker-compose.e2e.yml:16-24` (the `valkey` service block)
- Test: `scripts/infra.test.ts`

**Interfaces:**

- Produces: `docker-compose.e2e.yml`'s `valkey` service exposes `127.0.0.1:6379:6379`, so a host process can reach it at `redis://localhost:6379`.

- [ ] **Step 1: Write the failing test**

Add this `describe` block to the end of `scripts/infra.test.ts` (the file already reads `compose`, `rootPackage`, etc. at the top — add a new top-level `readFileSync` for the e2e compose file alongside the existing ones near line 10):

```ts
const e2eCompose = readFileSync(resolve(root, 'docker-compose.e2e.yml'), 'utf8')
```

Then append:

```ts
describe('docker-compose.e2e.yml headed-run support', () => {
  it('publishes valkey to localhost so a host-run Playwright can reach it', () => {
    const valkeyBlock = e2eCompose.slice(
      e2eCompose.indexOf('  valkey:'),
      e2eCompose.indexOf('  e2e:'),
    )
    expect(valkeyBlock).toContain("- '127.0.0.1:6379:6379'")
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm --filter client exec vitest run ../../scripts/infra.test.ts` — actually run it from the repo root instead: `pnpm exec vitest run scripts/infra.test.ts`
Expected: FAIL — `valkeyBlock` does not contain `'127.0.0.1:6379:6379'`.

- [ ] **Step 3: Publish the port**

In `docker-compose.e2e.yml`, change the `valkey` service from:

```yaml
valkey:
  image: valkey/valkey:8-alpine
  tmpfs:
    - /data
  healthcheck:
    test: ['CMD', 'valkey-cli', 'ping']
    interval: 5s
    timeout: 3s
    retries: 5
```

to:

```yaml
valkey:
  image: valkey/valkey:8-alpine
  tmpfs:
    - /data
  ports:
    - '127.0.0.1:6379:6379'
  healthcheck:
    test: ['CMD', 'valkey-cli', 'ping']
    interval: 5s
    timeout: 3s
    retries: 5
```

Also update the file's header comment (lines 1-13) to mention the new command, so the comment stays accurate. Change:

```yaml
# Fully isolated run of the main Playwright e2e suite. Its own Compose
# project, so it never shares a network or port with docker-compose.yml or
# docker-compose.dev.yml even if either is running on the same host. Valkey
# has no persistent volume — every run starts from a clean, disposable
# database. Run with:
#   pnpm test:e2e:docker       -> docker compose -f docker-compose.e2e.yml up --build ...
#   pnpm test:e2e:docker:down  -> tear it down
```

to:

```yaml
# Fully isolated run of the main Playwright e2e suite. Its own Compose
# project, so it never shares a network or port with docker-compose.yml or
# docker-compose.dev.yml even if either is running on the same host. Valkey
# has no persistent volume — every run starts from a clean, disposable
# database. Run with:
#   pnpm test:e2e:docker         -> docker compose -f docker-compose.e2e.yml up --build ...
#   pnpm test:e2e:docker:down    -> tear it down
#   pnpm test:e2e:docker:headed  -> only Valkey runs here; Playwright runs on
#                                    the host in headed mode (see
#                                    scripts/test-e2e-docker-headed.ts)
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm exec vitest run scripts/infra.test.ts`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add docker-compose.e2e.yml scripts/infra.test.ts
git commit -m "feat(e2e): publish valkey port in docker-compose.e2e.yml for headed runs"
```

---

### Task 2: Add the headed-run orchestrator script

**Files:**

- Create: `scripts/test-e2e-docker-headed.ts`
- Modify: `package.json` (add `test:e2e:docker:headed` script)
- Test: `scripts/infra.test.ts`

**Interfaces:**

- Consumes: the `valkey` service name and `docker-compose.e2e.yml` path from Task 1; `packages/client`'s `test:e2e` → `playwright test` wiring (unmodified, from `packages/client/package.json:12`).
- Produces: root script `test:e2e:docker:headed` → `tsx scripts/test-e2e-docker-headed.ts`, exiting with Playwright's own exit code.

- [ ] **Step 1: Write the failing test**

Append to `scripts/infra.test.ts`:

```ts
it('wires the headed e2e command to the orchestrator script', () => {
  expect(rootPackage.scripts['test:e2e:docker:headed']).toBe(
    'tsx scripts/test-e2e-docker-headed.ts',
  )
})
```

(Add this inside the existing `describe('docker-compose.e2e.yml headed-run support', ...)` block from Task 1, or as its own top-level `it` — either is fine since it doesn't depend on compose file contents. Put it as a second `it` inside that same `describe` block to keep headed-run assertions together.)

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm exec vitest run scripts/infra.test.ts`
Expected: FAIL — `rootPackage.scripts['test:e2e:docker:headed']` is `undefined`.

- [ ] **Step 3: Create the orchestrator script**

Create `scripts/test-e2e-docker-headed.ts`:

```ts
import { spawnSync } from 'node:child_process'

// Only Valkey runs in Docker here; Playwright runs on the host so `--headed`
// opens a real, visible Chromium window (see docs/superpowers/specs/2026-07-05-e2e-headed-command-design.md
// for why this is simpler than containerizing the browser itself).
const composeFile = 'docker-compose.e2e.yml'
const pnpmBin = process.platform === 'win32' ? 'pnpm.cmd' : 'pnpm'

function runDocker(args: string[]): number {
  const result = spawnSync('docker', ['compose', '-f', composeFile, ...args], {
    stdio: 'inherit',
  })
  return result.status ?? 1
}

function main(): number {
  try {
    const upStatus = runDocker(['up', '-d', '--wait', 'valkey'])
    if (upStatus !== 0) return upStatus

    const playwright = spawnSync(
      pnpmBin,
      ['--filter', 'client', 'exec', 'playwright', 'test', '--headed'],
      {
        stdio: 'inherit',
        env: {
          ...process.env,
          VALKEY_URL: 'redis://localhost:6379',
          ALLOW_TEST_DB_RESET: '1',
        },
      },
    )
    return playwright.status ?? 1
  } finally {
    runDocker(['down', '-v'])
  }
}

process.exitCode = main()
```

- [ ] **Step 4: Wire the root package.json script**

In `package.json`, add this entry directly after `"test:e2e:docker:down"`:

```json
    "test:e2e:docker:down": "docker compose -f docker-compose.e2e.yml down -v",
    "test:e2e:docker:headed": "tsx scripts/test-e2e-docker-headed.ts"
```

- [ ] **Step 5: Run test to verify it passes**

Run: `pnpm exec vitest run scripts/infra.test.ts`
Expected: PASS

- [ ] **Step 6: Typecheck and lint the new script**

Run: `pnpm typecheck`
Expected: no new errors from `scripts/test-e2e-docker-headed.ts`.

Run: `pnpm lint`
Expected: no new violations from `scripts/test-e2e-docker-headed.ts`.

- [ ] **Step 7: Manual smoke test**

Run: `pnpm test:e2e:docker:headed`
Expected: Docker starts `valkey`, a Chromium window opens and runs the e2e suite visibly, the command exits with Playwright's exit code, and `docker compose -f docker-compose.e2e.yml ps` afterward shows no running containers for the `myboard-e2e` project.

- [ ] **Step 8: Commit**

```bash
git add scripts/test-e2e-docker-headed.ts scripts/infra.test.ts package.json
git commit -m "feat(e2e): add pnpm test:e2e:docker:headed for headed local runs against dockerized valkey"
```

---

## Self-Review Notes

- **Spec coverage:** Task 1 covers the compose port-publishing requirement; Task 2 covers the orchestrator script, env injection, exit-code forwarding, and always-teardown behavior — all requirements from the design doc are implemented.
- **Placeholders:** none — every step has literal file contents and exact commands.
- **Type/name consistency:** `composeFile`, `pnpmBin`, `runDocker`, `main` are used consistently within Task 2's single file; no cross-task naming to reconcile since Task 1 only touches YAML/test files.
