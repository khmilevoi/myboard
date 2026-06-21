# F4 — History (Ofelia) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Wire the per-week history log into the Ofelia model as a reactive, SSE-backed read (keyed by the viewed week), expose a display-ready projection, replace the `undoAvailable` placeholder with a real day-status check, and ship a standalone `HistoryList` UI part.

**Architecture:** Everything model-side lands in the existing `model/ofelia-duty.ts` — no new model file (F4's read side is tightly coupled to `viewWeekStart`/`numberOfDebts`/`undoAvailable`/`undo`, all of which live there; this mirrors the F3 "no new model files" decision and supersedes the spec's `model/ofelia-history.ts` suggestion). A `historyEvents` atom subscribes to `history:<weekStartISO>` via `StorageApi.subscribe`; because the key follows `viewWeekStart`, the subscription is driven by an `effect` (which tracks `viewWeekStart` and re-subscribes on week change) hosted inside a `withConnectHook` (which tears the live subscription down on disconnect). The write side already exists (F3 appends directly), so F4 adds **only** the read side plus its consumers. The UI part `ui/parts/HistoryList.tsx` is a prop-driven, `reatomMemo`-wrapped presentational component; wiring it into the tier router is F6's job.

**Tech Stack:** TypeScript (ESM), Reatom v1001 (`atom`/`computed`/`action`/`effect`/`withConnectHook`/`withAsyncData`/`wrap`), Zod v4, Temporal (global polyfill), the `ServerTime` timer (`@/shared/timer/model/server-time`) with `createFakeTimer` in tests, Vitest + jsdom, Testing Library.

## Global Constraints

- **Model scope is `model/ofelia-duty.ts` only.** The only new files are the UI part and its CSS/test (`ui/parts/HistoryList.{tsx,module.css,test.tsx}`). Do **not** modify `ui/OfeliaPoopDuty.tsx` (the tier router is F6); do **not** touch the storage layer (F2 is merged) or the server.
- **History is read-only here.** The single history write path is F3's `storage.shared.server.append(...)`; F4 never writes history. The reactive read uses `storage.shared.server.subscribe(...)`, which already receives our own appends back via SSE (server republishes the whole array), so the list updates after every action for free.
- **Server-time first.** "today" and `viewWeekStart` are timer-derived and nullable (`Temporal.PlainDate | null`, `null` before the first sync). When `viewWeekStart()` is `null`, `historyEvents` holds `[]` and no subscription is opened.
- **Errors as values (errore/Reatom).** Storage callbacks deliver `StorageError | StorageChange<T>`; narrow with `instanceof Error` and ignore errors in the listener (do not throw from a subscription callback). Never use `try/catch` for control flow.
- **Async boundaries use `wrap`.** Every storage callback that touches an atom is wrapped with `wrap(...)` (matches `withStorageKey` and the rest of the repo).
- **Code style (match the file being edited).** `ofelia-duty.ts` and `ofelia-duty.test.ts` are oxfmt-formatted: **single quotes, no semicolons, 2-space indent, named exports**, and **every** atom/action/computed/effect carries an explicit `'ofeliaDuty.<name>'` trace name. New UI files follow the same single-quote/no-semicolon style as `Clock.tsx`. Run `pnpm format` before the final commit.
- **Reatom defaults.** Direct atom writes use `atom.set(...)` (no pass-through setter actions). The subscription is connection-scoped (`withConnectHook`), not an always-on top-level `effect`, so it auto-tears-down on widget unmount.
- **Before PR:** `pnpm test`, `pnpm typecheck`, `pnpm lint`, and `pnpm format:check` must pass (run from repo root).

---

## File Structure

- **Modify** `client/widgets/ofelia-poop-duty/model/ofelia-duty.ts`
  - Add history Zod schemas (`HistoryEventTypeSchema`, `HistoryEventSchema`, `HistoryEventsSchema`).
  - Add `IP_TAIL_LENGTH` const and `HistoryEntryView` type (module-level exports).
  - Add `effect` to the `@reatom/core` import.
  - Inside `ofeliaDutyModel`: add the `historyEvents` atom + connection-scoped subscription, the `historyView` computed; rewrite `undoAvailable` to read `historyEvents` (drop the `hasReversibleEvent` placeholder); make `undo` parameterless (read `historyEvents()` internally). Add `historyEvents` and `historyView` to the return.
- **Modify** `client/widgets/ofelia-poop-duty/model/ofelia-duty.test.ts`
  - Add a `createHistoryStorage()` helper (captures subscribe listeners, supports `emit`).
  - Add describe blocks for `historyEvents` and `historyView`.
  - Rewrite the existing `undoAvailable` "allows undo only when…" test and the two `undo` tests for the new wiring.
- **Create** `client/widgets/ofelia-poop-duty/ui/parts/HistoryList.tsx`
- **Create** `client/widgets/ofelia-poop-duty/ui/parts/HistoryList.module.css`
- **Create** `client/widgets/ofelia-poop-duty/ui/parts/HistoryList.test.tsx`

`viewWeekStart`, `startOfWeekOverride`, `selectedDate`, `numberOfDebts`, `currentUser`, the four domain actions, the week-nav actions, and all pure selectors already exist (F3 / server-time slice) and are consumed, not redefined.

---

## Task 1: `historyEvents` atom + reactive per-week subscription

**Files:**

- Modify: `client/widgets/ofelia-poop-duty/model/ofelia-duty.ts`
- Test: `client/widgets/ofelia-poop-duty/model/ofelia-duty.test.ts`

**Interfaces:**

- Consumes: existing `viewWeekStart` (`Computed<Temporal.PlainDate | null>`), `historyKey(date)` (free fn → `history:<weekStartISO>`), `storage.shared.server.subscribe`, existing module-private `PersonSchema`.
- Produces:
  - module-private `HistoryEventsSchema: z.ZodType<HistoryEvent[]>`
  - `ofeliaDutyModel(...)` return gains `historyEvents: Atom<HistoryEvent[]>` — `[]` by default and before the first sync; reflects the viewed week's log; re-subscribes when the week changes; tears the subscription down on disconnect.

- [ ] **Step 1: Write the failing tests**

In `client/widgets/ofelia-poop-duty/model/ofelia-duty.test.ts`, add `StorageListener` to the storage types import:

```ts
import type { StorageApi, StorageListener } from '@/storage/model/types'
```

Below the existing `createStorage` helper, add a history-aware storage double:

```ts
type SubscribeCall = {
  key: string
  listener: StorageListener<HistoryEvent[]>
  unsubscribe: ReturnType<typeof vi.fn>
}

function createHistoryStorage() {
  const calls: SubscribeCall[] = []

  const subscribe = vi.fn((key: string, listener: StorageListener<HistoryEvent[]>) => {
    const unsubscribe = vi.fn()
    calls.push({ key, listener, unsubscribe })
    return unsubscribe
  }) as unknown as StorageApi['subscribe']

  const storage = createStorage({ subscribe })

  const emit = (key: string, value: HistoryEvent[] | null) => {
    for (const call of calls) {
      if (call.key === key) call.listener({ value })
    }
  }

  return { storage, subscribe, calls, emit }
}
```

Add a describe block (place it after the `ofeliaDutyModel server time` block):

```ts
describe('ofeliaDutyModel.historyEvents', () => {
  it('defaults to an empty array', () => {
    const model = ofeliaDutyModel({
      storage: createStorage(),
      timer: createFakeTimer(),
    })

    expect(model.historyEvents()).toEqual([])
  })

  it('subscribes to the viewed week key and reflects emitted events', async () => {
    const { storage, subscribe, emit } = createHistoryStorage()
    const model = ofeliaDutyModel({
      storage,
      timer: createFakeTimer({ today: D('2026-06-16') }),
    })

    await context.start(async () => {
      const off = model.historyEvents.subscribe(() => {})

      await vi.waitFor(() =>
        expect(subscribe).toHaveBeenCalledWith(
          'history:2026-06-15',
          expect.any(Function),
          expect.anything(),
        ),
      )

      emit('history:2026-06-15', [ev({ date: '2026-06-16', type: 'cleaned' })])

      await vi.waitFor(() => expect(model.historyEvents()).toHaveLength(1))
      expect(model.historyEvents()[0]?.type).toBe('cleaned')

      off()
    })
  })

  it('re-subscribes to the new week and drops the old subscription on navigation', async () => {
    const { storage, subscribe, calls } = createHistoryStorage()
    const model = ofeliaDutyModel({
      storage,
      timer: createFakeTimer({ today: D('2026-06-16') }),
    })

    await context.start(async () => {
      const off = model.historyEvents.subscribe(() => {})

      await vi.waitFor(() =>
        expect(subscribe).toHaveBeenCalledWith(
          'history:2026-06-15',
          expect.any(Function),
          expect.anything(),
        ),
      )

      model.goToNextWeek()

      await vi.waitFor(() =>
        expect(subscribe).toHaveBeenCalledWith(
          'history:2026-06-22',
          expect.any(Function),
          expect.anything(),
        ),
      )
      expect(calls[0]?.unsubscribe).toHaveBeenCalled()

      off()
    })
  })
})
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `pnpm --filter client test -- ofelia-duty`
Expected: FAIL — `model.historyEvents` is `undefined`.

- [ ] **Step 3: Write minimal implementation**

In `client/widgets/ofelia-poop-duty/model/ofelia-duty.ts`:

(a) Add `effect` to the `@reatom/core` import:

```ts
import {
  action,
  atom,
  computed,
  effect,
  withAsyncData,
  withChangeHook,
  withConnectHook,
  wrap,
} from '@reatom/core'
```

(b) Directly below the existing `const PersonSchema = z.enum(DUTY_ROTATION)` add the history schemas (keep `HistoryEventTypeSchema` in sync with the `HistoryEventType` union):

```ts
const HistoryEventTypeSchema = z.enum(['cleaned', 'went_into_debt', 'forgiven', 'cancelled'])

const HistoryEventSchema = z.object({
  id: z.string(),
  ts: z.number(),
  ip: z.string(),
  date: z.string(),
  type: HistoryEventTypeSchema,
  actor: PersonSchema,
  onBehalfOf: PersonSchema.optional(),
  by: PersonSchema,
})

const HistoryEventsSchema = z.array(HistoryEventSchema)
```

(c) Inside `ofeliaDutyModel`, after the `selectedDate` atom (and before `undoAvailable`), add the history atom and its connection-scoped subscription:

```ts
const historyEvents = atom<HistoryEvent[]>([], 'ofeliaDuty.historyEvents')

// The history key follows the viewed week, so the subscription must re-key on
// navigation. An `effect` tracks `viewWeekStart` and (re)opens the storage
// subscription; the connect hook tears the live subscription down on disconnect
// (the effect itself is disposed via `sync.unsubscribe()`), so unmounting the
// widget releases the SSE subscription.
historyEvents.extend(
  withConnectHook(() => {
    let off: () => void = () => {}

    const sync = effect(() => {
      const week = viewWeekStart()
      off()
      off = () => {}

      if (week == null) {
        historyEvents.set([])
        return
      }

      off = storage.shared.server.subscribe<HistoryEvent[]>(
        historyKey(week),
        wrap((event) => {
          if (event instanceof Error) return
          historyEvents.set(event.value ?? [])
        }),
        HistoryEventsSchema,
      )
    }, 'ofeliaDuty.historyEvents.sync')

    return () => {
      off()
      sync.unsubscribe()
    }
  }),
)
```

(d) Add `historyEvents` to the model's `return { ... }` object (next to `currentWeek`/`undoAvailable`).

- [ ] **Step 4: Run tests to verify they pass**

Run: `pnpm --filter client test -- ofelia-duty`
Expected: PASS (all existing tests + the three new `historyEvents` tests).

- [ ] **Step 5: Commit**

```bash
git add client/widgets/ofelia-poop-duty/model/ofelia-duty.ts client/widgets/ofelia-poop-duty/model/ofelia-duty.test.ts
git commit -m "feat(ofelia): reactive per-week history subscription"
```

---

## Task 2: `historyView` projection (sort + IP tail)

**Files:**

- Modify: `client/widgets/ofelia-poop-duty/model/ofelia-duty.ts`
- Test: `client/widgets/ofelia-poop-duty/model/ofelia-duty.test.ts`

**Interfaces:**

- Consumes: `historyEvents` (Task 1).
- Produces (module-level exports + factory member):
  - `const IP_TAIL_LENGTH = 5`
  - `type HistoryEntryView = { id: string; date: string; type: HistoryEventType; actor: Person; onBehalfOf?: Person; by: Person; ipTail: string }`
  - `ofeliaDutyModel(...)` return gains `historyView: Computed<HistoryEntryView[]>` — events newest-first (`ts` desc), each with `ipTail` = the last `IP_TAIL_LENGTH` characters of `ip`.

- [ ] **Step 1: Write the failing tests**

Extend the import from `./ofelia-duty` to include the new symbols:

```ts
import {
  DEBT_WARNING_THRESHOLD,
  effectiveDuty,
  getDayStatus,
  historyKey,
  IP_TAIL_LENGTH,
  isDebtDay,
  isOverDebtWarning,
  ofeliaDutyModel,
  otherPerson,
  weekStartISO,
} from './ofelia-duty'
import type { HistoryEntryView, HistoryEvent } from './ofelia-duty'
```

Add a describe block:

```ts
describe('ofeliaDutyModel.historyView', () => {
  it('maps events newest-first with an IP tail', () => {
    const model = ofeliaDutyModel({
      storage: createStorage(),
      timer: createFakeTimer({ today: D('2026-06-16') }),
    })

    model.historyEvents.set([
      ev({ id: 'a', ts: 1, ip: '10.0.0.11', type: 'cleaned' }),
      ev({ id: 'b', ts: 3, ip: '10.0.0.22', type: 'went_into_debt', onBehalfOf: 'Карина' }),
      ev({ id: 'c', ts: 2, ip: '10.0.0.33', type: 'forgiven' }),
    ])

    const view = model.historyView()

    expect(view.map((entry) => entry.id)).toEqual(['b', 'c', 'a'])
    expect(view[0]).toMatchObject({
      id: 'b',
      type: 'went_into_debt',
      onBehalfOf: 'Карина',
      ipTail: '0.0.22',
    })
    expect(IP_TAIL_LENGTH).toBe(5)
    expect(view[0]?.ipTail).toBe('10.0.0.22'.slice(-IP_TAIL_LENGTH))
  })

  it('omits onBehalfOf when the event has none', () => {
    const model = ofeliaDutyModel({
      storage: createStorage(),
      timer: createFakeTimer({ today: D('2026-06-16') }),
    })

    model.historyEvents.set([ev({ id: 'a', ts: 1, type: 'cleaned' })])

    const entry: HistoryEntryView | undefined = model.historyView()[0]
    expect(entry?.onBehalfOf).toBeUndefined()
  })
})
```

> Note `ipTail: '0.0.22'` — the last 5 chars of `'10.0.0.22'`.

- [ ] **Step 2: Run tests to verify they fail**

Run: `pnpm --filter client test -- ofelia-duty`
Expected: FAIL — `IP_TAIL_LENGTH` / `model.historyView` do not exist.

- [ ] **Step 3: Write minimal implementation**

(a) At module level, next to `export const DEBT_WARNING_THRESHOLD = 7`, add:

```ts
export const IP_TAIL_LENGTH = 5

export type HistoryEntryView = {
  id: string
  date: string
  type: HistoryEventType
  actor: Person
  onBehalfOf?: Person
  by: Person
  ipTail: string
}
```

(b) Inside `ofeliaDutyModel`, right after the `historyEvents` subscription block, add:

```ts
const historyView = computed<HistoryEntryView[]>(
  () =>
    historyEvents()
      .slice()
      .sort((a, b) => b.ts - a.ts)
      .map((event) => ({
        id: event.id,
        date: event.date,
        type: event.type,
        actor: event.actor,
        ...(event.onBehalfOf ? { onBehalfOf: event.onBehalfOf } : {}),
        by: event.by,
        ipTail: event.ip.slice(-IP_TAIL_LENGTH),
      })),
  'ofeliaDuty.historyView',
)
```

(c) Add `historyView` to the model's `return { ... }` object.

- [ ] **Step 4: Run tests to verify they pass**

Run: `pnpm --filter client test -- ofelia-duty`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add client/widgets/ofelia-poop-duty/model/ofelia-duty.ts client/widgets/ofelia-poop-duty/model/ofelia-duty.test.ts
git commit -m "feat(ofelia): historyView projection with IP tail"
```

---

## Task 3: Wire `undoAvailable`/`undo` to the live history log

**Files:**

- Modify: `client/widgets/ofelia-poop-duty/model/ofelia-duty.ts`
- Test: `client/widgets/ofelia-poop-duty/model/ofelia-duty.test.ts`

**Interfaces:**

- Consumes: `historyEvents` (Task 1), existing `getDayStatus`, `effectiveDuty`, `historyKey`, `currentUser`, `numberOfDebts`, model-internal `today()`.
- Produces:
  - `undoAvailable` now returns `true` only when the selected day is server-today **and** that day is `closed` per the loaded week log (placeholder `hasReversibleEvent` removed).
  - `undo` becomes **parameterless** (`undo(): Promise<void>`), reading `historyEvents()` internally instead of taking an `events` argument. Behaviour is otherwise unchanged (today-only, debt-neutral, appends `cancelled` only when today is `closed`).

> **Why parameterless undo:** with `historyEvents` now in the model, both `undoAvailable` and `undo` should read the same internal source. Keeping `undo(events)` while `undoAvailable` reads internally would be inconsistent and force F6 to thread events into the call. `undoAvailable` reads `historyEvents()` **unconditionally** (before the short-circuit) so the atom stays a stable dependency — it remains connected across `selectedDate` changes rather than flickering its subscription.

- [ ] **Step 1: Update the existing tests**

(a) Replace the existing `it('allows undo only when the selected day equals server today', …)` test (in the `ofeliaDutyModel server time` block) with a version that loads a closed day:

```ts
it('allows undo only when today is closed and selected', async () => {
  const { storage, subscribe, emit } = createHistoryStorage()
  const model = ofeliaDutyModel({
    storage,
    timer: createFakeTimer({ today: D('2026-06-16') }),
  })

  await context.start(async () => {
    const off = model.undoAvailable.subscribe(() => {})

    await vi.waitFor(() =>
      expect(subscribe).toHaveBeenCalledWith(
        'history:2026-06-15',
        expect.any(Function),
        expect.anything(),
      ),
    )

    // No closed event yet -> not available.
    expect(model.undoAvailable()).toBe(false)

    emit('history:2026-06-15', [ev({ date: '2026-06-16', type: 'cleaned' })])
    await vi.waitFor(() => expect(model.undoAvailable()).toBe(true))

    model.selectedDate.set(D('2026-06-15'))
    expect(model.undoAvailable()).toBe(false)

    model.selectedDate.set(D('2026-06-16'))
    expect(model.undoAvailable()).toBe(true)

    off()
  })
})
```

(The `blocks undo before the first sync` test stays as-is: with an unsynced timer `today()` is `null`, so `undoAvailable()` is `false` regardless of history.)

(b) Replace the two tests in the `ofeliaDutyModel.undo` describe block:

```ts
describe('ofeliaDutyModel.undo', () => {
  it('appends a cancellation for today without changing debt', async () => {
    const { storage, subscribe, emit } = createHistoryStorage()
    const model = ofeliaDutyModel({
      storage,
      timer: createFakeTimer({ today: D('2026-06-16') }),
    })

    model.numberOfDebts.set({ Леша: 0, Карина: 0 })

    await context.start(async () => {
      const off = model.historyEvents.subscribe(() => {})

      await vi.waitFor(() =>
        expect(subscribe).toHaveBeenCalledWith(
          'history:2026-06-15',
          expect.any(Function),
          expect.anything(),
        ),
      )

      emit('history:2026-06-15', [
        ev({ date: '2026-06-16', type: 'cleaned', actor: 'Леша', by: 'Леша' }),
      ])
      await vi.waitFor(() => expect(model.historyEvents()).toHaveLength(1))

      await model.undo()
      off()
    })

    expect(model.numberOfDebts()).toEqual({ Леша: 0, Карина: 0 })
    expect(storage.shared.server.append).toHaveBeenCalledWith('history:2026-06-15', {
      date: '2026-06-16',
      type: 'cancelled',
      actor: 'Леша',
      by: 'Леша',
    })
  })

  it('is a no-op when today is not closed', async () => {
    const { storage } = createHistoryStorage()
    const model = ofeliaDutyModel({
      storage,
      timer: createFakeTimer({ today: D('2026-06-16') }),
    })

    model.numberOfDebts.set({ Леша: 0, Карина: 0 })

    await context.start(async () => {
      const off = model.historyEvents.subscribe(() => {})
      await model.undo()
      off()
    })

    expect(storage.shared.server.append).not.toHaveBeenCalled()
  })
})
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `pnpm --filter client test -- ofelia-duty`
Expected: FAIL — `undoAvailable` still returns the placeholder `true` (so `expect(...).toBe(false)` fails), and `undo()` called with no argument runs the old `(events) => …` body against `undefined`.

- [ ] **Step 3: Write minimal implementation**

(a) Remove the placeholder and rewrite `undoAvailable`. Replace:

```ts
// Placeholder until F4 wires the week log behind this port (spec §5).
const hasReversibleEvent = (_date: Temporal.PlainDate): boolean => true

const undoAvailable = computed(() => {
  const currentToday = today()
  const day = selectedDate() ?? currentToday
  return currentToday != null && day != null && day.equals(currentToday) && hasReversibleEvent(day)
}, 'ofeliaDuty.undoAvailable')
```

with:

```ts
const undoAvailable = computed(() => {
  const events = historyEvents()
  const currentToday = today()
  const day = selectedDate() ?? currentToday
  return (
    currentToday != null &&
    day != null &&
    day.equals(currentToday) &&
    getDayStatus(events, day) === 'closed'
  )
}, 'ofeliaDuty.undoAvailable')
```

> `undoAvailable` must be defined **after** `historyEvents`. If the current source order places `undoAvailable` before the Task 1 `historyEvents` block, move the `historyEvents` block (and the Task 2 `historyView`) above `undoAvailable`.

(b) Make `undo` parameterless. Replace the action signature/guard:

```ts
  const undo = action(async (events: HistoryEvent[]) => {
    const currentToday = today()
    if (currentToday == null) return
    if (getDayStatus(events, currentToday) !== 'closed') return
```

with:

```ts
  const undo = action(async () => {
    const currentToday = today()
    if (currentToday == null) return
    if (getDayStatus(historyEvents(), currentToday) !== 'closed') return
```

Leave the rest of the `undo` body (the `cancelled` append with `actor: effectiveDuty(...)`, `by: currentUser()`) and its `.extend(withAsyncData({ status: true }))` unchanged. The long explanatory comment above the append stays accurate.

- [ ] **Step 4: Run tests + typecheck to verify green**

Run: `pnpm --filter client test -- ofelia-duty`
Expected: PASS.
Run: `pnpm typecheck`
Expected: PASS — the only `undo` caller is tests (the widget UI never calls it yet).

- [ ] **Step 5: Commit**

```bash
git add client/widgets/ofelia-poop-duty/model/ofelia-duty.ts client/widgets/ofelia-poop-duty/model/ofelia-duty.test.ts
git commit -m "feat(ofelia): drive undoAvailable/undo from the live history log"
```

---

## Task 4: `HistoryList` UI part

**Files:**

- Create: `client/widgets/ofelia-poop-duty/ui/parts/HistoryList.tsx`
- Create: `client/widgets/ofelia-poop-duty/ui/parts/HistoryList.module.css`
- Test: `client/widgets/ofelia-poop-duty/ui/parts/HistoryList.test.tsx`

**Interfaces:**

- Consumes: `HistoryEntryView` (Task 2).
- Produces: `HistoryList` — a `reatomMemo`-wrapped presentational component. Props: `{ entries: HistoryEntryView[] }`. Renders, newest-first as supplied, one row per entry: an avatar (first letter of `actor`), the `actor` name, a localized action label, a `за <onBehalfOf>` badge when present, the ISO date, and the IP tail in a light/mono style. Renders an empty-state line when `entries` is empty.

- [ ] **Step 1: Write the failing test**

Create `client/widgets/ofelia-poop-duty/ui/parts/HistoryList.test.tsx`:

```tsx
// @vitest-environment jsdom
import { render, screen } from '@testing-library/react'
import { describe, expect, it } from 'vitest'

import type { HistoryEntryView } from '../../model/ofelia-duty'

import { HistoryList } from './HistoryList'

const entry = (overrides: Partial<HistoryEntryView> = {}): HistoryEntryView => ({
  id: 'e1',
  date: '2026-06-16',
  type: 'cleaned',
  actor: 'Карина',
  by: 'Карина',
  ipTail: '0.0.22',
  ...overrides,
})

describe('HistoryList', () => {
  it('renders an entry with name, action label, and IP tail', () => {
    render(<HistoryList entries={[entry()]} />)

    expect(screen.getByText('Карина')).toBeInTheDocument()
    expect(screen.getByText('убрал(а)')).toBeInTheDocument()
    expect(screen.getByText('2026-06-16')).toBeInTheDocument()
    expect(screen.getByText('0.0.22')).toBeInTheDocument()
  })

  it('renders an "за X" badge only when onBehalfOf is present', () => {
    const { rerender } = render(<HistoryList entries={[entry({ onBehalfOf: 'Леша' })]} />)
    expect(screen.getByText('за Леша')).toBeInTheDocument()

    rerender(<HistoryList entries={[entry()]} />)
    expect(screen.queryByText(/^за /)).not.toBeInTheDocument()
  })

  it('renders an empty state when there are no entries', () => {
    render(<HistoryList entries={[]} />)
    expect(screen.getByText('Пока нет событий')).toBeInTheDocument()
  })
})
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `pnpm --filter client test -- HistoryList`
Expected: FAIL — cannot resolve `./HistoryList`.

- [ ] **Step 3: Write the component and styles**

Create `client/widgets/ofelia-poop-duty/ui/parts/HistoryList.tsx`:

```tsx
import { reatomMemo } from '@/shared/reatom/reatom-memo'

import type { HistoryEntryView } from '../../model/ofelia-duty'

import styles from './HistoryList.module.css'

const ACTION_LABEL: Record<HistoryEntryView['type'], string> = {
  cleaned: 'убрал(а)',
  went_into_debt: 'ушёл(ла) в долг',
  forgiven: 'простил(а)',
  cancelled: 'отменил(а)',
}

export type HistoryListProps = {
  entries: HistoryEntryView[]
}

export const HistoryList = reatomMemo<HistoryListProps>(({ entries }) => {
  if (entries.length === 0) {
    return <div className={styles.empty}>Пока нет событий</div>
  }

  return (
    <ul className={styles.list}>
      {entries.map((entry) => (
        <li key={entry.id} className={styles.item}>
          <span className={styles.avatar} aria-hidden>
            {entry.actor.slice(0, 1)}
          </span>
          <div className={styles.body}>
            <div className={styles.line}>
              <span className={styles.name}>{entry.actor}</span>
              <span className={styles.action}>{ACTION_LABEL[entry.type]}</span>
              {entry.onBehalfOf ? (
                <span className={styles.badge}>за {entry.onBehalfOf}</span>
              ) : null}
            </div>
            <div className={styles.meta}>
              <span className={styles.date}>{entry.date}</span>
              <span className={styles.ip}>{entry.ipTail}</span>
            </div>
          </div>
        </li>
      ))}
    </ul>
  )
}, 'HistoryList')
```

Create `client/widgets/ofelia-poop-duty/ui/parts/HistoryList.module.css` (minimal, theme-token based; F6 refines the visual):

```css
.list {
  margin: 0;
  padding: 0;
  list-style: none;
  display: flex;
  flex-direction: column;
  gap: 8px;
}

.item {
  display: flex;
  align-items: flex-start;
  gap: 10px;
}

.avatar {
  flex: none;
  width: 28px;
  height: 28px;
  border-radius: 50%;
  display: grid;
  place-items: center;
  font-weight: 650;
  background: var(--accent-soft, var(--surface));
  color: var(--accent-2, var(--text));
}

.body {
  display: flex;
  flex-direction: column;
  gap: 2px;
  min-width: 0;
}

.line {
  display: flex;
  align-items: baseline;
  gap: 6px;
  flex-wrap: wrap;
}

.name {
  font-weight: 600;
  color: var(--text);
}

.action {
  color: var(--text-dim);
}

.badge {
  font-size: 12px;
  padding: 1px 6px;
  border-radius: 999px;
  background: var(--accent-soft, var(--surface));
  color: var(--text-dim);
}

.meta {
  display: flex;
  align-items: baseline;
  gap: 8px;
  font-size: 12px;
  color: var(--text-dim);
}

.ip {
  font-family: var(--font-mono, ui-monospace, monospace);
  opacity: 0.7;
}

.empty {
  font-size: 13px;
  color: var(--text-dim);
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `pnpm --filter client test -- HistoryList`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add client/widgets/ofelia-poop-duty/ui/parts/HistoryList.tsx client/widgets/ofelia-poop-duty/ui/parts/HistoryList.module.css client/widgets/ofelia-poop-duty/ui/parts/HistoryList.test.tsx
git commit -m "feat(ofelia): HistoryList UI part"
```

---

## Task 5: Verify & finalize

**Files:** none (verification only).

- [ ] **Step 1: Format**

Run: `pnpm format`
Expected: writes oxfmt formatting; re-stage if anything changed.

- [ ] **Step 2: Full workspace test + typecheck + lint**

Run: `pnpm test`
Expected: PASS (whole monorepo).
Run: `pnpm typecheck`
Expected: PASS.
Run: `pnpm lint`
Expected: PASS.
Run: `pnpm format:check`
Expected: PASS.

- [ ] **Step 3: Commit any formatting**

```bash
git add -A
git commit -m "chore(ofelia): format F4 history" || echo "nothing to format"
```

---

## Self-Review (against spec §F4 + contracts 4.3)

**1. Spec coverage:**

- **F4 goal — per-week log read/subscribe + UI list with IP tail:** `historyEvents` subscribes to `history:<weekStartISO>` (Task 1); `HistoryList` renders the entries with the IP tail (Task 4). ✅
- **"смена недели меняет лог":** the `effect` tracks `viewWeekStart` and re-subscribes, dropping the previous subscription (Task 1 navigation test). ✅
- **"пополняется действиями":** F3 actions `append` to the same key; the server republishes the array over SSE, which the subscription receives — covered indirectly (the subscription updates `historyEvents` on every emit; Task 1 emit test). ✅
- **Contract 4.3 (HistoryEvent shape):** `HistoryEventSchema` validates `id/ts/ip/date/type/actor/onBehalfOf?/by`; `historyView` carries them through plus `ipTail`. ✅
- **IP tail in light font:** `historyView.ipTail = ip.slice(-IP_TAIL_LENGTH)`; `.ip` styled mono/dim (Tasks 2, 4). ✅
- **Removes the F4 placeholder:** `hasReversibleEvent` deleted; `undoAvailable`/`undo` read the live log (Task 3). ✅

**2. Placeholder scan:** none. Every step shows full code, exact commands, and expected output.

**3. Type consistency:** `historyEvents: Atom<HistoryEvent[]>`, `historyView: Computed<HistoryEntryView[]>`, `HistoryEntryView`, `IP_TAIL_LENGTH`, and `HistoryListProps.entries` are used identically across model, tests, and UI. `undo` is parameterless everywhere after Task 3 (only callers are the updated tests). The factory signature stays `ofeliaDutyModel({ storage, timer })`. Every Reatom unit carries an `'ofeliaDuty.<name>'` trace name.

**Spec deltas recorded (apply to the spec doc separately if desired):**

- **History read lives in `model/ofelia-duty.ts`, not a new `model/ofelia-history.ts`** — it is coupled to `viewWeekStart`/`numberOfDebts`/`undoAvailable`/`undo`; consistent with F3's "no new model files".
- **No `HistoryPort`** (already dropped by F3): the read uses `storage.shared.server.subscribe` directly; the write side is F3's `append`.
- **`undo` is parameterless** (reads `historyEvents()` internally) instead of `undo(events)`; `undoAvailable` reads the live log instead of the `() => true` placeholder.
- **Wiring `HistoryList` into the tiers is F6**, not F4 (the part is delivered standalone and unit-tested).

---

## Execution Handoff

Plan complete and saved to `docs/superpowers/plans/2026-06-21-ofelia-f4-history.md`. Two execution options:

**1. Subagent-Driven (recommended)** — dispatch a fresh subagent per task, review between tasks, fast iteration.

**2. Inline Execution** — execute tasks in this session using executing-plans, batch execution with checkpoints.

Which approach?
