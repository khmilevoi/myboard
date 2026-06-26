import * as errore from 'errore'

import type { TierConfig } from '@/widget-host/model/tier'
import type { WidgetComponentModule, WidgetLoader } from '@/widget-host/model/types'

export type WidgetIconName = 'Clock' | 'CalendarDays' | 'Cat'

export type WidgetType = {
  id: string
  title: string
  /** One-line catalog/overlay subtitle. */
  description: string
  loadComponent: WidgetLoader
  preloadComponent?: () => void
  defaultSize: { w: number; h: number }
  /** Optional per-type tier thresholds; falls back to DEFAULT_TIERS. */
  tiers?: TierConfig
  /** lucide-react icon name used in the catalog menu. */
  icon: WidgetIconName
}

export class UnknownWidgetTypeError extends errore.createTaggedError({
  name: 'UnknownWidgetTypeError',
  message: 'Unknown widget type: $typeId',
}) {}

type IdleDeadline = {
  didTimeout: boolean
  timeRemaining: () => number
}

type WindowWithIdleCallback = Window & {
  requestIdleCallback?: (callback: (deadline: IdleDeadline) => void, options?: { timeout: number }) => number
}

function createLazyWidgetLoader(loader: WidgetLoader) {
  let pending: Promise<WidgetComponentModule> | null = null

  const loadComponent = () => {
    pending ??= loader().catch((error: unknown) => {
      pending = null
      throw error
    })
    return pending
  }

  return {
    loadComponent,
    preloadComponent() {
      void loadComponent().catch((error: unknown) => {
        console.warn('Widget chunk preload failed:', error)
      })
    },
  }
}

export const widgetTypes: WidgetType[] = [
  {
    id: 'clock',
    title: 'Часы',
    description: 'Текущее время и дата',
    ...createLazyWidgetLoader(() =>
      import('widgets/clock/ui/Clock').then((mod) => ({
        default: mod.Clock,
      })),
    ),
    defaultSize: { w: 3, h: 4 },
    icon: 'Clock',
  },
  {
    id: 'ofelia-poop-duty',
    title: 'Лоток Офелии',
    description: 'Чья сегодня очередь убирать',
    ...createLazyWidgetLoader(() =>
      import('widgets/ofelia-poop-duty/ui/OfeliaPoopDuty').then((mod) => ({
        default: mod.OfeliaPoopDuty,
      })),
    ),
    defaultSize: { w: 3, h: 5 },
    icon: 'Cat',
    tiers: {
      tiny: { minWidthPx: 0, minHeightPx: 0 },
      compact: { minWidthPx: 200, minHeightPx: 200 },
      standard: { minWidthPx: 400, minHeightPx: 200 },
      large: { minWidthPx: 500, minHeightPx: 400 },
    },
  },
]

export function preloadWidgetChunks() {
  if (typeof window === 'undefined') return

  const preload = () => {
    for (const type of widgetTypes) {
      type.preloadComponent?.()
    }
  }

  const idleWindow = window as WindowWithIdleCallback
  if (idleWindow.requestIdleCallback) {
    idleWindow.requestIdleCallback(preload, { timeout: 3000 })
    return
  }

  window.setTimeout(preload, 1500)
}

export function findWidgetType(typeId: string): UnknownWidgetTypeError | WidgetType {
  const type = widgetTypes.find((item) => item.id === typeId)
  if (!type) return new UnknownWidgetTypeError({ typeId })
  return type
}
