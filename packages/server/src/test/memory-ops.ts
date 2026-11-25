import type { ValkeyOps } from '../storage/valkey'

export type MemoryPubSub = {
  publish(channel: string, message: string): void
  subscribe(channel: string, onMessage: (message: string) => void): () => void
}

export function createMemoryPubSub(): MemoryPubSub {
  const listeners = new Map<string, Set<(message: string) => void>>()
  return {
    publish(channel, message) {
      for (const listener of listeners.get(channel) ?? []) listener(message)
    },
    subscribe(channel, onMessage) {
      let set = listeners.get(channel)
      if (!set) {
        set = new Set()
        listeners.set(channel, set)
      }
      set.add(onMessage)
      return () => {
        set.delete(onMessage)
        if (set.size === 0) listeners.delete(channel)
      }
    },
  }
}

export type MemoryOps = ValkeyOps & { clear(): void }

export function createMemoryOps(pubsub: MemoryPubSub): MemoryOps {
  const store = new Map<string, string>()
  const ttls = new Map<string, number>()
  return {
    async get(key) {
      return store.has(key) ? (store.get(key) as string) : null
    },
    async set(key, value, ttlMs) {
      store.set(key, value)
      if (ttlMs != null) ttls.set(key, ttlMs)
      else ttls.delete(key)
    },
    async del(key) {
      store.delete(key)
      ttls.delete(key)
    },
    async getdel(key) {
      const value = store.has(key) ? (store.get(key) as string) : null
      store.delete(key)
      ttls.delete(key)
      return value
    },
    async pttl(key) {
      if (!store.has(key)) return -2
      return ttls.get(key) ?? -1
    },
    async scanKeys(matchPrefix) {
      return [...store.keys()].filter((key) => key.startsWith(matchPrefix))
    },
    async publish(channel, message) {
      pubsub.publish(channel, message)
    },
    clear() {
      store.clear()
      ttls.clear()
    },
  }
}
