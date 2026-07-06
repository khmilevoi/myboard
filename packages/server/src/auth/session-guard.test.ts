import type { IncomingMessage } from 'node:http'
import { Readable } from 'node:stream'

import { describe, expect, it } from 'vitest'

import { createMemoryOps, createMemoryPubSub } from '../test/memory-ops'
import { createAccount } from './accounts'
import type { AuthConfig } from './config'
import { storeDevice } from './devices'
import type { AuthDeps } from './handlers'
import { isAuthResult, requireSession } from './session-guard'
import { issueSession } from './sessions'

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

function fakeReq(headers: Record<string, string> = {}): IncomingMessage {
  const req = Readable.from([]) as unknown as IncomingMessage
  req.headers = headers as IncomingMessage['headers']
  req.socket = { remoteAddress: '127.0.0.1' } as IncomingMessage['socket']
  return req
}

describe('requireSession', () => {
  it('returns a 401 AuthResult when no session cookie is present', async () => {
    const ops = makeOps()
    const clock = makeClock(0)
    const config = makeConfig()
    const deps: AuthDeps = { ops, config, now: clock.now }

    const result = await requireSession(deps, fakeReq())

    expect(isAuthResult(result)).toBe(true)
    if (!isAuthResult(result)) throw new Error('expected AuthResult')
    expect(result.status).toBe(401)
  })

  it('returns the SessionRecord for a valid session cookie', async () => {
    const ops = makeOps()
    const clock = makeClock(0)
    const config = makeConfig()
    const account = await createAccount(ops, clock.now, { name: 'Acc', inviteId: 'inv-1' })
    await storeDevice(ops, {
      credentialId: 'cred-1',
      publicKey: 'pk',
      signCount: 0,
      label: 'Board device',
      createdAt: 0,
      lastSeenAt: 0,
      disabled: false,
      accountId: account.id,
      status: 'active',
      addedVia: 'invite',
    })
    const session = await issueSession(ops, config, clock.now, {
      accountId: account.id,
      credentialId: 'cred-1',
    })

    const deps: AuthDeps = { ops, config, now: clock.now }
    const result = await requireSession(
      deps,
      fakeReq({ cookie: `mb_session=${session.sessionId}` }),
    )

    expect(isAuthResult(result)).toBe(false)
    if (isAuthResult(result)) throw new Error('expected SessionRecord')
    expect(result.accountId).toBe(account.id)
    expect(result.sessionId).toBe(session.sessionId)
  })
})
