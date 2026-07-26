import {
  action,
  atom,
  computed,
  withAsyncData,
  withChangeHook,
  withConnectHook,
  wrap,
} from '@reatom/core'
import { withStorageKeyReadonly } from 'widget-runtime'
import type { ServerTime, WidgetStorage } from 'widget-runtime'

import { foldDebt, getDebtDays } from '@/domain/debt'
import type { DebtDay } from '@/domain/debt'
import { LEDGER_KEY, LedgerEntriesSchema, resolveDays } from '@/domain/ledger'
import type { DayResolution, LedgerEntry, LedgerEntryDraft, LedgerType } from '@/domain/ledger'
import {
  DUTY_ROTATION,
  DUTY_TIME_ZONE,
  getOfeliaDutyByDate,
  getStartOfWeek,
  otherPerson,
  PersonSchema,
  weekStartISO,
} from '@/domain/roster'
import type { Person } from '@/domain/roster'

export const IP_TAIL_LENGTH = 5

export type HistoryEntryView = {
  id: string
  date: string
  type: LedgerType
  actor: Person
  onBehalfOf?: Person
  by: Person
  ipTail: string
}

export interface OfeliaDutyModelProps {
  storage: WidgetStorage
  timer: ServerTime
}

export const ofeliaDutyModel = ({ storage, timer }: OfeliaDutyModelProps) => {
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

  const currentUser = atom<Person>(DUTY_ROTATION[0], 'ofeliaDuty.currentUser').extend(
    withConnectHook(() => {
      void wrap(storage.shared.client.get('currentUser', PersonSchema)).then((storedUser) => {
        if (storedUser instanceof Error || storedUser === null) return
        currentUser.set(storedUser)
      })
    }),
    withChangeHook((state) => {
      void wrap(storage.shared.client.set('currentUser', state))
    }),
  )

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

  const historyView = computed<HistoryEntryView[]>(() => {
    const week = viewWeekStart()
    if (!week) return []
    const entries = ledger()
    if (entries === null) return []
    const weekIso = week.toString()
    return entries
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

  const confirmClean = action(async (date?: Temporal.PlainDate) => {
    const currentToday = today()
    const debts = numberOfDebts()
    if (currentToday == null || debts === null) return
    const target = date ?? selectedDate() ?? currentToday
    const debtDay = getDebtDays(debts, currentToday, dayResolution()).find((day) =>
      day.date.equals(target),
    )
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
    if (currentToday == null || ledger() === null) return
    const target = date ?? selectedDate() ?? currentToday
    const duty = getOfeliaDutyByDate(target)
    const debts = numberOfDebts()
    const debtDay =
      debts &&
      getDebtDays(debts, currentToday, dayResolution()).find((day) => day.date.equals(target))
    const actor = debtDay?.person ?? duty

    const draft: LedgerEntryDraft = {
      date: target.toString(),
      type: 'went_into_debt',
      actor: otherPerson(actor),
      onBehalfOf: actor,
      by: currentUser(),
    }
    const result = await wrap(storage.shared.server.append(LEDGER_KEY, draft))
    if (result instanceof Error) throw result
  }, 'ofeliaDuty.goIntoDebt').extend(withAsyncData({ status: true }))

  const forgive = action(async (date?: Temporal.PlainDate) => {
    const currentToday = today()
    const debts = numberOfDebts()
    if (currentToday == null || debts === null) return
    const target = date ?? selectedDate() ?? currentToday
    const debtDay = getDebtDays(debts, currentToday, dayResolution()).find((day) =>
      day.date.equals(target),
    )
    if (debtDay == null) return
    const duty = getOfeliaDutyByDate(target)
    if (debtDay.person === duty) return

    const draft: LedgerEntryDraft = {
      date: target.toString(),
      type: 'forgiven',
      actor: duty,
      by: currentUser(),
      onBehalfOf: debtDay.person,
    }
    const result = await wrap(storage.shared.server.append(LEDGER_KEY, draft))
    if (result instanceof Error) throw result
  }, 'ofeliaDuty.forgive').extend(withAsyncData({ status: true }))
  const forgivePending = computed(() => forgive.pending() > 0, 'ofeliaDuty.forgivePending')

  const undo = action(async (date?: Temporal.PlainDate) => {
    const target = date ?? selectedDate() ?? today()
    if (target == null || ledger() === null) return
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

  return {
    today,
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
