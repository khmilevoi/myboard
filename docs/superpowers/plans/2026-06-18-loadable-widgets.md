# Loadable Widgets Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Migrate myboard widgets from iframe-hosted HTML entries to ordinary lazily loaded React components.

**Architecture:** The board keeps the existing widget instance/layout model, but the widget registry stops pointing at HTML URLs and starts exposing typed dynamic imports. `WidgetFrame` remains the host boundary for now, but it renders a `React.lazy` component inside `Suspense` plus a per-widget error boundary instead of creating an iframe and `MessageChannel`. Host capabilities that used to travel over `postMessage` become direct React props.

**Tech Stack:** React 19, Vite, TypeScript, Reatom, Vitest, Testing Library, Playwright, react-grid-layout.

---

## Assumptions And Decision Gate

This plan assumes "loadable components" means first-party React components loaded with dynamic `import()` / `React.lazy`, not the `@loadable/component` package. It also assumes legacy iframe support can be removed rather than kept behind a compatibility mode.

Before implementation, confirm these two points:

- No new loadable dependency is required.
- All widgets are trusted first-party code, so iframe sandbox isolation is no longer a requirement.

If either assumption is wrong, use the alternate route in "Rejected / Deferred Approaches" before executing the tasks.

## Current Code Map

- `client/src/widget-registry/registry.ts` owns widget metadata and currently stores `entry: '/widgets/<id>/index.html'`.
- `client/src/widget-host/WidgetFrame.tsx` owns iframe rendering, load detection, handshake lifecycle, loading skeleton, retry UI, fullscreen/close event wiring, and live theme pushes.
- `client/src/widget-host/widget-connection.ts` is the host-side `MessageChannel` bridge.
- `client/src/shared/widget-bridge/*` is the widget-side bridge contract and parser.
- `client/widgets/*/main.tsx` are iframe HTML entrypoints that call `createWidgetClient()`.
- `client/widgets/*/*.tsx` are already normal React components, but they currently accept a `WidgetClient`.
- `client/vite.config.ts` auto-discovers `widgets/<name>/index.html` files as extra Rollup inputs.
- `client/e2e/widget-interactions.spec.ts` and several unit tests assert iframe behavior directly.

## Target File Structure

Create:

- `client/src/widget-host/types.ts` - shared in-process widget runtime types.
- `client/src/widget-host/WidgetErrorBoundary.tsx` - per-widget render/load error boundary with reset support.
- `client/src/widget-host/WidgetErrorBoundary.test.tsx` - focused tests for reset and fallback behavior.
- `client/widgets/clock/Clock.test.tsx` - direct component tests for small/large clock rendering.

Modify:

- `client/src/widget-registry/registry.ts` - replace `entry` with `loadComponent`.
- `client/src/widget-registry/registry.test.ts` - assert loader metadata and unknown-type behavior.
- `client/src/widget-host/WidgetFrame.tsx` - render lazy components instead of iframes.
- `client/src/widget-host/WidgetFrame.module.css` - rename iframe styling to in-process content styling.
- `client/src/widget-host/WidgetFrame.test.tsx` - replace iframe/handshake tests with lazy render/error/retry tests.
- `client/src/widget-host/FullscreenOverlay.test.tsx` - assert large widget content instead of iframe title.
- `client/src/board/Board.tsx` - remove iframe from grid drag cancel selector.
- `client/src/board/Board.test.tsx` - keep drag-handle coverage and add no-iframe regression if useful.
- `client/src/app/global.css` - replace iframe pointer-events rule with an in-process widget surface rule or remove it if not needed.
- `client/src/env.ts`, `client/src/env.test.ts`, `client/.env.example` - remove handshake timeout config.
- `client/widgets/clock/Clock.tsx` - accept runtime props directly.
- `client/widgets/ofelia-poop-duty/OfeliaPoopDuty.tsx` - accept runtime props directly.
- `client/widgets/ofelia-poop-duty/OfeliaPoopDuty.test.tsx` - remove fake `WidgetClient`.
- `client/vite.config.ts` - remove widget HTML multi-entry discovery.
- `client/e2e/widget-interactions.spec.ts` - remove `frameLocator('iframe')` usage.

Delete after replacement tests pass:

- `client/src/widget-host/widget-connection.ts`
- `client/src/widget-host/widget-connection.test.ts`
- `client/src/shared/widget-bridge/client.ts`
- `client/src/shared/widget-bridge/client.test.ts`
- `client/src/shared/widget-bridge/errors.ts`
- `client/src/shared/widget-bridge/index.ts`
- `client/src/shared/widget-bridge/messages.ts`
- `client/src/shared/widget-bridge/parse.ts`
- `client/src/shared/widget-bridge/parse.test.ts`
- `client/tests/bridge-handshake.test.ts`
- `client/widgets/clock/index.html`
- `client/widgets/clock/main.tsx`
- `client/widgets/ofelia-poop-duty/index.html`
- `client/widgets/ofelia-poop-duty/main.tsx`

Historical docs under `docs/superpowers/specs` and older plans can remain unchanged; they describe earlier architecture decisions.

## Rejected / Deferred Approaches

**A. Direct props + `React.lazy` loaders - recommended.** Lowest runtime complexity, no new dependencies, easiest to test. This is the plan below.

**B. Compatibility adapter that keeps `WidgetClient` in-process.** Faster if many widgets already depend deeply on `WidgetClient`, but it preserves the old bridge abstraction after the iframe is gone. Use only if direct props cause too much churn.

**C. Hybrid registry with both `entry` and `loadComponent`.** Useful for third-party widgets or staged production rollout, but this app currently has first-party widgets only. It would keep iframe code alive and make tests more complex.

---

### Task 1: Introduce In-Process Widget Runtime Types And Registry Loaders

**Files:**

- Create: `client/src/widget-host/types.ts`
- Modify: `client/src/widget-registry/registry.ts`
- Modify: `client/src/widget-registry/registry.test.ts`

- [ ] **Step 1: Write failing registry tests**

Update `client/src/widget-registry/registry.test.ts` so known widget types expose `loadComponent` instead of `entry`.

```ts
it('loads the clock component', async () => {
  const type = findWidgetType('clock')
  if (type instanceof Error) throw type

  expect(type).not.toHaveProperty('entry')
  expect(typeof type.loadComponent).toBe('function')

  const mod = await type.loadComponent()
  expect(mod.default).toBeTypeOf('function')
})
```

Also update the Ofelia test to assert `loadComponent` exists and keep the icon/default size assertions.

- [ ] **Step 2: Run the focused failing test**

Run:

```bash
pnpm --filter client test -- src/widget-registry/registry.test.ts
```

Expected: FAIL because `WidgetType` still has `entry` and no `loadComponent`.

- [ ] **Step 3: Add runtime types**

Create `client/src/widget-host/types.ts`:

```ts
import type { ComponentType } from 'react'
import type { ResolvedTheme } from '../theme/types'

export type WidgetMode = 'small' | 'large'

export type WidgetRuntimeProps = {
  instanceId: string
  typeId: string
  mode: WidgetMode
  theme: ResolvedTheme
  requestFullscreen: () => void
  requestClose: () => void
  reportError: (error: Error) => void
}

export type WidgetComponent = ComponentType<WidgetRuntimeProps>
export type WidgetComponentModule = { default: WidgetComponent }
export type WidgetLoader = () => Promise<WidgetComponentModule>
```

- [ ] **Step 4: Change registry metadata**

In `client/src/widget-registry/registry.ts`, remove `entry` from `WidgetType` and add a typed loader:

```ts
import type { WidgetLoader } from '../widget-host/types'

export type WidgetType = {
  id: string
  title: string
  loadComponent: WidgetLoader
  defaultSize: { w: number; h: number }
  icon: WidgetIconName
}
```

Use explicit dynamic imports:

```ts
{
  id: 'clock',
  title: 'Clock',
  loadComponent: () => import('../../widgets/clock/Clock').then((mod) => ({ default: mod.Clock })),
  defaultSize: { w: 3, h: 2 },
  icon: 'Clock',
}
```

and:

```ts
{
  id: 'ofelia-poop-duty',
  title: 'Какахи Офелии',
  loadComponent: () =>
    import('../../widgets/ofelia-poop-duty/OfeliaPoopDuty').then((mod) => ({
      default: mod.OfeliaPoopDuty,
    })),
  defaultSize: { w: 3, h: 2 },
  icon: 'CalendarDays',
}
```

- [ ] **Step 5: Run the focused registry test**

Run:

```bash
pnpm --filter client test -- src/widget-registry/registry.test.ts
```

Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add client/src/widget-host/types.ts client/src/widget-registry/registry.ts client/src/widget-registry/registry.test.ts
git commit -m "refactor(widgets): register loadable widget components"
```

---

### Task 2: Convert Widget Components From `WidgetClient` To Direct Runtime Props

**Files:**

- Modify: `client/widgets/clock/Clock.tsx`
- Create: `client/widgets/clock/Clock.test.tsx`
- Modify: `client/widgets/ofelia-poop-duty/OfeliaPoopDuty.tsx`
- Modify: `client/widgets/ofelia-poop-duty/OfeliaPoopDuty.test.tsx`

- [ ] **Step 1: Write direct-props tests for Clock**

Create `client/widgets/clock/Clock.test.tsx`:

```tsx
// @vitest-environment jsdom
import { render, screen } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import { Clock } from './Clock'
import type { WidgetRuntimeProps } from '../../src/widget-host/types'

function props(mode: WidgetRuntimeProps['mode']): WidgetRuntimeProps {
  return {
    instanceId: 'inst-clock',
    typeId: 'clock',
    mode,
    theme: 'light',
    requestFullscreen: vi.fn(),
    requestClose: vi.fn(),
    reportError: vi.fn(),
  }
}

describe('Clock', () => {
  it('renders the small clock view', () => {
    render(<Clock {...props('small')} />)
    expect(screen.getByText(/:/)).toBeInTheDocument()
  })

  it('renders the large clock view', () => {
    render(<Clock {...props('large')} />)
    expect(screen.getByText(/:/)).toBeInTheDocument()
    expect(screen.getByText(/\d{4}/)).toBeInTheDocument()
  })
})
```

- [ ] **Step 2: Update Ofelia tests to stop building a fake `WidgetClient`**

In `client/widgets/ofelia-poop-duty/OfeliaPoopDuty.test.tsx`, replace the local fake client with a `WidgetRuntimeProps` helper like the clock test.

- [ ] **Step 3: Run widget tests and verify they fail**

Run:

```bash
pnpm --filter client test -- widgets/clock/Clock.test.tsx widgets/ofelia-poop-duty/OfeliaPoopDuty.test.tsx
```

Expected: FAIL because components still require `{ client }`.

- [ ] **Step 4: Update Clock props**

In `client/widgets/clock/Clock.tsx`, remove `WidgetClient`, `useEffect`, and local mode state. Accept direct runtime props:

```tsx
import { useEffect, useState } from 'react'
import type { WidgetRuntimeProps } from '../../src/widget-host/types'
import styles from './clock.module.css'

export function Clock({ mode }: WidgetRuntimeProps) {
  const now = useNow()
  // existing rendering branches stay the same
}
```

Keep `useEffect` only because `useNow()` still uses it.

- [ ] **Step 5: Update Ofelia props**

In `client/widgets/ofelia-poop-duty/OfeliaPoopDuty.tsx`, remove `WidgetClient`, `WidgetMode`, `useEffect`, and local mode state:

```tsx
import { useEffect, useState } from 'react'
import type { WidgetRuntimeProps } from '../../src/widget-host/types'

export function OfeliaPoopDuty({ mode }: WidgetRuntimeProps) {
  const now = useNow()
  const duty = getOfeliaDutySummary(now)
  // existing rendering branches stay the same
}
```

Again, keep `useEffect` only for `useNow()`.

- [ ] **Step 6: Run widget tests**

Run:

```bash
pnpm --filter client test -- widgets/clock/Clock.test.tsx widgets/ofelia-poop-duty/OfeliaPoopDuty.test.tsx
```

Expected: PASS.

- [ ] **Step 7: Commit**

```bash
git add client/widgets/clock/Clock.tsx client/widgets/clock/Clock.test.tsx client/widgets/ofelia-poop-duty/OfeliaPoopDuty.tsx client/widgets/ofelia-poop-duty/OfeliaPoopDuty.test.tsx
git commit -m "refactor(widgets): accept host runtime props directly"
```

---

### Task 3: Replace `WidgetFrame` Iframe Host With Lazy Component Host

**Files:**

- Create: `client/src/widget-host/WidgetErrorBoundary.tsx`
- Create: `client/src/widget-host/WidgetErrorBoundary.test.tsx`
- Modify: `client/src/widget-host/WidgetFrame.tsx`
- Modify: `client/src/widget-host/WidgetFrame.module.css`
- Modify: `client/src/widget-host/WidgetFrame.test.tsx`
- Modify: `client/src/widget-host/FullscreenOverlay.test.tsx`

- [ ] **Step 1: Write `WidgetErrorBoundary` tests**

Create tests that prove a widget render error shows fallback UI and changing `resetKey` clears the error:

```tsx
// @vitest-environment jsdom
import { fireEvent, render, screen } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import { WidgetErrorBoundary } from './WidgetErrorBoundary'

function Broken() {
  throw new Error('boom')
}

describe('WidgetErrorBoundary', () => {
  it('renders fallback and calls onError', () => {
    const onError = vi.fn()
    render(
      <WidgetErrorBoundary resetKey={0} onRetry={vi.fn()} onError={onError}>
        <Broken />
      </WidgetErrorBoundary>,
    )

    expect(screen.getByText(/widget failed to load/i)).toBeInTheDocument()
    expect(onError).toHaveBeenCalled()
  })

  it('calls retry from the fallback', () => {
    const onRetry = vi.fn()
    render(
      <WidgetErrorBoundary resetKey={0} onRetry={onRetry} onError={vi.fn()}>
        <Broken />
      </WidgetErrorBoundary>,
    )

    fireEvent.click(screen.getByRole('button', { name: /retry/i }))
    expect(onRetry).toHaveBeenCalledTimes(1)
  })
})
```

- [ ] **Step 2: Rewrite `WidgetFrame.test.tsx` around lazy rendering**

Replace iframe assertions with tests for:

- unknown widget type still shows "Widget unavailable";
- known widget renders its direct component content;
- `mode="large"` reaches the component when used by `FullscreenOverlay`;
- Suspense fallback uses the existing skeleton class;
- render/import errors show retry UI.

The old `createWidgetConnection` mock should be removed.

- [ ] **Step 3: Run tests and verify failure**

Run:

```bash
pnpm --filter client test -- src/widget-host/WidgetErrorBoundary.test.tsx src/widget-host/WidgetFrame.test.tsx src/widget-host/FullscreenOverlay.test.tsx
```

Expected: FAIL because `WidgetFrame` still renders an iframe and the boundary does not exist.

- [ ] **Step 4: Implement `WidgetErrorBoundary`**

Create `client/src/widget-host/WidgetErrorBoundary.tsx`:

```tsx
import { Component, type ErrorInfo, type ReactNode } from 'react'
import { AlertTriangle, RotateCw } from 'lucide-react'
import styles from './WidgetFrame.module.css'

type Props = {
  children: ReactNode
  resetKey: number
  onError: (error: Error) => void
  onRetry: () => void
}

type State = { error: Error | null }

export class WidgetErrorBoundary extends Component<Props, State> {
  state: State = { error: null }

  static getDerivedStateFromError(error: Error): State {
    return { error }
  }

  componentDidCatch(error: Error, _info: ErrorInfo) {
    this.props.onError(error)
  }

  componentDidUpdate(prevProps: Props) {
    if (prevProps.resetKey !== this.props.resetKey && this.state.error) {
      this.setState({ error: null })
    }
  }

  render() {
    if (!this.state.error) return this.props.children

    return (
      <div className={styles.errorCard}>
        <AlertTriangle className={styles.errorIcon} size={22} aria-hidden />
        <div>Widget failed to load</div>
        <button className={styles.retry} aria-label="Retry" onClick={this.props.onRetry}>
          <RotateCw size={15} aria-hidden /> Retry
        </button>
      </div>
    )
  }
}
```

- [ ] **Step 5: Replace `WidgetFrame` iframe logic**

In `client/src/widget-host/WidgetFrame.tsx`:

- remove `env`, iframe refs, `createWidgetConnection`, load listeners, and theme-send effect;
- import `lazy`, `Suspense`, and `useMemo`;
- get `type.loadComponent` from registry;
- create the lazy component with `useMemo(() => lazy(type.loadComponent), [type, reloadKey])`;
- pass `instanceId`, `typeId`, `mode`, `theme`, `requestFullscreen`, `requestClose`, and `reportError` props.

Core render shape:

```tsx
const LazyWidget = useMemo(() => {
  if (type instanceof Error) return null
  return lazy(type.loadComponent)
}, [type, reloadKey])
```

```tsx
<div className={styles.frame} data-widget-surface>
  <WidgetErrorBoundary
    resetKey={reloadKey}
    onError={(error) => console.warn(`[widget ${instanceId}] render failed:`, error.message)}
    onRetry={() => setReloadKey((key) => key + 1)}
  >
    <Suspense fallback={<div className={styles.skeleton} aria-hidden />}>
      <LazyWidget
        instanceId={instanceId}
        typeId={typeId}
        mode={mode}
        theme={theme}
        requestFullscreen={() => onRequestFullscreen?.()}
        requestClose={() => onRequestClose?.()}
        reportError={(error) => console.warn(`[widget ${instanceId}] error:`, error)}
      />
    </Suspense>
  </WidgetErrorBoundary>
</div>
```

Guard the JSX above so it only renders when `LazyWidget` is non-null.

- [ ] **Step 6: Rename CSS selectors**

In `WidgetFrame.module.css`, replace `.iframe` with `.content` only if an inner wrapper is introduced. If the lazy component is rendered directly, delete the iframe class entirely and keep `.frame`, `.skeleton`, `.errorCard`, `.errorIcon`, and `.retry`.

- [ ] **Step 7: Update overlay test**

In `FullscreenOverlay.test.tsx`, replace:

```ts
expect(screen.getByTitle(`clock (${id})`)).toBeInTheDocument()
```

with an assertion against visible large widget content, for example:

```ts
expect(screen.getByText(/:/)).toBeInTheDocument()
```

- [ ] **Step 8: Run focused host tests**

Run:

```bash
pnpm --filter client test -- src/widget-host/WidgetErrorBoundary.test.tsx src/widget-host/WidgetFrame.test.tsx src/widget-host/FullscreenOverlay.test.tsx
```

Expected: PASS.

- [ ] **Step 9: Commit**

```bash
git add client/src/widget-host/WidgetErrorBoundary.tsx client/src/widget-host/WidgetErrorBoundary.test.tsx client/src/widget-host/WidgetFrame.tsx client/src/widget-host/WidgetFrame.module.css client/src/widget-host/WidgetFrame.test.tsx client/src/widget-host/FullscreenOverlay.test.tsx
git commit -m "refactor(widget-host): render loadable components"
```

---

### Task 4: Update Board Drag Semantics For In-Process Widgets

**Files:**

- Modify: `client/src/board/Board.tsx`
- Modify: `client/src/board/Board.test.tsx`
- Modify: `client/src/app/global.css`

- [ ] **Step 1: Write/update board assertions**

Keep the existing stable handle test. Add an assertion that the rendered card no longer contains an iframe:

```ts
expect(card.querySelector('iframe')).toBeNull()
```

Use `card` from the existing `render(<Board />)` test. If Testing Library returns an `HTMLElement`, this works directly.

- [ ] **Step 2: Run board tests and verify failure or current gap**

Run:

```bash
pnpm --filter client test -- src/board/Board.test.tsx
```

Expected before Task 3: FAIL if iframe is still rendered. Expected after Task 3: PASS once Board renders the new `WidgetFrame`.

- [ ] **Step 3: Update drag cancel selector**

In `client/src/board/Board.tsx`, replace:

```tsx
dragConfig={{ enabled: true, handle: '.widget-drag-handle', cancel: 'button,iframe' }}
```

with:

```tsx
dragConfig={{
  enabled: true,
  handle: '.widget-drag-handle',
  cancel: 'button,input,textarea,select,a,[data-widget-drag-cancel]',
}}
```

This keeps interactive controls inside future widgets from starting grid drags.

- [ ] **Step 4: Replace global iframe pointer-events rule**

In `client/src/app/global.css`, remove:

```css
body[data-board-interacting='true'] iframe {
  pointer-events: none;
}
```

If drag interactions still need pointer suppression during manual testing, replace it with:

```css
body[data-board-interacting='true'] [data-widget-surface] {
  pointer-events: none;
}
```

Use the replacement only if it does not block the grid's own resize/drag handles.

- [ ] **Step 5: Run focused tests**

Run:

```bash
pnpm --filter client test -- src/board/Board.test.tsx src/widget-host/WidgetFrame.test.tsx
```

Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add client/src/board/Board.tsx client/src/board/Board.test.tsx client/src/app/global.css
git commit -m "refactor(board): remove iframe drag assumptions"
```

---

### Task 5: Remove Bridge, Iframe Entrypoints, And Handshake Env

**Files:**

- Modify: `client/vite.config.ts`
- Modify: `client/src/env.ts`
- Modify: `client/src/env.test.ts`
- Modify: `client/.env.example`
- Delete: `client/src/widget-host/widget-connection.ts`
- Delete: `client/src/widget-host/widget-connection.test.ts`
- Delete: `client/src/shared/widget-bridge/*`
- Delete: `client/tests/bridge-handshake.test.ts`
- Delete: `client/widgets/clock/index.html`
- Delete: `client/widgets/clock/main.tsx`
- Delete: `client/widgets/ofelia-poop-duty/index.html`
- Delete: `client/widgets/ofelia-poop-duty/main.tsx`

- [ ] **Step 1: Search for bridge imports**

Run:

```bash
Get-ChildItem -Path client/src,client/widgets,client/tests -Recurse -File | Select-String -Pattern 'widget-bridge','WidgetClient','createWidgetClient','createWidgetConnection','VITE_WIDGET_HANDSHAKE_TIMEOUT_MS','postMessage','MessageChannel','contentWindow','iframe' -CaseSensitive:$false
```

Expected before cleanup: bridge and iframe files still appear. Use the result as the deletion checklist.

- [ ] **Step 2: Update env tests first**

In `client/src/env.test.ts`, remove timeout-specific cases and keep only validation of `MODE`, `DEV`, and `PROD`.

Expected replacement for the first test:

```ts
it('parses a valid env', () => {
  const env = parseEnv({ MODE: 'development', DEV: true, PROD: false })
  if (env instanceof Error) throw env
  expect(env.MODE).toBe('development')
})
```

- [ ] **Step 3: Remove handshake env schema**

In `client/src/env.ts`, remove `VITE_WIDGET_HANDSHAKE_TIMEOUT_MS` from `envSchema` and delete the handshake timeout comment.

In `client/.env.example`, remove the timeout entry. If the file becomes empty, leave a short comment:

```env
# No client env vars are required by default.
```

- [ ] **Step 4: Simplify Vite config**

In `client/vite.config.ts`, remove:

- `existsSync`, `readdirSync`, and `resolve` imports if they become unused;
- `widgetsDir`;
- `widgetEntries()`;
- `build.rollupOptions.input` custom HTML entries.

Keep the React plugin, `define`, tests, server watch config, and `/api` proxy.

- [ ] **Step 5: Delete obsolete bridge and entrypoint files**

Delete the files listed in this task's "Files" section after all imports are gone.

- [ ] **Step 6: Run cleanup search**

Run:

```bash
Get-ChildItem -Path client/src,client/widgets,client/tests,client/e2e -Recurse -File | Select-String -Pattern 'widget-bridge','WidgetClient','createWidgetClient','createWidgetConnection','VITE_WIDGET_HANDSHAKE_TIMEOUT_MS','postMessage','MessageChannel','contentWindow','frameLocator\\(' -CaseSensitive:$false
```

Expected: no matches in runtime/test code except any intentionally not-yet-updated E2E `frameLocator` references from Task 6.

- [ ] **Step 7: Run focused tests**

Run:

```bash
pnpm --filter client test -- src/env.test.ts src/widget-registry/registry.test.ts src/widget-host/WidgetFrame.test.tsx widgets/clock/Clock.test.tsx widgets/ofelia-poop-duty/OfeliaPoopDuty.test.tsx
```

Expected: PASS.

- [ ] **Step 8: Commit**

```bash
git add client/vite.config.ts client/src/env.ts client/src/env.test.ts client/.env.example client/src client/widgets client/tests
git commit -m "refactor(widgets): remove iframe bridge runtime"
```

---

### Task 6: Update Playwright E2E Coverage

**Files:**

- Modify: `client/e2e/widget-interactions.spec.ts`
- Optionally modify: `client/e2e/pages/BoardPage.ts`

- [ ] **Step 1: Replace iframe locators in fullscreen test**

In `widget can be expanded without duplicate fullscreen or close controls`, replace iframe-specific assertions:

```ts
await expect(board.getCard(0).frameLocator('iframe').getByTitle('Open fullscreen')).toHaveCount(0)
```

with:

```ts
await expect(board.getCard(0).locator('iframe')).toHaveCount(0)
await expect(board.getCard(0).getByRole('button', { name: 'Expand' })).toHaveCount(1)
```

Inside the overlay, replace iframe close-button checks with:

```ts
await expect(overlay.dialog.locator('iframe')).toHaveCount(0)
await expect(page.getByRole('button', { name: 'Close' })).toHaveCount(1)
```

- [ ] **Step 2: Rename and update loading test**

Rename:

```ts
test('widget loading skeleton disappears after the iframe is ready', ...)
```

to:

```ts
test('widget loading skeleton disappears after the loadable component is ready', ...)
```

Replace:

```ts
await expect(card.frameLocator('iframe').locator('body')).toContainText(':')
```

with:

```ts
await expect(card).toContainText(':')
await expect(card.locator('iframe')).toHaveCount(0)
```

- [ ] **Step 3: Keep resize and drag tests**

The resize and drag tests should remain mostly unchanged. Keep the console error guard in the drag test because it protects against runtime regressions after the host boundary changes.

- [ ] **Step 4: Typecheck E2E**

Run:

```bash
pnpm --filter client typecheck:e2e
```

Expected: PASS.

- [ ] **Step 5: Run E2E**

Run:

```bash
pnpm --filter client test:e2e
```

Expected: PASS. If Playwright browsers are not installed in the environment, record the failure and run the unit/build verification in Task 8.

- [ ] **Step 6: Commit**

```bash
git add client/e2e/widget-interactions.spec.ts client/e2e/pages/BoardPage.ts
git commit -m "test(e2e): assert loadable widget rendering"
```

---

### Task 7: Update Documentation And Residual Search

**Files:**

- Modify or create: `docs/superpowers/specs/2026-06-18-loadable-widgets-design.md` if a durable design note is wanted.
- Do not rewrite older historical specs/plans unless explicitly requested.

- [ ] **Step 1: Add a short design note only if implementation needs durable context**

If the implementation branch needs a current architecture note, create `docs/superpowers/specs/2026-06-18-loadable-widgets-design.md` with:

```md
# Loadable Widgets Design

Widgets are first-party React components loaded through typed dynamic imports in
the widget registry. The host passes instance identity, mode, theme, and host
capabilities as props. The iframe bridge and HTML widget entries have been
removed.
```

- [ ] **Step 2: Run residual source search**

Run:

```bash
Get-ChildItem -Path client/src,client/widgets,client/tests,client/e2e -Recurse -File | Select-String -Pattern 'iframe','widget-bridge','WidgetClient','postMessage','MessageChannel','contentWindow','VITE_WIDGET_HANDSHAKE_TIMEOUT_MS' -CaseSensitive:$false
```

Expected: no matches in active source/tests. If matches remain, either remove them or document why they are intentionally retained.

- [ ] **Step 3: Run docs-only search**

Run:

```bash
Get-ChildItem -Path docs -Recurse -File | Select-String -Pattern 'iframe','widget-bridge','postMessage','MessageChannel' -CaseSensitive:$false
```

Expected: older historical docs will still mention iframe. Do not edit them unless the user asks to rewrite history or create a current architecture index.

- [ ] **Step 4: Commit**

```bash
git add docs/superpowers/specs/2026-06-18-loadable-widgets-design.md
git commit -m "docs(widgets): document loadable widget architecture"
```

Skip this commit if no design note was created.

---

### Task 8: Full Verification

**Files:**

- No planned source changes.

- [ ] **Step 1: Run all client unit tests**

Run:

```bash
pnpm --filter client test
```

Expected: PASS.

- [ ] **Step 2: Run client typecheck**

Run:

```bash
pnpm --filter client typecheck
```

Expected: PASS.

- [ ] **Step 3: Run client build**

Run:

```bash
pnpm --filter client build
```

Expected: PASS, with no widget HTML multi-entry output required.

- [ ] **Step 4: Run root test suite**

Run:

```bash
pnpm test
```

Expected: PASS for client and server workspaces.

- [ ] **Step 5: Run E2E smoke**

Run:

```bash
pnpm --filter client test:e2e
```

Expected: PASS. Verify manually from the report if a timing issue appears around lazy component resolution.

- [ ] **Step 6: Final source search**

Run:

```bash
Get-ChildItem -Path client/src,client/widgets,client/tests,client/e2e -Recurse -File | Select-String -Pattern 'iframe','WidgetClient','createWidgetClient','createWidgetConnection','postMessage','MessageChannel','contentWindow' -CaseSensitive:$false
```

Expected: no matches in active source/tests.

- [ ] **Step 7: Commit verification fixes if needed**

```bash
git add -A
git commit -m "test(widgets): verify loadable widget migration"
```

Only commit if verification required code/test fixes not already committed.

## Rollback Plan

If the lazy host causes runtime instability, revert Tasks 3-6 as a group. Task 1 can stay only if the registry supports both `entry` and `loadComponent`; otherwise revert it too. The safest rollback checkpoint is the commit before `refactor(widget-host): render loadable components`.

## Manual Acceptance Checklist

- Adding Clock renders a ticking clock directly in the card.
- Adding Ofelia renders directly in the card.
- No `<iframe>` exists under widget cards or fullscreen overlay.
- Expanding a widget opens one overlay with exactly one host Close button.
- Theme switching still changes host and widget styling.
- Dragging and resizing cards still work.
- Unknown widget type still shows "Widget unavailable".
- Lazy import/render failure shows retry UI and does not crash the whole app.
