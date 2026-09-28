import type {
  CatProfile,
  FoodRecord,
  LedgerEntry,
  Product,
  WaterRecord,
  WeightRecord,
} from './schemas'

export const profile: CatProfile = {
  name: 'Мурка',
  birthDate: '2022-09-28',
  neutered: true,
  timeZone: 'Europe/Warsaw',
  bodyConditionScore: null,
  calorieTarget: null,
}
export const product: Product = {
  id: 'dry',
  name: 'Сухой корм',
  kind: 'dry',
  completeness: 'complete',
  archived: false,
  defaultPortionGrams: 30,
  nutrition: {
    kcalPer100g: 400,
    proteinPer100g: 30,
    fatPer100g: 15,
    carbsPer100g: null,
    moisturePercent: 10,
  },
}
export const time = Date.parse('2026-09-28T10:00:00Z')
export function food(overrides: Partial<FoodRecord> = {}): FoodRecord {
  return {
    id: 'meal',
    occurredAt: time,
    productId: product.id,
    snapshot: {
      name: product.name,
      kind: product.kind,
      completeness: product.completeness,
      nutrition: { ...product.nutrition },
    },
    grams: 30,
    mode: 'eaten',
    remainingGrams: null,
    observedAt: null,
    note: '',
    ...overrides,
  }
}
export function water(overrides: Partial<WaterRecord> = {}): WaterRecord {
  return {
    id: 'water',
    occurredAt: time,
    kind: 'replace',
    addedMl: 200,
    remainingMl: null,
    discardedMl: 0,
    unmeasuredLoss: false,
    note: '',
    ...overrides,
  }
}
export function weight(overrides: Partial<WeightRecord> = {}): WeightRecord {
  return { id: 'weight', occurredAt: time, kilograms: 4, note: '', ...overrides }
}
export function entry(
  command: LedgerEntry['command'],
  overrides: Partial<LedgerEntry> = {},
): LedgerEntry {
  return {
    id: `entry-${command.kind}`,
    ts: time,
    createdBy: null,
    mutationId: `mutation-${command.kind}`,
    command,
    ...overrides,
  }
}
