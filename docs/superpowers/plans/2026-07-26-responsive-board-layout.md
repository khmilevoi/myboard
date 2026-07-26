# Responsive Board Layout Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make the board render one full-width column below 768 px and scale the 12-column desktop grid as a true zoom, with a mobile layout that is derived from the desktop one and becomes authoritative once the user drags or resizes on a phone.

**Architecture:** Two pure modules under `packages/client/src/board/model/` carry all the logic — `grid-metrics.ts` maps a container width to `{ isMobile, cols, rowHeight, margin }`, and `mobile-layout.ts` derives/reconciles the one-column layout from the desktop one. `BoardSnapshot` gains one optional `mobileLayout` field whose *absence* is the "not yet overridden" state. `Board.tsx` only reads the container width and passes it to those pure functions; new Reatom actions in `board-model.ts` own every write.

**Tech Stack:** TypeScript, React 19, Reatom v1001 (`@reatom/core`), Zod, `react-grid-layout@2.2.3` (v2 config-object API), Vitest + Testing Library + jsdom, Playwright.

**Source spec:** `docs/superpowers/specs/2026-07-26-responsive-board-layout-design.md`

## Global Constraints

- **Work exclusively inside the worktree** `C:\Users\Khmil\JsProjects\myboard\.worktrees\responsive-board-layout` (branch `feat/responsive-board-layout`). Never edit the main checkout at `C:\Users\Khmil\JsProjects\myboard`, which stays on `dev`.
- **All changes are confined to `packages/client/src/board`, `packages/client/src/app/ui/Header.tsx`, and `packages/client/e2e`.** The server, `packages/widget-runtime`, `packages/shared`, and the storage layer are not touched.
- **Storage keys do not change.** `root:boards` and `root:localBoard` keep their namespace and relative key. Only the *value* shape changes, additively, via an `.optional()` Zod field. No migration is written and none is needed.
- **Code style:** TypeScript + ESM, 2-space indentation, single quotes, **no semicolons**, named exports, CSS Modules named `*.module.css`. Match the surrounding file exactly.
- **Every exported React function component must be defined with `reatomMemo`** from `widget-sdk/reatom/reatom-memo`. This is a hard repository rule.
- **Business logic lives in `model/`, DOM interop in `ui/`.** Pure functions and Reatom atoms/actions go under `model/`; `ui/` keeps refs, JSX, and tiny view glue.
- **errore pattern:** return errors as values (`Error | T` unions, `instanceof` narrowing, flat early returns). Do not throw. Nothing in this plan needs to fail, so no new error types are introduced.
- **Reatom:** actions are created with `action(fn, 'namespaced.name')`. Event handlers in JSX are wrapped inline with `wrap(...)` on every render — never hoist a `wrap()` closure to module scope (a hoisted one aborts after `context.reset()`).
- **Commits** use Conventional Commit prefixes, scoped where useful: `feat(board): …`, `test(board): …`, `fix(board): …`.
- **Windows/shell:** run `pnpm` outside any sandbox with escalated permissions. Vitest path filters for client tests are relative to `packages/client`, not the repo root.

---

## File Structure

**Create:**

| File | Responsibility |
| --- | --- |
| `packages/client/src/board/model/grid-metrics.ts` | Width → grid metrics. `MOBILE_BREAKPOINT`, `BASE_WIDTH`, `GridMetrics`, `resolveGridMetrics`. |
| `packages/client/src/board/model/grid-metrics.test.ts` | Unit tests for the above. |
| `packages/client/src/board/model/mobile-layout.ts` | `deriveMobileLayout`, `reconcileMobileLayout`, `resolveBoardLayout`. |
| `packages/client/src/board/model/mobile-layout.test.ts` | Unit tests for the above. |
| `packages/client/e2e/mobile-board.spec.ts` | Playwright: full-width cards, touch-scroll vs. grip. |

**Modify:**

| File | Change |
| --- | --- |
| `packages/client/src/board/model/types.ts` | Optional `mobileLayout` on `BoardSnapshotSchema`. |
| `packages/client/src/board/model/board-model.ts` | `updateMobileLayout`, `materializeMobileLayout`, `resetMobileLayout`; `removeInstance` filters both arrays. |
| `packages/client/src/board/model/board-model.test.ts` | Tests for the three new actions and the `removeInstance` change. |
| `packages/client/src/board/ui/Board.tsx` | Resolved metrics, resolved layout, conditional drag handle, grip element, `data-mobile`, new callbacks. |
| `packages/client/src/board/ui/Board.module.css` | `.grip` styles, hidden unless `data-mobile='true'`. |
| `packages/client/src/board/ui/Board.test.tsx` | Mock `useContainerWidth`, capture grid props, four new tests. |
| `packages/client/src/board/ui/BoardSchemaSelect.tsx` | Optional `onResetMobileLayout` prop + entry. |
| `packages/client/src/board/ui/BoardSchemaSelect.module.css` | `.resetButton` styles. |
| `packages/client/src/board/ui/BoardSchemaSelect.test.tsx` | Tests for the reset entry. |
| `packages/client/src/app/ui/Header.tsx` | Pass `onResetMobileLayout` only when the active board has `mobileLayout`. |
| `packages/client/e2e/pages/BoardPage.ts` | `getGrip(index)` locator. |

---

### Task 1: Grid metrics

**Files:**
- Create: `packages/client/src/board/model/grid-metrics.ts`
- Test: `packages/client/src/board/model/grid-metrics.test.ts`

**Interfaces:**
- Consumes: nothing.
- Produces:
  - `MOBILE_BREAKPOINT: 768`
  - `BASE_WIDTH: 1920`
  - `type GridMetrics = { isMobile: boolean; cols: number; rowHeight: number; margin: [number, number] }`
  - `resolveGridMetrics(width: number): GridMetrics`

**Background you need:** `react-grid-layout@2.2.3` computes column width as `(width - margin[0] * (cols - 1) - containerPadding[0] * 2) / cols`, and `containerPadding` defaults to `margin` when left unset. Scaling `margin` by the same factor as `rowHeight` therefore scales the column width by that factor too — that is what turns the desktop grid into a true zoom instead of a one-axis stretch. `BASE_WIDTH` is 1920 so that `scale === 1` reproduces today's hardcoded `{ cols: 12, rowHeight: 30 }` with the default `[10, 10]` margin exactly, and existing 1080p boards do not shift by a pixel.

- [ ] **Step 1: Install dependencies in the worktree**

The worktree has no `node_modules` yet. From the worktree root:

```bash
pnpm install
```

Expected: install completes. This is required before any test can run.

- [ ] **Step 2: Write the failing test**

Create `packages/client/src/board/model/grid-metrics.test.ts`:

```ts
// @vitest-environment node
import { describe, expect, it } from 'vitest'

import { BASE_WIDTH, MOBILE_BREAKPOINT, resolveGridMetrics } from './grid-metrics'

describe('resolveGridMetrics', () => {
  it('reproduces the previous hardcoded metrics at the base width', () => {
    // Regression barrier: existing 1080p boards must not shift by a pixel.
    expect(resolveGridMetrics(BASE_WIDTH)).toEqual({
      isMobile: false,
      cols: 12,
      rowHeight: 30,
      margin: [10, 10],
    })
  })

  it('scales the desktop grid by exactly two at double the base width', () => {
    expect(resolveGridMetrics(3840)).toEqual({
      isMobile: false,
      cols: 12,
      rowHeight: 60,
      margin: [20, 20],
    })
  })

  it('clamps the scale at 0.75 on narrow desktops', () => {
    expect(resolveGridMetrics(1280)).toEqual({
      isMobile: false,
      cols: 12,
      rowHeight: 22.5,
      margin: [7.5, 7.5],
    })
  })

  it('clamps the scale at 2.5 on ultrawide displays', () => {
    expect(resolveGridMetrics(10_000)).toEqual({
      isMobile: false,
      cols: 12,
      rowHeight: 75,
      margin: [25, 25],
    })
  })

  it('switches to a single column below the mobile breakpoint', () => {
    expect(resolveGridMetrics(MOBILE_BREAKPOINT - 1)).toEqual({
      isMobile: true,
      cols: 1,
      rowHeight: 40,
      margin: [10, 10],
    })
  })

  it('stays on the desktop grid at the breakpoint itself', () => {
    expect(resolveGridMetrics(MOBILE_BREAKPOINT).isMobile).toBe(false)
    expect(resolveGridMetrics(MOBILE_BREAKPOINT).cols).toBe(12)
  })

  it('keeps a fixed row height on mobile regardless of width', () => {
    expect(resolveGridMetrics(320).rowHeight).toBe(40)
    expect(resolveGridMetrics(500).rowHeight).toBe(40)
  })
})
```

- [ ] **Step 3: Run the test to verify it fails**

```bash
pnpm --filter client test -- src/board/model/grid-metrics.test.ts
```

Expected: FAIL — cannot resolve `./grid-metrics`.

- [ ] **Step 4: Write the implementation**

Create `packages/client/src/board/model/grid-metrics.ts`:

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

/**
 * Maps a container width to the grid metrics React Grid Layout is configured with.
 *
 * Below MOBILE_BREAKPOINT the board collapses to a single column with a fixed row
 * height: at one column the column width jumps to ~370 px, and a scaled row would
 * make each step too coarse to size a card with a finger.
 *
 * Above it the whole grid is scaled by one factor. React Grid Layout derives the
 * column width from `width`, `margin` and `containerPadding` (which defaults to
 * `margin`), so scaling the margin scales the column width by the same factor —
 * the grid zooms instead of stretching on one axis, and aspect ratios are preserved.
 */
export const resolveGridMetrics = (width: number): GridMetrics => {
  if (width < MOBILE_BREAKPOINT) {
    return { isMobile: true, cols: 1, rowHeight: 40, margin: [10, 10] }
  }

  const scale = clamp(width / BASE_WIDTH, 0.75, 2.5)
  return { isMobile: false, cols: 12, rowHeight: 30 * scale, margin: [10 * scale, 10 * scale] }
}
```

- [ ] **Step 5: Run the test to verify it passes**

```bash
pnpm --filter client test -- src/board/model/grid-metrics.test.ts
```

Expected: PASS, 7 tests.

- [ ] **Step 6: Commit**

```bash
git add packages/client/src/board/model/grid-metrics.ts packages/client/src/board/model/grid-metrics.test.ts
git commit -m "feat(board): resolve grid metrics from the container width"
```

---

### Task 2: Mobile layout derivation and reconciliation

**Files:**
- Modify: `packages/client/src/board/model/types.ts`
- Create: `packages/client/src/board/model/mobile-layout.ts`
- Test: `packages/client/src/board/model/mobile-layout.test.ts`

**Interfaces:**
- Consumes: `LayoutItem`, `BoardSnapshot` from `./types`.
- Produces:
  - `deriveMobileLayout(layout: LayoutItem[]): LayoutItem[]`
  - `reconcileMobileLayout(stored: LayoutItem[], desktop: LayoutItem[]): LayoutItem[]`
  - `resolveBoardLayout(board: BoardSnapshot, isMobile: boolean): LayoutItem[]`
  - `BoardSnapshot` gains `mobileLayout?: LayoutItem[]`

**Background you need:** `layout` keeps its current meaning — it is both the desktop layout *and* the source the mobile layout is derived from. Do **not** rename it to `desktopLayout`; that would be exactly the dangerous data migration this design avoids. The *absence* of `mobileLayout` is the "not yet overridden" state, so no separate boolean flag exists and flag and data cannot disagree.

- [ ] **Step 1: Write the failing test**

Create `packages/client/src/board/model/mobile-layout.test.ts`:

```ts
// @vitest-environment node
import { describe, expect, it } from 'vitest'

import { deriveMobileLayout, reconcileMobileLayout, resolveBoardLayout } from './mobile-layout'
import type { BoardSnapshot, LayoutItem } from './types'

const desktop: LayoutItem[] = [
  { i: 'right', x: 6, y: 0, w: 3, h: 4, minW: 2, minH: 2 },
  { i: 'left', x: 0, y: 0, w: 3, h: 2, minW: 2 },
  { i: 'bottom', x: 0, y: 4, w: 6, h: 3 },
]

const makeBoard = (overrides: Partial<BoardSnapshot> = {}): BoardSnapshot => ({
  id: 'b1',
  name: 'Board',
  instances: [
    { id: 'right', typeId: 'clock' },
    { id: 'left', typeId: 'clock' },
    { id: 'bottom', typeId: 'clock' },
  ],
  layout: desktop,
  ...overrides,
})

describe('deriveMobileLayout', () => {
  it('stacks items in desktop reading order', () => {
    expect(deriveMobileLayout(desktop).map((item) => item.i)).toEqual(['left', 'right', 'bottom'])
  })

  it('clamps width and minimum width to a single column', () => {
    for (const item of deriveMobileLayout(desktop)) {
      expect(item.x).toBe(0)
      expect(item.w).toBe(1)
      expect(item.minW).toBe(1)
    }
  })

  it('inherits height and minimum height unchanged', () => {
    const derived = deriveMobileLayout(desktop)
    expect(derived.find((item) => item.i === 'right')).toMatchObject({ h: 4, minH: 2 })
    expect(derived.find((item) => item.i === 'bottom')).toMatchObject({ h: 3 })
    expect(derived.find((item) => item.i === 'bottom')?.minH).toBeUndefined()
  })

  it('accumulates y so nothing overlaps', () => {
    expect(deriveMobileLayout(desktop).map((item) => item.y)).toEqual([0, 2, 6])
  })

  it('does not mutate the input', () => {
    const input = [...desktop]
    deriveMobileLayout(input)
    expect(input).toEqual(desktop)
  })
})

describe('reconcileMobileLayout', () => {
  const stored: LayoutItem[] = [
    { i: 'left', x: 0, y: 0, w: 1, h: 5, minW: 1 },
    { i: 'gone', x: 0, y: 5, w: 1, h: 2, minW: 1 },
  ]

  it('drops entries whose instance no longer exists on the desktop', () => {
    expect(reconcileMobileLayout(stored, desktop).map((item) => item.i)).not.toContain('gone')
  })

  it('leaves stored positions untouched', () => {
    expect(reconcileMobileLayout(stored, desktop)[0]).toEqual({
      i: 'left',
      x: 0,
      y: 0,
      w: 1,
      h: 5,
      minW: 1,
    })
  })

  it('appends missing items below the stored ones in reading order', () => {
    const result = reconcileMobileLayout(stored, desktop)
    expect(result.map((item) => item.i)).toEqual(['left', 'right', 'bottom'])
    // offset = max(y + h) over kept items = 0 + 5
    expect(result.find((item) => item.i === 'right')).toMatchObject({ x: 0, y: 5, w: 1, h: 4 })
    expect(result.find((item) => item.i === 'bottom')).toMatchObject({ x: 0, y: 9, w: 1, h: 3 })
  })

  it('derives everything when nothing was stored', () => {
    expect(reconcileMobileLayout([], desktop)).toEqual(deriveMobileLayout(desktop))
  })
})

describe('resolveBoardLayout', () => {
  it('returns the desktop layout untouched on desktop', () => {
    const board = makeBoard({ mobileLayout: [{ i: 'left', x: 0, y: 0, w: 1, h: 9, minW: 1 }] })
    expect(resolveBoardLayout(board, false)).toBe(board.layout)
  })

  it('derives from the desktop layout when no override was stored', () => {
    expect(resolveBoardLayout(makeBoard(), true)).toEqual(deriveMobileLayout(desktop))
  })

  it('reconciles the stored override against the desktop layout', () => {
    const mobileLayout: LayoutItem[] = [{ i: 'left', x: 0, y: 0, w: 1, h: 9, minW: 1 }]
    expect(resolveBoardLayout(makeBoard({ mobileLayout }), true)).toEqual(
      reconcileMobileLayout(mobileLayout, desktop),
    )
  })
})
```

- [ ] **Step 2: Run the test to verify it fails**

```bash
pnpm --filter client test -- src/board/model/mobile-layout.test.ts
```

Expected: FAIL — cannot resolve `./mobile-layout`, plus a TS error on `mobileLayout` not existing on `BoardSnapshot`.

- [ ] **Step 3: Add the optional schema field**

In `packages/client/src/board/model/types.ts`, change `BoardSnapshotSchema` to:

```ts
export const BoardSnapshotSchema = z.object({
  id: z.string(),
  name: z.string(),
  instances: z.array(WidgetInstanceSchema),
  // Desktop layout, and the source the mobile layout is derived from. Renaming
  // this would be a data migration; do not.
  layout: z.array(LayoutItemSchema),
  // Present only once the user has rearranged the board on a mobile-width
  // viewport. Its absence IS the "not yet overridden" state.
  mobileLayout: z.array(LayoutItemSchema).optional(),
})
```

Leave every other export in the file unchanged.

- [ ] **Step 4: Write the implementation**

Create `packages/client/src/board/model/mobile-layout.ts`:

```ts
import type { BoardSnapshot, LayoutItem } from './types'

/**
 * Projects a desktop layout onto a single column.
 *
 * Sorting by y then x is desktop reading order, which is the order the board is
 * already perceived in. minW is clamped to 1 because a widget declaring minW: 2
 * would make the layout invalid at cols: 1 and React Grid Layout would silently
 * repair it. h and minH are inherited unchanged — vertical size is the only
 * dimension that transfers meaningfully between grids of different width.
 */
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

/**
 * Brings a stored mobile layout back in sync with the desktop one.
 *
 * mobileLayout can drift out of sync with the instances — a widget added from the
 * desktop while the phone was offline, or removed by another device. Relying on
 * every mutator to keep both arrays correct is fragile, so this runs on read.
 * Stale entries are dropped and missing ones are derived and appended below,
 * matching what makeLayout already does on the desktop.
 */
export const reconcileMobileLayout = (
  stored: LayoutItem[],
  desktop: LayoutItem[],
): LayoutItem[] => {
  const byId = new Map(desktop.map((item) => [item.i, item]))
  const kept = stored.filter((item) => byId.has(item.i))
  const knownIds = new Set(kept.map((item) => item.i))
  const missing = desktop.filter((item) => !knownIds.has(item.i))
  const offset = kept.reduce((max, item) => Math.max(max, item.y + item.h), 0)

  return [...kept, ...deriveMobileLayout(missing).map((item) => ({ ...item, y: item.y + offset }))]
}

export const resolveBoardLayout = (board: BoardSnapshot, isMobile: boolean): LayoutItem[] => {
  if (!isMobile) return board.layout
  if (!board.mobileLayout) return deriveMobileLayout(board.layout)
  return reconcileMobileLayout(board.mobileLayout, board.layout)
}
```

- [ ] **Step 5: Run the test to verify it passes**

```bash
pnpm --filter client test -- src/board/model/mobile-layout.test.ts
```

Expected: PASS, 12 tests.

- [ ] **Step 6: Confirm the schema change did not break board storage**

```bash
pnpm --filter client test -- src/board/model/board-storage.test.ts
```

Expected: PASS — existing boards have no `mobileLayout` and `.optional()` accepts that.

- [ ] **Step 7: Commit**

```bash
git add packages/client/src/board/model/types.ts packages/client/src/board/model/mobile-layout.ts packages/client/src/board/model/mobile-layout.test.ts
git commit -m "feat(board): derive and reconcile the one-column mobile layout"
```

---

### Task 3: Board model actions for the mobile layout

**Files:**
- Modify: `packages/client/src/board/model/board-model.ts`
- Test: `packages/client/src/board/model/board-model.test.ts`

**Interfaces:**
- Consumes: `resolveBoardLayout` from `./mobile-layout`; `activeBoard` from `./board-storage`; `LayoutItem` from `./types`.
- Produces:
  - `updateMobileLayout(next: LayoutItem[])` — writes `mobileLayout` **only if it already exists**.
  - `materializeMobileLayout()` — writes the resolved mobile layout into `mobileLayout` if it is absent; a no-op otherwise.
  - `resetMobileLayout()` — removes the `mobileLayout` field entirely.
  - `removeInstance(id)` — now also filters `mobileLayout`.

**Background you need:** `onLayoutChange` fires on mount, after the compactor normalizes the layout — not only on user action. Persisting whatever arrives there would create `mobileLayout` the first time the board is opened on a phone, with no interaction at all, permanently collapsing derive-and-override into always-frozen. Gating on a live "interacting" flag does not work either, because the final `onLayoutChange` of a gesture arrives *after* `onDragStop`. So materialization is bound to the *start* of a gesture, and `updateMobileLayout` simply refuses to write when the field is absent. That rule lives in the action, not in the component, so it is testable here.

- [ ] **Step 1: Write the failing tests**

Append to the `describe('board-model', …)` block in `packages/client/src/board/model/board-model.test.ts`:

```ts
  it('ignores a mobile layout update before the layout was materialized', () => {
    addInstance('clock')
    const id = activeBoard()!.instances[0]!.id

    updateMobileLayout([{ i: id, x: 0, y: 0, w: 1, h: 9, minW: 1 }])

    expect(activeBoard()?.mobileLayout).toBeUndefined()
  })

  it('materializes the derived mobile layout once', () => {
    addInstance('clock')
    const id = activeBoard()!.instances[0]!.id

    materializeMobileLayout()

    const materialized = activeBoard()?.mobileLayout
    expect(materialized).toEqual(deriveMobileLayout(activeBoard()!.layout))
    expect(materialized?.[0]).toMatchObject({ i: id, x: 0, w: 1, minW: 1 })

    // A second gesture must not overwrite what the user has already arranged.
    updateMobileLayout([{ i: id, x: 0, y: 0, w: 1, h: 12, minW: 1 }])
    materializeMobileLayout()
    expect(activeBoard()?.mobileLayout?.[0]?.h).toBe(12)
  })

  it('stores a mobile layout update once the layout was materialized', () => {
    addInstance('clock')
    const id = activeBoard()!.instances[0]!.id

    materializeMobileLayout()
    updateMobileLayout([{ i: id, x: 0, y: 0, w: 1, h: 7, minW: 1 }])

    expect(activeBoard()?.mobileLayout).toEqual([{ i: id, x: 0, y: 0, w: 1, h: 7, minW: 1 }])
    // The desktop layout is untouched by mobile edits.
    expect(activeBoard()?.layout?.[0]?.h).not.toBe(7)
  })

  it('drops the mobile layout on reset', () => {
    addInstance('clock')
    materializeMobileLayout()
    expect(activeBoard()?.mobileLayout).toBeDefined()

    resetMobileLayout()

    expect(activeBoard()?.mobileLayout).toBeUndefined()
    expect('mobileLayout' in activeBoard()!).toBe(false)
  })

  it('removes an instance from both layouts', () => {
    addInstance('clock')
    const id = activeBoard()!.instances[0]!.id
    materializeMobileLayout()

    removeInstance(id)

    expect(activeBoard()?.layout).toHaveLength(0)
    expect(activeBoard()?.mobileLayout).toHaveLength(0)
  })
```

Extend the import block at the top of the same file so it reads:

```ts
import {
  addBoard,
  addInstance,
  expandedInstanceId,
  materializeMobileLayout,
  removeBoard,
  removeInstance,
  resetMobileLayout,
  updateBoard,
  updateLayout,
  updateMobileLayout,
} from './board-model'
import { deriveMobileLayout } from './mobile-layout'
```

(`activeBoard`, `activeBoardId`, `boards`, `LOCAL_BOARD_ID`, `localBoard` are already imported from `./board-storage` — leave that import alone.)

- [ ] **Step 2: Run the tests to verify they fail**

```bash
pnpm --filter client test -- src/board/model/board-model.test.ts
```

Expected: FAIL — `materializeMobileLayout`, `updateMobileLayout`, `resetMobileLayout` are not exported.

- [ ] **Step 3: Write the implementation**

In `packages/client/src/board/model/board-model.ts`, add the import:

```ts
import { resolveBoardLayout } from './mobile-layout'
```

Change `removeInstance` to filter both arrays:

```ts
export const removeInstance = action((id: string) => {
  activeBoard.update((active) => {
    if (!active) return active
    return {
      ...active,
      instances: active.instances.filter((instance) => instance.id !== id),
      layout: active.layout.filter((item) => item.i !== id),
      mobileLayout: active.mobileLayout?.filter((item) => item.i !== id),
    }
  })
}, 'board.removeInstance')
```

Append the three new actions at the end of the file:

```ts
/**
 * Persists a mobile-width layout change.
 *
 * Deliberately a no-op while mobileLayout is absent: onLayoutChange also fires on
 * mount, after the compactor normalizes the layout, and writing then would freeze
 * the mobile layout without any user interaction. materializeMobileLayout is what
 * creates the field, and it is bound to the start of a real gesture.
 */
export const updateMobileLayout = action((next: LayoutItem[]) => {
  activeBoard.update((active) => {
    if (!active) return active
    if (!active.mobileLayout) return active
    return { ...active, mobileLayout: next }
  })
}, 'board.updateMobileLayout')

/**
 * Freezes the currently resolved mobile layout into the board, making it
 * authoritative. Called at the start of a drag or resize on a mobile-width
 * viewport. Idempotent: once the field exists the user's own arrangement wins.
 */
export const materializeMobileLayout = action(() => {
  activeBoard.update((active) => {
    if (!active) return active
    if (active.mobileLayout) return active
    return { ...active, mobileLayout: resolveBoardLayout(active, true) }
  })
}, 'board.materializeMobileLayout')

/** Returns the board to derived mode by removing the override entirely. */
export const resetMobileLayout = action(() => {
  activeBoard.update((active) => {
    if (!active) return active
    const next = { ...active }
    delete next.mobileLayout
    return next
  })
}, 'board.resetMobileLayout')
```

- [ ] **Step 4: Run the tests to verify they pass**

```bash
pnpm --filter client test -- src/board/model/board-model.test.ts
```

Expected: PASS — the pre-existing tests plus the 5 new ones.

- [ ] **Step 5: Commit**

```bash
git add packages/client/src/board/model/board-model.ts packages/client/src/board/model/board-model.test.ts
git commit -m "feat(board): add mobile layout materialize, update and reset actions"
```

---

### Task 4: Wire the board grid to the resolved metrics

**Files:**
- Modify: `packages/client/src/board/ui/Board.tsx`
- Modify: `packages/client/src/board/ui/Board.module.css`
- Test: `packages/client/src/board/ui/Board.test.tsx`

**Interfaces:**
- Consumes: `resolveGridMetrics` (Task 1), `resolveBoardLayout` (Task 2), `materializeMobileLayout` / `updateMobileLayout` (Task 3).
- Produces: a `.widget-drag-grip` element inside every card and a `data-mobile` attribute on the board root, both relied on by Tasks 5 and 6.

**Background you need — the touch-scroll defect.** `react-grid-layout` drags through `react-draggable@4.6.0`, whose `handleDragStart` does this (verified at `build/cjs/Draggable.js:415`):

```js
if (e.type === "touchstart" && !this.props.allowMobileScroll) e.preventDefault();
```

The listener is registered with `{ passive: false }`, so that `preventDefault` really does cancel page scrolling — and the check runs *after* the `handle`/`cancel` test, so it only fires when the touch lands inside the drag handle. The handle is currently `.widget-drag-handle`, a class on the wrapper around the entire card. On a phone, touching anywhere on a card except a button or input therefore blocks scrolling. At one column the board is always taller than the screen, which turns a cosmetic bug into a blocking one. The fix is to point the handle at a small dedicated grip on mobile: a finger on the card body then no longer matches the selector, `handleDragStart` returns early, `preventDefault` is not called, and the page scrolls. Desktop keeps whole-card dragging, which is better with a mouse and has no scroll conflict.

`react-grid-layout@2.2.3` exposes no `allowMobileScroll` passthrough — `DragConfig` is `{ enabled, bounded, handle, cancel, threshold }` — so the grip is the fix, not a prop.

- [ ] **Step 1: Write the failing tests**

In `packages/client/src/board/ui/Board.test.tsx`, add the grid mock next to the existing `federation` hoisted mock (keep every existing mock and test as they are):

```tsx
const grid = vi.hoisted(() => ({
  width: 1920,
  props: null as null | Record<string, any>,
}))

// The real grid still renders — every existing test depends on it. The wrapper
// only records the props Board passed, and useContainerWidth is overridden
// because jsdom reports 0 for every measured element, which would send the
// component down the `width || 1200` desktop fallback in every test.
vi.mock('react-grid-layout', async (importActual) => {
  const actual = await importActual<typeof import('react-grid-layout')>()
  const Recorder = (props: Record<string, any>) => {
    grid.props = props
    return createElement(actual.default, props)
  }

  return {
    ...actual,
    default: Recorder,
    useContainerWidth: () => ({
      width: grid.width,
      mounted: true,
      containerRef: { current: null },
      measureWidth: () => {},
    }),
  }
})
```

Add `createElement` and `act` to the existing imports:

```tsx
import { act, fireEvent, render, screen, within } from '@testing-library/react'
import { createElement } from 'react'
```

Reset the width in the existing `beforeEach` (append these two lines to the end of the current body):

```tsx
  grid.width = 1920
  grid.props = null
```

Then append these tests inside `describe('Board', …)`:

```tsx
  it('renders a single column with the derived layout at mobile width', async () => {
    grid.width = 390
    addInstance('clock')
    addInstance('clock')

    render(<Board />)
    await screen.findAllByTestId('widget-card')

    expect(grid.props?.['gridConfig']).toEqual({ cols: 1, rowHeight: 40, margin: [10, 10] })
    expect(grid.props?.['layout']).toEqual(
      deriveMobileLayout(activeBoard()!.layout),
    )
    expect(grid.props?.['dragConfig']?.handle).toBe('.widget-drag-grip')
  })

  it('keeps the twelve-column zoomed grid at desktop width', async () => {
    grid.width = 3840
    addInstance('clock')

    render(<Board />)
    await screen.findByTestId('widget-card')

    expect(grid.props?.['gridConfig']).toEqual({ cols: 12, rowHeight: 60, margin: [20, 20] })
    expect(grid.props?.['layout']).toEqual(activeBoard()!.layout)
    expect(grid.props?.['dragConfig']?.handle).toBe('.widget-drag-handle')
  })

  it('does not create a mobile layout just by mounting at mobile width', async () => {
    // The critical guard: onLayoutChange fires on mount after compaction, so a
    // naive implementation would freeze the mobile layout with no interaction at
    // all and permanently degrade derive-and-override into always-frozen.
    grid.width = 390
    addInstance('clock')

    render(<Board />)
    await screen.findByTestId('widget-card')

    expect(activeBoard()?.mobileLayout).toBeUndefined()
  })

  it('materializes and then persists the mobile layout once a drag starts', async () => {
    grid.width = 390
    addInstance('clock')

    render(<Board />)
    await screen.findByTestId('widget-card')

    const derived = deriveMobileLayout(activeBoard()!.layout)
    act(() => {
      grid.props?.['onDragStart']?.([], null, null, null, new Event('mousedown'), null)
    })
    expect(activeBoard()?.mobileLayout).toEqual(derived)

    const dragged = derived.map((item) => ({ ...item, h: item.h + 3 }))
    act(() => {
      grid.props?.['onLayoutChange']?.(dragged)
    })
    expect(activeBoard()?.mobileLayout).toEqual(dragged)
    expect(activeBoard()?.layout).not.toEqual(dragged)

    act(() => {
      resetMobileLayout()
    })
    expect(activeBoard()?.mobileLayout).toBeUndefined()
  })

  it('renders a drag grip inside every card', async () => {
    grid.width = 390
    addInstance('clock')

    render(<Board />)
    const card = await screen.findByTestId('widget-card')

    expect(card.querySelector('.widget-drag-grip')).not.toBeNull()
  })
```

Extend the model imports at the top of the file:

```tsx
import { addInstance, resetMobileLayout } from '../model/board-model'
import { deriveMobileLayout } from '../model/mobile-layout'
```

- [ ] **Step 2: Run the tests to verify they fail**

```bash
pnpm --filter client test -- src/board/ui/Board.test.tsx
```

Expected: FAIL — `gridConfig` is still the hardcoded `{ cols: 12, rowHeight: 30 }`, there is no grip, and the handle never switches.

- [ ] **Step 3: Rewrite Board.tsx**

Replace the whole of `packages/client/src/board/ui/Board.tsx` with:

```tsx
import { wrap } from '@reatom/core'
import { type CSSProperties } from 'react'
import ReactGridLayout, { useContainerWidth, verticalCompactor } from 'react-grid-layout'
import { reatomMemo } from 'widget-sdk/reatom/reatom-memo'

import { WidgetFrame } from '@/widget-host/ui/WidgetFrame'

import { isBoardInteracting } from '../model/board-interaction-model'
import {
  expandedInstanceId,
  materializeMobileLayout,
  removeInstance,
  updateLayout,
  updateMobileLayout,
} from '../model/board-model'
import { activeBoard } from '../model/board-storage'
import { resolveGridMetrics } from '../model/grid-metrics'
import { resolveBoardLayout } from '../model/mobile-layout'
import { EmptyState } from './EmptyState'

import styles from './Board.module.css'

const FALLBACK_WIDTH = 1200

export const Board = reatomMemo(() => {
  const board = activeBoard()
  const isInteracting = isBoardInteracting()
  const { width, containerRef } = useContainerWidth()
  const gridWidth = width || FALLBACK_WIDTH
  const metrics = resolveGridMetrics(gridWidth)

  if (!board || board.instances.length === 0) {
    return (
      <div className={styles.root}>
        <EmptyState />
      </div>
    )
  }

  return (
    <div className={styles.root} data-interacting={isInteracting} data-mobile={metrics.isMobile}>
      <div ref={containerRef}>
        <ReactGridLayout
          className="layout"
          width={gridWidth}
          layout={resolveBoardLayout(board, metrics.isMobile)}
          gridConfig={{
            cols: metrics.cols,
            rowHeight: metrics.rowHeight,
            margin: metrics.margin,
          }}
          dragConfig={{
            enabled: true,
            // On mobile the handle must NOT be the whole card: react-draggable
            // calls preventDefault on a touchstart that lands inside the handle
            // (Draggable.js:415, registered with { passive: false }), which would
            // block page scrolling on a board that is always taller than the
            // screen at one column.
            handle: metrics.isMobile ? '.widget-drag-grip' : '.widget-drag-handle',
            cancel: 'button,input,textarea,select,a,[data-widget-drag-cancel]',
          }}
          resizeConfig={{ enabled: true, handles: ['se'] }}
          compactor={verticalCompactor}
          onDragStart={wrap(() => {
            isBoardInteracting.setTrue()
            if (metrics.isMobile) materializeMobileLayout()
          })}
          onDragStop={wrap(() => isBoardInteracting.setFalse())}
          onResizeStart={wrap(() => {
            isBoardInteracting.setTrue()
            if (metrics.isMobile) materializeMobileLayout()
          })}
          onResizeStop={wrap(() => isBoardInteracting.setFalse())}
          onLayoutChange={wrap((next) => {
            // updateMobileLayout ignores the call until the field exists, so the
            // on-mount compaction pass cannot freeze the derived layout.
            if (metrics.isMobile) return updateMobileLayout([...next])
            updateLayout([...next])
          })}
        >
          {board.instances.map((instance, index) => (
            <div key={instance.id} data-testid="widget-card" className={styles.gridItem}>
              <div
                className={`${styles.card} widget-drag-handle`}
                style={{ '--i': index } as CSSProperties}
              >
                <span
                  className={`${styles.grip} widget-drag-grip`}
                  data-testid="widget-drag-grip"
                  aria-hidden
                />
                <div className={styles.body}>
                  <WidgetFrame
                    instanceId={instance.id}
                    typeId={instance.typeId}
                    mode="small"
                    onRequestFullscreen={wrap(() => expandedInstanceId.set(instance.id))}
                    onDelete={wrap(() => removeInstance(instance.id))}
                  />
                </div>
              </div>
            </div>
          ))}
        </ReactGridLayout>
      </div>
    </div>
  )
}, 'Board')
```

- [ ] **Step 4: Add the grip styles**

Append to `packages/client/src/board/ui/Board.module.css`:

```css
/* The grip only exists to give react-draggable a small touch target on mobile;
   on desktop the whole card is the handle and the grip is not rendered at all. */
.grip {
  display: none;
}

.root[data-mobile='true'] .grip {
  position: absolute;
  z-index: 3;
  top: 4px;
  left: 50%;
  display: block;
  width: 48px;
  height: 16px;
  transform: translateX(-50%);
  border-radius: 8px;
  background: linear-gradient(var(--border), var(--border)) center / 28px 3px no-repeat;
  cursor: grab;
  touch-action: none;
}

.root[data-mobile='true'] .grip:active {
  cursor: grabbing;
}
```

- [ ] **Step 5: Run the tests to verify they pass**

```bash
pnpm --filter client test -- src/board/ui/Board.test.tsx
```

Expected: PASS — the 6 pre-existing tests plus the 5 new ones. The pre-existing "makes the whole card draggable instead of a dedicated handle element" test still holds: the grip is rendered *inside* the `.widget-drag-handle` element, so `card.firstElementChild` is unchanged.

- [ ] **Step 6: Typecheck the client**

```bash
pnpm --filter client typecheck
```

Expected: no errors in `src/board`. If an unrelated file errors, report the exact error and move on without chasing it.

- [ ] **Step 7: Commit**

```bash
git add packages/client/src/board/ui/Board.tsx packages/client/src/board/ui/Board.module.css packages/client/src/board/ui/Board.test.tsx
git commit -m "feat(board): switch the grid to resolved metrics and a mobile drag grip"
```

---

### Task 5: Reset entry in the board schema popover

**Files:**
- Modify: `packages/client/src/board/ui/BoardSchemaSelect.tsx`
- Modify: `packages/client/src/board/ui/BoardSchemaSelect.module.css`
- Modify: `packages/client/src/board/ui/BoardSchemaSelect.test.tsx`
- Modify: `packages/client/src/app/ui/Header.tsx`

**Interfaces:**
- Consumes: `resetMobileLayout` (Task 3), `activeBoard` from `@/board/model/board-storage`.
- Produces: `BoardSchemaSelectProps` gains `onResetMobileLayout?: () => void`.

**Background you need:** `BoardSchemaSelect` is a presentational component — it receives handlers and knows nothing about Reatom. The visibility rule ("shown only when `mobileLayout` exists") is therefore expressed by `Header` passing the handler or `undefined`. Reset is available from any device, not only from a phone, which is why it lives here rather than behind a mobile-only control.

- [ ] **Step 1: Write the failing tests**

Append to `describe('BoardSchemaSelect', …)` in `packages/client/src/board/ui/BoardSchemaSelect.test.tsx`:

```tsx
  it('emits a mobile layout reset', () => {
    const onResetMobileLayout = vi.fn()

    render(
      <BoardSchemaSelect
        items={items}
        value="main"
        onResetMobileLayout={onResetMobileLayout}
      />,
    )

    fireEvent.click(screen.getByRole('button', { name: currentBoardTrigger }))
    fireEvent.click(screen.getByRole('button', { name: 'Сбросить мобильную раскладку' }))

    expect(onResetMobileLayout).toHaveBeenCalledTimes(1)
  })

  it('hides the reset entry when no mobile layout is stored', () => {
    render(<BoardSchemaSelect items={items} value="main" />)

    fireEvent.click(screen.getByRole('button', { name: currentBoardTrigger }))

    expect(
      screen.queryByRole('button', { name: 'Сбросить мобильную раскладку' }),
    ).not.toBeInTheDocument()
  })
```

- [ ] **Step 2: Run the tests to verify they fail**

```bash
pnpm --filter client test -- src/board/ui/BoardSchemaSelect.test.tsx
```

Expected: FAIL — no such button, plus a TS error on the unknown `onResetMobileLayout` prop.

- [ ] **Step 3: Add the prop and the entry**

In `packages/client/src/board/ui/BoardSchemaSelect.tsx`:

Extend the lucide import to include `RotateCcw`:

```tsx
import { Check, ChevronDown, Pencil, Plus, RotateCcw, Trash2 } from 'lucide-react'
```

Add the prop to `BoardSchemaSelectProps`, after `onDelete`:

```tsx
  onResetMobileLayout?: () => void
```

Add it to the destructured parameter list, after `onDelete`:

```tsx
    onResetMobileLayout,
```

Insert the entry between the create form and `<PopoverArrow …/>` at the end of `PopoverContent`:

```tsx
          {onResetMobileLayout ? (
            <button
              type="button"
              className={styles.resetButton}
              onClick={() => {
                onResetMobileLayout()
                setOpen(false)
              }}
            >
              <RotateCcw size={14} aria-hidden />
              <span>Сбросить мобильную раскладку</span>
            </button>
          ) : null}
```

- [ ] **Step 4: Add the styles**

Append to `packages/client/src/board/ui/BoardSchemaSelect.module.css`:

```css
.resetButton {
  display: flex;
  gap: 8px;
  align-items: center;
  width: 100%;
  margin-top: 8px;
  padding: 8px 10px;
  border: none;
  border-radius: 8px;
  background: transparent;
  color: var(--muted-foreground);
  font: inherit;
  font-size: 13px;
  text-align: left;
  cursor: pointer;
}

.resetButton:hover {
  background: var(--accent-soft);
  color: var(--foreground);
}
```

- [ ] **Step 5: Wire it in the header**

In `packages/client/src/app/ui/Header.tsx`, extend the model import and read the active board inside `BoardSelect`:

```tsx
import { addBoard, removeBoard, resetMobileLayout, updateBoard } from '@/board/model/board-model'
import { activeBoard, activeBoardId, boards, LOCAL_BOARD_ID } from '@/board/model/board-storage'
```

```tsx
export const BoardSelect = reatomMemo(() => {
  const boardItems = boards()
  const boardId = activeBoardId()
  const hasMobileLayout = Boolean(activeBoard()?.mobileLayout)

  const items = useMemo(() => {
    const remoteItems = boardItems?.map((board) => ({ id: board.id, name: board.name })) ?? []

    return [...remoteItems, { id: LOCAL_BOARD_ID, name: 'Локальная', isReadonly: true }]
  }, [boardItems])

  return (
    <BoardSchemaSelect
      items={items}
      value={boardId ?? null}
      onCreate={wrap((name) => addBoard(name))}
      onDelete={wrap((id) => removeBoard(id))}
      onValueChange={wrap((id) => activeBoardId.set(id))}
      onRename={wrap((id, name) => updateBoard(id, name))}
      onResetMobileLayout={hasMobileLayout ? wrap(() => resetMobileLayout()) : undefined}
    />
  )
})
```

- [ ] **Step 6: Run the tests to verify they pass**

```bash
pnpm --filter client test -- src/board/ui/BoardSchemaSelect.test.tsx
```

Expected: PASS — the pre-existing tests plus the 2 new ones.

- [ ] **Step 7: Commit**

```bash
git add packages/client/src/board/ui/BoardSchemaSelect.tsx packages/client/src/board/ui/BoardSchemaSelect.module.css packages/client/src/board/ui/BoardSchemaSelect.test.tsx packages/client/src/app/ui/Header.tsx
git commit -m "feat(board): offer a mobile layout reset in the board schema popover"
```

---

### Task 6: End-to-end mobile behaviour

**Files:**
- Create: `packages/client/e2e/mobile-board.spec.ts`
- Modify: `packages/client/e2e/pages/BoardPage.ts`

**Interfaces:**
- Consumes: the `.widget-drag-grip` class and `data-testid="widget-card"` from Task 4; `HeaderPage.addWidget` from `e2e/pages/HeaderPage.ts`.
- Produces: `BoardPage.getGrip(index: number): Locator`.

**Background you need:** `playwright.config.ts` defines a single `chromium` project, so no new project is needed — the mobile context is set locally with `test.use`. `hasTouch` cannot be changed at runtime, so it is declared in `test.use`; the *viewport* is set to desktop first (the header controls are laid out for it, and seeding goes through them) and switched to phone size inside the test with `page.setViewportSize`, which `useContainerWidth`'s ResizeObserver picks up.

The two touch assertions check `Draggable.js:415` behaviour directly rather than trying to observe a scroll. `react-draggable` registers its `touchstart` listener on the grid item node with `{ passive: false }`; a listener added on `document` in the **bubble** phase therefore runs *after* it and can read `event.defaultPrevented`.

- [ ] **Step 1: Add the grip locator**

In `packages/client/e2e/pages/BoardPage.ts`, add a method next to `getCard`:

```ts
  getGrip(index: number): Locator {
    return this.getCard(index).locator('.widget-drag-grip')
  }
```

- [ ] **Step 2: Write the spec**

Create `packages/client/e2e/mobile-board.spec.ts`:

```ts
import { expect, test, type Page } from '@playwright/test'

import { BoardPage } from './pages/BoardPage.js'
import { HeaderPage } from './pages/HeaderPage.js'

const MOBILE_VIEWPORT = { width: 390, height: 844 }

// hasTouch cannot be changed at runtime, so it is declared here; the viewport
// starts at desktop size because seeding goes through the header controls, and
// is switched to phone size inside each test.
test.use({ hasTouch: true, viewport: { width: 1280, height: 800 } })

async function seedTwoWidgets(page: Page): Promise<void> {
  await page.goto('/')
  await page.evaluate(() => {
    localStorage.clear()
  })
  await page.reload()

  const header = new HeaderPage(page)
  await header.addWidget('Часы')
  await header.addWidget('Часы')
  await expect(new BoardPage(page).widgetCards).toHaveCount(2)

  await page.setViewportSize(MOBILE_VIEWPORT)
  // The grip is only rendered visible once the board resolves to mobile metrics,
  // so this doubles as a wait for the relayout.
  await expect(new BoardPage(page).getGrip(0)).toBeVisible()
}

async function recordTouchPrevention(page: Page): Promise<void> {
  await page.evaluate(() => {
    const store: boolean[] = []
    ;(window as unknown as { __touchPrevented: boolean[] }).__touchPrevented = store
    // Bubble phase on document runs AFTER react-draggable's own listener on the
    // grid item, so defaultPrevented already reflects its decision.
    document.addEventListener('touchstart', (event) => store.push(event.defaultPrevented))
  })
}

const readTouchPrevention = (page: Page): Promise<boolean[]> =>
  page.evaluate(() => (window as unknown as { __touchPrevented: boolean[] }).__touchPrevented)

test('cards span the full width and stack vertically on a phone', async ({ page }) => {
  await seedTwoWidgets(page)

  const board = new BoardPage(page)
  const first = (await board.getCard(0).boundingBox())!
  const second = (await board.getCard(1).boundingBox())!

  expect(first.width).toBeGreaterThan(300)
  expect(Math.abs(first.width - second.width)).toBeLessThan(2)
  expect(second.y).toBeGreaterThanOrEqual(first.y + first.height)
})

test('a touch on the card body leaves the page scrollable', async ({ page }) => {
  await seedTwoWidgets(page)
  await recordTouchPrevention(page)

  const box = (await new BoardPage(page).getCard(0).boundingBox())!
  await page.touchscreen.tap(box.x + 20, box.y + box.height - 20)

  expect(await readTouchPrevention(page)).toEqual([false])
})

test('a touch on the drag grip cancels scrolling so the card can be dragged', async ({ page }) => {
  await seedTwoWidgets(page)
  await recordTouchPrevention(page)

  const grip = (await new BoardPage(page).getGrip(0).boundingBox())!
  await page.touchscreen.tap(grip.x + grip.width / 2, grip.y + grip.height / 2)

  expect(await readTouchPrevention(page)).toEqual([true])
})
```

- [ ] **Step 3: Run the spec**

The suite needs the built client and a server. The self-contained way:

```bash
pnpm test:e2e:docker
```

To iterate on just this file with a stack already up (`ALLOW_TEST_DB_RESET=1 pnpm start:docker`):

```bash
pnpm --filter client exec playwright test e2e/mobile-board.spec.ts
```

Expected: 3 passing tests. If Docker is unavailable in this environment, say so explicitly in the report rather than claiming the suite passed.

- [ ] **Step 4: Commit**

```bash
git add packages/client/e2e/mobile-board.spec.ts packages/client/e2e/pages/BoardPage.ts
git commit -m "test(board): cover the mobile layout and touch-scroll behaviour end to end"
```

---

### Task 7: Full gate and pull request

**Files:** none changed unless the gate reports a problem.

- [ ] **Step 1: Run the full local gate**

From the worktree root:

```bash
pnpm check
```

This is lint + format:check + deps:check + typecheck + all workspace tests. There is no CI on this repo — this run *is* the gate. Fix anything it reports, then re-run until clean. `pnpm format` and `pnpm lint:fix` handle the mechanical failures.

- [ ] **Step 2: Run the browser gate**

```bash
pnpm test:e2e:docker
```

Expected: the whole Playwright suite green, including `mobile-board.spec.ts`. Report the actual result; do not claim success without the output.

- [ ] **Step 3: Verify nothing outside the intended scope changed**

```bash
git diff --stat origin/dev...HEAD
```

Expected: only files listed in the File Structure table above. `AGENTS.md` may show as a type change (`T`) on Windows because it is a symlink — do **not** stage it.

- [ ] **Step 4: Push and open the PR against `dev`**

```bash
git push -u origin feat/responsive-board-layout
gh pr create --base dev
```

The PR body must summarize the scope, list the verification commands actually run with their real outcomes, and note that no storage-key shape changed and no migration is required.
