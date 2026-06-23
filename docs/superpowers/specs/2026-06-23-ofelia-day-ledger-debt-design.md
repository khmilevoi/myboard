# Ofelia — per-day ledger as the single source of truth for debt

- **Branch:** `f6-ofelia-widget-finalisation`
- **Date:** 2026-06-23
- **Status:** Approved, ready for implementation planning

## 1. Goal & scope

Replace the standalone, mutable `debts` counter with a single **append-only per-day
ledger** that records the canonical outcome of each day (who ultimately cleaned, who
went into debt to whom) and derive every debt-related value from it.

In scope:

- New global ledger store (`ledger`) — the only source of truth for debt **and** the
  audit history list.
- Debt, day status (`closed`/`pending`), "who cleaned each day", the upcoming
  debt-day projection, and the history list — all become pure derivations of the
  ledger.
- Rewrite the four actions (`confirmClean`, `goIntoDebt`, `forgive`, `undo`) to a
  **single append** each; remove all direct `debts` writes.
- Generalise undo to **any day**, not only today.
- Retire the stored `debts` counter and the per-week `history:<week>` journal.

Out of scope:

- Comments (`comments:<week>`) — a separate store, untouched.
- The rotation rule, time-zone, server-time gating, week navigation UI, tier/layout
  structure — unchanged.
- Backfilling pre-migration history (we start the ledger from scratch — see §8).

## 2. Current system & the problem

Two independent stores in `shared.server` are mutated in lockstep:

- **`debts`** — `{ Леша, Карина }`, a mutable net counter, written directly by
  `confirmClean` / `goIntoDebt` / `forgive` (via `numberOfDebts.set`). This is the
  "current debt system".
- **`history:<weekMondayISO>`** — an append-only audit log of click events
  (`cleaned` / `went_into_debt` / `forgiven` / `cancelled`, each carrying
  `id`/`ts`/`ip`/`by`), subscribed **one week at a time**. It drives the history list
  and the `closed`/`pending` day status (`getDayStatus`).

Problems:

- **Dual source of truth.** The counter lives separately from the event log and is
  mutated in parallel. A failed write on one side, or out-of-order SSE delivery
  between the two clients, lets them drift. The author already flagged one asymmetry:
  `cancelled` (undo) re-opens the day but intentionally does **not** decrement
  `debts`.
- **No global reconstruction.** A single week's events can't reproduce the global
  debt; the counter is the only thing that "remembers" it.

## 3. Decisions (locked in during brainstorming)

1. **Single source of truth = a new canonical per-day ledger.** Debt is derived from
   it. The old per-week journal's audit role moves into the ledger (it is itself
   append-only and carries `by`/`ip`).
2. **Storage layout = one global append-only document** (`ledger`). The latest entry
   per date wins for day-outcome resolution; debt is a fold over the whole ledger.
   Growth is ~1 entry per action (a few per day at most) — negligible for years for a
   two-person rotation.
3. **Forgiveness = an adjustment entry in the same ledger** (`type: 'forgiven'`),
   counted as −1 to the debtor. It is **not** a day-outcome and does not participate
   in per-date dedup. The "простить один день" UX is preserved.
4. **Undo = a `reset` entry that supersedes a day's outcome, for any day.** Because
   debt is a pure fold over latest-per-date outcomes, re-opening a day automatically
   reverses its debt effect — removing the old asymmetry. Scope widens from
   "today only" to "any closed day".
5. **Migration = fresh start.** The ledger begins empty, debt is 0. The legacy
   `debts` and `history:<week>` keys are ignored and may be deleted (see §8). Losing
   ~one week of history is acceptable.
6. **Write path = a single append per action** (Variant 2). One store, one
   subscription, one schema; debt and audit cannot diverge because they are
   projections of the same array.

## 4. Data model

A new key in the existing **`shared.server`** scope (full key
`w:t:<typeId>:ledger`), holding an append-only array:

```ts
const LEDGER_KEY = 'ledger'

const LedgerTypeSchema = z.enum(['cleaned', 'went_into_debt', 'reset', 'forgiven'])

const LedgerEntrySchema = z.object({
  id: z.string(),        // server-stamped (randomUUID)
  ts: z.number(),        // server-stamped (Date.now) — ordering / latest-wins
  ip: z.string(),        // server-stamped — audit
  date: z.string(),      // ISO PlainDate — the day this entry is about
  type: LedgerTypeSchema,
  actor: PersonSchema,   // who cleaned / who went into debt / forgiven debtor
  onBehalfOf: PersonSchema.optional(), // scheduled person (debt repay / debt / forgive)
  by: PersonSchema,      // who performed the action (currentUser) — audit
})

type LedgerEntry = z.infer<typeof LedgerEntrySchema>
// Client passes only the draft; the server enriches id/ts/ip (handleAppend).
type LedgerEntryDraft = Omit<LedgerEntry, 'id' | 'ts' | 'ip'>
```

The server's `handleAppend` stamps `id`/`ts`/`ip`; the client sends only
`{ date, type, actor, onBehalfOf?, by }`.

Two conceptual groups:

- **Day-outcome entries** — `cleaned`, `went_into_debt`, `reset`. Describe the final
  state of a specific date. Deduped **latest-by-`ts` per `date`**.
- **Adjustment entries** — `forgiven`. A balance correction, not tied to a day's duty
  outcome; **not** deduped by date; each one counts independently.

## 5. Pure derivations

These are pure functions over `LedgerEntry[]`, unit-tested directly (mirroring the
existing `getDayStatus` / `getDebtDays` helpers).

### 5.1 Debt fold

```
foldDebt(entries) -> NumberOfDebts:
  outcomes   = entries where type ∈ {cleaned, went_into_debt, reset}
  latest     = for each date, the entry with the max ts
  debt       = { Леша: 0, Карина: 0 }
  for each latest outcome:
    went_into_debt          -> debt[onBehalfOf] += 1   // scheduled person now owes
    cleaned with onBehalfOf  -> debt[actor]      -= 1   // repaid a debt day by cleaning
    cleaned without onBehalfOf, reset -> no change
  for each entry where type == forgiven:
    debt[onBehalfOf] -= 1                               // creditor forgave the debtor
  return normalizeDebts(debt)                           // subtract the common minimum (unchanged)
```

`normalizeDebts` keeps its current behaviour (nets two-sided debt down to a single
positive debtor and clamps).

### 5.2 Day resolution

```
resolveDays(entries) -> Map<dateISO, DayResolution>:
  outcomes = entries where type ∈ {cleaned, went_into_debt, reset}
  for each date, take the latest by ts ->
    { status: type == 'reset' ? 'pending' : 'closed', type, actor, onBehalfOf? }
```

A date with no day-outcome entry, or whose latest outcome is `reset`, is `pending`.
This replaces `getDayStatus(events, date)`.

## 6. Model rewrite (`model/ofelia-duty.ts`)

- **Remove:** the `numberOfDebts` stored atom (`withStorageKey('debts')`), the
  per-week `historyEvents` subscription + `effect`, and every `numberOfDebts.set(...)`
  in the actions.
- **Add:** a single global `ledger` atom (no week dependency — global, server-backed,
  SSE-synced). The read-only "mirror an atom from a storage key over `subscribe`"
  pattern (also used by `historyEvents`/`ofelia-comments` today) is extracted into a
  reusable **`withStorageKeyReadonly`** extender beside `withStorageKey`. Unlike
  `withStorageKey` it has **no write-back** — the atom never PUTs itself, which is
  required for an append-only key written through `api.append` (server-stamped
  `id`/`ts`/`ip`), never `api.set`:

  ```ts
  const ledger = atom<LedgerEntry[]>([], 'ofeliaDuty.ledger').extend(
    withStorageKeyReadonly({
      api: storage.shared.server,
      key: LEDGER_KEY,
      schema: LedgerEntriesSchema,
      fallback: [],
    }),
  )
  ```

- **Derive:**
  - `numberOfDebts = computed(() => foldDebt(ledger()))` — keeps the same public name
    and shape, so `view-model.ts` (`toBalance`, `debtDays`, `canForgive`) is largely
    untouched.
  - `dayResolution = computed(() => resolveDays(ledger()))`.
  - `historyView` — filter `ledger()` to the viewed week
    (`weekStartISO(date) === viewWeekStart`), sort newest-first, map to
    `HistoryEntryView`. Replaces the per-week `historyEvents` subscription; week
    navigation now re-filters in memory (no re-subscribe).
  - `debtDays` — unchanged logic (`getDebtDays`), now fed by the derived
    `numberOfDebts`.
  - `currentWeek` — for each day, prefer the **resolved actor** (from `dayResolution`)
    on closed days; otherwise fall back to the projected debt-day person, then to the
    rotation duty. (Small extension to the per-day shape so the week strip can show
    who actually cleaned.)

## 7. Write paths (one append each)

All actions read the derived `numberOfDebts()` synchronously to decide the entry,
then perform **one** `append`. No direct debt mutation. errore convention: `append`
returns `StorageError | void`; on `Error`, `throw` (caught by `withAsyncData`).

- **`confirmClean(date?)`** — `target = date ?? selectedDate() ?? today`. If `target`
  is a projected debt day (`getDebtDays(numberOfDebts(), today)`), set
  `actor = debtor`, `onBehalfOf = scheduled`; else `actor = scheduled`, no
  `onBehalfOf`. Append `{ date, type: 'cleaned', actor, onBehalfOf?, by }`.
- **`goIntoDebt(date?)`** — `duty = getOfeliaDutyByDate(target)`. Append
  `{ date, type: 'went_into_debt', actor: otherPerson(duty), onBehalfOf: duty, by }`.
- **`forgive(date?)`** — `target = date ?? selectedDate() ?? today`. Guard: find a
  debtor with derived debt > 0; if none, no-op. Append
  `{ date: target, type: 'forgiven', actor: otherPerson(debtor), onBehalfOf: debtor, by }`.
  (`date` is only an audit timestamp anchor here — `forgiven` is an adjustment, not a
  day outcome, so it is **not** deduped per date.)
  **In-flight gate:** because each `forgiven` is additive (unlike the latest-wins day
  outcomes) and the debtor guard reads SSE-lagging derived debt, dispatching `forgive`
  again before the round-trip would stack extra `forgiven` and over-forgive — the surplus
  flips to the other person via `normalizeDebts` and persists. So the model exposes
  `forgivePending = forgive.pending() > 0`; the wiring ignores a `forgive` click while one
  is in flight, and the button disables on it (§9). One forgiveness per click; a multi-day
  debt is cleared with one click per round-trip.
- **`undo(date?)`** — `target = date ?? selectedDate() ?? today`. Guard: only if the
  target day currently resolves to `closed`. Append
  `{ date, type: 'reset', actor: <resolved actor or effectiveDuty(target)>, by }`.
  Debt for that day re-derives automatically.

## 8. Migration / cutover

- Fresh start: the `ledger` key does not exist → the subscription yields `[]` → debt
  0. No backfill.
- The legacy `debts` and `history:<week>` keys become dead data. Add a **one-time
  idempotent cleanup** on connect (best-effort, errore-as-value, ignore failures):
  `delete('debts')` and `delete` each `history:*` key (via `keys('history:')`). This
  is optional housekeeping — correctness does not depend on it, because nothing reads
  those keys after the rewrite.
- No server-side or schema migration is needed (the storage server is schemaless
  key/value).

## 9. UI changes

- **Undo for any closed day.** `view-model.ts`:
  - `SelectedDayView.status` comes from `dayResolution` instead of
    `getDayStatus(events, …)`.
  - `canUndo = status === 'closed'` (drop the `isToday` gate).
  - `resolveSelected` takes the resolution map instead of raw events.
  - Model `undoAvailable` likewise drops the `isToday` requirement.
- **History list** renders ledger entries. Add a badge for `reset`
  (e.g. «переоткрыто») in `HistoryList.badgeLabel`; existing `went_into_debt` /
  `forgiven` / `cleaned+onBehalfOf` badges unchanged.
- **Forgive in-flight gate.** `canForgive = (any debt > 0) && !forgivePending`; the
  «Простить» button is disabled while a forgive is in flight, so rapid presses cannot
  stack `forgiven` entries before the ledger round-trips.
- `DebtChips`, week strip, and tiers are otherwise visually unchanged — only their
  data source moves to the derived values.

## 10. Testing strategy (TDD)

Pure-function units (no atoms):

- `foldDebt`: plain clean (0), `went_into_debt` (+1 to scheduled), repay via
  `cleaned`+`onBehalfOf` (−1), `forgiven` (−1), `reset` reverses the day, latest-wins
  per date, two-sided netting via `normalizeDebts`, multiple `forgiven` stacking.
- `resolveDays`: `closed`/`pending`, `reset` re-opens, latest-by-`ts` wins, multiple
  dates independent.

Model (Reatom, fake storage + fake timer, `context.start`):

- Each action appends exactly the expected single draft and writes **no** `debts` key.
- `numberOfDebts` (now computed) reacts to emitted ledger values over the fake
  subscription.
- `undo` works for a past day, not only today; `forgive` no-op when nobody owes.
- View-model `canForgive` is false while `forgivePending` (the forgive in-flight gate).
- `historyView` filters to the viewed week and re-filters on week navigation without
  re-subscribing.

Regression guardrail: existing `view-model.test.ts` expectations for `toBalance` /
`debtDays` / `canForgive` stay green (same `numberOfDebts` shape). Update the
`ofelia-duty.test.ts` cases that asserted `debts` writes and `getDayStatus`.

## 11. Risks

- **Behaviour change — undo now reverses debt** (intended). Any test/e2e asserting
  the old "undo does not change debt" must be updated.
- **`confirmClean` repay detection** depends on the projection from derived debt at
  click time; the `onBehalfOf` decision is then frozen into the entry, so the fold
  never re-derives it — matching today's write-time decision.
- **e2e** (`ofelia-duty.spec.ts`) asserts `debts`-driven chips and undo; re-run and
  update once the model is converted (the SSE round-trip now carries `ledger`).
- **Forgive over-press** — additive `forgiven` + an SSE-lagging debtor guard could
  over-forgive on rapid presses. Mitigated by the `forgivePending` in-flight gate (one
  forgiveness per click). Residual: two clients forgiving the same debt within the SSE
  window can still over-forgive — accepted for a two-person widget. Day-outcome actions
  (`cleaned`/`went_into_debt`/`reset`) need no such gate — they are latest-wins per date,
  so repeated presses are idempotent.

## 12. Deliverables checklist

- [ ] `LedgerEntry` schema + `LEDGER_KEY` in `model/ofelia-duty.ts`.
- [ ] Pure `foldDebt` and `resolveDays` helpers + unit tests.
- [ ] `withStorageKeyReadonly` read-only extender in `storage/model/reatom/reatom-storage.ts` + test.
- [ ] `ledger` global atom via `withStorageKeyReadonly`; `numberOfDebts`/`dayResolution`/`historyView`
      as derivations; remove `debts` atom and per-week `historyEvents` subscription.
- [ ] Four actions rewritten to a single append; no `numberOfDebts.set`.
- [ ] `undo` generalised to any day; `view-model.ts` `status`/`canUndo` from
      resolution; `currentWeek` resolved-actor extension.
- [ ] `forgive` in-flight gate: model `forgivePending`, view-model `canForgive` gated,
      wiring ignores clicks while pending, button disabled.
- [ ] `HistoryList` badge for `reset`.
- [ ] Best-effort idempotent cleanup of legacy `debts` / `history:*` keys.
- [ ] Updated `ofelia-duty.test.ts` / `view-model.test.ts`; e2e re-run green.
