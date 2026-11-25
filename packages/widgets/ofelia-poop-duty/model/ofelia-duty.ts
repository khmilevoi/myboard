import { action, atom, computed, withAsyncData, wrap } from '@reatom/core'
import type { OfeliaModel } from 'module-ofelia'
import { getOfeliaDutyByDate, getStartOfWeek } from 'module-ofelia/domain/roster'
import { ModuleApiError } from 'widget-runtime'

export type { HistoryDayGroup, HistoryEntryView } from 'module-ofelia'

export interface OfeliaDutyModelProps {
  /** The shared ofelia module model: ledger, debts and day actions. */
  ofelia: OfeliaModel
}

// A day action's failure reaches the board as `ModuleApiError.message`, which
// is the internal `'Module API request failed: $reason'` template — not
// something a household member should read. Map the codes that can actually
// arrive here (see module-api.ts's own failure modes and the module dispatch
// codes on the server) to a short Russian sentence; anything unrecognised falls
// back to the generic message rather than leaking English text into an
// otherwise Russian UI. `unknown_widget` stays for a client still running the
// old cached PWA, which calls the removed widget route.
const ACTION_ERROR_MESSAGES: Record<string, string> = {
  network: 'Нет соединения с сервером',
  invalid_response: 'Сервер прислал некорректный ответ',
  payload_invalid: 'Некорректные данные запроса',
  unknown_module: 'Модуль недоступен на сервере',
  unknown_action: 'Это действие недоступно на сервере',
  account_required: 'Нужно войти в аккаунт',
  unknown_widget: 'Виджет недоступен на сервере',
  unknown_event: 'Это действие недоступно на сервере',
  internal_error: 'Ошибка сервера, попробуйте ещё раз',
}

const GENERIC_ACTION_ERROR_MESSAGE = 'Не удалось выполнить действие'

function mapActionError(error: Error): string {
  if (error instanceof ModuleApiError) {
    return ACTION_ERROR_MESSAGES[error.code] ?? GENERIC_ACTION_ERROR_MESSAGE
  }
  return GENERIC_ACTION_ERROR_MESSAGE
}

/**
 * One duty card's view over the shared ofelia model. Navigation, selection and
 * action status are this card's own; every domain value is the module's atom,
 * passed through, so two cards on one board read one ledger.
 */
export const ofeliaDutyModel = ({ ofelia }: OfeliaDutyModelProps) => {
  const { today, numberOfDebts, dayResolution, debtDays } = ofelia

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

  const historyView = ofelia.historyFor(viewWeekStart)

  const undoAvailable = computed(() => {
    const day = selectedDate() ?? today()
    if (day == null) return false
    return dayResolution().get(day.toString())?.status === 'closed'
  }, 'ofeliaDuty.undoAvailable')

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

  // Every day action is pure intent: which day, which event. Who the actor is,
  // whose debt moves and whether the event applies at all is derived by the
  // module server, which also stamps the authenticated account.
  //
  // `selectedDate()` and `today()` are read before the first `await`: a read
  // after it would resolve against the global context, not this widget's.
  // Likewise `actionFailure.set(null)` runs synchronously in this same frame,
  // before the call's await — no wrap() needed for it.
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
    const result = await wrap(ofelia.runDayAction(event, target))
    if (result instanceof Error) {
      // Russian mapping is what the UI renders; keep the raw message for logs.
      console.warn('ofelia day action failed:', result.message)
      setFailure(result)
      // Re-thrown so `withAsyncData` tracks the failure in `.pending()`/`.error()`.
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

  // F6a: a failed tap must not look identical to a successful one — with the
  // nightly auto-close cron closing unresolved days, a silently failed
  // "В долг" becomes a wrong, system-signed `cleaned` record later.
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
  // `ModuleApiError.message`.
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
    ledgerError: ofelia.ledgerError,
    ledgerLoading: ofelia.ledgerLoading,
    retryLedger: ofelia.retryLedger,
    actionPending,
    actionError,
    actionErrorMessage,
  }
}
