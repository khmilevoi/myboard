import type { ValkeyOps } from '../storage/valkey'
import type { AuthConfig } from './config'
import { serializeCookie, parseCookies } from './cookies'
import { ChallengeInvalidError } from './errors'
import {
  type ChallengeRecord,
  ChallengeRecordSchema,
  challengeKey,
  getJson,
  setJson,
} from './records'
import { randomId } from './tokens'

const CHALLENGE_TTL_MS = 5 * 60_000

export type SaveChallengeOptions = {
  type: ChallengeRecord['type']
  challenge: string
  inviteHash?: string
  accountId?: string
}

export async function saveChallenge(
  ops: ValkeyOps,
  config: AuthConfig,
  now: () => number,
  { type, challenge, inviteHash, accountId }: SaveChallengeOptions,
): Promise<{ challengeId: string; cookie: string }> {
  const challengeId = randomId()
  const record: ChallengeRecord = {
    challengeId,
    challenge,
    type,
    expiresAt: now() + CHALLENGE_TTL_MS,
    ...(inviteHash !== undefined ? { inviteHash } : {}),
    ...(accountId !== undefined ? { accountId } : {}),
  }

  await setJson(ops, challengeKey(challengeId), record, CHALLENGE_TTL_MS)

  const cookie = serializeCookie(config.challengeCookieName, challengeId, {
    maxAgeMs: CHALLENGE_TTL_MS,
    httpOnly: true,
    secure: config.secureCookies,
    sameSite: 'Strict',
    path: '/',
  })

  return { challengeId, cookie }
}

export type ConsumeChallengeOptions = {
  cookieHeader: string | undefined
  expectedType: ChallengeRecord['type']
}

export async function consumeChallenge(
  ops: ValkeyOps,
  config: AuthConfig,
  now: () => number,
  { cookieHeader, expectedType }: ConsumeChallengeOptions,
): Promise<ChallengeRecord | ChallengeInvalidError | Error> {
  const challengeId = parseCookies(cookieHeader)[config.challengeCookieName]
  if (!challengeId) return new ChallengeInvalidError()

  const record = await getJson(ops, challengeKey(challengeId), ChallengeRecordSchema)
  if (record instanceof Error) return record
  if (record === null) return new ChallengeInvalidError()
  if (now() >= record.expiresAt) return new ChallengeInvalidError()
  if (record.type !== expectedType) return new ChallengeInvalidError()

  await ops.del(challengeKey(challengeId))

  return record
}
