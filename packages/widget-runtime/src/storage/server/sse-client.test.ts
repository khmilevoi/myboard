import type { HttpLike } from '@shared/http/client'
import { makeFakeOpenEventStream } from '@shared/http/test/fake-event-stream'
import { afterEach, describe, expect, it, vi } from 'vitest'

import { makeSseManager, type SseManagerDeps } from './sse-client'

afterEach(() => {
  vi.useRealTimers()
})

type PostFn = (url: string, options?: { json: unknown }) => Promise<Error | HttpResponseLike>
type HttpResponseLike = { status: number; ok: boolean; body: unknown }

function makeStubHttp(
  post: ReturnType<typeof vi.fn<PostFn>> = vi.fn(async () => ({
    status: 204,
    ok: true,
    body: undefined,
  })),
) {
  const reject = () => {
    throw new Error('unexpected non-POST call')
  }
  const http = {
    get: reject,
    put: reject,
    delete: reject,
    patch: reject,
    post,
  } as unknown as HttpLike
  return { http, post }
}

function setup(overrides: Partial<SseManagerDeps> = {}) {
  const fake = makeFakeOpenEventStream()
  const { http, post } = makeStubHttp()
  const manager = makeSseManager({
    baseUrl: '/api/storage',
    http,
    openEventStream: fake.open,
    ...overrides,
  })
  return { manager, streams: fake.streams, post }
}

describe('makeSseManager', () => {
  it('registers interest after ready and delivers matching events', async () => {
    const { manager, streams, post } = setup()
    const seen: unknown[] = []
    manager.add('w:t:clock:settings', (raw) => seen.push(raw))

    expect(streams[0].url).toBe('/api/storage/events')
    streams[0].emit('ready', { connId: 'c1' })
    await vi.waitFor(() => {
      expect(post).toHaveBeenCalledWith(
        '/api/storage/events/c1',
        expect.objectContaining({
          json: expect.objectContaining({ subscribe: ['w:t:clock:settings'] }),
        }),
      )
    })

    streams[0].emit(undefined, { key: 'w:t:clock:settings', value: 7 })
    expect(seen).toEqual([7])
  })

  it('reconnects after a fatal stream error and re-registers desired keys', async () => {
    vi.useFakeTimers()
    const { manager, streams, post } = setup()
    manager.add('k1', () => {})

    streams[0].emit('ready', { connId: 'c1' })
    await vi.runAllTimersAsync()

    streams[0].fail()
    await vi.runAllTimersAsync()

    expect(streams.length).toBe(2)

    // the fresh connection re-registers the desired key
    streams[1].emit('ready', { connId: 'c2' })
    await vi.runAllTimersAsync()
    expect(String(post.mock.calls.at(-1)?.[0])).toContain('/events/c2')
  })

  it('re-registers all desired keys on a fresh ready (reconnect)', async () => {
    const { manager, streams, post } = setup()
    manager.add('k1', () => {})
    streams[0].emit('ready', { connId: 'c1' })
    await vi.waitFor(() => expect(post).toHaveBeenCalled())
    post.mockClear()

    streams[0].emit('ready', { connId: 'c2' }) // reconnect: new connId
    await vi.waitFor(() => {
      expect(post.mock.calls[0][0]).toBe('/api/storage/events/c2')
      const body = post.mock.calls[0][1] as { json: { subscribe: string[] } }
      expect(body.json.subscribe).toContain('k1')
    })
  })

  it('unsubscribes when local interest is removed while registration is pending', async () => {
    let resolveRegistration: ((response: HttpResponseLike) => void) | undefined
    const post: ReturnType<typeof vi.fn<PostFn>> = vi.fn(
      () =>
        new Promise<HttpResponseLike>((resolve) => {
          resolveRegistration = resolve
        }),
    )
    const { manager, streams } = setup({ http: makeStubHttp(post).http })

    const unsubscribe = manager.add('k1', () => {})

    streams[0].emit('ready', { connId: 'c1' })
    await vi.waitFor(() => expect(post).toHaveBeenCalledTimes(1))

    unsubscribe()
    resolveRegistration?.({ status: 204, ok: true, body: undefined })

    await vi.waitFor(() => expect(post).toHaveBeenCalledTimes(2))
    const secondCall = post.mock.calls[1]
    expect(secondCall[1]).toEqual({ json: { subscribe: [], unsubscribe: ['k1'] } })
  })

  it('retries registration when the POST fails at the transport', async () => {
    vi.useFakeTimers()
    const post: ReturnType<typeof vi.fn<PostFn>> = vi
      .fn()
      .mockResolvedValueOnce(new Error('offline'))
      .mockResolvedValueOnce({ status: 204, ok: true, body: undefined })
    const { manager, streams } = setup({ http: makeStubHttp(post).http })
    manager.add('k1', () => {})

    streams[0].emit('ready', { connId: 'c1' })
    await vi.waitFor(() => expect(post).toHaveBeenCalledTimes(1))

    await vi.advanceTimersByTimeAsync(1_000)
    await vi.waitFor(() => expect(post).toHaveBeenCalledTimes(2))
    vi.useRealTimers()
  })

  it('retries registration when the POST returns non-2xx', async () => {
    vi.useFakeTimers()
    const post: ReturnType<typeof vi.fn<PostFn>> = vi
      .fn()
      .mockResolvedValueOnce({ status: 500, ok: false, body: undefined })
      .mockResolvedValueOnce({ status: 204, ok: true, body: undefined })
    const { manager, streams } = setup({ http: makeStubHttp(post).http })
    manager.add('k1', () => {})

    streams[0].emit('ready', { connId: 'c1' })
    await vi.waitFor(() => expect(post).toHaveBeenCalledTimes(1))

    await vi.advanceTimersByTimeAsync(1_000)
    await vi.waitFor(() => expect(post).toHaveBeenCalledTimes(2))
    vi.useRealTimers()
  })

  it('ignores malformed ready frames without registering', async () => {
    const { manager, streams, post } = setup()
    manager.add('k1', () => {})

    streams[0].emit('ready', { connId: 123 })
    await Promise.resolve()

    expect(post).not.toHaveBeenCalled()
  })

  it('ignores malformed message frames without delivery', async () => {
    const { manager, streams } = setup()
    const seen: unknown[] = []
    manager.add('k1', (raw) => seen.push(raw))

    streams[0].emit(undefined, { key: 123, value: 1 })
    expect(seen).toEqual([])
  })
})
