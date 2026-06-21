# F3 — Actions & Debt (Ofelia model) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Extend the Ofelia model so it applies **confirm / go-into-debt / forgive / undo** to a selected day, keeps the debt counter per spec §3.2, writes an attributed per-week history log, and exposes the global **current user** ("кто я") persisted per-device.

**Baseline (server-time slice already merged):** This plan is rebased onto the server-time slice (`docs/superpowers/plans/2026-06-21-ofelia-server-time.md`), which is already implemented. That slice changed the model factory to `ofeliaDutyModel({ storage, timer })`, made "today" come from an injected `ServerTime` (`timer.today(DUTY_TIME_ZONE)` → `Temporal.PlainDate | null`, `null` before the first sync), replaced the old `startOfWeek` atom with `startOfWeekOverride` + a derived `viewWeekStart` computed, added a nullable `selectedDate` atom (set **directly** — there is no `selectDay`), added the `undoAvailable` computed with a `hasReversibleEvent` placeholder, and made `debtDays`/`currentWeek` nullable. F3 builds on that surface; it does **not** re-add `selectedDate`/`viewWeekStart`/`undoAvailable`.

**Architecture:** Everything lands in the existing `model/ofelia-duty.ts` — no new model files. `currentUser` is a plain writable atom **inside** `ofeliaDutyModel`, persisted device-local with connect/change hooks (no action, no computed, no separate model). The four domain actions read "today" from the model-internal `today()` computed (timer-derived) and **no-op before the first sync** (`today() == null`); their target day defaults to `selectedDate() ?? today()`. Debt stays a **stored counter** (`numberOfDebts`); the history log is written **directly** via `storage.shared.server.append(historyKey(date), draft)` (no `HistoryPort`). Day status is a **pure selector** over the week's events. **Undo is v1-simplified:** it appends a `cancelled` event for **today only** and does **not** change debt; a cancelled day reopens to _pending_. The widget UI is untouched (F6 wires buttons later); the factory signature stays `ofeliaDutyModel({ storage, timer })`.

**Tech Stack:** TypeScript (ESM), Reatom v1001 (`atom`/`computed`/`action`/`withAsyncData`/`withConnectHook`/`withChangeHook`/`wrap`), Zod v4, Temporal (global polyfill), the `ServerTime` timer (`@/shared/timer/model/server-time`) with `createFakeTimer` in tests, Vitest + jsdom.

## Global Constraints

- **Scope is `model/ofelia-duty.ts` only.** No UI changes, no new files. F4 (history read/UI), F5 (comments), F6 (tiers/toggle/buttons) are out of scope.
- **No authorization.** Either person may run any action. Every event records `actor` (domain, from duty) **and** `by` (who pressed it — read from `currentUser()` at action time).
- **Server-time first.** "today" is the model-internal `today()` computed (`timer.today(DUTY_TIME_ZONE)`, `PlainDate | null`). `getToday()` no longer exists. The four domain actions guard `if (today() == null) return;` (writes already require the server, so blocking before the first sync is correct). Pure selectors that need "today" take it as an explicit parameter (they cannot reach the model's computed).
- **Debt = stored counter** (`numberOfDebts`, source of truth, normalized so min = 0, never below 0). `numberOfDebts` is `NumberOfDebts | null` (null before its store loads); actions read it as `{ ...(numberOfDebts() ?? {}) }`. History is a separate per-week audit log.
- **History is append-only** (spec §3.3, now with **no** exceptions): the only history write is `storage.shared.server.append(...)`. Undo does **not** delete or mutate; it appends a `cancelled` event. The server stamps `id`/`ts`/`ip` (F2, already merged).
- **Undo is today-only and debt-neutral.** `undo(events)` appends a `cancelled` event for `today()` and changes nothing else; it no-ops unless today is currently `closed` (and no-ops before the first sync). F6 enables the undo button only when the selected day is today (it already reads `undoAvailable`).
- **currentUser persistence:** `storage.shared.client` (Dexie, per-device, not synced). Default `DUTY_ROTATION[0]` survives an empty store. Use hand-rolled `withConnectHook` (load via `get`, set the atom **only when a value exists**) + `withChangeHook` (persist via `set`) — **not** `withStorageKey`, because `withStorageKey` would `target.set(null)` on an empty store and null out a non-nullable `Person` atom.
- **No needless indirection** (per the user): a writable atom is its own setter — do **not** wrap `currentUser.set` / `selectedDate.set` in pass-through actions, and do **not** add a coalescing `computed`. (The merged code already sets `selectedDate` directly with no `selectDay`.) Actions are justified only when they do real work (the four domain actions; the week-nav actions, which coordinate `startOfWeekOverride`).
- **Code style (match the file being edited).** The current `ofelia-duty.ts` and its `ofelia-duty.test.ts` use **double quotes, semicolons, 2-space indent, named exports**, and **every** atom/action/computed carries an explicit `"ofeliaDuty.<name>"` for tracing. New and edited F3 code follows that local convention (this overrides AGENTS.md's single-quote/no-semicolon guidance for these two files — the server-time slice already established it; keep the file internally consistent). Use the errore/Reatom errors-as-values pattern (`const result = await wrap(storage.shared.server.append(...)); if (result instanceof Error) throw result` so `withAsyncData` captures it), never `try/catch` for control flow.
- **Before PR:** `pnpm test` and `pnpm typecheck` must pass (run from repo root).

---

## File Structure

- **Modify** `client/widgets/ofelia-poop-duty/model/ofelia-duty.ts` — add `PersonSchema`, event types (incl. `cancelled`), `DEBT_WARNING_THRESHOLD`, exported date helpers (`weekStartISO`, `historyKey`, `otherPerson`), pure selectors (`effectiveDuty`, `isDebtDay`, `isOverDebtWarning`, `getDayStatus` — `effectiveDuty`/`isDebtDay` take `today` as a parameter), inline `currentUser` atom + persistence, the four domain actions; **remove** the superseded `inDebt`/`forgiveDebt`. `today`/`startOfWeekOverride`/`viewWeekStart`/`selectedDate`/`undoAvailable`/`debtDays`/`currentWeek` already exist (server-time slice) and are left as-is.
- **Modify** `client/widgets/ofelia-poop-duty/model/ofelia-duty.test.ts` — make `createStorage` accept per-call overrides; add fakes/helpers and tests for selectors, currentUser, and each action; re-point the two existing tests that call the removed `inDebt`.

No other files change. `OfeliaPoopDuty.tsx` keeps calling `ofeliaDutyModel({ storage, timer: getServerTime() })`.

---

## Task 1: Types, constant, helpers, and pure selectors

**Files:**

- Modify: `client/widgets/ofelia-poop-duty/model/ofelia-duty.ts`
- Test: `client/widgets/ofelia-poop-duty/model/ofelia-duty.test.ts`

**Interfaces:**

- Consumes: existing `DUTY_ROTATION`, `DutyPerson`, `getOfeliaDutyByDate`, `getDebtDays` (private), `getStartOfWeek` (private). `getToday` no longer exists; selectors that need "today" take it as a parameter.
- Produces (all `export`ed unless noted):
  - `type Person = DutyPerson`
  - `type HistoryEventType = 'cleaned' | 'went_into_debt' | 'forgiven' | 'cancelled'`
  - `type HistoryEvent = { id: string; ts: number; ip: string; date: string; type: HistoryEventType; actor: Person; onBehalfOf?: Person; by: Person }`
  - `type HistoryEventDraft = Omit<HistoryEvent, 'id' | 'ts' | 'ip'>`
  - `const DEBT_WARNING_THRESHOLD = 7`
  - `const PersonSchema = z.enum(DUTY_ROTATION)` (module-private; used by Task 2)
  - `function weekStartISO(date: Temporal.PlainDate): string`
  - `function historyKey(date: Temporal.PlainDate): string` → `history:<weekStartISO>`
  - `function otherPerson(person: Person): Person`
  - `function effectiveDuty(date: Temporal.PlainDate, debts: Partial<NumberOfDebts>, today: Temporal.PlainDate): Person`
  - `function isDebtDay(date: Temporal.PlainDate, debts: Partial<NumberOfDebts>, today: Temporal.PlainDate): boolean`
  - `function isOverDebtWarning(debts: Partial<NumberOfDebts>, person: Person): boolean`
  - `function getDayStatus(events: HistoryEvent[], date: Temporal.PlainDate): 'closed' | 'pending'`

- [ ] **Step 1: Write the failing tests**

In `client/widgets/ofelia-poop-duty/model/ofelia-duty.test.ts`, extend the import from `./ofelia-duty` and add a describe block. The model tests inject the clock via `createFakeTimer`; these **pure-selector** tests don't build a model, so they pass an explicit `today` (e.g. `D("2026-06-16")` — a Tuesday whose week starts Monday `2026-06-15`).

```ts
import {
  ofeliaDutyModel,
  effectiveDuty,
  isDebtDay,
  isOverDebtWarning,
  getDayStatus,
  weekStartISO,
  historyKey,
  otherPerson,
  DEBT_WARNING_THRESHOLD,
  type HistoryEvent,
} from './ofelia-duty'

const D = (iso: string) => Temporal.PlainDate.from(iso)

const ev = (over: Partial<HistoryEvent>): HistoryEvent => ({
  id: 'id',
  ts: 0,
  ip: '0.0.0.0',
  date: '2026-06-16',
  type: 'cleaned',
  actor: 'Леша',
  by: 'Леша',
  ...over,
})

describe('ofelia-duty selectors', () => {
  it('otherPerson returns the partner', () => {
    expect(otherPerson('Леша')).toBe('Карина')
    expect(otherPerson('Карина')).toBe('Леша')
  })

  it('weekStartISO/historyKey use the Monday of the date week', () => {
    expect(weekStartISO(D('2026-06-16'))).toBe('2026-06-15')
    expect(historyKey(D('2026-06-17'))).toBe('history:2026-06-15')
  })

  it('effectiveDuty / isDebtDay reflect projected debt days', () => {
    const debts = { Леша: 0, Карина: 1 }
    const today = D('2026-06-16')
    expect(isDebtDay(D('2026-06-16'), debts, today)).toBe(true)
    expect(effectiveDuty(D('2026-06-16'), debts, today)).toBe('Карина')
    expect(isDebtDay(D('2026-06-17'), {}, today)).toBe(false)
    expect(effectiveDuty(D('2026-06-17'), {}, today)).toBe('Карина')
  })

  it('isOverDebtWarning fires strictly above the threshold', () => {
    expect(DEBT_WARNING_THRESHOLD).toBe(7)
    expect(isOverDebtWarning({ Леша: 7 }, 'Леша')).toBe(false)
    expect(isOverDebtWarning({ Леша: 8 }, 'Леша')).toBe(true)
  })

  it('getDayStatus closes on cleaned/went_into_debt and reopens on cancelled', () => {
    const date = D('2026-06-16')
    expect(getDayStatus([], date)).toBe('pending')
    expect(getDayStatus([ev({ type: 'forgiven' })], date)).toBe('pending')
    expect(getDayStatus([ev({ type: 'cleaned' })], date)).toBe('closed')
    expect(getDayStatus([ev({ type: 'went_into_debt' })], date)).toBe('closed')
    expect(
      getDayStatus([ev({ ts: 1, type: 'cleaned' }), ev({ ts: 2, type: 'cancelled' })], date),
    ).toBe('pending')
    expect(
      getDayStatus(
        [
          ev({ ts: 1, type: 'cleaned' }),
          ev({ ts: 2, type: 'cancelled' }),
          ev({ ts: 3, type: 'cleaned' }),
        ],
        date,
      ),
    ).toBe('closed')
    expect(getDayStatus([ev({ date: '2026-06-17', type: 'cleaned' })], date)).toBe('pending')
  })
})
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `pnpm --filter client test -- ofelia-duty`
Expected: FAIL — the new exports (`effectiveDuty`, `historyKey`, `getDayStatus`, …) do not exist.

- [ ] **Step 3: Write minimal implementation**

In `client/widgets/ofelia-poop-duty/model/ofelia-duty.ts`:

(a) Below `export type DutyPerson = (typeof DUTY_ROTATION)[number];` add:

```ts
export type Person = DutyPerson

export type HistoryEventType = 'cleaned' | 'went_into_debt' | 'forgiven' | 'cancelled'

export type HistoryEvent = {
  id: string
  ts: number
  ip: string
  date: string
  type: HistoryEventType
  actor: Person
  onBehalfOf?: Person
  by: Person
}

export type HistoryEventDraft = Omit<HistoryEvent, 'id' | 'ts' | 'ip'>

export const DEBT_WARNING_THRESHOLD = 7
```

(b) Next to `NumberOfDebtsSchema` add the person schema (used by Task 2):

```ts
const PersonSchema = z.enum(DUTY_ROTATION)
```

(c) No `getToday`/`getStartOfWeek` export changes: `getToday` no longer exists, and `getStartOfWeek` stays private (the new `weekStartISO` calls it within the module).

(d) At the bottom of the file (next to the other free functions) add:

```ts
export function weekStartISO(date: Temporal.PlainDate): string {
  return getStartOfWeek(date).toString()
}

export function historyKey(date: Temporal.PlainDate): string {
  return `history:${weekStartISO(date)}`
}

export function otherPerson(person: Person): Person {
  return DUTY_ROTATION.find((candidate) => candidate !== person) ?? person
}

export function effectiveDuty(
  date: Temporal.PlainDate,
  debts: Partial<NumberOfDebts>,
  today: Temporal.PlainDate,
): Person {
  const debtDay = getDebtDays(debts, today).find((day) => day.date.equals(date))
  return debtDay?.person ?? getOfeliaDutyByDate(date)
}

export function isDebtDay(
  date: Temporal.PlainDate,
  debts: Partial<NumberOfDebts>,
  today: Temporal.PlainDate,
): boolean {
  return getDebtDays(debts, today).some((day) => day.date.equals(date))
}

export function isOverDebtWarning(debts: Partial<NumberOfDebts>, person: Person): boolean {
  return (debts[person] ?? 0) > DEBT_WARNING_THRESHOLD
}

export function getDayStatus(
  events: HistoryEvent[],
  date: Temporal.PlainDate,
): 'closed' | 'pending' {
  const iso = date.toString()
  let closed = false
  for (const event of events.filter((e) => e.date === iso).sort((a, b) => a.ts - b.ts)) {
    if (event.type === 'cleaned' || event.type === 'went_into_debt') {
      closed = true
    } else if (event.type === 'cancelled') {
      closed = false
    }
  }
  return closed ? 'closed' : 'pending'
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `pnpm --filter client test -- ofelia-duty`
Expected: PASS (existing server-time tests + new selector tests).

- [ ] **Step 5: Commit**

```bash
git add client/widgets/ofelia-poop-duty/model/ofelia-duty.ts client/widgets/ofelia-poop-duty/model/ofelia-duty.test.ts
git commit -m "feat(ofelia): event types, debt threshold, and pure day/debt selectors"
```

---

## Task 2: Inline `currentUser` atom + device-local persistence

**Files:**

- Modify: `client/widgets/ofelia-poop-duty/model/ofelia-duty.ts`
- Test: `client/widgets/ofelia-poop-duty/model/ofelia-duty.test.ts`

**Interfaces:**

- Consumes: `PersonSchema` (Task 1), `storage.shared.client`, `withConnectHook`/`withChangeHook`/`wrap`.
- Produces: `ofeliaDutyModel(...)` now returns `currentUser: Atom<Person>` — a plain writable atom (default `DUTY_ROTATION[0]`), loaded from and persisted to `storage.shared.client` under key `currentUser`. No `setCurrentUser`, no computed.

- [ ] **Step 1: Write the failing tests**

The test file builds a `WidgetStorage` fake. Make it accept per-call overrides so individual tests can stub `get`/`set`/`subscribe`, and add `wrap`/`StorageApi` to the existing imports. Replace the existing `createStorage` helper with:

```ts
import { context, wrap } from '@reatom/core'
// StorageApi is already imported as a type at the top of the file.

function createStorage(overrides: Partial<StorageApi> = {}): WidgetStorage {
  const api: StorageApi = {
    get: vi.fn(async () => null),
    set: vi.fn(async () => undefined),
    delete: vi.fn(async () => undefined),
    has: vi.fn(async () => false),
    keys: vi.fn(async () => []),
    append: vi.fn(async () => undefined),
    subscribe: vi.fn(() => () => {}),
    ...overrides,
  }

  return {
    instance: { client: api, server: api },
    shared: { client: api, server: api },
  }
}
```

Add a describe block. `currentUser` does not read "today", so an unsynced `createFakeTimer()` is fine here:

```ts
describe('ofeliaDutyModel.currentUser', () => {
  it('defaults to the first roster member', () => {
    const model = ofeliaDutyModel({
      storage: createStorage(),
      timer: createFakeTimer(),
    })
    expect(model.currentUser()).toBe('Леша')
  })

  it('loads the persisted value from shared.client on connect', async () => {
    const get = vi.fn(async (key: string) => (key === 'currentUser' ? 'Карина' : null))
    const model = ofeliaDutyModel({
      storage: createStorage({ get }),
      timer: createFakeTimer(),
    })
    await context.start(async () => {
      const off = model.currentUser.subscribe(() => {})
      const check = wrap(() => expect(model.currentUser()).toBe('Карина'))
      await vi.waitFor(() => check())
      off()
    })
  })

  it('persists the selection to shared.client on change', async () => {
    const set = vi.fn(async () => undefined)
    const model = ofeliaDutyModel({
      storage: createStorage({ set }),
      timer: createFakeTimer(),
    })
    await context.start(async () => {
      const off = model.currentUser.subscribe(() => {})
      model.currentUser.set('Карина')
      const check = wrap(() =>
        expect(set.mock.calls.some((c) => c[0] === 'currentUser' && c[1] === 'Карина')).toBe(true),
      )
      await vi.waitFor(() => check())
      off()
    })
  })
})
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `pnpm --filter client test -- ofelia-duty`
Expected: FAIL — `model.currentUser` is undefined.

- [ ] **Step 3: Write minimal implementation**

(a) Extend the reatom import in `ofelia-duty.ts` (currently `{ action, atom, computed, withAsyncData }`):

```ts
import {
  action,
  atom,
  computed,
  withAsyncData,
  withChangeHook,
  withConnectHook,
  wrap,
} from '@reatom/core'
```

(b) Inside `ofeliaDutyModel`, after `numberOfDebts`, add the atom:

```ts
const currentUser = atom<Person>(DUTY_ROTATION[0], 'ofeliaDuty.currentUser').extend(
  withConnectHook(() => {
    storage.shared.client.get('currentUser', PersonSchema).then(
      wrap((value) => {
        if (value != null && !(value instanceof Error)) {
          currentUser.set(value)
        }
      }),
    )
    return () => {}
  }),
  withChangeHook((state, prevState) => {
    if (state !== prevState) {
      storage.shared.client.set('currentUser', state)
    }
  }),
)
```

(c) Add `currentUser` to the model's `return { ... }` object.

> The inferred atom type is already `Atom<Person>`, so no explicit annotation is needed.

- [ ] **Step 4: Run tests to verify they pass**

Run: `pnpm --filter client test -- ofelia-duty`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add client/widgets/ofelia-poop-duty/model/ofelia-duty.ts client/widgets/ofelia-poop-duty/model/ofelia-duty.test.ts
git commit -m "feat(ofelia): inline per-device currentUser atom"
```

---

## Task 3: Remove legacy debt actions; add the four guarded action stubs

**Files:**

- Modify: `client/widgets/ofelia-poop-duty/model/ofelia-duty.ts`
- Test: `client/widgets/ofelia-poop-duty/model/ofelia-duty.test.ts`

**Interfaces:**

- Produces: the four domain actions `confirmClean`/`goIntoDebt`/`forgive`/`undo` are added as no-op stubs (filled in Tasks 4–7) so the return shape is stable. The superseded `inDebt`/`forgiveDebt` are **removed**. `selectedDate`/`viewWeekStart`/`startOfWeekOverride`/`undoAvailable`/the week-nav actions already exist (server-time slice) and are left untouched.

> `confirmClean`/`goIntoDebt`/`forgive` take an optional `(date?: Temporal.PlainDate)` (resolved to `selectedDate() ?? today()` in Tasks 4–6); `undo` takes `(events: HistoryEvent[])`.

- [ ] **Step 1: Update the existing tests, then add the failing build**

In the existing `describe("ofeliaDutyModel server time", ...)` block:

1. In `it("returns null projections and blocks actions before the first sync", ...)`, replace the legacy call `await model.inDebt("Леша")` with `await model.goIntoDebt()` (the new guarded action; before the first sync it must no-op, leaving `{ Леша: 0, Карина: 0 }`).
2. **Remove** `it("changes the debt count when synced", ...)` entirely — it is an `inDebt`-specific test; the synced debt-change behavior is covered by Task 5's `goIntoDebt` tests.

(The `viewWeekStart`/`currentWeek`/`debtDays` null assertions, the week-nav test, and the `selectedDate`/`undoAvailable` tests stay as-is.)

- [ ] **Step 2: Run tests to verify they fail**

Run: `pnpm --filter client test -- ofelia-duty`
Expected: FAIL — `model.goIntoDebt` is undefined (and `model.inDebt` no longer exists).

- [ ] **Step 3: Write minimal implementation**

In `ofeliaDutyModel`, delete the `inDebt` and `forgiveDebt` definitions and replace them with the four stubs, then update the return:

```ts
const confirmClean = action(async (date?: Temporal.PlainDate) => {
  void date
}, 'ofeliaDuty.confirmClean').extend(withAsyncData({ status: true }))

const goIntoDebt = action(async (date?: Temporal.PlainDate) => {
  void date
}, 'ofeliaDuty.goIntoDebt').extend(withAsyncData({ status: true }))

const forgive = action(async (date?: Temporal.PlainDate) => {
  void date
}, 'ofeliaDuty.forgive').extend(withAsyncData({ status: true }))

const undo = action(async (events: HistoryEvent[]) => {
  void events
}, 'ofeliaDuty.undo').extend(withAsyncData({ status: true }))

return {
  startOfWeekOverride,
  viewWeekStart,
  goToNextWeek,
  goToPrevWeek,
  goToCurrentWeek,
  selectedDate,
  currentUser,
  numberOfDebts,
  debtDays,
  currentWeek,
  undoAvailable,
  confirmClean,
  goIntoDebt,
  forgive,
  undo,
}
```

> Keep `today`, `startOfWeekOverride`, `viewWeekStart`, the three nav actions, `selectedDate`, `hasReversibleEvent`, `undoAvailable`, `debtDays`, and `currentWeek` exactly as they are. Only `inDebt`/`forgiveDebt` are removed (and dropped from the return).

- [ ] **Step 4: Run tests + typecheck to verify green**

Run: `pnpm --filter client test -- ofelia-duty`
Expected: PASS.
Run: `pnpm typecheck`
Expected: PASS (the UI only reads `currentWeek`; it never referenced `inDebt`/`forgiveDebt`).

- [ ] **Step 5: Commit**

```bash
git add client/widgets/ofelia-poop-duty/model/ofelia-duty.ts client/widgets/ofelia-poop-duty/model/ofelia-duty.test.ts
git commit -m "feat(ofelia): drop legacy debt actions; add F3 action stubs"
```

---

## Task 4: `confirmClean(date)` — confirm cleaning

**Files:**

- Modify: `client/widgets/ofelia-poop-duty/model/ofelia-duty.ts`
- Test: `client/widgets/ofelia-poop-duty/model/ofelia-duty.test.ts`

**Interfaces:**

- Produces: `confirmClean` real body. §3.2 row 1 — on a **debt-payment day** the day's effective duty is the debtor: decrement their debt by 1 and set `onBehalfOf` = the scheduled rotation duty (creditor); on a plain day, no debt change. Always append a `cleaned` event with `actor` = effective duty, `by` = `currentUser()`, to `historyKey(target)`. Target day defaults to `selectedDate() ?? today()`; no-op before the first sync.

- [ ] **Step 1: Write the failing tests**

The model now needs a synced timer; `D` is the helper from Task 1:

```ts
describe('ofeliaDutyModel.confirmClean', () => {
  it('on a plain day appends cleaned with no debt change', async () => {
    const storage = createStorage()
    const model = ofeliaDutyModel({
      storage,
      timer: createFakeTimer({ today: D('2026-06-16') }),
    })
    model.numberOfDebts.set({ Леша: 0, Карина: 0 })
    await context.start(async () => {
      await model.confirmClean(D('2026-06-17'))
    })
    expect(model.numberOfDebts()).toEqual({ Леша: 0, Карина: 0 })
    expect(storage.shared.server.append).toHaveBeenCalledWith('history:2026-06-15', {
      date: '2026-06-17',
      type: 'cleaned',
      actor: 'Карина',
      by: 'Леша',
    })
  })

  it('on a debt-payment day decrements the debtor and records the creditor', async () => {
    const storage = createStorage()
    const model = ofeliaDutyModel({
      storage,
      timer: createFakeTimer({ today: D('2026-06-16') }),
    })
    model.numberOfDebts.set({ Леша: 0, Карина: 1 })
    model.currentUser.set('Карина')
    await context.start(async () => {
      await model.confirmClean(D('2026-06-16'))
    })
    expect(model.numberOfDebts()).toEqual({ Леша: 0, Карина: 0 })
    expect(storage.shared.server.append).toHaveBeenCalledWith('history:2026-06-15', {
      date: '2026-06-16',
      type: 'cleaned',
      actor: 'Карина',
      onBehalfOf: 'Леша',
      by: 'Карина',
    })
  })

  it('defaults the date to selectedDate (falling back to today)', async () => {
    const storage = createStorage()
    const model = ofeliaDutyModel({
      storage,
      timer: createFakeTimer({ today: D('2026-06-16') }),
    })
    model.numberOfDebts.set({ Леша: 0, Карина: 0 })
    await context.start(async () => {
      await model.confirmClean()
    })
    expect(storage.shared.server.append).toHaveBeenCalledWith(
      'history:2026-06-15',
      expect.objectContaining({ date: '2026-06-16' }),
    )
  })
})
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `pnpm --filter client test -- ofelia-duty`
Expected: FAIL — append not called (stub body).

- [ ] **Step 3: Implement `confirmClean`**

Replace the `confirmClean` stub body:

```ts
const confirmClean = action(async (date?: Temporal.PlainDate) => {
  const currentToday = today()
  if (currentToday == null) return
  const target = date ?? selectedDate() ?? currentToday

  const debts = { ...(numberOfDebts() ?? {}) }
  const debtDay = getDebtDays(debts, currentToday).find((day) => day.date.equals(target))
  const actor = debtDay?.person ?? getOfeliaDutyByDate(target)

  const draft: HistoryEventDraft = {
    date: target.toString(),
    type: 'cleaned',
    actor,
    by: currentUser(),
    ...(debtDay ? { onBehalfOf: getOfeliaDutyByDate(target) } : {}),
  }

  if (debtDay) {
    debts[actor] = Math.max((debts[actor] ?? 0) - 1, 0)
    numberOfDebts.set(normalizeDebts(debts))
  }

  const result = await wrap(storage.shared.server.append(historyKey(target), draft))
  if (result instanceof Error) throw result
}, 'ofeliaDuty.confirmClean').extend(withAsyncData({ status: true }))
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `pnpm --filter client test -- ofelia-duty`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add client/widgets/ofelia-poop-duty/model/ofelia-duty.ts client/widgets/ofelia-poop-duty/model/ofelia-duty.test.ts
git commit -m "feat(ofelia): confirmClean action with debt-payment handling"
```

---

## Task 5: `goIntoDebt(date)` — go into debt

**Files:**

- Modify: `client/widgets/ofelia-poop-duty/model/ofelia-duty.ts`
- Test: `client/widgets/ofelia-poop-duty/model/ofelia-duty.test.ts`

**Interfaces:**

- Produces: `goIntoDebt` real body. §3.2 row 2 — the day's effective duty `duty` gains `+1` (someone else cleaned). Append `went_into_debt` with `actor` = `otherPerson(duty)`, `onBehalfOf` = `duty`, `by` = `currentUser()`. Target day defaults to `selectedDate() ?? today()`; no-op before the first sync.

- [ ] **Step 1: Write the failing tests**

```ts
describe('ofeliaDutyModel.goIntoDebt', () => {
  it('adds a debt to the day duty and records who covered', async () => {
    const storage = createStorage()
    const model = ofeliaDutyModel({
      storage,
      timer: createFakeTimer({ today: D('2026-06-16') }),
    })
    model.numberOfDebts.set({ Леша: 0, Карина: 0 })
    model.currentUser.set('Карина')
    await context.start(async () => {
      await model.goIntoDebt(D('2026-06-16'))
    })
    expect(model.numberOfDebts()).toEqual({ Леша: 1, Карина: 0 })
    expect(storage.shared.server.append).toHaveBeenCalledWith('history:2026-06-15', {
      date: '2026-06-16',
      type: 'went_into_debt',
      actor: 'Карина',
      onBehalfOf: 'Леша',
      by: 'Карина',
    })
  })
})
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `pnpm --filter client test -- ofelia-duty`
Expected: FAIL — debt stays `{0,0}`, append not called.

- [ ] **Step 3: Implement `goIntoDebt`**

Replace the `goIntoDebt` stub body:

```ts
const goIntoDebt = action(async (date?: Temporal.PlainDate) => {
  const currentToday = today()
  if (currentToday == null) return
  const target = date ?? selectedDate() ?? currentToday

  const debts = { ...(numberOfDebts() ?? {}) }
  const debtDay = getDebtDays(debts, currentToday).find((day) => day.date.equals(target))
  const duty = debtDay?.person ?? getOfeliaDutyByDate(target)
  const cleaner = otherPerson(duty)

  debts[duty] = (debts[duty] ?? 0) + 1
  numberOfDebts.set(normalizeDebts(debts))

  const result = await wrap(
    storage.shared.server.append(historyKey(target), {
      date: target.toString(),
      type: 'went_into_debt',
      actor: cleaner,
      onBehalfOf: duty,
      by: currentUser(),
    }),
  )
  if (result instanceof Error) throw result
}, 'ofeliaDuty.goIntoDebt').extend(withAsyncData({ status: true }))
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `pnpm --filter client test -- ofelia-duty`
Expected: PASS (including the "blocks actions before the first sync" guard from Task 3, now backed by the real `today() == null` guard).

- [ ] **Step 5: Commit**

```bash
git add client/widgets/ofelia-poop-duty/model/ofelia-duty.ts client/widgets/ofelia-poop-duty/model/ofelia-duty.test.ts
git commit -m "feat(ofelia): goIntoDebt action"
```

---

## Task 6: `forgive(date)` — forgive a debt

**Files:**

- Modify: `client/widgets/ofelia-poop-duty/model/ofelia-duty.ts`
- Test: `client/widgets/ofelia-poop-duty/model/ofelia-duty.test.ts`

**Interfaces:**

- Produces: `forgive` real body. §3.2 row 3 — find the current debtor (the unique person with debt > 0 after normalization), decrement by 1 (floor 0). Append `forgiven` with `actor` = `otherPerson(debtor)` (creditor), `onBehalfOf` = `debtor`, `by` = `currentUser()`. No debtor ⇒ no-op (no debt change, no event). Also no-op before the first sync. Target day defaults to `selectedDate() ?? today()`.

- [ ] **Step 1: Write the failing tests**

```ts
describe('ofeliaDutyModel.forgive', () => {
  it('decrements the debtor and records the forgiver', async () => {
    const storage = createStorage()
    const model = ofeliaDutyModel({
      storage,
      timer: createFakeTimer({ today: D('2026-06-16') }),
    })
    model.numberOfDebts.set({ Леша: 1, Карина: 0 })
    model.currentUser.set('Карина')
    await context.start(async () => {
      await model.forgive(D('2026-06-16'))
    })
    expect(model.numberOfDebts()).toEqual({ Леша: 0, Карина: 0 })
    expect(storage.shared.server.append).toHaveBeenCalledWith('history:2026-06-15', {
      date: '2026-06-16',
      type: 'forgiven',
      actor: 'Карина',
      onBehalfOf: 'Леша',
      by: 'Карина',
    })
  })

  it('is a no-op when nobody owes', async () => {
    const storage = createStorage()
    const model = ofeliaDutyModel({
      storage,
      timer: createFakeTimer({ today: D('2026-06-16') }),
    })
    model.numberOfDebts.set({ Леша: 0, Карина: 0 })
    await context.start(async () => {
      await model.forgive(D('2026-06-16'))
    })
    expect(model.numberOfDebts()).toEqual({ Леша: 0, Карина: 0 })
    expect(storage.shared.server.append).not.toHaveBeenCalled()
  })
})
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `pnpm --filter client test -- ofelia-duty`
Expected: FAIL — no event appended.

- [ ] **Step 3: Implement `forgive`**

Replace the `forgive` stub body:

```ts
const forgive = action(async (date?: Temporal.PlainDate) => {
  const currentToday = today()
  if (currentToday == null) return
  const target = date ?? selectedDate() ?? currentToday

  const debts = { ...(numberOfDebts() ?? {}) }
  const debtor = DUTY_ROTATION.find((person) => (debts[person] ?? 0) > 0)
  if (!debtor) return
  const forgiver = otherPerson(debtor)

  debts[debtor] = Math.max((debts[debtor] ?? 0) - 1, 0)
  numberOfDebts.set(normalizeDebts(debts))

  const result = await wrap(
    storage.shared.server.append(historyKey(target), {
      date: target.toString(),
      type: 'forgiven',
      actor: forgiver,
      onBehalfOf: debtor,
      by: currentUser(),
    }),
  )
  if (result instanceof Error) throw result
}, 'ofeliaDuty.forgive').extend(withAsyncData({ status: true }))
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `pnpm --filter client test -- ofelia-duty`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add client/widgets/ofelia-poop-duty/model/ofelia-duty.ts client/widgets/ofelia-poop-duty/model/ofelia-duty.test.ts
git commit -m "feat(ofelia): forgive action"
```

---

## Task 7: `undo(events)` — append a cancellation for today

**Files:**

- Modify: `client/widgets/ofelia-poop-duty/model/ofelia-duty.ts`
- Test: `client/widgets/ofelia-poop-duty/model/ofelia-duty.test.ts`

**Interfaces:**

- Consumes: `getDayStatus`, `effectiveDuty`, `historyKey`, `currentUser`, `numberOfDebts`, the model-internal `today()`.
- Produces: `undo` real body. Today-only and debt-neutral. Given the viewed week's `events`, if `today() != null` and `getDayStatus(events, today())` is `closed`, append a `cancelled` event for today (`actor` = `effectiveDuty(today, debts, today)`, `by` = `currentUser()`); otherwise no-op. **Debt is not changed.**

> F6 enables the undo button only when the selected day is today (via `undoAvailable`), so `events` always contains today's events when `undo` runs. `undo` does not take a date — it always targets `today()`.

- [ ] **Step 1: Write the failing tests**

```ts
describe('ofeliaDutyModel.undo', () => {
  it('appends a cancellation for today without changing debt', async () => {
    const storage = createStorage()
    const model = ofeliaDutyModel({
      storage,
      timer: createFakeTimer({ today: D('2026-06-16') }),
    })
    model.numberOfDebts.set({ Леша: 0, Карина: 0 })
    const events: HistoryEvent[] = [
      {
        id: 'e1',
        ts: 1,
        ip: 'x',
        date: '2026-06-16',
        type: 'cleaned',
        actor: 'Леша',
        by: 'Леша',
      },
    ]
    await context.start(async () => {
      await model.undo(events)
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
    const storage = createStorage()
    const model = ofeliaDutyModel({
      storage,
      timer: createFakeTimer({ today: D('2026-06-16') }),
    })
    model.numberOfDebts.set({ Леша: 0, Карина: 0 })
    await context.start(async () => {
      await model.undo([])
    })
    expect(storage.shared.server.append).not.toHaveBeenCalled()
  })
})
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `pnpm --filter client test -- ofelia-duty`
Expected: FAIL — append not called (stub body).

- [ ] **Step 3: Implement `undo`**

Replace the `undo` stub body:

```ts
const undo = action(async (events: HistoryEvent[]) => {
  const currentToday = today()
  if (currentToday == null) return
  if (getDayStatus(events, currentToday) !== 'closed') return

  const result = await wrap(
    storage.shared.server.append(historyKey(currentToday), {
      date: currentToday.toString(),
      type: 'cancelled',
      actor: effectiveDuty(currentToday, numberOfDebts() ?? {}, currentToday),
      by: currentUser(),
    }),
  )
  if (result instanceof Error) throw result
}, 'ofeliaDuty.undo').extend(withAsyncData({ status: true }))
```

- [ ] **Step 4: Run full client suite + typecheck**

Run: `pnpm --filter client test -- ofelia-duty`
Expected: PASS.
Run: `pnpm test`
Expected: PASS (whole monorepo).
Run: `pnpm typecheck`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add client/widgets/ofelia-poop-duty/model/ofelia-duty.ts client/widgets/ofelia-poop-duty/model/ofelia-duty.test.ts
git commit -m "feat(ofelia): undo appends a today-only cancellation event"
```

---

## Self-Review (run against the spec + brainstorm decisions)

**1. Coverage:**

- currentUser inline atom, device-local persist, default `DUTY_ROTATION[0]`, no action/computed/separate model → Task 2. ✅
- `confirmClean`/`goIntoDebt`/`forgive` over a target date defaulting to `selectedDate() ?? today()`, guarded before first sync, writing `date` + `by = currentUser()` per §3.2 → Tasks 4–6. ✅
- Undo v1: today-only, append `cancelled`, debt-neutral, reopen-to-pending via `getDayStatus`, no-op before first sync → Tasks 1 (selector) + 7 (action). ✅
- Debt counter as source of truth, normalization + floor 0, `DEBT_WARNING_THRESHOLD` soft warning → Tasks 1, 4–6. ✅
- History written directly via `storage.shared.server.append`; no `HistoryPort` → Tasks 4–7. ✅
- Builds on the server-time slice without re-adding it: `today`/`selectedDate`/`viewWeekStart`/`undoAvailable` are consumed, not redefined; the four actions adopt the existing `today() == null` guard pattern. ✅

**2. Placeholders:** none. The Task 3 action stubs are explicit no-ops filled in Tasks 4–7 (each independently green). `hasReversibleEvent` (server-time slice) stays a `() => true` placeholder owned by F4 — F3 does not touch it.

**3. Type/name consistency:** `Person`/`DutyPerson`, `HistoryEvent`/`HistoryEventDraft`, `historyKey`/`weekStartISO`, `effectiveDuty`/`isDebtDay`/`getDayStatus`/`isOverDebtWarning` (`effectiveDuty`/`isDebtDay` now take a `today` parameter), factory return members (`currentUser`, the four actions, plus the existing `selectedDate`/`viewWeekStart`/`undoAvailable`/…) are consistent across tasks. Factory signature stays `ofeliaDutyModel({ storage, timer })`. Every atom/action/computed carries an `"ofeliaDuty.<name>"`.

**Spec deltas recorded (apply to the spec doc separately if desired):**

- **Drop contract §4.5 (HistoryPort).** Actions append to storage directly.
- **Simplify §4.6 (currentUser):** a writable `Atom<Person>` inside `ofeliaDutyModel`, device-local persistence via hand-rolled connect/change hooks (not `withStorageKey`), no action/computed.
- **Change §3.2 undo:** append-only `cancelled` event, **no** debt reversal, **today-only**; §3.3 append-only now holds with no exceptions. A cancelled day reopens to `pending`.
- `HistoryEventType` gains `cancelled`.
- **Server-time alignment:** "today" is timer-derived and nullable; the four actions no-op before the first sync; the target day resolves through the nullable `selectedDate` (`selectedDate() ?? today()`). `getToday()` is removed; `effectiveDuty`/`isDebtDay` take `today` as a parameter.

---

## Execution Handoff

Plan complete and saved to `docs/superpowers/plans/2026-06-20-ofelia-f3-actions-and-debt.md` (rebased onto the merged server-time slice). Two execution options:

**1. Subagent-Driven (recommended)** — dispatch a fresh subagent per task, review between tasks, fast iteration.

**2. Inline Execution** — execute tasks in this session using executing-plans, batch execution with checkpoints.

Which approach?
