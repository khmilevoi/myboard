import { context } from '@reatom/core'
// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest'

import { createActivationModel } from './activation-model'

afterEach(() => context.reset())

function jsonResponse(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  })
}

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
    const fetchImpl = vi
      .fn()
      .mockResolvedValueOnce(jsonResponse({ options: { challenge: 'reg-challenge' } }))
      .mockResolvedValueOnce(jsonResponse({ credentialId: 'cred-123' }))
    const startRegistrationCeremony = vi.fn().mockResolvedValue({ id: 'cred-123', rawId: 'raw' })
    const navigate = vi.fn()
    const storage = createStorage()

    const model = createActivationModel({
      token: 'invite-token',
      fetchImpl: fetchImpl as unknown as typeof fetch,
      startRegistrationCeremony,
      navigate,
      storage,
    })

    model.registrationForm.fields.name.change('Alice')
    await model.startRegistration()

    expect(fetchImpl).toHaveBeenNthCalledWith(
      1,
      '/api/auth/register/options',
      expect.objectContaining({
        method: 'POST',
        credentials: 'same-origin',
        headers: expect.objectContaining({ 'X-Requested-With': 'MyBoard' }),
        body: JSON.stringify({ token: 'invite-token' }),
      }),
    )
    expect(startRegistrationCeremony).toHaveBeenCalledWith({
      optionsJSON: { challenge: 'reg-challenge' },
    })
    expect(fetchImpl).toHaveBeenNthCalledWith(
      2,
      '/api/auth/register/verify',
      expect.objectContaining({
        body: JSON.stringify({
          token: 'invite-token',
          name: 'Alice',
          attestationResponse: { id: 'cred-123', rawId: 'raw' },
        }),
      }),
    )
    expect(storage.set).toHaveBeenCalledWith('cred-123')
    expect(navigate).toHaveBeenCalledWith('/')
  })

  it('blocks submit with a field error when the name is empty', async () => {
    const fetchImpl = vi.fn()
    const model = createActivationModel({
      token: 'invite-token',
      fetchImpl: fetchImpl as unknown as typeof fetch,
    })

    await model.startRegistration()

    expect(model.registrationForm.fields.name.validation().error).toBeDefined()
    expect(fetchImpl).not.toHaveBeenCalled()
  })

  it('blocks submit with a field error when the name exceeds 40 characters', async () => {
    const fetchImpl = vi.fn()
    const model = createActivationModel({
      token: 'invite-token',
      fetchImpl: fetchImpl as unknown as typeof fetch,
    })

    model.registrationForm.fields.name.change('a'.repeat(41))
    await model.startRegistration()

    expect(model.registrationForm.fields.name.validation().error).toBeDefined()
    expect(fetchImpl).not.toHaveBeenCalled()
  })

  it('flips mode to login when register/options returns 409 invite_consumed', async () => {
    const fetchImpl = vi
      .fn()
      .mockResolvedValueOnce(jsonResponse({ code: 'invite_consumed', canLogin: true }, 409))
    const model = createActivationModel({
      token: 'invite-token',
      fetchImpl: fetchImpl as unknown as typeof fetch,
    })

    model.registrationForm.fields.name.change('Alice')
    await model.startRegistration()

    expect(model.mode()).toBe('login')
  })
})

describe('startLogin', () => {
  it('sends the stored credential hint from localStorage after invite_consumed flips mode', async () => {
    const fetchImpl = vi
      .fn()
      .mockResolvedValueOnce(jsonResponse({ code: 'invite_consumed', canLogin: true }, 409))
      .mockResolvedValueOnce(jsonResponse({ options: { challenge: 'auth-challenge' } }))
      .mockResolvedValueOnce(jsonResponse({ credentialId: 'cred-456' }))
    const startAuthenticationCeremony = vi.fn().mockResolvedValue({ id: 'cred-456' })
    const navigate = vi.fn()
    const storage = createStorage('cred-hint-1')

    const model = createActivationModel({
      token: 'invite-token',
      fetchImpl: fetchImpl as unknown as typeof fetch,
      startAuthenticationCeremony,
      navigate,
      storage,
    })

    model.registrationForm.fields.name.change('Alice')
    await model.startRegistration()
    expect(model.mode()).toBe('login')

    await model.startLogin()

    expect(fetchImpl).toHaveBeenNthCalledWith(
      2,
      '/api/auth/login/options',
      expect.objectContaining({
        body: JSON.stringify({ credentialIdHint: 'cred-hint-1' }),
      }),
    )
    expect(startAuthenticationCeremony).toHaveBeenCalledWith({
      optionsJSON: { challenge: 'auth-challenge' },
    })
    expect(storage.set).toHaveBeenCalledWith('cred-456')
    expect(navigate).toHaveBeenCalledWith('/')
  })

  it('clears a stale credential hint and retries discoverable when the hinted ceremony fails', async () => {
    const fetchImpl = vi
      .fn()
      .mockResolvedValueOnce(jsonResponse({ options: { challenge: 'auth-challenge-hinted' } }))
      .mockResolvedValueOnce(
        jsonResponse({ options: { challenge: 'auth-challenge-discoverable' } }),
      )
      .mockResolvedValueOnce(jsonResponse({ credentialId: 'cred-789' }))
    const startAuthenticationCeremony = vi
      .fn()
      .mockRejectedValueOnce(new Error('NotAllowedError'))
      .mockResolvedValueOnce({ id: 'cred-789' })
    const navigate = vi.fn()
    const storage = createStorage('stale-cred-hint')

    const model = createActivationModel({
      token: 'invite-token',
      fetchImpl: fetchImpl as unknown as typeof fetch,
      startAuthenticationCeremony,
      navigate,
      storage,
    })

    await model.startLogin()

    expect(fetchImpl).toHaveBeenNthCalledWith(
      1,
      '/api/auth/login/options',
      expect.objectContaining({ body: JSON.stringify({ credentialIdHint: 'stale-cred-hint' }) }),
    )
    expect(storage.clear).toHaveBeenCalled()
    expect(fetchImpl).toHaveBeenNthCalledWith(
      2,
      '/api/auth/login/options',
      expect.objectContaining({ body: JSON.stringify({}) }),
    )
    expect(startAuthenticationCeremony).toHaveBeenNthCalledWith(2, {
      optionsJSON: { challenge: 'auth-challenge-discoverable' },
    })
    expect(storage.set).toHaveBeenCalledWith('cred-789')
    expect(navigate).toHaveBeenCalledWith('/')
    expect(model.status()).toBe('idle')
  })

  it('clears a stale credential hint and retries discoverable when the hinted verify is rejected', async () => {
    const fetchImpl = vi
      .fn()
      .mockResolvedValueOnce(jsonResponse({ options: { challenge: 'auth-challenge-hinted' } }))
      .mockResolvedValueOnce(jsonResponse({ code: 'device_not_found' }, 404))
      .mockResolvedValueOnce(
        jsonResponse({ options: { challenge: 'auth-challenge-discoverable' } }),
      )
      .mockResolvedValueOnce(jsonResponse({ credentialId: 'cred-999' }))
    const startAuthenticationCeremony = vi
      .fn()
      .mockResolvedValueOnce({ id: 'stale-cred-hint' })
      .mockResolvedValueOnce({ id: 'cred-999' })
    const navigate = vi.fn()
    const storage = createStorage('stale-cred-hint')

    const model = createActivationModel({
      token: 'invite-token',
      fetchImpl: fetchImpl as unknown as typeof fetch,
      startAuthenticationCeremony,
      navigate,
      storage,
    })

    await model.startLogin()

    expect(storage.clear).toHaveBeenCalled()
    expect(fetchImpl).toHaveBeenNthCalledWith(
      3,
      '/api/auth/login/options',
      expect.objectContaining({ body: JSON.stringify({}) }),
    )
    expect(storage.set).toHaveBeenCalledWith('cred-999')
    expect(navigate).toHaveBeenCalledWith('/')
    expect(model.status()).toBe('idle')
  })
})
