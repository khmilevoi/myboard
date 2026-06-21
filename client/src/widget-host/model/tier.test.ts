import { describe, expect, it } from 'vitest'

import { DEFAULT_TIERS, resolveTier, type TierConfig } from './tier'

const config: TierConfig = {
  tiny: { minW: 1, minH: 1 },
  compact: { minW: 2, minH: 3 },
  standard: { minW: 3, minH: 5 },
  large: { minW: 5, minH: 7 },
}

describe('resolveTier', () => {
  it('returns the largest tier whose thresholds are both met', () => {
    expect(resolveTier({ w: 6, h: 8 }, config)).toBe('large')
    expect(resolveTier({ w: 3, h: 5 }, config)).toBe('standard')
    expect(resolveTier({ w: 2, h: 3 }, config)).toBe('compact')
  })

  it('falls back to tiny when no larger threshold is met', () => {
    expect(resolveTier({ w: 1, h: 1 }, config)).toBe('tiny')
    expect(resolveTier({ w: 2, h: 2 }, config)).toBe('tiny')
    expect(resolveTier({ w: 0, h: 0 }, config)).toBe('tiny')
  })

  it('requires BOTH width and height to clear a threshold', () => {
    expect(resolveTier({ w: 12, h: 4 }, config)).toBe('compact')
    expect(resolveTier({ w: 2, h: 12 }, config)).toBe('compact')
  })

  it('treats thresholds as inclusive (>=) on exact boundaries', () => {
    expect(resolveTier({ w: 5, h: 7 }, config)).toBe('large')
    expect(resolveTier({ w: 4, h: 6 }, config)).toBe('standard')
  })

  it('never returns fullscreen (it is set explicitly by the overlay)', () => {
    expect(resolveTier({ w: 999, h: 999 }, config)).toBe('large')
  })
})

describe('DEFAULT_TIERS', () => {
  it('maps the Ofelia default size (3x5) to standard', () => {
    expect(resolveTier({ w: 3, h: 5 }, DEFAULT_TIERS)).toBe('standard')
  })

  it('maps the clock default size (3x4) to compact', () => {
    expect(resolveTier({ w: 3, h: 4 }, DEFAULT_TIERS)).toBe('compact')
  })

  it('exposes thresholds for every non-fullscreen tier', () => {
    expect(Object.keys(DEFAULT_TIERS).sort()).toEqual(['compact', 'large', 'standard', 'tiny'])
  })
})
