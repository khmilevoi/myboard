import type { IncomingMessage } from 'node:http'
import { Readable } from 'node:stream'

import { beforeEach, describe, expect, it, vi } from 'vitest'

import { createMemoryOps, createMemoryPubSub } from '../test/memory-ops'
import { createAccount } from './accounts'
import type { AuthConfig } from './config'
import { getDevice, storeDevice } from './devices'
import { DeviceLimitError, InviteLockedError, WebAuthnVerificationError } from './errors'
import {
  deviceLabelFromUa,
  getSession,
  postLoginOptions,
  postLoginVerify,
  postLogout,
  postRegisterOptions,
  postRegisterVerify,
  type AuthDeps,
} from './handlers'
import { createInvite, lookupInvite } from './invites'
import { challengeKey } from './records'
import { issueSession } from './sessions'
import { sha256hex } from './tokens'

vi.mock('./webauthn', () => ({
  buildRegistrationOptions: vi.fn(),
  buildAuthenticationOptions: vi.fn(),
  verifyRegistration: vi.fn(),
  verifyAuthentication: vi.fn(),
}))

vi.mock('./accounts', async (importOriginal) => {
  const actual = await importOriginal<typeof import('./accounts')>()
  return {
    ...actual,
    addDeviceToAccount: vi.fn(actual.addDeviceToAccount),
  }
})

import { addDeviceToAccount } from './accounts'
import {
  buildAuthenticationOptions,
  buildRegistrationOptions,
  verifyAuthentication,
  verifyRegistration,
} from './webauthn'

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

describe('deviceLabelFromUa', () => {
  it('returns Board device when the user-agent is missing', () => {
    expect(deviceLabelFromUa(undefined)).toBe('Board device')
  })

  it('detects browser and OS', () => {
    const ua =
      'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36'
    expect(deviceLabelFromUa(ua)).toBe('Chrome on Windows')
  })

  it('detects Safari on macOS', () => {
    const ua =
      'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Safari/605.1.15'
    expect(deviceLabelFromUa(ua)).toBe('Safari on macOS')
  })

  it('falls back to Board device for unrecognized user-agents', () => {
    expect(deviceLabelFromUa('some-weird-client/1.0')).toBe('Board device')
  })
})

describe('postRegisterOptions', () => {
  beforeEach(() => {
    vi.mocked(buildRegistrationOptions).mockReset()
  })

  it('returns options + challenge cookie for a live invite', async () => {
    const ops = makeOps()
    const clock = makeClock(0)
    const config = makeConfig()
    const deps: AuthDeps = { ops, config, now: clock.now, audit: vi.fn() }
    const { token } = await createInvite(ops, clock.now, { ttlMs: 10 * MINUTE, label: 'Kitchen' })

    vi.mocked(buildRegistrationOptions).mockResolvedValue({
      challenge: 'reg-challenge',
    } as never)

    const result = await postRegisterOptions(deps, fakeReq({ token }))

    expect(result.status).toBe(200)
    expect(result.body).toEqual({ options: { challenge: 'reg-challenge' } })
    const cookies = getSetCookies(result.headers)
    expect(cookies).toHaveLength(1)
    expect(cookies[0]).toContain('HttpOnly')
    expect(cookies[0]).toContain('SameSite=Strict')
  })

  it('passes existing device credential ids as excludeCredentials', async () => {
    const ops = makeOps()
    const clock = makeClock(0)
    const config = makeConfig()
    const deps: AuthDeps = { ops, config, now: clock.now, audit: vi.fn() }
    const { token } = await createInvite(ops, clock.now, { ttlMs: 10 * MINUTE })

    const account = await createAccount(ops, clock.now, { name: 'Existing', inviteId: 'inv-1' })
    await storeDevice(ops, {
      credentialId: 'existing-cred',
      publicKey: 'pk',
      signCount: 0,
      label: 'Existing device',
      createdAt: 0,
      lastSeenAt: 0,
      disabled: false,
      accountId: account.id,
      status: 'active',
      addedVia: 'invite',
    })

    vi.mocked(buildRegistrationOptions).mockResolvedValue({ challenge: 'chal' } as never)

    await postRegisterOptions(deps, fakeReq({ token }))

    expect(buildRegistrationOptions).toHaveBeenCalledWith(
      config,
      expect.objectContaining({
        excludeCredentials: [{ id: 'existing-cred' }],
      }),
    )
  })

  it('returns 409 invite_consumed with canLogin when the invite is spent', async () => {
    const ops = makeOps()
    const clock = makeClock(0)
    const config = makeConfig()
    const deps: AuthDeps = { ops, config, now: clock.now, audit: vi.fn() }
    const { token } = await createInvite(ops, clock.now, { ttlMs: 10 * MINUTE })
    const { consumeInvite } = await import('./invites')
    await consumeInvite(ops, clock.now, token)

    const result = await postRegisterOptions(deps, fakeReq({ token }))

    expect(result).toEqual({ status: 409, body: { code: 'invite_consumed', canLogin: true } })
  })

  it('returns invite_not_found for an unknown token', async () => {
    const ops = makeOps()
    const clock = makeClock(0)
    const config = makeConfig()
    const deps: AuthDeps = { ops, config, now: clock.now, audit: vi.fn() }

    const result = await postRegisterOptions(deps, fakeReq({ token: 'nope' }))

    expect(result).toEqual({ status: 404, body: { code: 'invite_not_found' } })
  })

  it('returns invite_locked after 10 recorded failures', async () => {
    const ops = makeOps()
    const clock = makeClock(0)
    const config = makeConfig()
    const { token } = await createInvite(ops, clock.now, { ttlMs: 10 * MINUTE })
    const { recordInviteFailure } = await import('./invites')
    for (let i = 0; i < 10; i++) {
      await recordInviteFailure(ops, clock.now, token)
    }

    const result = await lookupInvite(ops, clock.now, token)
    expect(result).toBeInstanceOf(InviteLockedError)

    const deps: AuthDeps = { ops, config, now: clock.now, audit: vi.fn() }
    const optionsResult = await postRegisterOptions(deps, fakeReq({ token }))
    expect(optionsResult).toEqual({ status: 429, body: { code: 'invite_locked' } })
  })
})

describe('postRegisterVerify', () => {
  beforeEach(() => {
    vi.mocked(buildRegistrationOptions).mockReset()
    vi.mocked(verifyRegistration).mockReset()
  })

  async function beginRegistration(
    ops: ReturnType<typeof makeOps>,
    config: AuthConfig,
    now: () => number,
    token: string,
  ) {
    vi.mocked(buildRegistrationOptions).mockResolvedValue({ challenge: 'reg-challenge' } as never)
    const deps: AuthDeps = { ops, config, now, audit: vi.fn() }
    const optionsResult = await postRegisterOptions(deps, fakeReq({ token }))
    const cookie = getSetCookies(optionsResult.headers)[0]
    return cookieHeaderFor(cookie)
  }

  it('happy path: creates account + active device, sets session cookie, returns credentialId', async () => {
    const ops = makeOps()
    const clock = makeClock(0)
    const config = makeConfig()
    const { token } = await createInvite(ops, clock.now, { ttlMs: 10 * MINUTE })
    const challengeCookie = await beginRegistration(ops, config, clock.now, token)

    vi.mocked(verifyRegistration).mockResolvedValue({
      credentialId: 'cred-1',
      publicKey: 'pk-1',
      signCount: 0,
    })

    const deps: AuthDeps = { ops, config, now: clock.now, audit: vi.fn() }
    const req = fakeReq(
      { token, name: 'My Account', attestationResponse: { id: 'cred-1' } },
      {
        cookie: challengeCookie,
        'user-agent': 'Mozilla/5.0 (Windows NT 10.0) Chrome/120.0 Safari/537.36',
      },
    )

    const result = await postRegisterVerify(deps, req)

    expect(result.status).toBe(200)
    expect(result.body).toMatchObject({ credentialId: 'cred-1' })
    const accountId = (result.body as { accountId: string }).accountId
    expect(accountId).toEqual(expect.any(String))

    const cookies = getSetCookies(result.headers)
    const sessionSetCookie = cookies.find((c) => c.startsWith(`${config.sessionCookieName}=`))
    expect(sessionSetCookie).toBeDefined()
    expect(sessionSetCookie).toContain('HttpOnly')
    expect(sessionSetCookie).toContain('SameSite=Lax')

    const clearedChallengeCookie = cookies.find((c) =>
      c.startsWith(`${config.challengeCookieName}=`),
    )
    expect(clearedChallengeCookie).toContain('Max-Age=0')

    const device = await getDevice(ops, 'cred-1')
    if (device instanceof Error) throw device
    expect(device.status).toBe('active')
    expect(device.label).toBe('Chrome on Windows')
    expect(device.accountId).toBe(accountId)

    const invite = await lookupInvite(ops, clock.now, token)
    expect(invite).toBeInstanceOf(Error)
  })

  it('rejects foreign/stale challenge (inviteHash mismatch) and creates nothing', async () => {
    const ops = makeOps()
    const clock = makeClock(0)
    const config = makeConfig()
    const { token: realToken } = await createInvite(ops, clock.now, { ttlMs: 10 * MINUTE })
    const { token: otherToken } = await createInvite(ops, clock.now, { ttlMs: 10 * MINUTE })

    const { saveChallenge } = await import('./challenge-store')
    const { cookie } = await saveChallenge(ops, config, clock.now, {
      type: 'reg',
      challenge: 'reg-challenge',
      inviteHash: sha256hex(otherToken),
    })

    const deps: AuthDeps = { ops, config, now: clock.now, audit: vi.fn() }
    const req = fakeReq(
      { token: realToken, name: 'X', attestationResponse: { id: 'cred-attempt' } },
      { cookie: cookieHeaderFor(cookie) },
    )

    const result = await postRegisterVerify(deps, req)

    expect(result.status).toBe(400)
    expect(result.body).toEqual({ code: 'challenge_invalid' })
    expect(verifyRegistration).not.toHaveBeenCalled()

    const invite = await lookupInvite(ops, clock.now, realToken)
    if (invite instanceof Error) throw invite
    expect(invite.failedAttempts).toBe(1)
    expect(invite.uses).toBe(0)
  })

  it('records an invite failure and rejects when verifyRegistration fails', async () => {
    const ops = makeOps()
    const clock = makeClock(0)
    const config = makeConfig()
    const { token } = await createInvite(ops, clock.now, { ttlMs: 10 * MINUTE })
    const challengeCookie = await beginRegistration(ops, config, clock.now, token)

    vi.mocked(verifyRegistration).mockResolvedValue(new WebAuthnVerificationError())

    const deps: AuthDeps = { ops, config, now: clock.now, audit: vi.fn() }
    const req = fakeReq(
      { token, name: 'X', attestationResponse: { id: 'cred-attempt' } },
      { cookie: challengeCookie },
    )

    const result = await postRegisterVerify(deps, req)

    expect(result.status).toBe(400)

    const invite = await lookupInvite(ops, clock.now, token)
    if (invite instanceof Error) throw invite
    expect(invite.failedAttempts).toBe(1)
    expect(invite.uses).toBe(0)
  })

  it('locks the invite after 10 failed verifyRegistration attempts', async () => {
    const ops = makeOps()
    const clock = makeClock(0)
    const config = makeConfig()
    const { token } = await createInvite(ops, clock.now, { ttlMs: 60 * MINUTE, maxUses: 100 })

    vi.mocked(verifyRegistration).mockResolvedValue(new WebAuthnVerificationError())

    for (let i = 0; i < 10; i++) {
      const challengeCookie = await beginRegistration(ops, config, clock.now, token)
      const deps: AuthDeps = { ops, config, now: clock.now, audit: vi.fn() }
      const req = fakeReq(
        { token, name: 'X', attestationResponse: { id: 'cred-attempt' } },
        { cookie: challengeCookie },
      )
      await postRegisterVerify(deps, req)
    }

    const invite = await lookupInvite(ops, clock.now, token)
    expect(invite).toBeInstanceOf(InviteLockedError)
  })

  it('rejects registration with a spent invite and creates no account/device', async () => {
    const ops = makeOps()
    const clock = makeClock(0)
    const config = makeConfig()
    const { token } = await createInvite(ops, clock.now, { ttlMs: 10 * MINUTE })
    const challengeCookie = await beginRegistration(ops, config, clock.now, token)

    const { consumeInvite } = await import('./invites')
    await consumeInvite(ops, clock.now, token)

    vi.mocked(verifyRegistration).mockResolvedValue({
      credentialId: 'cred-x',
      publicKey: 'pk',
      signCount: 0,
    })

    const deps: AuthDeps = { ops, config, now: clock.now, audit: vi.fn() }
    const req = fakeReq(
      { token, name: 'X', attestationResponse: { id: 'cred-x' } },
      { cookie: challengeCookie },
    )

    const result = await postRegisterVerify(deps, req)

    expect(result.status).toBe(409)
    const device = await getDevice(ops, 'cred-x')
    expect(device).toBeInstanceOf(Error)
  })

  it('releases the invite and leaves no account/device behind when a post-consume step fails', async () => {
    const ops = makeOps()
    const clock = makeClock(0)
    const config = makeConfig()
    const { token } = await createInvite(ops, clock.now, { ttlMs: 10 * MINUTE })
    const challengeCookie = await beginRegistration(ops, config, clock.now, token)

    vi.mocked(verifyRegistration).mockResolvedValue({
      credentialId: 'cred-fail',
      publicKey: 'pk',
      signCount: 0,
    })
    vi.mocked(addDeviceToAccount).mockResolvedValueOnce(new DeviceLimitError())

    const deps: AuthDeps = { ops, config, now: clock.now, audit: vi.fn() }
    const req = fakeReq(
      { token, name: 'X', attestationResponse: { id: 'cred-fail' } },
      { cookie: challengeCookie },
    )

    const result = await postRegisterVerify(deps, req)

    expect(result.status).toBe(409)
    expect(result.body).toEqual({ code: 'device_limit' })

    // The invite is usable again -- not permanently burned by the failed attempt.
    const invite = await lookupInvite(ops, clock.now, token)
    expect(invite).not.toBeInstanceOf(Error)
    if (invite instanceof Error) throw invite
    expect(invite.uses).toBe(0)
    expect(invite.usedAt).toBeUndefined()

    // Neither the device nor the account created for this failed attempt survive.
    const device = await getDevice(ops, 'cred-fail')
    expect(device).toBeInstanceOf(Error)
    const accounts = await ops.scanKeys('account:')
    expect(accounts).toHaveLength(0)
  })

  it('rejects a null attestationResponse with 422 and does not consume the challenge', async () => {
    const ops = makeOps()
    const clock = makeClock(0)
    const config = makeConfig()
    const { token } = await createInvite(ops, clock.now, { ttlMs: 10 * MINUTE })
    const challengeCookie = await beginRegistration(ops, config, clock.now, token)
    const challengeId = challengeCookie.split('=')[1]

    const deps: AuthDeps = { ops, config, now: clock.now, audit: vi.fn() }
    const req = fakeReq(
      { token, name: 'X', attestationResponse: null },
      { cookie: challengeCookie },
    )

    const result = await postRegisterVerify(deps, req)

    expect(result.status).toBe(422)
    expect(verifyRegistration).not.toHaveBeenCalled()

    const stored = await ops.get(challengeKey(challengeId))
    expect(stored).not.toBeNull()
  })

  it('rejects an attestationResponse missing id with 422', async () => {
    const ops = makeOps()
    const clock = makeClock(0)
    const config = makeConfig()
    const { token } = await createInvite(ops, clock.now, { ttlMs: 10 * MINUTE })
    const challengeCookie = await beginRegistration(ops, config, clock.now, token)

    const deps: AuthDeps = { ops, config, now: clock.now, audit: vi.fn() }
    const req = fakeReq({ token, name: 'X', attestationResponse: {} }, { cookie: challengeCookie })

    const result = await postRegisterVerify(deps, req)

    expect(result.status).toBe(422)
    expect(verifyRegistration).not.toHaveBeenCalled()
  })
})

describe('postLoginOptions', () => {
  beforeEach(() => {
    vi.mocked(buildAuthenticationOptions).mockReset()
  })

  it('seeds allowCredentials from credentialIdHint when present', async () => {
    const ops = makeOps()
    const clock = makeClock(0)
    const config = makeConfig()
    const deps: AuthDeps = { ops, config, now: clock.now, audit: vi.fn() }

    vi.mocked(buildAuthenticationOptions).mockResolvedValue({
      challenge: 'auth-challenge',
    } as never)

    await postLoginOptions(deps, fakeReq({ credentialIdHint: 'cred-hint' }))

    expect(buildAuthenticationOptions).toHaveBeenCalledWith(config, {
      allowCredentials: [{ id: 'cred-hint' }],
    })
  })

  it('leaves allowCredentials undefined (discoverable) without a hint', async () => {
    const ops = makeOps()
    const clock = makeClock(0)
    const config = makeConfig()
    const deps: AuthDeps = { ops, config, now: clock.now, audit: vi.fn() }

    vi.mocked(buildAuthenticationOptions).mockResolvedValue({
      challenge: 'auth-challenge',
    } as never)

    const result = await postLoginOptions(deps, fakeReq({}))

    expect(buildAuthenticationOptions).toHaveBeenCalledWith(config, { allowCredentials: undefined })
    expect(result.status).toBe(200)
    const cookies = getSetCookies(result.headers)
    expect(cookies[0]).toContain('SameSite=Strict')
  })
})

describe('postLoginVerify', () => {
  beforeEach(() => {
    vi.mocked(buildAuthenticationOptions).mockReset()
    vi.mocked(verifyAuthentication).mockReset()
  })

  async function beginLogin(
    ops: ReturnType<typeof makeOps>,
    config: AuthConfig,
    now: () => number,
  ) {
    vi.mocked(buildAuthenticationOptions).mockResolvedValue({
      challenge: 'auth-challenge',
    } as never)
    const deps: AuthDeps = { ops, config, now, audit: vi.fn() }
    const optionsResult = await postLoginOptions(deps, fakeReq({}))
    const cookie = getSetCookies(optionsResult.headers)[0]
    return cookieHeaderFor(cookie)
  }

  it('logs in an active device and issues a session', async () => {
    const ops = makeOps()
    const clock = makeClock(0)
    const config = makeConfig()
    const account = await createAccount(ops, clock.now, { name: 'Acc', inviteId: 'inv-1' })
    await storeDevice(ops, {
      credentialId: 'cred-active',
      publicKey: 'pk',
      signCount: 5,
      label: 'Board device',
      createdAt: 0,
      lastSeenAt: 0,
      disabled: false,
      accountId: account.id,
      status: 'active',
      addedVia: 'invite',
    })

    const challengeCookie = await beginLogin(ops, config, clock.now)
    vi.mocked(verifyAuthentication).mockResolvedValue({ newSignCount: 6 })

    const deps: AuthDeps = { ops, config, now: clock.now, audit: vi.fn() }
    const req = fakeReq(
      { authenticationResponse: { id: 'cred-active' } },
      { cookie: challengeCookie },
    )

    const result = await postLoginVerify(deps, req)

    expect(result).toEqual({
      status: 200,
      body: { accountId: account.id, credentialId: 'cred-active' },
      headers: { 'Set-Cookie': expect.stringContaining(`${config.sessionCookieName}=`) },
    })
    const cookies = getSetCookies(result.headers)
    expect(cookies[0]).toContain('HttpOnly')
    expect(cookies[0]).toContain('SameSite=Lax')

    const device = await getDevice(ops, 'cred-active')
    if (device instanceof Error) throw device
    expect(device.signCount).toBe(6)
  })

  it('rejects login for a pending device', async () => {
    const ops = makeOps()
    const clock = makeClock(0)
    const config = makeConfig()
    const account = await createAccount(ops, clock.now, { name: 'Acc', inviteId: 'inv-1' })
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

    const challengeCookie = await beginLogin(ops, config, clock.now)

    const deps: AuthDeps = { ops, config, now: clock.now, audit: vi.fn() }
    const req = fakeReq(
      { authenticationResponse: { id: 'cred-pending' } },
      { cookie: challengeCookie },
    )

    const result = await postLoginVerify(deps, req)

    expect(result.status).toBe(403)
    expect(result.body).toEqual({ code: 'device_disabled' })
    expect(verifyAuthentication).not.toHaveBeenCalled()
  })

  it('audits a successful login', async () => {
    const ops = makeOps()
    const clock = makeClock(0)
    const config = makeConfig()
    const account = await createAccount(ops, clock.now, { name: 'Acc', inviteId: 'inv-1' })
    await storeDevice(ops, {
      credentialId: 'cred-audit',
      publicKey: 'pk',
      signCount: 5,
      label: 'Board device',
      createdAt: 0,
      lastSeenAt: 0,
      disabled: false,
      accountId: account.id,
      status: 'active',
      addedVia: 'invite',
    })

    const challengeCookie = await beginLogin(ops, config, clock.now)
    vi.mocked(verifyAuthentication).mockResolvedValue({ newSignCount: 6 })

    const deps: AuthDeps = { ops, config, now: clock.now, audit: vi.fn() }
    const req = fakeReq(
      { authenticationResponse: { id: 'cred-audit' } },
      { cookie: challengeCookie },
    )

    await postLoginVerify(deps, req)

    expect(deps.audit).toHaveBeenCalledWith(
      expect.objectContaining({ event: 'login', credentialId: expect.any(String) }),
    )
    // No secrets in the event payload:
    const events = (deps.audit as ReturnType<typeof vi.fn>).mock.calls.map((c) => c[0])
    for (const event of events) {
      expect(JSON.stringify(event)).not.toMatch(/challenge|token/i)
    }
  })

  it('audits a failed login as login_failed', async () => {
    const ops = makeOps()
    const clock = makeClock(0)
    const config = makeConfig()
    const account = await createAccount(ops, clock.now, { name: 'Acc', inviteId: 'inv-1' })
    await storeDevice(ops, {
      credentialId: 'cred-pending-audit',
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

    const challengeCookie = await beginLogin(ops, config, clock.now)

    const deps: AuthDeps = { ops, config, now: clock.now, audit: vi.fn() }
    const req = fakeReq(
      { authenticationResponse: { id: 'cred-pending-audit' } },
      { cookie: challengeCookie },
    )

    await postLoginVerify(deps, req)

    expect(deps.audit).toHaveBeenCalledWith(expect.objectContaining({ event: 'login_failed' }))
  })

  it('serializes sign-counter verification so a concurrent stale/cloned assertion is rejected', async () => {
    const ops = makeOps()
    const clock = makeClock(0)
    const config = makeConfig()
    const account = await createAccount(ops, clock.now, { name: 'Acc', inviteId: 'inv-1' })
    await storeDevice(ops, {
      credentialId: 'cred-race',
      publicKey: 'pk',
      signCount: 5,
      label: 'Board device',
      createdAt: 0,
      lastSeenAt: 0,
      disabled: false,
      accountId: account.id,
      status: 'active',
      addedVia: 'invite',
    })

    const cookieA = await beginLogin(ops, config, clock.now)
    const cookieB = await beginLogin(ops, config, clock.now)

    // Legitimate request reads signCount 5 and reports the next counter (6). A
    // concurrent clone/replay only gets to run once the lock releases, by which
    // point the stored counter has already advanced to 6 — its embedded counter
    // is stale relative to that, so it is rejected.
    vi.mocked(verifyAuthentication).mockImplementation(async (_config, params) => {
      if (params.device.signCount === 5) return { newSignCount: 6 }
      return new WebAuthnVerificationError()
    })

    const deps: AuthDeps = { ops, config, now: clock.now, audit: vi.fn() }
    const [a, b] = await Promise.all([
      postLoginVerify(
        deps,
        fakeReq({ authenticationResponse: { id: 'cred-race' } }, { cookie: cookieA }),
      ),
      postLoginVerify(
        deps,
        fakeReq({ authenticationResponse: { id: 'cred-race' } }, { cookie: cookieB }),
      ),
    ])

    const results = [a, b]
    const successes = results.filter((r) => r.status === 200)
    const rejected = results.filter(
      (r) =>
        r.status === 400 && (r.body as { code?: string })?.code === 'webauthn_verification_failed',
    )

    expect(successes).toHaveLength(1)
    expect(rejected).toHaveLength(1)

    const device = await getDevice(ops, 'cred-race')
    if (device instanceof Error) throw device
    expect(device.signCount).toBe(6)
  })

  it('rejects a null authenticationResponse with 422 and does not consume the challenge', async () => {
    const ops = makeOps()
    const clock = makeClock(0)
    const config = makeConfig()
    const challengeCookie = await beginLogin(ops, config, clock.now)
    const challengeId = challengeCookie.split('=')[1]

    const deps: AuthDeps = { ops, config, now: clock.now, audit: vi.fn() }
    const req = fakeReq({ authenticationResponse: null }, { cookie: challengeCookie })

    const result = await postLoginVerify(deps, req)

    expect(result.status).toBe(422)
    expect(verifyAuthentication).not.toHaveBeenCalled()

    const stored = await ops.get(challengeKey(challengeId))
    expect(stored).not.toBeNull()
  })

  it('rejects an authenticationResponse missing id with 422', async () => {
    const ops = makeOps()
    const clock = makeClock(0)
    const config = makeConfig()
    const challengeCookie = await beginLogin(ops, config, clock.now)

    const deps: AuthDeps = { ops, config, now: clock.now, audit: vi.fn() }
    const req = fakeReq({ authenticationResponse: {} }, { cookie: challengeCookie })

    const result = await postLoginVerify(deps, req)

    expect(result.status).toBe(422)
    expect(verifyAuthentication).not.toHaveBeenCalled()
  })
})

describe('getSession', () => {
  it('returns 200 with accountId for a valid session', async () => {
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

    const deps: AuthDeps = { ops, config, now: clock.now, audit: vi.fn() }
    const result = await getSession(
      deps,
      fakeReq(undefined, { cookie: `mb_session=${session.sessionId}` }),
    )

    expect(result.status).toBe(200)
    expect(result.body).toEqual({ accountId: account.id })
  })

  it('returns 401 when the session is missing/expired', async () => {
    const ops = makeOps()
    const clock = makeClock(0)
    const config = makeConfig()
    const deps: AuthDeps = { ops, config, now: clock.now, audit: vi.fn() }

    const result = await getSession(deps, fakeReq(undefined, { cookie: 'mb_session=nonexistent' }))

    expect(result.status).toBe(401)
  })

  it('emits a refreshed session cookie even when the clock ticks between reads (explicit refreshed flag, not a lastSeenAt===now heuristic)', async () => {
    const ops = makeOps()
    const setupClock = makeClock(0)
    const config = makeConfig()
    const account = await createAccount(ops, setupClock.now, { name: 'Acc', inviteId: 'inv-1' })
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
    const session = await issueSession(ops, config, setupClock.now, {
      accountId: account.id,
      credentialId: 'cred-1',
    })

    // Simulate a real clock that ticks between successive now() reads (as it would
    // across awaited I/O), well past the 5-minute refresh throttle window.
    let time = 6 * MINUTE
    const drifting = () => {
      const value = time
      time += 1
      return value
    }
    const deps: AuthDeps = { ops, config, now: drifting, audit: vi.fn() }

    const result = await getSession(
      deps,
      fakeReq(undefined, { cookie: `mb_session=${session.sessionId}` }),
    )

    expect(result.status).toBe(200)
    const cookies = getSetCookies(result.headers)
    expect(cookies).toHaveLength(1)
    expect(cookies[0]).toContain(`${config.sessionCookieName}=`)
  })
})

describe('postLogout', () => {
  it('clears the session cookie and deletes the session', async () => {
    const ops = makeOps()
    const clock = makeClock(0)
    const config = makeConfig()
    const account = await createAccount(ops, clock.now, { name: 'Acc', inviteId: 'inv-1' })
    const session = await issueSession(ops, config, clock.now, {
      accountId: account.id,
      credentialId: 'cred-1',
    })

    const deps: AuthDeps = { ops, config, now: clock.now, audit: vi.fn() }
    const result = await postLogout(
      deps,
      fakeReq(undefined, { cookie: `mb_session=${session.sessionId}` }),
    )

    expect(result.status).toBe(204)
    const cookies = getSetCookies(result.headers)
    expect(cookies[0]).toContain('Max-Age=0')
    expect(cookies[0]).toContain('HttpOnly')

    const stored = await ops.get(`session:${session.sessionId}`)
    expect(stored).toBeNull()
  })
})
