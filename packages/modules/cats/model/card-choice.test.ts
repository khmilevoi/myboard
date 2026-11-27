import { atom, context, wrap } from '@reatom/core'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { StorageError, type StorageApi } from 'widget-runtime'
import { createFakeStorage } from 'widget-runtime/storage/test/fakes'

import { defaultCatProfile } from '../domain/cat'
import { CARD_CAT_KEY, CARD_LITTER_KEY, CATS_REGISTRY_KEY } from '../domain/keys'
import type { CatRegistryEvent, LitterRegistryEvent } from '../domain/registry'
import { makeCatChoice, makeLitterChoice, makeLitterOptions } from './card-choice'
import { makeTestCatsModel, type MakeTestCatsModelOptions } from './testing'

afterEach(() => {
  context.reset()
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

const TWO_CATS: MakeTestCatsModelOptions = {
  catRegistry: [catEvent('add', 'ofelia', 1), catEvent('add', 'busya', 2)],
  litterRegistry: [litterEvent('ofelia', 1), litterEvent('busya', 2)],
  profiles: { ofelia: OFELIA, busya: { ...BUSYA, litterId: 'busya' } },
}

const SHARED_LITTER: MakeTestCatsModelOptions = {
  catRegistry: [catEvent('add', 'ofelia', 1), catEvent('add', 'busya', 2)],
  litterRegistry: [litterEvent('ofelia', 1)],
  profiles: { ofelia: OFELIA, busya: BUSYA },
}

async function settle(): Promise<void> {
  await new Promise((resolve) => setTimeout(resolve, 0))
}

async function setup(
  options: MakeTestCatsModelOptions,
  stored?: { cat?: unknown; litter?: unknown },
) {
  const registryStorage = createFakeStorage()
  const { model } = makeTestCatsModel({ ...options, storage: registryStorage })
  const cardStorage: StorageApi = createFakeStorage()
  if (stored?.cat !== undefined) await cardStorage.set(CARD_CAT_KEY, stored.cat)
  if (stored?.litter !== undefined) await cardStorage.set(CARD_LITTER_KEY, stored.litter)
  const input = { model: atom(model), storage: cardStorage, name: 'test' }
  return {
    model,
    registryStorage,
    cardStorage,
    catChoice: makeCatChoice(input),
    litterChoice: makeLitterChoice(input),
  }
}

describe('makeCatChoice', () => {
  it('shows the first cat and never writes the fallback back', async () => {
    const { catChoice, cardStorage } = await setup(TWO_CATS)

    await context.start(async () => {
      const off = catChoice.current.subscribe(() => {})
      const read = wrap(() => catChoice.current()?.id)
      await vi.waitFor(() => expect(read()).toBe('ofelia'))
      await settle()
      expect(await cardStorage.get(CARD_CAT_KEY)).toBeNull()
      off()
    })
  })

  it('shows the stored cat', async () => {
    const { catChoice } = await setup(TWO_CATS, { cat: 'busya' })

    await context.start(async () => {
      const off = catChoice.current.subscribe(() => {})
      const read = wrap(() => catChoice.current()?.id)
      await vi.waitFor(() => expect(read()).toBe('busya'))
      off()
    })
  })

  it('falls back while the stored cat is archived and brings it back on restore', async () => {
    const { catChoice, cardStorage, registryStorage } = await setup(TWO_CATS, { cat: 'busya' })
    const events = [catEvent('add', 'ofelia', 1), catEvent('add', 'busya', 2)]

    await context.start(async () => {
      const off = catChoice.current.subscribe(() => {})
      const read = wrap(() => catChoice.current()?.id)
      await vi.waitFor(() => expect(read()).toBe('busya'))

      await registryStorage.set(CATS_REGISTRY_KEY, [...events, catEvent('archive', 'busya', 3)])
      await vi.waitFor(() => expect(read()).toBe('ofelia'))
      expect(await cardStorage.get(CARD_CAT_KEY)).toBe('busya')

      await registryStorage.set(CATS_REGISTRY_KEY, [
        ...events,
        catEvent('archive', 'busya', 3),
        catEvent('restore', 'busya', 4),
      ])
      await vi.waitFor(() => expect(read()).toBe('busya'))
      off()
    })
  })

  it('writes the choice, and refuses an id that is not a valid entity id', async () => {
    const { catChoice, cardStorage } = await setup(TWO_CATS)

    await context.start(async () => {
      const off = catChoice.current.subscribe(() => {})
      await wrap(catChoice.choose('A/B'))
      expect(await cardStorage.get(CARD_CAT_KEY)).toBeNull()
      await wrap(catChoice.choose('busya'))
      expect(await cardStorage.get(CARD_CAT_KEY)).toBe('busya')
      off()
    })
  })

  it('accepts an id the registry has not offered yet', async () => {
    const { catChoice, cardStorage } = await setup(TWO_CATS)

    await context.start(async () => {
      await wrap(catChoice.choose('murka'))
      expect(await cardStorage.get(CARD_CAT_KEY)).toBe('murka')
    })
  })

  it('reads a junk stored value as no choice', async () => {
    const { catChoice } = await setup(TWO_CATS, { cat: 'A/B' })

    await context.start(async () => {
      const off = catChoice.current.subscribe(() => {})
      const read = wrap(() => catChoice.current()?.id)
      await vi.waitFor(() => expect(read()).toBe('ofelia'))
      off()
    })
  })

  it('switches only with more than one cat', async () => {
    const one = await setup({
      catRegistry: [catEvent('add', 'ofelia', 1)],
      profiles: { ofelia: OFELIA },
    })
    const two = await setup(TWO_CATS)

    await context.start(async () => {
      const offs = [
        one.catChoice.canSwitch.subscribe(() => {}),
        two.catChoice.canSwitch.subscribe(() => {}),
      ]
      const read = wrap(() => [one.catChoice.canSwitch(), two.catChoice.canSwitch()])
      await vi.waitFor(() => expect(read()).toEqual([false, true]))
      for (const off of offs) off()
    })
  })

  it('exposes the cat model of the current cat', async () => {
    const { catChoice, model } = await setup(TWO_CATS)

    await context.start(async () => {
      const off = catChoice.cat.subscribe(() => {})
      const read = wrap(() => catChoice.cat())
      await vi.waitFor(() => expect(read()).toBe(model.cat('ofelia')))
      off()
    })
  })

  it('has no options while the model is absent', () => {
    const choice = makeCatChoice({
      model: atom(null),
      storage: createFakeStorage(),
      name: 'test',
    })

    expect(choice.options()).toBeNull()
    expect(choice.current()).toBeNull()
  })
})

const titles = (options: ReturnType<typeof makeLitterOptions>) =>
  options()?.map((o) => ({ title: o.title, cats: o.cats.map((c) => c.id) }))

describe('makeLitterChoice', () => {
  it('offers one titled option per litter and follows the choice', async () => {
    const { litterChoice, model } = await setup(TWO_CATS)

    await context.start(async () => {
      const offs = [
        litterChoice.options.subscribe(() => {}),
        litterChoice.litter.subscribe(() => {}),
      ]
      const read = wrap(() => ({
        options: titles(litterChoice.options),
        litter: litterChoice.litter(),
      }))
      await vi.waitFor(() =>
        expect(read()).toEqual({
          options: [
            { title: 'Лоток · Офелия', cats: ['ofelia'] },
            { title: 'Лоток · Буся', cats: ['busya'] },
          ],
          litter: model.litter('ofelia'),
        }),
      )

      await wrap(litterChoice.choose('busya'))
      await vi.waitFor(() => expect(read().litter).toBe(model.litter('busya')))
      for (const off of offs) off()
    })
  })

  it('merges cats sharing a litter into one option that cannot be switched', async () => {
    const { litterChoice } = await setup(SHARED_LITTER)

    await context.start(async () => {
      const offs = [
        litterChoice.options.subscribe(() => {}),
        litterChoice.canSwitch.subscribe(() => {}),
      ]
      const read = wrap(() => ({
        options: titles(litterChoice.options),
        canSwitch: litterChoice.canSwitch(),
      }))
      await vi.waitFor(() =>
        expect(read()).toEqual({
          options: [{ title: 'Лоток · Офелия и Буся', cats: ['ofelia', 'busya'] }],
          canSwitch: false,
        }),
      )
      for (const off of offs) off()
    })
  })
})

describe('card choice edge cases', () => {
  it('falls back to the first option when the stored key cannot be read', async () => {
    const { model } = await setup(TWO_CATS)
    const failure = new StorageError({ reason: 'boom' })
    const base = createFakeStorage()
    const failing: StorageApi = {
      ...base,
      subscribe: (_key, listener) => {
        queueMicrotask(() => listener(failure))
        return () => {}
      },
    }
    const choice = makeCatChoice({ model: atom(model), storage: failing, name: 'failing' })

    await context.start(async () => {
      const off = choice.current.subscribe(() => {})
      const read = wrap(() => choice.current()?.id)
      await vi.waitFor(() => expect(read()).toBe('ofelia'))
      off()
    })
  })

  it('falls back when the stored litter loses its last cat and restores it with the cat', async () => {
    const { litterChoice, cardStorage, registryStorage } = await setup(TWO_CATS, {
      litter: 'busya',
    })
    const events = [catEvent('add', 'ofelia', 1), catEvent('add', 'busya', 2)]

    await context.start(async () => {
      const off = litterChoice.current.subscribe(() => {})
      const read = wrap(() => litterChoice.current()?.id)
      await vi.waitFor(() => expect(read()).toBe('busya'))

      await registryStorage.set(CATS_REGISTRY_KEY, [...events, catEvent('archive', 'busya', 3)])
      await vi.waitFor(() => expect(read()).toBe('ofelia'))
      expect(await cardStorage.get(CARD_LITTER_KEY)).toBe('busya')

      await registryStorage.set(CATS_REGISTRY_KEY, [
        ...events,
        catEvent('archive', 'busya', 3),
        catEvent('restore', 'busya', 4),
      ])
      await vi.waitFor(() => expect(read()).toBe('busya'))
      off()
    })
  })
})

describe('makeLitterOptions', () => {
  it('is the same list the litter choice offers, and null without a model', async () => {
    const { model } = await setup(SHARED_LITTER)
    const options = makeLitterOptions(atom(model), 'test.options')
    const none = makeLitterOptions(atom(null), 'test.none')

    expect(none()).toBeNull()
    await context.start(async () => {
      const off = options.subscribe(() => {})
      const read = wrap(() => titles(options))
      await vi.waitFor(() =>
        expect(read()).toEqual([{ title: 'Лоток · Офелия и Буся', cats: ['ofelia', 'busya'] }]),
      )
      off()
    })
  })
})
