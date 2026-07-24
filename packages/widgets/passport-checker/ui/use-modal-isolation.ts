import { useEffect, useRef } from 'react'
import type { RefObject } from 'react'

const FOCUSABLE_SELECTOR =
  'button:not([disabled]), [href], input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])'

/**
 * Self-contained modal behavior for a portal that may sit above a MODAL Radix
 * layer the widget cannot patch (e.g. the board's fullscreen dialog). Radix's
 * DismissableLayer/FocusScope/useEscapeKeydown attach their listeners to
 * `document`, so we neutralize each axis from OUTSIDE that document boundary,
 * on `window` in the capture phase — the very first stop of the capture path,
 * which runs before any document-capture listener Radix registered:
 * - window-capture Esc closes ONLY this modal. `stopPropagation()` there runs
 *   before Radix's own capture-phase `useEscapeKeydown` document listener, so
 *   the underlying dialog never sees the key and cannot also dismiss.
 * - window-capture `focusout` guard: a focusout born INSIDE the underlying
 *   Radix tree (fired as focus moves INTO our modal) is swallowed when its
 *   `relatedTarget` lands inside our root, so Radix's trapped FocusScope never
 *   yanks focus back out of the modal.
 * - `root` IS the backdrop overlay (the dialog panel is a child), so backdrop
 *   dismissal lives in the native `pointerdown` stopper: any press stops
 *   propagating, and a press that STARTS on the overlay itself (never on the
 *   panel) closes — press-based, matching Radix, so a drag-select that ends
 *   over the backdrop does not close.
 * - `focusin` born inside the modal stops propagating so underlying document
 *   listeners never queue deferred outside-dismiss checks.
 * - Tab cycles within the modal; focus moves in on mount and returns to the
 *   previously focused element on unmount.
 *
 * The overlay also needs `pointer-events: auto` in CSS: a Radix modal layer
 * sets `pointer-events: none` on document.body, which the overlay inherits.
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
    const onPointerDown = (event: Event) => {
      event.stopPropagation()
      if (event.target === root) onCloseRef.current()
    }
    root.addEventListener('pointerdown', onPointerDown)
    root.addEventListener('focusin', stop)

    focusables()[0]?.focus()

    const onFocusOut = (event: FocusEvent) => {
      const related = event.relatedTarget
      if (related instanceof Node && root.contains(related)) event.stopPropagation()
    }
    window.addEventListener('focusout', onFocusOut, true)

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
    window.addEventListener('keydown', onKeyDown, true)

    return () => {
      window.removeEventListener('keydown', onKeyDown, true)
      window.removeEventListener('focusout', onFocusOut, true)
      root.removeEventListener('pointerdown', onPointerDown)
      root.removeEventListener('focusin', stop)
      previouslyFocused?.focus()
    }
  }, [rootRef])
}
