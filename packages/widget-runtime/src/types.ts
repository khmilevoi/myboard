import type { AtomLike } from '@reatom/core'
import type { WidgetApi, WidgetEventMap } from '@shared/widgets/contracts'
import type { ComponentType } from 'react'

import type { WidgetIdentity } from './identity'
import type { WidgetModules } from './modules/registry'
import { WidgetStorage } from './storage'
import type { ResolvedTheme } from './theme'
import type { WidgetTier } from './tier'
import type { WidgetApiError } from './widget-api'

export type WidgetMode = 'small' | 'large'

export type WidgetBoardAccess = {
  /** The first placed instance of `typeId` on the active board, in `instances` order; null if none. */
  firstInstanceOf(typeId: string): AtomLike<string | null>
  /** Opens that instance fullscreen; on a fullscreen card this replaces the open one. */
  expand(instanceId: string): void
}

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
  identity: WidgetIdentity
  modules: WidgetModules
  /** Host-only; harnesses leave it out. */
  board?: WidgetBoardAccess
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
