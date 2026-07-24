import { randomBytes } from 'node:crypto'

import * as errore from 'errore'

export class RecoveryCapabilityError extends errore.createTaggedError({
  name: 'RecoveryCapabilityError',
  message: 'Recovery capability is not usable ($reason)',
}) {}

export type RecoveryConnection = {
  widgetId: string
  destroy: () => void
}

export type RecoveryCapabilityStore = {
  issue(args: { widgetId: string; sessionId: string }): { token: string; expiresInMs: number }
  consume(args: {
    token: string | undefined
    sessionId: string
  }): RecoveryCapabilityError | { widgetId: string }
  isBusy(): boolean
  attach(connection: RecoveryConnection): void
  detach(connection: RecoveryConnection): void
  revoke(widgetId: string): void
  revokeAll(): void
}

type Entry = { widgetId: string; sessionId: string; expiresAt: number }

export function makeRecoveryCapabilityStore(deps: {
  now: () => number
  tokenTtlMs: number
}): RecoveryCapabilityStore {
  const entries = new Map<string, Entry>()
  let active: RecoveryConnection | null = null

  function dropWidgetTokens(widgetId: string): void {
    for (const [token, entry] of entries) {
      if (entry.widgetId === widgetId) entries.delete(token)
    }
  }

  function sweepExpired(): void {
    const nowMs = deps.now()
    for (const [token, entry] of entries) {
      if (entry.expiresAt <= nowMs) entries.delete(token)
    }
  }

  function destroyActive(): void {
    const connection = active
    active = null
    connection?.destroy()
  }

  return {
    issue({ widgetId, sessionId }) {
      sweepExpired()
      // One live token per widget: re-opening the panel supersedes the token
      // the previous attempt never used.
      dropWidgetTokens(widgetId)
      const token = randomBytes(32).toString('base64url')
      entries.set(token, { widgetId, sessionId, expiresAt: deps.now() + deps.tokenTtlMs })
      return { token, expiresInMs: deps.tokenTtlMs }
    },
    consume({ token, sessionId }) {
      if (!token) return new RecoveryCapabilityError({ reason: 'missing' })
      const entry = entries.get(token)
      if (!entry) return new RecoveryCapabilityError({ reason: 'unknown' })
      // Single use: the token dies on the first attempt, successful or not. A
      // token presented by another session is treated as compromised.
      entries.delete(token)
      if (entry.expiresAt <= deps.now()) return new RecoveryCapabilityError({ reason: 'expired' })
      if (entry.sessionId !== sessionId) {
        return new RecoveryCapabilityError({ reason: 'session_mismatch' })
      }
      return { widgetId: entry.widgetId }
    },
    isBusy: () => active !== null,
    attach(connection) {
      active = connection
    },
    detach(connection) {
      if (active === connection) active = null
    },
    revoke(widgetId) {
      dropWidgetTokens(widgetId)
      if (active?.widgetId === widgetId) destroyActive()
    },
    revokeAll() {
      entries.clear()
      destroyActive()
    },
  }
}
