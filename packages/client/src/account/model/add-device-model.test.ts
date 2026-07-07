import { atom, context } from '@reatom/core'
// @vitest-environment jsdom
import type { AuthenticationResponseJSON } from '@simplewebauthn/browser'
import { afterEach, describe, expect, it, vi } from 'vitest'

import type { ResolvedTheme } from '@/shared/theme/types'

import { createAddDeviceModel } from './add-device-model'
import type { DeviceDto } from './devices-http'

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

const OPTIONS_BODY = { options: { challenge: 'add-token-challenge' } }
const authenticationResponse = { id: 'cred-this' } as unknown as AuthenticationResponseJSON

function mintBody(overrides: Partial<{ expiresAt: number }> = {}) {
  return {
    code: 'ABC123',
    formatted: 'ABC-123',
    url: 'http://localhost:5173/add-device?token=ABC123',
    expiresAt: Date.now() + 5 * 60_000,
    ...overrides,
  }
}

function createFakeAccountModel(pendingDevices: DeviceDto[] = []) {
  // Mirrors the real account-model.ts contract: `approve`/`deny` never throw
  // -- they catch internally and set their OWN `error` atom, then resolve
  // normally. `setError` is a test-only helper simulating that.
  let errorValue: string | null = null
  return {
    pending: () => pendingDevices,
    error: () => errorValue,
    approve: vi.fn(async (_credentialId: string) => {}),
    deny: vi.fn(async (_credentialId: string) => {}),
    setError: (value: string | null) => {
      errorValue = value
    },
  }
}

describe('start', () => {
  it('transitions idle -> verifying -> showing and exposes the mint result', async () => {
    const fetchImpl = vi
      .fn()
      .mockResolvedValueOnce(jsonResponse(OPTIONS_BODY))
      .mockResolvedValueOnce(jsonResponse(mintBody()))
    const startAuthenticationCeremony = vi.fn(async () => authenticationResponse)
    const model = createAddDeviceModel({
      fetchImpl: fetchImpl as unknown as typeof fetch,
      startAuthenticationCeremony,
      accountModel: createFakeAccountModel(),
    })

    expect(model.phase()).toBe('idle')

    const promise = model.start()
    expect(model.phase()).toBe('verifying')

    await promise

    expect(model.phase()).toBe('showing')
    expect(startAuthenticationCeremony).toHaveBeenCalledWith({
      optionsJSON: OPTIONS_BODY.options,
    })
    expect(model.code()).toBe('ABC123')
    expect(model.formatted()).toBe('ABC-123')
    expect(model.url()).toContain('/add-device?token=')
    expect(model.error()).toBeNull()
  })

  it('surfaces an options-fetch failure into error and reverts to idle', async () => {
    const fetchImpl = vi.fn().mockResolvedValueOnce(jsonResponse({ code: 'session_missing' }, 401))
    const model = createAddDeviceModel({
      fetchImpl: fetchImpl as unknown as typeof fetch,
      startAuthenticationCeremony: vi.fn(),
      accountModel: createFakeAccountModel(),
    })

    await model.start()

    expect(model.phase()).toBe('idle')
    expect(model.error()).toBe('Сессия истекла, войдите снова')
  })

  it('surfaces a cancelled/failed ceremony into error and reverts to idle', async () => {
    const fetchImpl = vi.fn().mockResolvedValueOnce(jsonResponse(OPTIONS_BODY))
    const startAuthenticationCeremony = vi.fn(async () => {
      throw new Error('NotAllowedError')
    })
    const model = createAddDeviceModel({
      fetchImpl: fetchImpl as unknown as typeof fetch,
      startAuthenticationCeremony,
      accountModel: createFakeAccountModel(),
    })

    await model.start()

    expect(model.phase()).toBe('idle')
    expect(model.error()).not.toBeNull()
  })
})

describe('countdown', () => {
  it('formats the remaining time as mm:ss and reaches 0:00 -> phase=expired once expiresAt passes', async () => {
    vi.useFakeTimers()
    vi.setSystemTime(new Date('2026-07-06T12:00:00.000Z'))

    const expiresAt = Date.now() + 5 * 60_000
    const fetchImpl = vi
      .fn()
      .mockResolvedValueOnce(jsonResponse(OPTIONS_BODY))
      .mockResolvedValueOnce(jsonResponse(mintBody({ expiresAt })))
    const model = createAddDeviceModel({
      fetchImpl: fetchImpl as unknown as typeof fetch,
      startAuthenticationCeremony: vi.fn(async () => authenticationResponse),
      accountModel: createFakeAccountModel(),
    })

    // Subscribing keeps the model's ticking `now` atom connected (matches
    // packages/widgets/clock's clockNow withConnectHook idiom) so the
    // interval actually advances under fake timers.
    const unsubscribe = model.countdown.subscribe(() => {})

    await model.start()

    expect(model.countdown()).toBe('5:00')

    vi.advanceTimersByTime(4 * 60_000 + 59_000)
    expect(model.countdown()).toBe('0:01')
    expect(model.phase()).toBe('showing')

    vi.advanceTimersByTime(2_000)
    expect(model.countdown()).toBe('0:00')
    expect(model.phase()).toBe('expired')

    unsubscribe()
  })

  it('reads 0:00 before any code has been minted', () => {
    const model = createAddDeviceModel({ accountModel: createFakeAccountModel() })

    expect(model.countdown()).toBe('0:00')
  })
})

describe('pendingDevice', () => {
  it('reads the pending device from the owning account model', () => {
    const pendingDevice: DeviceDto = {
      credentialId: 'cred-new',
      label: 'New phone',
      status: 'pending',
      addedVia: 'add-token',
      createdAt: 1,
      lastSeenAt: 1,
    }
    const model = createAddDeviceModel({ accountModel: createFakeAccountModel([pendingDevice]) })

    expect(model.pendingDevice()).toEqual(pendingDevice)
  })

  it('is null when the account model has no pending devices', () => {
    const model = createAddDeviceModel({ accountModel: createFakeAccountModel([]) })

    expect(model.pendingDevice()).toBeNull()
  })
})

describe('approve', () => {
  it('delegates to the account model with the pending device credentialId', async () => {
    const pendingDevice: DeviceDto = {
      credentialId: 'cred-new',
      label: 'New phone',
      status: 'pending',
      addedVia: 'add-token',
      createdAt: 1,
      lastSeenAt: 1,
    }
    const accountModel = createFakeAccountModel([pendingDevice])
    const model = createAddDeviceModel({ accountModel })

    await model.approve()

    expect(accountModel.approve).toHaveBeenCalledWith('cred-new')
    expect(model.phase()).toBe('idle')
  })

  it('does nothing when there is no pending device', async () => {
    const accountModel = createFakeAccountModel([])
    const model = createAddDeviceModel({ accountModel })

    await model.approve()

    expect(accountModel.approve).not.toHaveBeenCalled()
  })

  it("surfaces a delegate approve failure into this model's own error atom", async () => {
    const pendingDevice: DeviceDto = {
      credentialId: 'cred-new',
      label: 'New phone',
      status: 'pending',
      addedVia: 'add-token',
      createdAt: 1,
      lastSeenAt: 1,
    }
    const accountModel = createFakeAccountModel([pendingDevice])
    // The real account-model.ts's approve() never throws -- it sets its own
    // `error` atom (e.g. on a 409 device_limit response) and resolves
    // normally. Simulate that exact contract here.
    accountModel.approve.mockImplementation(async () => {
      accountModel.setError('Достигнут лимит устройств аккаунта')
    })
    const model = createAddDeviceModel({ accountModel })

    await model.approve()

    expect(model.error()).toBe('Достигнут лимит устройств аккаунта')
    expect(model.phase()).toBe('idle')
  })
})

describe('deny', () => {
  it('delegates to the account model with the pending device credentialId', async () => {
    const pendingDevice: DeviceDto = {
      credentialId: 'cred-new',
      label: 'New phone',
      status: 'pending',
      addedVia: 'add-token',
      createdAt: 1,
      lastSeenAt: 1,
    }
    const accountModel = createFakeAccountModel([pendingDevice])
    const model = createAddDeviceModel({ accountModel })

    await model.deny()

    expect(accountModel.deny).toHaveBeenCalledWith('cred-new')
  })

  it("surfaces a delegate deny failure into this model's own error atom", async () => {
    const pendingDevice: DeviceDto = {
      credentialId: 'cred-new',
      label: 'New phone',
      status: 'pending',
      addedVia: 'add-token',
      createdAt: 1,
      lastSeenAt: 1,
    }
    const accountModel = createFakeAccountModel([pendingDevice])
    accountModel.deny.mockImplementation(async () => {
      accountModel.setError('Сессия истекла, войдите снова')
    })
    const model = createAddDeviceModel({ accountModel })

    await model.deny()

    expect(model.error()).toBe('Сессия истекла, войдите снова')
    expect(model.phase()).toBe('idle')
  })

  it('clears a stale justApproved value from a previous approval cycle', async () => {
    const pendingDevice: DeviceDto = {
      credentialId: 'cred-new',
      label: 'New phone',
      status: 'pending',
      addedVia: 'add-token',
      createdAt: 1,
      lastSeenAt: 1,
    }
    const staleDevice: DeviceDto = { ...pendingDevice, credentialId: 'cred-stale' }
    const accountModel = createFakeAccountModel([pendingDevice])
    const model = createAddDeviceModel({ accountModel })
    model.justApproved.set(staleDevice)

    await model.deny()

    expect(model.justApproved()).toBeNull()
  })
})

describe('justApproved', () => {
  it('is null before any approval', () => {
    const model = createAddDeviceModel({ accountModel: createFakeAccountModel() })

    expect(model.justApproved()).toBeNull()
  })

  it('is set to the approved device once approve() succeeds', async () => {
    const pendingDevice: DeviceDto = {
      credentialId: 'cred-new',
      label: 'Chrome на Android',
      status: 'pending',
      addedVia: 'add-token',
      createdAt: 1,
      lastSeenAt: 1,
    }
    const accountModel = createFakeAccountModel([pendingDevice])
    const model = createAddDeviceModel({ accountModel })

    await model.approve()

    expect(model.justApproved()).toEqual(pendingDevice)
  })

  it('stays null when approve() surfaces a delegate error', async () => {
    const pendingDevice: DeviceDto = {
      credentialId: 'cred-new',
      label: 'New phone',
      status: 'pending',
      addedVia: 'add-token',
      createdAt: 1,
      lastSeenAt: 1,
    }
    const accountModel = createFakeAccountModel([pendingDevice])
    accountModel.approve.mockImplementation(async () => {
      accountModel.setError('Достигнут лимит устройств аккаунта')
    })
    const model = createAddDeviceModel({ accountModel })

    await model.approve()

    expect(model.justApproved()).toBeNull()
  })

  it('is cleared again once a fresh start() ceremony begins', async () => {
    const pendingDevice: DeviceDto = {
      credentialId: 'cred-new',
      label: 'New phone',
      status: 'pending',
      addedVia: 'add-token',
      createdAt: 1,
      lastSeenAt: 1,
    }
    const accountModel = createFakeAccountModel([pendingDevice])
    const fetchImpl = vi
      .fn()
      .mockResolvedValueOnce(jsonResponse(OPTIONS_BODY))
      .mockResolvedValueOnce(jsonResponse(mintBody()))
    const model = createAddDeviceModel({
      fetchImpl: fetchImpl as unknown as typeof fetch,
      startAuthenticationCeremony: vi.fn(async () => authenticationResponse),
      accountModel,
    })

    await model.approve()
    expect(model.justApproved()).toEqual(pendingDevice)

    await model.start()

    expect(model.justApproved()).toBeNull()
  })
})

describe('qrOptions', () => {
  it('is null before a code has been minted', () => {
    const model = createAddDeviceModel({ accountModel: createFakeAccountModel() })

    expect(model.qrOptions()).toBeNull()
  })

  it("derives dots color from the light theme's --primary and a literal white background once a url is minted", async () => {
    const fetchImpl = vi
      .fn()
      .mockResolvedValueOnce(jsonResponse(OPTIONS_BODY))
      .mockResolvedValueOnce(jsonResponse(mintBody()))
    const themeAtom = atom<ResolvedTheme>('light', 'test.resolvedTheme')
    const model = createAddDeviceModel({
      fetchImpl: fetchImpl as unknown as typeof fetch,
      startAuthenticationCeremony: vi.fn(async () => authenticationResponse),
      accountModel: createFakeAccountModel(),
      resolvedTheme: themeAtom,
    })

    await model.start()

    expect(model.qrOptions()).toEqual({
      data: model.url(),
      width: 167,
      height: 167,
      type: 'svg',
      margin: 0,
      qrOptions: { errorCorrectionLevel: 'Q' },
      dotsOptions: { type: 'square', color: 'oklch(0.55 0.17 281)' },
      backgroundOptions: { color: '#ffffff' },
    })
  })

  it('regenerates the dots color when the resolved theme changes, keeping the background white', async () => {
    const fetchImpl = vi
      .fn()
      .mockResolvedValueOnce(jsonResponse(OPTIONS_BODY))
      .mockResolvedValueOnce(jsonResponse(mintBody()))
    const themeAtom = atom<ResolvedTheme>('light', 'test.resolvedTheme')
    const model = createAddDeviceModel({
      fetchImpl: fetchImpl as unknown as typeof fetch,
      startAuthenticationCeremony: vi.fn(async () => authenticationResponse),
      accountModel: createFakeAccountModel(),
      resolvedTheme: themeAtom,
    })
    await model.start()

    themeAtom.set('dark')

    expect(model.qrOptions()?.dotsOptions).toEqual({
      type: 'square',
      color: 'oklch(0.68 0.15 285)',
    })
    expect(model.qrOptions()?.backgroundOptions).toEqual({ color: '#ffffff' })
  })
})

describe('qrCode', () => {
  it('exposes a stable QRCodeStyling instance with append/update methods', () => {
    const model = createAddDeviceModel({ accountModel: createFakeAccountModel() })

    expect(typeof model.qrCode.append).toBe('function')
    expect(typeof model.qrCode.update).toBe('function')
  })
})

describe('busy', () => {
  it('is false when neither approve() nor deny() is in flight', () => {
    const model = createAddDeviceModel({ accountModel: createFakeAccountModel() })

    expect(model.busy()).toBe(false)
  })

  it('is true while approve() is in flight and false again once it settles', async () => {
    const pendingDevice: DeviceDto = {
      credentialId: 'cred-new',
      label: 'New phone',
      status: 'pending',
      addedVia: 'add-token',
      createdAt: 1,
      lastSeenAt: 1,
    }
    const accountModel = createFakeAccountModel([pendingDevice])
    let resolveApprove!: () => void
    accountModel.approve.mockImplementation(
      () =>
        new Promise<void>((resolve) => {
          resolveApprove = resolve
        }),
    )
    const model = createAddDeviceModel({ accountModel })

    const promise = model.approve()
    expect(model.busy()).toBe(true)

    resolveApprove()
    await promise

    expect(model.busy()).toBe(false)
  })
})
