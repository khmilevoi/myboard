import type { ComponentType } from 'react'

import type { ResolvedTheme } from '@/shared/theme/types'
import { WidgetStorage } from '@/storage/model/storage'

import type { WidgetTier } from './tier'

export type WidgetMode = 'small' | 'large'

export type WidgetRuntimeProps = {
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
}

export type WidgetComponent = ComponentType<WidgetRuntimeProps>
export type WidgetComponentModule = { default: WidgetComponent }
export type WidgetLoader = () => Promise<WidgetComponentModule>
