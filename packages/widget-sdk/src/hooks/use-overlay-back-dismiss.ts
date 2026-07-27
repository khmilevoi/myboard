import { useCallback, useEffect, useRef } from 'react'
import { dismissOverlay, dropOverlay, pushOverlay, type OverlayEntry } from 'widget-runtime'

/**
 * Registers an open overlay on the browser's history stack and returns the
 * dismiss callback every close path must go through.
 *
 * `close` is held in a ref rather than in the effect's dependency list: it is
 * usually rebuilt on every render, and re-running the effect would push a
 * fresh history entry each time. Same shape as `useModalIsolation` in
 * passport-checker.
 *
 * StrictMode runs this effect mount → cleanup → mount, which is push → drop
 * (a `history.back()`) → push: one entry registered, and the depth the
 * listener reconciles against agrees with the live stack. The cleanup is what
 * makes that true — pushing without unregistering would take two back presses
 * to close.
 */
export const useOverlayBackDismiss = (open: boolean, close: () => void): (() => void) => {
  const closeRef = useRef(close)
  closeRef.current = close
  const entryRef = useRef<OverlayEntry | null>(null)

  useEffect(() => {
    if (!open) return

    const entry = pushOverlay(() => closeRef.current())
    entryRef.current = entry

    return () => {
      entryRef.current = null
      dropOverlay(entry)
    }
  }, [open])

  return useCallback(() => {
    const entry = entryRef.current
    if (entry) dismissOverlay(entry)
    else closeRef.current()
  }, [])
}
