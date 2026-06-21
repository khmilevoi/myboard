export type WidgetTier = 'tiny' | 'compact' | 'standard' | 'large' | 'fullscreen'

export type TierThreshold = { minW: number; minH: number }

// Thresholds are defined in grid units. The fullscreen tier is assigned explicitly.
export type TierConfig = {
  tiny: TierThreshold
  compact: TierThreshold
  standard: TierThreshold
  large: TierThreshold
}

export const DEFAULT_TIERS: TierConfig = {
  tiny: { minW: 1, minH: 1 },
  compact: { minW: 2, minH: 3 },
  standard: { minW: 3, minH: 5 },
  large: { minW: 5, minH: 7 },
}

const RESOLVE_ORDER = ['large', 'standard', 'compact'] as const

export function resolveTier(size: { w: number; h: number }, config: TierConfig): WidgetTier {
  for (const tier of RESOLVE_ORDER) {
    const threshold = config[tier]
    if (size.w >= threshold.minW && size.h >= threshold.minH) return tier
  }

  return 'tiny'
}
