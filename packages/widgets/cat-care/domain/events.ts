import type { InferWidgetEvents } from '@shared/widgets/contracts'
import { z } from 'zod'

import { CatCareCommandSchema, IdSchema } from './schemas'

export const catCareEventSchemas = {
  write: {
    payload: z.object({ mutationId: IdSchema, command: CatCareCommandSchema }),
    result: z.object({ ok: z.literal(true) }),
  },
} as const
export type CatCareEvents = InferWidgetEvents<typeof catCareEventSchemas>
