import type { InferWidgetEvents } from '@shared/widgets/contracts'
import { z } from 'zod'

import { MAX_RANGE_MONTHS, MAX_TIMESTAMP, monthSpan } from './keys'
import { MeasurementSchema } from './measurement'
import { METRIC_KINDS } from './metrics'
import { ProfileSchema } from './profile'

const OkSchema = z.object({ ok: z.literal(true) })
const MetricKindSchema = z.enum(METRIC_KINDS)

const ListMeasurementsPayloadSchema = z
  .object({
    kinds: z.array(MetricKindSchema).min(1).optional(),
    from: z.number().int().nonnegative().max(MAX_TIMESTAMP),
    to: z.number().int().nonnegative().max(MAX_TIMESTAMP),
  })
  .refine((p) => p.from <= p.to, { message: 'from must not be after to', path: ['from'] })
  .refine((p) => p.from > p.to || monthSpan(p.from, p.to) <= MAX_RANGE_MONTHS, {
    message: `range must not span more than ${MAX_RANGE_MONTHS} months`,
    path: ['to'],
  })

export const healthActionSchemas = {
  getProfile: { payload: z.object({}), result: ProfileSchema.nullable() },
  setProfile: { payload: ProfileSchema, result: OkSchema },
  listMeasurements: {
    payload: ListMeasurementsPayloadSchema,
    result: z.array(MeasurementSchema),
  },
  latestMeasurement: {
    payload: z.object({ kind: MetricKindSchema }),
    result: MeasurementSchema.nullable(),
  },
} as const

export type HealthActions = InferWidgetEvents<typeof healthActionSchemas>
