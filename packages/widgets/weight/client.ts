import { healthModule } from 'module-health'
import { defineWidgetClient } from 'widget-sdk/define-widget-client'

export const weightWidget = defineWidgetClient({
  title: 'Вес',
  description: 'Последний вес и тренд',
  defaultSize: { w: 3, h: 3, minW: 2, minH: 2 },
  icon: 'Weight',
  modules: [healthModule],
  loadComponent: async () => {
    const { Weight } = await import('./ui/Weight')
    return { default: Weight }
  },
})

export default weightWidget
