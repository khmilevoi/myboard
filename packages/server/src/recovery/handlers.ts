import type { BrowserAutomationClient } from '../browser/client'
import type { RecoveryCapabilityStore } from './capability'
import { serializeRecoveryCookie } from './cookie'

// Widget ids are codegen-generated slugs; anything else must never reach an
// upstream URL.
const SAFE_WIDGET_ID = /^[a-z0-9][a-z0-9-]{0,63}$/

export type RecoveryIssueDeps = {
  store: RecoveryCapabilityStore
  client: BrowserAutomationClient
  secureCookies: boolean
  tokenTtlMs: number
}

export type RecoveryIssueResult = {
  status: number
  body: unknown
  cookie?: string
}

const unavailable: RecoveryIssueResult = {
  status: 404,
  body: { code: 'recovery_unavailable' },
}

export async function handleRecoveryIssue(
  deps: RecoveryIssueDeps,
  args: { widgetId: string; sessionId: string },
): Promise<RecoveryIssueResult> {
  if (!SAFE_WIDGET_ID.test(args.widgetId)) return unavailable
  if (deps.store.isBusy()) return { status: 409, body: { code: 'recovery_busy' } }

  const state = await deps.client.recoveryState({ widgetId: args.widgetId })
  if (state instanceof Error) return { status: 503, body: { code: 'automation_unavailable' } }
  if (!state.retained) return unavailable

  const { token, expiresInMs } = deps.store.issue({
    widgetId: args.widgetId,
    sessionId: args.sessionId,
  })
  return {
    status: 200,
    body: { expiresInMs },
    cookie: serializeRecoveryCookie({
      token,
      ttlMs: deps.tokenTtlMs,
      secureCookies: deps.secureCookies,
    }),
  }
}
