import { defineWidgetClient } from 'widget-sdk/define-widget-client'

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
  loadComponent: () =>
    import('./ui/OfeliaPoopDuty').then(({ OfeliaPoopDuty }) => ({ default: OfeliaPoopDuty })),
})

export default ofeliaWidget
