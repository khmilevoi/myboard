import { describe, expect, it } from 'vitest'

import { DEFAULT_TIERS, resolveTier, type TierConfig } from './tier'

// Thresholds are in CSS pixels — the actual rendered size of the widget's
// frame, not grid units. Grid columns resize with the viewport, so a fixed
// number of columns maps to a different pixel size on every screen.
const config: TierConfig = {
  tiny: { minWidthPx: 0, minHeightPx: 0 },
  compact: { minWidthPx: 200, minHeightPx: 150 },
  standard: { minWidthPx: 320, minHeightPx: 280 },
  large: { minWidthPx: 480, minHeightPx: 420 },
}

describe('resolveTier', () => {
  it('returns the largest tier whose thresholds are both met', () => {
    expect(resolveTier({ width: 600, height: 500 }, config)).toBe('large')
    expect(resolveTier({ width: 320, height: 280 }, config)).toBe('standard')
    expect(resolveTier({ width: 200, height: 150 }, config)).toBe('compact')
  })

  it('falls back to tiny when no larger threshold is met', () => {
    expect(resolveTier({ width: 10, height: 10 }, config)).toBe('tiny')
    expect(resolveTier({ width: 199, height: 149 }, config)).toBe('tiny')
    expect(resolveTier({ width: 0, height: 0 }, config)).toBe('tiny')
  })

  it('requires BOTH width and height to clear a threshold', () => {
    expect(resolveTier({ width: 1000, height: 160 }, config)).toBe('compact')
    expect(resolveTier({ width: 210, height: 1000 }, config)).toBe('compact')
  })

  it('treats thresholds as inclusive (>=) on exact boundaries', () => {
    expect(resolveTier({ width: 480, height: 420 }, config)).toBe('large')
    expect(resolveTier({ width: 479, height: 419 }, config)).toBe('standard')
  })

  it('never returns fullscreen (it is set explicitly by the overlay)', () => {
    expect(resolveTier({ width: 99_999, height: 99_999 }, config)).toBe('large')
  })
})

describe('DEFAULT_TIERS', () => {
  it('exposes thresholds for every non-fullscreen tier', () => {
    expect(Object.keys(DEFAULT_TIERS).sort()).toEqual(['compact', 'large', 'standard', 'tiny'])
  })

  it('orders thresholds so each tier needs more space than the last', () => {
    const order: (keyof TierConfig)[] = ['compact', 'standard', 'large']
    for (let i = 1; i < order.length; i++) {
      const prev = DEFAULT_TIERS[order[i - 1]]
      const next = DEFAULT_TIERS[order[i]]
      expect(next.minWidthPx).toBeGreaterThan(prev.minWidthPx)
      expect(next.minHeightPx).toBeGreaterThan(prev.minHeightPx)
    }
  })
})
