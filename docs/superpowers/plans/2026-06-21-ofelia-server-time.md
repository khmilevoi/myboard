# Ofelia Server-Time Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make the Ofelia widget's notion of "today" authoritative by deriving it from the server clock instead of the device clock, via a new `GET /api/time` endpoint and a shared `timer` (`ServerTime`) singleton injected into the model.

**Architecture:** The server exposes `GET /api/time` returning `{ now: <epoch ms> }`. A new shared module `client/src/shared/timer/` fetches it once, computes `offset = serverNow − clientNow`, and exposes synchronous getters `nowMs()`/`today(zone)` (both `null` until the first sync) plus a status-tracked `sync` action and an `isSynced` atom. The Ofelia model receives this `ServerTime` as a constructor dependency (same DI pattern as `storage`); "today" becomes `PlainDate | null`, date-dependent computeds return `null` before the first sync, week navigation moves to an override atom, and actions are guarded to no-op until "today" is known.

**Tech Stack:** TypeScript (ESM), Reatom v1001 (`@reatom/core`), errore (tagged errors-as-values), Zod v4, Temporal (`--harmony-temporal`), Vitest + Testing Library/jsdom, Node `http` + `find-my-way` (server).

## Global Constraints

- **Time zone:** all "today"/week math uses `DUTY_TIME_ZONE = 'Europe/Warsaw'` (existing constant in `ofelia-duty.ts`).
- **Scope = server-time slice only.** New F3 actions (`confirmClean`/`goIntoDebt`/`forgive`/`undo`), `HistoryPort`, and `currentUser` are a separate F3-core plan and are **out of scope** here. This plan adapts the *existing* model surface (`inDebt`/`forgiveDebt`, week nav, `currentWeek`, `debtDays`) to server-time, and adds `selectedDate`/`selectDay` + `undoAvailable`.
- **No fallback to device clock.** Before the first sync, "today" is `null`; date-dependent computeds return `null`; actions no-op. This is acceptable because writes already require the server (storage is HTTP) — see spec §1 "Связанность с хранилищем".
- **RTT is ignored:** `offset = serverNow − Date.now()` measured at response receipt; day granularity makes the few-ms error irrelevant.
- **Undo gate is `D == today`** (not by event creation time): past days are read-only.
- **Re-sync triggers:** consumer connect/reconnect (`withConnectHook`) and tab refocus (`visibilitychange` → `visible`). **No polling.** Midnight rolls over via the elapsing client clock plus the fixed offset.
- **Placement:** shared singleton in `client/src/shared/timer/` + port interface `ServerTime`, injected into the model via props. **Not** threaded through `WidgetRuntimeProps` (single consumer for now).
- **Code style (match the file being edited):**
  - New files under `client/src/shared/timer/` and all `server/` edits: single quotes, **no semicolons**, 2-space indent, named exports (matches `server/handlers.ts`, `client/src/storage/model/test/fakes.ts`).
  - Edits to `client/widgets/ofelia-poop-duty/model/ofelia-duty.ts` and `ui/OfeliaPoopDuty.tsx`: **double quotes + semicolons** (match those files' existing style).
  - Edits to `*.test.ts(x)`: single quotes, no semicolons (match existing test files).
- **Imports:** use the `@/` alias (`@/*` → `client/src/*`) in model code, matching `ofelia-duty.ts`'s existing `@/storage/...` imports.
- **Reatom:** name every atom/action/computed for tracing; cross async boundaries with `wrap(...)`; prefer `atom.set(...)` over identity setter actions.

---

## File Structure

**Create:**
- `server/` — extend existing `handlers.ts` + `index.ts` (no new file); add test to `handlers.test.ts`.
- `client/src/shared/timer/model/http-time.ts` — `fetchServerTime()` + `TimeError` + response schema.
- `client/src/shared/timer/model/http-time.test.ts` — fetch parse/error tests.
- `client/src/shared/timer/model/server-time.ts` — `ServerTime` interface + `createServerTime()` + `getServerTime()` singleton + re-sync.
- `client/src/shared/timer/model/server-time.test.ts` — offset/today/error/re-sync tests.
- `client/src/shared/timer/model/fakes.ts` — `createFakeTimer()` test double.
- `client/src/shared/timer/model/fakes.test.ts` — fake double sanity test.

**Modify:**
- `server/handlers.ts` — add `handleTime()`.
- `server/index.ts` — register `GET /api/time`.
- `server/handlers.test.ts` — test `handleTime()`.
- `client/widgets/ofelia-poop-duty/model/ofelia-duty.ts` — inject `timer`, nullable `today`, week override, nullable projections, action guards, `selectedDate`/`selectDay`, `undoAvailable`.
- `client/widgets/ofelia-poop-duty/model/ofelia-duty.test.ts` — rewrite for server-time-driven behavior.
- `client/widgets/ofelia-poop-duty/ui/OfeliaPoopDuty.tsx` — inject `getServerTime()`, render loading when `currentWeek() == null`.
- `client/widgets/ofelia-poop-duty/ui/OfeliaPoopDuty.test.tsx` — mock the timer singleton; add loading-state test.

---

## Task 1: Server `GET /api/time` endpoint

**Files:**
- Modify: `server/handlers.ts`
- Modify: `server/index.ts`
- Test: `server/handlers.test.ts`

**Interfaces:**
- Consumes: existing `HandlerResult = { status: number; body?: unknown }` and `send(res, result)` helper in `index.ts`.
- Produces: `handleTime(): HandlerResult` returning `{ status: 200, body: { now: number } }` where `now` is `Date.now()` (epoch ms, UTC). Route `GET /api/time`.

- [ ] **Step 1: Write the failing test**

Add to `server/handlers.test.ts` (import `handleTime` alongside the existing handler imports on line 2):

```ts
describe('handleTime', () => {
  it('returns 200 with the current epoch ms', () => {
    vi.useFakeTimers()
    vi.setSystemTime(new Date('2026-06-21T12:00:00.000Z'))

    expect(handleTime()).toEqual({
      status: 200,
      body: { now: Date.parse('2026-06-21T12:00:00.000Z') },
    })

    vi.useRealTimers()
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm --filter server test handlers`
Expected: FAIL — `handleTime is not a function` / import error.

- [ ] **Step 3: Add the handler**

In `server/handlers.ts`, add after `handlePut` (it needs no Valkey ops):

```ts
export function handleTime(): HandlerResult {
  return { status: 200, body: { now: Date.now() } }
}
```

- [ ] **Step 4: Register the route**

In `server/index.ts`, add `handleTime` to the import on line 6:

```ts
import { handleGet, handlePut, handleDelete, handleKeys, handleAppend, handleTime, publishChange, type HandlerResult } from './handlers'
```

Then register the route just before the `GET /api/storage` route (around line 91):

```ts
router.on('GET', '/api/time', (_req, res) => {
  send(res, handleTime())
})
```

- [ ] **Step 5: Run test to verify it passes**

Run: `pnpm --filter server test handlers`
Expected: PASS (all `handlers.test.ts` tests, including `handleTime`).

- [ ] **Step 6: Typecheck and commit**

Run: `pnpm --filter server typecheck`
Expected: no errors.

```bash
git add server/handlers.ts server/index.ts server/handlers.test.ts
git commit -m "feat(server): add GET /api/time endpoint"
```

---

## Task 2: `http-time.ts` — fetch server time as a value

**Files:**
- Create: `client/src/shared/timer/model/http-time.ts`
- Test: `client/src/shared/timer/model/http-time.test.ts`

**Interfaces:**
- Produces:
  - `class TimeError` (errore tagged error, mirrors `StorageError`).
  - `const ServerTimeSchema` (Zod) and `type ServerTimeResponse = { now: number }`.
  - `function fetchServerTime(baseUrl = '/api/time'): Promise<number | TimeError>` — resolves to the server epoch ms, or a `TimeError`. **Never throws.**

- [ ] **Step 1: Write the failing test**

Create `client/src/shared/timer/model/http-time.test.ts`:

```ts
import { afterEach, describe, expect, it, vi } from 'vitest'
import { fetchServerTime, TimeError } from './http-time'

afterEach(() => {
  vi.unstubAllGlobals()
})

describe('fetchServerTime', () => {
  it('returns the epoch ms from a valid response', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => new Response(JSON.stringify({ now: 1_700_000_000_000 }), { status: 200 })),
    )

    expect(await fetchServerTime()).toBe(1_700_000_000_000)
  })

  it('returns a TimeError on a non-ok status', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response('', { status: 500 })))

    const result = await fetchServerTime()
    expect(result).toBeInstanceOf(TimeError)
  })

  it('returns a TimeError when the payload shape is invalid', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => new Response(JSON.stringify({ now: 'nope' }), { status: 200 })),
    )

    expect(await fetchServerTime()).toBeInstanceOf(TimeError)
  })

  it('returns a TimeError when fetch rejects', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => { throw new Error('network down') }))

    expect(await fetchServerTime()).toBeInstanceOf(TimeError)
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm --filter client test src/shared/timer/model/http-time.test.ts`
Expected: FAIL — cannot resolve `./http-time`.

- [ ] **Step 3: Write the implementation**

Create `client/src/shared/timer/model/http-time.ts`:

```ts
import * as errore from 'errore'
import { z } from 'zod'

export class TimeError extends errore.createTaggedError({
  name: 'TimeError',
  message: 'Server time fetch failed: $reason',
}) {}

export const ServerTimeSchema = z.object({ now: z.number() })
export type ServerTimeResponse = z.infer<typeof ServerTimeSchema>

/** Fetches server epoch ms. Network/parse failures are returned as TimeError, never thrown. */
export async function fetchServerTime(baseUrl = '/api/time'): Promise<number | TimeError> {
  const res = await fetch(baseUrl).catch(
    (cause) => new TimeError({ reason: 'fetch failed', cause }),
  )
  if (res instanceof Error) return res
  if (!res.ok) return new TimeError({ reason: `status ${res.status}` })

  const body = await (res.json() as Promise<unknown>).catch(
    (cause) => new TimeError({ reason: 'json parse failed', cause }),
  )
  if (body instanceof Error) return body

  const parsed = ServerTimeSchema.safeParse(body)
  if (!parsed.success) return new TimeError({ reason: 'invalid response shape', cause: parsed.error })

  return parsed.data.now
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm --filter client test src/shared/timer/model/http-time.test.ts`
Expected: PASS (4 tests).

- [ ] **Step 5: Commit**

```bash
git add client/src/shared/timer/model/http-time.ts client/src/shared/timer/model/http-time.test.ts
git commit -m "feat(timer): add fetchServerTime with TimeError"
```

---

## Task 3: `server-time.ts` — `ServerTime` singleton

**Files:**
- Create: `client/src/shared/timer/model/server-time.ts`
- Test: `client/src/shared/timer/model/server-time.test.ts`

**Interfaces:**
- Consumes: `fetchServerTime`, `TimeError` from `./http-time` (Task 2).
- Produces:
  - `interface ServerTime` with `nowMs(): number | null`, `today(timeZone: string): Temporal.PlainDate | null`, `readonly sync: Action<[], Promise<void>>`, `readonly isSynced: Atom<boolean>`.
  - `function createServerTime(fetchTime?: () => Promise<number | TimeError>): ServerTime` — `fetchTime` defaults to `fetchServerTime`; the parameter is a test seam.
  - `function getServerTime(): ServerTime` — lazy app-wide singleton (one offset for all consumers).

**Notes for the implementer:**
- `offsetMs` carries the `withConnectHook` so that any connected computed reading `nowMs()`/`today()`/`isSynced()` triggers an initial `sync()` on connect (and again on reconnect), and registers the `visibilitychange` listener. The hook is attached *after* `sync` is declared (it references `sync`), via `offsetMs.extend(...)`.
- `sync` re-throws the `TimeError` so `withAsync({ status: true })` captures it in the action's status; on failure `offsetMs` stays `null`.
- `nowMs()`/`today()` are plain synchronous getters (callable inside reatom computeds). Reading `offsetMs()` inside them registers the reactive dependency edge.

- [ ] **Step 1: Write the failing tests**

Create `client/src/shared/timer/model/server-time.test.ts`:

```ts
import { context } from '@reatom/core'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { TimeError } from './http-time'
import { createServerTime, getServerTime } from './server-time'

afterEach(() => {
  vi.useRealTimers()
  vi.unstubAllGlobals()
  context.reset()
})

describe('createServerTime', () => {
  it('is null before the first sync', () => {
    const timer = createServerTime(async () => 0)

    expect(timer.nowMs()).toBeNull()
    expect(timer.today('Europe/Warsaw')).toBeNull()
    expect(timer.isSynced()).toBe(false)
  })

  it('computes the offset and resolves today after sync', async () => {
    vi.useFakeTimers()
    vi.setSystemTime(new Date('2026-06-21T00:00:00.000Z'))
    const serverNow = Date.parse('2026-06-22T09:00:00.000Z')
    const timer = createServerTime(async () => serverNow)

    await timer.sync()

    expect(timer.nowMs()).toBe(serverNow)
    expect(timer.today('Europe/Warsaw')?.toString()).toBe('2026-06-22')
    expect(timer.isSynced()).toBe(true)
  })

  it('keeps the offset null and surfaces the error when the fetch fails', async () => {
    const timer = createServerTime(async () => new TimeError({ reason: 'boom' }))

    await expect(timer.sync()).rejects.toBeInstanceOf(TimeError)

    expect(timer.nowMs()).toBeNull()
    expect(timer.isSynced()).toBe(false)
  })

  it('re-syncs when the tab becomes visible', async () => {
    const fetchTime = vi.fn(async () => 1_700_000_000_000)
    const timer = createServerTime(fetchTime)

    // Subscribing to a computed that reads offsetMs activates the connect hook
    // (initial sync + visibilitychange listener).
    const unsubscribe = timer.isSynced.subscribe(() => {})
    await vi.waitFor(() => expect(fetchTime).toHaveBeenCalledTimes(1))

    Object.defineProperty(document, 'visibilityState', { value: 'visible', configurable: true })
    document.dispatchEvent(new Event('visibilitychange'))

    await vi.waitFor(() => expect(fetchTime).toHaveBeenCalledTimes(2))
    unsubscribe()
  })
})

describe('getServerTime', () => {
  it('returns the same singleton instance', () => {
    expect(getServerTime()).toBe(getServerTime())
  })
})
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `pnpm --filter client test src/shared/timer/model/server-time.test.ts`
Expected: FAIL — cannot resolve `./server-time`.

- [ ] **Step 3: Write the implementation**

Create `client/src/shared/timer/model/server-time.ts`:

```ts
import {
  action,
  atom,
  computed,
  withAsync,
  withConnectHook,
  wrap,
  type Action,
  type Atom,
} from '@reatom/core'
import { fetchServerTime, type TimeError } from './http-time'

export interface ServerTime {
  /** Current server moment (clientNow + offset), or null before the first sync. */
  nowMs(): number | null
  /** Server "today" in the given zone, or null before the first sync. */
  today(timeZone: string): Temporal.PlainDate | null
  /** Status-tracked action: computes the offset via fetchServerTime(). */
  readonly sync: Action<[], Promise<void>>
  /** True after the first successful sync (offset known). */
  readonly isSynced: Atom<boolean>
}

export function createServerTime(
  fetchTime: () => Promise<number | TimeError> = fetchServerTime,
): ServerTime {
  const offsetMs = atom<number | null>(null, 'serverTime.offsetMs')

  const nowMs = (): number | null => {
    const offset = offsetMs()
    return offset == null ? null : Date.now() + offset
  }

  const today = (timeZone: string): Temporal.PlainDate | null => {
    const now = nowMs()
    return now == null
      ? null
      : Temporal.Instant.fromEpochMilliseconds(now).toZonedDateTimeISO(timeZone).toPlainDate()
  }

  const sync = action(async () => {
    const result = await wrap(fetchTime())
    if (result instanceof Error) throw result
    offsetMs.set(result - Date.now())
  }, 'serverTime.sync').extend(withAsync({ status: true }))

  const isSynced = computed(() => offsetMs() != null, 'serverTime.isSynced')

  // Re-sync on consumer connect/reconnect and on tab refocus. No polling.
  offsetMs.extend(
    withConnectHook(() => {
      sync()
      const onVisible = () => {
        if (document.visibilityState === 'visible') sync()
      }
      document.addEventListener('visibilitychange', onVisible)
      return () => document.removeEventListener('visibilitychange', onVisible)
    }),
  )

  return { nowMs, today, sync, isSynced }
}

let instance: ServerTime | null = null

/** Lazy app-wide ServerTime (one offset shared across all consumers). */
export function getServerTime(): ServerTime {
  if (instance == null) instance = createServerTime()
  return instance
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `pnpm --filter client test src/shared/timer/model/server-time.test.ts`
Expected: PASS (6 tests).

If the "re-syncs when the tab becomes visible" test is flaky on connect timing, confirm `vi.waitFor` is used (it polls); do not add fixed sleeps.

- [ ] **Step 5: Commit**

```bash
git add client/src/shared/timer/model/server-time.ts client/src/shared/timer/model/server-time.test.ts
git commit -m "feat(timer): add ServerTime singleton with offset sync and re-sync"
```

---

## Task 4: `fakes.ts` — `createFakeTimer` test double

**Files:**
- Create: `client/src/shared/timer/model/fakes.ts`
- Test: `client/src/shared/timer/model/fakes.test.ts`

**Interfaces:**
- Consumes: `ServerTime` interface from `./server-time` (Task 3).
- Produces: `function createFakeTimer(options?: { today?: Temporal.PlainDate | null; nowMs?: number }): ServerTime` — controllable `today()`/`nowMs()`; `sync` is a no-op status action; `isSynced` is `true` when `today` or `nowMs` is provided.

- [ ] **Step 1: Write the failing test**

Create `client/src/shared/timer/model/fakes.test.ts`:

```ts
import { context } from '@reatom/core'
import { afterEach, describe, expect, it } from 'vitest'
import { createFakeTimer } from './fakes'

afterEach(() => {
  context.reset()
})

describe('createFakeTimer', () => {
  it('reports unsynced and null today by default', () => {
    const timer = createFakeTimer()

    expect(timer.today('Europe/Warsaw')).toBeNull()
    expect(timer.nowMs()).toBeNull()
    expect(timer.isSynced()).toBe(false)
  })

  it('returns the provided today regardless of zone and reports synced', () => {
    const today = Temporal.PlainDate.from('2026-06-16')
    const timer = createFakeTimer({ today })

    expect(timer.today('Europe/Warsaw')).toBe(today)
    expect(timer.isSynced()).toBe(true)
  })

  it('resolves sync as a no-op', async () => {
    const timer = createFakeTimer({ today: Temporal.PlainDate.from('2026-06-16') })

    await expect(timer.sync()).resolves.toBeUndefined()
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm --filter client test src/shared/timer/model/fakes.test.ts`
Expected: FAIL — cannot resolve `./fakes`.

- [ ] **Step 3: Write the implementation**

Create `client/src/shared/timer/model/fakes.ts`:

```ts
import { action, atom, withAsync } from '@reatom/core'
import type { ServerTime } from './server-time'

/** In-memory ServerTime double for model tests: controllable today()/nowMs(). */
export function createFakeTimer(options?: {
  today?: Temporal.PlainDate | null
  nowMs?: number
}): ServerTime {
  const todayValue = options?.today ?? null
  const nowValue = options?.nowMs ?? null
  const synced = todayValue != null || nowValue != null

  return {
    nowMs: () => nowValue,
    today: () => todayValue,
    sync: action(async () => {}, 'fakeTimer.sync').extend(withAsync({ status: true })),
    isSynced: atom(synced, 'fakeTimer.isSynced'),
  }
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm --filter client test src/shared/timer/model/fakes.test.ts`
Expected: PASS (3 tests).

- [ ] **Step 5: Commit**

```bash
git add client/src/shared/timer/model/fakes.ts client/src/shared/timer/model/fakes.test.ts
git commit -m "test(timer): add createFakeTimer double"
```

---

## Task 5: Ofelia model — server-time-driven nullable "today"

**Files:**
- Modify: `client/widgets/ofelia-poop-duty/model/ofelia-duty.ts`
- Test: `client/widgets/ofelia-poop-duty/model/ofelia-duty.test.ts`

**Interfaces:**
- Consumes: `ServerTime` from `@/shared/timer/model/server-time` (Task 3); `createFakeTimer` from `@/shared/timer/model/fakes` (Task 4) in tests.
- Produces (new model signature + surface):
  - `interface OfeliaDutyModelProps { storage: WidgetStorage; timer: ServerTime }`.
  - `ofeliaDutyModel(props)` now exposes: `viewWeekStart` (`Atom<PlainDate | null>` — computed), `startOfWeekOverride` (`Atom<PlainDate | null>`), `goToNextWeek`/`goToPrevWeek`/`goToCurrentWeek`, `numberOfDebts`, `debtDays` (now nullable), `currentWeek` (now nullable), `inDebt`, `forgiveDebt`.
  - `getToday()` is **removed**; an internal `today = () => timer.today(DUTY_TIME_ZONE)` (`PlainDate | null`) replaces it.
  - `startOfWeek` (the old non-nullable atom) is **removed/renamed**: navigation now writes `startOfWeekOverride`; the viewed week is the derived `viewWeekStart`.

This task leaves `selectedDate`/`selectDay`/`undoAvailable` for Task 6.

- [ ] **Step 1: Rewrite the model test for server-time behavior**

Replace the entire contents of `client/widgets/ofelia-poop-duty/model/ofelia-duty.test.ts` with:

```ts
import { context } from '@reatom/core'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { createFakeTimer } from '../../../src/shared/timer/model/fakes'
import type { StorageApi } from '../../../src/storage/model/types'
import type { WidgetStorage } from '../../../src/storage/model/widget-storage'
import { ofeliaDutyModel } from './ofelia-duty'

function createStorage(): WidgetStorage {
  const api: StorageApi = {
    get: vi.fn(async () => null),
    set: vi.fn(async () => undefined),
    delete: vi.fn(async () => undefined),
    has: vi.fn(async () => false),
    keys: vi.fn(async () => []),
    append: vi.fn(async () => undefined),
    subscribe: vi.fn(() => () => {}),
  }

  return {
    instance: { client: api, server: api },
    shared: { client: api, server: api },
  }
}

afterEach(() => {
  context.reset()
})

describe('ofeliaDutyModel server time', () => {
  it('returns null projections and blocks actions before the first sync', async () => {
    const model = ofeliaDutyModel({
      storage: createStorage(),
      timer: createFakeTimer(),
    })
    model.numberOfDebts.set({ Леша: 0, Карина: 0 })

    expect(model.viewWeekStart()).toBeNull()
    expect(model.currentWeek()).toBeNull()
    expect(model.debtDays()).toBeNull()

    await model.inDebt('Леша')
    expect(model.numberOfDebts()).toEqual({ Леша: 0, Карина: 0 })
  })

  it('derives the week from server today once synced', () => {
    const model = ofeliaDutyModel({
      storage: createStorage(),
      timer: createFakeTimer({ today: Temporal.PlainDate.from('2026-06-16') }),
    })
    model.numberOfDebts.set({ Леша: 0, Карина: 0 })

    const week = model.currentWeek()
    expect(week).not.toBeNull()
    expect(week?.find((day) => day.isToday)?.date.toString()).toBe('2026-06-16')
    expect(model.viewWeekStart()?.toString()).toBe('2026-06-15')
  })

  it('changes the debt count when synced', async () => {
    const model = ofeliaDutyModel({
      storage: createStorage(),
      timer: createFakeTimer({ today: Temporal.PlainDate.from('2026-06-16') }),
    })
    model.numberOfDebts.set({ Леша: 0, Карина: 0 })

    await model.inDebt('Карина')
    expect(model.numberOfDebts()).toEqual({ Леша: 0, Карина: 1 })
  })

  it('navigates weeks via the override and resets to the current week', () => {
    const model = ofeliaDutyModel({
      storage: createStorage(),
      timer: createFakeTimer({ today: Temporal.PlainDate.from('2026-06-16') }),
    })

    model.goToNextWeek()
    expect(model.viewWeekStart()?.toString()).toBe('2026-06-22')

    model.goToPrevWeek()
    expect(model.viewWeekStart()?.toString()).toBe('2026-06-15')

    model.goToNextWeek()
    model.goToCurrentWeek()
    expect(model.viewWeekStart()?.toString()).toBe('2026-06-15')
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm --filter client test widgets/ofelia-poop-duty/model/ofelia-duty.test.ts`
Expected: FAIL — `viewWeekStart`/nullable behavior not implemented; `timer` prop unknown.

- [ ] **Step 3: Edit the model — imports and signature**

In `client/widgets/ofelia-poop-duty/model/ofelia-duty.ts`, add the `ServerTime` import after the existing storage imports (lines 1-4):

```ts
import { ServerTime } from "@/shared/timer/model/server-time";
```

Change the props interface (lines 16-18) to:

```ts
export interface OfeliaDutyModelProps {
  storage: WidgetStorage;
  timer: ServerTime;
}
```

- [ ] **Step 4: Edit the model — remove `getToday`, add nullable `today`**

Delete the `getToday()` function (lines 26-30). Change the model factory opening (line 38) from `({ storage }: OfeliaDutyModelProps) =>` to destructure `timer` and define `today`:

```ts
export const ofeliaDutyModel = ({ storage, timer }: OfeliaDutyModelProps) => {
  const today = () => timer.today(DUTY_TIME_ZONE);
```

- [ ] **Step 5: Edit the model — replace `startOfWeek` with override + derived view**

Replace the `startOfWeek` atom and the three navigation actions (lines 47-59) with:

```ts
  const startOfWeekOverride = atom<Temporal.PlainDate | null>(
    null,
    "ofeliaDuty.startOfWeekOverride",
  );

  const viewWeekStart = computed<Temporal.PlainDate | null>(() => {
    const override = startOfWeekOverride();
    if (override) return override;
    const currentToday = today();
    return currentToday ? getStartOfWeek(currentToday) : null;
  }, "ofeliaDuty.viewWeekStart");

  const goToNextWeek = action(() => {
    const base = viewWeekStart();
    if (!base) return;
    startOfWeekOverride.set(base.add({ days: 7 }));
  });

  const goToPrevWeek = action(() => {
    const base = viewWeekStart();
    if (!base) return;
    startOfWeekOverride.set(base.subtract({ days: 7 }));
  });

  const goToCurrentWeek = action(() => {
    startOfWeekOverride.set(null);
  });
```

- [ ] **Step 6: Edit the model — make `debtDays` and `currentWeek` nullable**

Replace the `debtDays` computed (lines 61-72) with:

```ts
  const debtDays = computed(() => {
    const debts = numberOfDebts();
    const currentToday = today();

    if (!debts || !currentToday) {
      return null;
    }

    return getDebtDays(debts, currentToday).reduce((acc, debtDay) => {
      acc.set(debtDay.date.toString(), debtDay);
      return acc;
    }, new Map<string, DebtDay>());
  }, "ofeliaDuty.debtDays");
```

Replace the `currentWeek` computed (lines 74-93) with:

```ts
  const currentWeek = computed(() => {
    const currentToday = today();
    const weekStart = viewWeekStart();

    if (!currentToday || !weekStart) {
      return null;
    }

    const days = debtDays();

    return Array.from({ length: 7 }, (_, dayOffset) => {
      const date = weekStart.add({ days: dayOffset });
      const duty = getOfeliaDutyByDate(date);

      const debt = days?.get(date.toString()) ?? null;

      return {
        date,
        isToday: date.equals(currentToday),
        day: date.day,
        duty,
        debt: debt?.person ?? null,
      };
    });
  }, "ofeliaDuty.currentWeek");
```

- [ ] **Step 7: Edit the model — guard the actions and update the return**

Add a `today() == null` guard to both actions (lines 95-109):

```ts
  const inDebt = action(async (person: DutyPerson) => {
    if (today() == null) return;

    const debts = { ...numberOfDebts() };

    debts[person] = (debts[person] ?? 0) + 1;

    numberOfDebts.set(normalizeDebts(debts));
  }).extend(withAsyncData({ status: true }));

  const forgiveDebt = action(async (person: DutyPerson) => {
    if (today() == null) return;

    const debts = { ...numberOfDebts() };

    debts[person] = Math.max((debts[person] ?? 0) - 1, 0);

    numberOfDebts.set(normalizeDebts(debts));
  }).extend(withAsyncData({ status: true }));
```

Update the returned object (lines 111-120) to expose the new surface:

```ts
  return {
    startOfWeekOverride,
    viewWeekStart,
    goToNextWeek,
    goToPrevWeek,
    goToCurrentWeek,
    numberOfDebts,
    debtDays,
    currentWeek,
    inDebt,
    forgiveDebt,
  };
```

- [ ] **Step 8: Run test to verify it passes**

Run: `pnpm --filter client test widgets/ofelia-poop-duty/model/ofelia-duty.test.ts`
Expected: PASS (4 tests).

- [ ] **Step 9: Commit**

```bash
git add client/widgets/ofelia-poop-duty/model/ofelia-duty.ts client/widgets/ofelia-poop-duty/model/ofelia-duty.test.ts
git commit -m "feat(ofelia): derive today from ServerTime with nullable projections"
```

---

## Task 6: Ofelia model — `selectedDate`/`selectDay` + `undoAvailable` gate

**Files:**
- Modify: `client/widgets/ofelia-poop-duty/model/ofelia-duty.ts`
- Test: `client/widgets/ofelia-poop-duty/model/ofelia-duty.test.ts`

**Interfaces:**
- Consumes: `today` and the model surface from Task 5.
- Produces:
  - `selectedDate` (`Atom<PlainDate | null>`; `null` ⇒ resolves to `today()`).
  - `selectDay` (`Action<[Temporal.PlainDate], void>`).
  - `undoAvailable` (`Atom<boolean>` — computed): `true` only when `today != null`, the resolved selected day `D` equals `today`, and `hasReversibleEvent(D)` holds.
  - Internal port `hasReversibleEvent(date) => boolean`, a `() => true` **placeholder** scoped to this slice; wiring it to the week log is F4's job (spec §5). Keep it as a local const so the F4 plan can later promote it to an injected port.

- [ ] **Step 1: Add the failing tests**

Append to the `describe('ofeliaDutyModel server time', ...)` block in `client/widgets/ofelia-poop-duty/model/ofelia-duty.test.ts`:

```ts
  it('selects a day and resolves the default to today', () => {
    const model = ofeliaDutyModel({
      storage: createStorage(),
      timer: createFakeTimer({ today: Temporal.PlainDate.from('2026-06-16') }),
    })

    expect(model.selectedDate()).toBeNull()

    model.selectDay(Temporal.PlainDate.from('2026-06-15'))
    expect(model.selectedDate()?.toString()).toBe('2026-06-15')
  })

  it('allows undo only when the selected day equals server today', () => {
    const model = ofeliaDutyModel({
      storage: createStorage(),
      timer: createFakeTimer({ today: Temporal.PlainDate.from('2026-06-16') }),
    })

    // default selection (null) resolves to today -> available
    expect(model.undoAvailable()).toBe(true)

    model.selectDay(Temporal.PlainDate.from('2026-06-15'))
    expect(model.undoAvailable()).toBe(false)

    model.selectDay(Temporal.PlainDate.from('2026-06-16'))
    expect(model.undoAvailable()).toBe(true)
  })

  it('blocks undo before the first sync', () => {
    const model = ofeliaDutyModel({
      storage: createStorage(),
      timer: createFakeTimer(),
    })

    expect(model.undoAvailable()).toBe(false)
  })
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `pnpm --filter client test widgets/ofelia-poop-duty/model/ofelia-duty.test.ts`
Expected: FAIL — `selectDay`/`selectedDate`/`undoAvailable` are not defined.

- [ ] **Step 3: Add `selectedDate`/`selectDay` and `undoAvailable`**

In `ofelia-duty.ts`, add after the `goToCurrentWeek` action (from Task 5):

```ts
  const selectedDate = atom<Temporal.PlainDate | null>(
    null,
    "ofeliaDuty.selectedDate",
  );

  const selectDay = action((date: Temporal.PlainDate) => {
    selectedDate.set(date);
  });

  // Placeholder until F4 wires the week log behind this port (spec §5).
  const hasReversibleEvent = (_date: Temporal.PlainDate): boolean => true;

  const undoAvailable = computed(() => {
    const currentToday = today();
    const day = selectedDate() ?? currentToday;
    return (
      currentToday != null &&
      day != null &&
      day.equals(currentToday) &&
      hasReversibleEvent(day)
    );
  }, "ofeliaDuty.undoAvailable");
```

- [ ] **Step 4: Export the new members**

Add `selectedDate`, `selectDay`, and `undoAvailable` to the returned object:

```ts
  return {
    startOfWeekOverride,
    viewWeekStart,
    goToNextWeek,
    goToPrevWeek,
    goToCurrentWeek,
    selectedDate,
    selectDay,
    numberOfDebts,
    debtDays,
    currentWeek,
    undoAvailable,
    inDebt,
    forgiveDebt,
  };
```

- [ ] **Step 5: Run tests to verify they pass**

Run: `pnpm --filter client test widgets/ofelia-poop-duty/model/ofelia-duty.test.ts`
Expected: PASS (7 tests total).

- [ ] **Step 6: Commit**

```bash
git add client/widgets/ofelia-poop-duty/model/ofelia-duty.ts client/widgets/ofelia-poop-duty/model/ofelia-duty.test.ts
git commit -m "feat(ofelia): add selectedDate and undoAvailable gate (D == today)"
```

---

## Task 7: Wire `getServerTime()` into the widget UI + loading state

**Files:**
- Modify: `client/widgets/ofelia-poop-duty/ui/OfeliaPoopDuty.tsx`
- Test: `client/widgets/ofelia-poop-duty/ui/OfeliaPoopDuty.test.tsx`

**Interfaces:**
- Consumes: `getServerTime()` from `client/src/shared/timer/model/server-time` (Task 3); `ofeliaDutyModel({ storage, timer })` (Tasks 5-6); `model.currentWeek()` is now `null` until synced.
- Produces: the widget renders a loading state when `currentWeek() == null`, and otherwise renders today/tomorrow as before. In tests, the timer singleton is mocked so the existing assertions stay deterministic (jsdom has no real `/api/time`).

- [ ] **Step 1: Update the UI test (mock timer + loading state)**

Replace the contents of `client/widgets/ofelia-poop-duty/ui/OfeliaPoopDuty.test.tsx` with:

```tsx
// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { render, screen } from '@testing-library/react'
import type { WidgetRuntimeProps } from '../../../src/widget-host/model/types'
import { createWidgetStorage } from '../../../src/storage/model/widget-storage'
import { createFakeTimer } from '../../../src/shared/timer/model/fakes'
import type { ServerTime } from '../../../src/shared/timer/model/server-time'
import { OfeliaPoopDuty } from './OfeliaPoopDuty'

// vi.hoisted lifts the holder above the (also-hoisted) vi.mock factory. The
// factory reads `timerHolder.current` lazily at getServerTime() call time, so
// each test can swap the fake in beforeEach (createFakeTimer is a normal
// import, available by the time beforeEach runs).
const timerHolder = vi.hoisted(() => ({ current: null as ServerTime | null }))

vi.mock('../../../src/shared/timer/model/server-time', () => ({
  getServerTime: () => timerHolder.current,
}))

function props(mode: WidgetRuntimeProps['mode']): WidgetRuntimeProps {
  return {
    instanceId: 'ofelia-poop-duty-1',
    typeId: 'ofelia-poop-duty',
    mode,
    tier: 'standard',
    theme: 'light',
    requestFullscreen: vi.fn(),
    requestClose: vi.fn(),
    reportError: vi.fn(),
    storage: createWidgetStorage({
      instanceId: 'ofelia-poop-duty-1',
      typeId: 'ofelia-poop-duty',
    }),
  }
}

beforeEach(() => {
  timerHolder.current = createFakeTimer({ today: Temporal.PlainDate.from('2026-06-16') })
})

afterEach(() => {
  vi.clearAllMocks()
})

describe('OfeliaPoopDuty', () => {
  it('shows today and tomorrow in small mode once synced', () => {
    render(<OfeliaPoopDuty {...props('small')} />)

    expect(screen.getByText('Сегодня убирает')).toBeInTheDocument()
    expect(screen.getByText('Леша')).toBeInTheDocument()
    expect(screen.getByText('Завтра: Карина')).toBeInTheDocument()
  })

  it('shows today and tomorrow in large mode once synced', () => {
    render(<OfeliaPoopDuty {...props('large')} />)

    expect(screen.getByRole('heading', { name: 'Кто сегодня убирает какахи Офелии' })).toBeInTheDocument()
    expect(screen.getByText('Леша')).toBeInTheDocument()
    expect(screen.getByText('Завтра: Карина')).toBeInTheDocument()
  })

  it('shows a loading state before the first sync', () => {
    timerHolder.current = createFakeTimer()

    render(<OfeliaPoopDuty {...props('small')} />)

    expect(screen.getByText('Загрузка…')).toBeInTheDocument()
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm --filter client test widgets/ofelia-poop-duty/ui/OfeliaPoopDuty.test.tsx`
Expected: FAIL — model called without `timer`; no loading text rendered.

- [ ] **Step 3: Update the UI component**

Edit `client/widgets/ofelia-poop-duty/ui/OfeliaPoopDuty.tsx`. Add the import after the model import (line 4):

```tsx
import { getServerTime } from "../../../src/shared/timer/model/server-time";
```

Change the model construction (line 9) to inject the timer, and guard on a null week:

```tsx
    const model = useMemo(
      () => ofeliaDutyModel({ storage, timer: getServerTime() }),
      [storage],
    );
    const week = model.currentWeek();

    if (!week) {
      return (
        <section className={styles.small}>
          <div className={styles.label}>Загрузка…</div>
        </section>
      );
    }

    const todayIndex = week.findIndex((day) => day.isToday);
```

The rest of the component (the `today`/`tomorrow` derivation and the `mode === "large"` / small render) is unchanged and now runs only when `week` is non-null.

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm --filter client test widgets/ofelia-poop-duty/ui/OfeliaPoopDuty.test.tsx`
Expected: PASS (3 tests).

- [ ] **Step 5: Commit**

```bash
git add client/widgets/ofelia-poop-duty/ui/OfeliaPoopDuty.tsx client/widgets/ofelia-poop-duty/ui/OfeliaPoopDuty.test.tsx
git commit -m "feat(ofelia): inject ServerTime and render loading until first sync"
```

---

## Task 8: Full verification

**Files:** none (verification only).

- [ ] **Step 1: Run the whole workspace test suite**

Run: `pnpm test`
Expected: PASS — all server + client tests green.

- [ ] **Step 2: Typecheck the workspace**

Run: `pnpm typecheck`
Expected: no errors in `server` or `client` (watch for `noUnusedLocals`/`noUnusedParameters` — e.g. the `_date`/`_timeZone` placeholders are prefixed with `_`).

- [ ] **Step 3: (Optional) Manual smoke check**

If the full stack is available, start it and confirm the endpoint:

Run: `pnpm dev:server` then in another shell `rtk curl http://localhost:8787/api/time`
Expected: `{"now":<epoch ms>}`. Then `pnpm dev` and confirm the Ofelia widget renders today's duty (not stuck on "Загрузка…").

- [ ] **Step 4: Final commit (only if Steps 1-2 surfaced fixes)**

```bash
git add -A
git commit -m "chore(ofelia): server-time verification fixes"
```

---

## Self-Review

**Spec coverage (server-time design §1-§7):**
- §3 ServerTime contract 4.7 → Task 3 (`server-time.ts`) — `nowMs`/`today`/`sync`/`isSynced`, RTT ignored.
- §4.1 `http-time.ts` (`fetchServerTime` + `TimeError`) → Task 2.
- §4.2 singleton (`offsetMs`, `sync`, `nowMs`, `today`, `isSynced`, re-sync via connect + visibilitychange, `getServerTime`) → Task 3.
- §4.3 `fakes.ts` (`createFakeTimer`) → Task 4.
- §5 model changes (signature `{ storage, timer }`, `getToday` removed → nullable `today`, `startOfWeekOverride`/`viewWeekStart`, nullable `debtDays`/`currentWeek`, action guards, `selectedDate`/`selectDay`, `undoAvailable` with `hasReversibleEvent` placeholder) → Tasks 5-6.
- §6 UI states (loading when `currentWeek == null`) → Task 7. (Buttons-disabled + undo affordance visuals are F6, out of scope; the model exposes `undoAvailable` and nullable state for F6 to consume — noted in spec §6.)
- §7 testing (server `GET /api/time`; shared/timer offset/today/error/re-sync; ofelia null-state + actions + undo gate) → Tasks 1-7 tests; §8 endpoint placement next to `/api/storage/*` → Task 1.

**Out of scope (per user-selected Plan A, spec §5 F3-core):** `confirmClean`/`goIntoDebt`/`forgive`/`undo` actions, `HistoryPort`, `currentUser`. The `undoAvailable` predicate's `hasReversibleEvent` is a `true` placeholder behind a local seam for F4 (spec §5 explicitly allows this).

**Placeholder scan:** no TBD/"handle edge cases"/"similar to Task N" — every code step shows full code.

**Type consistency:** `ServerTime` (`nowMs`/`today`/`sync`/`isSynced`) is defined in Task 3 and consumed identically in Tasks 4-7. `viewWeekStart`/`startOfWeekOverride`/`selectedDate`/`selectDay`/`undoAvailable`/`debtDays`/`currentWeek` names are consistent across model (Tasks 5-6), model tests, and UI (Task 7). `today` is `PlainDate | null` everywhere. `createFakeTimer` signature matches its uses.

---

## Execution Handoff

Plan complete and saved to `docs/superpowers/plans/2026-06-21-ofelia-server-time.md`. Two execution options:

**1. Subagent-Driven (recommended)** — I dispatch a fresh subagent per task, review between tasks, fast iteration.

**2. Inline Execution** — Execute tasks in this session using executing-plans, batch execution with checkpoints.

Which approach?
