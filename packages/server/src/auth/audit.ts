import type { IncomingMessage } from 'node:http'

import { clientIp } from '../http/client-ip'
import type { AuthConfig } from './config'

export type AuditEventName =
  | 'register'
  | 'register_failed'
  | 'login'
  | 'login_failed'
  | 'logout'
  | 'device_pending'
  | 'device_approved'
  | 'device_denied'
  | 'device_revoked'
  | 'invite_locked'
  | 'addtoken_minted'

export type AuditEvent = {
  event: AuditEventName
  accountId?: string
  credentialId?: string
  inviteId?: string
  code?: string
  ip?: string | null
  ua?: string
}

export type AuditLogger = (event: AuditEvent) => void

/** One structured JSON line per auth event, read via `docker compose logs server`. */
export function makeAuditLogger(write: (line: string) => void = console.log): AuditLogger {
  return (event) => write(JSON.stringify({ ts: new Date().toISOString(), ...event }))
}

/** Null object for hosts that don't audit — handler code never null-checks. */
export const noopAudit: AuditLogger = () => {}

/** Real client IP for audit: CF header only behind the trusted tunnel. */
export function auditIp(
  req: Pick<IncomingMessage, 'headers' | 'socket'>,
  config: AuthConfig,
): string | null {
  if (config.trustCfConnectingIp) {
    const cf = req.headers['cf-connecting-ip']
    const value = Array.isArray(cf) ? cf[0] : cf
    if (value) return value
  }
  return clientIp(req)
}

/**
 * Request-scoped emitter: binds the mechanical context (ip, ua) once so
 * emission sites state only the event and its own fields.
 */
export function auditFor(
  deps: { audit: AuditLogger; config: AuthConfig },
  req: Pick<IncomingMessage, 'headers' | 'socket'>,
): (event: AuditEventName, extra?: Omit<AuditEvent, 'event' | 'ip' | 'ua'>) => void {
  return (event, extra = {}) => {
    const ua = req.headers['user-agent']
    deps.audit({ event, ...extra, ip: auditIp(req, deps.config), ...(ua ? { ua } : {}) })
  }
}
