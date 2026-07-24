import { useEffect, useRef } from 'react'
import type { RefObject } from 'react'

const FOCUSABLE_SELECTOR =
  'button:not([disabled]), [href], input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])'

/**
 * Self-contained modal behavior for a portal that may sit above Radix layers
 * the widget cannot patch (e.g. the board's fullscreen dialog):
 * - capture-phase Esc on document closes ONLY this modal (stopPropagation
 *   keeps Radix's bubble-phase escape handler from ever seeing the key);
 * - pointerdown/focusin born inside the modal stop propagating, so underlying
 *   DismissableLayer/FocusScope document listeners never queue their deferred
 *   outside-dismiss checks (the nested-dialog dismiss race cannot start);
 * - Tab cycles within the modal; focus moves in on mount and returns to the
 *   previously focused element on unmount.
 */
export function useModalIsolation(rootRef: RefObject<HTMLElement | null>, onClose: () => void) {
  const onCloseRef = useRef(onClose)
  onCloseRef.current = onClose

  useEffect(() => {
    const root = rootRef.current
    if (!root) return

    const previouslyFocused =
      document.activeElement instanceof HTMLElement ? document.activeElement : null

    const focusables = () => Array.from(root.querySelectorAll<HTMLElement>(FOCUSABLE_SELECTOR))

    const stop = (event: Event) => event.stopPropagation()
    root.addEventListener('pointerdown', stop)
    root.addEventListener('focusin', stop)

    focusables()[0]?.focus()

    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        event.preventDefault()
        event.stopPropagation()
        onCloseRef.current()
        return
      }
      if (event.key !== 'Tab') return
      const items = focusables()
      const first = items[0]
      const last = items[items.length - 1]
      if (!first || !last) return
      const active = document.activeElement
      if (event.shiftKey && (active === first || !root.contains(active))) {
        event.preventDefault()
        last.focus()
        return
      }
      if (!event.shiftKey && (active === last || !root.contains(active))) {
        event.preventDefault()
        first.focus()
      }
    }
    document.addEventListener('keydown', onKeyDown, true)

    return () => {
      document.removeEventListener('keydown', onKeyDown, true)
      root.removeEventListener('pointerdown', stop)
      root.removeEventListener('focusin', stop)
      previouslyFocused?.focus()
    }
  }, [rootRef])
}
