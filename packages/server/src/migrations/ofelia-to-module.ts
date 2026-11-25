import * as errore from 'errore'

import type { ValkeyOps } from '../storage/valkey'
import type { Migration } from './runner'

export class OfeliaCopyError extends errore.createTaggedError({
  name: 'OfeliaCopyError',
  message: 'Could not copy $source to $target',
}) {}

// Hard-coded on purpose: a migration records history and must not move if the
// module's key helpers change later.
const copies = [
  { source: 'w:t:ofelia-poop-duty:', target: 'm:ofelia:s:duty/' },
  { source: 'cron:ofelia-poop-duty:', target: 'cron:module:ofelia:' },
] as const

async function copyKey(ops: ValkeyOps, sourceKey: string, targetKey: string) {
  const existing = await ops
    .get(targetKey)
    .catch((e) => new OfeliaCopyError({ source: sourceKey, target: targetKey, cause: e }))
  if (existing instanceof Error) return existing
  if (existing !== null) return

  const raw = await ops
    .get(sourceKey)
    .catch((e) => new OfeliaCopyError({ source: sourceKey, target: targetKey, cause: e }))
  if (raw instanceof Error) return raw
  if (raw === null) return // expired between scan and read

  const ttl = await ops
    .pttl(sourceKey)
    .catch((e) => new OfeliaCopyError({ source: sourceKey, target: targetKey, cause: e }))
  if (ttl instanceof Error) return ttl

  // PTTL is -1 for no expiry and -2 for a missing key; neither is a valid TTL.
  const written = await ops
    .set(targetKey, raw, ttl > 0 ? ttl : undefined)
    .catch((e) => new OfeliaCopyError({ source: sourceKey, target: targetKey, cause: e }))
  if (written instanceof Error) return written
}

export const ofeliaToModuleMigration: Migration = {
  name: 'ofelia-to-module',
  async run(ops) {
    for (const { source, target } of copies) {
      const keys = await ops
        .scanKeys(source)
        .catch((e) => new OfeliaCopyError({ source, target, cause: e }))
      if (keys instanceof Error) return keys

      for (const key of keys) {
        const result = await copyKey(ops, key, target + key.slice(source.length))
        if (result instanceof Error) return result
      }
    }
  },
}
