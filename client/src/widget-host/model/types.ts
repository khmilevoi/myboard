import type { ComponentType } from 'react'

import type { WidgetApi, WidgetEventMap } from '@shared/widgets/contracts'

import type { ResolvedTheme } from '@/shared/theme/types'
import { WidgetStorage } from '@/storage/model/storage'
import type { WidgetApiError } from '@/widget-api/widget-api'

import type { WidgetTier } from './tier'

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

export type WidgetComponent<Events extends WidgetEventMap = WidgetEventMap> = ComponentType<
  WidgetRuntimeProps<Events>
>
export type WidgetComponentModule<Events extends WidgetEventMap = WidgetEventMap> = {
  default: WidgetComponent<Events>
}
export type WidgetLoader<Events extends WidgetEventMap = WidgetEventMap> = () => Promise<
  WidgetComponentModule<Events>
>
