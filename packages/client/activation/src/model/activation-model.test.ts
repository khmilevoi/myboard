import { context } from '@reatom/core'
import { makeScriptedHttp } from '@shared/http/test/scripted-http'
// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest'

import { makeActivationModel } from './activation-model'

afterEach(() => context.reset())

function createStorage(initial: string | null = null) {
  let value = initial
  return {
    get: vi.fn(() => value),
    set: vi.fn((credentialId: string) => {
      value = credentialId
    }),
    clear: vi.fn(() => {
      value = null
    }),
  }
}

describe('startRegistration', () => {
  it('posts options, runs the registration ceremony, posts verify, stores the hint, and navigates', async () => {
    const { http, calls } = makeScriptedHttp({
      '/api/auth/register/options': [
        { status: 200, body: { options: { challenge: 'reg-challenge' } } },
      ],
      '/api/auth/register/verify': [{ status: 200, body: { credentialId: 'cred-123' } }],
    })
    const startRegistrationCeremony = vi.fn().mockResolvedValue({ id: 'cred-123', rawId: 'raw' })
    const navigate = vi.fn()
    const storage = createStorage()

    const model = makeActivationModel({
      token: 'invite-token',
      http,
      startRegistrationCeremony,
      navigate,
      storage,
    })

    model.registrationForm.fields.name.change('Alice')
    await model.startRegistration()

    expect(calls[0]).toEqual({
      method: 'POST',
      url: '/api/auth/register/options',
      json: { token: 'invite-token' },
    })
    expect(startRegistrationCeremony).toHaveBeenCalledWith({
      optionsJSON: { challenge: 'reg-challenge' },
    })
    expect(calls[1]).toEqual({
      method: 'POST',
      url: '/api/auth/register/verify',
      json: {
        token: 'invite-token',
        name: 'Alice',
        attestationResponse: { id: 'cred-123', rawId: 'raw' },
      },
    })
    expect(storage.set).toHaveBeenCalledWith('cred-123')
    expect(navigate).toHaveBeenCalledWith('/')
  })

  it('blocks submit with a field error when the name is empty', async () => {
    const { http, calls } = makeScriptedHttp({})
    const model = makeActivationModel({
      token: 'invite-token',
      http,
    })

    await model.startRegistration()

    expect(model.registrationForm.fields.name.validation().error).toBeDefined()
    expect(calls).toHaveLength(0)
  })

  it('blocks submit with a field error when the name exceeds 40 characters', async () => {
    const { http, calls } = makeScriptedHttp({})
    const model = makeActivationModel({
      token: 'invite-token',
      http,
    })

    model.registrationForm.fields.name.change('a'.repeat(41))
    await model.startRegistration()

    expect(model.registrationForm.fields.name.validation().error).toBeDefined()
    expect(calls).toHaveLength(0)
  })

  it('moves to the activate-used screen when register/options returns 409 invite_consumed', async () => {
    const { http } = makeScriptedHttp({
      '/api/auth/register/options': [
        { status: 409, body: { code: 'invite_consumed', canLogin: true } },
      ],
    })
    const model = makeActivationModel({ token: 'invite-token', http })

    model.registrationForm.fields.name.change('Alice')
    await model.startRegistration()

    expect(model.screen()).toBe('activate-used')
  })
})

describe('startLogin', () => {
  it('sends the stored credential hint from localStorage after invite_consumed flips mode', async () => {
    const { http, calls } = makeScriptedHttp({
      '/api/auth/register/options': [
        { status: 409, body: { code: 'invite_consumed', canLogin: true } },
      ],
      '/api/auth/login/options': [
        { status: 200, body: { options: { challenge: 'auth-challenge' } } },
      ],
      '/api/auth/login/verify': [{ status: 200, body: { credentialId: 'cred-456' } }],
    })
    const startAuthenticationCeremony = vi.fn().mockResolvedValue({ id: 'cred-456' })
    const navigate = vi.fn()
    const storage = createStorage('cred-hint-1')

    const model = makeActivationModel({
      token: 'invite-token',
      http,
      startAuthenticationCeremony,
      navigate,
      storage,
    })

    model.registrationForm.fields.name.change('Alice')
    await model.startRegistration()
    expect(model.screen()).toBe('activate-used')

    await model.startLogin()

    expect(calls[1]).toEqual({
      method: 'POST',
      url: '/api/auth/login/options',
      json: { credentialIdHint: 'cred-hint-1' },
    })
    expect(startAuthenticationCeremony).toHaveBeenCalledWith({
      optionsJSON: { challenge: 'auth-challenge' },
    })
    expect(storage.set).toHaveBeenCalledWith('cred-456')
    expect(navigate).toHaveBeenCalledWith('/')
  })

  it('clears a stale credential hint without auto-retrying when the hinted ceremony fails, then runs hintless on a subsequent user retry', async () => {
    const { http, calls } = makeScriptedHttp({
      '/api/auth/login/options': [
        { status: 200, body: { options: { challenge: 'auth-challenge-hinted' } } },
        { status: 200, body: { options: { challenge: 'auth-challenge-discoverable' } } },
      ],
      '/api/auth/login/verify': [{ status: 200, body: { credentialId: 'cred-789' } }],
    })
    const startAuthenticationCeremony = vi
      .fn()
      .mockRejectedValueOnce(new Error('NotAllowedError'))
      .mockResolvedValueOnce({ id: 'cred-789' })
    const navigate = vi.fn()
    const storage = createStorage('stale-cred-hint')

    const model = makeActivationModel({
      token: 'invite-token',
      http,
      startAuthenticationCeremony,
      navigate,
      storage,
    })

    await model.startLogin()

    expect(calls[0]).toEqual({
      method: 'POST',
      url: '/api/auth/login/options',
      json: { credentialIdHint: 'stale-cred-hint' },
    })
    expect(storage.clear).toHaveBeenCalled()
    // No automatic second ceremony/options call, and no navigation -- the
    // failure (which could be a genuine user cancel) surfaces as an error
    // instead of silently re-prompting.
    expect(calls).toHaveLength(1)
    expect(startAuthenticationCeremony).toHaveBeenCalledTimes(1)
    expect(navigate).not.toHaveBeenCalled()
    expect(model.error()).not.toBeNull()

    // A subsequent user-initiated retry sees the hint already cleared and
    // runs hintless (discoverable).
    await model.startLogin()

    expect(calls[1]).toEqual({
      method: 'POST',
      url: '/api/auth/login/options',
      json: {},
    })
    expect(startAuthenticationCeremony).toHaveBeenNthCalledWith(2, {
      optionsJSON: { challenge: 'auth-challenge-discoverable' },
    })
    expect(storage.set).toHaveBeenCalledWith('cred-789')
    expect(navigate).toHaveBeenCalledWith('/')
    expect(model.error()).toBeNull()
  })

  it('clears a stale credential hint without auto-retrying when the hinted verify is rejected, then runs hintless on a subsequent user retry', async () => {
    const { http, calls } = makeScriptedHttp({
      '/api/auth/login/options': [
        { status: 200, body: { options: { challenge: 'auth-challenge-hinted' } } },
        { status: 200, body: { options: { challenge: 'auth-challenge-discoverable' } } },
      ],
      '/api/auth/login/verify': [
        { status: 404, body: { code: 'device_not_found' } },
        { status: 200, body: { credentialId: 'cred-999' } },
      ],
    })
    const startAuthenticationCeremony = vi
      .fn()
      .mockResolvedValueOnce({ id: 'stale-cred-hint' })
      .mockResolvedValueOnce({ id: 'cred-999' })
    const navigate = vi.fn()
    const storage = createStorage('stale-cred-hint')

    const model = makeActivationModel({
      token: 'invite-token',
      http,
      startAuthenticationCeremony,
      navigate,
      storage,
    })

    await model.startLogin()

    expect(storage.clear).toHaveBeenCalled()
    expect(calls).toHaveLength(2)
    expect(navigate).not.toHaveBeenCalled()
    expect(model.error()).not.toBeNull()

    await model.startLogin()

    expect(calls[2]).toEqual({
      method: 'POST',
      url: '/api/auth/login/options',
      json: {},
    })
    expect(storage.set).toHaveBeenCalledWith('cred-999')
    expect(navigate).toHaveBeenCalledWith('/')
    expect(model.error()).toBeNull()
  })
})

describe('initial screen', () => {
  it('is home when there is no invite token', () => {
    const model = makeActivationModel({ token: null, http: makeScriptedHttp({}).http })
    expect(model.screen()).toBe('home')
  })

  it('is activate when a non-empty token is present', () => {
    const model = makeActivationModel({ token: 'invite-token', http: makeScriptedHttp({}).http })
    expect(model.screen()).toBe('activate')
  })

  it('is activate-no-code when the token param is present but empty', () => {
    const model = makeActivationModel({ token: '', http: makeScriptedHttp({}).http })
    expect(model.screen()).toBe('activate-no-code')
  })
})
