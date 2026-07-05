# Widget Server Browser Gateway Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a typed, widget-scoped, errors-as-values browser task gateway to `WidgetServerContext.api.browser` while keeping the main server healthy when browser automation is unavailable.

**Architecture:** Widget packages own neutral task descriptors containing literal task IDs and Zod payload/result schemas. The main server composes a descriptor-oriented scoped API over a low-level HTTP client, injects the current widget `typeId`, validates the shared response envelope and task result, and returns tagged gateway errors without retrying or leaking payloads.

**Tech Stack:** TypeScript, Zod 4, errore, Node `fetch`/`AbortController`, Vitest, find-my-way server dispatch, pnpm workspace, Docker Compose.

**Design:** [Widget Server Browser Gateway Design](../specs/2026-07-05-widget-server-browser-gateway-design.md)

---

## File Map

### Shared protocol and widget contracts

- Create `packages/shared/browser-automation/protocol.ts` — canonical HTTP request/response/health Zod schemas.
- Create `packages/shared/browser-automation/protocol.test.ts` — protocol acceptance and rejection tests.
- Modify `packages/browser-automation/src/schemas.ts` — re-export the canonical shared protocol.
- Delete `packages/browser-automation/src/schemas.test.ts` — move protocol tests to their owning package.
- Modify `packages/shared/widgets/browser-contracts.ts` — descriptor factory, descriptor types, and server browser API type.
- Create `packages/shared/widgets/browser-contracts.test.ts` — literal IDs, inferred types, and runtime descriptor shape.
- Create `packages/shared/widgets/browser-errors.ts` — public tagged gateway error union.
- Create `packages/shared/widgets/browser-errors.test.ts` — tagged fields, remote metadata, and abort inheritance.
- Modify `packages/shared/package.json` and `pnpm-lock.yaml` — declare shared's runtime `errore` dependency.
- Modify `packages/browser-automation/src/tasks/contracts.test.ts` — prove descriptor maps remain compatible with browser definitions.

### Main-server browser gateway

- Create `packages/server/src/browser/client.ts` — low-level browser automation client seam.
- Create `packages/server/src/browser/config.ts` — gateway URL/deadline parsing.
- Create `packages/server/src/browser/config.test.ts` — defaults and invalid configuration.
- Create `packages/server/src/browser/testing/fake-client.ts` — programmable call-recording fake.
- Create `packages/server/src/browser/testing/fake-client.test.ts` — fake behavior.
- Create `packages/server/src/browser/http-client.ts` — HTTP transport, deadline, envelope parsing, and error conversion.
- Create `packages/server/src/browser/http-client.test.ts` — transport behavior and redaction tests.
- Create `packages/server/src/browser/widget-api.ts` — widget scoping and result validation.
- Create `packages/server/src/browser/widget-api.test.ts` — scoped task invocation tests.

### Widget context composition and application wiring

- Modify `packages/server/src/widgets/storage.ts` and `storage.test.ts` — rename the storage-only factory to match its responsibility.
- Create `packages/server/src/widgets/api.ts` and `api.test.ts` — compose storage and browser capabilities.
- Modify `packages/shared/widgets/contracts.ts` — require `api.browser` in `WidgetServerContext`.
- Modify `packages/server/src/widgets/dispatch.ts` and `dispatch.test.ts` — inject the low-level client and prove all gateway errors reach handlers.
- Modify `packages/server/src/app.ts` and `app.test.ts` — carry the client through `AppDeps` and normal widget HTTP RPC.
- Modify `packages/server/src/index.ts` and `test-server.ts` — construct the production HTTP client lazily from config.

### Deployment and documentation

- Modify `scripts/infra.test.ts` — assert gateway configuration and the absence of a browser startup dependency.
- Modify `docker-compose.yml` and `docker-compose.dev.yml` — pass the internal URL and gateway deadline.
- Modify `packages/browser-automation/README.md` — document server gateway settings and availability semantics.

---

### Task 1: Extract the Shared Browser Automation Protocol

**Files:**

- Create: `packages/shared/browser-automation/protocol.ts`
- Create: `packages/shared/browser-automation/protocol.test.ts`
- Modify: `packages/browser-automation/src/schemas.ts`
- Delete: `packages/browser-automation/src/schemas.test.ts`

- [ ] **Step 1: Write the shared protocol test**

Create `packages/shared/browser-automation/protocol.test.ts`:

```ts
import { describe, expect, it } from 'vitest'

import { HealthResponseSchema, TaskRequestSchema, TaskResponseSchema } from './protocol'

describe('browser automation protocol', () => {
  it('accepts requests with and without payloads', () => {
    expect(TaskRequestSchema.safeParse({ payload: { value: 1 } }).success).toBe(true)
    expect(TaskRequestSchema.safeParse({}).success).toBe(true)
  })

  it('accepts success and public error envelopes', () => {
    expect(TaskResponseSchema.safeParse({ ok: true, result: { value: 1 } }).success).toBe(true)
    expect(
      TaskResponseSchema.safeParse({
        ok: false,
        error: {
          code: 'automation_timeout',
          message: 'The browser task timed out',
          meta: { phase: 'queue' },
        },
      }).success,
    ).toBe(true)
  })

  it('rejects mixed and incomplete envelopes', () => {
    expect(
      TaskResponseSchema.safeParse({ ok: true, error: { code: 'x', message: 'y' } }).success,
    ).toBe(false)
    expect(TaskResponseSchema.safeParse({ ok: false, error: { code: 'x' } }).success).toBe(false)
  })

  it('accepts only known health states', () => {
    expect(HealthResponseSchema.safeParse({ status: 'ready' }).success).toBe(true)
    expect(HealthResponseSchema.safeParse({ status: 'unknown' }).success).toBe(false)
  })
})
```

- [ ] **Step 2: Run the test and verify that the shared module is missing**

Run from the repository root:

```bash
pnpm --filter shared exec vitest run browser-automation/protocol.test.ts
```

Expected: FAIL because `./protocol` does not exist.

- [ ] **Step 3: Create the canonical shared protocol**

Create `packages/shared/browser-automation/protocol.ts`:

```ts
import { z } from 'zod'

export const TaskRequestSchema = z.object({ payload: z.unknown().optional() })
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

Replace `packages/browser-automation/src/schemas.ts` with compatibility exports:

```ts
export {
  HealthResponseSchema,
  TaskErrorSchema,
  TaskRequestSchema,
  TaskResponseSchema,
  TaskSuccessSchema,
  type HealthResponse,
  type TaskRequest,
  type TaskResponse,
} from '@shared/browser-automation/protocol'
```

Delete `packages/browser-automation/src/schemas.test.ts`; its cases now live with the canonical schema.

- [ ] **Step 4: Run the owning and consuming package tests**

```bash
pnpm --filter shared exec vitest run browser-automation/protocol.test.ts
pnpm --filter browser-automation exec vitest run src/http/app.test.ts
```

Expected: both tests PASS.

- [ ] **Step 5: Commit the protocol extraction**

```bash
git add packages/shared/browser-automation packages/browser-automation/src/schemas.ts packages/browser-automation/src/schemas.test.ts
git commit -m "refactor(browser-automation): share wire protocol"
```

### Task 2: Add Widget-Owned Task Descriptors and Gateway Errors

**Files:**

- Modify: `packages/shared/widgets/browser-contracts.ts`
- Create: `packages/shared/widgets/browser-contracts.test.ts`
- Create: `packages/shared/widgets/browser-errors.ts`
- Create: `packages/shared/widgets/browser-errors.test.ts`
- Modify: `packages/shared/package.json`
- Modify: `pnpm-lock.yaml`
- Modify: `packages/browser-automation/src/tasks/contracts.test.ts`

- [ ] **Step 1: Write failing descriptor and error tests**

Create `packages/shared/widgets/browser-contracts.test.ts`:

```ts
import { describe, expect, expectTypeOf, it } from 'vitest'
import { z } from 'zod'

import { defineWidgetBrowserTasks, type WidgetServerBrowserApi } from './browser-contracts'
import type { BrowserGatewayError } from './browser-errors'

const tasks = defineWidgetBrowserTasks({
  check: {
    payload: z.object({ value: z.string().transform(Number) }),
    result: z.object({ echoed: z.number().transform(String) }),
  },
})

describe('defineWidgetBrowserTasks', () => {
  it('adds the literal object key as the task ID', () => {
    expect(tasks.check.id).toBe('check')
    expectTypeOf(tasks.check.id).toEqualTypeOf<'check'>()
  })

  it('preserves input and output inference for server invocation', () => {
    const api = null as unknown as WidgetServerBrowserApi
    const result = api.invoke(tasks.check, { value: '7' })
    expectTypeOf(result).toEqualTypeOf<Promise<BrowserGatewayError | { echoed: string }>>()

    if (false) {
      // @ts-expect-error transformed payload input requires a string
      void api.invoke(tasks.check, { value: 7 })
    }
  })
})
```

Create `packages/shared/widgets/browser-errors.test.ts`:

```ts
import * as errore from 'errore'
import { describe, expect, it } from 'vitest'

import {
  BrowserAutomationDeadlineError,
  BrowserAutomationProtocolError,
  BrowserAutomationUnavailableError,
  BrowserTaskRejectedError,
} from './browser-errors'

describe('browser gateway errors', () => {
  it('uses a detectable typed abort reason for gateway deadlines', () => {
    const error = new BrowserAutomationDeadlineError({ timeoutMs: 100_000 })
    expect(error).toBeInstanceOf(errore.AbortError)
    expect(errore.isAbortError(error)).toBe(true)
    expect(error.timeoutMs).toBe(100_000)
  })

  it('keeps transport and protocol context free of request values', () => {
    expect(new BrowserAutomationUnavailableError({ operation: 'fetch' }).operation).toBe('fetch')
    const protocol = new BrowserAutomationProtocolError({
      phase: 'envelope',
      widgetId: 'passport-checker',
      taskId: 'check',
    })
    expect(protocol).toMatchObject({
      phase: 'envelope',
      widgetId: 'passport-checker',
      taskId: 'check',
    })
  })

  it('preserves safe remote rejection fields', () => {
    const error = new BrowserTaskRejectedError({
      widgetId: 'passport-checker',
      taskId: 'check',
      code: 'browser_session_required',
      publicMessage: 'Browser attention is required',
      meta: { recovery: 'ssh' },
    })
    expect(error).toMatchObject({
      code: 'browser_session_required',
      publicMessage: 'Browser attention is required',
      meta: { recovery: 'ssh' },
    })
  })
})
```

- [ ] **Step 2: Run the shared tests and verify missing exports**

```bash
pnpm --filter shared exec vitest run widgets/browser-contracts.test.ts widgets/browser-errors.test.ts
```

Expected: FAIL because the descriptor helper, API type, and errors do not exist.

- [ ] **Step 3: Declare the shared errore dependency**

Add the catalog dependency to `packages/shared/package.json`:

```json
"dependencies": {
  "errore": "catalog:",
  "zod": "catalog:"
}
```

Update the workspace lockfile from the repository root:

```bash
pnpm install --lockfile-only
```

Expected: `pnpm-lock.yaml` records `errore` under the `packages/shared` importer.

- [ ] **Step 4: Implement the shared tagged errors**

Create `packages/shared/widgets/browser-errors.ts`:

```ts
import * as errore from 'errore'

export class BrowserAutomationUnavailableError extends errore.createTaggedError({
  name: 'BrowserAutomationUnavailableError',
  message: 'Browser automation is unavailable during $operation',
}) {}

export class BrowserAutomationDeadlineError extends errore.createTaggedError({
  name: 'BrowserAutomationDeadlineError',
  message: 'Browser automation request exceeded $timeoutMs ms',
  extends: errore.AbortError,
}) {}

export class BrowserAutomationProtocolError extends errore.createTaggedError({
  name: 'BrowserAutomationProtocolError',
  message: 'Invalid browser automation response during $phase for $widgetId/$taskId',
}) {}

type BrowserTaskRejectedErrorOptions = {
  widgetId: string
  taskId: string
  code: string
  publicMessage: string
  meta?: Record<string, unknown>
}

export class BrowserTaskRejectedError extends errore.createTaggedError({
  name: 'BrowserTaskRejectedError',
  message: 'Browser task $widgetId/$taskId was rejected with $code',
}) {
  readonly publicMessage: string
  readonly meta: Record<string, unknown> | undefined

  constructor({ publicMessage, meta, ...options }: BrowserTaskRejectedErrorOptions) {
    super(options)
    this.publicMessage = publicMessage
    this.meta = meta
  }
}

export type BrowserGatewayError =
  | BrowserAutomationUnavailableError
  | BrowserAutomationDeadlineError
  | BrowserAutomationProtocolError
  | BrowserTaskRejectedError
```

- [ ] **Step 5: Implement task descriptors and the server API type**

Add these exports to `packages/shared/widgets/browser-contracts.ts`:

```ts
import type { BrowserGatewayError } from './browser-errors'

export type WidgetBrowserTaskDescriptor<
  Id extends string = string,
  PayloadSchema extends z.ZodType = z.ZodType,
  ResultSchema extends z.ZodType = z.ZodType,
> = {
  readonly id: Id
  readonly payload: PayloadSchema
  readonly result: ResultSchema
}

export type WidgetBrowserTaskDescriptors<Schemas extends WidgetBrowserTaskSchemas> = {
  readonly [Task in keyof Schemas & string]: WidgetBrowserTaskDescriptor<
    Task,
    Schemas[Task]['payload'],
    Schemas[Task]['result']
  >
}

export function defineWidgetBrowserTasks<const Schemas extends WidgetBrowserTaskSchemas>(
  schemas: Schemas,
): WidgetBrowserTaskDescriptors<Schemas> {
  return Object.fromEntries(
    Object.entries(schemas).map(([id, schema]) => [id, { id, ...schema }]),
  ) as WidgetBrowserTaskDescriptors<Schemas>
}

export type WidgetServerBrowserApi = {
  invoke<Id extends string, PayloadSchema extends z.ZodType, ResultSchema extends z.ZodType>(
    task: WidgetBrowserTaskDescriptor<Id, PayloadSchema, ResultSchema>,
    payload: z.input<PayloadSchema>,
  ): Promise<BrowserGatewayError | z.output<ResultSchema>>
}
```

Keep all existing browser definition and runtime conversion exports unchanged.

- [ ] **Step 6: Prove descriptor maps work as browser schemas**

In `packages/browser-automation/src/tasks/contracts.test.ts`, import `defineWidgetBrowserTasks` and replace the plain `schemas` constant with:

```ts
const schemas = defineWidgetBrowserTasks({
  check: {
    payload: z.object({ value: z.string().transform(Number) }),
    result: z.object({ echoed: z.number().transform(String) }),
  },
})
```

Add this assertion to the existing inference test:

```ts
expect(schemas.check.id).toBe('check')
expectTypeOf(schemas.check.id).toEqualTypeOf<'check'>()
```

- [ ] **Step 7: Run descriptor, error, and compatibility tests**

```bash
pnpm --filter shared exec vitest run widgets/browser-contracts.test.ts widgets/browser-errors.test.ts
pnpm --filter browser-automation exec vitest run src/tasks/contracts.test.ts
```

Expected: PASS.

- [ ] **Step 8: Commit widget descriptor infrastructure**

```bash
git add packages/shared/widgets packages/shared/package.json packages/browser-automation/src/tasks/contracts.test.ts pnpm-lock.yaml
git commit -m "feat(shared): define widget browser task descriptors"
```

### Task 3: Add Server Gateway Configuration and Client Seam

**Files:**

- Create: `packages/server/src/browser/client.ts`
- Create: `packages/server/src/browser/config.ts`
- Create: `packages/server/src/browser/config.test.ts`
- Create: `packages/server/src/browser/testing/fake-client.ts`
- Create: `packages/server/src/browser/testing/fake-client.test.ts`

- [ ] **Step 1: Write configuration and fake-client tests**

Create `packages/server/src/browser/config.test.ts`:

```ts
import { describe, expect, it } from 'vitest'

import { BrowserGatewayConfigError, loadBrowserGatewayConfig } from './config'

describe('loadBrowserGatewayConfig', () => {
  it('applies internal-service defaults', () => {
    expect(loadBrowserGatewayConfig({})).toEqual({
      baseUrl: 'http://browser-automation:8788',
      timeoutMs: 100_000,
    })
  })

  it('normalizes a configured URL and parses the deadline', () => {
    expect(
      loadBrowserGatewayConfig({
        BROWSER_AUTOMATION_URL: 'http://browser:9000/',
        BROWSER_AUTOMATION_TIMEOUT_MS: '150000',
      }),
    ).toEqual({ baseUrl: 'http://browser:9000', timeoutMs: 150_000 })
  })

  it.each([
    [{ BROWSER_AUTOMATION_URL: 'file:///tmp/browser' }, 'BROWSER_AUTOMATION_URL'],
    [{ BROWSER_AUTOMATION_TIMEOUT_MS: '0' }, 'BROWSER_AUTOMATION_TIMEOUT_MS'],
    [{ BROWSER_AUTOMATION_TIMEOUT_MS: 'nope' }, 'BROWSER_AUTOMATION_TIMEOUT_MS'],
  ])('returns a safe tagged error for invalid config %#', (env, field) => {
    const result = loadBrowserGatewayConfig(env)
    expect(result).toBeInstanceOf(BrowserGatewayConfigError)
    expect((result as BrowserGatewayConfigError).field).toBe(field)
  })
})
```

Create `packages/server/src/browser/testing/fake-client.test.ts`:

```ts
import { BrowserTaskRejectedError } from '@shared/widgets/browser-errors'
import { describe, expect, it } from 'vitest'

import { makeFakeBrowserAutomationClient } from './fake-client'

describe('makeFakeBrowserAutomationClient', () => {
  it('records calls and returns the programmed value', async () => {
    const fake = makeFakeBrowserAutomationClient()
    fake.setResult({ result: { echoed: 'ok' } })

    expect(
      await fake.client.invoke({ widgetId: 'demo', taskId: 'check', payload: { value: 'ok' } }),
    ).toEqual({ result: { echoed: 'ok' } })
    expect(fake.calls).toEqual([{ widgetId: 'demo', taskId: 'check', payload: { value: 'ok' } }])
  })

  it('can return a gateway error as a value', async () => {
    const fake = makeFakeBrowserAutomationClient()
    const error = new BrowserTaskRejectedError({
      widgetId: 'demo',
      taskId: 'check',
      code: 'rejected',
      publicMessage: 'Rejected',
    })
    fake.setResult(error)

    expect(await fake.client.invoke({ widgetId: 'demo', taskId: 'check', payload: {} })).toBe(error)
  })
})
```

- [ ] **Step 2: Run the tests and verify missing modules**

```bash
pnpm --filter server exec vitest run src/browser/config.test.ts src/browser/testing/fake-client.test.ts
```

Expected: FAIL because `config.ts` and `fake-client.ts` do not exist.

- [ ] **Step 3: Define the low-level client seam**

Create `packages/server/src/browser/client.ts`:

```ts
import type { BrowserGatewayError } from '@shared/widgets/browser-errors'

export type BrowserAutomationInvokeArgs = {
  widgetId: string
  taskId: string
  payload: unknown
}

export type BrowserAutomationClientSuccess = { result: unknown }
export type BrowserAutomationClientResult = BrowserGatewayError | BrowserAutomationClientSuccess

export type BrowserAutomationClient = {
  invoke(args: BrowserAutomationInvokeArgs): Promise<BrowserAutomationClientResult>
}
```

- [ ] **Step 4: Implement configuration parsing**

Create `packages/server/src/browser/config.ts`:

```ts
import * as errore from 'errore'
import { z } from 'zod'

export type BrowserGatewayConfig = {
  baseUrl: string
  timeoutMs: number
}

export class BrowserGatewayConfigError extends errore.createTaggedError({
  name: 'BrowserGatewayConfigError',
  message: 'Invalid browser gateway configuration for $field',
}) {}

const urlSchema = z
  .string()
  .url()
  .refine((value) => ['http:', 'https:'].includes(new URL(value).protocol))
  .transform((value) => value.replace(/\/+$/, ''))

const positiveIntEnv = (fallback: number) =>
  z.preprocess(
    (value) => (value === undefined || value === '' ? fallback : value),
    z.coerce.number().int().positive(),
  )

const ConfigSchema = z.object({
  BROWSER_AUTOMATION_URL: z.preprocess(
    (value) => (value === undefined || value === '' ? 'http://browser-automation:8788' : value),
    urlSchema,
  ),
  BROWSER_AUTOMATION_TIMEOUT_MS: positiveIntEnv(100_000),
})

export function loadBrowserGatewayConfig(
  env: NodeJS.ProcessEnv,
): BrowserGatewayConfigError | BrowserGatewayConfig {
  const parsed = ConfigSchema.safeParse(env)
  if (!parsed.success) {
    const field = parsed.error.issues[0]?.path.join('.') || 'configuration'
    return new BrowserGatewayConfigError({ field })
  }
  return {
    baseUrl: parsed.data.BROWSER_AUTOMATION_URL,
    timeoutMs: parsed.data.BROWSER_AUTOMATION_TIMEOUT_MS,
  }
}
```

- [ ] **Step 5: Implement the programmable fake**

Create `packages/server/src/browser/testing/fake-client.ts`:

```ts
import { BrowserAutomationUnavailableError } from '@shared/widgets/browser-errors'

import type {
  BrowserAutomationClient,
  BrowserAutomationClientResult,
  BrowserAutomationInvokeArgs,
} from '../client'

export function makeFakeBrowserAutomationClient() {
  const calls: BrowserAutomationInvokeArgs[] = []
  let result: BrowserAutomationClientResult = new BrowserAutomationUnavailableError({
    operation: 'fake',
  })

  const client: BrowserAutomationClient = {
    async invoke(args) {
      calls.push(args)
      return result
    },
  }

  return {
    client,
    calls,
    setResult(next: BrowserAutomationClientResult) {
      result = next
    },
  }
}
```

- [ ] **Step 6: Run tests and typecheck the server package**

```bash
pnpm --filter server exec vitest run src/browser/config.test.ts src/browser/testing/fake-client.test.ts
pnpm --filter server typecheck
```

Expected: PASS.

- [ ] **Step 7: Commit configuration and the client seam**

```bash
git add packages/server/src/browser
git commit -m "feat(server): add browser gateway client seam"
```

### Task 4: Implement the Browser Automation HTTP Client

**Files:**

- Create: `packages/server/src/browser/http-client.ts`
- Create: `packages/server/src/browser/http-client.test.ts`

- [ ] **Step 1: Write failing success and remote-rejection tests**

Create `packages/server/src/browser/http-client.test.ts` with these helpers and first cases:

```ts
import {
  BrowserAutomationDeadlineError,
  BrowserAutomationProtocolError,
  BrowserAutomationUnavailableError,
  BrowserTaskRejectedError,
} from '@shared/widgets/browser-errors'
import { afterEach, describe, expect, it, vi } from 'vitest'

import { createHttpBrowserAutomationClient } from './http-client'

function response(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json' },
  })
}

function fetchReturning(value: Response) {
  return vi.fn(async () => value) as unknown as typeof fetch
}

afterEach(() => {
  vi.useRealTimers()
})

describe('createHttpBrowserAutomationClient', () => {
  it('posts the scoped task and returns a success result', async () => {
    const fetchImpl = fetchReturning(response({ ok: true, result: { echoed: 'ok' } }))
    const client = createHttpBrowserAutomationClient({
      baseUrl: 'http://browser:8788',
      timeoutMs: 1000,
      fetchImpl,
    })

    expect(
      await client.invoke({
        widgetId: 'demo widget',
        taskId: 'check/value',
        payload: { value: 'ok' },
      }),
    ).toEqual({ result: { echoed: 'ok' } })
    expect(fetchImpl).toHaveBeenCalledWith(
      'http://browser:8788/tasks/demo%20widget/check%2Fvalue',
      expect.objectContaining({
        method: 'POST',
        body: JSON.stringify({ payload: { value: 'ok' } }),
      }),
    )
  })

  it('preserves a valid remote task rejection', async () => {
    const client = createHttpBrowserAutomationClient({
      baseUrl: 'http://browser:8788',
      timeoutMs: 1000,
      fetchImpl: fetchReturning(
        response({
          ok: false,
          error: {
            code: 'browser_session_required',
            message: 'Browser attention is required',
            meta: { recovery: 'ssh' },
          },
        }),
      ),
    })

    const result = await client.invoke({ widgetId: 'demo', taskId: 'check', payload: {} })
    expect(result).toBeInstanceOf(BrowserTaskRejectedError)
    expect(result).toMatchObject({
      code: 'browser_session_required',
      publicMessage: 'Browser attention is required',
      meta: { recovery: 'ssh' },
    })
  })
})
```

- [ ] **Step 2: Add failing transport, deadline, protocol, and redaction cases**

Add these cases inside the same `describe`:

```ts
it('maps a draining service and fetch rejection to unavailable errors', async () => {
  const draining = createHttpBrowserAutomationClient({
    baseUrl: 'http://browser:8788',
    timeoutMs: 1000,
    fetchImpl: fetchReturning(response({ status: 'draining' }, 503)),
  })
  expect(await draining.invoke({ widgetId: 'demo', taskId: 'check', payload: {} })).toBeInstanceOf(
    BrowserAutomationUnavailableError,
  )

  const rejectedFetch = vi.fn(async () => {
    throw new Error('connection refused')
  }) as unknown as typeof fetch
  const unavailable = createHttpBrowserAutomationClient({
    baseUrl: 'http://browser:8788',
    timeoutMs: 1000,
    fetchImpl: rejectedFetch,
  })
  expect(
    await unavailable.invoke({ widgetId: 'demo', taskId: 'check', payload: {} }),
  ).toBeInstanceOf(BrowserAutomationUnavailableError)
})

it('aborts with a typed deadline error', async () => {
  vi.useFakeTimers()
  const fetchImpl = vi.fn(
    (_input: string | URL | Request, init?: RequestInit) =>
      new Promise<Response>((_resolve, reject) => {
        const signal = init?.signal
        signal?.addEventListener('abort', () => reject(signal.reason), { once: true })
      }),
  ) as unknown as typeof fetch
  const client = createHttpBrowserAutomationClient({
    baseUrl: 'http://browser:8788',
    timeoutMs: 100,
    fetchImpl,
  })

  const pending = client.invoke({ widgetId: 'demo', taskId: 'check', payload: {} })
  await vi.advanceTimersByTimeAsync(100)
  expect(await pending).toBeInstanceOf(BrowserAutomationDeadlineError)
})

it.each([
  ['unexpected status', fetchReturning(response({ message: 'bad' }, 502))],
  ['invalid json', fetchReturning(new Response('{', { status: 200 }))],
  ['invalid envelope', fetchReturning(response({ ok: true, secret: 'SERIES123456' }))],
])('returns a protocol error for %s', async (_label, fetchImpl) => {
  const client = createHttpBrowserAutomationClient({
    baseUrl: 'http://browser:8788',
    timeoutMs: 1000,
    fetchImpl,
  })
  const result = await client.invoke({
    widgetId: 'demo',
    taskId: 'check',
    payload: { secret: 'PAYLOAD_SECRET' },
  })
  expect(result).toBeInstanceOf(BrowserAutomationProtocolError)
  expect(JSON.stringify(result)).not.toContain('SERIES123456')
  expect(JSON.stringify(result)).not.toContain('PAYLOAD_SECRET')
})

it('does not retry a failed request', async () => {
  const fetchImpl = vi.fn(async () => {
    throw new Error('connection refused')
  }) as unknown as typeof fetch
  const client = createHttpBrowserAutomationClient({
    baseUrl: 'http://browser:8788',
    timeoutMs: 1000,
    fetchImpl,
  })

  await client.invoke({ widgetId: 'demo', taskId: 'check', payload: {} })
  expect(fetchImpl).toHaveBeenCalledTimes(1)
})
```

- [ ] **Step 3: Run the HTTP client test and verify the module is missing**

```bash
pnpm --filter server exec vitest run src/browser/http-client.test.ts
```

Expected: FAIL because `http-client.ts` does not exist.

- [ ] **Step 4: Implement the HTTP client**

Create `packages/server/src/browser/http-client.ts`:

```ts
import { TaskResponseSchema } from '@shared/browser-automation/protocol'
import {
  BrowserAutomationDeadlineError,
  BrowserAutomationProtocolError,
  BrowserAutomationUnavailableError,
  BrowserTaskRejectedError,
} from '@shared/widgets/browser-errors'
import * as errore from 'errore'

import type { BrowserAutomationClient } from './client'

export type CreateHttpBrowserAutomationClientOptions = {
  baseUrl: string
  timeoutMs: number
  fetchImpl?: typeof fetch
}

export function createHttpBrowserAutomationClient({
  baseUrl,
  timeoutMs,
  fetchImpl = fetch,
}: CreateHttpBrowserAutomationClientOptions): BrowserAutomationClient {
  const normalizedBaseUrl = baseUrl.replace(/\/+$/, '')

  return {
    async invoke({ widgetId, taskId, payload }) {
      const body = errore.try(
        () => JSON.stringify({ payload }),
        (cause) =>
          new BrowserAutomationProtocolError({
            phase: 'request-json',
            widgetId,
            taskId,
            cause,
          }),
      )
      if (body instanceof Error) return body

      const deadline = new BrowserAutomationDeadlineError({ timeoutMs })
      const controller = new AbortController()
      const timeout = setTimeout(() => controller.abort(deadline), timeoutMs)
      timeout.unref?.()
      const clearDeadline = () => clearTimeout(timeout)

      const url = `${normalizedBaseUrl}/tasks/${encodeURIComponent(widgetId)}/${encodeURIComponent(taskId)}`
      const response = await fetchImpl(url, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body,
        signal: controller.signal,
      }).catch((cause) => new BrowserAutomationUnavailableError({ operation: 'fetch', cause }))
      if (errore.isAbortError(response)) {
        clearDeadline()
        return deadline
      }
      if (response instanceof Error) {
        clearDeadline()
        return response
      }
      if (response.status === 503) {
        clearDeadline()
        return new BrowserAutomationUnavailableError({ operation: 'service' })
      }
      if (response.status !== 200) {
        clearDeadline()
        return new BrowserAutomationProtocolError({
          phase: `http-${response.status}`,
          widgetId,
          taskId,
        })
      }

      const raw = await (response.json() as Promise<unknown>).catch(
        (cause) =>
          new BrowserAutomationProtocolError({
            phase: 'response-json',
            widgetId,
            taskId,
            cause,
          }),
      )
      clearDeadline()
      if (errore.isAbortError(raw)) return deadline
      if (raw instanceof Error) return raw

      const envelope = TaskResponseSchema.safeParse(raw)
      if (!envelope.success) {
        return new BrowserAutomationProtocolError({ phase: 'envelope', widgetId, taskId })
      }
      if (!envelope.data.ok) {
        return new BrowserTaskRejectedError({
          widgetId,
          taskId,
          code: envelope.data.error.code,
          publicMessage: envelope.data.error.message,
          meta: envelope.data.error.meta,
        })
      }
      return { result: envelope.data.result }
    },
  }
}
```

- [ ] **Step 5: Run HTTP tests and server typecheck**

```bash
pnpm --filter server exec vitest run src/browser/http-client.test.ts
pnpm --filter server typecheck
```

Expected: PASS.

- [ ] **Step 6: Commit the HTTP transport**

```bash
git add packages/server/src/browser/http-client.ts packages/server/src/browser/http-client.test.ts
git commit -m "feat(server): add browser automation http client"
```

### Task 5: Add the Widget-Scoped Browser API

**Files:**

- Create: `packages/server/src/browser/widget-api.ts`
- Create: `packages/server/src/browser/widget-api.test.ts`

- [ ] **Step 1: Write scoped invocation tests**

Create `packages/server/src/browser/widget-api.test.ts`:

```ts
import { defineWidgetBrowserTasks } from '@shared/widgets/browser-contracts'
import {
  BrowserAutomationProtocolError,
  BrowserTaskRejectedError,
  type BrowserGatewayError,
} from '@shared/widgets/browser-errors'
import { describe, expect, expectTypeOf, it } from 'vitest'
import { z } from 'zod'

import { makeFakeBrowserAutomationClient } from './testing/fake-client'
import { createWidgetBrowserApi } from './widget-api'

const tasks = defineWidgetBrowserTasks({
  check: {
    payload: z.object({ value: z.string() }),
    result: z.object({ echoed: z.number().transform(String) }),
  },
})

describe('createWidgetBrowserApi', () => {
  it('injects widget scope and validates the result', async () => {
    const fake = makeFakeBrowserAutomationClient()
    fake.setResult({ result: { echoed: 7 } })
    const api = createWidgetBrowserApi({ widgetId: 'passport-checker', client: fake.client })

    const result = await api.invoke(tasks.check, { value: 'hello' })
    expectTypeOf(result).toEqualTypeOf<BrowserGatewayError | { echoed: string }>()
    expect(result).toEqual({ echoed: '7' })
    expect(fake.calls).toEqual([
      {
        widgetId: 'passport-checker',
        taskId: 'check',
        payload: { value: 'hello' },
      },
    ])
  })

  it('returns a protocol error for an invalid success result', async () => {
    const fake = makeFakeBrowserAutomationClient()
    fake.setResult({ result: { echoed: 'not-a-number' } })
    const api = createWidgetBrowserApi({ widgetId: 'demo', client: fake.client })

    const result = await api.invoke(tasks.check, { value: 'hello' })
    expect(result).toBeInstanceOf(BrowserAutomationProtocolError)
    expect(result).toMatchObject({ phase: 'result', widgetId: 'demo', taskId: 'check' })
  })

  it('propagates gateway errors unchanged', async () => {
    const fake = makeFakeBrowserAutomationClient()
    const error = new BrowserTaskRejectedError({
      widgetId: 'demo',
      taskId: 'check',
      code: 'browser_session_required',
      publicMessage: 'Browser attention is required',
    })
    fake.setResult(error)
    const api = createWidgetBrowserApi({ widgetId: 'demo', client: fake.client })

    expect(await api.invoke(tasks.check, { value: 'hello' })).toBe(error)
  })
})
```

- [ ] **Step 2: Run the test and verify the scoped API is missing**

```bash
pnpm --filter server exec vitest run src/browser/widget-api.test.ts
```

Expected: FAIL because `widget-api.ts` does not exist.

- [ ] **Step 3: Implement widget scoping and result validation**

Create `packages/server/src/browser/widget-api.ts`:

```ts
import type { WidgetServerBrowserApi } from '@shared/widgets/browser-contracts'
import { BrowserAutomationProtocolError } from '@shared/widgets/browser-errors'

import type { BrowserAutomationClient } from './client'

export function createWidgetBrowserApi({
  widgetId,
  client,
}: {
  widgetId: string
  client: BrowserAutomationClient
}): WidgetServerBrowserApi {
  return {
    async invoke(task, payload) {
      const result = await client.invoke({ widgetId, taskId: task.id, payload })
      if (result instanceof Error) return result

      const validated = task.result.safeParse(result.result)
      if (!validated.success) {
        return new BrowserAutomationProtocolError({
          phase: 'result',
          widgetId,
          taskId: task.id,
        })
      }
      return validated.data
    },
  }
}
```

- [ ] **Step 4: Run scoped API tests and typecheck**

```bash
pnpm --filter server exec vitest run src/browser/widget-api.test.ts
pnpm --filter server typecheck
```

Expected: PASS.

- [ ] **Step 5: Commit the scoped API**

```bash
git add packages/server/src/browser/widget-api.ts packages/server/src/browser/widget-api.test.ts
git commit -m "feat(server): add scoped widget browser api"
```

### Task 6: Separate Storage API Construction from Context Composition

**Files:**

- Modify: `packages/server/src/widgets/storage.ts`
- Modify: `packages/server/src/widgets/storage.test.ts`
- Modify: `packages/server/src/widgets/dispatch.ts`
- Modify: `packages/server/src/widgets/dispatch.test.ts`

- [ ] **Step 1: Rename storage tests before implementation**

In `packages/server/src/widgets/storage.test.ts`:

- import `createWidgetServerStorageApi` instead of `createWidgetServerApi`;
- rename the suite to `createWidgetServerStorageApi`;
- replace each `api.storage.instance` with `storage.instance`;
- replace each `api.storage.shared` with `storage.shared`.

The first setup becomes:

```ts
const storage = createWidgetServerStorageApi({
  ops,
  typeId: 'clock',
  instanceId: 'placement-1',
  ip: '127.0.0.1',
  now: () => 123,
  createId: () => 'entry-1',
})
```

- [ ] **Step 2: Run storage tests and verify the renamed export is missing**

```bash
pnpm --filter server exec vitest run src/widgets/storage.test.ts
```

Expected: FAIL because `createWidgetServerStorageApi` is not exported.

- [ ] **Step 3: Rename the storage-only factory**

In `packages/server/src/widgets/storage.ts`:

- rename `CreateWidgetServerApiOptions` to `CreateWidgetServerStorageApiOptions`;
- rename `createWidgetServerApi` to `createWidgetServerStorageApi`;
- change its return type to `WidgetServerContext['api']['storage']`;
- return the storage scopes directly.

The final return statement must be:

```ts
return {
  instance: createScope(instanceNamespace(instanceId)),
  shared: createScope(typeNamespace(typeId)),
}
```

- [ ] **Step 4: Keep dispatch green with the storage-only shape**

In `packages/server/src/widgets/dispatch.ts`, import the renamed factory and construct the current API explicitly:

```ts
api: {
  storage: createWidgetServerStorageApi({
    ops: options.ops,
    typeId: options.typeId,
    instanceId: options.instanceId,
    ip: options.ip,
    now: options.now,
  }),
},
```

No browser capability is added in this task; `WidgetServerContext` still has its old shape until Task 7.

- [ ] **Step 5: Run storage and dispatch tests**

```bash
pnpm --filter server exec vitest run src/widgets/storage.test.ts src/widgets/dispatch.test.ts
pnpm --filter server typecheck
```

Expected: PASS.

- [ ] **Step 6: Commit the responsibility-preserving refactor**

```bash
git add packages/server/src/widgets/storage.ts packages/server/src/widgets/storage.test.ts packages/server/src/widgets/dispatch.ts packages/server/src/widgets/dispatch.test.ts
git commit -m "refactor(server): isolate widget storage api factory"
```

### Task 7: Wire the Browser Capability Through Widget RPC

**Files:**

- Create: `packages/server/src/widgets/api.ts`
- Create: `packages/server/src/widgets/api.test.ts`
- Modify: `packages/shared/widgets/contracts.ts`
- Modify: `packages/server/src/widgets/dispatch.ts`
- Modify: `packages/server/src/widgets/dispatch.test.ts`
- Modify: `packages/server/src/app.ts`
- Modify: `packages/server/src/app.test.ts`
- Modify: `packages/server/src/index.ts`
- Modify: `packages/server/src/test-server.ts`

- [ ] **Step 1: Write the composed API test**

Create `packages/server/src/widgets/api.test.ts`:

```ts
import { defineWidgetBrowserTasks } from '@shared/widgets/browser-contracts'
import { describe, expect, it } from 'vitest'
import { z } from 'zod'

import { makeFakeBrowserAutomationClient } from '../browser/testing/fake-client'
import { createMemoryOps, createMemoryPubSub } from '../test/memory-ops'
import { createWidgetServerApi } from './api'

const tasks = defineWidgetBrowserTasks({
  check: {
    payload: z.object({ value: z.string() }),
    result: z.object({ echoed: z.string() }),
  },
})

describe('createWidgetServerApi', () => {
  it('composes storage scopes with a widget-scoped browser client', async () => {
    const pubsub = createMemoryPubSub()
    const ops = createMemoryOps(pubsub)
    const fake = makeFakeBrowserAutomationClient()
    fake.setResult({ result: { echoed: 'ok' } })

    const api = createWidgetServerApi({
      ops,
      typeId: 'demo',
      instanceId: 'placement-1',
      ip: null,
      now: () => 123,
      browserClient: fake.client,
    })

    expect(await api.storage.instance.set('value', 1)).toBeUndefined()
    expect(await api.browser.invoke(tasks.check, { value: 'ok' })).toEqual({ echoed: 'ok' })
    expect(fake.calls[0]).toMatchObject({ widgetId: 'demo', taskId: 'check' })
  })
})
```

- [ ] **Step 2: Add browser-backed test events to dispatch tests**

In `packages/server/src/widgets/dispatch.test.ts`, define a descriptor and extend the test definition:

```ts
const browserTasks = defineWidgetBrowserTasks({
  check: {
    payload: z.object({ value: z.string() }),
    result: z.object({ echoed: z.string() }),
  },
})
```

Add this event schema:

```ts
browserStatus: {
  payload: z.object({ value: z.string() }),
  result: z.object({ kind: z.string(), code: z.string().nullable() }),
},
```

Add this handler:

```ts
async browserStatus(payload, context) {
  const result = await context.api.browser.invoke(browserTasks.check, payload)
  if (result instanceof BrowserTaskRejectedError) {
    return { kind: result._tag, code: result.code }
  }
  if (result instanceof Error) return { kind: result._tag, code: null }
  return { kind: 'success', code: null }
},
```

Create one fake per `dispatch` call, pass `browserClient` to `dispatchWidgetEvent`, and allow the helper to accept a programmed browser result. Add a table-driven test using these exact values:

```ts
it.each([
  new BrowserAutomationUnavailableError({ operation: 'fetch' }),
  new BrowserAutomationDeadlineError({ timeoutMs: 100_000 }),
  new BrowserAutomationProtocolError({
    phase: 'envelope',
    widgetId: 'test-widget',
    taskId: 'check',
  }),
  new BrowserTaskRejectedError({
    widgetId: 'test-widget',
    taskId: 'check',
    code: 'browser_session_required',
    publicMessage: 'Browser attention is required',
  }),
])('delivers $name to the widget handler', async (error) => {
  const result = await dispatch({ event: 'browserStatus', browserResult: error })
  expect(result).toEqual({
    data: {
      kind: error._tag,
      code: error instanceof BrowserTaskRejectedError ? error.code : null,
    },
  })
})
```

Use this exact test helper so `browserResult` remains outside production options:

```ts
type DispatchTestOverrides = Partial<DispatchWidgetEventOptions> & {
  browserResult?: BrowserAutomationClientResult
}

function dispatch(overrides: DispatchTestOverrides = {}) {
  const { browserResult, ...dispatchOverrides } = overrides
  const pubsub = createMemoryPubSub()
  const browserFake = makeFakeBrowserAutomationClient()
  if (browserResult !== undefined) browserFake.setResult(browserResult)

  return dispatchWidgetEvent({
    registry: createdRegistry,
    ops: createMemoryOps(pubsub),
    browserClient: browserFake.client,
    typeId: 'test-widget',
    event: 'echo',
    instanceId: 'placement-1',
    payload: { value: 'ok' },
    ip: '127.0.0.1',
    now: () => 100,
    ...dispatchOverrides,
  })
}
```

- [ ] **Step 3: Run the new tests and verify composition is missing**

```bash
pnpm --filter server exec vitest run src/widgets/api.test.ts src/widgets/dispatch.test.ts
```

Expected: FAIL because `widgets/api.ts`, `context.api.browser`, and `browserClient` injection do not exist.

- [ ] **Step 4: Add browser capability to the shared context**

In `packages/shared/widgets/contracts.ts`, add a type-only import:

```ts
import type { WidgetServerBrowserApi } from './browser-contracts'
```

Add the browser capability beside storage:

```ts
api: {
  storage: {
    instance: WidgetServerStorage
    shared: WidgetServerStorage
  }
  browser: WidgetServerBrowserApi
}
```

- [ ] **Step 5: Implement the composed widget API**

Create `packages/server/src/widgets/api.ts`:

```ts
import type { WidgetServerContext } from '@shared/widgets/contracts'

import type { BrowserAutomationClient } from '../browser/client'
import { createWidgetBrowserApi } from '../browser/widget-api'
import { createWidgetServerStorageApi, type CreateWidgetServerStorageApiOptions } from './storage'

export type CreateWidgetServerApiOptions = CreateWidgetServerStorageApiOptions & {
  browserClient: BrowserAutomationClient
}

export function createWidgetServerApi(
  options: CreateWidgetServerApiOptions,
): WidgetServerContext['api'] {
  return {
    storage: createWidgetServerStorageApi(options),
    browser: createWidgetBrowserApi({
      widgetId: options.typeId,
      client: options.browserClient,
    }),
  }
}
```

- [ ] **Step 6: Inject the client into dispatch and the app**

In `packages/server/src/widgets/dispatch.ts`:

- add `browserClient: BrowserAutomationClient` to `DispatchWidgetEventOptions`;
- import `createWidgetServerApi` from `./api`;
- remove the storage-only inline API;
- pass the existing storage options plus `browserClient: options.browserClient` to the composed factory.

In `packages/server/src/app.ts` add the client to dependencies:

```ts
export type AppDeps = {
  ops: ValkeyOps
  subscribe: (onMessage: (message: string) => void) => () => void
  now: () => number
  widgetRegistry: WidgetServerRegistry
  browserClient: BrowserAutomationClient
  testControls?: TestControls
}
```

Pass `browserClient: deps.browserClient` into every `dispatchWidgetEvent` call.

- [ ] **Step 7: Construct the lazy HTTP client in both server entry points**

Add this initialization to `packages/server/src/index.ts` and `packages/server/src/test-server.ts` before `createApp`:

```ts
const browserConfig = loadBrowserGatewayConfig(process.env)
if (browserConfig instanceof Error) {
  console.error(browserConfig.message)
  process.exit(1)
}

const browserClient = createHttpBrowserAutomationClient(browserConfig)
```

Import the two factories from `./browser/config` and `./browser/http-client`, then pass `browserClient` to `createApp`. Client construction must not perform a health request; absence is detected only on invocation.

- [ ] **Step 8: Update app tests and add a normal HTTP RPC browser invocation**

In `packages/server/src/app.test.ts`:

- create a fake browser client in `beforeEach` and pass it to `createApp`;
- add a `browserEcho` event to `testWidget` using a local descriptor;
- have the handler return an error value unchanged or the validated success;
- program `{ result: { echoed: 'from-browser' } }` before the HTTP call.

Use this descriptor and handler:

```ts
const browserTasks = defineWidgetBrowserTasks({
  check: {
    payload: z.object({ value: z.string() }),
    result: z.object({ echoed: z.string() }),
  },
})

browserEcho: {
  payload: z.object({ value: z.string() }),
  result: z.object({ echoed: z.string() }),
},

async browserEcho(payload, context) {
  return context.api.browser.invoke(browserTasks.check, payload)
},
```

Add this test:

```ts
it('invokes a widget-scoped browser task through normal widget RPC', async () => {
  browserFake.setResult({ result: { echoed: 'from-browser' } })
  const res = await fetch(`${base}/api/widgets/test-widget/browserEcho`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ instanceId: 'placement-1', payload: { value: 'hello' } }),
  })

  expect(res.status).toBe(200)
  expect(await res.json()).toEqual({ data: { echoed: 'from-browser' } })
  expect(browserFake.calls).toEqual([
    {
      widgetId: 'test-widget',
      taskId: 'check',
      payload: { value: 'hello' },
    },
  ])
})
```

Add this second test, leaving the fake in its default unavailable state:

```ts
it('keeps non-browser routes healthy while browser automation is unavailable', async () => {
  const time = await fetch(`${base}/api/time`)
  expect(time.status).toBe(200)
  expect(await time.json()).toEqual({ now })

  const echo = await fetch(`${base}/api/widgets/test-widget/echo`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ instanceId: 'placement-1', payload: { value: 'hello' } }),
  })
  expect(echo.status).toBe(200)
  expect(await echo.json()).toEqual({
    data: { echoed: 'hello', instanceId: 'placement-1' },
  })
})
```

This proves browser availability is not an app health dependency.

- [ ] **Step 9: Run focused integration tests and typecheck**

```bash
pnpm --filter server exec vitest run src/widgets/api.test.ts src/widgets/dispatch.test.ts src/app.test.ts
pnpm --filter server typecheck
```

Expected: PASS.

- [ ] **Step 10: Commit the complete context and RPC wiring**

```bash
git add packages/shared/widgets/contracts.ts packages/server/src/widgets packages/server/src/app.ts packages/server/src/app.test.ts packages/server/src/index.ts packages/server/src/test-server.ts
git commit -m "feat(server): expose browser tasks to widget handlers"
```

### Task 8: Wire Compose Configuration and Operator Documentation

**Files:**

- Modify: `scripts/infra.test.ts`
- Modify: `docker-compose.yml`
- Modify: `docker-compose.dev.yml`
- Modify: `packages/browser-automation/README.md`

- [ ] **Step 1: Write failing infrastructure assertions**

Add this case under `describe('browser-automation service wiring')` in `scripts/infra.test.ts`:

```ts
it('configures the server gateway without depending on browser startup', () => {
  const serverBlock = prod.slice(prod.indexOf('  server:'), prod.indexOf('  client:'))
  expect(serverBlock).toContain('BROWSER_AUTOMATION_URL: http://browser-automation:8788')
  expect(serverBlock).toContain("BROWSER_AUTOMATION_TIMEOUT_MS: '100000'")
  const dependsOnBlock = serverBlock.slice(
    serverBlock.indexOf('    depends_on:'),
    serverBlock.indexOf('    expose:'),
  )
  expect(dependsOnBlock).not.toContain('browser-automation:')

  const devServerBlock = compose.slice(compose.indexOf('  server:'), compose.indexOf('  widgets:'))
  expect(devServerBlock).toContain('BROWSER_AUTOMATION_URL: http://browser-automation:8788')
  expect(devServerBlock).toContain("BROWSER_AUTOMATION_TIMEOUT_MS: '100000'")
  const devDependsOnBlock = devServerBlock.slice(devServerBlock.indexOf('    depends_on:'))
  expect(devDependsOnBlock).not.toContain('browser-automation:')
})
```

- [ ] **Step 2: Run the infrastructure test and verify missing configuration**

```bash
pnpm exec vitest run scripts/infra.test.ts
```

Expected: FAIL because the server services do not yet expose the gateway variables.

- [ ] **Step 3: Add Compose environment values without dependencies**

Add these values to the `server.environment` section in both `docker-compose.yml` and `docker-compose.dev.yml`:

```yaml
BROWSER_AUTOMATION_URL: http://browser-automation:8788
BROWSER_AUTOMATION_TIMEOUT_MS: '100000'
```

Do not add `browser-automation` to either server's `depends_on`. The development browser service remains behind the existing `browser` profile.

- [ ] **Step 4: Document gateway operation**

Add a `## Main-server widget gateway` section to `packages/browser-automation/README.md` containing these facts:

```markdown
## Main-server widget gateway

Widget server handlers invoke their own allowlisted browser tasks through
`context.api.browser`. The server uses `BROWSER_AUTOMATION_URL` (default
`http://browser-automation:8788`) and `BROWSER_AUTOMATION_TIMEOUT_MS` (default
`100000`). The deadline is intentionally longer than the browser service's
default queue plus execution limits.

The main server does not depend on browser-automation health or startup. When
the service is absent, only browser task invocations return
`BrowserAutomationUnavailableError`; storage, time, and non-browser widgets
remain available. Calls are never retried automatically.
```

- [ ] **Step 5: Run infrastructure tests and package builds**

```bash
pnpm exec vitest run scripts/infra.test.ts
pnpm --filter server build
pnpm --filter browser-automation build
```

Expected: PASS. The builds prove both bundles resolve the extracted shared protocol and shared gateway errors.

- [ ] **Step 6: Commit deployment wiring and docs**

```bash
git add scripts/infra.test.ts docker-compose.yml docker-compose.dev.yml packages/browser-automation/README.md
git commit -m "build(browser-automation): wire widget server gateway"
```

### Task 9: Run the Full Repository Gate

**Files:**

- Verify only; no planned source changes.

- [ ] **Step 1: Run the repository's canonical verification command**

```bash
pnpm check
```

Expected: PASS. This single command performs codegen, lint, format checking, workspace typechecking, and all workspace tests.

- [ ] **Step 2: Confirm generated output and worktree state**

```bash
git status --short
```

Expected: no unexpected generated or modified files. If the command is not empty, stop and classify each path before any commit; do not include unrelated user changes.

- [ ] **Step 3: Record verification evidence for handoff**

The implementation handoff must list:

```text
pnpm check — PASS
pnpm --filter server build — PASS
pnpm --filter browser-automation build — PASS
```

Do not claim completion unless all three results were observed in the current worktree.
