# F1 — Tier Infrastructure (host) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Give every widget a `tier` derived from its grid-cell size, and let the fullscreen overlay force a dedicated `fullscreen` tier — without breaking the existing `mode` API.

**Architecture:** A new pure module `client/src/widget-host/model/tier.ts` owns the tier vocabulary (`WidgetTier`), the per-widget-type threshold config (`TierConfig`), a project-wide `DEFAULT_TIERS`, and the `resolveTier(size, config)` resolver. The host threads a `tier` field through `WidgetRuntimeProps` → `WidgetFrameContext` → the rendered widget. `Board` computes the tier per instance from its react-grid-layout item `{w, h}`; `FullscreenOverlay` hard-codes `tier="fullscreen"`. The Ofelia widget itself is **not** touched here — consuming `tier` in the UI is F6.

**Tech Stack:** TypeScript (ESM), React + `reatomMemo`, Reatom v1000 atoms/actions, Vitest + Testing Library + jsdom, `react-grid-layout`.

## Global Constraints

- **Scope is host-only.** This plan owns spec contract **4.1 (Tier)**. Do not modify the Ofelia widget UI/model — that is F6.
- **`mode` stays.** `WidgetRuntimeProps.mode: 'small' | 'large'` remains for backward compatibility with other widgets. `tier` is added alongside it, not as a replacement.
- **`tier` is required** on `WidgetRuntimeProps`, `WidgetFrameContext`, and `WidgetFrameProps`. Every host call site must supply it (this plan updates all of them).
- **Tier is computed from grid units, not pixels** — the `{w, h}` of the instance's `LayoutItem` (cols=12, rowHeight=30 in `Board.tsx`), not rendered size.
- **`fullscreen` is NOT part of `resolveTier`.** It is excluded from `TierConfig` and only ever set explicitly by `FullscreenOverlay`.
- **`tiny` is the floor.** `resolveTier` returns `'tiny'` when no larger tier's thresholds are met.
- **Thresholds are tunable** (spec §9): `DEFAULT_TIERS` and the current `defaultSize` (`ofelia-poop-duty` = `{w:3, h:5}`, `clock` = `{w:3, h:4}`) should be chosen so the Ofelia default lands in `standard`. The values in this plan satisfy that; revisit during F6 if the visual fit is wrong.
- **Code style:** match the file you edit. Source files under `widget-host/`, `widget-registry/`, `board/ui/Board.tsx` use **double quotes + semicolons**; `*.test.ts(x)` files across the repo use **single quotes + no semicolons**. New `tier.ts` follows its neighbor `types.ts` (double quotes + semicolons); new `tier.test.ts` follows the test convention (single quotes + no semicolons).
- **Components** use `reatomMemo`; **errors** use errore (errors-as-values) — neither applies to the pure functions/types added here, but keep edits to existing `reatomMemo` components intact.
- **Before PR:** `pnpm test` and `pnpm typecheck` must pass (run from repo root).

---

## File Structure

- **Create** `client/src/widget-host/model/tier.ts` — `WidgetTier`, `TierThreshold`, `TierConfig`, `DEFAULT_TIERS`, `resolveTier`. (Owns contract 4.1.)
- **Create** `client/src/widget-host/model/tier.test.ts` — unit tests for `resolveTier` boundaries + `DEFAULT_TIERS` mapping of real `defaultSize`s.
- **Modify** `client/src/widget-host/model/types.ts` — add `tier: WidgetTier` to `WidgetRuntimeProps`.
- **Modify** `client/src/widget-host/ui/WidgetFrame.context.ts` — add `tier: WidgetTier` to `WidgetFrameContext`.
- **Modify** `client/src/widget-host/ui/WidgetFrame.tsx` — add `tier` to `WidgetFrameProps`, put it in the context, pass it to the rendered widget.
- **Modify** `client/src/widget-host/ui/WidgetFrame.test.tsx` — add `tier` to existing direct renders; add a test that the tier reaches the child widget.
- **Modify** `client/src/widget-registry/model/registry.ts` — add optional `tiers?: TierConfig` to `WidgetType`.
- **Modify** `client/src/board/ui/Board.tsx` — compute `tier` per instance from its layout `{w, h}` and pass it to `WidgetFrame`.
- **Modify** `client/src/board/ui/Board.test.tsx` — add tier-mapping assertions via a probe widget.
- **Modify** `client/src/widget-host/ui/FullscreenOverlay.tsx` — pass `tier="fullscreen"`.
- **Modify** `client/src/widget-host/ui/FullscreenOverlay.test.tsx` — assert the overlay child receives `fullscreen`.
- **Modify** `client/widgets/clock/ui/Clock.test.tsx` — add `tier` to its `props()` helper (compile fix from required `tier`).
- **Modify** `client/widgets/ofelia-poop-duty/ui/OfeliaPoopDuty.test.tsx` — add `tier` to its `props()` helper (compile fix).

---

## Task 1: Tier model (`resolveTier` + `DEFAULT_TIERS`)

**Files:**

- Create: `client/src/widget-host/model/tier.ts`
- Test: `client/src/widget-host/model/tier.test.ts`

**Interfaces:**

- Consumes: nothing.
- Produces:
  - `type WidgetTier = 'tiny' | 'compact' | 'standard' | 'large' | 'fullscreen'`
  - `type TierThreshold = { minW: number; minH: number }`
  - `type TierConfig = { tiny: TierThreshold; compact: TierThreshold; standard: TierThreshold; large: TierThreshold }`
  - `const DEFAULT_TIERS: TierConfig`
  - `function resolveTier(size: { w: number; h: number }, config: TierConfig): WidgetTier`

- [ ] **Step 1: Write the failing test**

Create `client/src/widget-host/model/tier.test.ts`:

```ts
import { describe, expect, it } from 'vitest'
import { DEFAULT_TIERS, resolveTier, type TierConfig } from './tier'

const config: TierConfig = {
  tiny: { minW: 1, minH: 1 },
  compact: { minW: 2, minH: 3 },
  standard: { minW: 3, minH: 5 },
  large: { minW: 5, minH: 7 },
}

describe('resolveTier', () => {
  it('returns the largest tier whose thresholds are both met', () => {
    expect(resolveTier({ w: 6, h: 8 }, config)).toBe('large')
    expect(resolveTier({ w: 3, h: 5 }, config)).toBe('standard')
    expect(resolveTier({ w: 2, h: 3 }, config)).toBe('compact')
  })

  it('falls back to tiny when no larger threshold is met', () => {
    expect(resolveTier({ w: 1, h: 1 }, config)).toBe('tiny')
    expect(resolveTier({ w: 2, h: 2 }, config)).toBe('tiny')
    expect(resolveTier({ w: 0, h: 0 }, config)).toBe('tiny')
  })

  it('requires BOTH width and height to clear a threshold', () => {
    // wide but short -> cannot reach standard (h<5) or large (h<7)
    expect(resolveTier({ w: 12, h: 4 }, config)).toBe('compact')
    // tall but narrow -> cannot reach standard (w<3)
    expect(resolveTier({ w: 2, h: 12 }, config)).toBe('compact')
  })

  it('treats thresholds as inclusive (>=) on exact boundaries', () => {
    expect(resolveTier({ w: 5, h: 7 }, config)).toBe('large')
    expect(resolveTier({ w: 4, h: 6 }, config)).toBe('standard')
  })

  it('never returns fullscreen (it is set explicitly by the overlay)', () => {
    expect(resolveTier({ w: 999, h: 999 }, config)).toBe('large')
  })
})

describe('DEFAULT_TIERS', () => {
  it('maps the Ofelia default size (3x5) to standard', () => {
    expect(resolveTier({ w: 3, h: 5 }, DEFAULT_TIERS)).toBe('standard')
  })

  it('maps the clock default size (3x4) to compact', () => {
    expect(resolveTier({ w: 3, h: 4 }, DEFAULT_TIERS)).toBe('compact')
  })

  it('exposes thresholds for every non-fullscreen tier', () => {
    expect(Object.keys(DEFAULT_TIERS).sort()).toEqual(['compact', 'large', 'standard', 'tiny'])
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm --filter client exec vitest run src/widget-host/model/tier.test.ts`
Expected: FAIL — `Cannot find module './tier'` (file does not exist yet).

- [ ] **Step 3: Write minimal implementation**

Create `client/src/widget-host/model/tier.ts`:

```ts
export type WidgetTier = 'tiny' | 'compact' | 'standard' | 'large' | 'fullscreen'

export type TierThreshold = { minW: number; minH: number }

// Thresholds in grid units (cols=12, rowHeight=30 in Board).
// 'fullscreen' is intentionally excluded — the overlay sets it directly.
export type TierConfig = {
  tiny: TierThreshold
  compact: TierThreshold
  standard: TierThreshold
  large: TierThreshold
}

// Chosen so the Ofelia default (3x5) lands in 'standard' and clock (3x4) in 'compact'.
// Tunable (spec §9).
export const DEFAULT_TIERS: TierConfig = {
  tiny: { minW: 1, minH: 1 },
  compact: { minW: 2, minH: 3 },
  standard: { minW: 3, minH: 5 },
  large: { minW: 5, minH: 7 },
}

// Largest tier whose minW AND minH are both met; floor is 'tiny'.
const RESOLVE_ORDER = ['large', 'standard', 'compact'] as const

export function resolveTier(size: { w: number; h: number }, config: TierConfig): WidgetTier {
  for (const tier of RESOLVE_ORDER) {
    const threshold = config[tier]
    if (size.w >= threshold.minW && size.h >= threshold.minH) return tier
  }
  return 'tiny'
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm --filter client exec vitest run src/widget-host/model/tier.test.ts`
Expected: PASS (all cases green).

- [ ] **Step 5: Commit**

```bash
git add client/src/widget-host/model/tier.ts client/src/widget-host/model/tier.test.ts
git commit -m "feat(widget-host): add widget tier model and resolver"
```

---

## Task 2: Thread `tier` through the host (runtime props → context → widget)

**Files:**

- Modify: `client/src/widget-host/model/types.ts`
- Modify: `client/src/widget-host/ui/WidgetFrame.context.ts`
- Modify: `client/src/widget-host/ui/WidgetFrame.tsx`
- Test: `client/src/widget-host/ui/WidgetFrame.test.tsx`
- Modify (compile fix): `client/widgets/clock/ui/Clock.test.tsx`
- Modify (compile fix): `client/widgets/ofelia-poop-duty/ui/OfeliaPoopDuty.test.tsx`

**Interfaces:**

- Consumes: `WidgetTier` from `client/src/widget-host/model/tier.ts` (Task 1).
- Produces:
  - `WidgetRuntimeProps` gains `tier: WidgetTier`.
  - `WidgetFrameContext` gains `tier: WidgetTier`.
  - `WidgetFrameProps` gains required `tier: WidgetTier`; the rendered widget receives it as a prop.

- [ ] **Step 1: Write the failing test**

Add to `client/src/widget-host/ui/WidgetFrame.test.tsx`. First add the import at the top (next to the existing imports):

```tsx
import type { WidgetRuntimeProps } from '../model/types'
```

Then add this test inside the `describe('WidgetFrame', ...)` block:

```tsx
it('passes the resolved tier to the widget component', async () => {
  const Probe = (props: WidgetRuntimeProps) => <div>tier:{props.tier}</div>
  vi.mocked(findWidgetType).mockReturnValue({
    id: 'probe',
    title: 'Probe',
    description: 'probe widget',
    loadComponent: async () => ({ default: Probe }),
    defaultSize: { w: 3, h: 5 },
    icon: 'Clock',
  })

  render(<WidgetFrame instanceId="probe-1" typeId="probe" mode="large" tier="fullscreen" />)

  expect(await screen.findByText('tier:fullscreen')).toBeInTheDocument()
})
```

Also update the **four existing** `<WidgetFrame ... />` renders in this file to add a `tier` prop (required now), so the file still type-checks:

```tsx
// 1) "shows the restyled error card for an unknown widget type"
render(<WidgetFrame instanceId="inst-2" typeId="missing" mode="small" tier="standard" />)

// 2) "calls onDelete from the unknown-type card"
render(
  <WidgetFrame
    instanceId="inst-2"
    typeId="missing"
    mode="small"
    tier="standard"
    onDelete={onDelete}
  />,
)

// 3) "renders the loadable widget component content"
const { container } = render(
  <WidgetFrame instanceId="inst-1" typeId="clock" mode="small" tier="standard" />,
)

// 4) "shows the loading skeleton while the component is loading"
const { container } = render(
  <WidgetFrame instanceId="inst-skel" typeId="clock" mode="small" tier="standard" />,
)
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm --filter client exec vitest run src/widget-host/ui/WidgetFrame.test.tsx`
Expected: FAIL — the new test renders no `tier:fullscreen` text because `WidgetFrame` does not yet pass `tier` to the widget (and/or a type error that `tier` is not a valid `WidgetFrame` prop).

- [ ] **Step 3a: Add `tier` to runtime props**

In `client/src/widget-host/model/types.ts`, import the tier type and add the field:

```ts
import type { ComponentType } from 'react'
import type { ResolvedTheme } from '@/shared/theme/types'
import { WidgetStorage } from '@/storage/model/widget-storage'
import type { WidgetTier } from './tier'

export type WidgetMode = 'small' | 'large'

export type WidgetRuntimeProps = {
  instanceId: string
  typeId: string
  mode: WidgetMode
  tier: WidgetTier
  theme: ResolvedTheme
  requestFullscreen: () => void
  requestClose: () => void
  reportError: (error: Error) => void
  storage: WidgetStorage
}

export type WidgetComponent = ComponentType<WidgetRuntimeProps>
export type WidgetComponentModule = { default: WidgetComponent }
export type WidgetLoader = () => Promise<WidgetComponentModule>
```

- [ ] **Step 3b: Add `tier` to the frame context**

In `client/src/widget-host/ui/WidgetFrame.context.ts`:

```ts
import { createContext, useContext } from 'react'
import { WidgetMode } from '../model/types'
import type { WidgetTier } from '../model/tier'
import { ResolvedTheme } from '@/shared/theme/types'
import { WidgetStorage } from '@/storage/model/widget-storage'

export interface WidgetFrameContext {
  instanceId: string
  typeId: string
  mode: WidgetMode
  tier: WidgetTier
  theme: ResolvedTheme
  requestFullscreen: () => void
  requestClose: () => void
  reportError: (error: Error) => void
  storage: WidgetStorage
}

export const widgetFrameContext = createContext<WidgetFrameContext | null>(null)

export const useWidgetFrameContext = () => {
  const context = useContext(widgetFrameContext)
  if (!context) throw new Error('WidgetFrameContext is not available')
  return context
}
```

- [ ] **Step 3c: Thread `tier` through `WidgetFrame`**

In `client/src/widget-host/ui/WidgetFrame.tsx`:

1. Add the import (next to the other `../model` imports):

```tsx
import type { WidgetTier } from '../model/tier'
```

2. Add `tier` to `WidgetFrameProps`:

```tsx
export type WidgetFrameProps = {
  instanceId: string
  typeId: string
  mode: WidgetMode
  tier: WidgetTier
  onRequestFullscreen?: () => void
  onRequestClose?: () => void
  onDelete?: () => void
}
```

3. Destructure `tier` from props:

```tsx
  ({
    instanceId,
    typeId,
    mode,
    tier,
    onRequestFullscreen,
    onRequestClose,
    onDelete,
  }) => {
```

4. Put `tier` in the memoized context object and add it to the dependency array:

```tsx
const context = useMemo<WidgetFrameContext>(() => {
  return {
    instanceId,
    typeId,
    mode,
    tier,
    theme,
    requestFullscreen: () => onRequestFullscreen?.(),
    requestClose: () => onRequestClose?.(),
    reportError: (error) => console.warn(`[widget ${instanceId}] error:`, error),
    storage: createWidgetStorage({ instanceId, typeId }),
  }
}, [instanceId, typeId, mode, tier, theme, onRequestFullscreen, onRequestClose])
```

5. Pass `tier` to the rendered widget:

```tsx
<LazyWidget
  instanceId={instanceId}
  typeId={typeId}
  mode={mode}
  tier={tier}
  theme={theme}
  requestFullscreen={context.requestFullscreen}
  requestClose={context.requestClose}
  reportError={context.reportError}
  storage={context.storage}
/>
```

- [ ] **Step 3d: Fix the widget test prop helpers**

In `client/widgets/clock/ui/Clock.test.tsx`, add `tier` to the returned object in `props()`:

```tsx
return {
  instanceId: 'inst-clock',
  typeId: 'clock',
  mode,
  tier: 'standard',
  theme: 'light',
  requestFullscreen: vi.fn(),
  requestClose: vi.fn(),
  reportError: vi.fn(),
  storage: createWidgetStorage({
    instanceId: 'inst-clock',
    typeId: 'clock',
  }),
}
```

In `client/widgets/ofelia-poop-duty/ui/OfeliaPoopDuty.test.tsx`, add `tier` to the returned object in `props()`:

```tsx
return {
  instanceId: 'ofelia-poop-duty-1',
  typeId: 'ofelia-poop-duty',
  mode,
  tier: 'standard',
  theme: 'light',
  requestFullscreen: vi.fn(),
  requestClose: vi.fn(),
  reportError: vi.fn(),
  storage: createWidgetStorage({
    instanceId: 'ofelia-poop-duty-1',
    typeId: 'ofelia-poop-duty',
  }),
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `pnpm --filter client exec vitest run src/widget-host/ui/WidgetFrame.test.tsx client/widgets/clock/ui/Clock.test.tsx client/widgets/ofelia-poop-duty/ui/OfeliaPoopDuty.test.tsx`
Expected: PASS — including the new `tier:fullscreen` assertion.

Then typecheck to confirm no other call sites broke:

Run: `pnpm typecheck`
Expected: PASS (Board/FullscreenOverlay are still missing `tier` and WILL fail typecheck here — that is expected and is fixed in Tasks 3 and 4. If you want a green typecheck before committing, do Steps 3c of Tasks 3 and 4 first. Otherwise commit this task and proceed; the suite goes green at the end of Task 4.)

> Note: `WidgetFrame.test.tsx` does not render `Board`/`FullscreenOverlay`, so its Vitest run is green now. The repo-wide `pnpm typecheck` only goes fully green after Tasks 3–4.

- [ ] **Step 5: Commit**

```bash
git add client/src/widget-host/model/types.ts client/src/widget-host/ui/WidgetFrame.context.ts client/src/widget-host/ui/WidgetFrame.tsx client/src/widget-host/ui/WidgetFrame.test.tsx client/widgets/clock/ui/Clock.test.tsx client/widgets/ofelia-poop-duty/ui/OfeliaPoopDuty.test.tsx
git commit -m "feat(widget-host): thread tier through frame to widgets"
```

---

## Task 3: Registry `tiers?` field + Board tier computation

**Files:**

- Modify: `client/src/widget-registry/model/registry.ts`
- Modify: `client/src/board/ui/Board.tsx`
- Test: `client/src/board/ui/Board.test.tsx`

**Interfaces:**

- Consumes: `resolveTier`, `DEFAULT_TIERS`, `TierConfig` from `client/src/widget-host/model/tier.ts` (Task 1); `WidgetFrame` now requires `tier` (Task 2); `layout` atom items have `{ i, w, h }` (`client/src/board/model/types.ts`).
- Produces: `WidgetType` gains optional `tiers?: TierConfig`; `Board` passes a computed `tier` to every `WidgetFrame`.

- [ ] **Step 1: Write the failing test**

Add to `client/src/board/ui/Board.test.tsx`. The file already mocks `findWidgetType` and resets context in `beforeEach`. Add these imports at the top if not already present:

```tsx
import type { WidgetRuntimeProps } from '../../widget-host/model/types'
import { instances, layout } from '../model/board-model'
```

(`instances` and `layout` are already imported in this file — keep a single import line; only add `WidgetRuntimeProps`.)

Add this test inside `describe('Board', ...)`:

```tsx
it('computes each widget tier from its layout size', async () => {
  const Probe = (props: WidgetRuntimeProps) => <div>tier:{props.tier}</div>
  vi.mocked(findWidgetType).mockImplementation((typeId) => {
    if (typeId === 'probe') {
      return {
        id: 'probe',
        title: 'Probe',
        description: 'probe widget',
        loadComponent: async () => ({ default: Probe }),
        defaultSize: { w: 3, h: 5 },
        icon: 'Clock',
      }
    }
    return registryHolder.actual(typeId)
  })

  instances.set([
    { id: 'big', typeId: 'probe' },
    { id: 'small', typeId: 'probe' },
  ])
  layout.set([
    { i: 'big', x: 0, y: 0, w: 6, h: 8, minW: 2, minH: 2 },
    { i: 'small', x: 0, y: 8, w: 2, h: 2, minW: 2, minH: 2 },
  ])

  render(<Board />)

  expect(await screen.findByText('tier:large')).toBeInTheDocument()
  expect(await screen.findByText('tier:tiny')).toBeInTheDocument()
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm --filter client exec vitest run src/board/ui/Board.test.tsx`
Expected: FAIL — `Board` does not pass `tier` to `WidgetFrame` yet (type error / no `tier:large` text rendered).

- [ ] **Step 3a: Add `tiers?` to `WidgetType`**

In `client/src/widget-registry/model/registry.ts`, import the config type and add the optional field:

```ts
import * as errore from 'errore'
import type { WidgetLoader } from '../../widget-host/model/types'
import type { TierConfig } from '../../widget-host/model/tier'

export type WidgetIconName = 'Clock' | 'CalendarDays'

export type WidgetType = {
  id: string
  title: string
  /** One-line catalog/overlay subtitle. */
  description: string
  loadComponent: WidgetLoader
  defaultSize: { w: number; h: number }
  /** Optional per-type tier thresholds; falls back to DEFAULT_TIERS. */
  tiers?: TierConfig
  /** lucide-react icon name used in the catalog menu. */
  icon: WidgetIconName
}
```

(Do **not** set `tiers` on the existing `clock`/`ofelia-poop-duty` entries — they intentionally use `DEFAULT_TIERS`.)

- [ ] **Step 3b: Compute and pass `tier` in `Board`**

In `client/src/board/ui/Board.tsx`:

1. Add the import (next to the registry import):

```tsx
import { DEFAULT_TIERS, resolveTier } from '../../widget-host/model/tier'
```

2. Inside `currentInstances.map((instance, index) => { ... })`, right after the existing `const type = findWidgetType(instance.typeId);` line, compute the tier:

```tsx
const type = findWidgetType(instance.typeId)
const title = type instanceof Error ? instance.typeId : type.title
const layoutItem = currentLayout.find((item) => item.i === instance.id)
const size = layoutItem ? { w: layoutItem.w, h: layoutItem.h } : { w: 0, h: 0 }
const tiers = type instanceof Error ? DEFAULT_TIERS : (type.tiers ?? DEFAULT_TIERS)
const tier = resolveTier(size, tiers)
```

3. Pass `tier` to the `WidgetFrame`:

```tsx
<WidgetFrame
  instanceId={instance.id}
  typeId={instance.typeId}
  mode="small"
  tier={tier}
  onRequestFullscreen={wrap(() => expandedInstanceId.set(instance.id))}
  onDelete={wrap(() => removeInstance(instance.id))}
/>
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm --filter client exec vitest run src/board/ui/Board.test.tsx`
Expected: PASS — both `tier:large` and `tier:tiny` render.

- [ ] **Step 5: Commit**

```bash
git add client/src/widget-registry/model/registry.ts client/src/board/ui/Board.tsx client/src/board/ui/Board.test.tsx
git commit -m "feat(board): compute widget tier from layout size"
```

---

## Task 4: Fullscreen overlay forces `tier="fullscreen"`

**Files:**

- Modify: `client/src/widget-host/ui/FullscreenOverlay.tsx`
- Test: `client/src/widget-host/ui/FullscreenOverlay.test.tsx`

**Interfaces:**

- Consumes: `WidgetFrame` now requires `tier` (Task 2); `findWidgetType` (mockable per existing patterns); `addInstance`, `expandedInstanceId` from `board-model`.
- Produces: nothing new — completes the contract by guaranteeing the overlay child always renders with `tier === 'fullscreen'`.

- [ ] **Step 1: Write the failing test**

Add to `client/src/widget-host/ui/FullscreenOverlay.test.tsx`. Add imports at the top:

```tsx
import { vi } from 'vitest'
import type { WidgetRuntimeProps } from '../model/types'
import { findWidgetType } from '../../widget-registry/model/registry'
```

(Keep a single `vitest` import line — merge `vi` into the existing `import { beforeEach, describe, expect, it } from 'vitest'`.)

Add the registry mock (top-level, before `describe`), mirroring the pattern used in `WidgetFrame.test.tsx`:

```tsx
const registryHolder = vi.hoisted(() => ({
  actual:
    null as unknown as (typeof import('../../widget-registry/model/registry'))['findWidgetType'],
}))

vi.mock('../../widget-registry/model/registry', async (importActual) => {
  const actual = await importActual<typeof import('../../widget-registry/model/registry')>()
  registryHolder.actual = actual.findWidgetType
  return { ...actual, findWidgetType: vi.fn(actual.findWidgetType) }
})
```

And reset it in `beforeEach` (the block already calls `context.reset()` and `localStorage.clear()`):

```tsx
beforeEach(() => {
  context.reset()
  localStorage.clear()
  vi.mocked(findWidgetType).mockImplementation(registryHolder.actual)
})
```

Add this test inside `describe('FullscreenOverlay', ...)`:

```tsx
it('renders the expanded widget with the fullscreen tier', async () => {
  const Probe = (props: WidgetRuntimeProps) => <div>tier:{props.tier}</div>
  vi.mocked(findWidgetType).mockImplementation((typeId) => {
    if (typeId === 'probe') {
      return {
        id: 'probe',
        title: 'Probe',
        description: 'probe widget',
        loadComponent: async () => ({ default: Probe }),
        defaultSize: { w: 3, h: 5 },
        icon: 'Clock',
      }
    }
    return registryHolder.actual(typeId)
  })

  const id = addInstance('probe')
  if (id instanceof Error) throw id
  expandedInstanceId.set(id)

  render(<FullscreenOverlay />)

  expect(await screen.findByText('tier:fullscreen')).toBeInTheDocument()
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm --filter client exec vitest run src/widget-host/ui/FullscreenOverlay.test.tsx`
Expected: FAIL — `FullscreenOverlay` does not pass `tier` to `WidgetFrame` (type error / no `tier:fullscreen` text).

- [ ] **Step 3: Pass `tier="fullscreen"`**

In `client/src/widget-host/ui/FullscreenOverlay.tsx`, update the `WidgetFrame` render in the body:

```tsx
<WidgetFrame
  instanceId={instance.id}
  typeId={instance.typeId}
  mode="large"
  tier="fullscreen"
  onRequestClose={close}
  onDelete={wrap(() => removeInstance(instance.id))}
/>
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm --filter client exec vitest run src/widget-host/ui/FullscreenOverlay.test.tsx`
Expected: PASS — `tier:fullscreen` renders.

- [ ] **Step 5: Full verification**

Run: `pnpm test`
Expected: PASS (whole workspace suite green).

Run: `pnpm typecheck`
Expected: PASS (no remaining `tier`-missing errors).

- [ ] **Step 6: Commit**

```bash
git add client/src/widget-host/ui/FullscreenOverlay.tsx client/src/widget-host/ui/FullscreenOverlay.test.tsx
git commit -m "feat(widget-host): force fullscreen tier in overlay"
```

---

## Done When

- A widget rendered in a board card receives a `tier` computed from its grid `{w, h}` via `resolveTier` + `DEFAULT_TIERS` (or the type's own `tiers`).
- A widget rendered in the fullscreen overlay receives `tier === 'fullscreen'`.
- `mode` still works unchanged for all widgets.
- Unit tests cover `resolveTier` boundaries and `DEFAULT_TIERS` mapping; component tests confirm Board and Overlay deliver the correct tier to the child; `pnpm test` and `pnpm typecheck` are green.

## Self-Review Notes (spec coverage)

- Spec **4.1** (`WidgetTier`, `TierThreshold`, `TierConfig`, `resolveTier`) → Task 1. ✅
- Spec **4.1** "`WidgetRuntimeProps` gets `tier`; `mode` stays" → Task 2. ✅
- F1 scope "`tiers?: TierConfig` in `WidgetType` (+ `DEFAULT_TIERS`)" → Task 1 (`DEFAULT_TIERS`) + Task 3 (`tiers?`). ✅
- F1 scope "Board computes tier from layout `{w,h}` and passes to `WidgetFrame`" → Task 3. ✅
- F1 scope "`FullscreenOverlay` → `tier="fullscreen"`" → Task 4. ✅
- F1 tests "unit `resolveTier` (borders); Board prokids tier; overlay gives fullscreen" → Tasks 1, 3, 4. ✅
- Out of scope (correctly deferred): Ofelia widget consuming `tier` (F6); final threshold tuning (spec §9).
