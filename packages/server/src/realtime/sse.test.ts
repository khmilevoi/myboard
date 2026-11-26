import type { ServerResponse } from 'node:http'

import { describe, expect, it, vi } from 'vitest'

import { EventsParamsSchema, StorageEventSchema } from '../storage/schemas'
import { SseRegistry, writeSseEvent, fanout } from './sse'

function fakeRes() {
  return { write: vi.fn(), writableEnded: false } as unknown as ServerResponse
}

describe('SseRegistry', () => {
  it('tracks interest per key and lists subscribers', () => {
    const reg = new SseRegistry()
    reg.add('c1', fakeRes())
    reg.subscribe('c1', ['w:t:clock:settings'])
    expect(reg.subscribersOf('w:t:clock:settings')).toEqual(['c1'])
  })

  it('unsubscribe removes interest', () => {
    const reg = new SseRegistry()
    reg.add('c1', fakeRes())
    reg.subscribe('c1', ['k'])
    reg.unsubscribe('c1', ['k'])
    expect(reg.subscribersOf('k')).toEqual([])
  })

  it('remove drops the connection from every key index', () => {
    const reg = new SseRegistry()
    reg.add('c1', fakeRes())
    reg.subscribe('c1', ['a', 'b'])
    reg.remove('c1')
    expect(reg.subscribersOf('a')).toEqual([])
    expect(reg.subscribersOf('b')).toEqual([])
  })
})

describe('scoped subscriptions', () => {
  it('writes the frame key, not the full key, for scoped subscriptions', () => {
    const res = fakeRes()
    const reg = new SseRegistry()
    reg.add('c1', res)
    reg.subscribeScoped('c1', [{ fullKey: 'm:n:a:acc1:k', frameKey: 'scoped:module/n/account/k' }])
    fanout(reg, { key: 'm:n:a:acc1:k', value: 1 })
    expect(res.write).toHaveBeenCalledWith(
      expect.stringContaining('"key":"scoped:module/n/account/k"'),
    )
    expect(res.write).not.toHaveBeenCalledWith(expect.stringContaining('m:n:a:acc1:k'))
  })

  it('unsubscribeFrames stops delivery and clears the index', () => {
    const res = fakeRes()
    const reg = new SseRegistry()
    reg.add('c1', res)
    reg.subscribeScoped('c1', [{ fullKey: 'full', frameKey: 'frame' }])
    reg.unsubscribeFrames('c1', ['frame'])
    expect(reg.subscribersOf('full')).toEqual([])
    fanout(reg, { key: 'full', value: 1 })
    expect(res.write).not.toHaveBeenCalled()
  })

  it('plain subscribe keeps frame key equal to the full key', () => {
    const res = fakeRes()
    const reg = new SseRegistry()
    reg.add('c1', res)
    reg.subscribe('c1', ['k'])
    fanout(reg, { key: 'k', value: 2 })
    expect(res.write).toHaveBeenCalledWith(expect.stringContaining('"key":"k"'))
  })
})

describe('writeSseEvent', () => {
  it('writes a named event frame', () => {
    const res = fakeRes()
    writeSseEvent(res, 'ready', { connId: 'x' })
    expect(res.write).toHaveBeenCalledWith('event: ready\n')
    expect(res.write).toHaveBeenCalledWith('data: {"connId":"x"}\n\n')
  })

  it('writes a default (data-only) frame', () => {
    const res = fakeRes()
    writeSseEvent(res, undefined, { key: 'k', value: 1 })
    expect(res.write).toHaveBeenCalledWith('data: {"key":"k","value":1}\n\n')
  })
})

describe('fanout', () => {
  it('writes the change to every interested connection', () => {
    const reg = new SseRegistry()
    const res = fakeRes()
    reg.add('c1', res)
    reg.subscribe('c1', ['k'])
    fanout(reg, { key: 'k', value: 42 })
    expect(res.write).toHaveBeenCalledWith('data: {"key":"k","value":42}\n\n')
  })

  it('ignores keys with no subscribers', () => {
    const reg = new SseRegistry()
    expect(() => fanout(reg, { key: 'none', value: 1 })).not.toThrow()
  })
})

describe('storage event schemas', () => {
  it('accepts a valid storage event', () => {
    expect(StorageEventSchema.safeParse({ key: 'k', value: 1 }).success).toBe(true)
  })

  it('rejects events without a string key', () => {
    expect(StorageEventSchema.safeParse({ key: 1, value: 1 }).success).toBe(false)
  })

  it('requires a string connId param', () => {
    expect(EventsParamsSchema.safeParse({ connId: 'c1' }).success).toBe(true)
    expect(EventsParamsSchema.safeParse({ connId: 1 }).success).toBe(false)
  })
})
