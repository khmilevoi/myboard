import type { WidgetEventMap } from '@shared/widgets/contracts'
import type { TierConfig, WidgetComponentModule, WidgetLoader } from 'widget-runtime'

import { ensureSingleReatomRoot } from './reatom/ensure-single-reatom-root'

export type WidgetMetadata = {
  id: string
  title: string
  description: string
  defaultSize: { w: number; h: number; minW?: number; minH?: number }
  tiers?: TierConfig
  icon: string
}

export type WidgetClientMetadata = Omit<WidgetMetadata, 'id'>

export type WidgetClientDefinition<Events extends WidgetEventMap = WidgetEventMap> =
  WidgetClientMetadata & {
    loadComponent: WidgetLoader<Events>
  }

type WidgetTypeDefinition<Events extends WidgetEventMap> = WidgetMetadata & {
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
  definition: WidgetTypeDefinition<Events>,
): WidgetType {
  let pending: Promise<WidgetComponentModule> | null = null
  const loader = definition.loadComponent as unknown as WidgetLoader
  const loadComponent = () => {
    pending ??= loader().catch((error: unknown) => {
      pending = null
      throw error
    })
    // Never hand out the cached promise object itself: React's lazy() brands
    // resolved thenables with status/value in place, and a LATER lazy() around
    // the same branded object replays its suspended render synchronously —
    // before the microtask that would settle the new lazy payload — looping
    // forever under act()/flushSync. A derived promise is unbranded.
    return pending.then((module) => {
      // The remote's module graph is fully imported here; if its share-scope
      // negotiation fell back to a bundled @reatom/core copy, that copy's
      // import side effect just buried the host's root context. Repair the
      // shared stack before the widget's atoms are first read (React renders
      // the lazy component only after this promise resolves).
      ensureSingleReatomRoot()
      return module
    })
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
