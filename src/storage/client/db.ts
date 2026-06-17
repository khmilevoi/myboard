import Dexie, { type Table } from 'dexie'
import type { StorageEntry } from '../types'

export class StorageDb extends Dexie {
  entries!: Table<StorageEntry, string>

  constructor() {
    super('myboard-storage')
    this.version(1).stores({
      entries: 'key, namespace, expiresAt, updatedAt',
    })
  }
}

export const db = new StorageDb()

/** Delete every entry that has a numeric expiry in the past. Returns the count removed. */
export async function clearExpired(database: StorageDb = db): Promise<number> {
  return database.entries.where('expiresAt').below(Date.now()).delete()
}
