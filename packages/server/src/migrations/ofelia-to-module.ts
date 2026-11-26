import { copyKey, OfeliaCopyError, type CopyMode } from './record-copy'
import type { Migration } from './runner'

export { OfeliaCopyError }

const LABEL = 'ofelia-to-module'

// Hard-coded on purpose: a migration records history and must not move if the
// module's key helpers change later.
const copies = [
  { source: 'w:t:ofelia-poop-duty:', target: 'm:ofelia:s:duty/', mode: 'merge' },
  { source: 'cron:ofelia-poop-duty:', target: 'cron:module:ofelia:', mode: 'copy-if-missing' },
] as const satisfies readonly { source: string; target: string; mode: CopyMode }[]

/**
 * Copies the pre-module widget keys into the module's keys and leaves the originals untouched
 * (they are the rollback). Repeatable: a rollback to the pre-module release writes to the old keys
 * only, so every boot of the module release merges those records in again. Idempotent — a run
 * with nothing new to import writes nothing.
 */
export const ofeliaToModuleMigration: Migration = {
  name: 'ofelia-to-module',
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
  },
}
