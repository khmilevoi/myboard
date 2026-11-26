import { z } from 'zod'

import { EntityIdSchema } from './ids'
import { CreatedBySchema } from './ledger'
import { tolerantArraySchema } from './registry'
import { CalendarDateSchema } from './roster'

/** A cat's profile, stored under `catProfileKey`. `litterId` points at the litter it uses. */
export const CatProfileSchema = z.object({
  name: z.string().trim().min(1).max(40),
  breed: z.string().trim().max(60).nullable(),
  birthDate: CalendarDateSchema.nullable(),
  sex: z.enum(['female', 'male']).nullable(),
  sterilized: z.enum(['yes', 'no', 'unknown']),
  bodyCondition: z.number().int().min(1).max(9).nullable(),
  /** A media reference that plan 3 writes. */
  avatar: z.string().max(200).nullable(),
  litterId: EntityIdSchema,
})
export type CatProfile = z.infer<typeof CatProfileSchema>

/** The editable fields: the litter is chosen separately, as a `LitterChoice`. */
export const CatProfileFieldsSchema = CatProfileSchema.omit({ litterId: true })
export type CatProfileFields = z.infer<typeof CatProfileFieldsSchema>

export function defaultCatProfile(name: string, litterId: string): CatProfile {
  return {
    name,
    breed: null,
    birthDate: null,
    sex: null,
    sterilized: 'unknown',
    bodyCondition: null,
    avatar: null,
    litterId,
  }
}

/** One daily kcal goal, in force from `since` until a later entry. Appended under `catGoalKey`. */
export const GoalEntrySchema = z.object({
  id: z.string(),
  ts: z.number(),
  kcal: z.number().int().min(50).max(1000),
  since: CalendarDateSchema,
})
export type GoalEntry = z.infer<typeof GoalEntrySchema>
export const GoalEntriesSchema = tolerantArraySchema(GoalEntrySchema, 'goal entry')

/** The goal in force on `date`: the latest `since <= date`, a tie going to the higher `ts`. */
export function goalOn(goals: readonly GoalEntry[], date: Temporal.PlainDate): number | null {
  const day = date.toString()
  const best = goals.reduce<GoalEntry | null>((current, goal) => {
    if (goal.since > day) return current
    if (current === null) return goal
    if (goal.since !== current.since) return goal.since > current.since ? goal : current
    return goal.ts > current.ts ? goal : current
  }, null)
  return best?.kcal ?? null
}

/** One weighing, appended under `catWeightKey` with the weighing account stamped by the server. */
export const WeighingSchema = z.object({
  id: z.string(),
  ts: z.number(),
  at: CalendarDateSchema,
  kg: z.number().positive().max(30),
  createdBy: CreatedBySchema.nullish(),
})
export type Weighing = z.infer<typeof WeighingSchema>
export const WeighingsSchema = tolerantArraySchema(WeighingSchema, 'weighing')

/** The most recent weighing, ordered by `at`, then `ts`. */
export function latestWeighing(weighings: readonly Weighing[]): Weighing | null {
  return weighings.reduce<Weighing | null>((current, weighing) => {
    if (current === null) return weighing
    if (weighing.at !== current.at) return weighing.at > current.at ? weighing : current
    return weighing.ts > current.ts ? weighing : current
  }, null)
}

/** Which litter a cat uses: one already in the registry, or a new one the server creates. */
export const LitterChoiceSchema = z.discriminatedUnion('kind', [
  z.object({ kind: z.literal('existing'), litterId: EntityIdSchema }),
  z.object({ kind: z.literal('new') }),
])
export type LitterChoice = z.infer<typeof LitterChoiceSchema>

/** "Лоток · Офелия", "Лоток · Офелия и Буся", "Лоток · Офелия, Буся и Мурка". */
export function litterTitle(names: readonly string[]): string {
  if (names.length === 0) return 'Лоток'
  if (names.length === 1) return `Лоток · ${names[0]}`
  const head = names.slice(0, -1).join(', ')
  return `Лоток · ${head} и ${names[names.length - 1]}`
}
