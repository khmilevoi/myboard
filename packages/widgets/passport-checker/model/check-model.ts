import { action, atom, computed, wrap } from '@reatom/core'
import type { WidgetApi } from '@shared/widgets/contracts'
import * as errore from 'errore'
import { WidgetApiError, withStorageKey } from 'widget-runtime'
import type { StorageApi } from 'widget-runtime'
import { z } from 'zod'

import type { PassportCheckerEvents } from '../types'

export const CHECK_DEADLINE_MS = 25_000

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
  | { kind: 'sessionRequired'; sshTarget: string | null }

/** Everything that describes the current attempt rather than a stored fact. */
export type TransientState = Exclude<ViewState, { kind: 'success' }>

export const PASSPORT_LAST_RESULT_KEY = 'lastResult'

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

export function mapCheckError(error: WidgetApiError | CheckDeadlineError): TransientState {
  if (error instanceof CheckDeadlineError) {
    return { kind: 'retryable', message: RETRYABLE_MESSAGES.automation_timeout }
  }
  if (error.code === 'browser_session_required') {
    const sshTarget = error.meta?.sshTarget
    return {
      kind: 'sessionRequired',
      sshTarget: typeof sshTarget === 'string' ? sshTarget : null,
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

function withDeadline<T>(
  promise: Promise<T>,
  timeoutMs: number,
): Promise<T | CheckDeadlineError | WidgetApiError> {
  return new Promise((resolve) => {
    const timer = setTimeout(() => resolve(new CheckDeadlineError({ timeoutMs })), timeoutMs)
    promise.then(
      (value) => {
        clearTimeout(timer)
        resolve(value)
      },
      (cause: unknown) => {
        clearTimeout(timer)
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
    // Continuations after `await` run outside the calling frame; capture the
    // frame-bound writers now (repo wrap rules — never hoist them to module scope).
    const fail = wrap((next: TransientState) => transient.set(next))
    const succeed = wrap((next: StoredCheckResult) => {
      // Order matters only for readability: the write is what persists, and
      // clearing `transient` is what lets the computed show it.
      lastResult.set(next)
      transient.set({ kind: 'idle' })
    })

    const result = await withDeadline(api.invoke('check', {}), deadlineMs)
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
