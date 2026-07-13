import { context } from '@reatom/core'
import { makeScriptedHttp } from '@shared/http/test/scripted-http'
// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest'

import { makeAddDeviceModel } from './add-device-model'

afterEach(() => {
  vi.useRealTimers()
  context.reset()
})

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
    const model = makeAddDeviceModel({ currentOrigin: CURRENT_ORIGIN })

    expect(model.extractAddCode('https://host/add-device?token=K7QP3M9X')).toBe('K7QP3M9X')
  })

  it('accepts a bare dashed code with no URL', () => {
    const model = makeAddDeviceModel({ currentOrigin: CURRENT_ORIGIN })

    expect(model.extractAddCode('K7QP-3M9X')).toBe('K7QP3M9X')
  })

  it('accepts a full URL with a dashed token and normalizes it', () => {
    const model = makeAddDeviceModel({ currentOrigin: CURRENT_ORIGIN })

    expect(model.extractAddCode('https://host/add-device?token=K7QP-3M9X')).toBe('K7QP3M9X')
  })

  it('rejects a URL on a different origin', () => {
    const model = makeAddDeviceModel({ currentOrigin: CURRENT_ORIGIN })

    expect(model.extractAddCode('https://evil.example/add-device?token=K7QP3M9X')).toBeNull()
  })

  it('rejects a URL on the right origin but the wrong path', () => {
    const model = makeAddDeviceModel({ currentOrigin: CURRENT_ORIGIN })

    expect(model.extractAddCode('https://host/other-path?token=K7QP3M9X')).toBeNull()
  })

  it('rejects junk text that is not a URL or a valid code', () => {
    const model = makeAddDeviceModel({ currentOrigin: CURRENT_ORIGIN })

    expect(model.extractAddCode('not a real code!!')).toBeNull()
    expect(model.extractAddCode('')).toBeNull()
  })
})

describe('initial mode', () => {
  it('starts in scanning mode when scan is requested', () => {
    const model = makeAddDeviceModel({
      currentOrigin: CURRENT_ORIGIN,
      scan: true,
      http: makeScriptedHttp({}).http,
    })
    expect(model.mode()).toBe('scanning')
  })

  it('starts in choose mode by default', () => {
    const model = makeAddDeviceModel({
      currentOrigin: CURRENT_ORIGIN,
      http: makeScriptedHttp({}).http,
    })
    expect(model.mode()).toBe('choose')
  })
})

describe('init (auto-submit a code embedded in the activation link)', () => {
  it('starts on registering and ignores scan=1 when a valid code is present in the URL', () => {
    const model = makeAddDeviceModel({
      currentOrigin: CURRENT_ORIGIN,
      token: 'K7QP-3M9X',
      // scan=1 is explicitly requested but must be ignored: a present code wins,
      // so we never open the camera.
      scan: true,
      http: makeScriptedHttp({}).http,
    })

    expect(model.mode()).toBe('registering')
    expect(model.token()).toBe('K7QP3M9X')
  })

  it('auto-validates the URL code and lands on registering with the owner name', async () => {
    const { http, calls } = makeScriptedHttp({
      '/api/auth/devices/register/options': [
        {
          status: 200,
          body: {
            options: { challenge: 'add-device-challenge', user: { displayName: 'Анна Ковалёва' } },
          },
        },
      ],
    })
    const model = makeAddDeviceModel({
      currentOrigin: CURRENT_ORIGIN,
      token: 'K7QP-3M9X',
      http,
    })

    await model.init()

    expect(model.token()).toBe('K7QP3M9X')
    expect(model.mode()).toBe('registering')
    expect(model.error()).toBeNull()
    expect(model.ownerName()).toBe('Анна Ковалёва')
    expect(calls.filter((c) => c.url === '/api/auth/devices/register/options')).toHaveLength(1)
  })

  it('falls back to manual entry with an error when the server rejects the URL code', async () => {
    const { http } = makeScriptedHttp({
      '/api/auth/devices/register/options': [{ status: 404, body: { code: 'add_token_invalid' } }],
    })
    const model = makeAddDeviceModel({
      currentOrigin: CURRENT_ORIGIN,
      token: 'K7QP-3M9X',
      http,
    })

    await model.init()

    expect(model.mode()).toBe('manual')
    expect(model.error()).not.toBeNull()
  })

  it('is idempotent: a second init call (e.g. StrictMode double-invoke) does not re-fetch', async () => {
    const { http, calls } = makeScriptedHttp({
      '/api/auth/devices/register/options': [
        { status: 200, body: { options: { challenge: 'c', user: { displayName: 'A' } } } },
      ],
    })
    const model = makeAddDeviceModel({
      currentOrigin: CURRENT_ORIGIN,
      token: 'K7QP-3M9X',
      http,
    })

    await model.init()
    await model.init()

    expect(calls.filter((c) => c.url === '/api/auth/devices/register/options')).toHaveLength(1)
  })

  it('does nothing on init when the URL has no code, leaving the choose flow untouched', async () => {
    const { http, calls } = makeScriptedHttp({})
    const model = makeAddDeviceModel({
      currentOrigin: CURRENT_ORIGIN,
      http,
    })

    expect(model.mode()).toBe('choose')
    await model.init()

    expect(model.mode()).toBe('choose')
    expect(calls).toHaveLength(0)
  })

  it('keeps scanning on init when scan=1 is requested and there is no URL code', async () => {
    const model = makeAddDeviceModel({
      currentOrigin: CURRENT_ORIGIN,
      scan: true,
      http: makeScriptedHttp({}).http,
    })

    expect(model.mode()).toBe('scanning')
    await model.init()

    expect(model.mode()).toBe('scanning')
  })

  it('ignores a malformed (non-normalizable) URL code, keeping the choose flow', async () => {
    const { http, calls } = makeScriptedHttp({})
    const model = makeAddDeviceModel({
      currentOrigin: CURRENT_ORIGIN,
      token: 'not-a-real-code',
      http,
    })

    expect(model.mode()).toBe('choose')
    await model.init()

    expect(model.mode()).toBe('choose')
    expect(calls).toHaveLength(0)
  })
})

describe('submitManual', () => {
  it('sets an error and never calls fetch when the input is not a valid code', async () => {
    const { http, calls } = makeScriptedHttp({})
    const model = makeAddDeviceModel({
      currentOrigin: CURRENT_ORIGIN,
      http,
    })

    await model.submitManual('not a real code!!')

    expect(model.error()).not.toBeNull()
    expect(model.mode()).not.toBe('registering')
    expect(calls).toHaveLength(0)
  })

  it('returns to manual mode with an error when the server rejects a well-formed code (invalid/expired/exhausted token), instead of stranding the user on registering', async () => {
    const { http } = makeScriptedHttp({
      '/api/auth/devices/register/options': [{ status: 404, body: { code: 'add_token_invalid' } }],
    })
    const model = makeAddDeviceModel({
      currentOrigin: CURRENT_ORIGIN,
      http,
    })
    model.mode.set('manual')

    await model.submitManual('K7QP-3M9X')

    expect(model.mode()).toBe('manual')
    expect(model.error()).not.toBeNull()
  })

  it('exposes the account owner display name (for the registering heading) once register/options succeeds', async () => {
    const { http } = makeScriptedHttp({
      '/api/auth/devices/register/options': [
        {
          status: 200,
          body: {
            options: { challenge: 'add-device-challenge', user: { displayName: 'Анна Ковалёва' } },
          },
        },
      ],
      '/api/auth/devices/register/verify': [{ status: 200, body: { credentialId: 'cred-b' } }],
    })
    const model = makeAddDeviceModel({
      currentOrigin: CURRENT_ORIGIN,
      http,
      startRegistrationCeremony: vi.fn().mockResolvedValue({ id: 'cred-b' }),
      storage: createStorage(),
    })

    await model.submitManual('K7QP-3M9X')

    expect(model.ownerName()).toBe('Анна Ковалёва')
  })
})

describe('stageScannedCode', () => {
  it('stages the scanned code and moves to registering once the server confirms it, exposing the owner name', async () => {
    const { http } = makeScriptedHttp({
      '/api/auth/devices/register/options': [
        {
          status: 200,
          body: {
            options: { challenge: 'add-device-challenge', user: { displayName: 'Анна Ковалёва' } },
          },
        },
      ],
    })
    const model = makeAddDeviceModel({
      currentOrigin: CURRENT_ORIGIN,
      http,
    })

    await model.stageScannedCode('K7QP-3M9X')

    expect(model.token()).toBe('K7QP3M9X')
    expect(model.mode()).toBe('registering')
    expect(model.error()).toBeNull()
    expect(model.ownerName()).toBe('Анна Ковалёва')
  })

  it('returns to manual mode with an error when the server rejects the scanned code, instead of stranding the user on registering', async () => {
    const { http } = makeScriptedHttp({
      '/api/auth/devices/register/options': [{ status: 404, body: { code: 'add_token_invalid' } }],
    })
    const model = makeAddDeviceModel({
      currentOrigin: CURRENT_ORIGIN,
      http,
    })

    await model.stageScannedCode('K7QP-3M9X')

    expect(model.mode()).toBe('manual')
    expect(model.error()).not.toBeNull()
  })
})

describe('startRegistration ceremony/verify failures', () => {
  it('keeps mode on registering (not manual) when the WebAuthn ceremony fails, so the existing in-place error row can be used to retry', async () => {
    const { http } = makeScriptedHttp({
      '/api/auth/devices/register/options': [
        { status: 200, body: { options: { challenge: 'c' } } },
      ],
    })
    const startRegistrationCeremony = vi.fn().mockRejectedValue(new Error('user cancelled'))
    const model = makeAddDeviceModel({
      currentOrigin: CURRENT_ORIGIN,
      http,
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
    const { http } = makeScriptedHttp({
      '/api/auth/devices/register/options': [
        { status: 200, body: { options: { challenge: 'c' } } },
      ],
      '/api/auth/devices/register/verify': [{ status: 409, body: {} }],
    })
    const model = makeAddDeviceModel({
      currentOrigin: CURRENT_ORIGIN,
      http,
      startRegistrationCeremony: vi.fn().mockResolvedValue({ id: 'cred-b' }),
    })
    model.token.set('K7QP3M9X')

    await model.startRegistration()

    expect(model.mode()).toBe('registering')
    expect(model.error()).not.toBeNull()
  })
})

describe('registration + polling flow', () => {
  it('goes registering -> waiting -> done, claims a session, and navigates on approval', async () => {
    vi.useFakeTimers()

    const { http, calls } = makeScriptedHttp({
      '/api/auth/devices/register/options': [
        { status: 200, body: { options: { challenge: 'add-device-challenge' } } },
      ],
      '/api/auth/devices/register/verify': [{ status: 200, body: { credentialId: 'cred-b' } }],
      '/api/auth/devices/pending-status': [
        { status: 200, body: { status: 'pending' } },
        { status: 200, body: { status: 'approved' } },
      ],
      '/api/auth/devices/claim-session': [
        { status: 200, body: { status: 'approved', credentialId: 'cred-b' } },
      ],
    })
    const startRegistrationCeremony = vi.fn().mockResolvedValue({ id: 'cred-b', rawId: 'raw' })
    const navigate = vi.fn()
    const storage = createStorage()

    const model = makeAddDeviceModel({
      currentOrigin: CURRENT_ORIGIN,
      http,
      startRegistrationCeremony,
      navigate,
      storage,
    })

    await model.submitManual('K7QP-3M9X')

    expect(model.token()).toBe('K7QP3M9X')
    expect(startRegistrationCeremony).toHaveBeenCalledWith({
      optionsJSON: { challenge: 'add-device-challenge' },
    })
    expect(model.mode()).toBe('waiting')

    // Connect the poller the way the mounted 'waiting' screen does; the interval
    // only runs while `poll` is connected (withConnectHook).
    model.poll.subscribe(() => {})

    // First poll tick: still pending.
    await vi.advanceTimersByTimeAsync(2_000)
    expect(model.mode()).toBe('waiting')

    // Second poll tick: approved -> claim-session mints the session, then navigate.
    await vi.advanceTimersByTimeAsync(2_000)

    const claimCall = calls.find((c) => c.url === '/api/auth/devices/claim-session')
    expect(claimCall).toEqual({
      method: 'POST',
      url: '/api/auth/devices/claim-session',
      json: undefined,
    })
    // No second WebAuthn ceremony: the login endpoints are never touched.
    expect(calls.some((c) => c.url === '/api/auth/login/options')).toBe(false)
    expect(calls.some((c) => c.url === '/api/auth/login/verify')).toBe(false)
    expect(storage.set).toHaveBeenCalledWith('cred-b')
    expect(model.mode()).toBe('done')
    expect(navigate).toHaveBeenCalledWith('/')

    // Polling has stopped -- no further pending-status calls on more ticks.
    const callsAfterDone = calls.length
    await vi.advanceTimersByTimeAsync(10_000)
    expect(calls.length).toBe(callsAfterDone)
  })

  it('keeps waiting and surfaces an error when the claim fails, then resumes polling', async () => {
    vi.useFakeTimers()

    const { http } = makeScriptedHttp({
      '/api/auth/devices/register/options': [
        { status: 200, body: { options: { challenge: 'add-device-challenge' } } },
      ],
      '/api/auth/devices/register/verify': [{ status: 200, body: { credentialId: 'cred-b' } }],
      // First poll: approved -> claim fails (500). Later poll: pending again.
      '/api/auth/devices/pending-status': [
        { status: 200, body: { status: 'approved' } },
        { status: 200, body: { status: 'pending' } },
      ],
      '/api/auth/devices/claim-session': [{ status: 500, body: {} }],
    })
    const startRegistrationCeremony = vi.fn().mockResolvedValue({ id: 'cred-b' })
    const navigate = vi.fn()

    const model = makeAddDeviceModel({
      currentOrigin: CURRENT_ORIGIN,
      http,
      startRegistrationCeremony,
      navigate,
      storage: createStorage(),
    })

    await model.submitManual('K7QP-3M9X')
    expect(model.mode()).toBe('waiting')
    model.poll.subscribe(() => {})

    // Approved poll -> claim 500 -> stay on waiting with an error, do not navigate.
    await vi.advanceTimersByTimeAsync(2_000)
    expect(model.mode()).toBe('waiting')
    expect(model.error()).not.toBeNull()
    expect(navigate).not.toHaveBeenCalled()

    // Polling resumed: the next (pending) tick recovers and clears the error.
    await vi.advanceTimersByTimeAsync(2_000)
    expect(model.mode()).toBe('waiting')
    expect(model.error()).toBeNull()
  })

  it('single-flights the claim so two overlapping approved polls claim at most once', async () => {
    const { http, calls } = makeScriptedHttp({
      '/api/auth/devices/pending-status': [
        { status: 200, body: { status: 'approved' } },
        { status: 200, body: { status: 'approved' } },
      ],
      '/api/auth/devices/claim-session': [
        { status: 200, body: { status: 'approved', credentialId: 'cred-b' } },
      ],
    })
    const navigate = vi.fn()
    const storage = createStorage()

    const model = makeAddDeviceModel({
      currentOrigin: CURRENT_ORIGIN,
      http,
      navigate,
      storage,
    })
    model.mode.set('waiting')

    // Two poll passes fired concurrently (models a slow GET overlapping the next
    // tick): both see 'approved', but the single-flight guard admits one claim.
    await Promise.all([model.pollPendingStatus(), model.pollPendingStatus()])

    const claimCalls = calls.filter((c) => c.url === '/api/auth/devices/claim-session')
    expect(claimCalls).toHaveLength(1)
    expect(storage.set).toHaveBeenCalledWith('cred-b')
    expect(navigate).toHaveBeenCalledWith('/')
  })

  it('transitions to rejected when a poll reports the device was denied', async () => {
    vi.useFakeTimers()

    const { http, calls } = makeScriptedHttp({
      '/api/auth/devices/register/options': [
        { status: 200, body: { options: { challenge: 'add-device-challenge' } } },
      ],
      '/api/auth/devices/register/verify': [{ status: 200, body: { credentialId: 'cred-b' } }],
      '/api/auth/devices/pending-status': [{ status: 200, body: { status: 'denied' } }],
    })
    const startRegistrationCeremony = vi.fn().mockResolvedValue({ id: 'cred-b' })
    const navigate = vi.fn()

    const model = makeAddDeviceModel({
      currentOrigin: CURRENT_ORIGIN,
      http,
      startRegistrationCeremony,
      navigate,
      storage: createStorage(),
    })

    await model.submitManual('K7QP-3M9X')
    expect(model.mode()).toBe('waiting')
    model.poll.subscribe(() => {})

    await vi.advanceTimersByTimeAsync(2_000)

    expect(model.mode()).toBe('rejected')
    expect(navigate).not.toHaveBeenCalled()

    // Polling has stopped -- no further pending-status calls.
    const callsAfterRejected = calls.length
    await vi.advanceTimersByTimeAsync(10_000)
    expect(calls.length).toBe(callsAfterRejected)
  })

  it('clears a stale error once a later poll tick succeeds again', async () => {
    vi.useFakeTimers()

    const { http } = makeScriptedHttp({
      '/api/auth/devices/register/options': [
        { status: 200, body: { options: { challenge: 'add-device-challenge' } } },
      ],
      '/api/auth/devices/register/verify': [{ status: 200, body: { credentialId: 'cred-b' } }],
      // First poll tick: a transient server error. Second poll tick: recovered -- still pending.
      '/api/auth/devices/pending-status': [
        { status: 500, body: {} },
        { status: 200, body: { status: 'pending' } },
      ],
    })
    const startRegistrationCeremony = vi.fn().mockResolvedValue({ id: 'cred-b' })

    const model = makeAddDeviceModel({
      currentOrigin: CURRENT_ORIGIN,
      http,
      startRegistrationCeremony,
      storage: createStorage(),
    })

    await model.submitManual('K7QP-3M9X')
    expect(model.mode()).toBe('waiting')
    model.poll.subscribe(() => {})

    await vi.advanceTimersByTimeAsync(2_000)
    expect(model.error()).not.toBeNull()

    await vi.advanceTimersByTimeAsync(2_000)
    expect(model.error()).toBeNull()
    expect(model.mode()).toBe('waiting')
  })

  it('gives up polling after 10 minutes without a resolution', async () => {
    vi.useFakeTimers()

    // A fixed 'pending' script entry is repeatedly reused because
    // makeScriptedHttp shifts one step per call; only the last entry, once
    // shifted away, would leave the queue empty and throw -- so provide
    // enough 'pending' steps to cover every expected poll tick within the
    // window (300 real polls fit inside the 10-minute window).
    const { http, calls } = makeScriptedHttp({
      '/api/auth/devices/register/options': [
        { status: 200, body: { options: { challenge: 'add-device-challenge' } } },
      ],
      '/api/auth/devices/register/verify': [{ status: 200, body: { credentialId: 'cred-b' } }],
      '/api/auth/devices/pending-status': Array.from({ length: 300 }, () => ({
        status: 200,
        body: { status: 'pending' },
      })),
    })
    const startRegistrationCeremony = vi.fn().mockResolvedValue({ id: 'cred-b' })

    const model = makeAddDeviceModel({
      currentOrigin: CURRENT_ORIGIN,
      http,
      startRegistrationCeremony,
      storage: createStorage(),
    })

    await model.submitManual('K7QP-3M9X')
    expect(model.mode()).toBe('waiting')
    model.poll.subscribe(() => {})

    // 300 real polls fit inside the 10-minute window (2s * 300 = 600_000ms);
    // give-up is only decided at the next (301st) tick, so the window has to
    // be crossed by one more interval to observe it.
    await vi.advanceTimersByTimeAsync(10 * 60_000)
    expect(model.error()).toBeNull()
    const callsWithinWindow = calls.length
    expect(callsWithinWindow).toBe(2 + 300)

    await vi.advanceTimersByTimeAsync(2_000)

    expect(model.mode()).toBe('waiting')
    expect(model.error()).not.toBeNull()
    // The give-up tick itself never calls pending-status again.
    expect(calls.length).toBe(callsWithinWindow)

    const callsAfterGiveUp = calls.length
    await vi.advanceTimersByTimeAsync(10_000)
    expect(calls.length).toBe(callsAfterGiveUp)
  })
})
