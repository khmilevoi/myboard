# F3 — Actions & Debt (Ofelia model) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Extend the Ofelia model so it applies **confirm / go-into-debt / forgive / undo** to a selected day, keeps the debt counter per spec §3.2, writes an attributed per-week history log, and exposes the global **current user** ("кто я") persisted per-device.

**Architecture:** Everything lands in the existing `model/ofelia-duty.ts` — no new model files. `currentUser` is a plain writable atom **inside** `ofeliaDutyModel`, persisted device-local with connect/change hooks (no action, no computed, no separate model). `selectedDate` is a plain writable atom (set directly; week-navigation actions reset it). Debt stays a **stored counter** (`numberOfDebts`); the history log is written **directly** via `storage.shared.server.append(historyKey(date), draft)` (no `HistoryPort`). Day status is a **pure selector** over the week's events. **Undo is v1-simplified:** it appends a `cancelled` event for **today only** and does **not** change debt; a cancelled day reopens to *pending*. The widget UI is untouched (F6 wires buttons later); the factory signature stays `ofeliaDutyModel({ storage })`.

**Tech Stack:** TypeScript (ESM), Reatom v1001 (`atom`/`computed`/`action`/`withAsyncData`/`withConnectHook`/`withChangeHook`/`wrap`), Zod v4, Temporal (global polyfill), Vitest + jsdom.

## Global Constraints

- **Scope is `model/ofelia-duty.ts` only.** No UI changes, no new files. F4 (history read/UI), F5 (comments), F6 (tiers/toggle/buttons) are out of scope.
- **No authorization.** Either person may run any action. Every event records `actor` (domain, from duty) **and** `by` (who pressed it — read from `currentUser()` at action time).
- **Debt = stored counter** (`numberOfDebts`, source of truth, normalized so min = 0, never below 0). History is a separate per-week audit log.
- **History is append-only** (spec §3.3, now with **no** exceptions): the only history write is `storage.shared.server.append(...)`. Undo does **not** delete or mutate; it appends a `cancelled` event. The server stamps `id`/`ts`/`ip` (F2, already merged).
- **Undo is today-only and debt-neutral.** `undo(events)` appends a `cancelled` event for `getToday()` and changes nothing else; it no-ops unless today is currently `closed`. F6 enables the undo button only when the selected day is today.
- **currentUser persistence:** `storage.shared.client` (Dexie, per-device, not synced). Default `DUTY_ROTATION[0]` survives an empty store (load sets the atom only when a value exists).
- **No needless indirection** (per the user): a writable atom is its own setter — do **not** wrap `currentUser.set` / `selectedDate.set` in pass-through actions, and do **not** add a coalescing `computed`. Actions are justified only when they do real work (the four domain actions; the week-nav actions, which coordinate two atoms).
- **Code style (AGENTS.md is authoritative — there is no Prettier/ESLint config):** 2-space indentation, **single quotes, no semicolons**, named exports, ESM imports, `@/…` alias for `client/src` in source; relative imports in tests. Reatom atoms/actions/computeds created **without** explicit names (match the file). Use the errore/Reatom errors-as-values pattern (await the storage call, `if (result instanceof Error) throw result` so `withAsyncData` captures it), never `try/catch` for control flow.
- **Legacy style note:** the existing `ofelia-duty.ts` lines use double quotes + semicolons. New and edited code follows AGENTS.md (single quotes, no semicolons); leave untouched legacy lines as they are.
- **Before PR:** `pnpm test` and `pnpm typecheck` must pass (run from repo root).

---

## File Structure

- **Modify** `client/widgets/ofelia-poop-duty/model/ofelia-duty.ts` — add `PersonSchema`, event types (incl. `cancelled`), `DEBT_WARNING_THRESHOLD`, exported date helpers (`getToday`, `getStartOfWeek`, `weekStartISO`, `historyKey`, `otherPerson`), pure selectors (`effectiveDuty`, `isDebtDay`, `isOverDebtWarning`, `getDayStatus`), inline `currentUser` atom + persistence, `selectedDate` atom + nav coordination, the four domain actions; remove the superseded `inDebt`/`forgiveDebt`.
- **Modify** `client/widgets/ofelia-poop-duty/model/ofelia-duty.test.ts` — add fakes/helpers and tests for selectors, currentUser, selectedDate/nav, and each action.

No other files change. `OfeliaPoopDuty.tsx` keeps calling `ofeliaDutyModel({ storage })`.

---

## Task 1: Types, constant, helpers, and pure selectors

**Files:**
- Modify: `client/widgets/ofelia-poop-duty/model/ofelia-duty.ts`
- Test: `client/widgets/ofelia-poop-duty/model/ofelia-duty.test.ts`

**Interfaces:**
- Consumes: existing `DUTY_ROTATION`, `DutyPerson`, `getOfeliaDutyByDate`, `getDebtDays` (private), the private `getToday`/`getStartOfWeek` (now exported).
- Produces (all `export`ed):
  - `type Person = DutyPerson`
  - `type HistoryEventType = 'cleaned' | 'went_into_debt' | 'forgiven' | 'cancelled'`
  - `type HistoryEvent = { id: string; ts: number; ip: string; date: string; type: HistoryEventType; actor: Person; onBehalfOf?: Person; by: Person }`
  - `type HistoryEventDraft = Omit<HistoryEvent, 'id' | 'ts' | 'ip'>`
  - `const DEBT_WARNING_THRESHOLD = 7`
  - `function getToday(): Temporal.PlainDate` (was private)
  - `function getStartOfWeek(date: Temporal.PlainDate): Temporal.PlainDate` (was private)
  - `function weekStartISO(date: Temporal.PlainDate): string`
  - `function historyKey(date: Temporal.PlainDate): string` → `history:<weekStartISO>`
  - `function otherPerson(person: Person): Person`
  - `function effectiveDuty(date: Temporal.PlainDate, debts: Partial<NumberOfDebts>): Person`
  - `function isDebtDay(date: Temporal.PlainDate, debts: Partial<NumberOfDebts>): boolean`
  - `function isOverDebtWarning(debts: Partial<NumberOfDebts>, person: Person): boolean`
  - `function getDayStatus(events: HistoryEvent[], date: Temporal.PlainDate): 'closed' | 'pending'`

- [ ] **Step 1: Write the failing tests**

In `client/widgets/ofelia-poop-duty/model/ofelia-duty.test.ts`, extend the import from `./ofelia-duty` and add a describe block. (The file already fakes the clock to `2026-06-16T10:00:00.000Z`, so `getToday()` is `2026-06-16` and its week starts Monday `2026-06-15`.)

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
    expect(isDebtDay(D('2026-06-16'), debts)).toBe(true)
    expect(effectiveDuty(D('2026-06-16'), debts)).toBe('Карина')
    expect(isDebtDay(D('2026-06-17'), {})).toBe(false)
    expect(effectiveDuty(D('2026-06-17'), {})).toBe('Карина')
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

(c) Add `export` to the existing `getToday` and `getStartOfWeek` function declarations.

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
): Person {
  const debtDay = getDebtDays(debts, getToday()).find((day) => day.date.equals(date))
  return debtDay?.person ?? getOfeliaDutyByDate(date)
}

export function isDebtDay(
  date: Temporal.PlainDate,
  debts: Partial<NumberOfDebts>,
): boolean {
  return getDebtDays(debts, getToday()).some((day) => day.date.equals(date))
}

export function isOverDebtWarning(
  debts: Partial<NumberOfDebts>,
  person: Person,
): boolean {
  return (debts[person] ?? 0) > DEBT_WARNING_THRESHOLD
}

export function getDayStatus(
  events: HistoryEvent[],
  date: Temporal.PlainDate,
): 'closed' | 'pending' {
  const iso = date.toString()
  let closed = false
  for (const event of events.filter((e) => e.date === iso).sort((a, b) => a.ts - b.ts)) {
    if (event.type === 'cleaned' || event.type === 'went_into_debt') closed = true
    else if (event.type === 'cancelled') closed = false
  }
  return closed ? 'closed' : 'pending'
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `pnpm --filter client test -- ofelia-duty`
Expected: PASS (existing test + new selector tests).

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

The test file already builds a `WidgetStorage` fake. Make it accept per-call overrides so individual tests can stub `get`/`set`/`subscribe`. Replace the existing `createStorage` helper with:

```ts
import { context, wrap } from '@reatom/core'

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

Add a describe block:

```ts
describe('ofeliaDutyModel.currentUser', () => {
  it('defaults to the first roster member', () => {
    const model = ofeliaDutyModel({ storage: createStorage() })
    expect(model.currentUser()).toBe('Леша')
  })

  it('loads the persisted value from shared.client on connect', async () => {
    const get = vi.fn(async (key: string) => (key === 'currentUser' ? 'Карина' : null))
    const model = ofeliaDutyModel({ storage: createStorage({ get }) })
    await context.start(async () => {
      const off = model.currentUser.subscribe(() => {})
      const check = wrap(() => expect(model.currentUser()).toBe('Карина'))
      await vi.waitFor(() => check())
      off()
    })
  })

  it('persists the selection to shared.client on change', async () => {
    const set = vi.fn(async () => undefined)
    const model = ofeliaDutyModel({ storage: createStorage({ set }) })
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

(a) Extend the reatom import in `ofelia-duty.ts`:

```ts
import { Atom, action, atom, computed, withAsyncData, withChangeHook, withConnectHook, wrap } from '@reatom/core'
```

(b) Inside `ofeliaDutyModel`, after `numberOfDebts`, add the atom:

```ts
const currentUser = atom<Person>(DUTY_ROTATION[0]).extend(
  withConnectHook(() => {
    storage.shared.client.get('currentUser', PersonSchema).then(
      wrap((value) => {
        if (value != null && !(value instanceof Error)) currentUser.set(value)
      }),
    )
    return () => {}
  }),
  withChangeHook((state, prevState) => {
    if (state !== prevState) storage.shared.client.set('currentUser', state)
  }),
)
```

(c) Add `currentUser` to the model's `return { ... }` object.

> `Atom` is imported for the `currentUser: Atom<Person>` type if you annotate it; the inferred type already is `Atom<Person>`, so the explicit annotation is optional.

- [ ] **Step 4: Run tests to verify they pass**

Run: `pnpm --filter client test -- ofelia-duty`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add client/widgets/ofelia-poop-duty/model/ofelia-duty.ts client/widgets/ofelia-poop-duty/model/ofelia-duty.test.ts
git commit -m "feat(ofelia): inline per-device currentUser atom"
```

---

## Task 3: `selectedDate` + week-nav coordination; action stubs

**Files:**
- Modify: `client/widgets/ofelia-poop-duty/model/ofelia-duty.ts`
- Test: `client/widgets/ofelia-poop-duty/model/ofelia-duty.test.ts`

**Interfaces:**
- Produces: `ofeliaDutyModel(...)` returns `selectedDate: Atom<Temporal.PlainDate>` (plain writable atom, default today; set directly — no `selectDay`), and the nav actions `goToNextWeek`/`goToPrevWeek`/`goToCurrentWeek` now also reset `selectedDate` (today if landing on the current week, else that week's Monday). The four domain actions `confirmClean`/`goIntoDebt`/`forgive`/`undo` are added as no-op stubs (filled in Tasks 4–7) so the return shape is stable. The superseded `inDebt`/`forgiveDebt` are **removed**.

> The stubs keep every task's build green. `confirmClean`/`goIntoDebt`/`forgive` take `(date = selectedDate())`; `undo` takes `(events: HistoryEvent[])`.

- [ ] **Step 1: Write the failing tests**

```ts
describe('ofeliaDutyModel selected day + navigation', () => {
  it('defaults selectedDate to today', () => {
    const model = ofeliaDutyModel({ storage: createStorage() })
    expect(model.selectedDate().toString()).toBe('2026-06-16')
  })

  it('navigating to another week selects that week Monday; back to current selects today', async () => {
    const model = ofeliaDutyModel({ storage: createStorage() })
    await context.start(async () => {
      await model.goToNextWeek()
    })
    expect(model.startOfWeek().toString()).toBe('2026-06-22')
    expect(model.selectedDate().toString()).toBe('2026-06-22')

    await context.start(async () => {
      await model.goToCurrentWeek()
    })
    expect(model.selectedDate().toString()).toBe('2026-06-16')
  })
})
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `pnpm --filter client test -- ofelia-duty`
Expected: FAIL — `model.selectedDate` is undefined.

- [ ] **Step 3: Write minimal implementation**

In `ofeliaDutyModel`, after `startOfWeek`, add `selectedDate` and the sync helper, replace the three nav actions, add the stubs, remove `inDebt`/`forgiveDebt`, and update the return:

```ts
const selectedDate = atom<Temporal.PlainDate>(getToday())

function syncSelectedToWeek(weekStart: Temporal.PlainDate) {
  const today = getToday()
  selectedDate.set(weekStart.equals(getStartOfWeek(today)) ? today : weekStart)
}

const goToNextWeek = action(() => {
  const next = startOfWeek().add({ days: 7 })
  startOfWeek.set(next)
  syncSelectedToWeek(next)
})

const goToPrevWeek = action(() => {
  const prev = startOfWeek().subtract({ days: 7 })
  startOfWeek.set(prev)
  syncSelectedToWeek(prev)
})

const goToCurrentWeek = action(() => {
  const current = getStartOfWeek(getToday())
  startOfWeek.set(current)
  syncSelectedToWeek(current)
})

// ... keep `debtDays` and `currentWeek` computeds unchanged ...

const confirmClean = action(async (date: Temporal.PlainDate = selectedDate()) => {
  void date
}).extend(withAsyncData({ status: true }))

const goIntoDebt = action(async (date: Temporal.PlainDate = selectedDate()) => {
  void date
}).extend(withAsyncData({ status: true }))

const forgive = action(async (date: Temporal.PlainDate = selectedDate()) => {
  void date
}).extend(withAsyncData({ status: true }))

const undo = action(async (events: HistoryEvent[]) => {
  void events
}).extend(withAsyncData({ status: true }))

return {
  startOfWeek,
  selectedDate,
  currentUser,
  goToNextWeek,
  goToPrevWeek,
  goToCurrentWeek,
  numberOfDebts,
  currentWeek,
  confirmClean,
  goIntoDebt,
  forgive,
  undo,
}
```

> Keep the existing `debtDays` and `currentWeek` computed blocks exactly as they are. Delete the old `inDebt` and `forgiveDebt` definitions.

- [ ] **Step 4: Run tests + typecheck to verify green**

Run: `pnpm --filter client test -- ofelia-duty`
Expected: PASS.
Run: `pnpm typecheck`
Expected: PASS (UI still compiles against `ofeliaDutyModel({ storage })`).

- [ ] **Step 5: Commit**

```bash
git add client/widgets/ofelia-poop-duty/model/ofelia-duty.ts client/widgets/ofelia-poop-duty/model/ofelia-duty.test.ts
git commit -m "feat(ofelia): selected day + week-nav coordination; drop legacy debt actions"
```

---

## Task 4: `confirmClean(date)` — confirm cleaning

**Files:**
- Modify: `client/widgets/ofelia-poop-duty/model/ofelia-duty.ts`
- Test: `client/widgets/ofelia-poop-duty/model/ofelia-duty.test.ts`

**Interfaces:**
- Produces: `confirmClean` real body. §3.2 row 1 — on a **debt-payment day** the day's effective duty is the debtor: decrement their debt by 1 and set `onBehalfOf` = the scheduled rotation duty (creditor); on a plain day, no debt change. Always append a `cleaned` event with `actor` = effective duty, `by` = `currentUser()`, to `historyKey(date)`.

- [ ] **Step 1: Write the failing tests**

```ts
describe('ofeliaDutyModel.confirmClean', () => {
  it('on a plain day appends cleaned with no debt change', async () => {
    const storage = createStorage()
    const model = ofeliaDutyModel({ storage })
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
    const model = ofeliaDutyModel({ storage })
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

  it('defaults the date to selectedDate', async () => {
    const storage = createStorage()
    const model = ofeliaDutyModel({ storage })
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
const confirmClean = action(async (date: Temporal.PlainDate = selectedDate()) => {
  const debts = { ...(numberOfDebts() ?? {}) }
  const debtDay = getDebtDays(debts, getToday()).find((day) => day.date.equals(date))
  const actor = debtDay?.person ?? getOfeliaDutyByDate(date)

  const draft: HistoryEventDraft = {
    date: date.toString(),
    type: 'cleaned',
    actor,
    by: currentUser(),
    ...(debtDay ? { onBehalfOf: getOfeliaDutyByDate(date) } : {}),
  }

  if (debtDay) {
    debts[actor] = Math.max((debts[actor] ?? 0) - 1, 0)
    numberOfDebts.set(normalizeDebts(debts))
  }

  const result = await storage.shared.server.append(historyKey(date), draft)
  if (result instanceof Error) throw result
}).extend(withAsyncData({ status: true }))
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
- Produces: `goIntoDebt` real body. §3.2 row 2 — the day's effective duty `duty` gains `+1` (someone else cleaned). Append `went_into_debt` with `actor` = `otherPerson(duty)`, `onBehalfOf` = `duty`, `by` = `currentUser()`.

- [ ] **Step 1: Write the failing tests**

```ts
describe('ofeliaDutyModel.goIntoDebt', () => {
  it('adds a debt to the day duty and records who covered', async () => {
    const storage = createStorage()
    const model = ofeliaDutyModel({ storage })
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
const goIntoDebt = action(async (date: Temporal.PlainDate = selectedDate()) => {
  const debts = { ...(numberOfDebts() ?? {}) }
  const debtDay = getDebtDays(debts, getToday()).find((day) => day.date.equals(date))
  const duty = debtDay?.person ?? getOfeliaDutyByDate(date)
  const cleaner = otherPerson(duty)

  debts[duty] = (debts[duty] ?? 0) + 1
  numberOfDebts.set(normalizeDebts(debts))

  const result = await storage.shared.server.append(historyKey(date), {
    date: date.toString(),
    type: 'went_into_debt',
    actor: cleaner,
    onBehalfOf: duty,
    by: currentUser(),
  })
  if (result instanceof Error) throw result
}).extend(withAsyncData({ status: true }))
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `pnpm --filter client test -- ofelia-duty`
Expected: PASS.

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
- Produces: `forgive` real body. §3.2 row 3 — find the current debtor (the unique person with debt > 0 after normalization), decrement by 1 (floor 0). Append `forgiven` with `actor` = `otherPerson(debtor)` (creditor), `onBehalfOf` = `debtor`, `by` = `currentUser()`. No debtor ⇒ no-op (no debt change, no event).

- [ ] **Step 1: Write the failing tests**

```ts
describe('ofeliaDutyModel.forgive', () => {
  it('decrements the debtor and records the forgiver', async () => {
    const storage = createStorage()
    const model = ofeliaDutyModel({ storage })
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
    const model = ofeliaDutyModel({ storage })
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
const forgive = action(async (date: Temporal.PlainDate = selectedDate()) => {
  const debts = { ...(numberOfDebts() ?? {}) }
  const debtor = DUTY_ROTATION.find((person) => (debts[person] ?? 0) > 0)
  if (!debtor) return
  const forgiver = otherPerson(debtor)

  debts[debtor] = Math.max((debts[debtor] ?? 0) - 1, 0)
  numberOfDebts.set(normalizeDebts(debts))

  const result = await storage.shared.server.append(historyKey(date), {
    date: date.toString(),
    type: 'forgiven',
    actor: forgiver,
    onBehalfOf: debtor,
    by: currentUser(),
  })
  if (result instanceof Error) throw result
}).extend(withAsyncData({ status: true }))
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
- Consumes: `getDayStatus`, `effectiveDuty`, `historyKey`, `currentUser`, `numberOfDebts`.
- Produces: `undo` real body. Today-only and debt-neutral. Given the viewed week's `events`, if `getDayStatus(events, today)` is `closed`, append a `cancelled` event for today (`actor` = `effectiveDuty(today, debts)`, `by` = `currentUser()`); otherwise no-op. **Debt is not changed.**

> F6 enables the undo button only when the selected day is today, so `events` always contains today's events when `undo` runs. `undo` does not take a date — it always targets `getToday()`.

- [ ] **Step 1: Write the failing tests**

```ts
describe('ofeliaDutyModel.undo', () => {
  it('appends a cancellation for today without changing debt', async () => {
    const storage = createStorage()
    const model = ofeliaDutyModel({ storage })
    model.numberOfDebts.set({ Леша: 0, Карина: 0 })
    const events: HistoryEvent[] = [
      { id: 'e1', ts: 1, ip: 'x', date: '2026-06-16', type: 'cleaned', actor: 'Леша', by: 'Леша' },
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
    const model = ofeliaDutyModel({ storage })
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
  const today = getToday()
  if (getDayStatus(events, today) !== 'closed') return

  const result = await storage.shared.server.append(historyKey(today), {
    date: today.toString(),
    type: 'cancelled',
    actor: effectiveDuty(today, numberOfDebts() ?? {}),
    by: currentUser(),
  })
  if (result instanceof Error) throw result
}).extend(withAsyncData({ status: true }))
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
- `selectedDate` atom (set directly, no `selectDay`) + week-switch reconciliation (§3.1.1) → Task 3. ✅
- `confirmClean`/`goIntoDebt`/`forgive` over a target date defaulting to `selectedDate()`, writing `date` + `by = currentUser()` per §3.2 → Tasks 4–6. ✅
- Undo v1: today-only, append `cancelled`, debt-neutral, reopen-to-pending via `getDayStatus` → Tasks 1 (selector) + 7 (action). ✅
- Debt counter as source of truth, normalization + floor 0, `DEBT_WARNING_THRESHOLD` soft warning → Tasks 1, 4–6. ✅
- History written directly via `storage.shared.server.append`; no `HistoryPort` → Tasks 4–7. ✅

**2. Placeholders:** none. The Task 3 action stubs are explicit no-ops filled in Tasks 4–7 (each independently green).

**3. Type/name consistency:** `Person`/`DutyPerson`, `HistoryEvent`/`HistoryEventDraft`, `historyKey`/`weekStartISO`, `effectiveDuty`/`isDebtDay`/`getDayStatus`/`isOverDebtWarning`, factory return members (`currentUser`, `selectedDate`, the four actions) are consistent across tasks. Factory signature stays `ofeliaDutyModel({ storage })`.

**Spec deltas recorded (apply to the spec doc separately if desired):**
- **Drop contract §4.5 (HistoryPort).** Actions append to storage directly.
- **Simplify §4.6 (currentUser):** a writable `Atom<Person>` inside `ofeliaDutyModel`, device-local persistence, no action/computed.
- **Change §3.2 undo:** append-only `cancelled` event, **no** debt reversal, **today-only**; §3.3 append-only now holds with no exceptions. A cancelled day reopens to `pending`.
- `HistoryEventType` gains `cancelled`.

---

## Execution Handoff

Plan complete and saved to `docs/superpowers/plans/2026-06-20-ofelia-f3-actions-and-debt.md`. Two execution options:

**1. Subagent-Driven (recommended)** — dispatch a fresh subagent per task, review between tasks, fast iteration.

**2. Inline Execution** — execute tasks in this session using executing-plans, batch execution with checkpoints.

Which approach?
