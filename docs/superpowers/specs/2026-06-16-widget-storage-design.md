# Widget Storage Layer — Design

**Date:** 2026-06-16
**Status:** Approved (pending implementation plan)

## Overview

Give board widgets a small, explicit storage API with two backends:

- **client** — local, offline, persistent in the browser (Dexie / IndexedDB).
- **server** — shared/durable across devices via a thin HTTP service backed by Valkey.

The widget chooses `client` or `server` per key. There is **no automatic
hybrid/sync layer** — that can come later (`storage.sync`) without changing the
base contract.

### Goals

- One explicit `StorageApi` contract, two interchangeable implementations.
- Per-widget scoping so widgets cannot collide on keys.
- Errors returned as values (`errore`), matching the rest of the app.
- A minimal, Dockerized backend (server + Valkey), no auth.

### Non-goals (this spec)

- A sync/merge layer between client and server.
- Authentication / multi-user isolation (single-user personal board).
- Host-app adoption of this layer — the host keeps its current localStorage for
  board/theme. This layer is **widgets-only**.
- Untrusted/third-party widget sandboxing (all widgets are first-party).

## Architecture

Each widget runs in its own same-origin iframe and **builds its own storage** in
`main.tsx`. It needs only two identifiers it already has:

- `instanceId` — from the bridge handshake (`createWidgetClient().instanceId`).
  Stable across reloads (persisted `crypto.randomUUID()` in the board snapshot).
- `typeId` — a constant in the widget's own bundle (e.g. `'clock'`).

No bridge changes are required: the existing `init` message already carries
`instanceId`, and server calls go to `/api` same-origin.

Each widget receives four scoped `StorageApi` instances, organized by
**scope × backend**:

```ts
type ScopedStorage = { client: StorageApi; server: StorageApi }

type WidgetStorage = {
  instance: ScopedStorage // namespace  w:i:<instanceId>:  — this placement only
  shared: ScopedStorage // namespace  w:t:<typeId>:      — all placements of this type
}
```

- **client** → Dexie / IndexedDB (same-origin shared DB).
- **server** → HTTP adapter → `/api/storage/*` → `find-my-way` server → Valkey.

Each scoped API auto-prepends its namespace, so widgets use **relative keys**:
`storage.instance.client.set('draft', x)` is stored at `w:i:<instanceId>:draft`.
Widgets never build full keys themselves.

### Runtime topology

`docker-compose.yml` brings up three containers:

1. **client** — Vite, serving the SPA; dev-proxies `/api` → `server`.
2. **server** — Node `http` + `find-my-way` storage API.
3. **valkey** — `valkey/valkey` database.

The browser always talks to `/api` same-origin (via the Vite proxy in dev, a
reverse proxy in prod), so there is no CORS and no auth to configure.

## Module layout

```
src/storage/
  types.ts                  # StorageApi, StorageEntry, StorageOptions, StorageError
  scope.ts                  # namespace prefixing + relative/full key conversion
  client/db.ts              # Dexie schema (single `entries` table)
  client/dexie-storage.ts   # createDexieStorage(namespace) -> StorageApi
  server/http-storage.ts    # createHttpStorage(namespace, baseUrl?) -> StorageApi
  reatom/reatom-storage.ts  # optional reatomStorage(api) wrapper
  widget-storage.ts         # createWidgetStorage({ instanceId, typeId }) -> WidgetStorage

server/
  index.ts                  # find-my-way routes + http.createServer
  valkey.ts                 # iovalkey client + ops
  body.ts                   # read + JSON-parse request body
  Dockerfile
docker-compose.yml          # client + server + valkey
```

`src/storage/` is importable by widgets exactly like the existing
`src/shared/widget-bridge` (relative import from `widgets/<name>/`).

## Contract (`types.ts`)

```ts
export type StorageOptions = { ttlMs?: number }

export type StorageEntry<T = unknown> = {
  key: string // full namespaced key
  value: T
  expiresAt: number | null // epoch ms; null = never expires
  updatedAt: number // epoch ms
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

- `get` narrows three ways: `instanceof Error` → `=== null` (missing) → value.
- `keys()` returns **relative** keys (namespace stripped); optional `prefix`
  narrows within the scope.
- Errors are always values, never thrown.

## Scoping (`scope.ts`)

```
instance namespace = `w:i:${instanceId}:`
type namespace     = `w:t:${typeId}:`
fullKey            = namespace + relativeKey
toRelative(full)   = full.slice(namespace.length)
```

`createWidgetStorage({ instanceId, typeId })` builds the two namespaces and wires
four `StorageApi` instances (`instance.client`, `instance.server`,
`shared.client`, `shared.server`), each closed over its namespace.

## Client adapter (`client/db.ts` + `client/dexie-storage.ts`)

One Dexie DB `myboard-storage`, one table:

```ts
entries: 'key, namespace, expiresAt, updatedAt' // key = primary key
```

Each row is a `StorageEntry` with `namespace` set to the scope prefix so listing
and cleanup are index-friendly. `createDexieStorage(namespace)` returns a
`StorageApi`:

- **get** — read by full key; if `expiresAt != null && expiresAt < now`, delete
  the row and return `null`; else return `value`.
- **set** — `table.put({ key, namespace, value, expiresAt: ttlMs ? now+ttlMs : null, updatedAt: now })`.
- **delete** — `table.delete(fullKey)`.
- **has** — derived from `get` (respects expiry), returns `boolean`.
- **keys(prefix?)** — `where('key').startsWith(namespace + (prefix ?? ''))`,
  drop expired, return keys with the namespace stripped.

All operations wrapped with `errore.tryAsync` → `StorageError` (quota, blocked
DB, etc.). A standalone `clearExpired(db)` deletes all rows with
`expiresAt != null && expiresAt < now`; the Reatom model exposes it as an action.

## Server (`server/index.ts` + `server/valkey.ts` + `server/body.ts`)

A `find-my-way` router on Node's `http` server. The server is an opaque JSON
pass-through — it never inspects values, and relies on **Valkey-native TTL**
(`PX`) rather than storing `expiresAt` itself.

| Method   | Path                    | Valkey                    | Response                |
| -------- | ----------------------- | ------------------------- | ----------------------- |
| `GET`    | `/api/storage/:key`     | `GET key`                 | `200 { value }` / `404` |
| `PUT`    | `/api/storage/:key`     | `SET key json [PX ttlMs]` | `204`                   |
| `DELETE` | `/api/storage/:key`     | `DEL key`                 | `204`                   |
| `GET`    | `/api/storage?prefix=…` | `SCAN MATCH prefix*`      | `200 { keys }`          |

Details:

- `:key` is `encodeURIComponent`'d by the adapter (namespaced keys contain `:`).
- `PUT` body is `{ value, ttlMs? }`; `ttlMs` present → `SET … PX ttlMs`.
- `keys` listing uses a **`SCAN` cursor loop** (`MATCH ${prefix}*`, `COUNT 100`),
  never `KEYS`. Returns full keys; the adapter strips the namespace.
- `has` reuses `GET` and treats `404` as `false` — no separate route.
- Body parse failure → `400`; Valkey unreachable → `503`.
- `iovalkey` client configured from `VALKEY_URL`.
- `find-my-way` handler signature provides `params.key` and parsed query
  (`prefix`); `server/body.ts` reads and JSON-parses the request stream.

`server/valkey.ts` exposes thin ops: `get(key)`, `set(key, json, ttlMs?)`,
`del(key)`, `scanKeys(matchPrefix)`.

## HTTP adapter (`server/http-storage.ts`)

`createHttpStorage(namespace, baseUrl = '/api/storage')` returns a `StorageApi`
mapping each method to the routes above:

- `404` on `get` → `null`.
- Any other non-2xx, or a network/parse failure → `StorageError` (reason
  includes the status).
- All wrapped in `errore.tryAsync`.

Same-origin in dev via the Vite proxy, in prod via the reverse proxy.

## Reatom model (optional — `reatom/reatom-storage.ts`)

The plain async `StorageApi` is the core; the Reatom layer is **opt-in**.
`reatomStorage(api)` wraps an API in an observable model:

- Reactive reads via `computed(async () => …).extend(withAsyncData(…))`.
- Mutations via `action(async () => …).extend(withAsync(…))`.
- A `status` atom (`'idle' | 'pending' | 'error'`) so a widget can render
  fallback UI.
- A `clearExpired` action (client only) that calls `clearExpired(db)`.

Widgets that want reactivity opt in; simple widgets (the clock pattern) call the
async API directly. This keeps the core decoupled and avoids forcing Reatom into
every widget bundle.

## Widget integration

In a widget's `main.tsx`, after the bridge client resolves:

```tsx
const client = await createWidgetClient()
// ...handle Error / theme as today...
const storage = createWidgetStorage({
  instanceId: client.instanceId,
  typeId: 'clock', // constant for this widget bundle
})
root.render(<Clock client={client} storage={storage} />)
```

Usage inside the component:

```ts
await storage.instance.client.set('draft', draft) // w:i:<instanceId>:draft (Dexie)
const settings = await storage.shared.server.get('settings') // w:t:clock:settings (Valkey)
if (settings instanceof Error) {
  /* fall back to defaults */
}
```

## Data flow (server read example)

```
widget: storage.shared.server.get('settings')
  → fetch GET /api/storage/w:t:clock:settings   (same-origin)
  → find-my-way → valkey GET "w:t:clock:settings"
  → { value } | 404
  → adapter: value | null | StorageError
  → widget narrows with `instanceof Error`
```

Client reads are identical minus the network: straight to Dexie under
`w:i:<instanceId>:` / `w:t:<typeId>:`.

## Error handling

Errors are **always values, never thrown**, matching the rest of the app.
Adapters wrap with `errore.tryAsync`; `get` distinguishes "missing" (`null`)
from "failed" (`StorageError`). The optional Reatom model surfaces a `status`
atom for fallback UI. The storage layer never decides policy — the widget does
(e.g. fall back to defaults on error).

## Testing

- **scope.ts / types** — pure unit tests: prefixing, relative↔full conversion,
  expiry math.
- **dexie-storage** — Vitest + `fake-indexeddb`: CRUD, `has`, `keys` filtering,
  TTL deletes-on-read, `clearExpired`.
- **http-storage** — Vitest with mocked `fetch`: request shapes (method/URL/
  body), `404`→`null`, non-2xx→`StorageError`, JSON round-trip.
- **reatom-storage** — Reatom test context: status transitions, `withAsyncData`
  read, `clearExpired` action.
- **server** — unit-test handlers against a mocked `iovalkey` client (assert
  commands + status codes). Full container integration is a manual smoke step.
- The widget-bridge is untouched; its tests do not change.

## Dependencies

- **client/app:** `dexie`
- **server:** `find-my-way`, `iovalkey`
- **dev/test:** `fake-indexeddb`

## Future (out of scope here)

- `storage.sync` — a hybrid layer reconciling client + server, added without
  changing the base contract.
- Auth, if the board ever becomes multi-user.
- Host-app adoption (migrating board/theme persistence onto this layer).
