import { context, wrap } from '@reatom/core'
import { defaultCatProfile, type CatProfile, type Weighing } from 'module-cats/domain/cat'
import { catWeightKey } from 'module-cats/domain/keys'
import type { CatRegistryEvent, LitterRegistryEvent } from 'module-cats/domain/registry'
import {
  makeKeysDownStorage,
  makeTestCatsModel,
  type MakeTestCatsModelOptions,
} from 'module-cats/testing'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { makeStaticWidgetIdentity, StorageError, type WidgetModules } from 'widget-runtime'
import { createFakeStorage } from 'widget-runtime/storage/test/fakes'

import { catsCardStore, makeCatsCard } from './cats-card'

const TODAY = '2026-11-26'

const catEvent = (catId: string, ts: number): CatRegistryEvent => ({
  id: `c${ts}`,
  ts,
  catId,
  op: 'add',
})
const litterEvent = (litterId: string, ts: number): LitterRegistryEvent => ({
  id: `l${ts}`,
  ts,
  litterId,
  op: 'add',
})

const OFELIA: CatProfile = {
  ...defaultCatProfile('Офелия', 'ofelia'),
  breed: 'Британская короткошёрстная',
  birthDate: '2023-09-20',
  sex: 'female',
  sterilized: 'yes',
  bodyCondition: 5,
}

const weighing = (at: string, kg: number, ts = 1): Weighing => ({
  id: `w-${at}-${ts}`,
  ts,
  at,
  kg,
  createdBy: { accountId: 'acc-lesha', name: 'Леша' },
})

const ONE_CAT: MakeTestCatsModelOptions = {
  catRegistry: [catEvent('ofelia', 1)],
  litterRegistry: [litterEvent('ofelia', 1)],
  profiles: { ofelia: OFELIA },
}

afterEach(() => {
  context.reset()
})

function setup(weighings: Weighing[], options: MakeTestCatsModelOptions = ONE_CAT) {
  const shared = createFakeStorage()
  void shared.set(catWeightKey('ofelia'), weighings)
  const { model, calls } = makeTestCatsModel({ todayIso: TODAY, storage: shared, ...options })
  const modules = { get: async () => model } as unknown as WidgetModules
  const card = makeCatsCard({
    modules,
    storage: createFakeStorage(),
    identity: makeStaticWidgetIdentity(),
    name: 'test.card',
  })
  return { card, calls }
}

/** Subscribes to `read`'s atoms through `subscribeTo` and waits until `read` returns non-null. */
async function settled<T>(subscribeTo: { subscribe(cb: () => void): () => void }, read: () => T) {
  const off = subscribeTo.subscribe(() => {})
  const value = wrap(read)
  await vi.waitFor(() => expect(value()).not.toBeNull())
  const result = value()
  off()
  return result
}

describe('makeCatsCard', () => {
  it('reads the passport of the chosen cat', async () => {
    const { card } = setup([weighing('2026-11-21', 4.32)])

    await context.start(async () => {
      const passport = await settled(card.view.passport, () => card.view.passport())
      expect(passport).toEqual({
        name: 'Офелия',
        breed: 'Британская короткошёрстная',
        ageLong: '3 года 2 мес',
        ageShort: '3 года',
        sexLabel: 'кошка',
        sterilizedLabel: 'стерилизована',
        bodyCondition: 5,
        goalToday: null,
      })
    })
  })

  it('reads the latest weight, the 30-day trend and its author', async () => {
    const { card } = setup([weighing('2026-10-20', 4.4), weighing('2026-11-21', 4.32, 2)])

    await context.start(async () => {
      const weight = await settled(card.view.weight, () => card.view.weight())
      expect(weight?.kg).toBe(4.32)
      expect(weight?.trend30).toBe(-80)
      expect(weight?.daysAgo).toBe(5)
      expect(weight?.stale).toBe(false)
      expect(weight?.author).toMatchObject({ kind: 'account', name: 'Леша' })
    })
  })

  it('is stale at 14 days without a weighing and not at 13', async () => {
    const old = setup([weighing('2026-11-12', 4.32)])
    await context.start(async () => {
      const weight = await settled(old.card.view.weight, () => old.card.view.weight())
      expect(weight?.daysAgo).toBe(14)
      expect(weight?.stale).toBe(true)
    })

    context.reset()
    const recent = setup([weighing('2026-11-13', 4.32)])
    await context.start(async () => {
      const weight = await settled(recent.card.view.weight, () => recent.card.view.weight())
      expect(weight?.daysAgo).toBe(13)
      expect(weight?.stale).toBe(false)
    })
  })

  it('keeps the last 90 days of weighings for the sparkline, oldest first', async () => {
    const { card } = setup([
      weighing('2026-11-21', 4.32, 3),
      // 90 days before today: just outside the range.
      weighing('2026-08-28', 4.6, 1),
      weighing('2026-08-29', 4.44, 2),
    ])

    await context.start(async () => {
      const spark = await settled(card.view.spark, () => {
        const points = card.view.spark()
        return points.length > 0 ? points : null
      })
      expect(spark).toEqual([
        { at: '2026-08-29', kg: 4.44 },
        { at: '2026-11-21', kg: 4.32 },
      ])
    })
  })

  it('labels the sparkline with the months it spans, upper-cased', async () => {
    const { card } = setup([weighing('2026-09-05', 4.44), weighing('2026-11-21', 4.32, 2)])

    await context.start(async () => {
      const labels = await settled(card.view.sparkLabels, () => {
        const current = card.view.sparkLabels()
        return current.length > 0 ? current : null
      })
      expect(labels?.map((label) => label.label)).toEqual(['СЕН', 'ОКТ', 'НОЯ'])
    })
  })

  it('reports no cats as empty', async () => {
    const { card } = setup([], { catRegistry: [], litterRegistry: [] })

    await context.start(async () => {
      const off = card.status.subscribe(() => {})
      const status = wrap(() => card.status())
      await vi.waitFor(() => expect(status()).toBe('empty'))
      off()
    })
  })

  it("a failed weight read is the card's error, and retry loads it", async () => {
    const base = createFakeStorage()
    void base.set(catWeightKey('ofelia'), [weighing('2026-11-21', 4.32)])
    const { storage, recover } = makeKeysDownStorage(
      base,
      [catWeightKey('ofelia')],
      new StorageError({ reason: 'boom' }),
    )
    const { model } = makeTestCatsModel({ todayIso: TODAY, ...ONE_CAT, storage })
    const card = makeCatsCard({
      modules: { get: async () => model } as unknown as WidgetModules,
      storage: createFakeStorage(),
      identity: makeStaticWidgetIdentity(),
      name: 'test.card',
    })

    await context.start(async () => {
      const off = card.status.subscribe(() => {})
      const status = wrap(() => card.status())
      const retry = wrap(() => card.retry())
      await vi.waitFor(() => expect(status()).toBe('error'))

      recover()
      await retry()
      await vi.waitFor(() => expect(status()).toBe('ready'))
      off()
    })
  })

  it('weighs the chosen cat through the shared form', async () => {
    const { card, calls } = setup([])

    await context.start(async () => {
      await settled(card.view.passport, () => card.view.passport())
      const off = card.weighForm.canSend.subscribe(() => {})
      wrap(() => card.weighForm.text.set('4,30'))()
      await vi.waitFor(() => expect(wrap(() => card.weighForm.canSend())()).toBe(true))
      await wrap(card.weighForm.submit)()
      off()
    })
    expect(calls).toEqual([{ action: 'weigh', payload: { catId: 'ofelia', kg: 4.3, at: TODAY } }])
  })
})

describe('catsCardStore', () => {
  it('hands two mounts of one instance the same card and choice', () => {
    const make = vi.fn(() =>
      makeCatsCard({
        modules: { get: () => new Promise(() => {}) } as unknown as WidgetModules,
        storage: createFakeStorage(),
        identity: makeStaticWidgetIdentity(),
        name: 'test.store',
      }),
    )

    const first = catsCardStore('cats-1', make)
    const second = catsCardStore('cats-1', make)
    expect(second).toBe(first)
    const card = wrap(() => first())()
    expect(wrap(() => second())().choice).toBe(card.choice)
    expect(make).toHaveBeenCalledOnce()
    expect(catsCardStore('cats-2', make)).not.toBe(first)
  })
})
