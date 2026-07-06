import { runExclusive } from '../storage/key-lock'
import type { ValkeyOps } from '../storage/valkey'
import type { AuthConfig } from './config'
import { getDevice } from './devices'
import { DeviceDisabledError, DeviceNotFoundError, SessionMissingError } from './errors'
import { type SessionRecord, SessionRecordSchema, getJson, sessionKey, setJson } from './records'
import { randomId } from './tokens'

const SESSION_KEY_PREFIX = 'session:'
const REFRESH_THROTTLE_MS = 5 * 60_000

export type IssueSessionOptions = {
  accountId: string
  credentialId: string
  ip?: string
  ua?: string
}

export async function issueSession(
  ops: ValkeyOps,
  config: AuthConfig,
  now: () => number,
  { accountId, credentialId, ip, ua }: IssueSessionOptions,
): Promise<SessionRecord> {
  const createdAt = now()
  const record: SessionRecord = {
    sessionId: randomId(),
    accountId,
    credentialId,
    createdAt,
    lastSeenAt: createdAt,
    expiresAt: createdAt + config.sessionTtlSlidingMs,
    absoluteExpiresAt: createdAt + config.sessionTtlAbsoluteMs,
    ...(ip !== undefined ? { ip } : {}),
    ...(ua !== undefined ? { ua } : {}),
  }

  await setJson(ops, sessionKey(record.sessionId), record, config.sessionTtlAbsoluteMs)

  return record
}

export type VerifySessionResult = {
  record: SessionRecord
  refreshed: boolean
}

export async function verifySession(
  ops: ValkeyOps,
  config: AuthConfig,
  now: () => number,
  sessionId: string,
): Promise<
  VerifySessionResult | SessionMissingError | DeviceDisabledError | DeviceNotFoundError | Error
> {
  const record = await getJson(ops, sessionKey(sessionId), SessionRecordSchema)
  if (record instanceof Error) return record
  if (record === null) return new SessionMissingError()

  const nowMs = now()
  if (nowMs >= record.expiresAt || nowMs >= record.absoluteExpiresAt) {
    await ops.del(sessionKey(sessionId))
    return new SessionMissingError()
  }

  const device = await getDevice(ops, record.credentialId)
  if (device instanceof DeviceNotFoundError) return device
  if (device instanceof Error) return device
  if (device.disabled || device.status !== 'active') return new DeviceDisabledError()

  if (nowMs - record.lastSeenAt > REFRESH_THROTTLE_MS) {
    return runExclusive(sessionKey(sessionId), async () => {
      // Re-get inside the lock: a concurrent revokeSession may have deleted the
      // session between the read above and acquiring this lock. If so, do not
      // resurrect it.
      const current = await getJson(ops, sessionKey(sessionId), SessionRecordSchema)
      if (current instanceof Error) return current
      if (current === null) return new SessionMissingError()

      const slidExpiresAt = Math.min(nowMs + config.sessionTtlSlidingMs, current.absoluteExpiresAt)
      const updated: SessionRecord = {
        ...current,
        lastSeenAt: nowMs,
        expiresAt: slidExpiresAt,
      }
      await setJson(
        ops,
        sessionKey(sessionId),
        updated,
        Math.max(current.absoluteExpiresAt - nowMs, 0),
      )
      return { record: updated, refreshed: true }
    })
  }

  return { record, refreshed: false }
}

export async function revokeSession(ops: ValkeyOps, sessionId: string): Promise<void> {
  await runExclusive(sessionKey(sessionId), async () => {
    await ops.del(sessionKey(sessionId))
  })
}

export async function revokeAllSessionsForDevice(
  ops: ValkeyOps,
  credentialId: string,
): Promise<void> {
  const keys = await ops.scanKeys(SESSION_KEY_PREFIX)
  for (const key of keys) {
    const record = await getJson(ops, key, SessionRecordSchema)
    if (record instanceof Error || record === null) continue
    if (record.credentialId !== credentialId) continue

    // Serialize with verifySession's locked refresh (see revokeSession above): a
    // concurrent refresh could otherwise re-write this session key with
    // setJson between our read above and the delete, resurrecting it.
    await runExclusive(key, async () => {
      await ops.del(key)
    })
  }
}
