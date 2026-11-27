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

export const ofeliaStatsWidget = defineWidgetClient({
  title: 'Статистика лотка',
  description: 'Уборки и долги за 30 дней',
  defaultSize: { w: 3, h: 4, minW: 2, minH: 3 },
  icon: 'ChartColumn',
  modules: [catsModule],
  loadComponent: async () => {
    await ensureTemporal()
    const { OfeliaStats } = await import('./ui/OfeliaStats')
    return { default: OfeliaStats }
  },
})

export default ofeliaStatsWidget
