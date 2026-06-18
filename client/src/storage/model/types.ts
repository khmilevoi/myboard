import * as errore from 'errore'

export type StorageOptions = { ttlMs?: number }

export type StorageEntry<T = unknown> = {
  /** Full namespaced key (primary key in Dexie). */
  key: string
  /** Scope prefix the entry belongs to (indexed for listing/cleanup). */
  namespace: string
  value: T
  /** Epoch ms when the entry expires; null = never. */
  expiresAt: number | null
  /** Epoch ms of the last write. */
  updatedAt: number
}

export class StorageError extends errore.createTaggedError({
  name: 'StorageError',
  message: 'Storage operation failed: $reason',
}) {}

export type StorageApi = {
  get<T>(key: string): Promise<StorageError | T | null>
  set<T>(key: string, value: T, options?: StorageOptions): Promise<StorageError | void>
  delete(key: string): Promise<StorageError | void>
  has(key: string): Promise<StorageError | boolean>
  keys(prefix?: string): Promise<StorageError | string[]>
}
