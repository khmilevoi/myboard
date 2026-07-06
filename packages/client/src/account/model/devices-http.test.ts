import { describe, expect, it, vi } from 'vitest'

import {
  approveDevice,
  DeviceApiError,
  DeviceHttpError,
  denyDevice,
  fetchAccount,
  fetchDevices,
  logout,
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

describe('network failure', () => {
  it('wraps a rejected fetch in a DeviceHttpError', async () => {
    const fetchImpl = vi.fn().mockRejectedValueOnce(new Error('network down'))

    const result = await fetchAccount(fetchImpl as unknown as typeof fetch)

    expect(result).toBeInstanceOf(DeviceHttpError)
  })
})
