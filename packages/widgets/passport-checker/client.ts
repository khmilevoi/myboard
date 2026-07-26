import { defineWidgetClient } from 'widget-sdk/define-widget-client'

import type { PassportCheckerEvents } from './types'

export const passportCheckerWidget = defineWidgetClient<PassportCheckerEvents>({
  title: 'Паспорт',
  description: 'Проверка статуса паспорта',
  defaultSize: { w: 4, h: 4, minW: 2, minH: 2 },
  icon: 'IdCard',
  tiers: {
    tiny: { minWidthPx: 0, minHeightPx: 0 },
    compact: { minWidthPx: 0, minHeightPx: 0 },
    standard: { minWidthPx: 321, minHeightPx: 0 },
    large: { minWidthPx: 321, minHeightPx: 0 },
  },
  loadComponent: () =>
    import('./ui/PassportChecker').then(({ PassportChecker }) => ({ default: PassportChecker })),
})

export default passportCheckerWidget
