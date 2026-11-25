import type { HttpLike } from '@shared/http/client'
import {
  isValidRelativeKey,
  scopedBranchPath,
  type ScopedBranch,
  type ScopedStorageRef,
} from '@shared/storage/scoped'
import { z } from 'zod'

import { subscribeStorageKey } from '../subscribe-key'
import { StorageError, type StorageApi, type StorageListener, type StorageOptions } from '../types'
import { parseValue } from '../validate'
import type { SseDeliver } from './sse-client'

export type ScopedHttpStorageDeps = {
  baseUrl: string
  http: HttpLike
  registerScoped: (ref: ScopedStorageRef, deliver: SseDeliver) => () => void
}

const ValueEnvelopeSchema = z.object({ value: z.unknown() })
const KeysEnvelopeSchema = z.object({ keys: z.array(z.string()) })

export function makeScopedHttpStorage(
  branch: ScopedBranch,
  deps: ScopedHttpStorageDeps,
): StorageApi {
  const { http, baseUrl } = deps
  const branchUrl = `${baseUrl}${scopedBranchPath(branch)}`
  const keyUrl = (key: string) => `${branchUrl}/${encodeURIComponent(key)}`
  const invalidKey = (key: string) => new StorageError({ reason: `invalid_key: ${key}` })

  return {
    async get<T>(key: string, schema?: z.ZodType<T>): Promise<StorageError | T | null> {
      if (!isValidRelativeKey(key)) return invalidKey(key)
      const res = await http.get(keyUrl(key))
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
      if (!isValidRelativeKey(key)) return invalidKey(key)
      const res = await http.put(keyUrl(key), { json: { value, ttlMs: options?.ttlMs } })
      if (res instanceof Error) return new StorageError({ reason: 'server PUT failed', cause: res })
      if (!res.ok) return new StorageError({ reason: `server PUT ${res.status}` })
    },

    async delete(key: string): Promise<StorageError | void> {
      if (!isValidRelativeKey(key)) return invalidKey(key)
      const res = await http.delete(keyUrl(key))
      if (res instanceof Error) {
        return new StorageError({ reason: 'server DELETE failed', cause: res })
      }
      if (!res.ok) return new StorageError({ reason: `server DELETE ${res.status}` })
    },

    async has(key: string): Promise<StorageError | boolean> {
      if (!isValidRelativeKey(key)) return invalidKey(key)
      const res = await http.get(keyUrl(key))
      if (res instanceof Error) return new StorageError({ reason: 'server HAS failed', cause: res })
      if (res.status === 404) return false
      if (!res.ok) return new StorageError({ reason: `server HAS ${res.status}` })
      return true
    },

    async keys(prefix?: string): Promise<StorageError | string[]> {
      const url = prefix ? `${branchUrl}?prefix=${encodeURIComponent(prefix)}` : branchUrl
      const res = await http.get(url)
      if (res instanceof Error)
        return new StorageError({ reason: 'server KEYS failed', cause: res })
      if (!res.ok) return new StorageError({ reason: `server KEYS ${res.status}` })
      const envelope = KeysEnvelopeSchema.safeParse(res.body)
      if (!envelope.success) {
        return new StorageError({ reason: 'server KEYS invalid response', cause: envelope.error })
      }
      return envelope.data.keys
    },

    async append<T extends Record<string, unknown>>(
      key: string,
      entry: T,
      options?: { cap?: number },
    ): Promise<StorageError | void> {
      if (!isValidRelativeKey(key)) return invalidKey(key)
      const res = await http.post(`${keyUrl(key)}/append`, {
        json: { entry, ...(options?.cap !== undefined ? { cap: options.cap } : {}) },
      })
      if (res instanceof Error) {
        return new StorageError({ reason: 'server APPEND failed', cause: res })
      }
      if (!res.ok) return new StorageError({ reason: `server APPEND ${res.status}` })
    },

    subscribe<T>(key: string, listener: StorageListener<T>, schema?: z.ZodType<T>): () => void {
      return subscribeStorageKey({
        getCurrent: () => this.get<T>(key, schema),
        register: (deliver) => deps.registerScoped({ ...branch, key }, deliver),
        listener,
        schema,
      })
    },
  }
}
