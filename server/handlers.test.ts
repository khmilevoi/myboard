import { describe, expect, it, vi } from 'vitest'
import { handleGet, handlePut, handleDelete, handleKeys } from './handlers'
import type { ValkeyOps } from './valkey'

function mockOps(overrides: Partial<ValkeyOps> = {}): ValkeyOps {
  return {
    get: vi.fn(async () => null),
    set: vi.fn(async () => {}),
    del: vi.fn(async () => {}),
    scanKeys: vi.fn(async () => []),
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
    expect(await handleKeys(ops, 'w:t:clock:')).toEqual({ status: 200, body: { keys: ['w:t:clock:a'] } })
    expect(ops.scanKeys).toHaveBeenCalledWith('w:t:clock:')
  })
})
