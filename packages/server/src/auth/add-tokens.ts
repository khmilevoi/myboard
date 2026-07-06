import crypto from 'node:crypto'

import { runExclusive } from '../storage/key-lock'
import type { ValkeyOps } from '../storage/valkey'
import { AddTokenInvalidError } from './errors'
import { type AddTokenRecord, AddTokenRecordSchema, addTokenKey, getJson, setJson } from './records'
import { sha256hex } from './tokens'

const ALPHABET = '0123456789ABCDEFGHJKMNPQRSTVWXYZ' // Crockford base32, no I L O U
const CODE_LEN = 8
const FAILED_ATTEMPTS_LIMIT = 10

export function generateAddCode(): string {
  const bytes = crypto.randomBytes(CODE_LEN)
  let out = ''
  for (let i = 0; i < CODE_LEN; i++) out += ALPHABET[bytes[i] % ALPHABET.length]
  return out
}

export function normalizeAddCode(input: string): string | null {
  const cleaned = input.toUpperCase().replace(/[^0-9A-Z]/g, '')
  if (cleaned.length !== CODE_LEN) return null
  for (const ch of cleaned) if (!ALPHABET.includes(ch)) return null
  return cleaned
}

export function formatAddCode(canonical: string): string {
  return `${canonical.slice(0, 4)}-${canonical.slice(4)}`
}

function checkLive(record: AddTokenRecord, now: () => number): AddTokenInvalidError | undefined {
  if (record.expiresAt <= now()) return new AddTokenInvalidError()
  if (record.failedAttempts >= FAILED_ATTEMPTS_LIMIT) return new AddTokenInvalidError()
  return undefined
}

export async function mintAddToken(
  ops: ValkeyOps,
  now: () => number,
  { accountId, ttlMs }: { accountId: string; ttlMs: number },
): Promise<{ code: string; record: AddTokenRecord }> {
  const code = generateAddCode()
  const record: AddTokenRecord = { accountId, expiresAt: now() + ttlMs, failedAttempts: 0 }
  await setJson(ops, addTokenKey(sha256hex(code)), record, ttlMs)
  return { code, record }
}

export async function lookupAddToken(
  ops: ValkeyOps,
  now: () => number,
  code: string,
): Promise<AddTokenRecord | AddTokenInvalidError | Error> {
  const canonical = normalizeAddCode(code)
  if (!canonical) return new AddTokenInvalidError()
  const record = await getJson(ops, addTokenKey(sha256hex(canonical)), AddTokenRecordSchema)
  if (record instanceof Error) return record
  if (record === null) return new AddTokenInvalidError()
  const live = checkLive(record, now)
  if (live) return live
  return record
}

export async function consumeAddToken(
  ops: ValkeyOps,
  now: () => number,
  code: string,
): Promise<AddTokenRecord | AddTokenInvalidError | Error> {
  const canonical = normalizeAddCode(code)
  if (!canonical) return new AddTokenInvalidError()
  const key = addTokenKey(sha256hex(canonical))
  return runExclusive(key, async () => {
    const record = await getJson(ops, key, AddTokenRecordSchema)
    if (record instanceof Error) return record
    if (record === null) return new AddTokenInvalidError()
    const live = checkLive(record, now)
    if (live) return live
    await ops.del(key)
    return record
  })
}

export async function recordAddTokenFailure(
  ops: ValkeyOps,
  now: () => number,
  code: string,
): Promise<void> {
  const canonical = normalizeAddCode(code)
  if (!canonical) return
  const key = addTokenKey(sha256hex(canonical))
  await runExclusive(key, async () => {
    const record = await getJson(ops, key, AddTokenRecordSchema)
    if (record instanceof Error || record === null) return
    if (record.expiresAt - now() <= 0) return
    await setJson(
      ops,
      key,
      { ...record, failedAttempts: record.failedAttempts + 1 },
      Math.max(0, record.expiresAt - now()),
    )
  })
}
