import { action, atom, computed, withAsyncData, wrap } from '@reatom/core'
import type { WidgetApi } from '@shared/widgets/contracts'
import { withStorageKeyReadonly } from 'widget-runtime'
import type { ServerTime, WidgetIdentity, WidgetStorage } from 'widget-runtime'

import { foldDebt, getDebtDays } from '@/domain/debt'
import type { DebtDay } from '@/domain/debt'
import type { OfeliaEvents } from '@/domain/events'
import { LEDGER_KEY, LedgerEntriesSchema, resolveDays } from '@/domain/ledger'
import type { DayResolution, LedgerEntry } from '@/domain/ledger'
import { DUTY_TIME_ZONE, getOfeliaDutyByDate, getStartOfWeek } from '@/domain/roster'

import { toHistoryGroups } from './history-view'
import type { HistoryDayGroup } from './history-view'

export type { HistoryDayGroup, HistoryEntryView, ToHistoryGroupsOptions } from './history-view'

export interface OfeliaDutyModelProps {
  storage: WidgetStorage
  timer: ServerTime
  api: WidgetApi<OfeliaEvents>
  /** Read by the history view to resolve authors and mark the viewer's own records. */
  identity: WidgetIdentity
}

export const ofeliaDutyModel = ({ storage, timer, api, identity }: OfeliaDutyModelProps) => {
  // Reactive mirror of the append-only, server-owned ledger key. null is the
  // "not loaded yet" sentinel the computeds below branch on. The connect hook
  // lives on the atom itself: Reatom's dependency graph connects `ledger` when
  // any derived computed gains a subscriber and disconnects (auto-unsubscribing
  // the SSE listener) when the last one goes away — no manual ref-counting.
  const ledger = atom<LedgerEntry[] | null>(null, 'ofeliaDuty.ledger').extend(
    withStorageKeyReadonly({
      api: storage.shared.server,
      key: LEDGER_KEY,
      schema: LedgerEntriesSchema,
      fallback: [],
    }),
  )

  const numberOfDebts = computed(() => {
    const entries = ledger()
    return entries === null ? null : foldDebt(entries)
  }, 'ofeliaDuty.numberOfDebts')
  const dayResolution = computed(() => {
    const entries = ledger()
    return entries === null ? new Map<string, DayResolution>() : resolveDays(entries)
  }, 'ofeliaDuty.dayResolution')

  const today = computed(() => timer.today(DUTY_TIME_ZONE), 'today')

  const startOfWeekOverride = atom<Temporal.PlainDate | null>(
    null,
    'ofeliaDuty.startOfWeekOverride',
  )

  const viewWeekStart = computed<Temporal.PlainDate | null>(() => {
    const override = startOfWeekOverride()
    if (override) return override
    const currentToday = today()
    return currentToday ? getStartOfWeek(currentToday) : null
  }, 'ofeliaDuty.viewWeekStart')

  const goToNextWeek = action(() => {
    const base = viewWeekStart()
    if (!base) return
    startOfWeekOverride.set(base.add({ days: 7 }))
  }, 'ofeliaDuty.goToNextWeek')

  const goToPrevWeek = action(() => {
    const base = viewWeekStart()
    if (!base) return
    startOfWeekOverride.set(base.subtract({ days: 7 }))
  }, 'ofeliaDuty.goToPrevWeek')

  const goToCurrentWeek = action(() => {
    startOfWeekOverride.set(null)
  }, 'ofeliaDuty.goToCurrentWeek')

  const selectedDate = atom<Temporal.PlainDate | null>(null, 'ofeliaDuty.selectedDate')

  const historyView = computed<HistoryDayGroup[]>(() => {
    const week = viewWeekStart()
    const entries = ledger()
    if (!week || entries === null) return []

    return toHistoryGroups({
      entries,
      weekStartIso: week.toString(),
      members: identity.members(),
      viewerAccountId: identity.viewer()?.accountId ?? null,
    })
  }, 'ofeliaDuty.historyView')

  const undoAvailable = computed(() => {
    const day = selectedDate() ?? today()
    if (day == null) return false
    return dayResolution().get(day.toString())?.status === 'closed'
  }, 'ofeliaDuty.undoAvailable')

  const debtDays = computed(() => {
    const currentToday = today()
    const debts = numberOfDebts()
    if (!currentToday || debts === null) return null
    return getDebtDays(debts, currentToday, dayResolution()).reduce((acc, debtDay) => {
      acc.set(debtDay.date.toString(), debtDay)
      return acc
    }, new Map<string, DebtDay>())
  }, 'ofeliaDuty.debtDays')

  const currentWeek = computed(() => {
    const currentToday = today()
    const weekStart = viewWeekStart()
    const days = debtDays()
    const resolution = dayResolution()

    if (!currentToday || !weekStart || days === null) {
      return null
    }

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

  // Every day action is now pure intent: which day, which event. Who the actor
  // is, whose debt moves and whether the event applies at all is derived by the
  // widget server, which also stamps the authenticated account — so the client
  // keeps no copy of that derivation and cannot forge authorship.
  //
  // `selectedDate()` and `today()` are read before the first `await`: a read
  // after it would resolve against the global context, not this widget's.
  const invokeDay = async (
    event: 'clean' | 'debt' | 'forgive' | 'undo',
    date: Temporal.PlainDate | undefined,
  ) => {
    const target = date ?? selectedDate() ?? today()
    if (target == null) return
    const result = await wrap(api.invoke(event, { date: target.toString() }))
    if (result instanceof Error) throw result
  }

  const confirmClean = action(
    (date?: Temporal.PlainDate) => invokeDay('clean', date),
    'ofeliaDuty.confirmClean',
  ).extend(withAsyncData({ status: true }))

  const goIntoDebt = action(
    (date?: Temporal.PlainDate) => invokeDay('debt', date),
    'ofeliaDuty.goIntoDebt',
  ).extend(withAsyncData({ status: true }))

  const forgive = action(
    (date?: Temporal.PlainDate) => invokeDay('forgive', date),
    'ofeliaDuty.forgive',
  ).extend(withAsyncData({ status: true }))
  const forgivePending = computed(() => forgive.pending() > 0, 'ofeliaDuty.forgivePending')

  const undo = action(
    (date?: Temporal.PlainDate) => invokeDay('undo', date),
    'ofeliaDuty.undo',
  ).extend(withAsyncData({ status: true }))

  return {
    today,
    startOfWeekOverride,
    viewWeekStart,
    goToNextWeek,
    goToPrevWeek,
    goToCurrentWeek,
    selectedDate,
    numberOfDebts,
    debtDays,
    currentWeek,
    dayResolution,
    historyView,
    undoAvailable,
    forgivePending,
    confirmClean,
    goIntoDebt,
    forgive,
    undo,
  }
}
