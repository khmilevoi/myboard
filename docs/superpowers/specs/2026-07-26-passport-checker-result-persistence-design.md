# Passport Checker Result Persistence Design

Follow-up to [Passport Checker Tier-Shared State
Design](./2026-07-25-passport-checker-tier-shared-state-design.md). That work
made a check result survive a tier switch by moving the model graph into a
per-instance store; the result still lives only in memory. This spec makes the
last successful check survive a reload and reach every device.

## Goal

Persist the last successful passport check in widget storage, restore it when
the widget mounts, and keep the displayed timestamp honest about how old that
result is.

## Problem

`viewState` is a plain `atom<ViewState>` created inside `makePassportCheckModel`
(`model/check-model.ts:90`). `passportInstance` keeps the model graph alive
across tier switches, but the graph itself is per placement and per tab: a
reload, a second device, or a second placement of the widget all start at
`idle`. The user must re-run a check — which drives a real browser automation on
the Pi — to see a status they already checked minutes ago.

The timestamp is also baked at check time: `formatCheckedAt` renders a `HH:MM`
string into the `success` view state (`model/check-model.ts:49`). Persisting
that string as-is would make yesterday's result read as today's.

## Decisions

- **Scope: `storage.shared.server`.** The passport status is a fact about the
  world, not a property of a tile, so one value serves every placement and every
  device. The server backend also gives live fanout over SSE for free.
- **Only the successful result is persisted.** Failures (`retryable`,
  `sessionRequired`, `invalidConfig`) describe the current attempt, not a stored
  fact, and stay in memory.
- **No TTL.** The stored result lives until the next successful check. The
  timestamp label carries the staleness information, so expiring the key would
  only throw away context the user can already see.
- **Timestamp is stored as epoch ms** and formatted at render.

## Non-goals

- No check history or audit journal. One key, last write wins.
- No auto-check on mount. Restoring a result does not trigger a new check.
- No surfacing of storage errors in the UI (see Failure modes).
- No loading skeleton for the hydration gap (see Failure modes).

## Design

### Storage key and schema

A new key `lastResult` in the widget-type scope — full key
`w:t:passport-checker:lastResult`. Nothing existing is renamed, so the storage-key
migration hazard in `CLAUDE.md` does not apply here. Declared in
`model/check-model.ts` next to `ViewState`:

```ts
export const PASSPORT_LAST_RESULT_KEY = 'lastResult'

export const lastResultSchema = z.object({
  status: z.number().int(),
  message: z.string(),
  checkedAt: z.number().int(), // epoch ms
})
export type StoredCheckResult = z.output<typeof lastResultSchema>
```

### Model structure

`makePassportCheckModel` takes a new `storage: StorageApi` option. The caller
passes `storage.shared.server`, so the model sees exactly the backend it uses and
knows nothing about scopes.

The single `viewState` atom splits into two atoms and a computed:

```ts
const lastResult = atom<StoredCheckResult | null>(null, 'passportCheck.lastResult').extend(
  withStorageKey({ api: storage, key: PASSPORT_LAST_RESULT_KEY, schema: lastResultSchema }),
)
const transient = atom<TransientState>({ kind: 'idle' }, 'passportCheck.transient')

const viewState = computed<ViewState>(() => {
  const current = transient()
  if (current.kind !== 'idle') return current
  const stored = lastResult()
  if (!stored) return { kind: 'idle' }
  return {
    kind: 'success',
    status: stored.status,
    message: stored.message,
    checkedAtLabel: formatCheckedAt(stored.checkedAt, now()),
  }
}, 'passportCheck.viewState')
```

`TransientState = Exclude<ViewState, { kind: 'success' }>`. `mapCheckError`
already returns only those variants; only its annotation changes.

`checkPassport` keeps its `pending` guard (now reading `transient()`), and on
success writes `lastResult.set({ status, message, checkedAt: now().getTime() })`
and returns `transient` to `idle`. The write to Valkey and the SSE fanout are
done by the change hook inside `withStorageKey`; the model never calls
`storage.set` directly. On failure it sets `transient` to the mapped error and
leaves the stored success untouched.

The public contract is unchanged: `viewState` stays a readable field of the
model, and `StandardTier`, `TinyTier` and `RecoveryModal` keep reading it.
Nothing outside `check-model.ts` writes to `viewState` today, so turning the atom
into a computed breaks no caller.

### Time formatting

A pure exported helper in `model/check-model.ts`:

```ts
export function formatCheckedAt(checkedAt: number, now: Date): string
```

Same local calendar day → `14:32`. Any other day → `24.07 14:32`. `StatusBanner`
keeps printing `проверено {view.checkedAtLabel}`; no markup changes.

The label is recomputed whenever `viewState` recomputes, i.e. when `transient` or
`lastResult` changes. A tab left open across midnight keeps showing yesterday's
result as `23:59` without a date until something else changes. Accepted; no
ticking timer.

### Wiring

`ui/PassportChecker.tsx` reads `storage` from `useWidgetContext` and passes
`storage.shared.server` into `makePassportCheckModel`. The dev harness already
builds `storage` through `makeHostRuntime().makeWidgetStorage(...)`
(`dev/harness.tsx:25`) and needs no change.

## Failure modes and edge cases

- **Hydration gap.** The first frame renders `idle` — the description and the
  "Проверить" button — and switches to the success banner tens of milliseconds
  later. No skeleton state is added: it would mean a new variant in `ViewState`
  and edits in all three render sites for a flash on a LAN.
- **Storage read failure.** No value arrives, the widget shows `idle` and stays
  fully usable. The `error` and `isLoading` atoms from the extension are not read.
- **Storage write failure.** `withStorageKey` deliberately keeps the optimistic
  local value and only records the error, so the user still sees their own
  result; it simply did not reach other devices.
- **Live update from another device.** While `transient` is `idle`, a result
  arriving over SSE is displayed immediately. If this screen is mid-check or
  showing an error, `transient` masks it until the next check. Intentional.
- **Concurrent checks.** Within one model the `pending` guard still applies.
  Across devices the last write wins, which is the correct semantics for a
  "latest result" key.
- **Two placements.** The key is type-scoped, so two placements of the widget on
  the board now show the same result.

## Testing

New tests in `model/check-model.test.ts`, with the model built over
`createFakeStorage()` from `widget-runtime/storage/test/fakes`:

- `formatCheckedAt`: same day → `HH:MM`; another day → `DD.MM HH:MM`; exactly 24
  hours earlier at the same wall-clock time takes the dated branch.
- A successful check writes `{ status, message, checkedAt }` under `lastResult`.
- A pre-seeded key hydrates `viewState` to `success` with the formatted label,
  with no `invoke` call.
- A failed check renders `retryable` and leaves the stored success untouched.

Connect hooks only run on a connected atom, so the reactive cases connect the
graph with `viewState.subscribe(() => {})`. `ofelia-poop-duty` gave up on that in
its model test and moved the equivalent coverage into its UI test; if the connect
frame turns out not to work here either, these three cases move to
`PassportChecker.test.tsx` the same way.

UI tests: `ui/PassportChecker.test.tsx` and `ui/recovery-flow.test.tsx` currently
build a real `makeHostRuntime().makeWidgetStorage(...)`. That was harmless while
nothing used storage, but `shared.server` would now issue HTTP requests to
`/api/storage` from jsdom. Both switch to a fake `WidgetStorage` over
`createFakeStorage()`, mirroring the ofelia UI test. One new case: with the key
pre-seeded, the widget renders the success banner on mount without a click.

Mechanical updates, no new logic: `model/recovery-flow.test.ts`,
`ui/RecoveryModal.test.tsx` and `ui/recovery-modal-radix-stack.test.tsx` build the
model directly and gain the `storage` option.

## Files touched

| File | Change |
| --- | --- |
| `model/check-model.ts` | key, schema, `lastResult`, `transient`, `viewState` computed, `formatCheckedAt` |
| `ui/PassportChecker.tsx` | pass `storage.shared.server` into the factory |
| `model/check-model.test.ts` | new persistence and formatting cases |
| `ui/PassportChecker.test.tsx` | fake storage, restore-on-mount case |
| `ui/recovery-flow.test.tsx` | fake storage |
| `model/recovery-flow.test.ts`, `ui/RecoveryModal.test.tsx`, `ui/recovery-modal-radix-stack.test.tsx` | new `storage` option |

## Verification

- `pnpm --filter widgets-passport-checker test`
- `pnpm check` from the worktree

The widget has no Playwright specs; the e2e suite is not touched.
