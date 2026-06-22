import { describe, expect, it } from 'vitest'

import { personInitial, personTone } from './person'

describe('person helpers', () => {
  it('returns the first letter as the initial', () => {
    expect(personInitial('Карина')).toBe('К')
    expect(personInitial('Леша')).toBe('Л')
  })

  it('maps Карина to the red tone and Леша to the blue tone', () => {
    expect(personTone('Карина')).toBe('k')
    expect(personTone('Леша')).toBe('l')
  })
})
