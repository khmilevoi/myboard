import type { InferWidgetEvents } from '@shared/widgets/contracts'
import { z } from 'zod'

import { EntityIdSchema } from './ids'
import { IsoDateSchema } from './roster'

const OkSchema = z.object({ ok: z.literal(true) })
// The litter id becomes a storage-key segment on the server, so its schema is
// the guard against a forged id reaching another key.
const DayPayloadSchema = z.object({ litterId: EntityIdSchema, date: IsoDateSchema })

export const catsActionSchemas = {
  clean: { payload: DayPayloadSchema, result: OkSchema },
  debt: { payload: DayPayloadSchema, result: OkSchema },
  forgive: { payload: DayPayloadSchema, result: OkSchema },
  undo: { payload: DayPayloadSchema, result: OkSchema },
  comment: {
    payload: z.object({
      litterId: EntityIdSchema,
      weekStart: IsoDateSchema,
      text: z.string().min(1).max(2000),
    }),
    result: OkSchema,
  },
} as const

export type CatsActions = InferWidgetEvents<typeof catsActionSchemas>
