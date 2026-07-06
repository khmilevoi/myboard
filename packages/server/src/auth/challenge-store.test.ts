import { describe, expect, it } from 'vitest'

import { createMemoryOps, createMemoryPubSub } from '../test/memory-ops'
import { consumeChallenge, saveChallenge } from './challenge-store'
import type { AuthConfig } from './config'
import { ChallengeInvalidError } from './errors'
import { challengeKey } from './records'

const MINUTE = 60_000

function makeOps() {
  return createMemoryOps(createMemoryPubSub())
}

function makeClock(start = 0) {
  let time = start
  return {
    now: () => time,
    set: (value: number) => {
      time = value
    },
  }
}

function makeConfig(overrides: Partial<AuthConfig> = {}): AuthConfig {
  return {
    rpID: 'localhost',
    rpName: 'Board',
    expectedOrigin: 'http://localhost',
    sessionCookieName: 'mb_session',
    challengeCookieName: 'mb_chal',
    pendingCookieName: 'mb_pending',
    sessionTtlSlidingMs: 30 * 24 * 60 * MINUTE,
    sessionTtlAbsoluteMs: 90 * 24 * 60 * MINUTE,
    secureCookies: false,
    trustCfConnectingIp: false,
    ...overrides,
  }
}

function cookieHeaderFor(cookie: string): string {
  // cookie is a Set-Cookie string; extract "name=value" for use as a request Cookie header
  return cookie.split('; ')[0]
}

describe('saveChallenge', () => {
  it('writes the challenge record and returns a __Host- style Set-Cookie carrying the challengeId', async () => {
    const ops = makeOps()
    const clock = makeClock(0)
    const config = makeConfig({ secureCookies: true, challengeCookieName: '__Host-mb_chal' })

    const { challengeId, cookie } = await saveChallenge(ops, config, clock.now, {
      type: 'reg',
      challenge: 'base64url-challenge',
    })

    expect(challengeId).toEqual(expect.any(String))
    expect(cookie).toBe(
      `__Host-mb_chal=${challengeId}; Max-Age=300; Path=/; HttpOnly; Secure; SameSite=Strict`,
    )

    const stored = await ops.get(challengeKey(challengeId))
    expect(stored).not.toBeNull()
    expect(JSON.parse(stored as string)).toEqual({
      challengeId,
      challenge: 'base64url-challenge',
      type: 'reg',
      expiresAt: 5 * MINUTE,
    })
  })

  it('includes inviteHash and accountId when provided', async () => {
    const ops = makeOps()
    const clock = makeClock(0)
    const config = makeConfig()

    const { challengeId } = await saveChallenge(ops, config, clock.now, {
      type: 'add-device',
      challenge: 'chal',
      inviteHash: 'hash-1',
      accountId: 'acc-1',
    })

    const stored = await ops.get(challengeKey(challengeId))
    expect(JSON.parse(stored as string)).toEqual({
      challengeId,
      challenge: 'chal',
      type: 'add-device',
      expiresAt: 5 * MINUTE,
      inviteHash: 'hash-1',
      accountId: 'acc-1',
    })
  })
})

describe('consumeChallenge', () => {
  it('round-trips a saved challenge and deletes it (single-use)', async () => {
    const ops = makeOps()
    const clock = makeClock(0)
    const config = makeConfig()
    const { challengeId, cookie } = await saveChallenge(ops, config, clock.now, {
      type: 'auth',
      challenge: 'chal-1',
    })

    const result = await consumeChallenge(ops, config, clock.now, {
      cookieHeader: cookieHeaderFor(cookie),
      expectedType: 'auth',
    })

    expect(result).not.toBeInstanceOf(Error)
    if (result instanceof Error) throw result
    expect(result).toEqual({
      challengeId,
      challenge: 'chal-1',
      type: 'auth',
      expiresAt: 5 * MINUTE,
    })

    const stored = await ops.get(challengeKey(challengeId))
    expect(stored).toBeNull()
  })

  it('returns ChallengeInvalidError when the cookie header is missing', async () => {
    const ops = makeOps()
    const clock = makeClock(0)
    const config = makeConfig()

    const result = await consumeChallenge(ops, config, clock.now, {
      cookieHeader: undefined,
      expectedType: 'auth',
    })

    expect(result).toBeInstanceOf(ChallengeInvalidError)
  })

  it('returns ChallengeInvalidError when the cookie references an unknown challenge', async () => {
    const ops = makeOps()
    const clock = makeClock(0)
    const config = makeConfig()

    const result = await consumeChallenge(ops, config, clock.now, {
      cookieHeader: `${config.challengeCookieName}=missing-id`,
      expectedType: 'auth',
    })

    expect(result).toBeInstanceOf(ChallengeInvalidError)
  })

  it('returns ChallengeInvalidError when expectedType does not match', async () => {
    const ops = makeOps()
    const clock = makeClock(0)
    const config = makeConfig()
    const { cookie } = await saveChallenge(ops, config, clock.now, {
      type: 'reg',
      challenge: 'chal-1',
    })

    const result = await consumeChallenge(ops, config, clock.now, {
      cookieHeader: cookieHeaderFor(cookie),
      expectedType: 'auth',
    })

    expect(result).toBeInstanceOf(ChallengeInvalidError)
  })

  it('returns ChallengeInvalidError when consumed more than 5 minutes after save', async () => {
    const ops = makeOps()
    const clock = makeClock(0)
    const config = makeConfig()
    const { cookie } = await saveChallenge(ops, config, clock.now, {
      type: 'auth',
      challenge: 'chal-1',
    })

    clock.set(6 * MINUTE)
    const result = await consumeChallenge(ops, config, clock.now, {
      cookieHeader: cookieHeaderFor(cookie),
      expectedType: 'auth',
    })

    expect(result).toBeInstanceOf(ChallengeInvalidError)
  })

  it('returns ChallengeInvalidError on a second consume attempt', async () => {
    const ops = makeOps()
    const clock = makeClock(0)
    const config = makeConfig()
    const { cookie } = await saveChallenge(ops, config, clock.now, {
      type: 'auth',
      challenge: 'chal-1',
    })

    const first = await consumeChallenge(ops, config, clock.now, {
      cookieHeader: cookieHeaderFor(cookie),
      expectedType: 'auth',
    })
    expect(first).not.toBeInstanceOf(Error)

    const second = await consumeChallenge(ops, config, clock.now, {
      cookieHeader: cookieHeaderFor(cookie),
      expectedType: 'auth',
    })
    expect(second).toBeInstanceOf(ChallengeInvalidError)
  })

  it('only allows exactly one winner under a concurrent race for the same challenge', async () => {
    const ops = makeOps()
    const clock = makeClock(0)
    const config = makeConfig()
    const { cookie } = await saveChallenge(ops, config, clock.now, {
      type: 'auth',
      challenge: 'chal-1',
    })

    const [a, b] = await Promise.all([
      consumeChallenge(ops, config, clock.now, {
        cookieHeader: cookieHeaderFor(cookie),
        expectedType: 'auth',
      }),
      consumeChallenge(ops, config, clock.now, {
        cookieHeader: cookieHeaderFor(cookie),
        expectedType: 'auth',
      }),
    ])

    const results = [a, b]
    const successes = results.filter((r) => !(r instanceof Error))
    const invalidErrors = results.filter((r) => r instanceof ChallengeInvalidError)

    expect(successes).toHaveLength(1)
    expect(invalidErrors).toHaveLength(1)
  })
})
