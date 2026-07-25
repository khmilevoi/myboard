# Backlog

Known follow-ups that are deliberately not scheduled. Each entry states what
exists today, why it is tolerable, and what would trigger doing the work.

## Shared modal/overlay primitive for widgets

**Today.** `packages/widgets/passport-checker/ui/use-modal-isolation.ts` is a
hand-rolled modal implementation owned by one widget. It reimplements Escape
handling, a Tab focus trap, focus containment, mount/unmount focus hand-off and
press-based backdrop dismissal, and it does so with `window`-capture listeners
specifically to win against a modal `radix-ui` layer the widget cannot patch —
the board's fullscreen dialog. The widget's overlay also needs an explicit
`pointer-events: auto` because a Radix modal layer sets `pointer-events: none`
on `document.body`.

**Why it is tolerable.** After the tier-shared-state work
([design](./docs/superpowers/specs/2026-07-25-passport-checker-tier-shared-state-design.md))
recovery collapses fullscreen before opening, so in production the modal is the
only layer on screen. The stacked configuration survives only as a degenerate
fallback, covered by `ui/recovery-modal-radix-stack.test.tsx`.

**Why it should not stay.** The isolation is coupled to Radix internals rather
than to a contract: it depends on `FocusScope.handleFocusOut` inspecting only
`relatedTarget` and never `event.target`, and on `FocusScope` restoring focus
from a `setTimeout(…, 0)` on unmount. Both are implementation details that can
change in a patch release and fail silently — no type error, no test failure
outside the one stack test we wrote on purpose. A second widget needing a modal
would copy all of it.

**Shape to consider.** Either a host-owned overlay slot — `widget-host` renders
widget-requested overlays outside the fullscreen dialog, so nothing is ever
stacked and no isolation is needed — or a `widget-sdk` modal primitive built on
the same Radix layer stack the board itself uses, so layering is coordinated
instead of fought. The host-slot option is the stronger one: it removes the
problem rather than centralising the workaround.

**Trigger.** A second widget needs a modal, or a `radix-ui` upgrade breaks the
stack test.

## Two simultaneously-mounted `useModalIsolation` modals ping-pong focus

**Today.** `packages/widgets/passport-checker/ui/use-modal-isolation.ts`
registers its focus-containment `focusin` handler on `window` in the CAPTURE
phase (`use-modal-isolation.ts:76`), while the `stopPropagation()` that keeps a
modal's own `focusin` off `document` sits on the modal root
(`use-modal-isolation.ts:55`) — far later on the same capture path. Two mounted
modals therefore each see the other's `focusin` first, find the target outside
their own root, and pull focus back into themselves, each move re-triggering the
other. Measured in jsdom 29.1.1 with two `useModalIsolation` roots mounted at
once: a single modal performs 1 focus pull on mount, while two mounted together
run away without settling — a hard test guard at 400 pulls had to stop them (402
recorded, and the true count is unbounded).

**Why it is tolerable.** It is not reachable through the UI. The passport
checker is the only owner of a `useModalIsolation` modal, and it renders at most
one: `<RecoveryModal />` is rendered only from the non-fullscreen mount
(`PassportChecker.tsx:72`). A second one cannot be opened over the first either
— the overlay is `position: fixed; inset: 0` with `pointer-events: auto`
(`recovery-modal.module.css:1-13`) and its `pointerdown` handler closes the
modal on any press that starts on the overlay
(`use-modal-isolation.ts:50-53`), so nothing behind it can be clicked.

**Shape to consider.** A module-level stack of active modal roots: each
`useModalIsolation` effect pushes its root on mount and pops it on cleanup, and
the containment handler returns immediately unless its own root is the topmost
entry. Only the top modal contains focus, so there is no second handler left to
pull against. This also generalises cleanly to the shared modal primitive the
entry above describes.

**Trigger.** A second widget adopts `useModalIsolation`, or the passport checker
ever renders two of its modals at once (e.g. the fullscreen-mount guard at
`PassportChecker.tsx:72` is relaxed, or a second modal surface is added).
