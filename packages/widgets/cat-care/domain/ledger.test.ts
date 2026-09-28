// @vitest-environment node
import { describe, expect, it, vi } from 'vitest'

import { foldLedger, validateCommand } from './ledger'
import {
  CatCareCommandSchema,
  FoodRecordSchema,
  LedgerEntriesSchema,
  NutritionSchema,
  WaterRecordSchema,
} from './schemas'
import { entry, food, product, profile, time, water } from './test-fixtures'

describe('journal folding', () => {
  it('last append wins even with equal timestamps and retried mutation IDs do not replay', () => {
    const state = foldLedger([
      entry({ kind: 'food.save', food: food() }, { mutationId: 'first' }),
      entry({ kind: 'food.save', food: food({ grams: 50 }) }, { mutationId: 'edit' }),
      entry({ kind: 'food.save', food: food() }, { mutationId: 'first' }),
    ])
    expect(state.foods).toHaveLength(1)
    expect(state.foods[0].grams).toBe(50)
  })
  it('tombstones remove a record and a subsequent save can restore it', () => {
    const start = [
      entry({ kind: 'food.save', food: food() }),
      entry({ kind: 'record.delete', entity: 'food', recordId: 'meal' }),
    ]
    expect(foldLedger(start).foods).toEqual([])
    expect(
      foldLedger([...start, entry({ kind: 'food.save', food: food() }, { mutationId: 'restore' })])
        .foods,
    ).toHaveLength(1)
  })
  it('catalog changes and archiving leave past meal snapshots intact', () => {
    const state = foldLedger([
      entry({ kind: 'food.save', food: food() }),
      entry({
        kind: 'product.save',
        product: {
          ...product,
          archived: true,
          name: 'Renamed',
          nutrition: { ...product.nutrition, kcalPer100g: 500 },
        },
      }),
    ])
    expect(state.foods[0].snapshot.name).toBe('Сухой корм')
    expect(state.foods[0].snapshot.nutrition.kcalPer100g).toBe(400)
  })
  it('retains profile revisions without duplicate retries', () => {
    const row = entry({ kind: 'profile.save', profile })
    expect(foldLedger([row, row]).profileHistory).toEqual([{ ts: time, profile }])
  })
  it('skips a malformed stored row without losing valid history and logs the failure', () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
    const parsed = LedgerEntriesSchema.parse([
      entry({ kind: 'food.save', food: food() }),
      { id: 'broken' },
    ])
    expect(foldLedger(parsed).foods).toHaveLength(1)
    expect(warn).toHaveBeenCalledOnce()
    warn.mockRestore()
  })
})

describe('observation validation', () => {
  it('rejects invalid dates and zones before Temporal consumers', () => {
    expect(
      CatCareCommandSchema.safeParse({
        kind: 'profile.save',
        profile: { ...profile, birthDate: '2026-02-30' },
      }).success,
    ).toBe(false)
    expect(
      CatCareCommandSchema.safeParse({
        kind: 'profile.save',
        profile: { ...profile, timeZone: 'not/a-zone' },
      }).success,
    ).toBe(false)
  })
  it('rejects impossible leftovers and measured timestamps while allowing zero remainder', () => {
    expect(
      FoodRecordSchema.safeParse(food({ mode: 'offered', remainingGrams: 31, observedAt: time }))
        .success,
    ).toBe(false)
    expect(
      FoodRecordSchema.safeParse(food({ mode: 'offered', remainingGrams: 0, observedAt: time - 1 }))
        .success,
    ).toBe(false)
    expect(
      FoodRecordSchema.safeParse(food({ mode: 'offered', remainingGrams: 0, observedAt: null }))
        .success,
    ).toBe(false)
    expect(
      FoodRecordSchema.safeParse(food({ mode: 'offered', remainingGrams: 0, observedAt: time }))
        .success,
    ).toBe(true)
  })
  it('rejects nonfinite quantities and impossible nutrient percentages', () => {
    expect(FoodRecordSchema.safeParse(food({ grams: Infinity })).success).toBe(false)
    expect(WaterRecordSchema.safeParse(water({ addedMl: -1 })).success).toBe(false)
    expect(NutritionSchema.safeParse({ ...product.nutrition, moisturePercent: 101 }).success).toBe(
      false,
    )
  })
  it('allows small clock drift but rejects future measurements beyond one minute', () => {
    const state = foldLedger([entry({ kind: 'product.save', product })])
    expect(
      validateCommand({
        state,
        command: { kind: 'food.save', food: food({ occurredAt: time + 60_000 }) },
        nowMs: time,
      }),
    ).toBeNull()
    expect(
      validateCommand({
        state,
        command: { kind: 'food.save', food: food({ occurredAt: time + 60_001 }) },
        nowMs: time,
      }),
    ).toBeInstanceOf(Error)
  })
  it('rejects a new impossible water balance and edits that invalidate a later reading', () => {
    const state = foldLedger([
      entry({ kind: 'water.save', water: water() }),
      entry(
        {
          kind: 'water.save',
          water: water({ id: 'end', occurredAt: time + 3600000, remainingMl: 80 }),
        },
        { mutationId: 'second' },
      ),
    ])
    expect(
      validateCommand({
        state,
        command: { kind: 'water.save', water: water({ addedMl: 50 }) },
        nowMs: time + 3600000,
      }),
    ).toBeInstanceOf(Error)
  })
  it('validates a revised baseline in its original order when observations share a timestamp', () => {
    const state = foldLedger([
      entry({ kind: 'water.save', water: water() }),
      entry(
        { kind: 'water.save', water: water({ id: 'end', remainingMl: 80 }) },
        { mutationId: 'second' },
      ),
    ])
    expect(
      validateCommand({
        state,
        command: { kind: 'water.save', water: water({ addedMl: 50 }) },
        nowMs: time,
      }),
    ).toBeInstanceOf(Error)
  })
  it('rejects excessive known losses in an open interval without waiting for another measurement', () => {
    const state = foldLedger([entry({ kind: 'water.save', water: water() })])
    expect(
      validateCommand({
        state,
        command: {
          kind: 'water.save',
          water: water({
            id: 'loss',
            kind: 'topup',
            occurredAt: time + 1000,
            addedMl: 10,
            discardedMl: 250,
          }),
        },
        nowMs: time + 1000,
      }),
    ).toBeInstanceOf(Error)
  })
  it('can continue logging after a prior invalid historical interval has established a new baseline', () => {
    const state = foldLedger([
      entry({ kind: 'water.save', water: water() }),
      entry(
        {
          kind: 'water.save',
          water: water({ id: 'bad', occurredAt: time + 1000, remainingMl: 300 }),
        },
        { mutationId: 'second' },
      ),
    ])
    expect(
      validateCommand({
        state,
        command: {
          kind: 'water.save',
          water: water({ id: 'next', occurredAt: time + 2000, remainingMl: 100 }),
        },
        nowMs: time + 2000,
      }),
    ).toBeNull()
  })
  it('requires an active catalog product for a new meal but lets an old archived meal be corrected', () => {
    const state = foldLedger([
      entry({ kind: 'product.save', product: { ...product, archived: true } }),
      entry({ kind: 'food.save', food: food() }),
    ])
    expect(
      validateCommand({
        state,
        command: { kind: 'food.save', food: food({ grams: 20 }) },
        nowMs: time,
      }),
    ).toBeNull()
    expect(
      validateCommand({
        state,
        command: { kind: 'food.save', food: food({ id: 'new' }) },
        nowMs: time,
      }),
    ).toBeInstanceOf(Error)
  })
})
