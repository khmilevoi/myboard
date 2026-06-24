# Ofelia e2e — status / undo / debt Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Ship Playwright e2e coverage for the Ofelia widget's core duty feature (confirm / debt / forgive / undo / debt counter) on the standard board card, running against a real in-memory storage+SSE server with a deterministic clock, and fix the widget/server until those specs are green.

**Architecture:** Refactor the server into an injectable `createApp({ ops, subscribe, now, testControls })` factory. Production keeps Valkey ops + a Valkey pub/sub subscriber + `Date.now`. A new `test-server.ts` entry wires a `Map`-backed `ValkeyOps` and an in-process pub/sub emitter (so the `publishChange → storage:events → fanout` SSE round-trip fires without Docker) plus a settable clock and `/api/test/{time,reset}` control routes. Playwright runs the bundled test server on `:8787` and the client `vite preview` on `:4173`, with a `preview.proxy` forwarding `/api` to the test server.

**Tech Stack:** Node `node:http` + `find-my-way` + Zod (server); Vite/React + Reatom v1001 + Dexie + SSE (client); Playwright `@playwright/test`; rspack (server bundling); Vitest (unit); pnpm workspace.

## Global Constraints

- **Package manager:** pnpm workspace. Run commands from repo root; filter with `--filter client` / `--filter server`.
- **errore convention:** errors are values, never thrown across module boundaries. Server handlers return `{ status }` results; client APIs return `Error | T` unions. Do not introduce `throw` in storage/handler code paths (the existing `action(...)` wrappers re-throw internally on purpose — leave them).
- **Reatom component rule:** every exported React component in `client/src` and `client/widgets` is wrapped in `reatomMemo`. The only client UI change in this plan adds a `data-testid` to an existing `reatomMemo` component — do not unwrap it.
- **Production behaviour must stay identical:** `server/src/index.ts` after refactor must produce the same routes, the same `dist/index.cjs` output path, and the same `storage:events` Valkey wiring. The `node dist/index.cjs` start path and `dev.mjs` bundle-watch path must be unaffected.
- **Determinism (copy verbatim into the spec):** pin "today" to `2026-06-16T12:00:00+02:00` (noon Europe/Warsaw). With `BASE_DUTY_DATE = 2026-06-16` and rotation `['Леша', 'Карина']`, `getOfeliaDutyByDate(2026-06-16)` → `Леша` (diffDays 0, even).
- **Storage keys:** debts → `w:t:ofelia-poop-duty:debts`; history → `w:t:ofelia-poop-duty:history:<weekStartISO>` (shared/type scope, `w:t:<typeId>:` prefix). `currentUser` lives in Dexie (client scope) and resets with the browser context.
- **Formatting / lint:** run `pnpm format` (oxfmt) and `pnpm lint` (oxlint) before each commit; both must pass.
- **Guardrail:** existing unit suites stay green — `pnpm --filter client test` and `pnpm --filter server test`.

---

## File Structure

**Server**

- Create `server/src/test/memory-ops.ts` — in-memory `ValkeyOps` (`Map`-backed) + in-process pub/sub emitter. One responsibility: a Valkey-shaped backend with no I/O.
- Create `server/src/app.ts` — `createApp` factory: all routing/handlers extracted from `index.ts`, plus optional `/api/test/*` control routes.
- Create `server/src/test-server.ts` — test entry: wires memory ops + memory pub/sub + settable clock + test controls, then `listen`.
- Create `server/src/app.test.ts` — integration tests for `createApp` over memory ops.
- Modify `server/src/index.ts` — becomes the thin production entry calling `createApp` with Valkey deps.
- Modify `server/src/storage/handlers.ts` — `handleTime` takes an injectable `now`.
- Modify `server/src/storage/schemas.ts` — add `TestTimeSchema`.
- Modify `server/rspack.config.ts` — two named entries (`index`, `test-server`), `filename: '[name].cjs'`.

**Client**

- Modify `client/vite.config.ts` — add `preview.proxy` for `/api`.
- Modify `client/playwright.config.ts` — `webServer` becomes an array (test server + client preview).
- Modify `client/widgets/ofelia-poop-duty/ui/tiers/StandardTier.tsx` — add `data-testid="ofelia-duty-person"` to the duty-name node (the only stable hook; the name text also appears in `UserToggle`, so a text locator is ambiguous).
- Create `client/e2e/pages/OfeliaPage.ts` — page object + `seedOfeliaWidget()`.
- Create `client/e2e/ofelia-duty.spec.ts` — the 6 scenarios.

---

## Task 1: In-memory ValkeyOps + pub/sub

**Files:**

- Create: `server/src/test/memory-ops.ts`
- Test: `server/src/test/memory-ops.test.ts`

**Interfaces:**

- Consumes: `ValkeyOps` from `server/src/storage/valkey.ts` (`get/set/del/scanKeys/publish`).
- Produces:
  - `createMemoryPubSub(): MemoryPubSub` where `MemoryPubSub = { publish(channel: string, message: string): void; subscribe(channel: string, onMessage: (message: string) => void): () => void }`.
  - `createMemoryOps(pubsub: MemoryPubSub): MemoryOps` where `MemoryOps = ValkeyOps & { clear(): void }`. `publish` delegates to `pubsub.publish`; `scanKeys(prefix)` returns keys with `startsWith(prefix)`; TTL is ignored.

- [ ] **Step 1: Write the failing test**

```ts
// server/src/test/memory-ops.test.ts
import { describe, expect, it, vi } from 'vitest'

import { createMemoryOps, createMemoryPubSub } from './memory-ops'

describe('createMemoryPubSub', () => {
  it('delivers published messages to subscribers of the same channel', () => {
    const pubsub = createMemoryPubSub()
    const received: string[] = []
    pubsub.subscribe('storage:events', (m) => received.push(m))
    pubsub.publish('storage:events', 'hello')
    expect(received).toEqual(['hello'])
  })

  it('stops delivering after unsubscribe', () => {
    const pubsub = createMemoryPubSub()
    const fn = vi.fn()
    const off = pubsub.subscribe('c', fn)
    off()
    pubsub.publish('c', 'x')
    expect(fn).not.toHaveBeenCalled()
  })
})

describe('createMemoryOps', () => {
  it('round-trips set/get and removes on del', async () => {
    const ops = createMemoryOps(createMemoryPubSub())
    await ops.set('k', '1')
    expect(await ops.get('k')).toBe('1')
    await ops.del('k')
    expect(await ops.get('k')).toBeNull()
  })

  it('scanKeys returns keys by prefix and clear empties the store', async () => {
    const ops = createMemoryOps(createMemoryPubSub())
    await ops.set('w:t:a:1', 'x')
    await ops.set('w:t:b:1', 'y')
    expect(await ops.scanKeys('w:t:a:')).toEqual(['w:t:a:1'])
    ops.clear()
    expect(await ops.scanKeys('w:t:')).toEqual([])
  })

  it('ops.publish fans out through the shared pub/sub', async () => {
    const pubsub = createMemoryPubSub()
    const ops = createMemoryOps(pubsub)
    const received: string[] = []
    pubsub.subscribe('storage:events', (m) => received.push(m))
    await ops.publish('storage:events', '{"key":"k","value":1}')
    expect(received).toEqual(['{"key":"k","value":1}'])
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm --filter server exec vitest run src/test/memory-ops.test.ts`
Expected: FAIL — `Cannot find module './memory-ops'`.

- [ ] **Step 3: Write minimal implementation**

```ts
// server/src/test/memory-ops.ts
import type { ValkeyOps } from '../storage/valkey'

export type MemoryPubSub = {
  publish(channel: string, message: string): void
  subscribe(channel: string, onMessage: (message: string) => void): () => void
}

export function createMemoryPubSub(): MemoryPubSub {
  const listeners = new Map<string, Set<(message: string) => void>>()
  return {
    publish(channel, message) {
      for (const listener of listeners.get(channel) ?? []) listener(message)
    },
    subscribe(channel, onMessage) {
      let set = listeners.get(channel)
      if (!set) {
        set = new Set()
        listeners.set(channel, set)
      }
      set.add(onMessage)
      return () => {
        set.delete(onMessage)
        if (set.size === 0) listeners.delete(channel)
      }
    },
  }
}

export type MemoryOps = ValkeyOps & { clear(): void }

export function createMemoryOps(pubsub: MemoryPubSub): MemoryOps {
  const store = new Map<string, string>()
  return {
    async get(key) {
      return store.has(key) ? (store.get(key) as string) : null
    },
    async set(key, value) {
      store.set(key, value)
    },
    async del(key) {
      store.delete(key)
    },
    async scanKeys(matchPrefix) {
      return [...store.keys()].filter((key) => key.startsWith(matchPrefix))
    },
    async publish(channel, message) {
      pubsub.publish(channel, message)
    },
    clear() {
      store.clear()
    },
  }
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm --filter server exec vitest run src/test/memory-ops.test.ts`
Expected: PASS (4 tests).

- [ ] **Step 5: Format, lint, commit**

```bash
pnpm format && pnpm lint
git add server/src/test/memory-ops.ts server/src/test/memory-ops.test.ts
git commit -m "test(server): add in-memory ValkeyOps + pub/sub for e2e"
```

---

## Task 2: Injectable clock for `handleTime`

**Files:**

- Modify: `server/src/storage/handlers.ts:27-29`
- Test: `server/src/storage/handlers.test.ts:154-166` (add a case; keep the existing one)

**Interfaces:**

- Produces: `handleTime(now?: () => number): HandlerResult`. Defaults to `Date.now`, so existing zero-arg callers are unchanged.

- [ ] **Step 1: Write the failing test** (append inside the existing `describe('handleTime', …)` block)

```ts
it('uses an injected clock when provided', () => {
  expect(handleTime(() => 123)).toEqual({ status: 200, body: { now: 123 } })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm --filter server exec vitest run src/storage/handlers.test.ts -t "injected clock"`
Expected: FAIL — `handleTime` ignores its argument / type error.

- [ ] **Step 3: Edit implementation**

Replace `server/src/storage/handlers.ts:27-29`:

```ts
export function handleTime(now: () => number = Date.now): HandlerResult {
  return { status: 200, body: { now: now() } }
}
```

- [ ] **Step 4: Run the handlers suite**

Run: `pnpm --filter server exec vitest run src/storage/handlers.test.ts`
Expected: PASS (existing `returns 200 with the current epoch ms` still green via the `Date.now` default).

- [ ] **Step 5: Format, lint, commit**

```bash
pnpm format && pnpm lint
git add server/src/storage/handlers.ts server/src/storage/handlers.test.ts
git commit -m "refactor(server): make handleTime clock injectable"
```

---

## Task 3: `createApp` factory + production entry + `/api/test/*` routes

**Files:**

- Create: `server/src/app.ts`
- Create: `server/src/app.test.ts`
- Modify: `server/src/storage/schemas.ts` (add `TestTimeSchema`)
- Modify: `server/src/index.ts` (thin production entry)

**Interfaces:**

- Consumes: `ValkeyOps` (Task 1 `createMemoryOps` is a `ValkeyOps`); `handleTime(now)` (Task 2); all existing handlers/schemas/sse/key-lock/http helpers.
- Produces:
  - `createApp(deps: AppDeps): App`
  - `AppDeps = { ops: ValkeyOps; subscribe: (onMessage: (message: string) => void) => () => void; now: () => number; testControls?: TestControls }`
  - `TestControls = { setNow: (ms: number) => void; reset: () => Promise<void> | void }`
  - `App = { server: import('node:http').Server; close: () => Promise<void> }`
  - When `testControls` is present, `POST /api/test/time` (`{ iso?: string; ms?: number }`) and `POST /api/test/reset` are registered.

- [ ] **Step 1: Add `TestTimeSchema`** to `server/src/storage/schemas.ts` (after `EventsParamsSchema`)

```ts
export const TestTimeSchema = z.object({
  iso: z.string().optional(),
  ms: z.number().optional(),
})

export type TestTime = z.infer<typeof TestTimeSchema>
```

- [ ] **Step 2: Write the failing integration test**

```ts
// server/src/app.test.ts
import type { AddressInfo } from 'node:net'

import { afterEach, beforeEach, describe, expect, it } from 'vitest'

import { createApp, type App } from './app'
import { createMemoryOps, createMemoryPubSub } from './test/memory-ops'

const DEBTS_KEY = encodeURIComponent('w:t:ofelia-poop-duty:debts')

describe('createApp', () => {
  let app: App
  let base: string
  let now: number

  beforeEach(async () => {
    const pubsub = createMemoryPubSub()
    const ops = createMemoryOps(pubsub)
    now = Date.parse('2026-06-16T10:00:00.000Z')
    app = createApp({
      ops,
      subscribe: (onMessage) => pubsub.subscribe('storage:events', onMessage),
      now: () => now,
      testControls: {
        setNow: (ms) => {
          now = ms
        },
        reset: () => ops.clear(),
      },
    })
    await new Promise<void>((resolve) => app.server.listen(0, resolve))
    base = `http://localhost:${(app.server.address() as AddressInfo).port}`
  })

  afterEach(async () => {
    await app.close()
  })

  it('GET /api/time returns the injected clock', async () => {
    const res = await fetch(`${base}/api/time`)
    expect(res.status).toBe(200)
    expect(await res.json()).toEqual({ now })
  })

  it('PUT then GET round-trips a stored value', async () => {
    const put = await fetch(`${base}/api/storage/${DEBTS_KEY}`, {
      method: 'PUT',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ value: { count: 1 } }),
    })
    expect(put.status).toBe(204)
    const get = await fetch(`${base}/api/storage/${DEBTS_KEY}`)
    expect(await get.json()).toEqual({ value: { count: 1 } })
  })

  it('POST /api/test/time pins the clock', async () => {
    const res = await fetch(`${base}/api/test/time`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ iso: '2026-01-01T00:00:00.000Z' }),
    })
    expect(res.status).toBe(204)
    const time = await (await fetch(`${base}/api/time`)).json()
    expect(time).toEqual({ now: Date.parse('2026-01-01T00:00:00.000Z') })
  })

  it('POST /api/test/reset clears stored keys', async () => {
    await fetch(`${base}/api/storage/${DEBTS_KEY}`, {
      method: 'PUT',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ value: { count: 1 } }),
    })
    expect((await fetch(`${base}/api/test/reset`, { method: 'POST' })).status).toBe(204)
    expect((await fetch(`${base}/api/storage/${DEBTS_KEY}`)).status).toBe(404)
  })
})
```

- [ ] **Step 3: Run test to verify it fails**

Run: `pnpm --filter server exec vitest run src/app.test.ts`
Expected: FAIL — `Cannot find module './app'`.

- [ ] **Step 4: Write `server/src/app.ts`** (move the routing verbatim from `index.ts`, swapping the hard-wired `ops`/subscriber/clock for `deps`)

```ts
import { randomUUID } from 'node:crypto'
import { createServer, type Server, type ServerResponse } from 'node:http'

import Router from 'find-my-way'

import { readJsonBody } from './http/body'
import { clientIp } from './http/client-ip'
import { SseRegistry, writeSseEvent, fanout } from './realtime/sse'
import {
  handleGet,
  handlePut,
  handleDelete,
  handleKeys,
  handleAppend,
  handleTime,
  publishChange,
  type HandlerResult,
} from './storage/handlers'
import { runExclusive } from './storage/key-lock'
import {
  PutPayloadSchema,
  PrefixQuerySchema,
  AppendPayloadSchema,
  EventsBodySchema,
  EventsParamsSchema,
  StorageEventSchema,
  TestTimeSchema,
  formatZodError,
} from './storage/schemas'
import type { ValkeyOps } from './storage/valkey'

const HEARTBEAT_MS = 25_000

export type TestControls = {
  setNow: (ms: number) => void
  reset: () => Promise<void> | void
}

export type AppDeps = {
  ops: ValkeyOps
  subscribe: (onMessage: (message: string) => void) => () => void
  now: () => number
  testControls?: TestControls
}

export type App = {
  server: Server
  close: () => Promise<void>
}

export function createApp(deps: AppDeps): App {
  const { ops, now } = deps
  const router = Router({ ignoreTrailingSlash: true })
  const registry = new SseRegistry()

  const unsubscribe = deps.subscribe((message) => {
    let raw: unknown
    try {
      raw = JSON.parse(message) as unknown
    } catch (cause) {
      console.warn('invalid storage pub/sub JSON', cause)
      return
    }
    const parsed = StorageEventSchema.safeParse(raw)
    if (!parsed.success) {
      console.warn('invalid storage pub/sub event', parsed.error)
      return
    }
    fanout(registry, parsed.data)
  })

  function send(res: ServerResponse, result: HandlerResult): void {
    if (result.body === undefined) {
      res.writeHead(result.status)
      res.end()
      return
    }
    res.writeHead(result.status, { 'content-type': 'application/json' })
    res.end(JSON.stringify(result.body))
  }

  router.on('GET', '/api/storage/events', (req, res) => {
    res.writeHead(200, {
      'content-type': 'text/event-stream',
      'cache-control': 'no-cache',
      connection: 'keep-alive',
      'x-accel-buffering': 'no',
    })
    const connId = randomUUID()
    registry.add(connId, res)
    writeSseEvent(res, 'ready', { connId })
    const heartbeat = setInterval(() => res.write(': ping\n\n'), HEARTBEAT_MS)
    req.on('close', () => {
      clearInterval(heartbeat)
      registry.remove(connId)
    })
  })

  router.on('POST', '/api/storage/events/:connId', async (req, res, params) => {
    const parsedParams = EventsParamsSchema.safeParse(params)
    if (!parsedParams.success) {
      res.writeHead(422, { 'content-type': 'application/json' })
      res.end(JSON.stringify(formatZodError(parsedParams.error)))
      return
    }
    const { connId } = parsedParams.data

    let raw: unknown
    try {
      raw = await readJsonBody(req)
    } catch {
      res.writeHead(400)
      res.end()
      return
    }
    const parsed = EventsBodySchema.safeParse(raw ?? {})
    if (!parsed.success) {
      res.writeHead(422, { 'content-type': 'application/json' })
      res.end(JSON.stringify(formatZodError(parsed.error)))
      return
    }
    if (parsed.data.subscribe) registry.subscribe(connId, parsed.data.subscribe)
    if (parsed.data.unsubscribe) registry.unsubscribe(connId, parsed.data.unsubscribe)
    res.writeHead(204)
    res.end()
  })

  router.on('GET', '/api/time', (_req, res) => {
    send(res, handleTime(now))
  })

  router.on('GET', '/api/storage', async (_req, res, _params, _store, query) => {
    const parsed = PrefixQuerySchema.safeParse(query ?? {})
    if (!parsed.success) {
      res.writeHead(422, { 'content-type': 'application/json' })
      res.end(JSON.stringify(formatZodError(parsed.error)))
      return
    }
    send(res, await handleKeys(ops, parsed.data.prefix ?? ''))
  })

  router.on('GET', '/api/storage/:key', async (_req, res, params) => {
    send(res, await handleGet(ops, decodeURIComponent(params.key as string)))
  })

  router.on('PUT', '/api/storage/:key', async (req, res, params) => {
    let raw: unknown
    try {
      raw = await readJsonBody(req)
    } catch (e) {
      const status = e instanceof Error && e.message === 'request body too large' ? 413 : 400
      res.writeHead(status)
      res.end()
      return
    }
    const parsed = PutPayloadSchema.safeParse(raw)
    if (!parsed.success) {
      res.writeHead(422, { 'content-type': 'application/json' })
      res.end(JSON.stringify(formatZodError(parsed.error)))
      return
    }
    const key = decodeURIComponent(params.key as string)
    send(res, await handlePut(ops, key, parsed.data))
    await publishChange(ops, key, parsed.data.value)
  })

  router.on('POST', '/api/storage/:key/append', async (req, res, params) => {
    let raw: unknown
    try {
      raw = await readJsonBody(req)
    } catch (e) {
      const status = e instanceof Error && e.message === 'request body too large' ? 413 : 400
      res.writeHead(status)
      res.end()
      return
    }

    const parsed = AppendPayloadSchema.safeParse(raw)
    if (!parsed.success) {
      res.writeHead(422, { 'content-type': 'application/json' })
      res.end(JSON.stringify(formatZodError(parsed.error)))
      return
    }

    const key = decodeURIComponent(params.key as string)
    const ip = clientIp(req)
    const status = await runExclusive(key, async () => {
      const result = await handleAppend(ops, key, parsed.data, ip)
      await publishChange(ops, key, result.value)
      return result.status
    })

    res.writeHead(status)
    res.end()
  })

  router.on('DELETE', '/api/storage/:key', async (_req, res, params) => {
    const key = decodeURIComponent(params.key as string)
    send(res, await handleDelete(ops, key))
    await publishChange(ops, key, null)
  })

  if (deps.testControls) {
    const controls = deps.testControls

    router.on('POST', '/api/test/time', async (req, res) => {
      let raw: unknown
      try {
        raw = await readJsonBody(req)
      } catch {
        res.writeHead(400)
        res.end()
        return
      }
      const parsed = TestTimeSchema.safeParse(raw ?? {})
      if (!parsed.success) {
        res.writeHead(422, { 'content-type': 'application/json' })
        res.end(JSON.stringify(formatZodError(parsed.error)))
        return
      }
      const ms =
        parsed.data.ms ?? (parsed.data.iso != null ? Date.parse(parsed.data.iso) : Number.NaN)
      if (Number.isNaN(ms)) {
        res.writeHead(422, { 'content-type': 'application/json' })
        res.end(JSON.stringify({ errors: [{ path: [], message: 'iso or ms required' }] }))
        return
      }
      controls.setNow(ms)
      res.writeHead(204)
      res.end()
    })

    router.on('POST', '/api/test/reset', async (_req, res) => {
      await controls.reset()
      res.writeHead(204)
      res.end()
    })
  }

  const server = createServer((req, res) => {
    Promise.resolve(router.lookup(req, res)).catch(() => {
      if (!res.writableEnded) {
        res.writeHead(500)
        res.end()
      }
    })
  })

  const close = async (): Promise<void> => {
    unsubscribe()
    await new Promise<void>((resolve) => server.close(() => resolve()))
  }

  return { server, close }
}
```

- [ ] **Step 5: Run the integration test to verify it passes**

Run: `pnpm --filter server exec vitest run src/app.test.ts`
Expected: PASS (4 tests).

- [ ] **Step 6: Rewrite `server/src/index.ts` as the thin production entry** (replace the entire file)

```ts
import { createApp } from './app'
import { createValkeyOps, createValkeySubscriber } from './storage/valkey'

const { server } = createApp({
  ops: createValkeyOps(),
  subscribe: (onMessage) => createValkeySubscriber('storage:events', onMessage),
  now: Date.now,
})

const port = Number(process.env.PORT ?? 8787)
server.listen(port, () => {
  console.log(`storage-api listening on :${port}`)
})
```

- [ ] **Step 7: Verify the production bundle still builds and typechecks**

Run: `pnpm --filter server typecheck && pnpm --filter server build`
Expected: PASS; `server/dist/index.cjs` is (re)written. (Production wiring is now Valkey ops + `createValkeySubscriber('storage:events', …)` + `Date.now`, identical to before.)

- [ ] **Step 8: Run the full server suite (guardrail)**

Run: `pnpm --filter server test`
Expected: PASS (handlers, sse, key-lock, body, client-ip, memory-ops, app).

- [ ] **Step 9: Format, lint, commit**

```bash
pnpm format && pnpm lint
git add server/src/app.ts server/src/app.test.ts server/src/index.ts server/src/storage/schemas.ts
git commit -m "refactor(server): extract createApp factory with injectable ops/clock + test routes"
```

---

## Task 4: Test-server entry + rspack multi-entry build

**Files:**

- Create: `server/src/test-server.ts`
- Modify: `server/rspack.config.ts`

**Interfaces:**

- Consumes: `createApp` (Task 3), `createMemoryOps`/`createMemoryPubSub` (Task 1).
- Produces: a runnable bundle `server/dist/test-server.cjs` that listens on `PORT` (default 8787), serving the storage API + SSE + `/api/test/*` over in-memory ops with a settable clock. Production output `server/dist/index.cjs` is unchanged.

- [ ] **Step 1: Write `server/src/test-server.ts`**

```ts
import { createApp } from './app'
import { createMemoryOps, createMemoryPubSub } from './test/memory-ops'

// Dedicated e2e entry. Running this bundle (vs dist/index.cjs) IS the test-mode
// gate: in-memory storage, an in-process pub/sub so the SSE fanout fires without
// Valkey, a settable clock, and the /api/test/* control routes. The production
// entry (index.ts) never imports this file, so test routes can't leak to prod.
const pubsub = createMemoryPubSub()
const ops = createMemoryOps(pubsub)
let currentNow = Date.now()

const { server } = createApp({
  ops,
  subscribe: (onMessage) => pubsub.subscribe('storage:events', onMessage),
  now: () => currentNow,
  testControls: {
    setNow: (ms) => {
      currentNow = ms
    },
    reset: () => {
      ops.clear()
      currentNow = Date.now()
    },
  },
})

const port = Number(process.env.PORT ?? 8787)
server.listen(port, () => {
  console.log(`test storage-api listening on :${port}`)
})
```

- [ ] **Step 2: Update `server/rspack.config.ts`** to emit both entries

Replace the `entry` and `output` blocks:

```ts
  entry: {
    index: './src/index.ts',
    'test-server': './src/test-server.ts',
  },
  output: {
    path: path.resolve(import.meta.dirname, 'dist'),
    filename: '[name].cjs',
    libraryTarget: 'commonjs2',
    // dev.mjs restarts the server by polling the bundle's mtime; without this,
    // rspack skips rewriting the file when output is byte-identical to what's
    // already on disk (e.g. on a fresh container start), so the mtime never
    // changes and the server never gets (re)spawned.
    compareBeforeEmit: false,
  },
```

(The entry key `index` keeps the production filename `dist/index.cjs`; `node dist/index.cjs` and `dev.mjs`'s `watchFile(dist/index.cjs)` are unaffected.)

- [ ] **Step 3: Build and verify both bundles emit**

Run: `pnpm --filter server build`
Expected: PASS; both `server/dist/index.cjs` and `server/dist/test-server.cjs` exist.

Verify:

```bash
ls server/dist/index.cjs server/dist/test-server.cjs
```

Expected: both paths listed.

- [ ] **Step 4: Smoke-test the test server runtime** (a runtime check that `/api/time` + `/api/test/time` work end-to-end; full coverage lands in Task 7)

```bash
PORT=8799 node server/dist/test-server.cjs &
SERVER_PID=$!
sleep 1
node -e "fetch('http://localhost:8799/api/test/time',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({iso:'2026-06-16T12:00:00+02:00'})}).then(()=>fetch('http://localhost:8799/api/time')).then(r=>r.json()).then((t)=>{if(t.now!==Date.parse('2026-06-16T12:00:00+02:00'))throw new Error('clock not pinned: '+JSON.stringify(t));console.log('OK',t)})"
kill $SERVER_PID
```

Expected: prints `OK { now: 1781<…> }` (pinned epoch ms), no error.

(Windows PowerShell equivalent: `$env:PORT=8799; node server/dist/test-server.cjs` in one terminal, run the `node -e` check in another, then stop the process. If running the smoke is awkward in your shell, it is acceptable to rely on Task 7's Playwright run for runtime validation — the bundle existing from Step 3 is the committable deliverable.)

- [ ] **Step 5: Format, lint, commit**

```bash
pnpm format && pnpm lint
git add server/src/test-server.ts server/rspack.config.ts
git commit -m "feat(server): add in-memory test-server entry + rspack multi-entry"
```

---

## Task 5: Client preview proxy + Playwright webServer array

**Files:**

- Modify: `client/vite.config.ts:33-46` (add `preview.proxy`)
- Modify: `client/playwright.config.ts:16-21` (`webServer` → array)

**Interfaces:**

- Consumes: `server/dist/test-server.cjs` (Task 4).
- Produces: `vite preview` on `:4173` proxying `/api` → `:8787`; Playwright boots the test server then the client preview.

- [ ] **Step 1: Add `preview.proxy` to `client/vite.config.ts`** (mirror the existing `server.proxy`; add a sibling `preview` key after the `server` block, inside `defineConfig`)

```ts
  preview: {
    proxy: {
      '/api': {
        target: process.env.VITE_API_PROXY ?? 'http://localhost:8787',
        changeOrigin: true,
      },
    },
  },
```

(Vite preview is a static server by default and 404s `/api`; this routes the API — including the `/api/storage/events` SSE stream — to the test server while still serving the production build.)

- [ ] **Step 2: Convert `client/playwright.config.ts` `webServer` to an array**

Replace the single `webServer` object with:

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
      command: 'npm run build && npm run preview',
      url: 'http://localhost:4173',
      reuseExistingServer: !process.env['CI'],
      timeout: 120_000,
    },
  ],
```

(The test-server command builds the bundle then runs it; `../server/dist/test-server.cjs` is relative to the Playwright config dir, `client/`. Playwright waits for `GET /api/time` (200) before starting specs.)

- [ ] **Step 3: Typecheck the e2e/config TS**

Run: `pnpm --filter client typecheck:e2e`
Expected: PASS (config still type-checks under `tsconfig.e2e.json`).

- [ ] **Step 4: Verify both servers boot and the existing e2e suite still passes** (no Ofelia spec yet — this proves the harness change didn't break the clock/theme specs)

Run: `pnpm --filter client exec playwright test e2e/widget-interactions.spec.ts`
Expected: PASS (the test server boots on 8787, preview on 4173; existing specs are unaffected).

- [ ] **Step 5: Format, lint, commit**

```bash
pnpm format && pnpm lint
git add client/vite.config.ts client/playwright.config.ts
git commit -m "test(client): proxy /api in preview + run test server in playwright"
```

---

## Task 6: OfeliaPage page object + stable duty-name hook

**Files:**

- Modify: `client/widgets/ofelia-poop-duty/ui/tiers/StandardTier.tsx:32` (add `data-testid`)
- Create: `client/e2e/pages/OfeliaPage.ts`

**Interfaces:**

- Consumes: `BoardPage`, `HeaderPage` (existing page objects); the StandardTier DOM (status plaque text `Уборка подтверждена`; button names `Какашки убраны` / `В долг` / `Простить`; undo aria-label `Откатить`; debt chips `data-testid="debt-chip-<person>"`).
- Produces: `class OfeliaPage` with `card`, `dutyName`, `confirmedPlaque`, `confirmButton`, `debtButton`, `forgiveButton`, `undoButton`, `debtChip(person)`, and `async seedOfeliaWidget()`.

- [ ] **Step 1: Add the duty-name test id** in `StandardTier.tsx` — change the name node (currently `<div className={styles.name}>{selected.person}</div>`) to:

```tsx
<div className={styles.name} data-testid="ofelia-duty-person">
  {selected.person}
</div>
```

(The person name also renders inside `UserToggle` as `Л · Леша`, so a bare text locator is ambiguous; this testid is the single stable hook for the on-duty person.)

- [ ] **Step 2: Keep the StandardTier unit test green** (the change is additive — confirm nothing asserted on the old structure)

Run: `pnpm --filter client exec vitest run widgets/ofelia-poop-duty/ui/tiers/StandardTier.test.tsx`
Expected: PASS.

- [ ] **Step 3: Write `client/e2e/pages/OfeliaPage.ts`**

```ts
import { expect, type Locator, type Page } from '@playwright/test'

import { BoardPage } from './BoardPage.js'
import { HeaderPage } from './HeaderPage.js'

export type DutyPerson = 'Леша' | 'Карина'

export class OfeliaPage {
  readonly card: Locator
  readonly dutyName: Locator
  readonly confirmedPlaque: Locator
  readonly confirmButton: Locator
  readonly debtButton: Locator
  readonly forgiveButton: Locator
  readonly undoButton: Locator

  constructor(readonly page: Page) {
    this.card = new BoardPage(page).getCard(0)
    this.dutyName = this.card.getByTestId('ofelia-duty-person')
    this.confirmedPlaque = this.card.getByText('Уборка подтверждена')
    this.confirmButton = this.card.getByRole('button', { name: 'Какашки убраны' })
    this.debtButton = this.card.getByRole('button', { name: 'В долг' })
    this.forgiveButton = this.card.getByRole('button', { name: 'Простить' })
    this.undoButton = this.card.getByRole('button', { name: 'Откатить' })
  }

  debtChip(person: DutyPerson): Locator {
    return this.card.getByTestId(`debt-chip-${person}`)
  }

  async seedOfeliaWidget(): Promise<void> {
    await this.page.goto('/')
    await new HeaderPage(this.page).addWidget('Лоту Офелии'.replace('Лоту', 'Лоток'))
    // Wait past the "Загрузка…" gate: the duty name only renders once
    // /api/time has synced and the StandardTier mounts.
    await expect(this.dutyName).toBeVisible()
  }
}
```

> Note: `addWidget` takes the catalog title `Лоток Офелии`. Write it directly as `await new HeaderPage(this.page).addWidget('Лоток Офелии')` — the `.replace` above is only to flag the exact string; remove it and pass the literal title.

Corrected `seedOfeliaWidget` body:

```ts
  async seedOfeliaWidget(): Promise<void> {
    await this.page.goto('/')
    await new HeaderPage(this.page).addWidget('Лоток Офелии')
    await expect(this.dutyName).toBeVisible()
  }
```

- [ ] **Step 4: Typecheck the e2e TS**

Run: `pnpm --filter client typecheck:e2e`
Expected: PASS (`OfeliaPage.ts` compiles under NodeNext; `.js` import specifiers resolve).

- [ ] **Step 5: Format, lint, commit**

```bash
pnpm format && pnpm lint
git add client/widgets/ofelia-poop-duty/ui/tiers/StandardTier.tsx client/e2e/pages/OfeliaPage.ts
git commit -m "test(client): add OfeliaPage page object + duty-person testid"
```

---

## Task 7: `ofelia-duty.spec.ts` — the 6 scenarios

**Files:**

- Create: `client/e2e/ofelia-duty.spec.ts`

**Interfaces:**

- Consumes: `OfeliaPage` (Task 6); the test server's `/api/test/reset`, `/api/test/time`, and `/api/storage/:key` (PUT) via the Playwright `request` fixture (baseURL `:4173` → proxied to `:8787`).
- Produces: the runnable e2e suite. Running it first reveals the concrete failures that scope Task 8.

- [ ] **Step 1: Write `client/e2e/ofelia-duty.spec.ts`**

```ts
import { expect, test } from '@playwright/test'

import { OfeliaPage } from './pages/OfeliaPage.js'

// Noon Europe/Warsaw (UTC+2 in June) → server "today" = 2026-06-16.
// getOfeliaDutyByDate(2026-06-16) → Леша (diffDays 0 from BASE_DUTY_DATE, even).
const PINNED_ISO = '2026-06-16T12:00:00+02:00'
const ON_DUTY = 'Леша' as const
const DEBTS_URL = `/api/storage/${encodeURIComponent('w:t:ofelia-poop-duty:debts')}`

test.beforeEach(async ({ request }) => {
  await request.post('/api/test/reset')
  await request.post('/api/test/time', { data: { iso: PINNED_ISO } })
})

test('render — shows today’s duty person and the pending primary action', async ({ page }) => {
  const ofelia = new OfeliaPage(page)
  await ofelia.seedOfeliaWidget()

  await expect(ofelia.dutyName).toHaveText(ON_DUTY)
  await expect(ofelia.confirmButton).toBeVisible()
})

test('confirm — flips to the confirmed plaque via the SSE round-trip', async ({ page }) => {
  const ofelia = new OfeliaPage(page)
  await ofelia.seedOfeliaWidget()

  await ofelia.confirmButton.click()

  await expect(ofelia.confirmedPlaque).toBeVisible()
  await expect(ofelia.undoButton).toBeVisible()
  await expect(ofelia.confirmButton).toHaveCount(0)
})

test('undo — returns the day to pending', async ({ page }) => {
  const ofelia = new OfeliaPage(page)
  await ofelia.seedOfeliaWidget()

  await ofelia.confirmButton.click()
  await expect(ofelia.confirmedPlaque).toBeVisible()

  await ofelia.undoButton.click()

  await expect(ofelia.confirmButton).toBeVisible()
  await expect(ofelia.confirmedPlaque).toHaveCount(0)
})

test('В долг — increments the on-duty person’s debt chip and closes the day', async ({ page }) => {
  const ofelia = new OfeliaPage(page)
  await ofelia.seedOfeliaWidget()

  await expect(ofelia.debtChip(ON_DUTY)).toContainText('0')

  await ofelia.debtButton.click()

  await expect(ofelia.debtChip(ON_DUTY)).toContainText('1')
  await expect(ofelia.confirmedPlaque).toBeVisible()
})

test('Простить — decrements an existing debt', async ({ page, request }) => {
  // Seed a pre-existing debt so today stays pending (the secondary row, and thus
  // "Простить", only renders while status is pending).
  await request.put(DEBTS_URL, { data: { value: { Леша: 1, Карина: 0 } } })

  const ofelia = new OfeliaPage(page)
  await ofelia.seedOfeliaWidget()

  await expect(ofelia.debtChip(ON_DUTY)).toContainText('1')
  await expect(ofelia.forgiveButton).toBeVisible()

  await ofelia.forgiveButton.click()

  await expect(ofelia.debtChip(ON_DUTY)).toContainText('0')
})

test('persistence — a confirmed day survives a reload', async ({ page }) => {
  const ofelia = new OfeliaPage(page)
  await ofelia.seedOfeliaWidget()

  await ofelia.confirmButton.click()
  await expect(ofelia.confirmedPlaque).toBeVisible()

  await page.reload()
  await expect(ofelia.dutyName).toBeVisible()
  await expect(ofelia.confirmedPlaque).toBeVisible()
})
```

- [ ] **Step 2: Run the spec and capture the concrete failures**

Run: `pnpm --filter client exec playwright test e2e/ofelia-duty.spec.ts`
Expected: some/all scenarios may FAIL. **Do not fix anything yet.** Record which specs fail and the exact assertion/error for each — this output is the input to Task 8.

- [ ] **Step 3: Commit the spec (red is fine — it is the executable acceptance criteria)**

```bash
pnpm format && pnpm lint
git add client/e2e/ofelia-duty.spec.ts
git commit -m "test(client): add ofelia duty e2e specs (status/undo/debt)"
```

---

## Task 8: Fix loop until the specs are green

**Files (suspected, confirm before editing):**

- `client/widgets/ofelia-poop-duty/model/ofelia-duty.ts`
- `client/widgets/ofelia-poop-duty/ui/*`
- `client/src/storage/model/reatom/reatom-storage.ts` (the `withStorageKey` write-back echo — see hypothesis 2; this file is shared by other widgets, so any change here must keep `pnpm --filter client test` green)
- `server/src/*`

**Interfaces:** none new — this task only fixes existing modules until Task 7's specs pass.

This task is intentionally not pre-coded: per the design (§6/§7), the concrete failures define the fix scope. Work one red spec at a time.

- [ ] **Step 1: For each failing spec, root-cause with systematic-debugging before any edit.** Load the `superpowers:systematic-debugging` skill. Form a hypothesis, confirm it with evidence (Playwright trace/console, a targeted unit test, or server logs) before changing code.

  Pre-identified hypotheses to check first (from the design's risk list — confirm, don't assume):
  - **Status flip never fires (confirm/В долг/persistence specs):** the model does not refetch history on append; it relies wholly on SSE delivery via `storage.shared.server.subscribe(historyKey, …)`. Verify the in-memory `publishChange → storage:events → fanout` path reaches the browser's `EventSource` through the `vite preview` proxy. If the proxy doesn't stream SSE, that surfaces here.
  - **Debt chip echo loop (В долг / Простить specs):** `withStorageKey`'s connect-hook listener does `target.set(event.value)`, which re-triggers its own change-hook (`api.set`) — a possible debts write-back echo loop, since each SSE delivery is a fresh object reference and Reatom change-detection is by identity. If observed (runaway PUTs / flicker / wrong count), the minimal fix likely lives in `withStorageKey` (skip the change-hook when the new value is structurally equal to the last server-delivered value) — and must not regress other widgets.

- [ ] **Step 2: Apply the minimal fix** in the smallest scope that makes the spec pass. Prefer a model/UI fix over a shared-storage fix when both are viable.

- [ ] **Step 3: Re-run that spec.**

Run: `pnpm --filter client exec playwright test e2e/ofelia-duty.spec.ts -g "<scenario title substring>"`
Expected: the targeted scenario PASSES.

- [ ] **Step 4: Repeat Steps 1–3 until the whole file is green.**

Run: `pnpm --filter client exec playwright test e2e/ofelia-duty.spec.ts`
Expected: all 6 PASS.

- [ ] **Step 5: Guardrail — full unit + e2e suites stay green.**

Run:

```bash
pnpm --filter server test
pnpm --filter client test
pnpm --filter client exec playwright test
```

Expected: all PASS — notably `ofelia-duty.test.ts`, `view-model.test.ts`, the storage/server handler tests, and the existing `widget-interactions.spec.ts`.

- [ ] **Step 6: Final format/lint/typecheck + commit per fix.**

For each fix (commit incrementally as you go, not one giant commit):

```bash
pnpm format && pnpm lint && pnpm typecheck
git add <changed files>
git commit -m "fix(ofelia): <what the fix addressed to make spec X green>"
```

---

## Verification (run before declaring the plan complete)

```bash
pnpm --filter server typecheck && pnpm --filter server test
pnpm --filter client typecheck && pnpm --filter client typecheck:e2e && pnpm --filter client test
pnpm --filter client exec playwright test
pnpm lint && pnpm format:check
```

All must pass. The 6 Ofelia scenarios and every pre-existing suite are green.

---

## Self-Review (completed against the design spec)

**Spec coverage:**

- §3 server test-mode → Tasks 1–4 (`createApp({ ops, subscribe, now })`, in-memory ops + in-process pub/sub mirroring the Valkey fanout contract, settable clock, `/api/test/time`, `/api/test/reset`; production entry behaviour-identical). The design's `TEST_MODE` env gate is realised as a **dedicated `test-server.ts` entry** instead — a stronger gate (prod never imports the test routes). Noted as a deliberate refinement.
- §4 client/Playwright wiring → Task 5 (`preview.proxy`, `webServer` array). Per-test isolation (fresh context) + `beforeEach` reset/time → Task 7 `beforeEach`.
- §5 test surface → Task 6 (page object, `seedOfeliaWidget`, locators incl. the `data-testid` for the duty name) + Task 7 (determinism constants, 6 specs). The `Простить` spec seeds a debt server-side so the day stays pending (the design's "visible once a debt exists" — the secondary action row hides once the day closes, so the debt must pre-exist while pending).
- §6 fix loop / §7 risks → Task 8 (systematic-debugging first; the two suspected areas listed as hypotheses, not pre-committed fixes).
- §8 deliverables checklist → Tasks 1–7 cover every box; Task 8 is "module fixes until green".

**Placeholder scan:** No TBD/TODO; every code step shows complete code. Task 8 is deliberately process-driven because the design defers fix code to discovery — the commands, target files, and confirmed hypotheses are concrete.

**Type consistency:** `createApp`/`AppDeps`/`App`/`TestControls` names are consistent across Tasks 3–4 and the tests. `MemoryPubSub`/`MemoryOps` consistent across Tasks 1, 3, 4. `handleTime(now?)` default keeps Task 2's existing test valid and Task 3's `handleTime(now)` call type-correct. Page-object member names match their usages in the spec (`confirmButton`, `debtButton`, `forgiveButton`, `undoButton`, `confirmedPlaque`, `dutyName`, `debtChip`).
