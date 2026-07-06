import { context } from '@reatom/core'
// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest'

import { createAccountModel } from './account-model'

afterEach(() => context.reset())

function jsonResponse(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  })
}

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
    const fetchImpl = vi
      .fn()
      .mockResolvedValueOnce(jsonResponse(accountBody))
      .mockResolvedValueOnce(jsonResponse(devicesBody))
    const model = createAccountModel({
      fetchImpl: fetchImpl as unknown as typeof fetch,
      storage: createStorage(null),
    })

    await model.refresh()

    expect(model.account()).toEqual(accountBody)
    expect(model.devices()).toEqual(devicesBody.devices)
  })
})

describe('pending', () => {
  it('computes only devices with status pending', async () => {
    const fetchImpl = vi
      .fn()
      .mockResolvedValueOnce(jsonResponse(accountBody))
      .mockResolvedValueOnce(jsonResponse(devicesBody))
    const model = createAccountModel({
      fetchImpl: fetchImpl as unknown as typeof fetch,
      storage: createStorage(null),
    })

    await model.refresh()

    expect(model.pending()).toEqual([devicesBody.devices[1]])
  })
})

describe('thisCredentialId', () => {
  it('marks the device matching localStorage[mb_cred_hint]', async () => {
    const fetchImpl = vi
      .fn()
      .mockResolvedValueOnce(jsonResponse(accountBody))
      .mockResolvedValueOnce(jsonResponse(devicesBody))
    const model = createAccountModel({
      fetchImpl: fetchImpl as unknown as typeof fetch,
      storage: createStorage('cred-this'),
    })

    await model.refresh()

    expect(model.thisCredentialId()).toBe('cred-this')
    expect(model.devices().some((device) => device.credentialId === model.thisCredentialId())).toBe(
      true,
    )
  })

  it('prefers the server-authoritative thisCredentialId from refresh over a stale localStorage hint', async () => {
    const fetchImpl = vi
      .fn()
      .mockResolvedValueOnce(jsonResponse(accountBody))
      .mockResolvedValueOnce(jsonResponse(devicesBody))
    const model = createAccountModel({
      fetchImpl: fetchImpl as unknown as typeof fetch,
      // localStorage still has a stale/different hint; the server's session
      // credential (devicesBody.thisCredentialId === 'cred-this') must win.
      storage: createStorage('stale-hint'),
    })

    await model.refresh()

    expect(model.thisCredentialId()).toBe('cred-this')
  })

  it('falls back to the localStorage hint when the server response omits thisCredentialId', async () => {
    const { thisCredentialId: _omit, ...devicesWithoutHint } = devicesBody
    const fetchImpl = vi
      .fn()
      .mockResolvedValueOnce(jsonResponse(accountBody))
      .mockResolvedValueOnce(jsonResponse(devicesBody))
      .mockResolvedValueOnce(jsonResponse(accountBody))
      .mockResolvedValueOnce(jsonResponse(devicesWithoutHint))
    const model = createAccountModel({
      fetchImpl: fetchImpl as unknown as typeof fetch,
      storage: createStorage('fallback-hint'),
    })

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
    const fetchImpl = vi
      .fn()
      .mockResolvedValueOnce(jsonResponse({ code: 'last_active_device' }, 409))
    const model = createAccountModel({
      fetchImpl: fetchImpl as unknown as typeof fetch,
      storage: createStorage(null),
    })

    await model.revoke('cred-this')

    expect(fetchImpl).toHaveBeenCalledWith(
      '/api/auth/devices/cred-this/revoke',
      expect.objectContaining({ method: 'POST' }),
    )
    expect(model.error()).not.toBeNull()
    expect(model.error()).toContain('последнее активное устройство')
  })

  it('maps a session_missing error into a Russian "sign in again" message', async () => {
    const fetchImpl = vi.fn().mockResolvedValueOnce(jsonResponse({ code: 'session_missing' }, 401))
    const model = createAccountModel({
      fetchImpl: fetchImpl as unknown as typeof fetch,
      storage: createStorage(null),
    })

    await model.revoke('cred-this')

    expect(model.error()).not.toBeNull()
    expect(model.error()).toContain('войдите')
  })

  it('clears the error and refreshes devices on a successful revoke', async () => {
    const fetchImpl = vi
      .fn()
      .mockResolvedValueOnce(new Response(null, { status: 204 }))
      .mockResolvedValueOnce(jsonResponse(accountBody))
      .mockResolvedValueOnce(jsonResponse(devicesBody))
    const model = createAccountModel({
      fetchImpl: fetchImpl as unknown as typeof fetch,
      storage: createStorage(null),
    })

    await model.revoke('cred-other')

    expect(model.error()).toBeNull()
    expect(model.account()).toEqual(accountBody)
    expect(model.devices()).toEqual(devicesBody.devices)
  })
})

describe('logout', () => {
  it('posts to /api/auth/logout and navigates away', async () => {
    const fetchImpl = vi.fn().mockResolvedValueOnce(new Response(null, { status: 204 }))
    const navigate = vi.fn()
    const model = createAccountModel({
      fetchImpl: fetchImpl as unknown as typeof fetch,
      storage: createStorage(null),
      navigate,
    })

    await model.logout()

    expect(fetchImpl).toHaveBeenCalledWith(
      '/api/auth/logout',
      expect.objectContaining({ method: 'POST' }),
    )
    expect(navigate).toHaveBeenCalledWith('/')
  })
})

describe('connectEvents', () => {
  class FakeEventSource {
    static instances: FakeEventSource[] = []
    url: string
    onmessage: ((event: MessageEvent) => void) | null = null
    close = vi.fn()
    constructor(url: string) {
      this.url = url
      FakeEventSource.instances.push(this)
    }
  }

  afterEach(() => {
    FakeEventSource.instances = []
  })

  it('calls refresh when a device-* SSE message arrives', async () => {
    const fetchImpl = vi
      .fn()
      .mockResolvedValueOnce(jsonResponse(accountBody))
      .mockResolvedValueOnce(jsonResponse(devicesBody))
    const model = createAccountModel({
      fetchImpl: fetchImpl as unknown as typeof fetch,
      storage: createStorage(null),
      eventSourceCtor: FakeEventSource as unknown as typeof EventSource,
    })

    const disconnect = model.connectEvents()
    const source = FakeEventSource.instances[0]!
    expect(source.url).toBe('/api/auth/devices/events')

    source.onmessage?.({
      data: JSON.stringify({
        key: 'auth:account:acc-1',
        value: { type: 'device-approved', credentialId: 'cred-pending' },
      }),
    } as MessageEvent)

    await vi.waitFor(() => expect(fetchImpl).toHaveBeenCalledTimes(2))
    expect(model.account()).toEqual(accountBody)

    disconnect()
    expect(source.close).toHaveBeenCalled()
  })

  it('ignores non device-* SSE messages', async () => {
    const fetchImpl = vi.fn()
    const model = createAccountModel({
      fetchImpl: fetchImpl as unknown as typeof fetch,
      storage: createStorage(null),
      eventSourceCtor: FakeEventSource as unknown as typeof EventSource,
    })

    model.connectEvents()
    const source = FakeEventSource.instances[0]!
    source.onmessage?.({ data: JSON.stringify({ connId: 'abc' }) } as MessageEvent)

    expect(fetchImpl).not.toHaveBeenCalled()
  })
})
