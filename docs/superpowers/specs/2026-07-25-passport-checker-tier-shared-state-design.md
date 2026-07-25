# Passport Checker Tier-Shared State Design

Finishing work for Subproject 7 ([Passport Checker Widget
Design](./2026-07-24-passport-checker-widget-design.md)), delivered on the same
branch and the same pull request. It closes the fullscreen-stack limitations the
widget shipped with, and the pre-existing repository formatting debt that keeps
`pnpm format:check` red.

## Goal

Make the passport widget's in-memory state survive a tier switch, and remove the
two fullscreen-stack accessibility defects by removing the stack itself rather
than by fighting Radix internals.

## Problem

`Board.tsx:56` renders a `WidgetFrame` for every placed instance, and
`FullscreenOverlay.tsx:46` renders a **second** `WidgetFrame` for the same
`instanceId`. While fullscreen is open, two independent `PassportChecker` mounts
exist, and each builds its own models — `makePassportCheckModel`,
`makeRecoveryModel` and `makeRecoveryFlow` are called from `useMemo` inside the
component (`PassportChecker.tsx:27-40`), and every atom is created inside those
factories (`check-model.ts:90-91`).

Three consequences:

1. **State is lost on every tier switch.** A check run in the tile is invisible
   after expanding to fullscreen, and vice versa. The master spec says a result
   lives only in memory and disappears on reload; it does not say it disappears
   on expand.
2. **Collapsing fullscreen to escape the Radix stack cannot work naively.**
   `requestClose()` unmounts the fullscreen mount, which owns `recoveryOpen`,
   the `sessionRequired` view state, the `sshTarget`, and the `<RecoveryModal/>`
   element itself (`PassportChecker.tsx:51`). The tile mount is a different
   object graph sitting at `idle`, so the modal would simply never appear.
3. **The stack itself causes the two known defects.** Mount autofocus loses to
   the underlying trapped Radix `FocusScope`, and Radix's `hideOthers` stamps
   `aria-hidden` on our `document.body` portal.

Two further findings constrain the fix:

- **Radix restores focus asynchronously on unmount.** `FocusScope`'s cleanup
  schedules `setTimeout(…, 0)` and then calls
  `focus(previouslyFocusedElement ?? document.body)`
  (`@radix-ui/react-focus-scope/dist/index.mjs:87-99`). Collapsing fullscreen
  therefore hands focus to the board tile one tick *after* the recovery modal
  mounts and focuses itself. Collapsing alone is not enough; the modal must hold
  focus.
- **The backlog's proposed focusout tightening is a regression.** Radix's
  `handleFocusOut` inspects only `relatedTarget` and never `event.target`
  (`.../index.mjs:44-51`). A focus move entirely inside our modal has both
  endpoints outside Radix's container, so Radix pulls focus back to itself
  unless we swallow that event. Adding `&& !root.contains(event.target)` would
  stop swallowing exactly those events. The existing stack test does not catch
  it because it only exercises focus entering from outside.

## Non-goals

- No host-level (`widget-runtime` / `widget-host`) per-instance state slot. A
  shared store owned by the host would be the general answer for every widget;
  only this widget needs one today.
- No reusable helper in `widget-sdk`. The store stays widget-local until a
  second widget needs it.
- No persistence of check results. Results remain in memory and still disappear
  on reload, per the master spec's secret-audit requirements.
- No change to the recovery transport, capability lifecycle, server handler, or
  browser task.

## Design

### 1. Per-instance model store

`packages/widgets/passport-checker/model/instance-store.ts` owns a module-level
`Map<string, Entry>` keyed by `instanceId`, where
`Entry = { models: PassportInstanceModels; refs: number }` and
`PassportInstanceModels = { checkModel, recoveryModel, recoveryFlow }`.

```ts
export type PassportInstanceLease = {
  models: PassportInstanceModels
  release: () => void
}

export function acquirePassportInstance(
  key: string,
  make: () => PassportInstanceModels,
): PassportInstanceLease
```

- `acquire` creates the entry on first use, increments `refs`, and returns a
  lease.
- `release` is idempotent per lease: a lease decrements `refs` at most once, no
  matter how many times it is called.
- When `refs` reaches zero the entry is deleted from the map and
  `recoveryModel.teardown()` runs — a safety net in case the modal outlived the
  widget.

`make` is invoked only on the first acquire, so `api` and `typeId` are captured
from whichever mount arrived first. That is safe: `makeWidgetApi` is a stateless
wrapper over the shared http port (`host-runtime.ts:64`), so both mounts' `api`
objects are interchangeable.

### 2. Lease hook

`packages/widgets/passport-checker/ui/use-passport-instance.ts`:

- takes the lease during render, guarded by a `useRef` so a repeated render of
  the same fiber does not take a second one;
- releases in effect cleanup;
- on an `instanceId` change, releases the old lease and takes a new one.

Accepted risk: a render React discards before commit (the widget mounts under
`lazy` + `Suspense` in `WidgetFrame`) leaks one lease. Degradation is soft —
disposal never runs, and by then the entry holds no live resource, because the
RFB socket and the countdown interval belong to `NoVncCanvas`'s effect
(`NoVncCanvas.tsx:45-51`). Dead atoms remain until the page reloads.

### 3. StrictMode removal

`packages/client/src/app/main.tsx` drops the `<StrictMode>` wrapper.

Reference counting is incompatible with StrictMode's development-only
mount → unmount → mount effect cycle: the first cleanup would drop `refs` to
zero and dispose the entry while the component still renders against it, and
nothing re-acquires. StrictMode does not run in production builds, so this
changes no runtime behavior — it gives up a development-time detector of
non-idempotent mounts and missing cleanups across the whole client.

A comment replaces the wrapper explaining why it is absent, so it is not
reinstated without also making the store tolerate double mounting.

### 4. Modal ownership

`PassportChecker.tsx` renders the modal only from the non-fullscreen mount:

```tsx
{tier !== 'fullscreen' && checkModel.recoveryOpen() && <RecoveryModal />}
```

With shared state both mounts would otherwise render one modal each. `tier` is
`'fullscreen'` exactly when the mount comes from `FullscreenOverlay`, which
passes `tier="fullscreen"` as an override (`FullscreenOverlay.tsx:50`); every
other tier is resolved from size and belongs to the board tile or a dev harness.

### 5. Fullscreen collapse and restore

`model/recovery-flow.ts` owns the transition and gains a `restoreFullscreen`
atom meaning "we collapsed fullscreen to show recovery":

- `openRecovery({ fromFullscreen, collapse })` — sets the atom, sets
  `checkModel.recoveryOpen`, and calls `collapse()` when `fromFullscreen`;
- `closeRecovery({ restore })` and `retryCheck({ restore })` — keep the existing
  teardown and `recoveryOpen` reset, then, if the atom is set, clear it and call
  `restore()`.

The host callbacks are passed as action arguments rather than injected when the
flow is built, because **the two mounts do not have the same callbacks**:
`requestClose` only works on the fullscreen mount (the tile's default is a no-op
— `WidgetFrame.tsx:47`), and `requestFullscreen` only works on the tile mount
(`FullscreenOverlay` does not pass one, so it falls back to the same no-op).
Each call therefore originates from the mount whose callback is live: opening
comes from `StandardTier`/`TinyTier`, closing and retrying come from the modal,
which the tile owns. The atom lives in the shared entry, so the tile sees the
decision the fullscreen mount made.

Both tiers stop writing `checkModel.recoveryOpen` directly
(`StandardTier.tsx:16`, `TinyTier.tsx:15`) and call `recoveryFlow.openRecovery`
instead, so the transition has exactly one implementation.

Opening from fullscreen writes two atoms in one action, so React collapses the
fullscreen mount and renders the modal under the tile in a single commit.
`NoVncCanvas` mounts exactly once, so exactly one recovery capability is issued.

Retrying restores fullscreen as well; the check runs on the shared model and its
result is visible in whichever tier is on screen.

### 6. Focus containment

`ui/use-modal-isolation.ts` gains a window-capture `focusin` listener: while the
modal is open, focus landing outside the root returns to the modal's first
focusable element.

This absorbs the deferred `focus(previouslyFocusedElement)` Radix schedules when
the fullscreen dialog unmounts, and it also closes the original "mount autofocus
loses to the trapped FocusScope" defect, so the modal now holds focus even in
the degenerate case where collapsing did not happen.

No ping-pong with Radix: `focusin` raised inside the modal is stopped at the
root (`use-modal-isolation.ts:53`) and never reaches `document`, so Radix's
`handleFocusIn` never sees it. No recursion: our own capture listener does
nothing for targets already inside the root.

### 7. Focusout guard stays broad

The guard keeps swallowing every `focusout` whose `relatedTarget` is inside the
root, with a comment recording why the narrower form is wrong (Radix's
`handleFocusOut` ignores `event.target`, so intra-modal focus moves must be
swallowed too). The missing regression test is added instead.

## Testing

- `model/instance-store.test.ts` — one key returns the same models; `release` is
  idempotent; reaching zero references removes the entry, calls
  `recoveryModel.teardown()`, and a later acquire builds a fresh entry.
- `ui/PassportChecker.test.tsx` — two mounts sharing an `instanceId` share
  state (a check started in one is visible in the other); the fullscreen mount
  renders no modal while the tile mount does; opening recovery from the
  fullscreen mount calls `requestClose`.
- `ui/recovery-flow.test.tsx` — `closeRecovery` and `retryCheck` call
  `requestFullscreen` only when recovery was opened from fullscreen; opening
  from the tile restores nothing.
- `ui/recovery-modal-radix-stack.test.tsx` — the underlying Radix dialog mounts
  first, in its own render pass, mirroring production; focus moving between two
  buttons inside our modal stays inside it; focus driven outside the modal is
  pulled back. The `describe` header note claiming mount autofocus is
  intentionally untested is removed, because the behavior now exists.
- Test isolation needs no production reset hook: Testing Library's automatic
  cleanup (`globals: true` in `defineWidgetVitestConfig`) unmounts after each
  test, which drops references to zero and disposes the entry.

Gate: `pnpm --filter passport-checker test`, then `pnpm --filter client test`
(mandatory — StrictMode was removed), then `pnpm check`.

## Formatting debt

The first commit on the branch runs `pnpm format` over the 18 files that fail
`pnpm format:check` on a clean `main`: nine plans under
`docs/superpowers/plans/`, five specs under `docs/superpowers/specs/`,
`docs/superpowers/specs/designs/Мультиустройства.dc.html`,
`docs/typescript-7-migration.md`, `docs/typescript-7-migration/benchmarks.json`,
and `scripts/bench-typecheck-build.ts`. None of them are touched by this branch;
running it first keeps the branch's own gate green, and merging PR #23 turns the
repository gate green.

## Documentation

- This spec, linked from an amendment block in the Subproject 7 spec.
- The Subproject 7 section of the master spec gains its missing `**Plan:**`
  link; back-linking requires both, and only `**Design:**` is present.
- `main.tsx` carries the comment explaining the absent `StrictMode`.

## Delivery

Work continues in the existing worktree `./.worktrees/passport-checker-widget`
on `feat/passport-checker-widget`, adding commits to the open PR #23. The branch
is 18 commits ahead of `main` and behind by none, so no rebase is required.

## Decision Summary

The widget's models move into a reference-counted per-instance store so both
mounts of one placed widget share one object graph; `StrictMode` is removed
because it is incompatible with reference counting and only runs in development.
The tile mount owns the recovery modal, opening recovery from fullscreen
collapses it through `requestClose`, and closing or retrying restores it through
`requestFullscreen`. The modal gains focus containment to absorb Radix's
deferred unmount focus restore. The proposed focusout tightening is rejected as
a regression and replaced with the regression test that would have caught it.
