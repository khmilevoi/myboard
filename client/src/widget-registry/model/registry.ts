import * as errore from 'errore'

import { clockWidget } from '@widgets/clock/client'
import { ofeliaWidget } from '@widgets/ofelia-poop-duty/client'

export { type WidgetIconName, type WidgetType } from './widget-definition'
import { toWidgetType, type WidgetType } from './widget-definition'

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

export const widgetTypes: WidgetType[] = [
  toWidgetType(clockWidget),
  toWidgetType(ofeliaWidget),
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
