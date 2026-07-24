# Tokenized Browser Recovery Transport Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Let an operator take manual control of a retained browser challenge page from the board over one short-lived, single-use, same-origin WebSocket, without publishing the VNC port.

**Architecture:** `browser-automation` answers whether a widget has a live retained page. The main server mints a single-use capability bound to one widget and one board session, hands it to the browser in a narrowly scoped cookie, and — on the WebSocket upgrade — burns the capability and pipes the raw socket to the internal websockify endpoint without ever parsing WebSocket frames. Any browser task dispatched for that widget revokes the capability and destroys the live socket first.

**Tech Stack:** Node 22 (`node:http`, `node:net`), find-my-way, Zod, errore, Vitest, nginx, Vite dev proxy, `ws` (server devDependency, tests only).

**Design:** [Tokenized Browser Recovery Transport Design](../specs/2026-07-24-browser-recovery-websocket-design.md)

## Global Constraints

- Errors are values: return errore tagged errors, never `throw` for control flow (`errore` skill, repo-wide convention).
- New factories are named `make*`. Do not rename existing `create*` helpers in files you touch.
- No token, session id, or upstream response body may appear in a log line, an error message, or an error's public meta.
- The recovery WebSocket must stay under the gated `/api/` prefix; the server verifies the session itself and never relies solely on the nginx `auth_request`.
- Never add a runtime WebSocket dependency to `server`; the tunnel pipes bytes. `ws` may be added as a **devDependency** for tests.
- Recovery cookie: name `__Secure-mb_recovery`, degraded to `mb_recovery` with no `Secure` attribute when `secureCookies` is false; always `Path=/api/browser/recovery`, `HttpOnly`, `SameSite=Strict`.
- Exactly one active recovery connection service-wide.
- Storage keys are untouched by this plan; do not modify anything under `packages/*/storage`.
- Final gate: `pnpm check` (lint + format:check + typecheck + test).

---

### Task 1: Retained-page availability in the executor

**Files:**

- Modify: `packages/browser-automation/src/executor.ts`
- Modify: `packages/browser-automation/src/browser/chromium-executor.ts:126-196`
- Modify: `packages/browser-automation/src/testing/fake-executor.ts`
- Test: `packages/browser-automation/src/browser/chromium-executor.test.ts`

**Interfaces:**

- Consumes: nothing.
- Produces: `BrowserExecutor<Context>.hasRetainedPage(widgetId: string): boolean` — `true` only when a retained page exists and is still open. `makeFakeExecutor()` state gains `retainedWidgetIds: Set<string>`.

- [ ] **Step 1: Write the failing tests**

Add to `packages/browser-automation/src/browser/chromium-executor.test.ts`, inside the existing top-level `describe`, next to the other retention tests:

```ts
  it('reports a retained page only while it is open', async () => {
    const created: FakeContext[] = []
    const executor = makeChromiumExecutor(makeDeps(created))

    expect(executor.hasRetainedPage('passport-checker')).toBe(false)

    const context = await executor.acquire(new AbortController().signal, 'passport-checker')
    if (context instanceof Error) throw context
    context.retainPageForRecovery()
    await executor.release(context)

    expect(executor.hasRetainedPage('passport-checker')).toBe(true)
    expect(executor.hasRetainedPage('other-widget')).toBe(false)
  })

  it('forgets a retained page that Chromium closed on its own', async () => {
    const created: FakeContext[] = []
    const executor = makeChromiumExecutor(makeDeps(created))

    const context = await executor.acquire(new AbortController().signal, 'passport-checker')
    if (context instanceof Error) throw context
    context.retainPageForRecovery()
    await executor.release(context)
    await created[0].pages[0].close()

    expect(executor.hasRetainedPage('passport-checker')).toBe(false)
    // The stale entry is dropped, so a later acquire has nothing to close.
    expect(created[0].pages[0].closeCalls).toBe(1)
  })
```

The fake page in that file has no `isClosed`. Extend the fake so it mirrors Playwright's `Page`:

```ts
type FakePage = {
  closeCalls: number
  closed: boolean
  close: () => Promise<void>
  isClosed: () => boolean
}
```

and inside `makeFakeContext`'s `newPage`, add `isClosed: () => page.closed,` to the created page literal (keep the existing `closeCalls`/`closed`/`close` members unchanged).

- [ ] **Step 2: Run the tests to verify they fail**

Run: `pnpm --filter browser-automation exec vitest run src/browser/chromium-executor.test.ts`
Expected: FAIL — `executor.hasRetainedPage is not a function`.

- [ ] **Step 3: Extend the executor contract**

In `packages/browser-automation/src/executor.ts`:

```ts
export type BrowserExecutor<Context> = {
  acquire(signal: AbortSignal, widgetId: string): Promise<Error | Context>
  release(context: Context): Promise<void>
  /**
   * Whether the widget has a page retained for manual recovery. A page closed
   * by Chromium or a context crash counts as absent and its entry is dropped.
   */
  hasRetainedPage(widgetId: string): boolean
  shutdown(): Promise<void>
}
```

- [ ] **Step 4: Implement it in the Chromium executor**

In `packages/browser-automation/src/browser/chromium-executor.ts`, add to the object returned by `makeChromiumExecutor`, between `release` and `shutdown`:

```ts
    hasRetainedPage(widgetId) {
      const page = retainedPages.get(widgetId)
      if (!page) return false
      if (page.isClosed()) {
        retainedPages.delete(widgetId)
        return false
      }
      return true
    },
```

- [ ] **Step 5: Implement it in the fake executor**

In `packages/browser-automation/src/testing/fake-executor.ts`, add `retainedWidgetIds: new Set<string>()` to the `state` literal, add `retainedWidgetIds: Set<string>` to `FakeExecutorState`, and add to the executor:

```ts
    hasRetainedPage(widgetId) {
      return state.retainedWidgetIds.has(widgetId)
    },
```

- [ ] **Step 6: Run the package tests**

Run: `pnpm --filter browser-automation exec vitest run`
Expected: PASS — every existing suite plus the two new cases.

- [ ] **Step 7: Commit**

```bash
git add packages/browser-automation/src/executor.ts packages/browser-automation/src/browser/chromium-executor.ts packages/browser-automation/src/browser/chromium-executor.test.ts packages/browser-automation/src/testing/fake-executor.ts
git commit -m "feat(browser-automation): expose retained recovery page availability"
```

---

### Task 2: Recovery state on the service and its HTTP route

**Files:**

- Modify: `packages/browser-automation/src/service.ts`
- Modify: `packages/browser-automation/src/http/app.ts`
- Modify: `packages/shared/browser-automation/protocol.ts`
- Test: `packages/browser-automation/src/service.test.ts`
- Test: `packages/browser-automation/src/http/app.test.ts`

**Interfaces:**

- Consumes: `BrowserExecutor.hasRetainedPage` (Task 1).
- Produces:
  - `BrowserService.recoveryState(widgetId: string): BrowserServiceUnavailableError | { retained: boolean }`;
  - `GET /recovery/:widgetId` → `200 { "retained": boolean }` or `503 { "status": "starting" | "draining" }`;
  - `RecoveryStateResponseSchema` in `@shared/browser-automation/protocol`.

- [ ] **Step 1: Write the failing service test**

Add to `packages/browser-automation/src/service.test.ts`:

```ts
  it('reports recovery state only while ready', () => {
    const { executor, state } = makeFakeExecutor()
    const service = makeBrowserService({
      registry: buildRegistry(),
      executor,
      config: { queueWaitMs: 1000, executionMs: 1000 },
    })

    expect(service.recoveryState('demo')).toBeInstanceOf(BrowserServiceUnavailableError)

    service.markReady()
    expect(service.recoveryState('demo')).toEqual({ retained: false })

    state.retainedWidgetIds.add('demo')
    expect(service.recoveryState('demo')).toEqual({ retained: true })
  })
```

Reuse whatever registry helper that file already defines; if it builds the registry inline, copy that inline construction instead of inventing `buildRegistry()`. Import `BrowserServiceUnavailableError` from `./errors` if it is not imported yet.

- [ ] **Step 2: Write the failing route test**

Add to `packages/browser-automation/src/http/app.test.ts`:

```ts
  it('answers the recovery state query', async () => {
    service.markReady()
    const response = await fetch(`${base}/recovery/demo`)

    expect(response.status).toBe(200)
    expect(await response.json()).toEqual({ retained: false })
  })

  it('refuses the recovery state query before the service is ready', async () => {
    const response = await fetch(`${base}/recovery/demo`)

    expect(response.status).toBe(503)
    expect(await response.json()).toEqual({ status: 'starting' })
  })
```

- [ ] **Step 3: Run both tests to verify they fail**

Run: `pnpm --filter browser-automation exec vitest run src/service.test.ts src/http/app.test.ts`
Expected: FAIL — `service.recoveryState is not a function` and a 404 from the unregistered route.

- [ ] **Step 4: Implement the service method**

In `packages/browser-automation/src/service.ts`, add to the `BrowserService` type:

```ts
  recoveryState(widgetId: string): BrowserServiceUnavailableError | { retained: boolean }
```

and to `makeBrowserService`, before the returned object:

```ts
  function recoveryState(widgetId: string) {
    if (state !== 'ready') return new BrowserServiceUnavailableError({ state })
    // Deliberately not queued: the point is to inspect a page a finished task
    // left behind, which must stay answerable while the single lane is busy.
    return { retained: deps.executor.hasRetainedPage(widgetId) }
  }
```

Return `recoveryState` from the factory alongside `invoke`, `health`, `markReady`, and `shutdown`.

- [ ] **Step 5: Implement the route**

In `packages/browser-automation/src/http/app.ts`, register after the `/health` route:

```ts
  router.on('GET', '/recovery/:widgetId', (_req, res, params) => {
    const outcome = service.recoveryState(decodeURIComponent(params.widgetId as string))
    if (outcome instanceof BrowserServiceUnavailableError) {
      // Unlike the task route this reports the real state: a caller deciding
      // whether recovery is possible benefits from starting vs draining.
      sendJson(res, 503, { status: outcome.state })
      return
    }
    sendJson(res, 200, outcome)
  })
```

`BrowserServiceUnavailableError` is already imported in that file.

- [ ] **Step 6: Add the shared response schema**

Append to `packages/shared/browser-automation/protocol.ts`:

```ts
export const RecoveryStateResponseSchema = z.object({ retained: z.boolean() })
export type RecoveryStateResponse = z.infer<typeof RecoveryStateResponseSchema>
```

- [ ] **Step 7: Run the package tests**

Run: `pnpm --filter browser-automation exec vitest run`
Expected: PASS.

- [ ] **Step 8: Commit**

```bash
git add packages/browser-automation/src/service.ts packages/browser-automation/src/service.test.ts packages/browser-automation/src/http/app.ts packages/browser-automation/src/http/app.test.ts packages/shared/browser-automation/protocol.ts
git commit -m "feat(browser-automation): serve retained recovery state over http"
```

---

### Task 3: Gateway availability query in the main server

**Files:**

- Modify: `packages/server/src/browser/client.ts`
- Modify: `packages/server/src/browser/http-client.ts`
- Modify: `packages/server/src/browser/testing/fake-client.ts`
- Test: `packages/server/src/browser/http-client.test.ts`

**Interfaces:**

- Consumes: `GET /recovery/:widgetId` (Task 2), `RecoveryStateResponseSchema`.
- Produces: `BrowserAutomationClient.recoveryState(args: { widgetId: string }): Promise<BrowserGatewayError | { retained: boolean }>`; `makeFakeBrowserAutomationClient()` gains `setRecoveryState(next)` and `recoveryCalls: string[]`.

- [ ] **Step 1: Write the failing tests**

Add to `packages/server/src/browser/http-client.test.ts` (match the file's existing fetch-stub idiom; the snippets below assume a `fetchImpl` stub is passed to `createHttpBrowserAutomationClient` exactly as the existing tests do):

```ts
  it('returns the retained recovery state', async () => {
    const client = createHttpBrowserAutomationClient({
      baseUrl: 'http://automation:8788',
      timeoutMs: 1000,
      fetchImpl: async (input) => {
        expect(String(input)).toBe('http://automation:8788/recovery/passport-checker')
        return new Response(JSON.stringify({ retained: true }), { status: 200 })
      },
    })

    expect(await client.recoveryState({ widgetId: 'passport-checker' })).toEqual({ retained: true })
  })

  it('maps a draining service to an unavailable error', async () => {
    const client = createHttpBrowserAutomationClient({
      baseUrl: 'http://automation:8788',
      timeoutMs: 1000,
      fetchImpl: async () => new Response(JSON.stringify({ status: 'draining' }), { status: 503 }),
    })

    expect(await client.recoveryState({ widgetId: 'passport-checker' })).toBeInstanceOf(
      BrowserAutomationUnavailableError,
    )
  })

  it('rejects a malformed recovery state payload', async () => {
    const client = createHttpBrowserAutomationClient({
      baseUrl: 'http://automation:8788',
      timeoutMs: 1000,
      fetchImpl: async () => new Response(JSON.stringify({ retained: 'yes' }), { status: 200 }),
    })

    expect(await client.recoveryState({ widgetId: 'passport-checker' })).toBeInstanceOf(
      BrowserAutomationProtocolError,
    )
  })
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `pnpm --filter server exec vitest run src/browser/http-client.test.ts`
Expected: FAIL — `client.recoveryState is not a function`.

- [ ] **Step 3: Extend the client contract**

In `packages/server/src/browser/client.ts`:

```ts
export type BrowserAutomationRecoveryState = { retained: boolean }

export type BrowserAutomationClient = {
  invoke(args: BrowserAutomationInvokeArgs): Promise<BrowserAutomationClientResult>
  recoveryState(args: {
    widgetId: string
  }): Promise<BrowserGatewayError | BrowserAutomationRecoveryState>
}
```

- [ ] **Step 4: Implement it in the HTTP client**

In `packages/server/src/browser/http-client.ts`, import `RecoveryStateResponseSchema` from `@shared/browser-automation/protocol` and add a second method to the returned object:

```ts
    async recoveryState({ widgetId }) {
      // A liveness question, not a task: never make the operator wait out the
      // full task deadline before the panel can say "nothing to recover".
      const recoveryTimeoutMs = Math.min(timeoutMs, 5_000)
      const deadline = new BrowserAutomationDeadlineError({ timeoutMs: recoveryTimeoutMs })
      const controller = new AbortController()
      const timeout = setTimeout(() => controller.abort(deadline), recoveryTimeoutMs)
      timeout.unref?.()
      const clearDeadline = () => clearTimeout(timeout)

      const url = `${normalizedBaseUrl}/recovery/${encodeURIComponent(widgetId)}`
      const response: Response | BrowserAutomationUnavailableError = await fetchImpl(url, {
        method: 'GET',
        signal: controller.signal,
      }).catch((cause) => new BrowserAutomationUnavailableError({ operation: 'fetch', cause }))
      clearDeadline()
      if (errore.isAbortError(response)) return deadline
      if (response instanceof BrowserAutomationUnavailableError) return response
      if (response.status === 503) {
        return new BrowserAutomationUnavailableError({ operation: 'service' })
      }
      if (response.status !== 200) {
        return new BrowserAutomationProtocolError({
          phase: `http-${response.status}`,
          widgetId,
          taskId: 'recovery',
        })
      }

      const raw: unknown = await (response.json() as Promise<unknown>).catch(
        (cause) =>
          new BrowserAutomationProtocolError({
            phase: 'response-json',
            widgetId,
            taskId: 'recovery',
            cause,
          }),
      )
      if (raw instanceof BrowserAutomationProtocolError) return raw
      const parsed = RecoveryStateResponseSchema.safeParse(raw)
      if (!parsed.success) {
        return new BrowserAutomationProtocolError({
          phase: 'recovery-state',
          widgetId,
          taskId: 'recovery',
        })
      }
      return parsed.data
    },
```

- [ ] **Step 5: Extend the fake client**

In `packages/server/src/browser/testing/fake-client.ts`:

```ts
  const recoveryCalls: string[] = []
  let recovery: BrowserGatewayError | { retained: boolean } = { retained: false }

  const client: BrowserAutomationClient = {
    async invoke(args) {
      calls.push(args)
      return result
    },
    async recoveryState({ widgetId }) {
      recoveryCalls.push(widgetId)
      return recovery
    },
  }
```

and expose `recoveryCalls` plus `setRecoveryState(next: BrowserGatewayError | { retained: boolean }) { recovery = next }` from the returned object. Import `BrowserGatewayError` as a type from `@shared/widgets/browser-errors`.

- [ ] **Step 6: Run the server tests**

Run: `pnpm --filter server exec vitest run src/browser`
Expected: PASS.

- [ ] **Step 7: Commit**

```bash
git add packages/server/src/browser/client.ts packages/server/src/browser/http-client.ts packages/server/src/browser/http-client.test.ts packages/server/src/browser/testing/fake-client.ts
git commit -m "feat(server): query retained recovery state through the browser gateway"
```

---

### Task 4: Recovery configuration

**Files:**

- Modify: `packages/server/src/browser/config.ts`
- Test: `packages/server/src/browser/config.test.ts`

**Interfaces:**

- Consumes: nothing.
- Produces: `BrowserGatewayConfig.recovery: { upstreamUrl: string; tokenTtlMs: number; maxSessionMs: number }`, populated from `BROWSER_RECOVERY_URL` (default `http://browser-automation:6080`), `BROWSER_RECOVERY_TOKEN_TTL_MS` (default `60000`), `BROWSER_RECOVERY_MAX_SESSION_MS` (default `900000`).

- [ ] **Step 1: Write the failing tests**

Add to `packages/server/src/browser/config.test.ts`:

```ts
  it('defaults the recovery transport configuration', () => {
    const config = loadBrowserGatewayConfig({})
    if (config instanceof Error) throw config

    expect(config.recovery).toEqual({
      upstreamUrl: 'http://browser-automation:6080',
      tokenTtlMs: 60_000,
      maxSessionMs: 900_000,
    })
  })

  it('reads the recovery transport configuration from the environment', () => {
    const config = loadBrowserGatewayConfig({
      BROWSER_RECOVERY_URL: 'http://vnc:6080/',
      BROWSER_RECOVERY_TOKEN_TTL_MS: '5000',
      BROWSER_RECOVERY_MAX_SESSION_MS: '60000',
    })
    if (config instanceof Error) throw config

    expect(config.recovery).toEqual({
      upstreamUrl: 'http://vnc:6080',
      tokenTtlMs: 5_000,
      maxSessionMs: 60_000,
    })
  })

  it('rejects a non-http recovery url', () => {
    expect(loadBrowserGatewayConfig({ BROWSER_RECOVERY_URL: 'ws://vnc:6080' })).toBeInstanceOf(
      BrowserGatewayConfigError,
    )
  })
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `pnpm --filter server exec vitest run src/browser/config.test.ts`
Expected: FAIL — `config.recovery` is `undefined`.

- [ ] **Step 3: Implement the configuration**

In `packages/server/src/browser/config.ts`, extend the exported type:

```ts
export type BrowserGatewayConfig = {
  baseUrl: string
  timeoutMs: number
  recovery: {
    upstreamUrl: string
    tokenTtlMs: number
    maxSessionMs: number
  }
}
```

add to `ConfigSchema` (reusing the existing `urlSchema` and `positiveIntEnv` helpers):

```ts
  BROWSER_RECOVERY_URL: z.preprocess(
    (value) => (value === undefined || value === '' ? 'http://browser-automation:6080' : value),
    urlSchema,
  ),
  BROWSER_RECOVERY_TOKEN_TTL_MS: positiveIntEnv(60_000),
  BROWSER_RECOVERY_MAX_SESSION_MS: positiveIntEnv(900_000),
```

and extend the returned object:

```ts
    recovery: {
      upstreamUrl: parsed.data.BROWSER_RECOVERY_URL,
      tokenTtlMs: parsed.data.BROWSER_RECOVERY_TOKEN_TTL_MS,
      maxSessionMs: parsed.data.BROWSER_RECOVERY_MAX_SESSION_MS,
    },
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `pnpm --filter server exec vitest run src/browser/config.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add packages/server/src/browser/config.ts packages/server/src/browser/config.test.ts
git commit -m "feat(server): configure the browser recovery transport"
```

---

### Task 5: Capability store

**Files:**

- Create: `packages/server/src/recovery/capability.ts`
- Create: `packages/server/src/recovery/capability.test.ts`

**Interfaces:**

- Consumes: nothing.
- Produces:
  - `makeRecoveryCapabilityStore(deps: { now: () => number; tokenTtlMs: number }): RecoveryCapabilityStore`;
  - `RecoveryCapabilityStore` with `issue({ widgetId, sessionId }) => { token: string; expiresInMs: number }`, `consume({ token, sessionId }) => RecoveryCapabilityError | { widgetId: string }`, `isBusy() => boolean`, `attach(connection)`, `detach(connection)`, `revoke(widgetId)`, `revokeAll()`;
  - `RecoveryConnection = { widgetId: string; destroy: () => void }`;
  - `RecoveryCapabilityError` (tagged, `$reason` of `'missing' | 'unknown' | 'expired' | 'session_mismatch'`).

- [ ] **Step 1: Write the failing test**

Create `packages/server/src/recovery/capability.test.ts`:

```ts
import { describe, expect, it } from 'vitest'

import { makeRecoveryCapabilityStore, RecoveryCapabilityError } from './capability'

function makeStore(startMs = 1_000) {
  let nowMs = startMs
  const store = makeRecoveryCapabilityStore({ now: () => nowMs, tokenTtlMs: 60_000 })
  return { store, advance: (ms: number) => (nowMs += ms) }
}

describe('makeRecoveryCapabilityStore', () => {
  it('issues a token that can be consumed exactly once', () => {
    const { store } = makeStore()
    const { token, expiresInMs } = store.issue({ widgetId: 'passport-checker', sessionId: 's-1' })

    expect(expiresInMs).toBe(60_000)
    expect(store.consume({ token, sessionId: 's-1' })).toEqual({ widgetId: 'passport-checker' })
    expect(store.consume({ token, sessionId: 's-1' })).toBeInstanceOf(RecoveryCapabilityError)
  })

  it('rejects a missing, expired, or foreign-session token', () => {
    const { store, advance } = makeStore()

    expect(store.consume({ token: undefined, sessionId: 's-1' })).toBeInstanceOf(
      RecoveryCapabilityError,
    )

    const expired = store.issue({ widgetId: 'passport-checker', sessionId: 's-1' })
    advance(60_001)
    expect(store.consume({ token: expired.token, sessionId: 's-1' })).toBeInstanceOf(
      RecoveryCapabilityError,
    )

    const foreign = store.issue({ widgetId: 'passport-checker', sessionId: 's-1' })
    expect(store.consume({ token: foreign.token, sessionId: 's-2' })).toBeInstanceOf(
      RecoveryCapabilityError,
    )
    // A token seen by another session is treated as compromised, not retryable.
    expect(store.consume({ token: foreign.token, sessionId: 's-1' })).toBeInstanceOf(
      RecoveryCapabilityError,
    )
  })

  it('keeps only the newest token per widget', () => {
    const { store } = makeStore()
    const first = store.issue({ widgetId: 'passport-checker', sessionId: 's-1' })
    const second = store.issue({ widgetId: 'passport-checker', sessionId: 's-1' })

    expect(store.consume({ token: first.token, sessionId: 's-1' })).toBeInstanceOf(
      RecoveryCapabilityError,
    )
    expect(store.consume({ token: second.token, sessionId: 's-1' })).toEqual({
      widgetId: 'passport-checker',
    })
  })

  it('tracks one active connection and revokes it per widget', () => {
    const { store } = makeStore()
    let destroyed = 0
    const connection = { widgetId: 'passport-checker', destroy: () => (destroyed += 1) }

    expect(store.isBusy()).toBe(false)
    store.attach(connection)
    expect(store.isBusy()).toBe(true)

    store.revoke('other-widget')
    expect(destroyed).toBe(0)

    store.revoke('passport-checker')
    expect(destroyed).toBe(1)
    expect(store.isBusy()).toBe(false)
  })

  it('drops every token and connection on revokeAll', () => {
    const { store } = makeStore()
    let destroyed = 0
    const { token } = store.issue({ widgetId: 'passport-checker', sessionId: 's-1' })
    store.attach({ widgetId: 'passport-checker', destroy: () => (destroyed += 1) })

    store.revokeAll()

    expect(destroyed).toBe(1)
    expect(store.isBusy()).toBe(false)
    expect(store.consume({ token, sessionId: 's-1' })).toBeInstanceOf(RecoveryCapabilityError)
  })

  it('detaches only the connection that is still active', () => {
    const { store } = makeStore()
    const first = { widgetId: 'a', destroy: () => {} }
    const second = { widgetId: 'b', destroy: () => {} }

    store.attach(first)
    store.detach(second)
    expect(store.isBusy()).toBe(true)

    store.detach(first)
    expect(store.isBusy()).toBe(false)
  })
})
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `pnpm --filter server exec vitest run src/recovery/capability.test.ts`
Expected: FAIL — cannot resolve `./capability`.

- [ ] **Step 3: Implement the store**

Create `packages/server/src/recovery/capability.ts`:

```ts
import { randomBytes } from 'node:crypto'

import * as errore from 'errore'

export class RecoveryCapabilityError extends errore.createTaggedError({
  name: 'RecoveryCapabilityError',
  message: 'Recovery capability is not usable ($reason)',
}) {}

export type RecoveryConnection = {
  widgetId: string
  destroy: () => void
}

export type RecoveryCapabilityStore = {
  issue(args: { widgetId: string; sessionId: string }): { token: string; expiresInMs: number }
  consume(args: {
    token: string | undefined
    sessionId: string
  }): RecoveryCapabilityError | { widgetId: string }
  isBusy(): boolean
  attach(connection: RecoveryConnection): void
  detach(connection: RecoveryConnection): void
  revoke(widgetId: string): void
  revokeAll(): void
}

type Entry = { widgetId: string; sessionId: string; expiresAt: number }

export function makeRecoveryCapabilityStore(deps: {
  now: () => number
  tokenTtlMs: number
}): RecoveryCapabilityStore {
  const entries = new Map<string, Entry>()
  let active: RecoveryConnection | null = null

  function dropWidgetTokens(widgetId: string): void {
    for (const [token, entry] of entries) {
      if (entry.widgetId === widgetId) entries.delete(token)
    }
  }

  function sweepExpired(): void {
    const nowMs = deps.now()
    for (const [token, entry] of entries) {
      if (entry.expiresAt <= nowMs) entries.delete(token)
    }
  }

  function destroyActive(): void {
    const connection = active
    active = null
    connection?.destroy()
  }

  return {
    issue({ widgetId, sessionId }) {
      sweepExpired()
      // One live token per widget: re-opening the panel supersedes the token
      // the previous attempt never used.
      dropWidgetTokens(widgetId)
      const token = randomBytes(32).toString('base64url')
      entries.set(token, { widgetId, sessionId, expiresAt: deps.now() + deps.tokenTtlMs })
      return { token, expiresInMs: deps.tokenTtlMs }
    },
    consume({ token, sessionId }) {
      if (!token) return new RecoveryCapabilityError({ reason: 'missing' })
      const entry = entries.get(token)
      if (!entry) return new RecoveryCapabilityError({ reason: 'unknown' })
      // Single use: the token dies on the first attempt, successful or not. A
      // token presented by another session is treated as compromised.
      entries.delete(token)
      if (entry.expiresAt <= deps.now()) return new RecoveryCapabilityError({ reason: 'expired' })
      if (entry.sessionId !== sessionId) {
        return new RecoveryCapabilityError({ reason: 'session_mismatch' })
      }
      return { widgetId: entry.widgetId }
    },
    isBusy: () => active !== null,
    attach(connection) {
      active = connection
    },
    detach(connection) {
      if (active === connection) active = null
    },
    revoke(widgetId) {
      dropWidgetTokens(widgetId)
      if (active?.widgetId === widgetId) destroyActive()
    },
    revokeAll() {
      entries.clear()
      destroyActive()
    },
  }
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `pnpm --filter server exec vitest run src/recovery/capability.test.ts`
Expected: PASS — 6 tests.

- [ ] **Step 5: Commit**

```bash
git add packages/server/src/recovery/capability.ts packages/server/src/recovery/capability.test.ts
git commit -m "feat(server): add the single-use browser recovery capability store"
```

---

### Task 6: Capability issue endpoint

**Files:**

- Create: `packages/server/src/recovery/cookie.ts`
- Create: `packages/server/src/recovery/handlers.ts`
- Create: `packages/server/src/recovery/handlers.test.ts`
- Modify: `packages/server/src/app.ts`
- Test: `packages/server/src/app.test.ts`

**Interfaces:**

- Consumes: `makeRecoveryCapabilityStore` (Task 5), `BrowserAutomationClient.recoveryState` (Task 3), `BrowserGatewayConfig.recovery` (Task 4), `requireSession`/`isAuthResult` from `./auth/session-guard`, `serializeCookie` from `./auth/cookies`.
- Produces:
  - `recoveryCookieName(secureCookies: boolean): string`;
  - `serializeRecoveryCookie(args: { token: string; ttlMs: number; secureCookies: boolean }): string`;
  - `RECOVERY_COOKIE_PATH = '/api/browser/recovery'`;
  - `handleRecoveryIssue(deps, args): Promise<{ status: number; body: unknown; cookie?: string }>`;
  - route `POST /api/browser/recovery/:widgetId`.

- [ ] **Step 1: Write the failing cookie + handler tests**

Create `packages/server/src/recovery/handlers.test.ts`:

```ts
import { BrowserAutomationUnavailableError } from '@shared/widgets/browser-errors'
import { describe, expect, it } from 'vitest'

import { makeFakeBrowserAutomationClient } from '../testing/fake-client'
import { makeRecoveryCapabilityStore } from './capability'
import { recoveryCookieName, serializeRecoveryCookie } from './cookie'
import { handleRecoveryIssue } from './handlers'

function makeDeps(overrides?: { secureCookies?: boolean }) {
  const fake = makeFakeBrowserAutomationClient()
  const store = makeRecoveryCapabilityStore({ now: () => 1_000, tokenTtlMs: 60_000 })
  return {
    fake,
    store,
    deps: {
      store,
      client: fake.client,
      secureCookies: overrides?.secureCookies ?? true,
      tokenTtlMs: 60_000,
    },
  }
}

describe('recovery cookie', () => {
  it('uses the __Secure- prefix only on a secure origin', () => {
    expect(recoveryCookieName(true)).toBe('__Secure-mb_recovery')
    expect(recoveryCookieName(false)).toBe('mb_recovery')
  })

  it('scopes the cookie to the recovery path', () => {
    const secure = serializeRecoveryCookie({ token: 'tok', ttlMs: 60_000, secureCookies: true })

    expect(secure).toContain('__Secure-mb_recovery=tok')
    expect(secure).toContain('Path=/api/browser/recovery')
    expect(secure).toContain('Max-Age=60')
    expect(secure).toContain('HttpOnly')
    expect(secure).toContain('Secure')
    expect(secure).toContain('SameSite=Strict')

    const insecure = serializeRecoveryCookie({ token: 'tok', ttlMs: 60_000, secureCookies: false })
    expect(insecure).toContain('mb_recovery=tok')
    expect(insecure).not.toContain('Secure')
  })
})

describe('handleRecoveryIssue', () => {
  it('issues a capability when a retained page exists', async () => {
    const { deps, fake } = makeDeps()
    fake.setRecoveryState({ retained: true })

    const result = await handleRecoveryIssue(deps, {
      widgetId: 'passport-checker',
      sessionId: 's-1',
    })

    expect(result.status).toBe(200)
    expect(result.body).toEqual({ expiresInMs: 60_000 })
    expect(result.cookie).toContain('__Secure-mb_recovery=')
    expect(fake.recoveryCalls).toEqual(['passport-checker'])
  })

  it('reports nothing to recover when no page is retained', async () => {
    const { deps, fake } = makeDeps()
    fake.setRecoveryState({ retained: false })

    const result = await handleRecoveryIssue(deps, {
      widgetId: 'passport-checker',
      sessionId: 's-1',
    })

    expect(result).toEqual({ status: 404, body: { code: 'recovery_unavailable' } })
  })

  it('rejects an unsafe widget id without calling the service', async () => {
    const { deps, fake } = makeDeps()

    const result = await handleRecoveryIssue(deps, {
      widgetId: '../../etc/passwd',
      sessionId: 's-1',
    })

    expect(result).toEqual({ status: 404, body: { code: 'recovery_unavailable' } })
    expect(fake.recoveryCalls).toEqual([])
  })

  it('refuses while a recovery session is already active', async () => {
    const { deps, store, fake } = makeDeps()
    fake.setRecoveryState({ retained: true })
    store.attach({ widgetId: 'passport-checker', destroy: () => {} })

    const result = await handleRecoveryIssue(deps, {
      widgetId: 'passport-checker',
      sessionId: 's-1',
    })

    expect(result).toEqual({ status: 409, body: { code: 'recovery_busy' } })
    expect(fake.recoveryCalls).toEqual([])
  })

  it('maps an unreachable automation service to 503', async () => {
    const { deps, fake } = makeDeps()
    fake.setRecoveryState(new BrowserAutomationUnavailableError({ operation: 'fetch' }))

    const result = await handleRecoveryIssue(deps, {
      widgetId: 'passport-checker',
      sessionId: 's-1',
    })

    expect(result).toEqual({ status: 503, body: { code: 'automation_unavailable' } })
  })
})
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `pnpm --filter server exec vitest run src/recovery/handlers.test.ts`
Expected: FAIL — cannot resolve `./cookie` and `./handlers`.

- [ ] **Step 3: Implement the cookie helpers**

Create `packages/server/src/recovery/cookie.ts`:

```ts
import { serializeCookie } from '../../auth/cookies'

// `__Host-` is unavailable here: it demands Path=/, and this cookie is
// deliberately scoped to the recovery routes. `__Secure-` allows a narrow path
// and still requires HTTPS; a plain-http dev origin drops the prefix, exactly
// like the auth cookies do.
const SECURE_COOKIE_NAME = '__Secure-mb_recovery'
const INSECURE_COOKIE_NAME = 'mb_recovery'

export const RECOVERY_COOKIE_PATH = '/api/browser/recovery'

export function recoveryCookieName(secureCookies: boolean): string {
  return secureCookies ? SECURE_COOKIE_NAME : INSECURE_COOKIE_NAME
}

export function serializeRecoveryCookie(args: {
  token: string
  ttlMs: number
  secureCookies: boolean
}): string {
  return serializeCookie(recoveryCookieName(args.secureCookies), args.token, {
    maxAgeMs: args.ttlMs,
    httpOnly: true,
    secure: args.secureCookies,
    sameSite: 'Strict',
    path: RECOVERY_COOKIE_PATH,
  })
}
```

- [ ] **Step 4: Implement the handler**

Create `packages/server/src/recovery/handlers.ts`:

```ts
import type { BrowserAutomationClient } from '../client'
import type { RecoveryCapabilityStore } from './capability'
import { serializeRecoveryCookie } from './cookie'

// Widget ids are codegen-generated slugs; anything else must never reach an
// upstream URL.
const SAFE_WIDGET_ID = /^[a-z0-9][a-z0-9-]{0,63}$/

export type RecoveryIssueDeps = {
  store: RecoveryCapabilityStore
  client: BrowserAutomationClient
  secureCookies: boolean
  tokenTtlMs: number
}

export type RecoveryIssueResult = {
  status: number
  body: unknown
  cookie?: string
}

const unavailable: RecoveryIssueResult = {
  status: 404,
  body: { code: 'recovery_unavailable' },
}

export async function handleRecoveryIssue(
  deps: RecoveryIssueDeps,
  args: { widgetId: string; sessionId: string },
): Promise<RecoveryIssueResult> {
  if (!SAFE_WIDGET_ID.test(args.widgetId)) return unavailable
  if (deps.store.isBusy()) return { status: 409, body: { code: 'recovery_busy' } }

  const state = await deps.client.recoveryState({ widgetId: args.widgetId })
  if (state instanceof Error) return { status: 503, body: { code: 'automation_unavailable' } }
  if (!state.retained) return unavailable

  const { token, expiresInMs } = deps.store.issue({
    widgetId: args.widgetId,
    sessionId: args.sessionId,
  })
  return {
    status: 200,
    body: { expiresInMs },
    cookie: serializeRecoveryCookie({
      token,
      ttlMs: deps.tokenTtlMs,
      secureCookies: deps.secureCookies,
    }),
  }
}
```

- [ ] **Step 5: Run the tests to verify they pass**

Run: `pnpm --filter server exec vitest run src/recovery/handlers.test.ts`
Expected: PASS — 7 tests.

- [ ] **Step 6: Write the failing route test**

`createApp` currently takes no recovery configuration. Add to `packages/server/src/app.test.ts`, using the file's existing `seedAccountWithSession` helper and app bootstrap (the snippet assumes the file's existing `app`, `base`, `ops`, and `fakeBrowser` fixtures — reuse them verbatim; `nowMs` is whatever clock value that file already pins):

```ts
  it('issues a recovery capability for a retained page', async () => {
    const { session } = await seedAccountWithSession(ops, nowMs, 'cred-recovery')
    fakeBrowser.setRecoveryState({ retained: true })

    const response = await fetch(`${base}/api/browser/recovery/passport-checker`, {
      method: 'POST',
      headers: {
        cookie: `session=${session.sessionId}`,
        'x-requested-with': 'MyBoard',
      },
    })

    expect(response.status).toBe(200)
    expect(await response.json()).toEqual({ expiresInMs: 60_000 })
    expect(response.headers.getSetCookie().join(';')).toContain('mb_recovery=')
  })

  it('refuses to issue a recovery capability without a session', async () => {
    fakeBrowser.setRecoveryState({ retained: true })

    const response = await fetch(`${base}/api/browser/recovery/passport-checker`, {
      method: 'POST',
      headers: { 'x-requested-with': 'MyBoard' },
    })

    expect(response.status).toBe(401)
  })
```

If the existing suite creates its app through a local helper, extend that helper to pass the new `recovery` dependency described in Step 7 rather than duplicating the bootstrap.

- [ ] **Step 7: Wire the route into the app**

In `packages/server/src/app.ts`:

1. add to `AppDeps`:

```ts
  recovery: {
    tokenTtlMs: number
    maxSessionMs: number
    upstreamUrl: string
  }
```

2. import the store, handler, and cookie helpers, and build the store next to `authDeps`:

```ts
  const recoveryStore = makeRecoveryCapabilityStore({
    now,
    tokenTtlMs: deps.recovery.tokenTtlMs,
  })
```

3. register the route after the widget dispatch route:

```ts
  router.on('POST', '/api/browser/recovery/:widgetId', async (req, res, params) => {
    const session = await requireSession(authDeps, req)
    if (isAuthResult(session)) {
      res.writeHead(session.status, { 'content-type': 'application/json' })
      res.end(JSON.stringify(session.body))
      return
    }

    const result = await handleRecoveryIssue(
      {
        store: recoveryStore,
        client: deps.browserClient,
        secureCookies: deps.authConfig.secureCookies,
        tokenTtlMs: deps.recovery.tokenTtlMs,
      },
      {
        widgetId: decodeURIComponent(params.widgetId as string),
        sessionId: session.sessionId,
      },
    )

    const headers: Record<string, string | string[]> = { 'content-type': 'application/json' }
    if (result.cookie) headers['set-cookie'] = [result.cookie]
    res.writeHead(result.status, headers)
    res.end(JSON.stringify(result.body))
  })
```

4. pass `recovery: browserConfig.recovery` at both production call sites: `packages/server/src/index.ts` and `packages/server/src/test-server.ts` (both already load `browserConfig`).

`recovery` is a required dependency, so **every** `createApp(...)` call must supply it. Run `rg -n "createApp\(" packages/server/src` and fix each test call site with:

```ts
  recovery: { tokenTtlMs: 60_000, maxSessionMs: 60_000, upstreamUrl: 'http://127.0.0.1:1' },
```

(port 1 is unreachable on purpose: suites that do not test the tunnel must never open a real upstream connection).

- [ ] **Step 8: Run the server tests**

Run: `pnpm --filter server exec vitest run`
Expected: PASS — including the two new app tests.

- [ ] **Step 9: Commit**

```bash
git add packages/server/src/recovery packages/server/src/app.ts packages/server/src/app.test.ts packages/server/src/index.ts packages/server/src/test-server.ts
git commit -m "feat(server): issue single-use browser recovery capabilities"
```

---

### Task 7: WebSocket upgrade tunnel

**Files:**

- Create: `packages/server/src/recovery/tunnel.ts`
- Create: `packages/server/src/recovery/tunnel.test.ts`
- Modify: `packages/server/src/app.ts`
- Modify: `packages/server/package.json` (devDependency `ws`, `@types/ws`)

**Interfaces:**

- Consumes: `RecoveryCapabilityStore` (Task 5), `recoveryCookieName` (Task 6), `deps.recovery.upstreamUrl` / `maxSessionMs` (Task 4), `parseCookies` from `./auth/cookies`.
- Produces:
  - `RECOVERY_SOCKET_PATH = '/api/browser/recovery/socket'`;
  - `makeRecoveryTunnel(deps): (req: IncomingMessage, socket: Duplex, head: Buffer) => Promise<void>`;
  - `server.on('upgrade', …)` wiring and `revokeAll()` on app close.

- [ ] **Step 1: Add the test-only WebSocket dependency**

```bash
pnpm --filter server add -D ws @types/ws
```

Expected: `packages/server/package.json` gains both under `devDependencies`. The runtime bundle must not import `ws` — it is used only by tests.

- [ ] **Step 2: Write the failing tunnel test**

Create `packages/server/src/recovery/tunnel.test.ts`:

```ts
import type { AddressInfo } from 'node:net'

import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { WebSocket, WebSocketServer } from 'ws'

import { makeRecoveryCapabilityStore, type RecoveryCapabilityStore } from './capability'
import { makeRecoveryTunnel, RECOVERY_SOCKET_PATH } from './tunnel'
import { createServer, type Server } from 'node:http'

type Upstream = {
  server: WebSocketServer
  url: string
  received: Buffer[]
  lastHeaders: Record<string, string | string[] | undefined>
  send: (data: Buffer) => void
  close: () => Promise<void>
}

async function startUpstream(): Promise<Upstream> {
  const received: Buffer[] = []
  let lastHeaders: Record<string, string | string[] | undefined> = {}
  let socket: WebSocket | null = null
  const server = new WebSocketServer({ port: 0 })
  server.on('connection', (ws, req) => {
    socket = ws
    lastHeaders = req.headers
    ws.on('message', (data: Buffer) => received.push(Buffer.from(data)))
  })
  await new Promise<void>((resolve) => server.on('listening', resolve))
  const { port } = server.address() as AddressInfo
  return {
    server,
    url: `http://127.0.0.1:${port}`,
    received,
    get lastHeaders() {
      return lastHeaders
    },
    send: (data) => socket?.send(data),
    close: () => new Promise<void>((resolve) => server.close(() => resolve())),
  }
}

describe('makeRecoveryTunnel', () => {
  let upstream: Upstream
  let server: Server
  let store: RecoveryCapabilityStore
  let base: string
  let nowMs: number

  beforeEach(async () => {
    nowMs = 1_000
    upstream = await startUpstream()
    store = makeRecoveryCapabilityStore({ now: () => nowMs, tokenTtlMs: 60_000 })
    const tunnel = makeRecoveryTunnel({
      store,
      upstreamUrl: upstream.url,
      maxSessionMs: 60_000,
      cookieName: 'mb_recovery',
      resolveSession: async (req) =>
        req.headers.cookie?.includes('session=good') ? { sessionId: 's-1' } : null,
    })
    server = createServer((_req, res) => {
      res.writeHead(404)
      res.end()
    })
    server.on('upgrade', (req, socket, head) => {
      void tunnel(req, socket, head)
    })
    await new Promise<void>((resolve) => server.listen(0, resolve))
    base = `ws://127.0.0.1:${(server.address() as AddressInfo).port}`
  })

  afterEach(async () => {
    store.revokeAll()
    await new Promise<void>((resolve) => server.close(() => resolve()))
    await upstream.close()
  })

  function connect(cookie: string) {
    return new WebSocket(`${base}${RECOVERY_SOCKET_PATH}`, { headers: { cookie } })
  }

  function opened(ws: WebSocket) {
    return new Promise<Error | 'open'>((resolve) => {
      ws.on('open', () => resolve('open'))
      ws.on('error', (error) => resolve(error))
    })
  }

  it('pipes binary frames in both directions and hides board cookies', async () => {
    const { token } = store.issue({ widgetId: 'passport-checker', sessionId: 's-1' })
    const ws = connect(`session=good; mb_recovery=${token}`)

    expect(await opened(ws)).toBe('open')
    ws.send(Buffer.from('RFB 003.008\n'))
    await expect
      .poll(() => upstream.received.map((chunk) => chunk.toString()))
      .toEqual(['RFB 003.008\n'])
    expect(upstream.lastHeaders.cookie).toBeUndefined()

    const fromUpstream = new Promise<string>((resolve) =>
      ws.on('message', (data: Buffer) => resolve(Buffer.from(data).toString())),
    )
    upstream.send(Buffer.from('RFB 003.008\n'))
    expect(await fromUpstream).toBe('RFB 003.008\n')

    ws.close()
  })

  it('rejects a connection without a board session', async () => {
    const { token } = store.issue({ widgetId: 'passport-checker', sessionId: 's-1' })
    const result = await opened(connect(`mb_recovery=${token}`))

    expect(result).toBeInstanceOf(Error)
    expect(String(result)).toContain('401')
  })

  it('rejects missing, reused, and expired capabilities', async () => {
    expect(String(await opened(connect('session=good')))).toContain('401')

    const { token } = store.issue({ widgetId: 'passport-checker', sessionId: 's-1' })
    const first = connect(`session=good; mb_recovery=${token}`)
    expect(await opened(first)).toBe('open')
    first.close()
    await expect.poll(() => store.isBusy()).toBe(false)
    expect(String(await opened(connect(`session=good; mb_recovery=${token}`)))).toContain('401')

    const expired = store.issue({ widgetId: 'passport-checker', sessionId: 's-1' })
    nowMs += 60_001
    expect(String(await opened(connect(`session=good; mb_recovery=${expired.token}`)))).toContain(
      '401',
    )
  })

  it('refuses a second concurrent connection and keeps the first alive', async () => {
    const first = store.issue({ widgetId: 'passport-checker', sessionId: 's-1' })
    const firstSocket = connect(`session=good; mb_recovery=${first.token}`)
    expect(await opened(firstSocket)).toBe('open')

    const second = store.issue({ widgetId: 'passport-checker', sessionId: 's-1' })
    expect(String(await opened(connect(`session=good; mb_recovery=${second.token}`)))).toContain(
      '409',
    )
    expect(firstSocket.readyState).toBe(WebSocket.OPEN)

    firstSocket.close()
  })

  it('destroys the live connection when the capability is revoked', async () => {
    const { token } = store.issue({ widgetId: 'passport-checker', sessionId: 's-1' })
    const ws = connect(`session=good; mb_recovery=${token}`)
    expect(await opened(ws)).toBe('open')

    const closed = new Promise<void>((resolve) => ws.on('close', () => resolve()))
    store.revoke('passport-checker')

    await closed
    expect(store.isBusy()).toBe(false)
  })

  it('rejects any other upgrade path', async () => {
    const ws = new WebSocket(`${base}/api/storage/events`, {
      headers: { cookie: 'session=good' },
    })
    expect(String(await opened(ws))).toContain('404')
  })
})
```

- [ ] **Step 3: Run the test to verify it fails**

Run: `pnpm --filter server exec vitest run src/recovery/tunnel.test.ts`
Expected: FAIL — cannot resolve `./tunnel`.

- [ ] **Step 4: Implement the tunnel**

Create `packages/server/src/recovery/tunnel.ts`:

```ts
import type { IncomingMessage } from 'node:http'
import { connect as connectTcp } from 'node:net'
import type { Duplex } from 'node:stream'

import { parseCookies } from '../../auth/cookies'
import type { RecoveryCapabilityStore, RecoveryConnection } from './capability'

export const RECOVERY_SOCKET_PATH = '/api/browser/recovery/socket'

// Handshake headers are forwarded verbatim so the browser and websockify
// negotiate end to end. Everything else -- Cookie above all -- is dropped: no
// board credential may reach the browser container.
const HANDSHAKE_HEADERS = [
  'upgrade',
  'connection',
  'sec-websocket-key',
  'sec-websocket-version',
  'sec-websocket-protocol',
  'sec-websocket-extensions',
] as const

export type RecoveryTunnelDeps = {
  store: RecoveryCapabilityStore
  upstreamUrl: string
  maxSessionMs: number
  cookieName: string
  resolveSession: (req: IncomingMessage) => Promise<{ sessionId: string } | null>
}

function refuse(socket: Duplex, status: number, reason: string): void {
  // No negotiated protocol exists yet, so a bare status line is the only way to
  // say no. Never include a body: it would describe internal state.
  socket.write(`HTTP/1.1 ${status} ${reason}\r\nConnection: close\r\n\r\n`)
  socket.destroy()
}

function upgradeRequestFor(req: IncomingMessage, host: string): string {
  const lines = ['GET / HTTP/1.1', `Host: ${host}`]
  for (const name of HANDSHAKE_HEADERS) {
    const value = req.headers[name]
    if (typeof value === 'string') lines.push(`${name}: ${value}`)
  }
  return `${lines.join('\r\n')}\r\n\r\n`
}

export function makeRecoveryTunnel(deps: RecoveryTunnelDeps) {
  const upstreamUrl = new URL(deps.upstreamUrl)
  const upstreamPort = Number(upstreamUrl.port || 80)

  return async function handleUpgrade(
    req: IncomingMessage,
    socket: Duplex,
    head: Buffer,
  ): Promise<void> {
    socket.on('error', () => socket.destroy())

    const path = (req.url ?? '').split('?')[0]
    if (path !== RECOVERY_SOCKET_PATH) return refuse(socket, 404, 'Not Found')

    const session = await deps.resolveSession(req)
    if (!session) return refuse(socket, 401, 'Unauthorized')
    if (socket.destroyed) return
    if (deps.store.isBusy()) return refuse(socket, 409, 'Conflict')

    const token = parseCookies(req.headers.cookie)[deps.cookieName]
    const capability = deps.store.consume({ token, sessionId: session.sessionId })
    if (capability instanceof Error) return refuse(socket, 401, 'Unauthorized')

    const upstream = connectTcp({ host: upstreamUrl.hostname, port: upstreamPort })
    let settled = false
    let timer: NodeJS.Timeout | null = null

    const connection: RecoveryConnection = {
      widgetId: capability.widgetId,
      destroy: () => {
        upstream.destroy()
        socket.destroy()
      },
    }

    const teardown = () => {
      if (timer) clearTimeout(timer)
      timer = null
      deps.store.detach(connection)
      upstream.destroy()
      socket.destroy()
    }

    deps.store.attach(connection)

    upstream.on('connect', () => {
      settled = true
      upstream.write(upgradeRequestFor(req, `${upstreamUrl.hostname}:${upstreamPort}`))
      if (head.length > 0) upstream.write(head)
      socket.pipe(upstream)
      upstream.pipe(socket)
      timer = setTimeout(teardown, deps.maxSessionMs)
      timer.unref?.()
    })

    upstream.on('error', () => {
      deps.store.detach(connection)
      if (!settled) {
        refuse(socket, 503, 'Service Unavailable')
        return
      }
      teardown()
    })

    upstream.on('close', teardown)
    socket.on('close', teardown)
  }
}
```

- [ ] **Step 5: Run the test to verify it passes**

Run: `pnpm --filter server exec vitest run src/recovery/tunnel.test.ts`
Expected: PASS — 6 tests.

- [ ] **Step 6: Wire the tunnel into the app**

In `packages/server/src/app.ts`, after `const server = createServer(...)`:

```ts
  const recoveryTunnel = makeRecoveryTunnel({
    store: recoveryStore,
    upstreamUrl: deps.recovery.upstreamUrl,
    maxSessionMs: deps.recovery.maxSessionMs,
    cookieName: recoveryCookieName(deps.authConfig.secureCookies),
    resolveSession: async (req) => {
      const session = await requireSession(authDeps, req)
      return isAuthResult(session) ? null : { sessionId: session.sessionId }
    },
  })

  server.on('upgrade', (req, socket, head) => {
    void recoveryTunnel(req, socket, head)
  })
```

and destroy the live connection in `close` before the server closes, so a pending socket cannot keep the process alive:

```ts
  const close = async (): Promise<void> => {
    unsubscribe()
    recoveryStore.revokeAll()
    await new Promise<void>((resolve) => server.close(() => resolve()))
  }
```

- [ ] **Step 7: Add the app-level shutdown test**

Add to `packages/server/src/app.test.ts` (reusing the suite's app fixtures):

```ts
  it('closes the app even with a live recovery socket', async () => {
    const { session } = await seedAccountWithSession(ops, nowMs, 'cred-recovery-close')
    fakeBrowser.setRecoveryState({ retained: true })
    const issued = await fetch(`${base}/api/browser/recovery/passport-checker`, {
      method: 'POST',
      headers: { cookie: `session=${session.sessionId}`, 'x-requested-with': 'MyBoard' },
    })
    expect(issued.status).toBe(200)

    // No upstream is listening in this suite, so the upgrade is refused; the
    // point is that app.close() resolves regardless.
    await expect(app.close()).resolves.toBeUndefined()
  })
```

Place it last in the file or in its own `describe` so it does not close the shared app before other tests run; if the suite tears the app down in `afterEach`, recreate it in that block.

- [ ] **Step 8: Run the server tests**

Run: `pnpm --filter server exec vitest run`
Expected: PASS.

- [ ] **Step 9: Commit**

```bash
git add packages/server/src/recovery/tunnel.ts packages/server/src/recovery/tunnel.test.ts packages/server/src/app.ts packages/server/src/app.test.ts packages/server/package.json pnpm-lock.yaml
git commit -m "feat(server): tunnel the recovery websocket to internal websockify"
```

---

### Task 8: Revoke recovery before dispatching a browser task

**Files:**

- Create: `packages/server/src/recovery/revoking-client.ts`
- Create: `packages/server/src/recovery/revoking-client.test.ts`
- Modify: `packages/server/src/app.ts`

**Interfaces:**

- Consumes: `BrowserAutomationClient` (Task 3), `RecoveryCapabilityStore` (Task 5).
- Produces: `makeRecoveryRevokingClient({ client, store }): BrowserAutomationClient` — `invoke` revokes the widget's capability and live socket before delegating; `recoveryState` delegates untouched.

- [ ] **Step 1: Write the failing test**

Create `packages/server/src/recovery/revoking-client.test.ts`:

```ts
import { describe, expect, it } from 'vitest'

import { makeFakeBrowserAutomationClient } from '../testing/fake-client'
import { makeRecoveryCapabilityStore } from './capability'
import { makeRecoveryRevokingClient } from './revoking-client'

describe('makeRecoveryRevokingClient', () => {
  it('destroys the live recovery connection before dispatching a task', async () => {
    const fake = makeFakeBrowserAutomationClient()
    fake.setResult({ result: { ok: true } })
    const store = makeRecoveryCapabilityStore({ now: () => 1_000, tokenTtlMs: 60_000 })
    const order: string[] = []
    store.attach({ widgetId: 'passport-checker', destroy: () => order.push('destroyed') })
    const client = makeRecoveryRevokingClient({ client: fake.client, store })

    await client.invoke({ widgetId: 'passport-checker', taskId: 'check', payload: {} })
    order.push('dispatched')

    expect(order).toEqual(['destroyed', 'dispatched'])
    expect(store.isBusy()).toBe(false)
  })

  it('leaves another widget recovery session alone', async () => {
    const fake = makeFakeBrowserAutomationClient()
    fake.setResult({ result: { ok: true } })
    const store = makeRecoveryCapabilityStore({ now: () => 1_000, tokenTtlMs: 60_000 })
    let destroyed = 0
    store.attach({ widgetId: 'passport-checker', destroy: () => (destroyed += 1) })
    const client = makeRecoveryRevokingClient({ client: fake.client, store })

    await client.invoke({ widgetId: 'other-widget', taskId: 'check', payload: {} })

    expect(destroyed).toBe(0)
    expect(store.isBusy()).toBe(true)
  })

  it('delegates the availability query without revoking', async () => {
    const fake = makeFakeBrowserAutomationClient()
    fake.setRecoveryState({ retained: true })
    const store = makeRecoveryCapabilityStore({ now: () => 1_000, tokenTtlMs: 60_000 })
    let destroyed = 0
    store.attach({ widgetId: 'passport-checker', destroy: () => (destroyed += 1) })
    const client = makeRecoveryRevokingClient({ client: fake.client, store })

    expect(await client.recoveryState({ widgetId: 'passport-checker' })).toEqual({ retained: true })
    expect(destroyed).toBe(0)
  })
})
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `pnpm --filter server exec vitest run src/recovery/revoking-client.test.ts`
Expected: FAIL — cannot resolve `./revoking-client`.

- [ ] **Step 3: Implement the wrapper**

Create `packages/server/src/recovery/revoking-client.ts`:

```ts
import type { BrowserAutomationClient } from '../client'
import type { RecoveryCapabilityStore } from './capability'

/**
 * A task acquire closes the widget's retained page inside browser-automation.
 * Revoking here -- before the task travels -- guarantees the operator's socket
 * dies first instead of going blank on a page that vanished underneath it.
 */
export function makeRecoveryRevokingClient(deps: {
  client: BrowserAutomationClient
  store: RecoveryCapabilityStore
}): BrowserAutomationClient {
  return {
    async invoke(args) {
      deps.store.revoke(args.widgetId)
      return deps.client.invoke(args)
    },
    recoveryState(args) {
      return deps.client.recoveryState(args)
    },
  }
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `pnpm --filter server exec vitest run src/recovery/revoking-client.test.ts`
Expected: PASS — 3 tests.

- [ ] **Step 5: Use the wrapper in the app**

In `packages/server/src/app.ts`, right after `recoveryStore` is created:

```ts
  const browserClient = makeRecoveryRevokingClient({
    client: deps.browserClient,
    store: recoveryStore,
  })
```

and replace every later use of `deps.browserClient` (the widget dispatch call and the recovery issue handler) with `browserClient`.

- [ ] **Step 6: Run the server tests**

Run: `pnpm --filter server exec vitest run`
Expected: PASS.

- [ ] **Step 7: Commit**

```bash
git add packages/server/src/recovery/revoking-client.ts packages/server/src/recovery/revoking-client.test.ts packages/server/src/app.ts
git commit -m "feat(server): revoke recovery sessions before browser task dispatch"
```

---

### Task 9: Ingress, dev proxy, and infrastructure assertions

**Files:**

- Modify: `packages/client/nginx.conf`
- Modify: `packages/widget-sdk/src/vite/vite-dev-config.ts`
- Test: `packages/widget-sdk/src/vite/vite-dev-config.test.ts`
- Test: `scripts/infra.test.ts`

**Interfaces:**

- Consumes: `RECOVERY_SOCKET_PATH` value `/api/browser/recovery/socket` (Task 7).
- Produces: an exact-match nginx location for the socket path; `apiProxy()` returning a `ws: true` entry for that path in addition to the generic `/api` entry.

- [ ] **Step 1: Write the failing dev-proxy test**

Add to `packages/widget-sdk/src/vite/vite-dev-config.test.ts`:

```ts
  it('proxies the recovery websocket upgrade', () => {
    const proxy = apiProxy('http://localhost:8787')

    expect(proxy['/api/browser/recovery/socket']).toEqual({
      target: 'http://localhost:8787',
      changeOrigin: true,
      ws: true,
    })
    expect(proxy['/api']).toEqual({ target: 'http://localhost:8787', changeOrigin: true })
  })
```

- [ ] **Step 2: Write the failing infrastructure assertions**

In `scripts/infra.test.ts`, add the file read next to the other `readFileSync` constants at the top:

```ts
const nginxConf = readFileSync(resolve(root, 'packages/client/nginx.conf'), 'utf8')
```

and add a new `describe` block:

```ts
describe('recovery websocket ingress', () => {
  const location = nginxConf.slice(
    nginxConf.indexOf('location = /api/browser/recovery/socket'),
    nginxConf.indexOf('# ---- gated: board statics'),
  )

  it('gates the recovery socket behind the auth subrequest', () => {
    expect(nginxConf).toContain('location = /api/browser/recovery/socket')
    expect(location).toContain('auth_request /internal/auth;')
  })

  it('forwards the websocket upgrade headers', () => {
    expect(location).toContain('proxy_set_header Upgrade $http_upgrade;')
    expect(location).toContain('proxy_set_header Connection "upgrade";')
  })

  it('outlives the maximum recovery session', () => {
    expect(location).toContain('proxy_read_timeout 960s;')
    expect(location).toContain('proxy_send_timeout 960s;')
  })

  it('keeps the vnc bridge on the pi loopback only', () => {
    expect(compose).toContain("- '127.0.0.1:6080:6080'")
    expect(nginxConf).not.toContain('6080')
  })
})
```

`compose` in that file is `docker-compose.dev.yml`; use the production compose constant that the existing `browser-automation service wiring` describe block reads (`prodCompose` or equivalent — reuse whichever name that block already uses, do not introduce a second reader for the same file).

- [ ] **Step 3: Run both tests to verify they fail**

Run: `pnpm --filter widget-sdk exec vitest run src/vite/vite-dev-config.test.ts && pnpm exec vitest run scripts/infra.test.ts`
Expected: FAIL — the proxy entry and the nginx location are missing.

- [ ] **Step 4: Implement the dev proxy entry**

In `packages/widget-sdk/src/vite/vite-dev-config.ts`:

```ts
export function apiProxy(
  target = (globalThis as GlobalWithProcess).process?.env?.VITE_API_PROXY ??
    'http://localhost:8787',
) {
  return {
    // Vite only proxies an upgrade when `ws` is set, and the generic /api entry
    // must stay non-ws so SSE and plain requests are untouched.
    '/api/browser/recovery/socket': {
      target,
      changeOrigin: true,
      ws: true,
    },
    '/api': {
      target,
      changeOrigin: true,
    },
  }
}
```

- [ ] **Step 5: Implement the nginx location**

In `packages/client/nginx.conf`, insert between the `location /api/` block and the `# ---- gated: board statics` comment:

```nginx
    # ---- gated: recovery websocket ---------------------------------------
    # Exact match: it outranks the prefix /api/ block, which forwards no
    # Upgrade header and would drop an idle VNC session at its 60s read
    # timeout. The session gate still applies; the single-use capability
    # cookie is checked by Node on the upgrade.
    location = /api/browser/recovery/socket {
        auth_request /internal/auth;
        proxy_pass $upstream$request_uri;
        proxy_http_version 1.1;
        proxy_set_header Upgrade $http_upgrade;
        proxy_set_header Connection "upgrade";
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
        # Above BROWSER_RECOVERY_MAX_SESSION_MS: the server owns expiry.
        proxy_read_timeout 960s;
        proxy_send_timeout 960s;
        proxy_buffering off;
    }
```

- [ ] **Step 6: Run both tests to verify they pass**

Run: `pnpm --filter widget-sdk exec vitest run src/vite/vite-dev-config.test.ts && pnpm exec vitest run scripts/infra.test.ts`
Expected: PASS.

- [ ] **Step 7: Commit**

```bash
git add packages/client/nginx.conf packages/widget-sdk/src/vite/vite-dev-config.ts packages/widget-sdk/src/vite/vite-dev-config.test.ts scripts/infra.test.ts
git commit -m "feat(client): route the gated recovery websocket through the ingress"
```

---

### Task 10: Operator documentation and the opt-in stack check

**Files:**

- Create: `packages/server/src/recovery/recovery-stack.integration.test.ts`
- Modify: `packages/browser-automation/README.md` (or the operator doc that already documents the SSH fallback — locate it with `rg -l "AUTOMATION_SSH_TARGET" --glob '*.md'` and extend that file)

**Interfaces:**

- Consumes: the whole transport (Tasks 1-9).
- Produces: an opt-in test, skipped unless `BROWSER_IT=1`, that drives a real RFB handshake through the deployed stack; operator documentation for the embedded flow and the unchanged SSH fallback.

- [ ] **Step 1: Write the opt-in stack test**

Create `packages/server/src/recovery/recovery-stack.integration.test.ts`:

```ts
import { describe, expect, it } from 'vitest'
import { WebSocket } from 'ws'

// Opt-in: needs the assembled stack from `ALLOW_TEST_DB_RESET=1 pnpm start:docker`
// (client ingress on 127.0.0.1:8080, browser-automation with a retained page for
// RECOVERY_IT_WIDGET). Everything else runs against fakes, by design -- see the
// design doc's testing strategy.
const enabled = process.env.BROWSER_IT === '1'
const base = process.env.RECOVERY_IT_BASE ?? 'http://127.0.0.1:8080'
const widgetId = process.env.RECOVERY_IT_WIDGET ?? 'passport-checker'

describe.skipIf(!enabled)('recovery transport against the assembled stack', () => {
  it('reaches the retained page over one tokenized websocket', async () => {
    const seeded = await fetch(`${base}/api/test/seed-session`, { method: 'POST' })
    expect(seeded.status).toBe(200)
    const sessionCookie = seeded.headers.getSetCookie().join('; ')

    const issued = await fetch(`${base}/api/browser/recovery/${widgetId}`, {
      method: 'POST',
      headers: { cookie: sessionCookie, 'x-requested-with': 'MyBoard' },
    })
    expect(issued.status).toBe(200)
    const cookie = [sessionCookie, ...issued.headers.getSetCookie()].join('; ')

    const ws = new WebSocket(`${base.replace('http', 'ws')}/api/browser/recovery/socket`, {
      headers: { cookie },
    })
    const greeting = await new Promise<string>((resolve, reject) => {
      ws.on('message', (data: Buffer) => resolve(Buffer.from(data).toString()))
      ws.on('error', reject)
      setTimeout(() => reject(new Error('no RFB greeting')), 10_000)
    })

    // websockify hands through x11vnc's ProtocolVersion greeting verbatim.
    expect(greeting).toMatch(/^RFB \d{3}\.\d{3}\n$/)

    // Complete the version handshake, then prove input travels: a KeyEvent
    // (message type 4) for the Shift key, which changes nothing on screen.
    ws.send(Buffer.from(greeting))
    ws.send(Buffer.from([4, 1, 0, 0, 0, 0, 0xff, 0xe1]))
    expect(ws.readyState).toBe(WebSocket.OPEN)
    ws.close()
  })
})
```

- [ ] **Step 2: Verify the test is skipped by default**

Run: `pnpm --filter server exec vitest run src/recovery/recovery-stack.integration.test.ts`
Expected: PASS with the suite reported as skipped (no stack required).

- [ ] **Step 3: Document the operator flow**

In the operator doc that already documents `AUTOMATION_SSH_TARGET`, add a section stating:

- embedded recovery is the normal path: open the widget's recovery panel, which mints a single-use capability valid for 60 seconds and opens one WebSocket to the same origin;
- only one recovery session may be active at a time, and it ends after 15 minutes, on disconnect, or as soon as the widget runs its task again;
- the VNC port is still published only on the Pi loopback, so the SSH fallback (`ssh -L 6080:127.0.0.1:6080 $AUTOMATION_SSH_TARGET`, then `http://127.0.0.1:6080`) is unchanged and remains the fallback when the board itself is unreachable;
- a recovery session controls the entire shared display, so anyone who can open it can see and drive every page in the persistent Chromium profile.

- [ ] **Step 4: Run the full gate**

Run: `pnpm check`
Expected: lint, format, typecheck, and every workspace test pass.

- [ ] **Step 5: Commit**

```bash
git add packages/server/src/recovery/recovery-stack.integration.test.ts packages/browser-automation/README.md
git commit -m "docs(browser-automation): document embedded recovery and add the opt-in stack check"
```

---

## Verification

- `pnpm check` passes from the repo root.
- `pnpm --filter server exec vitest run src/browser` covers the capability store, issue endpoint, tunnel, and revoking client.
- `pnpm exec vitest run scripts/infra.test.ts` confirms the ingress and compose invariants.
- The opt-in `BROWSER_IT=1` run is expected to be exercised manually against `pnpm start:docker`, not in CI.
