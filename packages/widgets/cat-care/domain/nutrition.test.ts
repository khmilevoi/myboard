// @vitest-environment node
import { describe, expect, it } from 'vitest'

import { MAX_FUTURE_SKEW_MS } from './ledger'
import { calculateFoodNutrition, estimateCalorieTarget } from './nutrition'
import { WeightRecordSchema } from './schemas'
import { food, profile, time, weight } from './test-fixtures'

describe('food nutrition', () => {
  it('calculates manufacturer energy and as-fed nutrient grams', () => {
    expect(calculateFoodNutrition(food())).toMatchObject({
      eatenKcal: 120,
      eatenGrams: 30,
      proteinGrams: 9,
      fatGrams: 4.5,
      carbsGrams: null,
      foodWaterMl: 3,
      pendingKcal: 0,
    })
  })
  it('keeps unmeasured offered portions pending instead of inventing consumption', () => {
    expect(calculateFoodNutrition(food({ mode: 'offered' }))).toMatchObject({
      eatenKcal: null,
      eatenGrams: null,
      pendingKcal: 120,
      foodWaterMl: null,
    })
  })
  it('subtracts measured leftovers from the same feeding record', () => {
    expect(
      calculateFoodNutrition(
        food({ mode: 'offered', remainingGrams: 5, observedAt: time + 3600000 }),
      ),
    ).toMatchObject({ eatenKcal: 100, eatenGrams: 25, pendingKcal: 0 })
  })
  it('preserves unknown nutrients but a completely uneaten portion contributes zero', () => {
    expect(calculateFoodNutrition(food()).carbsGrams).toBeNull()
    expect(
      calculateFoodNutrition(food({ mode: 'offered', remainingGrams: 30, observedAt: time }))
        .carbsGrams,
    ).toBe(0)
  })
  it('counts food moisture from the consumed portion', () => {
    const meal = food({ grams: 85 })
    meal.snapshot.nutrition.moisturePercent = 80
    expect(calculateFoodNutrition(meal).foodWaterMl).toBe(68)
  })
})

describe('calorie candidate', () => {
  it('uses adult RER and neuter factor without changing an adopted target', () => {
    const saved = {
      ...profile,
      calorieTarget: { kcal: 210, source: 'manual' as const, effectiveFrom: '2026-09-01' },
    }
    expect(
      estimateCalorieTarget({ profile: saved, latestWeight: weight(), nowMs: time }),
    ).toMatchObject({ kcal: 238, weightKg: 4, reason: 'available' })
    expect(saved.calorieTarget.kcal).toBe(210)
    expect(
      estimateCalorieTarget({
        profile: { ...profile, neutered: false },
        latestWeight: weight(),
        nowMs: time,
      }).kcal,
    ).toBe(277)
  })
  it.each([
    [{ ...profile, birthDate: null }, 'missing_age'],
    [{ ...profile, neutered: null }, 'missing_neuter_status'],
    [{ ...profile, birthDate: '2026-01-01' }, 'kitten'],
    [{ ...profile, birthDate: '2015-09-28' }, 'senior'],
    [{ ...profile, bodyConditionScore: 7 }, 'body_condition'],
  ] as const)('does not create a personal goal when prerequisites do not apply', (cat, reason) => {
    expect(
      estimateCalorieTarget({ profile: cat, latestWeight: weight(), nowMs: time }),
    ).toMatchObject({ kcal: null, reason })
  })
  it('uses accepted current measurements within clock drift and excludes later future weights', () => {
    for (const offset of [75, MAX_FUTURE_SKEW_MS]) {
      expect(
        estimateCalorieTarget({
          profile,
          latestWeight: weight({ occurredAt: time + offset }),
          nowMs: time,
        }),
      ).toMatchObject({ kcal: 238, weightKg: 4, reason: 'available' })
    }
    expect(
      estimateCalorieTarget({
        profile,
        latestWeight: weight({ occurredAt: time + MAX_FUTURE_SKEW_MS + 1 }),
        nowMs: time,
      }).reason,
    ).toBe('missing_weight')
    expect(estimateCalorieTarget({ profile, latestWeight: null, nowMs: time }).kcal).toBeNull()
  })
  it('rejects grams entered as kilograms while preserving a typical adult estimate', () => {
    expect(WeightRecordSchema.safeParse(weight({ kilograms: 4000 })).success).toBe(false)
    for (const kilograms of [4000, 50.01, 0, -1, Infinity, Number.NaN]) {
      expect(
        estimateCalorieTarget({ profile, latestWeight: weight({ kilograms }), nowMs: time }),
      ).toMatchObject({ kcal: null, weightKg: null, reason: 'missing_weight' })
    }
    expect(WeightRecordSchema.safeParse(weight()).success).toBe(true)
    expect(estimateCalorieTarget({ profile, latestWeight: weight(), nowMs: time }).kcal).toBe(238)
  })
})
