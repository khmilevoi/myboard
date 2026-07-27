# Unified widget card controls

Date: 2026-07-27
Status: approved, ready for planning

## Problem

The expand / delete / close controls a widget draws on its board card exist in three unrelated
implementations, and the one used by most widgets is invisible on a touch device.

| Where | Shape | Button | Icons | Visibility |
| --- | --- | --- | --- | --- |
| `packages/widget-sdk/src/ui/WidgetControls.tsx` | absolute overlay, card corner | 28x28, no border, `--secondary` | 15px | `opacity: 0`, revealed by `.frame:hover` / `:focus-within` |
| `packages/widgets/ofelia-poop-duty/ui/parts/OfeliaActionControls.tsx` | inline, inside the widget header | 34x34, `1px var(--border)`, `--background` | 17px | always |
| `packages/client/src/widget-host/ui/WidgetFrame.module.css` `.delete` | labeled text button in the error card | 34px tall | none | always |

Consumers today: `clock/ui/Clock.tsx:37` (expand + delete), `passport-checker/ui/tiers/StandardTier.tsx:26`
and `passport-checker/ui/tiers/TinyTier.tsx` (delete only, repeated in **six** branches),
`ofelia-poop-duty/ui/parts/OfeliaMiniHeader.tsx:20` and `ofelia-poop-duty/ui/parts/RichLayout.tsx:86`
(expand + delete + close).

Five concrete defects follow.

1. **The overlay is an invisible tap target on touch.** `WidgetFrame.module.css:9-12` reveals
   `.widget-controls` only on `.frame:hover` / `:focus-within`. A touch device never hovers, and
   `opacity: 0` does not remove hit-testing — so the corner of every clock and passport-checker card
   carries a fully clickable but invisible "Удалить" button. Ofelia escapes this only because it
   draws its controls inline.
2. **Two visual languages** — 28 vs 34px, borderless vs bordered, 15 vs 17px icons.
3. **Delete and close share the `X` icon** in `OfeliaActionControls.tsx:30,36`.
4. **The "board card only" policy is copy-pasted.** `mode === 'small' ? requestDelete : undefined`
   appears in `PassportChecker.tsx:71` and `OfeliaPoopDuty.tsx:150-151`, and implicitly as a branch
   in `Clock.tsx:26`.
5. **28px is below the 44px touch-target floor.**

## Goals

- One component renders these buttons for every widget, with one visual language.
- The component itself accounts for desktop vs touch — no widget repeats that logic.
- Widgets keep control over *where* the buttons sit and *which* of them exist.
- The duplicated `mode === 'small'` policy moves to one place.
- The invisible tap target is gone.

## Non-goals

- The labeled "Удалить" button in the widget error card (`WidgetFrame.tsx:110`,
  `WidgetErrorBoundary.tsx:40`, `.delete` in `WidgetFrame.module.css`). That is host chrome — a
  labeled destructive action sitting next to "Повторить" — not a corner icon. Folding it into the
  same component would make both worse.
- A board-level edit mode, or a long-press context menu, for reaching the controls on a phone.
  Considered and rejected: the first moves ownership of the chrome out of the widget and adds
  global state to `Board.tsx`, the second collides with `.widget-drag-grip`, which already takes
  `touchstart` on mobile (`Board.tsx:63`).
- Adding a close button to fullscreen clock. `Clock.tsx` deliberately renders no chrome in its
  `mode === 'large'` branch today, and changing that is a behavior change unrelated to this work.

## Decisions

1. **The component owns all three actions**, not just delete. Expand, delete and close always
   travel together; splitting them across two components is what produced the current drift.
2. **Two placements, one button style.** `placement="overlay" | "inline"` changes positioning only.
   Size, radius, colors, icons and touch target are identical in both. Ofelia's header placement is
   a legitimate per-widget decision — `RichLayout`'s header carries the title, the `large` badge and
   the subtitle, and an absolute corner overlay there would float over content.
3. **Mobile is detected by pointer capability, not viewport width.** The defect is literally "there
   is no hover", so `@media (hover: hover)` gates the reveal and `@media (pointer: coarse)` gates the
   touch target size. Consequence, accepted deliberately: a narrow desktop window (< 768px, where
   `resolveGridMetrics` already calls the board mobile) keeps hover-reveal and the 30px button,
   because a mouse is present there.
4. **Visibility defaults to visible**, and is suppressed only inside a board frame on a hovering
   device. This inverts today's rule and makes the SDK self-sufficient: the host stops carrying a
   rule about someone else's chrome, and a standalone `dev/harness.tsx` (which has no
   `[data-widget-surface]` ancestor) shows the controls instead of hiding them forever.
5. **Which buttons exist stays in the widget's JSX**, and the `mode` policy behind them moves to a
   `useWidgetChrome()` hook. Passport-checker deliberately offers no expand affordance at all
   (`onExpand` is never passed to its tiers; `requestFullscreen` is used only to restore fullscreen
   after the recovery modal, `PassportChecker.tsx:87`), so a component that decides for itself would
   need an opt-out mechanism. A hook plus explicit props keeps the component pure and testable
   without the runtime context.

## Component API

`packages/widget-sdk/src/ui/WidgetControls.tsx`:

```ts
export type WidgetChrome = {
  onExpand?: () => void
  onDelete?: () => void
  onClose?: () => void
}

export type WidgetControlsProps = WidgetChrome & {
  placement?: 'overlay' | 'inline' // default 'overlay'
  className?: string
}
```

Rendering rules:

- Renders `null` when all three callbacks are absent (today's behavior, extended to `onClose`).
- Button order is fixed — expand, delete, close — regardless of prop order, so a given button always
  occupies the same position.
- Icons: `Maximize2` / `Trash2` / `X`. `Trash2` resolves the delete-vs-close collision.
- `aria-label`s are unchanged: `Развернуть`, `Удалить`, `Закрыть`. Every existing unit test and
  `packages/client/e2e/pages/BoardPage.ts:25` queries by these, so they are a compatibility contract.
- Delete takes `--destructive` on hover; the other two keep the neutral hover.
- `placement` is emitted as `data-placement` on the root, and `className` is appended to the root.

## Styling

One module, `WidgetControls.module.css`. Shape:

```css
.root {
  display: flex;
  gap: 4px;
}
.root[data-placement='overlay'] {
  position: absolute;
  inset-block-start: 8px;
  inset-inline-end: 8px;
  z-index: 5;
  transition: opacity 0.15s var(--ease);
}

/* Hidden only inside a board frame, and only where hover exists at all. */
@media (hover: hover) {
  :global([data-widget-surface]) .root[data-placement='overlay'] {
    opacity: 0;
    pointer-events: none;
  }
  :global([data-widget-surface]):hover .root[data-placement='overlay'],
  :global([data-widget-surface]):focus-within .root[data-placement='overlay'] {
    opacity: 1;
    pointer-events: auto;
  }
}

.button {
  inline-size: 30px;
  block-size: 30px;
  border: 1px solid var(--border);
  border-radius: 8px;
  background: var(--secondary);
  color: var(--text-3);
}
@media (pointer: coarse) {
  .button {
    inline-size: 44px;
    block-size: 44px;
  }
}
```

The solid fill plus border is what lets an overlay button read over arbitrary widget content, and it
is also what removes the borderless/bordered split between the two current implementations.

`pointer-events: none` in the hidden state is what actually closes defect 1 — even on desktop, the
control is no longer clickable while invisible.

`data-widget-surface` already exists on the frame element (`WidgetFrame.tsx:121`) and is already used
as a cross-package hook by `global.css:78`, so no new contract is introduced. The rule at
`WidgetFrame.module.css:9-12` and the `widget-controls` global class in `WidgetControls.tsx:20` are
both deleted.

## Policy hook

Co-located in `WidgetControls.tsx`, since the component and the policy are always used together:

```ts
export const useWidgetChrome = (): WidgetChrome => {
  const { mode, requestFullscreen, requestDelete, requestClose } = useWidgetContext()
  if (mode === 'large') return { onClose: requestClose }
  return { onExpand: requestFullscreen, onDelete: requestDelete }
}
```

This is exactly the policy the comments at `OfeliaPoopDuty.tsx:147-151` and
`PassportChecker.tsx:68-71` describe today, stated once. Widgets take the whole object or one field
of it:

```tsx
<WidgetControls {...useWidgetChrome()} />                   // ofelia
<WidgetControls onDelete={useWidgetChrome().onDelete} />    // passport-checker
```

## Migration

**clock** — `Clock.tsx:37` becomes `<WidgetControls {...useWidgetChrome()} />`. The `mode === 'large'`
branch keeps rendering no controls, as today.

**passport-checker** — `PassportChecker.tsx:71` becomes `useWidgetChrome().onDelete`; the tiers keep
their `onDelete` prop. Separately, the six repeated `<WidgetControls onDelete>` calls in `TinyTier.tsx`
collapse to one: the six branches currently each return their own root `div`, so this needs a single
shell with a computed `className` and per-state content. This step is separable from the rest — if it
looks risky during implementation, drop it and everything else still lands.

**ofelia-poop-duty** — `OfeliaActionControls.tsx` and `OfeliaActionControls.module.css` are deleted.
`OfeliaMiniHeader.tsx:20` becomes `<WidgetControls placement="inline" />`, `RichLayout.tsx:86-91`
becomes `<WidgetControls placement="inline" className={styles.headerClose} />`, and
`OfeliaPoopDuty.tsx:150-151` becomes `useWidgetChrome()`.

**host** — `WidgetFrame.module.css:9-12` is deleted.

## Testing

- `WidgetControls.test.tsx` grows: both placements, fixed button order, empty render, `className`
  passthrough, `onClose` wiring.
- A new test for `useWidgetChrome`: `mode: 'small'` yields expand + delete and no close;
  `mode: 'large'` yields close only.
- Existing widget tests (`Clock.test.tsx`, `PassportChecker.test.tsx`, `Tiers.test.tsx`,
  `RichTiers.test.tsx`, `StandardTier.test.tsx`, `RichLayout.test.tsx`) query by `aria-label` and are
  expected to pass unchanged. Any that break signals an accidental behavior change, not a stale test.
- Media queries are not observable in jsdom, so `packages/client/e2e/mobile-board.spec.ts` gains a
  check at a mobile viewport: the card's "Удалить" button is visible without any hover. That is the
  regression test for defect 1.

## Risks

- **Ofelia's inline buttons shrink from 34px to 30px on desktop** and gain a `Trash2` icon. This is
  the intended unification, but it is a visible change to a shipped widget.
- **The `:global([data-widget-surface])` descendant selector crosses a package boundary.** It is the
  same coupling that exists today in the opposite direction (host CSS reaching into a widget's DOM
  via `.widget-controls`), moved to the side that owns the component. `global.css:78` already relies
  on the same attribute.
- **A hybrid touch laptop** reports `hover: hover` with a touchscreen, so it keeps hover-reveal and a
  tap on the card corner still meets an invisible-until-hovered control. `pointer-events: none` makes
  that a no-op rather than an accidental delete, which is the important half of the fix.
