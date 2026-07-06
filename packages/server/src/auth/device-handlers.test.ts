import type { IncomingMessage } from 'node:http'
import { Readable } from 'node:stream'

import { beforeEach, describe, expect, it, vi } from 'vitest'

import { createMemoryOps, createMemoryPubSub } from '../test/memory-ops'
import { addDeviceToAccount, createAccount } from './accounts'
import type { AuthConfig } from './config'
import { getDevice, storeDevice } from './devices'
import type { AuthDeps } from './handlers'
import { issueSession } from './sessions'

vi.mock('./webauthn', () => ({
  buildAuthenticationOptions: vi.fn(),
  verifyAuthentication: vi.fn(),
}))

import { postAddToken, postAddTokenOptions } from './device-handlers'
import { buildAuthenticationOptions, verifyAuthentication } from './webauthn'

const MINUTE = 60_000
const ADD_TOKEN_TTL_MS = 5 * MINUTE

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

function fakeReq(body: unknown, headers: Record<string, string> = {}): IncomingMessage {
  const chunks = body === undefined ? [] : [Buffer.from(JSON.stringify(body))]
  const req = Readable.from(chunks) as unknown as IncomingMessage
  req.headers = headers as IncomingMessage['headers']
  req.socket = { remoteAddress: '127.0.0.1' } as IncomingMessage['socket']
  return req
}

function cookieHeaderFor(setCookie: string): string {
  return setCookie.split('; ')[0]
}

function getSetCookies(headers: Record<string, string | string[]> | undefined): string[] {
  const raw = headers?.['Set-Cookie']
  if (!raw) return []
  return Array.isArray(raw) ? raw : [raw]
}

type Ops = ReturnType<typeof makeOps>

async function seedAccountWithDevice(
  ops: Ops,
  now: () => number,
  credentialId: string,
  overrides: { status?: 'active' | 'pending'; disabled?: boolean } = {},
) {
  const account = await createAccount(ops, now, { name: 'Acc', inviteId: 'inv-1' })
  await storeDevice(ops, {
    credentialId,
    publicKey: 'pk',
    signCount: 5,
    label: 'Board device',
    createdAt: 0,
    lastSeenAt: 0,
    disabled: overrides.disabled ?? false,
    accountId: account.id,
    status: overrides.status ?? 'active',
    addedVia: 'invite',
  })
  await addDeviceToAccount(ops, account.id, credentialId, { countsAgainstLimit: false })
  return account
}

describe('postAddTokenOptions', () => {
  beforeEach(() => {
    vi.mocked(buildAuthenticationOptions).mockReset()
  })

  it('returns 401 without a session', async () => {
    const ops = makeOps()
    const clock = makeClock(0)
    const config = makeConfig()
    const deps: AuthDeps = { ops, config, now: clock.now }

    const result = await postAddTokenOptions(deps, fakeReq(undefined))

    expect(result.status).toBe(401)
  })

  it('returns options listing only the account active devices, with a challenge cookie', async () => {
    const ops = makeOps()
    const clock = makeClock(0)
    const config = makeConfig()
    const account = await seedAccountWithDevice(ops, clock.now, 'cred-active')
    // A pending device on the same account must not appear in allowCredentials.
    await storeDevice(ops, {
      credentialId: 'cred-pending',
      publicKey: 'pk',
      signCount: 0,
      label: 'Board device',
      createdAt: 0,
      lastSeenAt: 0,
      disabled: false,
      accountId: account.id,
      status: 'pending',
      addedVia: 'add-token',
    })
    await addDeviceToAccount(ops, account.id, 'cred-pending', { countsAgainstLimit: false })

    const session = await issueSession(ops, config, clock.now, {
      accountId: account.id,
      credentialId: 'cred-active',
    })

    vi.mocked(buildAuthenticationOptions).mockResolvedValue({
      challenge: 'add-token-challenge',
    } as never)

    const deps: AuthDeps = { ops, config, now: clock.now }
    const result = await postAddTokenOptions(
      deps,
      fakeReq(undefined, { cookie: `mb_session=${session.sessionId}` }),
    )

    expect(result.status).toBe(200)
    expect(buildAuthenticationOptions).toHaveBeenCalledWith(config, {
      allowCredentials: [{ id: 'cred-active' }],
    })
    const body = result.body as { options: unknown }
    expect(body.options).toEqual({ challenge: 'add-token-challenge' })

    const cookies = getSetCookies(result.headers)
    expect(cookies).toHaveLength(1)
    expect(cookies[0]).toContain('HttpOnly')
    expect(cookies[0]).toContain('SameSite=Strict')
  })
})

describe('postAddToken', () => {
  beforeEach(() => {
    vi.mocked(buildAuthenticationOptions).mockReset()
    vi.mocked(verifyAuthentication).mockReset()
  })

  async function beginAddToken(deps: AuthDeps, sessionCookieHeader: string) {
    vi.mocked(buildAuthenticationOptions).mockResolvedValue({
      challenge: 'add-token-challenge',
    } as never)
    const optionsResult = await postAddTokenOptions(
      deps,
      fakeReq(undefined, { cookie: sessionCookieHeader }),
    )
    const cookie = getSetCookies(optionsResult.headers)[0]
    return cookieHeaderFor(cookie)
  }

  it('returns 401 without a session', async () => {
    const ops = makeOps()
    const clock = makeClock(0)
    const config = makeConfig()
    const deps: AuthDeps = { ops, config, now: clock.now }

    const result = await postAddToken(deps, fakeReq({ authenticationResponse: { id: 'x' } }))

    expect(result.status).toBe(401)
  })

  it('mints an add-token after a fresh-UV assertion and returns a url + clears the challenge cookie', async () => {
    const ops = makeOps()
    const clock = makeClock(0)
    const config = makeConfig()
    const account = await seedAccountWithDevice(ops, clock.now, 'cred-active')
    const session = await issueSession(ops, config, clock.now, {
      accountId: account.id,
      credentialId: 'cred-active',
    })
    const sessionCookieHeader = `mb_session=${session.sessionId}`

    const deps: AuthDeps = { ops, config, now: clock.now }
    const challengeCookieHeader = await beginAddToken(deps, sessionCookieHeader)

    vi.mocked(verifyAuthentication).mockResolvedValue({ newSignCount: 6 })

    const req = fakeReq(
      { authenticationResponse: { id: 'cred-active' } },
      { cookie: `${sessionCookieHeader}; ${challengeCookieHeader}` },
    )

    const result = await postAddToken(deps, req)

    expect(result.status).toBe(200)
    const body = result.body as {
      code: string
      formatted: string
      url: string
      expiresAt: number
    }
    expect(body.code).toEqual(expect.any(String))
    expect(body.formatted).toContain('-')
    expect(body.url).toContain('/add-device?token=')
    expect(body.url).toContain(body.code)
    expect(body.expiresAt).toBe(clock.now() + ADD_TOKEN_TTL_MS)

    const cookies = getSetCookies(result.headers)
    expect(cookies[0]).toContain(`${config.challengeCookieName}=`)
    expect(cookies[0]).toContain('Max-Age=0')

    const device = await getDevice(ops, 'cred-active')
    if (device instanceof Error) throw device
    expect(device.signCount).toBe(6)
  })

  it('rejects an assertion for a device belonging to a different account', async () => {
    const ops = makeOps()
    const clock = makeClock(0)
    const config = makeConfig()
    const account = await seedAccountWithDevice(ops, clock.now, 'cred-owner')
    // A device that exists but belongs to a different account than the session.
    await seedAccountWithDevice(ops, clock.now, 'cred-other')

    const session = await issueSession(ops, config, clock.now, {
      accountId: account.id,
      credentialId: 'cred-owner',
    })
    const sessionCookieHeader = `mb_session=${session.sessionId}`

    const deps: AuthDeps = { ops, config, now: clock.now }
    const challengeCookieHeader = await beginAddToken(deps, sessionCookieHeader)

    const req = fakeReq(
      { authenticationResponse: { id: 'cred-other' } },
      { cookie: `${sessionCookieHeader}; ${challengeCookieHeader}` },
    )

    const result = await postAddToken(deps, req)

    expect(result.status).toBe(403)
    expect(result.body).toEqual({ code: 'not_authorized' })
    expect(verifyAuthentication).not.toHaveBeenCalled()
  })

  it('rejects an assertion for a disabled/non-active device on the same account', async () => {
    const ops = makeOps()
    const clock = makeClock(0)
    const config = makeConfig()
    const account = await seedAccountWithDevice(ops, clock.now, 'cred-active')
    await storeDevice(ops, {
      credentialId: 'cred-pending',
      publicKey: 'pk',
      signCount: 0,
      label: 'Board device',
      createdAt: 0,
      lastSeenAt: 0,
      disabled: false,
      accountId: account.id,
      status: 'pending',
      addedVia: 'add-token',
    })
    await addDeviceToAccount(ops, account.id, 'cred-pending', { countsAgainstLimit: false })

    const session = await issueSession(ops, config, clock.now, {
      accountId: account.id,
      credentialId: 'cred-active',
    })
    const sessionCookieHeader = `mb_session=${session.sessionId}`

    const deps: AuthDeps = { ops, config, now: clock.now }
    const challengeCookieHeader = await beginAddToken(deps, sessionCookieHeader)

    const req = fakeReq(
      { authenticationResponse: { id: 'cred-pending' } },
      { cookie: `${sessionCookieHeader}; ${challengeCookieHeader}` },
    )

    const result = await postAddToken(deps, req)

    expect(result.status).toBe(403)
    expect(result.body).toEqual({ code: 'device_disabled' })
    expect(verifyAuthentication).not.toHaveBeenCalled()
  })
})
