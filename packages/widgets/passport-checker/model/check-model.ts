import { action, atom, computed, effect, withComputed, withConnectHook, wrap } from '@reatom/core'
import type { WidgetApi } from '@shared/widgets/contracts'
import * as errore from 'errore'
import { WidgetApiError, withStorageKey } from 'widget-runtime'
import type { StorageApi } from 'widget-runtime'
import { z } from 'zod'

import type { PassportCheckerEvents, PassportCheckResult, PassportDocumentError } from '../types'

// This deadline exists only to stop the UI from waiting forever if the
// server itself never answers — the server's own timeout is the real
// authority on failure, so this must sit strictly between two server-side
// numbers or it either fires as the normal case or never fires at all:
//   - above the pipeline's own budget (queue wait + task execution), i.e.
//     BROWSER_QUEUE_WAIT_MS + BROWSER_TASK_TIMEOUT_MS in
//     packages/browser-automation/src/config.ts (defaults 30_000 + 60_000 =
//     90_000ms) — a Pi routinely takes close to that long;
//   - below the board server's own HTTP timeout on that call,
//     BROWSER_AUTOMATION_TIMEOUT_MS (docker-compose.yml: 100_000ms) — past
//     that the request is aborted server-side and there is nothing left to
//     arrive late.
// A third number sits above both and must never become the binding one: the
// ingress's own read timeout on this route, `proxy_read_timeout` on the
// `/api/widgets/` location in packages/client/nginx.conf (120_000ms). If that
// timeout is ever lowered below BROWSER_AUTOMATION_TIMEOUT_MS, nginx cuts the
// request with a bare 504 before the board server's own timeout — and before
// this deadline — can fire, so the ordering above silently stops holding.
// A late success (the invoke settling after this deadline already fired) is
// not discarded — see the `withDeadline`/`onLateSuccess` handling below.
export const CHECK_DEADLINE_MS = 95_000

export class CheckDeadlineError extends errore.createTaggedError({
  name: 'CheckDeadlineError',
  message: 'Passport check exceeded $timeoutMs ms',
  extends: errore.AbortError,
}) {}

export type DocumentKey = keyof PassportCheckResult

export type DocumentView =
  | { kind: 'success'; status: number; message: string; checkedAtLabel: string }
  | { kind: 'retryable'; message: string }
  | { kind: 'unchecked' }

export type ResultsViewState = {
  kind: 'results'
  idCard: DocumentView
  internationalPassport: DocumentView
}

export type ViewState =
  | { kind: 'idle' }
  | { kind: 'pending' }
  | ResultsViewState
  | { kind: 'retryable'; message: string }
  | { kind: 'invalidConfig' }
  | { kind: 'sessionRequired'; sshTarget: string | null; novncPort: number }

type GlobalTransientState = Exclude<ViewState, ResultsViewState>
export type DocumentErrorOverlay = Partial<
  Record<DocumentKey, Extract<DocumentView, { kind: 'retryable' }>>
>
/** Everything that describes the current attempt rather than a stored fact. */
export type TransientState =
  | GlobalTransientState
  | { kind: 'documentErrors'; errors: DocumentErrorOverlay }

export const PASSPORT_LAST_RESULT_KEY = 'lastResult'

// The schema is a persistence contract, same as the key. The union keeps the
// legacy ID-only value readable while the v2 document fields stay optional;
// hydration normalizes in memory and never writes a migration value back.
export const storedDocumentResultSchema = z.object({
  status: z.number().int(),
  message: z.string(),
  checkedAt: z.number().int(),
})

export const legacyStoredResultSchema = storedDocumentResultSchema

export const storedCheckResultV2Schema = z.object({
  version: z.literal(2),
  idCard: storedDocumentResultSchema.optional(),
  internationalPassport: storedDocumentResultSchema.optional(),
})

export const lastResultSchema = z.union([legacyStoredResultSchema, storedCheckResultV2Schema])

export type LegacyStoredResult = z.output<typeof legacyStoredResultSchema>
export type StoredDocumentResult = z.output<typeof storedDocumentResultSchema>
export type StoredCheckResultV2 = z.output<typeof storedCheckResultV2Schema>
export type StoredCheckResult = z.output<typeof lastResultSchema>

export function normalizeStoredResult(stored: StoredCheckResult | null): StoredCheckResultV2 {
  if (stored === null) return { version: 2 }
  if ('version' in stored) return stored
  return { version: 2, idCard: stored }
}

export const RETRYABLE_MESSAGES: Record<string, string> = {
  browser_unavailable: 'Сервис автоматизации недоступен',
  automation_timeout: 'Проверка не уложилась в отведённое время',
  user_input_probe: 'Не удалось проверить состояние браузера',
  upstream_response: 'Сервис проверки временно недоступен',
  invalid_checker_response: 'Сервис проверки вернул неожиданный ответ',
  automation_protocol: 'Внутренняя ошибка автоматизации',
}

export const GENERIC_RETRYABLE_MESSAGE = 'Не удалось выполнить проверку'

function storedSuccess(
  result: Extract<PassportCheckResult[DocumentKey], { kind: 'success' }>,
  checkedAt: number,
): StoredDocumentResult {
  return { status: result.status, message: result.send_status_msg, checkedAt }
}

function documentError(
  result: PassportDocumentError,
): Extract<DocumentView, { kind: 'retryable' }> {
  return { kind: 'retryable', message: RETRYABLE_MESSAGES[result.code] }
}

export function mergeCheckResult({
  stored,
  result,
  checkedAt,
}: {
  stored: StoredCheckResult | null
  result: PassportCheckResult
  checkedAt: number
}): { stored: StoredCheckResultV2 | null; errors: DocumentErrorOverlay } {
  const current = normalizeStoredResult(stored)
  const idCard =
    result.idCard.kind === 'success' ? storedSuccess(result.idCard, checkedAt) : current.idCard
  const internationalPassport =
    result.internationalPassport.kind === 'success'
      ? storedSuccess(result.internationalPassport, checkedAt)
      : current.internationalPassport
  const errors: DocumentErrorOverlay = {
    ...(result.idCard.kind === 'error' ? { idCard: documentError(result.idCard) } : {}),
    ...(result.internationalPassport.kind === 'error'
      ? { internationalPassport: documentError(result.internationalPassport) }
      : {}),
  }
  const hasSuccess =
    result.idCard.kind === 'success' || result.internationalPassport.kind === 'success'
  if (!hasSuccess) return { stored: null, errors }

  return {
    stored: {
      version: 2,
      ...(idCard ? { idCard } : {}),
      ...(internationalPassport ? { internationalPassport } : {}),
    },
    errors,
  }
}

function mergeDeferredResult({
  stored,
  deferred,
}: {
  stored: StoredCheckResult | null
  deferred: StoredCheckResultV2
}): StoredCheckResultV2 {
  const current = normalizeStoredResult(stored)
  const idCard = deferred.idCard ?? current.idCard
  const internationalPassport = deferred.internationalPassport ?? current.internationalPassport
  return {
    version: 2,
    ...(idCard ? { idCard } : {}),
    ...(internationalPassport ? { internationalPassport } : {}),
  }
}

// Mirrors server.ts's DEFAULT_NOVNC_PORT (matches docker-compose.yml's
// NOVNC_HOST_PORT default). Only used if the server response is missing or
// malformed — the server always sends a concrete value for this stack.
const DEFAULT_NOVNC_PORT = 6080

export function mapCheckError(error: WidgetApiError | CheckDeadlineError): GlobalTransientState {
  if (error instanceof CheckDeadlineError) {
    return { kind: 'retryable', message: RETRYABLE_MESSAGES.automation_timeout }
  }
  if (error.code === 'browser_session_required') {
    const sshTarget = error.meta?.sshTarget
    const novncPort = error.meta?.novncPort
    return {
      kind: 'sessionRequired',
      sshTarget: typeof sshTarget === 'string' ? sshTarget : null,
      novncPort: typeof novncPort === 'number' ? novncPort : DEFAULT_NOVNC_PORT,
    }
  }
  if (error.code === 'browser_configuration') return { kind: 'invalidConfig' }
  return { kind: 'retryable', message: RETRYABLE_MESSAGES[error.code] ?? GENERIC_RETRYABLE_MESSAGE }
}

const pad = (value: number) => String(value).padStart(2, '0')

/**
 * A stored result outlives the day it was taken, so a bare HH:MM would read as
 * "today" forever. Same-day results keep the short form; older ones carry the
 * date. Recomputed only when the view state recomputes — a tab left open across
 * midnight keeps yesterday's short label until something else changes.
 */
export function formatCheckedAt(checkedAt: number, now: Date): string {
  const date = new Date(checkedAt)
  const time = `${pad(date.getHours())}:${pad(date.getMinutes())}`
  const sameDay =
    date.getFullYear() === now.getFullYear() &&
    date.getMonth() === now.getMonth() &&
    date.getDate() === now.getDate()
  return sameDay ? time : `${pad(date.getDate())}.${pad(date.getMonth() + 1)} ${time}`
}

function storedView(stored: StoredDocumentResult | undefined, now: Date): DocumentView {
  if (!stored) return { kind: 'unchecked' }
  return {
    kind: 'success',
    status: stored.status,
    message: stored.message,
    checkedAtLabel: formatCheckedAt(stored.checkedAt, now),
  }
}

/**
 * Races `promise` against a timer, but never abandons `promise` itself — the
 * server has no cancellation for an in-flight check, so a timeout here only
 * changes what the UI shows, not whether the pipeline keeps running. If
 * `promise` still settles successfully after the timer already won the race,
 * `onLateSuccess` gets the value so a real result is never silently dropped.
 */
function withDeadline<T>(
  promise: Promise<T>,
  timeoutMs: number,
  onLateSuccess: (value: T) => void,
): Promise<T | CheckDeadlineError | WidgetApiError> {
  return new Promise((resolve) => {
    let deadlineWon = false
    const timer = setTimeout(() => {
      deadlineWon = true
      resolve(new CheckDeadlineError({ timeoutMs }))
    }, timeoutMs)
    promise.then(
      (value) => {
        clearTimeout(timer)
        if (deadlineWon) {
          onLateSuccess(value)
          return
        }
        resolve(value)
      },
      (cause: unknown) => {
        clearTimeout(timer)
        if (deadlineWon) return // nothing to salvage from a late rejection
        // invoke returns errors as values; a rejection here is an unexpected bug.
        resolve(
          new WidgetApiError({ reason: 'invoke rejected unexpectedly', code: 'network', cause }),
        )
      },
    )
  })
}

export type MakePassportCheckModelOptions = {
  api: WidgetApi<PassportCheckerEvents, WidgetApiError>
  /** The shared-scope server storage; the model never sees the scope itself. */
  storage: StorageApi
  deadlineMs?: number
  now?: () => Date
}

export type PassportCheckModel = ReturnType<typeof makePassportCheckModel>

type ObservedCheckResult = {
  result: PassportCheckResult
  checkedAt: number
}

export function makePassportCheckModel({
  api,
  storage,
  deadlineMs = CHECK_DEADLINE_MS,
  now = () => new Date(),
}: MakePassportCheckModelOptions) {
  // Persisted across reloads, placements and devices: the passport status is a
  // fact about the world, not a property of one tile. withStorageKey owns both
  // directions — it subscribes on connect and writes back on local change.
  const lastResult = atom<StoredCheckResult | null>(null, 'passportCheck.lastResult').extend(
    withStorageKey({ api: storage, key: PASSPORT_LAST_RESULT_KEY, schema: lastResultSchema }),
  )
  const storageSnapshotKnown = atom(false, 'passportCheck.storageSnapshotKnown').extend(
    withComputed((known) => known || (!lastResult.isLoading() && lastResult.error() === null)),
  )
  const optimisticResult = atom<StoredCheckResultV2 | null>(null, 'passportCheck.optimisticResult')
  // Before the first storage snapshot, partial attempts cannot safely write:
  // the unknown sibling may exist remotely. Keep every accepted success here
  // until hydration so completed retries accumulate instead of replacing one
  // another. The transient atom still owns only the latest error overlay.
  const deferredResult = atom<StoredCheckResultV2 | null>(null, 'passportCheck.deferredResult')
  const transient = atom<TransientState>({ kind: 'idle' }, 'passportCheck.transient')
  const recoveryOpen = atom(false, 'passportCheck.recoveryOpen')

  // Identifies the in-flight attempt so a straggler from an abandoned run can
  // be told apart from "no newer run exists yet" (see `succeedLate` below).
  // A plain counter, not a wrap()ed closure, so it is safe to close over
  // across awaits without the module-scope-wrap trap.
  let latestAttemptId = 0

  const applyResult = action((observed: ObservedCheckResult) => {
    const deferred = deferredResult()
    const snapshotKnown = storageSnapshotKnown()
    const stored = snapshotKnown ? lastResult() : (deferred ?? lastResult())
    const merged = mergeCheckResult({ stored, ...observed })
    const hasCompleteCoverage = Boolean(
      merged.stored?.idCard && merged.stored.internationalPassport,
    )
    const shouldDefer =
      !snapshotKnown &&
      !hasCompleteCoverage &&
      (deferred !== null || (merged.stored !== null && Object.keys(merged.errors).length > 0))

    if (shouldDefer) {
      if (merged.stored !== null) {
        deferredResult.set(merged.stored)
        optimisticResult.set(merged.stored)
      }
      transient.set({ kind: 'documentErrors', errors: merged.errors })
      return
    }

    // Once both documents have a fresh successful value, an unread snapshot
    // cannot contribute a missing sibling. Persist immediately, but retain the
    // complete deferred value as a hydration guard: if a delayed initial
    // snapshot arrives later, flushDeferredResult merges these newer values
    // back over it instead of letting the old snapshot win.
    if (!snapshotKnown && merged.stored !== null) {
      deferredResult.set(merged.stored)
      optimisticResult.set(merged.stored)
      lastResult.set(merged.stored)
      transient.set(
        Object.keys(merged.errors).length === 0
          ? { kind: 'idle' }
          : { kind: 'documentErrors', errors: merged.errors },
      )
      return
    }

    deferredResult.set(null)
    optimisticResult.set(null)
    if (merged.stored) lastResult.set(merged.stored)
    transient.set(
      Object.keys(merged.errors).length === 0
        ? { kind: 'idle' }
        : { kind: 'documentErrors', errors: merged.errors },
    )
  }, 'passportCheck.applyResult')

  const flushDeferredResult = action(() => {
    if (!storageSnapshotKnown()) return
    const deferred = deferredResult()
    if (deferred === null) return
    deferredResult.set(null)
    optimisticResult.set(null)
    lastResult.set(mergeDeferredResult({ stored: lastResult(), deferred }))
  }, 'passportCheck.flushDeferredResult')

  const viewState = computed((): ViewState => {
    // Read `lastResult` unconditionally, ahead of the transient branch. Behind
    // an `if` the dependency would disappear whenever a check is pending or an
    // error is showing, disconnecting the atom and tearing down its storage
    // subscription — every check would then re-subscribe (and, on the HTTP
    // backend, re-GET) on the way back to idle.
    const stored = normalizeStoredResult(lastResult())
    const optimistic = optimisticResult()
    const visible = {
      version: 2 as const,
      idCard: optimistic?.idCard ?? stored.idCard,
      internationalPassport: optimistic?.internationalPassport ?? stored.internationalPassport,
    }
    const current = transient()
    if (current.kind !== 'idle' && current.kind !== 'documentErrors') return current
    if (current.kind === 'idle' && !visible.idCard && !visible.internationalPassport) {
      return { kind: 'idle' }
    }

    const errors = current.kind === 'documentErrors' ? current.errors : {}
    const currentTime = now()
    return {
      kind: 'results',
      idCard: errors.idCard ?? storedView(visible.idCard, currentTime),
      internationalPassport:
        errors.internationalPassport ?? storedView(visible.internationalPassport, currentTime),
    }
  }, 'passportCheck.viewState').extend(
    withConnectHook(() => {
      effect(() => {
        if (!storageSnapshotKnown()) return
        if (deferredResult() === null) return
        flushDeferredResult()
      }, 'passportCheck.flushDeferredResultOnHydration')
    }),
  )

  const checkPassport = action(async () => {
    if (transient().kind === 'pending') return
    transient.set({ kind: 'pending' })
    // Stamp this attempt before any await; `succeedLate` below closes over
    // `attemptId` and only acts while it is still the latest one issued.
    // Guarding on `transient().kind === 'pending'` instead would be wrong: a
    // second, faster attempt can finish and flip transient back to `idle`
    // while this attempt's invoke is still out there, and a straggler that
    // lands afterwards would then sail through an `idle` check and overwrite
    // the newer, already-observed result with a stale one.
    latestAttemptId += 1
    const attemptId = latestAttemptId
    // Continuations after `await` run outside the calling frame; capture the
    // frame-bound writers now (repo wrap rules — never hoist them to module scope).
    const fail = wrap((next: TransientState) => transient.set(next))
    const succeed = wrap((observed: ObservedCheckResult) => applyResult(observed))
    // Mirrors `succeed`, but for a result that arrives after the deadline
    // already put the user into `retryable`. Guarded by attempt identity, not
    // by transient state, so a late answer from this superseded attempt can
    // never clobber a result a newer attempt already wrote — whether that
    // newer attempt is still pending or has already completed.
    const succeedLate = wrap((observed: ObservedCheckResult) => {
      if (attemptId !== latestAttemptId) return
      applyResult(observed)
    })

    const result = await withDeadline(api.invoke('check', {}), deadlineMs, (value) => {
      if (value instanceof Error) return
      // checkedAt is captured here, at the moment the invoke actually
      // settles (the observation), not later when `succeedLate` decides
      // whether to salvage it — so a superseded-but-accepted result never
      // gets stamped with a "just now" time it doesn't deserve.
      const checkedAt = now().getTime()
      succeedLate({ result: value, checkedAt })
    })
    if (result instanceof Error) {
      fail(mapCheckError(result))
      return
    }
    succeed({ result, checkedAt: now().getTime() })
  }, 'passportCheck.check')

  return { viewState, transient, lastResult, recoveryOpen, checkPassport }
}
