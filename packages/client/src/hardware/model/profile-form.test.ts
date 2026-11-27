import { ScaleProfileSchema } from '@shared/hardware/spike-assumptions'
import { describe, expect, it } from 'vitest'

import {
  formatBirthDate,
  isProfileComplete,
  parseBirthDate,
  parseProfileForm,
  profileToForm,
  SCALE_PROFILE_FORM_FIELDS,
} from './profile-form'

const filled = { height: '182', birthDate: '14.03.1992', sex: 'male' as const }

describe('profile form', () => {
  it("ScaleProfileSchema's keys are exactly SCALE_PROFILE_FORM_FIELDS", () => {
    expect(Object.keys(ScaleProfileSchema.shape).sort()).toEqual(
      [...SCALE_PROFILE_FORM_FIELDS].sort(),
    )
  })

  it('14.03.1992 ↔ 1992-03-14', () => {
    expect(parseBirthDate('14.03.1992')).toBe('1992-03-14')
    expect(parseBirthDate(' 14.03.1992 ')).toBe('1992-03-14')
    expect(formatBirthDate('1992-03-14')).toBe('14.03.1992')
  })

  it('31.02.1992 → null, and so is anything not ДД.ММ.ГГГГ', () => {
    expect(parseBirthDate('31.02.1992')).toBeNull()
    expect(parseBirthDate('1992-03-14')).toBeNull()
    expect(parseBirthDate('4.3.1992')).toBeNull()
    expect(parseBirthDate('')).toBeNull()
  })

  it('a filled form parses to the profile', () => {
    expect(parseProfileForm(filled)).toEqual({
      heightCm: 182,
      birthDate: '1992-03-14',
      sex: 'male',
    })
  })

  it("height '99' → { field: 'height' }", () => {
    expect(parseProfileForm({ ...filled, height: '99' })).toEqual({ field: 'height' })
    expect(parseProfileForm({ ...filled, height: 'abc' })).toEqual({ field: 'height' })
    expect(parseProfileForm({ ...filled, height: '' })).toEqual({ field: 'height' })
  })

  it("an invalid or future birth date → { field: 'birthDate' }", () => {
    expect(parseProfileForm({ ...filled, birthDate: '31.02.1992' })).toEqual({
      field: 'birthDate',
    })
    expect(parseProfileForm({ ...filled, birthDate: '01.01.2999' })).toEqual({
      field: 'birthDate',
    })
  })

  it("sex null → { field: 'sex' }", () => {
    expect(parseProfileForm({ ...filled, sex: null })).toEqual({ field: 'sex' })
  })

  it('isProfileComplete(null) false; a valid profile true', () => {
    expect(isProfileComplete(null)).toBe(false)
    expect(isProfileComplete({ heightCm: 182 })).toBe(false)
    expect(isProfileComplete({ heightCm: 182, birthDate: '1992-03-14', sex: 'male' })).toBe(true)
  })

  it('profileToForm prefills what a stored profile has', () => {
    expect(profileToForm(null)).toEqual({ height: '', birthDate: '', sex: null })
    expect(profileToForm({ heightCm: 182, birthDate: '1992-03-14', sex: 'female' })).toEqual({
      height: '182',
      birthDate: '14.03.1992',
      sex: 'female',
    })
  })
})
