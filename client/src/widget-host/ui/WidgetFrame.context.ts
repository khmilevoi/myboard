import type { WidgetApi, WidgetEventMap } from '@shared/widgets/contracts'
import { createContext, useContext } from 'react'

import { ResolvedTheme } from '@/shared/theme/types'
import { WidgetStorage } from '@/storage/model/storage'
import type { WidgetApiError } from '@/widget-api/widget-api'

import type { WidgetTier } from '../model/tier'
import { WidgetMode } from '../model/types'

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
