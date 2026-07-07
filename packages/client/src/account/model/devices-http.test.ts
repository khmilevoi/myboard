import type { AuthenticationResponseJSON } from '@simplewebauthn/browser'
import { describe, expect, it, vi } from 'vitest'

import {
  approveDevice,
  describeDeviceError,
  DeviceApiError,
  DeviceHttpError,
  denyDevice,
  fetchAccount,
  fetchAddTokenOptions,
  fetchDevices,
  logout,
  mintAddToken,
  revokeDevice,
} from './devices-http'

function jsonResponse(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  })
}

function emptyResponse(status = 204) {
  return new Response(null, { status })
}

describe('fetchAccount', () => {
  it('sends credentials + X-Requested-With and returns the parsed account', async () => {
    const fetchImpl = vi
      .fn()
      .mockResolvedValueOnce(jsonResponse({ id: 'acc-1', name: 'Alice', deviceLimit: 5 }))

    const result = await fetchAccount(fetchImpl as unknown as typeof fetch)

    expect(fetchImpl).toHaveBeenCalledWith(
      '/api/auth/account',
      expect.objectContaining({
        credentials: 'same-origin',
        headers: expect.objectContaining({ 'X-Requested-With': 'MyBoard' }),
      }),
    )
    expect(result).toEqual({ id: 'acc-1', name: 'Alice', deviceLimit: 5 })
  })
})

describe('fetchDevices', () => {
  it('returns the devices list and thisCredentialId', async () => {
    const devicesBody = {
      devices: [
        {
          credentialId: 'c1',
          label: 'Chrome',
          status: 'active',
          addedVia: 'invite',
          createdAt: 1,
          lastSeenAt: 2,
        },
      ],
      thisCredentialId: 'c1',
    }
    const fetchImpl = vi.fn().mockResolvedValueOnce(jsonResponse(devicesBody))

    const result = await fetchDevices(fetchImpl as unknown as typeof fetch)

    expect(fetchImpl).toHaveBeenCalledWith('/api/auth/devices', expect.objectContaining({}))
    expect(result).toEqual(devicesBody)
  })
})

describe('approveDevice', () => {
  it('posts to the approve endpoint', async () => {
    const fetchImpl = vi.fn().mockResolvedValueOnce(jsonResponse({ ok: true }))

    const result = await approveDevice(fetchImpl as unknown as typeof fetch, 'cred-1')

    expect(fetchImpl).toHaveBeenCalledWith(
      '/api/auth/devices/cred-1/approve',
      expect.objectContaining({ method: 'POST' }),
    )
    expect(result).toEqual({ ok: true })
  })
})

describe('denyDevice', () => {
  it('posts to the deny endpoint and resolves on 204', async () => {
    const fetchImpl = vi.fn().mockResolvedValueOnce(emptyResponse(204))

    const result = await denyDevice(fetchImpl as unknown as typeof fetch, 'cred-1')

    expect(fetchImpl).toHaveBeenCalledWith(
      '/api/auth/devices/cred-1/deny',
      expect.objectContaining({ method: 'POST' }),
    )
    expect(result).toBeUndefined()
  })
})

describe('revokeDevice', () => {
  it('posts to the revoke endpoint and resolves on 204', async () => {
    const fetchImpl = vi.fn().mockResolvedValueOnce(emptyResponse(204))

    const result = await revokeDevice(fetchImpl as unknown as typeof fetch, 'cred-1')

    expect(fetchImpl).toHaveBeenCalledWith(
      '/api/auth/devices/cred-1/revoke',
      expect.objectContaining({ method: 'POST' }),
    )
    expect(result).toBeUndefined()
  })

  it('surfaces a DeviceApiError carrying the server code and status on failure', async () => {
    const fetchImpl = vi
      .fn()
      .mockResolvedValueOnce(jsonResponse({ code: 'last_active_device' }, 409))

    const result = await revokeDevice(fetchImpl as unknown as typeof fetch, 'cred-1')

    expect(result).toBeInstanceOf(DeviceApiError)
    expect((result as DeviceApiError).code).toBe('last_active_device')
    expect((result as DeviceApiError).status).toBe(409)
  })
})

describe('fetchAddTokenOptions', () => {
  it('posts to the add-token options endpoint and returns the parsed options', async () => {
    const fetchImpl = vi.fn().mockResolvedValueOnce(jsonResponse({ options: { challenge: 'c' } }))

    const result = await fetchAddTokenOptions(fetchImpl as unknown as typeof fetch)

    expect(fetchImpl).toHaveBeenCalledWith(
      '/api/auth/devices/add-token/options',
      expect.objectContaining({ method: 'POST' }),
    )
    expect(result).toEqual({ options: { challenge: 'c' } })
  })
})

describe('mintAddToken', () => {
  it('posts the authenticationResponse and returns the minted code/formatted/url/expiresAt', async () => {
    const mintBody = {
      code: 'ABC123',
      formatted: 'ABC-123',
      url: 'http://localhost:5173/add-device?token=ABC123',
      expiresAt: 1_700_000_300_000,
    }
    const fetchImpl = vi.fn().mockResolvedValueOnce(jsonResponse(mintBody))
    const authenticationResponse = { id: 'cred-1' } as unknown as AuthenticationResponseJSON

    const result = await mintAddToken(fetchImpl as unknown as typeof fetch, authenticationResponse)

    expect(fetchImpl).toHaveBeenCalledWith(
      '/api/auth/devices/add-token',
      expect.objectContaining({
        method: 'POST',
        body: JSON.stringify({ authenticationResponse }),
      }),
    )
    expect(result).toEqual(mintBody)
  })
})

describe('logout', () => {
  it('posts to the logout endpoint and resolves on 204', async () => {
    const fetchImpl = vi.fn().mockResolvedValueOnce(emptyResponse(204))

    const result = await logout(fetchImpl as unknown as typeof fetch)

    expect(fetchImpl).toHaveBeenCalledWith(
      '/api/auth/logout',
      expect.objectContaining({ method: 'POST' }),
    )
    expect(result).toBeUndefined()
  })
})

describe('describeDeviceError', () => {
  it('maps a known DeviceApiError code to its Russian, user-facing message', () => {
    const err = new DeviceApiError({ code: 'session_missing', status: 401 })

    expect(describeDeviceError(err)).toBe('Сессия истекла, войдите снова')
  })

  it('falls back to a generic message carrying the raw code for an unmapped DeviceApiError code', () => {
    const err = new DeviceApiError({ code: 'totally_unknown', status: 500 })

    expect(describeDeviceError(err)).toBe('Не удалось выполнить действие (код totally_unknown)')
  })

  it('falls back to the error message for a non-DeviceApiError error', () => {
    const err = new DeviceHttpError({ reason: 'сбой сетевого запроса', cause: new Error('boom') })

    expect(describeDeviceError(err)).toBe(err.message)
  })
})

describe('network failure', () => {
  it('wraps a rejected fetch in a DeviceHttpError', async () => {
    const fetchImpl = vi.fn().mockRejectedValueOnce(new Error('network down'))

    const result = await fetchAccount(fetchImpl as unknown as typeof fetch)

    expect(result).toBeInstanceOf(DeviceHttpError)
  })
})
