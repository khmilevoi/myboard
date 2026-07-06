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

export async function verifySession(
  ops: ValkeyOps,
  config: AuthConfig,
  now: () => number,
  sessionId: string,
): Promise<
  SessionRecord | SessionMissingError | DeviceDisabledError | DeviceNotFoundError | Error
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
    const slidExpiresAt = Math.min(nowMs + config.sessionTtlSlidingMs, record.absoluteExpiresAt)
    const updated: SessionRecord = {
      ...record,
      lastSeenAt: nowMs,
      expiresAt: slidExpiresAt,
    }
    await setJson(
      ops,
      sessionKey(sessionId),
      updated,
      Math.max(record.absoluteExpiresAt - nowMs, 0),
    )
    return updated
  }

  return record
}

export async function revokeSession(ops: ValkeyOps, sessionId: string): Promise<void> {
  await ops.del(sessionKey(sessionId))
}

export async function revokeAllSessionsForDevice(
  ops: ValkeyOps,
  credentialId: string,
): Promise<void> {
  const keys = await ops.scanKeys(SESSION_KEY_PREFIX)
  for (const key of keys) {
    const record = await getJson(ops, key, SessionRecordSchema)
    if (record instanceof Error || record === null) continue
    if (record.credentialId === credentialId) await ops.del(key)
  }
}
