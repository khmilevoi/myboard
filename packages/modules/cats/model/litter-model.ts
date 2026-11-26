import { action, atom, computed, wrap } from '@reatom/core'
import type { Action, Atom, AtomLike, Computed } from '@reatom/core'
import { StorageError, withStorageKeyReadonly } from 'widget-runtime'
import type { ModuleApiError } from 'widget-runtime'
import type { ModuleContext } from 'widget-runtime/define-module'

import type { catsActionSchemas } from '../domain/actions'
import { foldDebt, getDebtDays, type DebtDay, type NumberOfDebts } from '../domain/debt'
import { ledgerKey, litterSettingsKey } from '../domain/keys'
import {
  LedgerEntriesSchema,
  resolveDays,
  type DayResolution,
  type LedgerEntry,
} from '../domain/ledger'
import {
  DEFAULT_LITTER_SETTINGS,
  DUTY_TIME_ZONE,
  LitterSettingsSchema,
  weekStartISO,
  type LitterSettings,
} from '../domain/roster'
import { STATS_WINDOW_DAYS, memberStats, type LitterMemberStats } from '../domain/stats'
import { toHistoryGroups, type HistoryDayGroup } from './history-view'
import { makeWeekComments, type LitterWeekComments } from './week-comments'

/** `rawSettings` before the settings key has answered: distinct from an absent key (null). */
const SETTINGS_LOADING = Symbol('cats.settingsLoading')

export type CatsModuleContext = ModuleContext<typeof catsActionSchemas, 'shared'>

export type LitterDayAction = 'clean' | 'debt' | 'forgive' | 'undo'

/** One litter's duty state: its ledger, debts, history, comments and day actions. */
export type LitterModel = {
  ledger: Atom<LedgerEntry[] | null>
  /** A failed ledger read; a later successful ledger event clears it. */
  ledgerError: Atom<StorageError | null>
  /**
   * A failed ledger or settings read, whichever is present; null once both have answered. Either
   * one keeps the rotation-dependent computeds at null, so a view gates its failure screen on this.
   */
  loadError: Computed<StorageError | null>
  ledgerLoading: Atom<boolean>
  /** Reads the ledger and the settings again, clearing whichever error the answer resolves. */
  retryLedger: Action<[], Promise<void>>
  /** The duty rotation: null while loading, the defaults when the key is absent or does not parse. */
  settings: Computed<LitterSettings | null>
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
  const settingsKey = litterSettingsKey(litterId)
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

  // The raw stored value, deliberately without a schema: a value that fails it must reach
  // `settings` below and become the defaults, not a subscription error that leaves every
  // rotation-dependent computed pinned at null. An absent key arrives as the fallback, null.
  const rawSettings = atom<unknown>(SETTINGS_LOADING, name('rawSettings')).extend(
    withStorageKeyReadonly({ api: shared.server, key: settingsKey, fallback: null }),
  )

  const settings = computed<LitterSettings | null>(() => {
    const raw = rawSettings()
    if (raw === SETTINGS_LOADING) return null
    const parsed = LitterSettingsSchema.safeParse(raw)
    return parsed.success ? parsed.data : DEFAULT_LITTER_SETTINGS
  }, name('settings'))

  // `withStorageKeyReadonly` only ever fetches the ledger once, at the
  // connect-frame's initial subscribe — a failed fetch has no built-in retry,
  // and every downstream computed stays pinned at the `null` sentinel
  // forever (F2c). `error`/`isLoading` are attached to `ledger` itself by the
  // extension above; surface them so a view can show a real failure state
  // instead of an endless skeleton.
  const ledgerError = ledger.error
  // A failed settings read keeps `settings` at null, so it is as blocking as a failed ledger
  // read. Each read keeps its own error atom: its listener clears that atom on every successful
  // event of its own key, so a settings failure must not live in the ledger's atom, where the
  // next ledger event would wipe it while `settings` is still null.
  const settingsError = rawSettings.error
  const loadError = computed(() => ledgerError() ?? settingsError(), name('loadError'))
  const ledgerLoading = ledger.isLoading

  // Re-runs the one-shot fetch `withStorageKeyReadonly` already performed at
  // connect time, using the same public `get` the connect hook's `subscribe`
  // is built on.
  const retryLedger = action(async () => {
    ledgerLoading.set(true)
    // The settings key is read again too: its connect-time read failed with the ledger's during
    // an outage, and the rotation-dependent computeds stay null until it answers.
    const [result, rawResult] = await wrap(
      Promise.all([shared.server.get(key, LedgerEntriesSchema), shared.server.get(settingsKey)]),
    )
    ledgerLoading.set(false)
    // Each answer settles only its own key, so a ledger that loads does not hide a settings read
    // that is still failing, and the other way round.
    if (result instanceof Error) {
      ledgerError.set(result)
    } else {
      ledgerError.set(null)
      ledger.set(result ?? [])
    }
    // The settings key is read without a schema, so its value is `unknown`; the only Error
    // `get` returns is a StorageError.
    if (rawResult instanceof StorageError) {
      settingsError.set(rawResult)
    } else {
      settingsError.set(null)
      rawSettings.set(rawResult)
    }
  }, name('retryLedger'))

  const today = computed(() => timer.today(DUTY_TIME_ZONE), name('today'))

  const numberOfDebts = computed(() => {
    const currentSettings = settings()
    const entries = ledger()
    if (currentSettings === null || entries === null) return null
    return foldDebt(currentSettings, entries)
  }, name('numberOfDebts'))

  const dayResolution = computed(() => {
    const entries = ledger()
    return entries === null ? new Map<string, DayResolution>() : resolveDays(entries)
  }, name('dayResolution'))

  const debtDays = computed(() => {
    const currentToday = today()
    const currentSettings = settings()
    const debts = numberOfDebts()
    if (!currentToday || currentSettings === null || debts === null) return null
    return getDebtDays(currentSettings, debts, currentToday, dayResolution()).reduce(
      (acc, debtDay) => {
        acc.set(debtDay.date.toString(), debtDay)
        return acc
      },
      new Map<string, DebtDay>(),
    )
  }, name('debtDays'))

  const stats = computed(() => {
    const currentToday = today()
    const entries = ledger()
    const currentSettings = settings()
    if (!currentToday || entries === null || currentSettings === null) return null
    return memberStats({
      settings: currentSettings,
      entries,
      today: currentToday,
      windowDays: STATS_WINDOW_DAYS,
    })
  }, name('memberStats'))

  // One computed per view: each caller owns the week atom it navigates.
  const historyFor = (weekStart: AtomLike<Temporal.PlainDate | null>) =>
    computed<HistoryDayGroup[]>(() => {
      const week = weekStart()
      const entries = ledger()
      const currentSettings = settings()
      if (!week || entries === null || currentSettings === null) return []

      return toHistoryGroups({
        settings: currentSettings,
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
    loadError,
    ledgerLoading,
    retryLedger,
    settings,
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
