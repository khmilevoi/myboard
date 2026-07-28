---
name: radix-stacked-dialogs
description: Use when two Radix Dialog, AlertDialog or Popover roots are open at once and closing the top one also dismisses the one underneath, or when a DismissableLayer / pointerDownOutside / deferPointerDownOutside race between stacked overlay layers is suspected.
---

# Stacked Radix dialogs dismiss each other

Read `docs/agent/radix-stacked-dialogs.md` in this repository before changing any overlay timing
code. It records the cause, the guard that does **not** fix it, and the structural fix to prefer.
