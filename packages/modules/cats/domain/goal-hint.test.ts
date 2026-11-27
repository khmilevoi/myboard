import { describe, expect, it } from 'vitest'

import { defaultCatProfile, type CatProfile, type Weighing } from './cat'
import { suggestGoal } from './goal-hint'

const TODAY = Temporal.PlainDate.from('2026-11-26')

const profile = (patch: Partial<CatProfile> = {}): CatProfile => ({
  ...defaultCatProfile('Офелия', 'ofelia'),
  birthDate: '2023-09-12',
  sterilized: 'yes',
  bodyCondition: 5,
  ...patch,
})

const weighing = (kg: number): Weighing => ({ id: 'w', ts: 1, at: '2026-11-21', kg })

describe('suggestGoal', () => {
  it('computes the resting-energy goal for a sterilized cat', () => {
    expect(suggestGoal({ profile: profile(), latest: weighing(4), today: TODAY })).toEqual({
      kind: 'available',
      kcal: 238,
      weightKg: 4,
    })
    expect(suggestGoal({ profile: profile(), latest: weighing(4.32), today: TODAY })).toMatchObject(
      { kcal: 252 },
    )
  })

  it('uses the higher factor for an intact cat', () => {
    expect(
      suggestGoal({ profile: profile({ sterilized: 'no' }), latest: weighing(4), today: TODAY }),
    ).toMatchObject({ kcal: 277 })
  })

  it.each([
    ['missing_weight', profile(), null],
    ['missing_age', profile({ birthDate: null }), weighing(4)],
    ['kitten', profile({ birthDate: '2026-03-15' }), weighing(4)],
    ['senior', profile({ birthDate: '2014-01-01' }), weighing(4)],
    ['missing_neuter_status', profile({ sterilized: 'unknown' }), weighing(4)],
    ['body_condition', profile({ bodyCondition: 7 }), weighing(4)],
  ] as const)('is unavailable with %s', (reason, catProfile, latest) => {
    expect(suggestGoal({ profile: catProfile, latest, today: TODAY })).toEqual({
      kind: 'unavailable',
      reason,
    })
  })
})
