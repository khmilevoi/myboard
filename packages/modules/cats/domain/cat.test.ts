import { describe, expect, it } from 'vitest'

import {
  CatProfileSchema,
  defaultCatProfile,
  goalOn,
  latestWeighing,
  litterTitle,
  type GoalEntry,
  type Weighing,
} from './cat'

const D = (iso: string) => Temporal.PlainDate.from(iso)

describe('goalOn', () => {
  const goals: GoalEntry[] = [
    { id: 'g1', ts: 1, kcal: 220, since: '2026-06-01' },
    { id: 'g2', ts: 2, kcal: 240, since: '2026-06-10' },
  ]

  it('takes the entry with the latest since on or before the date', () => {
    expect(goalOn(goals, D('2026-06-09'))).toBe(220)
    expect(goalOn(goals, D('2026-06-10'))).toBe(240)
  })

  it('is null before the first goal', () => {
    expect(goalOn(goals, D('2026-05-31'))).toBeNull()
  })

  it('breaks a since tie by the higher ts, whatever the storage order', () => {
    const tie: GoalEntry[] = [
      { id: 'g2', ts: 2, kcal: 260, since: '2026-06-10' },
      { id: 'g1', ts: 1, kcal: 250, since: '2026-06-10' },
    ]

    expect(goalOn(tie, D('2026-06-10'))).toBe(260)
  })
})

describe('latestWeighing', () => {
  it('orders by at, then ts', () => {
    const weighings: Weighing[] = [
      { id: 'w1', ts: 5, at: '2026-06-16', kg: 4.3 },
      { id: 'w2', ts: 9, at: '2026-06-16', kg: 4.4 },
      { id: 'w3', ts: 20, at: '2026-06-15', kg: 4.1 },
    ]

    expect(latestWeighing(weighings)?.id).toBe('w2')
    expect(latestWeighing([])).toBeNull()
  })
})

describe('litterTitle', () => {
  it.each([
    [[], 'Лоток'],
    [['Офелия'], 'Лоток · Офелия'],
    [['Офелия', 'Буся'], 'Лоток · Офелия и Буся'],
    [['Офелия', 'Буся', 'Мурка'], 'Лоток · Офелия, Буся и Мурка'],
  ])('titles %j as %s', (names, title) => {
    expect(litterTitle(names)).toBe(title)
  })
})

describe('CatProfileSchema', () => {
  const profile = defaultCatProfile('Офелия', 'ofelia')

  it('accepts the default profile', () => {
    expect(CatProfileSchema.parse(profile)).toEqual({
      name: 'Офелия',
      breed: null,
      birthDate: null,
      sex: null,
      sterilized: 'unknown',
      bodyCondition: null,
      avatar: null,
      litterId: 'ofelia',
    })
  })

  it('rejects a blank name', () => {
    expect(CatProfileSchema.safeParse({ ...profile, name: '  ' }).success).toBe(false)
  })

  it('rejects a body condition above 9', () => {
    expect(CatProfileSchema.safeParse({ ...profile, bodyCondition: 10 }).success).toBe(false)
  })

  it('rejects a litter id that is not an entity id', () => {
    expect(CatProfileSchema.safeParse({ ...profile, litterId: 'a/b' }).success).toBe(false)
  })
})
