# Reactive Storage Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add reactive reads to the widget storage layer — subscribe to a single key and be notified on every change across iframes, tabs, and devices — with schema-validated reads.

**Architecture:** Add a `subscribe(key, listener, schema?)` primitive to `StorageApi` plus an optional `schema?` on `get`. The Dexie (client) backend propagates changes across iframes/tabs via a shared `BroadcastChannel`; the HTTP (server) backend propagates across devices via a shared SSE connection fed by Valkey Pub/Sub. Schema validation lives in the storage layer (one `parseValue` helper); a thin Reatom wrapper (`reatomStorageKey`) exposes a key as a reactive atom.

**Tech Stack:** TypeScript (ESM), Reatom v1000 (`@reatom/core@1000`), `errore` (errors-as-values), `zod` v4, Dexie (IndexedDB), native `BroadcastChannel` / `EventSource`, Node `http` + `find-my-way`, `iovalkey`, Vitest (jsdom for client, node for server).

**Spec:** `docs/superpowers/specs/2026-06-19-reactive-storage-design.md`

## Global Constraints

- **Errors as values.** Never throw across an API boundary; return/emit `StorageError` (from `client/src/storage/model/types.ts`). Narrow with `instanceof Error`. (errore convention.)
- **Reatom v1000.** Use `@reatom/core@1000`. Reactive subscription on an atom uses `withConnectHook`. Wrap external-callback writes with `wrap(...)` around the listener passed to the external source (`addEventListener('click', wrap(...))` style) — never call `wrap` inside the listener, never wrap a reatom hook's own callback.
- **Style.** 2-space indent, single quotes, **no semicolons**, named exports, ESM imports. Model code lives in `model/` (this whole feature is `model/`).
- **zod v4** is already a client dependency (`client/package.json`). Validation mirrors `client/src/env.ts` / `server/schemas.ts`: `z.object` + `safeParse`, error wrapped in a tagged error.
- **Granularity:** exact key only — no prefix/namespace subscriptions.
- **Scope:** widgets-only. Do not touch board/theme `localStorage` modules.
- **Client tests run in jsdom**, which lacks `BroadcastChannel` and `EventSource`; tests must install fakes via `vi.stubGlobal`. **Server tests run in node.**
- Run all commands from the worktree root unless a `cd` is shown. Single-file test commands: client → `cd client && pnpm exec vitest run <path>`; server → `cd server && pnpm exec vitest run <path>`.

---

## File Structure

**Client (`client/src/storage/model/`):**

- `validate.ts` _(new)_ — `parseValue(schema, value)`. Single validation helper used by both adapters.
- `types.ts` _(modify)_ — add `StorageChange`, `StorageListener`, `subscribe`, and `schema?` on `get`/`subscribe`.
- `client/channel.ts` _(new)_ — Dexie-backend reactivity: shared `BroadcastChannel`, full-key subscriber registry, `registerLocal` / `publishChange` / `notifyLocal`.
- `client/dexie-storage.ts` _(modify)_ — `get(schema)`, `subscribe`, broadcast on `set`/`delete`.
- `client/db.ts` _(modify)_ — `clearExpired` broadcasts tombstones.
- `server/sse-client.ts` _(new)_ — HTTP-backend reactivity: one `EventSource` per `baseUrl`, full-key registry, server-side registration sync.
- `server/http-storage.ts` _(modify)_ — `get(schema)`, `subscribe` via the SSE manager.
- `reatom/reatom-storage.ts` _(modify)_ — add `reatomStorageKey({ api, key, schema }, name)`.
- `test/fakes.ts` _(new)_ — `FakeBroadcastChannel`, `FakeEventSource` test doubles.

**Server (`server/`):**

- `sse.ts` _(new)_ — `SseRegistry`, `writeSseEvent`, `fanout`.
- `valkey.ts` _(modify)_ — add `publish` op + `createValkeySubscriber`.
- `handlers.ts` _(modify)_ — add `publishChange(ops, key, value)`.
- `schemas.ts` _(modify)_ — add `EventsBodySchema`.
- `index.ts` _(modify)_ — SSE route, registration route, publish-on-write wiring, subscriber boot.

The Dexie registry (`client/channel.ts`) and the HTTP registry (`server/sse-client.ts`) are **deliberately separate**: a client key and a server key share the same full key string but are different stores, so a Dexie write must not notify HTTP subscribers and vice versa.

---

## Task 1: Schema-validated reads (`parseValue` + `get(schema)`)

**Files:**

- Create: `client/src/storage/model/validate.ts`
- Create (test): `client/src/storage/model/validate.test.ts`
- Modify: `client/src/storage/model/types.ts` (add `schema?` to `get`)
- Modify: `client/src/storage/model/client/dexie-storage.ts` (`get` honors schema)
- Modify: `client/src/storage/model/server/http-storage.ts` (`get` honors schema)

**Interfaces:**

- Produces: `parseValue<T>(schema: z.ZodType<T> | undefined, value: unknown): StorageError | T`
- Produces: `StorageApi.get<T>(key: string, schema?: z.ZodType<T>): Promise<StorageError | T | null>`

- [ ] **Step 1: Write the failing test** — `client/src/storage/model/validate.test.ts`

```ts
import { describe, expect, it } from 'vitest'
import { z } from 'zod'
import { parseValue } from './validate'
import { StorageError } from './types'

describe('parseValue', () => {
  it('returns the value unchanged when no schema is given', () => {
    expect(parseValue(undefined, { a: 1 })).toEqual({ a: 1 })
  })

  it('returns parsed data when the schema matches', () => {
    const schema = z.object({ a: z.number() })
    expect(parseValue(schema, { a: 1 })).toEqual({ a: 1 })
  })

  it('returns a StorageError when the schema does not match', () => {
    const schema = z.object({ a: z.number() })
    const result = parseValue(schema, { a: 'nope' })
    expect(result).toBeInstanceOf(StorageError)
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd client && pnpm exec vitest run src/storage/model/validate.test.ts`
Expected: FAIL — cannot find module `./validate`.

- [ ] **Step 3: Create `validate.ts`**

```ts
import type { z } from 'zod'
import { StorageError } from './types'

/** Validate a raw value against an optional schema. No schema = bare typed cast. */
export function parseValue<T>(schema: z.ZodType<T> | undefined, value: unknown): StorageError | T {
  if (!schema) return value as T
  const parsed = schema.safeParse(value)
  if (!parsed.success)
    return new StorageError({ reason: 'schema validation failed', cause: parsed.error })
  return parsed.data
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd client && pnpm exec vitest run src/storage/model/validate.test.ts`
Expected: PASS (3 tests).

- [ ] **Step 5: Add `schema?` to `get` in `types.ts`**

Add the `zod` import at the top of `client/src/storage/model/types.ts`:

```ts
import type { z } from 'zod'
```

Replace the `get` line inside `StorageApi`:

```ts
  get<T>(key: string, schema?: z.ZodType<T>): Promise<StorageError | T | null>
```

(Adding a trailing optional parameter is backward-compatible: existing implementations that ignore it remain assignable.)

- [ ] **Step 6: Make Dexie `get` honor the schema**

In `client/src/storage/model/client/dexie-storage.ts`, add the import near the top:

```ts
import { parseValue } from '../validate'
```

Replace the `get` method:

```ts
    async get<T>(key: string, schema?: import('zod').z.ZodType<T>): Promise<StorageError | T | null> {
      const row = await readValid(toFullKey(namespace, key))
      if (row instanceof Error) return row
      if (row === null) return null
      return parseValue(schema, row.value)
    },
```

- [ ] **Step 7: Make HTTP `get` honor the schema**

In `client/src/storage/model/server/http-storage.ts`, add:

```ts
import { parseValue } from '../validate'
```

Replace the `get` method:

```ts
    async get<T>(key: string, schema?: import('zod').z.ZodType<T>): Promise<StorageError | T | null> {
      const res = await fetch(keyUrl(toFullKey(namespace, key))).catch(
        (cause) => new StorageError({ reason: 'server GET failed', cause }),
      )
      if (res instanceof Error) return res
      if (res.status === 404) return null
      if (!res.ok) return new StorageError({ reason: `server GET ${res.status}` })

      const body = await (res.json() as Promise<{ value: unknown }>).catch(
        (cause) => new StorageError({ reason: 'server GET json parse failed', cause }),
      )
      if (body instanceof Error) return body
      return parseValue(schema, body.value)
    },
```

- [ ] **Step 8: Add a Dexie schema test**

Append to `client/src/storage/model/client/dexie-storage.test.ts` inside the `describe`:

```ts
it('get validates against a schema and returns StorageError on mismatch', async () => {
  const { z } = await import('zod')
  const schema = z.object({ text: z.string() })
  await storage.set('draft', { text: 'hi' })
  expect(await storage.get('draft', schema)).toEqual({ text: 'hi' })
  await storage.set('draft', { text: 123 })
  const { StorageError } = await import('../types')
  expect(await storage.get('draft', schema)).toBeInstanceOf(StorageError)
})
```

- [ ] **Step 9: Run the full storage suite**

Run: `cd client && pnpm exec vitest run src/storage`
Expected: PASS (existing tests + new schema tests).

- [ ] **Step 10: Typecheck**

Run: `pnpm typecheck`
Expected: PASS.

- [ ] **Step 11: Commit**

```bash
git add client/src/storage/model/validate.ts client/src/storage/model/validate.test.ts client/src/storage/model/types.ts client/src/storage/model/client/dexie-storage.ts client/src/storage/model/server/http-storage.ts client/src/storage/model/client/dexie-storage.test.ts
git commit -m "feat(storage): schema-validated get via parseValue"
```

---

## Task 2: Client broadcast registry (`client/channel.ts`)

**Files:**

- Create: `client/src/storage/model/client/channel.ts`
- Create (test): `client/src/storage/model/test/fakes.ts`
- Create (test): `client/src/storage/model/client/channel.test.ts`

**Interfaces:**

- Produces: `getStorageChannel(): BroadcastChannel`
- Produces: `notifyLocal(fullKey: string, rawValue: unknown): void`
- Produces: `registerLocal(fullKey: string, deliver: (rawValue: unknown) => void): () => void`
- Produces: `publishChange(fullKey: string, value: unknown): void`
- Produces (test): `FakeBroadcastChannel` with `installFakeBroadcastChannel()`

- [ ] **Step 1: Create the test fakes** — `client/src/storage/model/test/fakes.ts`

```ts
import { vi } from 'vitest'

/** In-memory BroadcastChannel: instances with the same name see each other's posts. */
export class FakeBroadcastChannel {
  static channels = new Map<string, Set<FakeBroadcastChannel>>()
  onmessage: ((event: MessageEvent) => void) | null = null
  private listeners = new Set<(event: MessageEvent) => void>()

  constructor(public name: string) {
    const peers = FakeBroadcastChannel.channels.get(name) ?? new Set()
    peers.add(this)
    FakeBroadcastChannel.channels.set(name, peers)
  }

  addEventListener(_type: 'message', listener: (event: MessageEvent) => void) {
    this.listeners.add(listener)
  }

  removeEventListener(_type: 'message', listener: (event: MessageEvent) => void) {
    this.listeners.delete(listener)
  }

  postMessage(data: unknown) {
    const peers = FakeBroadcastChannel.channels.get(this.name) ?? new Set()
    for (const peer of peers) {
      if (peer === this) continue // real BroadcastChannel does not echo to sender
      const event = { data } as MessageEvent
      peer.onmessage?.(event)
      for (const listener of peer.listeners) listener(event)
    }
  }

  close() {
    FakeBroadcastChannel.channels.get(this.name)?.delete(this)
  }
}

export function installFakeBroadcastChannel() {
  FakeBroadcastChannel.channels.clear()
  vi.stubGlobal('BroadcastChannel', FakeBroadcastChannel)
}
```

- [ ] **Step 2: Write the failing test** — `client/src/storage/model/client/channel.test.ts`

```ts
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { installFakeBroadcastChannel } from '../test/fakes'

beforeEach(() => {
  installFakeBroadcastChannel()
  vi.resetModules()
})

afterEach(() => {
  vi.unstubAllGlobals()
})

describe('channel registry', () => {
  it('publishChange notifies same-runtime subscribers', async () => {
    const { registerLocal, publishChange } = await import('./channel')
    const seen: unknown[] = []
    registerLocal('w:t:clock:settings', (raw) => seen.push(raw))
    publishChange('w:t:clock:settings', { a: 1 })
    expect(seen).toEqual([{ a: 1 }])
  })

  it('does not notify subscribers of a different key', async () => {
    const { registerLocal, publishChange } = await import('./channel')
    const seen: unknown[] = []
    registerLocal('w:t:clock:other', (raw) => seen.push(raw))
    publishChange('w:t:clock:settings', 1)
    expect(seen).toEqual([])
  })

  it('unsubscribe stops delivery', async () => {
    const { registerLocal, publishChange } = await import('./channel')
    const seen: unknown[] = []
    const off = registerLocal('k', (raw) => seen.push(raw))
    off()
    publishChange('k', 1)
    expect(seen).toEqual([])
  })

  it('delivers messages arriving from another runtime via the channel', async () => {
    const { registerLocal } = await import('./channel')
    const seen: unknown[] = []
    registerLocal('w:t:clock:settings', (raw) => seen.push(raw))
    // simulate another tab/iframe posting on the same channel name
    const other = new BroadcastChannel('myboard-storage')
    other.postMessage({ fullKey: 'w:t:clock:settings', value: 99 })
    expect(seen).toEqual([99])
  })
})
```

- [ ] **Step 3: Run test to verify it fails**

Run: `cd client && pnpm exec vitest run src/storage/model/client/channel.test.ts`
Expected: FAIL — cannot find module `./channel`.

- [ ] **Step 4: Create `client/channel.ts`**

```ts
export type StorageDeliver = (rawValue: unknown) => void
export type ChannelMessage = { fullKey: string; value: unknown }

const CHANNEL_NAME = 'myboard-storage'
const subscribers = new Map<string, Set<StorageDeliver>>()

let channel: BroadcastChannel | undefined
let listening = false

export function getStorageChannel(): BroadcastChannel {
  if (!channel) channel = new BroadcastChannel(CHANNEL_NAME)
  return channel
}

export function notifyLocal(fullKey: string, rawValue: unknown): void {
  const set = subscribers.get(fullKey)
  if (!set) return
  for (const deliver of set) deliver(rawValue)
}

function ensureChannelListener(): void {
  if (listening) return
  listening = true
  getStorageChannel().addEventListener('message', (event) => {
    const message = (event as MessageEvent<ChannelMessage>).data
    notifyLocal(message.fullKey, message.value)
  })
}

/** Register a delivery callback for a full key. Returns an unsubscribe function. */
export function registerLocal(fullKey: string, deliver: StorageDeliver): () => void {
  ensureChannelListener()
  let set = subscribers.get(fullKey)
  if (!set) {
    set = new Set()
    subscribers.set(fullKey, set)
  }
  set.add(deliver)
  return () => {
    set.delete(deliver)
    if (set.size === 0) subscribers.delete(fullKey)
  }
}

/** Notify same-runtime subscribers and broadcast to other tabs/iframes. */
export function publishChange(fullKey: string, value: unknown): void {
  notifyLocal(fullKey, value)
  getStorageChannel().postMessage({ fullKey, value } satisfies ChannelMessage)
}
```

- [ ] **Step 5: Run test to verify it passes**

Run: `cd client && pnpm exec vitest run src/storage/model/client/channel.test.ts`
Expected: PASS (4 tests).

- [ ] **Step 6: Add a `BroadcastChannel` polyfill to the test setup**

Task 3 makes `set`/`delete`/`clearExpired` broadcast, so **every** existing Dexie/Reatom test will create a `BroadcastChannel`. jsdom lacks it (just like the existing `ResizeObserver`/`matchMedia` polyfills here), so add a passive polyfill to `client/src/vitest.setup.ts`. Append:

```ts
// jsdom lacks BroadcastChannel; the storage layer broadcasts key changes across tabs.
// Passive in-memory polyfill — tests that need to control it use vi.stubGlobal instead.
if (typeof globalThis.BroadcastChannel === 'undefined') {
  const peers = new Map<string, Set<BroadcastChannelPolyfill>>()
  class BroadcastChannelPolyfill {
    onmessage: ((event: MessageEvent) => void) | null = null
    private listeners = new Set<(event: MessageEvent) => void>()
    constructor(public name: string) {
      const set = peers.get(name) ?? new Set()
      set.add(this)
      peers.set(name, set)
    }
    addEventListener(_type: 'message', listener: (event: MessageEvent) => void) {
      this.listeners.add(listener)
    }
    removeEventListener(_type: 'message', listener: (event: MessageEvent) => void) {
      this.listeners.delete(listener)
    }
    postMessage(data: unknown) {
      for (const peer of peers.get(this.name) ?? []) {
        if (peer === this) continue
        const event = { data } as MessageEvent
        peer.onmessage?.(event)
        for (const listener of peer.listeners) listener(event)
      }
    }
    close() {
      peers.get(this.name)?.delete(this)
    }
  }
  globalThis.BroadcastChannel = BroadcastChannelPolyfill as unknown as typeof BroadcastChannel
}
```

- [ ] **Step 7: Run the existing storage suite to confirm nothing regressed**

Run: `cd client && pnpm exec vitest run src/storage`
Expected: PASS.

- [ ] **Step 8: Commit**

```bash
git add client/src/storage/model/client/channel.ts client/src/storage/model/test/fakes.ts client/src/storage/model/client/channel.test.ts client/src/vitest.setup.ts
git commit -m "feat(storage): client broadcast registry for cross-tab reactivity"
```

---

## Task 3: `subscribe` contract + Dexie reactivity (+ HTTP initial-emit stub)

**Files:**

- Modify: `client/src/storage/model/types.ts` (add `StorageChange`, `StorageListener`, `subscribe`)
- Modify: `client/src/storage/model/client/dexie-storage.ts` (`subscribe`, broadcast on write)
- Modify: `client/src/storage/model/client/db.ts` (`clearExpired` tombstones)
- Modify: `client/src/storage/model/server/http-storage.ts` (`subscribe` — initial emit only; live updates land in Task 5)
- Modify (test): `client/src/storage/model/client/dexie-storage.test.ts`

**Interfaces:**

- Consumes: `registerLocal`, `publishChange` (Task 2); `parseValue` (Task 1)
- Produces: `StorageChange<T> = { value: T | null }`
- Produces: `StorageListener<T> = (event: StorageError | StorageChange<T>) => void`
- Produces: `StorageApi.subscribe<T>(key: string, listener: StorageListener<T>, schema?: z.ZodType<T>): () => void`

- [ ] **Step 1: Write the failing Dexie subscribe test**

Append to `client/src/storage/model/client/dexie-storage.test.ts`. Add at the top of the file (after existing imports):

```ts
import { installFakeBroadcastChannel } from '../test/fakes'
```

Add a new `describe` block:

```ts
describe('createDexieStorage subscribe', () => {
  beforeEach(() => {
    installFakeBroadcastChannel()
  })
  afterEach(() => {
    vi.unstubAllGlobals()
  })

  it('emits the current value on subscribe then on each change', async () => {
    await storage.set('draft', { text: 'first' })
    const seen: unknown[] = []
    const off = storage.subscribe<{ text: string }>('draft', (event) => {
      seen.push(event instanceof Error ? 'error' : event.value)
    })
    // initial emit is async (best-effort get)
    await vi.waitFor(() => expect(seen.length).toBeGreaterThanOrEqual(1))
    await storage.set('draft', { text: 'second' })
    await storage.delete('draft')
    off()
    expect(seen).toEqual([{ text: 'first' }, { text: 'second' }, null])
  })
})
```

Ensure `vi` is imported in this file's top import: `import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'`.

- [ ] **Step 2: Run test to verify it fails**

Run: `cd client && pnpm exec vitest run src/storage/model/client/dexie-storage.test.ts`
Expected: FAIL — `storage.subscribe is not a function`.

- [ ] **Step 3: Add the contract types to `types.ts`**

In `client/src/storage/model/types.ts`, add after the `StorageError` class:

```ts
/** A key's current value. value=null means deleted / absent / expired. */
export type StorageChange<T = unknown> = { value: T | null }

/** Receives a validated change, or an error — always as a value. */
export type StorageListener<T = unknown> = (event: StorageError | StorageChange<T>) => void
```

Add `subscribe` to the `StorageApi` type (after `keys`):

```ts
  subscribe<T>(key: string, listener: StorageListener<T>, schema?: z.ZodType<T>): () => void
```

- [ ] **Step 4: Implement Dexie `subscribe` and broadcast on write**

In `client/src/storage/model/client/dexie-storage.ts`:

Update imports:

```ts
import {
  StorageError,
  type StorageApi,
  type StorageEntry,
  type StorageListener,
  type StorageOptions,
} from '../types'
import { toFullKey, toRelativeKey } from '../scope'
import { db as defaultDb, type StorageDb } from './db'
import { parseValue } from '../validate'
import { registerLocal, publishChange } from './channel'
```

In `set`, after the successful `table.put`, broadcast. Replace the `set` body's tail:

```ts
const result = await table
  .put(entry)
  .catch((cause) => new StorageError({ reason: 'dexie write failed', cause }))
if (result instanceof Error) return result
publishChange(toFullKey(namespace, key), value)
```

In `delete`, after a successful delete, broadcast a tombstone:

```ts
    async delete(key: string): Promise<StorageError | void> {
      const result = await table.delete(toFullKey(namespace, key)).catch(
        (cause) => new StorageError({ reason: 'dexie delete failed', cause }),
      )
      if (result instanceof Error) return result
      publishChange(toFullKey(namespace, key), null)
    },
```

Add `subscribe` to the returned object (after `keys`):

```ts
    subscribe<T>(
      key: string,
      listener: StorageListener<T>,
      schema?: import('zod').z.ZodType<T>,
    ): () => void {
      const fullKey = toFullKey(namespace, key)
      const deliver = (raw: unknown) => {
        if (raw === null) return listener({ value: null })
        const parsed = parseValue(schema, raw)
        listener(parsed instanceof Error ? parsed : { value: parsed })
      }
      const unregister = registerLocal(fullKey, deliver)
      void this.get<T>(key, schema).then((current) => {
        if (current instanceof Error) return listener(current)
        listener({ value: current })
      })
      return unregister
    },
```

> Note: `this.get` resolves because `subscribe` is invoked as a method on the returned object. The initial emit uses the already-validated `get` result; live updates run raw broadcasts through `deliver` (which validates).

- [ ] **Step 5: Run the Dexie subscribe test**

Run: `cd client && pnpm exec vitest run src/storage/model/client/dexie-storage.test.ts`
Expected: PASS.

- [ ] **Step 6: Write the failing `clearExpired` tombstone test**

Append to `client/src/storage/model/client/dexie-storage.test.ts` inside the `subscribe` describe block. `db` and `clearExpired` are already imported at the top of the file (`import { db, clearExpired } from './db'`). The expired row is inserted directly (bypassing `set`) so the initial-emit `get` does not purge it first:

```ts
it('clearExpired broadcasts a tombstone for purged keys', async () => {
  const seen: unknown[] = []
  storage.subscribe('temp', (event) => {
    seen.push(event instanceof Error ? 'error' : event.value)
  })
  await vi.waitFor(() => expect(seen.length).toBe(1)) // initial emit: null (missing)
  seen.length = 0
  await db.entries.put({
    key: `${ns}temp`,
    namespace: ns,
    value: 5,
    expiresAt: Date.now() - 1,
    updatedAt: Date.now(),
  })
  await clearExpired()
  await vi.waitFor(() => expect(seen).toEqual([null]))
})
```

- [ ] **Step 7: Run to verify it fails**

Run: `cd client && pnpm exec vitest run src/storage/model/client/dexie-storage.test.ts`
Expected: FAIL — no tombstone (`seen` never contains `null` from `clearExpired`).

- [ ] **Step 8: Make `clearExpired` broadcast tombstones**

Replace `clearExpired` in `client/src/storage/model/client/db.ts`:

```ts
import Dexie, { type Table } from 'dexie'
import type { StorageEntry } from '../types'
import { publishChange } from './channel'

export class StorageDb extends Dexie {
  entries!: Table<StorageEntry, string>

  constructor() {
    super('myboard-storage')
    this.version(1).stores({
      entries: 'key, namespace, expiresAt, updatedAt',
    })
  }
}

export const db = new StorageDb()

/** Delete every entry with a numeric expiry in the past; broadcast tombstones. Returns the count removed. */
export async function clearExpired(database: StorageDb = db): Promise<number> {
  const expired = await database.entries.where('expiresAt').below(Date.now()).toArray()
  if (expired.length === 0) return 0
  await database.entries.bulkDelete(expired.map((entry) => entry.key))
  for (const entry of expired) publishChange(entry.key, null)
  return expired.length
}
```

- [ ] **Step 9: Run to verify it passes**

Run: `cd client && pnpm exec vitest run src/storage/model/client/dexie-storage.test.ts`
Expected: PASS.

- [ ] **Step 10: Add the HTTP `subscribe` initial-emit stub**

This keeps the `StorageApi` interface satisfied and the build green. Live SSE updates arrive in Task 5.

In `client/src/storage/model/server/http-storage.ts`, update imports:

```ts
import { StorageError, type StorageApi, type StorageListener, type StorageOptions } from '../types'
```

Add `subscribe` to the returned object (after `keys`):

```ts
    subscribe<T>(
      key: string,
      listener: StorageListener<T>,
      schema?: import('zod').z.ZodType<T>,
    ): () => void {
      // Initial value only; live updates are wired to SSE in a later step.
      void this.get<T>(key, schema).then((current) => {
        if (current instanceof Error) return listener(current)
        listener({ value: current })
      })
      return () => {}
    },
```

- [ ] **Step 11: Add an HTTP initial-emit test**

Append to `client/src/storage/model/server/http-storage.test.ts` inside the `describe`:

```ts
it('subscribe emits the current value once on attach', async () => {
  stubFetch(() => new Response(JSON.stringify({ value: { a: 1 } }), { status: 200 }))
  const seen: unknown[] = []
  storage.subscribe('settings', (event) => {
    seen.push(event instanceof Error ? 'error' : event.value)
  })
  await vi.waitFor(() => expect(seen).toEqual([{ a: 1 }]))
})
```

- [ ] **Step 12: Run the full storage suite + typecheck**

Run: `cd client && pnpm exec vitest run src/storage`
Expected: PASS.
Run: `pnpm typecheck`
Expected: PASS.

- [ ] **Step 13: Commit**

```bash
git add client/src/storage/model/types.ts client/src/storage/model/client/dexie-storage.ts client/src/storage/model/client/db.ts client/src/storage/model/server/http-storage.ts client/src/storage/model/client/dexie-storage.test.ts client/src/storage/model/server/http-storage.test.ts
git commit -m "feat(storage): subscribe primitive with Dexie cross-tab reactivity"
```

---

## Task 4: Server SSE endpoint + Valkey Pub/Sub

**Files:**

- Create: `server/sse.ts`
- Create (test): `server/sse.test.ts`
- Modify: `server/valkey.ts` (add `publish` op + `createValkeySubscriber`)
- Modify: `server/handlers.ts` (add `publishChange`)
- Create (test): append to `server/handlers.test.ts`
- Modify: `server/schemas.ts` (add `EventsBodySchema`)
- Modify: `server/index.ts` (routes + wiring)

**Interfaces:**

- Produces: `class SseRegistry` with `add(id, res)`, `remove(id)`, `subscribe(id, keys)`, `unsubscribe(id, keys)`, `subscribersOf(key): string[]`, `connection(id): SseConnection | undefined`
- Produces: `writeSseEvent(res, event: string | undefined, data: unknown): void`
- Produces: `fanout(registry: SseRegistry, message: { key: string; value: unknown }): void`
- Produces: `ValkeyOps.publish(channel: string, message: string): Promise<void>`
- Produces: `createValkeySubscriber(channel: string, onMessage: (message: string) => void, url?: string): () => void`
- Produces: `publishChange(ops: ValkeyOps, key: string, value: unknown): Promise<void>`
- Produces: `EventsBodySchema` (`{ subscribe?: string[]; unsubscribe?: string[] }`)

- [ ] **Step 1: Write the failing `SseRegistry` test** — `server/sse.test.ts`

```ts
import { describe, expect, it, vi } from 'vitest'
import type { ServerResponse } from 'node:http'
import { SseRegistry, writeSseEvent, fanout } from './sse'

function fakeRes() {
  return { write: vi.fn(), writableEnded: false } as unknown as ServerResponse
}

describe('SseRegistry', () => {
  it('tracks interest per key and lists subscribers', () => {
    const reg = new SseRegistry()
    reg.add('c1', fakeRes())
    reg.subscribe('c1', ['w:t:clock:settings'])
    expect(reg.subscribersOf('w:t:clock:settings')).toEqual(['c1'])
  })

  it('unsubscribe removes interest', () => {
    const reg = new SseRegistry()
    reg.add('c1', fakeRes())
    reg.subscribe('c1', ['k'])
    reg.unsubscribe('c1', ['k'])
    expect(reg.subscribersOf('k')).toEqual([])
  })

  it('remove drops the connection from every key index', () => {
    const reg = new SseRegistry()
    reg.add('c1', fakeRes())
    reg.subscribe('c1', ['a', 'b'])
    reg.remove('c1')
    expect(reg.subscribersOf('a')).toEqual([])
    expect(reg.subscribersOf('b')).toEqual([])
  })
})

describe('writeSseEvent', () => {
  it('writes a named event frame', () => {
    const res = fakeRes()
    writeSseEvent(res, 'ready', { connId: 'x' })
    expect(res.write).toHaveBeenCalledWith('event: ready\n')
    expect(res.write).toHaveBeenCalledWith('data: {"connId":"x"}\n\n')
  })

  it('writes a default (data-only) frame', () => {
    const res = fakeRes()
    writeSseEvent(res, undefined, { key: 'k', value: 1 })
    expect(res.write).toHaveBeenCalledWith('data: {"key":"k","value":1}\n\n')
  })
})

describe('fanout', () => {
  it('writes the change to every interested connection', () => {
    const reg = new SseRegistry()
    const res = fakeRes()
    reg.add('c1', res)
    reg.subscribe('c1', ['k'])
    fanout(reg, { key: 'k', value: 42 })
    expect(res.write).toHaveBeenCalledWith('data: {"key":"k","value":42}\n\n')
  })

  it('ignores keys with no subscribers', () => {
    const reg = new SseRegistry()
    expect(() => fanout(reg, { key: 'none', value: 1 })).not.toThrow()
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd server && pnpm exec vitest run sse.test.ts`
Expected: FAIL — cannot find module `./sse`.

- [ ] **Step 3: Create `server/sse.ts`**

```ts
import type { ServerResponse } from 'node:http'

export type SseConnection = { id: string; res: ServerResponse; keys: Set<string> }

export class SseRegistry {
  private connections = new Map<string, SseConnection>()
  private keyIndex = new Map<string, Set<string>>()

  add(id: string, res: ServerResponse): SseConnection {
    const conn: SseConnection = { id, res, keys: new Set() }
    this.connections.set(id, conn)
    return conn
  }

  remove(id: string): void {
    const conn = this.connections.get(id)
    if (!conn) return
    for (const key of conn.keys) this.dropFromKey(id, key)
    this.connections.delete(id)
  }

  subscribe(id: string, keys: string[]): void {
    const conn = this.connections.get(id)
    if (!conn) return
    for (const key of keys) {
      conn.keys.add(key)
      let set = this.keyIndex.get(key)
      if (!set) {
        set = new Set()
        this.keyIndex.set(key, set)
      }
      set.add(id)
    }
  }

  unsubscribe(id: string, keys: string[]): void {
    const conn = this.connections.get(id)
    if (!conn) return
    for (const key of keys) {
      conn.keys.delete(key)
      this.dropFromKey(id, key)
    }
  }

  subscribersOf(key: string): string[] {
    return [...(this.keyIndex.get(key) ?? [])]
  }

  connection(id: string): SseConnection | undefined {
    return this.connections.get(id)
  }

  private dropFromKey(id: string, key: string): void {
    const set = this.keyIndex.get(key)
    if (!set) return
    set.delete(id)
    if (set.size === 0) this.keyIndex.delete(key)
  }
}

export function writeSseEvent(res: ServerResponse, event: string | undefined, data: unknown): void {
  if (event) res.write(`event: ${event}\n`)
  res.write(`data: ${JSON.stringify(data)}\n\n`)
}

export function fanout(registry: SseRegistry, message: { key: string; value: unknown }): void {
  for (const id of registry.subscribersOf(message.key)) {
    const conn = registry.connection(id)
    if (conn) writeSseEvent(conn.res, undefined, message)
  }
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd server && pnpm exec vitest run sse.test.ts`
Expected: PASS.

- [ ] **Step 5: Add `publish` op + subscriber to `valkey.ts`**

In `server/valkey.ts`, add `publish` to the `ValkeyOps` type:

```ts
export type ValkeyOps = {
  get(key: string): Promise<string | null>
  set(key: string, value: string, ttlMs?: number): Promise<void>
  del(key: string): Promise<void>
  scanKeys(matchPrefix: string): Promise<string[]>
  publish(channel: string, message: string): Promise<void>
}
```

Add the `publish` implementation inside the returned object (after `scanKeys`):

```ts
    async publish(channel, message) {
      await client.publish(channel, message)
    },
```

Append the subscriber factory at the end of the file (a dedicated connection — Pub/Sub mode cannot run normal commands):

```ts
/** Subscribe to a channel on a dedicated connection. Returns a teardown function. */
export function createValkeySubscriber(
  channel: string,
  onMessage: (message: string) => void,
  url = process.env.VALKEY_URL ?? 'redis://localhost:6379',
): () => void {
  const client = new Valkey(url)
  void client.subscribe(channel)
  client.on('message', (_channel, message) => onMessage(message))
  return () => {
    void client.unsubscribe(channel)
    client.disconnect()
  }
}
```

- [ ] **Step 6: Write the failing `publishChange` test**

Append to `server/handlers.test.ts`:

```ts
import { publishChange } from './handlers'

describe('publishChange', () => {
  it('publishes the change envelope to the events channel', async () => {
    const ops = mockOps({ publish: vi.fn(async () => {}) })
    await publishChange(ops, 'w:t:clock:settings', { a: 1 })
    expect(ops.publish).toHaveBeenCalledWith(
      'storage:events',
      JSON.stringify({ key: 'w:t:clock:settings', value: { a: 1 } }),
    )
  })
})
```

Update `mockOps` in `server/handlers.test.ts` to include the new op:

```ts
function mockOps(overrides: Partial<ValkeyOps> = {}): ValkeyOps {
  return {
    get: vi.fn(async () => null),
    set: vi.fn(async () => {}),
    del: vi.fn(async () => {}),
    scanKeys: vi.fn(async () => []),
    publish: vi.fn(async () => {}),
    ...overrides,
  }
}
```

- [ ] **Step 7: Run to verify it fails**

Run: `cd server && pnpm exec vitest run handlers.test.ts`
Expected: FAIL — `publishChange` is not exported.

- [ ] **Step 8: Add `publishChange` to `handlers.ts`**

Append to `server/handlers.ts`:

```ts
export const EVENTS_CHANNEL = 'storage:events'

export async function publishChange(ops: ValkeyOps, key: string, value: unknown): Promise<void> {
  await ops.publish(EVENTS_CHANNEL, JSON.stringify({ key, value }))
}
```

- [ ] **Step 9: Run to verify it passes**

Run: `cd server && pnpm exec vitest run handlers.test.ts`
Expected: PASS.

- [ ] **Step 10: Add the registration body schema**

Append to `server/schemas.ts`:

```ts
export const EventsBodySchema = z.object({
  subscribe: z.array(z.string()).optional(),
  unsubscribe: z.array(z.string()).optional(),
})

export type EventsBody = z.infer<typeof EventsBodySchema>
```

- [ ] **Step 11: Wire the routes and subscriber in `index.ts`**

Edit `server/index.ts`. Update imports:

```ts
import { createServer, type ServerResponse } from 'node:http'
import { randomUUID } from 'node:crypto'
import Router from 'find-my-way'
import { createValkeyOps, createValkeySubscriber } from './valkey'
import { readJsonBody } from './body'
import {
  handleGet,
  handlePut,
  handleDelete,
  handleKeys,
  publishChange,
  type HandlerResult,
} from './handlers'
import { PutPayloadSchema, PrefixQuerySchema, EventsBodySchema, formatZodError } from './schemas'
import { SseRegistry, writeSseEvent, fanout } from './sse'
```

After `const router = ...`, create the registry and boot the subscriber:

```ts
const registry = new SseRegistry()
createValkeySubscriber('storage:events', (message) => {
  try {
    // TODO: используй здесь валидацию zod всесто небезопасного JSON.parse
    fanout(registry, JSON.parse(message) as { key: string; value: unknown })
  } catch {
    // ignore malformed pub/sub payloads
  }
})
const HEARTBEAT_MS = 25_000
```

Add the SSE stream route (register BEFORE the `/api/storage/:key` routes so the static path wins):

```ts
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
  // TODO: добавь здесь явную проверку на строку. можешь использовать z.string()
  const connId = params.connId as string
  if (parsed.data.subscribe) registry.subscribe(connId, parsed.data.subscribe)
  if (parsed.data.unsubscribe) registry.unsubscribe(connId, parsed.data.unsubscribe)
  res.writeHead(204)
  res.end()
})
```

In the existing `PUT` route, after `send(res, ...)`, publish the change. Replace the final line of the PUT handler:

```ts
const key = decodeURIComponent(params.key as string)
send(res, await handlePut(ops, key, parsed.data))
await publishChange(ops, key, parsed.data.value)
```

In the existing `DELETE` route, replace the body:

```ts
router.on('DELETE', '/api/storage/:key', async (_req, res, params) => {
  const key = decodeURIComponent(params.key as string)
  send(res, await handleDelete(ops, key))
  await publishChange(ops, key, null)
})
```

- [ ] **Step 12: Typecheck the server build**

Run: `pnpm --filter server build`
Expected: PASS (bundles with Rspack).

- [ ] **Step 13: Run the whole server suite**

Run: `cd server && pnpm exec vitest run`
Expected: PASS.

- [ ] **Step 14: Commit**

```bash
git add server/sse.ts server/sse.test.ts server/valkey.ts server/handlers.ts server/handlers.test.ts server/schemas.ts server/index.ts
git commit -m "feat(server): SSE event stream + Valkey pub/sub fanout"
```

---

## Task 5: Client SSE manager + live HTTP `subscribe`

**Files:**

- Create: `client/src/storage/model/server/sse-client.ts`
- Modify: `client/src/storage/model/test/fakes.ts` (add `FakeEventSource`)
- Modify: `client/src/storage/model/server/http-storage.ts` (`subscribe` uses the SSE manager)
- Create (test): `client/src/storage/model/server/sse-client.test.ts`
- Modify (test): `client/src/storage/model/server/http-storage.test.ts`

**Interfaces:**

- Consumes: `parseValue` (Task 1); the server routes `GET /api/storage/events`, `POST /api/storage/events/:connId` (Task 4)
- Produces: `getSseManager(baseUrl: string): { add(fullKey: string, deliver: (rawValue: unknown) => void): () => void }`
- Produces (test): `FakeEventSource` with static `instances` + `emit(event, data)` helpers

- [ ] **Step 1: Add `FakeEventSource` to the test fakes**

Append to `client/src/storage/model/test/fakes.ts`:

```ts
/** Minimal EventSource double: capture instances and push events manually. */
export class FakeEventSource {
  static instances: FakeEventSource[] = []
  listeners = new Map<string, Set<(event: MessageEvent) => void>>()
  onmessage: ((event: MessageEvent) => void) | null = null
  readyState = 0

  constructor(public url: string) {
    FakeEventSource.instances.push(this)
  }

  addEventListener(type: string, listener: (event: MessageEvent) => void) {
    const set = this.listeners.get(type) ?? new Set()
    set.add(listener)
    this.listeners.set(type, set)
  }

  /** Simulate a server frame. type 'message' fires onmessage + 'message' listeners. */
  emit(type: string, data: unknown) {
    const event = { data: JSON.stringify(data) } as MessageEvent
    if (type === 'message') this.onmessage?.(event)
    for (const listener of this.listeners.get(type) ?? []) listener(event)
  }

  close() {
    this.readyState = 2
  }
}

export function installFakeEventSource() {
  FakeEventSource.instances = []
  vi.stubGlobal('EventSource', FakeEventSource)
}
```

- [ ] **Step 2: Write the failing SSE manager test** — `client/src/storage/model/server/sse-client.test.ts`

```ts
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { FakeEventSource, installFakeEventSource } from '../test/fakes'

beforeEach(() => {
  installFakeEventSource()
  vi.resetModules()
  vi.stubGlobal(
    'fetch',
    vi.fn(() => Promise.resolve(new Response(null, { status: 204 }))),
  )
})

afterEach(() => {
  vi.unstubAllGlobals()
})

describe('getSseManager', () => {
  it('registers interest after ready and delivers matching events', async () => {
    const { getSseManager } = await import('./sse-client')
    const mgr = getSseManager('/api/storage')
    const seen: unknown[] = []
    mgr.add('w:t:clock:settings', (raw) => seen.push(raw))

    const es = FakeEventSource.instances[0]
    expect(es.url).toBe('/api/storage/events')

    es.emit('ready', { connId: 'c1' })
    await vi.waitFor(() => {
      const fetchMock = globalThis.fetch as ReturnType<typeof vi.fn>
      expect(fetchMock).toHaveBeenCalledWith(
        '/api/storage/events/c1',
        expect.objectContaining({ method: 'POST' }),
      )
    })

    es.emit('message', { key: 'w:t:clock:settings', value: 7 })
    expect(seen).toEqual([7])
  })

  it('re-registers all desired keys on a fresh ready (reconnect)', async () => {
    const { getSseManager } = await import('./sse-client')
    const mgr = getSseManager('/api/storage')
    mgr.add('k1', () => {})
    const es = FakeEventSource.instances[0]
    es.emit('ready', { connId: 'c1' })
    await vi.waitFor(() => expect(globalThis.fetch).toHaveBeenCalled())
    const fetchMock = globalThis.fetch as ReturnType<typeof vi.fn>
    fetchMock.mockClear()

    es.emit('ready', { connId: 'c2' }) // reconnect: new connId
    await vi.waitFor(() => {
      const body = JSON.parse((fetchMock.mock.calls[0][1] as RequestInit).body as string)
      expect(fetchMock.mock.calls[0][0]).toBe('/api/storage/events/c2')
      expect(body.subscribe).toContain('k1')
    })
  })
})
```

- [ ] **Step 3: Run to verify it fails**

Run: `cd client && pnpm exec vitest run src/storage/model/server/sse-client.test.ts`
Expected: FAIL — cannot find module `./sse-client`.

- [ ] **Step 4: Create `server/sse-client.ts`**

```ts
export type SseDeliver = (rawValue: unknown) => void

type SseManager = { add(fullKey: string, deliver: SseDeliver): () => void }

const managers = new Map<string, SseManager>()

export function getSseManager(baseUrl: string): SseManager {
  let mgr = managers.get(baseUrl)
  if (!mgr) {
    mgr = createSseManager(baseUrl)
    managers.set(baseUrl, mgr)
  }
  return mgr
}

function createSseManager(baseUrl: string): SseManager {
  const subscribers = new Map<string, Set<SseDeliver>>()
  const desired = new Set<string>()
  let registered = new Set<string>()
  let connId: string | undefined
  let syncScheduled = false

  const source = new EventSource(`${baseUrl}/events`)

  source.addEventListener('ready', (event) => {
    // TODO: либо здесь не нужен as MessageEvent либо добавь более явную проверку
    connId = JSON.parse((event as MessageEvent).data).connId
    registered = new Set() // new connection: server knows nothing yet
    scheduleSync()
  })

  source.onmessage = (event) => {
    // TODO: используй zod для валидации
    const message = JSON.parse((event as MessageEvent).data) as { key: string; value: unknown }
    const set = subscribers.get(message.key)
    if (set) for (const deliver of set) deliver(message.value)
  }

  function scheduleSync(): void {
    if (syncScheduled) return
    syncScheduled = true
    queueMicrotask(() => {
      syncScheduled = false
      void sync()
    })
  }

  async function sync(): Promise<void> {
    if (!connId) return
    const subscribe = [...desired].filter((key) => !registered.has(key))
    const unsubscribe = [...registered].filter((key) => !desired.has(key))
    if (subscribe.length === 0 && unsubscribe.length === 0) return
    registered = new Set(desired)
    await fetch(`${baseUrl}/events/${connId}`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ subscribe, unsubscribe }),
    }).catch(() => {
      registered = new Set() // force a resync on the next tick if the POST failed
    })
  }

  return {
    add(fullKey, deliver) {
      let set = subscribers.get(fullKey)
      if (!set) {
        set = new Set()
        subscribers.set(fullKey, set)
      }
      set.add(deliver)
      desired.add(fullKey)
      scheduleSync()
      return () => {
        set.delete(deliver)
        if (set.size === 0) {
          subscribers.delete(fullKey)
          desired.delete(fullKey)
          scheduleSync()
        }
      }
    },
  }
}
```

- [ ] **Step 5: Run to verify it passes**

Run: `cd client && pnpm exec vitest run src/storage/model/server/sse-client.test.ts`
Expected: PASS.

- [ ] **Step 6: Replace the HTTP `subscribe` stub with the live implementation**

In `client/src/storage/model/server/http-storage.ts`, add the import:

```ts
import { getSseManager } from './sse-client'
```

Replace the `subscribe` method body (the initial-emit stub from Task 3):

```ts
    subscribe<T>(
      key: string,
      listener: StorageListener<T>,
      schema?: import('zod').z.ZodType<T>,
    ): () => void {
      const fullKey = toFullKey(namespace, key)
      const deliver = (raw: unknown) => {
        if (raw === null) return listener({ value: null })
        const parsed = parseValue(schema, raw)
        listener(parsed instanceof Error ? parsed : { value: parsed })
      }
      const remove = getSseManager(baseUrl).add(fullKey, deliver)
      void this.get<T>(key, schema).then((current) => {
        if (current instanceof Error) return listener(current)
        listener({ value: current })
      })
      return remove
    },
```

- [ ] **Step 7: Upgrade the HTTP subscribe test to assert a live update**

In `client/src/storage/model/server/http-storage.test.ts`, add the fake EventSource import at the top:

```ts
import { FakeEventSource, installFakeEventSource } from '../test/fakes'
```

Replace the `subscribe emits the current value once on attach` test with:

```ts
it('subscribe emits the initial value then live SSE updates', async () => {
  installFakeEventSource()
  stubFetch(() => new Response(JSON.stringify({ value: { a: 1 } }), { status: 200 }))
  const seen: unknown[] = []
  storage.subscribe<{ a: number }>('settings', (event) => {
    seen.push(event instanceof Error ? 'error' : event.value)
  })
  await vi.waitFor(() => expect(seen).toContainEqual({ a: 1 }))

  const es = FakeEventSource.instances[0]
  es.emit('ready', { connId: 'c1' })
  es.emit('message', { key: 'w:t:clock:settings', value: { a: 2 } })
  expect(seen).toContainEqual({ a: 2 })
})
```

- [ ] **Step 8: Run the full storage suite + typecheck**

Run: `cd client && pnpm exec vitest run src/storage`
Expected: PASS.
Run: `pnpm typecheck`
Expected: PASS.

- [ ] **Step 9: Commit**

```bash
git add client/src/storage/model/server/sse-client.ts client/src/storage/model/test/fakes.ts client/src/storage/model/server/http-storage.ts client/src/storage/model/server/sse-client.test.ts client/src/storage/model/server/http-storage.test.ts
git commit -m "feat(storage): live HTTP subscribe over shared SSE connection"
```

---

## Task 6: Reatom reactive-key wrapper (`reatomStorageKey`)

**Files:**

- Modify: `client/src/storage/model/reatom/reatom-storage.ts`
- Modify (test): `client/src/storage/model/reatom/reatom-storage.test.ts`

**Interfaces:**

- Consumes: `StorageApi.subscribe` (Task 3/5); `StorageError`, `StorageListener` (Task 3)
- Produces: `reatomStorageKey<T>(options: { api: StorageApi; key: string; schema?: z.ZodType<T> }, name: string): { value: Atom<T | null>; error: Atom<StorageError | null> }`

- [ ] **Step 1: Write the failing test**

Append to `client/src/storage/model/reatom/reatom-storage.test.ts`:

```ts
import { reatomStorageKey } from './reatom-storage'

describe('reatomStorageKey', () => {
  it('reflects the current value and live updates while connected', async () => {
    const api: StorageApi = createDexieStorage(instanceNamespace('inst-1'))
    await api.set('draft', 1)
    const key = reatomStorageKey({ api, key: 'draft' }, 'test.draft')
    await context.start(async () => {
      const off = key.value.subscribe(() => {}) // connect the atom
      await vi.waitFor(() => expect(key.value()).toBe(1))
      await api.set('draft', 2)
      await vi.waitFor(() => expect(key.value()).toBe(2))
      off()
    })
  })

  it('unsubscribes from the api on disconnect', async () => {
    const unsubscribe = vi.fn()
    const api = {
      get: vi.fn(async () => null),
      set: vi.fn(),
      delete: vi.fn(),
      has: vi.fn(),
      keys: vi.fn(),
      subscribe: vi.fn(() => unsubscribe),
    } as unknown as StorageApi
    const key = reatomStorageKey({ api, key: 'k' }, 'test.k')
    await context.start(async () => {
      const off = key.value.subscribe(() => {})
      expect(api.subscribe).toHaveBeenCalled()
      off()
    })
    await vi.waitFor(() => expect(unsubscribe).toHaveBeenCalled())
  })
})
```

Ensure the test file imports `vi` (add to the existing vitest import) and `installFakeBroadcastChannel`, and install it in a `beforeEach` for this suite:

```ts
import { installFakeBroadcastChannel } from '../test/fakes'
// inside describe('reatomStorageKey'):
beforeEach(() => installFakeBroadcastChannel())
afterEach(() => vi.unstubAllGlobals())
```

- [ ] **Step 2: Run to verify it fails**

Run: `cd client && pnpm exec vitest run src/storage/model/reatom/reatom-storage.test.ts`
Expected: FAIL — `reatomStorageKey` is not exported.

- [ ] **Step 3: Implement `reatomStorageKey`**

Append to `client/src/storage/model/reatom/reatom-storage.ts`. Add to the top imports:

```ts
import { action, atom, withAsync, withConnectHook, wrap } from '@reatom/core'
import type { z } from 'zod'
import { clearExpired } from '../client/db'
import type { StorageApi, StorageError, StorageOptions } from '../types'
```

Append the factory:

```ts
export type ReatomStorageKeyOptions<T> = {
  api: StorageApi
  key: string
  schema?: z.ZodType<T>
}

/** Reactive value of a single key over StorageApi.subscribe. */
export function reatomStorageKey<T>(
  { api, key, schema }: ReatomStorageKeyOptions<T>,
  name: string,
) {
  const value = atom<T | null>(null, `${name}.value`)
  const error = atom<StorageError | null>(null, `${name}.error`)

  value.extend(
    withConnectHook(() =>
      // external subscription → wrap the listener itself (addEventListener style)
      api.subscribe<T>(
        key,
        wrap((event) => {
          if (event instanceof Error) return error.set(event)
          error.set(null)
          value.set(event.value)
        }),
        schema,
      ),
    ),
  )

  return { value, error }
}
```

> `withConnectHook` returns the cleanup (the `api.subscribe` unsubscribe), so the subscription is torn down on disconnect. `wrap` wraps the external listener so its `atom.set` calls are batched into the reactive context.

- [ ] **Step 4: Run to verify it passes**

Run: `cd client && pnpm exec vitest run src/storage/model/reatom/reatom-storage.test.ts`
Expected: PASS.

- [ ] **Step 5: Full suite + typecheck**

Run: `pnpm test`
Expected: PASS (whole workspace).
Run: `pnpm typecheck`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add client/src/storage/model/reatom/reatom-storage.ts client/src/storage/model/reatom/reatom-storage.test.ts
git commit -m "feat(storage): reatomStorageKey reactive read atom"
```

---

## Final Verification

- [ ] Run the whole workspace test suite: `pnpm test` — expect PASS.
- [ ] Run typecheck: `pnpm typecheck` — expect PASS.
- [ ] Lint: `pnpm lint` (if defined) — expect PASS.
- [ ] Manual smoke (Docker): `pnpm docker:dev`, open the board in two browser windows, mount the same widget twice, write a `server`-scoped key in one, confirm the other updates live; toggle a `client`-scoped key across two tabs and confirm cross-tab updates.

---

## Self-Review Notes (author)

- **Spec coverage:** Contract (Task 1, 3) · `parseValue` (Task 1) · client BroadcastChannel reactivity + `clearExpired` tombstones (Task 2, 3) · server SSE + Valkey pub/sub (Task 4) · shared client SSE manager + resync (Task 5) · `reatomStorageKey` (Task 6). Server TTL-expiry real-time push and prefix subscriptions are explicitly out of scope per the spec.
- **Separate registries:** Dexie (`client/channel.ts`) and HTTP (`server/sse-client.ts`) keep independent full-key registries by design — a client key and a server key share a full-key string but are different stores.
- **Type consistency:** `parseValue`, `StorageChange`, `StorageListener`, `subscribe(key, listener, schema?)`, and `reatomStorageKey({ api, key, schema }, name)` are used identically across all tasks.
