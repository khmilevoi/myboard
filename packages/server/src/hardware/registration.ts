import crypto from 'node:crypto'

import type { GatewayRegisterBody } from '@shared/hardware/gateway-protocol'

import {
  ADD_CODE_FAILED_ATTEMPTS_LIMIT,
  formatAddCode,
  generateAddCode,
  normalizeAddCode,
} from '../auth/add-tokens'
import { getJson, setJson } from '../auth/records'
import { randomId, randomToken, sha256hex } from '../auth/tokens'
import { runExclusive } from '../storage/key-lock'
import type { ValkeyOps } from '../storage/valkey'
import { GatewayCodeInvalidError, GatewayNotFoundError, GatewayUnauthorizedError } from './errors'
import { GATEWAY_CODE_KEY, gatewayKey, gatewayTokenKey, scanKey } from './keys'
import { type GatewayRecord, GatewayCodeRecordSchema, GatewayTokenRecordSchema } from './records'
import {
  deleteGateway,
  getGateway,
  listHardware,
  putGateway,
  updateGateway,
  updateHardware,
} from './store'

export const GATEWAY_CODE_TTL_MS = 5 * 60_000

const BEARER_PREFIX = 'Bearer '

export async function mintGatewayCode(
  ops: ValkeyOps,
  now: () => number,
  { accountId }: { accountId: string },
): Promise<{ code: string; expiresAt: number } | Error> {
  const canonical = generateAddCode()
  const expiresAt = now() + GATEWAY_CODE_TTL_MS
  // One live code per board: this write replaces any earlier pending code.
  return runExclusive(GATEWAY_CODE_KEY, async () => {
    await setJson(
      ops,
      GATEWAY_CODE_KEY,
      { codeHash: sha256hex(canonical), expiresAt, failedAttempts: 0, createdBy: accountId },
      GATEWAY_CODE_TTL_MS,
    )
    return { code: formatAddCode(canonical), expiresAt }
  })
}

function hashesEqual(a: string, b: string): boolean {
  const left = Buffer.from(a, 'hex')
  const right = Buffer.from(b, 'hex')
  return left.length === right.length && crypto.timingSafeEqual(left, right)
}

export function registerGateway(
  ops: ValkeyOps,
  now: () => number,
  body: GatewayRegisterBody,
): Promise<{ gatewayId: string; token: string } | GatewayCodeInvalidError | Error> {
  return runExclusive(GATEWAY_CODE_KEY, async () => {
    const record = await getJson(ops, GATEWAY_CODE_KEY, GatewayCodeRecordSchema)
    if (record instanceof Error) return record
    if (record === null) return new GatewayCodeInvalidError()
    if (record.expiresAt <= now()) return new GatewayCodeInvalidError()
    if (record.failedAttempts >= ADD_CODE_FAILED_ATTEMPTS_LIMIT)
      return new GatewayCodeInvalidError()

    const canonical = normalizeAddCode(body.code)
    if (canonical === null || !hashesEqual(sha256hex(canonical), record.codeHash)) {
      await setJson(
        ops,
        GATEWAY_CODE_KEY,
        { ...record, failedAttempts: record.failedAttempts + 1 },
        Math.max(1, record.expiresAt - now()),
      )
      return new GatewayCodeInvalidError()
    }

    await ops.del(GATEWAY_CODE_KEY)
    const token = randomToken()
    const tokenHash = sha256hex(token)
    const gatewayId = randomId()
    const at = now()
    const stored = await putGateway(ops, {
      id: gatewayId,
      label: body.label,
      tokenHash,
      createdAt: at,
      createdBy: record.createdBy,
      lastSeenAt: at,
      connectedAt: null,
      adapter: null,
      bonded: [],
    })
    if (stored instanceof Error) return stored
    await setJson(ops, gatewayTokenKey(tokenHash), { gatewayId })
    return { gatewayId, token }
  })
}

export async function authenticateGateway(
  ops: ValkeyOps,
  now: () => number,
  authorization: string | undefined,
): Promise<GatewayRecord | GatewayUnauthorizedError | Error> {
  if (authorization === undefined || !authorization.startsWith(BEARER_PREFIX)) {
    return new GatewayUnauthorizedError()
  }
  const token = authorization.slice(BEARER_PREFIX.length).trim()
  if (token === '') return new GatewayUnauthorizedError()
  const tokenRecord = await getJson(
    ops,
    gatewayTokenKey(sha256hex(token)),
    GatewayTokenRecordSchema,
  )
  if (tokenRecord instanceof Error) return tokenRecord
  if (tokenRecord === null) return new GatewayUnauthorizedError()
  const gateway = await getGateway(ops, tokenRecord.gatewayId)
  if (gateway instanceof Error) return gateway
  if (gateway === null) return new GatewayUnauthorizedError()
  const touched = await updateGateway(ops, gateway.id, (current) => ({
    ...current,
    lastSeenAt: now(),
  }))
  if (touched instanceof Error) return touched
  if (touched === null) return new GatewayUnauthorizedError()
  return touched
}

export function revokeGateway(
  ops: ValkeyOps,
  gatewayId: string,
): Promise<void | GatewayNotFoundError | Error> {
  // Same lock as updateGateway, so a concurrent touch cannot resurrect the record.
  return runExclusive(gatewayKey(gatewayId), async () => {
    const gateway = await getGateway(ops, gatewayId)
    if (gateway instanceof Error) return gateway
    if (gateway === null) return new GatewayNotFoundError()
    await ops.del(gatewayTokenKey(gateway.tokenHash))
    const removed = await deleteGateway(ops, gatewayId)
    if (removed instanceof Error) return removed
    await ops.del(scanKey(gatewayId))
    const all = await listHardware(ops)
    if (all instanceof Error) return all
    for (const hardware of all) {
      if (hardware.gatewayId !== gatewayId) continue
      const detached = await updateHardware(ops, hardware.id, (current) =>
        current.gatewayId === gatewayId ? { ...current, gatewayId: null } : current,
      )
      if (detached instanceof Error) return detached
    }
  })
}
