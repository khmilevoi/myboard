import { catsModule } from 'module-cats'
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

export const catsWidget = defineWidgetClient({
  title: 'Кошки',
  description: 'Профиль, вес и цель каждой кошки',
  defaultSize: { w: 4, h: 8, minW: 2, minH: 3 },
  icon: 'PawPrint',
  modules: [catsModule],
  tiers: {
    tiny: { minWidthPx: 0, minHeightPx: 0 },
    compact: { minWidthPx: 181, minHeightPx: 120 },
    standard: { minWidthPx: 321, minHeightPx: 300 },
    large: { minWidthPx: 561, minHeightPx: 420 },
  },
  loadComponent: async () => {
    await ensureTemporal()
    const { Cats } = await import('./ui/Cats')
    return { default: Cats }
  },
})

export default catsWidget
