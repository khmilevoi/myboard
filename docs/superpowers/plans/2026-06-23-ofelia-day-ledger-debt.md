# Ofelia Per-Day Ledger & Debt Derivation Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the standalone mutable `debts` counter with a single append-only per-day ledger that is the only source of truth for debt, day status, "who cleaned each day", and the audit history list.

**Architecture:** A new global `shared.server` key `ledger` holds an append-only `LedgerEntry[]`. Debt and day resolution are pure folds over that array (latest-entry-per-date wins for day outcomes; `forgiven` entries are balance adjustments). The four actions become a single `append` each; `numberOfDebts` becomes a `computed`; the per-week `history:<week>` journal and its subscription are retired. Spec: `docs/superpowers/specs/2026-06-23-ofelia-day-ledger-debt-design.md`.

**Tech Stack:** TypeScript, Reatom v1001 (`@reatom/core`: `atom`/`computed`/`action`/`withConnectHook`/`withAsyncData`/`wrap`), Zod, `Temporal.PlainDate`, errore (errors-as-values), Vitest, Playwright.

## Global Constraints

- Every exported React component is wrapped with `reatomMemo` (`@/shared/reatom/reatom-memo`). UI keeps only view glue; logic lives in `model/`.
- errore convention: storage calls return `StorageError | T`; never throw across boundaries except re-throwing inside an `action` (`if (result instanceof Error) throw result`) so `withAsyncData({ status: true })` captures it.
- Rotation is fixed: `DUTY_ROTATION = ['Леша', 'Карина']`, `BASE_DUTY_DATE = 2026-06-16`, `DUTY_TIME_ZONE = 'Europe/Warsaw'`. `getOfeliaDutyByDate` is `diffDays % 2` from base (even → Леша).
- `IP_TAIL_LENGTH = 5`, `DEBT_WARNING_THRESHOLD = 7` — unchanged.
- Storage scope for the ledger is `shared.server` (full key `w:t:ofelia-poop-duty:ledger`). The server's `handleAppend` stamps `id` (randomUUID), `ts` (Date.now), `ip`; the client sends only the draft.
- Single-file test run (cwd is `client/`): `pnpm --filter client exec vitest run <path-relative-to-client>`.
- Commit trailer on every commit: `Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>`.

---

### Task 1: Ledger model — types, schema, `foldDebt`

Introduces the ledger data model and the debt fold as pure, exported functions in `model/ofelia-duty.ts` (kept in this file to reuse `DUTY_ROTATION`/`PersonSchema`/`NumberOfDebts`/`normalizeDebts` without a circular import). Pure-function tests live in a new focused test file.

**Files:**
- Modify: `client/widgets/ofelia-poop-duty/model/ofelia-duty.ts` (add after the existing `PersonSchema`/`NumberOfDebtsSchema` block, ~line 57–75; add helpers near `getDebtDays`)
- Test: `client/widgets/ofelia-poop-duty/model/ledger.test.ts` (create)

**Interfaces:**
- Consumes: `PersonSchema`, `DUTY_ROTATION`, `Person`, `NumberOfDebts` (internal type), `normalizeDebts` — all already in `ofelia-duty.ts`.
- Produces:
  - `LEDGER_KEY = 'ledger'`
  - `type LedgerType = 'cleaned' | 'went_into_debt' | 'reset' | 'forgiven'`
  - `type LedgerEntry = { id: string; ts: number; ip: string; date: string; type: LedgerType; actor: Person; onBehalfOf?: Person; by: Person }`
  - `type LedgerEntryDraft = Omit<LedgerEntry, 'id' | 'ts' | 'ip'>`
  - `const LedgerEntriesSchema: z.ZodType<LedgerEntry[]>`
  - `function foldDebt(entries: LedgerEntry[]): NumberOfDebts` (always returns both rotation keys, normalized)
  - `function latestOutcomesByDate(entries: LedgerEntry[]): Map<string, LedgerEntry>` (used again in Task 2)

- [ ] **Step 1: Write the failing test**

Create `client/widgets/ofelia-poop-duty/model/ledger.test.ts`:

```ts
import { describe, expect, it } from 'vitest'

import { foldDebt } from './ofelia-duty'
import type { LedgerEntry } from './ofelia-duty'

let seq = 0
const le = (o: Partial<LedgerEntry> = {}): LedgerEntry => ({
  id: `e${seq++}`,
  ts: seq,
  ip: '127.0.0.1',
  date: '2026-06-16',
  type: 'cleaned',
  actor: 'Леша',
  by: 'Леша',
  ...o,
})

describe('foldDebt', () => {
  it('is zero for an empty ledger', () => {
    expect(foldDebt([])).toEqual({ Леша: 0, Карина: 0 })
  })

  it('a plain cleaned day changes nothing', () => {
    expect(foldDebt([le({ date: '2026-06-16', type: 'cleaned', actor: 'Леша' })])).toEqual({
      Леша: 0,
      Карина: 0,
    })
  })

  it('went_into_debt adds one to the scheduled person (onBehalfOf)', () => {
    expect(
      foldDebt([le({ type: 'went_into_debt', actor: 'Карина', onBehalfOf: 'Леша' })]),
    ).toEqual({ Леша: 1, Карина: 0 })
  })

  it('cleaning a debt day (cleaned + onBehalfOf) repays the cleaner', () => {
    const entries = [
      le({ ts: 1, date: '2026-06-16', type: 'went_into_debt', actor: 'Карина', onBehalfOf: 'Леша' }),
      le({ ts: 2, date: '2026-06-17', type: 'cleaned', actor: 'Леша', onBehalfOf: 'Карина' }),
    ]
    expect(foldDebt(entries)).toEqual({ Леша: 0, Карина: 0 })
  })

  it('forgiven subtracts one from the debtor (onBehalfOf)', () => {
    const entries = [
      le({ ts: 1, date: '2026-06-16', type: 'went_into_debt', actor: 'Карина', onBehalfOf: 'Леша' }),
      le({ ts: 2, date: '2026-06-16', type: 'forgiven', actor: 'Карина', onBehalfOf: 'Леша' }),
    ]
    expect(foldDebt(entries)).toEqual({ Леша: 0, Карина: 0 })
  })

  it('latest entry per date wins for day outcomes (reset reverses the day)', () => {
    const entries = [
      le({ ts: 1, date: '2026-06-16', type: 'went_into_debt', actor: 'Карина', onBehalfOf: 'Леша' }),
      le({ ts: 2, date: '2026-06-16', type: 'reset', actor: 'Леша' }),
    ]
    expect(foldDebt(entries)).toEqual({ Леша: 0, Карина: 0 })
  })

  it('forgiven is independent of per-date dedup and stacks', () => {
    const entries = [
      le({ ts: 1, date: '2026-06-14', type: 'went_into_debt', actor: 'Карина', onBehalfOf: 'Леша' }),
      le({ ts: 2, date: '2026-06-16', type: 'went_into_debt', actor: 'Карина', onBehalfOf: 'Леша' }),
      le({ ts: 3, date: '2026-06-16', type: 'forgiven', actor: 'Карина', onBehalfOf: 'Леша' }),
    ]
    // two debts incurred, one forgiven → net 1
    expect(foldDebt(entries)).toEqual({ Леша: 1, Карина: 0 })
  })

  it('nets two-sided debt down via normalizeDebts', () => {
    const entries = [
      le({ ts: 1, date: '2026-06-15', type: 'went_into_debt', actor: 'Леша', onBehalfOf: 'Карина' }),
      le({ ts: 2, date: '2026-06-16', type: 'went_into_debt', actor: 'Карина', onBehalfOf: 'Леша' }),
    ]
    // each owes one → nets to zero
    expect(foldDebt(entries)).toEqual({ Леша: 0, Карина: 0 })
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm --filter client exec vitest run widgets/ofelia-poop-duty/model/ledger.test.ts`
Expected: FAIL — `foldDebt`/`LedgerEntry` are not exported from `./ofelia-duty`.

- [ ] **Step 3: Add the schema, types, and helpers**

In `client/widgets/ofelia-poop-duty/model/ofelia-duty.ts`, immediately after the existing `const HistoryEventsSchema = ...` / `type NumberOfDebts = ...` lines (the schema block ~line 74–75), add:

```ts
export const LEDGER_KEY = 'ledger'

const LedgerTypeSchema = z.enum(['cleaned', 'went_into_debt', 'reset', 'forgiven'])
export type LedgerType = z.infer<typeof LedgerTypeSchema>

const LedgerEntrySchema = z.object({
  id: z.string(),
  ts: z.number(),
  ip: z.string(),
  date: z.string(),
  type: LedgerTypeSchema,
  actor: PersonSchema,
  onBehalfOf: PersonSchema.optional(),
  by: PersonSchema,
})

export type LedgerEntry = z.infer<typeof LedgerEntrySchema>
export type LedgerEntryDraft = Omit<LedgerEntry, 'id' | 'ts' | 'ip'>
export const LedgerEntriesSchema = z.array(LedgerEntrySchema)

const DAY_OUTCOME_TYPES: ReadonlySet<LedgerType> = new Set(['cleaned', 'went_into_debt', 'reset'])

export function latestOutcomesByDate(entries: LedgerEntry[]): Map<string, LedgerEntry> {
  const latest = new Map<string, LedgerEntry>()
  for (const entry of entries) {
    if (!DAY_OUTCOME_TYPES.has(entry.type)) continue
    const prev = latest.get(entry.date)
    if (!prev || entry.ts > prev.ts) latest.set(entry.date, entry)
  }
  return latest
}

export function foldDebt(entries: LedgerEntry[]): NumberOfDebts {
  const debt: Partial<NumberOfDebts> = {}

  for (const entry of latestOutcomesByDate(entries).values()) {
    if (entry.type === 'went_into_debt' && entry.onBehalfOf) {
      debt[entry.onBehalfOf] = (debt[entry.onBehalfOf] ?? 0) + 1
    } else if (entry.type === 'cleaned' && entry.onBehalfOf) {
      debt[entry.actor] = (debt[entry.actor] ?? 0) - 1
    }
  }

  for (const entry of entries) {
    if (entry.type === 'forgiven' && entry.onBehalfOf) {
      debt[entry.onBehalfOf] = (debt[entry.onBehalfOf] ?? 0) - 1
    }
  }

  return normalizeDebts(debt)
}
```

(`normalizeDebts` already exists further down the file and is hoisted as a function declaration, so the forward reference is fine.)

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm --filter client exec vitest run widgets/ofelia-poop-duty/model/ledger.test.ts`
Expected: PASS (8 tests).

- [ ] **Step 5: Commit**

```bash
git add client/widgets/ofelia-poop-duty/model/ofelia-duty.ts client/widgets/ofelia-poop-duty/model/ledger.test.ts
git commit -m "feat(ofelia): ledger schema + foldDebt pure helper

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

### Task 2: `resolveDays` — per-day status map

Adds the second pure fold: the latest day-outcome per date mapped to a `{ status, actor, onBehalfOf? }` resolution. Replaces the old `getDayStatus(events, date)`.

**Files:**
- Modify: `client/widgets/ofelia-poop-duty/model/ofelia-duty.ts` (add after `foldDebt`)
- Test: `client/widgets/ofelia-poop-duty/model/ledger.test.ts` (extend)

**Interfaces:**
- Consumes: `latestOutcomesByDate`, `LedgerEntry` (Task 1).
- Produces:
  - `type DayResolution = { status: 'closed' | 'pending'; type: LedgerType; actor: Person; onBehalfOf?: Person }`
  - `function resolveDays(entries: LedgerEntry[]): Map<string, DayResolution>`

- [ ] **Step 1: Write the failing test**

Append to `client/widgets/ofelia-poop-duty/model/ledger.test.ts`:

```ts
import { resolveDays } from './ofelia-duty'

describe('resolveDays', () => {
  it('marks a cleaned day closed with its actor', () => {
    const map = resolveDays([le({ date: '2026-06-16', type: 'cleaned', actor: 'Леша' })])
    expect(map.get('2026-06-16')).toMatchObject({ status: 'closed', type: 'cleaned', actor: 'Леша' })
  })

  it('marks a went_into_debt day closed and carries onBehalfOf', () => {
    const map = resolveDays([
      le({ date: '2026-06-16', type: 'went_into_debt', actor: 'Карина', onBehalfOf: 'Леша' }),
    ])
    expect(map.get('2026-06-16')).toMatchObject({ status: 'closed', onBehalfOf: 'Леша' })
  })

  it('re-opens a day when the latest outcome is reset', () => {
    const map = resolveDays([
      le({ ts: 1, date: '2026-06-16', type: 'cleaned', actor: 'Леша' }),
      le({ ts: 2, date: '2026-06-16', type: 'reset', actor: 'Леша' }),
    ])
    expect(map.get('2026-06-16')?.status).toBe('pending')
  })

  it('takes the latest by ts and keeps dates independent', () => {
    const map = resolveDays([
      le({ ts: 2, date: '2026-06-16', type: 'cleaned', actor: 'Леша' }),
      le({ ts: 1, date: '2026-06-16', type: 'went_into_debt', actor: 'Карина', onBehalfOf: 'Леша' }),
      le({ ts: 1, date: '2026-06-17', type: 'cleaned', actor: 'Карина' }),
    ])
    expect(map.get('2026-06-16')?.type).toBe('cleaned')
    expect(map.get('2026-06-17')?.actor).toBe('Карина')
    expect(map.size).toBe(2)
  })

  it('ignores forgiven entries (not a day outcome)', () => {
    const map = resolveDays([le({ date: '2026-06-16', type: 'forgiven', actor: 'Карина', onBehalfOf: 'Леша' })])
    expect(map.has('2026-06-16')).toBe(false)
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm --filter client exec vitest run widgets/ofelia-poop-duty/model/ledger.test.ts`
Expected: FAIL — `resolveDays` not exported.

- [ ] **Step 3: Implement `resolveDays`**

In `ofelia-duty.ts`, directly after `foldDebt`, add:

```ts
export type DayResolution = {
  status: 'closed' | 'pending'
  type: LedgerType
  actor: Person
  onBehalfOf?: Person
}

export function resolveDays(entries: LedgerEntry[]): Map<string, DayResolution> {
  const out = new Map<string, DayResolution>()
  for (const [date, entry] of latestOutcomesByDate(entries)) {
    out.set(date, {
      status: entry.type === 'reset' ? 'pending' : 'closed',
      type: entry.type,
      actor: entry.actor,
      ...(entry.onBehalfOf ? { onBehalfOf: entry.onBehalfOf } : {}),
    })
  }
  return out
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm --filter client exec vitest run widgets/ofelia-poop-duty/model/ledger.test.ts`
Expected: PASS (13 tests total).

- [ ] **Step 5: Commit**

```bash
git add client/widgets/ofelia-poop-duty/model/ofelia-duty.ts client/widgets/ofelia-poop-duty/model/ledger.test.ts
git commit -m "feat(ofelia): resolveDays per-day status map

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

### Task 3: Read-only storage-key extender (`withStorageKeyReadonly`)

Extract the read-only "mirror an atom from a storage key over `subscribe`" pattern (hand-rolled today in `historyEvents` and `ofelia-comments`, and needed again by the ledger) into a reusable extender beside `withStorageKey`. Unlike `withStorageKey` it has **no write-back** — the atom never PUTs itself, which matches append-only / server-owned values written via `api.append`.

**Files:**
- Modify: `client/src/storage/model/reatom/reatom-storage.ts`
- Test: `client/src/storage/model/reatom/reatom-storage.test.ts` (extend)

**Interfaces:**
- Consumes: `StorageApi`, `withConnectHook`, `wrap`, `AtomState`, `Atom`, `Ext` (all already imported in the file).
- Produces:
  - `type WithStorageKeyReadonlyOptions<T> = { api: StorageApi; key: string; schema?: z.ZodType<T>; fallback: T }`
  - `withStorageKeyReadonly<Target extends Atom>(opts): Ext<Target, Record<string, never>>` — subscribes on connect, `target.set(event.value ?? fallback)` on delivery, drops errors, never writes back.

- [ ] **Step 1: Write the failing test**

Append to `client/src/storage/model/reatom/reatom-storage.test.ts` and add `withStorageKeyReadonly` to the existing `import { … } from './reatom-storage'` line:

```ts
describe('withStorageKeyReadonly', () => {
  beforeEach(() => {
    installFakeBroadcastChannel()
  })
  afterEach(() => {
    vi.unstubAllGlobals()
  })

  it('mirrors the stored value, applies fallback on delete, and never writes back', async () => {
    const real = createDexieStorage(instanceNamespace('inst-ro'))
    const set = vi.fn(real.set)
    const api = { ...real, set } as StorageApi
    await real.set('led', [1, 2, 3])

    const led = atom<number[]>([], 'test.led').extend(
      withStorageKeyReadonly({ api, key: 'led', fallback: [] }),
    )

    await context.start(async () => {
      const off = led.subscribe(() => {})
      const seeded = wrap(() => expect(led()).toEqual([1, 2, 3]))
      await vi.waitFor(() => seeded())
      await real.delete('led')
      const emptied = wrap(() => expect(led()).toEqual([]))
      await vi.waitFor(() => emptied())
      off()
    })

    expect(set).not.toHaveBeenCalled()
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm --filter client exec vitest run src/storage/model/reatom/reatom-storage.test.ts -t "withStorageKeyReadonly"`
Expected: FAIL — `withStorageKeyReadonly` is not exported.

- [ ] **Step 3: Implement the extender**

In `client/src/storage/model/reatom/reatom-storage.ts`, after `withStorageKey`, add:

```ts
export type WithStorageKeyReadonlyOptions<T> = {
  api: StorageApi
  key: string
  schema?: z.ZodType<T>
  /** Applied when the key is absent/deleted (StorageChange.value === null). */
  fallback: T
}

/**
 * Read-only reactive mirror of a single key over StorageApi.subscribe. Unlike
 * withStorageKey there is NO write-back: the atom never PUTs itself. Use for
 * append-only / server-owned values written via api.append (server-stamped
 * id/ts/ip), never api.set.
 */
export const withStorageKeyReadonly =
  <Target extends Atom>({
    api,
    key,
    schema,
    fallback,
  }: WithStorageKeyReadonlyOptions<AtomState<Target>>): Ext<Target, Record<string, never>> =>
  (target) => {
    target.extend(
      withConnectHook(() =>
        api.subscribe<AtomState<Target>>(
          key,
          wrap((event) => {
            if (event instanceof Error) return
            target.set(event.value ?? fallback)
          }),
          schema,
        ),
      ),
    )
    return {}
  }
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm --filter client exec vitest run src/storage/model/reatom/reatom-storage.test.ts -t "withStorageKeyReadonly"`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add client/src/storage/model/reatom/reatom-storage.ts client/src/storage/model/reatom/reatom-storage.test.ts
git commit -m "feat(storage): withStorageKeyReadonly extender for append-only keys

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

### Task 4: Convert model + view-model + wiring to the ledger

The central conversion. `numberOfDebts` becomes a `computed`; the `debts` stored atom and the per-week `historyEvents` subscription are removed; the four actions each do one `append` to `LEDGER_KEY`; `undo` works on any closed day; `view-model.ts` reads `dayResolution`; `OfeliaPoopDuty.tsx` passes the target date to `undo`. Model, view-model, wiring, and both test files change together because the model's exported surface (`historyEvents` → `dayResolution`, removal of `getDayStatus`) is consumed by the view-model — they form one reviewer gate.

**Files:**
- Modify: `client/tsconfig.json` (add `ES2023` to `lib` for `toSorted`)
- Modify: `client/widgets/ofelia-poop-duty/model/ofelia-duty.ts`
- Modify: `client/widgets/ofelia-poop-duty/ui/view-model.ts`
- Modify: `client/widgets/ofelia-poop-duty/ui/OfeliaPoopDuty.tsx:61`
- Test: `client/widgets/ofelia-poop-duty/model/ofelia-duty.test.ts` (rewrite affected blocks)
- Test: `client/widgets/ofelia-poop-duty/ui/view-model.test.ts` (rewrite affected blocks)

**Interfaces:**
- Consumes: `foldDebt`, `resolveDays`, `LedgerEntry`, `LedgerEntriesSchema`, `LedgerEntryDraft`, `LEDGER_KEY`, `DayResolution` (Tasks 1–2); `withStorageKeyReadonly` from `@/storage/model/reatom/reatom-storage` (Task 3); existing `getDebtDays`, `getOfeliaDutyByDate`, `otherPerson`, `DUTY_ROTATION`, `weekStartISO`, `IP_TAIL_LENGTH`.
- Produces (model return shape changes):
  - adds `dayResolution: Computed<Map<string, DayResolution>>` (the `ledger` atom stays internal — the computeds connect it)
  - `numberOfDebts: Computed<NumberOfDebts>` (was a stored atom)
  - removes `historyEvents` from the return
  - `confirmClean/goIntoDebt/forgive` keep `(date?: Temporal.PlainDate)`; `undo` becomes `(date?: Temporal.PlainDate)`
  - `HistoryEntryView.type` changes from `HistoryEventType` to `LedgerType`
- Produces (view-model):
  - `OfeliaDutySources` swaps `historyEvents: AtomLike<HistoryEvent[]>` → `dayResolution: AtomLike<Map<string, DayResolution>>`
  - `resolveSelected(week, selectedDate, resolution, debts, today)` — third arg is the resolution map; `canUndo = status === 'closed'`

- [ ] **Step 1: Rewrite the model read-side**

In `ofelia-duty.ts`:

1. Update the `HistoryEntryView` type to use `LedgerType`:

```ts
export type HistoryEntryView = {
  id: string
  date: string
  type: LedgerType
  actor: Person
  onBehalfOf?: Person
  by: Person
  ipTail: string
}
```

2. Delete the now-unused history-journal declarations: `HistoryEventTypeSchema`, `HistoryEventType`, `HistoryEventSchema`, `HistoryEvent`, `HistoryEventsSchema`, `HistoryEventDraft`. **Keep** `NumberOfDebtsSchema` and the `NumberOfDebts` type — `normalizeDebts`/`foldDebt`/`numberOfDebts` still use that type even though the `debts` storage key is gone.

3. Replace the `numberOfDebts` stored atom (lines ~84–90) and the `historyEvents` atom + `onHistoryEvent`/`offHistoryEvents` + the `effect(...)` subscription block (lines ~136–163) and the old `historyView` computed (lines ~165–180) with:

```ts
const ledger = atom<LedgerEntry[]>([], 'ofeliaDuty.ledger').extend(
  withStorageKeyReadonly({
    api: storage.shared.server,
    key: LEDGER_KEY,
    schema: LedgerEntriesSchema,
    fallback: [],
  }),
)

const numberOfDebts = computed(() => foldDebt(ledger()), 'ofeliaDuty.numberOfDebts')
const dayResolution = computed(() => resolveDays(ledger()), 'ofeliaDuty.dayResolution')

const historyView = computed<HistoryEntryView[]>(() => {
  const week = viewWeekStart()
  if (!week) return []
  const weekIso = week.toString()
  return ledger()
    .filter((entry) => weekStartISO(Temporal.PlainDate.from(entry.date)) === weekIso)
    .toSorted((a, b) => b.ts - a.ts)
    .map((entry) => ({
      id: entry.id,
      date: entry.date,
      type: entry.type,
      actor: entry.actor,
      ...(entry.onBehalfOf ? { onBehalfOf: entry.onBehalfOf } : {}),
      by: entry.by,
      ipTail: entry.ip.slice(-IP_TAIL_LENGTH),
    }))
}, 'ofeliaDuty.historyView')
```

4. Replace `undoAvailable` (lines ~182–192) with a resolution-based, any-day version:

```ts
const undoAvailable = computed(() => {
  const day = selectedDate() ?? today()
  if (day == null) return false
  return dayResolution().get(day.toString())?.status === 'closed'
}, 'ofeliaDuty.undoAvailable')
```

5. In the `debtDays` computed (lines ~194–206), drop the `!debts` guard (it is never null now):

```ts
const debtDays = computed(() => {
  const currentToday = today()
  if (!currentToday) return null
  return getDebtDays(numberOfDebts(), currentToday).reduce((acc, debtDay) => {
    acc.set(debtDay.date.toString(), debtDay)
    return acc
  }, new Map<string, DebtDay>())
}, 'ofeliaDuty.debtDays')
```

6. Remove `getDayStatus` (the exported function ~lines 440–458) and `historyKey` (~lines 411–413) — both are now unused. Imports: add `withStorageKeyReadonly` from `@/storage/model/reatom/reatom-storage`; remove `withStorageKey` and `effect`; keep `withConnectHook` (still used by `currentUser`, and by the cleanup hook in Task 7), `withChangeHook` (`currentUser`), and `wrap`. Update the model `return { … }` object: remove `historyEvents`, add `dayResolution`, keep `historyView`, `numberOfDebts`, `undoAvailable`.

7. In `client/tsconfig.json`, add `"ES2023"` to the `lib` array (currently `["ES2022", "DOM", "DOM.Iterable", "ESNext.Temporal"]`) so `Array.prototype.toSorted` — used in `historyView` above — typechecks. Runtime already supports it (target stays `ES2022`, which does not downlevel `toSorted`; the deploy targets modern Node/browsers).

- [ ] **Step 2: Rewrite the four actions to a single append**

Replace `confirmClean`/`goIntoDebt`/`forgive`/`undo` (lines ~234–327) with:

```ts
const confirmClean = action(async (date?: Temporal.PlainDate) => {
  const currentToday = today()
  if (currentToday == null) return
  const target = date ?? selectedDate() ?? currentToday
  const debtDay = getDebtDays(numberOfDebts(), currentToday).find((day) => day.date.equals(target))
  const actor = debtDay?.person ?? getOfeliaDutyByDate(target)

  const draft: LedgerEntryDraft = {
    date: target.toString(),
    type: 'cleaned',
    actor,
    by: currentUser(),
    ...(debtDay ? { onBehalfOf: getOfeliaDutyByDate(target) } : {}),
  }
  const result = await wrap(storage.shared.server.append(LEDGER_KEY, draft))
  if (result instanceof Error) throw result
}, 'ofeliaDuty.confirmClean').extend(withAsyncData({ status: true }))

const goIntoDebt = action(async (date?: Temporal.PlainDate) => {
  const currentToday = today()
  if (currentToday == null) return
  const target = date ?? selectedDate() ?? currentToday
  const duty = getOfeliaDutyByDate(target)

  const draft: LedgerEntryDraft = {
    date: target.toString(),
    type: 'went_into_debt',
    actor: otherPerson(duty),
    onBehalfOf: duty,
    by: currentUser(),
  }
  const result = await wrap(storage.shared.server.append(LEDGER_KEY, draft))
  if (result instanceof Error) throw result
}, 'ofeliaDuty.goIntoDebt').extend(withAsyncData({ status: true }))

const forgive = action(async (date?: Temporal.PlainDate) => {
  const currentToday = today()
  if (currentToday == null) return
  const target = date ?? selectedDate() ?? currentToday
  const debts = numberOfDebts()
  const debtor = DUTY_ROTATION.find((person) => (debts[person] ?? 0) > 0)
  if (!debtor) return

  const draft: LedgerEntryDraft = {
    date: target.toString(),
    type: 'forgiven',
    actor: otherPerson(debtor),
    onBehalfOf: debtor,
    by: currentUser(),
  }
  const result = await wrap(storage.shared.server.append(LEDGER_KEY, draft))
  if (result instanceof Error) throw result
}, 'ofeliaDuty.forgive').extend(withAsyncData({ status: true }))

const undo = action(async (date?: Temporal.PlainDate) => {
  const target = date ?? selectedDate() ?? today()
  if (target == null) return
  const resolution = dayResolution().get(target.toString())
  if (resolution?.status !== 'closed') return

  const draft: LedgerEntryDraft = {
    date: target.toString(),
    type: 'reset',
    actor: resolution.actor,
    by: currentUser(),
  }
  const result = await wrap(storage.shared.server.append(LEDGER_KEY, draft))
  if (result instanceof Error) throw result
}, 'ofeliaDuty.undo').extend(withAsyncData({ status: true }))
```

- [ ] **Step 3: Update the view-model to read `dayResolution`**

In `client/widgets/ofelia-poop-duty/ui/view-model.ts`:

1. Replace the imports line `import { DUTY_ROTATION, getDayStatus, isOverDebtWarning } from '../model/ofelia-duty'` and `import type { HistoryEvent, Person } from '../model/ofelia-duty'` with:

```ts
import { DUTY_ROTATION, isOverDebtWarning } from '../model/ofelia-duty'
import type { DayResolution, Person } from '../model/ofelia-duty'
```

2. Change `resolveSelected` to take the resolution map and undo any closed day:

```ts
export function resolveSelected(
  week: DutyDay[],
  selectedDate: Temporal.PlainDate | null,
  resolution: Map<string, DayResolution>,
  debts: Partial<Record<Person, number>>,
  today: Temporal.PlainDate | null,
): SelectedDayView | null {
  if (week.length === 0) return null

  const explicit = selectedDate ? week.find((day) => day.date.equals(selectedDate)) : undefined
  const entry = explicit ?? week.find((day) => day.isToday) ?? week[0]

  const person = entry.debt ?? entry.duty
  const status = resolution.get(entry.date.toString())?.status ?? 'pending'

  return {
    iso: entry.date.toString(),
    person,
    isDebtDay: entry.debt != null,
    status,
    canUndo: status === 'closed',
    debtRemaining: debts[person] ?? 0,
    isFuture: today != null && Temporal.PlainDate.compare(entry.date, today) > 0,
  }
}
```

3. In `OfeliaDutySources`, replace `historyEvents: AtomLike<HistoryEvent[]>` with `dayResolution: AtomLike<Map<string, DayResolution>>`.

4. In `makeOfeliaViewModel`, change the `selected` computed call from `duty.historyEvents()` to `duty.dayResolution()`:

```ts
  const selected = computed(() => {
    const week = duty.currentWeek()
    if (!week) return null
    return resolveSelected(
      week,
      duty.selectedDate(),
      duty.dayResolution(),
      duty.numberOfDebts() ?? {},
      duty.today(),
    )
  }, 'ofelia.selected')
```

- [ ] **Step 4: Pass the target date to `undo` in the wiring**

In `client/widgets/ofelia-poop-duty/ui/OfeliaPoopDuty.tsx`, replace line 61:

```ts
          onUndo: wrap(() => {
            const date = targetDate()
            if (date) dutyModel.undo(date)
          }),
```

- [ ] **Step 5: Rewrite the affected model tests**

In `client/widgets/ofelia-poop-duty/model/ofelia-duty.test.ts`:

1. Replace the imports from `./ofelia-duty` — drop `getDayStatus`, `historyKey`, `HistoryEvent`, `HistoryEntryView` if unused here; add `LEDGER_KEY`, `LedgerEntry`. Keep `effectiveDuty`, `isDebtDay`, `isOverDebtWarning`, `otherPerson`, `weekStartISO`, `ofeliaDutyModel`, `DEBT_WARNING_THRESHOLD`, `IP_TAIL_LENGTH`.

2. Replace the `createHistoryStorage` helper and `ev` builder with a ledger version:

```ts
let seq = 0
const le = (o: Partial<LedgerEntry> = {}): LedgerEntry => ({
  id: `e${seq++}`,
  ts: seq,
  ip: '127.0.0.1',
  date: '2026-06-16',
  type: 'cleaned',
  actor: 'Леша',
  by: 'Леша',
  ...o,
})

function createLedgerStorage() {
  const api = createFakeStorage()
  const append = vi.fn(api.append)
  const subscribe = vi.fn(api.subscribe) as unknown as StorageApi['subscribe']
  const storage = createStorage({ ...api, append, subscribe })
  const emit = async (value: LedgerEntry[] | null) => {
    if (value === null) await api.delete(LEDGER_KEY)
    else await api.set(LEDGER_KEY, value)
  }
  return { storage, append, subscribe, emit }
}
```

3. Replace the action test blocks. Each now asserts a single `append` to `LEDGER_KEY` and never writes `debts`:

```ts
describe('ofeliaDutyModel.confirmClean', () => {
  it('on a plain day appends cleaned with no onBehalfOf', async () => {
    const { storage } = createLedgerStorage()
    const model = ofeliaDutyModel({ storage, timer: createFakeTimer({ today: D('2026-06-16') }) })
    await model.confirmClean(D('2026-06-17'))

    expect(storage.shared.server.append).toHaveBeenCalledWith(LEDGER_KEY, {
      date: '2026-06-17',
      type: 'cleaned',
      actor: 'Карина',
      by: 'Леша',
    })
    expect(storage.shared.server.set).not.toHaveBeenCalledWith('debts', expect.anything())
  })

  it('on a debt day appends cleaned with onBehalfOf for the debtor', async () => {
    const { storage, emit } = createLedgerStorage()
    const model = ofeliaDutyModel({ storage, timer: createFakeTimer({ today: D('2026-06-16') }) })

    await context.start(async () => {
      const off = model.numberOfDebts.subscribe(() => {})
      const userOff = model.currentUser.subscribe(() => {})
      model.currentUser.set('Карина')
      // Карина owes one (Леша covered her 2026-06-15 duty). getDebtDays assigns her to
      // the next day Леша is scheduled — 2026-06-16 — so cleaning it repays the debt.
      await emit([le({ ts: 1, date: '2026-06-15', type: 'went_into_debt', actor: 'Леша', onBehalfOf: 'Карина' })])
      await vi.waitFor(() => expect(model.numberOfDebts()).toEqual({ Леша: 0, Карина: 1 }))

      await model.confirmClean(D('2026-06-16'))
      off()
      userOff()
    })

    expect(storage.shared.server.append).toHaveBeenCalledWith(LEDGER_KEY, {
      date: '2026-06-16',
      type: 'cleaned',
      actor: 'Карина',
      onBehalfOf: 'Леша',
      by: 'Карина',
    })
  })
})

describe('ofeliaDutyModel.goIntoDebt', () => {
  it('appends went_into_debt for the scheduled person', async () => {
    const { storage } = createLedgerStorage()
    const model = ofeliaDutyModel({ storage, timer: createFakeTimer({ today: D('2026-06-16') }) })

    await context.start(async () => {
      const userOff = model.currentUser.subscribe(() => {})
      model.currentUser.set('Карина')
      await model.goIntoDebt(D('2026-06-16'))
      userOff()
    })

    expect(storage.shared.server.append).toHaveBeenCalledWith(LEDGER_KEY, {
      date: '2026-06-16',
      type: 'went_into_debt',
      actor: 'Карина',
      onBehalfOf: 'Леша',
      by: 'Карина',
    })
  })
})

describe('ofeliaDutyModel.forgive', () => {
  it('appends forgiven for the current debtor', async () => {
    const { storage, emit } = createLedgerStorage()
    const model = ofeliaDutyModel({ storage, timer: createFakeTimer({ today: D('2026-06-16') }) })

    await context.start(async () => {
      const off = model.numberOfDebts.subscribe(() => {})
      const userOff = model.currentUser.subscribe(() => {})
      model.currentUser.set('Карина')
      await emit([le({ ts: 1, date: '2026-06-14', type: 'went_into_debt', actor: 'Карина', onBehalfOf: 'Леша' })])
      await vi.waitFor(() => expect(model.numberOfDebts()).toEqual({ Леша: 1, Карина: 0 }))

      await model.forgive(D('2026-06-16'))
      off()
      userOff()
    })

    expect(storage.shared.server.append).toHaveBeenCalledWith(LEDGER_KEY, {
      date: '2026-06-16',
      type: 'forgiven',
      actor: 'Карина',
      onBehalfOf: 'Леша',
      by: 'Карина',
    })
  })

  it('is a no-op when nobody owes', async () => {
    const { storage } = createLedgerStorage()
    const model = ofeliaDutyModel({ storage, timer: createFakeTimer({ today: D('2026-06-16') }) })
    await context.start(async () => {
      await model.forgive(D('2026-06-16'))
    })
    expect(storage.shared.server.append).not.toHaveBeenCalled()
  })
})

describe('ofeliaDutyModel.undo', () => {
  it('reopens a closed day (incl. a past day) via a reset entry', async () => {
    const { storage, emit } = createLedgerStorage()
    const model = ofeliaDutyModel({ storage, timer: createFakeTimer({ today: D('2026-06-16') }) })

    await context.start(async () => {
      const off = model.dayResolution.subscribe(() => {})
      await emit([le({ ts: 1, date: '2026-06-15', type: 'cleaned', actor: 'Карина', by: 'Карина' })])
      await vi.waitFor(() => expect(model.dayResolution().get('2026-06-15')?.status).toBe('closed'))

      await model.undo(D('2026-06-15'))
      off()
    })

    expect(storage.shared.server.append).toHaveBeenCalledWith(LEDGER_KEY, {
      date: '2026-06-15',
      type: 'reset',
      actor: 'Карина',
      by: 'Карина',
    })
  })

  it('is a no-op when the target day is not closed', async () => {
    const { storage } = createLedgerStorage()
    const model = ofeliaDutyModel({ storage, timer: createFakeTimer({ today: D('2026-06-16') }) })
    await context.start(async () => {
      const off = model.dayResolution.subscribe(() => {})
      await model.undo(D('2026-06-16'))
      off()
    })
    expect(storage.shared.server.append).not.toHaveBeenCalled()
  })
})
```

4. Update the `ofeliaDutyModel server time` block: remove every `model.numberOfDebts.set(...)` (it is a computed now). The "returns null projections / blocks actions before sync" test keeps its `debtDays`/`currentWeek` null assertions (they gate on `today`), and asserts `goIntoDebt` did not append:

```ts
  it('returns null projections and blocks actions before the first sync', async () => {
    const { storage } = createLedgerStorage()
    const model = ofeliaDutyModel({ storage, timer: createFakeTimer() })

    expect(model.viewWeekStart()).toBeNull()
    expect(model.currentWeek()).toBeNull()
    expect(model.debtDays()).toBeNull()

    await model.goIntoDebt()
    expect(storage.shared.server.append).not.toHaveBeenCalled()
  })
```

In the remaining server-time tests (`derives the week…`, `exposes today…`, `navigates weeks…`, `selects a day…`) delete the `model.numberOfDebts.set({ … })` lines; the model needs no debt seed.

5. Replace the `historyView` describe block (was driven by `historyEvents.set`). The `ledger` atom is internal, so drive it by `emit`-ing ledger entries through the fake storage and asserting on `historyView` filtered to the viewed week:

```ts
describe('ofeliaDutyModel.historyView', () => {
  it('maps ledger entries for the viewed week newest-first with an IP tail', async () => {
    const { storage, emit } = createLedgerStorage()
    const model = ofeliaDutyModel({ storage, timer: createFakeTimer({ today: D('2026-06-16') }) })

    await context.start(async () => {
      const off = model.historyView.subscribe(() => {})
      await emit([
        le({ id: 'a', ts: 1, ip: '10.0.0.11', date: '2026-06-16', type: 'cleaned' }),
        le({ id: 'b', ts: 3, ip: '10.0.0.22', date: '2026-06-16', type: 'went_into_debt', actor: 'Карина', onBehalfOf: 'Леша' }),
        le({ id: 'c', ts: 2, ip: '10.0.0.33', date: '2026-06-16', type: 'forgiven', actor: 'Карина', onBehalfOf: 'Леша' }),
      ])
      await vi.waitFor(() => expect(model.historyView()).toHaveLength(3))
      const view = model.historyView()
      expect(view.map((entry) => entry.id)).toEqual(['b', 'c', 'a'])
      expect(view[0]).toMatchObject({ id: 'b', type: 'went_into_debt', onBehalfOf: 'Леша', ipTail: '.0.22' })
      off()
    })
  })
})
```

6. In the `ofelia-duty selectors` block, delete the `getDayStatus` test and the `weekStartISO/historyKey` test's `historyKey` assertion (keep the `weekStartISO` assertion):

```ts
  it('weekStartISO uses the Monday of the date week', () => {
    expect(weekStartISO(D('2026-06-16'))).toBe('2026-06-15')
  })
```

- [ ] **Step 6: Rewrite the affected view-model tests**

In `client/widgets/ofelia-poop-duty/ui/view-model.test.ts`:

1. Replace `import type { HistoryEvent, Person } from '../model/ofelia-duty'` with `import type { DayResolution, Person } from '../model/ofelia-duty'`.

2. Replace the `ev` builder with a resolution-map builder:

```ts
const closed = (
  date: string,
  o: Partial<DayResolution> = {},
): Map<string, DayResolution> =>
  new Map([[date, { status: 'closed', type: 'cleaned', actor: 'Карина', ...o }]])
```

3. Update the four `resolveSelected` calls that passed `[]`/`[ev(...)]` to pass a resolution map. The status/undo cases become:

```ts
  it('marks the day closed and undoable when it has a closing outcome', () => {
    const selected = resolveSelected(week(), null, closed('2026-06-16'), {}, D('2026-06-16'))
    expect(selected?.status).toBe('closed')
    expect(selected?.canUndo).toBe(true)
  })

  it('allows undo for any closed day, not only today', () => {
    const selected = resolveSelected(
      week(),
      D('2026-06-17'),
      closed('2026-06-17', { type: 'went_into_debt', onBehalfOf: 'Карина' }),
      {},
      D('2026-06-16'),
    )
    expect(selected?.status).toBe('closed')
    expect(selected?.canUndo).toBe(true)
  })
```

   For the cases that passed `[]` (no events), pass `new Map()`:
   `resolveSelected(week(), null, new Map(), {}, D('2026-06-16'))` etc. (the "defaults to today", "explicit selection", "off-week fallback", "empty week", "future" cases).

4. In the `makeOfeliaViewModel` test, replace the `historyEvents` source atom with a `dayResolution` one:

```ts
      dayResolution: atom<Map<string, DayResolution>>(new Map(), 'test.dayResolution'),
```

- [ ] **Step 7: Run the model + view-model suites and typecheck**

Run:
```bash
pnpm --filter client exec vitest run widgets/ofelia-poop-duty/model/ofelia-duty.test.ts widgets/ofelia-poop-duty/ui/view-model.test.ts widgets/ofelia-poop-duty/model/ledger.test.ts
pnpm typecheck
```
Expected: PASS for all three suites; `tsc --noEmit` clean (no references to removed `getDayStatus`/`historyEvents`/`historyKey`).

- [ ] **Step 8: Commit**

```bash
git add client/widgets/ofelia-poop-duty/model/ofelia-duty.ts client/widgets/ofelia-poop-duty/ui/view-model.ts client/widgets/ofelia-poop-duty/ui/OfeliaPoopDuty.tsx client/widgets/ofelia-poop-duty/model/ofelia-duty.test.ts client/widgets/ofelia-poop-duty/ui/view-model.test.ts
git commit -m "feat(ofelia): derive debt + day status from the ledger; single-append actions; undo any day

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

### Task 5: Week strip shows who actually cleaned

Additive: each day in `currentWeek` carries the resolved actor for closed days, and both the strip (`toWeekDays`) and the selected-day person prefer it. This surfaces "кто по итогу убрался" — e.g. a repaid debt day keeps showing the debtor who cleaned it, instead of reverting to the scheduled person once the debt is gone.

**Files:**
- Modify: `client/widgets/ofelia-poop-duty/model/ofelia-duty.ts` (the `currentWeek` computed)
- Modify: `client/widgets/ofelia-poop-duty/ui/view-model.ts` (`DutyDay`, `toWeekDays`, `resolveSelected`)
- Test: `client/widgets/ofelia-poop-duty/ui/view-model.test.ts` (extend)

**Interfaces:**
- Consumes: `dayResolution` (Task 4).
- Produces: `DutyDay` gains `resolvedActor: Person | null`; `toWeekDays`/`resolveSelected` person precedence becomes `resolvedActor ?? debt ?? duty`.

- [ ] **Step 1: Write the failing test**

Append to `view-model.test.ts`:

```ts
describe('resolved actor in the strip', () => {
  it('toWeekDays shows the resolved actor when present', () => {
    const w = week().map((d) =>
      d.date.toString() === '2026-06-17' ? { ...d, resolvedActor: 'Леша' as const } : d,
    )
    const days = toWeekDays(w, null)
    expect(days.find((d) => d.iso === '2026-06-17')?.person).toBe('Леша')
  })

  it('resolveSelected prefers the resolved actor over debt/duty', () => {
    const w = week().map((d) =>
      d.date.toString() === '2026-06-17' ? { ...d, resolvedActor: 'Леша' as const } : d,
    )
    const selected = resolveSelected(w, D('2026-06-17'), new Map(), {}, D('2026-06-16'))
    expect(selected?.person).toBe('Леша')
  })
})
```

Also update the existing `week()` builder and `toWeekDays` test in this file to include `resolvedActor: null` on each day (the field is now required on `DutyDay`).

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm --filter client exec vitest run widgets/ofelia-poop-duty/ui/view-model.test.ts`
Expected: FAIL — `resolvedActor` is not on `DutyDay` / not honored by `toWeekDays`.

- [ ] **Step 3: Add `resolvedActor` to `DutyDay` and honor it**

In `view-model.ts`:

```ts
export type DutyDay = {
  date: Temporal.PlainDate
  isToday: boolean
  day: number
  duty: Person
  debt: Person | null
  resolvedActor: Person | null
}
```

In `toWeekDays`, change the person field:

```ts
    person: day.resolvedActor ?? day.debt ?? day.duty,
```

In `resolveSelected`, change the person derivation:

```ts
  const person = entry.resolvedActor ?? entry.debt ?? entry.duty
```

- [ ] **Step 4: Populate `resolvedActor` in the model**

In `ofelia-duty.ts` `currentWeek` computed, read the resolution map and set the field:

```ts
const currentWeek = computed(() => {
  const currentToday = today()
  const weekStart = viewWeekStart()
  if (!currentToday || !weekStart) return null

  const days = debtDays()
  const resolution = dayResolution()

  return Array.from({ length: 7 }, (_, dayOffset) => {
    const date = weekStart.add({ days: dayOffset })
    const iso = date.toString()
    const duty = getOfeliaDutyByDate(date)
    const debt = days?.get(iso) ?? null
    const resolved = resolution.get(iso)

    return {
      date,
      isToday: date.equals(currentToday),
      day: date.day,
      duty,
      debt: debt?.person ?? null,
      resolvedActor: resolved?.status === 'closed' ? resolved.actor : null,
    }
  })
}, 'ofeliaDuty.currentWeek')
```

- [ ] **Step 5: Run tests + typecheck**

Run:
```bash
pnpm --filter client exec vitest run widgets/ofelia-poop-duty/ui/view-model.test.ts
pnpm typecheck
```
Expected: PASS; typecheck clean (all `DutyDay` literals include `resolvedActor`).

- [ ] **Step 6: Commit**

```bash
git add client/widgets/ofelia-poop-duty/model/ofelia-duty.ts client/widgets/ofelia-poop-duty/ui/view-model.ts client/widgets/ofelia-poop-duty/ui/view-model.test.ts
git commit -m "feat(ofelia): week strip shows the resolved actor for closed days

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

### Task 6: History list badge for `reset`

The history list now renders ledger entries, which include `reset` (re-open) rows. Add a readable badge so an undo shows up clearly in the audit list.

**Files:**
- Modify: `client/widgets/ofelia-poop-duty/ui/parts/HistoryList.tsx:10-19`
- Test: `client/widgets/ofelia-poop-duty/ui/parts/HistoryList.test.tsx` (extend)

**Interfaces:**
- Consumes: `HistoryEntryView.type` now includes `'reset'` (Task 4).
- Produces: `badgeLabel` returns `{ text: 'переоткрыто', tone: 'forgive' }` for `reset`.

- [ ] **Step 1: Write the failing test**

Append to `HistoryList.test.tsx`:

```ts
  it('renders "переоткрыто" badge for reset', () => {
    render(<HistoryList entries={[entry({ type: 'reset' })]} />)
    expect(screen.getByText('переоткрыто')).toBeInTheDocument()
  })
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm --filter client exec vitest run widgets/ofelia-poop-duty/ui/parts/HistoryList.test.tsx`
Expected: FAIL — no `переоткрыто` text (and TS: `'reset'` must be assignable to `HistoryEntryView['type']`, which it is after Task 4).

- [ ] **Step 3: Add the badge branch**

In `HistoryList.tsx` `badgeLabel`, add before the final `return null`:

```ts
  if (entry.type === 'reset') return { text: 'переоткрыто', tone: 'forgive' }
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm --filter client exec vitest run widgets/ofelia-poop-duty/ui/parts/HistoryList.test.tsx`
Expected: PASS (7 tests).

- [ ] **Step 5: Commit**

```bash
git add client/widgets/ofelia-poop-duty/ui/parts/HistoryList.tsx client/widgets/ofelia-poop-duty/ui/parts/HistoryList.test.tsx
git commit -m "feat(ofelia): history list badge for reset entries

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

### Task 7: Best-effort cleanup of legacy keys

One-shot, idempotent, fire-and-forget cleanup of the retired `debts` and `history:*` keys on model connect. Correctness does not depend on it (nothing reads those keys after Task 4); it only keeps the store tidy. errore-as-value: ignore failures.

**Files:**
- Modify: `client/widgets/ofelia-poop-duty/model/ofelia-duty.ts` (add a second connect hook to the `ledger` atom)
- Test: `client/widgets/ofelia-poop-duty/model/ofelia-duty.test.ts` (extend)

**Interfaces:**
- Consumes: `storage.shared.server.keys`, `storage.shared.server.delete`.
- Produces: no new exports — behavior only.

- [ ] **Step 1: Write the failing test**

Append a block to `ofelia-duty.test.ts`:

```ts
describe('legacy key cleanup', () => {
  it('deletes the retired debts and history:* keys on connect', async () => {
    const api = createFakeStorage()
    await api.set('debts', { Леша: 3, Карина: 0 })
    await api.set('history:2026-06-15', [{ id: 'x' }])
    const del = vi.fn(api.delete)
    const storage = createStorage({ ...api, delete: del, keys: vi.fn(api.keys) })

    const model = ofeliaDutyModel({ storage, timer: createFakeTimer({ today: D('2026-06-16') }) })
    await context.start(async () => {
      const off = model.numberOfDebts.subscribe(() => {})
      await vi.waitFor(() => expect(del).toHaveBeenCalledWith('debts'))
      await vi.waitFor(() => expect(del).toHaveBeenCalledWith('history:2026-06-15'))
      off()
    })
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm --filter client exec vitest run widgets/ofelia-poop-duty/model/ofelia-duty.test.ts -t "legacy key cleanup"`
Expected: FAIL — `delete` is never called.

- [ ] **Step 3: Add a second connect hook for cleanup**

In `ofelia-duty.ts`, chain a second `withConnectHook` onto the `ledger` atom, after the `withStorageKeyReadonly` from Task 4. Reatom composes connect hooks — both fire when the atom connects; the cleanup hook returns `void` (no disposer):

```ts
const ledger = atom<LedgerEntry[]>([], 'ofeliaDuty.ledger').extend(
  withStorageKeyReadonly({
    api: storage.shared.server,
    key: LEDGER_KEY,
    schema: LedgerEntriesSchema,
    fallback: [],
  }),
  // One-shot, best-effort cleanup of retired keys (composes with the helper's
  // subscription hook above; correctness never depends on it).
  withConnectHook(() => {
    void wrap(async () => {
      await storage.shared.server.delete('debts')
      const keys = await storage.shared.server.keys('history:')
      if (keys instanceof Error) return
      for (const key of keys) await storage.shared.server.delete(key)
    })()
  }),
)
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm --filter client exec vitest run widgets/ofelia-poop-duty/model/ofelia-duty.test.ts -t "legacy key cleanup"`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add client/widgets/ofelia-poop-duty/model/ofelia-duty.ts client/widgets/ofelia-poop-duty/model/ofelia-duty.test.ts
git commit -m "chore(ofelia): best-effort cleanup of retired debts/history keys

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

### Task 8: Update the e2e spec to seed the ledger

The "Простить" e2e seeds debt by PUT-ing the old `debts` key. Debt is now derived, so seed a `ledger` entry instead — a `went_into_debt` on a **past** Леша-duty day (`2026-06-14`) so today (`2026-06-16`) stays pending and "Простить" renders.

**Files:**
- Modify: `client/e2e/ofelia-duty.spec.ts:9,60-74`
- Test: the spec itself (Playwright).

**Interfaces:**
- Consumes: the running test server (`/api/storage`, `/api/test/reset`, `/api/test/time`) and `OfeliaPage`.
- Produces: no new exports.

- [ ] **Step 1: Swap the seed key from `debts` to `ledger`**

Replace line 9:

```ts
const LEDGER_URL = `/api/storage/${encodeURIComponent('w:t:ofelia-poop-duty:ledger')}`
```

Replace the seed PUT inside the "Простить" test (lines 62-63) with a ledger array carrying one debt-incurring entry on a past Леша-duty day:

```ts
  // Seed a past debt (Леша went into debt on 2026-06-14, a Леша-duty day) so the
  // global balance shows Леша:1 while today (2026-06-16) stays pending — the
  // secondary row, and thus "Простить", only renders while status is pending.
  await request.put(LEDGER_URL, {
    data: {
      value: [
        {
          id: 'seed-1',
          ts: 1,
          ip: '127.0.0.1',
          date: '2026-06-14',
          type: 'went_into_debt',
          actor: 'Карина',
          onBehalfOf: 'Леша',
          by: 'Карина',
        },
      ],
    },
  })
```

- [ ] **Step 2: Run the e2e spec**

Run: `pnpm --filter client exec playwright test e2e/ofelia-duty.spec.ts`
Expected: PASS — all 6 scenarios green (render, confirm, undo, В долг, Простить, persistence). The "В долг" and "undo" flows are unchanged because plain cleans/debts on today still close/reopen the day via the ledger SSE round-trip.

- [ ] **Step 3: Commit**

```bash
git add client/e2e/ofelia-duty.spec.ts
git commit -m "test(ofelia): e2e seeds the ledger instead of the retired debts key

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

## Final verification

- [ ] Full client suite: `pnpm --filter client test` — green.
- [ ] Typecheck: `pnpm typecheck` — clean.
- [ ] Lint: `pnpm lint` — clean.
- [ ] e2e: `pnpm --filter client exec playwright test e2e/ofelia-duty.spec.ts` — green.
- [ ] Grep for stragglers: no remaining references to `getDayStatus`, `historyEvents`, `historyKey`, `HistoryEvent`, or the `'debts'` storage key under `client/widgets/ofelia-poop-duty/` (except the e2e cleanup/test-server fixtures and the legacy-cleanup code in Task 7).
