import { context } from '@reatom/core'
// @vitest-environment jsdom
import type { AuthenticationResponseJSON } from '@simplewebauthn/browser'
import { afterEach, describe, expect, it, vi } from 'vitest'

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
  return {
    pending: () => pendingDevices,
    approve: vi.fn(async (_credentialId: string) => {}),
    deny: vi.fn(async (_credentialId: string) => {}),
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
    expect(model.error()).not.toBeNull()
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
})
