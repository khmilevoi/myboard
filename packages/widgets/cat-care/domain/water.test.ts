// @vitest-environment node
import { describe, expect, it } from 'vitest'

import { time, water } from './test-fixtures'
import { computeWaterIntervals } from './water'
const hour = 3600000

describe('bowl observation intervals', () => {
  it('first fill starts observation, with no invented consumption', () => {
    expect(computeWaterIntervals([water()])).toEqual([])
  })
  it('keeps an unmeasured topup in the original balance and replacement resets it', () => {
    const intervals = computeWaterIntervals([
      water(),
      water({ id: 'topup', kind: 'topup', occurredAt: time + hour, addedMl: 50 }),
      water({ id: 'replace', occurredAt: time + 48 * hour, remainingMl: 80, addedMl: 300 }),
      water({ id: 'next', occurredAt: time + 72 * hour, remainingMl: 200 }),
    ])
    expect(intervals).toMatchObject([
      {
        startAt: time,
        volumeMl: 170,
        durationHours: 48,
        normalizedMlPerDay: 85,
        status: 'estimated',
      },
      { volumeMl: 100, durationHours: 24, normalizedMlPerDay: 100 },
    ])
  })
  it('a measured topup closes the interval and establishes remainder plus fresh water', () => {
    expect(
      computeWaterIntervals([
        water(),
        water({
          id: 'topup',
          kind: 'topup',
          occurredAt: time + hour,
          remainingMl: 150,
          addedMl: 50,
        }),
        water({ id: 'end', occurredAt: time + 2 * hour, remainingMl: 120 }),
      ]).map((x) => x.volumeMl),
    ).toEqual([50, 80])
  })
  it('missing replacement remainder is unknown but does not poison the next interval', () => {
    const intervals = computeWaterIntervals([
      water(),
      water({ id: 'missing', occurredAt: time + hour, addedMl: 300 }),
      water({ id: 'end', occurredAt: time + 2 * hour, remainingMl: 220 }),
    ])
    expect(intervals[0]).toMatchObject({
      volumeMl: null,
      normalizedMlPerDay: null,
      reason: 'missing_observation',
    })
    expect(intervals[1].volumeMl).toBe(80)
  })
  it('a first unmeasured topup cannot establish the prior bowl volume', () => {
    expect(
      computeWaterIntervals([
        water({ kind: 'topup', addedMl: 50 }),
        water({ id: 'end', occurredAt: time + hour, remainingMl: 80 }),
      ])[0].volumeMl,
    ).toBeNull()
  })
  it('subtracts known discarded water exactly once across topups', () => {
    expect(
      computeWaterIntervals([
        water(),
        water({
          id: 'topup',
          kind: 'topup',
          occurredAt: time + hour,
          addedMl: 50,
          discardedMl: 20,
        }),
        water({ id: 'end', occurredAt: time + 2 * hour, remainingMl: 80, discardedMl: 10 }),
      ])[0].volumeMl,
    ).toBe(140)
  })
  it('propagates uncontrolled loss only until the next actual observation', () => {
    const result = computeWaterIntervals([
      water(),
      water({
        id: 'spill',
        kind: 'topup',
        occurredAt: time + hour,
        addedMl: 50,
        unmeasuredLoss: true,
      }),
      water({ id: 'end', occurredAt: time + 2 * hour, remainingMl: 100 }),
      water({ id: 'next', occurredAt: time + 3 * hour, remainingMl: 170 }),
    ])
    expect(result[0]).toMatchObject({ volumeMl: null, reason: 'unmeasured_loss' })
    expect(result[1].volumeMl).toBe(30)
  })
  it('invalid negative historical differences stay unknown and recover at the next baseline', () => {
    const result = computeWaterIntervals([
      water(),
      water({ id: 'bad', occurredAt: time + hour, remainingMl: 300 }),
      water({ id: 'ok', occurredAt: time + 2 * hour, remainingMl: 150 }),
    ])
    expect(result[0]).toMatchObject({ volumeMl: null, reason: 'invalid_balance' })
    expect(result[1].volumeMl).toBe(50)
  })
  it('uses elapsed hours across a DST change, never calendar-date counts', () => {
    const records = [
      water({ occurredAt: Date.parse('2026-10-24T12:00:00+02:00') }),
      water({ id: 'end', occurredAt: Date.parse('2026-10-25T12:00:00+01:00'), remainingMl: 100 }),
    ]
    expect(computeWaterIntervals(records)[0]).toMatchObject({
      durationHours: 25,
      normalizedMlPerDay: 96,
    })
  })
  it('does not divide by zero for two observations in the same instant', () => {
    expect(
      computeWaterIntervals([water(), water({ id: 'same', remainingMl: 180 })])[0]
        .normalizedMlPerDay,
    ).toBeNull()
  })
})
