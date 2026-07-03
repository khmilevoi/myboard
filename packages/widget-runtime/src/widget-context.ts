import type { WidgetEventMap } from '@shared/widgets/contracts'
import { createContext, useContext } from 'react'

import type { WidgetRuntimeProps } from './types'

export const WidgetRuntimeContext = createContext<WidgetRuntimeProps | null>(null)

export function useWidgetContext<Events extends WidgetEventMap = WidgetEventMap>() {
  const context = useContext(WidgetRuntimeContext)
  if (!context) throw new Error('WidgetRuntimeContext is not available')
  return context as WidgetRuntimeProps<Events>
}
