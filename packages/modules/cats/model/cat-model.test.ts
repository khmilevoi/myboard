import { context, wrap } from '@reatom/core'
import type { FileRef } from '@shared/files/contract'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { StorageError, makeFileSlotFromApi } from 'widget-runtime'
import { createFakeStorage, makeFakeFileSlotApi } from 'widget-runtime/storage/test/fakes'

import { defaultCatProfile, type GoalEntry, type Weighing } from '../domain/cat'
import { catGoalKey, catProfileKey, catWeightKey } from '../domain/keys'
import { makeKeysDownStorage, makeTestCatsModel, type MakeTestCatsModelOptions } from './testing'

const D = (iso: string) => Temporal.PlainDate.from(iso)

const GOALS: GoalEntry[] = [
  { id: 'g1', ts: 1, kcal: 220, since: '2026-06-01' },
  { id: 'g2', ts: 2, kcal: 240, since: '2026-06-10' },
]

const WEIGHINGS: Weighing[] = [
  { id: 'w1', ts: 1, at: '2026-06-16', kg: 4.3 },
  { id: 'w2', ts: 2, at: '2026-06-14', kg: 4.1 },
]

afterEach(() => {
  context.reset()
})

/** A cat model over storage seeded with Ofelia's goals and weighings. */
function makeOfelia(todayIso?: string, seed: Record<string, unknown> = {}) {
  const storage = createFakeStorage()
  // The fake's `set` writes synchronously before its first await.
  for (const [key, value] of Object.entries(seed)) void storage.set(key, value)
  const { model, calls } = makeTestCatsModel({
    storage,
    todayIso,
    profiles: { ofelia: defaultCatProfile('Офелия', 'ofelia') },
  })
  return { cat: model.cat('ofelia'), calls }
}

describe('makeCatModel', () => {
  it.each([
    ['2026-06-09', 220],
    ['2026-06-10', 240],
    ['2026-05-31', null],
  ])("follows goalOn at the fake clock's day %s", async (todayIso, expected) => {
    const { cat } = makeOfelia(todayIso, { [catGoalKey('ofelia')]: GOALS })

    await context.start(async () => {
      const off = cat.goalToday.subscribe(() => {})
      const read = wrap(() => ({ goals: cat.goals(), goalToday: cat.goalToday() }))

      await vi.waitFor(() => expect(read()).toEqual({ goals: GOALS, goalToday: expected }))
      off()
    })
  })

  it('reads the profile, the weighings and the latest weighing', async () => {
    const { cat } = makeOfelia(undefined, { [catWeightKey('ofelia')]: WEIGHINGS })

    await context.start(async () => {
      const offs = [cat.profile.subscribe(() => {}), cat.latestWeighing.subscribe(() => {})]
      const read = wrap(() => ({
        name: cat.profile()?.name,
        weighings: cat.weighings(),
        latest: cat.latestWeighing()?.id,
      }))

      await vi.waitFor(() =>
        expect(read()).toEqual({ name: 'Офелия', weighings: WEIGHINGS, latest: 'w1' }),
      )
      for (const off of offs) off()
    })
  })

  it('reads an absent goal key and a junk weight key as empty lists', async () => {
    const { cat } = makeOfelia('2026-06-16', { [catWeightKey('ofelia')]: 'junk' })

    await context.start(async () => {
      const offs = [cat.goalToday.subscribe(() => {}), cat.weighings.subscribe(() => {})]
      const read = wrap(() => ({ goals: cat.goals(), weighings: cat.weighings() }))

      await vi.waitFor(() => expect(read()).toEqual({ goals: [], weighings: [] }))
      expect(wrap(() => cat.goalToday())()).toBeNull()
      for (const off of offs) off()
    })
  })

  it('is null before its keys answer', () => {
    const { cat } = makeOfelia('2026-06-16', { [catGoalKey('ofelia')]: GOALS })

    expect(cat.profile()).toBeNull()
    expect(cat.weighings()).toBeNull()
    expect(cat.goals()).toBeNull()
    expect(cat.goalToday()).toBeNull()
  })

  it('sends weigh, setGoal and saveProfile with the cat id', async () => {
    const { cat, calls } = makeOfelia()
    const { litterId: _litterId, ...fields } = defaultCatProfile('Офелия', 'ofelia')

    await wrap(() => cat.weigh(4.32, D('2026-06-16')))()
    await wrap(() => cat.setGoal(220, D('2026-06-10')))()
    await wrap(() => cat.saveProfile(fields, { kind: 'existing', litterId: 'ofelia' }))()

    expect(calls).toEqual([
      { action: 'weigh', payload: { catId: 'ofelia', kg: 4.32, at: '2026-06-16' } },
      { action: 'setGoal', payload: { catId: 'ofelia', kcal: 220, since: '2026-06-10' } },
      {
        action: 'saveProfile',
        payload: {
          catId: 'ofelia',
          profile: fields,
          litter: { kind: 'existing', litterId: 'ofelia' },
        },
      },
    ])
  })
})

const AVATAR_REF: FileRef = {
  blobId: 'abcdefghijklmnop',
  url: '/files/abcdefghijklmnop',
  mime: 'image/webp',
  size: 10,
  updatedAt: 1,
}

describe('cat avatar slot', () => {
  const profiles = { ofelia: defaultCatProfile('Офелия', 'ofelia') }
  const readAvatars = (model: ReturnType<typeof makeTestCatsModel>['model']) =>
    wrap(() => ({
      avatarUrl: model.cat('ofelia').avatarUrl(),
      summary: model.cats()?.[0]?.avatar,
    }))

  const makeSlots = (api = makeFakeFileSlotApi(AVATAR_REF)) => {
    const requested: string[] = []
    const slot = makeFileSlotFromApi(api, 'test.avatar')
    const files = ((scopeOrKey: string, key?: string) => {
      requested.push(`${scopeOrKey}:${key}`)
      return slot
    }) as NonNullable<MakeTestCatsModelOptions['files']>
    return { files, requested }
  }

  it('reads the avatar from the slot, in the cat and in the summary', async () => {
    const { files, requested } = makeSlots()
    const { model, calls } = makeTestCatsModel({
      files,
      profiles,
      catRegistry: [{ id: 'r1', catId: 'ofelia', op: 'add', ts: 1 }],
    })

    await context.start(async () => {
      const offs = [
        model.cat('ofelia').avatarUrl.subscribe(() => {}),
        model.cats.subscribe(() => {}),
      ]
      const read = readAvatars(model)
      await vi.waitFor(() =>
        expect(read()).toEqual({
          avatarUrl: '/files/abcdefghijklmnop',
          summary: '/files/abcdefghijklmnop',
        }),
      )
      for (const off of offs) off()
    })
    expect(requested).toContain('shared:cat/ofelia/avatar')
    expect(calls).toEqual([])
  })

  it('clears both after removeAvatar, without an API call', async () => {
    const { files } = makeSlots()
    const { model, calls } = makeTestCatsModel({
      files,
      profiles,
      catRegistry: [{ id: 'r1', catId: 'ofelia', op: 'add', ts: 1 }],
    })

    await context.start(async () => {
      const offs = [
        model.cat('ofelia').avatarUrl.subscribe(() => {}),
        model.cats.subscribe(() => {}),
      ]
      const read = readAvatars(model)
      await vi.waitFor(() => expect(read().avatarUrl).toBe('/files/abcdefghijklmnop'))

      const removed = await wrap(model.cat('ofelia').removeAvatar())
      expect(removed).toBeUndefined()
      await vi.waitFor(() => expect(read()).toEqual({ avatarUrl: null, summary: null }))
      for (const off of offs) off()
    })
    expect(calls).toEqual([])
  })

  it('returns a failed upload as a value and leaves the avatar unchanged', async () => {
    const failure = new StorageError({ reason: 'upload failed' })
    const { files } = makeSlots({
      ...makeFakeFileSlotApi(AVATAR_REF),
      upload: async () => failure,
    })
    const { model, calls } = makeTestCatsModel({ files, profiles })

    await context.start(async () => {
      const off = model.cat('ofelia').avatarUrl.subscribe(() => {})
      const read = wrap(() => model.cat('ofelia').avatarUrl())
      await vi.waitFor(() => expect(read()).toBe('/files/abcdefghijklmnop'))

      const result = await wrap(model.cat('ofelia').uploadAvatar(new Blob(['x'])))
      expect(result).toBe(failure)
      expect(read()).toBe('/files/abcdefghijklmnop')
      off()
    })
    expect(calls).toEqual([])
  })
})

describe('makeCatModel read failures', () => {
  function makeDown(keys: string[]) {
    const base = createFakeStorage()
    void base.set(catWeightKey('ofelia'), WEIGHINGS)
    void base.set(catGoalKey('ofelia'), GOALS)
    const failure = new StorageError({ reason: 'boom' })
    const { storage, recover } = makeKeysDownStorage(base, keys, failure)
    const { model } = makeTestCatsModel({
      storage,
      todayIso: '2026-06-16',
      profiles: { ofelia: defaultCatProfile('Офелия', 'ofelia') },
    })
    return { cat: model.cat('ofelia'), failure, recover }
  }

  it('a failed weight read is the load error, and a retry loads the weighings', async () => {
    const { cat, failure, recover } = makeDown([catWeightKey('ofelia')])

    await context.start(async () => {
      const offs = [cat.weighings.subscribe(() => {}), cat.loadError.subscribe(() => {})]
      const read = wrap(() => ({ weighings: cat.weighings(), error: cat.loadError() }))
      // Wrapped before the first await: after it, an unwrapped call runs in the global context.
      const retry = wrap(() => cat.retry())
      await vi.waitFor(() => expect(read()).toEqual({ weighings: null, error: failure }))

      // Still down: the retry keeps the error.
      await retry()
      expect(read()).toEqual({ weighings: null, error: failure })

      recover()
      await retry()
      expect(read()).toEqual({ weighings: WEIGHINGS, error: null })
      for (const off of offs) off()
    })
  })

  it('a failed goal read is the load error too', async () => {
    const { cat, failure, recover } = makeDown([catGoalKey('ofelia')])

    await context.start(async () => {
      const off = cat.loadError.subscribe(() => {})
      const read = wrap(() => ({ goals: cat.goals(), error: cat.loadError() }))
      const retry = wrap(() => cat.retry())
      await vi.waitFor(() => expect(read()).toEqual({ goals: null, error: failure }))

      recover()
      await retry()
      expect(read()).toEqual({ goals: GOALS, error: null })
      off()
    })
  })

  it('a failed profile read reads as no profile, not as loading', async () => {
    const { cat } = makeDown([catProfileKey('ofelia')])

    await context.start(async () => {
      const off = cat.profile.subscribe(() => {})
      const read = wrap(() => ({ profile: cat.profile(), error: cat.loadError() }))
      await vi.waitFor(() => expect(read()).toEqual({ profile: null, error: null }))
      off()
    })
  })
})
