import { describe, expect, it, vi } from 'vitest'

import {
  handleGet,
  handlePut,
  handleDelete,
  handleKeys,
  publishChange,
  handleAppend,
  handleTime,
} from './handlers'
import type { ValkeyOps } from './valkey'

function mockOps(overrides: Partial<ValkeyOps> = {}): ValkeyOps {
  return {
    get: vi.fn(async () => null),
    set: vi.fn(async () => {}),
    del: vi.fn(async () => {}),
    scanKeys: vi.fn(async () => []),
    publish: vi.fn(async () => {}),
    ...overrides,
  }
}

describe('handlers', () => {
  it('GET returns 404 when missing', async () => {
    expect(await handleGet(mockOps(), 'k')).toEqual({ status: 404 })
  })

  it('GET parses the stored JSON into a value envelope', async () => {
    const ops = mockOps({ get: vi.fn(async () => JSON.stringify({ a: 1 })) })
    expect(await handleGet(ops, 'k')).toEqual({ status: 200, body: { value: { a: 1 } } })
  })

  it('PUT stores stringified value with ttl and returns 204', async () => {
    const ops = mockOps()
    const result = await handlePut(ops, 'k', { value: { a: 1 }, ttlMs: 500 })
    expect(result).toEqual({ status: 204 })
    expect(ops.set).toHaveBeenCalledWith('k', JSON.stringify({ a: 1 }), 500)
  })

  it('DELETE removes the key and returns 204', async () => {
    const ops = mockOps()
    expect(await handleDelete(ops, 'k')).toEqual({ status: 204 })
    expect(ops.del).toHaveBeenCalledWith('k')
  })

  it('KEYS returns scanned keys', async () => {
    const ops = mockOps({ scanKeys: vi.fn(async () => ['w:t:clock:a']) })
    expect(await handleKeys(ops, 'w:t:clock:')).toEqual({
      status: 200,
      body: { keys: ['w:t:clock:a'] },
    })
    expect(ops.scanKeys).toHaveBeenCalledWith('w:t:clock:')
  })
})

describe('publishChange', () => {
  it('publishes the change envelope to the events channel', async () => {
    const ops = mockOps({ publish: vi.fn(async () => {}) })
    await publishChange(ops, 'w:t:clock:settings', { a: 1 })
    expect(ops.publish).toHaveBeenCalledWith(
      'storage:events',
      JSON.stringify({ key: 'w:t:clock:settings', value: { a: 1 } }),
    )
  })
})

describe('handleAppend', () => {
  function statefulOps(seed?: unknown): ValkeyOps {
    let raw: string | null = seed === undefined ? null : JSON.stringify(seed)

    return mockOps({
      get: vi.fn(async () => raw),
      set: vi.fn(async (_key: string, value: string) => {
        raw = value
      }),
    })
  }

  it('creates a one-element array and stamps id/ts/ip when the key is missing', async () => {
    vi.useFakeTimers()
    vi.setSystemTime(new Date('2026-06-20T00:00:00.000Z'))
    const ops = statefulOps()

    const result = await handleAppend(
      ops,
      'history:2026-06-15',
      { entry: { type: 'cleaned' } },
      '1.2.3.4',
    )

    expect(result.status).toBe(204)
    expect(result.value).toHaveLength(1)
    expect(result.value[0]).toMatchObject({
      type: 'cleaned',
      ip: '1.2.3.4',
      ts: Date.parse('2026-06-20T00:00:00.000Z'),
    })
    expect(typeof (result.value[0] as { id: unknown }).id).toBe('string')
    expect(ops.set).toHaveBeenCalledWith('history:2026-06-15', JSON.stringify(result.value))
    vi.useRealTimers()
  })

  it('appends onto an existing array', async () => {
    const ops = statefulOps([{ type: 'forgiven', id: 'old' }])
    const result = await handleAppend(ops, 'k', { entry: { type: 'cleaned' } }, '1.2.3.4')
    expect(result.value).toHaveLength(2)
    expect(result.value[0]).toMatchObject({ type: 'forgiven', id: 'old' })
    expect(result.value[1]).toMatchObject({ type: 'cleaned' })
  })

  it('falls back to an empty array when stored JSON is corrupt', async () => {
    const ops = mockOps({
      get: vi.fn(async () => '{not json'),
      set: vi.fn(async () => {}),
    })

    const result = await handleAppend(ops, 'k', { entry: { type: 'cleaned' } }, '1.2.3.4')

    expect(result.value).toHaveLength(1)
    expect(result.value[0]).toMatchObject({ type: 'cleaned' })
    expect(ops.set).toHaveBeenCalledWith('k', JSON.stringify(result.value))
  })

  it('caps to the last N entries', async () => {
    const ops = statefulOps([{ n: 1 }, { n: 2 }, { n: 3 }])
    const result = await handleAppend(ops, 'k', { entry: { n: 4 }, cap: 2 }, '1.2.3.4')
    expect(result.value).toHaveLength(2)
    expect(result.value.map((e) => (e as { n: number }).n)).toEqual([3, 4])
  })

  it('overrides any client-provided id/ts/ip with server values', async () => {
    vi.useFakeTimers()
    vi.setSystemTime(new Date('2026-06-20T00:00:00.000Z'))
    const ops = statefulOps()

    const result = await handleAppend(
      ops,
      'k',
      { entry: { id: 'fake', ts: 1, ip: 'spoofed', type: 'cleaned' } },
      '1.2.3.4',
    )

    expect(result.value[0]).toMatchObject({
      ip: '1.2.3.4',
      ts: Date.parse('2026-06-20T00:00:00.000Z'),
    })
    expect((result.value[0] as { id: string }).id).not.toBe('fake')
    vi.useRealTimers()
  })
})

describe('handleTime', () => {
  it('returns 200 with the current epoch ms', () => {
    vi.useFakeTimers()
    vi.setSystemTime(new Date('2026-06-21T12:00:00.000Z'))

    expect(handleTime()).toEqual({
      status: 200,
      body: { now: Date.parse('2026-06-21T12:00:00.000Z') },
    })

    vi.useRealTimers()
  })
})
