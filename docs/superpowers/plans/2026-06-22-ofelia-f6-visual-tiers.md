# F6 — Visual & Tier UI (Ofelia) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Render the Ofelia widget across all five tiers (`tiny`/`compact`/`standard`/`large`/`fullscreen`) per the design reference — a `tier`-routing component that builds view props from the already-merged duty/history/comments models and feeds a set of pure presentational parts (Avatar, DebtChips, WeekStrip, ActionButtons, UserToggle, RichLayout) plus per-tier shells.

**Architecture:** F6 is **additive** — it does **not** change model logic. Pure helpers in `ui/view-model.ts` (`resolveSelected`, `toWeekDays`, `toBalance`) map the duty model's `currentWeek()` + `selectedDate` + `historyEvents` + `numberOfDebts` into render-ready slices, reusing the model's exported helpers (`getDayStatus`, `isOverDebtWarning`, `DEBT_WARNING_THRESHOLD`, `DUTY_ROTATION`). `makeOfeliaViewModel(dutyModel)` wraps those helpers in a **family of focused `computed` atoms** (`ready`, `selected`, `selectedPerson`, `days`, `balance`, `canForgive`), each depending on the **minimal** model atoms so an unrelated change never wakes an unrelated reader — selecting a day does not recompute `balance`, and a history event does not recompute the week strip. The selected day uses a fallback ladder (explicit selection in the viewed week → today → first day) implementing spec §3.1.1 without touching the model. The router `OfeliaPoopDuty.tsx` instantiates `ofeliaDutyModel` + `ofeliaCommentsModel` (memoised on `storage`), builds that view-model + the `wrap`-ed handlers **once** in a `useMemo` (handlers read `view.selected()?.iso` at call time, so an action always hits the day shown in the panel), and exposes everything through `ofeliaContext` as **reactive sources** — the `view` record of computeds, `currentUser`/`history`/`comments` atoms, and stable `actions`/`nav`/`onSend`. Tier shells + `RichLayout` read only the slices they need (`view.selected()`, `view.balance()`, …) for atomic re-renders; history and comments are isolated behind connected `HistoryColumn`/`CommentsColumn`, so an SSE update to one stream never re-renders the duty panel. Leaf parts under `ui/parts/` stay pure and prop-driven (strings/numbers/handlers, ISO date strings — never Temporal/atoms), unit-tested in jsdom with crafted props. `large` and `fullscreen` both render the shared `RichLayout`; `fullscreen` additionally gets an `onClose` affordance, so behaviour can diverge later.

**Tech Stack:** TypeScript (ESM), React 19, Reatom v1001 (`@reatom/core` `atom`/`computed`/`wrap`; `@reatom/react` via `reatomMemo`), Temporal (global polyfill), `lucide-react` icons, CSS Modules with oklch design tokens, Vitest + jsdom, Testing Library (`render`/`screen`/`fireEvent`).

**Design decisions (brainstorm 2026-06-22):**

- **Context carries an atomic view-model, not a rebuilt object (granularity: L1 + isolated history/comments).** `makeOfeliaViewModel(dutyModel)` builds a record of focused `computed` atoms (`ready`/`selected`/`selectedPerson`/`days`/`balance`/`canForgive`), each depending on the **minimal** model atoms so reatom's `===` bail-out isolates readers: `balance` ← only `numberOfDebts` (selecting a day keeps its ref stable); the primitive `selectedPerson` re-renders `TinyTier` only on a name change; an internal primitive `selectedIso` keeps a status change from recomputing `days`. Pure helpers `resolveSelected`/`toWeekDays`/`toBalance` carry the logic and stay unit-tested. The whole context value is built once in `useMemo`.
- **History & comments are isolated.** `RichLayout` does not read `history()`/`comments()`; connected `HistoryColumn`/`CommentsColumn` do, so an SSE update to one stream re-renders just that column, not the selected-day panel. (Per-cell/per-row atomization — L3 — was deliberately skipped as YAGNI for this widget.)
- **Actions read the resolved selected day at call time** (`view.selected()?.iso`), so a stable handler always targets the day the panel shows — no per-render `targetDate` closure, and no divergence from the model's lazy `selectedDate() ?? today` fallback.
- **Acting on a non-today selected day is intentional** (spec §3.2: actions apply to the selected day `D`; in `tiny`/`compact`/`standard` `D` is always today). No guard added.
- **`canForgive` is a `computed` over `balance`** — tiers/`RichLayout` never recompute `balance.some(...)`. `canUndo` stays in `resolveSelected` (correct for the viewed week); the model's `undoAvailable` is simply unused by F6.
- **Tier tests use an atom-backed fixture** whose override API stays on plain slice values (`makeOfeliaView` builds the record of atoms; `makeOfeliaValue` wraps `currentUser`/`history`/`comments`); leaf parts remain pure prop-driven. The router keeps a single integration test on real models + `createFakeTimer`.

## Global Constraints

- **No model logic changes.** Do **not** edit `model/ofelia-duty.ts` or `model/ofelia-comments.ts` (or the server/storage layer). F6 only **consumes** them. All new derivation lives in pure UI helpers (`ui/view-model.ts`, `ui/format.ts`, `ui/person.ts`).
- **Every exported React component is wrapped in `reatomMemo`** (`@/shared/reatom/reatom-memo`) with an explicit display name — hard repo rule, including trivial presentational parts.
- **Leaf parts hold only view glue.** Parts under `ui/parts/` (Avatar, DebtChips, WeekStrip, ActionButtons, UserToggle) are pure and **prop-driven**: they receive primitives (ISO strings, numbers, booleans) and callbacks, never atoms or `Temporal.PlainDate`. Tier shells + `RichLayout` may read the context view-model slices (`view.selected()`, `view.balance()`, …) but convert nothing — the router owns ISO↔Temporal at the model boundary and hands each leaf its plain slice.
- **Errors as values (errore).** Never `throw` for control flow and never `try/catch` for flow. The router calls model actions (which already handle their own errors); UI parts never touch storage.
- **`wrap` every event handler that calls a model action or atom `.set`** (matches `Board.tsx` / `FullscreenOverlay.tsx`). `wrap` is imported from `@reatom/core`.
- **Roster & tones are fixed:** `DUTY_ROTATION = ['Леша', 'Карина']`. Tone mapping: `Карина → 'k'` (red oklch tokens), `Леша → 'l'` (blue oklch tokens). Person initial = `person.slice(0, 1)` (`Л`/`К`).
- **Tier router is exhaustive:** `tiny | compact | standard | large | fullscreen`. `UserToggle` («кто я») appears in `compact` and above; **never** in `tiny`. There is **no** per-comment author toggle.
- **Theme tokens:** add `--font-mono` globally (`tokens.css`); add widget-local `--ofelia-*` tokens on the `.widget` wrapper with a `:root[data-theme='dark'] .widget` override (the repo's CSS-module dark pattern, see `WidgetFrame.module.css`).
- **Code style (oxfmt):** single quotes, no semicolons, 2-space indent, named exports. Run `pnpm format` before the final commit.
- **Before PR:** `pnpm test`, `pnpm typecheck`, `pnpm lint`, and `pnpm format:check` must pass (run from repo root).

---

## File Structure

New files (all under `client/widgets/ofelia-poop-duty/`):

- `ui/view-model.ts` — pure helpers (`resolveSelected`/`toWeekDays`/`toBalance`) + the `makeOfeliaViewModel(...)` atomic factory; owns `WeekDayView`, `SelectedDayView`, `DebtBalanceEntry`, `OfeliaViewModel`, `OfeliaDutySources`, `OfeliaActions`, `OfeliaWeekNav`.
- `ui/person.ts` — `personInitial`, `personTone` (+ `PersonTone`).
- `ui/format.ts` — `pluralizeDays`, `formatWeekRange`.
- `ui/parts/Avatar.{tsx,module.css}` — circular person badge (tones + sizes).
- `ui/parts/DebtChips.{tsx,module.css}` — К/Л debt chips with over-threshold accent.
- `ui/parts/UserToggle.{tsx,module.css}` — global «кто я» К/Л toggle.
- `ui/parts/WeekStrip.{tsx,module.css}` — 7-day calendar (debt dots, today marker, clickable selection, legend).
- `ui/parts/ActionButtons.{tsx,module.css}` — confirm/undo/в-долг/простить (full + `compact` icon variant).
- `ui/parts/RichLayout.{tsx,module.css}` — two-column shell (selected-day panel | week+history+comments) for `large`/`fullscreen`.
- `ui/tiers/TinyTier.{tsx,module.css}`, `ui/tiers/CompactTier.{tsx,module.css}`, `ui/tiers/StandardTier.{tsx,module.css}`, `ui/tiers/LargeTier.tsx`, `ui/tiers/FullscreenTier.tsx`.
- Test files alongside each behaviour-bearing module (`*.test.ts(x)`).

Modified files:

- `client/src/shared/theme/tokens.css` — add `--font-mono`.
- `client/widgets/ofelia-poop-duty/ui/ofelia-poop-duty.module.css` — add `.widget` (token host) + `.loading`.
- `client/widgets/ofelia-poop-duty/ui/OfeliaPoopDuty.tsx` — rewrite as the `tier` router.
- `client/widgets/ofelia-poop-duty/ui/OfeliaPoopDuty.test.tsx` — rewrite for tier routing.

Reused as-is: `ui/parts/HistoryList.tsx` (F4), `ui/parts/CommentThread.tsx` (F5), exported model surface from `model/ofelia-duty.ts` and `model/ofelia-comments.ts`.

---

## Task 1: `ui/view-model.ts` — pure helpers + atomic view-model factory

**Files:**

- Create: `client/widgets/ofelia-poop-duty/ui/view-model.ts`
- Test: `client/widgets/ofelia-poop-duty/ui/view-model.test.ts`

**Interfaces:**

- Consumes: `getDayStatus`, `isOverDebtWarning`, `DUTY_ROTATION`, types `HistoryEvent`, `Person` (from `../model/ofelia-duty`); `computed`, `Atom` (`@reatom/core`).
- Produces:
  - `type DutyDay = { date: Temporal.PlainDate; isToday: boolean; day: number; duty: Person; debt: Person | null }` (structurally = an element of `dutyModel.currentWeek()`).
  - `type WeekDayView = { iso: string; weekday: string; dayOfMonth: number; person: Person; isToday: boolean; isDebtDay: boolean; isSelected: boolean }`
  - `type SelectedDayView = { iso: string; person: Person; isDebtDay: boolean; status: 'closed' | 'pending'; canUndo: boolean; debtRemaining: number }`
  - `type DebtBalanceEntry = { person: Person; debt: number; over: boolean }`
  - Pure helpers (no atoms, unit-tested directly): `resolveSelected(week, selectedDate, events, debts): SelectedDayView | null` (§3.1.1 ladder + status/undo/debtRemaining), `toWeekDays(week, selectedIso): WeekDayView[]`, `toBalance(debts): DebtBalanceEntry[]`.
  - `type OfeliaActions = { onConfirm; onUndo; onDebt; onForgive: () => void; onSelectDay: (iso: string) => void; onSetUser: (person: Person) => void }`
  - `type OfeliaWeekNav = { onPrevWeek; onNextWeek; onCurrentWeek: () => void }` (the visible range is derived by `RichLayout` from `view.days()` via `formatWeekRange`, not carried here).
  - `type OfeliaViewModel = { ready; selected; selectedPerson; days; balance; canForgive }` — a record of **focused `computed` atoms** (L1 atomic split). Each slice depends on the minimal duty atoms (`balance` ← only `numberOfDebts`; `days` ← `currentWeek` + a primitive `selectedIso`), so an unrelated change never wakes an unrelated reader. `selectedPerson` is a primitive-output computed for `TinyTier`.
  - `function makeOfeliaViewModel(duty: OfeliaDutySources): OfeliaViewModel` — builds the computeds from the duty model's atoms (`currentWeek`/`selectedDate`/`historyEvents`/`numberOfDebts`); `ofeliaDutyModel` is passed directly (structural subset). **No model edits.**

- [ ] **Step 1: Write the failing test**

Create `client/widgets/ofelia-poop-duty/ui/view-model.test.ts`:

```ts
import { atom } from '@reatom/core'
import { describe, expect, it } from 'vitest'

import type { HistoryEvent, Person } from '../model/ofelia-duty'

import { makeOfeliaViewModel, resolveSelected, toBalance, toWeekDays } from './view-model'
import type { DutyDay } from './view-model'

const D = (iso: string) => Temporal.PlainDate.from(iso)

// Week of 2026-06-15 (Mon) .. 2026-06-21 (Sun); "today" = Tue 2026-06-16.
function week(): DutyDay[] {
  return [
    { date: D('2026-06-15'), isToday: false, day: 15, duty: 'Леша', debt: null },
    { date: D('2026-06-16'), isToday: true, day: 16, duty: 'Карина', debt: null },
    { date: D('2026-06-17'), isToday: false, day: 17, duty: 'Леша', debt: 'Карина' },
    { date: D('2026-06-18'), isToday: false, day: 18, duty: 'Карина', debt: null },
    { date: D('2026-06-19'), isToday: false, day: 19, duty: 'Леша', debt: null },
    { date: D('2026-06-20'), isToday: false, day: 20, duty: 'Карина', debt: null },
    { date: D('2026-06-21'), isToday: false, day: 21, duty: 'Леша', debt: null },
  ]
}

const ev = (overrides: Partial<HistoryEvent> = {}): HistoryEvent => ({
  id: 'e1',
  ts: 1,
  ip: '127.0.0.1',
  date: '2026-06-16',
  type: 'cleaned',
  actor: 'Карина',
  by: 'Карина',
  ...overrides,
})

describe('resolveSelected (§3.1.1 ladder + status)', () => {
  it('defaults to today when no day is selected (current week)', () => {
    const selected = resolveSelected(week(), null, [], {})
    expect(selected?.iso).toBe('2026-06-16')
    expect(selected?.person).toBe('Карина')
    expect(selected?.isDebtDay).toBe(false)
  })

  it('uses the explicit selection when it is in the viewed week (debt assignee wins)', () => {
    const selected = resolveSelected(week(), D('2026-06-17'), [], { Карина: 1 })
    expect(selected?.iso).toBe('2026-06-17')
    expect(selected?.person).toBe('Карина')
    expect(selected?.isDebtDay).toBe(true)
    expect(selected?.debtRemaining).toBe(1)
  })

  it('falls back to the first day of the week when selection is off-week and today is absent', () => {
    const offWeek = week().map((d) => ({ ...d, isToday: false }))
    expect(resolveSelected(offWeek, D('2026-07-01'), [], {})?.iso).toBe('2026-06-15')
  })

  it('marks the day closed and undoable when today has a cleaned event', () => {
    const selected = resolveSelected(week(), null, [ev({ date: '2026-06-16' })], {})
    expect(selected?.status).toBe('closed')
    expect(selected?.canUndo).toBe(true)
  })

  it('never allows undo for a non-today selected day', () => {
    const selected = resolveSelected(
      week(),
      D('2026-06-17'),
      [ev({ date: '2026-06-17', type: 'went_into_debt' })],
      {},
    )
    expect(selected?.status).toBe('closed')
    expect(selected?.canUndo).toBe(false)
  })

  it('returns null for an empty week', () => {
    expect(resolveSelected([], null, [], {})).toBeNull()
  })
})

describe('toBalance', () => {
  it('builds a balance flagged over the warning threshold (>7)', () => {
    expect(toBalance({ Карина: 8, Леша: 0 })).toEqual([
      { person: 'Леша', debt: 0, over: false },
      { person: 'Карина', debt: 8, over: true },
    ])
  })
})

describe('toWeekDays', () => {
  it('maps weekday labels, debt dots, and the selected flag across the strip', () => {
    const days = toWeekDays(week(), '2026-06-17')
    expect(days.map((d) => d.weekday)).toEqual(['ПН', 'ВТ', 'СР', 'ЧТ', 'ПТ', 'СБ', 'ВС'])
    expect(days[1]?.isToday).toBe(true)
    expect(days[2]).toMatchObject({ iso: '2026-06-17', isDebtDay: true, isSelected: true })
    expect(days.filter((d) => d.isSelected)).toHaveLength(1)
  })
})

describe('makeOfeliaViewModel (atomic slices)', () => {
  it('exposes focused slices and keeps the balance ref stable across a selection change', () => {
    const duty = {
      currentWeek: atom<DutyDay[] | null>(week(), 'test.currentWeek'),
      selectedDate: atom<Temporal.PlainDate | null>(null, 'test.selectedDate'),
      historyEvents: atom<HistoryEvent[]>([], 'test.historyEvents'),
      numberOfDebts: atom<Partial<Record<Person, number>> | null>({ Карина: 1 }, 'test.numberOfDebts'),
    }
    const view = makeOfeliaViewModel(duty)

    expect(view.ready()).toBe(true)
    expect(view.selected()?.iso).toBe('2026-06-16')
    expect(view.canForgive()).toBe(true)

    const balanceBefore = view.balance()
    duty.selectedDate.set(D('2026-06-17'))

    // Selection moved, but debts did not change → the `balance` computed is not
    // invalidated and returns the same reference (the atomic win we are after).
    expect(view.selected()?.iso).toBe('2026-06-17')
    expect(view.balance()).toBe(balanceBefore)
  })
})
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `pnpm --filter client test -- view-model`
Expected: FAIL — cannot resolve `./view-model`.

- [ ] **Step 3: Write the implementation**

Create `client/widgets/ofelia-poop-duty/ui/view-model.ts`:

```ts
import { computed } from '@reatom/core'
import type { Atom } from '@reatom/core'

import { DUTY_ROTATION, getDayStatus, isOverDebtWarning } from '../model/ofelia-duty'
import type { HistoryEvent, Person } from '../model/ofelia-duty'

const WEEKDAY_LABELS = ['ПН', 'ВТ', 'СР', 'ЧТ', 'ПТ', 'СБ', 'ВС'] as const

// Structural mirror of an element of `dutyModel.currentWeek()`.
export type DutyDay = {
  date: Temporal.PlainDate
  isToday: boolean
  day: number
  duty: Person
  debt: Person | null
}

export type WeekDayView = {
  iso: string
  weekday: string
  dayOfMonth: number
  person: Person
  isToday: boolean
  isDebtDay: boolean
  isSelected: boolean
}

export type SelectedDayView = {
  iso: string
  person: Person
  isDebtDay: boolean
  status: 'closed' | 'pending'
  canUndo: boolean
  debtRemaining: number
}

export type DebtBalanceEntry = {
  person: Person
  debt: number
  over: boolean
}

export type OfeliaActions = {
  onConfirm: () => void
  onUndo: () => void
  onDebt: () => void
  onForgive: () => void
  onSelectDay: (iso: string) => void
  onSetUser: (person: Person) => void
}

export type OfeliaWeekNav = {
  onPrevWeek: () => void
  onNextWeek: () => void
  onCurrentWeek: () => void
}

// ── Pure derivation helpers (no atoms — unit-tested directly) ──────────────

// §3.1.1 ladder: explicit selection if it is in the viewed week → today (only
// present when viewing the current week) → first day of the viewed week.
export function resolveSelected(
  week: DutyDay[],
  selectedDate: Temporal.PlainDate | null,
  events: HistoryEvent[],
  debts: Partial<Record<Person, number>>,
): SelectedDayView | null {
  if (week.length === 0) return null

  const explicit = selectedDate ? week.find((day) => day.date.equals(selectedDate)) : undefined
  const entry = explicit ?? week.find((day) => day.isToday) ?? week[0]

  const person = entry.debt ?? entry.duty
  const status = getDayStatus(events, entry.date)

  return {
    iso: entry.date.toString(),
    person,
    isDebtDay: entry.debt != null,
    status,
    canUndo: entry.isToday && status === 'closed',
    debtRemaining: debts[person] ?? 0,
  }
}

export function toWeekDays(week: DutyDay[], selectedIso: string | null): WeekDayView[] {
  return week.map((day) => ({
    iso: day.date.toString(),
    weekday: WEEKDAY_LABELS[day.date.dayOfWeek - 1],
    dayOfMonth: day.day,
    person: day.debt ?? day.duty,
    isToday: day.isToday,
    isDebtDay: day.debt != null,
    isSelected: day.date.toString() === selectedIso,
  }))
}

export function toBalance(debts: Partial<Record<Person, number>>): DebtBalanceEntry[] {
  return DUTY_ROTATION.map((person) => ({
    person,
    debt: debts[person] ?? 0,
    over: isOverDebtWarning(debts, person),
  }))
}

// ── Atomic view-model (L1): a family of focused computeds ───────────────────
// Each slice depends on the minimal duty atoms, so an unrelated change never
// wakes an unrelated reader (e.g. selecting a day does not recompute `balance`,
// and a history event does not recompute the week strip).
export type OfeliaViewModel = {
  ready: Atom<boolean>
  selected: Atom<SelectedDayView | null>
  selectedPerson: Atom<Person | null>
  days: Atom<WeekDayView[]>
  balance: Atom<DebtBalanceEntry[]>
  canForgive: Atom<boolean>
}

// Structural subset of `ofeliaDutyModel` — the model is passed in directly.
export type OfeliaDutySources = {
  currentWeek: Atom<DutyDay[] | null>
  selectedDate: Atom<Temporal.PlainDate | null>
  historyEvents: Atom<HistoryEvent[]>
  numberOfDebts: Atom<Partial<Record<Person, number>> | null>
}

// `make` (not `create`) per the repo factory convention; named for its output
// (`OfeliaViewModel`) to stay distinct from the test fixture's `makeOfeliaView`.
export function makeOfeliaViewModel(duty: OfeliaDutySources): OfeliaViewModel {
  const ready = computed(() => duty.currentWeek() != null, 'ofelia.ready')

  const selected = computed(() => {
    const week = duty.currentWeek()
    if (!week) return null
    return resolveSelected(week, duty.selectedDate(), duty.historyEvents(), duty.numberOfDebts() ?? {})
  }, 'ofelia.selected')

  // Primitive output → reatomComponent bail-out: TinyTier re-renders only when
  // the person actually changes, not on status/debt changes.
  const selectedPerson = computed(() => selected()?.person ?? null, 'ofelia.selectedPerson')

  // Primitive → keeps `days` from recomputing when only the selected day's
  // *status* changed (e.g. after a confirm) but the highlighted day is the same.
  const selectedIso = computed(() => selected()?.iso ?? null, 'ofelia.selectedIso')

  const days = computed(() => {
    const week = duty.currentWeek()
    if (!week) return []
    return toWeekDays(week, selectedIso())
  }, 'ofelia.days')

  // Depends ONLY on numberOfDebts → stable ref across week-nav / day-selection.
  const balance = computed(() => toBalance(duty.numberOfDebts() ?? {}), 'ofelia.balance')

  const canForgive = computed(() => balance().some((entry) => entry.debt > 0), 'ofelia.canForgive')

  return { ready, selected, selectedPerson, days, balance, canForgive }
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `pnpm --filter client test -- view-model`
Expected: PASS (helper cases + the `makeOfeliaViewModel` atomic-slice case).

- [ ] **Step 5: Commit**

```bash
git add client/widgets/ofelia-poop-duty/ui/view-model.ts client/widgets/ofelia-poop-duty/ui/view-model.test.ts
git commit -m "feat(ofelia): atomic view-model (pure helpers + computed factory)"
```

---

## Task 2: Theme tokens + person helpers + `Avatar` part

**Files:**

- Modify: `client/src/shared/theme/tokens.css` (add `--font-mono`)
- Modify: `client/widgets/ofelia-poop-duty/ui/ofelia-poop-duty.module.css` (add `.widget` token host + `.loading`)
- Create: `client/widgets/ofelia-poop-duty/ui/person.ts`
- Create: `client/widgets/ofelia-poop-duty/ui/person.test.ts`
- Create: `client/widgets/ofelia-poop-duty/ui/parts/Avatar.tsx`
- Create: `client/widgets/ofelia-poop-duty/ui/parts/Avatar.module.css`
- Create: `client/widgets/ofelia-poop-duty/ui/parts/Avatar.test.tsx`

**Interfaces:**

- Consumes: `DUTY_ROTATION`, `Person` (from `../model/ofelia-duty`).
- Produces:
  - `type PersonTone = 'k' | 'l'`
  - `function personInitial(person: Person): string`
  - `function personTone(person: Person): PersonTone`
  - `Avatar` — `reatomMemo` component, props `{ person: Person; size?: 'sm' | 'md' | 'lg' }`. Renders the initial in a tone-coloured circle; sets `data-tone` (`k`/`l`) and `data-size`. Default size `'md'`. Decorative (`aria-hidden`).

- [ ] **Step 1: Write the failing tests**

Create `client/widgets/ofelia-poop-duty/ui/person.test.ts`:

```ts
import { describe, expect, it } from 'vitest'

import { personInitial, personTone } from './person'

describe('person helpers', () => {
  it('returns the first letter as the initial', () => {
    expect(personInitial('Карина')).toBe('К')
    expect(personInitial('Леша')).toBe('Л')
  })

  it('maps Карина to the red tone and Леша to the blue tone', () => {
    expect(personTone('Карина')).toBe('k')
    expect(personTone('Леша')).toBe('l')
  })
})
```

Create `client/widgets/ofelia-poop-duty/ui/parts/Avatar.test.tsx`:

```tsx
// @vitest-environment jsdom
import { render, screen } from '@testing-library/react'
import { describe, expect, it } from 'vitest'

import { Avatar } from './Avatar'

describe('Avatar', () => {
  it('renders the person initial with the matching tone', () => {
    render(<Avatar person="Карина" />)
    const badge = screen.getByText('К')
    expect(badge).toHaveAttribute('data-tone', 'k')
    expect(badge).toHaveAttribute('data-size', 'md')
  })

  it('applies the requested size', () => {
    render(<Avatar person="Леша" size="lg" />)
    const badge = screen.getByText('Л')
    expect(badge).toHaveAttribute('data-tone', 'l')
    expect(badge).toHaveAttribute('data-size', 'lg')
  })
})
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `pnpm --filter client test -- person Avatar`
Expected: FAIL — `./person` / `./Avatar` not found.

- [ ] **Step 3: Add tokens + write helpers + component**

Edit `client/src/shared/theme/tokens.css` — inside the bottom `:root { ... }` block (the one with `--radius`/`--ease`), add a `--font-mono` line:

```css
:root {
  --radius: 0.625rem;
  --ease: cubic-bezier(0.22, 1, 0.36, 1);
  --font-mono: 'JetBrains Mono Variable', ui-monospace, monospace;
  /* ...existing compatibility tokens unchanged... */
}
```

Edit `client/widgets/ofelia-poop-duty/ui/ofelia-poop-duty.module.css` — append the token host + loading state (leave the existing `.root`/`.small`/etc. rules in place; the router uses `.widget`/`.loading`):

```css
.widget {
  block-size: 100%;
  font-family: var(--font-ui);
  color: var(--text);
  user-select: none;

  --ofelia-k-bg: oklch(0.86 0.07 25);
  --ofelia-k-fg: oklch(0.42 0.13 27);
  --ofelia-l-bg: oklch(0.87 0.06 215);
  --ofelia-l-fg: oklch(0.42 0.1 225);
  --ofelia-ok-soft: oklch(0.95 0.05 155);
  --ofelia-ok-fg: oklch(0.45 0.13 155);
}

:root[data-theme='dark'] .widget {
  --ofelia-k-bg: oklch(0.42 0.1 27);
  --ofelia-k-fg: oklch(0.86 0.09 25);
  --ofelia-l-bg: oklch(0.4 0.08 225);
  --ofelia-l-fg: oklch(0.85 0.07 215);
  --ofelia-ok-soft: oklch(0.34 0.07 155);
  --ofelia-ok-fg: oklch(0.82 0.13 155);
}

.loading {
  display: grid;
  place-items: center;
  block-size: 100%;
  font-size: 0.8125rem;
  color: var(--text-dim);
}
```

Create `client/widgets/ofelia-poop-duty/ui/person.ts`:

```ts
import { DUTY_ROTATION } from '../model/ofelia-duty'
import type { Person } from '../model/ofelia-duty'

// One tone per roster slot, assigned by position in DUTY_ROTATION (Леша → 'l'
// blue, Карина → 'k' red). Scales to N participants: add a tone here + matching
// `--ofelia-<tone>-*` tokens — no per-name branching. The palette must be at
// least as long as the roster; the modulo keeps the lookup total either way.
const PERSON_TONES = ['l', 'k'] as const

export type PersonTone = (typeof PERSON_TONES)[number]

export function personInitial(person: Person): string {
  return person.slice(0, 1)
}

export function personTone(person: Person): PersonTone {
  const slot = DUTY_ROTATION.indexOf(person)
  return PERSON_TONES[slot % PERSON_TONES.length]
}
```

Create `client/widgets/ofelia-poop-duty/ui/parts/Avatar.tsx`:

```tsx
import type { Person } from 'widgets/ofelia-poop-duty/model/ofelia-duty'

import { reatomMemo } from '@/shared/reatom/reatom-memo'
import { personInitial, personTone } from '../person'

import styles from './Avatar.module.css'

export type AvatarProps = {
  person: Person
  size?: 'sm' | 'md' | 'lg'
}

export const Avatar = reatomMemo<AvatarProps>(({ person, size = 'md' }) => {
  return (
    <span className={styles.avatar} data-tone={personTone(person)} data-size={size} aria-hidden>
      {personInitial(person)}
    </span>
  )
}, 'Avatar')
```

Create `client/widgets/ofelia-poop-duty/ui/parts/Avatar.module.css`:

```css
.avatar {
  flex: none;
  display: grid;
  place-items: center;
  border-radius: 999px;
  font-weight: 600;
  line-height: 1;
}

.avatar[data-tone='k'] {
  background: var(--ofelia-k-bg);
  color: var(--ofelia-k-fg);
}

.avatar[data-tone='l'] {
  background: var(--ofelia-l-bg);
  color: var(--ofelia-l-fg);
}

.avatar[data-size='sm'] {
  inline-size: 1.25rem;
  block-size: 1.25rem;
  font-size: 0.625rem;
}

.avatar[data-size='md'] {
  inline-size: 2.75rem;
  block-size: 2.75rem;
  font-size: 1.0625rem;
}

.avatar[data-size='lg'] {
  inline-size: 3.5rem;
  block-size: 3.5rem;
  font-size: 1.4rem;
}
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `pnpm --filter client test -- person Avatar`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add client/src/shared/theme/tokens.css client/widgets/ofelia-poop-duty/ui/ofelia-poop-duty.module.css client/widgets/ofelia-poop-duty/ui/person.ts client/widgets/ofelia-poop-duty/ui/person.test.ts client/widgets/ofelia-poop-duty/ui/parts/Avatar.tsx client/widgets/ofelia-poop-duty/ui/parts/Avatar.module.css client/widgets/ofelia-poop-duty/ui/parts/Avatar.test.tsx
git commit -m "feat(ofelia): font-mono + ofelia tone tokens, person helpers, Avatar part"
```

---

## Task 3: `ui/format.ts` + `DebtChips` part

**Files:**

- Create: `client/widgets/ofelia-poop-duty/ui/format.ts`
- Create: `client/widgets/ofelia-poop-duty/ui/format.test.ts`
- Create: `client/widgets/ofelia-poop-duty/ui/parts/DebtChips.tsx`
- Create: `client/widgets/ofelia-poop-duty/ui/parts/DebtChips.module.css`
- Create: `client/widgets/ofelia-poop-duty/ui/parts/DebtChips.test.tsx`

**Interfaces:**

- Consumes: `DebtBalanceEntry` (from `../view-model`); `Avatar`, `personInitial` indirectly.
- Produces:
  - `function pluralizeDays(n: number): string` → `"1 день"`, `"2 дня"`, `"5 дней"` (Russian plural rules).
  - `function formatWeekRange(days: { iso: string }[]): string` → `"15–21 июня"` or `"29 июня – 5 июля"`.
  - `function selectedDaySubtitle(selected: SelectedDayView, balance: DebtBalanceEntry[]): string` → the panel subtitle used by `standard` + `RichLayout`.
  - `DebtChips` — `reatomMemo`, props `{ balance: DebtBalanceEntry[] }`. One chip per person: mini Avatar + count. Adds `data-over="true"` on chips above the warning threshold.

- [ ] **Step 1: Write the failing tests**

Create `client/widgets/ofelia-poop-duty/ui/format.test.ts`:

```ts
import { describe, expect, it } from 'vitest'

import { formatWeekRange, pluralizeDays } from './format'

describe('pluralizeDays', () => {
  it('applies Russian plural rules', () => {
    expect(pluralizeDays(0)).toBe('0 дней')
    expect(pluralizeDays(1)).toBe('1 день')
    expect(pluralizeDays(2)).toBe('2 дня')
    expect(pluralizeDays(4)).toBe('4 дня')
    expect(pluralizeDays(5)).toBe('5 дней')
    expect(pluralizeDays(11)).toBe('11 дней')
    expect(pluralizeDays(21)).toBe('21 день')
    expect(pluralizeDays(22)).toBe('22 дня')
  })
})

describe('formatWeekRange', () => {
  it('keeps a single month when start and end share it', () => {
    const days = ['2026-06-15', '2026-06-21'].map((iso) => ({ iso }))
    expect(formatWeekRange(days)).toBe('15–21 июня')
  })

  it('spells both months across a boundary', () => {
    const days = ['2026-06-29', '2026-07-05'].map((iso) => ({ iso }))
    expect(formatWeekRange(days)).toBe('29 июня – 5 июля')
  })

  it('returns empty string for an empty week', () => {
    expect(formatWeekRange([])).toBe('')
  })
})

describe('selectedDaySubtitle', () => {
  const sel = (overrides: Partial<SelectedDayView> = {}): SelectedDayView => ({
    iso: '2026-06-17',
    person: 'Карина',
    isDebtDay: false,
    status: 'pending',
    canUndo: false,
    debtRemaining: 0,
    ...overrides,
  })

  it('describes an open debt day', () => {
    expect(selectedDaySubtitle(sel({ isDebtDay: true, debtRemaining: 2 }), [])).toBe(
      'гасит долг · осталось 2 дня',
    )
  })

  it('describes a closed debt day', () => {
    expect(
      selectedDaySubtitle(sel({ isDebtDay: true, status: 'closed', debtRemaining: 1 }), []),
    ).toBe('долг сокращён · осталось 1 день')
  })

  it('says there is no debt when the balance is flat', () => {
    expect(
      selectedDaySubtitle(sel(), [
        { person: 'Леша', debt: 0, over: false },
        { person: 'Карина', debt: 0, over: false },
      ]),
    ).toBe('по очереди · долгов нет')
  })

  it('says the day is the normal turn when others still owe', () => {
    expect(
      selectedDaySubtitle(sel(), [
        { person: 'Леша', debt: 0, over: false },
        { person: 'Карина', debt: 3, over: false },
      ]),
    ).toBe('по очереди')
  })
})
```

The `SelectedDayView` import is added to the test's top import:

```ts
import type { SelectedDayView } from './view-model'
```

Create `client/widgets/ofelia-poop-duty/ui/parts/DebtChips.test.tsx`:

```tsx
// @vitest-environment jsdom
import { render, screen } from '@testing-library/react'
import { describe, expect, it } from 'vitest'

import type { DebtBalanceEntry } from '../view-model'

import { DebtChips } from './DebtChips'

const balance: DebtBalanceEntry[] = [
  { person: 'Карина', debt: 8, over: true },
  { person: 'Леша', debt: 0, over: false },
]

describe('DebtChips', () => {
  it('renders a chip per person with the debt count', () => {
    render(<DebtChips balance={balance} />)
    expect(screen.getByText('8')).toBeInTheDocument()
    expect(screen.getByText('0')).toBeInTheDocument()
  })

  it('flags chips above the warning threshold', () => {
    render(<DebtChips balance={balance} />)
    expect(screen.getByTestId('debt-chip-Карина')).toHaveAttribute('data-over', 'true')
    expect(screen.getByTestId('debt-chip-Леша')).toHaveAttribute('data-over', 'false')
  })
})
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `pnpm --filter client test -- format DebtChips`
Expected: FAIL — modules not found.

- [ ] **Step 3: Write the helpers + component**

Create `client/widgets/ofelia-poop-duty/ui/format.ts`:

```ts
import type { DebtBalanceEntry, SelectedDayView } from './view-model'

const MONTHS_GENITIVE = [
  'января',
  'февраля',
  'марта',
  'апреля',
  'мая',
  'июня',
  'июля',
  'августа',
  'сентября',
  'октября',
  'ноября',
  'декабря',
] as const

export function pluralizeDays(n: number): string {
  const abs = Math.abs(n) % 100
  const last = abs % 10

  let word: string
  if (abs >= 11 && abs <= 14) word = 'дней'
  else if (last === 1) word = 'день'
  else if (last >= 2 && last <= 4) word = 'дня'
  else word = 'дней'

  return `${n} ${word}`
}

export function formatWeekRange(days: { iso: string }[]): string {
  if (days.length === 0) return ''

  const start = Temporal.PlainDate.from(days[0].iso)
  const end = Temporal.PlainDate.from(days[days.length - 1].iso)

  if (start.month === end.month) {
    return `${start.day}–${end.day} ${MONTHS_GENITIVE[end.month - 1]}`
  }

  return `${start.day} ${MONTHS_GENITIVE[start.month - 1]} – ${end.day} ${MONTHS_GENITIVE[end.month - 1]}`
}

export function selectedDaySubtitle(
  selected: SelectedDayView,
  balance: DebtBalanceEntry[],
): string {
  if (selected.isDebtDay) {
    const lead = selected.status === 'closed' ? 'долг сокращён' : 'гасит долг'
    return `${lead} · осталось ${pluralizeDays(selected.debtRemaining)}`
  }

  const noDebt = balance.every((entry) => entry.debt === 0)
  return noDebt ? 'по очереди · долгов нет' : 'по очереди'
}
```

Create `client/widgets/ofelia-poop-duty/ui/parts/DebtChips.tsx`:

```tsx
import { reatomMemo } from '@/shared/reatom/reatom-memo'

import type { DebtBalanceEntry } from '../view-model'
import { Avatar } from './Avatar'

import styles from './DebtChips.module.css'

export type DebtChipsProps = {
  balance: DebtBalanceEntry[]
}

export const DebtChips = reatomMemo<DebtChipsProps>(({ balance }) => {
  return (
    <div className={styles.row}>
      {balance.map((entry) => (
        <span
          key={entry.person}
          className={styles.chip}
          data-over={entry.over}
          data-testid={`debt-chip-${entry.person}`}
        >
          <Avatar person={entry.person} size="sm" />
          <span className={styles.count}>{entry.debt}</span>
        </span>
      ))}
    </div>
  )
}, 'DebtChips')
```

Create `client/widgets/ofelia-poop-duty/ui/parts/DebtChips.module.css`:

```css
.row {
  display: flex;
  gap: 0.75rem;
}

.chip {
  display: inline-flex;
  align-items: center;
  gap: 0.375rem;
  font-size: 0.78rem;
  font-weight: 600;
  color: var(--text);
}

.chip[data-over='false'] {
  color: var(--text-dim);
  font-weight: 500;
}

.chip[data-over='true'] {
  color: var(--destructive);
}

.count {
  font-family: var(--font-mono);
}
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `pnpm --filter client test -- format DebtChips`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add client/widgets/ofelia-poop-duty/ui/format.ts client/widgets/ofelia-poop-duty/ui/format.test.ts client/widgets/ofelia-poop-duty/ui/parts/DebtChips.tsx client/widgets/ofelia-poop-duty/ui/parts/DebtChips.module.css client/widgets/ofelia-poop-duty/ui/parts/DebtChips.test.tsx
git commit -m "feat(ofelia): day pluralizer, week-range formatter, DebtChips part"
```

---

## Task 4: `UserToggle` part («кто я»)

**Files:**

- Create: `client/widgets/ofelia-poop-duty/ui/parts/UserToggle.tsx`
- Create: `client/widgets/ofelia-poop-duty/ui/parts/UserToggle.module.css`
- Create: `client/widgets/ofelia-poop-duty/ui/parts/UserToggle.test.tsx`

**Interfaces:**

- Consumes: `DUTY_ROTATION`, `Person` (from `widgets/ofelia-poop-duty/model/ofelia-duty`); `personInitial` (from `../person`).
- Produces: `UserToggle` — `reatomMemo`, props `{ value: Person; onChange: (person: Person) => void }`. Renders one button per roster person (`"<initial> · <name>"`), marks the active one with `aria-pressed` + `data-active`, and calls `onChange(person)` on click. A leading "Я:" label conveys «кто я».

- [ ] **Step 1: Write the failing test**

Create `client/widgets/ofelia-poop-duty/ui/parts/UserToggle.test.tsx`:

```tsx
// @vitest-environment jsdom
import { fireEvent, render, screen } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'

import { UserToggle } from './UserToggle'

describe('UserToggle', () => {
  it('marks the active person as pressed', () => {
    render(<UserToggle value="Карина" onChange={vi.fn()} />)
    expect(screen.getByRole('button', { name: /Карина/ })).toHaveAttribute('aria-pressed', 'true')
    expect(screen.getByRole('button', { name: /Леша/ })).toHaveAttribute('aria-pressed', 'false')
  })

  it('calls onChange with the clicked person', () => {
    const onChange = vi.fn()
    render(<UserToggle value="Карина" onChange={onChange} />)
    fireEvent.click(screen.getByRole('button', { name: /Леша/ }))
    expect(onChange).toHaveBeenCalledWith('Леша')
  })
})
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `pnpm --filter client test -- UserToggle`
Expected: FAIL — `./UserToggle` not found.

- [ ] **Step 3: Write the component + styles**

Create `client/widgets/ofelia-poop-duty/ui/parts/UserToggle.tsx`:

```tsx
import { DUTY_ROTATION } from 'widgets/ofelia-poop-duty/model/ofelia-duty'
import type { Person } from 'widgets/ofelia-poop-duty/model/ofelia-duty'

import { reatomMemo } from '@/shared/reatom/reatom-memo'
import { personInitial } from '../person'

import styles from './UserToggle.module.css'

export type UserToggleProps = {
  value: Person
  onChange: (person: Person) => void
}

export const UserToggle = reatomMemo<UserToggleProps>(({ value, onChange }) => {
  return (
    <div className={styles.root}>
      <span className={styles.label}>Я:</span>
      {DUTY_ROTATION.map((person) => {
        const active = person === value
        return (
          <button
            key={person}
            type="button"
            className={styles.option}
            data-active={active}
            aria-pressed={active}
            onClick={() => onChange(person)}
          >
            {personInitial(person)} · {person}
          </button>
        )
      })}
    </div>
  )
}, 'UserToggle')
```

Create `client/widgets/ofelia-poop-duty/ui/parts/UserToggle.module.css`:

```css
.root {
  display: flex;
  align-items: center;
  gap: 0.375rem;
}

.label {
  font-family: var(--font-mono);
  font-size: 0.66rem;
  letter-spacing: 0.06em;
  color: var(--text-3);
}

.option {
  display: inline-flex;
  align-items: center;
  block-size: 1.625rem;
  padding: 0 0.625rem;
  border: 1px solid var(--border);
  border-radius: 0.4375rem;
  background: var(--surface);
  color: var(--text-3);
  font: inherit;
  font-size: 0.75rem;
  cursor: pointer;
}

.option[data-active='true'] {
  border-color: var(--primary);
  background: var(--accent-soft);
  color: var(--primary);
  font-weight: 600;
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `pnpm --filter client test -- UserToggle`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add client/widgets/ofelia-poop-duty/ui/parts/UserToggle.tsx client/widgets/ofelia-poop-duty/ui/parts/UserToggle.module.css client/widgets/ofelia-poop-duty/ui/parts/UserToggle.test.tsx
git commit -m "feat(ofelia): global UserToggle part"
```

---

## Task 5: `WeekStrip` part (calendar with day selection)

**Files:**

- Create: `client/widgets/ofelia-poop-duty/ui/parts/WeekStrip.tsx`
- Create: `client/widgets/ofelia-poop-duty/ui/parts/WeekStrip.module.css`
- Create: `client/widgets/ofelia-poop-duty/ui/parts/WeekStrip.test.tsx`

**Interfaces:**

- Consumes: `WeekDayView` (from `../view-model`); `Avatar` part.
- Produces: `WeekStrip` — `reatomMemo`, props `{ days: WeekDayView[]; onSelectDay: (iso: string) => void }`. Renders 7 day buttons (weekday label, Avatar, debt dot when `isDebtDay`, today marker when `isToday`, selected ring when `isSelected`), each calling `onSelectDay(day.iso)`; below, a legend explaining the debt dot.

- [ ] **Step 1: Write the failing test**

Create `client/widgets/ofelia-poop-duty/ui/parts/WeekStrip.test.tsx`:

```tsx
// @vitest-environment jsdom
import { fireEvent, render, screen } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'

import type { WeekDayView } from '../view-model'

import { WeekStrip } from './WeekStrip'

function days(): WeekDayView[] {
  return [
    { iso: '2026-06-15', weekday: 'ПН', dayOfMonth: 15, person: 'Леша', isToday: false, isDebtDay: false, isSelected: false },
    { iso: '2026-06-16', weekday: 'ВТ', dayOfMonth: 16, person: 'Карина', isToday: true, isDebtDay: false, isSelected: true },
    { iso: '2026-06-17', weekday: 'СР', dayOfMonth: 17, person: 'Карина', isToday: false, isDebtDay: true, isSelected: false },
    { iso: '2026-06-18', weekday: 'ЧТ', dayOfMonth: 18, person: 'Леша', isToday: false, isDebtDay: false, isSelected: false },
    { iso: '2026-06-19', weekday: 'ПТ', dayOfMonth: 19, person: 'Карина', isToday: false, isDebtDay: false, isSelected: false },
    { iso: '2026-06-20', weekday: 'СБ', dayOfMonth: 20, person: 'Леша', isToday: false, isDebtDay: false, isSelected: false },
    { iso: '2026-06-21', weekday: 'ВС', dayOfMonth: 21, person: 'Карина', isToday: false, isDebtDay: false, isSelected: false },
  ]
}

describe('WeekStrip', () => {
  it('renders a cell for every weekday', () => {
    render(<WeekStrip days={days()} onSelectDay={vi.fn()} />)
    for (const label of ['ПН', 'ВТ', 'СР', 'ЧТ', 'ПТ', 'СБ', 'ВС']) {
      expect(screen.getByText(label)).toBeInTheDocument()
    }
  })

  it('marks the selected and today cells', () => {
    render(<WeekStrip days={days()} onSelectDay={vi.fn()} />)
    const tuesday = screen.getByTestId('week-day-2026-06-16')
    expect(tuesday).toHaveAttribute('data-selected', 'true')
    expect(tuesday).toHaveAttribute('data-today', 'true')
  })

  it('flags debt days', () => {
    render(<WeekStrip days={days()} onSelectDay={vi.fn()} />)
    expect(screen.getByTestId('week-day-2026-06-17')).toHaveAttribute('data-debt', 'true')
  })

  it('calls onSelectDay with the clicked iso date', () => {
    const onSelectDay = vi.fn()
    render(<WeekStrip days={days()} onSelectDay={onSelectDay} />)
    fireEvent.click(screen.getByTestId('week-day-2026-06-19'))
    expect(onSelectDay).toHaveBeenCalledWith('2026-06-19')
  })
})
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `pnpm --filter client test -- WeekStrip`
Expected: FAIL — `./WeekStrip` not found.

- [ ] **Step 3: Write the component + styles**

Create `client/widgets/ofelia-poop-duty/ui/parts/WeekStrip.tsx`:

```tsx
import { reatomMemo } from '@/shared/reatom/reatom-memo'

import type { WeekDayView } from '../view-model'
import { Avatar } from './Avatar'

import styles from './WeekStrip.module.css'

export type WeekStripProps = {
  days: WeekDayView[]
  onSelectDay: (iso: string) => void
}

export const WeekStrip = reatomMemo<WeekStripProps>(({ days, onSelectDay }) => {
  return (
    <div className={styles.root}>
      <div className={styles.grid}>
        {days.map((day) => (
          <button
            key={day.iso}
            type="button"
            className={styles.day}
            data-today={day.isToday}
            data-selected={day.isSelected}
            data-debt={day.isDebtDay}
            data-testid={`week-day-${day.iso}`}
            aria-pressed={day.isSelected}
            onClick={() => onSelectDay(day.iso)}
          >
            {day.isDebtDay ? <span className={styles.dot} aria-hidden /> : null}
            <span className={styles.weekday}>{day.weekday}</span>
            <Avatar person={day.person} size="sm" />
          </button>
        ))}
      </div>
      <div className={styles.legend}>
        <span className={styles.dot} aria-hidden />
        дни гашения долга
      </div>
    </div>
  )
}, 'WeekStrip')
```

Create `client/widgets/ofelia-poop-duty/ui/parts/WeekStrip.module.css`:

```css
.root {
  display: flex;
  flex-direction: column;
  gap: 0.6875rem;
}

.grid {
  display: flex;
  gap: 0.4375rem;
}

.day {
  position: relative;
  flex: 1;
  min-inline-size: 0;
  block-size: 5.125rem;
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  gap: 0.5625rem;
  border: 1px solid var(--border);
  border-radius: 0.625rem;
  background: var(--surface);
  cursor: pointer;
}

.day[data-selected='true'] {
  border: 1.5px solid var(--primary);
  background: var(--accent-soft);
}

.day[data-today='true'] .weekday {
  color: var(--primary);
  font-weight: 600;
}

.weekday {
  font-family: var(--font-mono);
  font-size: 0.65rem;
  color: var(--text-3);
}

.dot {
  position: absolute;
  inset-block-start: 0.5rem;
  inset-inline-end: 0.5rem;
  inline-size: 0.375rem;
  block-size: 0.375rem;
  border-radius: 999px;
  background: var(--primary);
}

.legend {
  display: flex;
  align-items: center;
  gap: 0.4375rem;
  font-size: 0.72rem;
  color: var(--text-3);
}

.legend .dot {
  position: static;
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `pnpm --filter client test -- WeekStrip`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add client/widgets/ofelia-poop-duty/ui/parts/WeekStrip.tsx client/widgets/ofelia-poop-duty/ui/parts/WeekStrip.module.css client/widgets/ofelia-poop-duty/ui/parts/WeekStrip.test.tsx
git commit -m "feat(ofelia): WeekStrip calendar part with day selection"
```

---

## Task 6: `ActionButtons` part (confirm / undo / в долг / простить)

**Files:**

- Create: `client/widgets/ofelia-poop-duty/ui/parts/ActionButtons.tsx`
- Create: `client/widgets/ofelia-poop-duty/ui/parts/ActionButtons.module.css`
- Create: `client/widgets/ofelia-poop-duty/ui/parts/ActionButtons.test.tsx`

**Interfaces:**

- Consumes: `lucide-react` icons (`Check`, `Clock`, `Minus`, `Undo2`).
- Produces: `ActionButtons` — `reatomMemo`, props:
  ```ts
  type ActionButtonsProps = {
    status: 'pending' | 'closed'
    canUndo: boolean
    canForgive: boolean
    compact?: boolean
    alwaysSecondary?: boolean
    onConfirm: () => void
    onUndo: () => void
    onDebt: () => void
    onForgive: () => void
  }
  ```
  - **`compact`**: three icon buttons — confirm (✓), в долг (clock), простить (−). The "простить" button is `disabled` when `!canForgive`. (Used by the compact tier.)
  - **full primary block**: `status: 'pending'` → a primary "Какашки убраны" (→ `onConfirm`); `status: 'closed'` → a green "Уборка подтверждена" plaque + an "Откатить" icon button **only when `canUndo`** (→ `onUndo`).
  - **full secondary row** ("Простить" when `canForgive` → `onForgive`; "В долг" → `onDebt`): shown when `status === 'pending'` **or** `alwaysSecondary` (the RichLayout panel passes `alwaysSecondary` so debt actions stay reachable after confirming; the standard tier omits it, so state B shows only the plaque).
  - All buttons have accessible names (button text or `aria-label`).

- [ ] **Step 1: Write the failing test**

Create `client/widgets/ofelia-poop-duty/ui/parts/ActionButtons.test.tsx`:

```tsx
// @vitest-environment jsdom
import { fireEvent, render, screen } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'

import { ActionButtons } from './ActionButtons'

const handlers = () => ({
  onConfirm: vi.fn(),
  onUndo: vi.fn(),
  onDebt: vi.fn(),
  onForgive: vi.fn(),
})

describe('ActionButtons (full)', () => {
  it('shows confirm + secondary actions when the day is pending', () => {
    const h = handlers()
    render(<ActionButtons status="pending" canUndo={false} canForgive {...h} />)

    fireEvent.click(screen.getByRole('button', { name: 'Какашки убраны' }))
    expect(h.onConfirm).toHaveBeenCalledOnce()

    fireEvent.click(screen.getByRole('button', { name: 'В долг' }))
    expect(h.onDebt).toHaveBeenCalledOnce()

    fireEvent.click(screen.getByRole('button', { name: 'Простить' }))
    expect(h.onForgive).toHaveBeenCalledOnce()
  })

  it('hides "Простить" when there is no debt to forgive', () => {
    render(<ActionButtons status="pending" canUndo={false} canForgive={false} {...handlers()} />)
    expect(screen.queryByRole('button', { name: 'Простить' })).not.toBeInTheDocument()
  })

  it('shows the confirmed plaque with undo when closed and undoable', () => {
    const h = handlers()
    render(<ActionButtons status="closed" canUndo canForgive={false} {...h} />)

    expect(screen.getByText('Уборка подтверждена')).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: 'Откатить' }))
    expect(h.onUndo).toHaveBeenCalledOnce()
  })

  it('omits the undo button when closed but not undoable', () => {
    render(<ActionButtons status="closed" canUndo={false} canForgive={false} {...handlers()} />)
    expect(screen.queryByRole('button', { name: 'Откатить' })).not.toBeInTheDocument()
  })

  it('keeps the secondary row after confirmation when alwaysSecondary is set', () => {
    render(
      <ActionButtons status="closed" canUndo canForgive alwaysSecondary {...handlers()} />,
    )
    expect(screen.getByText('Уборка подтверждена')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'В долг' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Простить' })).toBeInTheDocument()
  })

  it('hides the secondary row in the plain closed state', () => {
    render(<ActionButtons status="closed" canUndo canForgive {...handlers()} />)
    expect(screen.queryByRole('button', { name: 'В долг' })).not.toBeInTheDocument()
  })
})

describe('ActionButtons (compact)', () => {
  it('renders three icon actions and disables forgive without debt', () => {
    const h = handlers()
    render(<ActionButtons compact status="pending" canUndo={false} canForgive={false} {...h} />)

    fireEvent.click(screen.getByRole('button', { name: 'Подтвердить уборку' }))
    expect(h.onConfirm).toHaveBeenCalledOnce()

    expect(screen.getByRole('button', { name: 'Простить' })).toBeDisabled()
  })
})
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `pnpm --filter client test -- ActionButtons`
Expected: FAIL — `./ActionButtons` not found.

- [ ] **Step 3: Write the component + styles**

Create `client/widgets/ofelia-poop-duty/ui/parts/ActionButtons.tsx`:

```tsx
import { Check, Clock, Minus, Undo2 } from 'lucide-react'

import { reatomMemo } from '@/shared/reatom/reatom-memo'

import styles from './ActionButtons.module.css'

export type ActionButtonsProps = {
  status: 'pending' | 'closed'
  canUndo: boolean
  canForgive: boolean
  compact?: boolean
  alwaysSecondary?: boolean
  onConfirm: () => void
  onUndo: () => void
  onDebt: () => void
  onForgive: () => void
}

export const ActionButtons = reatomMemo<ActionButtonsProps>(
  ({
    status,
    canUndo,
    canForgive,
    compact = false,
    alwaysSecondary = false,
    onConfirm,
    onUndo,
    onDebt,
    onForgive,
  }) => {
    if (compact) {
      return (
        <div className={styles.icons}>
          <button
            type="button"
            className={styles.icon}
            aria-label="Подтвердить уборку"
            onClick={onConfirm}
          >
            <Check size={14} aria-hidden />
          </button>
          <button type="button" className={styles.icon} aria-label="В долг" onClick={onDebt}>
            <Clock size={13} aria-hidden />
          </button>
          <button
            type="button"
            className={styles.icon}
            aria-label="Простить"
            disabled={!canForgive}
            onClick={onForgive}
          >
            <Minus size={13} aria-hidden />
          </button>
        </div>
      )
    }

    const showSecondary = status === 'pending' || alwaysSecondary

    return (
      <div className={styles.stack}>
        {status === 'closed' ? (
          <div className={styles.confirmedRow}>
            <div className={styles.plaque}>
              <Check size={16} aria-hidden />
              Уборка подтверждена
            </div>
            {canUndo ? (
              <button type="button" className={styles.undo} aria-label="Откатить" onClick={onUndo}>
                <Undo2 size={15} aria-hidden />
              </button>
            ) : null}
          </div>
        ) : (
          <button type="button" className={styles.primary} onClick={onConfirm}>
            <Check size={17} aria-hidden />
            Какашки убраны
          </button>
        )}
        {showSecondary ? (
          <div className={styles.secondary}>
            {canForgive ? (
              <button type="button" className={styles.ghost} onClick={onForgive}>
                <Minus size={14} aria-hidden />
                Простить
              </button>
            ) : null}
            <button type="button" className={styles.ghost} onClick={onDebt}>
              <Clock size={15} aria-hidden />
              В долг
            </button>
          </div>
        ) : null}
      </div>
    )
  },
  'ActionButtons',
)
```

Create `client/widgets/ofelia-poop-duty/ui/parts/ActionButtons.module.css`:

```css
.icons {
  display: flex;
  gap: 0.3125rem;
}

.icon {
  display: grid;
  place-items: center;
  inline-size: 1.625rem;
  block-size: 1.625rem;
  border: 1px solid var(--border);
  border-radius: 0.4375rem;
  background: var(--surface);
  color: var(--primary);
  cursor: pointer;
}

.icon:disabled {
  color: var(--text-3);
  cursor: not-allowed;
  opacity: 0.6;
}

.stack {
  display: flex;
  flex-direction: column;
  gap: 0.4375rem;
}

.primary {
  display: flex;
  align-items: center;
  justify-content: center;
  gap: 0.5rem;
  block-size: 2.625rem;
  border: none;
  border-radius: 0.6875rem;
  background: var(--primary);
  color: var(--primary-foreground);
  font: inherit;
  font-weight: 600;
  cursor: pointer;
}

.secondary {
  display: flex;
  gap: 0.4375rem;
}

.ghost {
  flex: 1;
  display: flex;
  align-items: center;
  justify-content: center;
  gap: 0.375rem;
  block-size: 2.5rem;
  border: 1px solid var(--border);
  border-radius: 0.625rem;
  background: var(--surface);
  color: var(--text);
  font: inherit;
  font-weight: 600;
  font-size: 0.82rem;
  cursor: pointer;
}

.confirmedRow {
  display: flex;
  align-items: center;
  gap: 0.4375rem;
  block-size: 2.625rem;
}

.plaque {
  flex: 1;
  display: flex;
  align-items: center;
  justify-content: center;
  gap: 0.5rem;
  block-size: 2.625rem;
  border-radius: 0.6875rem;
  background: var(--ofelia-ok-soft);
  color: var(--ofelia-ok-fg);
  font-weight: 600;
}

.undo {
  flex: none;
  display: grid;
  place-items: center;
  inline-size: 2.625rem;
  block-size: 2.625rem;
  border: 1px solid var(--border);
  border-radius: 0.6875rem;
  background: var(--surface);
  color: var(--text-dim);
  cursor: pointer;
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `pnpm --filter client test -- ActionButtons`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add client/widgets/ofelia-poop-duty/ui/parts/ActionButtons.tsx client/widgets/ofelia-poop-duty/ui/parts/ActionButtons.module.css client/widgets/ofelia-poop-duty/ui/parts/ActionButtons.test.tsx
git commit -m "feat(ofelia): ActionButtons part (full + compact variants)"
```

---

## Task 7: `OfeliaContext` + shared test fixture

The tiers and `RichLayout` need the derived `view`, `currentUser`, action/nav callbacks, and the history/comments data. Rather than drill that bundle router → tier → RichLayout → panel, the **router provides it via React context** (same idiom as `WidgetFrame.context.ts`) and composition layers read `useOfelia()`. The context carries the reactive fields as **atoms** (`view`/`currentUser`/`history`/`comments`) plus stable `wrap`-ed `actions`/`nav`/`onSend`, so tiers subscribe granularly by calling `view()` etc. Leaf parts (Avatar/DebtChips/WeekStrip/ActionButtons/UserToggle/HistoryList/CommentThread) stay pure and prop-driven — the tier reads context and hands each leaf its plain slice.

**Files:**

- Create: `client/widgets/ofelia-poop-duty/ui/ofelia-context.ts`
- Create: `client/widgets/ofelia-poop-duty/ui/ofelia.fixture.ts` (test-only factory; never imported by app code)
- Create: `client/widgets/ofelia-poop-duty/ui/ofelia-context.test.tsx`

**Interfaces:**

- Consumes: `OfeliaViewModel`, `OfeliaActions`, `OfeliaWeekNav`, plus slice types `SelectedDayView`/`DebtBalanceEntry`/`WeekDayView` (from `./view-model`); `HistoryEntryView`, `Person` (from `../model/ofelia-duty`); `CommentView` (from `../model/ofelia-comments`).
- Produces:
  - `type OfeliaContextValue = { view: OfeliaViewModel; currentUser: Atom<Person>; history: Atom<HistoryEntryView[]>; comments: Atom<CommentView[]>; actions: OfeliaActions; nav: OfeliaWeekNav; onSend: (text: string) => void }` — `view` is the **record of focused computeds** (consumers call `view.selected()`, `view.balance()`, … and each subscribes to exactly one slice); `currentUser`/`history`/`comments` are atoms; `actions`/`nav`/`onSend` are stable `wrap`-ed handlers. Readiness lives at `view.ready()`, so the router's loading guard subscribes to just that boolean.
  - `const ofeliaContext: React.Context<OfeliaContextValue | null>` — used directly as `<ofeliaContext.Provider>` by the router (Task 12).
  - `function useOfelia(): OfeliaContextValue` — throws `'OfeliaContext is not available'` when read outside a provider (mirrors `useWidgetFrameContext`).
  - `function makeOfeliaValue(overrides?): OfeliaContextValue` and `function makeOfeliaView(overrides?): OfeliaViewModel` (fixture) — default to a realistic current week (today = Tue 2026-06-16, Карина gasit dolg 2 days, debt day Wed 2026-06-17). `makeOfeliaView` builds the **record of atoms** but its override API stays on plain slice values (`ready`/`selected`/`days`/`balance`/`canForgive`), and `makeOfeliaValue` wraps `currentUser`/`history`/`comments` in `atom(...)` — so tier tests keep passing plain objects. `makeOfeliaView` derives `canForgive` (and `selectedPerson`) from the overridden `selected`/`balance` unless passed explicitly. Handlers default to no-ops; tests override individual fields.

- [ ] **Step 1: Write the failing test**

Create `client/widgets/ofelia-poop-duty/ui/ofelia-context.test.tsx`:

```tsx
// @vitest-environment jsdom
import { render, screen } from '@testing-library/react'
import { describe, expect, it } from 'vitest'

import { ofeliaContext, useOfelia } from './ofelia-context'
import { makeOfeliaValue } from './ofelia.fixture'

function Probe() {
  const { currentUser } = useOfelia()
  return <span>{currentUser()}</span>
}

describe('useOfelia', () => {
  it('throws when used outside a provider', () => {
    expect(() => render(<Probe />)).toThrow('OfeliaContext is not available')
  })

  it('exposes the provided value', () => {
    render(
      <ofeliaContext.Provider value={makeOfeliaValue({ currentUser: 'Леша' })}>
        <Probe />
      </ofeliaContext.Provider>,
    )
    expect(screen.getByText('Леша')).toBeInTheDocument()
  })
})
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `pnpm --filter client test -- ofelia-context`
Expected: FAIL — `./ofelia-context` / `./ofelia.fixture` not found.

- [ ] **Step 3: Write the context + fixture**

Create `client/widgets/ofelia-poop-duty/ui/ofelia-context.ts`:

```ts
import { createContext, useContext } from 'react'
import type { Atom } from '@reatom/core'

import type { CommentView } from '../model/ofelia-comments'
import type { HistoryEntryView, Person } from '../model/ofelia-duty'

import type { OfeliaActions, OfeliaViewModel, OfeliaWeekNav } from './view-model'

export type OfeliaContextValue = {
  // The atomic view-model: a record of focused computeds (consumers call
  // `view.selected()`, `view.balance()`, … so each subscribes to one slice).
  view: OfeliaViewModel
  currentUser: Atom<Person>
  history: Atom<HistoryEntryView[]>
  comments: Atom<CommentView[]>
  actions: OfeliaActions
  nav: OfeliaWeekNav
  onSend: (text: string) => void
}

export const ofeliaContext = createContext<OfeliaContextValue | null>(null)

export function useOfelia(): OfeliaContextValue {
  const value = useContext(ofeliaContext)
  if (!value) throw new Error('OfeliaContext is not available')
  return value
}
```

Create `client/widgets/ofelia-poop-duty/ui/ofelia.fixture.ts` (test-only; imported solely by `*.test.tsx`):

```ts
import { atom } from '@reatom/core'

import type { CommentView } from '../model/ofelia-comments'
import type { HistoryEntryView, Person } from '../model/ofelia-duty'

import type { OfeliaContextValue } from './ofelia-context'
import type {
  DebtBalanceEntry,
  OfeliaActions,
  OfeliaViewModel,
  SelectedDayView,
  WeekDayView,
} from './view-model'

const noop = () => {}

const WEEK: WeekDayView[] = [
  { iso: '2026-06-15', weekday: 'ПН', dayOfMonth: 15, person: 'Леша', isToday: false, isDebtDay: false, isSelected: false },
  { iso: '2026-06-16', weekday: 'ВТ', dayOfMonth: 16, person: 'Карина', isToday: true, isDebtDay: false, isSelected: true },
  { iso: '2026-06-17', weekday: 'СР', dayOfMonth: 17, person: 'Карина', isToday: false, isDebtDay: true, isSelected: false },
  { iso: '2026-06-18', weekday: 'ЧТ', dayOfMonth: 18, person: 'Леша', isToday: false, isDebtDay: false, isSelected: false },
  { iso: '2026-06-19', weekday: 'ПТ', dayOfMonth: 19, person: 'Карина', isToday: false, isDebtDay: false, isSelected: false },
  { iso: '2026-06-20', weekday: 'СБ', dayOfMonth: 20, person: 'Леша', isToday: false, isDebtDay: false, isSelected: false },
  { iso: '2026-06-21', weekday: 'ВС', dayOfMonth: 21, person: 'Карина', isToday: false, isDebtDay: false, isSelected: false },
]

const DEFAULT_SELECTED: SelectedDayView = {
  iso: '2026-06-16',
  person: 'Карина',
  isDebtDay: true,
  status: 'pending',
  canUndo: false,
  debtRemaining: 2,
}

const DEFAULT_BALANCE: DebtBalanceEntry[] = [
  { person: 'Леша', debt: 0, over: false },
  { person: 'Карина', debt: 2, over: false },
]

// Override API stays on plain slice values; each field is wrapped in an atom.
type OfeliaViewOverrides = {
  ready?: boolean
  selected?: SelectedDayView | null
  days?: WeekDayView[]
  balance?: DebtBalanceEntry[]
  canForgive?: boolean
}

export function makeOfeliaView(o: OfeliaViewOverrides = {}): OfeliaViewModel {
  const selected = o.selected === undefined ? DEFAULT_SELECTED : o.selected
  const balance = o.balance ?? DEFAULT_BALANCE

  return {
    ready: atom(o.ready ?? true, 'fixture.ready'),
    selected: atom<SelectedDayView | null>(selected, 'fixture.selected'),
    selectedPerson: atom<Person | null>(selected?.person ?? null, 'fixture.selectedPerson'),
    days: atom<WeekDayView[]>(o.days ?? WEEK, 'fixture.days'),
    balance: atom<DebtBalanceEntry[]>(balance, 'fixture.balance'),
    canForgive: atom(o.canForgive ?? balance.some((entry) => entry.debt > 0), 'fixture.canForgive'),
  }
}

type MakeOfeliaValueOptions = {
  view?: OfeliaViewModel
  currentUser?: Person
  history?: HistoryEntryView[]
  comments?: CommentView[]
  actions?: Partial<OfeliaActions>
  onSend?: (text: string) => void
}

export function makeOfeliaValue(o: MakeOfeliaValueOptions = {}): OfeliaContextValue {
  return {
    view: o.view ?? makeOfeliaView(),
    currentUser: atom<Person>(o.currentUser ?? 'Карина', 'fixture.currentUser'),
    history: atom<HistoryEntryView[]>(o.history ?? [], 'fixture.history'),
    comments: atom<CommentView[]>(o.comments ?? [], 'fixture.comments'),
    actions: {
      onConfirm: noop,
      onUndo: noop,
      onDebt: noop,
      onForgive: noop,
      onSelectDay: noop,
      onSetUser: noop,
      ...o.actions,
    },
    nav: { onPrevWeek: noop, onNextWeek: noop, onCurrentWeek: noop },
    onSend: o.onSend ?? noop,
  }
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `pnpm --filter client test -- ofelia-context`
Expected: PASS. (React logs the expected render error for the "throws" case — that is normal.)

- [ ] **Step 5: Commit**

```bash
git add client/widgets/ofelia-poop-duty/ui/ofelia-context.ts client/widgets/ofelia-poop-duty/ui/ofelia.fixture.ts client/widgets/ofelia-poop-duty/ui/ofelia-context.test.tsx
git commit -m "feat(ofelia): OfeliaContext + shared view fixture"
```

---

## Task 8: `RichLayout` (two-column shell for large/fullscreen)

**Files:**

- Create: `client/widgets/ofelia-poop-duty/ui/parts/RichLayout.tsx`
- Create: `client/widgets/ofelia-poop-duty/ui/parts/RichLayout.module.css`
- Create: `client/widgets/ofelia-poop-duty/ui/parts/RichLayout.test.tsx`

**Interfaces:**

- Consumes: `useOfelia` (the shell reads only the duty slices it needs — `view.selected()`/`view.balance()`/`view.canForgive()`/`view.days()` + `currentUser()`; it does **not** read `history()`/`comments()`); parts `Avatar`, `ActionButtons`, `WeekStrip`, `UserToggle`, `HistoryList` (F4), `CommentThread` (F5); helpers `formatWeekRange`, `pluralizeDays`, `selectedDaySubtitle`; `lucide-react` `Cat`, `ChevronLeft`, `ChevronRight`, `X`.
- Produces: `RichLayout` — `reatomMemo`, props `{ onClose?: () => void }` (the **only** prop; everything else comes from context). Plus two **local connected columns** `HistoryColumn`/`CommentsColumn` (each reads only `history()` / `comments()` so an SSE update to one stream re-renders just that column, not the panel). Renders the header (cat icon + "Лоток Офелии" + `large` badge + `UserToggle` + a close `X` when `onClose` is given), the left selected-day panel (Avatar, name, status subtitle, `ActionButtons` with `alwaysSecondary`, hint, debt-balance block), and the right column (week nav with range + prev/today/next, `WeekStrip`, then a `HistoryColumn` | `CommentsColumn` split).

- [ ] **Step 1: Write the failing test**

Create `client/widgets/ofelia-poop-duty/ui/parts/RichLayout.test.tsx`:

```tsx
// @vitest-environment jsdom
import { fireEvent, render, screen } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import type { ReactNode } from 'react'

import { ofeliaContext } from '../ofelia-context'
import type { OfeliaContextValue } from '../ofelia-context'
import { makeOfeliaValue } from '../ofelia.fixture'

import { RichLayout } from './RichLayout'

function renderRich(value: OfeliaContextValue, node: ReactNode) {
  return render(<ofeliaContext.Provider value={value}>{node}</ofeliaContext.Provider>)
}

describe('RichLayout', () => {
  it('renders the header, week range, calendar, and empty history/comments', () => {
    renderRich(makeOfeliaValue(), <RichLayout />)

    expect(screen.getByText('Лоток Офелии')).toBeInTheDocument()
    expect(screen.getByText('15–21 июня')).toBeInTheDocument()
    expect(screen.getByText('ПН')).toBeInTheDocument()
    expect(screen.getByText('Пока нет событий')).toBeInTheDocument()
    expect(screen.getByText('Пока нет комментариев')).toBeInTheDocument()
  })

  it('wires week navigation and day selection from context', () => {
    const onPrevWeek = vi.fn()
    const onSelectDay = vi.fn()
    const value = makeOfeliaValue()
    value.nav.onPrevWeek = onPrevWeek
    value.actions.onSelectDay = onSelectDay

    renderRich(value, <RichLayout />)

    fireEvent.click(screen.getByRole('button', { name: 'Прошлая неделя' }))
    expect(onPrevWeek).toHaveBeenCalledOnce()

    fireEvent.click(screen.getByTestId('week-day-2026-06-19'))
    expect(onSelectDay).toHaveBeenCalledWith('2026-06-19')
  })

  it('shows the close affordance only when onClose is provided', () => {
    const onClose = vi.fn()
    const { rerender } = renderRich(makeOfeliaValue(), <RichLayout onClose={onClose} />)
    fireEvent.click(screen.getByRole('button', { name: 'Закрыть' }))
    expect(onClose).toHaveBeenCalledOnce()

    rerender(
      <ofeliaContext.Provider value={makeOfeliaValue()}>
        <RichLayout />
      </ofeliaContext.Provider>,
    )
    expect(screen.queryByRole('button', { name: 'Закрыть' })).not.toBeInTheDocument()
  })
})
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `pnpm --filter client test -- RichLayout`
Expected: FAIL — `./RichLayout` not found.

- [ ] **Step 3: Write the component + styles**

Create `client/widgets/ofelia-poop-duty/ui/parts/RichLayout.tsx`:

```tsx
import { Cat, ChevronLeft, ChevronRight, X } from 'lucide-react'

import { reatomMemo } from '@/shared/reatom/reatom-memo'

import { useOfelia } from '../ofelia-context'
import { formatWeekRange, pluralizeDays, selectedDaySubtitle } from '../format'
import { ActionButtons } from './ActionButtons'
import { Avatar } from './Avatar'
import { CommentThread } from './CommentThread'
import { HistoryList } from './HistoryList'
import { UserToggle } from './UserToggle'
import { WeekStrip } from './WeekStrip'

import styles from './RichLayout.module.css'

export type RichLayoutProps = {
  onClose?: () => void
}

// Connected columns: each reads only its own stream atom, so an SSE update to
// history or comments re-renders just that column — never the selected-day panel.
const HistoryColumn = reatomMemo(() => {
  const { history } = useOfelia()
  return <HistoryList entries={history()} />
}, 'HistoryColumn')

const CommentsColumn = reatomMemo(() => {
  const { comments, onSend } = useOfelia()
  return <CommentThread comments={comments()} onSend={onSend} />
}, 'CommentsColumn')

export const RichLayout = reatomMemo<RichLayoutProps>(({ onClose }) => {
  const { view, currentUser, actions, nav } = useOfelia()
  const selected = view.selected()
  if (!selected) return null

  const balance = view.balance()
  const canForgive = view.canForgive()
  const days = view.days()
  const selectedDay = days.find((day) => day.isSelected)
  const range = formatWeekRange(days)

  return (
    <div className={styles.root}>
      <header className={styles.header}>
        <div className={styles.heading}>
          <span className={styles.tile}>
            <Cat size={21} aria-hidden />
          </span>
          <div>
            <div className={styles.titleRow}>
              <span className={styles.title}>Лоток Офелии</span>
              <span className={styles.badge}>large</span>
            </div>
            <div className={styles.subtitle}>Кто убирает за Офелией · чередование</div>
          </div>
        </div>
        <div className={styles.headerActions}>
          <UserToggle value={currentUser()} onChange={actions.onSetUser} />
          {onClose ? (
            <button type="button" className={styles.close} aria-label="Закрыть" onClick={onClose}>
              <X size={17} aria-hidden />
            </button>
          ) : null}
        </div>
      </header>

      <div className={styles.body}>
        <section className={styles.panel}>
          <div className={styles.panelLabel}>{selectedDay?.isToday ? 'Сегодня' : selectedDay?.weekday}</div>
          <div className={styles.today}>
            <Avatar person={selected.person} size="lg" />
            <div className={styles.todayName}>{selected.person}</div>
            <span className={styles.statusChip}>{selectedDaySubtitle(selected, balance)}</span>
          </div>

          <ActionButtons
            status={selected.status}
            canUndo={selected.canUndo}
            canForgive={canForgive}
            alwaysSecondary
            onConfirm={actions.onConfirm}
            onUndo={actions.onUndo}
            onDebt={actions.onDebt}
            onForgive={actions.onForgive}
          />

          <p className={styles.hint}>Не успеваешь — сегодня уберёт другой, а тебе запишется +1 день.</p>

          <div className={styles.balance}>
            <div className={styles.balanceTitle}>Баланс долга</div>
            {balance.map((entry) => (
              <div key={entry.person} className={styles.balanceRow} data-over={entry.over}>
                <Avatar person={entry.person} size="sm" />
                <span className={styles.balanceName}>{entry.person}</span>
                <span className={styles.balanceValue}>{pluralizeDays(entry.debt)}</span>
              </div>
            ))}
          </div>
        </section>

        <section className={styles.detail}>
          <div className={styles.weekNav}>
            <div className={styles.weekTitle}>
              <span className={styles.weekLabel}>Неделя</span>
              <span className={styles.weekRange}>{range}</span>
            </div>
            <div className={styles.weekButtons}>
              <button
                type="button"
                className={styles.navButton}
                aria-label="Прошлая неделя"
                onClick={nav.onPrevWeek}
              >
                <ChevronLeft size={15} aria-hidden />
              </button>
              <button type="button" className={styles.todayButton} onClick={nav.onCurrentWeek}>
                Сегодня
              </button>
              <button
                type="button"
                className={styles.navButton}
                aria-label="Следующая неделя"
                onClick={nav.onNextWeek}
              >
                <ChevronRight size={15} aria-hidden />
              </button>
            </div>
          </div>

          <WeekStrip days={days} onSelectDay={actions.onSelectDay} />

          <div className={styles.split}>
            <div className={styles.historyCol}>
              <div className={styles.colLabel}>История</div>
              <HistoryColumn />
            </div>
            <div className={styles.commentsCol}>
              <div className={styles.colLabel}>Комментарии</div>
              <CommentsColumn />
            </div>
          </div>
        </section>
      </div>
    </div>
  )
}, 'RichLayout')
```

Create `client/widgets/ofelia-poop-duty/ui/parts/RichLayout.module.css`:

```css
.root {
  display: flex;
  flex-direction: column;
  block-size: 100%;
  min-block-size: 0;
  background: var(--surface);
  color: var(--text);
}

.header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 0.75rem;
  padding: 1rem 1.25rem;
  border-bottom: 1px solid var(--border);
}

.heading {
  display: flex;
  align-items: center;
  gap: 0.75rem;
}

.tile {
  display: grid;
  place-items: center;
  inline-size: 2.5rem;
  block-size: 2.5rem;
  border-radius: 0.6875rem;
  background: var(--accent-soft);
  color: var(--primary);
}

.titleRow {
  display: flex;
  align-items: center;
  gap: 0.5625rem;
}

.title {
  font-weight: 600;
  font-size: 1.0625rem;
}

.badge {
  font-family: var(--font-mono);
  font-size: 0.62rem;
  letter-spacing: 0.06em;
  text-transform: uppercase;
  color: var(--primary);
  background: var(--accent-soft);
  border-radius: 0.3125rem;
  padding: 0.125rem 0.4375rem;
}

.subtitle {
  margin-block-start: 0.125rem;
  font-size: 0.8rem;
  color: var(--text-3);
}

.headerActions {
  display: flex;
  align-items: center;
  gap: 0.625rem;
}

.close {
  display: grid;
  place-items: center;
  inline-size: 2.125rem;
  block-size: 2.125rem;
  border: 1px solid var(--border);
  border-radius: 0.5625rem;
  background: var(--background);
  color: var(--text-dim);
  cursor: pointer;
}

.body {
  flex: 1;
  display: flex;
  gap: 1.375rem;
  padding: 1.375rem;
  min-block-size: 0;
}

.panel {
  inline-size: 15rem;
  flex: none;
  display: flex;
  flex-direction: column;
  gap: 0.75rem;
}

.panelLabel {
  font-family: var(--font-mono);
  font-size: 0.66rem;
  letter-spacing: 0.08em;
  text-transform: uppercase;
  color: var(--text-3);
}

.today {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 0.5625rem;
  padding: 1.25rem 0 1rem;
  background: var(--background);
  border: 1px solid var(--border);
  border-radius: 0.875rem;
}

.todayName {
  font-weight: 600;
  font-size: 1.375rem;
}

.statusChip {
  font-family: var(--font-mono);
  font-size: 0.68rem;
  color: var(--primary);
  background: var(--accent-soft);
  border-radius: 0.375rem;
  padding: 0.1875rem 0.5625rem;
}

.hint {
  margin: 0;
  font-size: 0.74rem;
  line-height: 1.45;
  color: var(--text-3);
}

.balance {
  margin-block-start: auto;
  padding-block-start: 0.875rem;
  border-top: 1px solid var(--border);
  display: flex;
  flex-direction: column;
  gap: 0.5625rem;
}

.balanceTitle {
  font-family: var(--font-mono);
  font-size: 0.66rem;
  letter-spacing: 0.08em;
  text-transform: uppercase;
  color: var(--text-3);
}

.balanceRow {
  display: flex;
  align-items: center;
  gap: 0.625rem;
}

.balanceName {
  flex: 1;
  font-size: 0.8rem;
}

.balanceValue {
  font-family: var(--font-mono);
  font-size: 0.8rem;
  color: var(--text);
}

.balanceRow[data-over='true'] .balanceValue {
  color: var(--destructive);
}

.detail {
  flex: 1;
  display: flex;
  flex-direction: column;
  min-inline-size: 0;
  gap: 0.875rem;
}

.weekNav {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 0.625rem;
}

.weekTitle {
  display: flex;
  align-items: baseline;
  gap: 0.625rem;
  min-inline-size: 0;
}

.weekLabel {
  font-family: var(--font-mono);
  font-size: 0.66rem;
  letter-spacing: 0.08em;
  text-transform: uppercase;
  color: var(--text-3);
}

.weekRange {
  font-weight: 600;
  font-size: 0.8rem;
  color: var(--text-dim);
  white-space: nowrap;
}

.weekButtons {
  display: flex;
  align-items: center;
  gap: 0.375rem;
}

.navButton {
  display: grid;
  place-items: center;
  inline-size: 1.75rem;
  block-size: 1.75rem;
  border: 1px solid var(--border);
  border-radius: 0.5rem;
  background: var(--surface);
  color: var(--text-dim);
  cursor: pointer;
}

.todayButton {
  block-size: 1.75rem;
  padding: 0 0.625rem;
  border: 1px solid var(--border);
  border-radius: 0.5rem;
  background: var(--surface);
  color: var(--text-dim);
  font: inherit;
  font-size: 0.72rem;
  cursor: pointer;
}

.split {
  flex: 1;
  display: flex;
  min-block-size: 0;
  gap: 0.875rem;
  padding-block-start: 0.875rem;
  border-top: 1px solid var(--border);
}

.historyCol {
  inline-size: 12.25rem;
  flex: none;
  overflow-y: auto;
  padding-inline-end: 0.875rem;
  border-inline-end: 1px solid var(--border);
}

.commentsCol {
  flex: 1;
  min-inline-size: 0;
  display: flex;
  flex-direction: column;
  overflow: hidden;
}

.colLabel {
  font-family: var(--font-mono);
  font-size: 0.66rem;
  letter-spacing: 0.08em;
  text-transform: uppercase;
  color: var(--text-3);
  margin-block-end: 0.5rem;
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `pnpm --filter client test -- RichLayout`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add client/widgets/ofelia-poop-duty/ui/parts/RichLayout.tsx client/widgets/ofelia-poop-duty/ui/parts/RichLayout.module.css client/widgets/ofelia-poop-duty/ui/parts/RichLayout.test.tsx
git commit -m "feat(ofelia): RichLayout two-column shell (context-driven)"
```

---

## Task 9: `TinyTier` + `CompactTier`

**Files:**

- Create: `client/widgets/ofelia-poop-duty/ui/tiers/TinyTier.tsx`
- Create: `client/widgets/ofelia-poop-duty/ui/tiers/TinyTier.module.css`
- Create: `client/widgets/ofelia-poop-duty/ui/tiers/CompactTier.tsx`
- Create: `client/widgets/ofelia-poop-duty/ui/tiers/CompactTier.module.css`
- Create: `client/widgets/ofelia-poop-duty/ui/tiers/Tiers.test.tsx`

**Interfaces:**

- Consumes: `useOfelia`; parts `Avatar`, `ActionButtons`, `DebtChips`, `UserToggle`.
- Produces:
  - `TinyTier` — `reatomMemo`, no props. Centered Avatar (`lg`) + the selected/today person's name. **No** UserToggle, **no** actions.
  - `CompactTier` — `reatomMemo`, no props. Top row: "Сегодня убирает" label + `ActionButtons` (`compact`). Middle: Avatar (`md`) + name + short subtitle (`гасит долг` / `по очереди`). Bottom row: `DebtChips` + `UserToggle`.

- [ ] **Step 1: Write the failing test**

Create `client/widgets/ofelia-poop-duty/ui/tiers/Tiers.test.tsx`:

```tsx
// @vitest-environment jsdom
import { fireEvent, render, screen } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import type { ReactNode } from 'react'

import { ofeliaContext } from '../ofelia-context'
import type { OfeliaContextValue } from '../ofelia-context'
import { makeOfeliaValue } from '../ofelia.fixture'

import { CompactTier } from './CompactTier'
import { TinyTier } from './TinyTier'

function withOfelia(value: OfeliaContextValue, node: ReactNode) {
  return render(<ofeliaContext.Provider value={value}>{node}</ofeliaContext.Provider>)
}

describe('TinyTier', () => {
  it('shows the current person and no controls', () => {
    withOfelia(makeOfeliaValue(), <TinyTier />)
    expect(screen.getByText('Карина')).toBeInTheDocument()
    expect(screen.queryByRole('button')).not.toBeInTheDocument()
  })
})

describe('CompactTier', () => {
  it('renders the label, the icon actions, and the user toggle', () => {
    withOfelia(makeOfeliaValue(), <CompactTier />)
    expect(screen.getByText('Сегодня убирает')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Подтвердить уборку' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: /Леша/ })).toBeInTheDocument()
  })

  it('confirms the day through context', () => {
    const onConfirm = vi.fn()
    const value = makeOfeliaValue()
    value.actions.onConfirm = onConfirm
    withOfelia(value, <CompactTier />)

    fireEvent.click(screen.getByRole('button', { name: 'Подтвердить уборку' }))
    expect(onConfirm).toHaveBeenCalledOnce()
  })

  it('switches the current user through the toggle', () => {
    const onSetUser = vi.fn()
    const value = makeOfeliaValue()
    value.actions.onSetUser = onSetUser
    withOfelia(value, <CompactTier />)

    fireEvent.click(screen.getByRole('button', { name: /Леша/ }))
    expect(onSetUser).toHaveBeenCalledWith('Леша')
  })
})
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `pnpm --filter client test -- Tiers`
Expected: FAIL — `./TinyTier` / `./CompactTier` not found.

- [ ] **Step 3: Write the components + styles**

Create `client/widgets/ofelia-poop-duty/ui/tiers/TinyTier.tsx`:

```tsx
import { reatomMemo } from '@/shared/reatom/reatom-memo'

import { useOfelia } from '../ofelia-context'
import { Avatar } from '../parts/Avatar'

import styles from './TinyTier.module.css'

export const TinyTier = reatomMemo(() => {
  // Reads only the primitive `selectedPerson` → re-renders solely on a name change.
  const person = useOfelia().view.selectedPerson()
  if (!person) return null

  return (
    <div className={styles.root}>
      <Avatar person={person} size="lg" />
      <div className={styles.name}>{person}</div>
    </div>
  )
}, 'TinyTier')
```

Create `client/widgets/ofelia-poop-duty/ui/tiers/TinyTier.module.css`:

```css
.root {
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  gap: 0.625rem;
  block-size: 100%;
  padding: 0.75rem;
}

.name {
  font-weight: 600;
  font-size: 0.95rem;
}
```

Create `client/widgets/ofelia-poop-duty/ui/tiers/CompactTier.tsx`:

```tsx
import { reatomMemo } from '@/shared/reatom/reatom-memo'

import { useOfelia } from '../ofelia-context'
import { ActionButtons } from '../parts/ActionButtons'
import { Avatar } from '../parts/Avatar'
import { DebtChips } from '../parts/DebtChips'
import { UserToggle } from '../parts/UserToggle'

import styles from './CompactTier.module.css'

export const CompactTier = reatomMemo(() => {
  const { view, currentUser, actions } = useOfelia()
  const selected = view.selected()
  if (!selected) return null

  const balance = view.balance()
  const canForgive = view.canForgive()
  const subtitle = selected.isDebtDay ? 'гасит долг' : 'по очереди'

  return (
    <div className={styles.root}>
      <div className={styles.top}>
        <span className={styles.label}>Сегодня убирает</span>
        <ActionButtons
          compact
          status={selected.status}
          canUndo={selected.canUndo}
          canForgive={canForgive}
          onConfirm={actions.onConfirm}
          onUndo={actions.onUndo}
          onDebt={actions.onDebt}
          onForgive={actions.onForgive}
        />
      </div>

      <div className={styles.who}>
        <Avatar person={selected.person} size="md" />
        <div>
          <div className={styles.name}>{selected.person}</div>
          <div className={styles.sub}>{subtitle}</div>
        </div>
      </div>

      <div className={styles.bottom}>
        <DebtChips balance={balance} />
        <UserToggle value={currentUser()} onChange={actions.onSetUser} />
      </div>
    </div>
  )
}, 'CompactTier')
```

Create `client/widgets/ofelia-poop-duty/ui/tiers/CompactTier.module.css`:

```css
.root {
  display: flex;
  flex-direction: column;
  justify-content: space-between;
  block-size: 100%;
  gap: 0.75rem;
  padding: 1rem 1.125rem;
}

.top {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 0.5rem;
}

.label {
  font-family: var(--font-mono);
  font-size: 0.66rem;
  letter-spacing: 0.08em;
  text-transform: uppercase;
  color: var(--text-3);
}

.who {
  display: flex;
  align-items: center;
  gap: 0.75rem;
}

.name {
  font-weight: 600;
  font-size: 1.3125rem;
}

.sub {
  margin-block-start: 0.1875rem;
  font-size: 0.75rem;
  color: var(--text-3);
}

.bottom {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 0.625rem;
  flex-wrap: wrap;
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `pnpm --filter client test -- Tiers`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add client/widgets/ofelia-poop-duty/ui/tiers/TinyTier.tsx client/widgets/ofelia-poop-duty/ui/tiers/TinyTier.module.css client/widgets/ofelia-poop-duty/ui/tiers/CompactTier.tsx client/widgets/ofelia-poop-duty/ui/tiers/CompactTier.module.css client/widgets/ofelia-poop-duty/ui/tiers/Tiers.test.tsx
git commit -m "feat(ofelia): TinyTier + CompactTier (context-driven)"
```

---

## Task 10: `StandardTier` (states A/B/C)

**Files:**

- Create: `client/widgets/ofelia-poop-duty/ui/tiers/StandardTier.tsx`
- Create: `client/widgets/ofelia-poop-duty/ui/tiers/StandardTier.module.css`
- Create: `client/widgets/ofelia-poop-duty/ui/tiers/StandardTier.test.tsx`

**Interfaces:**

- Consumes: `useOfelia`; parts `Avatar`, `ActionButtons`, `DebtChips`, `UserToggle`; helper `selectedDaySubtitle`; `lucide-react` `Cat`.
- Produces: `StandardTier` — `reatomMemo`, no props. Header ("Лоток Офелии"), "Сегодня убирает" label, Avatar (`md`) + name + full subtitle, divider, "Долг" row with `DebtChips`, hint, `UserToggle`, and `ActionButtons` **without** `alwaysSecondary` so the three reference states fall out of the model: **A** (pending debt day) → confirm + secondary; **B** (closed) → plaque (+undo if `canUndo`), no secondary; **C** (no debt, pending) → confirm + secondary.

- [ ] **Step 1: Write the failing test**

Create `client/widgets/ofelia-poop-duty/ui/tiers/StandardTier.test.tsx`:

```tsx
// @vitest-environment jsdom
import { render, screen } from '@testing-library/react'
import { describe, expect, it } from 'vitest'
import type { ReactNode } from 'react'

import { ofeliaContext } from '../ofelia-context'
import type { OfeliaContextValue } from '../ofelia-context'
import { makeOfeliaValue, makeOfeliaView } from '../ofelia.fixture'

import { StandardTier } from './StandardTier'

function withOfelia(value: OfeliaContextValue, node: ReactNode) {
  return render(<ofeliaContext.Provider value={value}>{node}</ofeliaContext.Provider>)
}

describe('StandardTier', () => {
  it('state A — open debt day shows the confirm button and the debt subtitle', () => {
    withOfelia(makeOfeliaValue(), <StandardTier />)
    expect(screen.getByText('Лоток Офелии')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Какашки убраны' })).toBeInTheDocument()
    expect(screen.getByText('гасит долг · осталось 2 дня')).toBeInTheDocument()
  })

  it('state B — a closed day shows the plaque and no secondary actions', () => {
    const view = makeOfeliaView({
      selected: {
        iso: '2026-06-16',
        person: 'Карина',
        isDebtDay: true,
        status: 'closed',
        canUndo: true,
        debtRemaining: 1,
      },
    })
    withOfelia(makeOfeliaValue({ view }), <StandardTier />)

    expect(screen.getByText('Уборка подтверждена')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Откатить' })).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'В долг' })).not.toBeInTheDocument()
  })

  it('state C — no debt shows the flat-balance subtitle', () => {
    const view = makeOfeliaView({
      selected: {
        iso: '2026-06-16',
        person: 'Леша',
        isDebtDay: false,
        status: 'pending',
        canUndo: false,
        debtRemaining: 0,
      },
      balance: [
        { person: 'Леша', debt: 0, over: false },
        { person: 'Карина', debt: 0, over: false },
      ],
    })
    withOfelia(makeOfeliaValue({ view }), <StandardTier />)

    expect(screen.getByText('по очереди · долгов нет')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Какашки убраны' })).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Простить' })).not.toBeInTheDocument()
  })
})
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `pnpm --filter client test -- StandardTier`
Expected: FAIL — `./StandardTier` not found.

- [ ] **Step 3: Write the component + styles**

Create `client/widgets/ofelia-poop-duty/ui/tiers/StandardTier.tsx`:

```tsx
import { Cat } from 'lucide-react'

import { reatomMemo } from '@/shared/reatom/reatom-memo'

import { selectedDaySubtitle } from '../format'
import { useOfelia } from '../ofelia-context'
import { ActionButtons } from '../parts/ActionButtons'
import { Avatar } from '../parts/Avatar'
import { DebtChips } from '../parts/DebtChips'
import { UserToggle } from '../parts/UserToggle'

import styles from './StandardTier.module.css'

export const StandardTier = reatomMemo(() => {
  const { view, currentUser, actions } = useOfelia()
  const selected = view.selected()
  if (!selected) return null

  const balance = view.balance()
  const canForgive = view.canForgive()

  return (
    <div className={styles.root}>
      <div className={styles.title}>
        <Cat size={16} aria-hidden />
        Лоток Офелии
      </div>

      <div className={styles.label}>Сегодня убирает</div>
      <div className={styles.who}>
        <Avatar person={selected.person} size="md" />
        <div>
          <div className={styles.name}>{selected.person}</div>
          <div className={styles.sub}>{selectedDaySubtitle(selected, balance)}</div>
        </div>
      </div>

      <div className={styles.divider} />

      <div className={styles.debtRow}>
        <span className={styles.debtLabel}>Долг</span>
        <DebtChips balance={balance} />
      </div>

      <div className={styles.spacer} />

      <div className={styles.footer}>
        <UserToggle value={currentUser()} onChange={actions.onSetUser} />
        <ActionButtons
          status={selected.status}
          canUndo={selected.canUndo}
          canForgive={canForgive}
          onConfirm={actions.onConfirm}
          onUndo={actions.onUndo}
          onDebt={actions.onDebt}
          onForgive={actions.onForgive}
        />
      </div>
    </div>
  )
}, 'StandardTier')
```

Create `client/widgets/ofelia-poop-duty/ui/tiers/StandardTier.module.css`:

```css
.root {
  display: flex;
  flex-direction: column;
  block-size: 100%;
  padding: 1.0625rem 1.125rem;
}

.title {
  display: flex;
  align-items: center;
  gap: 0.5rem;
  color: var(--text-dim);
  font-weight: 600;
  font-size: 0.8125rem;
}

.label {
  margin-block-start: 0.75rem;
  font-family: var(--font-mono);
  font-size: 0.66rem;
  letter-spacing: 0.08em;
  text-transform: uppercase;
  color: var(--text-3);
}

.who {
  display: flex;
  align-items: center;
  gap: 0.75rem;
  margin-block-start: 0.6875rem;
}

.name {
  font-weight: 600;
  font-size: 1.5rem;
}

.sub {
  margin-block-start: 0.25rem;
  font-size: 0.78rem;
  color: var(--text-3);
}

.divider {
  block-size: 1px;
  background: var(--border);
  margin: 0.8125rem 0;
}

.debtRow {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 0.5rem;
}

.debtLabel {
  font-family: var(--font-mono);
  font-size: 0.66rem;
  letter-spacing: 0.08em;
  text-transform: uppercase;
  color: var(--text-3);
}

.spacer {
  flex: 1;
}

.footer {
  display: flex;
  flex-direction: column;
  gap: 0.625rem;
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `pnpm --filter client test -- StandardTier`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add client/widgets/ofelia-poop-duty/ui/tiers/StandardTier.tsx client/widgets/ofelia-poop-duty/ui/tiers/StandardTier.module.css client/widgets/ofelia-poop-duty/ui/tiers/StandardTier.test.tsx
git commit -m "feat(ofelia): StandardTier with A/B/C states (context-driven)"
```

---

## Task 11: `LargeTier` + `FullscreenTier`

**Files:**

- Create: `client/widgets/ofelia-poop-duty/ui/tiers/LargeTier.tsx`
- Create: `client/widgets/ofelia-poop-duty/ui/tiers/FullscreenTier.tsx`
- Create: `client/widgets/ofelia-poop-duty/ui/tiers/RichTiers.test.tsx`

**Interfaces:**

- Consumes: `RichLayout` (Task 8). Both read the same context the router provides.
- Produces:
  - `LargeTier` — `reatomMemo`, no props. Renders `<RichLayout />` (no close affordance — it is an inline board card).
  - `FullscreenTier` — `reatomMemo`, props `{ onClose: () => void }`. Renders `<RichLayout onClose={onClose} />` (the close `X` is the only divergence from `large`, kept as a separate tier so behaviour can split later).

- [ ] **Step 1: Write the failing test**

Create `client/widgets/ofelia-poop-duty/ui/tiers/RichTiers.test.tsx`:

```tsx
// @vitest-environment jsdom
import { fireEvent, render, screen } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import type { ReactNode } from 'react'

import { ofeliaContext } from '../ofelia-context'
import { makeOfeliaValue } from '../ofelia.fixture'

import { FullscreenTier } from './FullscreenTier'
import { LargeTier } from './LargeTier'

function withOfelia(node: ReactNode) {
  return render(<ofeliaContext.Provider value={makeOfeliaValue()}>{node}</ofeliaContext.Provider>)
}

describe('LargeTier', () => {
  it('renders the rich layout without a close button', () => {
    withOfelia(<LargeTier />)
    expect(screen.getByText('Лоток Офелии')).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Закрыть' })).not.toBeInTheDocument()
  })
})

describe('FullscreenTier', () => {
  it('renders the rich layout with a wired close button', () => {
    const onClose = vi.fn()
    withOfelia(<FullscreenTier onClose={onClose} />)

    fireEvent.click(screen.getByRole('button', { name: 'Закрыть' }))
    expect(onClose).toHaveBeenCalledOnce()
  })
})
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `pnpm --filter client test -- RichTiers`
Expected: FAIL — `./LargeTier` / `./FullscreenTier` not found.

- [ ] **Step 3: Write the components**

Create `client/widgets/ofelia-poop-duty/ui/tiers/LargeTier.tsx`:

```tsx
import { reatomMemo } from '@/shared/reatom/reatom-memo'

import { RichLayout } from '../parts/RichLayout'

export const LargeTier = reatomMemo(() => {
  return <RichLayout />
}, 'LargeTier')
```

Create `client/widgets/ofelia-poop-duty/ui/tiers/FullscreenTier.tsx`:

```tsx
import { reatomMemo } from '@/shared/reatom/reatom-memo'

import { RichLayout } from '../parts/RichLayout'

export type FullscreenTierProps = {
  onClose: () => void
}

export const FullscreenTier = reatomMemo<FullscreenTierProps>(({ onClose }) => {
  return <RichLayout onClose={onClose} />
}, 'FullscreenTier')
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `pnpm --filter client test -- RichTiers`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add client/widgets/ofelia-poop-duty/ui/tiers/LargeTier.tsx client/widgets/ofelia-poop-duty/ui/tiers/FullscreenTier.tsx client/widgets/ofelia-poop-duty/ui/tiers/RichTiers.test.tsx
git commit -m "feat(ofelia): LargeTier + FullscreenTier wrappers"
```

---

## Task 12: Router — wire models, provide context, route by tier

**Files:**

- Modify (rewrite): `client/widgets/ofelia-poop-duty/ui/OfeliaPoopDuty.tsx`
- Modify (rewrite): `client/widgets/ofelia-poop-duty/ui/OfeliaPoopDuty.test.tsx`

**Interfaces:**

- Consumes: `ofeliaDutyModel`, `ofeliaCommentsModel`, `Person`; `makeOfeliaViewModel`, `ofeliaContext`, `OfeliaContextValue`; all five tier components; `getServerTime`; `WidgetRuntimeProps`, `WidgetTier`; `wrap` (`@reatom/core`). (`formatWeekRange` is no longer used here — `RichLayout` owns the range; the `computed`s live inside `makeOfeliaViewModel`.)
- Produces: `OfeliaPoopDuty` — the widget entry component. Instantiates both models (memoised on `storage`), and in a single `useMemo` (keyed on the models) assembles a **stable** `OfeliaContextValue`: the atomic `view` record from `makeOfeliaViewModel(dutyModel)`, the model's own `currentUser`/`historyView`/`commentThread` atoms, and `wrap`-ed `actions`/`nav`/`onSend` built once. Each day-scoped action reads the resolved selected day via `view.selected()?.iso` at call time (so it always targets the day shown in the panel); week navigation resets `selectedDate` to `null` (spec §3.1.1). The loading guard reads `view.ready()` (a boolean `computed`) so the router re-renders only when sync flips — the tiers subscribe to their own slices. Provides the value through `ofeliaContext.Provider` and renders the tier matching `tier`.

- [ ] **Step 1: Rewrite the test**

Replace `client/widgets/ofelia-poop-duty/ui/OfeliaPoopDuty.test.tsx` with:

```tsx
// @vitest-environment jsdom
import { render, screen } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { createFakeTimer } from '@/shared/timer/model/fakes'
import type { ServerTime } from '@/shared/timer/model/server-time'
import { createWidgetStorage } from '@/storage/model/widget-storage'
import type { WidgetTier } from '@/widget-host/model/tier'
import type { WidgetRuntimeProps } from '@/widget-host/model/types'

import { OfeliaPoopDuty } from './OfeliaPoopDuty'

const timerHolder = vi.hoisted(() => ({ current: null as ServerTime | null }))

vi.mock('@/shared/timer/model/server-time', () => ({
  getServerTime: () => timerHolder.current,
}))

function props(tier: WidgetTier): WidgetRuntimeProps {
  return {
    instanceId: 'ofelia-poop-duty-1',
    typeId: 'ofelia-poop-duty',
    mode: 'small',
    tier,
    theme: 'light',
    requestFullscreen: vi.fn(),
    requestClose: vi.fn(),
    reportError: vi.fn(),
    storage: createWidgetStorage({ instanceId: 'ofelia-poop-duty-1', typeId: 'ofelia-poop-duty' }),
  }
}

beforeEach(() => {
  timerHolder.current = createFakeTimer({ today: Temporal.PlainDate.from('2026-06-16') })
})

afterEach(() => {
  vi.clearAllMocks()
})

describe('OfeliaPoopDuty tier routing', () => {
  it('tiny — shows only the current person', () => {
    render(<OfeliaPoopDuty {...props('tiny')} />)
    expect(screen.getByText('Леша')).toBeInTheDocument()
    expect(screen.queryByText('Сегодня убирает')).not.toBeInTheDocument()
  })

  it('compact — shows the label and the icon actions', () => {
    render(<OfeliaPoopDuty {...props('compact')} />)
    expect(screen.getByText('Сегодня убирает')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Подтвердить уборку' })).toBeInTheDocument()
  })

  it('standard — shows the card title and the confirm button', () => {
    render(<OfeliaPoopDuty {...props('standard')} />)
    expect(screen.getByText('Лоток Офелии')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Какашки убраны' })).toBeInTheDocument()
  })

  it('large — shows the week navigation and the empty history/comments', () => {
    render(<OfeliaPoopDuty {...props('large')} />)
    expect(screen.getByText('Неделя')).toBeInTheDocument()
    expect(screen.getByText('Пока нет событий')).toBeInTheDocument()
    expect(screen.getByText('Пока нет комментариев')).toBeInTheDocument()
  })

  it('fullscreen — exposes the close affordance', () => {
    render(<OfeliaPoopDuty {...props('fullscreen')} />)
    expect(screen.getByRole('button', { name: 'Закрыть' })).toBeInTheDocument()
  })

  it('shows a loading state before the first server-time sync', () => {
    timerHolder.current = createFakeTimer()
    render(<OfeliaPoopDuty {...props('standard')} />)
    expect(screen.getByText('Загрузка…')).toBeInTheDocument()
  })
})
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `pnpm --filter client test -- OfeliaPoopDuty`
Expected: FAIL — the old `mode`-based component does not render tiers (`Подтвердить уборку`, `Неделя`, etc. are absent).

- [ ] **Step 3: Rewrite the component**

Replace `client/widgets/ofelia-poop-duty/ui/OfeliaPoopDuty.tsx` with:

```tsx
import { wrap } from '@reatom/core'
import { useMemo } from 'react'
import type { ReactNode } from 'react'

import { reatomMemo } from '@/shared/reatom/reatom-memo'
import { getServerTime } from '@/shared/timer/model/server-time'
import type { WidgetTier } from '@/widget-host/model/tier'
import type { WidgetRuntimeProps } from '@/widget-host/model/types'

import { ofeliaCommentsModel } from '../model/ofelia-comments'
import { ofeliaDutyModel } from '../model/ofelia-duty'
import type { Person } from '../model/ofelia-duty'

import { ofeliaContext } from './ofelia-context'
import type { OfeliaContextValue } from './ofelia-context'
import { CompactTier } from './tiers/CompactTier'
import { FullscreenTier } from './tiers/FullscreenTier'
import { LargeTier } from './tiers/LargeTier'
import { StandardTier } from './tiers/StandardTier'
import { TinyTier } from './tiers/TinyTier'
import { makeOfeliaViewModel } from './view-model'

import styles from './ofelia-poop-duty.module.css'

export const OfeliaPoopDuty = reatomMemo<WidgetRuntimeProps>(({ tier, storage, requestClose }) => {
  const dutyModel = useMemo(() => ofeliaDutyModel({ storage, timer: getServerTime() }), [storage])
  const commentsModel = useMemo(
    () =>
      ofeliaCommentsModel({
        storage,
        viewWeekStart: dutyModel.viewWeekStart,
        currentUser: dutyModel.currentUser,
      }),
    [storage, dutyModel],
  )

  // One stable, model-scoped context value. `view` is the atomic view-model — a
  // record of focused computeds (`view.selected()`, `view.balance()`, …) — so each
  // tier subscribes to a single slice. The wrapped handlers are built once and read
  // the resolved selected day via `view.selected()` at call time, so an action
  // always hits the day the panel shows (no stale per-render `targetDate`).
  const value = useMemo<OfeliaContextValue>(() => {
    const view = makeOfeliaViewModel(dutyModel)

    const targetDate = (): Temporal.PlainDate | null => {
      const iso = view.selected()?.iso
      return iso ? Temporal.PlainDate.from(iso) : null
    }

    return {
      view,
      currentUser: dutyModel.currentUser,
      history: dutyModel.historyView,
      comments: commentsModel.commentThread,
      actions: {
        onConfirm: wrap(() => {
          const date = targetDate()
          if (date) dutyModel.confirmClean(date)
        }),
        onUndo: wrap(() => dutyModel.undo()),
        onDebt: wrap(() => {
          const date = targetDate()
          if (date) dutyModel.goIntoDebt(date)
        }),
        onForgive: wrap(() => {
          const date = targetDate()
          if (date) dutyModel.forgive(date)
        }),
        onSelectDay: wrap((iso: string) => dutyModel.selectedDate.set(Temporal.PlainDate.from(iso))),
        onSetUser: wrap((person: Person) => dutyModel.currentUser.set(person)),
      },
      nav: {
        onPrevWeek: wrap(() => {
          dutyModel.goToPrevWeek()
          dutyModel.selectedDate.set(null)
        }),
        onNextWeek: wrap(() => {
          dutyModel.goToNextWeek()
          dutyModel.selectedDate.set(null)
        }),
        onCurrentWeek: wrap(() => {
          dutyModel.goToCurrentWeek()
          dutyModel.selectedDate.set(null)
        }),
      },
      onSend: wrap((text: string) => commentsModel.send(text)),
    }
  }, [dutyModel, commentsModel])

  // The loading guard subscribes to just the boolean readiness slice; the first
  // server-time sync flips it to true and the tiers (reading other slices) mount.
  if (!value.view.ready()) {
    return (
      <div className={styles.widget} data-tier={tier satisfies WidgetTier}>
        <div className={styles.loading}>Загрузка…</div>
      </div>
    )
  }

  let content: ReactNode = null
  switch (tier) {
    case 'tiny':
      content = <TinyTier />
      break
    case 'compact':
      content = <CompactTier />
      break
    case 'standard':
      content = <StandardTier />
      break
    case 'large':
      content = <LargeTier />
      break
    case 'fullscreen':
      content = <FullscreenTier onClose={requestClose} />
      break
  }

  return (
    <div className={styles.widget} data-tier={tier satisfies WidgetTier}>
      <ofeliaContext.Provider value={value}>{content}</ofeliaContext.Provider>
    </div>
  )
}, 'OfeliaPoopDuty')
```

Then delete the now-dead `mode`-based rules from `client/widgets/ofelia-poop-duty/ui/ofelia-poop-duty.module.css` — the old component was their only consumer. Remove `.root`, `.small`, `.label`, `.title`, `.person`, `.meta`, `.tomorrow`, `.smallTomorrow`; **keep** the `.widget`, `:root[data-theme='dark'] .widget`, and `.loading` rules added in Task 2.

- [ ] **Step 4: Run the test to verify it passes**

Run: `pnpm --filter client test -- OfeliaPoopDuty`
Expected: PASS (all six routing cases).

- [ ] **Step 5: Commit**

```bash
git add client/widgets/ofelia-poop-duty/ui/OfeliaPoopDuty.tsx client/widgets/ofelia-poop-duty/ui/OfeliaPoopDuty.test.tsx client/widgets/ofelia-poop-duty/ui/ofelia-poop-duty.module.css
git commit -m "feat(ofelia): tier router wiring duty + comments models via context"
```

---
