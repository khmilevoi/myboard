/**
 * Mirrors open overlays onto browser history entries so the platform back
 * gesture collapses the topmost one instead of leaving the application.
 *
 * Browser history is the single source of truth here. Callers reach this
 * module through one of two shapes. A **dismiss** — Esc, a backdrop click,
 * `DialogClose`, a modal's own close button — is the UI asking for a close;
 * it routes through `dismissOverlay`, which turns the request into a history
 * traversal. A **drop** — an unmount, or an owner setting `open` to false,
 * which is what a widget's fullscreen close control and `AddWidgetMenu`'s
 * close button do — means the overlay is already gone by the time this
 * module hears about it; it routes through `dropOverlay`, which hands the
 * history entry back instead of traversing, since there is nothing left to
 * traverse to. The platform back gesture needs no such routing — it already
 * is a traversal. Whichever of the three starts it, the `popstate` listener
 * below is the only code that ever invokes an overlay's `close`: a dismiss
 * never calls it directly, and neither does a drop, because by the time
 * `dropOverlay` runs the caller has already closed the overlay itself.
 * Closing directly from here AND keeping history in sync would maintain two
 * truths that diverge on the first double-back.
 *
 * Reconciliation is by depth rather than "pop one", so two fast back presses
 * and a `history.go(-3)` both resolve correctly instead of stranding an
 * overlay open.
 *
 * ## The traversal a drop owes is deferred, and that timer is load-bearing
 *
 * A history traversal is asynchronous. Measured in real Chromium:
 * `history.go(-1)` does not move the browser synchronously — it lands roughly
 * 25-40ms later — and a `pushState` issued in the same task does **not**
 * cancel it. (jsdom does cancel it, via `clearHistoryTraversalTasks()`; the
 * two disagree, so unit tests alone cannot see this.)
 *
 * Traversing eagerly therefore breaks the one sequence React produces all the
 * time: a drop immediately followed by a push, in a single synchronous task.
 * `StrictMode` does it on every overlay mount (mount → cleanup → mount), and
 * so does any state change that closes one overlay and opens another in the
 * same commit. The pending traversal would fire *after* the new entry was
 * pushed, roll the browser back past it to the pre-overlay entry, and hand the
 * application a spontaneous `popstate` at depth 0 — which reconciles as "close
 * the overlay that opened 30ms ago". The user sees a dialog flash and vanish.
 *
 * So `dropOverlay` does not traverse; it records the depth history must end up
 * on and schedules a flush on the next task. A `pushOverlay` arriving before
 * that flush reuses one of the entries the drop still owes back instead of
 * pushing another one. Drop-then-push nets exactly one entry and issues no
 * traversal at all, so there is no spontaneous `popstate` to misread. A drop
 * with nothing behind it flushes on its scheduled task and traverses exactly
 * as an eager one would.
 *
 * Do not "simplify" the scheduling away — the deferral *is* the fix, and no
 * test that fakes `popstate` instead of driving a real navigation can catch
 * its removal.
 *
 * `pushState` is called with the current URL, so nothing observable changes:
 * no address bar update, no router involvement, no interaction with the PWA
 * start_url or the service worker.
 */
export type OverlayEntry = { depth: number; close: () => void }

type OverlayHistoryState = { overlayDepth?: number } | null

const stack: OverlayEntry[] = []
let listening = false

/**
 * The depth the deferred traversal must land on, or `null` when nothing is
 * owed — plus the handle of the task that will perform it.
 *
 * A target depth rather than a step count, because targets compose and steps
 * do not: two drops in the same task each name the entry they want history to
 * end up on and the lower one wins, where adding their step counts would
 * traverse past the pre-overlay entry and out of the application.
 */
let owedDepth: number | null = null
let owedFlush: ReturnType<typeof setTimeout> | null = null

const readDepth = (): number => (history.state as OverlayHistoryState)?.overlayDepth ?? 0

/**
 * Closes every overlay that history no longer backs.
 *
 * The `stack.length > depth` clause catches what the depth comparison alone
 * misses. Coalescing can transiently leave two entries carrying the same
 * depth: a mid-stack drop leaves the overlays above it in the stack until its
 * traversal lands, and a push that reuses an owed entry claims a depth from
 * below them. Popping by depth alone would stop at the first duplicate and
 * strand the stale ones. Settled, `stack.length` always equals the top entry's
 * depth, so the clause is inert in every ordinary case.
 */
const reconcile = (): void => {
  const depth = readDepth()
  while (stack.length > 0 && (stack.length > depth || (stack.at(-1)?.depth ?? 0) > depth)) {
    stack.pop()?.close()
  }
}

const clearOwedTraversal = (): void => {
  owedDepth = null
  if (owedFlush !== null) clearTimeout(owedFlush)
  owedFlush = null
}

/** Performs the traversal a drop owes, if a push has not already claimed it. */
const flushOwedTraversal = (): void => {
  const target = owedDepth
  clearOwedTraversal()
  if (target === null) return
  // Recomputed from live history rather than accumulated, so a back press that
  // arrived first simply leaves nothing to do.
  const steps = readDepth() - target
  if (steps > 0) history.go(-steps)
}

const oweTraversalTo = (target: number): void => {
  owedDepth = owedDepth === null ? target : Math.min(owedDepth, target)
  owedFlush ??= setTimeout(flushOwedTraversal, 0)
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

  // A back press that beat the flush already settled the debt.
  if (owedDepth !== null && owedDepth >= readDepth()) clearOwedTraversal()

  if (owedDepth !== null) {
    // Claim an entry the deferred traversal still owes back instead of pushing
    // another one. Nothing is written to history at all — no `pushState`, no
    // `replaceState`, no traversal — because that entry already exists and
    // already carries this `overlayDepth`, stamped when the overlay now being
    // dropped was pushed. Only the bookkeeping moves.
    //
    // The depth therefore comes from the debt, never from the stack: an
    // overlay above a mid-stack drop is still sitting in the stack waiting to
    // be closed, so `stack.length + 1` would hand out a depth it already holds.
    const entry = { depth: owedDepth + 1, close }
    // Inserted at its depth, not appended, so the stack stays ordered by depth
    // and `reconcile` still pops the stale entries above it first.
    stack.splice(owedDepth, 0, entry)
    // The guard above leaves `owedDepth < readDepth()`, so the claimed depth is
    // at most the current one. Equal means the claimed entry is the one we are
    // standing on and the debt is spent; less means the traversal still has to
    // walk back to it.
    if (entry.depth === readDepth()) clearOwedTraversal()
    else owedDepth = entry.depth
    return entry
  }

  // `pushState` inserts its entry immediately after the current one, so the new
  // overlay's depth is the current depth plus one by construction — not by
  // counting the stack. The two agree whenever history and the stack agree, and
  // stop agreeing in exactly the duplicate-depth mode described on
  // `dropOverlay`, where `stack.length + 1` would skip a number. Depth would
  // then no longer be one-per-entry, and `flushOwedTraversal`'s
  // `readDepth() - target` — which counts entries — would traverse too far.
  const entry = { depth: readDepth() + 1, close }
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
 * removes everything above it — they share the same history entries. The index
 * of the dropped entry is therefore exactly the depth history must land on: it
 * counts the overlays that survive below, and `reconcile` closes the rest from
 * the depth mismatch when `popstate` fires, preserving the module's invariant
 * that only `popstate` invokes an overlay's `close`.
 *
 * The traversal itself is owed, not performed. It is scheduled on the next
 * task so that a `pushOverlay` in this same task can consume it — see the
 * module header for why performing it here breaks StrictMode and every
 * close-one-open-another transition.
 *
 * ## Residuals and constraints, needing care from callers
 *
 * None of these are fixable from inside this module while `popstate` is the
 * only code allowed to close an overlay, so they are documented as
 * constraints on callers:
 *
 * - **Do not mount two overlays in the same commit as a middle drop.** Such a
 *   drop owes more than one entry, and two pushes consume the whole debt
 *   between them, so no traversal runs and the overlay that sat above the drop
 *   stays open carrying a depth that duplicates the new top one's. It is not
 *   stranded — the `stack.length > depth` clause in `reconcile` closes it on
 *   the next back press, one press later than it should have — but a caller
 *   that mounts one overlay per commit never reaches this at all.
 * - `dropOverlay` and `dismissOverlay` in the same task overshoot.
 *   `dismissOverlay` navigates eagerly, and the flush then recomputes its step
 *   count against a history that has not moved yet, so the two traversals
 *   stack and land further back than either intended — far enough, with enough
 *   overlays open, to leave the application. This predates the deferral: an
 *   eager `dropOverlay` had the same overshoot against an eager dismiss.
 * - **A push landing while a flush's own traversal is in flight reads a stale
 *   depth.** `flushOwedTraversal` clears the debt and calls `history.go`
 *   before that call resolves — the traversal it issues is itself
 *   asynchronous, landing roughly 25-40ms later (see the module header). A
 *   `pushOverlay` inside that window sees no debt left to claim, so it derives
 *   its depth from `readDepth()`, which still reflects the pre-traversal state
 *   until the pending `popstate` lands. This is the same race the deferral
 *   exists to avoid, recurring one level later — in the flush's own
 *   asynchronous traversal instead of an eager one — and bookkeeping cannot
 *   close it, because the module has no signal for "a traversal is currently
 *   in flight", only for depths still owed. Unreachable at human speed and by
 *   any current call site: nothing today spans the gap between a flush firing
 *   and its `popstate` landing.
 * - **A dismiss cannot be vetoed by its caller.** `dismissOverlay` calls
 *   `history.back()` unconditionally once the entry is in the stack, and
 *   `reconcile` pops it and invokes `close` as soon as the resulting
 *   `popstate` arrives — before the owner gets a say. A caller implementing
 *   "confirm before closing", who leaves its own state untouched inside
 *   `close` (e.g. an `onOpenChange(false)` that shows a confirmation instead
 *   of actually closing), finds the history entry already gone: the overlay
 *   stays mounted with nothing behind it in history, and from then on neither
 *   the back gesture nor its own close control does anything, because both
 *   `dismissOverlay` and `dropOverlay` return silently once
 *   `stack.includes(entry)` is false. A close request routed through this
 *   module cannot be vetoed; by the time the owner learns of it, the entry is
 *   gone.
 */
export const dropOverlay = (entry: OverlayEntry): void => {
  const index = stack.indexOf(entry)
  if (index < 0) return
  stack.splice(index, 1)
  oweTraversalTo(index)
}

/**
 * Test-only: returns the module to its pre-import state.
 *
 * It must clear `listening` as well as the stack, not just the stack. The
 * one-time start-up work — dropping a depth left in history by a reload — runs
 * behind that flag, so a test file whose earlier cases already pushed would
 * otherwise never be able to reach it. Removing the listener at the same time
 * keeps the re-install from stacking a second reconciler on the window.
 *
 * Clearing the owed traversal matters just as much: a scheduled flush left
 * behind would fire a real `history.go` in the middle of the next test.
 */
export const resetOverlayHistory = (): void => {
  stack.length = 0
  clearOwedTraversal()
  window.removeEventListener('popstate', reconcile)
  listening = false
}
