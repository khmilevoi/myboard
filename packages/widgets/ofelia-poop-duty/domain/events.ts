import type { InferWidgetEvents } from '@shared/widgets/contracts'
import { z } from 'zod'

import { IsoDateSchema } from './roster'

const OkSchema = z.object({ ok: z.literal(true) })
const DayPayloadSchema = z.object({ date: IsoDateSchema })

export const ofeliaEventSchemas = {
  clean: { payload: DayPayloadSchema, result: OkSchema },
  debt: { payload: DayPayloadSchema, result: OkSchema },
  forgive: { payload: DayPayloadSchema, result: OkSchema },
  undo: { payload: DayPayloadSchema, result: OkSchema },
  comment: {
    payload: z.object({ weekStart: IsoDateSchema, text: z.string().min(1).max(2000) }),
    result: OkSchema,
  },
} as const

export type OfeliaEvents = InferWidgetEvents<typeof ofeliaEventSchemas>
