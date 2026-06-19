# Reactive Storage — Design

**Date:** 2026-06-19
**Status:** Approved (pending implementation plan)
**Builds on:** [2026-06-16 Widget Storage Layer](./2026-06-16-widget-storage-design.md)

## Overview

Extend the widget storage layer with **reactive reads**: subscribe to a single
key and be notified whenever its value changes — including changes made by other
widget iframes, other browser tabs, and **other devices**. Reads also gain
**schema validation** in the storage layer itself.

The existing `StorageApi` (`get/set/delete/has/keys`, errors-as-values) and its
two backends (Dexie/IndexedDB and HTTP/Valkey) are unchanged in spirit. We add
one method (`subscribe`), one optional read parameter (`schema`), and the
transport plumbing that makes cross-device reactivity work.

### Goals

- A `subscribe(key, listener)` primitive on `StorageApi` that emits the current
  value on attach, then on every change. Errors are values.
- Reactivity boundary spanning the full stack: same iframe → cross-iframe /
  cross-tab (one device) → cross-device (server push).
- Schema validation (`zod`) for reads, centralized in the storage layer so both
  raw consumers and the Reatom layer benefit.
- A thin Reatom wrapper (`reatomStorageKey`) that exposes a key as a reactive
  atom, building on the primitive.

### Non-goals (this spec)

- Prefix / namespace subscriptions — **exact key only**.
- Host-app adoption — board/theme keep their current `localStorage`. This is
  **widgets-only**, matching the base storage spec.
- Real-time push of server-side TTL expiry (Valkey-native `PX`). Deferred; see
  "Future".
- Auth / multi-user isolation (single-user personal board).

## Decisions (from brainstorming)

| Question | Decision |
|---|---|
| Reactivity boundary | Cross-device: server writes reach subscribers on other devices via server push (superset → client + server both reactive). |
| Granularity | Exact key only. |
| API shape | Low-level `subscribe(key, cb) -> unsubscribe` primitive on `StorageApi` + a Reatom atom on top. |
| Scope | Widgets only (`widget-storage`); host app untouched. |
| Server transport | SSE + app-level `PUBLISH` to Valkey Pub/Sub (Approach A). |
| Schema validation | Lives in the storage layer (`get` + `subscribe` take `schema?`); the Reatom layer just forwards the argument. |

## Contract (`types.ts`)

`StorageApi` gains `subscribe`; `get` and `subscribe` gain an optional `schema`.
The other four methods are unchanged.

```ts
import { z } from 'zod'

/** Value change of a key. value=null means deleted / absent / expired. */
export type StorageChange<T = unknown> = { value: T | null }

/** Listener receives either a validated change or an error — as a value. */
export type StorageListener<T = unknown> = (event: StorageError | StorageChange<T>) => void

export type StorageApi = {
  get<T>(key: string, schema?: z.ZodType<T>): Promise<StorageError | T | null>
  set<T>(key: string, value: T, options?: StorageOptions): Promise<StorageError | void>
  delete(key: string): Promise<StorageError | void>
  has(key: string): Promise<StorageError | boolean>
  keys(prefix?: string): Promise<StorageError | string[]>
  /**
   * Subscribe to changes of a single key. Best-effort emits the current value
   * once on attach, then on every change. Returns an unsubscribe function.
   */
  subscribe<T>(key: string, listener: StorageListener<T>, schema?: z.ZodType<T>): () => void
}
```

Semantics:

- **Event shape `StorageError | { value: T | null }`.** The listener narrows with
  `instanceof Error`; `value: null` means the key is deleted / absent / expired.
  No separate set/delete event types — consumers only care about the current
  value, mirroring how `get` already distinguishes "missing" (`null`) from
  "failed" (`StorageError`).
- **`subscribe` returns the unsubscribe function synchronously.** The transport
  (SSE connect) comes up asynchronously, so connection errors are delivered to
  the listener as `StorageError`, not returned from `subscribe`. This preserves
  errors-as-values without breaking synchronous teardown.
- **Initial emit.** `subscribe` performs a best-effort `get` and emits the
  current value, then updates. The primitive is self-contained, so the Reatom
  atom on top needs no separate seeding.

### Schema validation (`model/validate.ts`)

One shared helper, called by both adapters — no duplicated `zod` logic:

```ts
export function parseValue<T>(schema: z.ZodType<T> | undefined, value: unknown): StorageError | T {
  if (!schema) return value as T // unchanged behavior: bare typed cast
  const parsed = schema.safeParse(value)
  if (!parsed.success) return new StorageError({ reason: 'schema validation failed', cause: parsed.error })
  return parsed.data
}
```

Integration points:

- **`get(key, schema)`** — after reading the raw value, run `parseValue`. A
  `StorageError` propagates as a value; `null` (absence) bypasses the schema.
- **`subscribe(key, listener, schema)`** — every emit (the initial `get` and each
  update from BroadcastChannel/SSE) passes through `parseValue`; `null` bypasses.
  Transport **and** validation errors reach the listener identically, as
  `StorageError`. The listener therefore always receives **validated** events.

This matches `zod` usage elsewhere in the repo (`client/src/env.ts`,
`server/schemas.ts`): `z.object` + `safeParse`, error wrapped in a tagged error.
`zod` (v4) is already a client dependency.

## Client reactivity (Dexie + BroadcastChannel)

Cross-iframe / cross-tab propagation on one device via a single module-level
registry and one shared `BroadcastChannel` per runtime.

**Module level (shared by all Dexie instances in the runtime):**

- `subscribers: Map<fullKey, Set<Deliver>>` — registry keyed by **full** key. A
  `Deliver` is a per-subscribe closure that applies **that listener's own
  `schema`** (with `null` bypass) via `parseValue`, then calls the user
  listener. Validation is therefore per-listener, not per-broadcast: two
  subscriptions on the same key may carry different schemas.
- `getStorageChannel()` — singleton `new BroadcastChannel('myboard-storage')`,
  one `onmessage` handler per runtime.
- `notifyLocal(fullKey, rawValue)` — invokes every `Deliver` registered for
  `fullKey`, passing the raw (unvalidated) value; each `Deliver` validates with
  its own schema.

**Local write flow:**

```
set/delete → table.put/delete → on success:
  1. notifyLocal(fullKey, value | null)             // this runtime's subscribers
  2. channel.postMessage({ fullKey, value | null }) // other iframes / tabs
```

`BroadcastChannel` does not echo to the sender, so there is no double delivery:
the writing runtime is notified via `notifyLocal`; other runtimes via
`onmessage` (which calls their own `notifyLocal`).

**`subscribe(relativeKey, listener, schema)` in an instance:**

```
fullKey = toFullKey(namespace, relativeKey)
deliver = (raw) => listener(raw === null ? { value: null } : parseValue(schema, raw) as ...)
subscribers[fullKey].add(deliver)
ensureChannelListener()                                 // once per runtime
void get(relativeKey, schema).then(emit-initial)        // best-effort initial emit
return () => subscribers[fullKey].delete(deliver)        // + prune empty sets
```

(`deliver` maps a `StorageError` from `parseValue` straight to the listener and
otherwise wraps the parsed value as `{ value }`; `null` bypasses the schema.)

**Incoming channel routing:** `onmessage` reads `fullKey` from the message and
calls `notifyLocal(fullKey, rawValue)`; each registered `Deliver` then validates
with its own schema. The namespace is baked into `fullKey`, so matching is exact
— no prefix matching needed.

Notes:

1. **Client TTL expiry is lazy** (Dexie purges on read), so there is no push at
   the expiry instant — a subscriber sees `null` on the next read. To smooth
   this, `clearExpired` **broadcasts tombstones** (`{ fullKey, value: null }`)
   for each purged row, so active subscriptions update.
2. Errors from the initial `get` (Dexie failure or schema mismatch) reach the
   listener as `StorageError`.
3. `BroadcastChannel` is available in all target same-origin browsers; no
   fallback is planned.

## Server reactivity (SSE + Valkey Pub/Sub)

The server today is a `find-my-way` router on Node `http` plus Valkey ops
(`get/set/del/scanKeys`). Three additions:

**1. SSE endpoint — `GET /api/storage/events`**

- Opens a stream (`Content-Type: text/event-stream`, `Cache-Control: no-cache`,
  `X-Accel-Buffering: no`).
- Generates a `connId`, sends it as the first frame (`event: ready` /
  `data: {connId}`), and stores `res` in
  `connections: Map<connId, { res, keys: Set<fullKey> }>`.
- Heartbeat comment `: ping` every ~25s to keep the connection alive through
  proxies; on `req 'close'`, remove the connection from all indexes.

**2. Interest registration (side-channel) — `POST /api/storage/events/:connId`**

Batched body:

```jsonc
{ "subscribe": ["w:t:clock:settings"], "unsubscribe": [] } // → 204
```

Updates `connections[connId].keys` and the reverse index
`keyIndex: Map<fullKey, Set<connId>>`. Batching avoids round-trips when a widget
mounts with several keys.

**3. Publish on write + internal subscriber**

- In the `PUT`/`DELETE` handlers, after the Valkey write succeeds:
  `PUBLISH storage:events {"key": fullKey, "value": <new> | null}`.
- The server opens a **second** Valkey connection (Pub/Sub requires a dedicated
  connection) and `SUBSCRIBE storage:events`. On each message: look up
  `keyIndex.get(key)` and write an SSE frame `data: {key, value}` to every
  interested connection.

Publishing through Valkey Pub/Sub (rather than in-process fanout) means a write
arriving at any server instance is fanned out to every instance, each forwarding
to its own SSE clients. On a single instance it is a loopback and behaves
identically.

**Flow (write on device B → subscriber on device A):**

```
B: PUT /api/storage/w:t:clock:settings
   → valkey SET ... → PUBLISH storage:events {key, value}
server (sub-conn): on message → keyIndex[key] → SSE data:{key,value}
A: EventSource onmessage → notifyLocal → Reatom atom updates
```

Notes:

1. **Server-side TTL expiry is not pushed in real time** — Valkey-native `PX`
   expiry does not run our handler, so no `PUBLISH`. MVP: the next read returns
   `404 → null`. See "Future" for the optional keyspace-notifications path.
2. The `events` segment under `/api/storage/` is reserved. No collision with
   keys — all keys start with `w:i:` / `w:t:`, and `find-my-way` prioritizes the
   static route over `/:key`.
3. The event carries the written value (`null` for `DELETE`), so the subscriber
   needs no follow-up `GET`.

## Client HTTP adapter (shared SSE)

`createHttpStorage(namespace, baseUrl)` gains `subscribe`. Both server-scoped
APIs of a widget (`instance.server`, `shared.server`) share **one** SSE
connection per `baseUrl`.

**Module-level SSE manager (singleton per `baseUrl`):**

- `getEventSource(baseUrl)` lazily opens `new EventSource(`${baseUrl}/events`)`
  and holds `ready: Promise<connId>` (resolved on the `ready` frame).
- `subscribers: Map<fullKey, Set<Deliver>>` + `desired: Set<fullKey>` (what
  should be registered server-side). As on the Dexie side, a `Deliver` is a
  per-subscribe closure that validates the raw value with its own schema
  (`null` bypass) before calling the user listener.
- `onmessage` → `{ key, value }` → `notifyLocal(fullKey, rawValue)` (same helper
  concept as the Dexie side; each `Deliver` validates per-listener).
- **Registration sync** is debounced in a microtask: the diff of `desired`
  against what was last sent collapses into a single batched
  `POST /events/:connId { subscribe, unsubscribe }`.

**Adapter `subscribe(relativeKey, listener, schema)`:**

```
fullKey = toFullKey(namespace, relativeKey)
mgr.add(fullKey, listener)                       // updates desired + schedules sync
void get(relativeKey, schema).then(emit-initial) // best-effort initial via HTTP GET
return () => mgr.remove(fullKey, listener)        // empty set → unsubscribe server-side
```

**Resilience:** on reconnect, `EventSource` gets a **new** `connId` and the old
registrations are gone. So on **every** `ready` frame (including reconnects) the
manager **re-sends the entire `desired` set** with the new `connId`. This
self-healing re-sync makes subscriptions survive network drops.

**Errors:**

- Transient SSE drops are silent: `EventSource` auto-reconnects and we re-sync
  `desired` on `ready`. Listeners are not disturbed (avoids noise).
- A failed registration `POST` delivers a `StorageError` to the affected key's
  listeners.
- The initial `get` and its errors behave as in the Contract section.

Same-origin via the existing `/api` proxy; `EventSource` is GET-only, so no
infrastructure changes.

## Reatom model (`reatom/reatom-storage.ts`)

The primitive already emits the initial value and updates and already validates,
so the wrapper is thin. Alongside the existing `reatomStorageMutations`:

```ts
import { atom, withConnectHook, wrap } from '@reatom/core'
import type { z } from 'zod'
import type { StorageApi, StorageError } from '../types'

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
        schema, // validation already happened in storage
      ),
    ),
  )

  return { value, error }
}
```

Decisions:

1. **`atom` + `withConnectHook`, not `computed + withAsyncData`.** The data is a
   push stream (SSE / BroadcastChannel), not an idempotent re-runnable query.
   `withConnectHook` is the documented pattern for attaching/detaching an
   external subscription, with auto-abort on disconnect. The subscription lives
   exactly while the atom has subscribers (lazy by construction).
2. **`wrap` wraps the listener** passed to the external `api.subscribe`
   (`addEventListener('click', wrap(...))` style) — **not** called inside the
   listener, and **not** wrapping the `withConnectHook` callback itself. Per the
   Reatom v1000 `wrap` rules, this is required so external-callback writes are
   batched into the reactive context. The returned `api.subscribe(...)` value is
   the cleanup (unsubscribe on disconnect).
3. **No validation in Reatom.** It forwards `schema` to the storage layer and
   reacts to already-validated events. Non-Reatom widgets get the same validation
   by calling `get`/`subscribe` directly.
4. **`{ value, error }`** — two atoms: the component reads `value`; `error`
   drives fallback UI without losing the last valid value.

## Widget integration

In a widget's `model/`:

```ts
const settings = reatomStorageKey(
  { api: storage.shared.server, key: 'settings', schema: SettingsSchema },
  'clock.settings',
)
// component: settings.value() to render, settings.error() for fallback
// writes: reatomStorageMutations(storage.shared.server, 'clock.settings').set('settings', next)
```

Reads are reactive (the atom subscribes on the first subscriber, unsubscribes on
disconnect); writes go through the existing mutation path and propagate back to
subscribers via BroadcastChannel / SSE.

## Error handling

Everything is a value. Transport (Dexie / `fetch` / SSE registration `POST`) and
schema validation both yield a `StorageError` to the listener → the `error`
atom; `value` retains the last valid value. Transient SSE drops are silent
(auto-reconnect + `desired` re-sync). `null` is a legitimate "no value" and
bypasses the schema. The storage layer never decides policy — the widget does
(e.g. fall back to defaults on `error`).

## Module layout (delta)

```
client/src/storage/model/
  types.ts                  # + subscribe, StorageChange, StorageListener, schema params
  validate.ts               # + parseValue(schema, value)
  client/dexie-storage.ts   # + subscribe; BroadcastChannel registry; clearExpired tombstones
  client/channel.ts         # + getStorageChannel(), notifyLocal, subscribers registry
  server/http-storage.ts    # + subscribe; shared SSE manager
  server/sse-client.ts       # + getEventSource(baseUrl): connId, desired sync, onmessage
  reatom/reatom-storage.ts  # + reatomStorageKey({ api, key, schema }, name)

server/
  index.ts                  # + GET /api/storage/events, POST /api/storage/events/:connId
  sse.ts                    # + connections/keyIndex registries, SSE framing, heartbeat
  valkey.ts                 # + publish(channel, msg) + dedicated subscriber connection
```

(Exact file names finalized during planning; the table shows the shape of the
change.)

## Testing

- **`parseValue`** — pure unit tests: schema pass / fail / `null` bypass.
- **`dexie-storage.subscribe`** — `fake-indexeddb` + a mock `BroadcastChannel`
  (jsdom lacks it): local write notifies subscriber; incoming channel message →
  listener; `clearExpired` broadcasts a tombstone; schema validation on emit.
- **`http-storage.subscribe`** — mock `EventSource` + `fetch`: batched
  registration `POST`, `desired` re-sync on `ready` / reconnect, `onmessage` →
  listener, initial `get` emit, schema validation.
- **`server`** — unit-test `keyIndex` / registration + Pub/Sub fanout against a
  mocked `iovalkey`; assert the SSE frames written. Full container path is a
  manual smoke step.
- **`reatom-storage`** — Reatom test context: connect → `subscribe` called;
  incoming event updates `value`; error event sets `error`; disconnect →
  `unsubscribe` called.

## Dependencies / infra

- **Client:** no new dependencies — `zod` (v4) is already present;
  `BroadcastChannel` / `EventSource` are native.
- **Server:** no new packages — Pub/Sub via the existing `iovalkey` (a second
  connection for `SUBSCRIBE`).
- **Tests:** small `BroadcastChannel` / `EventSource` mock utilities.
- **Infra:** the `/api` topology is unchanged — SSE is same-origin through the
  existing proxy.

## Future (out of scope here)

- **Real-time server TTL expiry** — enable Valkey keyspace notifications
  (`notify-keyspace-events Ex` + `PSUBSCRIBE __keyevent@*__:expired`) and push a
  `null` to interested SSE connections when a key expires.
- **Prefix / namespace subscriptions** — subscribe to a relative prefix or a
  whole scope, with event dedup.
- **Host-app adoption** — migrate board/theme onto the reactive `StorageApi` so
  theme syncs across tabs/devices.
- **Validated one-shot `getValidated`** — sugar that reuses the same `schema`.
