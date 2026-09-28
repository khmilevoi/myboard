import { action, atom, context, schedule, wrap } from '@reatom/core'
import { afterEach, describe, expect, it, vi } from 'vitest'

import { foldLedger, validateCommand } from '../domain/ledger'
import {
  DEFAULT_PROFILE,
  type CatProfile,
  type FoodRecord,
  type Product,
  type WaterRecord,
} from '../domain/schemas'
import { computeWaterIntervals } from '../domain/water'
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
  const saveWater = vi.fn(async (_value: WaterRecord) => true)
  const profile = atom<CatProfile>({ ...DEFAULT_PROFILE })
  const products = atom([product])
  const foods = atom<FoodRecord[]>([])
  const water = atom<WaterRecord[]>([])
  const now = atom(NOW)
  const model = {
    profile,
    products,
    allProducts: products,
    foods,
    water,
    weights: atom([]),
    lastPortions: atom({}),
    nowMs: () => now(),
    today: () => '2026-09-28',
    selectedDate: atom(null),
    activeTab: atom('today'),
    mutationPending: () => false,
    latestWeight: () => null,
    saveFood: action(saveFood),
    saveProduct: action(saveProduct),
    saveProfile: action(saveProfile),
    saveWater: action(saveWater),
    saveWeight: action(vi.fn(async () => true)),
  } as unknown as CatCareModel
  return {
    forms: createCatCareForms(model),
    profile,
    products,
    foods,
    water,
    now,
    saveFood,
    saveProduct,
    saveProfile,
    saveWater,
    model,
  }
}
afterEach(() => context.reset())

describe('cat care form transactions', () => {
  it('does not report an untouched quick field on blur, but validates an empty submission', () =>
    context.start(async () => {
      const { forms, saveWater } = fixture()
      forms.openWater()
      forms.water.fields.addedMl.focus.in()
      forms.water.fields.addedMl.focus.out()
      await wrap(schedule(() => undefined))
      expect(forms.water.fields.addedMl.validation().error).toBeUndefined()
      await wrap(forms.submit())
      expect(forms.water.fields.addedMl.validation().error).toBeTruthy()
      expect(forms.active()).toBe('water')
      expect(saveWater).not.toHaveBeenCalled()
    }))
  it('starts quick meals as eaten while remembering portions and preserving an explicit offered choice', () =>
    context.start(() => {
      const { forms, model } = fixture()
      model.lastPortions.set({ food: { grams: 22, mode: 'offered' } })
      forms.openFood()
      expect(forms.food.fields.grams()).toBe('22')
      expect(forms.food.fields.mode()).toBe('eaten')
      expect(forms.detailsOpen()).toBe(false)
      forms.food.fields.mode.change('offered')
      forms.chooseProduct('food')
      expect(forms.food.fields.mode()).toBe('offered')
      forms.openFood({ ...food, mode: 'offered', remainingGrams: 10, observedAt: NOW })
      expect(forms.detailsOpen()).toBe(true)
      expect(forms.food.fields.remainingGrams()).toBe('10')
    }))
  it('returns new quick entries to today while preserving the navigation context of edits', () =>
    context.start(() => {
      const { forms, model } = fixture()
      for (const open of [forms.openFood, forms.openWater, forms.openWeight]) {
        model.activeTab.set('profile')
        model.selectedDate.set('2026-09-20')
        open()
        expect(model.activeTab()).toBe('today')
        expect(model.selectedDate()).toBeNull()
      }
      model.activeTab.set('history')
      model.selectedDate.set('2026-09-20')
      forms.openFood(food)
      expect(model.activeTab()).toBe('history')
      expect(model.selectedDate()).toBe('2026-09-20')
    }))
  it('accepts repeated quick topups without inventing a bowl baseline or consumption', () =>
    context.start(async () => {
      const { forms, water, saveWater, now } = fixture()
      forms.openWater()
      expect(forms.water.fields.kind()).toBe('topup')
      expect(forms.detailsOpen()).toBe(false)
      forms.waterUnit.set('g')
      forms.water.fields.addedMl.change('75,5')
      await wrap(schedule(() => undefined))
      await wrap(forms.submit())
      const first = saveWater.mock.calls[0]![0]
      expect(first).toMatchObject({
        kind: 'topup',
        addedMl: 75.5,
        remainingMl: null,
        discardedMl: 0,
        occurredAt: NOW,
      })
      expect(
        validateCommand({
          state: foldLedger([]),
          command: { kind: 'water.save', water: first },
          nowMs: NOW,
        }),
      ).toBeNull()
      water.set([first])
      now.set(NOW + 60_000)
      forms.openWater()
      expect(forms.water.fields.addedMl()).toBe('75,5')
      expect(forms.water.fields.remainingMl()).toBe('')
      await wrap(schedule(() => undefined))
      await wrap(forms.submit())
      const second = saveWater.mock.calls[1]![0]
      expect(second.id).not.toBe(first.id)
      expect(second.kind).toBe('topup')
      expect(computeWaterIntervals([first, second])).toEqual([])
      expect(
        computeWaterIntervals([
          first,
          second,
          { ...second, id: 'measured', occurredAt: NOW + 120_000, remainingMl: 20 },
        ])[0]?.volumeMl,
      ).toBeNull()
    }))
  it('reveals invalid hidden fields but keeps details closed after a save failure', () =>
    context.start(async () => {
      const { forms, saveFood } = fixture()
      forms.openFood()
      forms.food.fields.note.change('a'.repeat(2001))
      await wrap(schedule(() => undefined))
      await wrap(forms.submit())
      expect(forms.detailsOpen()).toBe(true)
      expect(saveFood).not.toHaveBeenCalled()
      forms.openFood()
      saveFood.mockResolvedValueOnce(false)
      await wrap(schedule(() => undefined))
      await wrap(forms.submit())
      expect(forms.detailsOpen()).toBe(false)
      expect(forms.active()).toBe('food')
    }))
  it('restores food details and mode after creating or cancelling a product', () =>
    context.start(() => {
      const { forms } = fixture()
      forms.openFood()
      forms.detailsOpen.set(true)
      forms.food.fields.mode.change('offered')
      forms.openProduct(null, true)
      forms.close()
      expect(forms.active()).toBe('food')
      expect(forms.detailsOpen()).toBe(true)
      expect(forms.food.fields.mode()).toBe('offered')
    }))
  it('prioritizes distinct active recent products and fills the remaining choices from the catalog', () =>
    context.start(() => {
      const { forms, foods, products } = fixture()
      const other = { ...product, id: 'other' }
      const third = { ...product, id: 'third' }
      products.set([product, other, third])
      foods.set([
        { ...food, id: 'old' },
        { ...food, id: 'new', productId: 'other', occurredAt: NOW + 2 },
        { ...food, id: 'repeat', productId: 'other', occurredAt: NOW + 1 },
        { ...food, id: 'archived', productId: 'removed', occurredAt: NOW + 3 },
      ])
      expect(forms.recentProducts().map((item) => item.id)).toEqual(['other', 'food', 'third'])
    }))
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
