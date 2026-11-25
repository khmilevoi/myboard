import type { ServerResponse } from 'node:http'

// `keys` maps one full storage key to ONE frame key. Plain subscriptions use frame key = full key;
// scoped ones use a `scoped:` frame key. The two can never target the same full key: scoped
// namespaces (w:a:, m:) lie outside ALLOWED_STORAGE_NAMESPACES, and the events POST refuses any
// plain subscribe outside that allowlist (pinned in storage/scoped-events.test.ts).
export type SseConnection = { id: string; res: ServerResponse; keys: Map<string, string> }

export class SseRegistry {
  private connections = new Map<string, SseConnection>()
  private keyIndex = new Map<string, Set<string>>()

  add(id: string, res: ServerResponse): SseConnection {
    const conn: SseConnection = { id, res, keys: new Map() }
    this.connections.set(id, conn)
    return conn
  }

  remove(id: string): void {
    const conn = this.connections.get(id)
    if (!conn) return
    for (const key of conn.keys.keys()) this.dropFromKey(id, key)
    this.connections.delete(id)
  }

  subscribe(id: string, keys: string[]): void {
    const conn = this.connections.get(id)
    if (!conn) return
    this.subscribeScoped(
      id,
      keys.map((key) => ({ fullKey: key, frameKey: key })),
    )
  }

  /** Subscribes to full storage keys but delivers them under the caller's frame key. */
  subscribeScoped(id: string, entries: { fullKey: string; frameKey: string }[]): void {
    const conn = this.connections.get(id)
    if (!conn) return
    for (const { fullKey, frameKey } of entries) {
      conn.keys.set(fullKey, frameKey)
      let set = this.keyIndex.get(fullKey)
      if (!set) {
        set = new Set()
        this.keyIndex.set(fullKey, set)
      }
      set.add(id)
    }
  }

  unsubscribeFrames(id: string, frameKeys: string[]): void {
    const conn = this.connections.get(id)
    if (!conn) return
    const frames = new Set(frameKeys)
    for (const [fullKey, frameKey] of [...conn.keys]) {
      if (!frames.has(frameKey)) continue
      conn.keys.delete(fullKey)
      this.dropFromKey(id, fullKey)
    }
  }

  unsubscribe(id: string, keys: string[]): void {
    const conn = this.connections.get(id)
    if (!conn) return
    for (const key of keys) {
      conn.keys.delete(key)
      this.dropFromKey(id, key)
    }
  }

  subscribersOf(key: string): string[] {
    return [...(this.keyIndex.get(key) ?? [])]
  }

  connection(id: string): SseConnection | undefined {
    return this.connections.get(id)
  }

  private dropFromKey(id: string, key: string): void {
    const set = this.keyIndex.get(key)
    if (!set) return
    set.delete(id)
    if (set.size === 0) this.keyIndex.delete(key)
  }
}

export function writeSseEvent(res: ServerResponse, event: string | undefined, data: unknown): void {
  if (event) res.write(`event: ${event}\n`)
  res.write(`data: ${JSON.stringify(data)}\n\n`)
}

export function fanout(registry: SseRegistry, message: { key: string; value: unknown }): void {
  for (const id of registry.subscribersOf(message.key)) {
    const conn = registry.connection(id)
    if (!conn) continue
    const key = conn.keys.get(message.key) ?? message.key
    writeSseEvent(conn.res, undefined, { ...message, key })
  }
}
