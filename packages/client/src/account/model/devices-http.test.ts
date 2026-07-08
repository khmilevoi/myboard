import type { AuthenticationResponseJSON } from '@simplewebauthn/browser'
import { makeScriptedHttp } from '@shared/http/test/scripted-http'
import { describe, expect, it } from 'vitest'

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

describe('fetchAccount', () => {
  it('returns the account payload', async () => {
    const { http } = makeScriptedHttp({
      '/api/auth/account': [{ status: 200, body: { id: 'acc-1', name: 'Alice', deviceLimit: 5 } }],
    })

    const result = await fetchAccount(http)

    expect(result).toEqual({ id: 'acc-1', name: 'Alice', deviceLimit: 5 })
  })

  it('sends the request via the http port', async () => {
    const { http, calls } = makeScriptedHttp({
      '/api/auth/account': [{ status: 200, body: { id: 'acc-1', name: 'Alice', deviceLimit: 5 } }],
    })

    await fetchAccount(http)

    expect(calls).toEqual([{ method: 'GET', url: '/api/auth/account', json: undefined }])
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
    const { http, calls } = makeScriptedHttp({
      '/api/auth/devices': [{ status: 200, body: devicesBody }],
    })

    const result = await fetchDevices(http)

    expect(calls).toEqual([{ method: 'GET', url: '/api/auth/devices', json: undefined }])
    expect(result).toEqual(devicesBody)
  })
})

describe('approveDevice', () => {
  it('posts to the approve endpoint', async () => {
    const { http, calls } = makeScriptedHttp({
      '/api/auth/devices/cred-1/approve': [{ status: 200, body: { ok: true } }],
    })

    const result = await approveDevice(http, 'cred-1')

    expect(calls).toEqual([
      { method: 'POST', url: '/api/auth/devices/cred-1/approve', json: undefined },
    ])
    expect(result).toEqual({ ok: true })
  })
})

describe('denyDevice', () => {
  it('posts to the deny endpoint and resolves on 204', async () => {
    const { http, calls } = makeScriptedHttp({
      '/api/auth/devices/cred-1/deny': [{ status: 204 }],
    })

    const result = await denyDevice(http, 'cred-1')

    expect(calls).toEqual([
      { method: 'POST', url: '/api/auth/devices/cred-1/deny', json: undefined },
    ])
    expect(result).toBeUndefined()
  })
})

describe('revokeDevice', () => {
  it('posts to the revoke endpoint and resolves on 204', async () => {
    const { http, calls } = makeScriptedHttp({
      '/api/auth/devices/cred-1/revoke': [{ status: 204 }],
    })

    const result = await revokeDevice(http, 'cred-1')

    expect(calls).toEqual([
      { method: 'POST', url: '/api/auth/devices/cred-1/revoke', json: undefined },
    ])
    expect(result).toBeUndefined()
  })

  it('surfaces a DeviceApiError carrying the server code and status on failure', async () => {
    const { http } = makeScriptedHttp({
      '/api/auth/devices/cred-1/revoke': [{ status: 409, body: { code: 'last_active_device' } }],
    })

    const result = await revokeDevice(http, 'cred-1')

    expect(result).toBeInstanceOf(DeviceApiError)
    expect((result as DeviceApiError).code).toBe('last_active_device')
    expect((result as DeviceApiError).status).toBe(409)
  })
})

describe('fetchAddTokenOptions', () => {
  it('posts to the add-token options endpoint and returns the parsed options', async () => {
    const { http, calls } = makeScriptedHttp({
      '/api/auth/devices/add-token/options': [
        { status: 200, body: { options: { challenge: 'c' } } },
      ],
    })

    const result = await fetchAddTokenOptions(http)

    expect(calls).toEqual([
      { method: 'POST', url: '/api/auth/devices/add-token/options', json: undefined },
    ])
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
    const { http, calls } = makeScriptedHttp({
      '/api/auth/devices/add-token': [{ status: 200, body: mintBody }],
    })
    const authenticationResponse = { id: 'cred-1' } as unknown as AuthenticationResponseJSON

    const result = await mintAddToken(http, authenticationResponse)

    expect(calls).toEqual([
      {
        method: 'POST',
        url: '/api/auth/devices/add-token',
        json: { authenticationResponse },
      },
    ])
    expect(result).toEqual(mintBody)
  })
})

describe('logout', () => {
  it('posts to the logout endpoint and resolves on 204', async () => {
    const { http, calls } = makeScriptedHttp({ '/api/auth/logout': [{ status: 204 }] })

    const result = await logout(http)

    expect(calls).toEqual([{ method: 'POST', url: '/api/auth/logout', json: undefined }])
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
  it('wraps a transport failure in a DeviceHttpError', async () => {
    const { http } = makeScriptedHttp({ '/api/auth/account': ['network-error'] })

    const result = await fetchAccount(http)

    expect(result).toBeInstanceOf(DeviceHttpError)
  })
})

describe('bare-bodied non-2xx (nginx gate)', () => {
  it('maps a bare-bodied 401 to DeviceApiError with code unknown_error, not a transport error', async () => {
    const { http } = makeScriptedHttp({ '/api/auth/account': [{ status: 401 }] })

    const result = await fetchAccount(http)

    expect(result).toBeInstanceOf(DeviceApiError)
    expect(result).toMatchObject({ status: 401, code: 'unknown_error' })
  })
})
