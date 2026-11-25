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
    expect((result as StorageError).reason).toContain('invalid_key')
    expect(calls).toHaveLength(0)
  })
})
