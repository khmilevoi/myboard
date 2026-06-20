import * as errore from 'errore'
import type { z } from 'zod'

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

/** A key's current value. value=null means deleted / absent / expired. */
export type StorageChange<T = unknown> = { value: T | null }

/** Receives a validated change, or an error — always as a value. */
export type StorageListener<T = unknown> = (event: StorageError | StorageChange<T>) => void

export type StorageApi = {
  get<T>(key: string, schema?: z.ZodType<T>): Promise<StorageError | T | null>
  set<T>(
    key: string,
    value: T,
    options?: StorageOptions,
  ): Promise<StorageError | void>
  delete(key: string): Promise<StorageError | void>
  has(key: string): Promise<StorageError | boolean>
  keys(prefix?: string): Promise<StorageError | string[]>
  append<T extends Record<string, unknown>>(
    key: string,
    entry: T,
    options?: { cap?: number },
  ): Promise<StorageError | void>
  subscribe<T>(
    key: string,
    listener: StorageListener<T>,
    schema?: z.ZodType<T>,
  ): () => void
}

