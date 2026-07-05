import * as errore from 'errore'

export class BrowserAutomationUnavailableError extends errore.createTaggedError({
  name: 'BrowserAutomationUnavailableError',
  message: 'Browser automation is unavailable during $operation',
}) {}

export class BrowserAutomationDeadlineError extends errore.createTaggedError({
  name: 'BrowserAutomationDeadlineError',
  message: 'Browser automation request exceeded $timeoutMs ms',
  extends: errore.AbortError,
}) {}

export class BrowserAutomationProtocolError extends errore.createTaggedError({
  name: 'BrowserAutomationProtocolError',
  message: 'Invalid browser automation response during $phase for $widgetId/$taskId',
}) {}

type BrowserTaskRejectedErrorOptions = {
  widgetId: string
  taskId: string
  code: string
  publicMessage: string
  meta?: Record<string, unknown>
}

export class BrowserTaskRejectedError extends errore.createTaggedError({
  name: 'BrowserTaskRejectedError',
  message: 'Browser task $widgetId/$taskId was rejected with $code',
}) {
  readonly publicMessage: string
  readonly meta: Record<string, unknown> | undefined

  constructor({ publicMessage, meta, ...options }: BrowserTaskRejectedErrorOptions) {
    super(options)
    this.publicMessage = publicMessage
    this.meta = meta
  }
}

export type BrowserGatewayError =
  | BrowserAutomationUnavailableError
  | BrowserAutomationDeadlineError
  | BrowserAutomationProtocolError
  | BrowserTaskRejectedError
