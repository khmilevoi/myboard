import { context } from '@reatom/core'
import { makeFakeOpenEventStream } from '@shared/http/test/fake-event-stream'
import { makeScriptedHttp } from '@shared/http/test/scripted-http'
// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest'

import { createAccountModel } from './account-model'

afterEach(() => context.reset())

function createStorage(initial: string | null) {
  return { get: vi.fn(() => initial) }
}

const accountBody = { id: 'acc-1', name: 'Alice', deviceLimit: 3 }
const devicesBody = {
  devices: [
    {
      credentialId: 'cred-this',
      label: 'This device',
      status: 'active' as const,
      addedVia: 'invite' as const,
      createdAt: 1,
      lastSeenAt: 2,
    },
    {
      credentialId: 'cred-pending',
      label: 'New phone',
      status: 'pending' as const,
      addedVia: 'add-token' as const,
      createdAt: 3,
      lastSeenAt: 3,
    },
  ],
  thisCredentialId: 'cred-this',
}

describe('refresh', () => {
  it('populates account and devices from the server', async () => {
    const { http } = makeScriptedHttp({
      '/api/auth/account': [{ status: 200, body: accountBody }],
      '/api/auth/devices': [{ status: 200, body: devicesBody }],
    })
    const model = createAccountModel({ http, storage: createStorage(null) })

    await model.refresh()

    expect(model.account()).toEqual(accountBody)
    expect(model.devices()).toEqual(devicesBody.devices)
  })
})

describe('pending', () => {
  it('computes only devices with status pending', async () => {
    const { http } = makeScriptedHttp({
      '/api/auth/account': [{ status: 200, body: accountBody }],
      '/api/auth/devices': [{ status: 200, body: devicesBody }],
    })
    const model = createAccountModel({ http, storage: createStorage(null) })

    await model.refresh()

    expect(model.pending()).toEqual([devicesBody.devices[1]])
  })
})

describe('thisCredentialId', () => {
  it('marks the device matching localStorage[mb_cred_hint]', async () => {
    const { http } = makeScriptedHttp({
      '/api/auth/account': [{ status: 200, body: accountBody }],
      '/api/auth/devices': [{ status: 200, body: devicesBody }],
    })
    const model = createAccountModel({ http, storage: createStorage('cred-this') })

    await model.refresh()

    expect(model.thisCredentialId()).toBe('cred-this')
    expect(model.devices().some((device) => device.credentialId === model.thisCredentialId())).toBe(
      true,
    )
  })

  it('prefers the server-authoritative thisCredentialId from refresh over a stale localStorage hint', async () => {
    const { http } = makeScriptedHttp({
      '/api/auth/account': [{ status: 200, body: accountBody }],
      '/api/auth/devices': [{ status: 200, body: devicesBody }],
    })
    const model = createAccountModel({
      http,
      // localStorage still has a stale/different hint; the server's session
      // credential (devicesBody.thisCredentialId === 'cred-this') must win.
      storage: createStorage('stale-hint'),
    })

    await model.refresh()

    expect(model.thisCredentialId()).toBe('cred-this')
  })

  it('falls back to the localStorage hint when the server response omits thisCredentialId', async () => {
    const { thisCredentialId: _omit, ...devicesWithoutHint } = devicesBody
    const { http } = makeScriptedHttp({
      '/api/auth/account': [
        { status: 200, body: accountBody },
        { status: 200, body: accountBody },
      ],
      '/api/auth/devices': [
        { status: 200, body: devicesBody },
        { status: 200, body: devicesWithoutHint },
      ],
    })
    const model = createAccountModel({ http, storage: createStorage('fallback-hint') })

    // First establish a server-provided value different from the storage hint...
    await model.refresh()
    expect(model.thisCredentialId()).toBe('cred-this')

    // ...then a refresh whose response omits thisCredentialId must fall back
    // to re-reading localStorage, not keep the previous atom value.
    await model.refresh()
    expect(model.thisCredentialId()).toBe('fallback-hint')
  })
})

describe('revoke', () => {
  it('surfaces the server last_active_device error into error', async () => {
    const { http, calls } = makeScriptedHttp({
      '/api/auth/devices/cred-this/revoke': [{ status: 409, body: { code: 'last_active_device' } }],
    })
    const model = createAccountModel({ http, storage: createStorage(null) })

    await model.revoke('cred-this')

    expect(calls).toEqual([
      { method: 'POST', url: '/api/auth/devices/cred-this/revoke', json: undefined },
    ])
    expect(model.error()).not.toBeNull()
    expect(model.error()).toContain('последнее активное устройство')
  })

  it('maps a session_missing error into a Russian "sign in again" message', async () => {
    const { http } = makeScriptedHttp({
      '/api/auth/devices/cred-this/revoke': [{ status: 401, body: { code: 'session_missing' } }],
    })
    const model = createAccountModel({ http, storage: createStorage(null) })

    await model.revoke('cred-this')

    expect(model.error()).not.toBeNull()
    expect(model.error()).toContain('войдите')
  })

  it('clears the error and refreshes devices on a successful revoke', async () => {
    const { http } = makeScriptedHttp({
      '/api/auth/devices/cred-other/revoke': [{ status: 204 }],
      '/api/auth/account': [{ status: 200, body: accountBody }],
      '/api/auth/devices': [{ status: 200, body: devicesBody }],
    })
    const model = createAccountModel({ http, storage: createStorage(null) })

    await model.revoke('cred-other')

    expect(model.error()).toBeNull()
    expect(model.account()).toEqual(accountBody)
    expect(model.devices()).toEqual(devicesBody.devices)
  })
})

describe('logout', () => {
  it('purges local data after server logout and before navigation', async () => {
    const order: string[] = []
    const bareHttp = makeScriptedHttp({ '/api/auth/logout': [{ status: 204 }] }).http
    const purge = vi.fn(async () => {
      order.push('purge')
    })
    const navigate = vi.fn(() => {
      order.push('navigate')
    })
    const model = createAccountModel({
      http: makeScriptedHttp({}).http,
      storage: createStorage(null),
      bareHttp,
      purge,
      navigate,
    })

    await model.logout()

    expect(order).toEqual(['purge', 'navigate'])
    expect(navigate).toHaveBeenCalledWith('/')
  })

  it('surfaces a server logout failure into error and does not navigate away', async () => {
    const bareHttp = makeScriptedHttp({
      '/api/auth/logout': [{ status: 401, body: { code: 'session_missing' } }],
    }).http
    const purge = vi.fn(async () => undefined)
    const navigate = vi.fn()
    const model = createAccountModel({
      http: makeScriptedHttp({}).http,
      storage: createStorage(null),
      bareHttp,
      purge,
      navigate,
    })

    await model.logout()

    expect(model.error()).not.toBeNull()
    expect(purge).not.toHaveBeenCalled()
    expect(navigate).not.toHaveBeenCalled()
  })
})

describe('connectEvents', () => {
  it('calls refresh when a device-* SSE message arrives', async () => {
    const { http } = makeScriptedHttp({
      '/api/auth/account': [{ status: 200, body: accountBody }],
      '/api/auth/devices': [{ status: 200, body: devicesBody }],
    })
    const { open: openEventStream, streams } = makeFakeOpenEventStream()
    const model = createAccountModel({ http, storage: createStorage(null), openEventStream })

    const disconnect = model.connectEvents()
    const stream = streams[0]!
    expect(stream.url).toBe('/api/auth/devices/events')

    stream.emit(undefined, {
      key: 'auth:account:acc-1',
      value: { type: 'device-approved', credentialId: 'cred-pending' },
    })

    await vi.waitFor(() => expect(model.account()).toEqual(accountBody))

    disconnect()
    expect(stream.closed).toBe(true)
  })

  it('ignores non device-* SSE messages', async () => {
    const { http, calls } = makeScriptedHttp({})
    const { open: openEventStream, streams } = makeFakeOpenEventStream()
    const model = createAccountModel({ http, storage: createStorage(null), openEventStream })

    model.connectEvents()
    const stream = streams[0]!
    stream.emit(undefined, { connId: 'abc' })

    expect(calls).toHaveLength(0)
  })
})
