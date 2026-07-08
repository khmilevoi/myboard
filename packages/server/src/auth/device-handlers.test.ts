import type { IncomingMessage } from 'node:http'
import { Readable } from 'node:stream'

import { beforeEach, describe, expect, it, vi } from 'vitest'

import { createMemoryOps, createMemoryPubSub } from '../test/memory-ops'
import { addDeviceToAccount, createAccount, listAccountDeviceIds } from './accounts'
import { lookupAddToken, mintAddToken } from './add-tokens'
import type { AuthConfig } from './config'
import { getDevice, storeDevice } from './devices'
import { AddTokenInvalidError, WebAuthnVerificationError } from './errors'
import type { AuthDeps } from './handlers'
import { issuePendingTicket } from './pending-tickets'
import { AddTokenRecordSchema, addTokenKey, getJson } from './records'
import { issueSession, verifySession } from './sessions'
import { sha256hex } from './tokens'

vi.mock('./webauthn', () => ({
  buildAuthenticationOptions: vi.fn(),
  verifyAuthentication: vi.fn(),
  buildRegistrationOptions: vi.fn(),
  verifyRegistration: vi.fn(),
}))

import {
  getAccountInfo,
  getDevices,
  getPendingStatus,
  postAddToken,
  postAddTokenOptions,
  postApproveDevice,
  postDenyDevice,
  postDeviceRegisterOptions,
  postDeviceRegisterVerify,
  postRevokeDevice,
} from './device-handlers'
import {
  buildAuthenticationOptions,
  buildRegistrationOptions,
  verifyAuthentication,
  verifyRegistration,
} from './webauthn'

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

async function readAddTokenFailedAttempts(ops: Ops, code: string): Promise<number> {
  const record = await getJson(ops, addTokenKey(sha256hex(code)), AddTokenRecordSchema)
  if (record instanceof Error || record === null) throw new Error('add-token record missing')
  return record.failedAttempts
}

async function seedPendingDevice(
  ops: Ops,
  accountId: string,
  credentialId: string,
  overrides: { label?: string } = {},
) {
  await storeDevice(ops, {
    credentialId,
    publicKey: 'pk',
    signCount: 0,
    label: overrides.label ?? 'New phone',
    createdAt: 0,
    lastSeenAt: 0,
    disabled: false,
    accountId,
    status: 'pending',
    addedVia: 'add-token',
  })
  await addDeviceToAccount(ops, accountId, credentialId, { countsAgainstLimit: false })
}

describe('postAddTokenOptions', () => {
  beforeEach(() => {
    vi.mocked(buildAuthenticationOptions).mockReset()
  })

  it('returns 401 without a session', async () => {
    const ops = makeOps()
    const clock = makeClock(0)
    const config = makeConfig()
    const deps: AuthDeps = { ops, config, now: clock.now, audit: vi.fn() }

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

    const deps: AuthDeps = { ops, config, now: clock.now, audit: vi.fn() }
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
    const deps: AuthDeps = { ops, config, now: clock.now, audit: vi.fn() }

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

    const deps: AuthDeps = { ops, config, now: clock.now, audit: vi.fn() }
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

    const deps: AuthDeps = { ops, config, now: clock.now, audit: vi.fn() }
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

    const deps: AuthDeps = { ops, config, now: clock.now, audit: vi.fn() }
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

describe('postDeviceRegisterOptions', () => {
  beforeEach(() => {
    vi.mocked(buildRegistrationOptions).mockReset()
  })

  it('returns add_token_invalid for an unknown code', async () => {
    const ops = makeOps()
    const clock = makeClock(0)
    const config = makeConfig()
    const deps: AuthDeps = { ops, config, now: clock.now, audit: vi.fn() }

    const result = await postDeviceRegisterOptions(deps, fakeReq({ token: 'NOPE1234' }))

    expect(result).toEqual({ status: 400, body: { code: 'add_token_invalid' } })
    expect(buildRegistrationOptions).not.toHaveBeenCalled()
  })

  it('returns add_token_invalid for an expired code', async () => {
    const ops = makeOps()
    const clock = makeClock(0)
    const config = makeConfig()
    const account = await createAccount(ops, clock.now, { name: 'Acc', inviteId: 'inv-1' })
    const { code } = await mintAddToken(ops, clock.now, { accountId: account.id, ttlMs: 1000 })
    clock.set(2000)

    const deps: AuthDeps = { ops, config, now: clock.now, audit: vi.fn() }
    const result = await postDeviceRegisterOptions(deps, fakeReq({ token: code }))

    expect(result).toEqual({ status: 400, body: { code: 'add_token_invalid' } })
  })

  it('returns options excluding the account existing devices, named from the account, with a challenge cookie', async () => {
    const ops = makeOps()
    const clock = makeClock(0)
    const config = makeConfig()
    const account = await seedAccountWithDevice(ops, clock.now, 'cred-active')
    const { code } = await mintAddToken(ops, clock.now, { accountId: account.id, ttlMs: 60_000 })

    vi.mocked(buildRegistrationOptions).mockResolvedValue({
      challenge: 'add-device-challenge',
    } as never)

    const deps: AuthDeps = { ops, config, now: clock.now, audit: vi.fn() }
    const result = await postDeviceRegisterOptions(deps, fakeReq({ token: code }))

    expect(result.status).toBe(200)
    expect(buildRegistrationOptions).toHaveBeenCalledWith(
      config,
      expect.objectContaining({
        userName: 'Acc',
        userDisplayName: 'Acc',
        excludeCredentials: [{ id: 'cred-active' }],
      }),
    )
    const body = result.body as { options: unknown }
    expect(body.options).toEqual({ challenge: 'add-device-challenge' })

    const cookies = getSetCookies(result.headers)
    expect(cookies).toHaveLength(1)
    expect(cookies[0]).toContain('HttpOnly')
    expect(cookies[0]).toContain('SameSite=Strict')
  })
})

describe('postDeviceRegisterVerify', () => {
  beforeEach(() => {
    vi.mocked(buildRegistrationOptions).mockReset()
    vi.mocked(verifyRegistration).mockReset()
  })

  async function beginDeviceRegister(deps: AuthDeps, token: string) {
    vi.mocked(buildRegistrationOptions).mockResolvedValue({
      challenge: 'add-device-challenge',
    } as never)
    const optionsResult = await postDeviceRegisterOptions(deps, fakeReq({ token }))
    const cookie = getSetCookies(optionsResult.headers)[0]
    return cookieHeaderFor(cookie)
  }

  it('happy path: creates a pending device, spends the add-token, sets a pending cookie, and publishes device-pending', async () => {
    const pubsub = createMemoryPubSub()
    const ops = createMemoryOps(pubsub)
    const clock = makeClock(0)
    const config = makeConfig()
    const account = await createAccount(ops, clock.now, { name: 'Acc', inviteId: 'inv-1' })
    const { code } = await mintAddToken(ops, clock.now, { accountId: account.id, ttlMs: 60_000 })

    const received: Array<{ key: string; value: unknown }> = []
    pubsub.subscribe('storage:events', (message) => received.push(JSON.parse(message)))

    const deps: AuthDeps = { ops, config, now: clock.now, audit: vi.fn() }
    const challengeCookie = await beginDeviceRegister(deps, code)

    vi.mocked(verifyRegistration).mockResolvedValue({
      credentialId: 'cred-new',
      publicKey: 'pk-new',
      signCount: 0,
    })

    const req = fakeReq(
      { token: code, attestationResponse: { id: 'cred-new' } },
      {
        cookie: challengeCookie,
        'user-agent': 'Mozilla/5.0 (Windows NT 10.0) Chrome/120.0 Safari/537.36',
      },
    )

    const result = await postDeviceRegisterVerify(deps, req)

    expect(result.status).toBe(200)
    expect(result.body).toEqual({ credentialId: 'cred-new' })

    const cookies = getSetCookies(result.headers)
    const pendingCookie = cookies.find((c) => c.startsWith(`${config.pendingCookieName}=`))
    expect(pendingCookie).toBeDefined()
    expect(pendingCookie).toContain('HttpOnly')
    expect(pendingCookie).toContain('SameSite=Strict')

    const clearedChal = cookies.find((c) => c.startsWith(`${config.challengeCookieName}=`))
    expect(clearedChal).toContain('Max-Age=0')

    const device = await getDevice(ops, 'cred-new')
    if (device instanceof Error) throw device
    expect(device.status).toBe('pending')
    expect(device.addedVia).toBe('add-token')
    expect(device.accountId).toBe(account.id)
    expect(device.label).toBe('Chrome on Windows')

    const deviceIds = await listAccountDeviceIds(ops, account.id)
    expect(deviceIds).toContain('cred-new')

    const spent = await lookupAddToken(ops, clock.now, code)
    expect(spent).toBeInstanceOf(AddTokenInvalidError)

    expect(received).toHaveLength(1)
    expect(received[0]).toEqual({
      key: `auth:account:${account.id}`,
      value: { type: 'device-pending', credentialId: 'cred-new', label: 'Chrome on Windows' },
    })
  })

  it('rejects with challenge_invalid and records an add-token failure when the challenge is missing', async () => {
    const ops = makeOps()
    const clock = makeClock(0)
    const config = makeConfig()
    const account = await createAccount(ops, clock.now, { name: 'Acc', inviteId: 'inv-1' })
    const { code } = await mintAddToken(ops, clock.now, { accountId: account.id, ttlMs: 60_000 })

    const deps: AuthDeps = { ops, config, now: clock.now, audit: vi.fn() }
    const req = fakeReq({ token: code, attestationResponse: { id: 'cred-x' } })

    const result = await postDeviceRegisterVerify(deps, req)

    expect(result).toEqual({ status: 400, body: { code: 'challenge_invalid' } })
    expect(await readAddTokenFailedAttempts(ops, code)).toBe(1)
  })

  it('rejects and records an add-token failure when verifyRegistration fails', async () => {
    const ops = makeOps()
    const clock = makeClock(0)
    const config = makeConfig()
    const account = await createAccount(ops, clock.now, { name: 'Acc', inviteId: 'inv-1' })
    const { code } = await mintAddToken(ops, clock.now, { accountId: account.id, ttlMs: 60_000 })

    const deps: AuthDeps = { ops, config, now: clock.now, audit: vi.fn() }
    const challengeCookie = await beginDeviceRegister(deps, code)

    vi.mocked(verifyRegistration).mockResolvedValue(new WebAuthnVerificationError())

    const req = fakeReq(
      { token: code, attestationResponse: { id: 'cred-fail' } },
      { cookie: challengeCookie },
    )

    const result = await postDeviceRegisterVerify(deps, req)

    expect(result.status).toBe(400)
    expect(result.body).toEqual({ code: 'webauthn_verification_failed' })
    expect(await readAddTokenFailedAttempts(ops, code)).toBe(1)

    const device = await getDevice(ops, 'cred-fail')
    expect(device).toBeInstanceOf(Error)
  })

  it('rejects with add_token_invalid (and records a failure) when the submitted add-token belongs to a different account than the challenge', async () => {
    const ops = makeOps()
    const clock = makeClock(0)
    const config = makeConfig()
    const accountA = await createAccount(ops, clock.now, { name: 'A', inviteId: 'inv-a' })
    const accountB = await createAccount(ops, clock.now, { name: 'B', inviteId: 'inv-b' })
    const tokenA = await mintAddToken(ops, clock.now, { accountId: accountA.id, ttlMs: 60_000 })
    const tokenB = await mintAddToken(ops, clock.now, { accountId: accountB.id, ttlMs: 60_000 })

    const deps: AuthDeps = { ops, config, now: clock.now, audit: vi.fn() }
    // Challenge is bound to account A (the options step used token A)...
    const challengeCookie = await beginDeviceRegister(deps, tokenA.code)

    vi.mocked(verifyRegistration).mockResolvedValue({
      credentialId: 'cred-swap',
      publicKey: 'pk',
      signCount: 0,
    })

    // ...but the verify body swaps in token B, from a different account.
    const req = fakeReq(
      { token: tokenB.code, attestationResponse: { id: 'cred-swap' } },
      { cookie: challengeCookie },
    )

    const result = await postDeviceRegisterVerify(deps, req)

    expect(result).toEqual({ status: 400, body: { code: 'add_token_invalid' } })
    expect(await readAddTokenFailedAttempts(ops, tokenB.code)).toBe(1)

    const device = await getDevice(ops, 'cred-swap')
    expect(device).toBeInstanceOf(Error)
  })

  it('rejects a null attestationResponse with 422 and does not consume the challenge', async () => {
    const ops = makeOps()
    const clock = makeClock(0)
    const config = makeConfig()
    const account = await createAccount(ops, clock.now, { name: 'Acc', inviteId: 'inv-1' })
    const { code } = await mintAddToken(ops, clock.now, { accountId: account.id, ttlMs: 60_000 })

    const deps: AuthDeps = { ops, config, now: clock.now, audit: vi.fn() }
    const challengeCookie = await beginDeviceRegister(deps, code)

    const req = fakeReq({ token: code, attestationResponse: null }, { cookie: challengeCookie })

    const result = await postDeviceRegisterVerify(deps, req)

    expect(result.status).toBe(422)
    expect(verifyRegistration).not.toHaveBeenCalled()
  })

  it('under a concurrent race with the same still-live code, creates exactly one device and cleanly rejects the loser', async () => {
    const ops = makeOps()
    const clock = makeClock(0)
    const config = makeConfig()
    const account = await createAccount(ops, clock.now, { name: 'Acc', inviteId: 'inv-1' })
    const { code } = await mintAddToken(ops, clock.now, { accountId: account.id, ttlMs: 60_000 })

    const deps: AuthDeps = { ops, config, now: clock.now, audit: vi.fn() }
    // Each concurrent request completed its own separate register/options ->
    // challenge -> ceremony ahead of time, so each carries its own challenge
    // cookie while sharing the same still-live add-device code.
    const challengeCookieA = await beginDeviceRegister(deps, code)
    const challengeCookieB = await beginDeviceRegister(deps, code)

    vi.mocked(verifyRegistration).mockImplementation(async (_config, params) => {
      const id = (params.response as unknown as { id: string }).id
      return { credentialId: id, publicKey: `pk-${id}`, signCount: 0 }
    })

    const reqA = fakeReq(
      { token: code, attestationResponse: { id: 'cred-race-a' } },
      { cookie: challengeCookieA },
    )
    const reqB = fakeReq(
      { token: code, attestationResponse: { id: 'cred-race-b' } },
      { cookie: challengeCookieB },
    )

    const [resultA, resultB] = await Promise.all([
      postDeviceRegisterVerify(deps, reqA),
      postDeviceRegisterVerify(deps, reqB),
    ])

    const results = [resultA, resultB]
    const successes = results.filter((r) => r.status === 200)
    const failures = results.filter((r) => r.status !== 200)

    expect(successes).toHaveLength(1)
    expect(failures).toHaveLength(1)
    expect(failures[0]).toEqual({ status: 400, body: { code: 'add_token_invalid' } })

    const deviceIds = await listAccountDeviceIds(ops, account.id)
    expect(deviceIds).toHaveLength(1)

    const winnerCredentialId = (successes[0].body as { credentialId: string }).credentialId
    const loserCredentialId = winnerCredentialId === 'cred-race-a' ? 'cred-race-b' : 'cred-race-a'

    const winnerDevice = await getDevice(ops, winnerCredentialId)
    expect(winnerDevice).not.toBeInstanceOf(Error)

    const loserDevice = await getDevice(ops, loserCredentialId)
    expect(loserDevice).toBeInstanceOf(Error)
  })
})

describe('getAccountInfo', () => {
  it('returns 401 without a session', async () => {
    const ops = makeOps()
    const clock = makeClock(0)
    const config = makeConfig()
    const deps: AuthDeps = { ops, config, now: clock.now, audit: vi.fn() }

    const result = await getAccountInfo(deps, fakeReq(undefined))

    expect(result.status).toBe(401)
  })

  it('returns id/name/deviceLimit for the session account', async () => {
    const ops = makeOps()
    const clock = makeClock(0)
    const config = makeConfig()
    const account = await seedAccountWithDevice(ops, clock.now, 'cred-active')
    const session = await issueSession(ops, config, clock.now, {
      accountId: account.id,
      credentialId: 'cred-active',
    })
    const deps: AuthDeps = { ops, config, now: clock.now, audit: vi.fn() }

    const result = await getAccountInfo(
      deps,
      fakeReq(undefined, { cookie: `mb_session=${session.sessionId}` }),
    )

    expect(result.status).toBe(200)
    expect(result.body).toEqual({ id: account.id, name: 'Acc', deviceLimit: account.deviceLimit })
  })
})

describe('getDevices', () => {
  it('returns 401 without a session', async () => {
    const ops = makeOps()
    const clock = makeClock(0)
    const config = makeConfig()
    const deps: AuthDeps = { ops, config, now: clock.now, audit: vi.fn() }

    const result = await getDevices(deps, fakeReq(undefined))

    expect(result.status).toBe(401)
  })

  it('returns device DTOs without publicKey, plus thisCredentialId', async () => {
    const ops = makeOps()
    const clock = makeClock(0)
    const config = makeConfig()
    const account = await seedAccountWithDevice(ops, clock.now, 'cred-active')
    await seedPendingDevice(ops, account.id, 'cred-pending')
    const session = await issueSession(ops, config, clock.now, {
      accountId: account.id,
      credentialId: 'cred-active',
    })
    const deps: AuthDeps = { ops, config, now: clock.now, audit: vi.fn() }

    const result = await getDevices(
      deps,
      fakeReq(undefined, { cookie: `mb_session=${session.sessionId}` }),
    )

    expect(result.status).toBe(200)
    const body = result.body as {
      devices: Array<Record<string, unknown>>
      thisCredentialId: string
    }
    expect(body.thisCredentialId).toBe('cred-active')
    expect(body.devices).toHaveLength(2)
    const activeDto = body.devices.find((d) => d.credentialId === 'cred-active')
    expect(activeDto).toEqual({
      credentialId: 'cred-active',
      label: 'Board device',
      status: 'active',
      addedVia: 'invite',
      createdAt: 0,
      lastSeenAt: 0,
    })
    for (const dto of body.devices) {
      expect(dto).not.toHaveProperty('publicKey')
    }
  })
})

describe('postApproveDevice', () => {
  it('returns 401 without a session', async () => {
    const ops = makeOps()
    const clock = makeClock(0)
    const config = makeConfig()
    const deps: AuthDeps = { ops, config, now: clock.now, audit: vi.fn() }

    const result = await postApproveDevice(deps, fakeReq(undefined), { credentialId: 'cred-x' })

    expect(result.status).toBe(401)
  })

  it('flips a pending device to active and publishes device-approved', async () => {
    const pubsub = createMemoryPubSub()
    const ops = createMemoryOps(pubsub)
    const clock = makeClock(0)
    const config = makeConfig()
    const account = await seedAccountWithDevice(ops, clock.now, 'cred-active')
    await seedPendingDevice(ops, account.id, 'cred-pending')
    const session = await issueSession(ops, config, clock.now, {
      accountId: account.id,
      credentialId: 'cred-active',
    })
    const deps: AuthDeps = { ops, config, now: clock.now, audit: vi.fn() }

    const received: Array<{ key: string; value: unknown }> = []
    pubsub.subscribe('storage:events', (message) => received.push(JSON.parse(message)))

    const result = await postApproveDevice(
      deps,
      fakeReq(undefined, { cookie: `mb_session=${session.sessionId}` }),
      { credentialId: 'cred-pending' },
    )

    expect(result.status).toBe(200)
    expect(result.body).toEqual({ ok: true })

    const device = await getDevice(ops, 'cred-pending')
    if (device instanceof Error) throw device
    expect(device.status).toBe('active')

    expect(received).toHaveLength(1)
    expect(received[0]).toEqual({
      key: `auth:account:${account.id}`,
      value: { type: 'device-approved', credentialId: 'cred-pending', label: 'New phone' },
    })

    expect(deps.audit).toHaveBeenCalledWith(
      expect.objectContaining({ event: 'device_approved', credentialId: 'cred-pending' }),
    )
  })

  it('rejects with device_limit when approving would exceed the account device limit', async () => {
    const ops = makeOps()
    const clock = makeClock(0)
    const config = makeConfig()
    const account = await createAccount(ops, clock.now, {
      name: 'Acc',
      inviteId: 'inv-1',
      deviceLimit: 1,
    })
    await storeDevice(ops, {
      credentialId: 'cred-active',
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
    await addDeviceToAccount(ops, account.id, 'cred-active', { countsAgainstLimit: false })
    await seedPendingDevice(ops, account.id, 'cred-pending')
    const session = await issueSession(ops, config, clock.now, {
      accountId: account.id,
      credentialId: 'cred-active',
    })
    const deps: AuthDeps = { ops, config, now: clock.now, audit: vi.fn() }

    const result = await postApproveDevice(
      deps,
      fakeReq(undefined, { cookie: `mb_session=${session.sessionId}` }),
      { credentialId: 'cred-pending' },
    )

    expect(result.status).toBe(409)
    expect(result.body).toEqual({ code: 'device_limit' })

    const device = await getDevice(ops, 'cred-pending')
    if (device instanceof Error) throw device
    expect(device.status).toBe('pending')
  })

  it('rejects a device belonging to a different account with 403', async () => {
    const ops = makeOps()
    const clock = makeClock(0)
    const config = makeConfig()
    const accountA = await seedAccountWithDevice(ops, clock.now, 'cred-a')
    await seedAccountWithDevice(ops, clock.now, 'cred-b')
    const session = await issueSession(ops, config, clock.now, {
      accountId: accountA.id,
      credentialId: 'cred-a',
    })
    const deps: AuthDeps = { ops, config, now: clock.now, audit: vi.fn() }

    const result = await postApproveDevice(
      deps,
      fakeReq(undefined, { cookie: `mb_session=${session.sessionId}` }),
      { credentialId: 'cred-b' },
    )

    expect(result.status).toBe(403)
    expect(result.body).toEqual({ code: 'not_authorized' })
  })
})

describe('postDenyDevice', () => {
  it('returns 401 without a session', async () => {
    const ops = makeOps()
    const clock = makeClock(0)
    const config = makeConfig()
    const deps: AuthDeps = { ops, config, now: clock.now, audit: vi.fn() }

    const result = await postDenyDevice(deps, fakeReq(undefined), { credentialId: 'cred-x' })

    expect(result.status).toBe(401)
  })

  it('deletes the pending device and publishes device-denied', async () => {
    const pubsub = createMemoryPubSub()
    const ops = createMemoryOps(pubsub)
    const clock = makeClock(0)
    const config = makeConfig()
    const account = await seedAccountWithDevice(ops, clock.now, 'cred-active')
    await seedPendingDevice(ops, account.id, 'cred-pending')
    const session = await issueSession(ops, config, clock.now, {
      accountId: account.id,
      credentialId: 'cred-active',
    })
    const deps: AuthDeps = { ops, config, now: clock.now, audit: vi.fn() }

    const received: Array<{ key: string; value: unknown }> = []
    pubsub.subscribe('storage:events', (message) => received.push(JSON.parse(message)))

    const result = await postDenyDevice(
      deps,
      fakeReq(undefined, { cookie: `mb_session=${session.sessionId}` }),
      { credentialId: 'cred-pending' },
    )

    expect(result.status).toBe(204)

    const device = await getDevice(ops, 'cred-pending')
    expect(device).toBeInstanceOf(Error)

    const deviceIds = await listAccountDeviceIds(ops, account.id)
    expect(deviceIds).not.toContain('cred-pending')

    expect(received).toHaveLength(1)
    expect(received[0]).toEqual({
      key: `auth:account:${account.id}`,
      value: { type: 'device-denied', credentialId: 'cred-pending', label: 'New phone' },
    })
  })

  it('rejects a device belonging to a different account with 403', async () => {
    const ops = makeOps()
    const clock = makeClock(0)
    const config = makeConfig()
    const accountA = await seedAccountWithDevice(ops, clock.now, 'cred-a')
    await seedAccountWithDevice(ops, clock.now, 'cred-b')
    const session = await issueSession(ops, config, clock.now, {
      accountId: accountA.id,
      credentialId: 'cred-a',
    })
    const deps: AuthDeps = { ops, config, now: clock.now, audit: vi.fn() }

    const result = await postDenyDevice(
      deps,
      fakeReq(undefined, { cookie: `mb_session=${session.sessionId}` }),
      { credentialId: 'cred-b' },
    )

    expect(result.status).toBe(403)
    expect(result.body).toEqual({ code: 'not_authorized' })
  })
})

describe('postRevokeDevice', () => {
  it('returns 401 without a session', async () => {
    const ops = makeOps()
    const clock = makeClock(0)
    const config = makeConfig()
    const deps: AuthDeps = { ops, config, now: clock.now, audit: vi.fn() }

    const result = await postRevokeDevice(deps, fakeReq(undefined), { credentialId: 'cred-x' })

    expect(result.status).toBe(401)
  })

  it('rejects with last_active_device (409) when revoking the only active device', async () => {
    const ops = makeOps()
    const clock = makeClock(0)
    const config = makeConfig()
    const account = await seedAccountWithDevice(ops, clock.now, 'cred-active')
    const session = await issueSession(ops, config, clock.now, {
      accountId: account.id,
      credentialId: 'cred-active',
    })
    const deps: AuthDeps = { ops, config, now: clock.now, audit: vi.fn() }

    const result = await postRevokeDevice(
      deps,
      fakeReq(undefined, { cookie: `mb_session=${session.sessionId}` }),
      { credentialId: 'cred-active' },
    )

    expect(result.status).toBe(409)
    expect(result.body).toEqual({ code: 'last_active_device' })

    const device = await getDevice(ops, 'cred-active')
    expect(device).not.toBeInstanceOf(Error)
  })

  it('revokes a second active device, cascading to its sessions, and publishes device-revoked', async () => {
    const pubsub = createMemoryPubSub()
    const ops = createMemoryOps(pubsub)
    const clock = makeClock(0)
    const config = makeConfig()
    const account = await seedAccountWithDevice(ops, clock.now, 'cred-active')
    await storeDevice(ops, {
      credentialId: 'cred-second',
      publicKey: 'pk',
      signCount: 0,
      label: 'Second device',
      createdAt: 0,
      lastSeenAt: 0,
      disabled: false,
      accountId: account.id,
      status: 'active',
      addedVia: 'invite',
    })
    await addDeviceToAccount(ops, account.id, 'cred-second', { countsAgainstLimit: false })
    const session = await issueSession(ops, config, clock.now, {
      accountId: account.id,
      credentialId: 'cred-active',
    })
    const secondSession = await issueSession(ops, config, clock.now, {
      accountId: account.id,
      credentialId: 'cred-second',
    })
    const deps: AuthDeps = { ops, config, now: clock.now, audit: vi.fn() }

    const received: Array<{ key: string; value: unknown }> = []
    pubsub.subscribe('storage:events', (message) => received.push(JSON.parse(message)))

    const result = await postRevokeDevice(
      deps,
      fakeReq(undefined, { cookie: `mb_session=${session.sessionId}` }),
      { credentialId: 'cred-second' },
    )

    expect(result.status).toBe(204)

    const device = await getDevice(ops, 'cred-second')
    expect(device).toBeInstanceOf(Error)

    const deviceIds = await listAccountDeviceIds(ops, account.id)
    expect(deviceIds).not.toContain('cred-second')

    const verified = await verifySession(ops, config, clock.now, secondSession.sessionId)
    expect(verified).toBeInstanceOf(Error)

    expect(received).toHaveLength(1)
    expect(received[0]).toEqual({
      key: `auth:account:${account.id}`,
      value: { type: 'device-revoked', credentialId: 'cred-second', label: 'Second device' },
    })
  })

  it('rejects a device belonging to a different account with 403', async () => {
    const ops = makeOps()
    const clock = makeClock(0)
    const config = makeConfig()
    const accountA = await seedAccountWithDevice(ops, clock.now, 'cred-a')
    await seedAccountWithDevice(ops, clock.now, 'cred-b')
    const session = await issueSession(ops, config, clock.now, {
      accountId: accountA.id,
      credentialId: 'cred-a',
    })
    const deps: AuthDeps = { ops, config, now: clock.now, audit: vi.fn() }

    const result = await postRevokeDevice(
      deps,
      fakeReq(undefined, { cookie: `mb_session=${session.sessionId}` }),
      { credentialId: 'cred-b' },
    )

    expect(result.status).toBe(403)
    expect(result.body).toEqual({ code: 'not_authorized' })
  })
})

describe('getPendingStatus', () => {
  it('returns 401 for a missing/invalid pending ticket', async () => {
    const ops = makeOps()
    const clock = makeClock(0)
    const config = makeConfig()
    const deps: AuthDeps = { ops, config, now: clock.now, audit: vi.fn() }

    const result = await getPendingStatus(deps, fakeReq(undefined))

    expect(result.status).toBe(401)
    expect(result.body).toEqual({ code: 'pending_ticket_invalid' })
  })

  it('returns pending while the device awaits owner action', async () => {
    const ops = makeOps()
    const clock = makeClock(0)
    const config = makeConfig()
    const account = await createAccount(ops, clock.now, { name: 'Acc', inviteId: 'inv-1' })
    await seedPendingDevice(ops, account.id, 'cred-pending')
    const { cookie } = await issuePendingTicket(ops, config, clock.now, {
      credentialId: 'cred-pending',
      accountId: account.id,
    })
    const deps: AuthDeps = { ops, config, now: clock.now, audit: vi.fn() }

    const result = await getPendingStatus(
      deps,
      fakeReq(undefined, { cookie: cookieHeaderFor(cookie) }),
    )

    expect(result.status).toBe(200)
    expect(result.body).toEqual({ status: 'pending' })
  })

  it('transitions to approved once the owner approves the device', async () => {
    const ops = makeOps()
    const clock = makeClock(0)
    const config = makeConfig()
    const account = await seedAccountWithDevice(ops, clock.now, 'cred-active')
    await seedPendingDevice(ops, account.id, 'cred-pending')
    const ownerSession = await issueSession(ops, config, clock.now, {
      accountId: account.id,
      credentialId: 'cred-active',
    })
    const { cookie } = await issuePendingTicket(ops, config, clock.now, {
      credentialId: 'cred-pending',
      accountId: account.id,
    })
    const deps: AuthDeps = { ops, config, now: clock.now, audit: vi.fn() }

    await postApproveDevice(
      deps,
      fakeReq(undefined, { cookie: `mb_session=${ownerSession.sessionId}` }),
      { credentialId: 'cred-pending' },
    )

    const result = await getPendingStatus(
      deps,
      fakeReq(undefined, { cookie: cookieHeaderFor(cookie) }),
    )

    expect(result.status).toBe(200)
    expect(result.body).toEqual({ status: 'approved' })
  })

  it('transitions to denied once the owner denies the device', async () => {
    const ops = makeOps()
    const clock = makeClock(0)
    const config = makeConfig()
    const account = await seedAccountWithDevice(ops, clock.now, 'cred-active')
    await seedPendingDevice(ops, account.id, 'cred-pending')
    const ownerSession = await issueSession(ops, config, clock.now, {
      accountId: account.id,
      credentialId: 'cred-active',
    })
    const { cookie } = await issuePendingTicket(ops, config, clock.now, {
      credentialId: 'cred-pending',
      accountId: account.id,
    })
    const deps: AuthDeps = { ops, config, now: clock.now, audit: vi.fn() }

    await postDenyDevice(
      deps,
      fakeReq(undefined, { cookie: `mb_session=${ownerSession.sessionId}` }),
      { credentialId: 'cred-pending' },
    )

    const result = await getPendingStatus(
      deps,
      fakeReq(undefined, { cookie: cookieHeaderFor(cookie) }),
    )

    expect(result.status).toBe(200)
    expect(result.body).toEqual({ status: 'denied' })
  })
})
