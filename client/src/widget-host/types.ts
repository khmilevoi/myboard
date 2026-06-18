import type { ComponentType } from 'react'
import type { ResolvedTheme } from '../shared/theme/types'

export type WidgetMode = 'small' | 'large'

export type WidgetRuntimeProps = {
  instanceId: string
  typeId: string
  mode: WidgetMode
  theme: ResolvedTheme
  requestFullscreen: () => void
  requestClose: () => void
  reportError: (error: Error) => void
}

export type WidgetComponent = ComponentType<WidgetRuntimeProps>
export type WidgetComponentModule = { default: WidgetComponent }
export type WidgetLoader = () => Promise<WidgetComponentModule>
