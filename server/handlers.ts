import { randomUUID } from 'node:crypto'
import type { AppendPayload } from './schemas'
import type { ValkeyOps } from './valkey'

export type HandlerResult = { status: number; body?: unknown }

export async function handleGet(ops: ValkeyOps, key: string): Promise<HandlerResult> {
  const raw = await ops.get(key)
  if (raw === null) return { status: 404 }
  return { status: 200, body: { value: JSON.parse(raw) } }
}

export async function handlePut(
  ops: ValkeyOps,
  key: string,
  payload: { value: unknown; ttlMs?: number },
): Promise<HandlerResult> {
  await ops.set(key, JSON.stringify(payload.value), payload.ttlMs)
  return { status: 204 }
}

export async function handleAppend(
  ops: ValkeyOps,
  key: string,
  payload: AppendPayload,
  ip: string,
): Promise<{ status: number; value: unknown[] }> {
  const raw = await ops.get(key)
  const parsed: unknown = raw === null ? [] : JSON.parse(raw)
  const current: unknown[] = Array.isArray(parsed) ? parsed : []
  const enriched = { ...payload.entry, id: randomUUID(), ts: Date.now(), ip }

  current.push(enriched)

  const value =
    payload.cap != null && current.length > payload.cap
      ? current.slice(current.length - payload.cap)
      : current

  await ops.set(key, JSON.stringify(value))
  return { status: 204, value }
}

export async function handleDelete(ops: ValkeyOps, key: string): Promise<HandlerResult> {
  await ops.del(key)
  return { status: 204 }
}

export async function handleKeys(ops: ValkeyOps, prefix: string): Promise<HandlerResult> {
  const keys = await ops.scanKeys(prefix)
  return { status: 200, body: { keys } }
}

export const EVENTS_CHANNEL = 'storage:events'

export async function publishChange(ops: ValkeyOps, key: string, value: unknown): Promise<void> {
  await ops.publish(EVENTS_CHANNEL, JSON.stringify({ key, value }))
}
