import type { z } from 'zod'

import { toFullKey, toRelativeKey } from '../scope'
import { subscribeStorageKey } from '../subscribe-key'
import {
  StorageError,
  type StorageApi,
  type StorageEntry,
  type StorageListener,
  type StorageOptions,
} from '../types'
import { parseValue } from '../validate'
import { registerLocal, publishChange } from './channel'
import { db as defaultDb, type StorageDb } from './db'

const appendTails = new Map<string, Promise<unknown>>()

function runAppendExclusive<T>(key: string, task: () => Promise<T>): Promise<T> {
  const previous = appendTails.get(key) ?? Promise.resolve()
  const result = previous.then(() => task())
  const tail = result.then(
    () => undefined,
    () => undefined,
  )

  appendTails.set(key, tail)
  void tail.then(() => {
    if (appendTails.get(key) === tail) appendTails.delete(key)
  })

  return result
}

export function createDexieStorage(namespace: string, database: StorageDb = defaultDb): StorageApi {
  const table = database.entries

  async function readValid(fullKey: string): Promise<StorageError | StorageEntry | null> {
    const row = await table
      .get(fullKey)
      .catch((cause) => new StorageError({ reason: 'dexie read failed', cause }))
    if (row instanceof Error) return row
    if (!row) return null
    if (row.expiresAt != null && row.expiresAt < Date.now()) {
      const delResult = await table
        .delete(fullKey)
        .catch((cause) => new StorageError({ reason: 'dexie read cleanup failed', cause }))
      if (delResult instanceof Error) return delResult
      return null
    }
    return row
  }

  return {
    async get<T>(key: string, schema?: z.ZodType<T>): Promise<StorageError | T | null> {
      const row = await readValid(toFullKey(namespace, key))
      if (row instanceof Error) return row
      if (row === null) return null
      return parseValue(schema, row.value)
    },

    async set<T>(key: string, value: T, options?: StorageOptions): Promise<StorageError | void> {
      const now = Date.now()
      const entry: StorageEntry<T> = {
        key: toFullKey(namespace, key),
        namespace,
        value,
        expiresAt: options?.ttlMs != null ? now + options.ttlMs : null,
        updatedAt: now,
      }
      const result = await table
        .put(entry)
        .catch((cause) => new StorageError({ reason: 'dexie write failed', cause }))
      if (result instanceof Error) return result
      publishChange(toFullKey(namespace, key), value)
    },

    async delete(key: string): Promise<StorageError | void> {
      const result = await table
        .delete(toFullKey(namespace, key))
        .catch((cause) => new StorageError({ reason: 'dexie delete failed', cause }))
      if (result instanceof Error) return result
      publishChange(toFullKey(namespace, key), null)
    },

    async has(key: string): Promise<StorageError | boolean> {
      const row = await readValid(toFullKey(namespace, key))
      if (row instanceof Error) return row
      return row !== null
    },

    async keys(prefix?: string): Promise<StorageError | string[]> {
      const fullPrefix = toFullKey(namespace, prefix ?? '')
      const rows = await table
        .where('key')
        .startsWith(fullPrefix)
        .toArray()
        .catch((cause) => new StorageError({ reason: 'dexie keys failed', cause }))
      if (rows instanceof Error) return rows
      const now = Date.now()
      return rows
        .filter((row) => row.expiresAt == null || row.expiresAt >= now)
        .map((row) => toRelativeKey(namespace, row.key))
    },

    async append<T extends Record<string, unknown>>(
      key: string,
      entry: T,
      options?: { cap?: number },
    ): Promise<StorageError | void> {
      const fullKey = toFullKey(namespace, key)
      return runAppendExclusive(fullKey, async () => {
        const row = await readValid(fullKey)
        if (row instanceof Error) return row
        const current: unknown[] = Array.isArray(row?.value) ? [...row.value] : []
        current.push(entry)
        const next =
          options?.cap != null && current.length > options.cap
            ? current.slice(current.length - options.cap)
            : current

        return this.set(key, next)
      })
    },

    subscribe<T>(key: string, listener: StorageListener<T>, schema?: z.ZodType<T>): () => void {
      const fullKey = toFullKey(namespace, key)
      return subscribeStorageKey({
        getCurrent: () => this.get<T>(key, schema),
        register: (deliver) => registerLocal(fullKey, deliver),
        listener,
        schema,
      })
    },
  }
}
