import { z } from 'zod'

import { MAX_TIMESTAMP } from './keys'
import { METRIC_KINDS, METRIC_UNITS, type MetricKind } from './metrics'

const MetricValueSchema = z.object({ value: z.number().finite(), unit: z.string() })

const MetricsSchema = z
  .partialRecord(z.enum(METRIC_KINDS), MetricValueSchema)
  .superRefine((metrics, ctx) => {
    const entries = Object.entries(metrics) as [MetricKind, { unit: string }][]
    if (entries.length === 0) {
      ctx.addIssue({ code: 'custom', message: 'metrics must not be empty' })
    }
    for (const [kind, { unit }] of entries) {
      if (unit !== METRIC_UNITS[kind]) {
        ctx.addIssue({
          code: 'custom',
          path: [kind, 'unit'],
          message: `unit for ${kind} must be ${METRIC_UNITS[kind]}`,
        })
      }
    }
  })

export const MeasurementSchema = z.object({
  id: z.string().min(1).max(200),
  takenAt: z.number().int().nonnegative().max(MAX_TIMESTAMP),
  metrics: MetricsSchema,
  source: z.discriminatedUnion('kind', [
    z.object({ kind: z.literal('hardware'), hardwareId: z.string(), model: z.string() }),
  ]),
})

export type Measurement = z.infer<typeof MeasurementSchema>

export const MeasurementLedgerSchema = z.array(MeasurementSchema)
