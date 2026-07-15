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
  defaultSize: { w: 4, h: 6, minW: 2, minH: 3 },
  icon: 'Cat',
  tiers: {
    tiny: { minWidthPx: 0, minHeightPx: 0 },
    compact: { minWidthPx: 200, minHeightPx: 200 },
    standard: { minWidthPx: 400, minHeightPx: 200 },
    large: { minWidthPx: 500, minHeightPx: 400 },
  },
  loadComponent: async () => {
    await ensureTemporal()
    const { OfeliaPoopDuty } = await import('./ui/OfeliaPoopDuty')
    return { default: OfeliaPoopDuty }
  },
})

export default ofeliaWidget
