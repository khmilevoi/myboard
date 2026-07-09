# Passport Checker Browser Task Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add the browser-only `passport-checker/check` task, including strict contracts, scoped-secret submission through persistent Chromium, evidence-based Cloudflare recovery, retained challenge pages, and local real-browser verification without exposing document data.

**Architecture:** Keep the widget package browser-only: shared schemas and domain errors live with the widget, while Playwright lifecycle remains in `browser-automation`. Refine three existing seams first—optional client entrypoints, a shared public task-error base, and page retention—then build the task as a fixed production definition backed by a test-only local-origin factory. Fast tests cover pure behavior and error mapping; an opt-in headed Chromium suite proves the actual multipart request against a local fixture.

**Tech Stack:** TypeScript 6, pnpm workspace, Zod 4, errore, Playwright 1.61 Chromium, Vitest 4, Node HTTP fixtures, Rspack browser-service bundle

---

## Implementation Map

### Existing files to modify

- `scripts/codegen/client.ts` — filter packages without `client.ts` before client imports and port assignment.
- `scripts/codegen.test.ts` — replace the missing-client failure expectation with browser-only omission and stale-port pruning tests.
- `packages/browser-automation/src/errors.ts` — import/re-export the shared `BrowserTaskError` base.
- `packages/browser-automation/src/errors.test.ts` — prove shared widget-owned subclasses serialize through the service envelope.
- `packages/browser-automation/src/browser/context.ts` — expose `retainPageForRecovery()`.
- `packages/browser-automation/src/browser/chromium-executor.ts` — retain at most one recovery page per widget and close it on retry, abort, or shutdown.
- `packages/browser-automation/src/browser/chromium-executor.test.ts` — verify retained-page lifecycle.
- `packages/browser-automation/src/diagnostics.test.ts` — supply the new context method in existing fixtures.
- `pnpm-lock.yaml` — register the new workspace importer and its exact development dependencies.

### New files

- `packages/shared/browser-automation/task-errors.ts` — Playwright-free public browser-task error base.
- `packages/shared/browser-automation/task-errors.test.ts` — base inheritance and safe defaults.
- `packages/widgets/passport-checker/package.json` — browser-only package scripts and dependencies.
- `packages/widgets/passport-checker/tsconfig.json` — Node + DOM typechecking for Playwright page callbacks.
- `packages/widgets/passport-checker/vitest.config.ts` — aliases and Node test environment.
- `packages/widgets/passport-checker/types.ts` — strict empty payload, checker result, and browser task descriptors.
- `packages/widgets/passport-checker/browser/errors.ts` — four widget-owned public task errors.
- `packages/widgets/passport-checker/browser/challenge.ts` — pure navigation challenge classifier and safe evidence types.
- `packages/widgets/passport-checker/browser/check.ts` — secret validation and one-shot checker orchestration.
- `packages/widgets/passport-checker/browser/check.test.ts` — fast task tests with a small Playwright page fake.
- `packages/widgets/passport-checker/browser/check.integration.test.ts` — opt-in headed Chromium + local fixture server.
- `packages/widgets/passport-checker/browser.ts` — factory and fixed production default export.
- `packages/widgets/passport-checker/browser.test.ts` — entrypoint contract, fixed identity, and SSH-target normalization.

## Task 1: Make Client Entrypoints Optional

**Files:**

- Modify: `scripts/codegen/client.ts`
- Modify: `scripts/codegen.test.ts`
- Test: `scripts/codegen.test.ts`

- [ ] **Step 1: Replace the missing-client failure test with omission and port-pruning coverage**

Remove `MissingWidgetEntrypointError` from the imports in `scripts/codegen.test.ts`. Replace `fails client codegen when client.ts is missing` with these tests:

```ts
it('omits browser-only packages from client outputs and port allocation', async () => {
  const paths = createTempCodegenPaths('browser-only-client-codegen')
  const widgetDir = join(paths.widgetsDir, 'probe')
  writeFileSync(join(widgetDir, 'browser.ts'), 'export default {}')

  const result = await generateClient(paths)

  expect(result).not.toBeInstanceOf(Error)
  expect(JSON.parse(readFileSync(paths.portsFile, 'utf8'))).toEqual({})
  expect(readFileSync(paths.clientCatalogFile, 'utf8')).not.toContain('probe')
  expect(readFileSync(paths.clientIconsFile, 'utf8')).toContain(
    'export type WidgetIconName = never',
  )
})

it('prunes stale ports when a package no longer has client.ts', async () => {
  const paths = createTempCodegenPaths('stale-browser-only-port')
  writeFileSync(paths.portsFile, '{"probe":5180}')

  const result = await generateClient(paths)

  expect(result).not.toBeInstanceOf(Error)
  expect(JSON.parse(readFileSync(paths.portsFile, 'utf8'))).toEqual({})
})
```

- [ ] **Step 2: Run the focused codegen tests and verify the new assertions fail**

Run from the repository root:

```powershell
pnpm vitest run scripts/codegen.test.ts
```

Expected: FAIL because `prepareClient` still returns `MissingWidgetEntrypointError` for `probe`.

- [ ] **Step 3: Filter client packages before importing metadata and assigning ports**

In `scripts/codegen/client.ts`, remove `MissingWidgetEntrypointError` from the shared imports. Immediately after `discoverWidgetDirs`, derive client-only directories and prune stale ports:

```ts
const widgetDirs = discoverWidgetDirs(paths.widgetsDir)
if (widgetDirs instanceof Error) return widgetDirs
const clientWidgetDirs = widgetDirs.filter((dir) =>
  fs.existsSync(path.resolve(paths.widgetsDir, dir, 'client.ts')),
)
```

After validating `currentPorts`, add:

```ts
const clientWidgetDirSet = new Set(clientWidgetDirs)
const clientPorts = Object.fromEntries(
  Object.entries(currentPorts).filter(([widgetId]) => clientWidgetDirSet.has(widgetId)),
)
```

Iterate `clientWidgetDirs`, remove the missing-entrypoint branch entirely, and assign ports from the filtered values:

```ts
const metas: WidgetMeta[] = []
for (const dir of clientWidgetDirs) {
  const entrypoint = path.resolve(paths.widgetsDir, dir, 'client.ts')
  const imported = await import(pathToFileURL(entrypoint).href).catch(
    (cause) => new WidgetClientImportError({ widgetId: dir, cause }),
  )
  if (imported instanceof Error) return imported
  const meta = errore.try(() => extractWidgetMeta(imported.default, dir))
  if (meta instanceof InvalidWidgetClientDefinitionError) return meta
  if (meta instanceof Error) {
    return new InvalidWidgetClientDefinitionError({ widgetId: dir, cause: meta })
  }
  metas.push(meta)
}
const ports = assignPorts(clientWidgetDirs, clientPorts)
if (ports instanceof Error) return ports
```

- [ ] **Step 4: Run codegen tests and repository codegen**

```powershell
pnpm vitest run scripts/codegen.test.ts
pnpm run codegen
```

Expected: codegen tests PASS; combined codegen succeeds; `packages/widgets/.ports.json` still contains only `clock` and `ofelia-poop-duty`.

- [ ] **Step 5: Commit the optional-client refinement**

```powershell
git add scripts/codegen/client.ts scripts/codegen.test.ts packages/widgets/.ports.json
git commit -m "build: allow browser-only widget packages"
```

## Task 2: Move the Public Browser Task Error Base to Shared Code

**Files:**

- Create: `packages/shared/browser-automation/task-errors.ts`
- Create: `packages/shared/browser-automation/task-errors.test.ts`
- Modify: `packages/browser-automation/src/errors.ts`
- Modify: `packages/browser-automation/src/errors.test.ts`
- Test: `packages/shared/browser-automation/task-errors.test.ts`
- Test: `packages/browser-automation/src/errors.test.ts`

- [ ] **Step 1: Add failing tests for a shared widget-owned task error**

Create `packages/shared/browser-automation/task-errors.test.ts`:

```ts
import { describe, expect, it } from 'vitest'

import { BrowserTaskError } from './task-errors'

class ProbeTaskError extends BrowserTaskError {
  code = 'probe'
  publicMessage = 'Probe failed'
  get publicMeta(): Record<string, unknown> {
    return { safe: true }
  }
}

describe('BrowserTaskError', () => {
  it('provides safe internal defaults and supports widget-owned subclasses', () => {
    const base = new BrowserTaskError('raw internal detail')
    const probe = new ProbeTaskError('raw probe detail')

    expect(base).toBeInstanceOf(Error)
    expect(base.code).toBe('internal')
    expect(base.publicMessage).toBe('Browser task failed')
    expect(base.publicMeta).toBeUndefined()
    expect(probe).toMatchObject({ code: 'probe', publicMessage: 'Probe failed' })
    expect(probe.publicMeta).toEqual({ safe: true })
  })
})
```

In `packages/browser-automation/src/errors.test.ts`, import `BrowserTaskError` from `@shared/browser-automation/task-errors`, add a local subclass, and assert service serialization:

```ts
class WidgetOwnedTaskError extends BrowserTaskError {
  code = 'widget_owned'
  publicMessage = 'Widget-owned failure'
  get publicMeta(): Record<string, unknown> {
    return { phase: 'fixture' }
  }
}

it('serializes a widget-owned subclass of the shared task-error base', () => {
  expect(toEnvelopeError(new WidgetOwnedTaskError('private detail'))).toEqual({
    code: 'widget_owned',
    message: 'Widget-owned failure',
    meta: { phase: 'fixture' },
  })
})
```

- [ ] **Step 2: Run the focused tests and verify the missing shared module fails**

```powershell
pnpm vitest run packages/shared/browser-automation/task-errors.test.ts packages/browser-automation/src/errors.test.ts
```

Expected: FAIL because `@shared/browser-automation/task-errors` does not exist.

- [ ] **Step 3: Create the shared base and re-export it from the service errors module**

Create `packages/shared/browser-automation/task-errors.ts`:

```ts
export class BrowserTaskError extends Error {
  code = 'internal'
  publicMessage = 'Browser task failed'
  get publicMeta(): Record<string, unknown> | undefined {
    return undefined
  }
}
```

At the top of `packages/browser-automation/src/errors.ts`, import and re-export the shared class, then delete the old local class:

```ts
import { BrowserTaskError } from '@shared/browser-automation/task-errors'
import * as errore from 'errore'

export { BrowserTaskError } from '@shared/browser-automation/task-errors'
```

Leave every existing service error subclass and `toEnvelopeError` using the imported `BrowserTaskError`.

- [ ] **Step 4: Run shared and service error tests plus browser typecheck**

```powershell
pnpm vitest run packages/shared/browser-automation/task-errors.test.ts packages/browser-automation/src/errors.test.ts packages/browser-automation/src/dispatch.test.ts
pnpm --filter browser-automation typecheck
```

Expected: all tests PASS and browser-automation typecheck succeeds.

- [ ] **Step 5: Commit the shared error boundary**

```powershell
git add packages/shared/browser-automation/task-errors.ts packages/shared/browser-automation/task-errors.test.ts packages/browser-automation/src/errors.ts packages/browser-automation/src/errors.test.ts
git commit -m "refactor(browser-automation): share task error base"
```

## Task 3: Add Retained Recovery-Page Lifecycle

**Files:**

- Modify: `packages/browser-automation/src/browser/context.ts`
- Modify: `packages/browser-automation/src/browser/chromium-executor.ts`
- Modify: `packages/browser-automation/src/browser/chromium-executor.test.ts`
- Modify: `packages/browser-automation/src/diagnostics.test.ts`
- Test: `packages/browser-automation/src/browser/chromium-executor.test.ts`

- [ ] **Step 1: Add failing executor tests for retain, retry, cross-widget isolation, abort, and shutdown**

Extend `packages/browser-automation/src/browser/chromium-executor.test.ts` with:

```ts
it('retains a marked page until the same widget acquires again', async () => {
  const created: FakeContext[] = []
  const executor = makeChromiumExecutor(makeDeps(created))

  const first = await executor.acquire(new AbortController().signal, 'passport-checker')
  if (first instanceof Error) throw first
  first.retainPageForRecovery()
  await executor.release(first)

  expect(created[0].pages[0].closed).toBe(false)

  const retry = await executor.acquire(new AbortController().signal, 'passport-checker')
  if (retry instanceof Error) throw retry
  expect(created[0].pages[0].closed).toBe(true)
  expect(created[0].pages[1].closed).toBe(false)
  await executor.release(retry)
})

it('does not discard another widget recovery page', async () => {
  const created: FakeContext[] = []
  const executor = makeChromiumExecutor(makeDeps(created))

  const recovery = await executor.acquire(new AbortController().signal, 'passport-checker')
  if (recovery instanceof Error) throw recovery
  recovery.retainPageForRecovery()
  await executor.release(recovery)

  const diagnostics = await executor.acquire(new AbortController().signal, '__diagnostics__')
  if (diagnostics instanceof Error) throw diagnostics
  expect(created[0].pages[0].closed).toBe(false)
  await executor.release(diagnostics)
})

it('abort closes a page even after it was marked for recovery', async () => {
  const created: FakeContext[] = []
  const executor = makeChromiumExecutor(makeDeps(created))
  const controller = new AbortController()
  const context = await executor.acquire(controller.signal, 'passport-checker')
  if (context instanceof Error) throw context

  context.retainPageForRecovery()
  controller.abort()

  await vi.waitFor(() => expect(created[0].pages[0].closed).toBe(true))
  await executor.release(context)
})

it('shutdown closes a retained recovery page with its persistent context', async () => {
  const created: FakeContext[] = []
  const executor = makeChromiumExecutor(makeDeps(created))
  const context = await executor.acquire(new AbortController().signal, 'passport-checker')
  if (context instanceof Error) throw context

  context.retainPageForRecovery()
  await executor.release(context)
  await executor.shutdown()

  expect(created[0].closed).toBe(true)
  expect(created[0].pages[0].closed).toBe(true)
})
```

Update the fake context's `close()` implementation to close all pages before emitting `close`:

```ts
async close() {
  context.closeCalls += 1
  await Promise.all(context.pages.map((page) => page.close()))
  context.emitClose()
},
```

- [ ] **Step 2: Run the executor test and verify the context method is missing**

```powershell
pnpm --filter browser-automation test -- src/browser/chromium-executor.test.ts
```

Expected: FAIL at typecheck/test transform because `retainPageForRecovery` does not exist.

- [ ] **Step 3: Extend the task context and managed executor state**

Update `packages/browser-automation/src/browser/context.ts`:

```ts
import type { WidgetSecrets } from './secrets'

export type { WidgetSecrets } from './secrets'

export type BrowserTaskContext = {
  page: import('playwright').Page
  secrets: WidgetSecrets
  retainPageForRecovery(): void
}
```

In `chromium-executor.ts`, add `retained` and `widgetId` to `ManagedBrowserTaskContext`, plus a map in `makeChromiumExecutor`:

```ts
type ManagedBrowserTaskContext = BrowserTaskContext & {
  abortListener: () => void
  released: boolean
  retained: boolean
  signal: AbortSignal
  widgetId: string
}

const retainedPages = new Map<string, Page>()
```

Add a helper that removes the previous page only for the same widget:

```ts
async function closeRetainedPage(widgetId: string) {
  const page = retainedPages.get(widgetId)
  if (!page) return
  retainedPages.delete(widgetId)
  await closePage(page)
}
```

After acquiring the persistent context, close only the same widget's stale
recovery page and recheck abort before creating a new page:

```ts
if (signal.aborted) {
  if (waitsForInitialLaunch) await closeUnclaimedPersistentContext(context)
  return toAbortError(signal)
}
await closeRetainedPage(widgetId)
if (signal.aborted) return toAbortError(signal)

const page = await context
  .newPage()
  .catch((cause) => (signal.aborted ? toAbortError(signal) : new BrowserLaunchError({ cause })))
```

- [ ] **Step 4: Implement release precedence and context marking**

Replace `releaseManagedContext` with:

```ts
async function releaseManagedContext(context: ManagedBrowserTaskContext) {
  if (context.released) return
  context.released = true
  activeTaskCount -= 1
  context.signal.removeEventListener('abort', context.abortListener)
  if (context.retained && !context.signal.aborted) {
    const previous = retainedPages.get(context.widgetId)
    retainedPages.set(context.widgetId, context.page)
    if (previous && previous !== context.page) await closePage(previous)
    return
  }
  await closePage(context.page)
}
```

Construct the managed context with:

```ts
const managedContext: ManagedBrowserTaskContext = {
  abortListener: () => {
    void releaseManagedContext(managedContext)
  },
  released: false,
  retained: false,
  page,
  secrets: makeWidgetSecrets(widgetId, deps.secretsDir),
  signal,
  widgetId,
  retainPageForRecovery() {
    managedContext.retained = true
  },
}
```

Clear `retainedPages` whenever the persistent context closes or is reset. The real `BrowserContext.close()` owns final page cleanup.

```ts
const resetPersistentContext = () => {
  persistentContext = null
  launching = null
  shutdownPromise = null
  retainedPages.clear()
}
```

- [ ] **Step 5: Update diagnostics fixtures and run browser tests**

Add `retainPageForRecovery: () => undefined` to every literal `BrowserTaskContext` in `packages/browser-automation/src/diagnostics.test.ts`.

Run:

```powershell
pnpm --filter browser-automation test -- src/browser/chromium-executor.test.ts src/diagnostics.test.ts
pnpm --filter browser-automation typecheck
```

Expected: tests PASS; typecheck succeeds; existing release and abort tests remain green.

- [ ] **Step 6: Commit the recovery lifecycle**

```powershell
git add packages/browser-automation/src/browser/context.ts packages/browser-automation/src/browser/chromium-executor.ts packages/browser-automation/src/browser/chromium-executor.test.ts packages/browser-automation/src/diagnostics.test.ts
git commit -m "feat(browser-automation): retain recovery pages"
```

## Task 4: Scaffold the Browser-Only Passport Package and Contracts

**Files:**

- Create: `packages/widgets/passport-checker/package.json`
- Create: `packages/widgets/passport-checker/tsconfig.json`
- Create: `packages/widgets/passport-checker/vitest.config.ts`
- Create: `packages/widgets/passport-checker/types.ts`
- Create: `packages/widgets/passport-checker/browser/errors.ts`
- Create: `packages/widgets/passport-checker/browser/contracts.test.ts`
- Modify: `pnpm-lock.yaml`

- [ ] **Step 1: Create package configuration**

Create `packages/widgets/passport-checker/package.json`:

```json
{
  "name": "widgets-passport-checker",
  "version": "0.0.0",
  "private": true,
  "type": "module",
  "scripts": {
    "test": "vitest run",
    "typecheck": "tsc --noEmit"
  },
  "dependencies": {
    "errore": "catalog:",
    "zod": "catalog:"
  },
  "devDependencies": {
    "@types/node": "catalog:",
    "browser-automation": "workspace:*",
    "playwright": "1.61.0",
    "typescript": "catalog:",
    "vitest": "catalog:"
  }
}
```

Create `packages/widgets/passport-checker/tsconfig.json`:

```json
{
  "compilerOptions": {
    "target": "ES2022",
    "lib": ["ES2024", "DOM", "DOM.Iterable"],
    "module": "ESNext",
    "moduleResolution": "bundler",
    "strict": true,
    "noUnusedLocals": true,
    "noUnusedParameters": true,
    "skipLibCheck": true,
    "noEmit": true,
    "types": ["node", "vitest/globals"],
    "paths": {
      "@/*": ["./*"],
      "@shared/*": ["../../shared/*"]
    }
  },
  "include": ["."]
}
```

Create `packages/widgets/passport-checker/vitest.config.ts`:

```ts
import path from 'node:path'

import { defineConfig } from 'vitest/config'

export default defineConfig({
  resolve: {
    alias: {
      '@': import.meta.dirname,
      '@shared': path.resolve(import.meta.dirname, '../../shared'),
    },
  },
  test: { environment: 'node' },
})
```

- [ ] **Step 2: Write failing contract and public-error tests**

Create `packages/widgets/passport-checker/browser/contracts.test.ts`:

```ts
import { describe, expect, expectTypeOf, it } from 'vitest'

import { toEnvelopeError } from '../../../browser-automation/src/errors'
import { passportCheckerBrowserSchemas, passportCheckerBrowserTasks } from '../types'
import {
  BrowserConfigurationError,
  BrowserSessionRequiredError,
  InvalidCheckerResponseError,
  UpstreamResponseError,
} from './errors'

describe('passport checker browser contracts', () => {
  it('requires a strict empty payload and an integer checker result', () => {
    expect(passportCheckerBrowserSchemas.check.payload.safeParse({}).success).toBe(true)
    expect(passportCheckerBrowserSchemas.check.payload.safeParse({ series: 'АБ' }).success).toBe(
      false,
    )
    expect(
      passportCheckerBrowserSchemas.check.result.safeParse({
        status: 1,
        send_status_msg: 'ok',
        ignored: true,
      }).data,
    ).toEqual({ status: 1, send_status_msg: 'ok' })
    expect(
      passportCheckerBrowserSchemas.check.result.safeParse({
        status: 1.5,
        send_status_msg: 'bad',
      }).success,
    ).toBe(false)
    expect(passportCheckerBrowserTasks.check.id).toBe('check')
    expectTypeOf(passportCheckerBrowserTasks.check.id).toEqualTypeOf<'check'>()
  })

  it('serializes only stable public codes, messages, and safe metadata', () => {
    expect(toEnvelopeError(new BrowserConfigurationError())).toEqual({
      code: 'browser_configuration',
      message: 'Passport checker is not configured',
    })
    expect(
      toEnvelopeError(new BrowserSessionRequiredError({ sshTarget: 'pi@myboard.local' })),
    ).toEqual({
      code: 'browser_session_required',
      message: 'The browser session requires attention',
      meta: { sshTarget: 'pi@myboard.local' },
    })
    expect(
      toEnvelopeError(new UpstreamResponseError({ phase: 'submission', status: 503 })),
    ).toEqual({
      code: 'upstream_response',
      message: 'Passport checker is temporarily unavailable',
      meta: { phase: 'submission', status: 503 },
    })
    expect(toEnvelopeError(new InvalidCheckerResponseError())).toEqual({
      code: 'invalid_checker_response',
      message: 'Passport checker returned an unexpected response',
    })
  })
})
```

- [ ] **Step 3: Run the package test and verify missing modules fail**

First refresh only the lockfile so the new workspace package is runnable:

```powershell
pnpm install --lockfile-only
pnpm --filter widgets-passport-checker test -- browser/contracts.test.ts
```

Expected: install updates the new lockfile importer; test FAIL because `types.ts` and `errors.ts` do not exist.

- [ ] **Step 4: Implement strict schemas and task descriptors**

Create `packages/widgets/passport-checker/types.ts`:

```ts
import { defineWidgetBrowserTasks } from '@shared/widgets/browser-contracts'
import { z } from 'zod'

export const passportCheckPayloadSchema = z.strictObject({})
export const passportCheckResultSchema = z.object({
  status: z.number().int(),
  send_status_msg: z.string(),
})

export const passportCheckerBrowserSchemas = {
  check: {
    payload: passportCheckPayloadSchema,
    result: passportCheckResultSchema,
  },
} as const

export const passportCheckerBrowserTasks = defineWidgetBrowserTasks(passportCheckerBrowserSchemas)

export type PassportCheckPayload = z.output<typeof passportCheckPayloadSchema>
export type PassportCheckResult = z.output<typeof passportCheckResultSchema>
```

- [ ] **Step 5: Implement widget-owned task errors without secret interpolation**

Create `packages/widgets/passport-checker/browser/errors.ts`:

```ts
import { BrowserTaskError } from '@shared/browser-automation/task-errors'
import * as errore from 'errore'

export type CheckerPhase = 'navigation' | 'submission'

export class BrowserConfigurationError extends errore.createTaggedError({
  name: 'BrowserConfigurationError',
  message: 'Passport checker configuration is invalid',
  extends: BrowserTaskError,
}) {
  code = 'browser_configuration'
  publicMessage = 'Passport checker is not configured'
}

type BrowserSessionRequiredErrorOptions = {
  sshTarget: string | null
  cause?: unknown
}

export class BrowserSessionRequiredError extends errore.createTaggedError({
  name: 'BrowserSessionRequiredError',
  message: 'Passport checker browser session requires attention',
  extends: BrowserTaskError,
}) {
  readonly sshTarget: string | null
  code = 'browser_session_required'
  publicMessage = 'The browser session requires attention'

  constructor({ sshTarget, ...options }: BrowserSessionRequiredErrorOptions) {
    super(options)
    this.sshTarget = sshTarget
  }

  get publicMeta(): Record<string, unknown> | undefined {
    return this.sshTarget ? { sshTarget: this.sshTarget } : undefined
  }
}

type UpstreamResponseErrorOptions = {
  phase: CheckerPhase
  status?: number
  cause?: unknown
}

export class UpstreamResponseError extends errore.createTaggedError({
  name: 'UpstreamResponseError',
  message: 'Passport checker failed during $phase',
  extends: BrowserTaskError,
}) {
  readonly status: number | undefined
  code = 'upstream_response'
  publicMessage = 'Passport checker is temporarily unavailable'

  constructor({ status, ...options }: UpstreamResponseErrorOptions) {
    super(options)
    this.status = status
  }

  get publicMeta(): Record<string, unknown> {
    return this.status === undefined
      ? { phase: this.phase }
      : { phase: this.phase, status: this.status }
  }
}

export class InvalidCheckerResponseError extends errore.createTaggedError({
  name: 'InvalidCheckerResponseError',
  message: 'Passport checker response is invalid',
  extends: BrowserTaskError,
}) {
  code = 'invalid_checker_response'
  publicMessage = 'Passport checker returned an unexpected response'
}
```

- [ ] **Step 6: Run package tests and typecheck**

```powershell
pnpm --filter widgets-passport-checker test -- browser/contracts.test.ts
pnpm --filter widgets-passport-checker typecheck
```

Expected: contract/error tests PASS and package typecheck succeeds.

- [ ] **Step 7: Commit the package contract**

```powershell
git add packages/widgets/passport-checker pnpm-lock.yaml
git commit -m "feat(passport-checker): add browser task contracts"
```

## Task 5: Implement Challenge Classification and One-Shot Checker Flow

**Files:**

- Create: `packages/widgets/passport-checker/browser/challenge.ts`
- Create: `packages/widgets/passport-checker/browser/check.ts`
- Create: `packages/widgets/passport-checker/browser/check.test.ts`
- Test: `packages/widgets/passport-checker/browser/check.test.ts`

- [ ] **Step 1: Write pure classifier and secret-validation tests first**

Create the initial sections of `browser/check.test.ts`:

```ts
import type { BrowserTaskContext, WidgetSecrets } from 'browser-automation/task-context'
import type { Page, Response } from 'playwright'
import { describe, expect, it, vi } from 'vitest'

import { isCloudflareChallenge, type ChallengeEvidence } from './challenge'
import { makePassportCheckHandler, readPassportIdentity } from './check'
import {
  BrowserConfigurationError,
  BrowserSessionRequiredError,
  InvalidCheckerResponseError,
  UpstreamResponseError,
} from './errors'

function secrets(series: string | undefined, number: string | undefined): WidgetSecrets {
  return {
    read: (key) => (key === 'series' ? series : key === 'number' ? number : undefined),
    has: (key) => (key === 'series' ? series !== undefined : number !== undefined),
  }
}

const baseEvidence: ChallengeEvidence = {
  url: 'https://pasport.org.ua/solutions/checker',
  title: 'Checker',
  status: 200,
  server: null,
  cfRay: null,
  hasChallengeForm: false,
  hasChallengePlatform: false,
  hasChallengeContent: false,
}

describe('passport identity', () => {
  it.each([
    [undefined, '123456'],
    ['АБ', undefined],
    ['AB', '123456'],
    ['Аб', '123456'],
    ['АБ', '12345'],
    ['АБ', '１２３４５６'],
  ])('rejects absent or malformed secrets without echoing them', (series, number) => {
    const result = readPassportIdentity(secrets(series, number))
    expect(result).toBeInstanceOf(BrowserConfigurationError)
    expect(JSON.stringify(result)).not.toContain(series ?? 'missing-series')
    expect(JSON.stringify(result)).not.toContain(number ?? 'missing-number')
  })

  it('accepts two uppercase Ukrainian letters and six ASCII digits', () => {
    expect(readPassportIdentity(secrets('АБ', '123456'))).toEqual({
      series: 'АБ',
      number: '123456',
    })
  })
})

describe('Cloudflare challenge classifier', () => {
  it.each([
    [{ ...baseEvidence, url: 'https://pasport.org.ua/cdn-cgi/challenge-platform/h/g' }],
    [{ ...baseEvidence, title: 'Just a moment...' }],
    [{ ...baseEvidence, hasChallengeForm: true }],
    [{ ...baseEvidence, hasChallengePlatform: true }],
    [
      {
        ...baseEvidence,
        status: 503,
        server: 'cloudflare',
        cfRay: 'fixture-ray',
        hasChallengeContent: true,
      },
    ],
  ])('accepts positive challenge evidence', (evidence) => {
    expect(isCloudflareChallenge(evidence)).toBe(true)
  })

  it.each([
    [{ ...baseEvidence, status: 403 }],
    [{ ...baseEvidence, status: 429 }],
    [{ ...baseEvidence, status: 503, server: 'fixture' }],
    [{ ...baseEvidence, status: 503, server: 'cloudflare', cfRay: 'fixture-ray' }],
  ])('does not treat status alone as a challenge', (evidence) => {
    expect(isCloudflareChallenge(evidence)).toBe(false)
  })
})
```

- [ ] **Step 2: Run the focused test and verify imports fail**

```powershell
pnpm --filter widgets-passport-checker test -- browser/check.test.ts
```

Expected: FAIL because `challenge.ts` and `check.ts` do not exist.

- [ ] **Step 3: Implement the pure evidence classifier**

Create `browser/challenge.ts`:

```ts
export type ChallengeEvidence = {
  url: string
  title: string
  status: number | null
  server: string | null
  cfRay: string | null
  hasChallengeForm: boolean
  hasChallengePlatform: boolean
  hasChallengeContent: boolean
}

const challengeStatuses = new Set([403, 503])

export function isCloudflareChallenge(evidence: ChallengeEvidence) {
  const explicitMarker =
    /\/cdn-cgi\/challenge-platform/i.test(evidence.url) ||
    /just a moment|attention required/i.test(evidence.title) ||
    evidence.hasChallengeForm ||
    evidence.hasChallengePlatform
  if (explicitMarker) return true

  const cloudflareResponse =
    evidence.server?.toLowerCase().includes('cloudflare') === true || evidence.cfRay !== null
  return (
    evidence.status !== null &&
    challengeStatuses.has(evidence.status) &&
    cloudflareResponse &&
    evidence.hasChallengeContent
  )
}
```

- [ ] **Step 4: Implement secret validation and safe page-boundary types**

Start `browser/check.ts` with:

```ts
import type { BrowserTaskContext, WidgetSecrets } from 'browser-automation/task-context'
import type { Response } from 'playwright'

import {
  passportCheckResultSchema,
  type PassportCheckPayload,
  type PassportCheckResult,
} from '../types'
import { isCloudflareChallenge, type ChallengeEvidence } from './challenge'
import {
  BrowserConfigurationError,
  BrowserSessionRequiredError,
  InvalidCheckerResponseError,
  UpstreamResponseError,
} from './errors'

const ukrainianPassportSeries = /^[АБВГҐДЕЄЖЗИІЇЙКЛМНОПРСТУФХЦЧШЩЬЮЯ]{2}$/u
const passportNumber = /^[0-9]{6}$/

export type PassportIdentity = { series: string; number: string }

export function readPassportIdentity(secrets: WidgetSecrets) {
  const series = secrets.read('series')
  const number = secrets.read('number')
  if (!series || !number) return new BrowserConfigurationError()
  if (!ukrainianPassportSeries.test(series)) return new BrowserConfigurationError()
  if (!passportNumber.test(number)) return new BrowserConfigurationError()
  return { series, number } satisfies PassportIdentity
}

type SubmitOutcome =
  | { kind: 'success'; data: unknown }
  | { kind: 'session_required' }
  | { kind: 'upstream_error'; status: number }
  | { kind: 'invalid_json' }
  | { kind: 'network_error' }

export type PassportCheckHandlerOptions = {
  checkerUrl: string
  recoverySshTarget: string | null
}
```

- [ ] **Step 5: Add failing orchestration tests with a minimal fake page**

Add helpers to `check.test.ts` that fake only `goto`, `evaluate`, and the safe challenge evidence returned by the page. Use `as unknown as Page` only at the adapter boundary:

```ts
type PageScenario = {
  navigationError?: Error
  submissionError?: Error
  navigationStatus?: number
  navigationHeaders?: Record<string, string>
  evidence?: Partial<ChallengeEvidence>
  submit?:
    | { kind: 'success'; data: unknown }
    | { kind: 'session_required' }
    | { kind: 'upstream_error'; status: number }
    | { kind: 'invalid_json' }
    | { kind: 'network_error' }
}

function makeContext(scenario: PageScenario) {
  const retainPageForRecovery = vi.fn()
  const goto = vi.fn(async () => {
    if (scenario.navigationError) throw scenario.navigationError
    const status = scenario.navigationStatus ?? 200
    return {
      status: () => status,
      ok: () => status >= 200 && status < 400,
      allHeaders: async () => scenario.navigationHeaders ?? {},
    } as unknown as Response
  })
  const evaluate = vi.fn(async (_fn: unknown, arg?: unknown) => {
    if (arg === undefined) return { ...baseEvidence, ...scenario.evidence }
    if (scenario.submissionError) throw scenario.submissionError
    return (
      scenario.submit ?? {
        kind: 'success',
        data: { status: 1, send_status_msg: 'ok' },
      }
    )
  })
  const context: BrowserTaskContext = {
    page: { goto, evaluate } as unknown as Page,
    secrets: secrets('АБ', '123456'),
    retainPageForRecovery,
  }
  return { context, evaluate, goto, retainPageForRecovery }
}

describe('passport check handler', () => {
  it('returns only the validated checker result after one submission', async () => {
    const { context, evaluate } = makeContext({
      submit: {
        kind: 'success',
        data: { status: 2, send_status_msg: 'valid', ignored: true },
      },
    })
    const result = await makePassportCheckHandler({
      checkerUrl: 'http://fixture.local/solutions/checker',
      recoverySshTarget: null,
    })({}, context)

    expect(result).toEqual({ status: 2, send_status_msg: 'valid' })
    expect(evaluate).toHaveBeenCalledTimes(2)
  })

  it('retains a navigation challenge without submitting', async () => {
    const { context, evaluate, retainPageForRecovery } = makeContext({
      evidence: { hasChallengeForm: true },
    })
    const result = await makePassportCheckHandler({
      checkerUrl: 'http://fixture.local/solutions/checker',
      recoverySshTarget: 'pi@myboard.local',
    })({}, context)

    expect(result).toBeInstanceOf(BrowserSessionRequiredError)
    expect(retainPageForRecovery).toHaveBeenCalledOnce()
    expect(evaluate).toHaveBeenCalledTimes(1)
  })

  it.each([
    [{ kind: 'upstream_error', status: 502 } as const, UpstreamResponseError],
    [{ kind: 'invalid_json' } as const, InvalidCheckerResponseError],
    [{ kind: 'network_error' } as const, UpstreamResponseError],
  ])('maps safe submission outcomes to domain errors', async (submit, ErrorType) => {
    const { context } = makeContext({ submit })
    const result = await makePassportCheckHandler({
      checkerUrl: 'http://fixture.local/solutions/checker',
      recoverySshTarget: null,
    })({}, context)
    expect(result).toBeInstanceOf(ErrorType)
  })

  it.each([
    ['navigation', { navigationError: new Error('navigation failed') }],
    ['submission', { submissionError: new Error('submission failed') }],
  ] as const)(
    'wraps a Playwright %s rejection as an upstream error',
    async (_phase, scenario) => {
      const { context } = makeContext(scenario)
      const result = await makePassportCheckHandler({
        checkerUrl: 'http://fixture.local/solutions/checker',
        recoverySshTarget: null,
      })({}, context)
      expect(result).toBeInstanceOf(UpstreamResponseError)
    },
  )

  it('rejects schema mismatches and responses that echo document identity', async () => {
    for (const data of [
      { status: '1', send_status_msg: 'bad' },
      { status: 1, send_status_msg: 'passport АБ 123456' },
    ]) {
      const { context } = makeContext({ submit: { kind: 'success', data } })
      const result = await makePassportCheckHandler({
        checkerUrl: 'http://fixture.local/solutions/checker',
        recoverySshTarget: null,
      })({}, context)
      expect(result).toBeInstanceOf(InvalidCheckerResponseError)
      expect(JSON.stringify(result)).not.toContain('123456')
    }
  })
})
```

- [ ] **Step 6: Implement navigation evidence collection and response mapping**

Complete `check.ts` with helpers that return only safe booleans/metadata from the page:

```ts
async function collectNavigationEvidence(context: BrowserTaskContext, response: Response | null) {
  const pageEvidence = await context.page
    .evaluate(() => ({
      url: window.location.href,
      title: document.title,
      hasChallengeForm:
        document.querySelector('#challenge-form, form[action*="challenge"]') !== null,
      hasChallengePlatform:
        document.querySelector('script[src*="/cdn-cgi/challenge-platform/"]') !== null,
      hasChallengeContent: /cf-chl-|challenge-platform/i.test(document.documentElement.innerHTML),
    }))
    .catch((cause) => new UpstreamResponseError({ phase: 'navigation', cause }))
  if (pageEvidence instanceof Error) return pageEvidence

  const headers = response
    ? await response
        .allHeaders()
        .catch((cause) => new UpstreamResponseError({ phase: 'navigation', cause }))
    : {}
  if (headers instanceof Error) return headers

  return {
    ...pageEvidence,
    status: response?.status() ?? null,
    server: headers.server ?? null,
    cfRay: headers['cf-ray'] ?? null,
  } satisfies ChallengeEvidence
}

function containsIdentity(result: PassportCheckResult, identity: PassportIdentity) {
  return (
    result.send_status_msg.includes(identity.series) ||
    result.send_status_msg.includes(identity.number)
  )
}
```

Implement the handler's flat control flow:

```ts
export function makePassportCheckHandler(options: PassportCheckHandlerOptions) {
  return async (_payload: PassportCheckPayload, context: BrowserTaskContext) => {
    const identity = readPassportIdentity(context.secrets)
    if (identity instanceof Error) return identity

    const navigation = await context.page
      .goto(options.checkerUrl, { waitUntil: 'domcontentloaded' })
      .catch((cause) => new UpstreamResponseError({ phase: 'navigation', cause }))
    if (navigation instanceof Error) return navigation

    const evidence = await collectNavigationEvidence(context, navigation)
    if (evidence instanceof Error) return evidence
    if (isCloudflareChallenge(evidence)) {
      context.retainPageForRecovery()
      return new BrowserSessionRequiredError({ sshTarget: options.recoverySshTarget })
    }
    if (navigation && !navigation.ok()) {
      return new UpstreamResponseError({ phase: 'navigation', status: navigation.status() })
    }

    const outcome = await submitPassport(context, identity)
    if (outcome instanceof Error) return outcome
    if (outcome.kind === 'session_required') {
      const prepared = await context.page
        .goto(options.checkerUrl, { waitUntil: 'domcontentloaded' })
        .catch((cause) => new UpstreamResponseError({ phase: 'navigation', cause }))
      if (prepared instanceof Error)
        console.warn('Failed to prepare passport recovery page', prepared)
      context.retainPageForRecovery()
      return new BrowserSessionRequiredError({ sshTarget: options.recoverySshTarget })
    }
    if (outcome.kind === 'network_error') {
      return new UpstreamResponseError({ phase: 'submission' })
    }
    if (outcome.kind === 'upstream_error') {
      return new UpstreamResponseError({ phase: 'submission', status: outcome.status })
    }
    if (outcome.kind === 'invalid_json') return new InvalidCheckerResponseError()

    const parsed = passportCheckResultSchema.safeParse(outcome.data)
    if (!parsed.success) return new InvalidCheckerResponseError()
    if (containsIdentity(parsed.data, identity)) return new InvalidCheckerResponseError()
    return parsed.data
  }
}
```

- [ ] **Step 7: Implement the page-context FormData submission without returning bodies**

Add `submitPassport` to `check.ts`. Keep all response text inside the browser callback:

```ts
async function submitPassport(
  context: BrowserTaskContext,
  identity: PassportIdentity,
): Promise<UpstreamResponseError | SubmitOutcome> {
  return context.page
    .evaluate(async ({ series, number }) => {
      const formData = new FormData()
      formData.set('service', '1')
      formData.set('doc_1_select', '1')
      formData.set('doc_1_series', series)
      formData.set('doc_1_number6', number)

      const response = await fetch('/solutions/checker', {
        method: 'POST',
        body: formData,
      }).catch(() => null)
      if (response === null) return { kind: 'network_error' } as const

      const text = await response.text().catch(() => null)
      if (text === null) return { kind: 'invalid_json' } as const

      const lower = text.toLowerCase()
      const cloudflareHeader =
        response.headers.get('server')?.toLowerCase().includes('cloudflare') === true ||
        response.headers.has('cf-ray')
      const challengeMarker =
        lower.includes('/cdn-cgi/challenge-platform/') ||
        lower.includes('id="challenge-form"') ||
        lower.includes('<title>just a moment')
      const challengeShapedContent = lower.includes('cf-chl-')
      if (
        challengeMarker ||
        ([403, 503].includes(response.status) && cloudflareHeader && challengeShapedContent)
      ) {
        return { kind: 'session_required' } as const
      }
      if (!response.ok) return { kind: 'upstream_error', status: response.status } as const

      return Promise.resolve(text)
        .then((value) => ({ kind: 'success', data: JSON.parse(value) as unknown }) as const)
        .catch(() => ({ kind: 'invalid_json' }) as const)
    }, identity)
    .catch((cause) => new UpstreamResponseError({ phase: 'submission', cause }))
}
```

- [ ] **Step 8: Run task tests and typecheck**

```powershell
pnpm --filter widgets-passport-checker test -- browser/check.test.ts
pnpm --filter widgets-passport-checker typecheck
```

Expected: classifier, validation, orchestration, no-retry, and redaction tests PASS.

- [ ] **Step 9: Commit the checker flow**

```powershell
git add packages/widgets/passport-checker/browser/challenge.ts packages/widgets/passport-checker/browser/check.ts packages/widgets/passport-checker/browser/check.test.ts
git commit -m "feat(passport-checker): implement browser checker flow"
```

## Task 6: Register the Fixed Production Browser Definition

**Files:**

- Create: `packages/widgets/passport-checker/browser.ts`
- Create: `packages/widgets/passport-checker/browser.test.ts`
- Test: `packages/widgets/passport-checker/browser.test.ts`
- Generated/ignored: `packages/browser-automation/src/tasks/widget-browser-list.generated.ts`

- [ ] **Step 1: Write failing entrypoint and normalization tests**

Create `packages/widgets/passport-checker/browser.test.ts`:

```ts
import { describe, expect, it } from 'vitest'

import browser, {
  makePassportCheckerBrowser,
  normalizeRecoverySshTarget,
  PASSPORT_CHECKER_URL,
} from './browser'

describe('passport checker browser definition', () => {
  it('exports exactly the check schema and handler for the fixed production URL', () => {
    expect(PASSPORT_CHECKER_URL).toBe('https://pasport.org.ua/solutions/checker')
    expect(Object.keys(browser.schemas)).toEqual(['check'])
    expect(Object.keys(browser.handlers)).toEqual(['check'])
  })

  it('allows only safe SSH host targets in public recovery metadata', () => {
    expect(normalizeRecoverySshTarget(' pi@myboard.local ')).toBe('pi@myboard.local')
    expect(normalizeRecoverySshTarget('192.168.1.10')).toBe('192.168.1.10')
    expect(normalizeRecoverySshTarget('pi@host; shutdown')).toBeNull()
    expect(normalizeRecoverySshTarget('')).toBeNull()
    expect(normalizeRecoverySshTarget(undefined)).toBeNull()
  })

  it('creates a fixture definition without exposing URL as task input', () => {
    const fixture = makePassportCheckerBrowser({
      checkerUrl: 'http://127.0.0.1:3000/solutions/checker',
      recoverySshTarget: null,
    })
    expect(Object.keys(fixture.schemas.check.payload.shape)).toEqual([])
  })
})
```

- [ ] **Step 2: Run the entrypoint test and verify it fails**

```powershell
pnpm --filter widgets-passport-checker test -- browser.test.ts
```

Expected: FAIL because root `browser.ts` does not exist.

- [ ] **Step 3: Implement the factory and fixed default export**

Create `packages/widgets/passport-checker/browser.ts`:

```ts
import type { BrowserTaskContext } from 'browser-automation/task-context'
import { defineWidgetBrowser } from '@shared/widgets/browser-contracts'

import { makePassportCheckHandler } from './browser/check'
import { passportCheckerBrowserSchemas } from './types'

export const PASSPORT_CHECKER_URL = 'https://pasport.org.ua/solutions/checker'

export function normalizeRecoverySshTarget(value: string | undefined) {
  const target = value?.trim()
  if (!target) return null
  return /^(?:[A-Za-z0-9._-]+@)?[A-Za-z0-9.-]+$/.test(target) ? target : null
}

export function makePassportCheckerBrowser(options: {
  checkerUrl: string
  recoverySshTarget: string | null
}) {
  return defineWidgetBrowser<BrowserTaskContext>()({
    schemas: passportCheckerBrowserSchemas,
    handlers: {
      check: makePassportCheckHandler(options),
    },
  })
}

export default makePassportCheckerBrowser({
  checkerUrl: PASSPORT_CHECKER_URL,
  recoverySshTarget: normalizeRecoverySshTarget(process.env.AUTOMATION_SSH_TARGET),
})
```

- [ ] **Step 4: Run entrypoint tests, browser codegen, and typechecks**

```powershell
pnpm --filter widgets-passport-checker test -- browser.test.ts
pnpm run codegen:browser
pnpm --filter widgets-passport-checker typecheck
pnpm --filter browser-automation typecheck
```

Expected: tests and typechecks PASS. The ignored generated list imports `@widgets/passport-checker/browser` and injects `widgetId: "passport-checker"` exactly once.

- [ ] **Step 5: Prove the production browser bundle includes the generated task**

```powershell
pnpm --filter browser-automation build
```

Expected: Rspack emits `packages/browser-automation/dist/index.cjs` with no unresolved widget or shared imports.

- [ ] **Step 6: Commit the registered browser entrypoint**

```powershell
git add packages/widgets/passport-checker/browser.ts packages/widgets/passport-checker/browser.test.ts
git commit -m "feat(passport-checker): register browser check task"
```

Do not add the generated registry or `dist/`; both are intentionally ignored.

## Task 7: Prove the Real Multipart Flow Against a Local Fixture

**Files:**

- Create: `packages/widgets/passport-checker/browser/check.integration.test.ts`
- Test: `packages/widgets/passport-checker/browser/check.integration.test.ts`

- [ ] **Step 1: Create an opt-in local fixture server and headed Chromium harness**

Create `browser/check.integration.test.ts` with an opt-in suite:

```ts
import fs from 'node:fs'
import http, { type IncomingMessage, type ServerResponse } from 'node:http'
import type { AddressInfo } from 'node:net'
import os from 'node:os'
import path from 'node:path'

import type { BrowserTaskContext, WidgetSecrets } from 'browser-automation/task-context'
import { chromium, type BrowserContext } from 'playwright'
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'

import { makePassportCheckerBrowser } from '../browser'
import {
  BrowserSessionRequiredError,
  InvalidCheckerResponseError,
  UpstreamResponseError,
} from './errors'

const run = process.env.BROWSER_IT === '1'
const fakeSeries = 'АБ'
const fakeNumber = '123456'

type FixtureMode =
  | 'success'
  | 'navigation-challenge'
  | 'post-challenge'
  | 'upstream-error'
  | 'invalid-json'
  | 'invalid-schema'

function fixtureSecrets(): WidgetSecrets {
  return {
    read: (key) => (key === 'series' ? fakeSeries : key === 'number' ? fakeNumber : undefined),
    has: (key) => key === 'series' || key === 'number',
  }
}

async function readForm(request: IncomingMessage) {
  const chunks: Buffer[] = []
  for await (const chunk of request) chunks.push(Buffer.from(chunk))
  const response = new Response(new Uint8Array(Buffer.concat(chunks)), {
    headers: { 'content-type': request.headers['content-type'] ?? '' },
  })
  return response.formData()
}

describe.skipIf(!run)('passport checker (real browser fixture)', () => {
  let browser: BrowserContext
  let server: http.Server
  let checkerUrl = ''
  let mode: FixtureMode = 'success'
  let receivedForm: FormData | null = null
  let receivedContentType = ''
  const requests: Array<{ method: string; url: string }> = []

  beforeAll(async () => {
    server = http.createServer(async (request, response) => {
      requests.push({ method: request.method ?? '', url: request.url ?? '' })
      if (request.method === 'GET') {
        const challenged =
          mode === 'navigation-challenge' || (mode === 'post-challenge' && receivedForm !== null)
        return handleGet(response, challenged)
      }
      if (request.method === 'POST') {
        receivedContentType = request.headers['content-type'] ?? ''
        receivedForm = await readForm(request)
        return handlePost(response, mode)
      }
      response.writeHead(405).end()
    })
    await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve))
    checkerUrl = `http://127.0.0.1:${(server.address() as AddressInfo).port}/solutions/checker`
    browser = await chromium.launchPersistentContext(
      fs.mkdtempSync(path.join(os.tmpdir(), 'passport-checker-it-profile-')),
      { headless: false },
    )
  })

  beforeEach(() => {
    mode = 'success'
    receivedForm = null
    receivedContentType = ''
    requests.length = 0
  })

  afterAll(async () => {
    await browser?.close()
    await new Promise<void>((resolve) => server?.close(() => resolve()))
  })

  async function runCheck() {
    const page = await browser.newPage()
    const browserRequests: string[] = []
    page.on('request', (request) => browserRequests.push(request.url()))
    const retainPageForRecovery = vi.fn()
    const definition = makePassportCheckerBrowser({ checkerUrl, recoverySshTarget: null })
    const context: BrowserTaskContext = {
      page,
      secrets: fixtureSecrets(),
      retainPageForRecovery,
    }
    const result = await definition.handlers.check({}, context)
    if (!retainPageForRecovery.mock.calls.length) await page.close()
    return { browserRequests, page, result, retainPageForRecovery }
  }
})
```

Define `handleGet` and `handlePost` at module scope. They must emit only fixed fixture data and never log the received form:

```ts
function challenge(response: ServerResponse) {
  response.writeHead(503, {
    'content-type': 'text/html',
    server: 'cloudflare',
    'cf-ray': 'fixture-ray',
  })
  response.end('<!doctype html><title>Just a moment...</title><form id="challenge-form"></form>')
}

function handleGet(response: ServerResponse, challenged: boolean) {
  if (challenged) return challenge(response)
  response.writeHead(200, { 'content-type': 'text/html' })
  response.end('<!doctype html><title>Checker fixture</title><main>ready</main>')
}

function handlePost(response: ServerResponse, mode: FixtureMode) {
  if (mode === 'post-challenge') return challenge(response)
  if (mode === 'upstream-error') return response.writeHead(502).end('unavailable')
  if (mode === 'invalid-json') {
    return response.writeHead(200, { 'content-type': 'application/json' }).end('{broken')
  }
  if (mode === 'invalid-schema') {
    return response
      .writeHead(200, { 'content-type': 'application/json' })
      .end(JSON.stringify({ status: 'wrong', send_status_msg: 'bad' }))
  }
  response.writeHead(200, { 'content-type': 'application/json' })
  response.end(JSON.stringify({ status: 1, send_status_msg: 'fixture ok', ignored: true }))
}
```

- [ ] **Step 2: Add real-browser success, challenge, error, and redaction assertions**

Inside the suite add:

```ts
it('submits exact browser-generated multipart fields and returns validated data', async () => {
  const { browserRequests, result } = await runCheck()

  expect(result).toEqual({ status: 1, send_status_msg: 'fixture ok' })
  expect(receivedContentType).toMatch(/^multipart\/form-data; boundary=/)
  expect(receivedForm).not.toBeNull()
  expect(Object.fromEntries(receivedForm!.entries())).toEqual({
    service: '1',
    doc_1_select: '1',
    doc_1_series: fakeSeries,
    doc_1_number6: fakeNumber,
  })
  expect(requests).toEqual([
    { method: 'GET', url: '/solutions/checker' },
    { method: 'POST', url: '/solutions/checker' },
  ])
  expect(browserRequests.every((url) => !url.includes('pasport.org.ua'))).toBe(true)
})

it('retains a visible navigation challenge without POST', async () => {
  mode = 'navigation-challenge'
  const { page, result, retainPageForRecovery } = await runCheck()

  expect(result).toBeInstanceOf(BrowserSessionRequiredError)
  expect(retainPageForRecovery).toHaveBeenCalledOnce()
  expect(await page.title()).toContain('Just a moment')
  expect(requests).toEqual([{ method: 'GET', url: '/solutions/checker' }])
  await page.close()
})

it('maps a POST challenge and prepares recovery without repeating POST', async () => {
  mode = 'post-challenge'
  const { page, result, retainPageForRecovery } = await runCheck()

  expect(result).toBeInstanceOf(BrowserSessionRequiredError)
  expect(retainPageForRecovery).toHaveBeenCalledOnce()
  expect(requests).toEqual([
    { method: 'GET', url: '/solutions/checker' },
    { method: 'POST', url: '/solutions/checker' },
    { method: 'GET', url: '/solutions/checker' },
  ])
  expect(await page.title()).toContain('Just a moment')
  await page.close()
})

it.each([
  ['upstream-error', UpstreamResponseError],
  ['invalid-json', InvalidCheckerResponseError],
  ['invalid-schema', InvalidCheckerResponseError],
] as const)('maps %s without leaking identity', async (fixtureMode, ErrorType) => {
  mode = fixtureMode
  const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined)
  const error = vi.spyOn(console, 'error').mockImplementation(() => undefined)

  const { result } = await runCheck()

  expect(result).toBeInstanceOf(ErrorType)
  expect(JSON.stringify(result)).not.toContain(fakeSeries)
  expect(JSON.stringify(result)).not.toContain(fakeNumber)
  expect(JSON.stringify(warn.mock.calls)).not.toContain(fakeNumber)
  expect(JSON.stringify(error.mock.calls)).not.toContain(fakeNumber)
  warn.mockRestore()
  error.mockRestore()
})
```

The exact method assertions prove that the POST-challenge case performs one GET,
one POST, and one recovery GET, never a second POST.

- [ ] **Step 3: Run the default package suite and verify the integration suite skips cleanly**

```powershell
pnpm --filter widgets-passport-checker test
```

Expected: all fast tests PASS; real-browser suite reports skipped because `BROWSER_IT` is unset.

- [ ] **Step 4: Run the opt-in headed Chromium fixture suite**

On a headed-capable Windows host:

```powershell
$env:BROWSER_IT='1'
pnpm --filter widgets-passport-checker test -- browser/check.integration.test.ts
Remove-Item Env:BROWSER_IT
```

In the browser container/Xvfb, set `BROWSER_IT=1` for the same package test command.

Expected: success multipart, navigation challenge, POST challenge, upstream, invalid JSON, schema, and redaction cases all PASS; no request leaves the local fixture origin.

- [ ] **Step 5: Commit real-browser fixture coverage**

```powershell
git add packages/widgets/passport-checker/browser/check.integration.test.ts
git commit -m "test(passport-checker): cover real browser fixture flow"
```

## Task 8: Run Repository Gates and Verify Isolation

**Files:**

- Verify: `packages/widgets/.ports.json`
- Verify generated/ignored: `packages/browser-automation/src/tasks/widget-browser-list.generated.ts`
- Verify build output/ignored: `packages/browser-automation/dist/index.cjs`

- [ ] **Step 1: Run focused package tests and typechecks**

```powershell
pnpm vitest run scripts/codegen.test.ts packages/shared/browser-automation/task-errors.test.ts
pnpm --filter browser-automation test
pnpm --filter widgets-passport-checker test
pnpm --filter browser-automation typecheck
pnpm --filter widgets-passport-checker typecheck
```

Expected: all commands PASS; the real-browser suite is skipped only in the ordinary package test.

- [ ] **Step 2: Regenerate all registries and verify entrypoint isolation**

```powershell
pnpm run codegen
Select-String -Path packages/browser-automation/src/tasks/widget-browser-list.generated.ts -Pattern 'passport-checker/browser'
Select-String -Path packages/server/src/widgets/widget-server-list.generated.ts -Pattern 'passport-checker'
Select-String -Path packages/client/src/widget-registry/model/widget-catalog.generated.ts -Pattern 'passport-checker'
Get-Content packages/widgets/.ports.json
```

Expected:

- browser list has exactly one `passport-checker/browser` import;
- server and client searches produce no match;
- ports remain `clock: 5180` and `ofelia-poop-duty: 5181` only.

- [ ] **Step 3: Build the production browser service**

```powershell
pnpm --filter browser-automation build
```

Expected: Rspack emits `dist/index.cjs` and resolves the generated passport browser definition.

- [ ] **Step 4: Re-run the mandatory opt-in fixture gate**

```powershell
$env:BROWSER_IT='1'
pnpm --filter widgets-passport-checker test -- browser/check.integration.test.ts
Remove-Item Env:BROWSER_IT
```

Expected: all real-browser fixture tests PASS.

- [ ] **Step 5: Run the full workspace gate**

```powershell
pnpm check
```

Expected: codegen, lint, formatting, dependency policy, all typechecks, and all default tests PASS.

- [ ] **Step 6: Inspect tracked changes and commit only genuine gate fixes if needed**

```powershell
git status --short
git diff --check
```

Expected: generated registries and `dist/` remain ignored and the worktree is
clean. If a tracked file changed, stop and inspect that exact diff; do not stage
or commit an unexplained gate mutation. Apply a focused correction in the task
that owns the file, rerun its targeted test, rerun `pnpm check`, and commit the
explicit correction with a scoped Conventional Commit message. Do not create an
empty verification commit.

## Completion Checklist

- [ ] Browser-only packages are omitted from client catalog and ports.
- [ ] Widget-owned errors serialize through the shared task-error base.
- [ ] Recovery pages survive normal release but not retry, abort, or shutdown.
- [ ] `passport-checker/check` accepts only `{}` and no configurable URL/document input.
- [ ] Scoped secrets are validated without entering public errors or logs.
- [ ] Cloudflare classification requires positive evidence, not status alone.
- [ ] The page-context boundary returns only safe discriminators or parsed success data.
- [ ] No automatic POST retry occurs; POST challenge recovery performs GET only.
- [ ] The validated success result strips extra fields and rejects identity echo.
- [ ] Real Chromium proves exact multipart fields against a local fixture.
- [ ] Client/server isolation, browser bundle, workspace checks, and redaction gates pass.
