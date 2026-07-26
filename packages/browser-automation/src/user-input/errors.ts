import { BrowserTaskError } from '@shared/browser-automation/task-errors'
import * as errore from 'errore'

type UserInputRequiredErrorOptions = {
  sshTarget: string | null
  cause?: unknown
}

/**
 * The canonical "a human must act on this browser session" error.
 *
 * `code` and the `sshTarget` meta key are a cross-package contract: the widget
 * server maps the code to HTTP 409, and the client switches to the noVNC
 * recovery view on it. Neither may be renamed without migrating both.
 */
export class UserInputRequiredError extends errore.createTaggedError({
  name: 'UserInputRequiredError',
  message: 'The browser session requires manual input',
  extends: BrowserTaskError,
}) {
  readonly sshTarget: string | null
  code = 'browser_session_required'
  publicMessage = 'The browser session requires attention'

  constructor({ sshTarget, ...options }: UserInputRequiredErrorOptions) {
    super(options)
    this.sshTarget = sshTarget
  }

  get publicMeta(): Record<string, unknown> | undefined {
    return this.sshTarget ? { sshTarget: this.sshTarget } : undefined
  }
}

/**
 * The detector could not decide. The page is deliberately left unretained: we
 * do not know whether a human could do anything with it, and holding a browser
 * page open for a recovery nobody will perform is worse than failing the task.
 */
export class UserInputProbeError extends errore.createTaggedError({
  name: 'UserInputProbeError',
  message: 'Failed to check whether the browser session requires manual input',
  extends: BrowserTaskError,
}) {
  code = 'user_input_probe'
  publicMessage = 'Could not determine whether the browser needs attention'
}
