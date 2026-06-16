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

export async function handleDelete(ops: ValkeyOps, key: string): Promise<HandlerResult> {
  await ops.del(key)
  return { status: 204 }
}

export async function handleKeys(ops: ValkeyOps, prefix: string): Promise<HandlerResult> {
  const keys = await ops.scanKeys(prefix)
  return { status: 200, body: { keys } }
}
