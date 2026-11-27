import { context, wrap } from '@reatom/core'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { ModuleApiError, type StorageApi } from 'widget-runtime'
import { createFakeStorage } from 'widget-runtime/storage/test/fakes'

import { defaultCatProfile } from '../domain/cat'
import { catProfileKey, ledgerKey } from '../domain/keys'
import type { LedgerEntry } from '../domain/ledger'
import type { CatRegistryEvent, LitterRegistryEvent } from '../domain/registry'
import { makeTestCatsModel } from './testing'

const D = (iso: string) => Temporal.PlainDate.from(iso)

const ENTRIES: LedgerEntry[] = [
  { id: 'e1', ts: 1, date: '2026-06-15', type: 'cleaned', actor: 'Карина' },
]

afterEach(() => {
  context.reset()
})

describe('makeCatsModel.litter', () => {
  it('memoizes one litter model per id', () => {
    const { model } = makeTestCatsModel()

    expect(model.litter('ofelia')).toBe(model.litter('ofelia'))
    expect(model.litter('a')).not.toBe(model.litter('b'))
  })

  it('reads each litter from its own ledger key', async () => {
    const storage = createFakeStorage()
    // The fake's `set` writes synchronously before its first await, so the key
    // is seeded by the time the litter's connect hook subscribes.
    void storage.set(ledgerKey('a'), ENTRIES)
    const { model } = makeTestCatsModel({ storage })
    const a = model.litter('a')
    const b = model.litter('b')

    await context.start(async () => {
      const offs = [a.ledger.subscribe(() => {}), b.ledger.subscribe(() => {})]
      const read = wrap(() => ({ a: a.ledger(), b: b.ledger() }))

      await vi.waitFor(() => expect(read()).toEqual({ a: ENTRIES, b: [] }))

      for (const off of offs) off()
    })
  })

  it("carries the litter id in a litter's day action payload", async () => {
    const { model, calls } = makeTestCatsModel()

    await wrap(() => model.litter('ofelia').runDayAction('clean', D('2026-06-17')))()

    expect(calls).toEqual([
      { action: 'clean', payload: { litterId: 'ofelia', date: '2026-06-17' } },
    ])
  })
})

const catEvent = (op: CatRegistryEvent['op'], catId: string, ts: number): CatRegistryEvent => ({
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

const OFELIA = defaultCatProfile('Офелия', 'ofelia')
const BUSYA = defaultCatProfile('Буся', 'ofelia')

/** Subscribes `read`'s atoms for the test's duration and waits for `expected`. */
async function expectEventually<T>(
  subscribe: () => (() => void)[],
  read: () => T,
  expected: T,
): Promise<void> {
  await context.start(async () => {
    const offs = subscribe()
    const wrapped = wrap(read)
    await vi.waitFor(() => expect(wrapped()).toEqual(expected))
    for (const off of offs) off()
  })
}

describe('makeCatsModel registries', () => {
  it('lists the active cats in order and the litters they use', async () => {
    const { model } = makeTestCatsModel({
      catRegistry: [catEvent('add', 'ofelia', 1), catEvent('add', 'busya', 2)],
      litterRegistry: [litterEvent('ofelia', 1)],
      profiles: { ofelia: OFELIA, busya: BUSYA },
    })

    await expectEventually(
      () => [model.cats.subscribe(() => {}), model.litters.subscribe(() => {})],
      () => ({ cats: model.cats(), litters: model.litters() }),
      {
        cats: [
          { id: 'ofelia', name: 'Офелия', avatar: null, litterId: 'ofelia', tone: 'a' },
          { id: 'busya', name: 'Буся', avatar: null, litterId: 'ofelia', tone: 'b' },
        ],
        litters: [{ id: 'ofelia', title: 'Лоток · Офелия и Буся', catIds: ['ofelia', 'busya'] }],
      },
    )
  })

  it('does not list a litter only an archived cat points at', async () => {
    const { model } = makeTestCatsModel({
      catRegistry: [
        catEvent('add', 'ofelia', 1),
        catEvent('add', 'busya', 2),
        catEvent('archive', 'busya', 3),
      ],
      litterRegistry: [litterEvent('ofelia', 1), litterEvent('busya', 2)],
      profiles: { ofelia: OFELIA, busya: { ...BUSYA, litterId: 'busya' } },
    })

    await expectEventually(
      () => [
        model.cats.subscribe(() => {}),
        model.archivedCats.subscribe(() => {}),
        model.litters.subscribe(() => {}),
      ],
      () => ({ archived: model.archivedCats(), litters: model.litters() }),
      {
        archived: [{ id: 'busya', name: 'Буся', avatar: null, litterId: 'busya', tone: 'b' }],
        litters: [{ id: 'ofelia', title: 'Лоток · Офелия', catIds: ['ofelia'] }],
      },
    )
  })

  it('exposes when each archived cat was archived, by cat id', async () => {
    const { model } = makeTestCatsModel({
      catRegistry: [
        catEvent('add', 'ofelia', 1),
        catEvent('add', 'busya', 2),
        catEvent('archive', 'busya', 3000),
      ],
      litterRegistry: [litterEvent('ofelia', 1), litterEvent('busya', 2)],
      profiles: { ofelia: OFELIA, busya: { ...BUSYA, litterId: 'busya' } },
    })

    await expectEventually(
      () => [model.archivedAt.subscribe(() => {})],
      () => model.archivedAt(),
      { busya: 3000 },
    )
  })

  it('keeps a cat tone fixed by add order, archived cats included', async () => {
    const { model } = makeTestCatsModel({
      catRegistry: [
        catEvent('add', 'ofelia', 1),
        catEvent('add', 'busya', 2),
        catEvent('add', 'murka', 3),
        catEvent('archive', 'busya', 4),
      ],
      litterRegistry: [litterEvent('ofelia', 1)],
      profiles: { ofelia: OFELIA, busya: BUSYA, murka: defaultCatProfile('Мурка', 'ofelia') },
    })

    await expectEventually(
      () => [model.cats.subscribe(() => {}), model.archivedCats.subscribe(() => {})],
      () => ({
        active: model.cats()?.map((cat) => [cat.id, cat.tone]) ?? null,
        archived: model.archivedCats()?.map((cat) => [cat.id, cat.tone]) ?? null,
      }),
      {
        active: [
          ['ofelia', 'a'],
          ['murka', 'a'],
        ],
        archived: [['busya', 'b']],
      },
    )
  })

  it('exposes the server-time today, null until the clock syncs', () => {
    expect(makeTestCatsModel().model.today()).toBeNull()
    expect(makeTestCatsModel({ todayIso: '2026-11-26' }).model.today()?.toString()).toBe(
      '2026-11-26',
    )
  })

  it('leaves out a registry id whose profile key is absent, without staying null', async () => {
    const { model } = makeTestCatsModel({
      catRegistry: [catEvent('add', 'ofelia', 1), catEvent('add', 'ghost', 2)],
      litterRegistry: [litterEvent('ofelia', 1)],
      profiles: { ofelia: OFELIA },
    })

    await expectEventually(
      () => [model.cats.subscribe(() => {})],
      () => model.cats()?.map((cat) => cat.id) ?? null,
      ['ofelia'],
    )
  })

  it('is null before the registry answers', () => {
    const { model } = makeTestCatsModel({ profiles: { ofelia: OFELIA } })

    // Nothing subscribed: no key has answered yet.
    expect(model.cats()).toBeNull()
    expect(model.archivedCats()).toBeNull()
    expect(model.litters()).toBeNull()
  })

  it("stays null while one active cat's profile has not answered", async () => {
    const fake = createFakeStorage()
    // Busya's profile read never answers; every other key answers from the fake.
    const storage: StorageApi = {
      ...fake,
      subscribe: (key, listener, schema) =>
        key === catProfileKey('busya') ? () => {} : fake.subscribe(key, listener, schema),
    }
    const { model } = makeTestCatsModel({
      storage,
      catRegistry: [catEvent('add', 'ofelia', 1), catEvent('add', 'busya', 2)],
      litterRegistry: [litterEvent('ofelia', 1)],
      profiles: { ofelia: OFELIA, busya: BUSYA },
    })

    await context.start(async () => {
      const off = model.cats.subscribe(() => {})
      const read = wrap(() => ({ ofelia: model.cat('ofelia').profile(), cats: model.cats() }))

      // Ofelia's profile has loaded, so `cats()` is null only because Busya's has not.
      await vi.waitFor(() => expect(read().ofelia).toEqual(OFELIA))
      expect(read().cats).toBeNull()
      off()
    })
  })

  it('memoizes one cat model per id', () => {
    const { model } = makeTestCatsModel()

    expect(model.cat('ofelia')).toBe(model.cat('ofelia'))
    expect(model.cat('a')).not.toBe(model.cat('b'))
  })

  it('sends addCat, archiveCat and restoreCat with their payloads', async () => {
    const { model, calls } = makeTestCatsModel({
      invoke: async (action) =>
        action === 'addCat' ? { ok: true, catId: 'new-cat' } : { ok: true },
    })

    expect(await wrap(() => model.addCat('Буся', { kind: 'new' }))()).toEqual({ catId: 'new-cat' })
    await wrap(() => model.archiveCat('busya'))()
    await wrap(() => model.restoreCat('busya'))()

    expect(calls).toEqual([
      { action: 'addCat', payload: { name: 'Буся', litter: { kind: 'new' } } },
      { action: 'archiveCat', payload: { catId: 'busya' } },
      { action: 'restoreCat', payload: { catId: 'busya' } },
    ])
  })

  it('returns a failed archive as a value', async () => {
    const failure = new ModuleApiError({ code: 'last_active_cat', reason: 'last active cat' })
    const { model } = makeTestCatsModel({ invoke: async () => failure })

    expect(await wrap(() => model.archiveCat('ofelia'))()).toBe(failure)
  })
})
