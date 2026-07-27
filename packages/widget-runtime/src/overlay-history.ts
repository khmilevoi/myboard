/**
 * Mirrors open overlays onto browser history entries so the platform back
 * gesture collapses the topmost one instead of leaving the application.
 *
 * Browser history is the single source of truth here. Every close path — a
 * close control, Esc, a backdrop click, the OS gesture — turns into
 * `history.back()`, and the `popstate` listener below is the only code that
 * ever invokes an overlay's `close`. Closing directly AND keeping history in
 * sync would maintain two truths that diverge on the first double-back.
 *
 * Reconciliation is by depth rather than "pop one", so two fast back presses
 * and a `history.go(-3)` both resolve correctly instead of stranding an
 * overlay open.
 *
 * `pushState` is called with the current URL, so nothing observable changes:
 * no address bar update, no router involvement, no interaction with the PWA
 * start_url or the service worker.
 */
export type OverlayEntry = { depth: number; close: () => void }

type OverlayHistoryState = { overlayDepth?: number } | null

const stack: OverlayEntry[] = []
let listening = false

const readDepth = (): number => (history.state as OverlayHistoryState)?.overlayDepth ?? 0

const reconcile = (): void => {
  const depth = readDepth()
  while (stack.length > 0 && (stack.at(-1)?.depth ?? 0) > depth) {
    stack.pop()?.close()
  }
}

// Installed lazily rather than at import time, so importing this module has no
// side effect on a document that never opens an overlay — and so a standalone
// widget harness gets the behavior without wiring anything up.
const ensureListening = (): void => {
  if (listening) return
  listening = true
  // A reload with an overlay open leaves a marked entry that no live overlay
  // corresponds to. Without this the first back press afterwards is consumed
  // doing nothing.
  if (readDepth() !== 0) history.replaceState({ ...history.state, overlayDepth: 0 }, '')
  window.addEventListener('popstate', reconcile)
}

export const pushOverlay = (close: () => void): OverlayEntry => {
  ensureListening()
  const entry = { depth: stack.length + 1, close }
  history.pushState({ ...history.state, overlayDepth: entry.depth }, '')
  stack.push(entry)
  return entry
}

/** A close request from the UI — a close control, Esc, a backdrop click. */
export const dismissOverlay = (entry: OverlayEntry): void => {
  if (!stack.includes(entry)) return
  history.back()
}

/**
 * The overlay went away outside the history flow: unmounted, or its owner set
 * `open` to false. Hands the history entry back.
 *
 * The `indexOf` guard carries the load in the common case. When the user
 * presses back, `popstate` has already unregistered the entry and called
 * `close`; React then unmounts and the effect cleanup lands here with an entry
 * that is no longer in the stack, and the early return keeps that path from
 * spending a second history entry.
 *
 * Since browser history is a stack, dropping an entry in the middle also
 * removes everything above it — they share the same history entries. The hop
 * distance must account for that: `steps = stack.length - index` removes the
 * entry and all overlays deeper in the stack. `reconcile()` then closes them
 * via the depth mismatch when `popstate` fires, preserving the module's
 * invariant that only `popstate` invokes an overlay's `close`.
 */
export const dropOverlay = (entry: OverlayEntry): void => {
  const index = stack.indexOf(entry)
  if (index < 0) return
  const steps = stack.length - index
  stack.splice(index, 1)
  history.go(-steps)
}

/**
 * Test-only: returns the module to its pre-import state.
 *
 * It must clear `listening` as well as the stack, not just the stack. The
 * one-time start-up work — dropping a depth left in history by a reload — runs
 * behind that flag, so a test file whose earlier cases already pushed would
 * otherwise never be able to reach it. Removing the listener at the same time
 * keeps the re-install from stacking a second reconciler on the window.
 */
export const resetOverlayHistory = (): void => {
  stack.length = 0
  window.removeEventListener('popstate', reconcile)
  listening = false
}
