import { useCallback, useRef, useState } from 'react'

import { observeElementSize, type ElementSize } from './element-size-observer'

export type UseElementSizeResult = ElementSize & { ref: (element: Element | null) => void }

export function useElementSize(): UseElementSizeResult {
  const [size, setSize] = useState<ElementSize>({ width: 0, height: 0 })
  const stopRef = useRef<(() => void) | null>(null)

  const ref = useCallback((element: Element | null) => {
    stopRef.current?.()
    stopRef.current = null

    if (!element) return

    const rect = element.getBoundingClientRect()
    setSize({ width: rect.width, height: rect.height })
    stopRef.current = observeElementSize(element, setSize)
  }, [])

  return { ...size, ref }
}
