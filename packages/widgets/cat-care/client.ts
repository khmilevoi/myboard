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

export const catCareWidget = defineWidgetClient({
  title: 'Питание кошки',
  description: 'Еда, вода и вес — дневник заботы о кошке',
  defaultSize: { w: 5, h: 8, minW: 2, minH: 3 },
  icon: 'Cat',
  tiers: {
    tiny: { minWidthPx: 0, minHeightPx: 0 },
    compact: { minWidthPx: 220, minHeightPx: 170 },
    standard: { minWidthPx: 380, minHeightPx: 290 },
    large: { minWidthPx: 520, minHeightPx: 390 },
  },
  loadComponent: async () => {
    await ensureTemporal()
    const { CatCare } = await import('./ui/CatCare')
    return { default: CatCare }
  },
})

export default catCareWidget
