# Browser Automation Playwright Host and Raspberry Pi Deployment Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the Subproject 2 stub executor with a production persistent headed Chromium host and make `packages/browser-automation` deployable in the Raspberry Pi Docker Compose stack.

**Architecture:** A per-widget scoped secret reader and a Playwright persistent-context executor fill the `BrowserExecutor<BrowserTaskContext>` seam. `index.ts` composes an always-registered `__diagnostics__/browser-check` self-test task with the generated widget list and wires the real executor. A pinned Playwright ARM64 image runs Chromium headed under Xvfb with an x11vnc/noVNC recovery surface bound to the Pi loopback; Compose supplies runtime secrets as `/run/secrets` files.

**Tech Stack:** TypeScript (ESM, `moduleResolution: bundler`), Playwright `1.61.0`, Zod, errore (errors-as-values), find-my-way, rspack (Node bundle), Vitest, Docker Compose, `mcr.microsoft.com/playwright:v1.61.0-noble`.

## Global Constraints

- **Playwright pinned exactly** to `1.61.0` (dependency `"playwright": "1.61.0"`, no `^`); the npm version and Docker image version MUST stay identical.
- **Runtime image:** `mcr.microsoft.com/playwright:v1.61.0-noble`, published for `linux/arm64`, run as the non-root `pwuser`.
- **Headed always:** Chromium launches `headless: false` everywhere; no `HEADLESS` override. Launch arg `--disable-dev-shm-usage`.
- **noVNC:** bound to `127.0.0.1:6080` only, no VNC password; the access boundary is SSH + loopback.
- **Secrets:** appear only as `/run/secrets/*` files, sourced from the deployment environment; never in the container `environment`, image layers, logs, or serialized errors. The scoped reader reads `<secretsDir>/<widgetId>_<key>` fresh on each call and never logs the value.
- **No live calls** to `pasport.org.ua` or any remote origin in automated tests; the only network target is a local fixture HTTP server.
- **errore style:** expected failures are returned as values; convert throwing boundaries immediately with `.catch(...)`; flat `instanceof Error` early returns; no `throw` across module boundaries.
- **Dispatch invariant:** the service core owns dispatch; `Context` is generic and never inspected by the core; concurrency is exactly one.
- **Repo code style:** no semicolons, single quotes, 2-space indent (oxfmt/oxlint). Import order: node builtins, external packages, then internal, separated by blank lines.

---

### Task 1: Config — profile and secrets directories

**Files:**
- Modify: `packages/browser-automation/src/config.ts`
- Test: `packages/browser-automation/src/config.test.ts`

**Interfaces:**
- Consumes: nothing new.
- Produces: `BrowserServiceConfig` gains `profileDir: string` (default `/profile`) and `secretsDir: string` (default `/run/secrets`); `loadBrowserServiceConfig(env)` returns them.

- [ ] **Step 1: Update the failing tests**

In `config.test.ts`, update the two `toEqual` expectations to include the new fields and add an override case:

```ts
  it('applies defaults when nothing is set', () => {
    expect(loadBrowserServiceConfig({})).toEqual({
      port: 8788,
      queueWaitMs: 30_000,
      executionMs: 60_000,
      profileDir: '/profile',
      secretsDir: '/run/secrets',
    })
  })

  it('parses positive integer overrides', () => {
    const config = loadBrowserServiceConfig({
      PORT: '9000',
      BROWSER_QUEUE_WAIT_MS: '5000',
      BROWSER_TASK_TIMEOUT_MS: '15000',
    })
    expect(config).toEqual({
      port: 9000,
      queueWaitMs: 5000,
      executionMs: 15000,
      profileDir: '/profile',
      secretsDir: '/run/secrets',
    })
  })

  it('reads profile and secrets directory overrides', () => {
    const config = loadBrowserServiceConfig({
      BROWSER_PROFILE_DIR: '/data/profile',
      BROWSER_SECRETS_DIR: '/tmp/secrets',
    })
    expect(config).toMatchObject({ profileDir: '/data/profile', secretsDir: '/tmp/secrets' })
  })
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `pnpm --filter browser-automation exec vitest run src/config.test.ts`
Expected: FAIL — returned object is missing `profileDir`/`secretsDir`.

- [ ] **Step 3: Implement config changes**

In `config.ts`, add a string-env helper and the two fields:

```ts
export type BrowserServiceConfig = {
  port: number
  queueWaitMs: number
  executionMs: number
  profileDir: string
  secretsDir: string
}
```

```ts
const stringEnv = (fallback: string) =>
  z.preprocess((value) => (value === undefined || value === '' ? fallback : value), z.string())

const ConfigSchema = z.object({
  PORT: positiveIntEnv(8788),
  BROWSER_QUEUE_WAIT_MS: positiveIntEnv(30_000),
  BROWSER_TASK_TIMEOUT_MS: positiveIntEnv(60_000),
  BROWSER_PROFILE_DIR: stringEnv('/profile'),
  BROWSER_SECRETS_DIR: stringEnv('/run/secrets'),
})
```

In the success return:

```ts
  return {
    port: parsed.data.PORT,
    queueWaitMs: parsed.data.BROWSER_QUEUE_WAIT_MS,
    executionMs: parsed.data.BROWSER_TASK_TIMEOUT_MS,
    profileDir: parsed.data.BROWSER_PROFILE_DIR,
    secretsDir: parsed.data.BROWSER_SECRETS_DIR,
  }
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `pnpm --filter browser-automation exec vitest run src/config.test.ts`
Expected: PASS (4 tests).

- [ ] **Step 5: Commit**

```bash
rtk git add packages/browser-automation/src/config.ts packages/browser-automation/src/config.test.ts
rtk git commit -m "feat(browser-automation): add profile and secrets dir config"
```

---

### Task 2: Scoped secret reader

**Files:**
- Create: `packages/browser-automation/src/browser/secrets.ts`
- Test: `packages/browser-automation/src/browser/secrets.test.ts`

**Interfaces:**
- Consumes: nothing.
- Produces:
  - `type WidgetSecrets = { read(key: string): string | undefined; has(key: string): boolean }`
  - `function makeWidgetSecrets(widgetId: string, dir: string): WidgetSecrets` — resolves `<dir>/<widgetId>_<key>`, reads fresh each call, returns `undefined` for a missing file or a `key` containing a path separator or `..`.

- [ ] **Step 1: Write the failing test**

Create `packages/browser-automation/src/browser/secrets.test.ts`:

```ts
import { mkdtempSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'

import { describe, expect, it, vi } from 'vitest'

import { makeWidgetSecrets } from './secrets'

function tempDir(): string {
  return mkdtempSync(path.join(tmpdir(), 'secrets-'))
}

describe('makeWidgetSecrets', () => {
  it('reads a scoped secret file by widget prefix', () => {
    const dir = tempDir()
    writeFileSync(path.join(dir, 'passport-checker_series'), 'AA\n')
    const secrets = makeWidgetSecrets('passport-checker', dir)
    expect(secrets.read('series')).toBe('AA')
    expect(secrets.has('series')).toBe(true)
  })

  it('returns undefined for a missing secret', () => {
    const secrets = makeWidgetSecrets('passport-checker', tempDir())
    expect(secrets.read('number')).toBeUndefined()
    expect(secrets.has('number')).toBe(false)
  })

  it('does not read another widget scope', () => {
    const dir = tempDir()
    writeFileSync(path.join(dir, 'other-widget_series'), 'ZZ')
    const secrets = makeWidgetSecrets('passport-checker', dir)
    expect(secrets.read('series')).toBeUndefined()
  })

  it('rejects path traversal in the key', () => {
    const secrets = makeWidgetSecrets('passport-checker', tempDir())
    expect(secrets.read('../etc/passwd')).toBeUndefined()
    expect(secrets.read('a/b')).toBeUndefined()
  })

  it('reads fresh on every call (no caching)', () => {
    const dir = tempDir()
    const file = path.join(dir, 'passport-checker_series')
    writeFileSync(file, 'AA')
    const secrets = makeWidgetSecrets('passport-checker', dir)
    expect(secrets.read('series')).toBe('AA')
    writeFileSync(file, 'BB')
    expect(secrets.read('series')).toBe('BB')
  })

  it('never logs the secret value', () => {
    const dir = tempDir()
    writeFileSync(path.join(dir, 'passport-checker_series'), 'TOP-SECRET-VALUE')
    const logs: string[] = []
    const spy = vi.spyOn(console, 'log').mockImplementation((...args) => {
      logs.push(args.join(' '))
    })
    const warn = vi.spyOn(console, 'warn').mockImplementation((...args) => {
      logs.push(args.join(' '))
    })
    makeWidgetSecrets('passport-checker', dir).read('series')
    spy.mockRestore()
    warn.mockRestore()
    expect(logs.join('\n')).not.toContain('TOP-SECRET-VALUE')
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm --filter browser-automation exec vitest run src/browser/secrets.test.ts`
Expected: FAIL with "Cannot find module './secrets'".

- [ ] **Step 3: Write the implementation**

Create `packages/browser-automation/src/browser/secrets.ts`:

```ts
import { readFileSync } from 'node:fs'
import path from 'node:path'

export type WidgetSecrets = {
  read(key: string): string | undefined
  has(key: string): boolean
}

// A key must be a single path segment: no separators, no traversal. This keeps
// a widget confined to its own `<widgetId>_<key>` scope under the secrets dir.
function isSafeKey(key: string): boolean {
  return key.length > 0 && !key.includes('/') && !key.includes('\\') && !key.includes('..')
}

export function makeWidgetSecrets(widgetId: string, dir: string): WidgetSecrets {
  function read(key: string): string | undefined {
    if (!isSafeKey(key)) return undefined
    try {
      return readFileSync(path.join(dir, `${widgetId}_${key}`), 'utf8').trim()
    } catch {
      return undefined
    }
  }
  return {
    read,
    has: (key) => read(key) !== undefined,
  }
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm --filter browser-automation exec vitest run src/browser/secrets.test.ts`
Expected: PASS (6 tests).

- [ ] **Step 5: Commit**

```bash
rtk git add packages/browser-automation/src/browser/secrets.ts packages/browser-automation/src/browser/secrets.test.ts
rtk git commit -m "feat(browser-automation): add per-widget scoped secret reader"
```

---

### Task 3: Refine the executor seam and add the concrete context type

**Files:**
- Create: `packages/browser-automation/src/browser/context.ts`
- Modify: `packages/browser-automation/src/executor.ts`
- Modify: `packages/browser-automation/src/dispatch.ts:34-36`
- Modify: `packages/browser-automation/src/testing/fake-executor.ts`
- Modify: `packages/browser-automation/src/executor.test.ts`
- Test: `packages/browser-automation/src/dispatch.test.ts` (add one case)

**Interfaces:**
- Consumes: `WidgetSecrets` from Task 2, Playwright `Page` type.
- Produces:
  - `type BrowserTaskContext = { page: import('playwright').Page; secrets: WidgetSecrets }`
  - `BrowserExecutor<Context>.acquire(signal: AbortSignal, widgetId: string): Promise<Error | Context>`
  - `FakeExecutorState` gains `lastWidgetId: string | null`.

- [ ] **Step 1: Write the failing test**

In `dispatch.test.ts`, add a case asserting the widgetId reaches `acquire` (append inside the `describe`):

```ts
  it('passes the widgetId to the executor acquire', async () => {
    const { executor, state } = makeFakeExecutor()
    await dispatchBrowserTask({
      ...base,
      registry: registryWith((p) => ({ echoed: p.value })),
      executor,
      payload: { value: 'hi' },
    })
    expect(state.lastWidgetId).toBe('demo')
  })
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm --filter browser-automation exec vitest run src/dispatch.test.ts`
Expected: FAIL — `state.lastWidgetId` is `undefined` (property does not exist yet).

- [ ] **Step 3: Refine the seam, context, dispatch, and fake**

Create `packages/browser-automation/src/browser/context.ts`:

```ts
import type { WidgetSecrets } from './secrets'

export type { WidgetSecrets } from './secrets'

// The concrete context handlers receive. `page` is a fresh tab per task; the
// persistent session lives in the executor's on-disk profile, not the page.
export type BrowserTaskContext = {
  page: import('playwright').Page
  secrets: WidgetSecrets
}
```

In `executor.ts`, refine the interface signature (keep `makeStubExecutor` for now — it is removed in Task 6; its zero-param `acquire` stays assignable):

```ts
export type BrowserExecutor<Context> = {
  acquire(signal: AbortSignal, widgetId: string): Promise<Error | Context>
  release(context: Context): Promise<void>
  shutdown(): Promise<void>
}
```

In `dispatch.ts`, pass the widgetId:

```ts
  const acquired = await args.executor
    .acquire(args.signal, args.widgetId)
    .catch((cause: unknown) => (cause instanceof Error ? cause : new Error(String(cause))))
```

In `testing/fake-executor.ts`, add `lastWidgetId` and capture it:

```ts
export type FakeExecutorState = {
  acquired: number
  released: number
  shutdowns: number
  lastSignal: AbortSignal | null
  lastWidgetId: string | null
  acquireError: Error | null
}
```

```ts
  const state: FakeExecutorState = {
    acquired: 0,
    released: 0,
    shutdowns: 0,
    lastSignal: null,
    lastWidgetId: null,
    acquireError: null,
  }
  const executor: BrowserExecutor<FakeContext> = {
    async acquire(signal, widgetId) {
      if (state.acquireError) return state.acquireError
      state.acquired += 1
      state.lastSignal = signal
      state.lastWidgetId = widgetId
      return { id: `ctx-${state.acquired}`, signal }
    },
    async release() {
      state.released += 1
    },
    async shutdown() {
      state.shutdowns += 1
    },
  }
```

In `executor.test.ts`, update every direct `acquire(...)` call to pass a widgetId (both the fake-executor and stub-executor blocks), e.g.:

```ts
    const context = await executor.acquire(controller.signal, 'demo')
```
```ts
    const context = await executor.acquire(new AbortController().signal, 'demo')
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `pnpm --filter browser-automation exec vitest run src/dispatch.test.ts src/executor.test.ts`
Expected: PASS (all cases, including the new widgetId case).

- [ ] **Step 5: Typecheck**

Run: `pnpm --filter browser-automation typecheck`
Expected: no errors.

- [ ] **Step 6: Commit**

```bash
rtk git add packages/browser-automation/src/browser/context.ts packages/browser-automation/src/executor.ts packages/browser-automation/src/dispatch.ts packages/browser-automation/src/testing/fake-executor.ts packages/browser-automation/src/executor.test.ts packages/browser-automation/src/dispatch.test.ts
rtk git commit -m "feat(browser-automation): scope acquire to widgetId and add BrowserTaskContext"
```

---

### Task 4: Chromium persistent-context executor

**Files:**
- Modify: `packages/browser-automation/package.json` (add `playwright` dependency)
- Create: `packages/browser-automation/src/browser/chromium-executor.ts`
- Test: `packages/browser-automation/src/browser/chromium-executor.test.ts`

**Interfaces:**
- Consumes: `BrowserExecutor`, `BrowserTaskContext`, `makeWidgetSecrets`.
- Produces:
  - `type LaunchPersistentContext = (profileDir: string) => Promise<import('playwright').BrowserContext>`
  - `function makeChromiumExecutor(deps: { profileDir: string; secretsDir: string; launch?: LaunchPersistentContext }): BrowserExecutor<BrowserTaskContext>`

- [ ] **Step 1: Add the pinned Playwright dependency**

In `packages/browser-automation/package.json`, add to `dependencies` (exact pin):

```json
    "playwright": "1.61.0",
```

Run: `pnpm install`
Expected: lockfile updated; `playwright` resolves. (Browser binaries are NOT required for the fake-launch unit tests; they are fetched later with `pnpm exec playwright install chromium` for the integration test.)

- [ ] **Step 2: Write the failing test**

Create `packages/browser-automation/src/browser/chromium-executor.test.ts`:

```ts
import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'

import type { BrowserContext } from 'playwright'
import { describe, expect, it } from 'vitest'

import { makeChromiumExecutor, type LaunchPersistentContext } from './chromium-executor'

type FakePage = { closed: boolean; close: () => Promise<void> }
type FakeContext = {
  pages: FakePage[]
  closed: boolean
  emitClose: () => void
  newPage: () => Promise<FakePage>
  on: (event: string, cb: () => void) => FakeContext
  close: () => Promise<void>
}

function makeFakeContext(): FakeContext {
  const closeListeners: (() => void)[] = []
  const ctx: FakeContext = {
    pages: [],
    closed: false,
    emitClose() {
      ctx.closed = true
      for (const cb of closeListeners) cb()
    },
    async newPage() {
      const page: FakePage = { closed: false, close: async () => void (page.closed = true) }
      ctx.pages.push(page)
      return page
    },
    on(event, cb) {
      if (event === 'close') closeListeners.push(cb)
      return ctx
    },
    async close() {
      ctx.emitClose()
    },
  }
  return ctx
}

function fakeLaunch(created: FakeContext[]): LaunchPersistentContext {
  return async () => {
    const ctx = makeFakeContext()
    created.push(ctx)
    return ctx as unknown as BrowserContext
  }
}

function deps(created: FakeContext[]) {
  return {
    profileDir: mkdtempSync(path.join(tmpdir(), 'profile-')),
    secretsDir: mkdtempSync(path.join(tmpdir(), 'secrets-')),
    launch: fakeLaunch(created),
  }
}

describe('makeChromiumExecutor', () => {
  it('launches once and opens a fresh page carrying scoped secrets', async () => {
    const created: FakeContext[] = []
    const executor = makeChromiumExecutor(deps(created))
    const ctx = await executor.acquire(new AbortController().signal, 'demo')
    if (ctx instanceof Error) throw ctx
    expect(created).toHaveLength(1)
    expect(created[0].pages).toHaveLength(1)
    expect(typeof ctx.secrets.read).toBe('function')
  })

  it('reuses the persistent context across acquires (new page each time)', async () => {
    const created: FakeContext[] = []
    const executor = makeChromiumExecutor(deps(created))
    await executor.acquire(new AbortController().signal, 'demo')
    await executor.acquire(new AbortController().signal, 'demo')
    expect(created).toHaveLength(1)
    expect(created[0].pages).toHaveLength(2)
  })

  it('relaunches after the persistent context closes (recovery)', async () => {
    const created: FakeContext[] = []
    const executor = makeChromiumExecutor(deps(created))
    await executor.acquire(new AbortController().signal, 'demo')
    created[0].emitClose()
    await executor.acquire(new AbortController().signal, 'demo')
    expect(created).toHaveLength(2)
  })

  it('closes the page when the signal aborts', async () => {
    const created: FakeContext[] = []
    const executor = makeChromiumExecutor(deps(created))
    const controller = new AbortController()
    const ctx = await executor.acquire(controller.signal, 'demo')
    if (ctx instanceof Error) throw ctx
    controller.abort()
    await Promise.resolve()
    expect(created[0].pages[0].closed).toBe(true)
  })

  it('release closes the page and is idempotent', async () => {
    const created: FakeContext[] = []
    const executor = makeChromiumExecutor(deps(created))
    const ctx = await executor.acquire(new AbortController().signal, 'demo')
    if (ctx instanceof Error) throw ctx
    await executor.release(ctx)
    await executor.release(ctx)
    expect(created[0].pages[0].closed).toBe(true)
  })

  it('shutdown closes the persistent context once', async () => {
    const created: FakeContext[] = []
    const executor = makeChromiumExecutor(deps(created))
    await executor.acquire(new AbortController().signal, 'demo')
    await executor.shutdown()
    await executor.shutdown()
    expect(created[0].closed).toBe(true)
  })
})
```

- [ ] **Step 3: Run test to verify it fails**

Run: `pnpm --filter browser-automation exec vitest run src/browser/chromium-executor.test.ts`
Expected: FAIL with "Cannot find module './chromium-executor'".

- [ ] **Step 4: Write the implementation**

Create `packages/browser-automation/src/browser/chromium-executor.ts`:

```ts
import { chromium, type BrowserContext } from 'playwright'

import type { BrowserExecutor } from '../executor'
import type { BrowserTaskContext } from './context'
import { makeWidgetSecrets } from './secrets'

export type LaunchPersistentContext = (profileDir: string) => Promise<BrowserContext>

const defaultLaunch: LaunchPersistentContext = (profileDir) =>
  chromium.launchPersistentContext(profileDir, {
    headless: false,
    args: ['--disable-dev-shm-usage'],
  })

export type ChromiumExecutorDeps = {
  profileDir: string
  secretsDir: string
  launch?: LaunchPersistentContext
}

export function makeChromiumExecutor(deps: ChromiumExecutorDeps): BrowserExecutor<BrowserTaskContext> {
  const launch = deps.launch ?? defaultLaunch
  let context: BrowserContext | null = null
  let contextClosed = false

  async function ensureContext(): Promise<Error | BrowserContext> {
    if (context && !contextClosed) return context
    const launched = await launch(deps.profileDir).catch((cause: unknown) =>
      cause instanceof Error ? cause : new Error('launch failed', { cause }),
    )
    if (launched instanceof Error) return launched
    context = launched
    contextClosed = false
    // Chromium crash or browser exit closes the persistent context; the next
    // acquire relaunches from the same on-disk profile.
    context.on('close', () => {
      contextClosed = true
    })
    return context
  }

  return {
    async acquire(signal, widgetId) {
      const ctx = await ensureContext()
      if (ctx instanceof Error) return ctx
      const page = await ctx.newPage()
      // The execution-deadline abort must promptly close the tab, or a hung
      // page operation would keep the single FIFO lane blocked (queue.ts awaits
      // release before the next task).
      const onAbort = () => void page.close().catch(() => {})
      if (signal.aborted) onAbort()
      else signal.addEventListener('abort', onAbort, { once: true })
      return { page, secrets: makeWidgetSecrets(widgetId, deps.secretsDir) }
    },
    async release(taskContext) {
      await taskContext.page.close().catch(() => {})
    },
    async shutdown() {
      if (context && !contextClosed) await context.close().catch(() => {})
      context = null
      contextClosed = true
    },
  }
}
```

- [ ] **Step 5: Run test to verify it passes**

Run: `pnpm --filter browser-automation exec vitest run src/browser/chromium-executor.test.ts`
Expected: PASS (6 tests).

- [ ] **Step 6: Commit**

```bash
rtk git add packages/browser-automation/package.json pnpm-lock.yaml packages/browser-automation/src/browser/chromium-executor.ts packages/browser-automation/src/browser/chromium-executor.test.ts
rtk git commit -m "feat(browser-automation): add persistent Chromium executor with recovery"
```

---

### Task 5: Diagnostics self-test task

**Files:**
- Create: `packages/browser-automation/src/diagnostics.ts`
- Test: `packages/browser-automation/src/diagnostics.test.ts`

**Interfaces:**
- Consumes: `defineWidgetBrowser`, `toRuntimeWidgetBrowserDefinition`, `BrowserTaskContext`.
- Produces:
  - `const DIAGNOSTICS_WIDGET_ID = '__diagnostics__'`
  - `const diagnosticsDefinition: RuntimeWidgetBrowserDefinition<BrowserTaskContext>` with one task `browser-check`, result `{ ok: boolean; secretPresent: boolean; userAgent: string }`.

- [ ] **Step 1: Write the failing test**

Create `packages/browser-automation/src/diagnostics.test.ts`:

```ts
import type { Page } from 'playwright'
import { describe, expect, it } from 'vitest'

import type { BrowserTaskContext } from './browser/context'
import type { WidgetSecrets } from './browser/secrets'
import { diagnosticsDefinition, DIAGNOSTICS_WIDGET_ID } from './diagnostics'

function fakePage(userAgent: string): Page {
  return {
    goto: async () => null,
    evaluate: async () => userAgent,
  } as unknown as Page
}

function fakeSecrets(value: string | undefined): WidgetSecrets {
  return { read: (key) => (key === 'probe' ? value : undefined), has: (key) => key === 'probe' && value !== undefined }
}

const handler = diagnosticsDefinition.handlers['browser-check']

describe('diagnostics browser-check', () => {
  it('uses the reserved diagnostics widget id', () => {
    expect(DIAGNOSTICS_WIDGET_ID).toBe('__diagnostics__')
    expect(diagnosticsDefinition.widgetId).toBe('__diagnostics__')
  })

  it('reports ok, the user agent, and secret presence', async () => {
    const context: BrowserTaskContext = { page: fakePage('FakeUA/1.0'), secrets: fakeSecrets('present') }
    const result = await handler({}, context)
    expect(result).toEqual({ ok: true, secretPresent: true, userAgent: 'FakeUA/1.0' })
  })

  it('reports secretPresent false when the probe is absent', async () => {
    const context: BrowserTaskContext = { page: fakePage('FakeUA/1.0'), secrets: fakeSecrets(undefined) }
    const result = await handler({}, context)
    expect(result).toMatchObject({ ok: true, secretPresent: false })
  })

  it('never echoes the secret value', async () => {
    const context: BrowserTaskContext = { page: fakePage('FakeUA/1.0'), secrets: fakeSecrets('TOP-SECRET') }
    const result = await handler({}, context)
    expect(JSON.stringify(result)).not.toContain('TOP-SECRET')
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm --filter browser-automation exec vitest run src/diagnostics.test.ts`
Expected: FAIL with "Cannot find module './diagnostics'".

- [ ] **Step 3: Write the implementation**

Create `packages/browser-automation/src/diagnostics.ts`:

```ts
import {
  defineWidgetBrowser,
  toRuntimeWidgetBrowserDefinition,
} from '@shared/widgets/browser-contracts'
import { z } from 'zod'

import type { BrowserTaskContext } from './browser/context'

export const DIAGNOSTICS_WIDGET_ID = '__diagnostics__'

const definition = defineWidgetBrowser<BrowserTaskContext>()({
  schemas: {
    'browser-check': {
      payload: z.object({}),
      result: z.object({
        ok: z.boolean(),
        secretPresent: z.boolean(),
        userAgent: z.string(),
      }),
    },
  },
  handlers: {
    'browser-check': async (_payload, { page, secrets }) => {
      await page.goto('about:blank')
      // String form avoids pulling the DOM lib into this Node service's tsconfig.
      const userAgent = String(await page.evaluate('navigator.userAgent'))
      return { ok: true, secretPresent: secrets.read('probe') !== undefined, userAgent }
    },
  },
})

export const diagnosticsDefinition = toRuntimeWidgetBrowserDefinition({
  widgetId: DIAGNOSTICS_WIDGET_ID,
  definition,
})
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm --filter browser-automation exec vitest run src/diagnostics.test.ts`
Expected: PASS (4 tests).

- [ ] **Step 5: Commit**

```bash
rtk git add packages/browser-automation/src/diagnostics.ts packages/browser-automation/src/diagnostics.test.ts
rtk git commit -m "feat(browser-automation): add diagnostics browser-check self-test task"
```

---

### Task 6: Compose the registry, wire the real executor, remove the stub

**Files:**
- Create: `packages/browser-automation/src/tasks/compose.ts`
- Test: `packages/browser-automation/src/tasks/compose.test.ts`
- Modify: `packages/browser-automation/src/index.ts`
- Modify: `packages/browser-automation/src/executor.ts` (remove `makeStubExecutor`)
- Modify: `packages/browser-automation/src/executor.test.ts` (remove the stub-executor block)

**Interfaces:**
- Consumes: `makeWidgetBrowserRegistry`, `diagnosticsDefinition`, `widgetBrowserList`, `makeChromiumExecutor`.
- Produces: `function composeBrowserRegistry(widgetBrowserList: readonly RuntimeWidgetBrowserDefinition<BrowserTaskContext>[]): DuplicateWidgetBrowserTaskError | WidgetBrowserRegistry<BrowserTaskContext>`.

- [ ] **Step 1: Write the failing test**

Create `packages/browser-automation/src/tasks/compose.test.ts`:

```ts
import {
  defineWidgetBrowser,
  toRuntimeWidgetBrowserDefinition,
} from '@shared/widgets/browser-contracts'
import { describe, expect, it } from 'vitest'
import { z } from 'zod'

import type { BrowserTaskContext } from '../browser/context'
import { DuplicateWidgetBrowserTaskError } from './registry'
import { composeBrowserRegistry } from './compose'

const widgetDefinition = toRuntimeWidgetBrowserDefinition({
  widgetId: 'demo',
  definition: defineWidgetBrowser<BrowserTaskContext>()({
    schemas: { run: { payload: z.object({}), result: z.object({ ok: z.boolean() }) } },
    handlers: { run: async () => ({ ok: true }) },
  }),
})

describe('composeBrowserRegistry', () => {
  it('always registers the diagnostics task', () => {
    const registry = composeBrowserRegistry([])
    if (registry instanceof Error) throw registry
    expect(registry.get('__diagnostics__')?.has('browser-check')).toBe(true)
  })

  it('registers widget tasks alongside diagnostics', () => {
    const registry = composeBrowserRegistry([widgetDefinition])
    if (registry instanceof Error) throw registry
    expect(registry.get('demo')?.has('run')).toBe(true)
    expect(registry.get('__diagnostics__')?.has('browser-check')).toBe(true)
  })

  it('rejects a widget that collides with the diagnostics id', () => {
    const collision = toRuntimeWidgetBrowserDefinition({
      widgetId: '__diagnostics__',
      definition: defineWidgetBrowser<BrowserTaskContext>()({
        schemas: { 'browser-check': { payload: z.object({}), result: z.object({ ok: z.boolean() }) } },
        handlers: { 'browser-check': async () => ({ ok: true }) },
      }),
    })
    expect(composeBrowserRegistry([collision])).toBeInstanceOf(DuplicateWidgetBrowserTaskError)
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm --filter browser-automation exec vitest run src/tasks/compose.test.ts`
Expected: FAIL with "Cannot find module './compose'".

- [ ] **Step 3: Write the compose helper**

Create `packages/browser-automation/src/tasks/compose.ts`:

```ts
import type { RuntimeWidgetBrowserDefinition } from '@shared/widgets/browser-contracts'

import type { BrowserTaskContext } from '../browser/context'
import { diagnosticsDefinition } from '../diagnostics'
import { makeWidgetBrowserRegistry } from './registry'

export function composeBrowserRegistry(
  widgetBrowserList: readonly RuntimeWidgetBrowserDefinition<BrowserTaskContext>[],
) {
  return makeWidgetBrowserRegistry<BrowserTaskContext>([diagnosticsDefinition, ...widgetBrowserList])
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm --filter browser-automation exec vitest run src/tasks/compose.test.ts`
Expected: PASS (3 tests).

- [ ] **Step 5: Wire index.ts and remove the stub**

Replace `packages/browser-automation/src/index.ts` with:

```ts
import { makeChromiumExecutor } from './browser/chromium-executor'
import { loadBrowserServiceConfig } from './config'
import { makeBrowserHttpApp } from './http/app'
import { makeBrowserService } from './service'
import { composeBrowserRegistry } from './tasks/compose'
import { widgetBrowserList } from './tasks/widget-browser-list.generated'

const config = loadBrowserServiceConfig(process.env)
if (config instanceof Error) {
  console.error(config.message)
  process.exit(1)
}

const registry = composeBrowserRegistry(widgetBrowserList)
if (registry instanceof Error) {
  console.error(registry.message)
  process.exit(1)
}

const executor = makeChromiumExecutor({
  profileDir: config.profileDir,
  secretsDir: config.secretsDir,
})
const service = makeBrowserService({ registry, executor, config })
const app = makeBrowserHttpApp(service)

app.server.listen(config.port, () => {
  service.markReady()
  console.log(`browser-automation listening on :${config.port}`)
})

process.on('SIGTERM', () => {
  void service.shutdown().then(() => app.close())
})
process.on('SIGINT', () => {
  void service.shutdown().then(() => app.close())
})
```

In `executor.ts`, delete the `makeStubExecutor` function and its comment, leaving only the `BrowserExecutor<Context>` type.

In `executor.test.ts`, delete the entire `describe('stub executor', ...)` block and the `import { makeStubExecutor } from './executor'` line.

- [ ] **Step 6: Verify the package tests and typecheck**

Run: `pnpm --filter browser-automation exec vitest run`
Expected: PASS (all files; no stub references).
Run: `pnpm --filter browser-automation typecheck`
Expected: no errors.

- [ ] **Step 7: Commit**

```bash
rtk git add packages/browser-automation/src/tasks/compose.ts packages/browser-automation/src/tasks/compose.test.ts packages/browser-automation/src/index.ts packages/browser-automation/src/executor.ts packages/browser-automation/src/executor.test.ts
rtk git commit -m "feat(browser-automation): wire chromium executor and diagnostics registry"
```

---

### Task 7: Real-browser integration and profile persistence (env-gated)

**Files:**
- Create: `packages/browser-automation/src/browser/chromium-executor.integration.test.ts`

**Interfaces:**
- Consumes: `makeChromiumExecutor`, `diagnosticsDefinition`.
- Produces: nothing (verification only).

- [ ] **Step 1: Install the Chromium browser binary locally (one-time)**

Run: `pnpm --filter browser-automation exec playwright install chromium`
Expected: Chromium downloaded for Playwright `1.61.0`.

- [ ] **Step 2: Write the integration test**

Create `packages/browser-automation/src/browser/chromium-executor.integration.test.ts`:

```ts
import { mkdtempSync, writeFileSync } from 'node:fs'
import { createServer, type Server } from 'node:http'
import type { AddressInfo } from 'node:net'
import { tmpdir } from 'node:os'
import path from 'node:path'

import { afterAll, beforeAll, describe, expect, it } from 'vitest'

import { diagnosticsDefinition } from '../diagnostics'
import { makeChromiumExecutor } from './chromium-executor'

// Real browser tests are opt-in: they need a Chromium binary and a display
// (Xvfb in the container). Run with BROWSER_IT=1 on Linux/container or a
// headed-capable dev host.
const run = process.env.BROWSER_IT === '1'

describe.skipIf(!run)('chromium executor (real browser)', () => {
  let server: Server
  let url = ''

  beforeAll(async () => {
    server = createServer((_req, res) => {
      res.writeHead(200, { 'content-type': 'text/html' })
      res.end('<!doctype html><title>fixture</title><body>ok</body>')
    })
    await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve))
    url = `http://127.0.0.1:${(server.address() as AddressInfo).port}/`
  })

  afterAll(() => new Promise<void>((resolve) => server.close(() => resolve())))

  it('runs the diagnostics task against a real browser', async () => {
    const secretsDir = mkdtempSync(path.join(tmpdir(), 'it-secrets-'))
    writeFileSync(path.join(secretsDir, '__diagnostics___probe'), 'x')
    const executor = makeChromiumExecutor({
      profileDir: mkdtempSync(path.join(tmpdir(), 'it-profile-')),
      secretsDir,
    })
    const context = await executor.acquire(new AbortController().signal, '__diagnostics__')
    if (context instanceof Error) throw context
    const result = await diagnosticsDefinition.handlers['browser-check']({}, context)
    await executor.release(context)
    await executor.shutdown()
    expect(result).toMatchObject({ ok: true, secretPresent: true })
    expect(String((result as { userAgent: string }).userAgent)).toContain('Mozilla')
  })

  it('persists the profile across a relaunch', async () => {
    const profileDir = mkdtempSync(path.join(tmpdir(), 'it-persist-'))
    const secretsDir = mkdtempSync(path.join(tmpdir(), 'it-persist-secrets-'))

    const first = makeChromiumExecutor({ profileDir, secretsDir })
    const c1 = await first.acquire(new AbortController().signal, 'demo')
    if (c1 instanceof Error) throw c1
    await c1.page.goto(url)
    await c1.page.evaluate("localStorage.setItem('probe','kept')")
    await first.release(c1)
    await first.shutdown()

    const second = makeChromiumExecutor({ profileDir, secretsDir })
    const c2 = await second.acquire(new AbortController().signal, 'demo')
    if (c2 instanceof Error) throw c2
    await c2.page.goto(url)
    const value = await c2.page.evaluate("localStorage.getItem('probe')")
    await second.release(c2)
    await second.shutdown()
    expect(value).toBe('kept')
  })
})
```

- [ ] **Step 3: Run the integration test (opt-in)**

Run: `BROWSER_IT=1 pnpm --filter browser-automation exec vitest run src/browser/chromium-executor.integration.test.ts`
Expected: PASS (2 tests). On Windows PowerShell use `$env:BROWSER_IT=1; pnpm --filter browser-automation exec vitest run src/browser/chromium-executor.integration.test.ts`.

- [ ] **Step 4: Confirm the default suite still skips it**

Run: `pnpm --filter browser-automation exec vitest run`
Expected: the integration file is skipped (no browser needed); all other tests PASS.

- [ ] **Step 5: Commit**

```bash
rtk git add packages/browser-automation/src/browser/chromium-executor.integration.test.ts
rtk git commit -m "test(browser-automation): add env-gated real-browser and profile-persistence tests"
```

---

### Task 8: rspack production bundle and package build script

**Files:**
- Create: `packages/browser-automation/rspack.config.ts`
- Modify: `packages/browser-automation/package.json`
- Modify: `scripts/infra.test.ts:74-79` (the scripts `toEqual`)

**Interfaces:**
- Consumes: nothing.
- Produces: `pnpm --filter browser-automation build` emits `packages/browser-automation/dist/index.cjs`; `package.json` exports `./task-context` for Subproject 5.

- [ ] **Step 1: Update the failing infra assertion**

In `scripts/infra.test.ts`, update the `expect(manifest.scripts).toEqual(...)` to include the build script:

```ts
  expect(manifest.scripts).toEqual({
    dev: 'tsx watch src/index.ts',
    start: 'tsx src/index.ts',
    build: 'rspack build',
    test: 'vitest run',
    typecheck: 'tsc --noEmit -p tsconfig.json',
  })
```

- [ ] **Step 2: Run the infra test to verify it fails**

Run: `pnpm exec vitest run scripts/infra.test.ts -t "lightweight browser automation"`
Expected: FAIL — the manifest has no `build` script yet.

- [ ] **Step 3: Update the package manifest**

Edit `packages/browser-automation/package.json` to add `exports`, the `build` script, the `rspack` devDependencies, and the exact `playwright` pin (from Task 4):

```json
{
  "name": "browser-automation",
  "version": "0.0.0",
  "private": true,
  "type": "module",
  "exports": {
    "./task-context": "./src/browser/context.ts"
  },
  "scripts": {
    "dev": "tsx watch src/index.ts",
    "start": "tsx src/index.ts",
    "build": "rspack build",
    "test": "vitest run",
    "typecheck": "tsc --noEmit -p tsconfig.json"
  },
  "dependencies": {
    "errore": "catalog:",
    "find-my-way": "^9.6.0",
    "playwright": "1.61.0",
    "zod": "catalog:"
  },
  "devDependencies": {
    "@rspack/cli": "^1.3.14",
    "@rspack/core": "^1.3.14",
    "@types/node": "^25.9.3",
    "tsx": "^4.20.6",
    "typescript": "^6.0.3",
    "vitest": "catalog:"
  }
}
```

Run: `pnpm install`
Expected: `@rspack/cli` and `@rspack/core` resolve.

- [ ] **Step 4: Write the rspack config**

Create `packages/browser-automation/rspack.config.ts` (mirrors `packages/server/rspack.config.ts`; single entry, externalizes bare deps like `playwright`/`find-my-way`/`zod`, bundles `errore` and internal aliases):

```ts
import path from 'node:path'

import { defineConfig } from '@rspack/cli'

export default defineConfig({
  target: 'node',
  entry: { index: './src/index.ts' },
  output: {
    path: path.resolve(import.meta.dirname, 'dist'),
    filename: '[name].cjs',
    libraryTarget: 'commonjs2',
    compareBeforeEmit: false,
  },
  // Bundle only our own code; resolve dependencies (playwright, find-my-way,
  // zod) from node_modules at runtime. errore is ESM-only with no CJS require
  // condition, so it is bundled rather than externalized.
  externalsType: 'commonjs',
  externals: [
    ({ request }, callback) => {
      if (
        request &&
        !request.startsWith('.') &&
        !request.startsWith('@shared') &&
        !request.startsWith('@widgets') &&
        request !== 'errore' &&
        !path.isAbsolute(request)
      ) {
        return callback(undefined, `commonjs ${request}`)
      }
      callback()
    },
  ],
  module: {
    rules: [
      {
        test: /\.ts$/,
        exclude: /node_modules/,
        loader: 'builtin:swc-loader',
        options: { detectSyntax: 'auto' },
        type: 'javascript/auto',
      },
    ],
  },
  resolve: {
    alias: {
      '@shared': path.resolve(import.meta.dirname, '../shared'),
      '@widgets': path.resolve(import.meta.dirname, '../widgets'),
    },
    extensions: ['.ts', '.js'],
  },
})
```

- [ ] **Step 5: Generate the browser registry and build**

Run: `pnpm run codegen:browser && pnpm --filter browser-automation build`
Expected: `packages/browser-automation/dist/index.cjs` is produced with no errors.

- [ ] **Step 6: Run the infra test to verify it passes**

Run: `pnpm exec vitest run scripts/infra.test.ts -t "lightweight browser automation"`
Expected: PASS.

- [ ] **Step 7: Commit**

```bash
rtk git add packages/browser-automation/package.json packages/browser-automation/rspack.config.ts pnpm-lock.yaml scripts/infra.test.ts
rtk git commit -m "build(browser-automation): add rspack bundle and task-context export"
```

---

### Task 9: Dockerfile and process entrypoint

**Files:**
- Create: `packages/browser-automation/Dockerfile`
- Create: `packages/browser-automation/docker-entrypoint.sh`
- Modify: `scripts/infra.test.ts` (add a browser-image assertion block)

**Interfaces:**
- Consumes: the rspack `build` script and `codegen:browser` from Task 8.
- Produces: a runnable browser image whose registry is generated in-image.

- [ ] **Step 1: Write the failing infra assertions**

In `scripts/infra.test.ts`, after the "runs only server codegen in the server image" test, add a browser-image block (reads the new Dockerfile):

```ts
it('runs only browser codegen in the browser image', () => {
  const browserDockerfile = readFileSync(
    resolve(root, 'packages/browser-automation/Dockerfile'),
    'utf8',
  )
  expect(browserDockerfile).toContain(
    'RUN pnpm run codegen:browser && pnpm --filter browser-automation build',
  )
  expect(browserDockerfile).not.toContain('RUN pnpm run codegen:client')
  expect(browserDockerfile).not.toContain('RUN pnpm run codegen:server')
  expect(browserDockerfile).toContain('mcr.microsoft.com/playwright:v1.61.0-noble')
  expect(browserDockerfile).toContain('USER pwuser')
})
```

- [ ] **Step 2: Run the infra test to verify it fails**

Run: `pnpm exec vitest run scripts/infra.test.ts -t "browser codegen in the browser image"`
Expected: FAIL — the Dockerfile does not exist.

- [ ] **Step 3: Write the entrypoint script**

Create `packages/browser-automation/docker-entrypoint.sh`:

```sh
#!/bin/sh
set -e

# One persistent virtual display shared by Chromium and the VNC bridge, so noVNC
# shows the real running session during manual Cloudflare recovery.
Xvfb :99 -screen 0 1280x1024x24 -nolisten tcp &
x11vnc -display :99 -forever -shared -localhost -rfbport 5900 -nopw -quiet &
websockify --web=/usr/share/novnc 6080 localhost:5900 &

export DISPLAY=:99
exec node dist/index.cjs
```

- [ ] **Step 4: Write the Dockerfile**

Create `packages/browser-automation/Dockerfile`:

```dockerfile
# syntax=docker/dockerfile:1

# --- widget-manifests stage: reduce packages/widgets to package.json files so
# the install layer re-keys on manifest changes, not widget sources (mirrors the
# server image). Browser task discovery stays directory-based via browser.ts.
FROM node:22-alpine AS widget-manifests
COPY packages/widgets /widgets
RUN find /widgets -mindepth 2 -maxdepth 2 ! -name package.json -exec rm -rf {} +

# --- build stage: codegen:browser (generated registry is git/docker-ignored and
# MUST be generated here) + rspack bundle to dist/index.cjs ---
FROM node:22-alpine AS build
WORKDIR /app
RUN corepack enable

COPY pnpm-lock.yaml pnpm-workspace.yaml package.json ./
COPY packages/browser-automation/package.json ./packages/browser-automation/
COPY packages/client/package.json ./packages/client/
COPY packages/server/package.json ./packages/server/
COPY packages/shared/package.json ./packages/shared/
COPY packages/widget-runtime/package.json ./packages/widget-runtime/
COPY packages/widget-sdk/package.json ./packages/widget-sdk/
COPY --from=widget-manifests /widgets ./packages/widgets
RUN --mount=type=cache,id=pnpm-store,target=/pnpm-store \
    PLAYWRIGHT_SKIP_BROWSER_DOWNLOAD=1 pnpm install --frozen-lockfile --store-dir /pnpm-store

COPY packages/shared ./packages/shared
COPY packages/widgets ./packages/widgets
COPY scripts ./scripts
COPY packages/browser-automation ./packages/browser-automation

RUN pnpm run codegen:browser && pnpm --filter browser-automation build

# --- runtime stage: pinned Playwright image (arm64-published, Xvfb + browsers) ---
FROM mcr.microsoft.com/playwright:v1.61.0-noble AS runtime
WORKDIR /app
ENV PLAYWRIGHT_SKIP_BROWSER_DOWNLOAD=1

# noVNC recovery surface + a writable X socket dir + a profile dir owned by the
# non-root runtime user (an empty named volume inherits this ownership).
RUN apt-get update \
    && apt-get install -y --no-install-recommends x11vnc novnc websockify \
    && rm -rf /var/lib/apt/lists/* \
    && corepack enable \
    && mkdir -p /tmp/.X11-unix && chmod 1777 /tmp/.X11-unix \
    && mkdir -p /profile && chown pwuser:pwuser /profile

COPY pnpm-lock.yaml pnpm-workspace.yaml package.json ./
COPY packages/browser-automation/package.json ./packages/browser-automation/
COPY packages/client/package.json ./packages/client/
COPY packages/server/package.json ./packages/server/
COPY packages/shared/package.json ./packages/shared/
COPY packages/widget-runtime/package.json ./packages/widget-runtime/
COPY packages/widget-sdk/package.json ./packages/widget-sdk/
COPY --from=widget-manifests /widgets ./packages/widgets
RUN --mount=type=cache,id=pnpm-store,target=/pnpm-store \
    pnpm install --frozen-lockfile --filter browser-automation --prod --store-dir /pnpm-store

COPY --from=build /app/packages/browser-automation/dist ./packages/browser-automation/dist
COPY packages/browser-automation/docker-entrypoint.sh /docker-entrypoint.sh
RUN chmod +x /docker-entrypoint.sh

USER pwuser
WORKDIR /app/packages/browser-automation
ENV BROWSER_PROFILE_DIR=/profile
EXPOSE 8788 6080
ENTRYPOINT ["/docker-entrypoint.sh"]
```

- [ ] **Step 5: Run the infra test to verify it passes**

Run: `pnpm exec vitest run scripts/infra.test.ts -t "browser codegen in the browser image"`
Expected: PASS.

- [ ] **Step 6: Build the image (manual gate — needs Docker + network)**

Run: `docker build -f packages/browser-automation/Dockerfile -t browser-automation:local .`
Expected: the image builds; the final stage runs `codegen:browser` + `rspack build` and installs prod deps. (If Docker is unavailable in this environment, record this as a deferred manual gate for the Raspberry Pi in Subproject 7.)

- [ ] **Step 7: Commit**

```bash
rtk git add packages/browser-automation/Dockerfile packages/browser-automation/docker-entrypoint.sh scripts/infra.test.ts
rtk git commit -m "build(browser-automation): add Playwright arm64 Dockerfile and noVNC entrypoint"
```

---

### Task 10: Compose wiring (production + development)

**Files:**
- Modify: `docker-compose.yml`
- Modify: `docker-compose.dev.yml`
- Modify: `.gitignore`
- Modify: `scripts/infra.test.ts` (add a compose assertion block)

**Interfaces:**
- Consumes: the Dockerfile from Task 9.
- Produces: a `browser-automation` production service with scoped secrets, a loopback noVNC port, and a profile volume; a `browser`-profiled dev service.

- [ ] **Step 1: Write the failing compose assertions**

In `scripts/infra.test.ts`, add a new block (place it near the "production hardening" describe):

```ts
describe('browser-automation service wiring', () => {
  const prod = readFileSync(resolve(root, 'docker-compose.yml'), 'utf8')

  it('binds novnc to the pi loopback only', () => {
    expect(prod).toContain("127.0.0.1:6080:6080")
  })

  it('exposes the internal api port without publishing it', () => {
    expect(prod).toContain("- '8788'")
    expect(prod).not.toContain('8788:8788')
  })

  it('mounts passport secrets as scoped /run/secrets targets', () => {
    expect(prod).toContain('target: passport-checker_series')
    expect(prod).toContain('target: passport-checker_number')
  })

  it('sources runtime secrets from the deployment environment', () => {
    expect(prod).toContain('environment: PASSPORT_SERIES')
    expect(prod).toContain('environment: PASSPORT_NUMBER')
  })

  it('keeps the browser profile in a named volume', () => {
    expect(prod).toContain('browser_profile:/profile')
  })

  it('provisions a fake diagnostics probe secret in the dev stack only', () => {
    expect(compose).toContain('__diagnostics___probe')
    expect(prod).not.toContain('__diagnostics___probe')
  })
})
```

- [ ] **Step 2: Run the infra test to verify it fails**

Run: `pnpm exec vitest run scripts/infra.test.ts -t "browser-automation service wiring"`
Expected: FAIL — the compose files have no browser service yet.

- [ ] **Step 3: Add the production service**

In `docker-compose.yml`, add the service (after `client`), and the top-level `secrets:` and a `browser_profile` volume:

```yaml
  browser-automation:
    build:
      context: .
      dockerfile: packages/browser-automation/Dockerfile
    init: true
    environment:
      PORT: '8788'
      # Non-secret operational config; Subproject 5 includes it in safe error meta.
      AUTOMATION_SSH_TARGET: ${AUTOMATION_SSH_TARGET:-}
    secrets:
      - source: passport_series
        target: passport-checker_series
      - source: passport_number
        target: passport-checker_number
    expose:
      - '8788'
    ports:
      # noVNC only on the Raspberry Pi loopback; SSH is the access boundary.
      - '127.0.0.1:6080:6080'
    volumes:
      - browser_profile:/profile
    healthcheck:
      test:
        - CMD
        - node
        - -e
        - "fetch('http://127.0.0.1:8788/health').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"
      interval: 30s
      timeout: 5s
      retries: 3
    restart: unless-stopped
```

Update the bottom of the file to add secrets and the profile volume:

```yaml
volumes:
  valkey_data:
  browser_profile:

secrets:
  passport_series:
    environment: PASSPORT_SERIES
  passport_number:
    environment: PASSPORT_NUMBER
```

- [ ] **Step 4: Add the development service**

In `docker-compose.dev.yml`, add a `browser` -profiled service (built image, fake secrets, dev profile) and its volume + secrets. Add at the end of `services:`:

```yaml
  browser-automation:
    profiles: ['browser']
    build:
      context: .
      dockerfile: packages/browser-automation/Dockerfile
    init: true
    environment:
      PORT: '8788'
    secrets:
      - source: dev_passport_series
        target: passport-checker_series
      - source: dev_passport_number
        target: passport-checker_number
      - source: dev_diagnostics_probe
        target: __diagnostics___probe
    ports:
      - '127.0.0.1:8788:8788'
      - '127.0.0.1:6080:6080'
    volumes:
      - browser_profile_dev:/profile
    depends_on:
      install:
        condition: service_completed_successfully
```

Add to the `volumes:` list:

```yaml
  browser_profile_dev:
```

Add a top-level `secrets:` block (fake, non-production values):

```yaml
secrets:
  dev_passport_series:
    environment: PASSPORT_SERIES
  dev_passport_number:
    environment: PASSPORT_NUMBER
  dev_diagnostics_probe:
    environment: DIAGNOSTICS_PROBE
```

> Operator note (documented in Task 11): start the dev browser service with obviously-fake values, e.g. `PASSPORT_SERIES=АА PASSPORT_NUMBER=123456 DIAGNOSTICS_PROBE=ok docker compose -f docker-compose.dev.yml --profile browser up --build browser-automation`.

- [ ] **Step 5: Ignore local dev profile and secret directories**

Append to `.gitignore`:

```
# browser-automation local (non-Docker) dev
packages/browser-automation/.dev-profile/
packages/browser-automation/.dev-secrets/
```

- [ ] **Step 6: Run the infra suite to verify it passes**

Run: `pnpm exec vitest run scripts/infra.test.ts`
Expected: PASS (existing tests + the new "browser-automation service wiring" block; the "restarts every service" count is still satisfied).

- [ ] **Step 7: Validate compose rendering (manual gate — needs Docker)**

Run: `PASSPORT_SERIES=АА PASSPORT_NUMBER=123456 docker compose config >/dev/null`
Expected: renders with no error; secrets resolve to `/run/secrets/passport-checker_series` and `_number`. (Defer to Subproject 7 if Docker is unavailable here.)

- [ ] **Step 8: Commit**

```bash
rtk git add docker-compose.yml docker-compose.dev.yml .gitignore scripts/infra.test.ts
rtk git commit -m "build(browser-automation): wire production and dev Compose services"
```

---

### Task 11: Operator documentation

**Files:**
- Create: `packages/browser-automation/README.md`

**Interfaces:**
- Consumes: everything above.
- Produces: operator runbook (provisioning, recovery, diagnostics).

- [ ] **Step 1: Write the README**

Create `packages/browser-automation/README.md`:

````markdown
# browser-automation

Internal service that runs allowlisted, widget-owned browser tasks in one
persistent headed Chromium session under Xvfb. Reachable only on the Compose
network; no public route. See the design specs under `docs/superpowers/specs/`.

## Provisioning secrets (Raspberry Pi)

Passport identity and the SSH target are provisioned once through the `pi` CLI's
`.env` (never committed). `rpi.toml` already declares `[env] file = ".env"`.

```
PASSPORT_SERIES=<two Ukrainian Cyrillic uppercase letters>
PASSPORT_NUMBER=<six digits>
AUTOMATION_SSH_TARGET=<ssh target for the Pi>
```

Send them, restarting the running stack when needed:

```bash
pi env send            # stage values for the next deploy
pi env send --apply    # send and restart the running stack
```

Compose exposes `PASSPORT_SERIES`/`PASSPORT_NUMBER` as **runtime secrets**, mounted
only into `browser-automation` as `/run/secrets/passport-checker_series` and
`/run/secrets/passport-checker_number`. They never appear in the container
environment, image layers, or logs.

## Cloudflare recovery over SSH

When a task reports that browser attention is required, complete the challenge in
the already-running session through an SSH-tunnelled noVNC (the port is bound to
the Pi loopback only):

```bash
ssh -L 6080:127.0.0.1:6080 $AUTOMATION_SSH_TARGET
# then open http://127.0.0.1:6080 locally, solve the challenge, close the tunnel
```

Press Retry in the widget afterward. The same browser process and profile stay
active throughout.

## Profile volume

The Chromium profile lives in the named volume `browser_profile` at `/profile`.
It survives image rebuilds and container restarts, preserving the session
(including `cf_clearance`). Do not delete it to "fix" a problem; surface a
recovery instead.

## Diagnostics probe

Verify the browser after a deploy, from inside the Compose network:

```bash
docker compose exec server \
  node -e "fetch('http://browser-automation:8788/tasks/__diagnostics__/browser-check',{method:'POST',headers:{'content-type':'application/json'},body:'{}'}).then(r=>r.json()).then(console.log)"
```

A healthy response is `{ "ok": true, "result": { "ok": true, "secretPresent": <bool>, "userAgent": "..." } }`.
`secretPresent` is `true` only when a `/run/secrets/__diagnostics___probe` file is
mounted (the dev stack mounts a fake one; production does not).

## Local development (non-Docker)

Headed Chromium runs on your native display; no Xvfb needed.

```bash
pnpm --filter browser-automation exec playwright install chromium   # one time
BROWSER_PROFILE_DIR=.dev-profile BROWSER_SECRETS_DIR=.dev-secrets \
  pnpm --filter browser-automation dev
```

`.dev-profile/` and `.dev-secrets/` are git-ignored. Create fake scoped secret
files under `.dev-secrets/` (e.g. `.dev-secrets/__diagnostics___probe`) as needed.

## Docker development

The dev browser service is behind the `browser` Compose profile so it does not
slow the default board dev stack:

```bash
PASSPORT_SERIES=АА PASSPORT_NUMBER=123456 DIAGNOSTICS_PROBE=ok \
  docker compose -f docker-compose.dev.yml --profile browser up --build browser-automation
```
````

- [ ] **Step 2: Commit**

```bash
rtk git add packages/browser-automation/README.md
rtk git commit -m "docs(browser-automation): add operator runbook"
```

---

## Final verification

- [ ] **Whole-package tests and typecheck**

Run: `pnpm --filter browser-automation exec vitest run` → all pass (integration file skipped without `BROWSER_IT`).
Run: `pnpm --filter browser-automation typecheck` → no errors.

- [ ] **Workspace gates**

Run: `pnpm run codegen && pnpm test` → green.
Run: `pnpm typecheck` → green.
Run: `pnpm lint && pnpm format:check` → clean (run `pnpm lint:fix` / `pnpm format` if needed).

- [ ] **Manual/CI gates (record for Subproject 7 if Docker is unavailable here)**

- `docker build -f packages/browser-automation/Dockerfile -t browser-automation:local .`
- `PASSPORT_SERIES=АА PASSPORT_NUMBER=123456 docker compose config >/dev/null`
- `BROWSER_IT=1 pnpm --filter browser-automation exec vitest run src/browser/chromium-executor.integration.test.ts`
- ARM64 Raspberry Pi smoke run of the diagnostics probe.
