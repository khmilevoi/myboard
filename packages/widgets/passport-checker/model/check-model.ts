import { action, atom, wrap } from '@reatom/core'
import type { WidgetApi } from '@shared/widgets/contracts'
import * as errore from 'errore'
import { WidgetApiError } from 'widget-runtime'

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

export const RETRYABLE_MESSAGES: Record<string, string> = {
  browser_unavailable: 'Сервис автоматизации недоступен',
  automation_timeout: 'Проверка не уложилась в отведённое время',
  user_input_probe: 'Не удалось проверить состояние браузера',
  upstream_response: 'Сервис проверки временно недоступен',
  invalid_checker_response: 'Сервис проверки вернул неожиданный ответ',
  automation_protocol: 'Внутренняя ошибка автоматизации',
}

export const GENERIC_RETRYABLE_MESSAGE = 'Не удалось выполнить проверку'

export function mapCheckError(error: WidgetApiError | CheckDeadlineError): ViewState {
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
  deadlineMs?: number
  now?: () => Date
}

export type PassportCheckModel = ReturnType<typeof makePassportCheckModel>

export function makePassportCheckModel({
  api,
  deadlineMs = CHECK_DEADLINE_MS,
  now = () => new Date(),
}: MakePassportCheckModelOptions) {
  const viewState = atom<ViewState>({ kind: 'idle' }, 'passportCheck.viewState')
  const recoveryOpen = atom(false, 'passportCheck.recoveryOpen')

  const checkPassport = action(async () => {
    if (viewState().kind === 'pending') return
    viewState.set({ kind: 'pending' })
    // Continuations after `await` run outside the calling frame; capture the
    // frame-bound writer now (repo wrap rules — never hoist it to module scope).
    const settle = wrap((next: ViewState) => viewState.set(next))

    const result = await withDeadline(api.invoke('check', {}), deadlineMs)
    if (result instanceof Error) {
      settle(mapCheckError(result))
      return
    }
    settle({
      kind: 'success',
      status: result.status,
      message: result.send_status_msg,
      checkedAtLabel: formatCheckedAt(now().getTime(), now()),
    })
  }, 'passportCheck.check')

  return { viewState, recoveryOpen, checkPassport }
}
