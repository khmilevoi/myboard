import { beforeEach, describe, expect, it, vi } from 'vitest'

const verifyRegistrationResponseMock = vi.fn()
const verifyAuthenticationResponseMock = vi.fn()

vi.mock('@simplewebauthn/server', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@simplewebauthn/server')>()
  return {
    ...actual,
    verifyRegistrationResponse: (...args: unknown[]) => verifyRegistrationResponseMock(...args),
    verifyAuthenticationResponse: (...args: unknown[]) => verifyAuthenticationResponseMock(...args),
  }
})

import { isoBase64URL } from '@simplewebauthn/server/helpers'
import type { AuthenticatorTransportFuture } from '@simplewebauthn/server'

import type { AuthConfig } from './config'
import { WebAuthnVerificationError } from './errors'
import {
  buildAuthenticationOptions,
  buildRegistrationOptions,
  verifyAuthentication,
  verifyRegistration,
} from './webauthn'

const config: AuthConfig = {
  rpID: 'localhost',
  rpName: 'MyBoard',
  expectedOrigin: 'http://localhost',
  sessionCookieName: 'session',
  challengeCookieName: 'chal',
  pendingCookieName: 'pending',
  sessionTtlSlidingMs: 1000,
  sessionTtlAbsoluteMs: 2000,
  secureCookies: false,
  trustCfConnectingIp: false,
}

describe('buildRegistrationOptions', () => {
  it('emits the strict WebAuthn profile', async () => {
    const options = await buildRegistrationOptions(config, {
      userId: 'user-1',
      userName: 'user@example.com',
      userDisplayName: 'User One',
      excludeCredentials: [{ id: 'cred-existing', transports: ['internal'] }],
    })

    expect(options.authenticatorSelection?.userVerification).toBe('required')
    expect(options.authenticatorSelection?.residentKey).toBe('required')
    expect(options.attestation).toBe('none')
    expect(options.pubKeyCredParams.map((p) => p.alg)).toEqual(expect.arrayContaining([-7, -8]))
    expect(options.excludeCredentials?.map((c) => c.id)).toEqual(['cred-existing'])
    expect(options.rp.id).toBe(config.rpID)
    expect(options.rp.name).toBe(config.rpName)
  })
})

describe('buildAuthenticationOptions', () => {
  it('requires user verification and passes allowCredentials through', async () => {
    const options = await buildAuthenticationOptions(config, {
      allowCredentials: [{ id: 'cred-1', transports: ['internal'] }],
    })

    expect(options.userVerification).toBe('required')
    expect(options.rpId).toBe(config.rpID)
    expect(options.allowCredentials?.map((c) => c.id)).toEqual(['cred-1'])
  })
})

describe('verifyRegistration', () => {
  beforeEach(() => {
    verifyRegistrationResponseMock.mockReset()
  })

  it('returns WebAuthnVerificationError when the library reports verified: false', async () => {
    verifyRegistrationResponseMock.mockResolvedValue({ verified: false })

    const result = await verifyRegistration(config, {
      response: {} as never,
      expectedChallenge: 'chal',
    })

    expect(result).toBeInstanceOf(WebAuthnVerificationError)
  })

  it('returns WebAuthnVerificationError (not throw) when the library throws', async () => {
    verifyRegistrationResponseMock.mockRejectedValue(new Error('boom'))

    const result = await verifyRegistration(config, {
      response: {} as never,
      expectedChallenge: 'chal',
    })

    expect(result).toBeInstanceOf(WebAuthnVerificationError)
  })

  it('maps registrationInfo.credential on success', async () => {
    const publicKeyBytes = new Uint8Array([1, 2, 3])
    verifyRegistrationResponseMock.mockResolvedValue({
      verified: true,
      registrationInfo: {
        credential: {
          id: 'cred-abc',
          publicKey: publicKeyBytes,
          counter: 0,
          transports: ['internal'],
        },
      },
    })

    const result = await verifyRegistration(config, {
      response: {} as never,
      expectedChallenge: 'chal',
    })

    if (result instanceof Error) throw result
    expect(result.credentialId).toBe('cred-abc')
    expect(result.publicKey).toBe(isoBase64URL.fromBuffer(publicKeyBytes))
    expect(result.signCount).toBe(0)
    expect(result.transports).toEqual(['internal'])
    expect(verifyRegistrationResponseMock).toHaveBeenCalledWith(
      expect.objectContaining({
        expectedOrigin: config.expectedOrigin,
        expectedRPID: config.rpID,
        requireUserVerification: true,
      }),
    )
  })
})

describe('verifyAuthentication', () => {
  const device = {
    credentialId: 'cred-1',
    publicKey: isoBase64URL.fromBuffer(new Uint8Array([9, 9, 9])),
    signCount: 5,
    transports: ['internal'] as AuthenticatorTransportFuture[],
  }

  beforeEach(() => {
    verifyAuthenticationResponseMock.mockReset()
  })

  it('returns WebAuthnVerificationError when the library reports verified: false', async () => {
    verifyAuthenticationResponseMock.mockResolvedValue({
      verified: false,
      authenticationInfo: { newCounter: 6 },
    })

    const result = await verifyAuthentication(config, {
      response: {} as never,
      expectedChallenge: 'chal',
      device,
    })

    expect(result).toBeInstanceOf(WebAuthnVerificationError)
  })

  it('returns WebAuthnVerificationError (not throw) when the library throws', async () => {
    verifyAuthenticationResponseMock.mockRejectedValue(new Error('boom'))

    const result = await verifyAuthentication(config, {
      response: {} as never,
      expectedChallenge: 'chal',
      device,
    })

    expect(result).toBeInstanceOf(WebAuthnVerificationError)
  })

  it('rejects a sign-counter regression as a clone', async () => {
    verifyAuthenticationResponseMock.mockResolvedValue({
      verified: true,
      authenticationInfo: { newCounter: 5 },
    })

    const result = await verifyAuthentication(config, {
      response: {} as never,
      expectedChallenge: 'chal',
      device,
    })

    expect(result).toBeInstanceOf(WebAuthnVerificationError)
  })

  it('accepts a zero counter on a brand-new device (signCount baseline 0)', async () => {
    verifyAuthenticationResponseMock.mockResolvedValue({
      verified: true,
      authenticationInfo: { newCounter: 0 },
    })

    const result = await verifyAuthentication(config, {
      response: {} as never,
      expectedChallenge: 'chal',
      device: { ...device, signCount: 0 },
    })

    expect(result).toEqual({ newSignCount: 0 })
  })

  it('returns the new sign count on success', async () => {
    verifyAuthenticationResponseMock.mockResolvedValue({
      verified: true,
      authenticationInfo: { newCounter: 6 },
    })

    const result = await verifyAuthentication(config, {
      response: {} as never,
      expectedChallenge: 'chal',
      device,
    })

    expect(result).toEqual({ newSignCount: 6 })
    expect(verifyAuthenticationResponseMock).toHaveBeenCalledWith(
      expect.objectContaining({
        expectedOrigin: config.expectedOrigin,
        expectedRPID: config.rpID,
        requireUserVerification: true,
        credential: expect.objectContaining({
          id: device.credentialId,
          counter: device.signCount,
        }),
      }),
    )
  })
})
