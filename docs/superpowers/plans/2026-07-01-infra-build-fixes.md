# Infra & Build System Fixes Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make `docker:dev` serve widget remotes, retire the `vite-build-exit` hang workaround by upgrading Vite/Rolldown, speed up the build while deduplicating shared chunks across federation remotes, and harden the production compose stack (reproducible server image, data persistence, healthchecks).

**Architecture:** Four independent fixes plus one dependent one. (1) `docker-compose.dev.yml` gains a `widgets` service running every widget dev server with published ports, codegen in the `install` service, and named `node_modules` volumes for every workspace package — guarded by a root-level regression test. (2) Vite is upgraded from 8.0.16 (Rolldown 1.0.3, whose native thread pool keeps the process alive after build) to ^8.1.2 (Rolldown ~1.1.3); if the CLI now exits, the wrapper bin is deleted everywhere. (3) The client build stops re-running tsc serially, typecheck runs in parallel with widget builds, tsc goes incremental, and `federationShared()` grows `zod`/`errore` singletons with real semver ranges resolved from the pnpm catalog. (4) The production stack: the server image runs codegen itself (today it silently depends on untracked generated files leaking in from the host working tree), generated files are dockerignored, and `docker-compose.yml` gets valkey persistence, healthchecks, and restart policies.

**Tech Stack:** pnpm 10 workspaces, Vite 8 / Rolldown, @module-federation/vite 1.16, Docker Compose, Vitest, TypeScript 6.

## Global Constraints

- **Commands can hang.** Any command that runs a Vite build or waits on a server MUST be wrapped: `timeout <seconds> <cmd>` in Git Bash. `docker compose up` MUST use `-d` plus curl polling — never foreground.
- Prefix shell commands with `rtk` where a terminal is used interactively (repo-wide rule from `~/CLAUDE.md`); the `timeout`-guarded commands below may run without `rtk`.
- Package manager is `pnpm@10.28.2`; Node 22. Windows host — prefer the Bash tool for `timeout`, `time`, `curl`.
- Conventional commit messages (`fix:`, `feat:`, `chore:`, `test:` …), as in existing history.
- Generated files (`*.generated.ts`, `packages/widgets/.ports.json`) are only ever written by `pnpm run codegen` — never hand-edited.
- Root `pnpm-workspace.yaml` `catalog:` is the single source for shared dependency versions (`react ^19.2.7`, `zod ^4.4.3`, …).
- Task 1 is independent. Task 2 MUST land before Tasks 3 and 4 (their measurements and build-script edits assume the upgraded stack and a known exit behavior). Task 5 needs Task 1's `scripts/infra.test.ts` to exist and Task 2's outcome for the client Dockerfile build line; run it last. Task 6 (pre-existing defects surfaced by verification) must go green before committing Tasks 1–4.

## Execution Status (as of 2026-07-02)

Tasks 1–4 code changes are **implemented in the working tree, nothing committed yet**. Verified so far: `pnpm run test:scripts` PASS, `federation-shared.test.ts` PASS, `pnpm build` PASS (completes _and exits_).

**Task 2 outcome — branch 3b (hang persists on Vite 8.1.2 / Rolldown 1.1.3):** direct bisect showed a widget CLI build prints `✓ built` and then hangs with `@module-federation/vite` enabled, and exits normally with the federation plugin removed; the PWA plugin could not be isolated (removing it breaks the `virtual:pwa-register` import before exit behavior can be measured). The `vite-build-exit` wrapper is KEPT and its comment updated with this evidence. Upstream issue target: `@module-federation/vite` (federation plugin implicated, possibly its Rolldown interplay). The client Dockerfile correctly still uses `vite-build-exit`.

**Workspace-wide gates are red for two PRE-EXISTING defects (not caused by these changes) — see Task 6:**

1. `pnpm typecheck` fails in `widgets-clock`: TS2307 for `*.module.css` (both `ui/Clock.tsx` and widget-sdk's `WidgetControls.tsx` compiled inside clock's program). Not upgrade-related: both vite 8.0.16 and 8.1.2 `client.d.ts` declare `*.module.css` (verified side-by-side in the pnpm store); the widget tsc programs simply never include any ambient CSS-module declaration.
2. `pnpm test` fails in `WidgetFrame.test.tsx` ("renders the loadable widget component content", 30s timeout): the real generated catalog calls `loadRemote('clock/ui')`, which throws MF `RUNTIME-009 Please call createInstance first` because the federation plugin is disabled under Vitest and no host instance exists. Pre-existing since `5c31f22` (the commit that switched the catalog to `loadRemote`); MF runtime version is unchanged by the upgrade.

**Still to do:** Task 6 (fix both defects), Task 1 Step 5a (pnpm store volume — the `install` container hang, root-caused 2026-07-02: pnpm's store fell back to `/app/.pnpm-store` on the Windows bind mount; 502 MB / 29k files found on the host), Task 1 Step 6 (docker smoke), `pnpm test:e2e`, per-task commits, Task 5 (not started).

---

### Task 1: docker:dev serves widget remotes

**Root cause being fixed:** In dev, `widgetRemotes()` ([widget-remotes.ts:20](packages/widget-sdk/src/vite/widget-remotes.ts)) points each remote at `http://localhost:<port>/remoteEntry.js` using `packages/widgets/.ports.json` (`clock: 5180`, `ofelia-poop-duty: 5181`). `docker-compose.dev.yml` starts only valkey/redisinsight/install/server/client — no widget dev servers, no 518x ports published — so the browser's fetch of `localhost:5181/remoteEntry.js` is refused. Two latent defects fixed in passing: the container `pnpm install` writes `node_modules` for `shared`/`widget-runtime`/`widget-sdk`/`widgets/*` through the bind mount (clobbering the host's Windows install — exactly what the compose comment says the volumes exist to prevent), and nothing in the compose stack runs codegen (the generated catalog files are untracked, so a fresh clone fails).

**Additional confirmed failure (stale volumes):** the current stack also crashes at startup — client can't resolve `@module-federation/vite`/`@tailwindcss/vite`/`@vitejs/plugin-react`, server can't resolve `@rspack/cli`, while `install` reports "Already up to date". Verified cause: the named `node_modules` volumes were created 2026-06-17/18, _before_ commit `c61d5aa` (2026-07-01) moved packages under `packages/`. The volumes still contain pnpm symlinks with the old relative depth (`@module-federation/vite -> ../../../node_modules/.pnpm/…`, three levels up — correct for `/app/client/`, wrong for `/app/packages/client/`, where four levels are needed), so they resolve to the nonexistent `/app/packages/node_modules/.pnpm/…`. pnpm skips relinking because the root volume's `.pnpm/lock.yaml` matches the lockfile ("Already up to date"). Any future package move will recreate this failure mode, hence the `docker:dev:clean` script below.

**Files:**

- Modify: `docker-compose.dev.yml`
- Create: `scripts/infra.test.ts`
- Create: `vitest.config.ts` (repo root)
- Modify: `package.json` (repo root — devDeps + test scripts)
- Modify: `scripts/codegen.test.ts` (fix stale assertions once it actually runs)

**Interfaces:**

- Consumes: `discoverWidgetDirs(dir: string): string[]` from `scripts/codegen.ts` (exists).
- Produces: compose service `widgets` publishing host ports `5180-5199`; root script `test:scripts` running `vitest run` over `scripts/`.

- [x] **Step 1: Give `scripts/*.test.ts` a runner (it currently has none)** — DONE

`scripts/codegen.test.ts` is orphaned — no vitest config includes it, and `pnpm test` (`pnpm -r test`) skips the root package. Add root devDeps and config.

In root `package.json`, add to `devDependencies` and scripts:

```json
"devDependencies": {
  "oxfmt": "^0.55.0",
  "oxlint": "^1.70.0",
  "tsx": "^4.20.6",
  "vitest": "catalog:"
},
```

and change the `test` script, adding `test:scripts` and `docker:dev:clean` (drops the named volumes; required after any workspace layout change — pnpm's "Already up to date" fast path will NOT repair stale symlinks in the volumes):

```json
"test": "pnpm run codegen && pnpm run test:scripts && pnpm -r test",
"test:scripts": "vitest run",
"docker:dev:clean": "docker compose -f docker-compose.dev.yml down -v",
```

Create `vitest.config.ts` at the repo root:

```ts
import { defineConfig } from 'vitest/config'

export default defineConfig({
  test: {
    include: ['scripts/**/*.test.ts'],
    environment: 'node',
  },
})
```

Run: `rtk pnpm install`

- [x] **Step 2: Run the revived codegen tests; fix stale assertions** — DONE

Run: `timeout 120 pnpm run test:scripts`
Expected: `codegen.test.ts` FAILS on stale string assertions (e.g. it expects `loadRemoteModule('ofelia-poop-duty')` with single quotes, while `emitCatalog` emits `loadRemoteModule("ofelia-poop-duty")` via `JSON.stringify`).

Update the failing `expect(...).toContain(...)` strings in `scripts/codegen.test.ts` to match the current emitter output exactly (double-quoted ids). Do NOT change `scripts/codegen.ts` — the emitters are correct; the test is stale.

Re-run: `timeout 120 pnpm run test:scripts`
Expected: PASS.

- [x] **Step 3: Write the failing compose-coverage regression test** — DONE

Create `scripts/infra.test.ts`:

```ts
import { readFileSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

import { describe, expect, it } from 'vitest'

import { discoverWidgetDirs } from './codegen'

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const compose = readFileSync(resolve(root, 'docker-compose.dev.yml'), 'utf8')
const ports = JSON.parse(
  readFileSync(resolve(root, 'packages/widgets/.ports.json'), 'utf8'),
) as Record<string, number>

describe('docker-compose.dev.yml widget coverage', () => {
  it('publishes a host port range covering every widget dev port', () => {
    const match = compose.match(/'(\d+)-(\d+):\1-\2'/)
    expect(match, 'a published port range like 5180-5199:5180-5199').not.toBeNull()
    const from = Number(match![1])
    const to = Number(match![2])
    for (const [id, port] of Object.entries(ports)) {
      expect(port, `${id} dev port inside published range`).toBeGreaterThanOrEqual(from)
      expect(port, `${id} dev port inside published range`).toBeLessThanOrEqual(to)
    }
  })

  it('mounts a named node_modules volume for every workspace package', () => {
    const widgetDirs = discoverWidgetDirs(resolve(root, 'packages/widgets'))
    const required = [
      'packages/client',
      'packages/server',
      'packages/shared',
      'packages/widget-runtime',
      'packages/widget-sdk',
      ...widgetDirs.map((dir) => `packages/widgets/${dir}`),
    ]
    for (const pkg of required) {
      expect(compose, `${pkg} node_modules named volume`).toContain(`/app/${pkg}/node_modules`)
    }
  })

  it('runs codegen before dev servers start (generated files are untracked)', () => {
    expect(compose).toContain('pnpm run codegen')
  })
})
```

Run: `timeout 120 pnpm run test:scripts`
Expected: FAIL — no port range, no volumes for shared/widget-runtime/widget-sdk/widgets, no codegen in compose.

- [x] **Step 4: Rewrite `docker-compose.dev.yml`** — DONE

Replace the whole file with:

```yaml
# Development stack with hot reload. Run with:
#   pnpm docker:dev        -> docker compose -f docker-compose.dev.yml up --build
#   pnpm docker:dev:down   -> tear it down
#
# - client: Vite dev server with HMR at http://localhost:5173
# - widgets: every packages/widgets/* dev server (federation remotes). Dev
#   remotes resolve to http://localhost:<port>/remoteEntry.js (see
#   packages/widgets/.ports.json), so the 5180-5199 range is published 1:1.
#   Adding a widget needs no compose edit until the range is exhausted — but
#   DOES need a node_modules volume below (scripts/infra.test.ts enforces both).
# - server: storage-api rebuilt on change via rspack watch + node --watch
# - install runs `pnpm install` + codegen once; everything else starts after it.
# - source is bind-mounted; file watching uses polling (CHOKIDAR_USEPOLLING)
#   so edits on a Windows/macOS host are detected through the Docker bind mount.
# - node_modules of EVERY workspace package live in named volumes so the
#   host's (Windows) install is not clobbered by the container's (Linux) one.
#   After moving/renaming workspace packages run `pnpm docker:dev:clean`:
#   pnpm's "Already up to date" check trusts the volume state and will not
#   repair relative symlinks that the move broke.

x-workspace-volumes: &workspace-volumes
  - .:/app
  - root_node_modules:/app/node_modules
  - client_node_modules:/app/packages/client/node_modules
  - server_node_modules:/app/packages/server/node_modules
  - shared_node_modules:/app/packages/shared/node_modules
  - widget_runtime_node_modules:/app/packages/widget-runtime/node_modules
  - widget_sdk_node_modules:/app/packages/widget-sdk/node_modules
  - widgets_clock_node_modules:/app/packages/widgets/clock/node_modules
  - widgets_ofelia_poop_duty_node_modules:/app/packages/widgets/ofelia-poop-duty/node_modules

services:
  valkey:
    image: valkey/valkey:8-alpine
    ports:
      - '127.0.0.1:6379:6379'

  redisinsight:
    image: redis/redisinsight:latest
    ports:
      - '127.0.0.1:5540:5540'
    volumes:
      - redisinsight:/data
    depends_on:
      - valkey

  install:
    image: node:22-alpine
    working_dir: /app
    command: sh -c "corepack enable && pnpm install && pnpm run codegen"
    volumes: *workspace-volumes

  server:
    image: node:22-alpine
    working_dir: /app
    command: sh -c "corepack enable && pnpm --filter server dev"
    environment:
      VALKEY_URL: redis://valkey:6379
      PORT: '8787'
      CHOKIDAR_USEPOLLING: 'true'
    volumes: *workspace-volumes
    ports:
      - '127.0.0.1:8787:8787'
    depends_on:
      install:
        condition: service_completed_successfully
      valkey:
        condition: service_started

  widgets:
    image: node:22-alpine
    working_dir: /app
    command: sh -c 'corepack enable && pnpm -r --parallel --filter "./packages/widgets/*" dev --host'
    environment:
      VITE_API_PROXY: http://server:8787
      CHOKIDAR_USEPOLLING: 'true'
    volumes: *workspace-volumes
    ports:
      - '5180-5199:5180-5199'
    depends_on:
      install:
        condition: service_completed_successfully

  client:
    image: node:22-alpine
    working_dir: /app
    command: sh -c "corepack enable && pnpm --filter client dev --host"
    environment:
      VITE_API_PROXY: http://server:8787
      CHOKIDAR_USEPOLLING: 'true'
    volumes: *workspace-volumes
    ports:
      - '5173:5173'
    depends_on:
      install:
        condition: service_completed_successfully
      server:
        condition: service_started
      widgets:
        condition: service_started

volumes:
  root_node_modules:
  client_node_modules:
  server_node_modules:
  shared_node_modules:
  widget_runtime_node_modules:
  widget_sdk_node_modules:
  widgets_clock_node_modules:
  widgets_ofelia_poop_duty_node_modules:
  redisinsight:
```

Notes locked in by this file:

- `--host` after the `dev` script name is forwarded by pnpm to each Vite dev server (same pattern the existing `client` service already uses) so Vite binds `0.0.0.0` inside the container.
- The `5180-5199` range covers the codegen port map (starts at 5180, +1 per widget); the regression test fails the moment codegen assigns a port outside it.

- [x] **Step 5: Run the regression test** — DONE (`pnpm run test:scripts` PASS)

- [x] **Step 5a: Pin the pnpm store to a named volume (fixes the hanging `install` container)** — DONE (`pnpm_store` volume; clean first-run install completed)

Root cause (verified 2026-07-02): the container's pnpm cannot hardlink from its default global store (container overlay FS) into the named-volume `node_modules`, so it relocates the store to the project root — `/app/.pnpm-store` — which sits on the **Windows bind mount**. Evidence: `.pnpm-store` exists on the host with **502 MB / 29 171 files** (v10 + v11 layouts, i.e. written by container pnpm versions over time; it's even listed in `.gitignore`), with files freshly written during the hung run. Every install streams store writes through Docker Desktop's file sharing at bind-mount speed — the freeze at `Progress: … added N` is that copy; the executor killed it (install exited 137). Fix in three parts:

1. Extend the failing regression test first — append to the dev-compose `describe` in `scripts/infra.test.ts`:

```ts
it('keeps the pnpm store off the bind mount', () => {
  expect(compose).toContain('pnpm_store:/pnpm-store')
  expect(compose).toContain('npm_config_store_dir: /pnpm-store')
})
```

Run `timeout 120 pnpm run test:scripts` → the new case FAILS.

2. In `docker-compose.dev.yml`: add `- pnpm_store:/pnpm-store` to the `x-workspace-volumes` anchor list, add `pnpm_store:` to the top-level `volumes:`, and give the `install` service an environment block (pnpm honors `npm_config_*` env vars):

```yaml
  install:
    image: node:22-alpine
    working_dir: /app
    command: sh -c "corepack enable && pnpm install && pnpm run codegen"
    environment:
      npm_config_store_dir: /pnpm-store
    volumes: *workspace-volumes
```

(The store volume is a different device than the `node_modules` volumes, so pnpm copies instead of hardlinking — a volume→volume copy at Linux-native speed, which is exactly the point.)

Run `timeout 120 pnpm run test:scripts` → PASS.

3. Clean up the stale host artifacts (both git-ignored; the store dir is dead weight now, `packages/widgets/node_modules` is a leftover of the pre-`packages/` layout):

```bash
rm -rf .pnpm-store packages/widgets/node_modules
```

Note for Step 6: the first `up` after this repopulates the store **into the volume** — expect a one-time full download of the workspace's packages at container network speed (a few minutes, with visible `downloaded N` progress); subsequent runs reuse the volume and take seconds.

Run: `timeout 120 pnpm run test:scripts`
Expected: PASS (all three `infra.test.ts` cases + codegen tests).

- [ ] **Step 6: Smoke-test the stack (detached — never foreground)**

Start from clean volumes — MANDATORY, the existing ones hold pre-`packages/`-move symlinks (three-`..` instead of four-`..` relative targets) that pnpm's "Already up to date" check never repairs:

```bash
cd C:/Users/Khmil/JsProjects/myboard
docker compose -f docker-compose.dev.yml down -v
# optional cleanup of volumes from the old worktree project:
docker volume rm myboard-design-update_client_node_modules myboard-design-update_root_node_modules myboard-design-update_server_node_modules 2>/dev/null || true
docker compose -f docker-compose.dev.yml up --build -d
# poll until remotes answer (up to ~3 min for install+codegen on first run)
for i in $(seq 1 36); do
  curl -sf -o /dev/null http://localhost:5180/remoteEntry.js \
    && curl -sf -o /dev/null http://localhost:5181/remoteEntry.js \
    && echo REMOTES_OK && break
  sleep 5
done
curl -sf -o /dev/null http://localhost:5173/ && echo CLIENT_OK
```

Expected: `REMOTES_OK` and `CLIENT_OK`. If not, inspect with `docker compose -f docker-compose.dev.yml logs widgets --tail 100` before changing anything.

Then open `http://localhost:5173` (or drive it with the browser tooling) and confirm the board renders widgets with no `WidgetFrame` error boundary and no `Failed to fetch dynamically imported module` in the console.

Tear down: `docker compose -f docker-compose.dev.yml down`

- [ ] **Step 7: Commit** (after Task 6 makes workspace gates green)

```bash
rtk git add docker-compose.dev.yml scripts/infra.test.ts scripts/codegen.test.ts vitest.config.ts package.json pnpm-lock.yaml
rtk git commit -m "fix(docker): run widget dev servers in docker:dev and publish 518x ports"
```

---

### Task 2: Retire the `vite-build-exit` hang workaround (Vite/Rolldown upgrade)

**Root cause being fixed:** `vite build` never returns control on Vite 8.0.16 because Rolldown 1.0.3's native thread pool keeps the process alive after the build finishes (verified in commit `39378a1` with `why-is-node-running`: zero JS handles remain). The workaround is [vite-build.mjs](packages/widget-sdk/bin/vite-build.mjs) (`build()` API + `process.exit(0)`), wired as the `vite-build-exit` bin into the client, both widgets, and the production Dockerfile. Vite ^8.1.2 pulls Rolldown ~1.1.3 — test whether the CLI now exits; upstream has no documented fix note, so this is an experiment with two prepared outcomes.

**Files:**

- Modify: `packages/client/package.json`, `packages/widget-sdk/package.json`, `packages/widgets/clock/package.json`, `packages/widgets/ofelia-poop-duty/package.json` (vite version; on success also `build` scripts / `bin` removal)
- Modify: `packages/client/Dockerfile` (on success)
- Delete: `packages/widget-sdk/bin/vite-build.mjs` (on success)

**Interfaces:**

- Consumes: nothing from other tasks.
- Produces: on success, `build` scripts are plain `vite build` and the `vite-build-exit` bin no longer exists — Tasks 3/4 build-script edits assume whatever this task leaves in place, so record the outcome in the commit message.

- [x] **Step 1: Bump Vite in all four packages** — DONE (vite ^8.1.2, rolldown 1.1.3 in lockfile)

In `packages/client/package.json`, `packages/widget-sdk/package.json`, `packages/widgets/clock/package.json`, `packages/widgets/ofelia-poop-duty/package.json` change:

```json
"vite": "^8.1.2"
```

Run: `rtk pnpm install`
Expected: lockfile resolves `vite@8.1.x` with `rolldown@1.1.x` (verify: `grep -m2 "rolldown@" pnpm-lock.yaml`).

- [x] **Step 2: Test CLI exit behavior with a timeout guard** — DONE; OUTCOME: hang persists → branch 3b

```bash
cd C:/Users/Khmil/JsProjects/myboard
pnpm run codegen
timeout 300 pnpm --filter widgets-clock exec vite build; echo "clock exit=$?"
timeout 300 pnpm --filter widgets-ofelia-poop-duty exec vite build; echo "ofelia exit=$?"
# client build needs widget dists staged (stageWidgetBuilds), built just above
timeout 600 pnpm --filter client exec vite build; echo "client exit=$?"
```

Expected if fixed: each prints `exit=0` well before the timeout. `exit=124` means the hang persists.
(Note: widget package names are `widgets-clock` / `widgets-ofelia-poop-duty` — check `name` in each widget `package.json` and adjust the filter if they differ.)

- [ ] ~~**Step 3a (hang fixed): Remove the wrapper everywhere**~~ — NOT APPLICABLE (hang persists)

1. `packages/widgets/clock/package.json` and `packages/widgets/ofelia-poop-duty/package.json`:

```json
"build": "vite build",
```

2. `packages/client/package.json`:

```json
"build": "tsc --noEmit --incremental false -p tsconfig.json && tsc --noEmit --incremental false -p tsconfig.node.json && vite build",
```

(Task 3 restructures this further; keep the tsc gate intact here.)

3. `packages/widget-sdk/package.json`: delete the whole `"bin"` block.
4. Delete `packages/widget-sdk/bin/vite-build.mjs`.
5. `packages/client/Dockerfile`: the second `pnpm install --offline --frozen-lockfile` (lines 26–31 incl. comment) existed only to link the `vite-build-exit` bin — delete it, and change the build line to:

```dockerfile
RUN pnpm run codegen \
    && pnpm --filter "./packages/widgets/*" build \
    && pnpm --filter client exec vite build
```

6. `rtk pnpm install` (refreshes bin links), then confirm no references remain: `rtk grep "vite-build-exit"` — expected: no matches outside this plan document.

- [x] **Step 3b (hang persists): Keep the wrapper, isolate the culprit, stop** — DONE except the upstream-issue report: bisect implicates `@module-federation/vite` (widget build prints `✓ built` then hangs with the plugin, exits without it; PWA plugin not isolatable — removing it breaks `virtual:pwa-register`). Wrapper comment updated. Ready-to-file issue body still owed to the user.

1. Revert nothing — the version bump alone is still worth keeping if Step 4 passes.
2. Bisect to identify the trigger, one variable at a time, each run behind `timeout 300`: in `packages/widgets/clock/vite.config.ts` temporarily disable the `federation(...)` plugin and run `timeout 300 pnpm --filter widgets-clock exec vite build`; if it exits, the federation plugin is implicated; restore, and for the client repeat with `VitePWA` removed. Record which minimal plugin set hangs.
3. Update the comment block in `packages/widget-sdk/bin/vite-build.mjs` with the tested versions (`vite 8.1.x / rolldown 1.1.x`) and the bisect result, so the workaround documents current — not stale — evidence.
4. Report the findings to the user with a ready-to-file upstream issue body (rolldown or @module-federation/vite depending on bisect); filing it is the user's call. Skip Steps 3a edits entirely.

- [ ] **Step 4: Full pipeline verification** — PARTIAL: `pnpm build` PASS (returns control ✓); `pnpm test` FAILS on the pre-existing WidgetFrame defect (Task 6); `pnpm test:e2e` not yet run.

```bash
timeout 1200 pnpm build; echo "build exit=$?"
timeout 900 pnpm test; echo "test exit=$?"
```

Expected: both `exit=0`, and the commands actually _return_ (that's the whole point). If e2e infra is available: `timeout 1200 pnpm test:e2e`.

- [ ] **Step 5: Commit**

```bash
rtk git add -A
rtk git commit -m "fix(build): upgrade vite to 8.1.x so vite build exits; drop vite-build-exit wrapper"
```

(Adjust the message to `chore(build): upgrade vite to 8.1.x; hang persists, wrapper kept — <culprit>` if Step 3b was taken.)

---

### Task 3: Deduplicate and parallelize the build pipeline

**Root cause being fixed:** Root `pnpm build` is fully serial: codegen → widget builds → client (two full non-incremental tsc passes, then Vite). The client tsc passes are independent of the widget builds, so they can overlap; and with `--incremental false` plus no `tsBuildInfo`, every rebuild pays full typecheck cost. `pnpm typecheck` then re-runs the identical tsc invocations a second time.

**Files:**

- Modify: `package.json` (root — build orchestration, `concurrently` devDep)
- Modify: `packages/client/package.json` (build script, typecheck flags)
- Modify: `packages/client/tsconfig.json`, `packages/client/tsconfig.node.json` (incremental)

**Interfaces:**

- Consumes: Task 2's outcome — `vite build` if the wrapper was removed, `vite-build-exit` otherwise. Steps below use `vite build`; substitute `vite-build-exit` if Task 2 ended in 3b.
- Produces: root `build` = codegen → (widgets build ∥ client typecheck) → client vite build. Client `build` script no longer typechecks; `pnpm --filter client typecheck` is the only tsc entry point.

- [ ] **Step 1: Record the baseline** — SKIPPED by the executor (timings not recorded; note cold/warm numbers in Step 4 instead)

```bash
cd C:/Users/Khmil/JsProjects/myboard
time timeout 1200 pnpm build
```

Note total plus rough phase split (widgets vs client tsc vs client vite from the log timestamps). Save the numbers — they go in the final commit message.

- [x] **Step 2: Enable incremental tsc for the client** — DONE

`packages/client/tsconfig.json` — add inside `compilerOptions`:

```json
"incremental": true,
"tsBuildInfoFile": "node_modules/.cache/tsconfig.tsbuildinfo",
```

`packages/client/tsconfig.node.json` — add inside `compilerOptions`:

```json
"incremental": true,
"tsBuildInfoFile": "node_modules/.cache/tsconfig.node.tsbuildinfo",
```

`packages/client/package.json` — drop the `--incremental false` flags (they were a belt-and-suspenders no-op; now they'd fight the config):

```json
"typecheck": "tsc --noEmit -p tsconfig.json && tsc --noEmit -p tsconfig.node.json",
```

- [x] **Step 3: Move typecheck out of the client build; overlap it with widget builds** — DONE (client `build` is `vite-build-exit` per Task 2's 3b outcome; root `build` uses `concurrently`)

`packages/client/package.json`:

```json
"build": "vite build",
```

Root `package.json` — add devDep:

```json
"concurrently": "^9.2.0"
```

and change the root `build` script (typecheck gate preserved — `--kill-others-on-fail` makes a tsc error abort the widget builds and fail the whole command):

```json
"build": "pnpm run codegen && concurrently -g --kill-others-on-fail \"pnpm --filter ./packages/widgets/* build\" \"pnpm --filter client typecheck\" && pnpm --filter client build",
```

Run: `rtk pnpm install`

- [x] **Step 4: Verify — cold and warm** — DONE (cold 293.04s, warm 157.69s; deliberate TS error made root build exit 1 and killed peer builds)

```bash
rm -rf packages/client/node_modules/.cache
time timeout 1200 pnpm build          # cold
time timeout 1200 pnpm build          # warm (incremental tsc should be near-instant)
timeout 900 pnpm typecheck            # still green workspace-wide
```

Expected: cold build ≈ baseline minus min(widget-build time, tsc time); warm build noticeably faster again; both exit 0. Also verify a type error still fails the build: introduce `const x: number = 'boom'` in `packages/client/src/main.tsx` (or any src file), run `timeout 600 pnpm build`, expect nonzero exit, then revert the line.

- [ ] **Step 5: Commit**

```bash
rtk git add package.json pnpm-lock.yaml packages/client/package.json packages/client/tsconfig.json packages/client/tsconfig.node.json
rtk git commit -m "perf(build): overlap client typecheck with widget builds, incremental tsc (cold Xs -> Ys, warm Zs)"
```

---

### Task 4: Deduplicate shared chunks across federation remotes

**Root cause being fixed:** `federationShared()` ([federation-shared.ts:28](packages/widget-sdk/src/vite/federation-shared.ts)) shares only `react`, `react-dom`, `@reatom/core`, `@reatom/react`, `widget-runtime` — every widget remote additionally bundles its own full copy of `zod` and `errore` (and the host bundles them again). Worse, `dependencyVersion()` returns the literal string `"catalog:"` for catalog deps as `requiredVersion`, which is not a semver range. Two deliberate non-goals: `lucide-react` stays unshared (remotes tree-shake individual icons; sharing would ship the whole icon set), and `widget-sdk` stays unshared (its many subpath exports make MF sharing fragile; it is stateless so duplication is only a size cost).

**Files:**

- Modify: `packages/widget-sdk/src/vite/federation-shared.ts`
- Modify: `packages/widget-sdk/src/vite/federation-shared.test.ts`
- Modify: `packages/widget-sdk/package.json` (add `zod` dep)

**Interfaces:**

- Consumes: `pnpm-workspace.yaml` `catalog:` block (source of real version ranges).
- Produces: `federationShared(): Record<string, { singleton: true; strictVersion: true; requiredVersion: string }>` now including `zod` and `errore`, with `requiredVersion` always a real semver range (never `"catalog:"`). Consumed unchanged by `packages/client/vite.config.ts` and `widget-vite-config.ts`.

- [ ] **Step 1: Record duplication baseline** — SKIPPED by the executor (can still be done post-hoc against a stashed tree if the numbers matter)

After a successful `pnpm build` (Task 3 state):

```bash
du -sh packages/client/dist packages/widgets/*/dist
# spot duplicated vendor code inside each remote:
grep -rl "ZodError" packages/widgets/*/dist packages/client/dist | head
```

Note sizes and which bundles carry their own zod copy. Also note the PWA precache summary Vite/workbox prints at the end of the client build (`precache N entries (X KiB)`).

- [x] **Step 2: Write the failing tests** — DONE

In `packages/widget-sdk/src/vite/federation-shared.test.ts`, add (keeping existing cases):

```ts
it('shares zod and errore as strict singletons', () => {
  const shared = federationShared()
  expect(Object.keys(shared)).toEqual(
    expect.arrayContaining([
      'react',
      'react-dom',
      '@reatom/core',
      '@reatom/react',
      'widget-runtime',
      'zod',
      'errore',
    ]),
  )
})

it('resolves catalog: references to the real semver range', () => {
  const shared = federationShared()
  for (const [name, config] of Object.entries(shared)) {
    expect(config.requiredVersion, `${name} requiredVersion`).not.toContain('catalog')
    expect(config.requiredVersion, `${name} requiredVersion`).toMatch(/^[~^]?\d|^workspace:/)
  }
})
```

Run: `timeout 300 pnpm --filter widget-sdk exec vitest run src/vite/federation-shared.test.ts`
Expected: FAIL — `zod` missing (throws `missing a version`), and `react`'s requiredVersion is the literal `catalog:`.

- [x] **Step 3: Implement** — DONE (executor additionally added `errore` to the workspace catalog and switched `server`/`widget-runtime` to `catalog:` for errore/zod — consistent with the single-source-of-versions constraint)

1. `packages/widget-sdk/package.json` — add to `dependencies` (errore is already there):

```json
"zod": "catalog:"
```

2. Rewrite `packages/widget-sdk/src/vite/federation-shared.ts`:

```ts
import { readFileSync } from 'node:fs'

type PackageJson = {
  dependencies?: Record<string, string>
  devDependencies?: Record<string, string>
}

const packageJson = JSON.parse(
  readFileSync(new URL('../../package.json', import.meta.url), 'utf8'),
) as PackageJson

/** Minimal parser for the flat `catalog:` block in pnpm-workspace.yaml —
 *  kept dependency-free because this file runs inside every vite.config.ts. */
function catalogVersions(): Record<string, string> {
  const text = readFileSync(new URL('../../../../pnpm-workspace.yaml', import.meta.url), 'utf8')
  const lines = text.split('\n')
  const start = lines.findIndex((line) => line.trim() === 'catalog:')
  const versions: Record<string, string> = {}
  if (start === -1) return versions
  for (const line of lines.slice(start + 1)) {
    const match = line.match(/^ {2}['"]?([^:'"]+?)['"]?:\s*['"]?([^'"\s]+)['"]?\s*$/)
    if (!match) break
    versions[match[1]] = match[2]
  }
  return versions
}

const catalog = catalogVersions()

function dependencyVersion(name: string) {
  const raw = packageJson.dependencies?.[name] ?? packageJson.devDependencies?.[name]
  if (!raw) {
    throw new Error(`widget-sdk package.json is missing a version for shared dependency ${name}`)
  }
  if (raw.startsWith('catalog:')) {
    const version = catalog[name]
    if (!version) {
      throw new Error(`pnpm-workspace.yaml catalog is missing shared dependency ${name}`)
    }
    return version
  }
  return raw
}

function singleton(name: string) {
  return {
    singleton: true,
    strictVersion: true,
    requiredVersion: dependencyVersion(name),
  }
}

/** Shared singletons for every federation boundary (host + all remotes).
 *  Deliberately NOT shared: lucide-react (remotes tree-shake individual
 *  icons; sharing would ship the entire icon set as one chunk) and
 *  widget-sdk (stateless + many subpath exports; duplication is a size
 *  cost only, sharing would be fragile). */
export function federationShared() {
  return {
    react: singleton('react'),
    'react-dom': singleton('react-dom'),
    '@reatom/core': singleton('@reatom/core'),
    '@reatom/react': singleton('@reatom/react'),
    'widget-runtime': singleton('widget-runtime'),
    zod: singleton('zod'),
    errore: singleton('errore'),
  } as Record<string, ReturnType<typeof singleton>>
}
```

Note: `widget-runtime` is `workspace:*` — the second test regex accepts `workspace:` prefixed ranges; if `@module-federation/vite` logs a version warning for it at build time, map `workspace:*` to the package's real `version` field the same way catalog is resolved, in a follow-up edit inside this task.

3. `rtk pnpm install` (new zod dep).

Run: `timeout 300 pnpm --filter widget-sdk exec vitest run src/vite/federation-shared.test.ts`
Expected: PASS.

- [ ] **Step 4: Rebuild, compare, and verify at runtime** — PARTIAL: rebuild PASS, `federation-shared.test.ts` PASS; size comparison and `pnpm test:e2e` not yet done

```bash
time timeout 1200 pnpm build
du -sh packages/client/dist packages/widgets/*/dist
```

Expected: no MF `shared` version warnings in the build log (the `catalog:` fix should _remove_ any pre-existing invalid-range warnings); per-remote loaded JS shrinks at runtime (fallback copies still exist on disk by MF design — the win is single runtime load + smaller host chunks). Then run the e2e suite as the runtime proof (remotes still load, shared scope satisfied):

```bash
timeout 1200 pnpm test:e2e
```

Expected: PASS, and no `[Module Federation]` version-mismatch warnings in the browser console (check the Playwright trace/console on failure).

- [ ] **Step 5: Commit**

```bash
rtk git add packages/widget-sdk/src/vite/federation-shared.ts packages/widget-sdk/src/vite/federation-shared.test.ts packages/widget-sdk/package.json pnpm-lock.yaml
rtk git commit -m "perf(federation): share zod/errore singletons, resolve catalog: to real semver ranges"
```

---

### Task 5: Production compose stack — reproducible server image, persistence, healthchecks

**Root causes being fixed:**

1. **Server image only builds by accident.** [production-registry.ts:2](packages/server/src/widgets/production-registry.ts) imports `widget-server-list.generated.ts`, which is git-ignored (`.gitignore:43`), and `packages/server/Dockerfile` never runs codegen (and doesn't copy `scripts/`). Local `docker:up` works only because the Docker build context includes the untracked generated file from the host working tree; a clean clone — exactly what `pi.toml` produces on the Pi (`[source] repo/branch`) — fails the server image build. The fix mirrors what the client Dockerfile already does (codegen in-image) and dockerignores generated files so local builds equal clean-clone builds.
2. **`docker-compose.yml` loses data and doesn't self-heal.** valkey has no volume (all board storage is destroyed by `docker compose down`/container recreation), no service has a healthcheck or restart policy (after a Pi reboot or a crash the stack stays down), and `depends_on` uses bare `service_started`.

No widget services are needed here — in prod, remotes resolve to same-origin `/widgets/<id>/remoteEntry.js` (`widgetRemotes` with `command === 'build'`), baked into the client image and served by nginx.

**Files:**

- Modify: `.dockerignore`
- Modify: `packages/server/Dockerfile`
- Modify: `docker-compose.yml`
- Modify: `scripts/infra.test.ts` (extend with prod-compose assertions)

**Interfaces:**

- Consumes: `scripts/infra.test.ts` and root `test:scripts` from Task 1; the server's existing `GET /api/time` route ([app.ts:147](packages/server/src/app.ts)) as the healthcheck endpoint (no new route needed); Task 2's client Dockerfile build line.
- Produces: `docker-compose.yml` with `valkey_data` volume, healthchecks, `restart: unless-stopped` on all three services; a two-stage `packages/server/Dockerfile` (`build` stage with full install + codegen + rspack, `runtime` stage with `--filter server --prod` deps + `dist`).

- [x] **Step 1: Write the failing prod-compose regression tests** — DONE (all four cases observed failing before implementation)

Append to `scripts/infra.test.ts`:

```ts
describe('docker-compose.yml production hardening', () => {
  const prodCompose = readFileSync(resolve(root, 'docker-compose.yml'), 'utf8')

  it('persists valkey data in a named volume', () => {
    expect(prodCompose).toContain('valkey_data:/data')
  })

  it('restarts every service and gates on health', () => {
    expect(prodCompose.match(/restart: unless-stopped/g)?.length ?? 0).toBeGreaterThanOrEqual(3)
    expect(prodCompose).toContain('condition: service_healthy')
  })

  it('keeps generated files out of the docker build context', () => {
    const dockerignore = readFileSync(resolve(root, '.dockerignore'), 'utf8')
    expect(dockerignore).toContain('*.generated.ts')
  })

  it('runs codegen inside the server image build', () => {
    const dockerfile = readFileSync(resolve(root, 'packages/server/Dockerfile'), 'utf8')
    expect(dockerfile).toContain('pnpm run codegen')
  })
})
```

Run: `timeout 120 pnpm run test:scripts`
Expected: all four new cases FAIL.

- [x] **Step 2: Dockerignore generated files** — DONE

Append to `.dockerignore`:

```
**/*.generated.ts
```

This forces every image build to regenerate them (the client Dockerfile already runs codegen; the server one starts doing so in Step 3), making local builds identical to clean-clone/Pi builds.

- [x] **Step 3: Rewrite `packages/server/Dockerfile` (two-stage, codegen in-image)** — DONE

The rspack bundle externalizes everything from `node_modules` (see [rspack.config.ts:25](packages/server/rspack.config.ts) — only `@shared`/`@widgets`/`errore` are bundled), so the runtime image needs the server's production deps installed. Replace the whole file with:

```dockerfile
# syntax=docker/dockerfile:1

# --- build stage: codegen (widget server registry is git-ignored and
# dockerignored, it MUST be generated here) + rspack bundle ---
FROM node:22-alpine AS build
WORKDIR /app
RUN corepack enable

COPY pnpm-lock.yaml pnpm-workspace.yaml package.json ./
COPY packages/client/package.json ./packages/client/
COPY packages/server/package.json ./packages/server/
COPY packages/shared/package.json ./packages/shared/
COPY packages/widget-runtime/package.json ./packages/widget-runtime/
COPY packages/widget-sdk/package.json ./packages/widget-sdk/
# Widget package discovery is directory-based (same trick as the client image).
COPY packages/widgets ./packages/widgets
# codegen imports every widgets/*/client.ts through tsx + widget-sdk sources,
# so the full workspace install is required in this stage.
RUN pnpm install --frozen-lockfile

COPY packages/shared ./packages/shared
COPY packages/widget-runtime ./packages/widget-runtime
COPY packages/widget-sdk ./packages/widget-sdk
COPY scripts ./scripts
COPY packages/server ./packages/server

RUN pnpm run codegen && pnpm --filter server build

# --- runtime stage: dist + server's production deps only ---
FROM node:22-alpine AS runtime
WORKDIR /app
RUN corepack enable
COPY pnpm-lock.yaml pnpm-workspace.yaml package.json ./
COPY packages/client/package.json ./packages/client/
COPY packages/server/package.json ./packages/server/
COPY packages/shared/package.json ./packages/shared/
COPY packages/widget-runtime/package.json ./packages/widget-runtime/
COPY packages/widget-sdk/package.json ./packages/widget-sdk/
COPY packages/widgets ./packages/widgets
RUN pnpm install --frozen-lockfile --filter server --prod
COPY --from=build /app/packages/server/dist ./packages/server/dist
WORKDIR /app/packages/server
EXPOSE 8787
CMD ["node", "dist/index.cjs"]
```

Note for the Pi: the build stage now does a full workspace install (heavier than the old `--filter server...`), but the client image in the same release already pays that cost; `pi.toml`'s 30m build timeout has stated headroom. If a Pi build ever gets tight, the two images share the pnpm store via buildkit cache mounts — out of scope here.

- [x] **Step 4: Rewrite `docker-compose.yml`** — DONE (`pnpm run test:scripts`: 12/12)

```yaml
services:
  valkey:
    image: valkey/valkey:8-alpine
    # AOF so board data survives an unclean stop, not just periodic snapshots.
    command: valkey-server --appendonly yes
    volumes:
      - valkey_data:/data
    ports:
      - '127.0.0.1:6379:6379'
    healthcheck:
      test: ['CMD', 'valkey-cli', 'ping']
      interval: 10s
      timeout: 3s
      retries: 5
    restart: unless-stopped

  server:
    build:
      context: .
      dockerfile: packages/server/Dockerfile
    environment:
      VALKEY_URL: redis://valkey:6379
      PORT: '8787'
    depends_on:
      valkey:
        condition: service_healthy
    expose:
      - '8787'
    healthcheck:
      # /api/time is the cheapest existing route; wget ships in busybox.
      test: ['CMD', 'wget', '-qO-', 'http://127.0.0.1:8787/api/time']
      interval: 15s
      timeout: 3s
      retries: 5
    restart: unless-stopped

  client:
    build:
      context: .
      dockerfile: packages/client/Dockerfile
    depends_on:
      server:
        condition: service_healthy
    ports:
      - '127.0.0.1:8080:80'
    restart: unless-stopped

volumes:
  valkey_data:
```

(`client` gating on a healthy server makes a broken API fail the Pi deploy's `/` healthcheck visibly instead of shipping a board with dead storage; nginx itself resolves `server` at request time, so no runtime coupling is added.)

Run: `timeout 120 pnpm run test:scripts`
Expected: PASS (all infra + codegen cases).

- [x] **Step 5: Build and smoke-test the prod stack** — DONE (server image codegen PASS; three HTTP 200s; Valkey/server healthy; persisted key survived down/up)

Image builds are the slow part (several minutes each) — run detached / in background, never foreground-blocking:

```bash
cd C:/Users/Khmil/JsProjects/myboard
docker compose build server   # background this; proves in-image codegen works WITHOUT host generated files
docker compose up --build -d
for i in $(seq 1 60); do
  curl -sf -o /dev/null http://localhost:8080/ && echo CLIENT_OK && break
  sleep 5
done
curl -s -o /dev/null -w "shell %{http_code}\n"  http://localhost:8080/
curl -s -o /dev/null -w "remote %{http_code}\n" http://localhost:8080/widgets/clock/remoteEntry.js
curl -s -o /dev/null -w "api %{http_code}\n"    http://localhost:8080/api/time
docker compose ps
```

Expected: three `200`s and `docker compose ps` showing valkey/server healthy. The server-image build succeeding is itself the proof of the clean-clone fix — `.dockerignore` now excludes `*.generated.ts`, so the build cannot cheat by inheriting host files.

Persistence check: place any widget on the board (or `curl -X PUT` a key via `/api/storage/<key>`), then `docker compose down && docker compose up -d`, and confirm the key survives (`curl http://localhost:8080/api/storage/<key>` → 200). Tear down with `docker compose down` (never `-v` — that's the data volume now).

- [ ] **Step 6: Commit**

```bash
rtk git add .dockerignore packages/server/Dockerfile docker-compose.yml scripts/infra.test.ts
rtk git commit -m "fix(docker): reproducible server image (in-image codegen), valkey persistence, healthchecks"
```

---

### Task 6: Fix the two pre-existing defects blocking workspace gates

**Root causes being fixed (both predate this plan's changes — verified 2026-07-02):**

1. **CSS modules invisible to widget tsc programs.** `tsc --noEmit` for `widgets-clock` errors with TS2307 on `./clock.module.css` and on `../../widget-sdk/src/ui/WidgetControls.module.css` (widget-sdk sources are compiled _inside the widget's program_ via the `./ui/*` source exports). The ambient `declare module '*.module.css'` lives in two places, and neither is in the widget program: `vite/client` is not listed in the widgets' tsconfig `types` (which suppresses automatic type inclusion), and `packages/widget-sdk/src/vite-env.d.ts` is a root file only of widget-sdk's own tsconfig. Not upgrade-related: vite 8.0.16 and 8.1.2 `client.d.ts` both declare `*.module.css` (compared side-by-side in the pnpm store).
2. **WidgetFrame test depends on a live federation host.** `renders the loadable widget component content` uses the real generated catalog, whose `loadComponent` calls `loadRemote('clock/ui')` from `@module-federation/runtime`. Under Vitest the federation plugin is excluded (`process.env.VITEST` guard in [vite.config.ts:15](packages/client/vite.config.ts)) and nothing ever calls `init`/`createInstance`, so `loadRemote` throws `RUNTIME-009 Please call createInstance first`; the error boundary renders and `findByText(/:/)` times out after 30s. Pre-existing since `5c31f22` switched the catalog to `loadRemote`. Fix: mock the MF runtime module in this test file so the test still exercises the real catalog entry and the generated `loadRemoteModule` unwrap logic, but hermetically.

**Files:**

- Modify: `packages/widgets/clock/tsconfig.json`
- Modify: `packages/widgets/ofelia-poop-duty/tsconfig.json`
- Modify: `packages/client/src/widget-host/ui/WidgetFrame.test.tsx`

**Interfaces:**

- Consumes: the generated catalog's loader contract — `loadRemote` is called with `` `${id}/ui` `` and its result may be a module with or without a `default` key (see `loadRemoteModule` in [codegen.ts:92](scripts/codegen.ts)).
- Produces: nothing new — green `pnpm typecheck` and `pnpm test` gates.

- [x] **Step 1: Reproduce the typecheck failure** — DONE (both expected TS2307 errors observed)

Run: `timeout 240 pnpm --filter widgets-clock typecheck`
Expected: FAIL with exactly two TS2307 errors (`WidgetControls.module.css` via widget-sdk source, `clock.module.css` local).

- [x] **Step 2: Pull `vite/client` into both widget tsc programs** — DONE

In `packages/widgets/clock/tsconfig.json` AND `packages/widgets/ofelia-poop-duty/tsconfig.json` change the `types` line (ofelia gets the same fix preemptively — it compiles the same widget-sdk UI sources, so it fails the same way the moment clock stops masking it):

```json
"types": ["vite/client", "vitest/globals", "@testing-library/jest-dom"],
```

`vite` is a direct devDependency of each widget, so the types resolve under pnpm's strict node_modules. Do NOT add a `declare module '*.module.css'` shim file instead — `vite/client`'s declaration is the canonical one and also types `import.meta.env`.

- [x] **Step 3: Verify typecheck workspace-wide** — DONE (`pnpm typecheck` exit 0)

Run: `timeout 240 pnpm --filter widgets-clock typecheck` → exit 0.
Run: `timeout 600 pnpm typecheck` → exit 0 (watch that ofelia doesn't surface next; if a DIFFERENT error class appears in another package, stop and re-diagnose — do not stack fixes).

- [x] **Step 4: Make the WidgetFrame remote test hermetic** — DONE

In `packages/client/src/widget-host/ui/WidgetFrame.test.tsx`, add next to the existing `vi.mock` calls:

```tsx
const federation = vi.hoisted(() => ({
  loadRemote: vi.fn(),
}))

vi.mock('@module-federation/runtime', () => ({
  loadRemote: federation.loadRemote,
}))
```

and replace the failing test:

```tsx
it('renders the loadable widget component content', async () => {
  const RemoteClock = () => <div>12:34</div>
  federation.loadRemote.mockResolvedValue({ default: RemoteClock })

  const { container } = render(
    <WidgetFrame instanceId="inst-1" typeId="clock" mode="small" tier="standard" />,
  )

  expect(await screen.findByText(/:/)).toBeInTheDocument()
  expect(federation.loadRemote).toHaveBeenCalledWith('clock/ui')
  expect(container.querySelector('iframe')).toBeNull()
})
```

This keeps the original intent — the REAL generated catalog entry for `clock` is resolved through `findWidgetType`, and the generated `loadRemoteModule` default-unwrap path runs — while removing the impossible dependency on a live MF host instance. The other seven tests mock `loadComponent` directly and never reach `loadRemote`, so the module mock is inert for them.

- [x] **Step 5: Run the test file** — DONE (loadable remote test passes and asserts `clock/ui`)

Run: `timeout 240 pnpm --filter client exec vitest run src/widget-host/ui/WidgetFrame.test.tsx`
Expected: 8 passed, 0 failed, and no 30s stalls.

- [ ] **Step 6: Full gates** — PARTIAL: `pnpm typecheck` exit 0; workspace test process lost its shell exit after package suites; `pnpm test:e2e` failed 7/15 on stale UI-tier/overlay expectations (federation artifacts and remote rendering passed)

```bash
timeout 900 pnpm test; echo "test exit=$?"
timeout 600 pnpm typecheck; echo "typecheck exit=$?"
```

Expected: both `exit=0`.

- [ ] **Step 7: Commit (two logical fixes, two commits)**

```bash
rtk git add packages/widgets/clock/tsconfig.json packages/widgets/ofelia-poop-duty/tsconfig.json
rtk git commit -m "fix(widgets): include vite/client types so CSS module imports typecheck"
rtk git add packages/client/src/widget-host/ui/WidgetFrame.test.tsx
rtk git commit -m "test(client): mock @module-federation/runtime in WidgetFrame remote test"
```

---

### Remaining verification & commit checklist (after Task 6 is green)

- [ ] Task 1 Step 6: docker:dev smoke (`down -v` → `up --build -d` → curl 5180/5181/5173) — then Task 1 Step 7 commit.
- [ ] Task 2 Step 5 / Task 3 Step 5 / Task 4 Step 5: commits (messages already specified in each task; Task 2's message takes the 3b variant).
- [x] Task 3 Step 4 tail: cold/warm timings + the deliberate-type-error probe (293.04s cold, 157.69s warm, error probe exit 1).
- [ ] Task 4 Step 4 tail: `du` size comparison + `timeout 1200 pnpm test:e2e` (also covers Task 2 Step 4's e2e gap).
- [ ] Write the ready-to-file upstream issue body for `@module-federation/vite` (hang after `✓ built` with Rolldown-Vite 8.1.2) and hand it to the user.
- [ ] Task 5 Step 6 commit remains; implementation and smoke/persistence verification are complete.

---

### Task 8: Client test-suite health (slow tests / silent fork deaths)

**Status: partially DONE (2026-07-02).** The suite went from 14m49s-with-crashes (or fully livelocked) to **1m15s, 82/86 passing, zero worker deaths**. Committed as `fix(client): stop silent vitest fork deaths…`.

**Root causes found (with profiler evidence):**

1. **Missing `fake-indexeddb` in the client vitest setup** (widget-sdk and widget-runtime setups had it; the client's didn't, though the dep was already in devDependencies). Without indexedDB, Dexie's failed open feeds `withStorageKey`'s error path as soon as a storage-backed atom connects; module-level effects (e.g. `selectInitialActiveBoard`) re-write on every revert → **infinite microtask cycle** that starves all timers (even `testTimeout`), so forks died silently ("Worker exited unexpectedly", no stderr, no exit hooks) and vitest hung. V8 tick profile of the repro: `dexie callListener → StorageError ctor (errore Tagged)` + `reatom withAbort/computedMiddleware` churn. FIXED: `import 'fake-indexeddb/auto'` first in `packages/client/src/vitest.setup.ts`.
2. **Node fetch rejects the app's relative `/api` URLs**, so every server-scope storage call failed — same livelock fuel class. FIXED: an "empty backend" fetch stub in the setup (storage GET → 404 = no value, listing → `{keys: []}`, writes → ok); tests that need real fetch behavior still `vi.stubGlobal` their own.

**RESOLVED 2026-07-02 — all 4 failures root-caused and fixed (client suite 86/86 in ~14s):**

1. **Cross-test state leak (the "error-card delete" 14ms failure + a detached-node ingredient of the 30s timeouts).** The Dexie db behind client storage is a module singleton; fake-indexeddb rows AND in-flight write publishes leaked across tests — a fresh `withStorageKey` subscription received the _previous_ test's board mid-test (proven with a transition-logging diagnostic: test B observed test A's clock instance arrive asynchronously). `removeInstance` was never buggy; the board-model is fine. FIX: `resetClientStorage()` test helper in `widget-runtime/storage/test/fakes` (macrotask hop → `db.entries.clear()` queued behind in-flight Dexie transactions → hop), called from a global `beforeEach` in `packages/client/src/vitest.setup.ts`.
2. **Detached card nodes (the 30s `within(card)` timeouts).** `beforeEach`'s redundant `localBoard.set({empty})` (redundant because `context.reset()` already restores the initial snapshot) scheduled a write whose publish landed MID-test, flipping Board through EmptyState and back — the card node found by `findByTestId` was detached (`card.isConnected === false`) while a live delete button existed elsewhere. FIX: drop the redundant set in `Board.test.tsx` / `FullscreenOverlay.test.tsx`.
3. **React 19 suspended-replay livelock (the worker-killing spin once the MF mock is applied).** `toWidgetType` (packages/widget-sdk/src/define-widget-client.ts) memoizes the loader PROMISE per widget type at module scope; React's `lazyInitializer` brands resolved thenables in place (`thenable.status = 'fulfilled'`). Any LATER `lazy()` around the same branded object (second mount of the same widget type — i.e. the next mounting test) throws a thenable that already reports fulfilled; react-dom replays the suspended unit synchronously (`SuspendedOnImmediate → SuspendedAndReadyToContinue → isThenableResolved → replaySuspendedUnitOfWork`) before the microtask that would settle the new lazy payload can run — infinite synchronous loop under `act()` (a real browser yields via the Scheduler, so prod only pays an extra hop). FIX: `loadComponent` returns a fresh derived promise (`pending.then((m) => m)`) instead of the cached branded object. MF mock recipe now applied to `Board.test.tsx` and `FullscreenOverlay.test.tsx`.
4. **`withStorageKey` revert livelock (prod hardening, was "bonus finding").** Failed writes reverted `target` to `prevState`, resonating with default-refilling effects (`selectInitialActiveBoard` pattern): revert → effect re-writes → write fails → revert… FIX (TDD, failing test first in `reatom-storage.test.ts`): keep the optimistic local state on failed writes, only record `error`; additionally the `.then`/`.finally` continuations are now `wrap()`ed — unwrapped they silently lost the reactive frame under `context.start` (error reporting no-op'd in SSR/tests; proven by diagnostic: `error.set` had no effect, `updatePromise` never cleared).

**Surfaced while verifying (pre-existing, NOT fixed here):** `ofelia-comments.test.ts` fails 3 subscription tests (`withStorageKeyReadonly` + computed week key driven through `context.start`) — fails identically on a clean tree at 86a65fa; previously masked because `pnpm -r test` aborted on the client failures first. Needs its own investigation (same `wrap`/context-frame bug class as item 4). Also fixed in passing: `scripts/infra.test.ts` port-range regex now accepts double-quoted YAML (compose was reformatted), and two unused imports in `ofelia-comments.ts` that failed `pnpm typecheck`.

**Hardening follow-ups (still open):**

- Consider dropping `testTimeout: 30000` / `asyncUtilTimeout: 30000` to ~5–10s so genuine failures stop costing 30s each.

---

### Task 9: Duplicate @reatom/core instances across federation boundaries — RESOLVED 2026-07-02

**Symptom:** widget-runtime and widgets ran different reatom module copies; storage-backed widgets (ofelia) stuck on their loading skeleton with `connected: false` storage atoms and a console storm.

**Root cause (verified in the running dev board):** `@module-federation/vite` dev mode never consumes the share scope — `__FEDERATION__.__SHARE__` had `@reatom/core@1001.1.0` registered with `loaded: false, useIn: []` while host and BOTH widget dev servers each imported their own prebundled copy (`@reatom_core.js` fetched from :5173, :5180 AND :5181 with different hashes). Reatom v1001 shares its context stack across same-version copies via `globalThis.__REATOM.stackFrames`, but every copy's import side effect unconditionally pushes ITS OWN fresh root frame (`STACK.push(context.start())` in @reatom/core), burying the root that owns all existing atom state — the page ran with **3 root frames** (3 distinct `context` atoms), splitting host board/storage state from widget state.

**Fix:** `ensureSingleReatomRoot()` (packages/widget-sdk/src/reatom/ensure-single-reatom-root.ts) collapses trailing root frames on the shared stack down to the oldest root; it reads `globalThis.__REATOM` directly (no @reatom/core import — it must target the shared structure, not one copy's view). Called from `toWidgetType.loadComponent` right after the remote's module graph resolves: the duplicate copy's import-time push has already happened, and none of the widget's atoms have been read yet (React renders the lazy component only after that promise resolves). Same-version copies interoperate safely over one root: the stack array is shared, frames are plain objects, and each atom is always processed by the copy that created it (`isAtom` is duck-typed; `AtomInitState instanceof` stays within the creating copy's middleware).

**Proof:** dev board before → `stackFrames.length === 3`, ofelia skeleton forever, `connected: false` storm; after → `stackFrames.length === 1`, single context atom, `connected: true`, clock ticking (ofelia skeleton in the serverless `pnpm dev` stand is expected — its `view.ready` needs the first `/api/time` sync). Unit-tested in `ensure-single-reatom-root.test.ts` (simulates the duplicate-copy root push via `STACK.push(context.start())`, asserts split-brain then recovery). If share negotiation ever starts working (or in prod where it may), the call is a no-op.

---

## Verification Summary

| Problem                                    | Proof of fix                                                                                                                                                                                                      |
| ------------------------------------------ | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| docker:dev remotes                         | `curl localhost:5180/5181/remoteEntry.js` → 200 from the compose stack; board renders without the WidgetFrame error boundary; `scripts/infra.test.ts` guards regressions                                          |
| docker:dev install hang                    | `install` completes in minutes on first run (visible `downloaded N` progress into the `pnpm_store` volume), seconds on re-runs; no `.pnpm-store` reappears in the repo root                                       |
| vite build hang                            | `timeout`-guarded `pnpm build` exits 0 without the wrapper (or documented bisect + kept wrapper)                                                                                                                  |
| build speed / chunks                       | timed cold/warm `pnpm build` before/after; `du` of dists; MF warnings gone; e2e green                                                                                                                             |
| prod stack                                 | server image builds with generated files dockerignored (clean-clone equivalent); `curl :8080/`, `/widgets/clock/remoteEntry.js`, `/api/time` → 200; storage key survives `down`/`up`; `docker compose ps` healthy |
| widget CSS-module typecheck (pre-existing) | `pnpm typecheck` exit 0 workspace-wide with `vite/client` in widget tsconfig `types`                                                                                                                              |
| WidgetFrame MF test (pre-existing)         | `pnpm test` exit 0; WidgetFrame suite 8/8 with `@module-federation/runtime` mocked, no 30s stalls                                                                                                                 |
