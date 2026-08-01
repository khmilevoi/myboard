import { defineWidgetClient } from 'widget-sdk/define-widget-client'

import type { PassportCheckerEvents } from './types'

export const passportCheckerWidget = defineWidgetClient<PassportCheckerEvents>({
  title: 'Паспорт',
  description: 'Проверка статуса паспорта',
  defaultSize: { w: 4, h: 4, minW: 4, minH: 4 },
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
