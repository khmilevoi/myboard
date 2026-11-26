import { describe, expect, it } from 'vitest'

import { latestKey, monthKey, monthKeysInRange, monthSpan, PROFILE_KEY } from './keys'

describe('keys', () => {
  it('builds fixed keys', () => {
    expect(PROFILE_KEY).toBe('profile')
    expect(latestKey('body-fat')).toBe('latest/body-fat')
  })

  it('uses the UTC month', () => {
    expect(monthKey(Date.UTC(2026, 10, 30, 23, 59))).toBe('measurements/2026-11')
    expect(monthKey(Date.UTC(2026, 11, 1))).toBe('measurements/2026-12')
  })

  it('lists months across a year boundary', () => {
    expect(monthKeysInRange(Date.UTC(2026, 11, 15), Date.UTC(2027, 0, 2))).toEqual([
      'measurements/2026-12',
      'measurements/2027-01',
    ])
  })

  it('returns one key inside a month', () => {
    expect(monthKeysInRange(Date.UTC(2026, 4, 2), Date.UTC(2026, 4, 20))).toEqual([
      'measurements/2026-05',
    ])
  })

  it('counts the months of a range without listing them', () => {
    expect(monthSpan(Date.UTC(2026, 4, 2), Date.UTC(2026, 4, 20))).toBe(1)
    expect(monthSpan(Date.UTC(2026, 11, 15), Date.UTC(2027, 0, 2))).toBe(2)
    expect(monthSpan(Date.UTC(2021, 0, 1), Date.UTC(2025, 11, 31))).toBe(60)
    expect(monthSpan(Date.UTC(2021, 0, 1), Date.UTC(2026, 0, 1))).toBe(61)
    expect(monthSpan(Date.UTC(2021, 0, 1), Date.UTC(2026, 0, 1))).toBe(
      monthKeysInRange(Date.UTC(2021, 0, 1), Date.UTC(2026, 0, 1)).length,
    )
  })
})
