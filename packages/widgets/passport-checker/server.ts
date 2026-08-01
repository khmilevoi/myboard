import {
  BrowserAutomationDeadlineError,
  BrowserAutomationProtocolError,
  BrowserAutomationUnavailableError,
  BrowserTaskRejectedError,
  type BrowserGatewayError,
} from '@shared/widgets/browser-errors'
import { defineWidgetServer } from '@shared/widgets/contracts'
import { PublicWidgetError } from '@shared/widgets/public-error'

import { passportCheckerBrowserSchemas, passportCheckerBrowserTasks } from './types'

// docker-compose.yml maps the noVNC container port to a per-stack host port
// via NOVNC_HOST_PORT (default 6080). The recovery error meta carries the
// real value so the client's SSH-tunnel hint never hardcodes 6080 — a
// hardcoded value would tunnel an operator on dev/branch straight into
// production's browser session whenever the stacks disagree. 6080 here is
// only a fallback for a browser-automation build that hasn't started
// sending `novncPort` yet, matching NOVNC_HOST_PORT's own default.
const DEFAULT_NOVNC_PORT = 6080

export function mapRejectedTask(error: BrowserTaskRejectedError): PublicWidgetError {
  if (error.code === 'browser_session_required') {
    const sshTarget = error.meta?.sshTarget
    const novncPort = error.meta?.novncPort
    return new PublicWidgetError({
      status: 409,
      code: 'browser_session_required',
      publicMessage: error.publicMessage,
      // sshTarget mirrors the upstream meta exactly (present only when it's a
      // string); novncPort always travels, falling back to the stack default
      // so the client can build the SSH tunnel hint even when the upstream
      // meta is missing or malformed.
      meta: {
        ...(typeof sshTarget === 'string' ? { sshTarget } : {}),
        novncPort:
          typeof novncPort === 'number' && Number.isInteger(novncPort) && novncPort > 0
            ? novncPort
            : DEFAULT_NOVNC_PORT,
      },
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

function isBrowserGatewayError(value: unknown): value is BrowserGatewayError {
  return (
    value instanceof BrowserTaskRejectedError ||
    value instanceof BrowserAutomationUnavailableError ||
    value instanceof BrowserAutomationDeadlineError ||
    value instanceof BrowserAutomationProtocolError
  )
}

function mapBrowserError(error: BrowserGatewayError): PublicWidgetError {
  if (error instanceof BrowserTaskRejectedError) return mapRejectedTask(error)
  if (error instanceof BrowserAutomationUnavailableError) {
    return new PublicWidgetError({
      status: 503,
      code: 'browser_unavailable',
      publicMessage: 'Browser automation is unavailable',
      cause: error,
    })
  }
  if (error instanceof BrowserAutomationDeadlineError) {
    return new PublicWidgetError({
      status: 504,
      code: 'automation_timeout',
      publicMessage: 'The passport check timed out',
      cause: error,
    })
  }
  return new PublicWidgetError({
    status: 502,
    code: 'automation_protocol',
    publicMessage: 'Browser automation returned an unexpected response',
    cause: error,
  })
}

export function makePassportCheckerServer() {
  return defineWidgetServer({
    schemas: passportCheckerBrowserSchemas,
    handlers: {
      async check(_payload, context) {
        const result = await context.api.browser.invoke(passportCheckerBrowserTasks.check, {})
        if (isBrowserGatewayError(result)) return mapBrowserError(result)
        return result
      },
      async checkV2(_payload, context) {
        const result = await context.api.browser.invoke(passportCheckerBrowserTasks.checkV2, {})
        if (isBrowserGatewayError(result)) return mapBrowserError(result)
        return result
      },
    },
  })
}

export default makePassportCheckerServer()
