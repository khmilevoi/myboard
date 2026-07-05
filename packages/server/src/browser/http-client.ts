import { TaskResponseSchema } from '@shared/browser-automation/protocol'
import {
  BrowserAutomationDeadlineError,
  BrowserAutomationProtocolError,
  BrowserAutomationUnavailableError,
  BrowserTaskRejectedError,
} from '@shared/widgets/browser-errors'
import * as errore from 'errore'

import type { BrowserAutomationClient } from './client'

export type CreateHttpBrowserAutomationClientOptions = {
  baseUrl: string
  timeoutMs: number
  fetchImpl?: typeof fetch
}

export function createHttpBrowserAutomationClient({
  baseUrl,
  timeoutMs,
  fetchImpl = fetch,
}: CreateHttpBrowserAutomationClientOptions): BrowserAutomationClient {
  const normalizedBaseUrl = baseUrl.replace(/\/+$/, '')

  return {
    async invoke({ widgetId, taskId, payload }) {
      const body = errore.try({
        try: () => JSON.stringify({ payload }),
        catch: (cause) =>
          new BrowserAutomationProtocolError({
            phase: 'request-json',
            widgetId,
            taskId,
            cause,
          }),
      })
      if (body instanceof Error) return body

      const deadline = new BrowserAutomationDeadlineError({ timeoutMs })
      const controller = new AbortController()
      const timeout = setTimeout(() => controller.abort(deadline), timeoutMs)
      timeout.unref?.()
      const clearDeadline = () => clearTimeout(timeout)

      const url = `${normalizedBaseUrl}/tasks/${encodeURIComponent(widgetId)}/${encodeURIComponent(taskId)}`
      const response: Response | BrowserAutomationUnavailableError = await fetchImpl(url, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body,
        signal: controller.signal,
      }).catch((cause) => new BrowserAutomationUnavailableError({ operation: 'fetch', cause }))
      if (errore.isAbortError(response)) {
        clearDeadline()
        return deadline
      }
      if (response instanceof BrowserAutomationUnavailableError) {
        clearDeadline()
        return response
      }
      if (response.status === 503) {
        clearDeadline()
        return new BrowserAutomationUnavailableError({ operation: 'service' })
      }
      if (response.status !== 200) {
        clearDeadline()
        return new BrowserAutomationProtocolError({
          phase: `http-${response.status}`,
          widgetId,
          taskId,
        })
      }

      const raw: unknown | BrowserAutomationProtocolError = await (
        response.json() as Promise<unknown>
      ).catch(
        (cause) =>
          new BrowserAutomationProtocolError({
            phase: 'response-json',
            widgetId,
            taskId,
            cause,
          }),
      )
      clearDeadline()
      if (errore.isAbortError(raw)) return deadline
      if (raw instanceof BrowserAutomationProtocolError) return raw

      const envelope = TaskResponseSchema.safeParse(raw)
      if (!envelope.success) {
        return new BrowserAutomationProtocolError({ phase: 'envelope', widgetId, taskId })
      }
      if (!envelope.data.ok) {
        return new BrowserTaskRejectedError({
          widgetId,
          taskId,
          code: envelope.data.error.code,
          publicMessage: envelope.data.error.message,
          meta: envelope.data.error.meta,
        })
      }
      return { result: envelope.data.result }
    },
  }
}
