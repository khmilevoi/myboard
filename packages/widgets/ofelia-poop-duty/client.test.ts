import { describe, expect, it } from 'vitest'
import { resolveTier } from 'widget-runtime'

import { ofeliaWidget } from './client'

describe('ofeliaWidget tiers', () => {
  // Regression test for a bug where the widget's own `defaultSize` never
  // cleared its own `tiers.standard` threshold (`{ minWidthPx: 400,
  // minHeightPx: 200 }`): with the previous `defaultSize: { w: 3, h: 5 }` a
  // freshly-placed widget was too small to satisfy it, so a newly-added widget
  // always rendered in the `tiny` tier instead of `standard`.
  //
  // Fixed by raising `defaultSize` to `{ w: 4, h: 6 }` (not by lowering the
  // tier thresholds, which would change tier-resolution semantics for anyone
  // who has already resized the widget).
  //
  // The pixel footprint follows from React Grid Layout's
  // `colWidth = (containerWidth - margin[0] * (cols - 1) - containerPadding[0] * 2) / cols`
  // (`containerPadding` defaults to `margin`) at `cols: 12`, `rowHeight: 30`,
  // `margin: [10, 10]`: a `{ w: 4, h: 6 }` card spans `colWidth * 4 + 3 * 10`
  // by `30 * 6 + 5 * 10`. The 413x230 pinned below is that footprint at a
  // 1280px *container*, which is what the board used to report on every screen.
  //
  // The container is not the viewport: the board subtracts its own 20px padding
  // on each side plus the stable scrollbar gutter, so a 1280px viewport is only
  // a 1225px container. There the card spans ~395x230 (the old `{ w: 3, h: 5 }`
  // spanned ~294x190), and the element that is actually measured for the tier is
  // the frame inside the card's 1px border — ~393x228. That is below this
  // widget's own `minWidthPx: 400`, so at a 1280px viewport it resolves to
  // `compact`, not `standard`; `standard` needs a viewport of roughly 1301px or
  // wider, which is why e2e/ofelia-duty.spec.ts declares one.
  it('resolves to the standard tier at the widget default-placement footprint', () => {
    const defaultFootprintPx = { width: 413, height: 230 }

    expect(resolveTier(defaultFootprintPx, ofeliaWidget.tiers!)).toBe('standard')
  })

  it('loads the component when the browser has no native Temporal', async () => {
    const temporalDescriptor = Object.getOwnPropertyDescriptor(globalThis, 'Temporal')

    try {
      Reflect.deleteProperty(globalThis, 'Temporal')

      const componentModule = await ofeliaWidget.loadComponent()

      expect(typeof globalThis.Temporal.PlainDate.from).toBe('function')
      expect(componentModule.default).toBeDefined()
    } finally {
      if (temporalDescriptor) {
        Object.defineProperty(globalThis, 'Temporal', temporalDescriptor)
      } else {
        Reflect.deleteProperty(globalThis, 'Temporal')
      }
    }
  })
})
