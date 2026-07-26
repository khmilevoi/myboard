# Responsive board layout

Date: 2026-07-26
Status: approved, ready for planning

## Problem

The board stores one layout and renders it through a grid whose metrics are hardcoded:
`cols: 12, rowHeight: 30` in `packages/client/src/board/ui/Board.tsx:35`. Column width is
derived from the container, but row height and margins are fixed pixels. The same stored
layout therefore produces three unrelated physical results:

| Screen | Column width | A `w:3 h:4` card |
| --- | --- | --- |
| 3840 | ~309 px | 947 x 150 |
| 1920 | ~149 px | 468 x 150 |
| Phone (~390) | ~24 px | 91 x 150 |

Two distinct defects follow. On a phone the width collapses while the height does not, so a
card becomes an unusable vertical sliver. On a 4K display the width doubles while the height
stays put, so the aspect ratio drifts from 3:1 to 6:1.

Separately, the phone needs a genuinely different arrangement: every card should span the full
width, which no amount of pixel arithmetic on a 12-column grid can produce.

## Goals

- Cards span the full width on a phone.
- One stored layout scales as a true zoom across desktop widths, without aspect drift.
- The phone arrangement is derived automatically from the desktop one, and is remembered if the
  user rearranges it by hand.
- No migration of stored board data.

## Non-goals

- A tablet breakpoint. Two breakpoints ship; the derivation is a pure function, so a third one
  is an extra call rather than a schema change.
- Per-device layouts. Layouts are keyed by width, not by device. Boards live in a single
  `root:boards` document shared by every device, so a per-device layout would require either a
  device-keyed sub-document or per-device storage keys; a phone would also clobber the desktop
  arrangement on every write under the current last-write-wins model.
- Conflict resolution for simultaneous edits from two devices. That limitation is pre-existing
  and unchanged.

## Decisions

1. **Two breakpoints**, switched on container width: `< 768` is mobile with `cols: 1`,
   `>= 768` is desktop with `cols: 12`.
2. **Desktop scales as a true zoom.** Row height and margin scale with the same factor as the
   column width, so proportions are preserved at any width.
3. **Mobile layout is derived, and overridable.** It is computed from the desktop layout until
   the user drags or resizes on a mobile-width viewport; from that point it is stored and
   authoritative until reset.

## Data model

`BoardSnapshotSchema` in `packages/client/src/board/model/types.ts` gains exactly one optional
field:

```ts
export const BoardSnapshotSchema = z.object({
  id: z.string(),
  name: z.string(),
  instances: z.array(WidgetInstanceSchema),
  layout: z.array(LayoutItemSchema),                  // desktop, unchanged
  mobileLayout: z.array(LayoutItemSchema).optional(), // present only once overridden
})
```

Storage keys do not change. `root:boards` and `root:localBoard` keep their namespace and
relative key, so the key-shape hazard documented in `CLAUDE.md` (commit `0027a99`) does not
apply: only the value shape changes, and additively. Existing boards validate because the field
is absent and `.optional()` accepts that. No migration is required.

`layout` keeps its current meaning. It is both the desktop layout and the source the mobile
layout is derived from. Renaming it to something like `desktopLayout` would be precisely the
dangerous migration this design avoids.

The absence of `mobileLayout` *is* the "not yet overridden" state. No separate boolean flag is
introduced, so flag and data cannot disagree.

## Grid metrics

New module `packages/client/src/board/model/grid-metrics.ts`:

```ts
export const MOBILE_BREAKPOINT = 768
export const BASE_WIDTH = 1920

export type GridMetrics = {
  isMobile: boolean
  cols: number
  rowHeight: number
  margin: [number, number]
}

const clamp = (value: number, min: number, max: number) => Math.min(Math.max(value, min), max)

export const resolveGridMetrics = (width: number): GridMetrics => {
  if (width < MOBILE_BREAKPOINT) {
    return { isMobile: true, cols: 1, rowHeight: 40, margin: [10, 10] }
  }

  const scale = clamp(width / BASE_WIDTH, 0.75, 2.5)
  return { isMobile: false, cols: 12, rowHeight: 30 * scale, margin: [10 * scale, 10 * scale] }
}
```

React Grid Layout computes column width as
`(width - margin[0] * (cols - 1) - containerPadding[0] * 2) / cols`, and `containerPadding`
defaults to `margin`. Scaling the margin by the same factor therefore scales the column width by
that factor too, which is what makes the desktop grid a true zoom rather than a one-axis stretch.
`BASE_WIDTH` is 1920, so at `scale === 1` the numbers are identical to today's and existing
1080p boards do not shift by a pixel.

| Width | cols | scale | Column | `w:3 h:4` card |
| --- | --- | --- | --- | --- |
| 3840 | 12 | 2.0 | 298 | 935 x 300 |
| 1920 | 12 | 1.0 | 149 | 468 x 150 (unchanged) |
| 1280 | 12 | 0.75 | 98 | 311 x 113 |
| 390 | 1 | n/a | 370 | 370 x 190 |

Scaling the height also lets cards cross tier thresholds that a fixed `rowHeight` could never
reach. `resolveTier` (`packages/widget-runtime/src/tier.ts:26`) requires both axes to clear a
threshold, and `DEFAULT_TIERS.compact` needs `160` px of height. Accounting for the card's
`padding: 20px`, a default `h:4` card measures roughly 110 px of frame height at 1920 — below
`compact` — and roughly 260 px at 3840, which clears it. Exact tiers depend on each widget's `h`
and on `tiers` overrides, but the direction is the point: on a large display widgets start
rendering their richer layouts, which is what the tier system was built for.

The lower clamp of `0.75` covers the 768-1100 px band, which is a desktop window narrowed to a
third of a 4K screen. Twelve columns are objectively cramped there at any scale; the clamp only
keeps cards from collapsing to unreadable heights. This is an accepted compromise, not a
solution: if the band becomes a problem, a third breakpoint is added. The upper clamp of `2.5`
never binds on a 4K display and exists as a guard against ultrawide monitors.

Mobile row height is a fixed `40` rather than a scaled value. With one column the column width
jumps to ~370 px, and the desktop coefficient would make each row step ~74 px — too coarse to
size a card precisely with a finger. With heights inherited from the desktop layout this yields
190 px for a `h:4` widget and 290 px for `h:6`, which is a reasonable starting point and the one
constant most likely to be tuned once after seeing it on a real phone.

## Derivation and reconciliation

New module `packages/client/src/board/model/mobile-layout.ts`.

```ts
export const deriveMobileLayout = (layout: LayoutItem[]): LayoutItem[] => {
  let y = 0
  return [...layout]
    .sort((a, b) => a.y - b.y || a.x - b.x)
    .map((item) => {
      const next = { ...item, x: 0, y, w: 1, minW: 1 }
      y += item.h
      return next
    })
}
```

Sorting by `y` then `x` is desktop reading order, which is the order the board is already
perceived in. `minW` is clamped to `1` because a widget declaring `minW: 2` would make the
layout invalid at `cols: 1` and React Grid Layout would silently repair it. `h` and `minH` are
inherited unchanged, because vertical size is the only dimension that transfers meaningfully
between grids of different width.

`mobileLayout` can drift out of sync with `instances` — a widget added from the desktop while
the phone was offline, or removed by another device. Relying on every mutator to keep both
arrays correct is fragile, so reconciliation happens on read:

```ts
export const reconcileMobileLayout = (
  stored: LayoutItem[],
  desktop: LayoutItem[],
): LayoutItem[] => {
  const byId = new Map(desktop.map((item) => [item.i, item]))
  const kept = stored.filter((item) => byId.has(item.i))
  const knownIds = new Set(kept.map((item) => item.i))
  const missing = desktop.filter((item) => !knownIds.has(item.i))
  const offset = kept.reduce((max, item) => Math.max(max, item.y + item.h), 0)

  return [...kept, ...deriveMobileLayout(missing).map((it) => ({ ...it, y: it.y + offset }))]
}
```

Stale entries are dropped, missing ones are derived from the desktop layout and appended below,
matching what `makeLayout` already does on the desktop (`x: 0`, `y` at the bottom). Because of
this, `addInstance` does not touch `mobileLayout` at all — reconciliation supplies the entry, and
the next real mobile edit persists it. `removeInstance` filters both arrays purely to keep stored
data tidy.

The two are combined by:

```ts
export const resolveBoardLayout = (board: BoardSnapshot, isMobile: boolean): LayoutItem[] => {
  if (!isMobile) return board.layout
  if (!board.mobileLayout) return deriveMobileLayout(board.layout)
  return reconcileMobileLayout(board.mobileLayout, board.layout)
}
```

## Override lifecycle

`onLayoutChange` fires on mount, after the compactor normalizes the layout — not only on user
action. Persisting whatever arrives there would create `mobileLayout` the first time the board is
opened on a phone, with no interaction at all, permanently collapsing the chosen
derive-and-override behavior into an always-frozen one.

Gating on a live "interacting" flag is not reliable either: the final `onLayoutChange` arrives
*after* `onDragStop`, so the most important change of the gesture would be dropped. Materialization
is therefore bound to the *start* of a gesture:

```
onDragStart / onResizeStart:
  mobile and mobileLayout absent  -> store resolveBoardLayout(board, true) as mobileLayout

onLayoutChange(next):
  desktop                         -> updateLayout(next)          // unchanged
  mobile and mobileLayout present -> updateMobileLayout(next)
  mobile and mobileLayout absent  -> ignore
```

This is independent of callback ordering. Nothing is written on mobile before the first touch;
once a gesture begins the field exists, and every subsequent change — including the final one —
flows into it uniformly. The desktop path is unchanged.

Reset removes the field, returning the board to derived mode. It surfaces as an entry beside the
existing board actions in `packages/client/src/board/ui/BoardSchemaSelect.tsx`, shown only when
`mobileLayout` exists, and available from any device rather than only from a phone.

## Mobile editing and the touch-scroll defect

React Grid Layout depends on `react-draggable@4.6.0`, whose drag start does this
(`build/cjs/Draggable.js:415`):

```js
if (e.type === "touchstart" && !this.props.allowMobileScroll) e.preventDefault();
```

The listener is registered with `{ passive: false }` (line 511), so the `preventDefault` really
does cancel scrolling. The check runs *after* the `handle`/`cancel` test, meaning it only fires
when the touch lands inside the drag handle.

The handle is currently `.widget-drag-handle`, a class on the wrapper around the entire card
(`packages/client/src/board/ui/Board.tsx:52`). On a phone, touching anywhere on a card except a
button or input therefore blocks page scrolling. This is barely noticeable today because a
12-column board is short; at one column the board is always taller than the screen, which turns a
cosmetic bug into a blocking one — the board could not be scrolled at all.

The fix is to make the mobile drag handle a small dedicated grip instead of the whole card:

```
dragConfig.handle = isMobile ? '.widget-drag-grip' : '.widget-drag-handle'
```

A finger on the card body no longer matches the handle selector, `handleDragStart` returns early,
`preventDefault` is not called, and the page scrolls. A finger on the grip drags. The desktop keeps
whole-card dragging, which is better with a mouse and has no scroll conflict. The grip is always
rendered and hidden on desktop via CSS.

Accepted limitation: while a drag is in progress the page still cannot scroll — that is the point
of `preventDefault` — and neither React Grid Layout nor `react-draggable` implements edge
auto-scroll. Moving a card from the first position to the eighth in a single gesture is therefore
impossible on a phone; it takes several passes. This is accepted rather than solved: order is
inherited from the desktop layout, where it is arranged anyway, and mobile tweaking is mostly
about the height of adjacent cards. If it proves annoying, move-up/move-down buttons can be added
later without any schema change.

Resizing on mobile is unchanged: the `se` handle stays, only affects height at one column, and is
a short gesture that does not conflict with scrolling.

## Code layout

All changes are confined to `packages/client/src/board`. The server, `packages/widget-runtime`,
and the storage layer are untouched — from their perspective `root:boards` simply holds JSON of a
slightly different shape.

New:

- `model/grid-metrics.ts` — `MOBILE_BREAKPOINT`, `BASE_WIDTH`, `resolveGridMetrics`.
- `model/mobile-layout.ts` — `deriveMobileLayout`, `reconcileMobileLayout`, `resolveBoardLayout`.

Changed:

- `model/types.ts` — the optional `mobileLayout` field.
- `model/board-model.ts` — new `updateMobileLayout`, `materializeMobileLayout`, and
  `resetMobileLayout` actions; `removeInstance` filters both arrays. `updateLayout`, `addInstance`,
  and `makeLayout` are unchanged.
- `ui/Board.tsx` — resolved metrics instead of the hardcoded `gridConfig`, the conditional handle
  selector, and the three callbacks above.
- `ui/Board.module.css` — grip styles, hidden on desktop.
- `ui/BoardSchemaSelect.tsx` — the reset entry.

Width comes from the existing `useContainerWidth()` call in `Board.tsx:18`. It is deliberately not
lifted into an atom: writing to an atom during render is wrong, and routing it through an effect
buys nothing when the logic already lives in pure functions under `model/`. The component passes a
number, which satisfies the repository convention — computation in `model/`, DOM interop in `ui/`.
`Board.tsx` stays around a hundred lines and does not need splitting.

## Testing

Unit tests on the pure functions carry most of the weight.

`model/grid-metrics.test.ts`:

- At 1920 the metrics equal today's values (`cols: 12`, `rowHeight: 30`, `margin: [10, 10]`) — the
  regression barrier guaranteeing existing 1080p boards do not shift.
- At 3840 the factor is exactly 2.
- Both clamps engage at their bounds.
- The 767/768 boundary switches breakpoint.

`model/mobile-layout.test.ts`:

- Derivation produces reading order (sorted by `y`, then `x`).
- `w` and `minW` are clamped to 1; `h` and `minH` are inherited.
- `y` accumulates so items stack without overlap.
- Reconciliation drops removed instances, appends missing ones below, and leaves stored positions
  untouched.

Component tests extend the existing `ui/Board.test.tsx`, which already provides the federation
mocks and `context.reset()` harness, plus a pixel-tier regression test at line 144. A partial mock
of `react-grid-layout` is needed to override `useContainerWidth`: under jsdom it reports 0, so
everything currently falls through to the `width || 1200` fallback and thus the desktop branch.

- At mobile width, React Grid Layout receives `cols: 1` and the derived layout.
- Mounting at mobile width does **not** create `mobileLayout`. This is the critical test; it
  guards the derive-and-override behavior against degrading into always-frozen.
- After a drag starts, `mobileLayout` exists and equals the derived layout.
- Reset removes the field.

End-to-end: one new `e2e/mobile-board.spec.ts`. No new Playwright project is needed —
`playwright.config.ts` defines a single `chromium` project, and the mobile context is set locally
with `test.use({ viewport: { width: 390, height: 844 }, hasTouch: true })`.

- Cards span the full width.
- `touchstart` on the card body is **not** `defaultPrevented`.
- `touchstart` on the grip **is** `defaultPrevented`.

The last two assert the `Draggable.js:415` behavior directly rather than trying to observe a scroll.

## Risks and accepted limitations

**A stale client can drop an override.** A client running a cached previous build reads a board
containing `mobileLayout`, Zod strips the unknown field, and its next write loses the override.
The window runs from deploy until `autoUpdate` lands on every device. With a single household and
`registerType: 'autoUpdate'` that is minutes, and the cost is a reset to the derived layout rather
than a lost board. If that is not acceptable, `.passthrough()` on the schema would make the old
client preserve the unknown field untouched.

**Simultaneous edits still clobber.** `boards` is written as one whole JSON document under
last-write-wins, so two devices editing at the same time overwrite each other. Splitting the
desktop and mobile layouts into separate fields does not help, because the whole document is the
unit of writing. This is pre-existing and unchanged by this design.

**The 768-1100 px band is a compromise.** Twelve columns are cramped there and the lower clamp only
limits the damage. A third breakpoint is the real fix if it becomes a problem in practice.

**Long-distance reordering on a phone takes several gestures.** See the mobile editing section.
