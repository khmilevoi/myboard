import { action, atom, computed, wrap } from '@reatom/core'
import type { Action, Atom, AtomLike, Computed } from '@reatom/core'
import { withStorageKeyReadonly } from 'widget-runtime'
import type { ModuleApiError, StorageError } from 'widget-runtime'
import type { ModuleContext } from 'widget-runtime/define-module'

import type { ofeliaActionSchemas } from '../domain/actions'
import { foldDebt, getDebtDays, type DebtDay, type NumberOfDebts } from '../domain/debt'
import { LEDGER_KEY } from '../domain/keys'
import {
  LedgerEntriesSchema,
  resolveDays,
  type DayResolution,
  type LedgerEntry,
} from '../domain/ledger'
import { DUTY_TIME_ZONE, weekStartISO } from '../domain/roster'
import { STATS_WINDOW_DAYS, memberStats, type OfeliaMemberStats } from '../domain/stats'
import { toHistoryGroups, type HistoryDayGroup } from './history-view'
import { makeWeekComments, type OfeliaWeekComments } from './week-comments'

export type OfeliaModuleContext = ModuleContext<typeof ofeliaActionSchemas, 'shared'>

export type OfeliaDayAction = 'clean' | 'debt' | 'forgive' | 'undo'

export type OfeliaModel = {
  ledger: Atom<LedgerEntry[] | null>
  ledgerError: Atom<StorageError | null>
  ledgerLoading: Atom<boolean>
  retryLedger: Action<[], Promise<void>>
  today: Computed<Temporal.PlainDate | null>
  numberOfDebts: Computed<NumberOfDebts | null>
  dayResolution: Computed<Map<string, DayResolution>>
  debtDays: Computed<Map<string, DebtDay> | null>
  memberStats: Computed<OfeliaMemberStats[] | null>
  historyFor(weekStart: AtomLike<Temporal.PlainDate | null>): Computed<HistoryDayGroup[]>
  weekComments(weekStart: AtomLike<Temporal.PlainDate | null>): OfeliaWeekComments
  runDayAction(action: OfeliaDayAction, date: Temporal.PlainDate): Promise<ModuleApiError | void>
  sendComment(weekStart: Temporal.PlainDate, text: string): Promise<ModuleApiError | void>
}

export function makeOfeliaModel(context: OfeliaModuleContext): OfeliaModel {
  const { storage, timer, identity, api } = context
  const shared = storage.shared

  // Reactive mirror of the append-only, server-owned ledger key. null is the
  // "not loaded yet" sentinel the computeds below branch on. The connect hook
  // lives on the atom itself: Reatom's dependency graph connects `ledger` when
  // any derived computed gains a subscriber and disconnects (auto-unsubscribing
  // the SSE listener) when the last one goes away — no manual ref-counting.
  const ledger = atom<LedgerEntry[] | null>(null, 'ofelia.ledger').extend(
    withStorageKeyReadonly({
      api: shared.server,
      key: LEDGER_KEY,
      schema: LedgerEntriesSchema,
      fallback: [],
    }),
  )

  // `withStorageKeyReadonly` only ever fetches the ledger once, at the
  // connect-frame's initial subscribe — a failed fetch has no built-in retry,
  // and every downstream computed stays pinned at the `null` sentinel
  // forever (F2c). `error`/`isLoading` are attached to `ledger` itself by the
  // extension above; surface them so a view can show a real failure state
  // instead of an endless skeleton.
  const ledgerError = ledger.error
  const ledgerLoading = ledger.isLoading

  // Re-runs the one-shot fetch `withStorageKeyReadonly` already performed at
  // connect time, using the same public `get` the connect hook's `subscribe`
  // is built on.
  const retryLedger = action(async () => {
    ledgerLoading.set(true)
    const result = await wrap(shared.server.get(LEDGER_KEY, LedgerEntriesSchema))
    ledgerLoading.set(false)
    if (result instanceof Error) {
      ledgerError.set(result)
      return
    }
    ledgerError.set(null)
    ledger.set(result ?? [])
  }, 'ofelia.retryLedger')

  const today = computed(() => timer.today(DUTY_TIME_ZONE), 'ofelia.today')

  const numberOfDebts = computed(() => {
    const entries = ledger()
    return entries === null ? null : foldDebt(entries)
  }, 'ofelia.numberOfDebts')

  const dayResolution = computed(() => {
    const entries = ledger()
    return entries === null ? new Map<string, DayResolution>() : resolveDays(entries)
  }, 'ofelia.dayResolution')

  const debtDays = computed(() => {
    const currentToday = today()
    const debts = numberOfDebts()
    if (!currentToday || debts === null) return null
    return getDebtDays(debts, currentToday, dayResolution()).reduce((acc, debtDay) => {
      acc.set(debtDay.date.toString(), debtDay)
      return acc
    }, new Map<string, DebtDay>())
  }, 'ofelia.debtDays')

  const stats = computed(() => {
    const currentToday = today()
    const entries = ledger()
    if (!currentToday || entries === null) return null
    return memberStats({ entries, today: currentToday, windowDays: STATS_WINDOW_DAYS })
  }, 'ofelia.memberStats')

  // One computed per view: each caller owns the week atom it navigates.
  const historyFor = (weekStart: AtomLike<Temporal.PlainDate | null>) =>
    computed<HistoryDayGroup[]>(() => {
      const week = weekStart()
      const entries = ledger()
      if (!week || entries === null) return []

      return toHistoryGroups({
        entries,
        weekStartIso: week.toString(),
        members: identity.members(),
        viewerAccountId: identity.viewer()?.accountId ?? null,
      })
    }, 'ofelia.history')

  const weekComments = (weekStart: AtomLike<Temporal.PlainDate | null>) =>
    makeWeekComments({ storage: shared, identity, weekStart })

  // Every day action is pure intent: which day, which event. Who the actor is,
  // whose debt moves and whether the event applies at all is derived by the
  // module server, which also stamps the authenticated account. Failures are
  // returned as values; nothing after the await touches an atom.
  const runDayAction = action(
    async (event: OfeliaDayAction, date: Temporal.PlainDate): Promise<ModuleApiError | void> => {
      const result = await wrap(api.invoke(event, { date: date.toString() }))
      if (result instanceof Error) return result
    },
    'ofelia.runDayAction',
  )

  // The server trims and stamps the authoring account; the empty-text check
  // here only avoids a pointless round trip.
  const sendComment = action(
    async (weekStart: Temporal.PlainDate, text: string): Promise<ModuleApiError | void> => {
      if (text.trim().length === 0) return
      const result = await wrap(api.invoke('comment', { weekStart: weekStartISO(weekStart), text }))
      if (result instanceof Error) return result
    },
    'ofelia.sendComment',
  )

  return {
    ledger,
    ledgerError,
    ledgerLoading,
    retryLedger,
    today,
    numberOfDebts,
    dayResolution,
    debtDays,
    memberStats: stats,
    historyFor,
    weekComments,
    runDayAction,
    sendComment,
  }
}
