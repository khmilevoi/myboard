import * as errore from 'errore'

export type WidgetType = {
  id: string
  title: string
  /** URL of the widget's HTML entry, relative to the app origin. */
  entry: string
  defaultSize: { w: number; h: number }
  /** lucide-react icon name used in the catalog menu. */
  icon: string
}

export class UnknownWidgetTypeError extends errore.createTaggedError({
  name: 'UnknownWidgetTypeError',
  message: 'Unknown widget type: $typeId',
}) {}

export const widgetTypes: WidgetType[] = [
  {
    id: 'clock',
    title: 'Clock',
    entry: '/widgets/clock/index.html',
    defaultSize: { w: 3, h: 2 },
    icon: 'Clock',
  },
]

export function findWidgetType(typeId: string): UnknownWidgetTypeError | WidgetType {
  const type = widgetTypes.find((item) => item.id === typeId)
  if (!type) return new UnknownWidgetTypeError({ typeId })
  return type
}
