import * as errore from 'errore'
import type { WidgetType } from 'widget-sdk/define-widget-client'

import { widgetTypes } from './widget-catalog.generated'
import { WIDGET_ICONS, type WidgetIconName } from './widget-icons.generated'

export { widgetTypes, WIDGET_ICONS }
export type { WidgetIconName, WidgetType }

export class UnknownWidgetTypeError extends errore.createTaggedError({
  name: 'UnknownWidgetTypeError',
  message: 'Unknown widget type: $typeId',
}) {}

type IdleDeadline = {
  didTimeout: boolean
  timeRemaining: () => number
}

type WindowWithIdleCallback = Window & {
  requestIdleCallback?: (
    callback: (deadline: IdleDeadline) => void,
    options?: { timeout: number },
  ) => number
}

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
