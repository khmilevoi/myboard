import { StorageError, type StorageApi, type StorageEntry, type StorageOptions } from '../types'
import { toFullKey, toRelativeKey } from '../scope'
import { db as defaultDb, type StorageDb } from './db'

export function createDexieStorage(namespace: string, database: StorageDb = defaultDb): StorageApi {
  const table = database.entries

  async function readValid(fullKey: string): Promise<StorageError | StorageEntry | null> {
    try {
      const row = await table.get(fullKey)
      if (!row) return null
      if (row.expiresAt != null && row.expiresAt < Date.now()) {
        await table.delete(fullKey)
        return null
      }
      return row
    } catch (cause) {
      return new StorageError({ reason: 'dexie read failed', cause })
    }
  }

  return {
    async get<T>(key: string): Promise<StorageError | T | null> {
      const row = await readValid(toFullKey(namespace, key))
      if (row instanceof Error) return row
      return row === null ? null : (row.value as T)
    },

    async set<T>(key: string, value: T, options?: StorageOptions): Promise<StorageError | void> {
      try {
        const now = Date.now()
        const entry: StorageEntry<T> = {
          key: toFullKey(namespace, key),
          namespace,
          value,
          expiresAt: options?.ttlMs != null ? now + options.ttlMs : null,
          updatedAt: now,
        }
        await table.put(entry)
      } catch (cause) {
        return new StorageError({ reason: 'dexie write failed', cause })
      }
    },

    async delete(key: string): Promise<StorageError | void> {
      try {
        await table.delete(toFullKey(namespace, key))
      } catch (cause) {
        return new StorageError({ reason: 'dexie delete failed', cause })
      }
    },

    async has(key: string): Promise<StorageError | boolean> {
      const row = await readValid(toFullKey(namespace, key))
      if (row instanceof Error) return row
      return row !== null
    },

    async keys(prefix?: string): Promise<StorageError | string[]> {
      try {
        const fullPrefix = toFullKey(namespace, prefix ?? '')
        const rows = await table.where('key').startsWith(fullPrefix).toArray()
        const now = Date.now()
        return rows
          .filter((row) => row.expiresAt == null || row.expiresAt >= now)
          .map((row) => toRelativeKey(namespace, row.key))
      } catch (cause) {
        return new StorageError({ reason: 'dexie keys failed', cause })
      }
    },
  }
}
