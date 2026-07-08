import { HttpClient, makeUnauthorizedRetryHook } from '@shared/http/client'
import { makeHostRuntime } from 'widget-runtime'

import { makeReloginModel } from '@/session/model/relogin'

/** The app's single relogin instance — built here, at the root, not as a
 * module singleton inside the model. */
const relogin = makeReloginModel()

/** Board-wide HTTP: silent 401 re-login via a single forced replay. This
 * hook is the app's ONLY session-healing path — SSE reconnect deliberately
 * never re-auths (the connect attempt is its own probe). Known residual,
 * accepted: a timer-driven widget fetch after absolute-TTL expiry reaches
 * the ceremony here without a user gesture; sliding TTL makes that a
 * once-per-absolute-TTL event. */
export const http = new HttpClient({
  onResponse: [makeUnauthorizedRetryHook(relogin.ensureSession)],
})

/** The board's single widget-runtime composition root (one per document),
 * sharing the board client. */
export const hostRuntime = makeHostRuntime({ http })
