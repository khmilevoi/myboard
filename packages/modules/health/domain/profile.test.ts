import { describe, expect, it } from 'vitest'

import { ProfileSchema } from './profile'

const valid = { heightCm: 180, birthDate: '1990-05-17', sex: 'male' }
const parse = (patch: Record<string, unknown>) => ProfileSchema.safeParse({ ...valid, ...patch })

describe('ProfileSchema', () => {
  it('parses a valid profile', () => {
    expect(ProfileSchema.parse(valid)).toEqual(valid)
  })

  it('enforces the height bounds', () => {
    expect(parse({ heightCm: 99 }).success).toBe(false)
    expect(parse({ heightCm: 251 }).success).toBe(false)
    expect(parse({ heightCm: 100 }).success).toBe(true)
    expect(parse({ heightCm: 250 }).success).toBe(true)
  })

  it('rejects a future birth date', () => {
    expect(parse({ birthDate: '2999-01-01' }).success).toBe(false)
  })

  it('rejects an impossible calendar date', () => {
    expect(parse({ birthDate: '2026-02-30' }).success).toBe(false)
  })

  it('rejects a non-ISO string', () => {
    expect(parse({ birthDate: '17.05.1990' }).success).toBe(false)
    expect(parse({ birthDate: '1990-5-7' }).success).toBe(false)
  })

  it('rejects an unknown sex', () => {
    expect(parse({ sex: 'other' }).success).toBe(false)
  })
})
