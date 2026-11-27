import type { IncomingMessage, ServerResponse } from 'node:http'

import type { HardwareBoardEvent } from '@shared/hardware/board-api'
import type { z } from 'zod'

import type { AuthDeps } from '../auth/handlers'
import type { SessionRecord } from '../auth/records'
import { isAuthResult, requireSession } from '../auth/session-guard'
import { readJsonBody } from '../http/body'
import { formatZodError } from '../storage/schemas'
import type { ValkeyOps } from '../storage/valkey'
import type { GatewayConnections } from './connections'
import { HardwareError, type HardwarePublishError } from './errors'

export type HardwareDeps = {
  ops: ValkeyOps
  now: () => number
  connections: GatewayConnections
  /**
   * `publishChange(ops, HARDWARE_EVENTS_KEY, event)`: reaches every board subscriber. Never
   * rejects: a pub/sub failure comes back as a value.
   */
  publish(event: HardwareBoardEvent): Promise<void | HardwarePublishError>
}

/** Logs a failure the request still succeeds past (a missed board refresh); name only. */
export function logHardwareFailure(context: string, error: Error): void {
  console.error(`hardware ${context} failed`, error.name)
}

export function sendJson(res: ServerResponse, status: number, body: unknown): void {
  res.writeHead(status, { 'content-type': 'application/json' })
  res.end(JSON.stringify(body))
}

/**
 * Sends `{ error: { code, message } }`. Anything that is not a `HardwareError` is an internal
 * failure: it is answered as a generic 500 and only its name is logged, never its message (store
 * errors can quote record contents).
 */
export function sendHardwareError(res: ServerResponse, error: Error): void {
  const known = error instanceof HardwareError ? error : new HardwareError()
  if (known.status >= 500) console.error('hardware request failed', error.name)
  sendJson(res, known.status, { error: { code: known.code, message: known.publicMessage } })
}

/** Parsed body, or `null` once `400` (malformed JSON), `413` (too large) or `422` was sent. */
export async function readBody<S extends z.ZodType>(
  req: IncomingMessage,
  res: ServerResponse,
  schema: S,
): Promise<z.output<S> | null> {
  const raw = await readJsonBody(req).catch((cause: unknown) =>
    cause instanceof Error ? cause : new Error('invalid body', { cause }),
  )
  if (raw instanceof Error) {
    res.writeHead(raw.message === 'request body too large' ? 413 : 400)
    res.end()
    return null
  }
  const parsed = schema.safeParse(raw)
  if (!parsed.success) {
    sendJson(res, 422, formatZodError(parsed.error))
    return null
  }
  return parsed.data
}

/** The signed-in session, or `null` once the auth failure was sent. */
export async function requireBoardSession(
  authDeps: AuthDeps,
  req: IncomingMessage,
  res: ServerResponse,
): Promise<SessionRecord | null> {
  const session = await requireSession(authDeps, req)
  if (isAuthResult(session)) {
    sendJson(res, session.status, session.body)
    return null
  }
  return session
}
