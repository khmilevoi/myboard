import { StorageError, type StorageApi, type StorageOptions } from '../types'
import { toFullKey, toRelativeKey } from '../scope'

export function createHttpStorage(namespace: string, baseUrl = '/api/storage'): StorageApi {
  const keyUrl = (fullKey: string) => `${baseUrl}/${encodeURIComponent(fullKey)}`

  return {
    async get<T>(key: string): Promise<StorageError | T | null> {
      try {
        const res = await fetch(keyUrl(toFullKey(namespace, key)))
        if (res.status === 404) return null
        if (!res.ok) return new StorageError({ reason: `server GET ${res.status}` })
        const body = (await res.json()) as { value: T }
        return body.value
      } catch (cause) {
        return new StorageError({ reason: 'server GET failed', cause })
      }
    },

    async set<T>(key: string, value: T, options?: StorageOptions): Promise<StorageError | void> {
      try {
        const res = await fetch(keyUrl(toFullKey(namespace, key)), {
          method: 'PUT',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ value, ttlMs: options?.ttlMs }),
        })
        if (!res.ok) return new StorageError({ reason: `server PUT ${res.status}` })
      } catch (cause) {
        return new StorageError({ reason: 'server PUT failed', cause })
      }
    },

    async delete(key: string): Promise<StorageError | void> {
      try {
        const res = await fetch(keyUrl(toFullKey(namespace, key)), { method: 'DELETE' })
        if (!res.ok) return new StorageError({ reason: `server DELETE ${res.status}` })
      } catch (cause) {
        return new StorageError({ reason: 'server DELETE failed', cause })
      }
    },

    async has(key: string): Promise<StorageError | boolean> {
      try {
        const res = await fetch(keyUrl(toFullKey(namespace, key)))
        if (res.status === 404) return false
        if (!res.ok) return new StorageError({ reason: `server HAS ${res.status}` })
        return true
      } catch (cause) {
        return new StorageError({ reason: 'server HAS failed', cause })
      }
    },

    async keys(prefix?: string): Promise<StorageError | string[]> {
      try {
        const fullPrefix = toFullKey(namespace, prefix ?? '')
        const res = await fetch(`${baseUrl}?prefix=${encodeURIComponent(fullPrefix)}`)
        if (!res.ok) return new StorageError({ reason: `server KEYS ${res.status}` })
        const body = (await res.json()) as { keys: string[] }
        return body.keys.map((full) => toRelativeKey(namespace, full))
      } catch (cause) {
        return new StorageError({ reason: 'server KEYS failed', cause })
      }
    },
  }
}
