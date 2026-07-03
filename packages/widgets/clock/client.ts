import { defineWidgetClient } from 'widget-sdk/define-widget-client'

export const clockWidget = defineWidgetClient({
  title: 'Часы',
  description: 'Текущее время и дата',
  defaultSize: { w: 3, h: 4, minW: 2, minH: 2 },
  icon: 'Clock',
  loadComponent: () => import('./ui/Clock').then(({ Clock }) => ({ default: Clock })),
})

export default clockWidget
