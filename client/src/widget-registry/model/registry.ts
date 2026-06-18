import * as errore from 'errore'
import type { WidgetLoader } from '../../widget-host/model/types'

export type WidgetIconName = 'Clock' | 'CalendarDays'

export type WidgetType = {
  id: string
  title: string
  loadComponent: WidgetLoader
  defaultSize: { w: number; h: number }
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
    title: 'Clock',
    loadComponent: () =>
      import('../../../widgets/clock/ui/Clock').then((mod) => ({ default: mod.Clock })),
    defaultSize: { w: 3, h: 2 },
    icon: 'Clock',
  },
  {
    id: 'ofelia-poop-duty',
    title: 'Какахи Офелии',
    loadComponent: () =>
      import('../../../widgets/ofelia-poop-duty/ui/OfeliaPoopDuty').then((mod) => ({
        default: mod.OfeliaPoopDuty,
      })),
    defaultSize: { w: 3, h: 2 },
    icon: 'CalendarDays',
  },
]

export function findWidgetType(typeId: string): UnknownWidgetTypeError | WidgetType {
  const type = widgetTypes.find((item) => item.id === typeId)
  if (!type) return new UnknownWidgetTypeError({ typeId })
  return type
}
