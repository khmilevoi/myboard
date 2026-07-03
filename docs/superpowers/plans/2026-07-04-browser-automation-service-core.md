# Browser Automation Service Core Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Turn `packages/browser-automation` into an executable internal service that validates and dispatches allowlisted widget browser tasks through one FIFO lane with deadlines, cancellation, liveness health, and graceful shutdown — decoupled from a real browser by a fake/stub executor seam.

**Architecture:** A transport-agnostic service core (`service.ts`) composes a nested task registry (already generated in Subproject 1), a `BrowserExecutor<Context>` context-provider seam, a single-lane FIFO queue, and pure single-task dispatch. A thin `node:http`/`find-my-way` layer wraps the core. The task endpoint always answers HTTP 200 with a discriminated envelope; service unavailability answers HTTP 503; `/health` reports liveness only. Subproject 3 replaces the stub executor with the persistent Chromium host at one construction site.

**Tech Stack:** TypeScript (ESM, `moduleResolution: bundler`), `zod` (catalog), `errore` (errors-as-values), `find-my-way` (routing), `node:http`, Vitest (node environment), `tsx` (dev entrypoint).

## Global Constraints

Every task's requirements implicitly include this section.

- **No Playwright and no Reatom** are imported anywhere in `packages/browser-automation`.
- **Errors-as-values via `errore`.** Always `import * as errore from 'errore'`; never throw for expected failures; convert external throwing boundaries with `.catch((cause) => new TaggedError({ cause }))`; flat `instanceof Error` early returns.
- **Zod validates both sides.** The request body and the response envelopes each have a Zod schema.
- **Task endpoint always HTTP 200** with `{ ok: true, result } | { ok: false, error: { code, message, meta? } }`. Service unavailability answers **HTTP 503**. `/health` answers **200** when ready, **503** otherwise.
- **Deadlines come from env only** (`PORT`, `BROWSER_QUEUE_WAIT_MS`, `BROWSER_TASK_TIMEOUT_MS`); callers pass no timing.
- **Single FIFO lane, concurrency exactly one.** The lane waits for the current task to fully settle — including executor teardown/`release` — before starting the next, even after a timeout.
- **Redaction.** Envelope errors carry only `code`, `message`, and safe `meta`. Raw `cause` chains, Zod issue details, payloads, and results never cross the envelope and are never logged; request/response bodies are never logged.
- **Commits** prefix commands with `rtk` (repo golden rule) and end messages with the repo `Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>` trailer.

## File Structure

```text
packages/browser-automation/
  package.json                              modify: add find-my-way dep, tsx devDep, dev/start scripts
  src/
    tasks/registry.ts                       exists (SP1) — consumed, unchanged
    tasks/widget-browser-list.generated.ts  exists (SP1, empty) — consumed by index.ts
    errors.ts            create: BrowserTaskError base + tagged errors + toEnvelopeError
    errors.test.ts       create
    config.ts            create: loadBrowserServiceConfig (env → config, errors-as-values)
    config.test.ts       create
    schemas.ts           create: request/response/health Zod envelopes
    schemas.test.ts      create
    executor.ts          create: BrowserExecutor<Context> seam + makeStubExecutor (SP2 placeholder)
    testing/fake-executor.ts  create: makeFakeExecutor for tests
    executor.test.ts     create
    dispatch.ts          create: dispatchBrowserTask (lookup → validate → handler → validate)
    dispatch.test.ts     create
    queue.ts             create: makeSingleLaneQueue (FIFO, deadlines, cancellation, drain)
    queue.test.ts        create
    service.ts           create: makeBrowserService (compose + lifecycle + invoke/health/shutdown)
    service.test.ts      create
    http/body.ts         create: readJsonBody (1 MB cap)
    http/app.ts          create: node:http + find-my-way routing + serialization
    http/app.test.ts     create
    index.ts             create: process entrypoint (env → registry → stub executor → HTTP)
```

---

### Task 1: Error taxonomy and envelope serializer

**Files:**
- Create: `packages/browser-automation/src/errors.ts`
- Test: `packages/browser-automation/src/errors.test.ts`

**Interfaces:**
- Consumes: `errore` (`createTaggedError`, `AbortError`).
- Produces:
  - `class BrowserTaskError extends Error` with instance fields `code: string` (default `'internal'`), `publicMessage: string` (default `'Browser task failed'`), and getter `publicMeta(): Record<string, unknown> | undefined` (default `undefined`).
  - Tagged subclasses of `BrowserTaskError`: `UnknownBrowserTaskError` (`code: 'unknown_task'`), `InvalidBrowserPayloadError` (`'payload_invalid'`), `InvalidBrowserResultError` (`'result_invalid'`), `AutomationTimeoutError` (`'automation_timeout'`, `publicMeta → { phase }`), `BrowserTaskHandlerError` (inherits `'internal'`), `BrowserExecutorError` (inherits `'internal'`). Constructor payloads: task errors take `{ widgetId, taskId, cause? }`; `AutomationTimeoutError` takes `{ phase: 'queue' | 'execution' }`.
  - `class BrowserServiceUnavailableError` (tagged, NOT a `BrowserTaskError`), payload `{ state }`.
  - `type EnvelopeError = { code: string; message: string; meta?: Record<string, unknown> }`.
  - `function toEnvelopeError(error: Error): EnvelopeError`.

- [ ] **Step 1: Write the failing test**

Create `packages/browser-automation/src/errors.test.ts`:

```ts
import { describe, expect, it } from 'vitest'

import {
  AutomationTimeoutError,
  BrowserServiceUnavailableError,
  BrowserTaskHandlerError,
  UnknownBrowserTaskError,
  toEnvelopeError,
} from './errors'

describe('browser task errors', () => {
  it('serializes a public task error to its code and safe message', () => {
    const error = new UnknownBrowserTaskError({ widgetId: 'w', taskId: 't' })
    expect(error.code).toBe('unknown_task')
    expect(toEnvelopeError(error)).toEqual({
      code: 'unknown_task',
      message: 'Unknown browser task',
    })
  })

  it('includes only safe meta for timeouts', () => {
    const error = new AutomationTimeoutError({ phase: 'queue' })
    expect(toEnvelopeError(error)).toEqual({
      code: 'automation_timeout',
      message: 'The browser task timed out',
      meta: { phase: 'queue' },
    })
  })

  it('redacts unknown handler failures and their cause chains', () => {
    const secret = new Error('series=AB number=123456')
    const error = new BrowserTaskHandlerError({ widgetId: 'w', taskId: 't', cause: secret })
    const envelope = toEnvelopeError(error)
    expect(envelope).toEqual({ code: 'internal', message: 'Browser task failed' })
    expect(JSON.stringify(envelope)).not.toContain('123456')
  })

  it('wraps a plain non-task error as internal', () => {
    expect(toEnvelopeError(new Error('boom'))).toEqual({
      code: 'internal',
      message: 'Browser task failed',
    })
  })

  it('keeps service-unavailable separate from the task error hierarchy', () => {
    const error = new BrowserServiceUnavailableError({ state: 'draining' })
    expect(error).toBeInstanceOf(BrowserServiceUnavailableError)
    expect(error.state).toBe('draining')
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm --filter browser-automation exec vitest run src/errors.test.ts`
Expected: FAIL — `Failed to resolve import "./errors"` / module not found.

- [ ] **Step 3: Write minimal implementation**

Create `packages/browser-automation/src/errors.ts`:

```ts
import * as errore from 'errore'

export class BrowserTaskError extends Error {
  code = 'internal'
  publicMessage = 'Browser task failed'
  get publicMeta(): Record<string, unknown> | undefined {
    return undefined
  }
}

export class UnknownBrowserTaskError extends errore.createTaggedError({
  name: 'UnknownBrowserTaskError',
  message: 'Unknown browser task $widgetId/$taskId',
  extends: BrowserTaskError,
}) {
  code = 'unknown_task'
  publicMessage = 'Unknown browser task'
}

export class InvalidBrowserPayloadError extends errore.createTaggedError({
  name: 'InvalidBrowserPayloadError',
  message: 'Invalid payload for $widgetId/$taskId',
  extends: BrowserTaskError,
}) {
  code = 'payload_invalid'
  publicMessage = 'Browser task payload is invalid'
}

export class InvalidBrowserResultError extends errore.createTaggedError({
  name: 'InvalidBrowserResultError',
  message: 'Invalid result from $widgetId/$taskId',
  extends: BrowserTaskError,
}) {
  code = 'result_invalid'
  publicMessage = 'Browser task result is invalid'
}

export class AutomationTimeoutError extends errore.createTaggedError({
  name: 'AutomationTimeoutError',
  message: 'Browser task timed out during $phase',
  extends: BrowserTaskError,
}) {
  code = 'automation_timeout'
  publicMessage = 'The browser task timed out'
  get publicMeta(): Record<string, unknown> {
    return { phase: this.phase }
  }
}

export class BrowserTaskHandlerError extends errore.createTaggedError({
  name: 'BrowserTaskHandlerError',
  message: 'Handler failed for $widgetId/$taskId',
  extends: BrowserTaskError,
}) {}

export class BrowserExecutorError extends errore.createTaggedError({
  name: 'BrowserExecutorError',
  message: 'Executor failed for $widgetId/$taskId',
  extends: BrowserTaskError,
}) {}

export class BrowserServiceUnavailableError extends errore.createTaggedError({
  name: 'BrowserServiceUnavailableError',
  message: 'Browser service is not accepting work ($state)',
}) {}

export type EnvelopeError = {
  code: string
  message: string
  meta?: Record<string, unknown>
}

export function toEnvelopeError(error: Error): EnvelopeError {
  if (error instanceof BrowserTaskError) {
    const meta = error.publicMeta
    return meta
      ? { code: error.code, message: error.publicMessage, meta }
      : { code: error.code, message: error.publicMessage }
  }
  return { code: 'internal', message: 'Browser task failed' }
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm --filter browser-automation exec vitest run src/errors.test.ts`
Expected: PASS (5 tests).

- [ ] **Step 5: Commit**

```bash
rtk git add packages/browser-automation/src/errors.ts packages/browser-automation/src/errors.test.ts
rtk git commit -m "feat(browser-automation): add task error taxonomy and envelope serializer"
```

---

### Task 2: Service configuration

**Files:**
- Create: `packages/browser-automation/src/config.ts`
- Test: `packages/browser-automation/src/config.test.ts`

**Interfaces:**
- Consumes: `errore`, `zod`.
- Produces:
  - `type BrowserServiceConfig = { port: number; queueWaitMs: number; executionMs: number }`.
  - `class BrowserServiceConfigError` (tagged, payload `{ reason }`).
  - `function loadBrowserServiceConfig(env: NodeJS.ProcessEnv): BrowserServiceConfigError | BrowserServiceConfig`.
  - Defaults: `port 8788`, `queueWaitMs 30_000`, `executionMs 60_000`.

- [ ] **Step 1: Write the failing test**

Create `packages/browser-automation/src/config.test.ts`:

```ts
import { describe, expect, it } from 'vitest'

import { BrowserServiceConfigError, loadBrowserServiceConfig } from './config'

describe('loadBrowserServiceConfig', () => {
  it('applies defaults when nothing is set', () => {
    expect(loadBrowserServiceConfig({})).toEqual({
      port: 8788,
      queueWaitMs: 30_000,
      executionMs: 60_000,
    })
  })

  it('parses positive integer overrides', () => {
    const config = loadBrowserServiceConfig({
      PORT: '9000',
      BROWSER_QUEUE_WAIT_MS: '5000',
      BROWSER_TASK_TIMEOUT_MS: '15000',
    })
    expect(config).toEqual({ port: 9000, queueWaitMs: 5000, executionMs: 15000 })
  })

  it('returns a tagged error for a non-positive-integer value', () => {
    const result = loadBrowserServiceConfig({ BROWSER_TASK_TIMEOUT_MS: '-1' })
    expect(result).toBeInstanceOf(BrowserServiceConfigError)
  })

  it('returns a tagged error for a non-numeric value', () => {
    const result = loadBrowserServiceConfig({ PORT: 'abc' })
    expect(result).toBeInstanceOf(BrowserServiceConfigError)
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm --filter browser-automation exec vitest run src/config.test.ts`
Expected: FAIL — module `./config` not found.

- [ ] **Step 3: Write minimal implementation**

Create `packages/browser-automation/src/config.ts`:

```ts
import * as errore from 'errore'
import { z } from 'zod'

export type BrowserServiceConfig = {
  port: number
  queueWaitMs: number
  executionMs: number
}

export class BrowserServiceConfigError extends errore.createTaggedError({
  name: 'BrowserServiceConfigError',
  message: 'Invalid browser service configuration: $reason',
}) {}

// Preprocess intercepts unset/empty env vars before coercion (Number('') === 0
// would otherwise fail .positive()), preserving the "unset -> default" behaviour.
const positiveIntEnv = (fallback: number) =>
  z.preprocess(
    (value) => (value === undefined || value === '' ? fallback : value),
    z.coerce.number().int().positive(),
  )

const ConfigSchema = z.object({
  PORT: positiveIntEnv(8788),
  BROWSER_QUEUE_WAIT_MS: positiveIntEnv(30_000),
  BROWSER_TASK_TIMEOUT_MS: positiveIntEnv(60_000),
})

export function loadBrowserServiceConfig(
  env: NodeJS.ProcessEnv,
): BrowserServiceConfigError | BrowserServiceConfig {
  const parsed = ConfigSchema.safeParse(env)
  if (!parsed.success) {
    const field = parsed.error.issues[0]?.path.join('.') ?? 'configuration'
    return new BrowserServiceConfigError({ reason: `${field} must be a positive integer` })
  }
  return {
    port: parsed.data.PORT,
    queueWaitMs: parsed.data.BROWSER_QUEUE_WAIT_MS,
    executionMs: parsed.data.BROWSER_TASK_TIMEOUT_MS,
  }
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm --filter browser-automation exec vitest run src/config.test.ts`
Expected: PASS (4 tests).

- [ ] **Step 5: Commit**

```bash
rtk git add packages/browser-automation/src/config.ts packages/browser-automation/src/config.test.ts
rtk git commit -m "feat(browser-automation): add env-based service configuration"
```

---

### Task 3: Wire envelope schemas

**Files:**
- Create: `packages/browser-automation/src/schemas.ts`
- Test: `packages/browser-automation/src/schemas.test.ts`

**Interfaces:**
- Consumes: `zod`.
- Produces:
  - `TaskRequestSchema` = `z.object({ payload: z.unknown() })`; `type TaskRequest`.
  - `TaskSuccessSchema`, `TaskErrorSchema`, `TaskResponseSchema` (`z.discriminatedUnion('ok', [...])`); `type TaskResponse`.
  - `HealthResponseSchema` = `z.object({ status: z.enum(['starting', 'ready', 'draining']) })`; `type HealthResponse`.

- [ ] **Step 1: Write the failing test**

Create `packages/browser-automation/src/schemas.test.ts`:

```ts
import { describe, expect, it } from 'vitest'

import {
  HealthResponseSchema,
  TaskRequestSchema,
  TaskResponseSchema,
} from './schemas'

describe('wire schemas', () => {
  it('accepts a request with a payload and a request with none', () => {
    expect(TaskRequestSchema.safeParse({ payload: { a: 1 } }).success).toBe(true)
    expect(TaskRequestSchema.safeParse({}).success).toBe(true)
  })

  it('parses a success envelope', () => {
    expect(TaskResponseSchema.safeParse({ ok: true, result: { x: 1 } }).success).toBe(true)
  })

  it('parses an error envelope with optional meta', () => {
    expect(
      TaskResponseSchema.safeParse({
        ok: false,
        error: { code: 'automation_timeout', message: 'x', meta: { phase: 'queue' } },
      }).success,
    ).toBe(true)
  })

  it('rejects a mixed envelope', () => {
    expect(TaskResponseSchema.safeParse({ ok: true, error: { code: 'x', message: 'y' } }).success).toBe(
      false,
    )
  })

  it('parses a health response', () => {
    expect(HealthResponseSchema.safeParse({ status: 'ready' }).success).toBe(true)
    expect(HealthResponseSchema.safeParse({ status: 'nope' }).success).toBe(false)
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm --filter browser-automation exec vitest run src/schemas.test.ts`
Expected: FAIL — module `./schemas` not found.

- [ ] **Step 3: Write minimal implementation**

Create `packages/browser-automation/src/schemas.ts`:

```ts
import { z } from 'zod'

export const TaskRequestSchema = z.object({ payload: z.unknown() })
export type TaskRequest = z.infer<typeof TaskRequestSchema>

export const TaskSuccessSchema = z.object({ ok: z.literal(true), result: z.unknown() })
export const TaskErrorSchema = z.object({
  ok: z.literal(false),
  error: z.object({
    code: z.string(),
    message: z.string(),
    meta: z.record(z.string(), z.unknown()).optional(),
  }),
})
export const TaskResponseSchema = z.discriminatedUnion('ok', [TaskSuccessSchema, TaskErrorSchema])
export type TaskResponse = z.infer<typeof TaskResponseSchema>

export const HealthResponseSchema = z.object({
  status: z.enum(['starting', 'ready', 'draining']),
})
export type HealthResponse = z.infer<typeof HealthResponseSchema>
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm --filter browser-automation exec vitest run src/schemas.test.ts`
Expected: PASS (5 tests).

- [ ] **Step 5: Commit**

```bash
rtk git add packages/browser-automation/src/schemas.ts packages/browser-automation/src/schemas.test.ts
rtk git commit -m "feat(browser-automation): add wire envelope schemas"
```

---

### Task 4: Executor seam, stub, and fake

**Files:**
- Create: `packages/browser-automation/src/executor.ts`
- Create: `packages/browser-automation/src/testing/fake-executor.ts`
- Test: `packages/browser-automation/src/executor.test.ts`

**Interfaces:**
- Produces:
  - `type BrowserExecutor<Context> = { acquire(signal: AbortSignal): Promise<Error | Context>; release(context: Context): Promise<void>; shutdown(): Promise<void> }`.
  - `function makeStubExecutor(): BrowserExecutor<unknown>` (SP2 placeholder; SP3 replaces at the call site in `index.ts`).
  - `type FakeContext = { id: string; signal: AbortSignal }`.
  - `type FakeExecutorState = { acquired: number; released: number; shutdowns: number; lastSignal: AbortSignal | null; acquireError: Error | null }`.
  - `function makeFakeExecutor(): { executor: BrowserExecutor<FakeContext>; state: FakeExecutorState }`.

- [ ] **Step 1: Write the failing test**

Create `packages/browser-automation/src/executor.test.ts`:

```ts
import { describe, expect, it } from 'vitest'

import { makeStubExecutor } from './executor'
import { makeFakeExecutor } from './testing/fake-executor'

describe('fake executor', () => {
  it('acquires a context carrying the abort signal', async () => {
    const { executor, state } = makeFakeExecutor()
    const controller = new AbortController()
    const context = await executor.acquire(controller.signal)
    if (context instanceof Error) throw context
    expect(context.signal).toBe(controller.signal)
    expect(state.acquired).toBe(1)
    expect(state.lastSignal).toBe(controller.signal)
  })

  it('counts release and shutdown calls', async () => {
    const { executor, state } = makeFakeExecutor()
    const context = await executor.acquire(new AbortController().signal)
    if (context instanceof Error) throw context
    await executor.release(context)
    await executor.shutdown()
    expect(state.released).toBe(1)
    expect(state.shutdowns).toBe(1)
  })

  it('returns the configured acquire error', async () => {
    const { executor, state } = makeFakeExecutor()
    state.acquireError = new Error('no browser')
    const context = await executor.acquire(new AbortController().signal)
    expect(context).toBeInstanceOf(Error)
  })
})

describe('stub executor', () => {
  it('acquires, releases, and shuts down without throwing', async () => {
    const executor = makeStubExecutor()
    const context = await executor.acquire(new AbortController().signal)
    if (context instanceof Error) throw context
    await executor.release(context)
    await executor.shutdown()
    expect(context).toBeDefined()
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm --filter browser-automation exec vitest run src/executor.test.ts`
Expected: FAIL — modules `./executor` / `./testing/fake-executor` not found.

- [ ] **Step 3: Write minimal implementation**

Create `packages/browser-automation/src/executor.ts`:

```ts
export type BrowserExecutor<Context> = {
  acquire(signal: AbortSignal): Promise<Error | Context>
  release(context: Context): Promise<void>
  shutdown(): Promise<void>
}

// SP2 placeholder. Subproject 3 replaces this at the index.ts construction site
// with the persistent headed Chromium host.
export function makeStubExecutor(): BrowserExecutor<unknown> {
  return {
    async acquire() {
      return {}
    },
    async release() {},
    async shutdown() {},
  }
}
```

Create `packages/browser-automation/src/testing/fake-executor.ts`:

```ts
import type { BrowserExecutor } from '../executor'

export type FakeContext = { id: string; signal: AbortSignal }

export type FakeExecutorState = {
  acquired: number
  released: number
  shutdowns: number
  lastSignal: AbortSignal | null
  acquireError: Error | null
}

export function makeFakeExecutor(): {
  executor: BrowserExecutor<FakeContext>
  state: FakeExecutorState
} {
  const state: FakeExecutorState = {
    acquired: 0,
    released: 0,
    shutdowns: 0,
    lastSignal: null,
    acquireError: null,
  }
  const executor: BrowserExecutor<FakeContext> = {
    async acquire(signal) {
      if (state.acquireError) return state.acquireError
      state.acquired += 1
      state.lastSignal = signal
      return { id: `ctx-${state.acquired}`, signal }
    },
    async release() {
      state.released += 1
    },
    async shutdown() {
      state.shutdowns += 1
    },
  }
  return { executor, state }
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm --filter browser-automation exec vitest run src/executor.test.ts`
Expected: PASS (4 tests).

- [ ] **Step 5: Commit**

```bash
rtk git add packages/browser-automation/src/executor.ts packages/browser-automation/src/testing/fake-executor.ts packages/browser-automation/src/executor.test.ts
rtk git commit -m "feat(browser-automation): add executor seam with stub and fake"
```

---

### Task 5: Single-task dispatch

**Files:**
- Create: `packages/browser-automation/src/dispatch.ts`
- Test: `packages/browser-automation/src/dispatch.test.ts`

**Interfaces:**
- Consumes: `WidgetBrowserRegistry<Context>` from `./tasks/registry`; `BrowserExecutor<Context>` from `./executor`; error classes from `./errors`.
- Produces:
  - `type DispatchArgs<Context> = { registry: WidgetBrowserRegistry<Context>; executor: BrowserExecutor<Context>; widgetId: string; taskId: string; payload: unknown; signal: AbortSignal }`.
  - `function dispatchBrowserTask<Context>(args: DispatchArgs<Context>): Promise<Error | unknown>` — returns the validated result, or a `BrowserTaskError` subclass. Always calls `executor.release` after a successful `acquire`. Propagates a handler-returned `BrowserTaskError` unchanged; wraps any other thrown/returned error as `BrowserTaskHandlerError`.

- [ ] **Step 1: Write the failing test**

Create `packages/browser-automation/src/dispatch.test.ts`:

```ts
import { defineWidgetBrowser, toRuntimeWidgetBrowserDefinition } from '@shared/widgets/browser-contracts'
import { describe, expect, it } from 'vitest'
import { z } from 'zod'

import { dispatchBrowserTask } from './dispatch'
import {
  BrowserExecutorError,
  BrowserTaskError,
  BrowserTaskHandlerError,
  InvalidBrowserPayloadError,
  InvalidBrowserResultError,
  UnknownBrowserTaskError,
} from './errors'
import { makeWidgetBrowserRegistry, type WidgetBrowserRegistry } from './tasks/registry'
import { makeFakeExecutor, type FakeContext } from './testing/fake-executor'

class SessionRequiredError extends BrowserTaskError {
  code = 'session_required'
  publicMessage = 'Session required'
}

type Handler = (payload: { value: string }) => unknown

function registryWith(handler: Handler): WidgetBrowserRegistry<FakeContext> {
  const definition = defineWidgetBrowser<FakeContext>()({
    schemas: {
      check: { payload: z.object({ value: z.string() }), result: z.object({ echoed: z.string() }) },
    },
    handlers: { check: (payload) => handler(payload) as { echoed: string } },
  })
  const registry = makeWidgetBrowserRegistry([
    toRuntimeWidgetBrowserDefinition({ widgetId: 'demo', definition }),
  ])
  if (registry instanceof Error) throw registry
  return registry
}

const base = { widgetId: 'demo', taskId: 'check', signal: new AbortController().signal }

describe('dispatchBrowserTask', () => {
  it('returns UnknownBrowserTaskError for a missing task', async () => {
    const { executor } = makeFakeExecutor()
    const result = await dispatchBrowserTask({
      registry: registryWith((p) => ({ echoed: p.value })),
      executor,
      widgetId: 'demo',
      taskId: 'nope',
      payload: {},
      signal: base.signal,
    })
    expect(result).toBeInstanceOf(UnknownBrowserTaskError)
  })

  it('returns InvalidBrowserPayloadError for a bad payload', async () => {
    const { executor } = makeFakeExecutor()
    const result = await dispatchBrowserTask({
      ...base,
      registry: registryWith((p) => ({ echoed: p.value })),
      executor,
      payload: { value: 123 },
    })
    expect(result).toBeInstanceOf(InvalidBrowserPayloadError)
  })

  it('validates the handler result', async () => {
    const { executor } = makeFakeExecutor()
    const result = await dispatchBrowserTask({
      ...base,
      registry: registryWith(() => ({ wrong: true })),
      executor,
      payload: { value: 'x' },
    })
    expect(result).toBeInstanceOf(InvalidBrowserResultError)
  })

  it('propagates a handler-returned public browser error', async () => {
    const { executor } = makeFakeExecutor()
    const result = await dispatchBrowserTask({
      ...base,
      registry: registryWith(() => new SessionRequiredError()),
      executor,
      payload: { value: 'x' },
    })
    expect(result).toBeInstanceOf(SessionRequiredError)
  })

  it('wraps a thrown handler error as internal', async () => {
    const { executor } = makeFakeExecutor()
    const result = await dispatchBrowserTask({
      ...base,
      registry: registryWith(() => {
        throw new Error('boom')
      }),
      executor,
      payload: { value: 'x' },
    })
    expect(result).toBeInstanceOf(BrowserTaskHandlerError)
  })

  it('returns BrowserExecutorError when acquire fails', async () => {
    const { executor, state } = makeFakeExecutor()
    state.acquireError = new Error('no browser')
    const result = await dispatchBrowserTask({
      ...base,
      registry: registryWith((p) => ({ echoed: p.value })),
      executor,
      payload: { value: 'x' },
    })
    expect(result).toBeInstanceOf(BrowserExecutorError)
  })

  it('returns the validated result, passes the signal, and releases the context', async () => {
    const { executor, state } = makeFakeExecutor()
    const controller = new AbortController()
    const result = await dispatchBrowserTask({
      registry: registryWith((p) => ({ echoed: p.value })),
      executor,
      widgetId: 'demo',
      taskId: 'check',
      payload: { value: 'hi' },
      signal: controller.signal,
    })
    expect(result).toEqual({ echoed: 'hi' })
    expect(state.lastSignal).toBe(controller.signal)
    expect(state.released).toBe(1)
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm --filter browser-automation exec vitest run src/dispatch.test.ts`
Expected: FAIL — module `./dispatch` not found.

- [ ] **Step 3: Write minimal implementation**

Create `packages/browser-automation/src/dispatch.ts`:

```ts
import type { BrowserExecutor } from './executor'
import {
  BrowserExecutorError,
  BrowserTaskError,
  BrowserTaskHandlerError,
  InvalidBrowserPayloadError,
  InvalidBrowserResultError,
  UnknownBrowserTaskError,
} from './errors'
import type { WidgetBrowserRegistry } from './tasks/registry'

export type DispatchArgs<Context> = {
  registry: WidgetBrowserRegistry<Context>
  executor: BrowserExecutor<Context>
  widgetId: string
  taskId: string
  payload: unknown
  signal: AbortSignal
}

export async function dispatchBrowserTask<Context>(args: DispatchArgs<Context>) {
  const task = args.registry.get(args.widgetId)?.get(args.taskId)
  if (!task) return new UnknownBrowserTaskError({ widgetId: args.widgetId, taskId: args.taskId })

  const payload = task.payloadSchema.safeParse(args.payload)
  if (!payload.success) {
    return new InvalidBrowserPayloadError({
      widgetId: args.widgetId,
      taskId: args.taskId,
      cause: payload.error,
    })
  }

  const context = await args.executor
    .acquire(args.signal)
    .catch((cause) => new BrowserExecutorError({ widgetId: args.widgetId, taskId: args.taskId, cause }))
  if (context instanceof Error) return context

  const handlerResult = await Promise.resolve(task.handler(payload.data, context)).catch(
    (cause) => new BrowserTaskHandlerError({ widgetId: args.widgetId, taskId: args.taskId, cause }),
  )

  const released = await args.executor
    .release(context)
    .catch((cause) => new Error('release failed', { cause }))
  if (released instanceof Error) console.warn('[browser-automation] context release failed')

  if (handlerResult instanceof BrowserTaskError) return handlerResult
  if (handlerResult instanceof Error) {
    return new BrowserTaskHandlerError({
      widgetId: args.widgetId,
      taskId: args.taskId,
      cause: handlerResult,
    })
  }

  const result = task.resultSchema.safeParse(handlerResult)
  if (!result.success) {
    return new InvalidBrowserResultError({
      widgetId: args.widgetId,
      taskId: args.taskId,
      cause: result.error,
    })
  }
  return result.data
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm --filter browser-automation exec vitest run src/dispatch.test.ts`
Expected: PASS (7 tests).

- [ ] **Step 5: Commit**

```bash
rtk git add packages/browser-automation/src/dispatch.ts packages/browser-automation/src/dispatch.test.ts
rtk git commit -m "feat(browser-automation): add single-task dispatch"
```

---

### Task 6: Single-lane FIFO queue

**Files:**
- Create: `packages/browser-automation/src/queue.ts`
- Test: `packages/browser-automation/src/queue.test.ts`

**Interfaces:**
- Consumes: `errore` (`AbortError`); `AutomationTimeoutError` from `./errors`.
- Produces:
  - `class ExecutionAbortError extends errore.AbortError` (internal; used as the abort reason).
  - `type QueueConfig = { queueWaitMs: number; executionMs: number }`.
  - `type SingleLaneQueue = { enqueue<T>(run: (signal: AbortSignal) => Promise<T>): Promise<T | Error>; close(makeError: () => Error): void; whenSettled(): Promise<void> }`.
  - `function makeSingleLaneQueue(config: QueueConfig): SingleLaneQueue`.
- Behavior: concurrency is exactly one; a job's `run` receives an `AbortSignal`; the queue-wait deadline settles as `AutomationTimeoutError{ phase: 'queue' }`; the execution deadline aborts the signal (reason `ExecutionAbortError`) and settles as `AutomationTimeoutError{ phase: 'execution' }`; the lane always waits for `run` to settle before the next job; after `close`, not-yet-started jobs and new `enqueue` calls settle with `makeError()`.

- [ ] **Step 1: Write the failing test**

Create `packages/browser-automation/src/queue.test.ts`:

```ts
import * as errore from 'errore'
import { describe, expect, it } from 'vitest'

import { AutomationTimeoutError } from './errors'
import { makeSingleLaneQueue } from './queue'

function deferred<T>() {
  let resolve!: (value: T) => void
  const promise = new Promise<T>((r) => {
    resolve = r
  })
  return { promise, resolve }
}

describe('makeSingleLaneQueue', () => {
  it('runs jobs one at a time in FIFO order', async () => {
    const queue = makeSingleLaneQueue({ queueWaitMs: 1000, executionMs: 1000 })
    const order: string[] = []
    const first = deferred<void>()

    const p1 = queue.enqueue(async () => {
      order.push('start-1')
      await first.promise
      order.push('end-1')
      return 1
    })
    const p2 = queue.enqueue(async () => {
      order.push('start-2')
      return 2
    })

    await Promise.resolve()
    expect(order).toEqual(['start-1']) // second has not started while first runs
    first.resolve()
    expect(await p1).toBe(1)
    expect(await p2).toBe(2)
    expect(order).toEqual(['start-1', 'end-1', 'start-2'])
  })

  it('times out a job that waits too long in the queue', async () => {
    const queue = makeSingleLaneQueue({ queueWaitMs: 20, executionMs: 1000 })
    const blocker = deferred<void>()
    const p1 = queue.enqueue(async () => {
      await blocker.promise
      return 1
    })
    const p2 = queue.enqueue(async () => 2)

    const r2 = await p2
    expect(r2).toBeInstanceOf(AutomationTimeoutError)
    expect((r2 as AutomationTimeoutError).phase).toBe('queue')
    blocker.resolve()
    await p1
  })

  it('times out and aborts a running job, then frees the lane', async () => {
    const queue = makeSingleLaneQueue({ queueWaitMs: 1000, executionMs: 20 })
    let aborted = false
    const order: string[] = []

    const p1 = queue.enqueue(
      (signal) =>
        new Promise((resolve) => {
          order.push('start-1')
          signal.addEventListener('abort', () => {
            aborted = true
            order.push('abort-1')
            resolve('cleaned-up')
          })
        }),
    )
    const p2 = queue.enqueue(async () => {
      order.push('start-2')
      return 2
    })

    const r1 = await p1
    expect(r1).toBeInstanceOf(AutomationTimeoutError)
    expect((r1 as AutomationTimeoutError).phase).toBe('execution')
    expect(aborted).toBe(true)
    expect(await p2).toBe(2)
    expect(order).toEqual(['start-1', 'abort-1', 'start-2']) // next starts only after teardown
  })

  it('rejects queued and new jobs after close', async () => {
    const queue = makeSingleLaneQueue({ queueWaitMs: 1000, executionMs: 1000 })
    const blocker = deferred<void>()
    const p1 = queue.enqueue(async () => {
      await blocker.promise
      return 1
    })
    const p2 = queue.enqueue(async () => 2)

    queue.close(() => new Error('unavailable'))
    const p3 = queue.enqueue(async () => 3)

    expect(await p3).toBeInstanceOf(Error) // new enqueue after close
    blocker.resolve()
    await p1
    expect(await p2).toBeInstanceOf(Error) // queued-but-not-started rejected
    await queue.whenSettled()
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm --filter browser-automation exec vitest run src/queue.test.ts`
Expected: FAIL — module `./queue` not found.

- [ ] **Step 3: Write minimal implementation**

Create `packages/browser-automation/src/queue.ts`:

```ts
import * as errore from 'errore'

import { AutomationTimeoutError } from './errors'

export class ExecutionAbortError extends errore.createTaggedError({
  name: 'ExecutionAbortError',
  message: 'Browser task aborted after execution deadline',
  extends: errore.AbortError,
}) {}

export type QueueConfig = { queueWaitMs: number; executionMs: number }

export type SingleLaneQueue = {
  enqueue<T>(run: (signal: AbortSignal) => Promise<T>): Promise<T | Error>
  close(makeError: () => Error): void
  whenSettled(): Promise<void>
}

export function makeSingleLaneQueue(config: QueueConfig): SingleLaneQueue {
  let tail: Promise<void> = Promise.resolve()
  let closed = false
  let makeCloseError: (() => Error) | null = null

  function enqueue<T>(run: (signal: AbortSignal) => Promise<T>): Promise<T | Error> {
    if (closed && makeCloseError) return Promise.resolve(makeCloseError())
    return new Promise<T | Error>((resolve) => {
      let settled = false
      const settle = (value: T | Error) => {
        if (settled) return
        settled = true
        resolve(value)
      }
      const waitTimer = setTimeout(
        () => settle(new AutomationTimeoutError({ phase: 'queue' })),
        config.queueWaitMs,
      )

      tail = tail
        .then(async () => {
          clearTimeout(waitTimer)
          if (settled) return
          if (closed && makeCloseError) {
            settle(makeCloseError())
            return
          }
          const controller = new AbortController()
          const execTimer = setTimeout(() => {
            controller.abort(new ExecutionAbortError())
            settle(new AutomationTimeoutError({ phase: 'execution' }))
          }, config.executionMs)
          const outcome = await run(controller.signal)
          clearTimeout(execTimer)
          settle(outcome)
        })
        .catch(() => {})
    })
  }

  function close(makeError: () => Error) {
    closed = true
    makeCloseError = makeError
  }

  function whenSettled() {
    return tail.catch(() => {})
  }

  return { enqueue, close, whenSettled }
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm --filter browser-automation exec vitest run src/queue.test.ts`
Expected: PASS (4 tests).

- [ ] **Step 5: Commit**

```bash
rtk git add packages/browser-automation/src/queue.ts packages/browser-automation/src/queue.test.ts
rtk git commit -m "feat(browser-automation): add single-lane FIFO queue with deadlines"
```

---

### Task 7: Service core

**Files:**
- Create: `packages/browser-automation/src/service.ts`
- Test: `packages/browser-automation/src/service.test.ts`

**Interfaces:**
- Consumes: `WidgetBrowserRegistry<Context>`, `BrowserExecutor<Context>`, `dispatchBrowserTask`, `makeSingleLaneQueue`, `BrowserServiceUnavailableError`, `BrowserTaskError`.
- Produces:
  - `type ServiceState = 'starting' | 'ready' | 'draining'`.
  - `type BrowserService = { invoke(args: { widgetId: string; taskId: string; payload: unknown }): Promise<Error | unknown>; health(): { status: ServiceState; healthy: boolean }; markReady(): void; shutdown(): Promise<void> }`.
  - `type BrowserServiceDeps<Context> = { registry: WidgetBrowserRegistry<Context>; executor: BrowserExecutor<Context>; config: { queueWaitMs: number; executionMs: number }; logger?: { warn(message: string, fields: Record<string, unknown>): void } }`.
  - `function makeBrowserService<Context>(deps: BrowserServiceDeps<Context>): BrowserService`.
- Behavior: `invoke` returns `BrowserServiceUnavailableError` unless state is `ready`; logs (redacted `{ widgetId, taskId, code }`) only for `internal`-code outcomes; `shutdown` is idempotent, closes the queue, drains, then calls `executor.shutdown` once.

- [ ] **Step 1: Write the failing test**

Create `packages/browser-automation/src/service.test.ts`:

```ts
import { defineWidgetBrowser, toRuntimeWidgetBrowserDefinition } from '@shared/widgets/browser-contracts'
import { describe, expect, it, vi } from 'vitest'
import { z } from 'zod'

import { BrowserServiceUnavailableError, BrowserTaskError, UnknownBrowserTaskError } from './errors'
import { makeBrowserService } from './service'
import { makeWidgetBrowserRegistry, type WidgetBrowserRegistry } from './tasks/registry'
import { makeFakeExecutor, type FakeContext } from './testing/fake-executor'

class SessionRequiredError extends BrowserTaskError {
  code = 'session_required'
  publicMessage = 'Session required'
}

function registryWith(handler: (payload: { value: string }) => unknown): WidgetBrowserRegistry<FakeContext> {
  const definition = defineWidgetBrowser<FakeContext>()({
    schemas: {
      check: { payload: z.object({ value: z.string() }), result: z.object({ echoed: z.string() }) },
    },
    handlers: { check: (payload) => handler(payload) as { echoed: string } },
  })
  const registry = makeWidgetBrowserRegistry([
    toRuntimeWidgetBrowserDefinition({ widgetId: 'demo', definition }),
  ])
  if (registry instanceof Error) throw registry
  return registry
}

const config = { queueWaitMs: 1000, executionMs: 1000 }

describe('makeBrowserService', () => {
  it('rejects invocations before markReady', async () => {
    const { executor } = makeFakeExecutor()
    const service = makeBrowserService({ registry: registryWith((p) => ({ echoed: p.value })), executor, config })
    const result = await service.invoke({ widgetId: 'demo', taskId: 'check', payload: { value: 'x' } })
    expect(result).toBeInstanceOf(BrowserServiceUnavailableError)
  })

  it('runs a task after markReady', async () => {
    const { executor } = makeFakeExecutor()
    const service = makeBrowserService({ registry: registryWith((p) => ({ echoed: p.value })), executor, config })
    service.markReady()
    const result = await service.invoke({ widgetId: 'demo', taskId: 'check', payload: { value: 'hi' } })
    expect(result).toEqual({ echoed: 'hi' })
  })

  it('returns a public error for an unknown task', async () => {
    const { executor } = makeFakeExecutor()
    const service = makeBrowserService({ registry: registryWith((p) => ({ echoed: p.value })), executor, config })
    service.markReady()
    const result = await service.invoke({ widgetId: 'demo', taskId: 'nope', payload: {} })
    expect(result).toBeInstanceOf(UnknownBrowserTaskError)
  })

  it('reports liveness transitions', async () => {
    const { executor } = makeFakeExecutor()
    const service = makeBrowserService({ registry: registryWith((p) => ({ echoed: p.value })), executor, config })
    expect(service.health()).toEqual({ status: 'starting', healthy: false })
    service.markReady()
    expect(service.health()).toEqual({ status: 'ready', healthy: true })
    await service.shutdown()
    expect(service.health()).toEqual({ status: 'draining', healthy: false })
  })

  it('keeps health ready when a task reports session-required', async () => {
    const { executor } = makeFakeExecutor()
    const service = makeBrowserService({
      registry: registryWith(() => new SessionRequiredError()),
      executor,
      config,
    })
    service.markReady()
    const result = await service.invoke({ widgetId: 'demo', taskId: 'check', payload: { value: 'x' } })
    expect(result).toBeInstanceOf(SessionRequiredError)
    expect(service.health()).toEqual({ status: 'ready', healthy: true })
  })

  it('shuts the executor down exactly once and is idempotent', async () => {
    const { executor, state } = makeFakeExecutor()
    const service = makeBrowserService({ registry: registryWith((p) => ({ echoed: p.value })), executor, config })
    service.markReady()
    await service.shutdown()
    await service.shutdown()
    expect(state.shutdowns).toBe(1)
  })

  it('logs only redacted fields for internal failures', async () => {
    const { executor } = makeFakeExecutor()
    const warn = vi.fn()
    const service = makeBrowserService({
      registry: registryWith(() => {
        throw new Error('series=AB number=123456')
      }),
      executor,
      config,
      logger: { warn },
    })
    service.markReady()
    await service.invoke({ widgetId: 'demo', taskId: 'check', payload: { value: 'x' } })
    expect(warn).toHaveBeenCalledWith('[browser-automation] task failed', {
      widgetId: 'demo',
      taskId: 'check',
      code: 'internal',
    })
    expect(JSON.stringify(warn.mock.calls)).not.toContain('123456')
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm --filter browser-automation exec vitest run src/service.test.ts`
Expected: FAIL — module `./service` not found.

- [ ] **Step 3: Write minimal implementation**

Create `packages/browser-automation/src/service.ts`:

```ts
import { dispatchBrowserTask } from './dispatch'
import { BrowserServiceUnavailableError, BrowserTaskError } from './errors'
import type { BrowserExecutor } from './executor'
import { makeSingleLaneQueue } from './queue'
import type { WidgetBrowserRegistry } from './tasks/registry'

export type ServiceState = 'starting' | 'ready' | 'draining'

export type BrowserService = {
  invoke(args: { widgetId: string; taskId: string; payload: unknown }): Promise<Error | unknown>
  health(): { status: ServiceState; healthy: boolean }
  markReady(): void
  shutdown(): Promise<void>
}

export type BrowserServiceDeps<Context> = {
  registry: WidgetBrowserRegistry<Context>
  executor: BrowserExecutor<Context>
  config: { queueWaitMs: number; executionMs: number }
  logger?: { warn(message: string, fields: Record<string, unknown>): void }
}

export function makeBrowserService<Context>(deps: BrowserServiceDeps<Context>): BrowserService {
  const logger = deps.logger ?? {
    warn: (message: string, fields: Record<string, unknown>) => console.warn(message, fields),
  }
  const queue = makeSingleLaneQueue(deps.config)
  let state: ServiceState = 'starting'

  async function invoke(args: { widgetId: string; taskId: string; payload: unknown }) {
    if (state !== 'ready') return new BrowserServiceUnavailableError({ state })

    const outcome = await queue.enqueue((signal) =>
      dispatchBrowserTask({
        registry: deps.registry,
        executor: deps.executor,
        widgetId: args.widgetId,
        taskId: args.taskId,
        payload: args.payload,
        signal,
      }),
    )

    if (outcome instanceof BrowserTaskError && outcome.code === 'internal') {
      logger.warn('[browser-automation] task failed', {
        widgetId: args.widgetId,
        taskId: args.taskId,
        code: outcome.code,
      })
    }
    return outcome
  }

  function health() {
    return { status: state, healthy: state === 'ready' }
  }

  function markReady() {
    if (state === 'starting') state = 'ready'
  }

  async function shutdown() {
    if (state === 'draining') return
    state = 'draining'
    queue.close(() => new BrowserServiceUnavailableError({ state: 'draining' }))
    await queue.whenSettled()
    await deps.executor.shutdown()
  }

  return { invoke, health, markReady, shutdown }
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm --filter browser-automation exec vitest run src/service.test.ts`
Expected: PASS (7 tests).

- [ ] **Step 5: Commit**

```bash
rtk git add packages/browser-automation/src/service.ts packages/browser-automation/src/service.test.ts
rtk git commit -m "feat(browser-automation): add service core with lifecycle and redacted logging"
```

---

### Task 8: HTTP layer

**Files:**
- Create: `packages/browser-automation/src/http/body.ts`
- Create: `packages/browser-automation/src/http/app.ts`
- Test: `packages/browser-automation/src/http/app.test.ts`
- Modify: `packages/browser-automation/package.json` (add `find-my-way` dependency)

**Interfaces:**
- Consumes: `BrowserService` from `../service`; `TaskRequestSchema` from `../schemas`; `BrowserServiceUnavailableError`, `toEnvelopeError` from `../errors`; `find-my-way`; `node:http`.
- Produces:
  - `readJsonBody(req: IncomingMessage): Promise<unknown>` (1 MB cap; `undefined` on empty body).
  - `type BrowserHttpApp = { server: Server; close(): Promise<void> }`.
  - `function makeBrowserHttpApp(service: BrowserService): BrowserHttpApp`.
- Routes: `GET /health` → 200/503 `{ status }`; `POST /tasks/:widgetId/:taskId` → 200 envelope, 503 on unavailable, 400 on unreadable body.

- [ ] **Step 1: Add the routing dependency**

In `packages/browser-automation/package.json`, add to `dependencies` (keep alphabetical): `"find-my-way": "^9.6.0"`. Then run:

Run: `pnpm install`
Expected: lockfile updates; `find-my-way` linked into the package.

- [ ] **Step 2: Write the failing test**

Create `packages/browser-automation/src/http/app.test.ts`:

```ts
import type { AddressInfo } from 'node:net'

import { defineWidgetBrowser, toRuntimeWidgetBrowserDefinition } from '@shared/widgets/browser-contracts'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { z } from 'zod'

import { makeBrowserService, type BrowserService } from '../service'
import { makeWidgetBrowserRegistry } from '../tasks/registry'
import { makeFakeExecutor, type FakeContext } from '../testing/fake-executor'
import { makeBrowserHttpApp, type BrowserHttpApp } from './app'

function buildService(): BrowserService {
  const { executor } = makeFakeExecutor()
  const definition = defineWidgetBrowser<FakeContext>()({
    schemas: {
      check: { payload: z.object({ value: z.string() }), result: z.object({ echoed: z.string() }) },
    },
    handlers: { check: (payload) => ({ echoed: payload.value }) },
  })
  const registry = makeWidgetBrowserRegistry([
    toRuntimeWidgetBrowserDefinition({ widgetId: 'demo', definition }),
  ])
  if (registry instanceof Error) throw registry
  return makeBrowserService({ registry, executor, config: { queueWaitMs: 1000, executionMs: 1000 } })
}

describe('makeBrowserHttpApp', () => {
  let app: BrowserHttpApp
  let base: string
  let service: BrowserService

  beforeEach(async () => {
    service = buildService()
    app = makeBrowserHttpApp(service)
    await new Promise<void>((resolve) => app.server.listen(0, resolve))
    base = `http://localhost:${(app.server.address() as AddressInfo).port}`
  })

  afterEach(async () => {
    await app.close()
  })

  it('reports 503 health while starting and 200 once ready', async () => {
    const starting = await fetch(`${base}/health`)
    expect(starting.status).toBe(503)
    expect(await starting.json()).toEqual({ status: 'starting' })
    service.markReady()
    const ready = await fetch(`${base}/health`)
    expect(ready.status).toBe(200)
    expect(await ready.json()).toEqual({ status: 'ready' })
  })

  it('returns a success envelope', async () => {
    service.markReady()
    const res = await fetch(`${base}/tasks/demo/check`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ payload: { value: 'hi' } }),
    })
    expect(res.status).toBe(200)
    expect(await res.json()).toEqual({ ok: true, result: { echoed: 'hi' } })
  })

  it('returns an error envelope for an unknown task', async () => {
    service.markReady()
    const res = await fetch(`${base}/tasks/demo/nope`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ payload: {} }),
    })
    expect(res.status).toBe(200)
    expect(await res.json()).toEqual({ ok: false, error: { code: 'unknown_task', message: 'Unknown browser task' } })
  })

  it('returns a payload_invalid envelope for a bad payload', async () => {
    service.markReady()
    const res = await fetch(`${base}/tasks/demo/check`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ payload: { value: 123 } }),
    })
    const body = await res.json()
    expect(res.status).toBe(200)
    expect(body.ok).toBe(false)
    expect(body.error.code).toBe('payload_invalid')
  })

  it('returns 503 when the service is not ready', async () => {
    const res = await fetch(`${base}/tasks/demo/check`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ payload: { value: 'hi' } }),
    })
    expect(res.status).toBe(503)
  })

  it('returns 400 for an unreadable body', async () => {
    service.markReady()
    const res = await fetch(`${base}/tasks/demo/check`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: 'not-json',
    })
    expect(res.status).toBe(400)
  })
})
```

- [ ] **Step 3: Run test to verify it fails**

Run: `pnpm --filter browser-automation exec vitest run src/http/app.test.ts`
Expected: FAIL — module `./app` not found.

- [ ] **Step 4: Write minimal implementation**

Create `packages/browser-automation/src/http/body.ts`:

```ts
import type { IncomingMessage } from 'node:http'

const MAX_BODY_BYTES = 1_048_576 // 1 MB

export async function readJsonBody(req: IncomingMessage): Promise<unknown> {
  const chunks: Buffer[] = []
  let total = 0
  for await (const chunk of req) {
    const buf = chunk as Buffer
    total += buf.byteLength
    if (total > MAX_BODY_BYTES) throw new Error('request body too large')
    chunks.push(buf)
  }
  if (chunks.length === 0) return undefined
  return JSON.parse(Buffer.concat(chunks).toString('utf8'))
}
```

Create `packages/browser-automation/src/http/app.ts`:

```ts
import { createServer, type Server, type ServerResponse } from 'node:http'

import Router from 'find-my-way'

import { BrowserServiceUnavailableError, toEnvelopeError } from '../errors'
import { TaskRequestSchema } from '../schemas'
import type { BrowserService } from '../service'
import { readJsonBody } from './body'

export type BrowserHttpApp = { server: Server; close: () => Promise<void> }

function sendJson(res: ServerResponse, status: number, body: unknown): void {
  res.writeHead(status, { 'content-type': 'application/json' })
  res.end(JSON.stringify(body))
}

export function makeBrowserHttpApp(service: BrowserService): BrowserHttpApp {
  const router = Router({ ignoreTrailingSlash: true })

  router.on('GET', '/health', (_req, res) => {
    const health = service.health()
    sendJson(res, health.healthy ? 200 : 503, { status: health.status })
  })

  router.on('POST', '/tasks/:widgetId/:taskId', async (req, res, params) => {
    let raw: unknown
    try {
      raw = await readJsonBody(req)
    } catch {
      res.writeHead(400)
      res.end()
      return
    }
    const parsed = TaskRequestSchema.safeParse(raw ?? {})
    const payload = parsed.success ? parsed.data.payload : undefined

    const outcome = await service.invoke({
      widgetId: decodeURIComponent(params.widgetId as string),
      taskId: decodeURIComponent(params.taskId as string),
      payload,
    })

    if (outcome instanceof BrowserServiceUnavailableError) {
      sendJson(res, 503, { status: 'draining' })
      return
    }
    if (outcome instanceof Error) {
      sendJson(res, 200, { ok: false, error: toEnvelopeError(outcome) })
      return
    }
    sendJson(res, 200, { ok: true, result: outcome })
  })

  const server = createServer((req, res) => {
    Promise.resolve(router.lookup(req, res)).catch(() => {
      if (!res.writableEnded) {
        res.writeHead(500)
        res.end()
      }
    })
  })

  const close = () => new Promise<void>((resolve) => server.close(() => resolve()))
  return { server, close }
}
```

- [ ] **Step 5: Run test to verify it passes**

Run: `pnpm --filter browser-automation exec vitest run src/http/app.test.ts`
Expected: PASS (6 tests).

- [ ] **Step 6: Commit**

```bash
rtk git add packages/browser-automation/src/http packages/browser-automation/package.json pnpm-lock.yaml
rtk git commit -m "feat(browser-automation): add http layer for tasks and health"
```

---

### Task 9: Process entrypoint and scripts

**Files:**
- Create: `packages/browser-automation/src/index.ts`
- Modify: `packages/browser-automation/package.json` (add `tsx` devDependency and `dev`/`start` scripts)

**Interfaces:**
- Consumes: `loadBrowserServiceConfig`, `makeWidgetBrowserRegistry`, `widgetBrowserList` (generated), `makeStubExecutor`, `makeBrowserService`, `makeBrowserHttpApp`.
- Produces: a runnable process that starts the HTTP server and calls `service.markReady()` after `listen`. The stub-executor line is the single site Subproject 3 replaces with the Playwright host.

- [ ] **Step 1: Add scripts and dev dependency**

In `packages/browser-automation/package.json`:
- add to `scripts`: `"dev": "tsx watch src/index.ts"` and `"start": "tsx src/index.ts"`;
- add to `devDependencies`: `"tsx": "^4.20.6"`.

Run: `pnpm install`
Expected: `tsx` linked into the package.

- [ ] **Step 2: Write the entrypoint**

Create `packages/browser-automation/src/index.ts`:

```ts
import { loadBrowserServiceConfig } from './config'
import { makeStubExecutor } from './executor'
import { makeBrowserHttpApp } from './http/app'
import { makeBrowserService } from './service'
import { makeWidgetBrowserRegistry } from './tasks/registry'
import { widgetBrowserList } from './tasks/widget-browser-list.generated'

const config = loadBrowserServiceConfig(process.env)
if (config instanceof Error) {
  console.error(config.message)
  process.exit(1)
}

const registry = makeWidgetBrowserRegistry(widgetBrowserList)
if (registry instanceof Error) {
  console.error(registry.message)
  process.exit(1)
}

// Subproject 3 replaces makeStubExecutor() with the persistent Chromium host.
const executor = makeStubExecutor()
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

- [ ] **Step 3: Verify the package typechecks**

Run: `pnpm --filter browser-automation typecheck`
Expected: PASS (no type errors).

- [ ] **Step 4: Smoke-test the running process**

Run (in one terminal): `pnpm --filter browser-automation start`
Then (in another): `curl -s http://127.0.0.1:8788/health`
Expected: `{"status":"ready"}` with HTTP 200. Stop the process afterward.

- [ ] **Step 5: Commit**

```bash
rtk git add packages/browser-automation/src/index.ts packages/browser-automation/package.json pnpm-lock.yaml
rtk git commit -m "feat(browser-automation): add process entrypoint and dev scripts"
```

---

### Task 10: Whole-package and workspace verification

**Files:** none (verification only).

- [ ] **Step 1: Run the whole package test suite**

Run: `pnpm --filter browser-automation test`
Expected: PASS — all suites (`errors`, `config`, `schemas`, `executor`, `dispatch`, `queue`, `service`, `http/app`) plus the existing SP1 `tasks/registry` and `tasks/contracts` suites are green.

- [ ] **Step 2: Run workspace codegen, typecheck, and tests**

Run: `pnpm typecheck`
Expected: PASS — workspace-wide `tsc --noEmit` including the new package.

Run: `pnpm test`
Expected: PASS — `codegen` runs, then all workspace Vitest suites pass; existing client/server behavior is unaffected.

- [ ] **Step 3: Lint and format**

Run: `pnpm lint`
Expected: PASS (oxlint clean).

Run: `pnpm format:check`
Expected: PASS, or run `pnpm format` and re-check, then include formatting in the commit below.

- [ ] **Step 4: Commit any formatting fixes**

```bash
rtk git add -A
rtk git commit -m "chore(browser-automation): formatting and verification pass"
```

(If nothing changed, skip this commit.)

---

## Self-Review

**1. Spec coverage** — every design section maps to a task:

- Package shape / module layout → Tasks 1–9 (files match the spec's `src/` tree).
- Wire protocol (task endpoint, health, 400 body rules) → Task 8; envelope schemas → Task 3.
- Executor seam (context-provider) → Task 4; dispatch owns lookup/validation → Task 5.
- FIFO queue, two deadlines, cancellation, one-task-at-a-time invariant → Task 6.
- Error taxonomy, `BrowserTaskError` base, `toEnvelopeError`, redaction → Task 1 (serialization) and Task 7 (redacted logging).
- Health + graceful shutdown, availability-vs-task separation → Tasks 7 and 8.
- Configuration (env, errors-as-values) → Task 2.
- Testing strategy (dispatch, queue, health, shutdown, redaction, http) → Tasks 1, 5, 6, 7, 8.
- Success criteria + verification gates → Task 10.
- Deferred work (Playwright, gateway, passport) → explicitly out of scope; `makeStubExecutor` marks the single SP3 swap site.

**2. Placeholder scan** — no `TBD`/`TODO`/"handle edge cases"; every code step contains complete source.

**3. Type consistency** — names are stable across tasks: `BrowserExecutor<Context>` (`acquire`/`release`/`shutdown`), `dispatchBrowserTask`, `makeSingleLaneQueue` (`enqueue`/`close`/`whenSettled`), `makeBrowserService` (`invoke`/`health`/`markReady`/`shutdown`), `makeBrowserHttpApp`, `toEnvelopeError`, `loadBrowserServiceConfig`, generated export `widgetBrowserList`, registry accessor `registry.get(widgetId)?.get(taskId)` with `payloadSchema`/`resultSchema`/`handler` (from SP1 `RuntimeWidgetBrowserTask`). Error codes (`unknown_task`, `payload_invalid`, `result_invalid`, `automation_timeout`, `internal`) are consistent between `errors.ts`, dispatch, service, and the HTTP tests.
