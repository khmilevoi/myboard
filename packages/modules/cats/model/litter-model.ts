import { action, atom, computed, wrap } from '@reatom/core'
import type { Action, Atom, AtomLike, Computed } from '@reatom/core'
import { withStorageKeyReadonly } from 'widget-runtime'
import type { ModuleApiError, StorageError } from 'widget-runtime'
import type { ModuleContext } from 'widget-runtime/define-module'

import type { catsActionSchemas } from '../domain/actions'
import { foldDebt, getDebtDays, type DebtDay, type NumberOfDebts } from '../domain/debt'
import { ledgerKey } from '../domain/keys'
import {
  LedgerEntriesSchema,
  resolveDays,
  type DayResolution,
  type LedgerEntry,
} from '../domain/ledger'
import { DUTY_TIME_ZONE, weekStartISO } from '../domain/roster'
import { STATS_WINDOW_DAYS, memberStats, type LitterMemberStats } from '../domain/stats'
import { toHistoryGroups, type HistoryDayGroup } from './history-view'
import { makeWeekComments, type LitterWeekComments } from './week-comments'

export type CatsModuleContext = ModuleContext<typeof catsActionSchemas, 'shared'>

export type LitterDayAction = 'clean' | 'debt' | 'forgive' | 'undo'

/** One litter's duty state: its ledger, debts, history, comments and day actions. */
export type LitterModel = {
  ledger: Atom<LedgerEntry[] | null>
  ledgerError: Atom<StorageError | null>
  ledgerLoading: Atom<boolean>
  retryLedger: Action<[], Promise<void>>
  today: Computed<Temporal.PlainDate | null>
  numberOfDebts: Computed<NumberOfDebts | null>
  dayResolution: Computed<Map<string, DayResolution>>
  debtDays: Computed<Map<string, DebtDay> | null>
  memberStats: Computed<LitterMemberStats[] | null>
  historyFor(weekStart: AtomLike<Temporal.PlainDate | null>): Computed<HistoryDayGroup[]>
  weekComments(weekStart: AtomLike<Temporal.PlainDate | null>): LitterWeekComments
  runDayAction(action: LitterDayAction, date: Temporal.PlainDate): Promise<ModuleApiError | void>
  sendComment(weekStart: Temporal.PlainDate, text: string): Promise<ModuleApiError | void>
}

/**
 * The model of one litter. Every key it reads and every payload it sends carries
 * `litterId`; build it through `CatsModel.litter(id)`, which memoizes it.
 */
export function makeLitterModel(context: CatsModuleContext, litterId: string): LitterModel {
  const { storage, timer, identity, api } = context
  const shared = storage.shared
  const key = ledgerKey(litterId)
  const name = (suffix: string) => `cats.litter.${litterId}.${suffix}`

  // Reactive mirror of the append-only, server-owned ledger key. null is the
  // "not loaded yet" sentinel the computeds below branch on. The connect hook
  // lives on the atom itself: Reatom's dependency graph connects `ledger` when
  // any derived computed gains a subscriber and disconnects (auto-unsubscribing
  // the SSE listener) when the last one goes away — no manual ref-counting.
  const ledger = atom<LedgerEntry[] | null>(null, name('ledger')).extend(
    withStorageKeyReadonly({
      api: shared.server,
      key,
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
    const result = await wrap(shared.server.get(key, LedgerEntriesSchema))
    ledgerLoading.set(false)
    if (result instanceof Error) {
      ledgerError.set(result)
      return
    }
    ledgerError.set(null)
    ledger.set(result ?? [])
  }, name('retryLedger'))

  const today = computed(() => timer.today(DUTY_TIME_ZONE), name('today'))

  const numberOfDebts = computed(() => {
    const entries = ledger()
    return entries === null ? null : foldDebt(entries)
  }, name('numberOfDebts'))

  const dayResolution = computed(() => {
    const entries = ledger()
    return entries === null ? new Map<string, DayResolution>() : resolveDays(entries)
  }, name('dayResolution'))

  const debtDays = computed(() => {
    const currentToday = today()
    const debts = numberOfDebts()
    if (!currentToday || debts === null) return null
    return getDebtDays(debts, currentToday, dayResolution()).reduce((acc, debtDay) => {
      acc.set(debtDay.date.toString(), debtDay)
      return acc
    }, new Map<string, DebtDay>())
  }, name('debtDays'))

  const stats = computed(() => {
    const currentToday = today()
    const entries = ledger()
    if (!currentToday || entries === null) return null
    return memberStats({ entries, today: currentToday, windowDays: STATS_WINDOW_DAYS })
  }, name('memberStats'))

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
    }, name('history'))

  const weekComments = (weekStart: AtomLike<Temporal.PlainDate | null>) =>
    makeWeekComments({ storage: shared, identity, litterId, weekStart })

  // Every day action is pure intent: which day, which event. Who the actor is,
  // whose debt moves and whether the event applies at all is derived by the
  // module server, which also stamps the authenticated account. Failures are
  // returned as values; nothing after the await touches an atom.
  const runDayAction = action(
    async (event: LitterDayAction, date: Temporal.PlainDate): Promise<ModuleApiError | void> => {
      const result = await wrap(api.invoke(event, { litterId, date: date.toString() }))
      if (result instanceof Error) return result
    },
    name('runDayAction'),
  )

  // The server trims and stamps the authoring account; the empty-text check
  // here only avoids a pointless round trip.
  const sendComment = action(
    async (weekStart: Temporal.PlainDate, text: string): Promise<ModuleApiError | void> => {
      if (text.trim().length === 0) return
      const result = await wrap(
        api.invoke('comment', { litterId, weekStart: weekStartISO(weekStart), text }),
      )
      if (result instanceof Error) return result
    },
    name('sendComment'),
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
