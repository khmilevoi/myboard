import { context, wrap } from '@reatom/core'
import type { HttpLike } from '@shared/http/client'
import { afterEach, describe, expect, it, vi } from 'vitest'

import { makeStaticWidgetIdentity, makeWidgetIdentity } from './identity'

afterEach(() => context.reset())

const okResponse = (body: unknown) => ({ ok: true, status: 200, body })

function makeHttp(body: unknown) {
  return { get: vi.fn(async () => okResponse(body)), post: vi.fn() } as unknown as HttpLike
}

// No @types/node in this package's tsconfig `types` — go through globalThis
// rather than pull in the ambient `process` global just for one test.
type NodeProcess = {
  on(event: 'unhandledRejection', cb: (reason: unknown) => void): void
  off(event: 'unhandledRejection', cb: (reason: unknown) => void): void
}
const nodeProcess = () => (globalThis as unknown as { process: NodeProcess }).process

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

  it('stays empty when the request fails, and warns about the transport failure', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
    const http = {
      get: vi.fn(async () => new Error('offline')),
      post: vi.fn(),
    } as unknown as HttpLike
    const identity = makeWidgetIdentity({ http })

    const off = identity.members.subscribe(() => {})
    await vi.waitFor(() => expect(warn).toHaveBeenCalled())
    expect(wrap(() => identity.members().size)()).toBe(0)
    expect(wrap(() => identity.viewer())()).toBeNull()
    off()
    warn.mockRestore()
  })

  it('stays silent on a 401 — the expected shape for an unauthenticated host', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
    const http = {
      get: vi.fn(async () => ({ ok: false, status: 401, body: undefined })),
      post: vi.fn(),
    } as unknown as HttpLike
    const identity = makeWidgetIdentity({ http })

    const off = identity.members.subscribe(() => {})
    await vi.waitFor(() => expect(http.get).toHaveBeenCalled())
    // Give every queued microtask (wrap's internal queueMicrotask hops
    // included) a full macrotask to settle before asserting silence.
    await new Promise((resolve) => setTimeout(resolve, 0))

    expect(wrap(() => identity.members().size)()).toBe(0)
    expect(wrap(() => identity.viewer())()).toBeNull()
    expect(warn).not.toHaveBeenCalled()
    off()
    warn.mockRestore()
  })

  it('warns when the response body no longer matches AccountsResultSchema', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
    const http = {
      get: vi.fn(async () => ({ ok: true, status: 200, body: { accounts: 'not-an-array' } })),
      post: vi.fn(),
    } as unknown as HttpLike
    const identity = makeWidgetIdentity({ http })

    const off = identity.members.subscribe(() => {})
    await vi.waitFor(() => expect(warn).toHaveBeenCalled())
    expect(wrap(() => identity.members().size)()).toBe(0)
    expect(wrap(() => identity.viewer())()).toBeNull()
    off()
    warn.mockRestore()
  })

  it('does not leave an unhandled rejection when the connect scope aborts mid-fetch', async () => {
    const rejections: unknown[] = []
    const onUnhandledRejection = (reason: unknown) => rejections.push(reason)
    nodeProcess().on('unhandledRejection', onUnhandledRejection)

    const http = {
      get: vi.fn(() => new Promise(() => {})), // never resolves — only the abort settles it
      post: vi.fn(),
    } as unknown as HttpLike
    const identity = makeWidgetIdentity({ http })

    const off = identity.members.subscribe(() => {})
    off() // last subscriber gone: the connect scope aborts mid-fetch

    // Node reports an unhandled rejection only after the microtask queue
    // drains, so a macrotask tick is required to observe one either way.
    await new Promise((resolve) => setTimeout(resolve, 0))

    nodeProcess().off('unhandledRejection', onUnhandledRejection)
    expect(rejections).toEqual([])
  })
})

describe('makeWidgetIdentity retry and refresh', () => {
  afterEach(() => {
    vi.useRealTimers()
  })

  // Both fetches in this suite are pure microtask chains (mocked `http.get`
  // never itself schedules a timer), so nothing forces the JS engine to drain
  // them just because a fake timer got advanced. Pump the microtask queue by
  // hand at every checkpoint instead of trusting `advanceTimersByTimeAsync`
  // alone to have fully settled a multi-hop `wrap`/`fetchIdentity` chain.
  const flushMicrotasks = async (times = 20) => {
    for (let i = 0; i < times; i++) await Promise.resolve()
  }

  it('retries after a transient failure and populates the roster once the retry succeeds', async () => {
    vi.useFakeTimers()
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
    const get = vi
      .fn()
      .mockResolvedValueOnce(new Error('offline'))
      .mockResolvedValueOnce(
        okResponse({ accounts: [{ accountId: 'a1', name: 'Карина' }], viewerAccountId: 'a1' }),
      )
    const http = { get, post: vi.fn() } as unknown as HttpLike
    const identity = makeWidgetIdentity({ http })

    const off = identity.members.subscribe(() => {})

    await flushMicrotasks()
    expect(get).toHaveBeenCalledTimes(1)
    expect(warn).toHaveBeenCalled()
    expect(wrap(() => identity.members().size)()).toBe(0)

    // Past the first retry delay: the retry fires and this time succeeds.
    await vi.advanceTimersByTimeAsync(1_000)
    await flushMicrotasks()

    expect(get).toHaveBeenCalledTimes(2)
    expect(wrap(() => identity.members().size)()).toBe(1)
    expect(wrap(() => identity.viewer()?.name)()).toBe('Карина')

    off()
    warn.mockRestore()
  })

  it('does not retry a 401, even left connected far longer than any retry/refresh delay', async () => {
    vi.useFakeTimers()
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
    const get = vi.fn(async () => ({ ok: false, status: 401, body: undefined }))
    const http = { get, post: vi.fn() } as unknown as HttpLike
    const identity = makeWidgetIdentity({ http })

    const off = identity.members.subscribe(() => {})
    await flushMicrotasks()
    expect(get).toHaveBeenCalledTimes(1)

    await vi.advanceTimersByTimeAsync(10 * 60 * 1000)
    await flushMicrotasks()

    expect(get).toHaveBeenCalledTimes(1)
    expect(warn).not.toHaveBeenCalled()

    off()
    warn.mockRestore()
  })

  it('cancels the scheduled retry when the last subscriber disconnects', async () => {
    vi.useFakeTimers()
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
    const get = vi.fn(async () => new Error('offline'))
    const http = { get, post: vi.fn() } as unknown as HttpLike
    const identity = makeWidgetIdentity({ http })

    const off = identity.members.subscribe(() => {})
    await flushMicrotasks()
    expect(get).toHaveBeenCalledTimes(1)

    off() // last subscriber gone while a retry is scheduled

    // Well past the delay that would have fired the retry had the loop kept
    // running after disconnect.
    await vi.advanceTimersByTimeAsync(60_000)
    await flushMicrotasks()

    expect(get).toHaveBeenCalledTimes(1)

    warn.mockRestore()
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
