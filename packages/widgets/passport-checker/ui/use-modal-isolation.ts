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
 * - window-capture `focusout` guard: any focusout whose `relatedTarget` lands
 *   inside our root is swallowed, so Radix's trapped FocusScope never yanks
 *   focus out of the modal. The guard deliberately does NOT also require the
 *   event's target to be outside the root: Radix's `handleFocusOut` inspects
 *   only `relatedTarget`, so a focus move BETWEEN two of our own controls has
 *   both endpoints outside its container and would make it reclaim focus.
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

    // Focus containment. Radix's FocusScope restores focus on unmount from a
    // setTimeout(…, 0), so collapsing the board's fullscreen dialog to show
    // this modal would otherwise hand focus to the board one tick after we
    // mounted. Pull it back instead. No ping-pong with a Radix layer beneath:
    // focusin raised inside the modal is stopped at the root below and never
    // reaches document, so its FocusScope never sees our focus.
    const onFocusIn = (event: FocusEvent) => {
      const target = event.target
      if (target instanceof Node && root.contains(target)) return
      focusables()[0]?.focus()
    }
    window.addEventListener('focusin', onFocusIn, true)

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
      window.removeEventListener('focusin', onFocusIn, true)
      root.removeEventListener('pointerdown', onPointerDown)
      root.removeEventListener('focusin', stop)
      previouslyFocused?.focus()
    }
  }, [rootRef])
}
