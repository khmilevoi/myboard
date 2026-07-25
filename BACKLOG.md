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
