import Valkey from 'iovalkey'

export type ValkeyOps = {
  get(key: string): Promise<string | null>
  set(key: string, value: string, ttlMs?: number): Promise<void>
  del(key: string): Promise<void>
  scanKeys(matchPrefix: string): Promise<string[]>
  publish(channel: string, message: string): Promise<void>
}

function buildOps(client: Valkey): ValkeyOps {
  return {
    async get(key) {
      return client.get(key)
    },
    async set(key, value, ttlMs) {
      if (ttlMs != null) await client.set(key, value, 'PX', ttlMs)
      else await client.set(key, value)
    },
    async del(key) {
      await client.del(key)
    },
    async scanKeys(matchPrefix) {
      const escaped = matchPrefix.replace(/[*?[\]\\]/g, '\\$&')
      const found: string[] = []
      let cursor = '0'
      do {
        const [next, batch] = await client.scan(cursor, 'MATCH', `${escaped}*`, 'COUNT', 100)
        cursor = next
        found.push(...batch)
      } while (cursor !== '0')
      return found
    },
    async publish(channel, message) {
      await client.publish(channel, message)
    },
  }
}

export function createValkeyOps(
  url = process.env.VALKEY_URL ?? 'redis://localhost:6379',
): ValkeyOps {
  return buildOps(new Valkey(url))
}

export type ValkeyTestOps = ValkeyOps & { clear(): Promise<void> }

/** Same as createValkeyOps plus a destructive clear() for e2e test resets.
 *  Only test-server.ts may use this — the production entry never does. */
export function createValkeyTestOps(
  url = process.env.VALKEY_URL ?? 'redis://localhost:6379',
): ValkeyTestOps {
  const client = new Valkey(url)
  return {
    ...buildOps(client),
    async clear() {
      await client.flushdb()
    },
  }
}

/** Subscribe to a channel on a dedicated connection. Returns a teardown function. */
export function createValkeySubscriber(
  channel: string,
  onMessage: (message: string) => void,
  url = process.env.VALKEY_URL ?? 'redis://localhost:6379',
): () => void {
  const client = new Valkey(url)
  void client.subscribe(channel)
  client.on('message', (_channel, message) => onMessage(message))
  return () => {
    void client.unsubscribe(channel)
    client.disconnect()
  }
}
