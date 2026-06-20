# F3 — Actions & Debt (Ofelia model) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Give the Ofelia widget a domain model that applies **confirm / go-into-debt / forgive / undo** to a **selected day**, updates the debt counter per spec §3.2, emits attributed `HistoryEventDraft`s through an injected port, and exposes the global **current user** (“кто я”) persisted per-device.

**Architecture:** A new tiny model `model/current-user.ts` owns contract **4.6** (`currentUser`/`setCurrentUser`, persisted to `shared.client` so it stays per-device and is *not* synced). `model/ofelia-duty.ts` is extended with the event/port **types** (contract **4.3** event shape + **4.5** port), a `selectedDate` atom + week-navigation coordination (spec §3.1.1), the four day-targeted actions, and a set of **pure selectors** (effective duty, debt-day test, day status, debt warning) that the UI (F6) and history (F4) reuse. The action model never touches storage for history — it calls an injected `HistoryPort`; F3 also ships a minimal production `createHistoryPort(storage)` so the build/app stay green until F4 supersedes it. The widget UI is **not** redesigned here (that is F6) — `OfeliaPoopDuty.tsx` is only rewired so the new factory signature compiles and the existing render keeps working.

**Tech Stack:** TypeScript (ESM), Reatom v1001 (`atom`/`computed`/`action`/`withAsyncData`/`withStorageKey`), Zod v4, Temporal (global polyfill), Vitest + jsdom.

## Global Constraints

- **Scope is the Ofelia model only.** This plan owns spec contracts **4.5 (HistoryPort)** and **4.6 (currentUser)**, and shares ownership of **4.3 (HistoryEvent shape)** with F4. Do **not** build the history/comments models or any UI redesign (F4/F5/F6).
- **No authorization.** Either person may run any action. Every event records `actor` (domain: derived from duty) **and** `by` (who actually pressed it — read from `currentUser()` at action time). Comments’ `author` is F5; this plan only provides `currentUser`.
- **Actions target a day `D`** — default `selectedDate()` (which defaults to today). Each action writes an event with `date = D.toString()` and the debt delta of §3.2. Day status is **derived** from the week log, never stored.
- **Debt counter rules:** keep using `normalizeDebts` (min becomes 0); debt never goes below 0; `DEBT_WARNING_THRESHOLD = 7` triggers only a *soft* warning selector (no hard cap).
- **currentUser persistence:** `shared.client` (Dexie, per-device, **not** synced). Default = `DUTY_ROTATION[0]` (`'Леша'`) until a value loads / is chosen.
- **Contract refinement (4.5):** the bare 4.5 sketch is `append` only. F3 needs to **reverse** the last event of a day for *undo* (spec §3.2 row “Откатить” = remove the record), so this plan adds **one** method: `remove(weekStartISO, id)`. Day-status and undo otherwise consume events through **pure selectors** that receive the week’s `HistoryEvent[]` as an argument (the caller — F4’s model / F6’s UI — supplies them), so the action model still does no history reads. Document this for F4 (it implements `remove` over `storage.shared.server`).
- **`Person` is the canonical name** for a roster member (contract 4.3). It is defined as `Person = DutyPerson` so the existing `DutyPerson` keeps working; prefer `Person` in new code.
- **Code style — match the file you edit.** Source files (`model/*.ts`, `ui/*.tsx`) use **double quotes + semicolons** and the `@/…` path alias for `client/src`. Test files (`*.test.ts(x)`) use **single quotes + no semicolons** and relative imports (`../../../src/…`). Reatom atoms/actions/computed in this widget are created **without** explicit names (match `ofelia-duty.ts`).
- **Before PR:** `pnpm test` and `pnpm typecheck` must pass (run from repo root).

---

## File Structure

- **Create** `client/widgets/ofelia-poop-duty/model/current-user.ts` — `currentUserModel({ storage })` → `{ currentUser, setCurrentUser }`. Owns contract 4.6.
- **Create** `client/widgets/ofelia-poop-duty/model/current-user.test.ts` — default, load-from-storage, persist-on-change.
- **Modify** `client/widgets/ofelia-poop-duty/model/ofelia-duty.ts` — add event/port types (4.3/4.5), `DEBT_WARNING_THRESHOLD`, exported date helpers (`getToday`, `getStartOfWeek`, `weekStartISO`, `historyKey`), `otherPerson`, pure selectors (`effectiveDuty`, `isDebtDay`, `isOverDebtWarning`, `getDayStatus`, `findLastDayEvent`), `createHistoryPort`, and the reworked `ofeliaDutyModel` (new props `{ storage, history, currentUser }`, `selectedDate`/`selectDay`, week-nav coordination, the four actions). Remove the superseded `inDebt`/`forgiveDebt`.
- **Modify** `client/widgets/ofelia-poop-duty/model/ofelia-duty.test.ts` — update the existing test to the new factory signature; add fakes (`createHistory`, `currentUser` atom); add tests for selectors, `selectedDate`/nav, and each action.
- **Modify** `client/widgets/ofelia-poop-duty/ui/OfeliaPoopDuty.tsx` — build `currentUserModel` + `createHistoryPort` and pass them into `ofeliaDutyModel`; render is otherwise unchanged.

---

## Task 1: `currentUserModel` (contract 4.6)

**Files:**
- Create: `client/widgets/ofelia-poop-duty/model/current-user.ts`
- Test: `client/widgets/ofelia-poop-duty/model/current-user.test.ts`

**Interfaces:**
- Consumes: `DUTY_ROTATION`, `Person` from `./ofelia-duty` (already exported as `DUTY_ROTATION`; `Person` is added in Task 2 — for Task 1 use `DutyPerson` re-typed locally to avoid an ordering dependency, see note). `withStorageKey` from `@/storage/model/reatom/reatom-storage`. `WidgetStorage` from `@/storage/model/widget-storage`.
- Produces:
  - `interface CurrentUserModelProps { storage: WidgetStorage }`
  - `const currentUserModel: (props: CurrentUserModelProps) => { currentUser: Atom<Person>; setCurrentUser: Action<(person: Person) => void> }`

> **Note on import order:** Task 2 adds `export type Person = DutyPerson` to `ofelia-duty.ts`. To keep Task 1 self-contained, import the existing `DutyPerson` and alias it: `import { DUTY_ROTATION, type DutyPerson as Person } from "./ofelia-duty";`. After Task 2 this can stay as-is (both names resolve to the same type).

- [ ] **Step 1: Write the failing test**

Create `client/widgets/ofelia-poop-duty/model/current-user.test.ts`:

```ts
import { context, wrap } from '@reatom/core'
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { StorageApi } from '../../../src/storage/model/types'
import type { WidgetStorage } from '../../../src/storage/model/widget-storage'
import { currentUserModel } from './current-user'

function createStorage(client: Partial<StorageApi> = {}): WidgetStorage {
  const base: StorageApi = {
    get: vi.fn(async () => null),
    set: vi.fn(async () => undefined),
    delete: vi.fn(async () => undefined),
    has: vi.fn(async () => false),
    keys: vi.fn(async () => []),
    append: vi.fn(async () => undefined),
    subscribe: vi.fn(() => () => {}),
  }
  const clientApi: StorageApi = { ...base, ...client }
  return {
    instance: { client: clientApi, server: base },
    shared: { client: clientApi, server: base },
  }
}

afterEach(() => {
  context.reset()
})

describe('currentUserModel', () => {
  it('defaults to the first roster member when nothing is stored', () => {
    const model = currentUserModel({ storage: createStorage() })
    expect(model.currentUser()).toBe('Леша')
  })

  it('loads the persisted value from shared.client', async () => {
    const subscribe: StorageApi['subscribe'] = (key, listener) => {
      if (key === 'currentUser') listener({ value: 'Карина' as never })
      return () => {}
    }
    const model = currentUserModel({ storage: createStorage({ subscribe }) })
    await context.start(async () => {
      const off = model.currentUser.subscribe(() => {})
      const check = wrap(() => expect(model.currentUser()).toBe('Карина'))
      await vi.waitFor(() => check())
      off()
    })
  })

  it('persists the selection to shared.client on change', async () => {
    const set = vi.fn(async () => undefined)
    const model = currentUserModel({ storage: createStorage({ set }) })
    await context.start(async () => {
      const off = model.currentUser.subscribe(() => {})
      await model.setCurrentUser('Карина')
      const check = wrap(() =>
        expect(set.mock.calls.some((c) => c[0] === 'currentUser' && c[1] === 'Карина')).toBe(true),
      )
      await vi.waitFor(() => check())
      off()
    })
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm --filter client test -- current-user`
Expected: FAIL — `Cannot find module './current-user'`.

- [ ] **Step 3: Write minimal implementation**

Create `client/widgets/ofelia-poop-duty/model/current-user.ts`:

```ts
import { withStorageKey } from "@/storage/model/reatom/reatom-storage";
import { WidgetStorage } from "@/storage/model/widget-storage";
import { Atom, action, atom, computed } from "@reatom/core";
import z from "zod";
import { DUTY_ROTATION, type DutyPerson as Person } from "./ofelia-duty";

const PersonSchema = z.enum(DUTY_ROTATION);

export interface CurrentUserModelProps {
  storage: WidgetStorage;
}

export const currentUserModel = ({ storage }: CurrentUserModelProps) => {
  const stored = atom<Person | null>(null).extend(
    withStorageKey({
      api: storage.shared.client,
      key: "currentUser",
      schema: PersonSchema,
    }),
  );

  const currentUser: Atom<Person> = computed(() => stored() ?? DUTY_ROTATION[0]);

  const setCurrentUser = action((person: Person) => {
    stored.set(person);
  });

  return { currentUser, setCurrentUser };
};
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm --filter client test -- current-user`
Expected: PASS (3 tests).

- [ ] **Step 5: Commit**

```bash
git add client/widgets/ofelia-poop-duty/model/current-user.ts client/widgets/ofelia-poop-duty/model/current-user.test.ts
git commit -m "feat(ofelia): add per-device current-user model (contract 4.6)"
```

---

## Task 2: Event/port types, helpers, pure selectors, production port

**Files:**
- Modify: `client/widgets/ofelia-poop-duty/model/ofelia-duty.ts`
- Test: `client/widgets/ofelia-poop-duty/model/ofelia-duty.test.ts`

**Interfaces:**
- Consumes: existing `DUTY_ROTATION`, `DutyPerson`, `getOfeliaDutyByDate`, `getDebtDays` (private — keep), `normalizeDebts`, the private `getToday`/`getStartOfWeek` (now exported), `WidgetStorage`.
- Produces (all `export`ed):
  - `type Person = DutyPerson`
  - `type HistoryEventType = 'cleaned' | 'went_into_debt' | 'forgiven'`
  - `type HistoryEvent = { id: string; ts: number; ip: string; date: string; type: HistoryEventType; actor: Person; onBehalfOf?: Person; by: Person }`
  - `type HistoryEventDraft = Omit<HistoryEvent, 'id' | 'ts' | 'ip'>`
  - `type HistoryPort = { append(event: HistoryEventDraft): Promise<void>; remove(weekStartISO: string, id: string): Promise<void> }`
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
  - `function findLastDayEvent(events: HistoryEvent[], date: Temporal.PlainDate): HistoryEvent | null`
  - `function createHistoryPort(storage: WidgetStorage): HistoryPort`

- [ ] **Step 1: Write the failing tests**

Append to `client/widgets/ofelia-poop-duty/model/ofelia-duty.test.ts` (the file already imports `vi`, `describe`, `it`, `expect` and sets the fake clock to `2026-06-16T10:00:00.000Z`, so `getToday()` is `2026-06-16`). Add these imports to the existing import of `./ofelia-duty`:

```ts
import {
  ofeliaDutyModel,
  effectiveDuty,
  isDebtDay,
  isOverDebtWarning,
  getDayStatus,
  findLastDayEvent,
  weekStartISO,
  historyKey,
  otherPerson,
  createHistoryPort,
  DEBT_WARNING_THRESHOLD,
  type HistoryEvent,
} from './ofelia-duty'
```

Then add a new describe block:

```ts
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
    // 2026-06-16 is a Tuesday -> week starts Monday 2026-06-15
    expect(weekStartISO(D('2026-06-16'))).toBe('2026-06-15')
    expect(historyKey(D('2026-06-16'))).toBe('history:2026-06-15')
  })

  it('effectiveDuty / isDebtDay reflect projected debt days', () => {
    // Карина owes 1 -> the next non-Карина day (today 2026-06-16, duty Леша) becomes a debt day for Карина
    const debts = { Леша: 0, Карина: 1 }
    expect(isDebtDay(D('2026-06-16'), debts)).toBe(true)
    expect(effectiveDuty(D('2026-06-16'), debts)).toBe('Карина')
    // a plain rotation day with no debts
    expect(isDebtDay(D('2026-06-17'), {})).toBe(false)
    expect(effectiveDuty(D('2026-06-17'), {})).toBe('Карина') // 2026-06-17 rotation = Карина
  })

  it('isOverDebtWarning fires strictly above the threshold', () => {
    expect(DEBT_WARNING_THRESHOLD).toBe(7)
    expect(isOverDebtWarning({ Леша: 7 }, 'Леша')).toBe(false)
    expect(isOverDebtWarning({ Леша: 8 }, 'Леша')).toBe(true)
  })

  it('getDayStatus is closed only for cleaned/went_into_debt of that day', () => {
    const date = D('2026-06-16')
    expect(getDayStatus([], date)).toBe('pending')
    expect(getDayStatus([ev({ type: 'forgiven' })], date)).toBe('pending')
    expect(getDayStatus([ev({ type: 'cleaned' })], date)).toBe('closed')
    expect(getDayStatus([ev({ type: 'went_into_debt' })], date)).toBe('closed')
    expect(getDayStatus([ev({ date: '2026-06-17', type: 'cleaned' })], date)).toBe('pending')
  })

  it('findLastDayEvent returns the latest event of the day or null', () => {
    const date = D('2026-06-16')
    expect(findLastDayEvent([], date)).toBeNull()
    const a = ev({ id: 'a', ts: 1 })
    const b = ev({ id: 'b', ts: 2 })
    const other = ev({ id: 'c', ts: 9, date: '2026-06-17' })
    expect(findLastDayEvent([b, a, other], date)?.id).toBe('b')
  })

  it('createHistoryPort.append derives the week key and forwards to storage.append', async () => {
    const append = vi.fn(async () => undefined)
    const storage = createStorage()
    storage.shared.server.append = append as never
    const port = createHistoryPort(storage)
    await port.append({ date: '2026-06-16', type: 'cleaned', actor: 'Леша', by: 'Леша' })
    expect(append).toHaveBeenCalledWith('history:2026-06-15', {
      date: '2026-06-16',
      type: 'cleaned',
      actor: 'Леша',
      by: 'Леша',
    })
  })

  it('createHistoryPort.remove drops the event by id via get + set', async () => {
    const existing: HistoryEvent[] = [ev({ id: 'keep' }), ev({ id: 'drop' })]
    const get = vi.fn(async () => existing)
    const set = vi.fn(async () => undefined)
    const storage = createStorage()
    storage.shared.server.get = get as never
    storage.shared.server.set = set as never
    const port = createHistoryPort(storage)
    await port.remove('2026-06-15', 'drop')
    expect(set).toHaveBeenCalledWith('history:2026-06-15', [ev({ id: 'keep' })])
  })
})
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `pnpm --filter client test -- ofelia-duty`
Expected: FAIL — the new exports (`effectiveDuty`, `historyKey`, `createHistoryPort`, …) do not exist.

- [ ] **Step 3: Write minimal implementation**

In `client/widgets/ofelia-poop-duty/model/ofelia-duty.ts`:

(a) Add `WidgetStorage` to the existing imports and keep the others:

```ts
import { WidgetStorage } from "@/storage/model/widget-storage";
```

(b) Below `export type DutyPerson = (typeof DUTY_ROTATION)[number];` add the types and constant:

```ts
export type Person = DutyPerson;

export type HistoryEventType = "cleaned" | "went_into_debt" | "forgiven";

export type HistoryEvent = {
  id: string;
  ts: number;
  ip: string;
  date: string;
  type: HistoryEventType;
  actor: Person;
  onBehalfOf?: Person;
  by: Person;
};

export type HistoryEventDraft = Omit<HistoryEvent, "id" | "ts" | "ip">;

export type HistoryPort = {
  append(event: HistoryEventDraft): Promise<void>;
  remove(weekStartISO: string, id: string): Promise<void>;
};

export const DEBT_WARNING_THRESHOLD = 7;
```

(c) Change the existing private `getToday`/`getStartOfWeek` to `export function …` (just add `export`).

(d) At the bottom of the file (next to the other free functions) add the helpers and selectors:

```ts
export function weekStartISO(date: Temporal.PlainDate): string {
  return getStartOfWeek(date).toString();
}

export function historyKey(date: Temporal.PlainDate): string {
  return `history:${weekStartISO(date)}`;
}

export function otherPerson(person: Person): Person {
  return DUTY_ROTATION.find((candidate) => candidate !== person) ?? person;
}

export function effectiveDuty(
  date: Temporal.PlainDate,
  debts: Partial<NumberOfDebts>,
): Person {
  const debtDay = getDebtDays(debts, getToday()).find((day) =>
    day.date.equals(date),
  );
  return debtDay?.person ?? getOfeliaDutyByDate(date);
}

export function isDebtDay(
  date: Temporal.PlainDate,
  debts: Partial<NumberOfDebts>,
): boolean {
  return getDebtDays(debts, getToday()).some((day) => day.date.equals(date));
}

export function isOverDebtWarning(
  debts: Partial<NumberOfDebts>,
  person: Person,
): boolean {
  return (debts[person] ?? 0) > DEBT_WARNING_THRESHOLD;
}

export function getDayStatus(
  events: HistoryEvent[],
  date: Temporal.PlainDate,
): "closed" | "pending" {
  const iso = date.toString();
  const closed = events.some(
    (event) =>
      event.date === iso &&
      (event.type === "cleaned" || event.type === "went_into_debt"),
  );
  return closed ? "closed" : "pending";
}

export function findLastDayEvent(
  events: HistoryEvent[],
  date: Temporal.PlainDate,
): HistoryEvent | null {
  const iso = date.toString();
  const dayEvents = events
    .filter((event) => event.date === iso)
    .sort((a, b) => a.ts - b.ts);
  return dayEvents.at(-1) ?? null;
}

export function createHistoryPort(storage: WidgetStorage): HistoryPort {
  const api = storage.shared.server;
  return {
    async append(event) {
      const result = await api.append(
        historyKey(Temporal.PlainDate.from(event.date)),
        event,
      );
      if (result instanceof Error) throw result;
    },
    async remove(weekStart, id) {
      const key = `history:${weekStart}`;
      const current = await api.get<HistoryEvent[]>(key);
      if (current instanceof Error) throw current;
      const next = (current ?? []).filter((event) => event.id !== id);
      const result = await api.set(key, next);
      if (result instanceof Error) throw result;
    },
  };
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `pnpm --filter client test -- ofelia-duty`
Expected: PASS (existing test + new selector/port tests).

- [ ] **Step 5: Commit**

```bash
git add client/widgets/ofelia-poop-duty/model/ofelia-duty.ts client/widgets/ofelia-poop-duty/model/ofelia-duty.test.ts
git commit -m "feat(ofelia): add event/port types, selectors and history port (contracts 4.3/4.5)"
```

---

## Task 3: Rework factory — `selectedDate`, week-nav coordination, new props, UI wiring

**Files:**
- Modify: `client/widgets/ofelia-poop-duty/model/ofelia-duty.ts`
- Modify: `client/widgets/ofelia-poop-duty/model/ofelia-duty.test.ts`
- Modify: `client/widgets/ofelia-poop-duty/ui/OfeliaPoopDuty.tsx`

**Interfaces:**
- Consumes: `HistoryPort`, `Person` (Task 2); `currentUserModel`, `createHistoryPort`.
- Produces:
  - `interface OfeliaDutyModelProps { storage: WidgetStorage; history: HistoryPort; currentUser: Atom<Person> }`
  - `ofeliaDutyModel` now also returns `selectedDate: Atom<Temporal.PlainDate>` and `selectDay: Action<(date: Temporal.PlainDate) => void>`; the action stubs `confirmClean`/`goIntoDebt`/`forgive`/`undo` are added empty here and implemented in Tasks 4–7. The superseded `inDebt`/`forgiveDebt` are **removed**.
  - Week-nav actions (`goToNextWeek`/`goToPrevWeek`/`goToCurrentWeek`) also reset `selectedDate` per §3.1.1.

> The four action stubs are added in this task only so the return shape is stable and the UI compiles; their bodies are filled by Tasks 4–7. Each stub is a no-op `action(async (date: Temporal.PlainDate = selectedDate()) => {})` (and `undo` takes `(date, events)`), with real behaviour + tests added later. This keeps every task’s build green.

- [ ] **Step 1: Write the failing tests**

Replace the test file’s `createStorage` block usage and add fakes + new tests. First, update the existing top-of-file helpers in `ofelia-duty.test.ts` by adding (after `createStorage`):

```ts
import { atom } from '@reatom/core'
import type { HistoryEventDraft, HistoryPort, Person } from './ofelia-duty'

function createHistory() {
  const appended: HistoryEventDraft[] = []
  const removed: Array<{ week: string; id: string }> = []
  const port: HistoryPort = {
    append: vi.fn(async (event: HistoryEventDraft) => {
      appended.push(event)
    }),
    remove: vi.fn(async (week: string, id: string) => {
      removed.push({ week, id })
    }),
  }
  return { port, appended, removed }
}

function createModel(currentUserName: Person = 'Леша') {
  const currentUser = atom<Person>(currentUserName)
  const history = createHistory()
  const model = ofeliaDutyModel({ storage: createStorage(), history: history.port, currentUser })
  return { model, currentUser, ...history }
}
```

Update the **existing** test’s instantiation from `ofeliaDutyModel({ storage: createStorage() })` to use the helper:

```ts
it('uses the current date when the week recomputes after midnight', () => {
  const { model } = createModel()

  expect(model.currentWeek().find((day) => day.isToday)?.date.toString()).toBe('2026-06-16')

  vi.setSystemTime(new Date('2026-06-17T10:00:00.000Z'))
  model.numberOfDebts.set({ Леша: 0, Карина: 0 })

  expect(model.currentWeek().find((day) => day.isToday)?.date.toString()).toBe('2026-06-17')
})
```

Add a new describe block:

```ts
describe('ofeliaDutyModel selected day + navigation', () => {
  it('defaults selectedDate to today', () => {
    const { model } = createModel()
    expect(model.selectedDate().toString()).toBe('2026-06-16')
  })

  it('selectDay updates the selected date', async () => {
    const { model } = createModel()
    await context.start(async () => {
      await model.selectDay(Temporal.PlainDate.from('2026-06-18'))
    })
    expect(model.selectedDate().toString()).toBe('2026-06-18')
  })

  it('navigating to another week selects that week start; back to current selects today', async () => {
    const { model } = createModel()
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
Expected: FAIL — `model.selectedDate`/`model.selectDay` undefined; type error on `ofeliaDutyModel` missing `history`/`currentUser`.

- [ ] **Step 3: Implement the factory changes**

In `ofelia-duty.ts`:

(a) Add `Atom` and `withAsyncData` to the reatom import (the file already imports `action, atom, computed, withAsyncData`; add `Atom`):

```ts
import { Atom, action, atom, computed, withAsyncData } from "@reatom/core";
```

(b) Replace `OfeliaDutyModelProps`:

```ts
export interface OfeliaDutyModelProps {
  storage: WidgetStorage;
  history: HistoryPort;
  currentUser: Atom<Person>;
}
```

(c) Update the factory signature and body. Destructure the new props, add `selectedDate`/`selectDay`, the `syncSelectedToWeek` helper, update the three nav actions, **remove** `inDebt`/`forgiveDebt`, add the four action stubs, and update the return:

```ts
export const ofeliaDutyModel = ({
  storage,
  history,
  currentUser,
}: OfeliaDutyModelProps) => {
  const numberOfDebts = atom<NumberOfDebts | null>(null).extend(
    withStorageKey({
      api: storage.shared.server,
      key: "debts",
      schema: NumberOfDebtsSchema,
    }),
  );

  const startOfWeek = atom<Temporal.PlainDate>(getStartOfWeek(getToday()));
  const selectedDate = atom<Temporal.PlainDate>(getToday());

  const selectDay = action((date: Temporal.PlainDate) => {
    selectedDate.set(date);
  });

  function syncSelectedToWeek(weekStart: Temporal.PlainDate) {
    const today = getToday();
    selectedDate.set(
      weekStart.equals(getStartOfWeek(today)) ? today : weekStart,
    );
  }

  const goToNextWeek = action(() => {
    const next = startOfWeek().add({ days: 7 });
    startOfWeek.set(next);
    syncSelectedToWeek(next);
  });

  const goToPrevWeek = action(() => {
    const prev = startOfWeek().subtract({ days: 7 });
    startOfWeek.set(prev);
    syncSelectedToWeek(prev);
  });

  const goToCurrentWeek = action(() => {
    const current = getStartOfWeek(getToday());
    startOfWeek.set(current);
    syncSelectedToWeek(current);
  });

  // ... keep `debtDays` and `currentWeek` computeds unchanged ...

  const confirmClean = action(
    async (date: Temporal.PlainDate = selectedDate()) => {
      void date;
    },
  ).extend(withAsyncData({ status: true }));

  const goIntoDebt = action(
    async (date: Temporal.PlainDate = selectedDate()) => {
      void date;
    },
  ).extend(withAsyncData({ status: true }));

  const forgive = action(
    async (date: Temporal.PlainDate = selectedDate()) => {
      void date;
    },
  ).extend(withAsyncData({ status: true }));

  const undo = action(
    async (date: Temporal.PlainDate, events: HistoryEvent[]) => {
      void date;
      void events;
    },
  ).extend(withAsyncData({ status: true }));

  return {
    startOfWeek,
    selectedDate,
    selectDay,
    goToNextWeek,
    goToPrevWeek,
    goToCurrentWeek,
    numberOfDebts,
    currentWeek,
    confirmClean,
    goIntoDebt,
    forgive,
    undo,
  };
};
```

> Keep the existing `debtDays` and `currentWeek` computed blocks exactly as they are; only the surrounding code changes. Delete the old `inDebt` and `forgiveDebt` definitions.

(d) Wire the UI in `client/widgets/ofelia-poop-duty/ui/OfeliaPoopDuty.tsx`:

```tsx
import { useMemo } from "react";
import { reatomMemo } from "../../../src/shared/reatom/reatom-memo";
import type { WidgetRuntimeProps } from "../../../src/widget-host/model/types";
import { currentUserModel } from "../model/current-user";
import { createHistoryPort, ofeliaDutyModel } from "../model/ofelia-duty";
import styles from "./ofelia-poop-duty.module.css";

export const OfeliaPoopDuty = reatomMemo<WidgetRuntimeProps>(
  ({ mode, storage }) => {
    const currentUser = useMemo(() => currentUserModel({ storage }), [storage]);
    const history = useMemo(() => createHistoryPort(storage), [storage]);
    const model = useMemo(
      () =>
        ofeliaDutyModel({
          storage,
          history,
          currentUser: currentUser.currentUser,
        }),
      [storage, history, currentUser],
    );
    const week = model.currentWeek();
    // ... rest of the component unchanged ...
```

> Leave the rest of `OfeliaPoopDuty.tsx` (the `today`/`tomorrow` derivation and the JSX) untouched.

- [ ] **Step 4: Run tests + typecheck to verify green**

Run: `pnpm --filter client test -- ofelia-duty`
Expected: PASS.
Run: `pnpm typecheck`
Expected: PASS (UI compiles against the new factory signature).

- [ ] **Step 5: Commit**

```bash
git add client/widgets/ofelia-poop-duty/model/ofelia-duty.ts client/widgets/ofelia-poop-duty/model/ofelia-duty.test.ts client/widgets/ofelia-poop-duty/ui/OfeliaPoopDuty.tsx
git commit -m "feat(ofelia): selected day + week-nav coordination; inject history/currentUser"
```

---

## Task 4: `confirmClean(date)` — confirm cleaning

**Files:**
- Modify: `client/widgets/ofelia-poop-duty/model/ofelia-duty.ts`
- Test: `client/widgets/ofelia-poop-duty/model/ofelia-duty.test.ts`

**Interfaces:**
- Consumes: `effectiveDuty`/debt-day logic via `getDebtDays`, `getOfeliaDutyByDate`, `normalizeDebts`, `currentUser`, `history.append`.
- Produces: `confirmClean` real body. Semantics (§3.2 row 1): on a **debt-payment day**, the day’s effective duty is the debtor — decrement their debt by 1 and set `onBehalfOf` = the scheduled rotation duty (the creditor); on a plain day, no debt change. Always append a `cleaned` event with `actor` = effective duty of `D`, `by` = `currentUser()`.

- [ ] **Step 1: Write the failing tests**

Add to the actions describe block (create one if not present):

```ts
describe('ofeliaDutyModel.confirmClean', () => {
  it('on a plain day appends cleaned with no debt change', async () => {
    const { model, appended } = createModel()
    model.numberOfDebts.set({ Леша: 0, Карина: 0 })
    await context.start(async () => {
      await model.confirmClean(Temporal.PlainDate.from('2026-06-17'))
    })
    expect(model.numberOfDebts()).toEqual({ Леша: 0, Карина: 0 })
    expect(appended).toEqual([
      { date: '2026-06-17', type: 'cleaned', actor: 'Карина', by: 'Леша' },
    ])
  })

  it('on a debt-payment day decrements the debtor and records the creditor', async () => {
    const { model, appended } = createModel('Карина')
    model.numberOfDebts.set({ Леша: 0, Карина: 1 })
    await context.start(async () => {
      await model.confirmClean(Temporal.PlainDate.from('2026-06-16'))
    })
    expect(model.numberOfDebts()).toEqual({ Леша: 0, Карина: 0 })
    expect(appended).toEqual([
      {
        date: '2026-06-16',
        type: 'cleaned',
        actor: 'Карина',
        onBehalfOf: 'Леша',
        by: 'Карина',
      },
    ])
  })

  it('defaults the date to selectedDate', async () => {
    const { model, appended } = createModel()
    model.numberOfDebts.set({ Леша: 0, Карина: 0 })
    await context.start(async () => {
      await model.confirmClean()
    })
    expect(appended[0]?.date).toBe('2026-06-16')
  })
})
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `pnpm --filter client test -- ofelia-duty`
Expected: FAIL — `appended` is empty / debt unchanged (stub body).

- [ ] **Step 3: Implement `confirmClean`**

Replace the `confirmClean` stub body:

```ts
const confirmClean = action(
  async (date: Temporal.PlainDate = selectedDate()) => {
    const debts = { ...(numberOfDebts() ?? {}) };
    const debtDay = getDebtDays(debts, getToday()).find((day) =>
      day.date.equals(date),
    );
    const actor = debtDay?.person ?? getOfeliaDutyByDate(date);

    const draft: HistoryEventDraft = {
      date: date.toString(),
      type: "cleaned",
      actor,
      by: currentUser(),
      ...(debtDay ? { onBehalfOf: getOfeliaDutyByDate(date) } : {}),
    };

    if (debtDay) {
      debts[actor] = Math.max((debts[actor] ?? 0) - 1, 0);
      numberOfDebts.set(normalizeDebts(debts));
    }

    await history.append(draft);
  },
).extend(withAsyncData({ status: true }));
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
- Produces: `goIntoDebt` real body. Semantics (§3.2 row 2): the day’s effective duty `duty` gains `+1` debt (someone else cleaned that day). Append `went_into_debt` with `actor` = `otherPerson(duty)` (who actually cleaned), `onBehalfOf` = `duty`, `by` = `currentUser()`.

- [ ] **Step 1: Write the failing tests**

```ts
describe('ofeliaDutyModel.goIntoDebt', () => {
  it('adds a debt to the day duty and records who covered', async () => {
    const { model, appended } = createModel('Карина')
    model.numberOfDebts.set({ Леша: 0, Карина: 0 })
    await context.start(async () => {
      await model.goIntoDebt(Temporal.PlainDate.from('2026-06-16'))
    })
    // 2026-06-16 rotation duty = Леша -> Леша owes, Карина covered
    expect(model.numberOfDebts()).toEqual({ Леша: 1, Карина: 0 })
    expect(appended).toEqual([
      {
        date: '2026-06-16',
        type: 'went_into_debt',
        actor: 'Карина',
        onBehalfOf: 'Леша',
        by: 'Карина',
      },
    ])
  })
})
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `pnpm --filter client test -- ofelia-duty`
Expected: FAIL — debt stays `{0,0}`, `appended` empty.

- [ ] **Step 3: Implement `goIntoDebt`**

Replace the `goIntoDebt` stub body:

```ts
const goIntoDebt = action(
  async (date: Temporal.PlainDate = selectedDate()) => {
    const debts = { ...(numberOfDebts() ?? {}) };
    const debtDay = getDebtDays(debts, getToday()).find((day) =>
      day.date.equals(date),
    );
    const duty = debtDay?.person ?? getOfeliaDutyByDate(date);
    const cleaner = otherPerson(duty);

    debts[duty] = (debts[duty] ?? 0) + 1;
    numberOfDebts.set(normalizeDebts(debts));

    await history.append({
      date: date.toString(),
      type: "went_into_debt",
      actor: cleaner,
      onBehalfOf: duty,
      by: currentUser(),
    });
  },
).extend(withAsyncData({ status: true }));
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
- Produces: `forgive` real body. Semantics (§3.2 row 3): find the current debtor (the unique person with debt > 0 after normalization). Decrement them by 1 (floor 0). Append `forgiven` with `actor` = `otherPerson(debtor)` (the forgiver/creditor), `onBehalfOf` = `debtor`, `by` = `currentUser()`. If nobody owes, it is a no-op (no debt change, no event).

- [ ] **Step 1: Write the failing tests**

```ts
describe('ofeliaDutyModel.forgive', () => {
  it('decrements the debtor and records the forgiver', async () => {
    const { model, appended } = createModel('Карина')
    model.numberOfDebts.set({ Леша: 1, Карина: 0 })
    await context.start(async () => {
      await model.forgive(Temporal.PlainDate.from('2026-06-16'))
    })
    expect(model.numberOfDebts()).toEqual({ Леша: 0, Карина: 0 })
    expect(appended).toEqual([
      {
        date: '2026-06-16',
        type: 'forgiven',
        actor: 'Карина',
        onBehalfOf: 'Леша',
        by: 'Карина',
      },
    ])
  })

  it('is a no-op when nobody owes', async () => {
    const { model, appended } = createModel()
    model.numberOfDebts.set({ Леша: 0, Карина: 0 })
    await context.start(async () => {
      await model.forgive(Temporal.PlainDate.from('2026-06-16'))
    })
    expect(appended).toEqual([])
    expect(model.numberOfDebts()).toEqual({ Леша: 0, Карина: 0 })
  })
})
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `pnpm --filter client test -- ofelia-duty`
Expected: FAIL — no event appended.

- [ ] **Step 3: Implement `forgive`**

Replace the `forgive` stub body:

```ts
const forgive = action(
  async (date: Temporal.PlainDate = selectedDate()) => {
    const debts = { ...(numberOfDebts() ?? {}) };
    const debtor = DUTY_ROTATION.find((person) => (debts[person] ?? 0) > 0);
    if (!debtor) return;
    const forgiver = otherPerson(debtor);

    debts[debtor] = Math.max((debts[debtor] ?? 0) - 1, 0);
    numberOfDebts.set(normalizeDebts(debts));

    await history.append({
      date: date.toString(),
      type: "forgiven",
      actor: forgiver,
      onBehalfOf: debtor,
      by: currentUser(),
    });
  },
).extend(withAsyncData({ status: true }));
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

## Task 7: `undo(date, events)` — revert the last event of a day

**Files:**
- Modify: `client/widgets/ofelia-poop-duty/model/ofelia-duty.ts`
- Test: `client/widgets/ofelia-poop-duty/model/ofelia-duty.test.ts`

**Interfaces:**
- Consumes: `findLastDayEvent` (Task 2), `normalizeDebts`, `weekStartISO`, `history.remove`.
- Produces: `undo` real body. Given the week’s `events` (supplied by the caller — F4’s model / F6’s UI; a fake array in tests), find the last event of day `D`, reverse its debt delta, and remove it from its week’s log:
  - `cleaned` **with** `onBehalfOf` (a debt-payment): re-add `+1` to `event.actor` (the debtor).
  - `went_into_debt`: subtract `1` (floor 0) from `event.onBehalfOf` (the duty who had owed).
  - `forgiven`: re-add `+1` to `event.onBehalfOf` (the forgiven debtor).
  - `cleaned` without `onBehalfOf` (plain confirm): no debt change.
  - No event for the day → no-op (no debt change, no `remove`).

- [ ] **Step 1: Write the failing tests**

```ts
describe('ofeliaDutyModel.undo', () => {
  const baseEvent = {
    id: 'e1',
    ts: 1,
    ip: '0.0.0.0',
    date: '2026-06-16',
    by: 'Карина' as Person,
  }

  it('reverts a debt-payment cleaned event and removes it', async () => {
    const { model, removed } = createModel()
    model.numberOfDebts.set({ Леша: 0, Карина: 0 })
    const events: HistoryEvent[] = [
      { ...baseEvent, type: 'cleaned', actor: 'Карина', onBehalfOf: 'Леша' },
    ]
    await context.start(async () => {
      await model.undo(Temporal.PlainDate.from('2026-06-16'), events)
    })
    expect(model.numberOfDebts()).toEqual({ Леша: 0, Карина: 1 })
    expect(removed).toEqual([{ week: '2026-06-15', id: 'e1' }])
  })

  it('reverts a went_into_debt event', async () => {
    const { model } = createModel()
    model.numberOfDebts.set({ Леша: 1, Карина: 0 })
    const events: HistoryEvent[] = [
      { ...baseEvent, type: 'went_into_debt', actor: 'Карина', onBehalfOf: 'Леша' },
    ]
    await context.start(async () => {
      await model.undo(Temporal.PlainDate.from('2026-06-16'), events)
    })
    expect(model.numberOfDebts()).toEqual({ Леша: 0, Карина: 0 })
  })

  it('reverts a forgiven event', async () => {
    const { model } = createModel()
    model.numberOfDebts.set({ Леша: 0, Карина: 0 })
    const events: HistoryEvent[] = [
      { ...baseEvent, type: 'forgiven', actor: 'Карина', onBehalfOf: 'Леша' },
    ]
    await context.start(async () => {
      await model.undo(Temporal.PlainDate.from('2026-06-16'), events)
    })
    expect(model.numberOfDebts()).toEqual({ Леша: 1, Карина: 0 })
  })

  it('is a no-op when the day has no events', async () => {
    const { model, removed } = createModel()
    model.numberOfDebts.set({ Леша: 0, Карина: 0 })
    await context.start(async () => {
      await model.undo(Temporal.PlainDate.from('2026-06-16'), [])
    })
    expect(model.numberOfDebts()).toEqual({ Леша: 0, Карина: 0 })
    expect(removed).toEqual([])
  })
})
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `pnpm --filter client test -- ofelia-duty`
Expected: FAIL — debt unchanged, `removed` empty.

- [ ] **Step 3: Implement `undo`**

Replace the `undo` stub body:

```ts
const undo = action(
  async (date: Temporal.PlainDate, events: HistoryEvent[]) => {
    const event = findLastDayEvent(events, date);
    if (!event) return;

    const debts = { ...(numberOfDebts() ?? {}) };

    if (event.type === "cleaned" && event.onBehalfOf) {
      debts[event.actor] = (debts[event.actor] ?? 0) + 1;
    } else if (event.type === "went_into_debt" && event.onBehalfOf) {
      debts[event.onBehalfOf] = Math.max(
        (debts[event.onBehalfOf] ?? 0) - 1,
        0,
      );
    } else if (event.type === "forgiven" && event.onBehalfOf) {
      debts[event.onBehalfOf] = (debts[event.onBehalfOf] ?? 0) + 1;
    }

    numberOfDebts.set(normalizeDebts(debts));
    await history.remove(weekStartISO(date), event.id);
  },
).extend(withAsyncData({ status: true }));
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
git commit -m "feat(ofelia): undo action reverting the last event of a day"
```

---

## Self-Review (run against the spec)

**1. Spec coverage (F3 “Скоуп” §5 + §3):**
- `currentUser` + `setCurrentUser`, local persist via `shared.client`, default `DUTY_ROTATION[0]` → Task 1. ✅ (contract 4.6)
- `selectedDate` + `selectDay` + week-switch reconciliation (§3.1.1) → Task 3. ✅
- `confirmClean`/`goIntoDebt`/`forgive`/`undo` taking a target date, defaulting to `selectedDate()`, writing `date` + `by = currentUser()` → Tasks 4–7. ✅
- Day status derived from the week log (`getDayStatus`) → Task 2; used by undo via `findLastDayEvent` → Task 7. ✅
- `DEBT_WARNING_THRESHOLD` + soft warning selector (`isOverDebtWarning`) → Task 2. ✅
- `HistoryPort` accepted as a model dependency; fake in tests, real `createHistoryPort` for prod → Tasks 2–3. ✅ (contract 4.5, extended with `remove` — documented in Global Constraints)
- Debt table §3.2 effects, normalization, floor-0 → Tasks 4–7. ✅
- Event shape §4.3 (`actor` domain vs `by` presser; `onBehalfOf` when covering) → Tasks 2,4–7. ✅

**2. Placeholder scan:** No “TBD/TODO/handle edge cases”. The Task 3 action **stubs** are explicit no-op bodies (`void date`) with their real implementations specified in Tasks 4–7 — intentional, not placeholders, and each is independently green.

**3. Type consistency:** `Person`/`DutyPerson`, `HistoryEvent`/`HistoryEventDraft`/`HistoryPort`, `historyKey`/`weekStartISO`, `effectiveDuty`/`isDebtDay`/`getDayStatus`/`findLastDayEvent`/`isOverDebtWarning`, factory props `{ storage, history, currentUser }`, and returned members are used consistently across Tasks 1–7 and the UI wiring.

**Decisions captured for downstream features:**
- **F4** must implement `HistoryPort.remove(weekStartISO, id)` (over `storage.shared.server`) and may replace `createHistoryPort` with `ofelia-history.ts`; the read model it builds feeds the `events` argument of `undo` and the `getDayStatus`/`findLastDayEvent` selectors.
- **F5/F6** consume `currentUser`/`setCurrentUser` from `current-user.ts` (no per-thread author toggle).
- `inDebt`/`forgiveDebt` were removed (superseded by the date-targeted actions); no current consumer depended on them.

---

## Execution Handoff

Plan complete and saved to `docs/superpowers/plans/2026-06-20-ofelia-f3-actions-and-debt.md`. Two execution options:

**1. Subagent-Driven (recommended)** — dispatch a fresh subagent per task, review between tasks, fast iteration.

**2. Inline Execution** — execute tasks in this session using executing-plans, batch execution with checkpoints.

Which approach?
