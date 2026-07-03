# Widget Production Build + Deployment Implementation Plan (Plan 3 of 3)

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Finish widget build isolation by assembling every independently-built widget remote into the host artifact before PWA generation, serving that artifact from the production nginx image, testing both the assembled preview and real nginx topology, and correcting repository/deployment documentation.

**Architecture:** This is Phased Rollout steps 5–6 of `docs/superpowers/specs/2026-06-30-widget-build-isolation-design.md`. The root build first runs codegen and every `widgets/*` build, then the client Vite build uses a tested `widget-sdk/vite` plugin to copy each remote's complete `dist/` tree into `client/dist/widgets/<id>/` during `writeBundle`; `vite-plugin-pwa` runs `generateSW` afterward and its existing recursive `globPatterns` precache those files with revision hashes. Local Playwright runs against this self-contained host artifact, while a separate nginx smoke suite checks the actual Docker image, strict `/widgets/` 404 behavior, MIME types, and runtime mounting without making every normal e2e run Docker-dependent.

**Tech Stack:** pnpm workspaces, TypeScript 6, Vite 8/Rolldown, `@module-federation/vite`, `vite-plugin-pwa`/Workbox, Vitest, Playwright, Docker Compose, nginx, Pi CLI.

---

## Global Constraints

- Plan 1 (`2026-07-01-widget-runtime-sdk-extraction.md`) and Plan 2 (`2026-07-01-widget-federation-and-codegen.md`) are prerequisites. Start from the post-Plan-2 tree: per-widget packages exist, `widgets/.ports.json` is committed, host production remotes use `/widgets/<id>/remoteEntry.js`, and preview e2e currently proxies to separate widget preview servers.
- Preserve the existing uncommitted change in `client/src/widget-registry/model/registry.test.ts`; it predates this plan and is not part of any commit below.
- Use `pnpm` from the repository root. In this Windows environment, run every `pnpm`, `node`, `npm`, and `corepack` invocation outside the default sandbox as required by `AGENTS.md`.
- Do not add a runtime `CacheFirst` rule for `/widgets/**`. Widget files are release artifacts and belong in the Workbox precache with content revisions; this is what makes a host + remotes update atomic.
- Keep the server as one Rspack bundle. No widget server image/process is introduced.
- New TypeScript filesystem helpers follow errore: expected read/parse/copy failures are returned as tagged errors; only the Vite plugin boundary converts the returned error into a thrown build failure because Rollup/Vite hook contracts signal failure by throwing.
- `widget-runtime` remains a federation singleton. `widget-sdk` remains outside the shared singleton scope.

## File Structure

**Create:**

- `widget-sdk/src/vite/widget-build-assets.ts` — discovers active widget packages, stages each complete widget build into the host output, and exposes the Vite `writeBundle` plugin.
- `widget-sdk/src/vite/widget-build-assets.test.ts` — filesystem contract tests: all active remotes copied, nested chunks preserved, stale host widget files removed, discovery failures returned, missing build rejected.
- `client/e2e/widget-build-artifacts.spec.ts` — assembled-host checks for remote assets, standalone harness, and Workbox precache revisions.
- `client/playwright.nginx.config.ts` — Docker/nginx-only Playwright configuration.
- `client/e2e/nginx-smoke.spec.ts` — real nginx checks for MIME/404 behavior and federated Clock mounting.

**Modify:**

- `widget-sdk/package.json` — add the direct `errore` dependency used by the build helper.
- `widget-sdk/src/vite/index.ts` — export the staging plugin.
- `widget-sdk/src/vite/widget-remotes.ts` and `.test.ts` — remove the temporary preview proxy now that the host artifact contains remotes.
- `package.json` — make root `pnpm build` build all widget packages before the client.
- `client/vite.config.ts` — stage widget builds before PWA generation, remove the preview widget proxy, and remove React/Reatom manual chunk groups that compete with federation sharing.
- `client/playwright.config.ts` — serve one self-contained production host artifact instead of three preview processes.
- `client/package.json` — expose the separate nginx smoke command.
- `client/tsconfig.e2e.json` — typecheck both Playwright config files.
- `client/Dockerfile` — install/build all workspace inputs required by codegen, remotes, and the host PWA.
- `client/nginx.conf` — serve existing widget assets as files and return 404 for missing remotes instead of the SPA shell.
- `AGENTS.md`, `CLAUDE.md` — replace stale pre-extraction/pre-federation paths and commands.
- `pi.toml` — update its build-cost comment; change the timeout value only if the measured Pi acceptance gate lacks five minutes of headroom.

---

## Task 1: Stage independently-built widget artifacts inside the host Vite build

**Files:**

- Create: `widget-sdk/src/vite/widget-build-assets.test.ts`
- Create: `widget-sdk/src/vite/widget-build-assets.ts`
- Modify: `widget-sdk/src/vite/index.ts`
- Modify: `widget-sdk/package.json`
- Modify: `pnpm-lock.yaml` (generated by install)

**Interfaces:**

- `stageWidgetBuilds({ widgetsDir })` is a Vite build-only plugin.
- `copyWidgetBuilds({ widgetsDir, outDir })` is the tested error-as-value filesystem operation.
- Active widget builds are discovered from `widgets/*/package.json`, exactly like codegen/root pnpm filters. `widgets/.ports.json` is not an active manifest: it intentionally retains unused entries when a widget is removed so surviving ports never change.

- [ ] **Step 1: Write the failing filesystem contract tests** — `widget-sdk/src/vite/widget-build-assets.test.ts`

```ts
import { mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { describe, expect, it } from 'vitest'

import {
  copyWidgetBuilds,
  MissingWidgetBuildError,
  WidgetAssetsIoError,
} from './widget-build-assets'

function fixture() {
  const root = mkdtempSync(join(tmpdir(), 'widget-build-assets-'))
  const widgetsDir = join(root, 'widgets')
  const outDir = join(root, 'client-dist')

  mkdirSync(join(widgetsDir, 'clock', 'dist', 'assets'), { recursive: true })
  mkdirSync(join(widgetsDir, 'ofelia-poop-duty', 'dist'), { recursive: true })
  writeFileSync(join(widgetsDir, 'clock', 'package.json'), '{}')
  writeFileSync(join(widgetsDir, 'ofelia-poop-duty', 'package.json'), '{}')
  writeFileSync(join(widgetsDir, 'clock', 'dist', 'remoteEntry.js'), 'clock-entry')
  writeFileSync(join(widgetsDir, 'clock', 'dist', 'assets', 'clock.js'), 'clock-chunk')
  writeFileSync(join(widgetsDir, 'ofelia-poop-duty', 'dist', 'remoteEntry.js'), 'ofelia-entry')

  return { root, widgetsDir, outDir }
}

describe('copyWidgetBuilds', () => {
  it('copies every complete widget dist tree and removes stale staged files', () => {
    const { widgetsDir, outDir } = fixture()
    mkdirSync(join(outDir, 'widgets', 'removed-widget'), { recursive: true })
    writeFileSync(join(outDir, 'widgets', 'removed-widget', 'remoteEntry.js'), 'stale')

    const result = copyWidgetBuilds({ widgetsDir, outDir })

    expect(result).toEqual(['clock', 'ofelia-poop-duty'])
    expect(readFileSync(join(outDir, 'widgets', 'clock', 'remoteEntry.js'), 'utf8')).toBe(
      'clock-entry',
    )
    expect(readFileSync(join(outDir, 'widgets', 'clock', 'assets', 'clock.js'), 'utf8')).toBe(
      'clock-chunk',
    )
    expect(() =>
      readFileSync(join(outDir, 'widgets', 'removed-widget', 'remoteEntry.js'), 'utf8'),
    ).toThrow()
  })

  it('returns a tagged error when the widgets directory cannot be read', () => {
    const { root, outDir } = fixture()

    expect(copyWidgetBuilds({ widgetsDir: join(root, 'missing-widgets'), outDir })).toBeInstanceOf(
      WidgetAssetsIoError,
    )
  })

  it('returns a tagged error when a discovered widget has not been built', () => {
    const { widgetsDir, outDir } = fixture()
    mkdirSync(join(widgetsDir, 'missing'), { recursive: true })
    writeFileSync(join(widgetsDir, 'missing', 'package.json'), '{}')

    const result = copyWidgetBuilds({ widgetsDir, outDir })

    expect(result).toBeInstanceOf(MissingWidgetBuildError)
    expect(result).toMatchObject({ widgetId: 'missing' })
  })
})
```

- [ ] **Step 2: Run the focused test and verify the red state**

Run: `pnpm --filter widget-sdk test -- src/vite/widget-build-assets.test.ts`

Expected: FAIL because `./widget-build-assets` does not exist.

- [ ] **Step 3: Add the direct errore dependency** — `widget-sdk/package.json`

Add to `dependencies` in alphabetical order:

```json
"errore": "^0.14.1"
```

Run: `pnpm install`

Expected: `widget-sdk/package.json` and `pnpm-lock.yaml` resolve `errore`; no unrelated dependency upgrades.

- [ ] **Step 4: Implement the error-as-value copier and Vite boundary** — `widget-sdk/src/vite/widget-build-assets.ts`

```ts
import { cpSync, existsSync, mkdirSync, readdirSync, rmSync } from 'node:fs'
import { resolve } from 'node:path'

import * as errore from 'errore'
import type { Plugin } from 'vite'

export class WidgetAssetsIoError extends errore.createTaggedError({
  name: 'WidgetAssetsIoError',
  message: 'Failed to $operation widget build assets at $path',
}) {}

export class MissingWidgetBuildError extends errore.createTaggedError({
  name: 'MissingWidgetBuildError',
  message: 'Widget $widgetId has no production build at $path',
}) {}

type CopyWidgetBuildsOptions = {
  widgetsDir: string
  outDir: string
}

type StageWidgetBuildsOptions = Omit<CopyWidgetBuildsOptions, 'outDir'>

function discoverWidgetIds(widgetsDir: string) {
  const entries = errore.try({
    try: () => readdirSync(widgetsDir, { withFileTypes: true }),
    catch: (cause) => new WidgetAssetsIoError({ operation: 'discover', path: widgetsDir, cause }),
  })
  if (entries instanceof Error) return entries

  return entries
    .filter((entry) => entry.isDirectory())
    .map((entry) => entry.name)
    .filter((widgetId) => existsSync(resolve(widgetsDir, widgetId, 'package.json')))
    .sort((a, b) => a.localeCompare(b))
}

export function copyWidgetBuilds({ widgetsDir, outDir }: CopyWidgetBuildsOptions) {
  const widgetIds = discoverWidgetIds(widgetsDir)
  if (widgetIds instanceof Error) return widgetIds

  const stagedWidgetsDir = resolve(outDir, 'widgets')
  const cleanResult = errore.try({
    try: () => {
      rmSync(stagedWidgetsDir, { recursive: true, force: true })
      mkdirSync(stagedWidgetsDir, { recursive: true })
    },
    catch: (cause) =>
      new WidgetAssetsIoError({ operation: 'clean', path: stagedWidgetsDir, cause }),
  })
  if (cleanResult instanceof Error) return cleanResult

  for (const widgetId of widgetIds) {
    const source = resolve(widgetsDir, widgetId, 'dist')
    if (!existsSync(source)) return new MissingWidgetBuildError({ widgetId, path: source })

    const target = resolve(stagedWidgetsDir, widgetId)
    const copyResult = errore.try({
      try: () => cpSync(source, target, { recursive: true }),
      catch: (cause) => new WidgetAssetsIoError({ operation: 'copy', path: source, cause }),
    })
    if (copyResult instanceof Error) return copyResult
  }

  return widgetIds
}

export function stageWidgetBuilds({ widgetsDir }: StageWidgetBuildsOptions): Plugin {
  return {
    name: 'stage-widget-builds',
    apply: 'build',
    writeBundle(outputOptions) {
      if (!outputOptions.dir) throw new Error('Vite did not provide a build output directory')

      const result = copyWidgetBuilds({ widgetsDir, outDir: outputOptions.dir })
      if (result instanceof Error) {
        throw new Error('Failed to stage widget builds in the host artifact', { cause: result })
      }
    },
  }
}
```

The thrown errors are confined to the Vite/Rollup hook boundary. All filesystem failures below it remain typed error values with preserved causes.

- [ ] **Step 5: Export the plugin** — append to `widget-sdk/src/vite/index.ts`

```ts
export * from './widget-build-assets'
```

- [ ] **Step 6: Run focused and package verification**

Run:

```bash
pnpm --filter widget-sdk test -- src/vite/widget-build-assets.test.ts
pnpm --filter widget-sdk typecheck
pnpm --filter widget-sdk test
```

Expected: all pass; the copier returns tagged errors rather than throwing in its direct tests.

- [ ] **Step 7: Commit**

```bash
git add widget-sdk/package.json widget-sdk/src/vite/widget-build-assets.ts widget-sdk/src/vite/widget-build-assets.test.ts widget-sdk/src/vite/index.ts pnpm-lock.yaml
git commit -m "build(widgets): stage remote artifacts for the host build"
```

---

## Task 2: Build widgets before the host and include them in the PWA precache

**Files:**

- Modify: `package.json`
- Modify: `client/vite.config.ts`
- Modify: `widget-sdk/src/vite/widget-remotes.ts`
- Modify: `widget-sdk/src/vite/widget-remotes.test.ts`

**Interfaces:**

- Root `pnpm build` is the production entrypoint: codegen → every widget build → client typecheck/build.
- `stageWidgetBuilds` runs in Vite's `writeBundle` phase. `vite-plugin-pwa` generates the service worker afterward from `client/dist`, so copied `widgets/**/*.{js,css,html,...}` files match the existing recursive Workbox glob.

- [ ] **Step 1: Make the root build order explicit** — `package.json`

Replace the root `build` script with:

```json
"build": "pnpm run codegen && pnpm --filter \"./widgets/*\" build && pnpm --filter client build"
```

The path glob remains discovery-based: adding a package under `widgets/` changes neither this script nor Docker.

- [ ] **Step 2: Wire artifact staging into the host build** — `client/vite.config.ts`

Replace the `widget-sdk/vite` import and path constants with:

```ts
import { apiProxy, federationShared, stageWidgetBuilds, widgetRemotes } from 'widget-sdk/vite'

const widgetsDir = resolve(__dirname, '../widgets')
const portsFile = resolve(widgetsDir, '.ports.json')
```

Insert the staging plugin after `tailwindcss()` and immediately before `VitePWA(...)`:

```ts
    react(),
    tailwindcss(),
    stageWidgetBuilds({ widgetsDir }),
    VitePWA({
```

`writeBundle` completes before `vite-plugin-pwa`'s service-worker generation. Do not add another Workbox glob: the existing `**/*.{js,css,html,ico,png,svg,webmanifest,woff2}` recursively includes the staged `widgets/` tree and assigns revision hashes.

- [ ] **Step 3: Reconcile Rolldown chunk groups with federation sharing** — `client/vite.config.ts`

Delete only these two manual groups:

```ts
            {
              name: 'react-vendor',
              test: /node_modules[\\/](react|react-dom)[\\/]/,
              priority: 20,
            },
            {
              name: 'reatom-vendor',
              test: /node_modules[\\/]@reatom[\\/]/,
              priority: 16,
            },
```

Keep `grid-vendor`, `storage-vendor`, and `ui-vendor`. React/Reatom/widget-runtime ownership is now controlled by federation's strict singleton configuration; a second manual partitioning rule for React/Reatom is redundant and can obscure duplicate/shared chunk diagnosis.

- [ ] **Step 4: Remove the temporary preview-widget proxy**

In `client/vite.config.ts`, replace:

```ts
  preview: {
    proxy: { ...apiProxy(), ...previewWidgetsProxy(portsFile) },
  },
```

with:

```ts
  preview: {
    proxy: apiProxy(),
  },
```

Delete `previewWidgetsProxy` from `widget-sdk/src/vite/widget-remotes.ts`:

```ts
export function previewWidgetsProxy(portsFile: string) {
  const ports = readWidgetPorts(portsFile)

  return Object.fromEntries(
    Object.entries(ports).map(([id, port]) => [
      `/widgets/${id}`,
      {
        target: `http://localhost:${port}`,
        changeOrigin: false,
      },
    ]),
  )
}
```

In `widget-sdk/src/vite/widget-remotes.test.ts`, import only:

```ts
import { readWidgetPort, widgetRemotes } from './widget-remotes'
```

and delete the `maps each widget id to a preview proxy target` test. Dev remotes still use their own ports; only production preview stops proxying because files now exist in the host output.

- [ ] **Step 5: Verify the build fails clearly if a remote was not built**

Run:

```powershell
Remove-Item -Recurse -Force widgets\clock\dist -ErrorAction SilentlyContinue
pnpm --filter client build
```

Expected: FAIL from `stage-widget-builds`, with `MissingWidgetBuildError` in the cause chain for `widgets\clock\dist`. This makes accidental host-only production builds fail rather than emitting a host with broken remote URLs.

- [ ] **Step 6: Run the root build and inspect the self-contained output**

Run:

```bash
pnpm build
```

Then run:

```powershell
Get-Item client\dist\widgets\clock\remoteEntry.js
Get-Item client\dist\widgets\ofelia-poop-duty\remoteEntry.js
Select-String -Path client\dist\sw.js -Pattern 'widgets/clock/remoteEntry.js','widgets/ofelia-poop-duty/remoteEntry.js'
```

Expected: both remote entries exist under `client/dist/widgets/`; `sw.js` contains both URLs with Workbox-generated content revisions. The widget `index.html` and nested chunks are also present because the complete remote `dist/` is copied.

- [ ] **Step 7: Run config/package verification**

Run:

```bash
pnpm --filter widget-sdk test -- src/vite/widget-remotes.test.ts src/vite/widget-build-assets.test.ts
pnpm --filter client typecheck
```

Expected: all pass; production remotes still resolve to same-origin `/widgets/<id>/remoteEntry.js`.

- [ ] **Step 8: Commit**

```bash
git add package.json client/vite.config.ts widget-sdk/src/vite/widget-remotes.ts widget-sdk/src/vite/widget-remotes.test.ts
git commit -m "build(widgets): assemble remotes before PWA generation"
```

---

## Task 3: Run normal e2e against the assembled host and cover the standalone harness

**Files:**

- Modify: `client/playwright.config.ts`
- Create: `client/e2e/widget-build-artifacts.spec.ts`

**Interfaces:**

- The normal Playwright suite stays local and fast: test API server + one Vite preview.
- The preview serves widget remotes directly from `client/dist/widgets/*`; no widget preview processes or widget proxy are involved.

- [ ] **Step 1: Collapse Playwright web servers to API + assembled host** — `client/playwright.config.ts`

Replace the `webServer` array with:

```ts
  webServer: [
    {
      command: 'pnpm --filter server build && node ../server/dist/test-server.cjs',
      url: 'http://localhost:8787/api/time',
      env: { PORT: '8787' },
      reuseExistingServer: !process.env['CI'],
      timeout: 120_000,
    },
    {
      command: 'pnpm -w build && npm run preview',
      url: 'http://localhost:4173/widgets/clock/remoteEntry.js',
      reuseExistingServer: !process.env['CI'],
      timeout: 240_000,
    },
  ],
```

The command runs from `client/`; `pnpm -w build` selects the root script and guarantees widget builds precede the client.

- [ ] **Step 2: Add assembled artifact, harness, and precache acceptance tests** — `client/e2e/widget-build-artifacts.spec.ts`

```ts
import { expect, test } from '@playwright/test'

const REMOTE_PATHS = [
  '/widgets/clock/remoteEntry.js',
  '/widgets/ofelia-poop-duty/remoteEntry.js',
] as const

function escapeRegex(value: string) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
}

test('the host artifact serves both federation remote entries as JavaScript', async ({
  request,
}) => {
  for (const path of REMOTE_PATHS) {
    const response = await request.get(path)
    expect(response.ok(), `${path} should exist`).toBe(true)
    expect(response.headers()['content-type']).toContain('javascript')
    expect(await response.text()).not.toContain('<!doctype html>')
  }
})

test('the copied Clock standalone harness renders from the host artifact', async ({ page }) => {
  await page.goto('/widgets/clock/')

  await expect(page.getByText(/:/)).toBeVisible()
})

test('Workbox precaches both remote entries with release revisions', async ({ page, request }) => {
  await page.goto('/')
  await page.evaluate(async () => {
    await navigator.serviceWorker.ready
  })

  const serviceWorker = await request.get('/sw.js')
  expect(serviceWorker.ok()).toBe(true)
  const source = await serviceWorker.text()

  for (const path of REMOTE_PATHS) {
    const relativePath = escapeRegex(path.slice(1))
    const revisionedEntry = new RegExp(
      `\\{(?=[^{}]*"url":"${relativePath}")(?=[^{}]*"revision":"[^"]+")[^{}]*\\}`,
    )
    expect(source).toMatch(revisionedEntry)
  }

  await expect
    .poll(async () => {
      return page.evaluate(async () => {
        const cacheNames = await caches.keys()
        const requests = (
          await Promise.all(
            cacheNames.map(async (cacheName) => (await caches.open(cacheName)).keys()),
          )
        ).flat()
        return requests.map((request) => new URL(request.url).pathname)
      })
    })
    .toEqual(expect.arrayContaining([...REMOTE_PATHS]))
})
```

- [ ] **Step 3: Run the new spec alone**

Run: `pnpm --filter client exec playwright test e2e/widget-build-artifacts.spec.ts`

Expected: 3 tests pass. Only the test API server and client preview processes start; the harness loads from `/widgets/clock/` inside the assembled host output.

- [ ] **Step 4: Run the complete normal e2e suite**

Run: `pnpm test:e2e`

Expected: existing widget interaction/Ofelia tests plus the new artifact tests pass. Browser requests for `/widgets/*` are served by the host preview itself, not proxied to ports 5180/5181.

- [ ] **Step 5: Commit**

```bash
git add client/playwright.config.ts client/e2e/widget-build-artifacts.spec.ts
git commit -m "test(widgets): verify assembled remotes and PWA precache"
```

---

## Task 4: Build and verify the real nginx production image

**Files:**

- Modify: `client/Dockerfile`
- Modify: `client/nginx.conf`
- Modify: `client/package.json`
- Modify: `client/playwright.config.ts`
- Create: `client/playwright.nginx.config.ts`
- Modify: `client/tsconfig.e2e.json`
- Create: `client/e2e/nginx-smoke.spec.ts`

**Interfaces:**

- Docker builds remotes and host in the same order as root `pnpm build`.
- nginx returns files under `/widgets/` or 404; it never substitutes `/index.html` for a missing remote/chunk.
- The Docker-only suite remains opt-in as `pnpm --filter client test:e2e:nginx` and targets the running Compose stack on port 8080.

- [ ] **Step 1: Build the complete workspace input in the client image** — replace `client/Dockerfile`

```dockerfile
# syntax=docker/dockerfile:1

# --- build stage: build every widget remote, then assemble the host PWA ---
FROM node:22-alpine AS build
WORKDIR /app
RUN corepack enable

COPY pnpm-lock.yaml pnpm-workspace.yaml package.json ./
COPY client/package.json ./client/
COPY server/package.json ./server/
COPY shared/package.json ./shared/
COPY widget-runtime/package.json ./widget-runtime/
COPY widget-sdk/package.json ./widget-sdk/
# Widget package discovery is directory-based. Copying the tree before install
# keeps Docker correct when a new widgets/* package is added without editing
# this Dockerfile.
COPY widgets ./widgets
RUN pnpm install --frozen-lockfile

COPY shared ./shared
COPY widget-runtime ./widget-runtime
COPY widget-sdk ./widget-sdk
COPY scripts ./scripts
COPY client ./client

# Typechecking runs in CI. The image build keeps the same production artifact
# order as the root build while invoking Vite directly for the host on slow Pi
# hardware: codegen -> every remote -> host/PWA assembly.
RUN pnpm run codegen \
    && pnpm --filter "./widgets/*" build \
    && pnpm --filter client exec vite build

# --- runtime stage: serve static files + reverse-proxy /api -> server ---
FROM nginx:alpine AS runtime
COPY client/nginx.conf /etc/nginx/conf.d/default.conf
COPY --from=build /app/client/dist /usr/share/nginx/html
EXPOSE 80
```

- [ ] **Step 2: Give widget files strict nginx routing** — `client/nginx.conf`

Insert these locations after `/api/` and before the catch-all `location /`:

```nginx
    # Federation assets are real release files. Never fall back to index.html:
    # a missing remote/chunk must be a 404 so WidgetErrorBoundary gets a real
    # load failure instead of trying to parse the SPA shell as JavaScript.
    location ~ ^/widgets/[^/]+/remoteEntry\.js$ {
        try_files $uri =404;
        add_header Cache-Control "no-cache" always;
    }

    location /widgets/ {
        try_files $uri =404;
    }
```

Change the catch-all comment to:

```nginx
    # SPA routes only: serve the file if it exists, otherwise use the app shell.
```

`remoteEntry.js` is intentionally revalidated by HTTP caches. Offline behavior comes from the revisioned Workbox precache, not a stale nginx/browser `CacheFirst` policy.

- [ ] **Step 3: Add an isolated nginx Playwright config** — `client/playwright.nginx.config.ts`

```ts
import { defineConfig, devices } from '@playwright/test'

export default defineConfig({
  testDir: 'e2e',
  testMatch: 'nginx-smoke.spec.ts',
  outputDir: 'test-results/nginx',
  use: {
    baseURL: 'http://127.0.0.1:8080',
    screenshot: 'only-on-failure',
  },
  projects: [
    {
      name: 'nginx-chromium',
      use: { ...devices['Desktop Chrome'] },
    },
  ],
})
```

In normal `client/playwright.config.ts`, add next to `testDir`:

```ts
  testIgnore: 'nginx-smoke.spec.ts',
```

- [ ] **Step 4: Add the real-image smoke tests** — `client/e2e/nginx-smoke.spec.ts`

```ts
import { expect, test } from '@playwright/test'

import { BoardPage } from './pages/BoardPage.js'
import { HeaderPage } from './pages/HeaderPage.js'

test('nginx serves remote entries as JavaScript and never falls back for a missing remote', async ({
  request,
}) => {
  const remote = await request.get('/widgets/clock/remoteEntry.js')
  expect(remote.status()).toBe(200)
  expect(remote.headers()['content-type']).toContain('javascript')
  expect(remote.headers()['cache-control']).toContain('no-cache')
  expect(await remote.text()).not.toContain('<!doctype html>')

  const missing = await request.get('/widgets/missing/remoteEntry.js')
  expect(missing.status()).toBe(404)
  expect(await missing.text()).not.toContain('<div id="root">')
})

test('the production nginx image mounts Clock through the same-origin remote', async ({ page }) => {
  await page.goto('/')
  await page.evaluate(() => localStorage.clear())
  await page.reload()

  await new HeaderPage(page).addWidget('Часы')

  const card = new BoardPage(page).getCard(0)
  await expect(card.getByText(/:/)).toBeVisible()
  await expect(card.locator('[class*="skeleton"]')).toHaveCount(0)
})
```

- [ ] **Step 5: Wire the opt-in command and e2e typecheck**

Add to `client/package.json` scripts:

```json
"test:e2e:nginx": "playwright test --config playwright.nginx.config.ts"
```

Replace `client/tsconfig.e2e.json`'s include with:

```json
"include": ["e2e/**/*", "playwright*.config.ts"]
```

- [ ] **Step 6: Build and start the actual production stack**

Run:

```bash
docker compose up --build -d
```

Expected: Valkey, server, and client containers are running; the client image build logs show `widgets-clock`, `widgets-ofelia-poop-duty`, then the client Vite/PWA build. `client/dist/widgets/*` is copied into `/usr/share/nginx/html/widgets/*` by the image build.

- [ ] **Step 7: Run the nginx smoke suite and always stop the stack**

Run:

```bash
pnpm --filter client test:e2e:nginx
docker compose down
```

Expected: 2 tests pass against `127.0.0.1:8080`; the missing remote is a real 404. Run `docker compose down` even if Playwright fails so the fixed local ports are released.

- [ ] **Step 8: Typecheck and commit**

Run:

```bash
pnpm --filter client typecheck:e2e
```

Expected: PASS for both Playwright configs and all e2e files.

Commit:

```bash
git add client/Dockerfile client/nginx.conf client/package.json client/playwright.config.ts client/playwright.nginx.config.ts client/tsconfig.e2e.json client/e2e/nginx-smoke.spec.ts
git commit -m "test(deploy): verify widget remotes in the nginx image"
```

---

## Task 5: Correct repository docs and re-verify the Pi timeout

**Files:**

- Modify: `AGENTS.md`
- Modify: `CLAUDE.md`
- Modify: `pi.toml` comment; conditionally change `[timeouts].build` from `30m` to `45m` only at the measured gate below

**Interfaces:**

- Documentation describes the post-Plan-3 workspace and the root commands developers actually run.
- Pi's ingress remains `client:80`; deployment remains one Compose release.

- [ ] **Step 1: Replace the stale structure paragraph in `AGENTS.md`**

Use this text under `## Project Structure & Module Organization`:

```markdown
This is a private pnpm workspace with `client`, `server`, `shared`, `widget-runtime`, `widget-sdk`, and one package per `widgets/*` directory. The React/Vite board lives in `client/src`; widget implementations live in `widgets/<widget-name>` and each owns `client.ts`, `server.ts`, `types.ts`, `model/`, `ui/`, a federation `vite.config.ts`, and a standalone harness under `dev/`. `widget-runtime` owns the singleton live runtime (storage, widget RPC, SSE/BroadcastChannel, server time, runtime contracts); `widget-sdk` owns stateless Reatom/React glue and shared widget UI. Client features and widgets split React/CSS/view tests into `ui/` and Reatom/domain/storage logic into `model/`. Client e2e tests live in `client/e2e`; package tests are colocated as `*.test.ts` or `*.test.tsx`. The storage API lives in `server/src`, builds to `server/dist`, uses Valkey, and keeps all widget server functions in one bundle.
```

Update these command descriptions:

```markdown
- `pnpm dev`: run codegen, then start the board and every widget dev server in parallel.
- `pnpm dev:server`: run codegen, then start the server in watch mode.
- `pnpm build`: run codegen, build every widget remote, then typecheck/build the client host and PWA.
- `pnpm test:e2e`: run board Playwright tests against the assembled production-style Vite output.
- `pnpm --filter client test:e2e:nginx`: with `docker compose up --build -d` running, smoke-test the actual nginx image.
```

Replace the exported-component rule's first sentence with:

```markdown
All exported React function components in `client/src` and `widgets/*` must be defined with `reatomMemo` from `widget-sdk` (normally `widget-sdk/reatom/reatom-memo`).
```

Remove remaining claims that widgets or `reatomMemo` live under `client/widgets` / `client/src/shared/reatom`.

- [ ] **Step 2: Update `CLAUDE.md` architecture and commands**

Make the command comments match Step 1. Replace the workspace/widget/storage/component paragraphs with:

```markdown
**Workspace layout**: pnpm workspace with the `client` Vite/React host, the `server` Node API, root-level `shared`, singleton `widget-runtime`, stateless `widget-sdk`, and independently built `widgets/*` packages. `@/*` aliases only to `client/src`; shared widget code is imported through the two workspace package names.

### Widget system

- **`client/src/widget-registry`**: synchronous codegen-generated catalog metadata and icon map. Only `loadComponent` crosses the Module Federation boundary when a placed widget mounts.
- **`widgets/<widget-name>`**: one pnpm package per widget, split into `model/` and `ui/`, exposing only `./ui` as a federation remote and providing a standalone `dev/` harness. Adding a widget package and running codegen updates the client catalog, server registry, and stable port map without editing a hand-written registry.
- **`client/src/widget-host`**: mounts first-party widget components in the board React tree and provides frame/error-boundary/fullscreen behavior.
- **`widget-runtime` / `widget-sdk`**: shared runtime contracts/connections and stateless React/UI helpers respectively. React, React DOM, Reatom, and `widget-runtime` are strict federation singletons.

### Storage system (offline-first + sync)

`widget-runtime/src/storage` owns per-widget instance/shared scopes, Dexie and HTTP backends, SSE/BroadcastChannel fanout, and Reatom bindings. Board and standalone harnesses construct the same `WidgetRuntimeProps`; widgets do not import storage through `client/src`.

### Reatom + component convention

Every exported React function component in `client/src` and `widgets/*` is wrapped with `reatomMemo` from `widget-sdk`. Business logic, derived state, timers, and async flows belong in `model/`; `ui/` keeps refs, DOM interop, and minimal view glue. Class error boundaries stay internal and expose a `reatomMemo` wrapper.
```

In Deployment, state that the client image builds every remote first, stages them under `/widgets/<id>/`, and precaches them in the same PWA release.

- [ ] **Step 3: Update the Pi timeout comment without guessing a new value** — `pi.toml`

Keep `build = "30m"` initially. Replace its preceding comment with:

```toml
# The Pi builds every widget remote, assembles the client PWA/nginx image, and
# builds the server image in one Compose release. Keep at least five minutes of
# observed headroom when this pipeline changes.
```

- [ ] **Step 4: Verify no stale architecture paths remain**

Run:

```powershell
Select-String -Path AGENTS.md,CLAUDE.md -Pattern 'client/widgets','client/src/storage','client/src/shared/reatom','two packages'
```

Expected: no matches.

- [ ] **Step 5: Commit documentation and the measured-time comment**

```bash
git add AGENTS.md CLAUDE.md pi.toml
git commit -m "docs(widgets): document isolated build and deployment workflow"
```

- [ ] **Step 6: Run the Pi acceptance gate from a remotely available commit**

After the implementation commit is pushed to the configured repository, run from the project root:

```powershell
$ref = git rev-parse HEAD
pi deploy --ref $ref
```

Expected: fetch/build/up/healthcheck succeed; `/widgets/clock/remoteEntry.js` is served by the deployed ingress; recorded build duration is **25 minutes or less**, leaving at least five minutes below the current `30m` build timeout.

If the build exceeds 25 minutes or times out, change exactly:

```toml
[timeouts]
build = "45m"
```

then commit and repeat the same deploy command:

```bash
git add pi.toml
git commit -m "chore(deploy): increase Pi timeout for widget builds"
```

Expected after the conditional change: deploy succeeds with at least five minutes of headroom. Do not change ingress, healthcheck, Compose service names, or introduce a separate widget deployment.

---

## Task 6: Final verification and release boundary checks

**Files:**

- Verify only

- [ ] **Step 1: Simulate a fresh generated/build state**

Delete only ignored outputs and generated registries, preserving user changes:

```powershell
Get-ChildItem widgets -Directory | ForEach-Object {
  Remove-Item -Recurse -Force (Join-Path $_.FullName 'dist') -ErrorAction SilentlyContinue
}
Remove-Item -Recurse -Force client\dist -ErrorAction SilentlyContinue
Remove-Item client\src\widget-registry\model\*.generated.ts -ErrorAction SilentlyContinue
Remove-Item server\src\widgets\widget-server-list.generated.ts -ErrorAction SilentlyContinue
```

- [ ] **Step 2: Run the complete non-Docker matrix**

Run:

```bash
pnpm install --frozen-lockfile
pnpm typecheck
pnpm test
pnpm build
pnpm test:e2e
pnpm lint
pnpm format:check
```

Expected: all pass from missing generated/build outputs. `pnpm build` recreates both widget dists, stages them in `client/dist/widgets`, and generates a service worker containing both remote entries.

- [ ] **Step 3: Re-run the real-image gate**

Run:

```bash
docker compose up --build -d
pnpm --filter client test:e2e:nginx
docker compose down
```

Expected: Docker build and both nginx smoke tests pass; stack is stopped afterward.

- [ ] **Step 4: Confirm discovery and package boundaries**

Run:

```powershell
pnpm --filter "./widgets/*" list --depth -1
git diff --exit-code widgets\.ports.json
Select-String -Path client\dist\sw.js -Pattern 'widgets/clock/remoteEntry.js','widgets/ofelia-poop-duty/remoteEntry.js'
git grep -n "previewWidgetsProxy"
```

Expected: both widget packages are selected; `.ports.json` is stable; both remotes are revisioned in the service worker; `previewWidgetsProxy` has no matches.

- [ ] **Step 5: Confirm only intended work is staged/committed**

Run: `git status --short`

Expected: the pre-existing user edit in `client/src/widget-registry/model/registry.test.ts` remains untouched/uncommitted unless the user separately decides to include it; no ignored `dist/` output is staged.

---

## Error Handling

- Missing widget `dist/` and filesystem discovery/copy failures: `copyWidgetBuilds` returns tagged errors with causes; `stageWidgetBuilds` converts them to a Vite build failure at the plugin boundary. The existing codegen/remote config remains responsible for validating `widgets/.ports.json`.
- Missing production remote/chunk: nginx returns 404, not `/index.html`; the existing lazy import rejection flows to `WidgetErrorBoundary` and its retry UI.
- Widget dev server unavailable: unchanged Plan-2 behavior; only that mounted widget fails.
- Shared singleton mismatch: unchanged strict federation build/dev failure for React, React DOM, Reatom, and `widget-runtime`.
- Offline/deploy update: widget files are Workbox precache entries with revisions. They update with the host service worker release; no independent stale runtime cache is introduced.

## Self-Review

**Spec coverage (Plan 3 = Phased Rollout steps 5–6):**

- Root build widgets → client, automatic discovery → Task 2.
- Copy widget artifacts before PWA generation; precache `/widgets/**` with revisions → Tasks 1–3.
- Reconcile manual React/Reatom chunk groups with federation sharing → Task 2.
- Dockerfile and nginx serve the same-image `/widgets/<id>/` topology; actual nginx verification → Task 4.
- Production-style board e2e plus standalone harness smoke → Task 3; real-image browser smoke → Task 4.
- Pi timeout re-verification with an explicit five-minute-headroom gate → Task 5.
- Correct stale `AGENTS.md` / `CLAUDE.md` structure and import references → Task 5.
- Full `pnpm build`, tests, typecheck, Docker production build from a clean generated state → Task 6.

**No unnecessary cache policy:** the existing recursive Workbox glob already includes nested widget JS/CSS/HTML after staging. The plan verifies revisioned entries and Cache Storage contents instead of adding a duplicate `CacheFirst` route that could retain stale `remoteEntry.js`.

**Type/name consistency:** `copyWidgetBuilds` is the error-as-value helper; `stageWidgetBuilds` is the Vite plugin exported from `widget-sdk/vite` and consumed by `client/vite.config.ts`. `widgetsDir` is the staging discovery root; `portsFile` remains the separate host federation port/path input. Normal e2e uses `widget-build-artifacts.spec.ts`; Docker-only e2e uses `nginx-smoke.spec.ts` and `playwright.nginx.config.ts`.

**Placeholder scan:** no TBD/TODO/implicit implementation steps. The only conditional is the measured Pi timeout gate, with exact threshold (`25m`), exact fallback (`45m`), exact config edit, and required redeploy.

---

## Execution Handoff

Plan complete and saved to `docs/superpowers/plans/2026-07-01-widget-production-deployment.md`. Two execution options:

**1. Subagent-Driven (recommended)** — dispatch a fresh subagent per task, review between tasks, fast iteration.

**2. Inline Execution** — execute tasks in this session using `superpowers:executing-plans`, with checkpoints after the PWA build, normal e2e, and nginx/Pi gates.

Which approach?
