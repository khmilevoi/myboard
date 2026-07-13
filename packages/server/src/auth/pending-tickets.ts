import type { ValkeyOps } from '../storage/valkey'
import type { AuthConfig } from './config'
import { parseCookies, serializeCookie } from './cookies'
import { PendingTicketInvalidError } from './errors'
import {
  type PendingTicketRecord,
  PendingTicketRecordSchema,
  getJson,
  getdelJson,
  pendingKey,
  setJson,
} from './records'
import { randomId } from './tokens'

export const PENDING_TTL_MS = 15 * 60_000

export async function issuePendingTicket(
  ops: ValkeyOps,
  config: AuthConfig,
  now: () => number,
  { credentialId, accountId }: { credentialId: string; accountId: string },
): Promise<{ ticketId: string; cookie: string }> {
  const ticketId = randomId()
  const record: PendingTicketRecord = {
    ticketId,
    credentialId,
    accountId,
    expiresAt: now() + PENDING_TTL_MS,
  }
  await setJson(ops, pendingKey(ticketId), record, PENDING_TTL_MS)
  const cookie = serializeCookie(config.pendingCookieName, ticketId, {
    maxAgeMs: PENDING_TTL_MS,
    httpOnly: true,
    secure: config.secureCookies,
    sameSite: 'Strict',
    path: '/',
  })
  return { ticketId, cookie }
}

export async function readPendingTicket(
  ops: ValkeyOps,
  config: AuthConfig,
  now: () => number,
  cookieHeader: string | undefined,
): Promise<PendingTicketRecord | PendingTicketInvalidError | Error> {
  const ticketId = parseCookies(cookieHeader)[config.pendingCookieName]
  if (!ticketId) return new PendingTicketInvalidError()
  const record = await getJson(ops, pendingKey(ticketId), PendingTicketRecordSchema)
  if (record instanceof Error) return record
  if (record === null || now() >= record.expiresAt) return new PendingTicketInvalidError()
  return record
}

// Atomic, single-use claim of a pending ticket via Valkey GETDEL: the
// get-and-delete is one atomic server-side op, so two concurrent claims (two
// overlapping "approved" polls from the same device) can never both consume it
// — even across separate server instances. The loser's GETDEL finds the key
// already gone and returns PendingTicketInvalidError. readPendingTicket stays
// the non-consuming peek used by the status check.
export async function consumePendingTicket(
  ops: ValkeyOps,
  config: AuthConfig,
  now: () => number,
  cookieHeader: string | undefined,
): Promise<PendingTicketRecord | PendingTicketInvalidError | Error> {
  const ticketId = parseCookies(cookieHeader)[config.pendingCookieName]
  if (!ticketId) return new PendingTicketInvalidError()

  const record = await getdelJson(ops, pendingKey(ticketId), PendingTicketRecordSchema)
  if (record instanceof Error) return record
  if (record === null || now() >= record.expiresAt) return new PendingTicketInvalidError()
  return record
}
