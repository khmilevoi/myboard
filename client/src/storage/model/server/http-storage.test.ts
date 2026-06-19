import { afterEach, describe, expect, it, vi } from 'vitest'
import { StorageError } from '../types'
import { createHttpStorage } from './http-storage'
import { typeNamespace } from '../scope'
import { FakeEventSource, installFakeEventSource } from '../test/fakes'

const ns = typeNamespace('clock')
const storage = createHttpStorage(ns)

afterEach(() => {
  vi.unstubAllGlobals()
})

function stubFetch(impl: (input: string, init?: RequestInit) => Response) {
  vi.stubGlobal('fetch', vi.fn((input: string, init?: RequestInit) => Promise.resolve(impl(input, init))))
}

describe('createHttpStorage', () => {
  it('GET returns the value', async () => {
    stubFetch(() => new Response(JSON.stringify({ value: { a: 1 } }), { status: 200 }))
    expect(await storage.get('settings')).toEqual({ a: 1 })
  })

  it('GET maps 404 to null', async () => {
    stubFetch(() => new Response(null, { status: 404 }))
    expect(await storage.get('settings')).toBeNull()
  })

  it('GET maps other non-2xx to StorageError', async () => {
    stubFetch(() => new Response(null, { status: 503 }))
    expect(await storage.get('settings')).toBeInstanceOf(StorageError)
  })

  it('SET sends a PUT with value and ttl, namespaced and encoded', async () => {
    const fetchMock = vi.fn((_url: string, _init?: RequestInit) =>
      Promise.resolve(new Response(null, { status: 204 })),
    )
    vi.stubGlobal('fetch', fetchMock)
    await storage.set('settings', { a: 1 }, { ttlMs: 1000 })
    const [url, init] = fetchMock.mock.calls[0]
    expect(url).toBe(`/api/storage/${encodeURIComponent('w:t:clock:settings')}`)
    expect(init).toMatchObject({ method: 'PUT' })
    expect(JSON.parse((init as RequestInit).body as string)).toEqual({ value: { a: 1 }, ttlMs: 1000 })
  })

  it('DELETE sends a DELETE', async () => {
    const fetchMock = vi.fn((_url: string, _init?: RequestInit) =>
      Promise.resolve(new Response(null, { status: 204 })),
    )
    vi.stubGlobal('fetch', fetchMock)
    await storage.delete('settings')
    expect(fetchMock.mock.calls[0][1]).toMatchObject({ method: 'DELETE' })
  })

  it('has returns false on 404, true on 200', async () => {
    stubFetch(() => new Response(null, { status: 404 }))
    expect(await storage.has('settings')).toBe(false)
    stubFetch(() => new Response(JSON.stringify({ value: 1 }), { status: 200 }))
    expect(await storage.has('settings')).toBe(true)
  })

  it('keys queries by prefix and strips the namespace', async () => {
    const fetchMock = vi.fn((_url: string) =>
      Promise.resolve(new Response(JSON.stringify({ keys: ['w:t:clock:a', 'w:t:clock:b'] }), { status: 200 })),
    )
    vi.stubGlobal('fetch', fetchMock)
    expect(await storage.keys()).toEqual(['a', 'b'])
    expect(fetchMock.mock.calls[0][0]).toBe(`/api/storage?prefix=${encodeURIComponent('w:t:clock:')}`)
  })

  it('maps a network failure to StorageError', async () => {
    vi.stubGlobal('fetch', vi.fn(() => Promise.reject(new Error('offline'))))
    expect(await storage.get('settings')).toBeInstanceOf(StorageError)
  })

  it('subscribe emits the initial value then live SSE updates', async () => {
    installFakeEventSource()
    stubFetch(() => new Response(JSON.stringify({ value: { a: 1 } }), { status: 200 }))
    const seen: unknown[] = []
    storage.subscribe<{ a: number }>('settings', (event) => {
      seen.push(event instanceof Error ? 'error' : event.value)
    })
    await vi.waitFor(() => expect(seen).toContainEqual({ a: 1 }))

    const es = FakeEventSource.instances[0]
    es.emit('ready', { connId: 'c1' })
    es.emit('message', { key: 'w:t:clock:settings', value: { a: 2 } })
    expect(seen).toContainEqual({ a: 2 })
  })
})
