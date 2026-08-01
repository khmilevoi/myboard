import { defineWidgetClient } from 'widget-sdk/define-widget-client'

import type { PassportCheckerEvents } from './types'

export const passportCheckerWidget = defineWidgetClient<PassportCheckerEvents>({
  title: 'Паспорт',
  description: 'Проверка статуса паспорта',
  // h3/w3 is the smallest desktop footprint that keeps Tiny's status,
  // management controls, timestamp, and refresh action visible together.
  defaultSize: { w: 3, h: 3, minW: 3, minH: 3 },
  icon: 'IdCard',
  tiers: {
    tiny: { minWidthPx: 0, minHeightPx: 0 },
    compact: { minWidthPx: 0, minHeightPx: 280 },
    // Two full document banners need more vertical room than the default
    // board placement provides. Keep the compact summary until the card can
    // show both messages without crowding the action below them.
    standard: { minWidthPx: 321, minHeightPx: 400 },
    large: { minWidthPx: 321, minHeightPx: 400 },
  },
  loadComponent: () =>
    import('./ui/PassportChecker').then(({ PassportChecker }) => ({ default: PassportChecker })),
})

export default passportCheckerWidget
