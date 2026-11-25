// @vitest-environment node
import { describe, expect, it } from 'vitest'

import { epochToLocalDateTime, getLocalDate, localDateTimeToEpoch } from './time'

describe('observation time boundaries', () => {
  it('uses the profile local day instead of the UTC date', () => {
    expect(
      getLocalDate({ occurredAt: Date.parse('2026-09-28T22:30:00Z'), timeZone: 'Europe/Warsaw' }),
    ).toBe('2026-09-29')
  })
  it('converts a local form timestamp to its exact UTC instant', () => {
    expect(localDateTimeToEpoch({ value: '2026-09-28T12:00', timeZone: 'Europe/Warsaw' })).toBe(
      Date.parse('2026-09-28T10:00:00Z'),
    )
    expect(
      epochToLocalDateTime({
        occurredAt: Date.parse('2026-09-28T10:00:00Z'),
        timeZone: 'Europe/Warsaw',
      }),
    ).toBe('2026-09-28T12:00')
  })
  it.each(['2026-03-29T02:30', '2026-10-25T02:30', '2026-02-30T12:00', 'not a date'])(
    'rejects impossible or ambiguous newly entered time %s',
    (value) => {
      expect(localDateTimeToEpoch({ value, timeZone: 'Europe/Warsaw' })).toBeInstanceOf(Error)
    },
  )
  it('returns an error value for an invalid timezone', () => {
    expect(
      localDateTimeToEpoch({ value: '2026-09-28T12:00', timeZone: 'Unknown/Zone' }),
    ).toBeInstanceOf(Error)
  })
})
