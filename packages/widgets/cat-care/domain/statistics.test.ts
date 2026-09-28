// @vitest-environment node
import { describe, expect, it } from 'vitest'

import { foldLedger } from './ledger'
import { getTargetForDate, getWeightSeries, summarizeDay, summarizePeriod } from './statistics'
import { entry, food, profile, time, weight } from './test-fixtures'

describe('daily and period summaries', () => {
  it('separates known eaten from offered, preserves missing nutrients and flags later leftovers', () => {
    const state = foldLedger([
      entry({
        kind: 'food.save',
        food: food({ mode: 'offered', remainingGrams: 5, observedAt: time + 86400000 }),
      }),
      entry(
        { kind: 'food.save', food: food({ id: 'pending', mode: 'offered' }) },
        { mutationId: 'second' },
      ),
    ])
    expect(summarizeDay({ state, date: '2026-09-28', timeZone: 'Europe/Warsaw' })).toMatchObject({
      eatenKcal: 100,
      pendingKcal: 120,
      foodCount: 2,
      pendingCount: 1,
      carbsGrams: null,
      proteinGrams: 7.5,
      foodMoistureMl: 2.5,
      hasEstimatedTiming: true,
    })
  })
  it('does not treat unlogged calendar days as observed fasting in a period average', () => {
    const state = foldLedger([entry({ kind: 'food.save', food: food() })])
    const summary = summarizePeriod({
      state,
      endDate: '2026-09-28',
      days: 7,
      timeZone: 'Europe/Warsaw',
    })
    expect(summary.days).toHaveLength(7)
    expect(summary).toMatchObject({ loggedDays: 1, averageEatenKcal: 120 })
    expect(
      summarizePeriod({
        state: foldLedger([]),
        endDate: '2026-09-28',
        days: 7,
        timeZone: 'Europe/Warsaw',
      }).averageEatenKcal,
    ).toBeNull()
  })
  it('keeps a moisture total unknown when any eaten product lacks it', () => {
    const meal = food()
    meal.snapshot.nutrition.moisturePercent = null
    const state = foldLedger([entry({ kind: 'food.save', food: meal })])
    expect(summarizeDay({ state, date: '2026-09-28', timeZone: 'Europe/Warsaw' })).toMatchObject({
      foodMoistureMl: null,
      unknownMoistureCount: 1,
    })
  })
  it('excludes pending-only days from the confirmed average but includes a measured zero', () => {
    const entries = [entry({ kind: 'food.save', food: food({ mode: 'offered' }) })]
    const summarize = () =>
      summarizePeriod({
        state: foldLedger(entries),
        endDate: '2026-09-28',
        days: 7,
        timeZone: 'Europe/Warsaw',
      })
    expect(summarize()).toMatchObject({ loggedDays: 1, confirmedDays: 0, averageEatenKcal: null })
    entries.push(
      entry(
        { kind: 'food.save', food: food({ id: 'eaten', occurredAt: time - 86400000 }) },
        { mutationId: 'eaten' },
      ),
      entry(
        {
          kind: 'food.save',
          food: food({
            id: 'measured-zero',
            mode: 'offered',
            occurredAt: time - 172800000,
            remainingGrams: 30,
            observedAt: time - 172800000,
          }),
        },
        { mutationId: 'measured-zero' },
      ),
    )
    expect(summarize()).toMatchObject({ loggedDays: 3, confirmedDays: 2, averageEatenKcal: 60 })
  })
})

describe('date-effective targets and weight points', () => {
  it('keeps previous goals and removes them only from the explicit local removal day', () => {
    const history = [
      {
        ts: time,
        profile: {
          ...profile,
          calorieTarget: { kcal: 210, source: 'manual' as const, effectiveFrom: '2026-09-01' },
        },
      },
      { ts: Date.parse('2026-09-28T22:30:00Z'), profile },
    ]
    expect(getTargetForDate({ profileHistory: history, date: '2026-09-28' })?.kcal).toBe(210)
    expect(getTargetForDate({ profileHistory: history, date: '2026-09-29' })).toBeNull()
    expect(getTargetForDate({ profileHistory: history, date: '2026-10-01' })).toBeNull()
  })
  it('uses effective dates and last journal revision for equal-date target edits', () => {
    const history = [220, 200].map((kcal) => ({
      ts: time,
      profile: {
        ...profile,
        calorieTarget: { kcal, source: 'manual' as const, effectiveFrom: '2026-09-28' },
      },
    }))
    expect(getTargetForDate({ profileHistory: history, date: '2026-09-27' })).toBeNull()
    expect(getTargetForDate({ profileHistory: history, date: '2026-09-28' })?.kcal).toBe(200)
  })
  it('cancels previously scheduled goals on removal and accepts a later new goal', () => {
    const history = [
      {
        ts: time - 1000,
        profile: {
          ...profile,
          calorieTarget: { kcal: 210, source: 'manual' as const, effectiveFrom: '2026-09-01' },
        },
      },
      {
        ts: time,
        profile: {
          ...profile,
          calorieTarget: { kcal: 220, source: 'manual' as const, effectiveFrom: '2026-10-01' },
        },
      },
      { ts: time + 1000, profile },
      {
        ts: time + 2000,
        profile: {
          ...profile,
          calorieTarget: { kcal: 230, source: 'manual' as const, effectiveFrom: '2026-10-02' },
        },
      },
      {
        ts: time + 3000,
        profile: {
          ...profile,
          name: 'Новое имя',
          calorieTarget: { kcal: 230, source: 'manual' as const, effectiveFrom: '2026-10-02' },
        },
      },
    ]
    expect(getTargetForDate({ profileHistory: history, date: '2026-09-27' })?.kcal).toBe(210)
    expect(getTargetForDate({ profileHistory: history, date: '2026-09-28' })).toBeNull()
    expect(getTargetForDate({ profileHistory: history, date: '2026-10-01' })).toBeNull()
    expect(getTargetForDate({ profileHistory: history, date: '2026-10-02' })?.kcal).toBe(230)
  })
  it('sorts actual measurements without filling calendar gaps or mutating inputs', () => {
    const records = [weight({ id: 'later', occurredAt: time + 864000000 }), weight()]
    expect(getWeightSeries({ records }).map((point) => point.id)).toEqual(['weight', 'later'])
    expect(records[0].id).toBe('later')
    expect(getWeightSeries({ records, toMs: time })).toHaveLength(1)
  })
})
