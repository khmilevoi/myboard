import { vi } from 'vitest'

import { db } from '../client/db'
import type {
  StorageApi,
  StorageChange,
  StorageError,
  StorageListener,
  StorageOptions,
} from '../types'

const macrotask = () => new Promise((resolve) => setTimeout(resolve, 0))

/**
 * Test-only: wipe the shared client (Dexie) storage between tests. The db and
 * its publish channel are module singletons, so without this every test file
 * leaks persisted rows AND in-flight write publishes into later tests — a
 * fresh subscription on the same key receives the previous test's board.
 * The first hop flushes pending reatom change hooks so their writes enter the
 * Dexie queue; clear() then queues behind them; the last hop lets their
 * publishes fire while no subscriber is connected yet.
 */
export async function resetClientStorage(): Promise<void> {
  await macrotask()
  await db.entries.clear()
  await macrotask()
}

/** In-memory BroadcastChannel: instances with the same name see each other's posts. */
export class FakeBroadcastChannel {
  static channels = new Map<string, Set<FakeBroadcastChannel>>()
  onmessage: ((event: MessageEvent) => void) | null = null
  private listeners = new Set<(event: MessageEvent) => void>()

  constructor(public name: string) {
    const peers = FakeBroadcastChannel.channels.get(name) ?? new Set()
    peers.add(this)
    FakeBroadcastChannel.channels.set(name, peers)
  }

  addEventListener(_type: 'message', listener: (event: MessageEvent) => void) {
    this.listeners.add(listener)
  }

  removeEventListener(_type: 'message', listener: (event: MessageEvent) => void) {
    this.listeners.delete(listener)
  }

  postMessage(data: unknown) {
    const peers = FakeBroadcastChannel.channels.get(this.name) ?? new Set()
    for (const peer of peers) {
      if (peer === this) continue // real BroadcastChannel does not echo to sender
      const event = { data } as MessageEvent
      peer.onmessage?.(event)
      for (const listener of peer.listeners) listener(event)
    }
  }

  close() {
    FakeBroadcastChannel.channels.get(this.name)?.delete(this)
  }
}

export function installFakeBroadcastChannel() {
  FakeBroadcastChannel.channels.clear()
  vi.stubGlobal('BroadcastChannel', FakeBroadcastChannel)
}

/**
 * In-memory StorageApi double for model tests. Keys are used verbatim (no
 * namespacing); TTL and schema validation are intentionally ignored.
 */
export function createFakeStorage(): StorageApi {
  const store = new Map<string, unknown>()
  const listeners = new Map<string, Set<(event: StorageError | StorageChange) => void>>()

  function emit(key: string): void {
    const value = store.has(key) ? store.get(key) : null

    for (const listener of listeners.get(key) ?? []) listener({ value })
  }

  return {
    async get<T>(key: string): Promise<StorageError | T | null> {
      return store.has(key) ? (store.get(key) as T) : null
    },
    async set<T>(key: string, value: T, _options?: StorageOptions): Promise<StorageError | void> {
      store.set(key, value)
      emit(key)
    },
    async delete(key: string): Promise<StorageError | void> {
      store.delete(key)
      emit(key)
    },
    async has(key: string): Promise<StorageError | boolean> {
      return store.has(key)
    },
    async keys(prefix?: string): Promise<StorageError | string[]> {
      const all = [...store.keys()]
      return prefix ? all.filter((key) => key.startsWith(prefix)) : all
    },
    async append<T extends Record<string, unknown>>(
      key: string,
      entry: T,
      options?: { cap?: number },
    ): Promise<StorageError | void> {
      const existing = store.get(key)
      const current: unknown[] = Array.isArray(existing) ? existing : []
      current.push(entry)
      const next =
        options?.cap != null && current.length > options.cap
          ? current.slice(current.length - options.cap)
          : current
      store.set(key, next)
      emit(key)
    },
    subscribe<T>(key: string, listener: StorageListener<T>): () => void {
      const set = listeners.get(key) ?? new Set()
      set.add(listener as (event: StorageError | StorageChange) => void)
      listeners.set(key, set)
      listener({ value: (store.has(key) ? store.get(key) : null) as T | null })
      return () => set.delete(listener as (event: StorageError | StorageChange) => void)
    },
  }
}
