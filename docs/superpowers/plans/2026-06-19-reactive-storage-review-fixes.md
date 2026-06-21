# Reactive Storage Review Fixes Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Fix the reactive-storage review findings: subscription ordering/cancellation, SSE registration retry, validated SSE/pubsub payloads, and the current client typecheck fallout.

**Architecture:** Add one small subscription helper shared by Dexie and HTTP storage so initial reads cannot overwrite newer live events and unsubscribed listeners cannot be called. Harden the SSE client/server boundaries with zod validation and retry failed registration POSTs without spinning. Finish by fixing widget tests/UI typecheck errors caused by the now-required `storage` runtime prop and the unused Ofelia model.

**Tech Stack:** TypeScript, Reatom v1000, zod v4, Dexie, EventSource/SSE, find-my-way, Vitest, Testing Library, pnpm.

---

## File Structure

**Client storage:**

- Create: `client/src/storage/model/subscribe-key.ts` — shared subscribe orchestration for initial read + live changes.
- Create: `client/src/storage/model/subscribe-key.test.ts` — deterministic tests for stale initial emit, unsubscribe, and schema errors.
- Modify: `client/src/storage/model/client/dexie-storage.ts` — delegate `subscribe` to `subscribeStorageKey`.
- Modify: `client/src/storage/model/server/http-storage.ts` — delegate `subscribe` to `subscribeStorageKey`.
- Modify: `client/src/storage/model/client/dexie-storage.test.ts` — keep adapter smoke tests; remove duplicated edge-case assertions if they move to helper tests.
- Modify: `client/src/storage/model/server/http-storage.test.ts` — keep adapter smoke tests; add a live-before-initial HTTP regression if useful.

**Client SSE:**

- Modify: `client/src/storage/model/server/sse-client.ts` — validate `ready` and message frames, retry failed registrations, treat non-2xx POST as failure.
- Modify: `client/src/storage/model/server/sse-client.test.ts` — cover malformed frames, rejected registration POST, and non-2xx registration POST.

**Server SSE/pubsub:**

- Modify: `server/schemas.ts` — add `StorageEventSchema` and `EventsParamsSchema`.
- Modify: `server/index.ts` — validate pub/sub events and route params before fanout/registration.
- Modify: `server/sse.test.ts` or create route-level tests if server test harness exists — cover invalid pub/sub payloads and invalid params at the smallest available seam.

**Widget/typecheck fallout:**

- Modify: `client/widgets/clock/ui/Clock.test.tsx` — provide `storage` in test props.
- Modify: `client/widgets/ofelia-poop-duty/ui/OfeliaPoopDuty.test.tsx` — provide `storage` in test props.
- Modify: `client/widgets/ofelia-poop-duty/ui/OfeliaPoopDuty.tsx` — actually use the model values, or remove the model creation if UI is intentionally static.
- Modify: `client/widgets/ofelia-poop-duty/model/ofelia-duty.ts` — keep the current `reatomStorageKey` migration coherent with the UI; remove dead fields if not used.

---

## Task 1: Shared Subscribe Helper Prevents Stale Initial Emits

**Files:**

- Create: `client/src/storage/model/subscribe-key.ts`
- Create: `client/src/storage/model/subscribe-key.test.ts`
- Modify: `client/src/storage/model/client/dexie-storage.ts`
- Modify: `client/src/storage/model/server/http-storage.ts`

- [ ] **Step 1: Write failing helper tests**

Create `client/src/storage/model/subscribe-key.test.ts`:

```ts
import { describe, expect, it, vi } from 'vitest'
import { z } from 'zod'
import { StorageError, type StorageListener } from './types'
import { subscribeStorageKey } from './subscribe-key'

function deferred<T>() {
  let resolve!: (value: T) => void
  const promise = new Promise<T>((r) => {
    resolve = r
  })
  return { promise, resolve }
}

describe('subscribeStorageKey', () => {
  it('emits the initial value when no live change arrives first', async () => {
    const initial = deferred<StorageError | number | null>()
    const seen: unknown[] = []
    subscribeStorageKey({
      getCurrent: () => initial.promise,
      register: () => () => {},
      listener: (event) => seen.push(event instanceof Error ? event : event.value),
    })

    initial.resolve(1)
    await vi.waitFor(() => expect(seen).toEqual([1]))
  })

  it('does not let a delayed initial value overwrite a newer live change', async () => {
    const initial = deferred<StorageError | number | null>()
    let live!: (raw: unknown) => void
    const seen: unknown[] = []
    subscribeStorageKey({
      getCurrent: () => initial.promise,
      register: (deliver) => {
        live = deliver
        return () => {}
      },
      listener: (event) => seen.push(event instanceof Error ? event : event.value),
    })

    live(2)
    initial.resolve(1)
    await vi.waitFor(() => expect(seen).toEqual([2]))
  })

  it('does not emit after unsubscribe, including delayed initial reads', async () => {
    const initial = deferred<StorageError | number | null>()
    const unregister = vi.fn()
    const seen: unknown[] = []
    const off = subscribeStorageKey({
      getCurrent: () => initial.promise,
      register: () => unregister,
      listener: (event) => seen.push(event instanceof Error ? event : event.value),
    })

    off()
    initial.resolve(1)
    await Promise.resolve()
    expect(unregister).toHaveBeenCalledOnce()
    expect(seen).toEqual([])
  })

  it('validates live raw values through the schema', () => {
    let live!: (raw: unknown) => void
    const events: Array<StorageError | { value: { text: string } | null }> = []
    const listener: StorageListener<{ text: string }> = (event) => events.push(event)
    subscribeStorageKey({
      getCurrent: async () => null,
      register: (deliver) => {
        live = deliver
        return () => {}
      },
      listener,
      schema: z.object({ text: z.string() }),
    })

    live({ text: 123 })
    expect(events[0]).toBeInstanceOf(StorageError)
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm --dir client exec vitest run src/storage/model/subscribe-key.test.ts`

Expected: FAIL because `./subscribe-key` does not exist.

- [ ] **Step 3: Implement the shared helper**

Create `client/src/storage/model/subscribe-key.ts`:

```ts
import type { z } from 'zod'
import type { StorageError, StorageListener } from './types'
import { parseValue } from './validate'

export type SubscribeStorageKeyOptions<T> = {
  getCurrent: () => Promise<StorageError | T | null>
  register: (deliver: (raw: unknown) => void) => () => void
  listener: StorageListener<T>
  schema?: z.ZodType<T>
}

export function subscribeStorageKey<T>({
  getCurrent,
  register,
  listener,
  schema,
}: SubscribeStorageKeyOptions<T>): () => void {
  let active = true
  let liveVersion = 0

  const emit: StorageListener<T> = (event) => {
    if (!active) return
    listener(event)
  }

  const unregister = register((raw) => {
    liveVersion += 1
    if (raw === null) return emit({ value: null })
    const parsed = parseValue(schema, raw)
    emit(parsed instanceof Error ? parsed : { value: parsed })
  })

  const initialVersion = liveVersion
  void getCurrent().then((current) => {
    if (!active || liveVersion !== initialVersion) return
    if (current instanceof Error) return emit(current)
    emit({ value: current })
  })

  return () => {
    active = false
    unregister()
  }
}
```

- [ ] **Step 4: Wire Dexie and HTTP adapters to the helper**

In `client/src/storage/model/client/dexie-storage.ts`, import the helper:

```ts
import { subscribeStorageKey } from '../subscribe-key'
```

Replace the `subscribe` body with:

```ts
    subscribe<T>(
      key: string,
      listener: StorageListener<T>,
      schema?: z.ZodType<T>,
    ): () => void {
      const fullKey = toFullKey(namespace, key)
      return subscribeStorageKey({
        getCurrent: () => this.get<T>(key, schema),
        register: (deliver) => registerLocal(fullKey, deliver),
        listener,
        schema,
      })
    },
```

In `client/src/storage/model/server/http-storage.ts`, import the helper:

```ts
import { subscribeStorageKey } from '../subscribe-key'
```

Replace the `subscribe` body with:

```ts
    subscribe<T>(
      key: string,
      listener: StorageListener<T>,
      schema?: z.ZodType<T>,
    ): () => void {
      const fullKey = toFullKey(namespace, key)
      return subscribeStorageKey({
        getCurrent: () => this.get<T>(key, schema),
        register: (deliver) => getSseManager(baseUrl).add(fullKey, deliver),
        listener,
        schema,
      })
    },
```

- [ ] **Step 5: Run focused tests**

Run:

```bash
pnpm --dir client exec vitest run src/storage/model/subscribe-key.test.ts src/storage/model/client/dexie-storage.test.ts src/storage/model/server/http-storage.test.ts src/storage/model/reatom/reatom-storage.test.ts
```

Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add client/src/storage/model/subscribe-key.ts client/src/storage/model/subscribe-key.test.ts client/src/storage/model/client/dexie-storage.ts client/src/storage/model/server/http-storage.ts
git commit -m "fix(storage): guard initial subscription emissions"
```

---

## Task 2: SSE Registration Retries Failed POSTs

**Files:**

- Modify: `client/src/storage/model/server/sse-client.ts`
- Modify: `client/src/storage/model/server/sse-client.test.ts`

- [ ] **Step 1: Add failing retry tests**

Append to `client/src/storage/model/server/sse-client.test.ts`:

```ts
it('retries registration when the POST rejects', async () => {
  vi.useFakeTimers()
  const fetchMock = vi
    .fn()
    .mockRejectedValueOnce(new Error('offline'))
    .mockResolvedValueOnce(new Response(null, { status: 204 }))
  vi.stubGlobal('fetch', fetchMock)

  const { getSseManager } = await import('./sse-client')
  const mgr = getSseManager('/api/storage')
  mgr.add('k1', () => {})

  FakeEventSource.instances[0].emit('ready', { connId: 'c1' })
  await vi.waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(1))

  await vi.advanceTimersByTimeAsync(1_000)
  await vi.waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(2))
  vi.useRealTimers()
})

it('retries registration when the POST returns non-2xx', async () => {
  vi.useFakeTimers()
  const fetchMock = vi
    .fn()
    .mockResolvedValueOnce(new Response(null, { status: 500 }))
    .mockResolvedValueOnce(new Response(null, { status: 204 }))
  vi.stubGlobal('fetch', fetchMock)

  const { getSseManager } = await import('./sse-client')
  getSseManager('/api/storage').add('k1', () => {})

  FakeEventSource.instances[0].emit('ready', { connId: 'c1' })
  await vi.waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(1))

  await vi.advanceTimersByTimeAsync(1_000)
  await vi.waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(2))
  vi.useRealTimers()
})
```

Ensure `afterEach` calls `vi.useRealTimers()` before `vi.unstubAllGlobals()`.

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm --dir client exec vitest run src/storage/model/server/sse-client.test.ts`

Expected: FAIL because failed registrations are not retried.

- [ ] **Step 3: Implement retry without optimistic `registered` updates**

In `client/src/storage/model/server/sse-client.ts`, add near the top:

```ts
const REGISTER_RETRY_MS = 1_000
```

Inside `createSseManager`, add:

```ts
let retryTimer: ReturnType<typeof setTimeout> | undefined

function scheduleRetry(): void {
  if (retryTimer) return
  retryTimer = setTimeout(() => {
    retryTimer = undefined
    scheduleSync()
  }, REGISTER_RETRY_MS)
}
```

Replace `sync()` with:

```ts
async function sync(): Promise<void> {
  if (!connId) return
  const subscribe = [...desired].filter((key) => !registered.has(key))
  const unsubscribe = [...registered].filter((key) => !desired.has(key))
  if (subscribe.length === 0 && unsubscribe.length === 0) return

  const nextRegistered = new Set(desired)
  const response = await fetch(`${baseUrl}/events/${connId}`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ subscribe, unsubscribe }),
  }).catch((cause) => {
    console.warn('storage SSE registration failed', cause)
    return null
  })

  if (response === null || !response.ok) {
    if (response !== null) {
      console.warn('storage SSE registration failed', response.status)
    }
    scheduleRetry()
    return
  }

  registered = nextRegistered
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm --dir client exec vitest run src/storage/model/server/sse-client.test.ts`

Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add client/src/storage/model/server/sse-client.ts client/src/storage/model/server/sse-client.test.ts
git commit -m "fix(storage): retry SSE registration failures"
```

---

## Task 3: Validate SSE and Pub/Sub Payloads

**Files:**

- Modify: `client/src/storage/model/server/sse-client.ts`
- Modify: `client/src/storage/model/server/sse-client.test.ts`
- Modify: `server/schemas.ts`
- Modify: `server/index.ts`
- Modify: `server/sse.test.ts`

- [ ] **Step 1: Add client malformed-frame tests**

Append to `client/src/storage/model/server/sse-client.test.ts`:

```ts
it('ignores malformed ready frames without registering', async () => {
  const { getSseManager } = await import('./sse-client')
  getSseManager('/api/storage').add('k1', () => {})

  FakeEventSource.instances[0].emit('ready', { connId: 123 })
  await Promise.resolve()

  expect(globalThis.fetch).not.toHaveBeenCalled()
})

it('ignores malformed message frames without delivery', async () => {
  const { getSseManager } = await import('./sse-client')
  const seen: unknown[] = []
  getSseManager('/api/storage').add('k1', (raw) => seen.push(raw))

  FakeEventSource.instances[0].emit('message', { key: 123, value: 1 })
  expect(seen).toEqual([])
})
```

- [ ] **Step 2: Add server schema tests**

Append to `server/sse.test.ts` or create `server/schemas.test.ts` if preferred:

```ts
import { EventsParamsSchema, StorageEventSchema } from './schemas'

describe('storage event schemas', () => {
  it('accepts a valid storage event', () => {
    expect(StorageEventSchema.safeParse({ key: 'k', value: 1 }).success).toBe(true)
  })

  it('rejects events without a string key', () => {
    expect(StorageEventSchema.safeParse({ key: 1, value: 1 }).success).toBe(false)
  })

  it('requires a string connId param', () => {
    expect(EventsParamsSchema.safeParse({ connId: 'c1' }).success).toBe(true)
    expect(EventsParamsSchema.safeParse({ connId: 1 }).success).toBe(false)
  })
})
```

- [ ] **Step 3: Run tests to verify they fail**

Run:

```bash
pnpm --dir client exec vitest run src/storage/model/server/sse-client.test.ts
pnpm --dir server exec vitest run sse.test.ts
```

Expected: FAIL because schemas/validation are not implemented.

- [ ] **Step 4: Add shared server schemas**

In `server/schemas.ts`, append:

```ts
export const StorageEventSchema = z.object({
  key: z.string(),
  value: z.unknown(),
})

export type StorageEvent = z.infer<typeof StorageEventSchema>

export const EventsParamsSchema = z.object({
  connId: z.string(),
})
```

- [ ] **Step 5: Validate server pub/sub and params**

In `server/index.ts`, update imports:

```ts
import {
  PutPayloadSchema,
  PrefixQuerySchema,
  EventsBodySchema,
  EventsParamsSchema,
  StorageEventSchema,
  formatZodError,
} from './schemas'
```

Replace the Valkey subscriber body:

```ts
createValkeySubscriber('storage:events', (message) => {
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
```

Replace the unchecked connId cast:

```ts
const parsedParams = EventsParamsSchema.safeParse(params)
if (!parsedParams.success) {
  res.writeHead(422, { 'content-type': 'application/json' })
  res.end(JSON.stringify(formatZodError(parsedParams.error)))
  return
}
const { connId } = parsedParams.data
```

- [ ] **Step 6: Validate client SSE frames**

In `client/src/storage/model/server/sse-client.ts`, import zod:

```ts
import { z } from 'zod'
```

Add schemas near the top:

```ts
const ReadyEventSchema = z.object({
  connId: z.string(),
})

const StorageEventSchema = z.object({
  key: z.string(),
  value: z.unknown(),
})

function parseMessageData(event: MessageEvent): unknown | Error {
  try {
    return JSON.parse(event.data) as unknown
  } catch (cause) {
    return new Error('invalid SSE JSON', { cause })
  }
}
```

Replace the `ready` listener:

```ts
source.addEventListener('ready', (event) => {
  const raw = parseMessageData(event)
  if (raw instanceof Error) {
    console.warn('invalid storage SSE ready frame', raw)
    return
  }
  const parsed = ReadyEventSchema.safeParse(raw)
  if (!parsed.success) {
    console.warn('invalid storage SSE ready frame', parsed.error)
    return
  }
  connId = parsed.data.connId
  registered = new Set()
  scheduleSync()
})
```

Replace `source.onmessage`:

```ts
source.onmessage = (event) => {
  const raw = parseMessageData(event)
  if (raw instanceof Error) {
    console.warn('invalid storage SSE message frame', raw)
    return
  }
  const parsed = StorageEventSchema.safeParse(raw)
  if (!parsed.success) {
    console.warn('invalid storage SSE message frame', parsed.error)
    return
  }
  const set = subscribers.get(parsed.data.key)
  if (set) for (const deliver of set) deliver(parsed.data.value)
}
```

- [ ] **Step 7: Run focused tests**

Run:

```bash
pnpm --dir client exec vitest run src/storage/model/server/sse-client.test.ts
pnpm --dir server exec vitest run sse.test.ts
```

Expected: PASS.

- [ ] **Step 8: Commit**

```bash
git add client/src/storage/model/server/sse-client.ts client/src/storage/model/server/sse-client.test.ts server/schemas.ts server/index.ts server/sse.test.ts
git commit -m "fix(storage): validate SSE event payloads"
```

---

## Task 4: Fix Widget Typecheck Fallout

**Files:**

- Modify: `client/widgets/clock/ui/Clock.test.tsx`
- Modify: `client/widgets/ofelia-poop-duty/ui/OfeliaPoopDuty.test.tsx`
- Modify: `client/widgets/ofelia-poop-duty/ui/OfeliaPoopDuty.tsx`
- Modify: `client/widgets/ofelia-poop-duty/model/ofelia-duty.ts`

- [ ] **Step 1: Fix test props with real widget storage**

In both `Clock.test.tsx` and `OfeliaPoopDuty.test.tsx`, import:

```ts
import { createWidgetStorage } from '../../../src/storage/model/widget-storage'
```

Add `storage` to the returned props object:

```ts
    storage: createWidgetStorage({
      instanceId: 'inst-clock',
      typeId: 'clock',
    }),
```

For Ofelia, use its IDs:

```ts
    storage: createWidgetStorage({
      instanceId: 'ofelia-poop-duty-1',
      typeId: 'ofelia-poop-duty',
    }),
```

- [ ] **Step 2: Make Ofelia UI consume the model**

In `client/widgets/ofelia-poop-duty/ui/OfeliaPoopDuty.tsx`, read from the model so `model` is not dead and the existing tests have rendered duty names:

```tsx
const week = model.currentWeek()
const today = week[0]
const tomorrow = week[1]
```

Render the values in both branches:

```tsx
          <div className={styles.person}>{today.duty}</div>
          <div className={styles.meta}>Завтра: {tomorrow.duty}</div>
```

Use existing class names if they already exist in `ofelia-poop-duty.module.css`; otherwise add small semantic classes in that CSS module.

- [ ] **Step 3: Keep `ofelia-duty.ts` internally consistent**

In `client/widgets/ofelia-poop-duty/model/ofelia-duty.ts`, ensure the current dirty migration does not leave unused or misleading state:

- If `startOfWeek` is needed by UI controls, use it in `currentWeek`:

```ts
const currentWeek = computed(() => {
  const today = startOfWeek()
  const weekStart = today.subtract({
    days: today.dayOfWeek - 1,
  })
  // ...
})
```

- If there is no UI control for changing week, remove `startOfWeek` entirely and keep `Temporal.Now.plainDateISO(DUTY_TIME_ZONE)` inside `currentWeek`.
- Keep `numberOfDebts.value()` for the `reatomStorageKey` return shape.
- Do not call removed `withAsyncData` APIs such as `.data()` or `.retry()` on `numberOfDebts`.

- [ ] **Step 4: Run widget-focused tests and typecheck**

Run:

```bash
pnpm --dir client exec vitest run widgets/clock/ui/Clock.test.tsx widgets/ofelia-poop-duty/ui/OfeliaPoopDuty.test.tsx
pnpm typecheck
```

Expected: both widget tests PASS and `pnpm typecheck` PASS.

- [ ] **Step 5: Commit**

```bash
git add client/widgets/clock/ui/Clock.test.tsx client/widgets/ofelia-poop-duty/ui/OfeliaPoopDuty.test.tsx client/widgets/ofelia-poop-duty/ui/OfeliaPoopDuty.tsx client/widgets/ofelia-poop-duty/model/ofelia-duty.ts
git commit -m "fix(widgets): update runtime props and Ofelia model usage"
```

---

## Final Verification

- [ ] Run storage tests:

```bash
pnpm --dir client exec vitest run src/storage
```

Expected: PASS.

- [ ] Run server tests:

```bash
pnpm --dir server exec vitest run
```

Expected: PASS.

- [ ] Run workspace tests:

```bash
pnpm test
```

Expected: PASS.

- [ ] Run workspace typecheck:

```bash
pnpm typecheck
```

Expected: PASS.

- [ ] Inspect worktree:

```bash
git status --short
```

Expected: only intentional changes remain. Remove or ignore `.dev-before.pid`; do not commit it unless it is intentionally part of dev tooling.

---

## Review Checklist

- [ ] Initial subscription read cannot overwrite a newer live update.
- [ ] Unsubscribed storage listeners cannot receive delayed initial values.
- [ ] SSE registration retries rejected fetches and non-2xx responses without a tight loop.
- [ ] SSE `ready` and message frames are zod-validated before use.
- [ ] Server pub/sub events and `connId` params are zod-validated before fanout/registration.
- [ ] No plan TODOs remain as unsafe casts in implementation.
- [ ] Client and server focused test suites pass.
- [ ] `pnpm typecheck` passes.
