import { makeScriptedHttp } from '@shared/http/test/scripted-http'
import { describe, expect, it, vi } from 'vitest'

import { typeNamespace } from '../scope'
import { StorageError } from '../types'
import { makeHttpStorage } from './http-storage'

const ns = typeNamespace('clock')
const BASE = '/api/storage'
const KEY = `${BASE}/${encodeURIComponent('w:t:clock:settings')}`

function storageWith(script: Parameters<typeof makeScriptedHttp>[0]) {
  const { http, calls } = makeScriptedHttp(script)
  const registerKey = vi.fn(() => () => {})
  return { storage: makeHttpStorage(ns, { baseUrl: BASE, http, registerKey }), calls, registerKey }
}

describe('makeHttpStorage on the HttpClient port', () => {
  it('GET returns the value', async () => {
    const { storage } = storageWith({ [KEY]: [{ status: 200, body: { value: { a: 1 } } }] })
    expect(await storage.get('settings')).toEqual({ a: 1 })
  })

  it('GET maps 404 to null', async () => {
    const { storage } = storageWith({ [KEY]: [{ status: 404 }] })
    expect(await storage.get('settings')).toBeNull()
  })

  it('GET maps other non-2xx to StorageError', async () => {
    const { storage } = storageWith({ [KEY]: [{ status: 503 }] })
    expect(await storage.get('settings')).toBeInstanceOf(StorageError)
  })

  it('GET maps a malformed envelope to StorageError', async () => {
    const { storage } = storageWith({ [KEY]: [{ status: 200, body: { nope: true } }] })
    expect(await storage.get('settings')).toBeInstanceOf(StorageError)
  })

  it('GET maps transport failures to StorageError with the cause', async () => {
    const { storage } = storageWith({ [KEY]: ['network-error'] })
    expect(await storage.get('settings')).toBeInstanceOf(StorageError)
  })

  it('SET sends a PUT with value and ttl', async () => {
    const { storage, calls } = storageWith({ [KEY]: [{ status: 204 }] })
    await storage.set('settings', { a: 1 }, { ttlMs: 1000 })
    expect(calls[0]).toEqual({
      method: 'PUT',
      url: KEY,
      json: { value: { a: 1 }, ttlMs: 1000 },
    })
  })

  it('DELETE sends a DELETE', async () => {
    const { storage, calls } = storageWith({ [KEY]: [{ status: 204 }] })
    await storage.delete('settings')
    expect(calls[0]?.method).toBe('DELETE')
  })

  it('HAS maps 404 to false and 200 to true', async () => {
    const { storage } = storageWith({ [KEY]: [{ status: 404 }, { status: 200, body: { value: 1 } }] })
    expect(await storage.has('settings')).toBe(false)
    expect(await storage.has('settings')).toBe(true)
  })

  it('KEYS strips the namespace', async () => {
    const url = `${BASE}?prefix=${encodeURIComponent('w:t:clock:')}`
    const { storage } = storageWith({
      [url]: [{ status: 200, body: { keys: ['w:t:clock:a', 'w:t:clock:b'] } }],
    })
    expect(await storage.keys()).toEqual(['a', 'b'])
  })

  it('APPEND posts the entry', async () => {
    const url = `${BASE}/${encodeURIComponent('w:t:clock:log')}/append`
    const { storage, calls } = storageWith({ [url]: [{ status: 204 }] })
    await storage.append('log', { x: 1 }, { cap: 10 })
    expect(calls[0]).toEqual({ method: 'POST', url, json: { entry: { x: 1 }, cap: 10 } })
  })

  it('APPEND without a cap omits it from the payload', async () => {
    const url = `${BASE}/${encodeURIComponent('w:t:clock:log')}/append`
    const { storage, calls } = storageWith({ [url]: [{ status: 204 }] })
    await storage.append('log', { x: 1 })
    expect(calls[0]).toEqual({ method: 'POST', url, json: { entry: { x: 1 } } })
  })

  it('APPEND maps a non-2xx response to StorageError', async () => {
    const url = `${BASE}/${encodeURIComponent('w:t:clock:k')}/append`
    const { storage } = storageWith({ [url]: [{ status: 500 }] })
    expect(await storage.append('k', { a: 1 })).toBeInstanceOf(StorageError)
  })

  it('APPEND maps a network failure to StorageError', async () => {
    const url = `${BASE}/${encodeURIComponent('w:t:clock:k')}/append`
    const { storage } = storageWith({ [url]: ['network-error'] })
    expect(await storage.append('k', { a: 1 })).toBeInstanceOf(StorageError)
  })

  it('subscribe registers the full key through the injected registerKey', () => {
    const { storage, registerKey } = storageWith({ [KEY]: [{ status: 404 }] })
    const unsubscribe = storage.subscribe('settings', () => {})
    expect(registerKey).toHaveBeenCalledWith('w:t:clock:settings', expect.any(Function))
    unsubscribe()
  })
})
