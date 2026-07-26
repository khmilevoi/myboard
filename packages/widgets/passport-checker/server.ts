import {
  BrowserAutomationDeadlineError,
  BrowserAutomationProtocolError,
  BrowserAutomationUnavailableError,
  BrowserTaskRejectedError,
} from '@shared/widgets/browser-errors'
import { defineWidgetServer } from '@shared/widgets/contracts'
import { PublicWidgetError } from '@shared/widgets/public-error'

import { passportCheckerBrowserSchemas, passportCheckerBrowserTasks } from './types'

export function mapRejectedTask(error: BrowserTaskRejectedError): PublicWidgetError {
  if (error.code === 'browser_session_required') {
    const sshTarget = error.meta?.sshTarget
    return new PublicWidgetError({
      status: 409,
      code: 'browser_session_required',
      publicMessage: error.publicMessage,
      meta: typeof sshTarget === 'string' ? { sshTarget } : undefined,
      cause: error,
    })
  }
  if (error.code === 'browser_configuration') {
    return new PublicWidgetError({
      status: 500,
      code: 'browser_configuration',
      publicMessage: error.publicMessage,
      cause: error,
    })
  }
  return new PublicWidgetError({
    status: 502,
    // errore's tagged-error factory types every $variable in the message
    // template (including $code) as `string | number`, even though
    // BrowserTaskRejectedErrorOptions.code is always a string at
    // construction time; normalize back to `string` for PublicWidgetError.
    code: String(error.code),
    publicMessage: error.publicMessage,
    cause: error,
  })
}

export function makePassportCheckerServer() {
  return defineWidgetServer({
    schemas: passportCheckerBrowserSchemas,
    handlers: {
      async check(_payload, context) {
        const result = await context.api.browser.invoke(passportCheckerBrowserTasks.check, {})
        if (result instanceof BrowserTaskRejectedError) return mapRejectedTask(result)
        if (result instanceof BrowserAutomationUnavailableError) {
          return new PublicWidgetError({
            status: 503,
            code: 'browser_unavailable',
            publicMessage: 'Browser automation is unavailable',
            cause: result,
          })
        }
        if (result instanceof BrowserAutomationDeadlineError) {
          return new PublicWidgetError({
            status: 504,
            code: 'automation_timeout',
            publicMessage: 'The passport check timed out',
            cause: result,
          })
        }
        if (result instanceof BrowserAutomationProtocolError) {
          return new PublicWidgetError({
            status: 502,
            code: 'automation_protocol',
            publicMessage: 'Browser automation returned an unexpected response',
            cause: result,
          })
        }
        return result
      },
    },
  })
}

export default makePassportCheckerServer()
