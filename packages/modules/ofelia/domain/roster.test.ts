import { describe, expect, it } from 'vitest'

import { otherPerson, weekStartISO } from './roster'

const D = (iso: string) => Temporal.PlainDate.from(iso)

describe('roster selectors', () => {
  it('otherPerson returns the partner', () => {
    expect(otherPerson('Леша')).toBe('Карина')
    expect(otherPerson('Карина')).toBe('Леша')
  })

  it('weekStartISO uses the Monday of the date week', () => {
    expect(weekStartISO(D('2026-06-16'))).toBe('2026-06-15')
  })
})
