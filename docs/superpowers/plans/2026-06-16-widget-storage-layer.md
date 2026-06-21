# Widget Storage Layer Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Give board widgets an explicit two-backend storage API — local (Dexie/IndexedDB) and server (HTTP → Valkey) — with per-instance and per-type scopes, errors returned as values.

**Architecture:** A single `StorageApi` contract with two implementations. Each widget builds its own four scoped APIs (`instance`/`shared` × `client`/`server`) in `main.tsx` from `instanceId` (bridge) + `typeId` (constant). The server is a thin `find-my-way` HTTP service backed by Valkey, reached same-origin via a Vite proxy. A Dockerized three-container stack (client + server + valkey) runs it all. No widget-bridge changes.

**Tech Stack:** TypeScript 6, Vite 8, Vitest 4, React 19, `errore`, Dexie, `find-my-way`, `iovalkey`, `@reatom/core@1001`, Docker Compose.

**Spec:** `docs/superpowers/specs/2026-06-16-widget-storage-design.md`

---

## Conventions

- **Errors as values, never thrown.** Every adapter method returns `StorageError | T` and is guarded by `try/catch` that returns a `StorageError`. This matches `src/board-model/board-storage.ts`.
- **Relative keys.** Each scoped API auto-prepends its namespace; callers pass keys like `'draft'`.
- Tests import test helpers explicitly from `vitest` (the repo does this in widget tests), e.g. `import { describe, it, expect, vi } from 'vitest'`.
- Commands shown without the `rtk` prefix for readability; apply `rtk` at execution if configured.

## File Structure

Create:

- `src/storage/types.ts` — `StorageApi`, `StorageEntry`, `StorageOptions`, `StorageError`.
- `src/storage/scope.ts` — namespace builders + full/relative key conversion.
- `src/storage/scope.test.ts` — scope + `StorageError` tests.
- `src/storage/client/db.ts` — Dexie schema + `clearExpired`.
- `src/storage/client/dexie-storage.ts` — `createDexieStorage(namespace)`.
- `src/storage/client/dexie-storage.test.ts` — client adapter tests.
- `src/storage/server/http-storage.ts` — `createHttpStorage(namespace, baseUrl?)`.
- `src/storage/server/http-storage.test.ts` — HTTP adapter tests.
- `src/storage/widget-storage.ts` — `createWidgetStorage({ instanceId, typeId })`.
- `src/storage/widget-storage.test.ts` — scope isolation test.
- `src/storage/reatom/reatom-storage.ts` — optional Reatom layer.
- `src/storage/reatom/reatom-storage.test.ts` — optional Reatom tests.
- `server/valkey.ts` — `iovalkey` client + ops.
- `server/handlers.ts` — pure request handlers (Valkey-ops injected).
- `server/handlers.test.ts` — handler tests with a mock ops object.
- `server/body.ts` — read + JSON-parse request body.
- `server/body.test.ts` — body reader tests.
- `server/index.ts` — `find-my-way` routes + `http.createServer`.
- `server/Dockerfile` — server image.
- `docker-compose.yml` — client + server + valkey.

Modify:

- `vite.config.ts` — add `/api` dev proxy.
- `tsconfig.node.json` — add `server` to `include`.

---

### Task 1: Contract and scope helpers

**Files:**

- Create: `src/storage/types.ts`
- Create: `src/storage/scope.ts`
- Test: `src/storage/scope.test.ts`

- [ ] **Step 1: Write the failing test**

Create `src/storage/scope.test.ts`:

```ts
import { describe, expect, it } from 'vitest'
import { StorageError } from './types'
import { instanceNamespace, typeNamespace, toFullKey, toRelativeKey } from './scope'

describe('scope', () => {
  it('builds instance and type namespaces', () => {
    expect(instanceNamespace('abc')).toBe('w:i:abc:')
    expect(typeNamespace('clock')).toBe('w:t:clock:')
  })

  it('round-trips full and relative keys', () => {
    const ns = instanceNamespace('abc')
    const full = toFullKey(ns, 'draft')
    expect(full).toBe('w:i:abc:draft')
    expect(toRelativeKey(ns, full)).toBe('draft')
  })

  it('leaves a key unchanged when it does not start with the namespace', () => {
    expect(toRelativeKey('w:i:abc:', 'other:key')).toBe('other:key')
  })
})

describe('StorageError', () => {
  it('interpolates the reason and is an Error', () => {
    const err = new StorageError({ reason: 'read failed' })
    expect(err).toBeInstanceOf(Error)
    expect(err.message).toContain('read failed')
  })
})
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `pnpm exec vitest run src/storage/scope.test.ts`
Expected: FAIL — `./types` and `./scope` do not exist.

- [ ] **Step 3: Create the contract**

Create `src/storage/types.ts`:

```ts
import * as errore from 'errore'

export type StorageOptions = { ttlMs?: number }

export type StorageEntry<T = unknown> = {
  /** Full namespaced key (primary key in Dexie). */
  key: string
  /** Scope prefix the entry belongs to (indexed for listing/cleanup). */
  namespace: string
  value: T
  /** Epoch ms when the entry expires; null = never. */
  expiresAt: number | null
  /** Epoch ms of the last write. */
  updatedAt: number
}

export class StorageError extends errore.createTaggedError({
  name: 'StorageError',
  message: 'Storage operation failed: $reason',
}) {}

export type StorageApi = {
  get<T>(key: string): Promise<StorageError | T | null>
  set<T>(key: string, value: T, options?: StorageOptions): Promise<StorageError | void>
  delete(key: string): Promise<StorageError | void>
  has(key: string): Promise<StorageError | boolean>
  keys(prefix?: string): Promise<StorageError | string[]>
}
```

- [ ] **Step 4: Create the scope helpers**

Create `src/storage/scope.ts`:

```ts
export function instanceNamespace(instanceId: string): string {
  return `w:i:${instanceId}:`
}

export function typeNamespace(typeId: string): string {
  return `w:t:${typeId}:`
}

export function toFullKey(namespace: string, relativeKey: string): string {
  return namespace + relativeKey
}

export function toRelativeKey(namespace: string, fullKey: string): string {
  return fullKey.startsWith(namespace) ? fullKey.slice(namespace.length) : fullKey
}
```

- [ ] **Step 5: Run the test to verify it passes**

Run: `pnpm exec vitest run src/storage/scope.test.ts`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add src/storage/types.ts src/storage/scope.ts src/storage/scope.test.ts
git commit -m "feat(storage): add StorageApi contract and scope helpers"
```

---

### Task 2: Dexie client adapter

**Files:**

- Create: `src/storage/client/db.ts`
- Create: `src/storage/client/dexie-storage.ts`
- Test: `src/storage/client/dexie-storage.test.ts`

- [ ] **Step 1: Install dependencies**

Run:

```bash
pnpm add dexie
pnpm add -D fake-indexeddb
```

Expected: both packages added to `package.json`.

- [ ] **Step 2: Write the failing test**

Create `src/storage/client/dexie-storage.test.ts`:

```ts
import 'fake-indexeddb/auto'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { db, clearExpired } from './db'
import { createDexieStorage } from './dexie-storage'
import { instanceNamespace } from '../scope'

const ns = instanceNamespace('inst-1')
const storage = createDexieStorage(ns)

beforeEach(async () => {
  await db.entries.clear()
})

afterEach(async () => {
  await db.entries.clear()
})

describe('createDexieStorage', () => {
  it('sets and gets a value', async () => {
    await storage.set('draft', { text: 'hi' })
    expect(await storage.get<{ text: string }>('draft')).toEqual({ text: 'hi' })
  })

  it('returns null for a missing key', async () => {
    expect(await storage.get('missing')).toBeNull()
  })

  it('reports presence with has', async () => {
    expect(await storage.has('draft')).toBe(false)
    await storage.set('draft', 1)
    expect(await storage.has('draft')).toBe(true)
  })

  it('deletes a value', async () => {
    await storage.set('draft', 1)
    await storage.delete('draft')
    expect(await storage.get('draft')).toBeNull()
  })

  it('expires a value on read and removes the row', async () => {
    await storage.set('temp', 1, { ttlMs: -1 })
    expect(await storage.get('temp')).toBeNull()
    expect(await db.entries.get(`${ns}temp`)).toBeUndefined()
  })

  it('lists relative keys within the namespace, filtered by prefix', async () => {
    await storage.set('a', 1)
    await storage.set('group:b', 2)
    expect(await storage.keys()).toEqual(expect.arrayContaining(['a', 'group:b']))
    expect(await storage.keys('group:')).toEqual(['group:b'])
  })

  it('clearExpired removes only expired rows', async () => {
    await storage.set('live', 1)
    await storage.set('dead', 1, { ttlMs: -1 })
    await clearExpired()
    expect(await db.entries.get(`${ns}live`)).toBeDefined()
    expect(await db.entries.get(`${ns}dead`)).toBeUndefined()
  })
})
```

- [ ] **Step 3: Run the test to verify it fails**

Run: `pnpm exec vitest run src/storage/client/dexie-storage.test.ts`
Expected: FAIL — `./db` and `./dexie-storage` do not exist.

- [ ] **Step 4: Create the Dexie schema**

Create `src/storage/client/db.ts`:

```ts
import Dexie, { type Table } from 'dexie'
import type { StorageEntry } from '../types'

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

/** Delete every entry that has a numeric expiry in the past. Returns the count removed. */
export async function clearExpired(database: StorageDb = db): Promise<number> {
  return database.entries.where('expiresAt').below(Date.now()).delete()
}
```

- [ ] **Step 5: Create the adapter**

Create `src/storage/client/dexie-storage.ts`:

```ts
import { StorageError, type StorageApi, type StorageEntry, type StorageOptions } from '../types'
import { toFullKey, toRelativeKey } from '../scope'
import { db as defaultDb, type StorageDb } from './db'

export function createDexieStorage(namespace: string, database: StorageDb = defaultDb): StorageApi {
  const table = database.entries

  async function readValid(fullKey: string): Promise<StorageError | StorageEntry | null> {
    try {
      const row = await table.get(fullKey)
      if (!row) return null
      if (row.expiresAt != null && row.expiresAt < Date.now()) {
        await table.delete(fullKey)
        return null
      }
      return row
    } catch (cause) {
      return new StorageError({ reason: 'dexie read failed', cause })
    }
  }

  return {
    async get<T>(key: string): Promise<StorageError | T | null> {
      const row = await readValid(toFullKey(namespace, key))
      if (row instanceof Error) return row
      return row === null ? null : (row.value as T)
    },

    async set<T>(key: string, value: T, options?: StorageOptions): Promise<StorageError | void> {
      try {
        const now = Date.now()
        const entry: StorageEntry<T> = {
          key: toFullKey(namespace, key),
          namespace,
          value,
          expiresAt: options?.ttlMs != null ? now + options.ttlMs : null,
          updatedAt: now,
        }
        await table.put(entry)
      } catch (cause) {
        return new StorageError({ reason: 'dexie write failed', cause })
      }
    },

    async delete(key: string): Promise<StorageError | void> {
      try {
        await table.delete(toFullKey(namespace, key))
      } catch (cause) {
        return new StorageError({ reason: 'dexie delete failed', cause })
      }
    },

    async has(key: string): Promise<StorageError | boolean> {
      const row = await readValid(toFullKey(namespace, key))
      if (row instanceof Error) return row
      return row !== null
    },

    async keys(prefix?: string): Promise<StorageError | string[]> {
      try {
        const fullPrefix = toFullKey(namespace, prefix ?? '')
        const rows = await table.where('key').startsWith(fullPrefix).toArray()
        const now = Date.now()
        return rows
          .filter((row) => row.expiresAt == null || row.expiresAt >= now)
          .map((row) => toRelativeKey(namespace, row.key))
      } catch (cause) {
        return new StorageError({ reason: 'dexie keys failed', cause })
      }
    },
  }
}
```

- [ ] **Step 6: Run the test to verify it passes**

Run: `pnpm exec vitest run src/storage/client/dexie-storage.test.ts`
Expected: PASS.

- [ ] **Step 7: Commit**

```bash
git add package.json pnpm-lock.yaml src/storage/client
git commit -m "feat(storage): add Dexie client adapter"
```

---

### Task 3: HTTP server adapter

**Files:**

- Create: `src/storage/server/http-storage.ts`
- Test: `src/storage/server/http-storage.test.ts`

- [ ] **Step 1: Write the failing test**

Create `src/storage/server/http-storage.test.ts`:

```ts
import { afterEach, describe, expect, it, vi } from 'vitest'
import { StorageError } from '../types'
import { createHttpStorage } from './http-storage'
import { typeNamespace } from '../scope'

const ns = typeNamespace('clock')
const storage = createHttpStorage(ns)

afterEach(() => {
  vi.unstubAllGlobals()
})

function stubFetch(impl: (input: string, init?: RequestInit) => Response) {
  vi.stubGlobal(
    'fetch',
    vi.fn((input: string, init?: RequestInit) => Promise.resolve(impl(input, init))),
  )
}

describe('createHttpStorage', () => {
  it('GET returns the value', async () => {
    stubFetch(() => new Response(JSON.stringify({ value: { a: 1 } }), { status: 200 }))
    expect(await storage.get('settings')).toEqual({ a: 1 })
  })

  it('GET maps 404 to null', async () => {
    stubFetch(() => new Response(null, { status: 404 }))
    expect(await storage.get('settings')).toBeNull()
  })

  it('GET maps other non-2xx to StorageError', async () => {
    stubFetch(() => new Response(null, { status: 503 }))
    expect(await storage.get('settings')).toBeInstanceOf(StorageError)
  })

  it('SET sends a PUT with value and ttl, namespaced and encoded', async () => {
    const fetchMock = vi.fn((_url: string, _init?: RequestInit) =>
      Promise.resolve(new Response(null, { status: 204 })),
    )
    vi.stubGlobal('fetch', fetchMock)
    await storage.set('settings', { a: 1 }, { ttlMs: 1000 })
    const [url, init] = fetchMock.mock.calls[0]
    expect(url).toBe(`/api/storage/${encodeURIComponent('w:t:clock:settings')}`)
    expect(init).toMatchObject({ method: 'PUT' })
    expect(JSON.parse((init as RequestInit).body as string)).toEqual({
      value: { a: 1 },
      ttlMs: 1000,
    })
  })

  it('DELETE sends a DELETE', async () => {
    const fetchMock = vi.fn((_url: string, _init?: RequestInit) =>
      Promise.resolve(new Response(null, { status: 204 })),
    )
    vi.stubGlobal('fetch', fetchMock)
    await storage.delete('settings')
    expect(fetchMock.mock.calls[0][1]).toMatchObject({ method: 'DELETE' })
  })

  it('has returns false on 404, true on 200', async () => {
    stubFetch(() => new Response(null, { status: 404 }))
    expect(await storage.has('settings')).toBe(false)
    stubFetch(() => new Response(JSON.stringify({ value: 1 }), { status: 200 }))
    expect(await storage.has('settings')).toBe(true)
  })

  it('keys queries by prefix and strips the namespace', async () => {
    const fetchMock = vi.fn((_url: string) =>
      Promise.resolve(
        new Response(JSON.stringify({ keys: ['w:t:clock:a', 'w:t:clock:b'] }), { status: 200 }),
      ),
    )
    vi.stubGlobal('fetch', fetchMock)
    expect(await storage.keys()).toEqual(['a', 'b'])
    expect(fetchMock.mock.calls[0][0]).toBe(
      `/api/storage?prefix=${encodeURIComponent('w:t:clock:')}`,
    )
  })

  it('maps a network failure to StorageError', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(() => Promise.reject(new Error('offline'))),
    )
    expect(await storage.get('settings')).toBeInstanceOf(StorageError)
  })
})
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `pnpm exec vitest run src/storage/server/http-storage.test.ts`
Expected: FAIL — `./http-storage` does not exist.

- [ ] **Step 3: Create the adapter**

Create `src/storage/server/http-storage.ts`:

```ts
import { StorageError, type StorageApi, type StorageOptions } from '../types'
import { toFullKey, toRelativeKey } from '../scope'

export function createHttpStorage(namespace: string, baseUrl = '/api/storage'): StorageApi {
  const keyUrl = (fullKey: string) => `${baseUrl}/${encodeURIComponent(fullKey)}`

  return {
    async get<T>(key: string): Promise<StorageError | T | null> {
      try {
        const res = await fetch(keyUrl(toFullKey(namespace, key)))
        if (res.status === 404) return null
        if (!res.ok) return new StorageError({ reason: `server GET ${res.status}` })
        const body = (await res.json()) as { value: T }
        return body.value
      } catch (cause) {
        return new StorageError({ reason: 'server GET failed', cause })
      }
    },

    async set<T>(key: string, value: T, options?: StorageOptions): Promise<StorageError | void> {
      try {
        const res = await fetch(keyUrl(toFullKey(namespace, key)), {
          method: 'PUT',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ value, ttlMs: options?.ttlMs }),
        })
        if (!res.ok) return new StorageError({ reason: `server PUT ${res.status}` })
      } catch (cause) {
        return new StorageError({ reason: 'server PUT failed', cause })
      }
    },

    async delete(key: string): Promise<StorageError | void> {
      try {
        const res = await fetch(keyUrl(toFullKey(namespace, key)), { method: 'DELETE' })
        if (!res.ok) return new StorageError({ reason: `server DELETE ${res.status}` })
      } catch (cause) {
        return new StorageError({ reason: 'server DELETE failed', cause })
      }
    },

    async has(key: string): Promise<StorageError | boolean> {
      try {
        const res = await fetch(keyUrl(toFullKey(namespace, key)))
        if (res.status === 404) return false
        if (!res.ok) return new StorageError({ reason: `server HAS ${res.status}` })
        return true
      } catch (cause) {
        return new StorageError({ reason: 'server HAS failed', cause })
      }
    },

    async keys(prefix?: string): Promise<StorageError | string[]> {
      try {
        const fullPrefix = toFullKey(namespace, prefix ?? '')
        const res = await fetch(`${baseUrl}?prefix=${encodeURIComponent(fullPrefix)}`)
        if (!res.ok) return new StorageError({ reason: `server KEYS ${res.status}` })
        const body = (await res.json()) as { keys: string[] }
        return body.keys.map((full) => toRelativeKey(namespace, full))
      } catch (cause) {
        return new StorageError({ reason: 'server KEYS failed', cause })
      }
    },
  }
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `pnpm exec vitest run src/storage/server/http-storage.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/storage/server/http-storage.ts src/storage/server/http-storage.test.ts
git commit -m "feat(storage): add HTTP server adapter"
```

---

### Task 4: createWidgetStorage

**Files:**

- Create: `src/storage/widget-storage.ts`
- Test: `src/storage/widget-storage.test.ts`

- [ ] **Step 1: Write the failing test**

Create `src/storage/widget-storage.test.ts`:

```ts
import 'fake-indexeddb/auto'
import { beforeEach, describe, expect, it } from 'vitest'
import { db } from './client/db'
import { createWidgetStorage } from './widget-storage'

beforeEach(async () => {
  await db.entries.clear()
})

describe('createWidgetStorage', () => {
  it('isolates instance client storage from shared client storage', async () => {
    const storage = createWidgetStorage({ instanceId: 'inst-1', typeId: 'clock' })
    await storage.instance.client.set('draft', 'per-instance')
    await storage.shared.client.set('draft', 'per-type')

    expect(await storage.instance.client.get('draft')).toBe('per-instance')
    expect(await storage.shared.client.get('draft')).toBe('per-type')
  })

  it('isolates one instance from another', async () => {
    const a = createWidgetStorage({ instanceId: 'inst-a', typeId: 'clock' })
    const b = createWidgetStorage({ instanceId: 'inst-b', typeId: 'clock' })
    await a.instance.client.set('draft', 'a')
    await b.instance.client.set('draft', 'b')

    expect(await a.instance.client.get('draft')).toBe('a')
    expect(await b.instance.client.get('draft')).toBe('b')
  })

  it('exposes server adapters for both scopes', () => {
    const storage = createWidgetStorage({ instanceId: 'inst-1', typeId: 'clock' })
    expect(typeof storage.instance.server.get).toBe('function')
    expect(typeof storage.shared.server.get).toBe('function')
  })
})
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `pnpm exec vitest run src/storage/widget-storage.test.ts`
Expected: FAIL — `./widget-storage` does not exist.

- [ ] **Step 3: Create the factory**

Create `src/storage/widget-storage.ts`:

```ts
import { createDexieStorage } from './client/dexie-storage'
import { createHttpStorage } from './server/http-storage'
import { instanceNamespace, typeNamespace } from './scope'
import type { StorageApi } from './types'

export type ScopedStorage = { client: StorageApi; server: StorageApi }

export type WidgetStorage = {
  /** Scoped to this widget placement (w:i:<instanceId>:). */
  instance: ScopedStorage
  /** Shared across all placements of this widget type (w:t:<typeId>:). */
  shared: ScopedStorage
}

export type CreateWidgetStorageOptions = {
  instanceId: string
  typeId: string
  /** Override the server base URL (defaults to '/api/storage'). */
  serverBaseUrl?: string
}

export function createWidgetStorage(options: CreateWidgetStorageOptions): WidgetStorage {
  const instanceNs = instanceNamespace(options.instanceId)
  const typeNs = typeNamespace(options.typeId)
  return {
    instance: {
      client: createDexieStorage(instanceNs),
      server: createHttpStorage(instanceNs, options.serverBaseUrl),
    },
    shared: {
      client: createDexieStorage(typeNs),
      server: createHttpStorage(typeNs, options.serverBaseUrl),
    },
  }
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `pnpm exec vitest run src/storage/widget-storage.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/storage/widget-storage.ts src/storage/widget-storage.test.ts
git commit -m "feat(storage): add createWidgetStorage factory"
```

---

### Task 5: Backend — Valkey ops, handlers, body reader

**Files:**

- Create: `server/valkey.ts`
- Create: `server/handlers.ts`
- Create: `server/handlers.test.ts`
- Create: `server/body.ts`
- Create: `server/body.test.ts`
- Modify: `tsconfig.node.json`

- [ ] **Step 1: Install dependencies**

Run:

```bash
pnpm add find-my-way iovalkey
pnpm add -D tsx
```

Expected: `find-my-way`, `iovalkey` in dependencies; `tsx` in devDependencies.

- [ ] **Step 2: Add `server` to the Node tsconfig**

Edit `tsconfig.node.json` — change the `include` line:

```json
  "include": ["vite.config.ts", "server"]
```

- [ ] **Step 3: Write the failing handler + body tests**

Create `server/handlers.test.ts`:

```ts
import { describe, expect, it, vi } from 'vitest'
import { handleGet, handlePut, handleDelete, handleKeys } from './handlers'
import type { ValkeyOps } from './valkey'

function mockOps(overrides: Partial<ValkeyOps> = {}): ValkeyOps {
  return {
    get: vi.fn(async () => null),
    set: vi.fn(async () => {}),
    del: vi.fn(async () => {}),
    scanKeys: vi.fn(async () => []),
    ...overrides,
  }
}

describe('handlers', () => {
  it('GET returns 404 when missing', async () => {
    expect(await handleGet(mockOps(), 'k')).toEqual({ status: 404 })
  })

  it('GET parses the stored JSON into a value envelope', async () => {
    const ops = mockOps({ get: vi.fn(async () => JSON.stringify({ a: 1 })) })
    expect(await handleGet(ops, 'k')).toEqual({ status: 200, body: { value: { a: 1 } } })
  })

  it('PUT stores stringified value with ttl and returns 204', async () => {
    const ops = mockOps()
    const result = await handlePut(ops, 'k', { value: { a: 1 }, ttlMs: 500 })
    expect(result).toEqual({ status: 204 })
    expect(ops.set).toHaveBeenCalledWith('k', JSON.stringify({ a: 1 }), 500)
  })

  it('DELETE removes the key and returns 204', async () => {
    const ops = mockOps()
    expect(await handleDelete(ops, 'k')).toEqual({ status: 204 })
    expect(ops.del).toHaveBeenCalledWith('k')
  })

  it('KEYS returns scanned keys', async () => {
    const ops = mockOps({ scanKeys: vi.fn(async () => ['w:t:clock:a']) })
    expect(await handleKeys(ops, 'w:t:clock:')).toEqual({
      status: 200,
      body: { keys: ['w:t:clock:a'] },
    })
    expect(ops.scanKeys).toHaveBeenCalledWith('w:t:clock:')
  })
})
```

Create `server/body.test.ts`:

```ts
import { Readable } from 'node:stream'
import { describe, expect, it } from 'vitest'
import { readJsonBody } from './body'

describe('readJsonBody', () => {
  it('parses a JSON body', async () => {
    const req = Readable.from([Buffer.from(JSON.stringify({ value: 1 }))])
    expect(await readJsonBody(req as never)).toEqual({ value: 1 })
  })

  it('returns undefined for an empty body', async () => {
    const req = Readable.from([])
    expect(await readJsonBody(req as never)).toBeUndefined()
  })

  it('throws on invalid JSON', async () => {
    const req = Readable.from([Buffer.from('not json')])
    await expect(readJsonBody(req as never)).rejects.toThrow()
  })
})
```

- [ ] **Step 4: Run the tests to verify they fail**

Run: `pnpm exec vitest run server/handlers.test.ts server/body.test.ts`
Expected: FAIL — `./handlers`, `./body`, `./valkey` do not exist.

- [ ] **Step 5: Create the Valkey ops**

Create `server/valkey.ts`:

```ts
import Valkey from 'iovalkey'

export type ValkeyOps = {
  get(key: string): Promise<string | null>
  set(key: string, value: string, ttlMs?: number): Promise<void>
  del(key: string): Promise<void>
  scanKeys(matchPrefix: string): Promise<string[]>
}

export function createValkeyOps(
  url = process.env.VALKEY_URL ?? 'redis://localhost:6379',
): ValkeyOps {
  const client = new Valkey(url)
  return {
    async get(key) {
      return client.get(key)
    },
    async set(key, value, ttlMs) {
      if (ttlMs != null) await client.set(key, value, 'PX', ttlMs)
      else await client.set(key, value)
    },
    async del(key) {
      await client.del(key)
    },
    async scanKeys(matchPrefix) {
      const found: string[] = []
      let cursor = '0'
      do {
        const [next, batch] = await client.scan(cursor, 'MATCH', `${matchPrefix}*`, 'COUNT', 100)
        cursor = next
        found.push(...batch)
      } while (cursor !== '0')
      return found
    },
  }
}
```

- [ ] **Step 6: Create the handlers**

Create `server/handlers.ts`:

```ts
import type { ValkeyOps } from './valkey'

export type HandlerResult = { status: number; body?: unknown }

export async function handleGet(ops: ValkeyOps, key: string): Promise<HandlerResult> {
  const raw = await ops.get(key)
  if (raw === null) return { status: 404 }
  return { status: 200, body: { value: JSON.parse(raw) } }
}

export async function handlePut(
  ops: ValkeyOps,
  key: string,
  payload: { value: unknown; ttlMs?: number },
): Promise<HandlerResult> {
  await ops.set(key, JSON.stringify(payload.value), payload.ttlMs)
  return { status: 204 }
}

export async function handleDelete(ops: ValkeyOps, key: string): Promise<HandlerResult> {
  await ops.del(key)
  return { status: 204 }
}

export async function handleKeys(ops: ValkeyOps, prefix: string): Promise<HandlerResult> {
  const keys = await ops.scanKeys(prefix)
  return { status: 200, body: { keys } }
}
```

- [ ] **Step 7: Create the body reader**

Create `server/body.ts`:

```ts
import type { IncomingMessage } from 'node:http'

export async function readJsonBody(req: IncomingMessage): Promise<unknown> {
  const chunks: Buffer[] = []
  for await (const chunk of req) chunks.push(chunk as Buffer)
  if (chunks.length === 0) return undefined
  return JSON.parse(Buffer.concat(chunks).toString('utf8'))
}
```

- [ ] **Step 8: Run the tests to verify they pass**

Run: `pnpm exec vitest run server/handlers.test.ts server/body.test.ts`
Expected: PASS.

- [ ] **Step 9: Commit**

```bash
git add package.json pnpm-lock.yaml tsconfig.node.json server/valkey.ts server/handlers.ts server/handlers.test.ts server/body.ts server/body.test.ts
git commit -m "feat(server): add Valkey ops, storage handlers, and body reader"
```

---

### Task 6: Backend HTTP wiring and Vite proxy

**Files:**

- Create: `server/index.ts`
- Modify: `vite.config.ts`

This task wires the tested handlers to `find-my-way` + Node `http`. It is integration glue (verified by the smoke test in Task 9), so it has no unit test.

- [ ] **Step 1: Create the HTTP entrypoint**

Create `server/index.ts`:

```ts
import { createServer, type ServerResponse } from 'node:http'
import Router from 'find-my-way'
import { createValkeyOps } from './valkey'
import { readJsonBody } from './body'
import { handleGet, handlePut, handleDelete, handleKeys, type HandlerResult } from './handlers'

const ops = createValkeyOps()
const router = Router({ ignoreTrailingSlash: true })

function send(res: ServerResponse, result: HandlerResult): void {
  if (result.body === undefined) {
    res.writeHead(result.status)
    res.end()
    return
  }
  res.writeHead(result.status, { 'content-type': 'application/json' })
  res.end(JSON.stringify(result.body))
}

router.on('GET', '/api/storage', async (_req, res, _params, _store, query) => {
  const prefix = query && typeof query.prefix === 'string' ? query.prefix : ''
  send(res, await handleKeys(ops, prefix))
})

router.on('GET', '/api/storage/:key', async (_req, res, params) => {
  send(res, await handleGet(ops, decodeURIComponent(params.key)))
})

router.on('PUT', '/api/storage/:key', async (req, res, params) => {
  let payload: unknown
  try {
    payload = await readJsonBody(req)
  } catch {
    res.writeHead(400)
    res.end()
    return
  }
  if (payload == null || typeof payload !== 'object' || !('value' in payload)) {
    res.writeHead(400)
    res.end()
    return
  }
  send(
    res,
    await handlePut(
      ops,
      decodeURIComponent(params.key),
      payload as { value: unknown; ttlMs?: number },
    ),
  )
})

router.on('DELETE', '/api/storage/:key', async (_req, res, params) => {
  send(res, await handleDelete(ops, decodeURIComponent(params.key)))
})

const port = Number(process.env.PORT ?? 8787)
createServer((req, res) => {
  router.lookup(req, res)
}).listen(port, () => {
  console.log(`storage-api listening on :${port}`)
})
```

- [ ] **Step 2: Add the `/api` dev proxy to Vite**

Edit `vite.config.ts` — add a `server` block to the `defineConfig({...})` object (alongside `plugins`, `define`, `build`, `test`):

```ts
  server: {
    proxy: {
      '/api': {
        target: process.env.VITE_API_PROXY ?? 'http://localhost:8787',
        changeOrigin: true,
      },
    },
  },
```

- [ ] **Step 3: Typecheck**

Run: `pnpm typecheck`
Expected: PASS (both `tsconfig.json` and `tsconfig.node.json`, the latter now including `server`).

- [ ] **Step 4: Commit**

```bash
git add server/index.ts vite.config.ts
git commit -m "feat(server): wire storage routes with find-my-way and add /api dev proxy"
```

---

### Task 7: Docker Compose stack

**Files:**

- Create: `server/Dockerfile`
- Create: `docker-compose.yml`

- [ ] **Step 1: Create the server Dockerfile**

Create `server/Dockerfile`:

```dockerfile
FROM node:22-alpine
WORKDIR /app
RUN corepack enable
COPY package.json ./
RUN pnpm install
COPY tsconfig.json tsconfig.node.json ./
COPY server ./server
EXPOSE 8787
CMD ["pnpm", "exec", "tsx", "server/index.ts"]
```

- [ ] **Step 2: Create the compose file**

Create `docker-compose.yml`:

```yaml
services:
  valkey:
    image: valkey/valkey:8-alpine
    ports:
      - '6379:6379'

  server:
    build:
      context: .
      dockerfile: server/Dockerfile
    environment:
      VALKEY_URL: redis://valkey:6379
      PORT: '8787'
    depends_on:
      - valkey
    ports:
      - '8787:8787'

  client:
    image: node:22-alpine
    working_dir: /app
    command: sh -c "corepack enable && pnpm install && pnpm dev --host"
    environment:
      VITE_API_PROXY: http://server:8787
    volumes:
      - .:/app
    ports:
      - '5173:5173'
    depends_on:
      - server
```

> **Production note:** the `client` container runs the Vite dev server for simplicity. For a production image, swap it for a static build (`pnpm build`) served by nginx with `/api` proxied to `server`.

- [ ] **Step 3: Validate the compose file**

Run: `docker compose config`
Expected: prints the resolved config with no errors. (If Docker is unavailable in this environment, skip and verify during the Task 9 smoke test.)

- [ ] **Step 4: Commit**

```bash
git add server/Dockerfile docker-compose.yml
git commit -m "feat(server): add Dockerized client + server + valkey stack"
```

---

### Task 8 (optional): Reatom storage layer

This task is optional — the storage feature is complete without it. It adds a small observable layer for widgets that use Reatom. Skip it if no widget needs reactive status yet.

**Files:**

- Create: `src/storage/reatom/reatom-storage.ts`
- Test: `src/storage/reatom/reatom-storage.test.ts`

- [ ] **Step 1: Write the failing test**

Create `src/storage/reatom/reatom-storage.test.ts`:

```ts
import 'fake-indexeddb/auto'
import { context } from '@reatom/core'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { db } from '../client/db'
import { createDexieStorage } from '../client/dexie-storage'
import { instanceNamespace } from '../scope'
import { StorageError, type StorageApi } from '../types'
import { reatomStorageMutations, reatomClearExpired } from './reatom-storage'

beforeEach(async () => {
  await db.entries.clear()
})

afterEach(() => {
  context.reset()
})

describe('reatomStorageMutations', () => {
  it('set forwards to the api and leaves error undefined on success', async () => {
    const api: StorageApi = createDexieStorage(instanceNamespace('inst-1'))
    const { set } = reatomStorageMutations(api, 'test')
    await context.start(async () => {
      await set('draft', 42)
    })
    expect(await api.get('draft')).toBe(42)
  })

  it('set records a StorageError on failure', async () => {
    const failing: StorageApi = {
      get: vi.fn(),
      set: vi.fn(async () => new StorageError({ reason: 'boom' })),
      delete: vi.fn(),
      has: vi.fn(),
      keys: vi.fn(),
    } as unknown as StorageApi
    const { set } = reatomStorageMutations(failing, 'test')
    await context.start(async () => {
      await set('draft', 1).catch(() => {})
      expect(set.error()).toBeInstanceOf(StorageError)
    })
  })
})

describe('reatomClearExpired', () => {
  it('removes expired client rows', async () => {
    const api = createDexieStorage(instanceNamespace('inst-1'))
    await api.set('dead', 1, { ttlMs: -1 })
    const clear = reatomClearExpired('test')
    await context.start(async () => {
      await clear()
    })
    expect(await db.entries.get('w:i:inst-1:dead')).toBeUndefined()
  })
})
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `pnpm exec vitest run src/storage/reatom/reatom-storage.test.ts`
Expected: FAIL — `./reatom-storage` does not exist.

- [ ] **Step 3: Create the Reatom layer**

Create `src/storage/reatom/reatom-storage.ts`:

```ts
import { action, withAsync, wrap } from '@reatom/core'
import { clearExpired } from '../client/db'
import type { StorageApi, StorageOptions } from '../types'

/**
 * Status-tracked mutations over a StorageApi. The underlying api returns errors
 * as values; we re-throw them so withAsync captures them in `.error()`/`.status()`.
 */
export function reatomStorageMutations(api: StorageApi, name: string) {
  const set = action(async (key: string, value: unknown, options?: StorageOptions) => {
    const result = await wrap(api.set(key, value, options))
    if (result instanceof Error) throw result
  }, `${name}.set`).extend(withAsync({ status: true }))

  const remove = action(async (key: string) => {
    const result = await wrap(api.delete(key))
    if (result instanceof Error) throw result
  }, `${name}.remove`).extend(withAsync({ status: true }))

  return { set, remove }
}

/** Action that purges expired client (Dexie) rows. */
export function reatomClearExpired(name: string) {
  return action(async () => {
    await wrap(clearExpired())
  }, `${name}.clearExpired`).extend(withAsync())
}
```

> **Note for the implementer:** `withAsync({ status: true })` exposes `set.error()`, `set.status()`, and `set.ready()`. Reactive _reads_ are intentionally not included here — a widget that needs one should create a local `computed(async () => { const r = await wrap(api.get(key)); if (r instanceof Error) throw r; return r }).extend(withAsyncData())`, per the Reatom v1000 pattern. Add that only when a widget actually needs it (YAGNI).

- [ ] **Step 4: Run the test to verify it passes**

Run: `pnpm exec vitest run src/storage/reatom/reatom-storage.test.ts`
Expected: PASS. (If the Reatom test-context API differs in the installed version, consult the `reatom` skill — `context.start` / `context.reset` — and adjust the harness; the production code does not change.)

- [ ] **Step 5: Commit**

```bash
git add src/storage/reatom/reatom-storage.ts src/storage/reatom/reatom-storage.test.ts
git commit -m "feat(storage): add optional Reatom mutation layer"
```

---

### Task 9: Final verification

**Files:** none

- [ ] **Step 1: Run the full unit suite**

Run: `pnpm test`
Expected: PASS (all storage, server, and existing tests).

- [ ] **Step 2: Typecheck**

Run: `pnpm typecheck`
Expected: PASS.

- [ ] **Step 3: Production build**

Run: `pnpm build`
Expected: PASS — the SPA builds; server files are not part of the Vite build.

- [ ] **Step 4: Backend smoke test (requires Docker)**

Run:

```bash
docker compose up --build -d valkey server
```

Then exercise the API (key is namespaced and URL-encoded):

```bash
curl -X PUT localhost:8787/api/storage/w%3At%3Aclock%3Asettings \
  -H 'content-type: application/json' -d '{"value":{"size":"large"}}'
curl localhost:8787/api/storage/w%3At%3Aclock%3Asettings
# expect: {"value":{"size":"large"}}
curl "localhost:8787/api/storage?prefix=w%3At%3Aclock%3A"
# expect: {"keys":["w:t:clock:settings"]}
curl -X DELETE localhost:8787/api/storage/w%3At%3Aclock%3Asettings -i
# expect: 204
```

Tear down:

```bash
docker compose down
```

Expected: PUT → 204, GET → the value, KEYS → the key, DELETE → 204, GET again → 404.

- [ ] **Step 5: Commit any verification-only fixes**

```bash
git add -A
git commit -m "chore(storage): verify widget storage layer"
```

---

## Notes for the implementer

- **No widget is wired to use storage in this plan.** The layer is delivered tested and runnable. Wiring a real widget (constructing `createWidgetStorage({ instanceId: client.instanceId, typeId: '<type>' })` in its `main.tsx` and passing it into the component) is a follow-up done when a widget actually needs persistence.
- **`instanceId`** comes from `createWidgetClient().instanceId`; **`typeId`** is a constant in the widget's own bundle (e.g. `'clock'`).
- Keep errors as values everywhere; only the Reatom layer re-throws, and only to feed `withAsync`'s status tracking.
