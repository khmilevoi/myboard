import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { FakeEventSource, installFakeEventSource } from '../test/fakes'

beforeEach(() => {
  installFakeEventSource()
  vi.resetModules()
  vi.stubGlobal('fetch', vi.fn(() => Promise.resolve(new Response(null, { status: 204 }))))
})

afterEach(() => {
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
})
