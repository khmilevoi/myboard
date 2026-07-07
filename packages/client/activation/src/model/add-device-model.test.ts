import { context } from '@reatom/core'
// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest'

import { createAddDeviceModel } from './add-device-model'

afterEach(() => {
  vi.useRealTimers()
  context.reset()
})

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

const CURRENT_ORIGIN = 'https://host'

describe('extractAddCode', () => {
  it('accepts a full URL with a bare token and normalizes it', () => {
    const model = createAddDeviceModel({ currentOrigin: CURRENT_ORIGIN })

    expect(model.extractAddCode('https://host/add-device?token=K7QP3M9X')).toBe('K7QP3M9X')
  })

  it('accepts a bare dashed code with no URL', () => {
    const model = createAddDeviceModel({ currentOrigin: CURRENT_ORIGIN })

    expect(model.extractAddCode('K7QP-3M9X')).toBe('K7QP3M9X')
  })

  it('accepts a full URL with a dashed token and normalizes it', () => {
    const model = createAddDeviceModel({ currentOrigin: CURRENT_ORIGIN })

    expect(model.extractAddCode('https://host/add-device?token=K7QP-3M9X')).toBe('K7QP3M9X')
  })

  it('rejects a URL on a different origin', () => {
    const model = createAddDeviceModel({ currentOrigin: CURRENT_ORIGIN })

    expect(model.extractAddCode('https://evil.example/add-device?token=K7QP3M9X')).toBeNull()
  })

  it('rejects a URL on the right origin but the wrong path', () => {
    const model = createAddDeviceModel({ currentOrigin: CURRENT_ORIGIN })

    expect(model.extractAddCode('https://host/other-path?token=K7QP3M9X')).toBeNull()
  })

  it('rejects junk text that is not a URL or a valid code', () => {
    const model = createAddDeviceModel({ currentOrigin: CURRENT_ORIGIN })

    expect(model.extractAddCode('not a real code!!')).toBeNull()
    expect(model.extractAddCode('')).toBeNull()
  })
})

describe('submitManual', () => {
  it('sets an error and never calls fetch when the input is not a valid code', async () => {
    const fetchImpl = vi.fn()
    const model = createAddDeviceModel({
      currentOrigin: CURRENT_ORIGIN,
      fetchImpl: fetchImpl as unknown as typeof fetch,
    })

    await model.submitManual('not a real code!!')

    expect(model.error()).not.toBeNull()
    expect(model.mode()).not.toBe('registering')
    expect(fetchImpl).not.toHaveBeenCalled()
  })

  it('returns to manual mode with an error when the server rejects a well-formed code (invalid/expired/exhausted token), instead of stranding the user on registering', async () => {
    const fetchImpl = vi
      .fn()
      .mockResolvedValueOnce(jsonResponse({ code: 'add_token_invalid' }, 404))
    const model = createAddDeviceModel({
      currentOrigin: CURRENT_ORIGIN,
      fetchImpl: fetchImpl as unknown as typeof fetch,
    })
    model.mode.set('manual')

    await model.submitManual('K7QP-3M9X')

    expect(model.mode()).toBe('manual')
    expect(model.error()).not.toBeNull()
  })

  it('exposes the account owner display name (for the registering heading) once register/options succeeds', async () => {
    const fetchImpl = vi
      .fn()
      .mockResolvedValueOnce(
        jsonResponse({
          options: { challenge: 'add-device-challenge', user: { displayName: 'Анна Ковалёва' } },
        }),
      )
      .mockResolvedValueOnce(jsonResponse({ credentialId: 'cred-b' }))
    const model = createAddDeviceModel({
      currentOrigin: CURRENT_ORIGIN,
      fetchImpl: fetchImpl as unknown as typeof fetch,
      startRegistrationCeremony: vi.fn().mockResolvedValue({ id: 'cred-b' }),
      storage: createStorage(),
    })

    await model.submitManual('K7QP-3M9X')

    expect(model.ownerName()).toBe('Анна Ковалёва')
  })
})

describe('stageScannedCode', () => {
  it('stages the scanned code and moves to registering once the server confirms it, exposing the owner name', async () => {
    const fetchImpl = vi.fn().mockResolvedValueOnce(
      jsonResponse({
        options: { challenge: 'add-device-challenge', user: { displayName: 'Анна Ковалёва' } },
      }),
    )
    const model = createAddDeviceModel({
      currentOrigin: CURRENT_ORIGIN,
      fetchImpl: fetchImpl as unknown as typeof fetch,
    })

    await model.stageScannedCode('K7QP-3M9X')

    expect(model.token()).toBe('K7QP3M9X')
    expect(model.mode()).toBe('registering')
    expect(model.error()).toBeNull()
    expect(model.ownerName()).toBe('Анна Ковалёва')
  })

  it('returns to manual mode with an error when the server rejects the scanned code, instead of stranding the user on registering', async () => {
    const fetchImpl = vi
      .fn()
      .mockResolvedValueOnce(jsonResponse({ code: 'add_token_invalid' }, 404))
    const model = createAddDeviceModel({
      currentOrigin: CURRENT_ORIGIN,
      fetchImpl: fetchImpl as unknown as typeof fetch,
    })

    await model.stageScannedCode('K7QP-3M9X')

    expect(model.mode()).toBe('manual')
    expect(model.error()).not.toBeNull()
  })
})

describe('startRegistration ceremony/verify failures', () => {
  it('keeps mode on registering (not manual) when the WebAuthn ceremony fails, so the existing in-place error row can be used to retry', async () => {
    const fetchImpl = vi.fn().mockResolvedValueOnce(jsonResponse({ options: { challenge: 'c' } }))
    const startRegistrationCeremony = vi.fn().mockRejectedValue(new Error('user cancelled'))
    const model = createAddDeviceModel({
      currentOrigin: CURRENT_ORIGIN,
      fetchImpl: fetchImpl as unknown as typeof fetch,
      startRegistrationCeremony,
    })
    // Simulates having already reached 'registering' (via submitManual or
    // stageScannedCode having already validated the code) before the
    // ceremony itself is attempted -- a cancelled/failed WebAuthn prompt
    // (e.g. the user backs out of Face ID/Touch ID) must not re-validate
    // the code or bounce back to the manual-entry screen; it should stay
    // right here so the same "Создать passkey" button can be retried.
    model.token.set('K7QP3M9X')

    await model.startRegistration()

    expect(model.mode()).toBe('registering')
    expect(model.error()).not.toBeNull()
  })

  it('keeps mode on registering (not manual) when register/verify is rejected by the server', async () => {
    const fetchImpl = vi
      .fn()
      .mockResolvedValueOnce(jsonResponse({ options: { challenge: 'c' } }))
      .mockResolvedValueOnce(jsonResponse({}, 409))
    const model = createAddDeviceModel({
      currentOrigin: CURRENT_ORIGIN,
      fetchImpl: fetchImpl as unknown as typeof fetch,
      startRegistrationCeremony: vi.fn().mockResolvedValue({ id: 'cred-b' }),
    })
    model.token.set('K7QP3M9X')

    await model.startRegistration()

    expect(model.mode()).toBe('registering')
    expect(model.error()).not.toBeNull()
  })
})

describe('registration + polling flow', () => {
  it('goes registering -> waiting -> done, logs in, and navigates on approval', async () => {
    vi.useFakeTimers()

    const fetchImpl = vi
      .fn()
      .mockResolvedValueOnce(jsonResponse({ options: { challenge: 'add-device-challenge' } }))
      .mockResolvedValueOnce(jsonResponse({ credentialId: 'cred-b' }))
      .mockResolvedValueOnce(jsonResponse({ status: 'pending' }))
      .mockResolvedValueOnce(jsonResponse({ status: 'approved' }))
      .mockResolvedValueOnce(jsonResponse({ options: { challenge: 'login-challenge' } }))
      .mockResolvedValueOnce(jsonResponse({ credentialId: 'cred-b' }))
    const startRegistrationCeremony = vi.fn().mockResolvedValue({ id: 'cred-b', rawId: 'raw' })
    const startAuthenticationCeremony = vi.fn().mockResolvedValue({ id: 'cred-b' })
    const navigate = vi.fn()
    const storage = createStorage()

    const model = createAddDeviceModel({
      currentOrigin: CURRENT_ORIGIN,
      fetchImpl: fetchImpl as unknown as typeof fetch,
      startRegistrationCeremony,
      startAuthenticationCeremony,
      navigate,
      storage,
    })

    await model.submitManual('K7QP-3M9X')

    expect(model.token()).toBe('K7QP3M9X')
    expect(fetchImpl).toHaveBeenNthCalledWith(
      1,
      '/api/auth/devices/register/options',
      expect.objectContaining({
        method: 'POST',
        credentials: 'same-origin',
        headers: expect.objectContaining({ 'X-Requested-With': 'MyBoard' }),
        body: JSON.stringify({ token: 'K7QP3M9X' }),
      }),
    )
    expect(startRegistrationCeremony).toHaveBeenCalledWith({
      optionsJSON: { challenge: 'add-device-challenge' },
    })
    expect(fetchImpl).toHaveBeenNthCalledWith(
      2,
      '/api/auth/devices/register/verify',
      expect.objectContaining({
        body: JSON.stringify({
          token: 'K7QP3M9X',
          attestationResponse: { id: 'cred-b', rawId: 'raw' },
        }),
      }),
    )
    expect(model.mode()).toBe('waiting')

    // First poll tick: still pending.
    await vi.advanceTimersByTimeAsync(2_000)
    expect(fetchImpl).toHaveBeenNthCalledWith(
      3,
      '/api/auth/devices/pending-status',
      expect.objectContaining({ method: 'GET', credentials: 'same-origin' }),
    )
    expect(model.mode()).toBe('waiting')

    // Second poll tick: approved -> runs a normal login, then navigates.
    await vi.advanceTimersByTimeAsync(2_000)

    expect(fetchImpl).toHaveBeenNthCalledWith(
      5,
      '/api/auth/login/options',
      expect.objectContaining({ body: JSON.stringify({ credentialIdHint: 'cred-b' }) }),
    )
    expect(startAuthenticationCeremony).toHaveBeenCalledWith({
      optionsJSON: { challenge: 'login-challenge' },
    })
    expect(storage.set).toHaveBeenCalledWith('cred-b')
    expect(model.mode()).toBe('done')
    expect(navigate).toHaveBeenCalledWith('/')

    // Polling has stopped -- no further pending-status calls on more ticks.
    const callsAfterDone = fetchImpl.mock.calls.length
    await vi.advanceTimersByTimeAsync(10_000)
    expect(fetchImpl.mock.calls.length).toBe(callsAfterDone)
  })

  it('transitions to rejected when a poll reports the device was denied', async () => {
    vi.useFakeTimers()

    const fetchImpl = vi
      .fn()
      .mockResolvedValueOnce(jsonResponse({ options: { challenge: 'add-device-challenge' } }))
      .mockResolvedValueOnce(jsonResponse({ credentialId: 'cred-b' }))
      .mockResolvedValueOnce(jsonResponse({ status: 'denied' }))
    const startRegistrationCeremony = vi.fn().mockResolvedValue({ id: 'cred-b' })
    const navigate = vi.fn()

    const model = createAddDeviceModel({
      currentOrigin: CURRENT_ORIGIN,
      fetchImpl: fetchImpl as unknown as typeof fetch,
      startRegistrationCeremony,
      navigate,
      storage: createStorage(),
    })

    await model.submitManual('K7QP-3M9X')
    expect(model.mode()).toBe('waiting')

    await vi.advanceTimersByTimeAsync(2_000)

    expect(model.mode()).toBe('rejected')
    expect(navigate).not.toHaveBeenCalled()

    // Polling has stopped -- no further pending-status calls.
    const callsAfterRejected = fetchImpl.mock.calls.length
    await vi.advanceTimersByTimeAsync(10_000)
    expect(fetchImpl.mock.calls.length).toBe(callsAfterRejected)
  })

  it('clears a stale error once a later poll tick succeeds again', async () => {
    vi.useFakeTimers()

    const fetchImpl = vi
      .fn()
      .mockResolvedValueOnce(jsonResponse({ options: { challenge: 'add-device-challenge' } }))
      .mockResolvedValueOnce(jsonResponse({ credentialId: 'cred-b' }))
      // First poll tick: a transient server error.
      .mockResolvedValueOnce(jsonResponse({}, 500))
      // Second poll tick: recovered -- still pending.
      .mockResolvedValueOnce(jsonResponse({ status: 'pending' }))
    const startRegistrationCeremony = vi.fn().mockResolvedValue({ id: 'cred-b' })

    const model = createAddDeviceModel({
      currentOrigin: CURRENT_ORIGIN,
      fetchImpl: fetchImpl as unknown as typeof fetch,
      startRegistrationCeremony,
      storage: createStorage(),
    })

    await model.submitManual('K7QP-3M9X')
    expect(model.mode()).toBe('waiting')

    await vi.advanceTimersByTimeAsync(2_000)
    expect(model.error()).not.toBeNull()

    await vi.advanceTimersByTimeAsync(2_000)
    expect(model.error()).toBeNull()
    expect(model.mode()).toBe('waiting')
  })

  it('gives up polling after 10 minutes without a resolution', async () => {
    vi.useFakeTimers()

    // `mockResolvedValue` (no "Once") would replay the *same* Response
    // instance on every call -- and a Response body can only be read once,
    // so a second `.json()` read throws and would surface as an unrelated
    // "invalid server response" error, masking whether the give-up logic
    // itself ever ran. `mockImplementation` builds a fresh Response per call.
    const fetchImpl = vi
      .fn()
      .mockResolvedValueOnce(jsonResponse({ options: { challenge: 'add-device-challenge' } }))
      .mockResolvedValueOnce(jsonResponse({ credentialId: 'cred-b' }))
      .mockImplementation(async () => jsonResponse({ status: 'pending' }))
    const startRegistrationCeremony = vi.fn().mockResolvedValue({ id: 'cred-b' })

    const model = createAddDeviceModel({
      currentOrigin: CURRENT_ORIGIN,
      fetchImpl: fetchImpl as unknown as typeof fetch,
      startRegistrationCeremony,
      storage: createStorage(),
    })

    await model.submitManual('K7QP-3M9X')
    expect(model.mode()).toBe('waiting')

    // 300 real polls fit inside the 10-minute window (2s * 300 = 600_000ms);
    // give-up is only decided at the next (301st) tick, so the window has to
    // be crossed by one more interval to observe it.
    await vi.advanceTimersByTimeAsync(10 * 60_000)
    expect(model.error()).toBeNull()
    const callsWithinWindow = fetchImpl.mock.calls.length
    expect(callsWithinWindow).toBe(2 + 300)

    await vi.advanceTimersByTimeAsync(2_000)

    expect(model.mode()).toBe('waiting')
    expect(model.error()).not.toBeNull()
    // The give-up tick itself never calls pending-status again.
    expect(fetchImpl.mock.calls.length).toBe(callsWithinWindow)

    const callsAfterGiveUp = fetchImpl.mock.calls.length
    await vi.advanceTimersByTimeAsync(10_000)
    expect(fetchImpl.mock.calls.length).toBe(callsAfterGiveUp)
  })
})
