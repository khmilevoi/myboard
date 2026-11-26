import { copyKey, OfeliaCopyError, type CopyMode } from './record-copy'
import type { Migration } from './runner'

const LABEL = 'ofelia-to-cats'

// Hard-coded on purpose: a migration records history and must not move if the
// module's key helpers change later. The `m:ofelia:` keys are the rollback and are never touched.
const copies = [
  { source: 'm:ofelia:s:duty/ledger', target: 'm:cats:s:litter/ofelia/ledger', mode: 'merge' },
  {
    source: 'm:ofelia:s:duty/comments:',
    target: 'm:cats:s:litter/ofelia/comments:',
    mode: 'merge',
  },
  { source: 'cron:module:ofelia:', target: 'cron:module:cats:', mode: 'copy-if-missing' },
] as const satisfies readonly { source: string; target: string; mode: CopyMode }[]

// Written only when absent, with no TTL.
const seeds = [
  ['m:cats:s:registry/cats', '[{"id":"seed:ofelia","ts":0,"catId":"ofelia","op":"add"}]'],
  ['m:cats:s:registry/litters', '[{"id":"seed:ofelia","ts":0,"litterId":"ofelia","op":"add"}]'],
  ['m:cats:s:litter/ofelia/settings', '{"rotation":["Леша","Карина"],"baseDate":"2026-06-16"}'],
  [
    'm:cats:s:cat/ofelia/profile',
    '{"name":"Офелия","breed":null,"birthDate":null,"sex":null,"sterilized":"unknown","bodyCondition":null,"avatar":null,"litterId":"ofelia"}',
  ],
] as const

/**
 * Moves Ofelia's `ofelia` module data into the multi-cat `cats` module: litter `ofelia`, cat
 * `ofelia`. Repeatable, like `ofelia-to-module`: a rollback to the `ofelia` release writes only to
 * the old keys, so each boot of the cats release merges those records in again. A run with nothing
 * new to import writes nothing.
 */
export const ofeliaToCatsMigration: Migration = {
  name: 'ofelia-to-cats',
  repeatable: true,
  async run(ops) {
    for (const { source, target, mode } of copies) {
      const keys = await ops
        .scanKeys(source)
        .catch((e) => new OfeliaCopyError({ source, target, cause: e }))
      if (keys instanceof Error) return keys

      for (const key of keys) {
        const result = await copyKey(ops, key, target + key.slice(source.length), mode, LABEL)
        if (result instanceof Error) return result
      }
    }

    for (const [key, value] of seeds) {
      const existing = await ops
        .get(key)
        .catch((e) => new OfeliaCopyError({ source: 'seed', target: key, cause: e }))
      if (existing instanceof Error) return existing
      if (existing !== null) continue
      const written = await ops
        .set(key, value)
        .catch((e) => new OfeliaCopyError({ source: 'seed', target: key, cause: e }))
      if (written instanceof Error) return written
    }
  },
}
