import { defineWidgetClient } from 'widget-sdk/define-widget-client'

async function ensureTemporal(): Promise<void> {
  if (typeof globalThis.Temporal !== 'undefined') return

  const { Temporal } = await import('@js-temporal/polyfill')
  Object.defineProperty(globalThis, 'Temporal', {
    configurable: true,
    writable: true,
    value: Temporal,
  })
}

export const ofeliaWidget = defineWidgetClient({
  title: 'Лоток Офелии',
  description: 'Чья сегодня очередь убирать',
  defaultSize: { w: 4, h: 8, minW: 2, minH: 3 },
  icon: 'Cat',
  tiers: {
    tiny: { minWidthPx: 0, minHeightPx: 0 },
    compact: { minWidthPx: 200, minHeightPx: 200 },
    // StandardTier lays out to 298px of content and the widget card clips
    // rather than scrolls, so a threshold below that renders a tier whose
    // action row is cut in half. The threshold states what the tier needs;
    // anything shorter degrades to `compact`, which is built to fit.
    standard: { minWidthPx: 400, minHeightPx: 300 },
    large: { minWidthPx: 500, minHeightPx: 400 },
  },
  loadComponent: async () => {
    await ensureTemporal()
    const { OfeliaPoopDuty } = await import('./ui/OfeliaPoopDuty')
    return { default: OfeliaPoopDuty }
  },
})

export default ofeliaWidget
