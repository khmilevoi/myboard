import { action, atom, computed, withAsyncData, wrap } from '@reatom/core'
import type { WidgetApi } from '@shared/widgets/contracts'
import { WidgetApiError, withStorageKeyReadonly } from 'widget-runtime'
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

// A day action's failure reaches the board as `WidgetApiError.message`, which
// is the internal `'Widget API request failed: $reason'` template — not
// something a household member should read. Map the codes that can actually
// arrive here (see widget-api.ts's own failure modes and the dispatch codes
// in packages/server/src/widgets/errors.ts) to a short Russian sentence;
// anything unrecognised falls back to the generic message rather than
// leaking English text into an otherwise Russian UI.
const ACTION_ERROR_MESSAGES: Record<string, string> = {
  network: 'Нет соединения с сервером',
  invalid_response: 'Сервер прислал некорректный ответ',
  payload_invalid: 'Некорректные данные запроса',
  unknown_widget: 'Виджет недоступен на сервере',
  unknown_event: 'Это действие недоступно на сервере',
  internal_error: 'Ошибка сервера, попробуйте ещё раз',
}

const GENERIC_ACTION_ERROR_MESSAGE = 'Не удалось выполнить действие'

function mapActionError(error: Error): string {
  if (error instanceof WidgetApiError) {
    return ACTION_ERROR_MESSAGES[error.code] ?? GENERIC_ACTION_ERROR_MESSAGE
  }
  return GENERIC_ACTION_ERROR_MESSAGE
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

  // `withStorageKeyReadonly` only ever fetches the ledger once, at the
  // connect-frame's initial subscribe — a failed fetch has no built-in retry,
  // and every downstream computed stays pinned at the `null` sentinel
  // forever (F2c). `error`/`isLoading` are attached to `ledger` itself by the
  // extension above; surface them so the view can show a real failure state
  // instead of an endless skeleton.
  const ledgerError = ledger.error
  const ledgerLoading = ledger.isLoading

  // Re-runs the one-shot fetch `withStorageKeyReadonly` already performed at
  // connect time, using the same public `get` the connect hook's `subscribe`
  // is built on. `ledger`/`ledger.error`/`ledger.isLoading` are ordinary
  // atoms — nothing stops setting them directly from here, and a genuine
  // reconnect (moving the SSE subscription itself) would need cooperation
  // from `withStorageKeyReadonly` that this read-only extension doesn't
  // expose.
  const retryLedger = action(async () => {
    ledgerLoading.set(true)
    const result = await wrap(storage.shared.server.get(LEDGER_KEY, LedgerEntriesSchema))
    ledgerLoading.set(false)
    if (result instanceof Error) {
      ledgerError.set(result)
      return
    }
    ledgerError.set(null)
    ledger.set(result ?? [])
  }, 'ofeliaDuty.retryLedger')

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

  // The single write path for the "last day-action failure" banner (MEDIUM
  // finding): every call clears it up front, before any await, and the one
  // that actually fails is the one that (re)sets it — so the banner tracks
  // WRITE order, not a fixed per-action precedence. Contrast with reading
  // `confirmClean.error() ?? goIntoDebt.error() ?? …`, which pins to whichever
  // of the four failed FIRST regardless of what has succeeded since.
  const actionFailure = atom<Error | null>(null, 'ofeliaDuty.actionFailure')

  // Every day action is now pure intent: which day, which event. Who the actor
  // is, whose debt moves and whether the event applies at all is derived by the
  // widget server, which also stamps the authenticated account — so the client
  // keeps no copy of that derivation and cannot forge authorship.
  //
  // `selectedDate()` and `today()` are read before the first `await`: a read
  // after it would resolve against the global context, not this widget's.
  // Likewise `actionFailure.set(null)` runs synchronously in this same frame,
  // before the invoke's await — no wrap() needed for it.
  const invokeDay = async (
    event: 'clean' | 'debt' | 'forgive' | 'undo',
    date: Temporal.PlainDate | undefined,
  ) => {
    const target = date ?? selectedDate() ?? today()
    if (target == null) return
    actionFailure.set(null)
    // Continuation after `await` runs outside this frame — repo wrap rules —
    // so the writer is captured now, not hoisted to module scope.
    const setFailure = wrap((next: Error) => actionFailure.set(next))
    const result = await wrap(api.invoke(event, { date: target.toString() }))
    if (result instanceof Error) {
      // Russian mapping is what the UI renders; keep the raw message for logs.
      console.warn('ofelia day action failed:', result.message)
      setFailure(result)
      throw result
    }
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

  // F6a: `invokeDay` re-throws so `withAsyncData` captures the rejection in
  // each action's own `.error()`/`.pending()` — but nothing used to read
  // those atoms. A failed tap looked identical to a successful one, and with
  // the nightly auto-close cron now closing unresolved days, a silently
  // failed "В долг" becomes a wrong, system-signed `cleaned` record later.
  const actionPending = computed(
    () =>
      confirmClean.pending() > 0 ||
      goIntoDebt.pending() > 0 ||
      forgive.pending() > 0 ||
      undo.pending() > 0,
    'ofeliaDuty.actionPending',
  )
  // Passes `actionFailure` through unchanged — see the comment above the atom
  // for why this is write-order, not the four actions' own `.error()`s merged
  // in a fixed `??` chain.
  const actionError = computed(() => actionFailure(), 'ofeliaDuty.actionError')
  // What the UI actually renders: a short Russian sentence, never the raw
  // `WidgetApiError.message` (which carries the internal reason string and,
  // for server-side failures, the server's own English text verbatim).
  const actionErrorMessage = computed(() => {
    const failure = actionFailure()
    return failure ? mapActionError(failure) : null
  }, 'ofeliaDuty.actionErrorMessage')

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
    ledgerError,
    ledgerLoading,
    retryLedger,
    actionPending,
    actionError,
    actionErrorMessage,
  }
}
