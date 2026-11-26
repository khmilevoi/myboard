import {
  copyKey,
  field,
  idOf,
  OfeliaCopyError,
  type CopyMode,
  type RecordFilter,
} from './record-copy'
import type { Migration } from './runner'

const LABEL = 'ofelia-to-cats'

/**
 * Keeps the old release's cron from overriding what users decided in the cats release.
 *
 * During a rollback the old release reads only `m:ofelia:s:duty/ledger`, which lacks every decision
 * made in the cats release. Its first cron run therefore writes a system `cleaned` for each of the
 * last seven days that look open there, stamped later than those decisions. Merged as is, each one
 * would win its day by `ts` and silently replace a user's debt, forgiveness or clean. So a system
 * record is dropped when:
 * - the target holds a record for the same `date` that the source lacks: every ledger type is a day
 *   outcome, and that record is a decision the old release never saw; or
 * - it carries `onBehalfOf`, and the target holds any record the source lacks: it settles a debt
 *   computed from a ledger missing those decisions, and could repay a debt a second time.
 *
 * Dropping is safe: a day that is really open is closed again by the cats cron, from a fresh read
 * of the full ledger, on its next run. Users' own records from the rollback are always merged.
 * Fields are read raw on purpose: like the keys below, this must not move with the module schemas.
 */
const keepLedgerRecord: RecordFilter = (record, { target, source }) => {
  const createdBy = field(record, 'createdBy')
  if (field(createdBy, 'system') !== true) return true

  const seenByOldRelease = new Set(source.map(idOf))
  const unseen = target.filter((entry) => {
    const id = idOf(entry)
    return id !== null && !seenByOldRelease.has(id)
  })
  if (unseen.length === 0) return true
  if (field(record, 'onBehalfOf') != null) return false
  const date = field(record, 'date')
  return !unseen.some((entry) => field(entry, 'date') === date)
}

// Hard-coded on purpose: a migration records history and must not move if the
// module's key helpers change later. The `m:ofelia:` keys are the rollback and are never touched.
const copies = [
  {
    source: 'm:ofelia:s:duty/ledger',
    target: 'm:cats:s:litter/ofelia/ledger',
    mode: 'merge',
    keep: keepLedgerRecord,
  },
  {
    source: 'm:ofelia:s:duty/comments:',
    target: 'm:cats:s:litter/ofelia/comments:',
    mode: 'merge',
  },
  { source: 'cron:module:ofelia:', target: 'cron:module:cats:', mode: 'copy-if-missing' },
] as const satisfies readonly {
  source: string
  target: string
  mode: CopyMode
  keep?: RecordFilter
}[]

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
    for (const copy of copies) {
      const { source, target, mode } = copy
      const keep = 'keep' in copy ? copy.keep : undefined
      const keys = await ops
        .scanKeys(source)
        .catch((e) => new OfeliaCopyError({ source, target, cause: e }))
      if (keys instanceof Error) return keys

      for (const key of keys) {
        const targetKey = target + key.slice(source.length)
        const result = await copyKey(ops, key, targetKey, mode, LABEL, keep)
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
