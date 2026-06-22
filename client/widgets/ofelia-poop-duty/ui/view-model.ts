import { computed } from '@reatom/core'
import type { AtomLike, Computed } from '@reatom/core'

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
  ready: Computed<boolean>
  selected: Computed<SelectedDayView | null>
  selectedPerson: Computed<Person | null>
  days: Computed<WeekDayView[]>
  balance: Computed<DebtBalanceEntry[]>
  canForgive: Computed<boolean>
}

// Structural subset of `ofeliaDutyModel` — the model is passed in directly.
export type OfeliaDutySources = {
  currentWeek: AtomLike<DutyDay[] | null>
  selectedDate: AtomLike<Temporal.PlainDate | null>
  historyEvents: AtomLike<HistoryEvent[]>
  numberOfDebts: AtomLike<Partial<Record<Person, number>> | null>
}

// `make` (not `create`) per the repo factory convention; named for its output
// (`OfeliaViewModel`) to stay distinct from the test fixture's `makeOfeliaView`.
export function makeOfeliaViewModel(duty: OfeliaDutySources): OfeliaViewModel {
  const ready = computed(() => duty.currentWeek() != null, 'ofelia.ready')

  const selected = computed(() => {
    const week = duty.currentWeek()
    if (!week) return null
    return resolveSelected(
      week,
      duty.selectedDate(),
      duty.historyEvents(),
      duty.numberOfDebts() ?? {},
    )
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
