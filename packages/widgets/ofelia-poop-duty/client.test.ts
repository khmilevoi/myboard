import { describe, expect, it } from 'vitest'
import { resolveTier } from 'widget-runtime'

import { ofeliaWidget } from './client'

describe('ofeliaWidget tiers', () => {
  // Regression test for a bug where the widget's own `defaultSize` never
  // cleared its own `tiers.standard` threshold: at the default 1280px-viewport
  // board layout (12 grid columns, 30px rowHeight), a freshly-placed widget
  // with the previous `defaultSize: { w: 3, h: 5 }` rendered at ~308x190px
  // (measured via Playwright: e2e/ofelia-duty.spec.ts), which never satisfied
  // `tiers.standard` (`{ minWidthPx: 400, minHeightPx: 200 }`) — so a newly
  // -added widget always rendered in the `tiny` tier instead of `standard`.
  //
  // Fixed by raising `defaultSize` (not lowering the tier thresholds, which
  // would change tier-resolution semantics for anyone who has already resized
  // the widget). `{ w: 4, h: 6 }` measures at ~413x230px, comfortably inside
  // `standard`.
  it('resolves to the standard tier at the widget default-placement footprint', () => {
    const defaultFootprintPx = { width: 413, height: 230 }

    expect(resolveTier(defaultFootprintPx, ofeliaWidget.tiers!)).toBe('standard')
  })
})
