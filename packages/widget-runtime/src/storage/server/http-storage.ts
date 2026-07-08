import type { HttpLike } from '@shared/http/client'
import { z } from 'zod'

import { toFullKey, toRelativeKey } from '../scope'
import { subscribeStorageKey } from '../subscribe-key'
import { StorageError, type StorageApi, type StorageListener, type StorageOptions } from '../types'
import { parseValue } from '../validate'
import type { SseDeliver } from './sse-client'

export type HttpStorageDeps = {
  baseUrl: string
  http: HttpLike
  registerKey: (fullKey: string, deliver: SseDeliver) => () => void
}

const ValueEnvelopeSchema = z.object({ value: z.unknown() })
const KeysEnvelopeSchema = z.object({ keys: z.array(z.string()) })

export function makeHttpStorage(namespace: string, deps: HttpStorageDeps): StorageApi {
  const { http, baseUrl } = deps
  const keyUrl = (fullKey: string) => `${baseUrl}/${encodeURIComponent(fullKey)}`

  return {
    async get<T>(key: string, schema?: z.ZodType<T>): Promise<StorageError | T | null> {
      const res = await http.get(keyUrl(toFullKey(namespace, key)))
      if (res instanceof Error) return new StorageError({ reason: 'server GET failed', cause: res })
      if (res.status === 404) return null
      if (!res.ok) return new StorageError({ reason: `server GET ${res.status}` })
      const envelope = ValueEnvelopeSchema.safeParse(res.body)
      if (!envelope.success) {
        return new StorageError({ reason: 'server GET invalid response', cause: envelope.error })
      }
      return parseValue(schema, envelope.data.value)
    },

    async set<T>(key: string, value: T, options?: StorageOptions): Promise<StorageError | void> {
      const res = await http.put(keyUrl(toFullKey(namespace, key)), {
        json: { value, ttlMs: options?.ttlMs },
      })
      if (res instanceof Error) return new StorageError({ reason: 'server PUT failed', cause: res })
      if (!res.ok) return new StorageError({ reason: `server PUT ${res.status}` })
    },

    async delete(key: string): Promise<StorageError | void> {
      const res = await http.delete(keyUrl(toFullKey(namespace, key)))
      if (res instanceof Error) {
        return new StorageError({ reason: 'server DELETE failed', cause: res })
      }
      if (!res.ok) return new StorageError({ reason: `server DELETE ${res.status}` })
    },

    async has(key: string): Promise<StorageError | boolean> {
      const res = await http.get(keyUrl(toFullKey(namespace, key)))
      if (res instanceof Error) return new StorageError({ reason: 'server HAS failed', cause: res })
      if (res.status === 404) return false
      if (!res.ok) return new StorageError({ reason: `server HAS ${res.status}` })
      return true
    },

    async keys(prefix?: string): Promise<StorageError | string[]> {
      const fullPrefix = toFullKey(namespace, prefix ?? '')
      const res = await http.get(`${baseUrl}?prefix=${encodeURIComponent(fullPrefix)}`)
      if (res instanceof Error)
        return new StorageError({ reason: 'server KEYS failed', cause: res })
      if (!res.ok) return new StorageError({ reason: `server KEYS ${res.status}` })
      const envelope = KeysEnvelopeSchema.safeParse(res.body)
      if (!envelope.success) {
        return new StorageError({ reason: 'server KEYS invalid response', cause: envelope.error })
      }
      return envelope.data.keys.map((full) => toRelativeKey(namespace, full))
    },

    async append<T extends Record<string, unknown>>(
      key: string,
      entry: T,
      options?: { cap?: number },
    ): Promise<StorageError | void> {
      const res = await http.post(`${keyUrl(toFullKey(namespace, key))}/append`, {
        json: { entry, ...(options?.cap !== undefined ? { cap: options.cap } : {}) },
      })
      if (res instanceof Error) {
        return new StorageError({ reason: 'server APPEND failed', cause: res })
      }
      if (!res.ok) return new StorageError({ reason: `server APPEND ${res.status}` })
    },

    subscribe<T>(key: string, listener: StorageListener<T>, schema?: z.ZodType<T>): () => void {
      const fullKey = toFullKey(namespace, key)
      return subscribeStorageKey({
        getCurrent: () => this.get<T>(key, schema),
        register: (deliver) => deps.registerKey(fullKey, deliver),
        listener,
        schema,
      })
    },
  }
}
