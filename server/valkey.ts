import Valkey from 'iovalkey'

export type ValkeyOps = {
  get(key: string): Promise<string | null>
  set(key: string, value: string, ttlMs?: number): Promise<void>
  del(key: string): Promise<void>
  scanKeys(matchPrefix: string): Promise<string[]>
}

export function createValkeyOps(url = process.env.VALKEY_URL ?? 'redis://localhost:6379'): ValkeyOps {
  const client = new Valkey(url)
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
  }
}
