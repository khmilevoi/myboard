import * as errore from 'errore'

import type { TierConfig } from '@/widget-host/model/tier'
import type { WidgetLoader } from '@/widget-host/model/types'

export type WidgetIconName = 'Clock' | 'CalendarDays' | 'Cat'

export type WidgetType = {
  id: string
  title: string
  /** One-line catalog/overlay subtitle. */
  description: string
  loadComponent: WidgetLoader
  defaultSize: { w: number; h: number; minW?: number; minH?: number }
  /** Optional per-type tier thresholds; falls back to DEFAULT_TIERS. */
  tiers?: TierConfig
  /** lucide-react icon name used in the catalog menu. */
  icon: WidgetIconName
}

export class UnknownWidgetTypeError extends errore.createTaggedError({
  name: 'UnknownWidgetTypeError',
  message: 'Unknown widget type: $typeId',
}) {}

export const widgetTypes: WidgetType[] = [
  {
    id: 'clock',
    title: 'Часы',
    description: 'Текущее время и дата',
    loadComponent: () =>
      import('widgets/clock/ui/Clock').then((mod) => ({
        default: mod.Clock,
      })),
    defaultSize: { w: 3, h: 4, minW: 2, minH: 2 },
    icon: 'Clock',
  },
  {
    id: 'ofelia-poop-duty',
    title: 'Лоток Офелии',
    description: 'Чья сегодня очередь убирать',
    loadComponent: () =>
      import('widgets/ofelia-poop-duty/ui/OfeliaPoopDuty').then((mod) => ({
        default: mod.OfeliaPoopDuty,
      })),
    defaultSize: { w: 3, h: 5, minW: 2, minH: 3 },
    icon: 'Cat',
    tiers: {
      tiny: { minWidthPx: 0, minHeightPx: 0 },
      compact: { minWidthPx: 200, minHeightPx: 200 },
      standard: { minWidthPx: 400, minHeightPx: 200 },
      large: { minWidthPx: 500, minHeightPx: 400 },
    },
  },
]

export function findWidgetType(typeId: string): UnknownWidgetTypeError | WidgetType {
  const type = widgetTypes.find((item) => item.id === typeId)
  if (!type) return new UnknownWidgetTypeError({ typeId })
  return type
}
