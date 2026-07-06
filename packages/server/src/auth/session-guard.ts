import type { IncomingMessage } from 'node:http'

import { parseCookies } from './cookies'
import type { AuthDeps, AuthResult } from './handlers'
import type { SessionRecord } from './records'
import { verifySession } from './sessions'

export function isAuthResult(v: unknown): v is AuthResult {
  return typeof v === 'object' && v !== null && typeof (v as AuthResult).status === 'number'
}

export async function requireSession(
  deps: AuthDeps,
  req: IncomingMessage,
): Promise<SessionRecord | AuthResult> {
  const sessionId = parseCookies(req.headers.cookie)[deps.config.sessionCookieName]
  if (!sessionId) return { status: 401, body: { code: 'session_missing' } }
  const result = await verifySession(deps.ops, deps.config, deps.now, sessionId)
  if (result instanceof Error) return { status: 401, body: { code: 'session_missing' } }
  return result.record
}
