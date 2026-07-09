import { runExclusive } from '../storage/key-lock'
import type { ValkeyOps } from '../storage/valkey'
import {
  InviteConsumedError,
  InviteExpiredError,
  InviteLockedError,
  InviteNotFoundError,
} from './errors'
import { type InviteRecord, InviteRecordSchema, getJson, inviteKey, setJson } from './records'
import { randomId, randomToken, sha256hex } from './tokens'

const FAILED_ATTEMPTS_LIMIT = 10

export type CreateInviteOptions = {
  ttlMs: number
  maxUses?: number
  label?: string
  createdBy?: string
}

export async function createInvite(
  ops: ValkeyOps,
  now: () => number,
  { ttlMs, maxUses = 1, label, createdBy }: CreateInviteOptions,
): Promise<{ token: string; record: InviteRecord }> {
  const token = randomToken()
  const createdAt = now()
  const record: InviteRecord = {
    id: randomId(),
    createdAt,
    expiresAt: createdAt + ttlMs,
    maxUses,
    uses: 0,
    failedAttempts: 0,
    ...(label !== undefined ? { label } : {}),
    ...(createdBy !== undefined ? { createdBy } : {}),
  }

  await setJson(ops, inviteKey(sha256hex(token)), record, ttlMs)

  return { token, record }
}

export type InviteStatus = 'active' | 'expired' | 'consumed' | 'locked'

export function inviteStatus(record: InviteRecord, now: () => number): InviteStatus {
  if (record.expiresAt <= now()) return 'expired'
  if (record.uses >= record.maxUses) return 'consumed'
  if (record.failedAttempts >= FAILED_ATTEMPTS_LIMIT) return 'locked'
  return 'active'
}

function checkLive(
  record: InviteRecord,
  now: () => number,
): InviteExpiredError | InviteConsumedError | InviteLockedError | undefined {
  switch (inviteStatus(record, now)) {
    case 'expired':
      return new InviteExpiredError()
    case 'consumed':
      return new InviteConsumedError()
    case 'locked':
      return new InviteLockedError()
    case 'active':
      return undefined
  }
}

export async function lookupInvite(
  ops: ValkeyOps,
  now: () => number,
  token: string,
): Promise<
  | InviteRecord
  | InviteNotFoundError
  | InviteExpiredError
  | InviteConsumedError
  | InviteLockedError
  | Error
> {
  const record = await getJson(ops, inviteKey(sha256hex(token)), InviteRecordSchema)
  if (record instanceof Error) return record
  if (record === null) return new InviteNotFoundError()

  const liveError = checkLive(record, now)
  if (liveError) return liveError

  return record
}

export async function consumeInvite(
  ops: ValkeyOps,
  now: () => number,
  token: string,
): Promise<
  | InviteRecord
  | InviteNotFoundError
  | InviteExpiredError
  | InviteConsumedError
  | InviteLockedError
  | Error
> {
  const hash = sha256hex(token)
  return runExclusive(inviteKey(hash), async () => {
    const record = await getJson(ops, inviteKey(hash), InviteRecordSchema)
    if (record instanceof Error) return record
    if (record === null) return new InviteNotFoundError()

    const liveError = checkLive(record, now)
    if (liveError) return liveError

    const updated: InviteRecord = {
      ...record,
      uses: record.uses + 1,
      usedAt: now(),
    }
    await setJson(ops, inviteKey(hash), updated, Math.max(0, updated.expiresAt - now()))

    return updated
  })
}

export async function recordInviteFailure(
  ops: ValkeyOps,
  now: () => number,
  token: string,
): Promise<void> {
  const hash = sha256hex(token)
  await runExclusive(inviteKey(hash), async () => {
    const record = await getJson(ops, inviteKey(hash), InviteRecordSchema)
    if (record instanceof Error || record === null) return
    // Already expired (clock skew or TTL-fire lag): re-persisting would compute a
    // <= 0 ttl and issue `SET key val PX 0`, which Valkey rejects. Nothing useful
    // to record on an invite that's already dead -- skip the write.
    if (record.expiresAt - now() <= 0) return

    const updated: InviteRecord = {
      ...record,
      failedAttempts: record.failedAttempts + 1,
    }
    await setJson(ops, inviteKey(hash), updated, Math.max(0, updated.expiresAt - now()))
  })
}

export async function releaseInvite(
  ops: ValkeyOps,
  now: () => number,
  token: string,
): Promise<void> {
  const hash = sha256hex(token)
  await runExclusive(inviteKey(hash), async () => {
    const record = await getJson(ops, inviteKey(hash), InviteRecordSchema)
    if (record instanceof Error || record === null) return
    if (record.expiresAt - now() <= 0) return

    const updated: InviteRecord = {
      id: record.id,
      createdAt: record.createdAt,
      expiresAt: record.expiresAt,
      maxUses: record.maxUses,
      uses: Math.max(0, record.uses - 1),
      failedAttempts: record.failedAttempts,
      ...(record.label !== undefined ? { label: record.label } : {}),
      ...(record.createdBy !== undefined ? { createdBy: record.createdBy } : {}),
    }
    await setJson(ops, inviteKey(hash), updated, Math.max(0, updated.expiresAt - now()))
  })
}

const INVITE_KEY_PREFIX = 'invite:'

/** Ops-script path: invites are stored by token hash, so find by record id via scan. */
export async function revokeInviteById(ops: ValkeyOps, id: string): Promise<boolean> {
  const keys = await ops.scanKeys(INVITE_KEY_PREFIX)
  for (const key of keys) {
    const record = await getJson(ops, key, InviteRecordSchema)
    if (record instanceof Error || record === null) continue
    if (record.id !== id) continue
    await ops.del(key)
    return true
  }
  return false
}

/** Ops-script path: list every invite record currently in the store. */
export async function listAllInvites(ops: ValkeyOps): Promise<InviteRecord[]> {
  const keys = await ops.scanKeys(INVITE_KEY_PREFIX)
  const records: InviteRecord[] = []
  for (const key of keys) {
    const record = await getJson(ops, key, InviteRecordSchema)
    if (record instanceof Error || record === null) continue
    records.push(record)
  }
  return records
}
