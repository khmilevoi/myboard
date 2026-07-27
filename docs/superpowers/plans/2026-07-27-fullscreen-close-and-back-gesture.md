# Fullscreen close control and back-gesture dismissal — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Give every widget a visible way out of fullscreen, and make the platform back gesture close the topmost open overlay instead of leaving the PWA.

**Architecture:** A singleton overlay stack in `widget-runtime` mirrors open overlays onto browser history entries; a `popstate` listener reconciles by depth and is the only code path that closes anything. A React hook in `widget-sdk` wraps that stack; the client's shared `Dialog` and `Popover` roots call it so no call site changes. Separately, `clock` and `passport-checker` start rendering the existing `WidgetControls` close button in `mode === 'large'`.

**Tech Stack:** TypeScript, React 19, Radix UI, Reatom v1001, Vitest + Testing Library + jsdom, Playwright.

**Spec:** `docs/superpowers/specs/2026-07-27-fullscreen-close-and-back-gesture-design.md`

## Global Constraints

- Repository style: 2-space indent, single quotes, **no semicolons**, named exports, ESM. Formatting is `oxfmt`'s job — run `pnpm format`, never hand-tune.
- Every exported React function component in `packages/client/src` and `packages/widgets/*` must be defined with `reatomMemo` from `widget-sdk`. This is a hard rule and applies to the new `Dialog` wrapper.
- Widgets import shared code through the `widget-runtime` / `widget-sdk` package names, never through `packages/client/src`.
- `aria-label`s are a compatibility contract: `Развернуть`, `Удалить`, `Закрыть`. Existing unit tests and `packages/client/e2e/pages/BoardPage.ts:25,30` query by them.
- Commit messages use Conventional Commit prefixes, optionally scoped: `feat(widget-runtime): …`, `fix(client): …`.
- All commands run from the worktree root `C:\Users\Khmil\JsProjects\myboard\.worktrees\fullscreen-back`.
- **Machine-specific gate reality:** `pnpm check` on this machine tends to die at `format:check` before it ever reaches the tests. Run `pnpm format` first; if `check` still stops early, run `pnpm lint`, `pnpm deps:check`, `pnpm typecheck` and `pnpm test` individually rather than debugging the aggregate script.
- **Machine-specific test noise:** if the client suite reports roughly forty `localStorage` failures at once, that is the Node 26 webstorage behavior, not damage from this branch. Verify against `dev` before chasing it.
- Vitest path filters are relative to the package, not the repo root.

---

### Task 0: Worktree setup

**Files:** none — environment only.

- [ ] **Step 1: Install dependencies**

The worktree was created with `git worktree add` and has no `node_modules` yet.

Run: `pnpm install`
Expected: completes without an `ERR_PNPM_*` error.

- [ ] **Step 2: Run codegen**

The client catalog, server registry and browser task registry are generated files that the typecheck and several tests import.

Run: `pnpm codegen`
Expected: exits 0.

- [ ] **Step 3: Confirm the baseline is green before changing anything**

Run: `pnpm --filter widget-runtime test`
Expected: PASS. If it does not, stop and report — a red baseline makes every later step ambiguous.

---

### Task 1: The overlay history stack

**Files:**
- Create: `packages/widget-runtime/src/overlay-history.ts`
- Create: `packages/widget-runtime/src/overlay-history.test.ts`
- Modify: `packages/widget-runtime/src/index.ts`

**Interfaces:**
- Consumes: nothing.
- Produces:
  - `type OverlayEntry = { depth: number; close: () => void }`
  - `pushOverlay(close: () => void): OverlayEntry`
  - `dismissOverlay(entry: OverlayEntry): void`
  - `dropOverlay(entry: OverlayEntry): void`
  - `resetOverlayHistory(): void` (test-only)

- [ ] **Step 1: Write the failing test**

Create `packages/widget-runtime/src/overlay-history.test.ts`:

```ts
// @vitest-environment jsdom
import { beforeEach, describe, expect, it, vi } from 'vitest'

import {
  dismissOverlay,
  dropOverlay,
  pushOverlay,
  resetOverlayHistory,
} from './overlay-history'

// The module reconciles against `history.state`, so a simulated back
// navigation must move the state first and then raise the event, exactly as a
// real traversal does. This keeps the unit tests independent of whether jsdom
// implements `history.back()` — one integration test at the bottom covers that
// separately.
function goBackTo(depth: number) {
  history.replaceState({ overlayDepth: depth }, '')
  window.dispatchEvent(new PopStateEvent('popstate', { state: history.state }))
}

beforeEach(() => {
  resetOverlayHistory()
  history.replaceState({}, '')
})

describe('overlay history', () => {
  it('marks a history entry with the depth of the overlay it belongs to', () => {
    pushOverlay(vi.fn())
    expect(history.state).toEqual({ overlayDepth: 1 })

    pushOverlay(vi.fn())
    expect(history.state).toEqual({ overlayDepth: 2 })
  })

  it('closes every overlay deeper than the entry the user landed on', () => {
    const first = vi.fn()
    const second = vi.fn()
    pushOverlay(first)
    pushOverlay(second)

    goBackTo(1)
    expect(second).toHaveBeenCalledOnce()
    expect(first).not.toHaveBeenCalled()

    goBackTo(0)
    expect(first).toHaveBeenCalledOnce()
  })

  it('closes both overlays when the user goes back past two entries at once', () => {
    const first = vi.fn()
    const second = vi.fn()
    pushOverlay(first)
    pushOverlay(second)

    goBackTo(0)
    expect(first).toHaveBeenCalledOnce()
    expect(second).toHaveBeenCalledOnce()
  })

  it('closes nothing a second time when popstate arrives again at the same depth', () => {
    const close = vi.fn()
    pushOverlay(close)

    goBackTo(0)
    goBackTo(0)
    expect(close).toHaveBeenCalledOnce()
  })

  it('ignores a dismiss for an entry that is no longer registered', () => {
    const close = vi.fn()
    const entry = pushOverlay(close)
    goBackTo(0)
    close.mockClear()

    dismissOverlay(entry)
    expect(close).not.toHaveBeenCalled()
  })

  it('gives the history entry back when an overlay closes outside the history flow', () => {
    const close = vi.fn()
    const entry = pushOverlay(close)
    const back = vi.spyOn(history, 'back').mockImplementation(() => undefined)

    dropOverlay(entry)
    expect(back).toHaveBeenCalledOnce()
    expect(close).not.toHaveBeenCalled()

    back.mockRestore()
  })

  it('does not spend a second history entry when the drop follows a user back', () => {
    const close = vi.fn()
    const entry = pushOverlay(close)

    // The user pressed back: popstate already closed and unregistered the
    // overlay. React then unmounts it and the effect cleanup calls dropOverlay
    // on an entry that is gone. This must be a no-op — the guard that keeps the
    // normal path from consuming an extra history entry.
    goBackTo(0)
    const back = vi.spyOn(history, 'back').mockImplementation(() => undefined)

    dropOverlay(entry)
    expect(back).not.toHaveBeenCalled()

    back.mockRestore()
  })

  it('clears a stale depth left in history by a reload', () => {
    history.replaceState({ overlayDepth: 3 }, '')

    pushOverlay(vi.fn())
    expect(history.state).toEqual({ overlayDepth: 1 })
  })
})
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `pnpm --filter widget-runtime exec vitest run src/overlay-history.test.ts`
Expected: FAIL — cannot resolve `./overlay-history`.

- [ ] **Step 3: Write the implementation**

Create `packages/widget-runtime/src/overlay-history.ts`:

```ts
/**
 * Mirrors open overlays onto browser history entries so the platform back
 * gesture collapses the topmost one instead of leaving the application.
 *
 * Browser history is the single source of truth here. Every close path — a
 * close control, Esc, a backdrop click, the OS gesture — turns into
 * `history.back()`, and the `popstate` listener below is the only code that
 * ever invokes an overlay's `close`. Closing directly AND keeping history in
 * sync would maintain two truths that diverge on the first double-back.
 *
 * Reconciliation is by depth rather than "pop one", so two fast back presses
 * and a `history.go(-3)` both resolve correctly instead of stranding an
 * overlay open.
 *
 * `pushState` is called with the current URL, so nothing observable changes:
 * no address bar update, no router involvement, no interaction with the PWA
 * start_url or the service worker.
 */
export type OverlayEntry = { depth: number; close: () => void }

type OverlayHistoryState = { overlayDepth?: number } | null

const stack: OverlayEntry[] = []
let listening = false

const readDepth = (): number => (history.state as OverlayHistoryState)?.overlayDepth ?? 0

const reconcile = (): void => {
  const depth = readDepth()
  while (stack.length > 0 && (stack.at(-1)?.depth ?? 0) > depth) {
    stack.pop()?.close()
  }
}

// Installed lazily rather than at import time, so importing this module has no
// side effect on a document that never opens an overlay — and so a standalone
// widget harness gets the behavior without wiring anything up.
const ensureListening = (): void => {
  if (listening) return
  listening = true
  // A reload with an overlay open leaves a marked entry that no live overlay
  // corresponds to. Without this the first back press afterwards is consumed
  // doing nothing.
  if (readDepth() !== 0) history.replaceState({ ...history.state, overlayDepth: 0 }, '')
  window.addEventListener('popstate', reconcile)
}

export const pushOverlay = (close: () => void): OverlayEntry => {
  ensureListening()
  const entry = { depth: stack.length + 1, close }
  history.pushState({ ...history.state, overlayDepth: entry.depth }, '')
  stack.push(entry)
  return entry
}

/** A close request from the UI — a close control, Esc, a backdrop click. */
export const dismissOverlay = (entry: OverlayEntry): void => {
  if (!stack.includes(entry)) return
  history.back()
}

/**
 * The overlay went away outside the history flow: unmounted, or its owner set
 * `open` to false. Hands the history entry back.
 *
 * The `indexOf` guard carries the load in the common case. When the user
 * presses back, `popstate` has already unregistered the entry and called
 * `close`; React then unmounts and the effect cleanup lands here with an entry
 * that is no longer in the stack, and the early return keeps that path from
 * spending a second history entry.
 */
export const dropOverlay = (entry: OverlayEntry): void => {
  const index = stack.indexOf(entry)
  if (index < 0) return
  stack.splice(index, 1)
  history.back()
}

/**
 * Test-only: returns the module to its pre-import state.
 *
 * It must clear `listening` as well as the stack, not just the stack. The
 * one-time start-up work — dropping a depth left in history by a reload — runs
 * behind that flag, so a test file whose earlier cases already pushed would
 * otherwise never be able to reach it. Removing the listener at the same time
 * keeps the re-install from stacking a second reconciler on the window.
 */
export const resetOverlayHistory = (): void => {
  stack.length = 0
  window.removeEventListener('popstate', reconcile)
  listening = false
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `pnpm --filter widget-runtime exec vitest run src/overlay-history.test.ts`
Expected: PASS, 8 tests.

- [ ] **Step 5: Export it from the package root**

`widget-runtime` exposes only `.` in its `exports` map, so a new module is unreachable until it is re-exported.

Modify `packages/widget-runtime/src/index.ts` — append after the existing `export * from './host-runtime'` line:

```ts
export * from './overlay-history'
```

- [ ] **Step 6: Add the integration check for the real traversal**

The unit tests above simulate `popstate`. This one exercises the actual `history.back()` path, which is the thing production depends on.

Append to `packages/widget-runtime/src/overlay-history.test.ts`:

```ts
describe('overlay history — real history traversal', () => {
  it('closes the overlay when history.back() is called for real', async () => {
    const close = vi.fn()
    const entry = pushOverlay(close)

    dismissOverlay(entry)

    await vi.waitFor(() => expect(close).toHaveBeenCalledOnce())
  })
})
```

- [ ] **Step 7: Run it**

Run: `pnpm --filter widget-runtime exec vitest run src/overlay-history.test.ts`
Expected: PASS, 9 tests.

**If this one test fails with a timeout** while the other eight pass, jsdom did not fire `popstate` for a programmatic traversal. That is a limitation of the test environment, not a defect in the code: delete this `describe` block, leave a one-line comment in its place saying the real traversal is covered by the Playwright test in Task 8, and continue. Do not change the implementation to make it pass.

- [ ] **Step 8: Commit**

```bash
git add packages/widget-runtime/src/overlay-history.ts packages/widget-runtime/src/overlay-history.test.ts packages/widget-runtime/src/index.ts
git commit -m "feat(widget-runtime): mirror open overlays onto browser history"
```

---

### Task 2: The React hook

**Files:**
- Create: `packages/widget-sdk/src/hooks/use-overlay-back-dismiss.ts`
- Create: `packages/widget-sdk/src/hooks/use-overlay-back-dismiss.test.tsx`
- Modify: `packages/widget-sdk/package.json`

**Interfaces:**
- Consumes: `pushOverlay`, `dismissOverlay`, `dropOverlay`, `OverlayEntry`, `resetOverlayHistory` from `widget-runtime` (Task 1).
- Produces: `useOverlayBackDismiss(open: boolean, close: () => void): () => void` — importable as `widget-sdk/hooks/use-overlay-back-dismiss`.

- [ ] **Step 1: Open the subpath in the package exports map**

`packages/widget-sdk/package.json` already has an internal `#hooks/*` alias but no public `./hooks/*` entry, so the file would be unreachable from other packages.

Modify the `exports` block — add the `./hooks/*` line after `./reatom/*`:

```json
  "exports": {
    ".": "./src/index.ts",
    "./lib/utils": "./src/lib/utils.ts",
    "./ui/*": "./src/ui/*.tsx",
    "./reatom/*": "./src/reatom/*.ts",
    "./hooks/*": "./src/hooks/*.ts",
    "./define-widget-client": "./src/define-widget-client.ts",
    "./vite": "./src/vite/index.ts",
    "./test-setup": "./src/test/widget-setup.ts"
  },
```

- [ ] **Step 2: Write the failing test**

Create `packages/widget-sdk/src/hooks/use-overlay-back-dismiss.test.tsx`:

```tsx
// @vitest-environment jsdom
import { fireEvent, render, screen } from '@testing-library/react'
import { useState } from 'react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { resetOverlayHistory } from 'widget-runtime'

import { useOverlayBackDismiss } from './use-overlay-back-dismiss'

function goBackTo(depth: number) {
  history.replaceState({ overlayDepth: depth }, '')
  window.dispatchEvent(new PopStateEvent('popstate', { state: history.state }))
}

function Overlay({ onClose }: { onClose: () => void }) {
  const [open, setOpen] = useState(true)
  const requestDismiss = useOverlayBackDismiss(open, () => {
    setOpen(false)
    onClose()
  })

  return (
    <div>
      <span>{open ? 'open' : 'closed'}</span>
      <button onClick={requestDismiss}>dismiss</button>
    </div>
  )
}

beforeEach(() => {
  resetOverlayHistory()
  history.replaceState({}, '')
})

describe('useOverlayBackDismiss', () => {
  it('registers a history entry while the overlay is open', () => {
    render(<Overlay onClose={vi.fn()} />)
    expect(history.state).toEqual({ overlayDepth: 1 })
  })

  it('closes the overlay when the user navigates back', () => {
    const onClose = vi.fn()
    render(<Overlay onClose={onClose} />)

    goBackTo(0)

    expect(onClose).toHaveBeenCalledOnce()
    expect(screen.getByText('closed')).toBeInTheDocument()
  })

  it('routes its own dismiss through history rather than closing directly', () => {
    const back = vi.spyOn(history, 'back').mockImplementation(() => undefined)
    const onClose = vi.fn()
    render(<Overlay onClose={onClose} />)

    fireEvent.click(screen.getByRole('button', { name: 'dismiss' }))

    expect(back).toHaveBeenCalledOnce()
    expect(onClose).not.toHaveBeenCalled()
    back.mockRestore()
  })

  it('registers nothing while the overlay is closed', () => {
    const Closed = () => {
      useOverlayBackDismiss(false, vi.fn())
      return <span>inert</span>
    }
    render(<Closed />)
    expect(history.state).toEqual({})
  })
})
```

- [ ] **Step 3: Run the test to verify it fails**

Run: `pnpm --filter widget-sdk exec vitest run src/hooks/use-overlay-back-dismiss.test.tsx`
Expected: FAIL — cannot resolve `./use-overlay-back-dismiss`.

- [ ] **Step 4: Write the implementation**

Create `packages/widget-sdk/src/hooks/use-overlay-back-dismiss.ts`:

```ts
import { useCallback, useEffect, useRef } from 'react'
import { dismissOverlay, dropOverlay, pushOverlay, type OverlayEntry } from 'widget-runtime'

/**
 * Registers an open overlay on the browser's history stack and returns the
 * dismiss callback every close path must go through.
 *
 * `close` is held in a ref rather than in the effect's dependency list: it is
 * usually rebuilt on every render, and re-running the effect would push a
 * fresh history entry each time. Same shape as `useModalIsolation` in
 * passport-checker.
 *
 * StrictMode runs this effect mount → cleanup → mount, which is push → drop
 * (a `history.back()`) → push: one entry registered, and the depth the
 * listener reconciles against agrees with the live stack. The cleanup is what
 * makes that true — pushing without unregistering would take two back presses
 * to close.
 */
export const useOverlayBackDismiss = (open: boolean, close: () => void): (() => void) => {
  const closeRef = useRef(close)
  closeRef.current = close
  const entryRef = useRef<OverlayEntry | null>(null)

  useEffect(() => {
    if (!open) return

    const entry = pushOverlay(() => closeRef.current())
    entryRef.current = entry

    return () => {
      entryRef.current = null
      dropOverlay(entry)
    }
  }, [open])

  return useCallback(() => {
    const entry = entryRef.current
    if (entry) dismissOverlay(entry)
    else closeRef.current()
  }, [])
}
```

- [ ] **Step 5: Run the test to verify it passes**

Run: `pnpm --filter widget-sdk exec vitest run src/hooks/use-overlay-back-dismiss.test.tsx`
Expected: PASS, 4 tests.

- [ ] **Step 6: Commit**

```bash
git add packages/widget-sdk/src/hooks/use-overlay-back-dismiss.ts packages/widget-sdk/src/hooks/use-overlay-back-dismiss.test.tsx packages/widget-sdk/package.json
git commit -m "feat(widget-sdk): add the overlay back-dismiss hook"
```

---

### Task 3: Wire the shared Dialog root

**Files:**
- Modify: `packages/client/src/components/ui/dialog.tsx:6`
- Modify: `packages/client/src/widget-host/ui/FullscreenOverlay.test.tsx`

**Interfaces:**
- Consumes: `useOverlayBackDismiss` from `widget-sdk/hooks/use-overlay-back-dismiss` (Task 2).
- Produces: nothing new — `Dialog` keeps its current export name and prop shape. `FullscreenOverlay`, `MyDevicesDialog` and `AddDeviceModal` are not modified.

- [ ] **Step 1: Write the failing test**

Add to `packages/client/src/widget-host/ui/FullscreenOverlay.test.tsx`, inside the existing `describe('FullscreenOverlay', …)` block, after the `closes on Escape` test:

```tsx
  it('collapses when the platform back gesture pops the overlay entry', async () => {
    addInstance('clock')
    const id = localBoard().instances[0]?.id
    if (!id) throw new Error('expected instance id after addInstance')
    expandedInstanceId.set(id)

    render(<FullscreenOverlay />)
    await screen.findByRole('dialog')
    expect(history.state).toMatchObject({ overlayDepth: 1 })

    // A back traversal moves the state first and then raises the event, which
    // is what the reconciler reads. Simulated rather than driven through
    // history.back() so the assertion does not depend on jsdom's traversal
    // timing; the real gesture is covered by e2e in mobile-board.spec.ts.
    history.replaceState({ overlayDepth: 0 }, '')
    window.dispatchEvent(new PopStateEvent('popstate', { state: history.state }))

    expect(expandedInstanceId()).toBeNull()
  })
```

And add `resetOverlayHistory` to the existing `beforeEach` in that file, plus its import:

```tsx
import { resetOverlayHistory } from 'widget-runtime'
```

```tsx
beforeEach(() => {
  context.reset()
  localStorage.clear()
  resetOverlayHistory()
  history.replaceState({}, '')
  activeBoardId.set(LOCAL_BOARD_ID)
  vi.mocked(findWidgetType).mockImplementation(registryHolder.actual)
  federation.loadRemote.mockResolvedValue({
    default: {
      loadComponent: async () => ({ default: StubClockWidget }),
    },
  })
})
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `pnpm --filter client exec vitest run src/widget-host/ui/FullscreenOverlay.test.tsx`
Expected: FAIL on the new test — `history.state` is `null`, nothing registered the overlay.

- [ ] **Step 3: Write the implementation**

Modify `packages/client/src/components/ui/dialog.tsx`. Replace line 6 (`const Dialog = DialogPrimitive.Root`) with:

```tsx
type DialogRootProps = React.ComponentProps<typeof DialogPrimitive.Root>

// Split out because the hook cannot sit behind the `open === undefined` branch
// below. Every close request is routed into `requestDismiss`, which goes
// through history; `popstate` is what eventually calls `onOpenChange(false)`.
const ControlledDialog = reatomMemo<DialogRootProps & { open: boolean }>(
  ({ open, onOpenChange, ...props }) => {
    const requestDismiss = useOverlayBackDismiss(open, () => onOpenChange?.(false))

    return (
      <DialogPrimitive.Root
        open={open}
        onOpenChange={(next) => {
          if (next) onOpenChange?.(true)
          else requestDismiss()
        }}
        {...props}
      />
    )
  },
  'ControlledDialog',
)

/**
 * The shared dialog root, with the platform back gesture wired in for every
 * call site at once — see the overlay-history module in widget-runtime.
 *
 * An uncontrolled dialog keeps Radix's own open state, which this wrapper
 * cannot drive, so it passes straight through. There is no such call site in
 * production (only `primitives.test.tsx`), but the branch must exist: without
 * it an uncontrolled dialog's close request would route into an
 * `onOpenChange` nobody is listening to and the dialog would never shut.
 */
const Dialog = reatomMemo<DialogRootProps>(({ open, ...props }) => {
  if (open === undefined) return <DialogPrimitive.Root {...props} />
  return <ControlledDialog open={open} {...props} />
}, 'Dialog')
```

Add the import at the top of the file, after the existing `reatomMemo` import:

```tsx
import { useOverlayBackDismiss } from 'widget-sdk/hooks/use-overlay-back-dismiss'
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `pnpm --filter client exec vitest run src/widget-host/ui/FullscreenOverlay.test.tsx`
Expected: PASS, 6 tests. In particular `closes on Escape` and `closes when the widget itself calls requestClose` must still pass — they now travel through history, and their continued passing is what proves the round trip works end to end.

- [ ] **Step 5: Check the other dialog call sites still behave**

Run: `pnpm --filter client exec vitest run src/account src/components`
Expected: PASS. These cover `MyDevicesDialog`, `AddDeviceModal` and the uncontrolled-dialog branch in `primitives.test.tsx`.

- [ ] **Step 6: Commit**

```bash
git add packages/client/src/components/ui/dialog.tsx packages/client/src/widget-host/ui/FullscreenOverlay.test.tsx
git commit -m "feat(client): close the topmost dialog on the platform back gesture"
```

---

### Task 4: Wire the shared Popover root

**Files:**
- Modify: `packages/client/src/components/ui/popover.tsx:6`
- Modify: `packages/client/src/components/ui/primitives.test.tsx`

**Interfaces:**
- Consumes: `useOverlayBackDismiss` (Task 2).
- Produces: nothing new. `AddWidgetMenu.tsx:27-29` and `BoardSchemaSelect.tsx:91` are both controlled and are not modified.

- [ ] **Step 1: Write the failing test**

Add to `packages/client/src/components/ui/primitives.test.tsx`, inside the existing top-level `describe`:

```tsx
  it('closes a controlled popover on the platform back gesture', async () => {
    const ControlledPopover = () => {
      const [open, setOpen] = useState(true)
      return (
        <Popover open={open} onOpenChange={setOpen}>
          <PopoverTrigger>open</PopoverTrigger>
          <PopoverContent>inside</PopoverContent>
        </Popover>
      )
    }

    render(<ControlledPopover />)
    expect(await screen.findByText('inside')).toBeInTheDocument()

    history.replaceState({ overlayDepth: 0 }, '')
    window.dispatchEvent(new PopStateEvent('popstate', { state: history.state }))

    await waitFor(() => expect(screen.queryByText('inside')).not.toBeInTheDocument())
  })
```

That file currently imports `{ describe, expect, it }` from `vitest` and nothing from `react`. Extend the imports and add the reset — `waitFor` is already imported from `@testing-library/react`:

```tsx
import { useState } from 'react'
import { beforeEach, describe, expect, it } from 'vitest'
import { resetOverlayHistory } from 'widget-runtime'
```

and, immediately above `describe('ui primitives', …)`:

```tsx
beforeEach(() => {
  resetOverlayHistory()
  history.replaceState({}, '')
})
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `pnpm --filter client exec vitest run src/components/ui/primitives.test.tsx`
Expected: FAIL — the popover content is still in the document.

- [ ] **Step 3: Write the implementation**

Modify `packages/client/src/components/ui/popover.tsx`. Replace line 6 (`const Popover = PopoverPrimitive.Root`) with the same two-component shape as Task 3:

```tsx
type PopoverRootProps = React.ComponentProps<typeof PopoverPrimitive.Root>

const ControlledPopover = reatomMemo<PopoverRootProps & { open: boolean }>(
  ({ open, onOpenChange, ...props }) => {
    const requestDismiss = useOverlayBackDismiss(open, () => onOpenChange?.(false))

    return (
      <PopoverPrimitive.Root
        open={open}
        onOpenChange={(next) => {
          if (next) onOpenChange?.(true)
          else requestDismiss()
        }}
        {...props}
      />
    )
  },
  'ControlledPopover',
)

// Same contract as the shared Dialog root: an uncontrolled popover owns its
// state and passes through untouched.
const Popover = reatomMemo<PopoverRootProps>(({ open, ...props }) => {
  if (open === undefined) return <PopoverPrimitive.Root {...props} />
  return <ControlledPopover open={open} {...props} />
}, 'Popover')
```

Add the import after the existing `reatomMemo` import:

```tsx
import { useOverlayBackDismiss } from 'widget-sdk/hooks/use-overlay-back-dismiss'
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `pnpm --filter client exec vitest run src/components/ui/primitives.test.tsx`
Expected: PASS.

- [ ] **Step 5: Check the popover call sites**

Run: `pnpm --filter client exec vitest run src/board`
Expected: PASS. This covers `AddWidgetMenu` and `BoardSchemaSelect`.

**If a popover test now fails intermittently**, this is the `DismissableLayer` race documented in `CLAUDE.md` surfacing through the extra tick. The declared retreat is to revert this task entirely — the dialogs in Task 3 do not depend on it. Do that rather than adding a timing guard, and note it in the final report.

- [ ] **Step 6: Commit**

```bash
git add packages/client/src/components/ui/popover.tsx packages/client/src/components/ui/primitives.test.tsx
git commit -m "feat(client): close the topmost popover on the platform back gesture"
```

---

### Task 5: The clock's fullscreen close control

**Files:**
- Modify: `packages/widgets/clock/ui/Clock.tsx:26-33`
- Modify: `packages/widgets/clock/ui/Clock.test.tsx:64-68`
- Modify: `packages/widgets/ofelia-poop-duty/ui/OfeliaPoopDuty.test.tsx`

**Interfaces:**
- Consumes: `WidgetControls` and `useWidgetChrome` from `widget-sdk/ui/WidgetControls` — both already exist on this branch. `useWidgetChrome()` returns `{ onClose: requestClose }` when `mode !== 'small'`.
- Produces: nothing.

Note: `clock.module.css` `.root` already carries `position: relative` (line 8), so `placement="overlay"` resolves against the widget content. No CSS change is needed — the spec's note about adding it is stale.

- [ ] **Step 1: Write the failing test**

Replace the existing `has no expand/delete controls in the fullscreen (large) view` test in `packages/widgets/clock/ui/Clock.test.tsx` with:

```tsx
  it('offers a close control, and no expand or delete, in the fullscreen (large) view', () => {
    const widgetProps = props('large')
    renderClock(widgetProps)

    expect(screen.queryByRole('button', { name: 'Развернуть' })).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Удалить' })).not.toBeInTheDocument()

    fireEvent.click(screen.getByRole('button', { name: 'Закрыть' }))
    expect(widgetProps.requestClose).toHaveBeenCalledOnce()
  })
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `pnpm --filter clock exec vitest run ui/Clock.test.tsx`
Expected: FAIL — no button named `Закрыть`.

- [ ] **Step 3: Write the implementation**

Modify the `mode === 'large'` branch of `packages/widgets/clock/ui/Clock.tsx`:

```tsx
  if (mode === 'large') {
    return (
      <div className={styles.root}>
        <WidgetControls {...chrome} />
        <div className={styles.timeLarge}>{timeFmt.format(now)}</div>
        <div className={styles.date}>{dateFmt.format(now)}</div>
      </div>
    )
  }
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `pnpm --filter clock exec vitest run ui/Clock.test.tsx`
Expected: PASS, 4 tests.

- [ ] **Step 5: Add the same guard for ofelia**

Ofelia already draws a close control — `OfeliaPoopDuty.tsx:171-173` routes `tier === 'fullscreen'` to `<FullscreenTier onClose={requestClose} />` — so this test should pass on the first run. It exists so the guarantee is asserted for every widget rather than assumed for two of them.

Add to `packages/widgets/ofelia-poop-duty/ui/OfeliaPoopDuty.test.tsx`, inside `describe('OfeliaPoopDuty tier routing', …)`. That file's `props(tier)` helper hardcodes `mode: 'small'`, so the mode is overridden here to match how the host actually mounts a fullscreen widget. The widget loads asynchronously, hence `waitForLoaded()` — both helpers already exist in the file (lines 45, 62, 80):

```tsx
  it('fullscreen — offers a close control', async () => {
    // Every widget must give the user a way out of fullscreen: a phone has no
    // Esc key, and the dialog panel leaves only a few pixels of backdrop to hit.
    const widgetProps = { ...props('fullscreen'), mode: 'large' as const }
    renderWidget(widgetProps)
    await waitForLoaded()

    fireEvent.click(screen.getByRole('button', { name: 'Закрыть' }))
    expect(widgetProps.requestClose).toHaveBeenCalledOnce()
  })
```

- [ ] **Step 6: Run it**

Run: `pnpm --filter ofelia-poop-duty exec vitest run ui/OfeliaPoopDuty.test.tsx`
Expected: PASS.

- [ ] **Step 7: Commit**

```bash
git add packages/widgets/clock/ui/Clock.tsx packages/widgets/clock/ui/Clock.test.tsx packages/widgets/ofelia-poop-duty/ui/OfeliaPoopDuty.test.tsx
git commit -m "feat(clock): give the fullscreen clock a close control"
```

---

### Task 6: The passport-checker's fullscreen close control

**Files:**
- Modify: `packages/widgets/passport-checker/ui/PassportChecker.tsx:60-72`
- Modify: `packages/widgets/passport-checker/ui/tiers/StandardTier.tsx:11-26`
- Modify: `packages/widgets/passport-checker/ui/tiers/TinyTier.tsx:138-141` and its props type
- Modify: `packages/widgets/passport-checker/ui/PassportChecker.test.tsx`

**Interfaces:**
- Consumes: `useWidgetChrome` (already on this branch).
- Produces: `StandardTierProps` and the tiny tier's props type each gain `onClose?: () => void`.

The widget deliberately offers no expand affordance, so it must keep destructuring named fields rather than spreading the whole chrome object — spreading would introduce a `Развернуть` button that this widget has decided not to have.

- [ ] **Step 1: Write the failing test**

Add to `packages/widgets/passport-checker/ui/PassportChecker.test.tsx`, at the end of `describe('PassportChecker / standard tier', …)`. That file's `renderWidget(tier, invoke)` helper cannot set the mode, so this test builds the props through `makeProps` (line 21) and renders directly — `makeFakeStorage` is at line 12. Vitest globals are enabled in this package, so `vi`, `describe`, `it` and `expect` need no import:

```tsx
  it('offers a close control, and no delete, on the fullscreen mount', () => {
    const widgetProps = makeProps(
      'fullscreen',
      vi.fn(),
      'inst-passport-fullscreen',
      makeFakeStorage(),
      'large',
    )
    render(
      <WidgetRuntimeContext.Provider value={widgetProps}>
        <PassportChecker />
      </WidgetRuntimeContext.Provider>,
    )

    expect(screen.queryByRole('button', { name: 'Удалить' })).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Развернуть' })).not.toBeInTheDocument()

    fireEvent.click(screen.getByRole('button', { name: 'Закрыть' }))
    expect(widgetProps.requestClose).toHaveBeenCalledOnce()
  })
```

Both `mode: 'large'` and `tier: 'fullscreen'` matter and are not interchangeable: the tier selects `StandardTier`, and the mode is what makes `useWidgetChrome()` return `onClose` instead of `onExpand` + `onDelete`.

- [ ] **Step 2: Run the test to verify it fails**

Run: `pnpm --filter passport-checker exec vitest run ui/PassportChecker.test.tsx`
Expected: FAIL — no button named `Закрыть`.

- [ ] **Step 3: Thread the callback through**

In `packages/widgets/passport-checker/ui/PassportChecker.tsx`, replace the `useWidgetChrome` destructuring and the tier render:

```tsx
  // Named fields rather than a spread: this widget deliberately offers no
  // expand affordance, and `requestFullscreen` above exists solely to restore
  // fullscreen after the recovery modal closes. Exactly one of the two is
  // defined in any given mode, so each tier still shows a single button.
  const { onDelete, onClose } = useWidgetChrome()

  return (
    <passportCheckerContext.Provider value={value}>
      <div className={styles.widget} data-tier={tier}>
        {isStandardLayout(tier) ? (
          <StandardTier onOpenRecovery={openRecovery} onDelete={onDelete} onClose={onClose} />
        ) : (
          <TinyTier onOpenRecovery={openRecovery} onDelete={onDelete} onClose={onClose} />
        )}
      </div>
```

In `packages/widgets/passport-checker/ui/tiers/StandardTier.tsx`:

```tsx
export type StandardTierProps = {
  onOpenRecovery: () => void
  onDelete?: () => void
  onClose?: () => void
}

export const StandardTier = reatomMemo(
  ({ onOpenRecovery, onDelete, onClose }: StandardTierProps) => {
```

and its controls line:

```tsx
      <WidgetControls onDelete={onDelete} onClose={onClose} />
```

In `packages/widgets/passport-checker/ui/tiers/TinyTier.tsx`, make the same three edits: add `onClose?: () => void` to the props type, destructure it, and render `<WidgetControls onDelete={onDelete} onClose={onClose} />`.

- [ ] **Step 4: Run the test to verify it passes**

Run: `pnpm --filter passport-checker exec vitest run ui/PassportChecker.test.tsx`
Expected: PASS.

- [ ] **Step 5: Run the whole widget suite**

Run: `pnpm --filter passport-checker test`
Expected: PASS. The tier tests query by `aria-label`; any that break signals an accidental behavior change rather than a stale test.

- [ ] **Step 6: Commit**

```bash
git add packages/widgets/passport-checker
git commit -m "feat(passport-checker): give the fullscreen widget a close control"
```

---

### Task 7: The recovery modal joins the back stack

**Files:**
- Modify: `packages/widgets/passport-checker/ui/RecoveryModal.tsx:23-31,63-84`

**Interfaces:**
- Consumes: `useOverlayBackDismiss` (Task 2).
- Produces: nothing.

`RecoveryModal` is a hand-rolled `createPortal` overlay inside a federated remote, so it cannot reach the client's `Dialog` wrapper — it calls the hook directly. It only mounts while open, so `open` is a literal `true`.

- [ ] **Step 1: Write the failing test**

Add to `packages/widgets/passport-checker/ui/recovery-flow.test.tsx`, inside `describe('recovery flow across tiers', …)`. It reuses `renderSessionRequiredIn(tier, instanceId)` from line 113 — note the instance id must be unique, as that file's own comment at line 109 explains, because the model graph is module-scoped and keyed by it:

```tsx
  it('closes the recovery modal on the platform back gesture', async () => {
    renderSessionRequiredIn('standard', 'inst-passport-back-gesture')

    fireEvent.click(screen.getByRole('button', { name: /Проверить/ }))
    fireEvent.click(await screen.findByRole('button', { name: /Открыть восстановление/ }))
    const dialog = await screen.findByRole('dialog')

    // Same race the file-level comment above describes, for the same reason:
    // findByRole resolves on DOM commit, but the modal's passive mount effects
    // — useModalIsolation's listeners AND useOverlayBackDismiss's history push
    // — can still be pending. Focus landing inside the dialog proves they ran.
    await waitFor(() => expect(dialog.contains(document.activeElement)).toBe(true))
    expect(history.state).toMatchObject({ overlayDepth: 1 })

    history.replaceState({ overlayDepth: 0 }, '')
    window.dispatchEvent(new PopStateEvent('popstate', { state: history.state }))

    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull())
  })
```

That file has an `afterEach` at line 78 but no `beforeEach`. Add one next to it, and extend the `widget-runtime` import at line 2 with `resetOverlayHistory`:

```tsx
beforeEach(() => {
  resetOverlayHistory()
  history.replaceState({}, '')
})
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `pnpm --filter passport-checker exec vitest run ui/recovery-flow.test.tsx`
Expected: FAIL — the modal is still mounted.

- [ ] **Step 3: Write the implementation**

In `packages/widgets/passport-checker/ui/RecoveryModal.tsx`, route every close path through the hook:

```tsx
  const close = wrap(() => recoveryFlow.closeRecovery({ restore: restoreFullscreen }))
  const retry = wrap(() => recoveryFlow.retryCheck({ restore: restoreFullscreen }))

  // The modal only mounts while recovery is open, so `open` is literally true.
  // `retry` deliberately does NOT go through here: it closes the modal by
  // transitioning the flow, and the effect cleanup hands the history entry back
  // on unmount.
  const requestDismiss = useOverlayBackDismiss(true, close)

  useModalIsolation(rootRef, requestDismiss)
```

Then change the two close buttons — the header one at line 68 and the footer one at line 78 — from `onClick={close}` to `onClick={requestDismiss}`. Leave `retry` alone.

Add the import:

```tsx
import { useOverlayBackDismiss } from 'widget-sdk/hooks/use-overlay-back-dismiss'
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `pnpm --filter passport-checker exec vitest run ui/recovery-flow.test.tsx`
Expected: PASS.

- [ ] **Step 5: Run the stacked-dialog regression file**

This widget has a dedicated test for the Radix layer race, and this change adds a tick to the modal's close path.

Run: `pnpm --filter passport-checker exec vitest run ui/recovery-modal-radix-stack.test.tsx`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add packages/widgets/passport-checker/ui/RecoveryModal.tsx packages/widgets/passport-checker/ui/recovery-flow.test.tsx
git commit -m "feat(passport-checker): dismiss the recovery modal on the back gesture"
```

---

### Task 8: End-to-end coverage and the full gate

**Files:**
- Modify: `packages/client/e2e/mobile-board.spec.ts`

**Interfaces:**
- Consumes: `BoardPage.expandCard(index)` — already exists at `packages/client/e2e/pages/BoardPage.ts:23`. No page-object change is needed: it hovers before clicking, and Playwright's mouse emulation makes that work under `hasTouch: true` (the existing touch test at line 147 already relies on the same helper shape for `removeCard`).

- [ ] **Step 1: Write the failing tests**

Append to `packages/client/e2e/mobile-board.spec.ts`:

```ts
// A phone has no Esc key, and the fullscreen panel is min(900px, 92vw) wide by
// min(680px, 100dvh - 2rem) tall, so "tap outside" means hitting a margin a few
// pixels wide. Every widget must draw its own way out.
test('an expanded widget can be collapsed with its own close control', async ({ page }) => {
  await seedTwoWidgets(page)

  const board = new BoardPage(page)
  await board.expandCard(0)

  const dialog = page.getByRole('dialog')
  await expect(dialog).toBeVisible()

  await dialog.getByRole('button', { name: 'Закрыть' }).click()
  await expect(page.getByRole('dialog')).toHaveCount(0)
  await expect(board.widgetCards).toHaveCount(2)
})

// Without an overlay on the history stack the platform back gesture leaves the
// application entirely — on an installed PWA that means the board disappears
// rather than the widget collapsing.
test('the platform back gesture collapses an expanded widget instead of leaving the board', async ({
  page,
}) => {
  await seedTwoWidgets(page)

  const board = new BoardPage(page)
  await board.expandCard(0)
  await expect(page.getByRole('dialog')).toBeVisible()

  await page.goBack()

  await expect(page.getByRole('dialog')).toHaveCount(0)
  await expect(board.widgetCards).toHaveCount(2)
})
```

- [ ] **Step 2: Run them**

Run: `pnpm test:e2e:docker`
Expected: PASS for the whole suite, including the two new tests. This target is fully isolated — ephemeral Valkey plus browsers in one container — so it needs no running stack.

If the run reports that a stale service worker served an old widget bundle, that is the known branch-stand caching behavior and not these tests; re-run after the container is rebuilt.

- [ ] **Step 3: Format**

Run: `pnpm format`
Expected: rewrites whatever it wants to. Do not hand-tune the result.

- [ ] **Step 4: Run the full local gate**

Run: `pnpm check`
Expected: PASS — lint, format:check, deps:check, typecheck and every workspace Vitest suite.

If it stops at `format:check` before reaching the tests, run `pnpm lint`, `pnpm deps:check`, `pnpm typecheck` and `pnpm test` individually and report each result. There is no CI on this repository, so these runs are the gate.

- [ ] **Step 5: Commit**

```bash
git add packages/client/e2e/mobile-board.spec.ts
git commit -m "test(e2e): cover the fullscreen close control and the back gesture"
```

- [ ] **Step 6: Open the pull request**

```bash
git push -u origin feat/fullscreen-back
gh pr create --base feat/widget-controls
```

The base is `feat/widget-controls`, **not** `dev`: the base branch is not merged yet, so a PR against `dev` would carry all of it in the diff. Rebase onto the current `feat/widget-controls` tip first — another session works in that branch and it has moved during this work.

In the PR body, list the verification commands actually run, and say explicitly whether the popover half of Task 4 survived or was reverted.

---

## Notes for the implementer

- **The one bug this design is most likely to hit** is a doubled history entry from `StrictMode`'s double effect invocation (`main.tsx:17`). If closing an overlay takes two back presses in the browser, the effect cleanup in `useOverlayBackDismiss` is not unregistering. Do not "fix" it by removing `StrictMode`.
- **Do not add a suppression flag** ("was this back ours?"). The `indexOf` guard in `dropOverlay` is what makes flags unnecessary; if you find yourself wanting one, the guard has been weakened.
- **jsdom's traversal timing** is the reason most tests here simulate `popstate` instead of calling `history.back()`. That is deliberate: the tests cover our reconciliation logic, and the real traversal is covered once in Task 1 Step 6 and again by Playwright in Task 8.
