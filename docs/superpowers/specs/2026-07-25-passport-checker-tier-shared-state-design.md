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
  therefore hands focus to the board tile one tick _after_ the recovery modal
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

- No host-owned instance lifetime. The generic store ships in `widget-sdk` as a
  factory each widget instantiates on its own module scope, not as state inside
  the `widget-runtime` federation singleton, and neither `widget-host` nor the
  board creates or disposes entries.
- No migration of the other widgets. `clock` holds no state and
  `ofelia-poop-duty` keeps its state in storage, which already survives a tier
  switch; they adopt the helper only if they ever need in-memory state.
- No persistence of check results. Results remain in memory and still disappear
  on reload, per the master spec's secret-audit requirements.
- No change to the recovery transport, capability lifecycle, server handler, or
  browser task.

## Design

### 1. Generic instance store in `widget-sdk`

Nothing about sharing one model graph across a widget's mounts is
passport-specific — it follows from how the board mounts widgets — so the
mechanism ships as a reusable helper in
`packages/widget-sdk/src/instance/instance-store.ts`, exported from the package
root:

```ts
export type WidgetInstanceStore<Value> = (key: string, make: () => Value) => Computed<Value>

export type MakeWidgetInstanceStoreOptions<Value> = {
  name: string
  dispose?: (value: Value, key: string) => void
}

export function makeWidgetInstanceStore<Value>(
  options: MakeWidgetInstanceStoreOptions<Value>,
): WidgetInstanceStore<Value>
```

`widget-sdk` stays stateless: it exports a **factory**, and each widget creates
its own store at module scope, so one widget's entries are never visible to
another and nothing lives in the `widget-runtime` federation singleton.

**Reatom's connection lifetime is the reference count.** A store keeps a
`Map<string, Computed<Value>>` of memoized instance atoms; each atom is named
`${name}#${key}` and carries `withDisconnectHook`. `withConnectHook` fires on
the first subscriber and its cleanup on the last, which is exactly the counting
we would otherwise hand-roll. Measured against `@reatom/core@1001.1.0` with two
`reatomComponent` mounts reading one key: both read one value, unmounting one
does not dispose, unmounting the last disposes once, and the next mount builds
a fresh value.

`@reatom/core@1001.1.0` has no keyed atom family to lean on instead — `computed`
takes no parameters (`Computed<State> extends AtomLike<State, []>`), `withParams`
only transforms call arguments, `memoKey` is scoped to a host atom's lifetime,
and `withCache` is an async request cache. The keyed `Map` is also what upstream
prescribes for model collections, so it stays hand-written by design.

**The handle must be dropped on disconnect.** A `computed`'s cache survives
disconnection, so reusing the same atom after disposal resurrects a torn-down
value — measured: with the handle retained, a remount returned the disposed
object instead of rebuilding. The disconnect hook therefore deletes the atom
from the map, and the next mount builds a new atom and a new value.

`make` is passed per call because the value depends on runtime props, but it
runs only for the first mount of a key, so a widget must pass a `make` whose
captured inputs are interchangeable between mounts. It must also not read atoms
reactively: the instance atom is a `computed`, and a reactive dependency would
silently rebuild the whole value when it changes.

### 2. Reading an instance in a component

There is no React hook. A `reatomMemo` component reads the instance atom in its
body — `passportInstance(instanceId, make)()` — and that read is what subscribes
the mount, so the component's lifetime and the store's reference count are the
same thing. No `useRef` bookkeeping, no `useEffect` cleanup, and an orphaned
atom from a render React discards before commit is cleaned up by the first real
connect/disconnect cycle rather than pinning a counter forever.

### 3. Passport binding

`packages/widgets/passport-checker/model/instance-store.ts` shrinks to the
widget's own typing and disposal policy:

```ts
export type PassportInstanceModels = {
  checkModel: PassportCheckModel
  recoveryModel: RecoveryModel
  recoveryFlow: RecoveryFlow
}

export const passportInstance = makeWidgetInstanceStore<PassportInstanceModels>({
  name: 'passport.instance',
  dispose: (models) => models.recoveryModel.teardown(),
})
```

Disposal tears the recovery session down as a safety net in case the modal
outlived the widget; in the normal flow the recovery canvas effect already did
it. The `make` passed at each mount captures `api` and `typeId`; capturing them
from whichever mount arrives first is safe, because `makeWidgetApi` is a
stateless wrapper over the shared http port (`host-runtime.ts:64`) and `typeId`
is identical for both mounts.

The store creator keeps the repository's `make*` factory naming rather than
Reatom's `reatom*` convention for atom factories: it creates a store, and the
per-key accessor it returns is memoized rather than a fresh factory per call.
The atoms it builds are named, which is what that convention protects.

### 4. StrictMode removal

`packages/client/src/app/main.tsx` drops the `<StrictMode>` wrapper.

Connection-owned lifetime is incompatible with StrictMode's development-only
mount → unmount → mount effect cycle. Measured with two components mounted
under `<StrictMode>`: the cycle empties the subscriber set, the disconnect hook
disposes the value and drops the handle, and the store ends up empty while both
components are still mounted and rendering the disposed value. A hand-rolled
reference count fails the same way for the same reason.

StrictMode does not run in production builds, so this changes no runtime
behavior — it gives up a development-time detector of non-idempotent mounts and
missing cleanups across the whole client.

A comment replaces the wrapper explaining why it is absent, so it is not
reinstated without also making instance stores tolerate double mounting.

### 5. Modal ownership

`PassportChecker.tsx` renders the modal only from the non-fullscreen mount:

```text
{tier !== 'fullscreen' && checkModel.recoveryOpen() && <RecoveryModal />}
```

With shared state both mounts would otherwise render one modal each. `tier` is
`'fullscreen'` exactly when the mount comes from `FullscreenOverlay`, which
passes `tier="fullscreen"` as an override (`FullscreenOverlay.tsx:50`); every
other tier is resolved from size and belongs to the board tile or a dev harness.

### 6. Fullscreen collapse and restore

`model/recovery-flow.ts` owns the transition and gains a `restorePending` atom
meaning "we collapsed fullscreen to show recovery":

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

### 7. Focus containment

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

### 8. Focusout guard stays broad

The guard keeps swallowing every `focusout` whose `relatedTarget` is inside the
root, with a comment recording why the narrower form is wrong (Radix's
`handleFocusOut` ignores `event.target`, so intra-modal focus moves must be
swallowed too). The missing regression test is added instead.

## Testing

- `widget-sdk/src/instance/instance-store.test.tsx` — one key returns the same
  atom and calls `make` once; separate keys and separate stores stay separate;
  two mounted components share one value; unmounting one keeps it alive;
  unmounting the last disposes it exactly once; a later mount builds a fresh
  value rather than resurrecting the disposed one.
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
  test, which disconnects the instance atom and disposes it. Disconnection is
  not synchronous with unmount, so lifecycle assertions await it.

Gate: `pnpm --filter widget-sdk test`, `pnpm --filter widgets-passport-checker
test`, then `pnpm --filter client test` (mandatory — StrictMode was removed),
then `pnpm check`.

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
- `BACKLOG.md` records the deferred follow-up this design leaves standing: the
  widget still owns a hand-rolled modal coupled to Radix internals, and the
  shared primitive that would replace it is out of scope here.

## Delivery

Work continues in the existing worktree `./.worktrees/passport-checker-widget`
on `feat/passport-checker-widget`, adding commits to the open PR #23. The branch
is 18 commits ahead of `main` and behind by none, so no rebase is required.

## Decision Summary

`widget-sdk` gains a generic instance-store factory whose reference counting is
Reatom's own connection lifetime; the passport widget instantiates one so both
mounts of one placed widget share a single model graph. `StrictMode` is removed
because its development-only remount cycle disposes a value that is still
mounted, and it never runs in production.
The tile mount owns the recovery modal, opening recovery from fullscreen
collapses it through `requestClose`, and closing or retrying restores it through
`requestFullscreen`. The modal gains focus containment to absorb Radix's
deferred unmount focus restore. The proposed focusout tightening is rejected as
a regression and replaced with the regression test that would have caught it.
