import { context, wrap } from '@reatom/core'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { createFakeStorage } from 'widget-runtime/storage/test/fakes'

import { defaultCatProfile, type GoalEntry, type Weighing } from '../domain/cat'
import { catGoalKey, catWeightKey } from '../domain/keys'
import { makeTestCatsModel } from './testing'

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
