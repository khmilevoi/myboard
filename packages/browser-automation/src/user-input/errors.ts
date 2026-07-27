import { BrowserTaskError } from '@shared/browser-automation/task-errors'
import * as errore from 'errore'

// Mirrors loadBrowserServiceConfig's own NOVNC_HOST_PORT default in ../config.ts.
// Only used when a caller constructs this error without a novncPort (existing
// callers that predate the option), so it keeps compiling and still degrades
// to the stack's usual port instead of an arbitrary one.
const DEFAULT_NOVNC_PORT = 6080

type UserInputRequiredErrorOptions = {
  sshTarget: string | null
  novncPort?: number
  cause?: unknown
}

/**
 * The canonical "a human must act on this browser session" error.
 *
 * `code`, the `sshTarget` meta key and the `novncPort` meta key are a
 * cross-package contract: the widget server maps the code to HTTP 409, reads
 * `novncPort` to build the recovery hint against THIS stack's actual noVNC
 * host port (docker-compose.yml's NOVNC_HOST_PORT can differ per stack), and
 * the client switches to the noVNC recovery view on the code. None of the
 * three may be renamed without migrating both sides.
 */
export class UserInputRequiredError extends errore.createTaggedError({
  name: 'UserInputRequiredError',
  message: 'The browser session requires manual input',
  extends: BrowserTaskError,
}) {
  readonly sshTarget: string | null
  readonly novncPort: number
  code = 'browser_session_required'
  publicMessage = 'The browser session requires attention'

  constructor({ sshTarget, novncPort, ...options }: UserInputRequiredErrorOptions) {
    super(options)
    this.sshTarget = sshTarget
    this.novncPort = novncPort ?? DEFAULT_NOVNC_PORT
  }

  get publicMeta(): Record<string, unknown> {
    return { novncPort: this.novncPort, ...(this.sshTarget ? { sshTarget: this.sshTarget } : {}) }
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
