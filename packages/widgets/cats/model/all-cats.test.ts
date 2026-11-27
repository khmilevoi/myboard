import { atom, computed, context, wrap } from '@reatom/core'
import { defaultCatProfile, type CatProfile } from 'module-cats/domain/cat'
import { catWeightKey } from 'module-cats/domain/keys'
import type { CatRegistryEvent, LitterRegistryEvent } from 'module-cats/domain/registry'
import { makeTestCatsModel, type MakeTestCatsModelOptions } from 'module-cats/testing'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { ModuleApiError } from 'widget-runtime'
import { createFakeStorage } from 'widget-runtime/storage/test/fakes'

import { LAST_ACTIVE_CAT_COPY, makeAllCats } from './all-cats'

const catEvent = (op: 'add' | 'archive', catId: string, ts: number): CatRegistryEvent => ({
  id: `c${ts}`,
  ts,
  catId,
  op,
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
  birthDate: '2023-09-12',
}
const BUSYA: CatProfile = { ...defaultCatProfile('Буся', 'busya'), breed: 'Беспородная' }

const TWO_CATS: MakeTestCatsModelOptions = {
  catRegistry: [catEvent('add', 'ofelia', 1), catEvent('add', 'busya', 2)],
  litterRegistry: [litterEvent('ofelia', 1), litterEvent('busya', 2)],
  profiles: { ofelia: OFELIA, busya: { ...BUSYA, litterId: 'busya' } },
}

afterEach(() => {
  context.reset()
})

function setup(options: MakeTestCatsModelOptions = TWO_CATS) {
  const storage = options.storage ?? createFakeStorage()
  void storage.set(catWeightKey('ofelia'), [
    { id: 'w1', ts: 1, at: '2026-11-21', kg: 4.32, createdBy: { accountId: 'a', name: 'Леша' } },
  ])
  const { model, calls } = makeTestCatsModel({
    todayIso: '2026-11-26',
    storage,
    ...options,
  })
  const cats = atom(model, 'test.cats')
  const today = computed(() => model.today(), 'test.today')
  const all = makeAllCats(cats, today, 'test.all')
  return { all, calls, model }
}

/** Keeps the unit connected for the whole test, as a mounted tab does, and waits for its value. */
async function settled<T>(unit: { (): T; subscribe(listener: () => void): () => void }) {
  const off = unit.subscribe(() => {})
  const read = wrap(() => unit())
  await vi.waitFor(() => expect(read()).not.toBeNull())
  return { value: read, off }
}

describe('makeAllCats', () => {
  it('rows: name, tone and the "breed · age · weight · litter" line', async () => {
    const { all } = setup()
    const { value, off } = await settled(all.active)
    // Busya has no weighing and no birth date: those parts drop out.
    expect(value()).toEqual([
      {
        id: 'ofelia',
        name: 'Офелия',
        tone: 'a',
        photoUrl: null,
        line: 'Британская · 3 года · 4,32 кг · Лоток · Офелия',
      },
      {
        id: 'busya',
        name: 'Буся',
        tone: 'b',
        photoUrl: null,
        line: 'Беспородная · Лоток · Буся',
      },
    ])
    off()
  })

  it('archived rows read "В архиве с {d MMMM yyyy} · история сохранена"', async () => {
    const archivedAt = Date.parse('2026-05-03T10:00:00Z')
    const { all } = setup({
      ...TWO_CATS,
      catRegistry: [
        catEvent('add', 'ofelia', 1),
        catEvent('add', 'busya', 2),
        catEvent('archive', 'busya', archivedAt),
      ],
    })
    const { value, off } = await settled(all.archived)
    expect(value()).toEqual([
      {
        id: 'busya',
        name: 'Буся',
        tone: 'b',
        photoUrl: null,
        line: 'В архиве с 3 мая 2026 · история сохранена',
      },
    ])
    off()
  })

  it('one active cat is the last active one', async () => {
    const { all } = setup({
      catRegistry: [catEvent('add', 'ofelia', 1)],
      litterRegistry: [litterEvent('ofelia', 1)],
      profiles: { ofelia: OFELIA },
    })
    const { value, off } = await settled(all.active)
    expect(all.lastActive()).toBe(true)
    expect(value()).toHaveLength(1)
    off()
  })

  it('two active cats are not', async () => {
    const { all } = setup()
    const { off } = await settled(all.active)
    expect(all.lastActive()).toBe(false)
    off()
  })

  it('archiving a cat alone on her litter names the fallback and the orphaned litter', async () => {
    const { all } = setup()
    const { off } = await settled(all.active)
    const impact = all.archiveImpact('busya')
    const offImpact = impact.subscribe(() => {})
    expect(impact()).toEqual({ fallbackName: 'Офелия', orphanLitter: 'Лоток · Буся' })
    offImpact()
    off()
  })

  it('a litter another active cat still uses is not orphaned', async () => {
    const { all } = setup({
      ...TWO_CATS,
      profiles: { ofelia: OFELIA, busya: { ...BUSYA, litterId: 'ofelia' } },
    })
    const { off } = await settled(all.active)
    const impact = all.archiveImpact('busya')
    const offImpact = impact.subscribe(() => {})
    expect(impact()).toEqual({ fallbackName: 'Офелия', orphanLitter: null })
    offImpact()
    off()
  })

  it('archive and restore send the cat id and return their error as a value', async () => {
    const failure = new ModuleApiError({ code: 'last_active_cat', reason: 'last active cat' })
    const { all, calls } = setup({
      ...TWO_CATS,
      invoke: async (action) => (action === 'archiveCat' ? failure : { ok: true }),
    })
    const { off } = await settled(all.active)

    const archived = await wrap(() => all.archive('busya'))()
    expect(archived).toBe(failure)
    expect(all.failure()).toBe(LAST_ACTIVE_CAT_COPY)
    expect(LAST_ACTIVE_CAT_COPY).toBe('Последнюю кошку в архив не убрать')

    expect(await wrap(() => all.restore('busya'))()).toBeUndefined()
    expect(all.failure()).toBeNull()
    expect(calls).toEqual([
      { action: 'archiveCat', payload: { catId: 'busya' } },
      { action: 'restoreCat', payload: { catId: 'busya' } },
    ])
    off()
  })

  it('any other failure gets a generic message, and clearing it forgets it', async () => {
    const { all } = setup({
      ...TWO_CATS,
      invoke: async () => new ModuleApiError({ code: 'boom', reason: 'boom' }),
    })
    const { off } = await settled(all.active)

    await wrap(() => all.archive('busya'))()
    expect(all.failure()).toBe('Не удалось убрать кошку в архив. Попробуйте ещё раз.')
    wrap(() => all.clearFailure())()
    expect(all.failure()).toBeNull()

    await wrap(() => all.restore('busya'))()
    expect(all.failure()).toBe('Не удалось вернуть кошку. Попробуйте ещё раз.')
    off()
  })
})
