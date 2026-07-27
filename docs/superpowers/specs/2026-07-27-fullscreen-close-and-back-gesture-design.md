# Fullscreen close control and back-gesture dismissal

Date: 2026-07-27
Status: approved, ready for planning
Base: `feat/widget-controls` at `b5ea2a72` (not `dev` — the base branch is not merged yet)

## Problem

A widget expanded to fullscreen on a phone is a trap: there is often no way back to the board.

Two independent causes.

**1. Two of three widgets draw no chrome in `mode === 'large'`.**

| Widget | Fullscreen chrome today |
| --- | --- |
| `clock` | none — `Clock.tsx` returns time + date and nothing else |
| `passport-checker` | none — `PassportChecker.tsx:63` destructures only `onDelete` from `useWidgetChrome()`, which yields `{ onClose }` in `large`, so `onDelete` is `undefined` and every tier renders an empty `WidgetControls` |
| `ofelia-poop-duty` | a close button, inside `RichLayout`'s own header |

`FullscreenOverlay.tsx:14-18` states the policy that produced this: "The widget itself decides what chrome (title, badge, close button, …) to draw for its fullscreen content". A widget is free to draw nothing, and two of them do.

Desktop hides the defect — `Esc` and a click on the backdrop both work. A phone has no `Esc`, and the panel is `min(900px, 92vw)` wide by `min(680px, calc(100dvh - 2rem))` tall (`FullscreenOverlay.module.css:6-15`), so "click outside" means hitting a margin a few pixels wide.

**2. The board pushes nothing onto `history`.**

`expandedInstanceId` (`board-model.ts:10`) is a plain atom; no overlay in the app touches `history`. In the installed PWA the system back gesture therefore has nothing to pop and exits the application. Expanding a widget and swiping back closes the whole board instead of collapsing the widget — the single most likely thing a phone user tries.

## Goals

- Every widget offers a visible way out of fullscreen.
- The system back gesture collapses the topmost open overlay instead of leaving the app.
- Existing overlay call sites do not change.

## Non-goals

- **View Transitions, or any new animation.** Radix already animates both directions
  (`dialog.tsx:36`, `fade` + `zoom-95`) and every close path — button, `Esc`, backdrop, back
  gesture — converges on the same state change, so all four inherit it. Considered and dropped
  deliberately.
- **A finger-following, cancellable swipe.** No web API exposes the progress of the OS back
  gesture; `popstate` reports the fact after the fact and reports nothing at all when the user
  aborts mid-swipe. Motion that tracks the finger and reverses on cancel requires the swipe to *be*
  a scroll — a scroll-snap container plus `animation-timeline: view()`, per the `stack-drill-down`
  guidance. That is a different, larger piece of work; if it is ever wanted, it layers on top of
  this one rather than replacing it.
- **Host-owned fullscreen close.** Having `FullscreenOverlay` always draw a close button would make
  the trap impossible by construction. Rejected: ofelia already draws its own in a header where a
  corner overlay would float over content, so the host version would need an opt-out, and an opt-out
  is the same "widget decides" policy with the default flipped. Ownership stays with the widget; see
  the compensating test below.
- **Ofelia's header close.** Kept as is.
- **`AlertDialog`.** No call site in the repository uses one.

## Decisions

1. **The widget owns the fullscreen close control.** The accepted consequence: a fourth widget can
   forget again, silently. Compensated by a per-package test rather than by architecture.
2. **Browser history is the single source of truth for "an overlay is open".** Every close request —
   the control, `Esc`, a backdrop click, the back gesture — turns into `history.back()`, and
   `popstate` is the only code path that actually closes anything. The alternative (close directly
   *and* keep history in sync) maintains two truths that diverge on the first double-back.
3. **Reconciliation is by depth, not by "pop one".** `popstate` closes every registered overlay
   deeper than `history.state.overlayDepth`. Two fast back presses, `history.go(-3)` and a
   multi-level stack all resolve correctly, where a decrement would leave an orphan open.
4. **No suppression flags.** A programmatic close unregisters its entry *before* calling
   `history.back()`, so the resulting `popstate` finds nothing deeper than the new depth and does
   nothing. This is what keeps the module readable: there is no "was this back ours?" state.
5. **The wiring point is the shared `Root` components**, not the call sites. `Dialog` and `Popover`
   in `packages/client/src/components/ui/` gain a wrapper; `FullscreenOverlay`, `MyDevicesDialog`,
   `AddDeviceModal`, `AddWidgetMenu` and `BoardSchemaSelect` are untouched.
6. **The stack lives in `widget-runtime`, the hook in `widget-sdk`.** `RecoveryModal`
   (`packages/widgets/passport-checker/ui/RecoveryModal.tsx`) is a hand-rolled `createPortal`
   overlay inside a federated remote and cannot import from `packages/client/src`. There must be
   exactly one stack on both sides of the federation boundary, and `widget-runtime` is the package
   that already carries singleton live state; `widget-sdk` carries the stateless React glue.
7. **Popovers participate, and are the first thing to drop.** `CLAUDE.md` documents a
   `DismissableLayer` race between stacked Radix roots, and this change makes every close path one
   asynchronous tick longer. If `BoardSchemaSelect` or `AddWidgetMenu` misbehaves, removing the
   `Popover` wrapper is a one-line retreat that leaves the dialogs working.

## Part A — the fullscreen close control

**clock.** `Clock.tsx` renders `<WidgetControls {...chrome} />` in the `mode === 'large'` branch as
well as the small one. `useWidgetChrome()` yields `{ onClose }` there, so exactly one button
appears. No CSS change: `placement="overlay"` needs a positioned ancestor, and `clock.module.css`'s
`.root` already carries `position: relative` (line 8).

**passport-checker.** `PassportChecker.tsx:63` becomes `const { onDelete, onClose } =
useWidgetChrome()`; both travel to the tiers, and `StandardTier` / `TinyTier` render
`<WidgetControls onDelete={onDelete} onClose={onClose} />`. Exactly one of the two is defined in any
given mode, so each tier still shows a single button, and the deliberate absence of an expand
affordance is preserved — `onExpand` is still never passed.

**ofelia-poop-duty.** Unchanged.

## Part B — overlay history

### Module

`packages/widget-runtime/src/overlay-history.ts` — module-level state, no Reatom: nothing renders
from this stack, so an atom would add a reactive contract that no consumer wants.

```ts
export type OverlayEntry = { depth: number; close: () => void }

const stack: OverlayEntry[] = []

export const pushOverlay = (close: () => void): OverlayEntry => {
  const depth = stack.length + 1
  history.pushState({ ...history.state, overlayDepth: depth }, '')
  const entry = { depth, close }
  stack.push(entry)
  return entry
}

/** A close request from the UI — the control, Esc, a backdrop click. */
export const dismissOverlay = (entry: OverlayEntry): void => {
  if (!stack.includes(entry)) return
  history.back() // popstate does the closing
}

/** The overlay went away outside the history flow — unmount, or `open` set to false by its owner. */
export const dropOverlay = (entry: OverlayEntry): void => {
  const index = stack.indexOf(entry)
  if (index < 0) return
  stack.splice(index, 1)
  history.back() // hand the history entry back
}
```

One `popstate` listener, installed once when the module is first imported:

```ts
window.addEventListener('popstate', () => {
  const depth = (history.state as { overlayDepth?: number } | null)?.overlayDepth ?? 0
  while (stack.length > 0 && stack[stack.length - 1].depth > depth) {
    stack.pop()?.close()
  }
})
```

And, at the same point, a one-time cleanup:

```ts
if ((history.state as { overlayDepth?: number } | null)?.overlayDepth) {
  history.replaceState({ ...history.state, overlayDepth: 0 }, '')
}
```

Reloading the page with an overlay open leaves a marked entry in history that no live overlay
corresponds to. Without this, the first back press after such a reload is consumed doing nothing.

`pushState` is called with the current URL, so nothing observable changes: no address bar update, no
router involvement, no interaction with the PWA `start_url` or the service worker.

The `indexOf` guard in `dropOverlay` carries the load in the common case. When the *user* presses
back, `popstate` has already popped the entry and called `close()`; React then unmounts the overlay
and runs the effect cleanup, which calls `dropOverlay` on an entry that is no longer in the stack.
The guard returns early, so the normal path does not fire a second `history.back()`. `dropOverlay`
reaches its `history.back()` only when the overlay really did close outside the history flow.

`dropOverlay` calls `history.back()` even when its entry was not the topmost, which returns the
wrong entry in a stack of two where the lower one closes first. Accepted: overlays close top-first
in every call site we have, and the depth reconciliation on the resulting `popstate` closes the
stragglers rather than leaving them stranded.

### Hook

`packages/widget-sdk/src/overlay/use-overlay-back-dismiss.ts`:

```ts
export const useOverlayBackDismiss = (open: boolean, close: () => void): (() => void) => {
  const entry = useRef<OverlayEntry | null>(null)
  const onClose = useEvent(close)

  useEffect(() => {
    if (!open) return
    const pushed = pushOverlay(() => onClose())
    entry.current = pushed
    return () => {
      entry.current = null
      dropOverlay(pushed)
    }
  }, [open, onClose])

  return useCallback(() => {
    if (entry.current) dismissOverlay(entry.current)
    else onClose()
  }, [onClose])
}
```

`useEvent` is `@khmilevoi/use-event`, already used by `WidgetFrame.tsx:1`.

**`StrictMode` is on** (`main.tsx:17`), so in development this effect runs mount → cleanup → mount.
The sequence is `push` → `drop` (which calls `back()`) → `push`: one entry registered, one spare
forward entry in browser history, and depth reconciliation agrees with the live stack. The cleanup
is what makes that true — an effect that pushes without unregistering would register twice and take
two back presses to close. This is the first thing to verify during implementation, not a
theoretical concern.

### Wiring

`packages/client/src/components/ui/dialog.tsx` — `Dialog` stops being a bare re-export of
`DialogPrimitive.Root`:

```tsx
const Dialog = ({ open, onOpenChange, ...props }: React.ComponentProps<typeof DialogPrimitive.Root>) => {
  // Uncontrolled dialogs keep Radix's own open state, which this wrapper cannot
  // drive; passing them through untouched is the only correct thing to do.
  if (open === undefined) return <DialogPrimitive.Root onOpenChange={onOpenChange} {...props} />

  const requestDismiss = useOverlayBackDismiss(open, () => onOpenChange?.(false))
  return (
    <DialogPrimitive.Root
      open={open}
      onOpenChange={(next) => (next ? onOpenChange?.(true) : requestDismiss())}
      {...props}
    />
  )
}
```

The `open === undefined` branch has no production call site — the only uncontrolled usage in the
repository is `primitives.test.tsx:58` — but it must exist, because without it an uncontrolled
dialog's close request would route into a `close()` that does nothing and the dialog would never
shut. The early return sits before a hook call, so the two branches need to be two components with
the hook in the controlled one; the exact split is an implementation detail.

`packages/client/src/components/ui/popover.tsx` gets the same treatment for `Popover`.

`RecoveryModal.tsx` calls the hook directly, passing its own visibility and close callback.

### Consequences

- `Esc` on desktop now travels through history and consumes an entry. This is the symmetry the
  design is built on, but it is a behavior change beyond the phone.
- Back on the board with nothing open still exits the PWA, exactly as today.

## Testing

- **Model unit tests** (jsdom): push/dismiss/drop, depth reconciliation, two back presses in a row,
  a programmatic close that does not double-close, and the start-up `replaceState`.
- **`FullscreenOverlay` component test**: a back navigation collapses the overlay. jsdom's
  `history.back()` is asynchronous; if it proves unreliable the test drives `replaceState` plus a
  hand-dispatched `popstate` instead. Recorded here so that substitution reads as a known fallback
  rather than a test bent around the implementation.
- **Per-widget tests** in `clock`, `passport-checker` and `ofelia-poop-duty`: mounting at
  `mode: 'large'` yields a button labelled `Закрыть`. This is the compensator for decision 1 — the
  only thing standing between a future widget and the same trap.
- **E2E** in `packages/client/e2e/mobile-board.spec.ts`, at a mobile viewport: expand the clock,
  `page.goBack()`, assert the board is back; and separately, assert the close control is visible and
  tappable with no hover anywhere in the sequence.

## Risks

- **`StrictMode` double-invocation** — see the hook section. Highest-probability implementation bug.
- **jsdom history** — see the testing section.
- **The Radix `DismissableLayer` race** documented in `CLAUDE.md`. Every close path grows an
  asynchronous tick. Popovers are the declared retreat.
- **The base branch is moving.** `feat/widget-controls` is being worked on by another session; it
  gained `b5ea2a72` during this design. Rebase before opening the PR.

## Workflow

Worktree `./.worktrees/fullscreen-back`, branch `feat/fullscreen-back`, based on
`feat/widget-controls`. The PR targets `feat/widget-controls`, not `dev` — a PR against `dev` would
carry the whole base branch in its diff. It merges after the base does.
