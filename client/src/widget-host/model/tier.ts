export type WidgetTier = 'tiny' | 'compact' | 'standard' | 'large' | 'fullscreen'

export type TierThreshold = { minWidthPx: number; minHeightPx: number }

// Thresholds are the widget's actual rendered size in CSS pixels, measured
// from its frame element — not grid units. Grid columns resize with the
// viewport, so a fixed column count maps to a different pixel size on every
// screen; only the rendered size is a stable signal for layout decisions.
// The fullscreen tier is assigned explicitly by the overlay.
export type TierConfig = {
  tiny: TierThreshold
  compact: TierThreshold
  standard: TierThreshold
  large: TierThreshold
}

export const DEFAULT_TIERS: TierConfig = {
  tiny: { minWidthPx: 0, minHeightPx: 0 },
  compact: { minWidthPx: 220, minHeightPx: 160 },
  standard: { minWidthPx: 320, minHeightPx: 280 },
  large: { minWidthPx: 480, minHeightPx: 420 },
}

const RESOLVE_ORDER = ['large', 'standard', 'compact'] as const

export function resolveTier(
  size: { width: number; height: number },
  config: TierConfig,
): WidgetTier {
  for (const tier of RESOLVE_ORDER) {
    const threshold = config[tier]
    if (size.width >= threshold.minWidthPx && size.height >= threshold.minHeightPx) return tier
  }

  return 'tiny'
}
