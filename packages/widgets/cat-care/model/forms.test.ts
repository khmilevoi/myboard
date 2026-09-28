import { action, atom, context, schedule, wrap } from '@reatom/core'
import { afterEach, describe, expect, it, vi } from 'vitest'

import { DEFAULT_PROFILE, type CatProfile, type FoodRecord, type Product } from '../domain/schemas'
import type { CatCareModel } from './cat-care'
import { createCatCareForms, parseDecimal, resolveDraftTime } from './forms'

const NOW = Date.parse('2026-09-28T10:00:00Z')
const product: Product = {
  id: 'food',
  name: 'Корм',
  kind: 'dry',
  completeness: 'complete',
  defaultPortionGrams: 30,
  archived: false,
  nutrition: {
    kcalPer100g: 400,
    proteinPer100g: null,
    fatPer100g: null,
    carbsPer100g: null,
    moisturePercent: null,
  },
}
const food: FoodRecord = {
  id: 'meal',
  occurredAt: NOW,
  productId: product.id,
  snapshot: product,
  grams: 30,
  mode: 'eaten',
  remainingGrams: null,
  observedAt: null,
  note: '',
}

function fixture() {
  const saveFood = vi.fn(async (_value: FoodRecord) => true)
  const saveProduct = vi.fn(async (_value: Product) => true)
  const saveProfile = vi.fn(async (_value: CatProfile) => true)
  const profile = atom<CatProfile>({ ...DEFAULT_PROFILE })
  const products = atom([product])
  const now = atom(NOW)
  const model = {
    profile,
    products,
    allProducts: products,
    foods: atom<FoodRecord[]>([]),
    water: atom([]),
    weights: atom([]),
    lastPortions: atom({}),
    nowMs: () => now(),
    today: () => '2026-09-28',
    selectedDate: atom(null),
    mutationPending: () => false,
    latestWeight: () => null,
    saveFood: action(saveFood),
    saveProduct: action(saveProduct),
    saveProfile: action(saveProfile),
    saveWater: action(vi.fn(async () => true)),
    saveWeight: action(vi.fn(async () => true)),
  } as unknown as CatCareModel
  return {
    forms: createCatCareForms(model),
    profile,
    products,
    now,
    saveFood,
    saveProduct,
    saveProfile,
    model,
  }
}
afterEach(() => context.reset())

describe('cat care form transactions', () => {
  it('accepts Russian decimals and leaves missing measurements unknown', () => {
    expect(parseDecimal(' 4,25 ')).toBe(4.25)
    expect(parseDecimal('')).toBeNull()
    expect(parseDecimal('0')).toBe(0)
    expect(Number.isNaN(parseDecimal('1e3'))).toBe(true)
  })
  it('reuses the exact known epoch during the repeated DST hour', () => {
    const occurredAt = Date.parse('2026-10-25T00:30:00Z')
    const known = { value: '2026-10-25T02:30', timeZone: 'Europe/Warsaw', occurredAt }
    expect(resolveDraftTime(known.value, known.timeZone, known)).toBe(occurredAt)
    expect(resolveDraftTime(known.value, known.timeZone, null)).toBeInstanceOf(Error)
  })
  it('retains draft id and contents on failure, then captures a new time for the next meal', () =>
    context.start(async () => {
      const { forms, saveFood, now } = fixture()
      saveFood.mockResolvedValueOnce(false)
      forms.openFood()
      forms.food.fields.grams.change('25,5')
      await wrap(schedule(() => undefined))
      await wrap(forms.submit())
      expect(forms.active()).toBe('food')
      expect(forms.food.fields.grams()).toBe('25,5')
      await wrap(schedule(() => undefined))
      await wrap(forms.submit())
      expect(saveFood.mock.calls[0]![0].id).toBe(saveFood.mock.calls[1]![0].id)
      expect(saveFood.mock.calls[0]![0]).toMatchObject({
        grams: 25.5,
        mode: 'eaten',
        occurredAt: NOW,
      })
      expect(forms.active()).toBeNull()
      now.set(NOW + 60_000)
      forms.openFood()
      await wrap(schedule(() => undefined))
      await wrap(forms.submit())
      expect(saveFood.mock.calls[2]![0].occurredAt).toBe(NOW + 60_000)
      expect(saveFood.mock.calls[2]![0].id).not.toBe(saveFood.mock.calls[0]![0].id)
    }))
  it('preserves a historical food snapshot after the catalog changes or is archived', () =>
    context.start(async () => {
      const { forms, saveFood, products } = fixture()
      products.set([
        { ...product, archived: true, nutrition: { ...product.nutrition, kcalPer100g: 100 } },
      ])
      forms.openFood(food)
      forms.food.fields.grams.change('20')
      await wrap(schedule(() => undefined))
      await wrap(forms.submit())
      expect(saveFood.mock.calls[0]![0].snapshot.nutrition.kcalPer100g).toBe(400)
      expect(saveFood.mock.calls[0]![0].grams).toBe(20)
    }))
  it('converts package energy, restores the food draft and keeps optional composition unknown', () =>
    context.start(async () => {
      const { forms, saveProduct, saveFood } = fixture()
      forms.openFood()
      forms.openProduct(null, true)
      forms.product.fields.name.change('Пауч')
      forms.product.fields.energy.change('85')
      forms.product.fields.energyUnit.change('portion')
      forms.product.fields.packageGrams.change('85')
      forms.product.fields.defaultPortionGrams.change('42,5')
      await wrap(schedule(() => undefined))
      await wrap(forms.submit())
      expect(saveProduct.mock.calls[0]![0].nutrition).toMatchObject({
        kcalPer100g: 100,
        proteinPer100g: null,
      })
      expect(forms.active()).toBe('food')
      // The actual model synchronously refreshes the product catalog after save.
      const added = saveProduct.mock.calls[0]![0]
      forms.chooseProduct(product.id)
      await wrap(schedule(() => undefined))
      await wrap(forms.submit())
      expect(saveFood.mock.calls[0]![0].id).not.toBe(added.id)
    }))
  it('never resurrects a concurrently cleared target during an unrelated profile edit', () =>
    context.start(async () => {
      const { forms, profile, saveProfile } = fixture()
      profile.set({
        ...DEFAULT_PROFILE,
        calorieTarget: { kcal: 200, source: 'manual', effectiveFrom: '2026-09-28' },
      })
      forms.openProfile()
      profile.set({ ...DEFAULT_PROFILE, calorieTarget: null, birthDate: '2022-01-01' })
      forms.profile.fields.name.change('Мурка')
      await wrap(schedule(() => undefined))
      await wrap(forms.submit())
      expect(saveProfile.mock.calls[0]![0]).toMatchObject({
        name: 'Мурка',
        birthDate: '2022-01-01',
        calorieTarget: null,
      })
    }))
  it('keeps explicit goal edits and chooses their default date in the edited timezone', () =>
    context.start(async () => {
      const { forms, profile, now, saveProfile } = fixture()
      now.set(Date.parse('2026-09-28T23:30:00Z'))
      forms.openProfile()
      forms.profile.fields.timeZone.change('Pacific/Auckland')
      forms.changeTarget('225')
      expect(forms.profile.fields.effectiveFrom()).toBe('2026-09-29')
      profile.set({
        ...DEFAULT_PROFILE,
        calorieTarget: { kcal: 100, source: 'manual', effectiveFrom: '2026-09-28' },
      })
      await wrap(schedule(() => undefined))
      await wrap(forms.submit())
      expect(saveProfile.mock.calls[0]![0].calorieTarget).toMatchObject({
        kcal: 225,
        effectiveFrom: '2026-09-29',
      })
    }))
  it('new water entries remember filled volume but never invent or reuse the remaining volume', () =>
    context.start(() => {
      const { forms } = fixture()
      forms.openWater({
        id: 'water',
        occurredAt: NOW - 3_600_000,
        kind: 'replace',
        addedMl: 250,
        remainingMl: 50,
        discardedMl: 0,
        unmeasuredLoss: false,
        note: '',
      })
      expect(forms.water.fields.remainingMl()).toBe('50')
      forms.openWater()
      expect(forms.water.fields.remainingMl()).toBe('')
    }))
})
