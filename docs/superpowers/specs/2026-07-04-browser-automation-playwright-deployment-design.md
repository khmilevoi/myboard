# Browser Automation Playwright Host and Raspberry Pi Deployment Design

**Date:** 2026-07-04
**Status:** Approved
**Slug:** `browser-automation-playwright-deployment`
**Parent design:** [Passport Checker and Browser Automation Runtime Design](./2026-07-03-passport-checker-browser-automation-design.md)
**Depends on:** [Browser Automation Service Core Design](./2026-07-04-browser-automation-service-core-design.md)

## Goal

Replace the Subproject 2 fake executor boundary with a production persistent
headed Chromium host, and make `packages/browser-automation` operable in the
Raspberry Pi Docker Compose deployment.

Subproject 2 built the whole service around generated task definitions except the
real browser: a FIFO queue with deadlines and cancellation, dispatch, health,
graceful shutdown, a tagged error taxonomy, and a `BrowserExecutor<Context>` seam
whose only implementation today is `makeStubExecutor()`. This subproject supplies
the concrete `Context`, the real Playwright executor, the container that runs it
under Xvfb, the x11vnc/noVNC recovery surface, the profile volume, the Compose
runtime-secret plumbing, development support, and operator documentation.

## Scope

This subproject includes:

- the concrete `BrowserTaskContext` and a per-widget scoped secret reader;
- a refined `acquire(signal, widgetId)` executor seam;
- `makeChromiumExecutor`: a persistent-context lifecycle with crash recovery,
  abort-driven page teardown, and graceful profile flush;
- an always-registered `__diagnostics__/browser-check` self-test task;
- a slim Node/Debian ARM64 Docker image with **only Chromium** installed (pinned
  to the workspace Playwright version), running as the non-root `node` user, with
  Xvfb, x11vnc, noVNC/websockify, `init`, shared-memory configuration, a profile
  volume, and a liveness healthcheck;
- production and development Compose wiring, including runtime secrets sourced
  from the deployment environment (`pi env send`);
- an rspack production bundle and an in-image browser-registry codegen step;
- environment configuration for the profile directory and secrets directory;
- unit, fake-launch, real-browser integration, profile-persistence, redaction,
  and `docker compose config` tests;
- operator documentation (provisioning, SSH/noVNC recovery, diagnostics probe).

It excludes the main-server browser gateway and `BROWSER_AUTOMATION_URL` server
wiring (Subproject 4), all passport request logic, secret validation, and domain
error codes (Subproject 5), and the widget UI (Subproject 6).

## Design Decisions

Resolved during this subproject's brainstorming. These fix local details without
reopening any master-design or Subproject 2 boundary.

1. **Built-in diagnostics task for in-container verification.** The acceptance
   criterion "a generic fixture task runs in the container" is satisfied by an
   always-registered `(__diagnostics__, browser-check)` task, composed into the
   registry outside widget codegen. It exercises the full HTTP → queue → executor
   → Playwright → secret path with fixed, allowlisted behavior (navigate
   `about:blank`, evaluate a fixed expression, read a probe secret). It is not a
   generic browser API and is compatible with the master non-goals.
2. **Per-widget scoped secret reader.** `Context` exposes a `secrets` reader
   bound to the current widget. `acquire` is refined to `acquire(signal, widgetId)`
   so the executor builds the scoped reader. Subproject 2 explicitly anticipated
   refining `acquire`. Scoping is by `<widgetId>_<key>` file naming under the
   secrets directory, giving hard isolation between widgets.
3. **Concrete `Context` lives in `packages/browser-automation`.** The concrete
   `BrowserTaskContext` references Playwright's `Page` type, so it lives with the
   executor. Widget `browser.ts` files (Subproject 5) import it **type-only** and
   add `browser-automation` to their `devDependencies`. Type-only imports are
   erased at build time, so no runtime cycle is created even though the service
   already imports widgets through codegen.
4. **Fresh page per task, persistent context reused.** Each task gets a new tab
   from the one long-lived persistent `BrowserContext`; the session (cookies,
   `cf_clearance`) lives in the on-disk profile and survives per-task page
   recycling. Timeout aborts close only the aborted tab, never the browser, so the
   session is preserved for the caller's explicit retry.
5. **Headed always, no headless override.** Chromium runs `headless: false`
   everywhere for a consistent browser-visible fingerprint between unattended runs
   and manual Cloudflare recovery. In the container `DISPLAY=:99` is provided by
   Xvfb; on a developer host the native display is used with the same code path.
   No `HEADLESS` escape hatch is added.
6. **Chromium-only slim base (amends the master image decision).** The master
   design specified a Dockerfile based on the official Playwright Ubuntu image,
   which bundles Chromium, Firefox, and WebKit (~2.5 GB). This feature launches
   only Chromium, so Subproject 3 instead bases the image on `node:22-bookworm-slim`
   and installs only Chromium via `playwright@1.61.0 install --with-deps chromium`,
   pinned to the workspace Playwright version. The master design's Docker section
   is amended accordingly. Everything else about the runtime (headed under Xvfb,
   persistent profile, noVNC recovery, `init`, non-root user) is unchanged.

## Executor Seam, Context, and Secrets

### Concrete context

```ts
// packages/browser-automation/src/browser/context.ts
export type BrowserTaskContext = {
  page: import('playwright').Page   // a fresh tab, one per task
  secrets: WidgetSecrets            // scoped to the current widgetId
}

export type WidgetSecrets = {
  read(key: string): string | undefined
  has(key: string): boolean
}
```

The scoped reader resolves `read('series')` for widget `passport-checker` to
`<secretsDir>/passport-checker_series`. It reads the file **fresh on every call**
(no caching — "read only for the duration of an invocation"), **never logs the
value**, and rejects `key` values containing path separators or `..`. A missing
file returns `undefined`; the domain meaning of an absent secret (for example
`BrowserConfigurationError`) is decided by the Subproject 5 handler, so this
subproject stays free of passport semantics. The secrets directory is
`BROWSER_SECRETS_DIR` (default `/run/secrets`).

### Refined executor seam

```ts
export type BrowserExecutor<Context> = {
  acquire(signal: AbortSignal, widgetId: string): Promise<Error | Context>
  release(context: Context): Promise<void>
  shutdown(): Promise<void>
}
```

Adding `widgetId` to `acquire` is the single Subproject 2 seam refinement. It
changes one line in `dispatch.ts` (`executor.acquire(args.signal, args.widgetId)`),
plus the reusable fake executor and its tests. Dispatch still never inspects
`Context`; only the executor knows its shape.

## Persistent Chromium Host and Recovery

`makeChromiumExecutor({ launch, profileDir, secretsDir }): BrowserExecutor<BrowserTaskContext>`
holds one long-lived Playwright `BrowserContext` created by
`chromium.launchPersistentContext(profileDir, { headless: false, args: ['--disable-dev-shm-usage'] })`.
The context is reused across tasks; the profile (`profileDir`) persists the
session on disk. `launch` is an internal seam (default: the real
`launchPersistentContext`) that tests replace with a fake.

- **`acquire(signal, widgetId)`**
  1. If the persistent context is `null` or closed, relaunch it from the **same**
     `profileDir` (this is the crash-recovery path). A launch failure returns an
     `Error`, which dispatch wraps as `BrowserExecutorError`.
  2. Open a fresh tab: `page = await context.newPage()`.
  3. Register abort teardown: when `signal` aborts (the execution deadline), force
     `page.close()`. Without this, a hung `page.*` call would keep the FIFO lane
     blocked until Playwright's own timeout, because `queue.ts` aborts the signal
     but still awaits `run()` (acquire → handler → release) before starting the
     next task.
  4. Return `{ page, secrets: makeWidgetSecrets(widgetId, secretsDir) }`.
- **`release({ page })`**: `await page.close()` (idempotent with the abort close).
  The persistent context stays alive; the on-disk profile is untouched.
- **`shutdown()`**: close remaining pages and `await context.close()` exactly
  once, flushing the profile cleanly.
- **Crash recovery**: subscribe to the persistent context `close` / browser
  `disconnected` events and mark the context `null`. A task in flight at crash
  time sees its `page.*` reject → `BrowserTaskHandlerError` → the caller retries
  explicitly (no automatic retry). The next `acquire` relaunches from the same
  volume.

Concurrency is exactly one (the queue guarantees it), so no locking is needed and
only one tab exists at a time. Session persistence is independent of per-task page
recycling because it lives in the profile directory on disk.

## Diagnostics Self-Test Task

The service composes its registry from `[...widgetBrowserList, diagnosticsDefinition]`.
The diagnostics definition is a `RuntimeWidgetBrowserDefinition<BrowserTaskContext>`
with a reserved `widgetId` of `__diagnostics__` and one task `browser-check`:

- payload schema `z.object({})`;
- result schema `{ ok: boolean, secretPresent: boolean, userAgent: string }`;
- handler: `page.goto('about:blank')` (no network — the master non-goal against
  live calls is honored), `page.evaluate(() => navigator.userAgent)`, then
  `secrets.read('probe')` (scoped to `/run/secrets/__diagnostics___probe`), and
  return `{ ok: true, secretPresent: value !== undefined, userAgent }`. The secret
  value is never echoed.

The `__diagnostics__` sentinel cannot collide with kebab-case widget directory
names, and codegen never emits it. The task is always registered: it runs only on
the internal network, has fixed allowlisted behavior, and doubles as an
operational "is the browser alive after deploy?" probe.

To demonstrate the `/run/secrets` reader positively (`secretPresent: true`), the
development Compose and the real-browser integration test provision a fake
`__diagnostics___probe` secret. In production no probe secret is mounted, so
`secretPresent` reports `false` while still proving the scoped reader ran without
error; the diagnostics probe never depends on a real passport secret.

## Docker Image

`packages/browser-automation/Dockerfile`, multi-stage, mirroring the server image:

- **build stage** (`node:22-alpine`): stage widget package manifests, install with
  the frozen lockfile from a BuildKit cache mount, copy `shared`, `widgets`,
  `scripts`, and `browser-automation`, then run `pnpm run codegen:browser`
  (generating `widget-browser-list.generated.ts` inside the image — currently
  empty) and `pnpm --filter browser-automation build` (rspack → `dist/index.cjs`,
  externalizing `playwright` and `find-my-way`, bundling `errore` like the server
  rspack config).
- **runtime stage** (`node:22-bookworm-slim`, Debian 12, arm64):
  - as root: `apt-get install -y xvfb x11vnc novnc websockify fonts-liberation`;
    `npx playwright@1.61.0 install --with-deps chromium` (installs **only** Chromium
    plus its OS libraries into `PLAYWRIGHT_BROWSERS_PATH=/ms-playwright`, pinned to
    the workspace Playwright version); `chmod -R 755 /ms-playwright`;
    `mkdir -p /profile && chown node:node /profile` (an empty named volume inherits
    the `node` ownership at first creation);
  - `pnpm install --prod --filter browser-automation` with
    `PLAYWRIGHT_SKIP_BROWSER_DOWNLOAD=1` (the browser is installed explicitly above,
    not via the npm postinstall), then copy `dist`;
  - `USER node`; `ENTRYPOINT ["/docker-entrypoint.sh"]`.

Chromium is pinned to the exact Playwright `1.61.0`: the `playwright` npm package
and the `playwright@1.61.0 install` command resolve the same browser build. Only
Chromium is installed — Firefox and WebKit (which the official Playwright image
would bundle) are never present, keeping the Raspberry Pi image small.

### Entrypoint and process supervision

`docker-entrypoint.sh` runs under Compose `init: true` (tini reaps zombies):

```sh
Xvfb :99 -screen 0 1280x1024x24 -nolisten tcp &
x11vnc -display :99 -forever -shared -localhost -rfbport 5900 -nopw &
websockify --web=/usr/share/novnc 6080 localhost:5900 &
export DISPLAY=:99
exec node dist/index.cjs
```

The VNC endpoint has no password by design: the access boundary is the SSH tunnel
plus loopback binding (per the master design). x11vnc attaches to the same display
Chromium renders to (`:99`) so noVNC shows the real, already-running session.

### Healthcheck

The image is not guaranteed to ship `curl`/`wget`, so the healthcheck uses Node
against the liveness-only `/health` endpoint:

```
node -e "fetch('http://127.0.0.1:'+(process.env.PORT||8788)+'/health').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"
```

A Cloudflare challenge or any session-required outcome never flips `/health`
(Subproject 2 guarantees liveness-only health), so browser attention never causes
a restart loop.

## Compose Wiring

### Production (`docker-compose.yml`)

A new standalone service:

```yaml
browser-automation:
  build: { context: ., dockerfile: packages/browser-automation/Dockerfile }
  init: true
  environment:
    PORT: '8788'
    AUTOMATION_SSH_TARGET: ${AUTOMATION_SSH_TARGET}   # non-secret; consumed by SP5 error meta
  secrets:
    - source: passport_series
      target: passport-checker_series      # -> /run/secrets/passport-checker_series
    - source: passport_number
      target: passport-checker_number
  expose: ['8788']                          # internal network only, no public route
  ports: ['127.0.0.1:6080:6080']            # noVNC on the Pi loopback only
  volumes: [browser_profile:/profile]
  healthcheck:
    test: ['CMD', 'node', '-e', "fetch('http://127.0.0.1:8788/health').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"]
    interval: 30s
    timeout: 5s
    retries: 3
  restart: unless-stopped

secrets:
  passport_series: { environment: PASSPORT_SERIES }   # source: deployment env (.env via pi env send)
  passport_number: { environment: PASSPORT_NUMBER }

volumes:
  browser_profile:
```

- The main server does **not** depend on this service for its own health, and
  `BROWSER_AUTOMATION_URL` server wiring is added by Subproject 4; here the service
  stands alone.
- Secrets appear only as `/run/secrets/*` files, never in the container
  environment or image layers.

### Development (`docker-compose.dev.yml`)

The development service builds the **same Dockerfile** as production (it needs
Xvfb and a real browser, which the bind-mounted `node:22-alpine` dev services do
not have), with non-production inputs: fake secret values (`PASSPORT_SERIES` /
`PASSPORT_NUMBER` set to obviously-fake constants), a fake `__diagnostics___probe`
secret so the diagnostics probe reports `secretPresent: true`, a separate
development profile volume, and `BROWSER_SECRETS_DIR=/run/secrets`. It runs under
a `browser` Compose profile so the default `pnpm docker:dev` board stack is not
slowed by the heavy Playwright image build; `docker compose --profile browser`
starts it. Because it runs the built image (not a workspace bind-mount), it needs
no `node_modules` volume. Fast iteration on browser code uses the local
non-Docker `pnpm --filter browser-automation dev` entrypoint instead. The main
server may still run without the automation service.

## Configuration

`config.ts` (parsed as errors-as-values with sane defaults) gains:

- `BROWSER_PROFILE_DIR` — persistent user-data directory (default `/profile`);
- `BROWSER_SECRETS_DIR` — scoped-secret directory (default `/run/secrets`).

The existing `PORT`, `BROWSER_QUEUE_WAIT_MS`, and `BROWSER_TASK_TIMEOUT_MS`
remain. No passport or secret values are introduced as configuration.

## Build and Development Workflow

- `browser-automation/package.json` gains `"build": "rspack build"` and a
  `rspack.config.ts` modeled on the server's (externalizing `playwright` and
  `find-my-way`), the `@rspack/cli` devDependency, and `playwright: "1.61.0"` as an
  exact-pinned dependency.
- `pnpm run codegen` already includes the browser target; `pnpm test` and
  `pnpm typecheck` are recursive, so the package is covered without new root wiring
  beyond the existing patterns.
- Local (non-Docker) development: `pnpm --filter browser-automation dev` already
  runs `tsx watch src/index.ts`; `index.ts` swaps the stub for the real Chromium
  executor at its single construction site. On a developer host, headed Chromium
  opens on the native display; `BROWSER_PROFILE_DIR=.dev-profile` and
  `BROWSER_SECRETS_DIR=.dev-secrets` (both git-ignored) are used. A one-time
  `pnpm exec playwright install chromium` step is documented.
- The `index.ts` construction site is the single line Subproject 2 promised
  Subproject 3 would replace.

## Operator Documentation

`packages/browser-automation/README.md` documents:

- provisioning `PASSPORT_SERIES`, `PASSPORT_NUMBER`, and `AUTOMATION_SSH_TARGET`
  through `pi env send` (and `pi env send --apply` when the running stack must
  restart);
- the Cloudflare recovery sequence:
  `ssh -L 6080:127.0.0.1:6080 $AUTOMATION_SSH_TARGET` → open
  `http://127.0.0.1:6080` locally → complete the challenge in the already-running
  persistent Chromium → close the tunnel → press Retry in the widget;
- the profile volume and why it must survive image rebuilds;
- how to run the diagnostics probe (`POST /tasks/__diagnostics__/browser-check`
  from inside the Compose network).

Real secret values never appear in documentation examples.

## Testing Strategy

No automated test contacts the real checker or any remote origin; the only
network target is a local fixture HTTP server.

### Unit and fake-launch tests (no real browser)

- **Scoped secret reader** (temp directory): reads `<dir>/<widgetId>_<key>`;
  returns `undefined` for a missing file; rejects `key` values with path
  separators or `..`; re-reads fresh on each call; the value never reaches a spy
  logger (proven with a sentinel value).
- **Executor lifecycle with a fake `launch`** (fake context/page counting
  `newPage`, `close`, and `on('close')`):
  - `acquire` opens a fresh page; a second `acquire` after a `close` event
    relaunches the persistent context (recovery);
  - an aborted `signal` closes the page; `release` is idempotent; `shutdown`
    closes the context exactly once.

### Real-browser integration tests (environment-gated, Linux/container)

Against a local fixture page served by a tiny HTTP server:

- the diagnostics handler returns `{ ok, secretPresent, userAgent }`;
- **profile persistence**: a value written on the fixture page (cookie or
  localStorage) survives `close` + relaunch from the same `profileDir`, validating
  the "profile survives a rebuild" criterion at the executor level (the full image
  rebuild is a manual Pi step).

These tests are skipped where a real browser is unavailable.

### Compose validation

`scripts/infra.test.ts` gains string assertions (matching the file's existing
style, no Docker required): the browser secrets map to
`/run/secrets/passport-checker_*`, noVNC binds to `127.0.0.1:6080`, and the
browser service exposes `8788` only to the internal network. Actually resolving
`docker compose config` with fake secret values is a manual/CI verification gate,
since it requires a Docker daemon that unit tests do not assume.

### Verification gates

- targeted `browser-automation` package tests and typecheck;
- workspace `pnpm test` and `pnpm typecheck` remain green;
- the browser Docker image builds;
- `docker compose config` succeeds with non-production secret values;
- a manual ARM64 Raspberry Pi smoke run of the diagnostics probe (assembled into
  the full stack in Subproject 7).

## Done When

- The diagnostics fixture task runs in the container through the real HTTP →
  queue → executor → Playwright path.
- The browser profile survives a browser-image rebuild.
- noVNC is reachable only through an SSH tunnel (loopback binding + SSH).
- Secrets appear only as `/run/secrets/*` files, never in environment, image
  layers, or logs.
- Browser attention (a Cloudflare challenge or session-required outcome) never
  fails process health.

## Deferred Work

Subproject 4 adds the main-server `WidgetServerContext.api.browser` gateway,
`BROWSER_AUTOMATION_URL` wiring, and `BrowserUnavailableError`. Subproject 5 adds
the passport `browser.ts` task, its scoped series/number secrets, Cloudflare-state
detection, and its domain error codes; it reads the non-secret
`AUTOMATION_SSH_TARGET` from the service process environment (not from `Context`)
when building its session-required error meta. Subproject 6 adds the widget UI and
RPC handler. Subproject 7 assembles the full stack and runs the Raspberry Pi
acceptance.
