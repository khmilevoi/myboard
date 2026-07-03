import type { WidgetApi, WidgetEventMap } from '@shared/widgets/contracts'
import type { ComponentType } from 'react'

import { WidgetStorage } from './storage'
import type { ResolvedTheme } from './theme'
import type { WidgetTier } from './tier'
import type { WidgetApiError } from './widget-api'

export type WidgetMode = 'small' | 'large'

export type WidgetRuntimeProps<Events extends WidgetEventMap = WidgetEventMap> = {
  instanceId: string
  typeId: string
  mode: WidgetMode
  tier: WidgetTier
  theme: ResolvedTheme
  requestFullscreen: () => void
  requestClose: () => void
  requestDelete: () => void
  reportError: (error: Error) => void
  storage: WidgetStorage
  api: WidgetApi<Events, WidgetApiError>
}

declare const widgetEvents: unique symbol

export type WidgetComponent<Events extends WidgetEventMap = WidgetEventMap> = ComponentType & {
  readonly [widgetEvents]?: Events
}
export type WidgetComponentModule<Events extends WidgetEventMap = WidgetEventMap> = {
  default: WidgetComponent<Events>
}
export type WidgetLoader<Events extends WidgetEventMap = WidgetEventMap> = () => Promise<
  WidgetComponentModule<Events>
>
