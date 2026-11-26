import { makeScriptedHttp } from '@shared/http/test/scripted-http'
import { describe, expect, it, vi } from 'vitest'

import { StorageError } from '../types'
import { makeScopedHttpStorage } from './scoped-http-storage'

const BASE = '/api/storage'
const BRANCH = { owner: 'module', id: 'notes', scope: 'account' } as const
const ROOT = `${BASE}/scoped/module/notes/account`

function storageWith(script: Parameters<typeof makeScriptedHttp>[0]) {
  const { http, calls } = makeScriptedHttp(script)
  const registerScoped = vi.fn(() => () => {})
  return { storage: makeScopedHttpStorage(BRANCH, { baseUrl: BASE, http, registerScoped }), calls }
}

describe('makeScopedHttpStorage', () => {
  it('SET PUTs to the scoped key URL', async () => {
    const url = `${ROOT}/duty%2Fx`
    const { storage, calls } = storageWith({ [url]: [{ status: 204 }] })
    await storage.set('duty/x', 1)
    expect(calls[0]).toMatchObject({ method: 'PUT', url, json: { value: 1 } })
  })

  it('sends the expected-account header and tags SSE registrations when bound to an account', async () => {
    const url = `${ROOT}/a`
    const { http, calls } = makeScriptedHttp({
      [url]: [{ status: 204 }, { status: 404 }, { status: 404 }],
    })
    const registerScoped = vi.fn(() => () => {})
    const storage = makeScopedHttpStorage(BRANCH, {
      baseUrl: BASE,
      http,
      registerScoped,
      account: 'acc-1',
    })
    await storage.set('a', 1)
    await storage.get('a')
    expect(calls.map((call) => call.headers)).toEqual([
      { 'x-myboard-expected-account': 'acc-1' },
      { 'x-myboard-expected-account': 'acc-1' },
    ])
    const off = storage.subscribe('a', () => {})
    expect(registerScoped).toHaveBeenCalledWith(
      { ...BRANCH, key: 'a' },
      expect.any(Function),
      'acc-1',
    )
    off()
  })

  it('GET maps 404 to null', async () => {
    const { storage } = storageWith({ [`${ROOT}/a`]: [{ status: 404 }] })
    expect(await storage.get('a')).toBeNull()
  })

  it('keys returns the relative keys as they are', async () => {
    const { storage } = storageWith({ [ROOT]: [{ status: 200, body: { keys: ['a', 'b'] } }] })
    expect(await storage.keys()).toEqual(['a', 'b'])
  })

  it('rejects an invalid key without a request', async () => {
    const { storage, calls } = storageWith({})
    const result = await storage.get('a b')
    expect(result).toBeInstanceOf(StorageError)
    expect((result as StorageError).reason).toBe('invalid_key')
    expect(calls).toHaveLength(0)
  })

  it('keys rejects an invalid prefix without a request', async () => {
    const { storage, calls } = storageWith({})
    const result = await storage.keys('a b')
    expect(result).toBeInstanceOf(StorageError)
    expect((result as StorageError).reason).toBe('invalid_key')
    expect(calls).toHaveLength(0)
  })

  it('subscribe with an invalid key emits invalid_key and registers nothing', async () => {
    const { http, calls } = makeScriptedHttp({})
    const registerScoped = vi.fn(() => () => {})
    const storage = makeScopedHttpStorage(BRANCH, { baseUrl: BASE, http, registerScoped })
    const listener = vi.fn()
    storage.subscribe('a b', listener)
    await vi.waitFor(() => expect(listener).toHaveBeenCalledTimes(1))
    expect((listener.mock.calls[0][0] as StorageError).reason).toBe('invalid_key')
    expect(registerScoped).not.toHaveBeenCalled()
    expect(calls).toHaveLength(0)
  })
})
