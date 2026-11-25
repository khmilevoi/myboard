import { z } from 'zod'

export const IdSchema = z.string().min(1).max(128)
export const EpochSchema = z.number().finite().int().min(0).max(253402300799999)
const AmountSchema = z.number().finite().min(0).max(1_000_000)
const PositiveAmountSchema = AmountSchema.positive()
const PercentageSchema = z.number().finite().min(0).max(100).nullable()
const NoteSchema = z.string().max(2000)

export const CalendarDateSchema = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}$/)
  .refine((value) => {
    // Temporal is an external throwing API. Domain imports cannot include errore;
    // convert at this boundary, never throw expected validation failures to callers.
    try {
      Temporal.PlainDate.from(value)
      return true
    } catch {
      return false
    }
  }, 'Укажите существующую дату')

export const TimeZoneSchema = z
  .string()
  .max(100)
  .refine((value) => {
    if (/^[+-]/.test(value)) return false
    try {
      new Intl.DateTimeFormat('en', { timeZone: value })
      return true
    } catch {
      return false
    }
  }, 'Укажите часовой пояс IANA')

export const NutritionSchema = z.object({
  kcalPer100g: z.number().finite().positive().max(1000),
  proteinPer100g: PercentageSchema,
  fatPer100g: PercentageSchema,
  carbsPer100g: PercentageSchema,
  moisturePercent: PercentageSchema,
})
export type Nutrition = z.infer<typeof NutritionSchema>

export const CalorieTargetSchema = z.object({
  kcal: PositiveAmountSchema,
  source: z.enum(['manual', 'estimate']),
  effectiveFrom: CalendarDateSchema,
})
export type CalorieTarget = z.infer<typeof CalorieTargetSchema>

export const CatProfileSchema = z.object({
  name: z.string().trim().min(1).max(80),
  birthDate: CalendarDateSchema.nullable(),
  neutered: z.boolean().nullable(),
  timeZone: TimeZoneSchema,
  bodyConditionScore: z.number().int().min(1).max(9).nullable(),
  calorieTarget: CalorieTargetSchema.nullable(),
})
export type CatProfile = z.infer<typeof CatProfileSchema>
export const DEFAULT_PROFILE: CatProfile = {
  name: 'Кошка',
  birthDate: null,
  neutered: null,
  timeZone: 'Europe/Warsaw',
  bodyConditionScore: null,
  calorieTarget: null,
}

export const ProductSnapshotSchema = z.object({
  name: z.string().trim().min(1).max(160),
  kind: z.enum(['dry', 'wet', 'treat', 'other']),
  completeness: z.enum(['complete', 'complementary', 'unknown']),
  nutrition: NutritionSchema,
})
export type ProductSnapshot = z.infer<typeof ProductSnapshotSchema>
export const ProductSchema = ProductSnapshotSchema.extend({
  id: IdSchema,
  defaultPortionGrams: PositiveAmountSchema.nullable(),
  archived: z.boolean(),
})
export type Product = z.infer<typeof ProductSchema>

export const FoodRecordSchema = z
  .object({
    id: IdSchema,
    occurredAt: EpochSchema,
    productId: IdSchema,
    snapshot: ProductSnapshotSchema,
    grams: PositiveAmountSchema,
    mode: z.enum(['eaten', 'offered']),
    remainingGrams: AmountSchema.nullable(),
    observedAt: EpochSchema.nullable(),
    note: NoteSchema,
  })
  .superRefine((record, context) => {
    if (record.mode === 'eaten' && (record.remainingGrams !== null || record.observedAt !== null)) {
      context.addIssue({
        code: 'custom',
        path: ['remainingGrams'],
        message: 'Для съеденной порции остаток не нужен',
      })
    }
    if ((record.remainingGrams === null) !== (record.observedAt === null)) {
      context.addIssue({
        code: 'custom',
        path: ['observedAt'],
        message: 'Укажите остаток и время измерения вместе',
      })
    }
    if (record.remainingGrams !== null && record.remainingGrams > record.grams) {
      context.addIssue({
        code: 'custom',
        path: ['remainingGrams'],
        message: 'Остаток не может превышать порцию',
      })
    }
    if (record.observedAt !== null && record.observedAt < record.occurredAt) {
      context.addIssue({
        code: 'custom',
        path: ['observedAt'],
        message: 'Измерение остатка не может быть раньше кормления',
      })
    }
  })
export type FoodRecord = z.infer<typeof FoodRecordSchema>

export const WaterRecordSchema = z.object({
  id: IdSchema,
  occurredAt: EpochSchema,
  kind: z.enum(['replace', 'topup']),
  addedMl: AmountSchema,
  remainingMl: AmountSchema.nullable(),
  discardedMl: AmountSchema,
  unmeasuredLoss: z.boolean(),
  note: NoteSchema,
})
export type WaterRecord = z.infer<typeof WaterRecordSchema>

// Generous data-entry guard against entering grams in the kilograms field;
// this is not a healthy-weight threshold or a feeding recommendation.
export const MAX_CAT_WEIGHT_KG = 50
export const WeightRecordSchema = z.object({
  id: IdSchema,
  occurredAt: EpochSchema,
  kilograms: PositiveAmountSchema.max(
    MAX_CAT_WEIGHT_KG,
    'Проверьте вес: укажите его в килограммах',
  ),
  note: NoteSchema,
})
export type WeightRecord = z.infer<typeof WeightRecordSchema>

export const CatCareCommandSchema = z.discriminatedUnion('kind', [
  z.object({ kind: z.literal('profile.save'), profile: CatProfileSchema }),
  z.object({ kind: z.literal('product.save'), product: ProductSchema }),
  z.object({ kind: z.literal('food.save'), food: FoodRecordSchema }),
  z.object({ kind: z.literal('water.save'), water: WaterRecordSchema }),
  z.object({ kind: z.literal('weight.save'), weight: WeightRecordSchema }),
  z.object({
    kind: z.literal('record.delete'),
    entity: z.enum(['food', 'water', 'weight']),
    recordId: IdSchema,
  }),
])
export type CatCareCommand = z.infer<typeof CatCareCommandSchema>
export const CreatedBySchema = z.object({ accountId: z.string(), name: z.string() })
export const LedgerEntrySchema = z.object({
  id: IdSchema,
  ts: EpochSchema,
  createdBy: CreatedBySchema.nullable(),
  mutationId: IdSchema,
  command: CatCareCommandSchema,
})
export type LedgerEntry = z.infer<typeof LedgerEntrySchema>
export type LedgerEntryDraft = Omit<LedgerEntry, 'id' | 'ts'>
export const LedgerEntriesSchema = z.array(z.unknown()).transform((rows) =>
  rows.flatMap((row) => {
    const parsed = LedgerEntrySchema.safeParse(row)
    if (!parsed.success) {
      console.warn('Skipping invalid cat care ledger entry', parsed.error)
      return []
    }
    return [parsed.data]
  }),
)
export type CatCareState = {
  profile: CatProfile
  profileHistory: { ts: number; profile: CatProfile }[]
  products: Product[]
  foods: FoodRecord[]
  water: WaterRecord[]
  weights: WeightRecord[]
}
