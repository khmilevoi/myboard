import type { InferWidgetEvents } from '@shared/widgets/contracts'
import { z } from 'zod'

import {
  CatProfileFieldsSchema,
  CatProfileSchema,
  GoalEntrySchema,
  LitterChoiceSchema,
  WeighingSchema,
} from './cat'
import { EntityIdSchema } from './ids'
import { IsoDateSchema } from './roster'

const OkSchema = z.object({ ok: z.literal(true) })
// The litter id becomes a storage-key segment on the server, so its schema is
// the guard against a forged id reaching another key.
const DayPayloadSchema = z.object({ litterId: EntityIdSchema, date: IsoDateSchema })
// Likewise every cat id becomes a `cat/<id>/…` segment, and an `existing` litter choice a
// `litter/<id>/…` one, so both are `EntityIdSchema` values here.
const CatPayloadSchema = z.object({ catId: EntityIdSchema })

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
  addCat: {
    payload: z.object({
      name: CatProfileSchema.shape.name,
      litter: LitterChoiceSchema,
      birthDate: CatProfileSchema.shape.birthDate.optional(),
      sex: CatProfileSchema.shape.sex.optional(),
    }),
    result: z.object({ ok: z.literal(true), catId: EntityIdSchema }),
  },
  archiveCat: { payload: CatPayloadSchema, result: OkSchema },
  restoreCat: { payload: CatPayloadSchema, result: OkSchema },
  saveProfile: {
    payload: CatPayloadSchema.extend({
      profile: CatProfileFieldsSchema,
      litter: LitterChoiceSchema,
    }),
    result: OkSchema,
  },
  setGoal: {
    payload: CatPayloadSchema.extend({
      kcal: GoalEntrySchema.shape.kcal,
      since: GoalEntrySchema.shape.since,
    }),
    result: OkSchema,
  },
  weigh: {
    payload: CatPayloadSchema.extend({ kg: WeighingSchema.shape.kg, at: WeighingSchema.shape.at }),
    result: OkSchema,
  },
} as const

export type CatsActions = InferWidgetEvents<typeof catsActionSchemas>
