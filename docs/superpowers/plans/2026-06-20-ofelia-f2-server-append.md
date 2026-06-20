# F2 — Server-side append + IP (storage) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add an atomic per-key `append` to the storage layer that pushes an entry onto a JSON array, stamps it server-side with `id`/`ts`/`ip`, honours an optional `cap`, and republishes the whole array over SSE.

**Architecture:** A new `POST /api/storage/:key/append` route reads the current array from Valkey, appends a server-enriched entry, caps it, writes it back, and publishes the change — all under an in-process per-key lock so concurrent appends to one key can't lose writes. The client-facing `StorageApi` gains an `append` method implemented over HTTP (real enrichment) and Dexie (local-only, no enrichment). A reusable in-memory `createFakeStorage` test double is added for downstream features (F3–F5).

**Tech Stack:** TypeScript (ESM), Node `http` + `find-my-way` router, Zod v4 schemas, Valkey (`iovalkey`) via `ValkeyOps`, Dexie on the client, Vitest for tests, `errore` for errors-as-values.

## Global Constraints

- **Reatom + errore skills:** load and follow `C:\Users\Khmil\.agents\skills\reatom` and `C:\Users\Khmil\.agents\skills\errore` before working. Storage methods return errors **as values** (`StorageError | T`), never throw.
- **Language/style:** TypeScript, ESM imports, 2-space indent, single quotes, **no semicolons**, named exports. Match the surrounding file's existing style when it differs.
- **Package manager:** pnpm, run from repo root. `pnpm test` = `pnpm -r test`; `pnpm typecheck` = `pnpm -r typecheck`.
- **Tests:** colocated `*.test.ts`. Server tests run in the `server` package (node env, `server/vitest.config.ts`); client tests run in the `client` package (jsdom). Run `pnpm test` and `pnpm typecheck` before the PR.
- **Contract owned by F2 (spec §4.2):**
  ```ts
  append<T>(key: string, entry: T, options?: { cap?: number }): Promise<StorageError | void>
  ```
  Server enriches every entry with `id` (uuid), `ts` (epoch ms), `ip` (`x-forwarded-for` first hop → else `socket.remoteAddress`, stored whole). New value is published as a normal `set` (subscribers receive the full array). Atomicity: serialize appends **per key** in-process. HTTP: `POST /api/storage/:key/append`, body `{ entry, cap? }`, response `204`.

---

## File Structure

**Server (`server/`):**
- Create `server/client-ip.ts` — pure `clientIp(req)` header/socket → IP string. (Task 1)
- Create `server/key-lock.ts` — `runExclusive(key, task)` in-process per-key serialization. (Task 2)
- Modify `server/schemas.ts` — add `AppendPayloadSchema` + `AppendPayload` type. (Task 3)
- Modify `server/handlers.ts` — add `handleAppend(ops, key, payload, ip)`. (Task 3)
- Modify `server/index.ts` — register `POST /api/storage/:key/append`. (Task 4)
- Tests: `server/client-ip.test.ts`, `server/key-lock.test.ts`, extend `server/handlers.test.ts`.

**Client (`client/src/storage/model/`):**
- Modify `types.ts` — add `append` to the `StorageApi` type. (Task 5)
- Modify `server/http-storage.ts` — implement `append` (HTTP POST). (Task 5)
- Modify `client/dexie-storage.ts` — implement `append` (local read-modify-write). (Task 5)
- Modify `test/fakes.ts` — add reusable `createFakeStorage()` with working `append`. (Task 6)
- Modify `client/widgets/ofelia-poop-duty/model/ofelia-duty.test.ts` — add `append` to the inline `StorageApi` fake so client typecheck stays green. (Task 5)
- Tests: extend `server/http-storage.test.ts`, `client/dexie-storage.test.ts`; add `test/fakes.test.ts`.

---

## Task 1: Server client-IP extraction

**Files:**
- Create: `server/client-ip.ts`
- Test: `server/client-ip.test.ts`

**Interfaces:**
- Consumes: nothing.
- Produces: `clientIp(req: Pick<IncomingMessage, 'headers' | 'socket'>): string`. Used by the route in Task 4.

- [ ] **Step 1: Write the failing test**

```ts
// server/client-ip.test.ts
import { describe, expect, it } from 'vitest'
import type { IncomingMessage } from 'node:http'
import { clientIp } from './client-ip'

function req(headers: IncomingMessage['headers'], remoteAddress?: string): IncomingMessage {
  return { headers, socket: { remoteAddress } } as unknown as IncomingMessage
}

describe('clientIp', () => {
  it('takes the first hop of a comma-separated x-forwarded-for', () => {
    expect(clientIp(req({ 'x-forwarded-for': '1.1.1.1, 2.2.2.2' }, '9.9.9.9'))).toBe('1.1.1.1')
  })

  it('takes the first entry when x-forwarded-for is an array', () => {
    expect(clientIp(req({ 'x-forwarded-for': ['3.3.3.3, 4.4.4.4', '5.5.5.5'] }, '9.9.9.9'))).toBe('3.3.3.3')
  })

  it('falls back to socket.remoteAddress when no forwarded header', () => {
    expect(clientIp(req({}, '9.9.9.9'))).toBe('9.9.9.9')
  })

  it('returns an empty string when nothing is available', () => {
    expect(clientIp(req({}, undefined))).toBe('')
  })
})
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `pnpm --filter server exec vitest run client-ip.test.ts`
Expected: FAIL — cannot find module `./client-ip`.

- [ ] **Step 3: Write the minimal implementation**

```ts
// server/client-ip.ts
import type { IncomingMessage } from 'node:http'

/**
 * Best-effort client IP: first hop of x-forwarded-for, else the socket address.
 * Stored whole; the UI is responsible for only showing a tail.
 */
export function clientIp(req: Pick<IncomingMessage, 'headers' | 'socket'>): string {
  const forwarded = req.headers['x-forwarded-for']
  const first = Array.isArray(forwarded) ? forwarded[0] : forwarded
  if (typeof first === 'string' && first.length > 0) return first.split(',')[0].trim()
  return req.socket.remoteAddress ?? ''
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `pnpm --filter server exec vitest run client-ip.test.ts`
Expected: PASS (4 tests).

- [ ] **Step 5: Commit**

```bash
git add server/client-ip.ts server/client-ip.test.ts
git commit -m "feat(server): add clientIp header/socket extraction"
```

---

## Task 2: In-process per-key lock

**Files:**
- Create: `server/key-lock.ts`
- Test: `server/key-lock.test.ts`

**Interfaces:**
- Consumes: nothing.
- Produces: `runExclusive<T>(key: string, task: () => Promise<T>): Promise<T>` — tasks for the same key run strictly one after another; different keys run concurrently; a rejecting task does not block the next one. Used by the route in Task 4.

- [ ] **Step 1: Write the failing test**

```ts
// server/key-lock.test.ts
import { describe, expect, it } from 'vitest'
import { runExclusive } from './key-lock'

describe('runExclusive', () => {
  it('serializes tasks for the same key', async () => {
    const order: string[] = []
    let releaseA = () => {}
    const a = runExclusive('k', () => new Promise<void>((resolve) => {
      order.push('a-start')
      releaseA = () => {
        order.push('a-end')
        resolve()
      }
    }))
    const b = runExclusive('k', async () => {
      order.push('b-start')
      order.push('b-end')
    })

    await Promise.resolve()
    expect(order).toEqual(['a-start']) // b is queued behind a

    releaseA()
    await Promise.all([a, b])
    expect(order).toEqual(['a-start', 'a-end', 'b-start', 'b-end'])
  })

  it('runs different keys concurrently', async () => {
    const order: string[] = []
    let releaseA = () => {}
    const a = runExclusive('a', () => new Promise<void>((resolve) => {
      order.push('a-start')
      releaseA = resolve
    }))
    const b = runExclusive('b', async () => {
      order.push('b-ran')
    })

    await b
    expect(order).toEqual(['a-start', 'b-ran']) // b did not wait for a

    releaseA()
    await a
  })

  it('does not let a rejecting task block the next one for the same key', async () => {
    const failed = runExclusive('k', async () => {
      throw new Error('boom')
    })
    await expect(failed).rejects.toThrow('boom')

    const next = await runExclusive('k', async () => 'ok')
    expect(next).toBe('ok')
  })
})
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `pnpm --filter server exec vitest run key-lock.test.ts`
Expected: FAIL — cannot find module `./key-lock`.

- [ ] **Step 3: Write the minimal implementation**

```ts
// server/key-lock.ts

/**
 * In-process per-key serialization. Each task waits for the previous task on the
 * same key to settle; different keys are independent. Good enough for a single
 * Node instance (spec §4.2: upgrade to atomic/Lua only if we scale horizontally).
 */
const tails = new Map<string, Promise<unknown>>()

export function runExclusive<T>(key: string, task: () => Promise<T>): Promise<T> {
  const previous = tails.get(key) ?? Promise.resolve()
  const result = previous.then(() => task())
  // Swallow rejection so the next waiter still runs; keep the chain alive.
  const tail = result.then(
    () => undefined,
    () => undefined,
  )
  tails.set(key, tail)
  void tail.then(() => {
    if (tails.get(key) === tail) tails.delete(key)
  })
  return result
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `pnpm --filter server exec vitest run key-lock.test.ts`
Expected: PASS (3 tests).

- [ ] **Step 5: Commit**

```bash
git add server/key-lock.ts server/key-lock.test.ts
git commit -m "feat(server): add in-process per-key lock"
```

---

## Task 3: Append schema + handler

**Files:**
- Modify: `server/schemas.ts`
- Modify: `server/handlers.ts`
- Test: `server/handlers.test.ts`

**Interfaces:**
- Consumes: `ValkeyOps` (`get`, `set`) from `server/valkey.ts`; `randomUUID` from `node:crypto`.
- Produces:
  - `AppendPayloadSchema` (zod) and `AppendPayload = { entry: Record<string, unknown>; cap?: number }` in `schemas.ts`.
  - `handleAppend(ops: ValkeyOps, key: string, payload: AppendPayload, ip: string): Promise<{ status: number; value: unknown[] }>` in `handlers.ts`. Returns `204` and the **new full array** (so the route can publish it). Used by the route in Task 4.

- [ ] **Step 1: Add the schema**

In `server/schemas.ts`, after `PutPayloadSchema` add:

```ts
export const AppendPayloadSchema = z.object({
  entry: z.record(z.string(), z.unknown()),
  cap: z.number().int().positive().optional(),
})

export type AppendPayload = z.infer<typeof AppendPayloadSchema>
```

- [ ] **Step 2: Write the failing handler test**

In `server/handlers.test.ts`, extend the imports and add a new `describe`. The existing `mockOps` returns a no-op `set`, so use a small stateful ops for append tests.

```ts
// add to the existing import from './handlers'
import { handleGet, handlePut, handleDelete, handleKeys, publishChange, handleAppend } from './handlers'

// ...keep the existing describes...

describe('handleAppend', () => {
  function statefulOps(seed?: unknown): ValkeyOps {
    let raw: string | null = seed === undefined ? null : JSON.stringify(seed)
    return mockOps({
      get: vi.fn(async () => raw),
      set: vi.fn(async (_key: string, value: string) => {
        raw = value
      }),
    })
  }

  it('creates a one-element array and stamps id/ts/ip when the key is missing', async () => {
    vi.useFakeTimers()
    vi.setSystemTime(new Date('2026-06-20T00:00:00.000Z'))
    const ops = statefulOps()

    const result = await handleAppend(ops, 'history:2026-06-15', { entry: { type: 'cleaned' } }, '1.2.3.4')

    expect(result.status).toBe(204)
    expect(result.value).toHaveLength(1)
    expect(result.value[0]).toMatchObject({
      type: 'cleaned',
      ip: '1.2.3.4',
      ts: Date.parse('2026-06-20T00:00:00.000Z'),
    })
    expect(typeof (result.value[0] as { id: unknown }).id).toBe('string')
    expect(ops.set).toHaveBeenCalledWith('history:2026-06-15', JSON.stringify(result.value))
    vi.useRealTimers()
  })

  it('appends onto an existing array', async () => {
    const ops = statefulOps([{ type: 'forgiven', id: 'old' }])
    const result = await handleAppend(ops, 'k', { entry: { type: 'cleaned' } }, '1.2.3.4')
    expect(result.value).toHaveLength(2)
    expect(result.value[0]).toMatchObject({ type: 'forgiven', id: 'old' })
    expect(result.value[1]).toMatchObject({ type: 'cleaned' })
  })

  it('caps to the last N entries', async () => {
    const ops = statefulOps([{ n: 1 }, { n: 2 }, { n: 3 }])
    const result = await handleAppend(ops, 'k', { entry: { n: 4 }, cap: 2 }, '1.2.3.4')
    expect(result.value).toHaveLength(2)
    expect(result.value.map((e) => (e as { n: number }).n)).toEqual([3, 4])
  })

  it('overrides any client-provided id/ts/ip with server values', async () => {
    vi.useFakeTimers()
    vi.setSystemTime(new Date('2026-06-20T00:00:00.000Z'))
    const ops = statefulOps()
    const result = await handleAppend(
      ops,
      'k',
      { entry: { id: 'fake', ts: 1, ip: 'spoofed', type: 'cleaned' } },
      '1.2.3.4',
    )
    expect(result.value[0]).toMatchObject({ ip: '1.2.3.4', ts: Date.parse('2026-06-20T00:00:00.000Z') })
    expect((result.value[0] as { id: string }).id).not.toBe('fake')
    vi.useRealTimers()
  })
})
```

- [ ] **Step 3: Run the test to verify it fails**

Run: `pnpm --filter server exec vitest run handlers.test.ts`
Expected: FAIL — `handleAppend` is not exported.

- [ ] **Step 4: Implement the handler**

In `server/handlers.ts`, add the import at the top and the function (place it after `handlePut`):

```ts
import { randomUUID } from 'node:crypto'
import type { ValkeyOps } from './valkey'
import type { AppendPayload } from './schemas'
```

```ts
export async function handleAppend(
  ops: ValkeyOps,
  key: string,
  payload: AppendPayload,
  ip: string,
): Promise<{ status: number; value: unknown[] }> {
  const raw = await ops.get(key)
  const parsed: unknown = raw === null ? [] : JSON.parse(raw)
  const current: unknown[] = Array.isArray(parsed) ? parsed : []

  const enriched = { ...payload.entry, id: randomUUID(), ts: Date.now(), ip }
  current.push(enriched)

  const value =
    payload.cap != null && current.length > payload.cap
      ? current.slice(current.length - payload.cap)
      : current

  await ops.set(key, JSON.stringify(value))
  return { status: 204, value }
}
```

(The existing `import type { ValkeyOps } from './valkey'` is already at the top of `handlers.ts`; only add the lines that are missing.)

- [ ] **Step 5: Run the test to verify it passes**

Run: `pnpm --filter server exec vitest run handlers.test.ts`
Expected: PASS (existing handler tests + 4 new append tests).

- [ ] **Step 6: Commit**

```bash
git add server/schemas.ts server/handlers.ts server/handlers.test.ts
git commit -m "feat(server): add append handler and schema with id/ts/ip stamp and cap"
```

---

## Task 4: Wire the append route

**Files:**
- Modify: `server/index.ts`

**Interfaces:**
- Consumes: `handleAppend`, `publishChange` (`handlers.ts`), `AppendPayloadSchema`, `formatZodError` (`schemas.ts`), `clientIp` (`client-ip.ts`), `runExclusive` (`key-lock.ts`), `readJsonBody` (`body.ts`).
- Produces: HTTP `POST /api/storage/:key/append` returning `204`; republishes the full array via `publishChange` inside the per-key lock.

- [ ] **Step 1: Add the imports**

In `server/index.ts`, extend the existing imports:

```ts
import { handleGet, handlePut, handleDelete, handleKeys, handleAppend, publishChange, type HandlerResult } from './handlers'
import { PutPayloadSchema, PrefixQuerySchema, AppendPayloadSchema, EventsBodySchema, EventsParamsSchema, StorageEventSchema, formatZodError } from './schemas'
import { clientIp } from './client-ip'
import { runExclusive } from './key-lock'
```

- [ ] **Step 2: Register the route**

In `server/index.ts`, add this route next to the other `/api/storage/:key` routes (e.g. right after the `PUT` route). The read-modify-write **and** publish run inside `runExclusive` so subscribers observe writes in order:

```ts
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
```

- [ ] **Step 3: Verify typecheck and the server suite**

Run: `pnpm --filter server typecheck`
Expected: PASS (no type errors).

Run: `pnpm --filter server test`
Expected: PASS (all server tests, including Tasks 1–3).

- [ ] **Step 4: Commit**

```bash
git add server/index.ts
git commit -m "feat(server): wire POST /api/storage/:key/append with per-key lock"
```

---

## Task 5: `StorageApi.append` + HTTP and Dexie implementations

**Files:**
- Modify: `client/src/storage/model/types.ts`
- Modify: `client/src/storage/model/server/http-storage.ts`
- Modify: `client/src/storage/model/client/dexie-storage.ts`
- Modify: `client/widgets/ofelia-poop-duty/model/ofelia-duty.test.ts`
- Test: `client/src/storage/model/server/http-storage.test.ts`, `client/src/storage/model/client/dexie-storage.test.ts`

**Interfaces:**
- Consumes: `StorageError`, `StorageApi`, `StorageOptions` (`types.ts`); `toFullKey` (`scope.ts`).
- Produces: `StorageApi.append<T>(key, entry, options?: { cap?: number }): Promise<StorageError | void>` and its HTTP + Dexie implementations. HTTP enriches on the server; Dexie appends **as-is** (no server, so no `id`/`ts`/`ip` stamp). Consumed by F4/F5.

> This is one task because adding `append` to the `StorageApi` type makes every implementer required at once — the type and its implementations are a single green unit.

- [ ] **Step 1: Add `append` to the type**

In `client/src/storage/model/types.ts`, inside `StorageApi`, add after `keys`:

```ts
  append<T>(
    key: string,
    entry: T,
    options?: { cap?: number },
  ): Promise<StorageError | void>
```

- [ ] **Step 2: Write the failing HTTP test**

In `client/src/storage/model/server/http-storage.test.ts`, add inside `describe('createHttpStorage', ...)`:

```ts
  it('append POSTs the entry and cap to the key /append URL', async () => {
    const fetchMock = vi.fn((_url: string, _init?: RequestInit) =>
      Promise.resolve(new Response(null, { status: 204 })),
    )
    vi.stubGlobal('fetch', fetchMock)
    await storage.append('history:2026-06-15', { type: 'cleaned' }, { cap: 100 })
    const [url, init] = fetchMock.mock.calls[0]
    expect(url).toBe(`/api/storage/${encodeURIComponent('w:t:clock:history:2026-06-15')}/append`)
    expect(init).toMatchObject({ method: 'POST' })
    expect(JSON.parse((init as RequestInit).body as string)).toEqual({
      entry: { type: 'cleaned' },
      cap: 100,
    })
  })

  it('append maps a non-2xx response to StorageError', async () => {
    stubFetch(() => new Response(null, { status: 500 }))
    expect(await storage.append('k', { a: 1 })).toBeInstanceOf(StorageError)
  })

  it('append maps a network failure to StorageError', async () => {
    vi.stubGlobal('fetch', vi.fn(() => Promise.reject(new Error('offline'))))
    expect(await storage.append('k', { a: 1 })).toBeInstanceOf(StorageError)
  })
```

- [ ] **Step 3: Run the HTTP test to verify it fails**

Run: `pnpm --filter client exec vitest run src/storage/model/server/http-storage.test.ts`
Expected: FAIL — `append` does not exist on the returned storage.

- [ ] **Step 4: Implement the HTTP append**

In `client/src/storage/model/server/http-storage.ts`, add this method to the returned object (e.g. after `keys`, before `subscribe`):

```ts
    async append<T>(
      key: string,
      entry: T,
      options?: { cap?: number },
    ): Promise<StorageError | void> {
      const res = await fetch(`${keyUrl(toFullKey(namespace, key))}/append`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ entry, cap: options?.cap }),
      }).catch((cause) => new StorageError({ reason: 'server APPEND failed', cause }))
      if (res instanceof Error) return res
      if (!res.ok) return new StorageError({ reason: `server APPEND ${res.status}` })
    },
```

- [ ] **Step 5: Run the HTTP test to verify it passes**

Run: `pnpm --filter client exec vitest run src/storage/model/server/http-storage.test.ts`
Expected: PASS.

- [ ] **Step 6: Write the failing Dexie test**

In `client/src/storage/model/client/dexie-storage.test.ts`, add inside `describe('createDexieStorage', ...)`:

```ts
  it('append creates an array then appends to it', async () => {
    await storage.append('log', { a: 1 })
    await storage.append('log', { a: 2 })
    expect(await storage.get('log')).toEqual([{ a: 1 }, { a: 2 }])
  })

  it('append caps to the last N entries', async () => {
    await storage.append('log', 1)
    await storage.append('log', 2)
    await storage.append('log', 3, { cap: 2 })
    expect(await storage.get('log')).toEqual([2, 3])
  })
```

- [ ] **Step 7: Run the Dexie test to verify it fails**

Run: `pnpm --filter client exec vitest run src/storage/model/client/dexie-storage.test.ts`
Expected: FAIL — `append` does not exist.

- [ ] **Step 8: Implement the Dexie append**

In `client/src/storage/model/client/dexie-storage.ts`, add this method to the returned object (after `keys`, before `subscribe`). It reuses `readValid` and the object's own `set` (which constructs the entry and publishes the change):

```ts
    async append<T>(
      key: string,
      entry: T,
      options?: { cap?: number },
    ): Promise<StorageError | void> {
      const row = await readValid(toFullKey(namespace, key))
      if (row instanceof Error) return row
      const current: unknown[] = Array.isArray(row?.value) ? (row.value as unknown[]) : []
      current.push(entry)
      const next =
        options?.cap != null && current.length > options.cap
          ? current.slice(current.length - options.cap)
          : current
      return this.set(key, next)
    },
```

- [ ] **Step 9: Patch the inline Ofelia fake (keep client typecheck green)**

In `client/widgets/ofelia-poop-duty/model/ofelia-duty.test.ts`, the inline `const api: StorageApi = { ... }` (around line 8) is type-annotated, so it must implement `append`. Add this line inside the object literal (e.g. after `keys`):

```ts
    append: vi.fn(async () => undefined),
```

- [ ] **Step 10: Run the Dexie test, then typecheck the client**

Run: `pnpm --filter client exec vitest run src/storage/model/client/dexie-storage.test.ts`
Expected: PASS.

Run: `pnpm --filter client typecheck`
Expected: PASS (no `append` is missing anywhere).

- [ ] **Step 11: Commit**

```bash
git add client/src/storage/model/types.ts client/src/storage/model/server/http-storage.ts client/src/storage/model/client/dexie-storage.ts client/src/storage/model/server/http-storage.test.ts client/src/storage/model/client/dexie-storage.test.ts client/widgets/ofelia-poop-duty/model/ofelia-duty.test.ts
git commit -m "feat(storage): add append to StorageApi with http and dexie implementations"
```

---

## Task 6: Reusable in-memory `createFakeStorage`

**Files:**
- Modify: `client/src/storage/model/test/fakes.ts`
- Test: `client/src/storage/model/test/fakes.test.ts`

**Interfaces:**
- Consumes: `StorageApi`, `StorageError`, `StorageChange`, `StorageListener`, `StorageOptions` (`../types`).
- Produces: `createFakeStorage(): StorageApi` — a Map-backed `StorageApi` (no namespacing; keys used verbatim) implementing `get`/`set`/`delete`/`has`/`keys`/`append`/`subscribe`. `subscribe` emits the current value immediately, then on each mutation. Schema validation and TTL are out of scope for the fake. Used by F3/F4/F5 model tests.

- [ ] **Step 1: Write the failing test**

```ts
// client/src/storage/model/test/fakes.test.ts
import { describe, expect, it } from 'vitest'
import { createFakeStorage } from './fakes'

describe('createFakeStorage', () => {
  it('round-trips set and get', async () => {
    const storage = createFakeStorage()
    await storage.set('k', { a: 1 })
    expect(await storage.get('k')).toEqual({ a: 1 })
  })

  it('returns null for a missing key', async () => {
    expect(await createFakeStorage().get('missing')).toBeNull()
  })

  it('append creates then grows an array and honours cap', async () => {
    const storage = createFakeStorage()
    await storage.append('log', 1)
    await storage.append('log', 2)
    await storage.append('log', 3, { cap: 2 })
    expect(await storage.get('log')).toEqual([2, 3])
  })

  it('lists keys filtered by prefix', async () => {
    const storage = createFakeStorage()
    await storage.set('a', 1)
    await storage.set('group:b', 2)
    expect(await storage.keys('group:')).toEqual(['group:b'])
  })

  it('subscribe emits the current value, then each change', async () => {
    const storage = createFakeStorage()
    await storage.set('k', 'first')
    const seen: unknown[] = []
    const off = storage.subscribe('k', (event) => {
      seen.push(event instanceof Error ? 'error' : event.value)
    })
    await storage.append('k', 'x') // overwrites scalar with [..]; we only assert it fires
    await storage.delete('k')
    off()
    expect(seen[0]).toBe('first')
    expect(seen.at(-1)).toBeNull()
  })
})
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `pnpm --filter client exec vitest run src/storage/model/test/fakes.test.ts`
Expected: FAIL — `createFakeStorage` is not exported.

- [ ] **Step 3: Implement the fake**

Append to `client/src/storage/model/test/fakes.ts`:

```ts
import type {
  StorageApi,
  StorageChange,
  StorageError,
  StorageListener,
  StorageOptions,
} from '../types'

/**
 * In-memory StorageApi double for model tests. Keys are used verbatim (no
 * namespacing); TTL and schema validation are intentionally ignored. subscribe
 * emits the current value immediately, then on every mutation of that key.
 */
export function createFakeStorage(): StorageApi {
  const store = new Map<string, unknown>()
  const listeners = new Map<string, Set<(event: StorageError | StorageChange) => void>>()

  function emit(key: string): void {
    const value = store.has(key) ? store.get(key) : null
    for (const listener of listeners.get(key) ?? []) listener({ value })
  }

  return {
    async get<T>(key: string): Promise<StorageError | T | null> {
      return store.has(key) ? (store.get(key) as T) : null
    },
    async set<T>(key: string, value: T, _options?: StorageOptions): Promise<StorageError | void> {
      store.set(key, value)
      emit(key)
    },
    async delete(key: string): Promise<StorageError | void> {
      store.delete(key)
      emit(key)
    },
    async has(key: string): Promise<StorageError | boolean> {
      return store.has(key)
    },
    async keys(prefix?: string): Promise<StorageError | string[]> {
      const all = [...store.keys()]
      return prefix ? all.filter((key) => key.startsWith(prefix)) : all
    },
    async append<T>(key: string, entry: T, options?: { cap?: number }): Promise<StorageError | void> {
      const existing = store.get(key)
      const current: unknown[] = Array.isArray(existing) ? existing : []
      current.push(entry)
      const next =
        options?.cap != null && current.length > options.cap
          ? current.slice(current.length - options.cap)
          : current
      store.set(key, next)
      emit(key)
    },
    subscribe<T>(key: string, listener: StorageListener<T>): () => void {
      const set = listeners.get(key) ?? new Set()
      set.add(listener as (event: StorageError | StorageChange) => void)
      listeners.set(key, set)
      listener({ value: (store.has(key) ? store.get(key) : null) as T | null })
      return () => set.delete(listener as (event: StorageError | StorageChange) => void)
    },
  }
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `pnpm --filter client exec vitest run src/storage/model/test/fakes.test.ts`
Expected: PASS (5 tests).

- [ ] **Step 5: Commit**

```bash
git add client/src/storage/model/test/fakes.ts client/src/storage/model/test/fakes.test.ts
git commit -m "test(storage): add in-memory createFakeStorage with append"
```

---

## Final Verification

- [ ] **Run the full workspace test suite**

Run: `pnpm test`
Expected: PASS — all server and client tests green.

- [ ] **Run the full workspace typecheck**

Run: `pnpm typecheck`
Expected: PASS — server and client both clean.

- [ ] **(Optional) Manual end-to-end smoke test**

There is no automated HTTP-server integration test in this repo (only handler-level tests), matching the existing pattern. To confirm the wired route against a live stack:

```bash
pnpm docker:server   # starts Valkey + server
curl -i -X POST http://localhost:8787/api/storage/w:t:ofelia-poop-duty:history:2026-06-15/append \
  -H 'content-type: application/json' \
  -d '{"entry":{"type":"cleaned","actor":"Леша","date":"2026-06-15","by":"Карина"}}'
# Expect: HTTP/1.1 204
curl -s http://localhost:8787/api/storage/w:t:ofelia-poop-duty:history:2026-06-15 | jq
# Expect: { "value": [ { "type":"cleaned", ..., "id":"<uuid>", "ts":<ms>, "ip":"<addr>" } ] }
pnpm docker:down
```

---

## Self-Review Notes (coverage against spec §F2)

- **`POST /api/storage/:key/append` route** → Task 4.
- **Handler + schema in `handlers.ts`/`schemas.ts`** → Task 3.
- **IP capture (`x-forwarded-for` first hop → `socket.remoteAddress`, stored whole)** → Task 1 + used in Task 4.
- **In-process per-key lock** → Task 2 + used in Task 4.
- **Publish change (subscribers get the whole array)** → Task 4 (`publishChange` inside the lock).
- **`append` in `StorageApi` + `http-storage.ts` + `dexie-storage.ts`** → Task 5.
- **`append` in `test/fakes.ts`** → Task 6 (`createFakeStorage`); inline Ofelia fake patched in Task 5.
- **`cap` honoured (trim to last N)** → server (Task 3), Dexie (Task 5), fake (Task 6), each with a cap test.
- **`id`/`ts`/`ip` enrichment server-side; server values override client-provided** → Task 3 tests.
- **Tests:** server `handlers.test.ts` (append + cap + ip + server overrides), `client-ip.test.ts`, `key-lock.test.ts`; client `http-storage.test.ts` + `dexie-storage.test.ts` (append) + `fakes.test.ts`.
- **Out of scope (spec §4.2 / §9):** Lua/atomic upgrade and horizontal scaling — the in-process lock is sufficient for one Node instance. The `reatom-storage.ts` mutation helper is **not** extended here: `append` does not need status tracking for F2; F3+ can add a `reatomStorageMutations`-style wrapper if required.
