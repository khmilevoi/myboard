import { action, atom, computed, wrap } from '@reatom/core'
import type { WidgetApi } from '@shared/widgets/contracts'
import * as errore from 'errore'
import { WidgetApiError, withStorageKey } from 'widget-runtime'
import type { StorageApi } from 'widget-runtime'
import { z } from 'zod'

import type { PassportCheckerEvents } from '../types'

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

export type ViewState =
  | { kind: 'idle' }
  | { kind: 'pending' }
  | { kind: 'success'; status: number; message: string; checkedAtLabel: string }
  | { kind: 'retryable'; message: string }
  | { kind: 'invalidConfig' }
  | { kind: 'sessionRequired'; sshTarget: string | null; novncPort: number }

/** Everything that describes the current attempt rather than a stored fact. */
export type TransientState = Exclude<ViewState, { kind: 'success' }>

export const PASSPORT_LAST_RESULT_KEY = 'lastResult'

// The schema is a persistence contract, same as the key: existing stored
// values are never migrated when it changes. Any new field must be
// `.optional()` or carry a `.default()` — a required field added later fails
// `safeParse` for every value already sitting in Valkey, `withStorageKey`
// then discards it on read, and every client falls back to `idle` with no
// way back short of a manual data fix.
export const lastResultSchema = z.object({
  status: z.number().int(),
  message: z.string(),
  checkedAt: z.number().int(),
})
export type StoredCheckResult = z.output<typeof lastResultSchema>

export const RETRYABLE_MESSAGES: Record<string, string> = {
  browser_unavailable: 'Сервис автоматизации недоступен',
  automation_timeout: 'Проверка не уложилась в отведённое время',
  user_input_probe: 'Не удалось проверить состояние браузера',
  upstream_response: 'Сервис проверки временно недоступен',
  invalid_checker_response: 'Сервис проверки вернул неожиданный ответ',
  automation_protocol: 'Внутренняя ошибка автоматизации',
}

export const GENERIC_RETRYABLE_MESSAGE = 'Не удалось выполнить проверку'

// Mirrors server.ts's DEFAULT_NOVNC_PORT (matches docker-compose.yml's
// NOVNC_HOST_PORT default). Only used if the server response is missing or
// malformed — the server always sends a concrete value for this stack.
const DEFAULT_NOVNC_PORT = 6080

export function mapCheckError(error: WidgetApiError | CheckDeadlineError): TransientState {
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
  const transient = atom<TransientState>({ kind: 'idle' }, 'passportCheck.transient')
  const recoveryOpen = atom(false, 'passportCheck.recoveryOpen')

  // Identifies the in-flight attempt so a straggler from an abandoned run can
  // be told apart from "no newer run exists yet" (see `succeedLate` below).
  // A plain counter, not a wrap()ed closure, so it is safe to close over
  // across awaits without the module-scope-wrap trap.
  let latestAttemptId = 0

  const viewState = computed((): ViewState => {
    // Read `lastResult` unconditionally, ahead of the transient branch. Behind
    // an `if` the dependency would disappear whenever a check is pending or an
    // error is showing, disconnecting the atom and tearing down its storage
    // subscription — every check would then re-subscribe (and, on the HTTP
    // backend, re-GET) on the way back to idle.
    const stored = lastResult()
    const current = transient()
    if (current.kind !== 'idle') return current
    if (!stored) return { kind: 'idle' }
    return {
      kind: 'success',
      status: stored.status,
      message: stored.message,
      checkedAtLabel: formatCheckedAt(stored.checkedAt, now()),
    }
  }, 'passportCheck.viewState')

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
    const succeed = wrap((next: StoredCheckResult) => {
      // Both sets land in one frame — Reatom notifies subscribers only after
      // the synchronous block finishes — so no subscriber ever observes a gap
      // between them. Order kept anyway: write-then-reveal reads better.
      lastResult.set(next)
      transient.set({ kind: 'idle' })
    })
    // Mirrors `succeed`, but for a result that arrives after the deadline
    // already put the user into `retryable`. Guarded by attempt identity, not
    // by transient state, so a late answer from this superseded attempt can
    // never clobber a result a newer attempt already wrote — whether that
    // newer attempt is still pending or has already completed.
    const succeedLate = wrap((next: StoredCheckResult) => {
      if (attemptId !== latestAttemptId) return
      lastResult.set(next)
      transient.set({ kind: 'idle' })
    })

    const result = await withDeadline(api.invoke('check', {}), deadlineMs, (value) => {
      if (value instanceof Error) return
      // checkedAt is captured here, at the moment the invoke actually
      // settles (the observation), not later when `succeedLate` decides
      // whether to salvage it — so a superseded-but-accepted result never
      // gets stamped with a "just now" time it doesn't deserve.
      succeedLate({
        status: value.status,
        message: value.send_status_msg,
        checkedAt: now().getTime(),
      })
    })
    if (result instanceof Error) {
      fail(mapCheckError(result))
      return
    }
    succeed({
      status: result.status,
      message: result.send_status_msg,
      checkedAt: now().getTime(),
    })
  }, 'passportCheck.check')

  return { viewState, transient, lastResult, recoveryOpen, checkPassport }
}
