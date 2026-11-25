import { makeKeyedSerialLane } from '@shared/async/serial-lane'
import { defineWidgetServer } from '@shared/widgets/contracts'
import { PublicWidgetError } from '@shared/widgets/public-error'

import { catCareEventSchemas } from './domain/events'
import { foldLedger, LEDGER_KEY, validateCommand } from './domain/ledger'
import { LedgerEntriesSchema } from './domain/schemas'

const OK = { ok: true } as const
// The application runs one server process, like the storage adapter's own
// append lock. Serialize the whole command so validation and retry detection
// observe the preceding write. Independent cats have independent lanes.
const commands = makeKeyedSerialLane()

export default defineWidgetServer({
  schemas: catCareEventSchemas,
  handlers: {
    write: ({ mutationId, command }, context) =>
      commands.run(context.instanceId, async () => {
        const stored = await context.api.storage.instance.get(LEDGER_KEY, LedgerEntriesSchema)
        if (stored instanceof Error) return stored
        const entries = stored ?? []
        // A lost response may be retried after a later edit or archive. Resolve
        // the original mutation before validating against the newer state.
        const prior = entries.find((entry) => entry.mutationId === mutationId)
        if (prior) {
          if (JSON.stringify(prior.command) === JSON.stringify(command)) return OK
          return new PublicWidgetError({
            code: 'cat_care_invalid_data',
            publicMessage:
              'Эта попытка сохранения уже содержит другие данные. Откройте запись заново.',
          })
        }

        const invalid = validateCommand({
          state: foldLedger(entries),
          command,
          nowMs: context.now(),
        })
        if (invalid instanceof Error) return invalid
        // No cap: observations remain available for long-term weight and diet
        // history. The storage adapter owns id, timestamp and atomic append.
        const written = await context.api.storage.instance.append(LEDGER_KEY, {
          mutationId,
          command,
          createdBy: context.viewer,
        })
        if (written instanceof Error) return written
        return OK
      }),
  },
})
