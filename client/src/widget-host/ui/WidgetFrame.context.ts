import type { WidgetApi, WidgetEventMap } from '@shared/widgets/contracts'
import { createContext, useContext } from 'react'

import { ResolvedTheme } from '@/shared/theme/types'
import { WidgetStorage } from '@widget-runtime/storage'
import type { WidgetApiError } from '@widget-runtime/widget-api'

import type { WidgetTier } from '@widget-runtime/tier'
import { WidgetMode } from '@widget-runtime/types'

export interface WidgetFrameContext {
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
  api: WidgetApi<WidgetEventMap, WidgetApiError>
}

export const widgetFrameContext = createContext<WidgetFrameContext | null>(null)

export const useWidgetFrameContext = () => {
  const context = useContext(widgetFrameContext)
  if (!context) throw new Error('WidgetFrameContext is not available')
  return context
}
