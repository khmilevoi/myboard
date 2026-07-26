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
  // Fixed by raising `defaultSize` (not lowering the tier thresholds, which
  // would change tier-resolution semantics for anyone who has already resized
  // the widget).
  //
  // Raised again once `tiers.standard` was corrected to the 300px StandardTier
  // actually needs: at `{ w: 4, h: 6 }` the tier resolved but the card clipped
  // its action row, so the default footprint had to clear the honest threshold.
  //
  // The pixel footprint follows from React Grid Layout's
  // `colWidth = (containerWidth - margin[0] * (cols - 1) - containerPadding[0] * 2) / cols`
  // (`containerPadding` defaults to `margin`) at `cols: 12`, `rowHeight: 30`,
  // `margin: [10, 10]`: a `{ w: 4, h: 8 }` card spans `colWidth * 4 + 3 * 10`
  // by `30 * 8 + 7 * 10`. The 413x310 pinned below is that footprint at a
  // 1280px *container*, which is what the board used to report on every screen
  // before it started measuring its container for real.
  //
  // The container is not the viewport: the board subtracts its own 20px padding
  // on each side plus the stable scrollbar gutter, so a 1280px viewport is only
  // a 1225px container. There the card spans ~395x310, and the element actually
  // measured for the tier is the frame inside the card's 1px border — ~393x308.
  // The height clears `minHeightPx: 300`, but the width is below this widget's
  // own `minWidthPx: 400`, so at a 1280px viewport it resolves to `compact`, not
  // `standard`; `standard` needs a viewport of roughly 1301px or wider, which is
  // why e2e/ofelia-duty.spec.ts declares one.
  it('resolves to the standard tier at the widget default-placement footprint', () => {
    const defaultFootprintPx = { width: 413, height: 310 }

    expect(resolveTier(defaultFootprintPx, ofeliaWidget.tiers!)).toBe('standard')
  })

  // The threshold exists to keep StandardTier out of cards it would overflow:
  // the widget card clips, so a tier that does not fit is a truncated tier.
  it('falls back to compact just below the standard tier height', () => {
    const tooShortForStandard = { width: 413, height: 299 }

    expect(resolveTier(tooShortForStandard, ofeliaWidget.tiers!)).toBe('compact')
  })

  // The dynamic import below pulls the whole UI chunk plus the Temporal
  // polyfill; under a full-workspace `pnpm -r test` run the machine is busy
  // enough that it can exceed vitest's default 5s per-test timeout.
  it(
    'loads the component when the browser has no native Temporal',
    { timeout: 30_000 },
    async () => {
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
    },
  )
})
