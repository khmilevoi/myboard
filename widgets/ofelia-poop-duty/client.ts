import { defineWidgetClient } from '@widget-sdk/define-widget-client'

import type { OfeliaEvents } from './types'

export const ofeliaWidget = defineWidgetClient<OfeliaEvents>({
  id: 'ofelia-poop-duty',
  title: 'Лоток Офелии',
  description: 'Чья сегодня очередь убирать',
  defaultSize: { w: 3, h: 5, minW: 2, minH: 3 },
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
