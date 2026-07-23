import { BrowserTaskError } from '@shared/browser-automation/task-errors'
import * as errore from 'errore'

export { BrowserTaskError } from '@shared/browser-automation/task-errors'

export class UnknownBrowserTaskError extends errore.createTaggedError({
  name: 'UnknownBrowserTaskError',
  message: 'Unknown browser task $widgetId/$taskId',
  extends: BrowserTaskError,
}) {
  code = 'unknown_task'
  publicMessage = 'Unknown browser task'
}

export class InvalidBrowserPayloadError extends errore.createTaggedError({
  name: 'InvalidBrowserPayloadError',
  message: 'Invalid payload for $widgetId/$taskId',
  extends: BrowserTaskError,
}) {
  code = 'payload_invalid'
  publicMessage = 'Browser task payload is invalid'
}

export class InvalidBrowserResultError extends errore.createTaggedError({
  name: 'InvalidBrowserResultError',
  message: 'Invalid result from $widgetId/$taskId',
  extends: BrowserTaskError,
}) {
  code = 'result_invalid'
  publicMessage = 'Browser task result is invalid'
}

export class AutomationTimeoutError extends errore.createTaggedError({
  name: 'AutomationTimeoutError',
  message: 'Browser task timed out during $phase',
  extends: BrowserTaskError,
}) {
  code = 'automation_timeout'
  publicMessage = 'The browser task timed out'
  get publicMeta(): Record<string, unknown> {
    return { phase: this.phase }
  }
}

export class BrowserTaskHandlerError extends errore.createTaggedError({
  name: 'BrowserTaskHandlerError',
  message: 'Handler failed for $widgetId/$taskId',
  extends: BrowserTaskError,
}) {}

export class BrowserExecutorError extends errore.createTaggedError({
  name: 'BrowserExecutorError',
  message: 'Executor failed for $widgetId/$taskId',
  extends: BrowserTaskError,
}) {}

export class BrowserServiceUnavailableError extends errore.createTaggedError({
  name: 'BrowserServiceUnavailableError',
  message: 'Browser service is not accepting work ($state)',
}) {}

export type EnvelopeError = {
  code: string
  message: string
  meta?: Record<string, unknown>
}

export function toEnvelopeError(error: Error): EnvelopeError {
  if (error instanceof BrowserTaskError) {
    const meta = error.publicMeta
    return meta
      ? { code: error.code, message: error.publicMessage, meta }
      : { code: error.code, message: error.publicMessage }
  }
  return { code: 'internal', message: 'Browser task failed' }
}
