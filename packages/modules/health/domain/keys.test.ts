import { describe, expect, it } from 'vitest'

import { latestKey, monthKey, monthKeysInRange, PROFILE_KEY } from './keys'

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
})
