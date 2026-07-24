import { BrowserTaskError } from '@shared/browser-automation/task-errors'
import * as errore from 'errore'

export type CheckerPhase = 'navigation' | 'submission'

export class BrowserConfigurationError extends errore.createTaggedError({
  name: 'BrowserConfigurationError',
  message: 'Passport checker configuration is invalid',
  extends: BrowserTaskError,
}) {
  code = 'browser_configuration'
  publicMessage = 'Passport checker is not configured'
}

type BrowserSessionRequiredErrorOptions = {
  sshTarget: string | null
  cause?: unknown
}

export class BrowserSessionRequiredError extends errore.createTaggedError({
  name: 'BrowserSessionRequiredError',
  message: 'Passport checker browser session requires attention',
  extends: BrowserTaskError,
}) {
  readonly sshTarget: string | null
  code = 'browser_session_required'
  publicMessage = 'The browser session requires attention'

  constructor({ sshTarget, ...options }: BrowserSessionRequiredErrorOptions) {
    super(options)
    this.sshTarget = sshTarget
  }

  get publicMeta(): Record<string, unknown> | undefined {
    return this.sshTarget ? { sshTarget: this.sshTarget } : undefined
  }
}

type UpstreamResponseErrorOptions = {
  phase: CheckerPhase
  status?: number
  cause?: unknown
}

export class UpstreamResponseError extends errore.createTaggedError({
  name: 'UpstreamResponseError',
  message: 'Passport checker failed during $phase',
  extends: BrowserTaskError,
}) {
  readonly status: number | undefined
  code = 'upstream_response'
  publicMessage = 'Passport checker is temporarily unavailable'

  constructor({ status, ...options }: UpstreamResponseErrorOptions) {
    super(options)
    this.status = status
  }

  get publicMeta(): Record<string, unknown> {
    return this.status === undefined
      ? { phase: this.phase }
      : { phase: this.phase, status: this.status }
  }
}

export class InvalidCheckerResponseError extends errore.createTaggedError({
  name: 'InvalidCheckerResponseError',
  message: 'Passport checker response is invalid',
  extends: BrowserTaskError,
}) {
  code = 'invalid_checker_response'
  publicMessage = 'Passport checker returned an unexpected response'
}
