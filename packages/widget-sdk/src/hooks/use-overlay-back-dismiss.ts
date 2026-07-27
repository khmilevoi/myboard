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
 * StrictMode runs this effect mount → cleanup → mount, so the runtime sees
 * push → drop → push in one synchronous task. That still registers exactly one
 * entry, but not because the drop and the push cancel out as navigations: a
 * drop does not navigate at all. It records the depth history owes back and
 * schedules the traversal, and the push that follows in the same task reuses
 * that owed entry instead of pushing a new one — a `replaceState`, no
 * traversal. Issuing the drop's `history.back()` eagerly would be the bug: a
 * real browser performs it tens of milliseconds later, after the second push,
 * and the resulting `popstate` would close the overlay on its own. See the
 * header of `overlay-history.ts`.
 *
 * The cleanup is still what makes the count come out right — pushing without
 * dropping would take two back presses to close.
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
