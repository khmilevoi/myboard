// @vitest-environment node
import { describe, expect, it } from 'vitest'

import { MEMBER_TONES, memberInitial, memberTone } from './member'

describe('memberTone', () => {
  it('is stable for the same id', () => {
    expect(memberTone('abc')).toBe(memberTone('abc'))
  })

  it('always lands inside the palette', () => {
    for (const id of ['', 'a', 'zzzzzzzzzzzz', '9f-_A']) {
      expect(MEMBER_TONES).toContain(memberTone(id))
    }
  })

  it('spreads different ids across more than one tone', () => {
    const tones = new Set(Array.from({ length: 50 }, (_, i) => memberTone(`account-${i}`)))
    expect(tones.size).toBeGreaterThan(1)
  })
})

describe('memberInitial', () => {
  it('takes the first letter, upper-cased', () => {
    expect(memberInitial('карина')).toBe('К')
  })

  it('ignores surrounding whitespace', () => {
    expect(memberInitial('  Лёша ')).toBe('Л')
  })

  it('is a placeholder for an empty name', () => {
    expect(memberInitial('   ')).toBe('?')
  })
})
