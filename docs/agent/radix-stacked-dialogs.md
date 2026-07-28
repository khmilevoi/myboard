# Stacked Radix dialogs dismiss each other

## Symptom

Two sibling Radix `Dialog` / `AlertDialog` / `Popover` roots are open at once (stacked, not
DOM-nested). Closing the top one — via its own close button, escape, or an outside click — also
dismisses the one underneath.

## Cause

A known `DismissableLayer` race. The underlying root's deferred `pointerDownOutside` check
(`deferPointerDownOutside` → `setTimeout(0)`) runs *after* the top root has already unregistered
from Radix's shared "topmost" layer stack, so the underlying root concludes the click landed outside
itself.

## What does not work

A reactive open-state guard: the state has already flipped by the time the deferred check runs. Only
a plain ref cleared one tick later works, and even that is coupled to Radix's internal event timing.

## Preferred fix

Treat a recurrence as an architectural decision, not another timing patch. First consider collapsing
the stack into a single `Dialog.Root` with an internal view/content switch — with no second `Root`,
the race cannot occur — before reaching for another ref-based guard.
