import Dexie, { type Table } from 'dexie'

import type { StorageEntry } from '../types'
import { publishChange } from './channel'

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

/** Delete every entry with a numeric expiry in the past; broadcast tombstones. Returns the count removed. */
export async function clearExpired(database: StorageDb = db): Promise<number> {
  const expired = await database.entries.where('expiresAt').below(Date.now()).toArray()
  if (expired.length === 0) return 0
  await database.entries.bulkDelete(expired.map((entry) => entry.key))
  for (const entry of expired) publishChange(entry.key, null)
  return expired.length
}
