import { defineWidgetClient } from 'widget-sdk/define-widget-client'

import type { ClockEvents } from './types'

export const clockWidget = defineWidgetClient<ClockEvents>({
  id: 'clock',
  title: 'Часы',
  description: 'Текущее время и дата',
  defaultSize: { w: 3, h: 4, minW: 2, minH: 2 },
  icon: 'Clock',
  loadComponent: () => import('./ui/Clock').then(({ Clock }) => ({ default: Clock })),
})
