import { context, wrap } from '@reatom/core'
import type { HttpLike } from '@shared/http/client'
import { afterEach, describe, expect, it, vi } from 'vitest'

import { makeStaticWidgetIdentity, makeWidgetIdentity } from './identity'

afterEach(() => context.reset())

const okResponse = (body: unknown) => ({ ok: true, status: 200, body })

function makeHttp(body: unknown) {
  return { get: vi.fn(async () => okResponse(body)), post: vi.fn() } as unknown as HttpLike
}

describe('makeWidgetIdentity', () => {
  it('is empty until something subscribes', () => {
    const http = makeHttp({ accounts: [], viewerAccountId: 'a1' })
    makeWidgetIdentity({ http })
    expect(http.get).not.toHaveBeenCalled()
  })

  it('loads the roster on first subscription and resolves the viewer', async () => {
    const http = makeHttp({
      accounts: [
        { accountId: 'a1', name: 'Карина' },
        { accountId: 'a2', name: 'Лёша' },
      ],
      viewerAccountId: 'a2',
    })
    const identity = makeWidgetIdentity({ http })

    const off = identity.members.subscribe(() => {})
    await vi.waitFor(() => {
      expect(wrap(() => identity.members().size)()).toBe(2)
    })
    expect(wrap(() => identity.viewer()?.name)()).toBe('Лёша')
    off()
  })

  it('stays empty when the request fails', async () => {
    const http = {
      get: vi.fn(async () => new Error('offline')),
      post: vi.fn(),
    } as unknown as HttpLike
    const identity = makeWidgetIdentity({ http })

    const off = identity.members.subscribe(() => {})
    await vi.waitFor(() => expect(http.get).toHaveBeenCalled())
    expect(wrap(() => identity.members().size)()).toBe(0)
    expect(wrap(() => identity.viewer())()).toBeNull()
    off()
  })
})

describe('makeStaticWidgetIdentity', () => {
  it('serves the members it was given without any request', () => {
    const identity = makeStaticWidgetIdentity({
      members: [{ accountId: 'a1', name: 'Карина' }],
      viewerAccountId: 'a1',
    })
    expect(wrap(() => identity.viewer()?.name)()).toBe('Карина')
  })
})
