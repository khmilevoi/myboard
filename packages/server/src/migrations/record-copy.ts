import * as errore from 'errore'

import type { ValkeyOps } from '../storage/valkey'

export class OfeliaCopyError extends errore.createTaggedError({
  name: 'OfeliaCopyError',
  message: 'Could not copy $source to $target',
}) {}

/**
 * How a source key reaches its target.
 * - `merge`: the value is an append-only array of `{ id, ts, … }` records (the ledger, a week's
 *   comments). The target keeps every record it has; source records whose id it lacks are added.
 * - `copy-if-missing`: an opaque value (the cron cursor); copied only when the target is absent.
 */
export type CopyMode = 'merge' | 'copy-if-missing'

function parseRecords(raw: string): unknown[] | null {
  const parsed = errore.try(() => JSON.parse(raw) as unknown)
  if (parsed instanceof Error) return null
  if (!Array.isArray(parsed)) return null
  return parsed
}

const field = (record: unknown, name: string): unknown =>
  typeof record === 'object' && record !== null ? (record as { [k: string]: unknown })[name] : null
const idOf = (record: unknown) => {
  const id = field(record, 'id')
  return typeof id === 'string' ? id : null
}
const tsOf = (record: unknown) => {
  const ts = field(record, 'ts')
  return typeof ts === 'number' ? ts : Number.NEGATIVE_INFINITY
}

/**
 * Target records plus every source record whose id the target lacks, or `null` when there is
 * nothing to add. The result is stably sorted by `ts`, target first on a tie: the server stamps
 * `ts` at append time, so `ts` order is append order, and the domain resolves a day by highest
 * `ts` with the later-appended record winning a tie (`latestOutcomesByDate`). A stable sort never
 * changes how the target's own records resolve against each other, and slots source-only records
 * (written to the old keys during a rollback) where they would have been appended.
 */
export function mergeRecords(target: unknown[], source: unknown[]): unknown[] | null {
  const known = new Set(target.map(idOf).filter((id) => id !== null))
  // A record with no id cannot be matched; the readers drop it anyway, so it is not imported.
  const missing = source.filter((record) => {
    const id = idOf(record)
    return id !== null && !known.has(id)
  })
  if (missing.length === 0) return null
  return [...target, ...missing]
    .map((record, index) => ({ record, index }))
    .sort((a, b) => tsOf(a.record) - tsOf(b.record) || a.index - b.index)
    .map(({ record }) => record)
}

export async function copyKey(
  ops: ValkeyOps,
  sourceKey: string,
  targetKey: string,
  mode: CopyMode,
  label: string,
) {
  const fail = (cause: unknown) =>
    new OfeliaCopyError({ source: sourceKey, target: targetKey, cause })

  const existing = await ops.get(targetKey).catch(fail)
  if (existing instanceof Error) return existing
  if (existing !== null && mode === 'copy-if-missing') return

  const raw = await ops.get(sourceKey).catch(fail)
  if (raw instanceof Error) return raw
  if (raw === null) return // expired between scan and read

  const ttl = await ops.pttl(sourceKey).catch(fail)
  if (ttl instanceof Error) return ttl
  if (ttl === -2) return // expired between read and PTTL; its TTL is gone with it

  if (existing === null) {
    // PTTL is -1 for no expiry; that is not a valid TTL to pass on.
    const written = await ops.set(targetKey, raw, ttl > 0 ? ttl : undefined).catch(fail)
    if (written instanceof Error) return written
    return
  }

  const target = parseRecords(existing)
  const source = parseRecords(raw)
  if (target === null || source === null) {
    console.warn(`${label}: ${sourceKey} or ${targetKey} is not a record array; skipped`)
    return
  }
  const merged = mergeRecords(target, source)
  if (merged === null) return

  // Keep the target's own expiry; the source's TTL describes a different key.
  const targetTtl = await ops.pttl(targetKey).catch(fail)
  if (targetTtl instanceof Error) return targetTtl
  const written = await ops
    .set(targetKey, JSON.stringify(merged), targetTtl > 0 ? targetTtl : undefined)
    .catch(fail)
  if (written instanceof Error) return written
}
