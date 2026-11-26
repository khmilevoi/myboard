import { describe, expect, it } from 'vitest'

import {
  DEFAULT_LITTER_SETTINGS,
  LitterSettingsSchema,
  dutyByDate,
  otherPerson,
  weekStartISO,
} from './roster'
import type { LitterSettings } from './roster'

const D = (iso: string) => Temporal.PlainDate.from(iso)

const swapped: LitterSettings = { rotation: ['Карина', 'Леша'], baseDate: '2026-06-16' }

describe('roster selectors', () => {
  it('otherPerson returns the partner', () => {
    expect(otherPerson(DEFAULT_LITTER_SETTINGS, 'Леша')).toBe('Карина')
    expect(otherPerson(DEFAULT_LITTER_SETTINGS, 'Карина')).toBe('Леша')
  })

  it('dutyByDate starts the rotation on the base date', () => {
    expect(dutyByDate(DEFAULT_LITTER_SETTINGS, D('2026-06-16'))).toBe('Леша')
    expect(dutyByDate(DEFAULT_LITTER_SETTINGS, D('2026-06-17'))).toBe('Карина')
    expect(dutyByDate(DEFAULT_LITTER_SETTINGS, D('2026-06-15'))).toBe('Карина')
  })

  it('dutyByDate follows the litter rotation order', () => {
    expect(dutyByDate(swapped, D('2026-06-16'))).toBe('Карина')
    expect(dutyByDate(swapped, D('2026-06-17'))).toBe('Леша')
  })

  it('dutyByDate follows the litter base date', () => {
    const shifted: LitterSettings = { ...DEFAULT_LITTER_SETTINGS, baseDate: '2026-06-17' }
    expect(dutyByDate(shifted, D('2026-06-17'))).toBe('Леша')
    expect(dutyByDate(shifted, D('2026-06-16'))).toBe('Карина')
  })

  it('weekStartISO uses the Monday of the date week', () => {
    expect(weekStartISO(D('2026-06-16'))).toBe('2026-06-15')
  })
})

describe('LitterSettingsSchema', () => {
  it('accepts the default settings and a swapped rotation', () => {
    expect(LitterSettingsSchema.safeParse(DEFAULT_LITTER_SETTINGS).success).toBe(true)
    expect(LitterSettingsSchema.safeParse(swapped).success).toBe(true)
  })

  it.each([
    ['a duplicated member', { rotation: ['Леша', 'Леша'], baseDate: '2026-06-16' }],
    ['a missing member', { rotation: ['Леша'], baseDate: '2026-06-16' }],
    ['a base date that does not exist', { rotation: ['Леша', 'Карина'], baseDate: '2026-02-30' }],
    ['an unknown member', { rotation: ['Леша', 'Миша'], baseDate: '2026-06-16' }],
  ])('rejects %s', (_label, value) => {
    expect(LitterSettingsSchema.safeParse(value).success).toBe(false)
  })
})
