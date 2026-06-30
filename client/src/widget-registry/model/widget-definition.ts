import type { WidgetEventMap } from '@shared/widgets/contracts'

import type { TierConfig } from '@widget-runtime/tier'
import type { WidgetComponentModule, WidgetLoader } from '@widget-runtime/types'

export type WidgetIconName = 'Clock' | 'CalendarDays' | 'Cat'

export type WidgetMetadata = {
  id: string
  title: string
  description: string
  defaultSize: { w: number; h: number; minW?: number; minH?: number }
  tiers?: TierConfig
  icon: WidgetIconName
}

export type WidgetClientDefinition<Events extends WidgetEventMap> = WidgetMetadata & {
  loadComponent: WidgetLoader<Events>
}

export type WidgetType = WidgetMetadata & {
  loadComponent: WidgetLoader
  preloadComponent?: () => void
}

export function defineWidgetClient<const Events extends WidgetEventMap>(
  definition: WidgetClientDefinition<Events>,
): WidgetClientDefinition<Events> {
  return definition
}

export function toWidgetType<const Events extends WidgetEventMap>(
  definition: WidgetClientDefinition<Events>,
): WidgetType {
  let pending: Promise<WidgetComponentModule> | null = null
  const loader = definition.loadComponent as unknown as WidgetLoader
  const loadComponent = () => {
    pending ??= loader().catch((error: unknown) => {
      pending = null
      throw error
    })
    return pending
  }

  return {
    ...definition,
    loadComponent,
    preloadComponent() {
      void loadComponent().catch((error: unknown) => {
        console.warn('Widget chunk preload failed:', error)
      })
    },
  }
}
