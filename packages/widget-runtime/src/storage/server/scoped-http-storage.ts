import type { HttpLike } from '@shared/http/client'
import {
  EXPECTED_ACCOUNT_HEADER,
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
  registerScoped: (ref: ScopedStorageRef, deliver: SseDeliver, account?: string) => () => void
  /**
   * The account this storage serves (account branches only). Sent as the expected-account header
   * so the server refuses with 409 instead of acting on a session that has switched to another
   * account, and tagged onto SSE registrations so a switch re-registers them.
   */
  account?: string
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
  // The reason never embeds the key: it is caller-supplied text that would leak into logs.
  const invalidKey = () => new StorageError({ reason: 'invalid_key' })
  const headers =
    deps.account === undefined ? undefined : { [EXPECTED_ACCOUNT_HEADER]: deps.account }
  const withHeaders = <O extends object>(options?: O) =>
    headers === undefined ? options : { ...options, headers }

  return {
    async get<T>(key: string, schema?: z.ZodType<T>): Promise<StorageError | T | null> {
      if (!isValidRelativeKey(key)) return invalidKey()
      const res = await http.get(keyUrl(key), withHeaders())
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
      if (!isValidRelativeKey(key)) return invalidKey()
      const res = await http.put(
        keyUrl(key),
        withHeaders({ json: { value, ttlMs: options?.ttlMs } }),
      )
      if (res instanceof Error) return new StorageError({ reason: 'server PUT failed', cause: res })
      if (!res.ok) return new StorageError({ reason: `server PUT ${res.status}` })
    },

    async delete(key: string): Promise<StorageError | void> {
      if (!isValidRelativeKey(key)) return invalidKey()
      const res = await http.delete(keyUrl(key), withHeaders())
      if (res instanceof Error) {
        return new StorageError({ reason: 'server DELETE failed', cause: res })
      }
      if (!res.ok) return new StorageError({ reason: `server DELETE ${res.status}` })
    },

    async has(key: string): Promise<StorageError | boolean> {
      if (!isValidRelativeKey(key)) return invalidKey()
      const res = await http.get(keyUrl(key), withHeaders())
      if (res instanceof Error) return new StorageError({ reason: 'server HAS failed', cause: res })
      if (res.status === 404) return false
      if (!res.ok) return new StorageError({ reason: `server HAS ${res.status}` })
      return true
    },

    async keys(prefix?: string): Promise<StorageError | string[]> {
      if (prefix && !isValidRelativeKey(prefix)) return invalidKey()
      const url = prefix ? `${branchUrl}?prefix=${encodeURIComponent(prefix)}` : branchUrl
      const res = await http.get(url, withHeaders())
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
      if (!isValidRelativeKey(key)) return invalidKey()
      const res = await http.post(
        `${keyUrl(key)}/append`,
        withHeaders({
          json: { entry, ...(options?.cap !== undefined ? { cap: options.cap } : {}) },
        }),
      )
      if (res instanceof Error) {
        return new StorageError({ reason: 'server APPEND failed', cause: res })
      }
      if (!res.ok) return new StorageError({ reason: `server APPEND ${res.status}` })
    },

    subscribe<T>(key: string, listener: StorageListener<T>, schema?: z.ZodType<T>): () => void {
      if (!isValidRelativeKey(key)) {
        // Never register an invalid ref: the server rejects the whole events POST atomically.
        let active = true
        void Promise.resolve().then(() => {
          if (active) listener(invalidKey())
        })
        return () => {
          active = false
        }
      }
      return subscribeStorageKey({
        getCurrent: () => this.get<T>(key, schema),
        register: (deliver) => deps.registerScoped({ ...branch, key }, deliver, deps.account),
        listener,
        schema,
      })
    },
  }
}
