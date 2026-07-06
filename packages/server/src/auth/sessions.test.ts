import { describe, expect, it, vi } from 'vitest'

import { createMemoryOps, createMemoryPubSub } from '../test/memory-ops'
import { addDeviceToAccount, createAccount } from './accounts'
import type { AuthConfig } from './config'
import { revokeDevice, storeDevice } from './devices'
import { DeviceDisabledError, DeviceNotFoundError, SessionMissingError } from './errors'
import { getJson, sessionKey, SessionRecordSchema } from './records'
import type { DeviceRecord } from './records'
import { issueSession, revokeAllSessionsForDevice, revokeSession, verifySession } from './sessions'

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
    sessionTtlSlidingMs: 20 * MINUTE,
    sessionTtlAbsoluteMs: 60 * MINUTE,
    secureCookies: false,
    trustCfConnectingIp: false,
    ...overrides,
  }
}

function makeDevice(overrides: Partial<DeviceRecord> = {}): DeviceRecord {
  return {
    credentialId: 'cred-1',
    publicKey: 'pk',
    signCount: 0,
    label: 'Board device',
    createdAt: 0,
    lastSeenAt: 0,
    disabled: false,
    accountId: 'acc-1',
    status: 'active',
    addedVia: 'invite',
    ...overrides,
  }
}

describe('issueSession / verifySession', () => {
  it('issues a session and verify returns the same record', async () => {
    const ops = makeOps()
    const clock = makeClock(0)
    const config = makeConfig()
    await storeDevice(ops, makeDevice())

    const issued = await issueSession(ops, config, clock.now, {
      accountId: 'acc-1',
      credentialId: 'cred-1',
    })

    expect(issued).toEqual({
      sessionId: expect.any(String),
      accountId: 'acc-1',
      credentialId: 'cred-1',
      createdAt: 0,
      lastSeenAt: 0,
      expiresAt: config.sessionTtlSlidingMs,
      absoluteExpiresAt: config.sessionTtlAbsoluteMs,
    })

    const result = await verifySession(ops, config, clock.now, issued.sessionId)

    expect(result).not.toBeInstanceOf(Error)
    if (result instanceof Error) throw result
    expect(result.refreshed).toBe(false)
    expect(result.record).toEqual(issued)
  })

  it('stores optional ip and ua', async () => {
    const ops = makeOps()
    const clock = makeClock(0)
    const config = makeConfig()
    await storeDevice(ops, makeDevice())

    const issued = await issueSession(ops, config, clock.now, {
      accountId: 'acc-1',
      credentialId: 'cred-1',
      ip: '127.0.0.1',
      ua: 'test-agent',
    })

    expect(issued.ip).toBe('127.0.0.1')
    expect(issued.ua).toBe('test-agent')
  })

  it('refreshes lastSeenAt and slides expiresAt once the 5-min throttle window has passed', async () => {
    const ops = makeOps()
    const clock = makeClock(0)
    const config = makeConfig()
    await storeDevice(ops, makeDevice())
    const issued = await issueSession(ops, config, clock.now, {
      accountId: 'acc-1',
      credentialId: 'cred-1',
    })

    const setSpy = vi.spyOn(ops, 'set')
    clock.set(6 * MINUTE)

    const result = await verifySession(ops, config, clock.now, issued.sessionId)

    expect(result).not.toBeInstanceOf(Error)
    if (result instanceof Error) throw result
    expect(result.refreshed).toBe(true)
    expect(result.record.lastSeenAt).toBe(6 * MINUTE)
    expect(result.record.expiresAt).toBe(6 * MINUTE + config.sessionTtlSlidingMs)
    expect(setSpy).toHaveBeenCalledTimes(1)

    const stored = await getJson(ops, sessionKey(issued.sessionId), SessionRecordSchema)
    expect(stored).not.toBeInstanceOf(Error)
    if (stored instanceof Error || stored === null) throw stored ?? new Error('missing')
    expect(stored.expiresAt).toBe(6 * MINUTE + config.sessionTtlSlidingMs)
  })

  it('caps the slid expiresAt at absoluteExpiresAt', async () => {
    const ops = makeOps()
    const clock = makeClock(0)
    const config = makeConfig({
      sessionTtlSlidingMs: 20 * MINUTE,
      sessionTtlAbsoluteMs: 25 * MINUTE,
    })
    await storeDevice(ops, makeDevice())
    const issued = await issueSession(ops, config, clock.now, {
      accountId: 'acc-1',
      credentialId: 'cred-1',
    })

    // Past the 5-min throttle, still under both expiresAt (20min) and absoluteExpiresAt (25min).
    clock.set(6 * MINUTE)
    const result = await verifySession(ops, config, clock.now, issued.sessionId)

    expect(result).not.toBeInstanceOf(Error)
    if (result instanceof Error) throw result
    expect(result.refreshed).toBe(true)
    // Without capping this would be 26min (6+20), which exceeds the 25min absolute cap.
    expect(result.record.expiresAt).toBe(25 * MINUTE)
  })

  it('does not write again on a second verify within 5 minutes of the refreshed lastSeenAt', async () => {
    const ops = makeOps()
    const clock = makeClock(0)
    const config = makeConfig()
    await storeDevice(ops, makeDevice())
    const issued = await issueSession(ops, config, clock.now, {
      accountId: 'acc-1',
      credentialId: 'cred-1',
    })

    const setSpy = vi.spyOn(ops, 'set')

    clock.set(6 * MINUTE)
    const first = await verifySession(ops, config, clock.now, issued.sessionId)
    expect(first).not.toBeInstanceOf(Error)
    if (first instanceof Error) throw first
    expect(first.refreshed).toBe(true)
    expect(setSpy).toHaveBeenCalledTimes(1)

    clock.set(7 * MINUTE)
    const second = await verifySession(ops, config, clock.now, issued.sessionId)
    expect(second).not.toBeInstanceOf(Error)
    if (second instanceof Error) throw second
    expect(second.refreshed).toBe(false)
    expect(setSpy).toHaveBeenCalledTimes(1)
  })

  it('returns SessionMissingError for an unknown session id', async () => {
    const ops = makeOps()
    const clock = makeClock(0)
    const config = makeConfig()

    const result = await verifySession(ops, config, clock.now, 'missing')

    expect(result).toBeInstanceOf(SessionMissingError)
  })

  it('returns SessionMissingError and deletes the key once past the absolute cap', async () => {
    const ops = makeOps()
    const clock = makeClock(0)
    const config = makeConfig()
    await storeDevice(ops, makeDevice())
    const issued = await issueSession(ops, config, clock.now, {
      accountId: 'acc-1',
      credentialId: 'cred-1',
    })

    clock.set(61 * MINUTE)
    const result = await verifySession(ops, config, clock.now, issued.sessionId)

    expect(result).toBeInstanceOf(SessionMissingError)
    const stored = await ops.get(sessionKey(issued.sessionId))
    expect(stored).toBeNull()
  })

  it('returns DeviceNotFoundError when the backing device no longer exists', async () => {
    const ops = makeOps()
    const clock = makeClock(0)
    const config = makeConfig()
    const issued = await issueSession(ops, config, clock.now, {
      accountId: 'acc-1',
      credentialId: 'missing-cred',
    })

    const result = await verifySession(ops, config, clock.now, issued.sessionId)

    expect(result).toBeInstanceOf(DeviceNotFoundError)
  })

  it('returns DeviceDisabledError when the backing device is disabled', async () => {
    const ops = makeOps()
    const clock = makeClock(0)
    const config = makeConfig()
    await storeDevice(ops, makeDevice({ disabled: true }))
    const issued = await issueSession(ops, config, clock.now, {
      accountId: 'acc-1',
      credentialId: 'cred-1',
    })

    const result = await verifySession(ops, config, clock.now, issued.sessionId)

    expect(result).toBeInstanceOf(DeviceDisabledError)
  })

  it('returns DeviceDisabledError when the backing device is only pending', async () => {
    const ops = makeOps()
    const clock = makeClock(0)
    const config = makeConfig()
    await storeDevice(ops, makeDevice({ status: 'pending' }))
    const issued = await issueSession(ops, config, clock.now, {
      accountId: 'acc-1',
      credentialId: 'cred-1',
    })

    const result = await verifySession(ops, config, clock.now, issued.sessionId)

    expect(result).toBeInstanceOf(DeviceDisabledError)
  })
})

describe('revokeSession', () => {
  it('deletes the session key', async () => {
    const ops = makeOps()
    const clock = makeClock(0)
    const config = makeConfig()
    await storeDevice(ops, makeDevice())
    const issued = await issueSession(ops, config, clock.now, {
      accountId: 'acc-1',
      credentialId: 'cred-1',
    })

    await revokeSession(ops, issued.sessionId)

    const stored = await ops.get(sessionKey(issued.sessionId))
    expect(stored).toBeNull()
  })

  it('a concurrent refresh does not resurrect a session revoked at the same time', async () => {
    const ops = makeOps()
    const clock = makeClock(0)
    const config = makeConfig()
    await storeDevice(ops, makeDevice())
    const issued = await issueSession(ops, config, clock.now, {
      accountId: 'acc-1',
      credentialId: 'cred-1',
    })

    // Past the refresh throttle window, so verifySession will attempt to slide expiresAt.
    clock.set(6 * MINUTE)

    const [verifyResult] = await Promise.all([
      verifySession(ops, config, clock.now, issued.sessionId),
      revokeSession(ops, issued.sessionId),
    ])

    // Whichever order the lock serializes the two operations in, the session must
    // end up deleted -- never resurrected by the refresh write.
    void verifyResult
    const stored = await ops.get(sessionKey(issued.sessionId))
    expect(stored).toBeNull()
  })
})

describe('revokeAllSessionsForDevice', () => {
  it('deletes only sessions belonging to the matching device', async () => {
    const ops = makeOps()
    const clock = makeClock(0)
    const config = makeConfig()
    await storeDevice(ops, makeDevice({ credentialId: 'cred-1' }))
    await storeDevice(ops, makeDevice({ credentialId: 'cred-2' }))
    const sessionA = await issueSession(ops, config, clock.now, {
      accountId: 'acc-1',
      credentialId: 'cred-1',
    })
    const sessionB = await issueSession(ops, config, clock.now, {
      accountId: 'acc-1',
      credentialId: 'cred-1',
    })
    const sessionC = await issueSession(ops, config, clock.now, {
      accountId: 'acc-1',
      credentialId: 'cred-2',
    })

    await revokeAllSessionsForDevice(ops, 'cred-1')

    expect(await ops.get(sessionKey(sessionA.sessionId))).toBeNull()
    expect(await ops.get(sessionKey(sessionB.sessionId))).toBeNull()
    expect(await ops.get(sessionKey(sessionC.sessionId))).not.toBeNull()
  })

  it('a concurrent refresh does not resurrect a session deleted by a device-wide cascade', async () => {
    const ops = makeOps()
    const clock = makeClock(0)
    const config = makeConfig()
    await storeDevice(ops, makeDevice({ credentialId: 'cred-1' }))
    const issued = await issueSession(ops, config, clock.now, {
      accountId: 'acc-1',
      credentialId: 'cred-1',
    })

    // Past the refresh throttle window, so verifySession will attempt to slide expiresAt.
    clock.set(6 * MINUTE)

    const [verifyResult] = await Promise.all([
      verifySession(ops, config, clock.now, issued.sessionId),
      revokeAllSessionsForDevice(ops, 'cred-1'),
    ])

    // Whichever order the lock serializes the two operations in, the session must
    // end up deleted -- never resurrected by the refresh write.
    void verifyResult
    const stored = await ops.get(sessionKey(issued.sessionId))
    expect(stored).toBeNull()
  })
})

describe('revokeDevice session cascade', () => {
  it('deletes all sessions for a revoked device', async () => {
    const ops = makeOps()
    const clock = makeClock(0)
    const config = makeConfig()
    const account = await createAccount(ops, clock.now, { name: 'Household', inviteId: 'inv-1' })
    await storeDevice(ops, makeDevice({ credentialId: 'cred-1', accountId: account.id }))
    await addDeviceToAccount(ops, account.id, 'cred-1', { countsAgainstLimit: true })
    const session = await issueSession(ops, config, clock.now, {
      accountId: account.id,
      credentialId: 'cred-1',
    })

    await revokeDevice(ops, 'cred-1')

    const stored = await ops.get(sessionKey(session.sessionId))
    expect(stored).toBeNull()
  })
})
