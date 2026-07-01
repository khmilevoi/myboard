import type { ServerResponse } from 'node:http'

export type SseConnection = { id: string; res: ServerResponse; keys: Set<string> }

export class SseRegistry {
  private connections = new Map<string, SseConnection>()
  private keyIndex = new Map<string, Set<string>>()

  add(id: string, res: ServerResponse): SseConnection {
    const conn: SseConnection = { id, res, keys: new Set() }
    this.connections.set(id, conn)
    return conn
  }

  remove(id: string): void {
    const conn = this.connections.get(id)
    if (!conn) return
    for (const key of conn.keys) this.dropFromKey(id, key)
    this.connections.delete(id)
  }

  subscribe(id: string, keys: string[]): void {
    const conn = this.connections.get(id)
    if (!conn) return
    for (const key of keys) {
      conn.keys.add(key)
      let set = this.keyIndex.get(key)
      if (!set) {
        set = new Set()
        this.keyIndex.set(key, set)
      }
      set.add(id)
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
    if (conn) writeSseEvent(conn.res, undefined, message)
  }
}
