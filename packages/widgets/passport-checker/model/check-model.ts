import { action, atom, computed, effect, withComputed, withConnectHook, wrap } from '@reatom/core'
import type { WidgetApi } from '@shared/widgets/contracts'
import * as errore from 'errore'
import { WidgetApiError, withStorageKey, withStorageKeyReadonly } from 'widget-runtime'
import type { StorageApi } from 'widget-runtime'
import { z } from 'zod'

import {
  passportCheckResultSchema,
  passportServiceResponseSchema,
  type PassportCheckerEvents,
  type PassportCheckResult,
  type PassportDocumentError,
  type PassportServiceResponse,
} from '../types'

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

/** Which tier renders the live recovery session: a portal modal (tiny/standard) or embedded inline (fullscreen). */
export type RecoverySurface = 'modal' | 'inline'

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

export const PASSPORT_LEGACY_LAST_RESULT_KEY = 'lastResult'
export const PASSPORT_ID_CARD_LAST_RESULT_V2_KEY = 'lastResultV2:idCard'
export const PASSPORT_INTERNATIONAL_PASSPORT_LAST_RESULT_V2_KEY =
  'lastResultV2:internationalPassport'

// Each schema belongs to its own persistence key. The legacy ID-only value is
// read as a fallback, while each V2 document success is persisted independently.
export const storedDocumentResultSchema = z.object({
  status: z.number().int(),
  message: z.string(),
  checkedAt: z.number().int(),
})

export const legacyStoredResultSchema = storedDocumentResultSchema

export type LegacyStoredResult = z.output<typeof legacyStoredResultSchema>
export type StoredDocumentResult = z.output<typeof storedDocumentResultSchema>

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

export function mapCheckResult({
  result,
  checkedAt,
}: {
  result: PassportCheckResult
  checkedAt: number
}): {
  successes: Partial<Record<DocumentKey, StoredDocumentResult>>
  errors: DocumentErrorOverlay
} {
  const successes = {
    ...(result.idCard.kind === 'success'
      ? { idCard: storedSuccess(result.idCard, checkedAt) }
      : {}),
    ...(result.internationalPassport.kind === 'success'
      ? { internationalPassport: storedSuccess(result.internationalPassport, checkedAt) }
      : {}),
  }
  const errors: DocumentErrorOverlay = {
    ...(result.idCard.kind === 'error' ? { idCard: documentError(result.idCard) } : {}),
    ...(result.internationalPassport.kind === 'error'
      ? { internationalPassport: documentError(result.internationalPassport) }
      : {}),
  }

  return { successes, errors }
}

function mapLegacyCheckResult({
  result,
  checkedAt,
}: {
  result: PassportServiceResponse
  checkedAt: number
}): {
  successes: Partial<Record<DocumentKey, StoredDocumentResult>>
  errors: DocumentErrorOverlay
} {
  return {
    successes: {
      idCard: {
        status: result.status,
        message: result.send_status_msg,
        checkedAt,
      },
    },
    errors: {},
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

const documentCheckedAt = new WeakMap<Extract<DocumentView, { kind: 'success' }>, number>()

/**
 * DocumentView deliberately exposes only display data. Tiny needs the original
 * timestamp to choose the latest result without changing that public shape.
 */
export function getDocumentCheckedAt(view: DocumentView): number | undefined {
  return view.kind === 'success' ? documentCheckedAt.get(view) : undefined
}

function storedView(stored: StoredDocumentResult | undefined, now: Date): DocumentView {
  if (!stored) return { kind: 'unchecked' }
  const view: Extract<DocumentView, { kind: 'success' }> = {
    kind: 'success',
    status: stored.status,
    message: stored.message,
    checkedAtLabel: formatCheckedAt(stored.checkedAt, now),
  }
  documentCheckedAt.set(view, stored.checkedAt)
  return view
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

type CompatibleCheckResult =
  | { kind: 'v2'; value: PassportCheckResult }
  | { kind: 'legacy'; value: PassportServiceResponse }

type ObservedCheckResult = {
  result: CompatibleCheckResult
  checkedAt: number
}

const UNSUPPORTED_V2_CODES = new Set(['unknown_event', 'unknown_task'])

function invalidRpcResult(event: 'check' | 'checkV2', cause: unknown) {
  return new WidgetApiError({
    reason: `${event} response is invalid`,
    code: 'invalid_response',
    cause,
  })
}

async function invokeCompatibleCheck(api: WidgetApi<PassportCheckerEvents, WidgetApiError>) {
  const v2Result = await api.invoke('checkV2', {})
  if (v2Result instanceof WidgetApiError) {
    if (!UNSUPPORTED_V2_CODES.has(v2Result.code)) return v2Result

    const legacyResult = await api.invoke('check', {})
    if (legacyResult instanceof WidgetApiError) return legacyResult
    const parsedLegacy = passportServiceResponseSchema.safeParse(legacyResult)
    if (!parsedLegacy.success) return invalidRpcResult('check', parsedLegacy.error)
    return { kind: 'legacy', value: parsedLegacy.data } as const
  }

  const parsedV2 = passportCheckResultSchema.safeParse(v2Result)
  if (!parsedV2.success) return invalidRpcResult('checkV2', parsedV2.error)
  return { kind: 'v2', value: parsedV2.data } as const
}

export function makePassportCheckModel({
  api,
  storage,
  deadlineMs = CHECK_DEADLINE_MS,
  now = () => new Date(),
}: MakePassportCheckModelOptions) {
  // Each V2 document owns a separate key. Complementary successes from stale
  // clients therefore cannot replace one another, while a still-open legacy
  // PWA remains confined to the read-only fallback key below.
  const idCardLastResult = atom<StoredDocumentResult | null>(
    null,
    'passportCheck.idCardLastResultV2',
  ).extend(
    withStorageKey({
      api: storage,
      key: PASSPORT_ID_CARD_LAST_RESULT_V2_KEY,
      schema: storedDocumentResultSchema,
    }),
  )
  const internationalPassportLastResult = atom<StoredDocumentResult | null>(
    null,
    'passportCheck.internationalPassportLastResultV2',
  ).extend(
    withStorageKey({
      api: storage,
      key: PASSPORT_INTERNATIONAL_PASSPORT_LAST_RESULT_V2_KEY,
      schema: storedDocumentResultSchema,
    }),
  )
  const legacyLastResult = atom<LegacyStoredResult | null>(
    null,
    'passportCheck.legacyLastResult',
  ).extend(
    withStorageKeyReadonly({
      api: storage,
      key: PASSPORT_LEGACY_LAST_RESULT_KEY,
      schema: legacyStoredResultSchema,
      fallback: null,
    }),
  )
  const idCardV2StorageSnapshotKnown = atom(
    false,
    'passportCheck.idCardV2StorageSnapshotKnown',
  ).extend(
    withComputed(
      (known) => known || (!idCardLastResult.isLoading() && idCardLastResult.error() === null),
    ),
  )
  const internationalPassportV2StorageSnapshotKnown = atom(
    false,
    'passportCheck.internationalPassportV2StorageSnapshotKnown',
  ).extend(
    withComputed(
      (known) =>
        known ||
        (!internationalPassportLastResult.isLoading() &&
          internationalPassportLastResult.error() === null),
    ),
  )
  const legacyStorageSnapshotKnown = atom(false, 'passportCheck.legacyStorageSnapshotKnown').extend(
    withComputed(
      (known) => known || (!legacyLastResult.isLoading() && legacyLastResult.error() === null),
    ),
  )
  const optimisticIdCardResult = atom<StoredDocumentResult | null>(
    null,
    'passportCheck.optimisticIdCardResult',
  )
  const optimisticInternationalPassportResult = atom<StoredDocumentResult | null>(
    null,
    'passportCheck.optimisticInternationalPassportResult',
  )
  const transient = atom<TransientState>({ kind: 'idle' }, 'passportCheck.transient')
  const recoveryOpen = atom(false, 'passportCheck.recoveryOpen')
  // Which mount is allowed to render the live noVNC session: the tile and the
  // fullscreen mount can be alive at the same time (the fullscreen overlay
  // sits on top of the board, it does not unmount the tile underneath), and
  // both watch the same `recoveryOpen` flag. Without an owner, opening
  // recovery from one would make BOTH try to mount a canvas against the same
  // shared `recoveryModel` session.
  const recoverySurface = atom<RecoverySurface | null>(null, 'passportCheck.recoverySurface')

  // Identifies the in-flight attempt so a straggler from an abandoned run can
  // be told apart from "no newer run exists yet" (see `succeedLate` below).
  // A plain counter, not a wrap()ed closure, so it is safe to close over
  // across awaits without the module-scope-wrap trap.
  let latestAttemptId = 0

  const applyResult = action((observed: ObservedCheckResult) => {
    const mapped =
      observed.result.kind === 'v2'
        ? mapCheckResult({
            result: observed.result.value,
            checkedAt: observed.checkedAt,
          })
        : mapLegacyCheckResult({
            result: observed.result.value,
            checkedAt: observed.checkedAt,
          })

    const idCard = mapped.successes.idCard
    if (idCard) {
      if (!idCardV2StorageSnapshotKnown()) optimisticIdCardResult.set(idCard)
      idCardLastResult.set(idCard)
    }

    const internationalPassport = mapped.successes.internationalPassport
    if (internationalPassport) {
      if (!internationalPassportV2StorageSnapshotKnown()) {
        optimisticInternationalPassportResult.set(internationalPassport)
      }
      internationalPassportLastResult.set(internationalPassport)
    }

    transient.set(
      Object.keys(mapped.errors).length === 0
        ? { kind: 'idle' }
        : { kind: 'documentErrors', errors: mapped.errors },
    )
  }, 'passportCheck.applyResult')

  const flushOptimisticResults = action(() => {
    const idCard = optimisticIdCardResult()
    if (idCardV2StorageSnapshotKnown() && idCard !== null) {
      idCardLastResult.set(idCard)
      optimisticIdCardResult.set(null)
    }

    const internationalPassport = optimisticInternationalPassportResult()
    if (internationalPassportV2StorageSnapshotKnown() && internationalPassport !== null) {
      internationalPassportLastResult.set(internationalPassport)
      optimisticInternationalPassportResult.set(null)
    }
  }, 'passportCheck.flushOptimisticResults')

  const viewState = computed((): ViewState => {
    // Read every persisted branch unconditionally, ahead of the transient
    // branch. Otherwise a pending/global-error view would disconnect storage
    // and force fresh GETs on the way back to results.
    const idCardV2Stored = idCardLastResult()
    const internationalPassportV2Stored = internationalPassportLastResult()
    const legacyStored = legacyLastResult()
    const idCardV2Known = idCardV2StorageSnapshotKnown()
    const legacyKnown = legacyStorageSnapshotKnown()
    const visibleIdCard =
      optimisticIdCardResult() ??
      idCardV2Stored ??
      (idCardV2Known && legacyKnown ? legacyStored : null)
    const visibleInternationalPassport =
      optimisticInternationalPassportResult() ?? internationalPassportV2Stored
    const current = transient()
    if (current.kind !== 'idle' && current.kind !== 'documentErrors') return current
    if (current.kind === 'idle' && !visibleIdCard && !visibleInternationalPassport) {
      return { kind: 'idle' }
    }

    const errors = current.kind === 'documentErrors' ? current.errors : {}
    const currentTime = now()
    return {
      kind: 'results',
      idCard: errors.idCard ?? storedView(visibleIdCard ?? undefined, currentTime),
      internationalPassport:
        errors.internationalPassport ??
        storedView(visibleInternationalPassport ?? undefined, currentTime),
    }
  }, 'passportCheck.viewState').extend(
    withConnectHook(() => {
      effect(() => {
        const shouldFlushIdCard =
          idCardV2StorageSnapshotKnown() && optimisticIdCardResult() !== null
        const shouldFlushInternationalPassport =
          internationalPassportV2StorageSnapshotKnown() &&
          optimisticInternationalPassportResult() !== null
        if (!shouldFlushIdCard && !shouldFlushInternationalPassport) return
        flushOptimisticResults()
      }, 'passportCheck.flushOptimisticResultsOnHydration')
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

    const result = await withDeadline(invokeCompatibleCheck(api), deadlineMs, (value) => {
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

  return {
    viewState,
    transient,
    idCardLastResult,
    internationalPassportLastResult,
    legacyLastResult,
    recoveryOpen,
    recoverySurface,
    checkPassport,
  }
}
