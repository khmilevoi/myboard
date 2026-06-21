import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { FakeEventSource, installFakeEventSource } from '../test/fakes'

beforeEach(() => {
  installFakeEventSource()
  vi.resetModules()
  vi.stubGlobal(
    'fetch',
    vi.fn(() => Promise.resolve(new Response(null, { status: 204 }))),
  )
})

afterEach(() => {
  vi.useRealTimers()
  vi.unstubAllGlobals()
})

describe('getSseManager', () => {
  it('registers interest after ready and delivers matching events', async () => {
    const { getSseManager } = await import('./sse-client')
    const mgr = getSseManager('/api/storage')
    const seen: unknown[] = []
    mgr.add('w:t:clock:settings', (raw) => seen.push(raw))

    const es = FakeEventSource.instances[0]
    expect(es.url).toBe('/api/storage/events')

    es.emit('ready', { connId: 'c1' })
    await vi.waitFor(() => {
      const fetchMock = globalThis.fetch as ReturnType<typeof vi.fn>
      expect(fetchMock).toHaveBeenCalledWith(
        '/api/storage/events/c1',
        expect.objectContaining({ method: 'POST' }),
      )
    })

    es.emit('message', { key: 'w:t:clock:settings', value: 7 })
    expect(seen).toEqual([7])
  })

  it('re-registers all desired keys on a fresh ready (reconnect)', async () => {
    const { getSseManager } = await import('./sse-client')
    const mgr = getSseManager('/api/storage')
    mgr.add('k1', () => {})
    const es = FakeEventSource.instances[0]
    es.emit('ready', { connId: 'c1' })
    await vi.waitFor(() => expect(globalThis.fetch).toHaveBeenCalled())
    const fetchMock = globalThis.fetch as ReturnType<typeof vi.fn>
    fetchMock.mockClear()

    es.emit('ready', { connId: 'c2' }) // reconnect: new connId
    await vi.waitFor(() => {
      const body = JSON.parse((fetchMock.mock.calls[0][1] as RequestInit).body as string)
      expect(fetchMock.mock.calls[0][0]).toBe('/api/storage/events/c2')
      expect(body.subscribe).toContain('k1')
    })
  })

  it('unsubscribes when local interest is removed while registration is pending', async () => {
    let resolveRegistration: ((response: Response) => void) | undefined
    const fetchMock = vi.fn(
      (_input: RequestInfo | URL, _init?: RequestInit) =>
        new Promise<Response>((resolve) => {
          resolveRegistration = resolve
        }),
    )
    vi.stubGlobal('fetch', fetchMock)

    const { getSseManager } = await import('./sse-client')
    const mgr = getSseManager('/api/storage')
    const unsubscribe = mgr.add('k1', () => {})

    FakeEventSource.instances[0].emit('ready', { connId: 'c1' })
    await vi.waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(1))

    unsubscribe()
    resolveRegistration?.(new Response(null, { status: 204 }))

    await vi.waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(2))
    const secondCall = fetchMock.mock.calls[1]
    const body = JSON.parse(secondCall[1]!.body as string)
    expect(body).toEqual({ subscribe: [], unsubscribe: ['k1'] })
  })

  it('retries registration when the POST rejects', async () => {
    vi.useFakeTimers()
    const fetchMock = vi
      .fn()
      .mockRejectedValueOnce(new Error('offline'))
      .mockResolvedValueOnce(new Response(null, { status: 204 }))
    vi.stubGlobal('fetch', fetchMock)

    const { getSseManager } = await import('./sse-client')
    const mgr = getSseManager('/api/storage')
    mgr.add('k1', () => {})

    FakeEventSource.instances[0].emit('ready', { connId: 'c1' })
    await vi.waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(1))

    await vi.advanceTimersByTimeAsync(1_000)
    await vi.waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(2))
    vi.useRealTimers()
  })

  it('retries registration when the POST returns non-2xx', async () => {
    vi.useFakeTimers()
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(new Response(null, { status: 500 }))
      .mockResolvedValueOnce(new Response(null, { status: 204 }))
    vi.stubGlobal('fetch', fetchMock)

    const { getSseManager } = await import('./sse-client')
    getSseManager('/api/storage').add('k1', () => {})

    FakeEventSource.instances[0].emit('ready', { connId: 'c1' })
    await vi.waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(1))

    await vi.advanceTimersByTimeAsync(1_000)
    await vi.waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(2))
    vi.useRealTimers()
  })

  it('ignores malformed ready frames without registering', async () => {
    const { getSseManager } = await import('./sse-client')
    getSseManager('/api/storage').add('k1', () => {})

    FakeEventSource.instances[0].emit('ready', { connId: 123 })
    await Promise.resolve()

    expect(globalThis.fetch).not.toHaveBeenCalled()
  })

  it('ignores malformed message frames without delivery', async () => {
    const { getSseManager } = await import('./sse-client')
    const seen: unknown[] = []
    getSseManager('/api/storage').add('k1', (raw) => seen.push(raw))

    FakeEventSource.instances[0].emit('message', { key: 123, value: 1 })
    expect(seen).toEqual([])
  })
})
