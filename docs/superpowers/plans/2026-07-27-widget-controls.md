# Unified widget card controls — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the three separate implementations of a widget's expand/delete/close chrome with one customizable `WidgetControls` component that handles desktop-vs-touch itself.

**Architecture:** `packages/widget-sdk/src/ui/WidgetControls.tsx` becomes the single implementation, taking `placement="overlay" | "inline"` and the three optional callbacks. Its CSS module owns the visibility rule — visible by default, hidden only inside a board frame (`[data-widget-surface]`) on a device that can hover — so the host stops carrying a rule about a widget's chrome and a touch device always sees the buttons. A co-located `useWidgetChrome()` hook states the `mode`-based policy once, replacing the copy-pasted `mode === 'small' ? requestDelete : undefined` in three widgets.

**Tech Stack:** React 19, TypeScript, CSS Modules, Reatom v1001 (`reatomMemo` from `widget-sdk`), lucide-react icons, Vitest + Testing Library, Playwright.

**Spec:** `docs/superpowers/specs/2026-07-27-widget-controls-design.md`

## Global Constraints

- Work happens in the worktree `C:\Users\Khmil\JsProjects\myboard\.worktrees\widget-controls` on branch `feat/widget-controls`. All commands below are run from that directory unless stated otherwise. Run `pnpm install` there once before the first build or test.
- Every exported React function component in `packages/client/src` and `packages/widgets/*` must be defined with `reatomMemo` from `widget-sdk`. This is a hard repository rule and applies even to trivial presentational components.
- Style: TypeScript, ESM, 2-space indent, single quotes, **no semicolons**, named exports, CSS Modules named `*.module.css`.
- `aria-label` strings are a compatibility contract — `Развернуть`, `Удалить`, `Закрыть`. Every existing unit test and `packages/client/e2e/pages/BoardPage.ts` queries by them. Do not change them.
- Comments and documentation in English. Commit messages use Conventional Commit prefixes (`feat:`, `fix:`, `refactor:`, `test:`, `docs:`), imperative mood.
- Node 26 is required (`engines.node: ">=26"`). If `Temporal` is missing at test time, the wrong Node is on PATH — it is not a missing flag.
- Do **not** run `pnpm check` as a single command: it dies at `format:check` before reaching the tests. Run `pnpm format`, then `pnpm lint`, `pnpm deps:check`, `pnpm typecheck`, `pnpm test` separately.
- Vitest path filters are relative to the package, not the repo root.

## File Structure

**Created:** none.

**Modified:**

| File | Responsibility after the change |
| --- | --- |
| `packages/widget-sdk/src/ui/WidgetControls.tsx` | The only implementation of widget card chrome, plus the `useWidgetChrome()` policy hook |
| `packages/widget-sdk/src/ui/WidgetControls.module.css` | Both placements, the hover/touch visibility rule, the touch target floor |
| `packages/widget-sdk/src/ui/WidgetControls.test.tsx` | Unit coverage for the component and the hook |
| `packages/client/src/widget-host/ui/WidgetFrame.module.css` | Loses the now-dead `.widget-controls` reveal rule |
| `packages/client/e2e/pages/BoardPage.ts` | Hovers the card before clicking a control, as a real desktop user does |
| `packages/client/e2e/mobile-board.spec.ts` | Gains the regression test for the invisible touch target |
| `packages/widgets/clock/ui/Clock.tsx` | Consumes `useWidgetChrome()` |
| `packages/widgets/passport-checker/ui/PassportChecker.tsx` | Consumes `useWidgetChrome()` |
| `packages/widgets/passport-checker/ui/tiers/TinyTier.tsx` | One shell instead of six repeated chrome mounts (Task 6, separable) |
| `packages/widgets/ofelia-poop-duty/ui/OfeliaPoopDuty.tsx` | Consumes `useWidgetChrome()` |
| `packages/widgets/ofelia-poop-duty/ui/parts/OfeliaMiniHeader.tsx` | Uses `WidgetControls placement="inline"` |
| `packages/widgets/ofelia-poop-duty/ui/parts/RichLayout.tsx` | Uses `WidgetControls placement="inline"` |

**Deleted:**

- `packages/widgets/ofelia-poop-duty/ui/parts/OfeliaActionControls.tsx`
- `packages/widgets/ofelia-poop-duty/ui/parts/OfeliaActionControls.module.css`

---

### Task 0: Prepare the worktree

**Files:** none

- [ ] **Step 1: Install dependencies**

Run from `C:\Users\Khmil\JsProjects\myboard\.worktrees\widget-controls`:

```bash
pnpm install
```

Expected: completes without an `ERR_PNPM_*` failure. Run `pnpm`/`node` commands with escalated permissions on Windows — sandboxed runs fail with `pnpm` not found or `Access is denied`.

- [ ] **Step 2: Generate the codegen outputs**

```bash
pnpm codegen
```

Required, not optional: `widget-catalog.generated.ts` and `widget-icons.generated.ts` are git-ignored, so a fresh worktree has neither and 11 of the client's 41 test files fail to import `@/widget-registry/model/registry` until this runs.

- [ ] **Step 3: Confirm the baseline is green**

```bash
pnpm --filter widget-sdk test
pnpm --filter client test
```

Expected: PASS. If either does not pass here, the failure is pre-existing and must be reported before any change is made.

---

### Task 1: One `WidgetControls` plus the `useWidgetChrome` policy hook

**Files:**
- Modify: `packages/widget-sdk/src/ui/WidgetControls.tsx` (whole file)
- Modify: `packages/widget-sdk/src/ui/WidgetControls.module.css` (whole file)
- Modify: `packages/widget-sdk/src/ui/WidgetControls.test.tsx` (whole file)
- Modify: `packages/client/e2e/pages/BoardPage.ts:20-26`

**Interfaces:**
- Consumes: `reatomMemo` from `../reatom/reatom-memo`, `cn` from `../lib/utils`, `useWidgetContext` from `widget-runtime`.
- Produces, all importable from `widget-sdk/ui/WidgetControls`:
  - `type WidgetChrome = { onExpand?: () => void; onDelete?: () => void; onClose?: () => void }`
  - `type WidgetControlsProps = WidgetChrome & { placement?: 'overlay' | 'inline'; className?: string }`
  - `const WidgetControls: NamedExoticComponent<WidgetControlsProps>`
  - `const useWidgetChrome: () => WidgetChrome`

- [ ] **Step 1: Write the failing tests**

Replace the entire contents of `packages/widget-sdk/src/ui/WidgetControls.test.tsx` with:

```tsx
// @vitest-environment jsdom
import { fireEvent, render, renderHook, screen } from '@testing-library/react'
import type { ReactNode } from 'react'
import { describe, expect, it, vi } from 'vitest'
import { WidgetRuntimeContext, type WidgetRuntimeProps } from 'widget-runtime'

import { useWidgetChrome, WidgetControls } from './WidgetControls'

const labels = () =>
  screen.getAllByRole('button').map((button) => button.getAttribute('aria-label'))

describe('WidgetControls', () => {
  it('renders nothing when no callback is provided', () => {
    const { container } = render(<WidgetControls />)
    expect(container).toBeEmptyDOMElement()
  })

  it('renders only the expand button when the others are omitted', () => {
    render(<WidgetControls onExpand={vi.fn()} />)
    expect(screen.getByRole('button', { name: 'Развернуть' })).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Удалить' })).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Закрыть' })).not.toBeInTheDocument()
  })

  it('calls each callback from its own button', () => {
    const onExpand = vi.fn()
    const onDelete = vi.fn()
    const onClose = vi.fn()
    render(<WidgetControls onExpand={onExpand} onDelete={onDelete} onClose={onClose} />)

    fireEvent.click(screen.getByRole('button', { name: 'Развернуть' }))
    expect(onExpand).toHaveBeenCalledOnce()

    fireEvent.click(screen.getByRole('button', { name: 'Удалить' }))
    expect(onDelete).toHaveBeenCalledOnce()

    fireEvent.click(screen.getByRole('button', { name: 'Закрыть' }))
    expect(onClose).toHaveBeenCalledOnce()
  })

  // The point of one component is that a given button always sits in the same
  // place, whatever order a widget happens to spell its props in.
  it('renders the buttons in a fixed order regardless of prop order', () => {
    render(<WidgetControls onClose={vi.fn()} onDelete={vi.fn()} onExpand={vi.fn()} />)
    expect(labels()).toEqual(['Развернуть', 'Удалить', 'Закрыть'])
  })

  it('defaults to the overlay placement', () => {
    const { container } = render(<WidgetControls onDelete={vi.fn()} />)
    expect(container.firstElementChild).toHaveAttribute('data-placement', 'overlay')
  })

  it('marks the inline placement and appends the caller className', () => {
    const { container } = render(
      <WidgetControls onDelete={vi.fn()} placement="inline" className="header-slot" />,
    )
    const root = container.firstElementChild
    expect(root).toHaveAttribute('data-placement', 'inline')
    expect(root).toHaveClass('header-slot')
  })
})

// useWidgetChrome reads exactly four fields off the runtime context, so a
// partial value is cast rather than standing up a whole host runtime.
const chromeContext = (mode: WidgetRuntimeProps['mode']) =>
  ({
    mode,
    requestFullscreen: vi.fn(),
    requestDelete: vi.fn(),
    requestClose: vi.fn(),
  }) as unknown as WidgetRuntimeProps

const renderChrome = (context: WidgetRuntimeProps) =>
  renderHook(() => useWidgetChrome(), {
    wrapper: ({ children }: { children: ReactNode }) => (
      <WidgetRuntimeContext.Provider value={context}>{children}</WidgetRuntimeContext.Provider>
    ),
  })

describe('useWidgetChrome', () => {
  it('offers expand and delete on a board card', () => {
    const context = chromeContext('small')
    const { result } = renderChrome(context)

    expect(result.current.onClose).toBeUndefined()
    result.current.onExpand?.()
    result.current.onDelete?.()

    expect(context.requestFullscreen).toHaveBeenCalledOnce()
    expect(context.requestDelete).toHaveBeenCalledOnce()
  })

  it('offers only close on the fullscreen mount', () => {
    const context = chromeContext('large')
    const { result } = renderChrome(context)

    expect(result.current.onExpand).toBeUndefined()
    expect(result.current.onDelete).toBeUndefined()
    result.current.onClose?.()

    expect(context.requestClose).toHaveBeenCalledOnce()
  })
})
```

- [ ] **Step 2: Run the tests to verify they fail**

```bash
pnpm --filter widget-sdk exec vitest run src/ui/WidgetControls.test.tsx
```

Expected: FAIL. `useWidgetChrome` is not exported, the `Закрыть` button does not exist, and there is no `data-placement` attribute.

- [ ] **Step 3: Rewrite the component**

Replace the entire contents of `packages/widget-sdk/src/ui/WidgetControls.tsx` with:

```tsx
import { Maximize2, Trash2, X } from 'lucide-react'
import { useWidgetContext } from 'widget-runtime'

import { cn } from '../lib/utils'
import { reatomMemo } from '../reatom/reatom-memo'

import styles from './WidgetControls.module.css'

export type WidgetChrome = {
  onExpand?: () => void
  onDelete?: () => void
  onClose?: () => void
}

export type WidgetControlsProps = WidgetChrome & {
  /** `overlay` pins the controls to the card corner; `inline` leaves them in the flow. */
  placement?: 'overlay' | 'inline'
  className?: string
}

/**
 * The card-management chrome a widget draws for itself — expand, delete,
 * close. One implementation for the whole repository; see
 * docs/superpowers/specs/2026-07-27-widget-controls-design.md.
 *
 * Button order is fixed here rather than following prop order, so a given
 * button always occupies the same position across widgets.
 *
 * Visibility is inverted on purpose: see WidgetControls.module.css.
 */
export const WidgetControls = reatomMemo<WidgetControlsProps>(
  ({ onExpand, onDelete, onClose, placement = 'overlay', className }) => {
    if (!onExpand && !onDelete && !onClose) return null

    return (
      <div className={cn(styles.root, className)} data-placement={placement}>
        {onExpand && (
          <button
            type="button"
            className={styles.button}
            aria-label="Развернуть"
            onClick={onExpand}
          >
            <Maximize2 aria-hidden />
          </button>
        )}
        {onDelete && (
          <button
            type="button"
            className={cn(styles.button, styles.destructive)}
            aria-label="Удалить"
            onClick={onDelete}
          >
            <Trash2 aria-hidden />
          </button>
        )}
        {onClose && (
          <button type="button" className={styles.button} aria-label="Закрыть" onClick={onClose}>
            <X aria-hidden />
          </button>
        )}
      </div>
    )
  },
  'WidgetControls',
)

/**
 * The board-card policy behind those callbacks, stated once.
 *
 * `mode === 'large'` is the fullscreen mount (see FullscreenOverlay in the
 * client host), where expanding is meaningless and deleting the card you are
 * looking at is a trap; `mode === 'small'` is the board card, where closing is.
 *
 * This returns the callbacks rather than the rendered buttons because *which*
 * buttons a widget offers stays the widget's decision — passport-checker, for
 * one, deliberately offers no expand affordance at all.
 *
 * The callbacks are already stable and Reatom-bound: the host builds them with
 * `wrap(...)` and hands them through `useEvent(...)` (WidgetFrame.tsx), so
 * neither this hook nor the component re-wraps them.
 */
export const useWidgetChrome = (): WidgetChrome => {
  const { mode, requestFullscreen, requestDelete, requestClose } = useWidgetContext()

  if (mode === 'large') return { onClose: requestClose }
  return { onExpand: requestFullscreen, onDelete: requestDelete }
}
```

- [ ] **Step 4: Rewrite the stylesheet**

Replace the entire contents of `packages/widget-sdk/src/ui/WidgetControls.module.css` with:

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

/*
  Inverted on purpose. The controls are visible by default and are hidden only
  inside a board frame ([data-widget-surface], set by WidgetFrame) on a device
  that can hover. Three things follow:

  - a touch device, which never hovers, always sees them;
  - a standalone dev/ harness, which has no frame around it, shows them instead
    of hiding them forever;
  - the reveal rule lives in this package rather than in the host's
    WidgetFrame.module.css, so the host no longer styles a widget's chrome.

  `pointer-events: none` is the half that matters: without it an opacity:0
  control is still clickable, which is how an invisible "Удалить" button ended
  up in the corner of every clock and passport-checker card on a phone.
*/
@media (hover: hover) {
  :global([data-widget-surface]) .root[data-placement='overlay'] {
    opacity: 0;
    pointer-events: none;
  }
  :global([data-widget-surface]:hover) .root[data-placement='overlay'],
  :global([data-widget-surface]:focus-within) .root[data-placement='overlay'] {
    opacity: 1;
    pointer-events: auto;
  }
}

.button {
  display: grid;
  place-items: center;
  inline-size: 30px;
  block-size: 30px;
  border: 1px solid var(--border);
  border-radius: 8px;
  background: var(--secondary);
  color: var(--text-3);
  cursor: pointer;
  transition:
    color 0.15s var(--ease),
    background 0.15s var(--ease),
    border-color 0.15s var(--ease);
}

/* Sized here, not through lucide's `size` prop, so the touch bump below is a
   single rule rather than a prop threaded through every call site. */
.button svg {
  inline-size: 16px;
  block-size: 16px;
}

.button:hover {
  color: var(--foreground);
  background: var(--muted);
}

.destructive:hover {
  color: var(--destructive);
  border-color: color-mix(in oklch, var(--destructive), transparent 60%);
  background: color-mix(in oklch, var(--destructive), transparent 90%);
}

.button:focus-visible {
  outline: 2px solid var(--ring);
  outline-offset: 2px;
}

/* A coarse pointer has no hover to reveal anything, so these are permanently on
   screen and have to be finger-sized. 44px is the touch-target floor. */
@media (pointer: coarse) {
  .button {
    inline-size: 44px;
    block-size: 44px;
  }
  .button svg {
    inline-size: 20px;
    block-size: 20px;
  }
}
```

- [ ] **Step 5: Run the tests to verify they pass**

```bash
pnpm --filter widget-sdk exec vitest run src/ui/WidgetControls.test.tsx
```

Expected: PASS, 8 tests.

- [ ] **Step 6: Teach the e2e page object to hover before clicking**

`pointer-events: none` in the hidden state means a desktop Playwright click can no longer land on a control that has not been revealed — Playwright's hit-target check runs before it moves the mouse, so it would retry until it times out. Hovering the card first is both the fix and what a real user does.

In `packages/client/e2e/pages/BoardPage.ts`, replace the two methods at lines 20-26 with:

```ts
  // The controls are hover-revealed on a desktop pointer and carry
  // `pointer-events: none` until then, so the card has to be hovered before the
  // click — Playwright checks the hit target before it moves the mouse.
  async expandCard(index: number): Promise<void> {
    await this.getCard(index).hover()
    await this.getCard(index).getByRole('button', { name: 'Развернуть' }).click()
  }

  async removeCard(index: number): Promise<void> {
    await this.getCard(index).hover()
    await this.getCard(index).getByRole('button', { name: 'Удалить' }).click()
  }
```

- [ ] **Step 7: Typecheck the two touched packages**

```bash
pnpm --filter widget-sdk typecheck
pnpm --filter client typecheck
```

Expected: no errors introduced by this change. If `client` reports an error in a file this task did not touch, report the exact error and move on — do not chase it.

- [ ] **Step 8: Commit**

```bash
git add packages/widget-sdk/src/ui/WidgetControls.tsx \
        packages/widget-sdk/src/ui/WidgetControls.module.css \
        packages/widget-sdk/src/ui/WidgetControls.test.tsx \
        packages/client/e2e/pages/BoardPage.ts
git commit -m "feat(widget-sdk): make WidgetControls the one widget chrome component"
```

---

### Task 2: Retire the host's reveal rule and pin the touch regression

**Files:**
- Modify: `packages/client/src/widget-host/ui/WidgetFrame.module.css:9-12`
- Modify: `packages/client/e2e/mobile-board.spec.ts`

**Interfaces:**
- Consumes: the `[data-widget-surface]`-scoped visibility rule shipped in Task 1. Nothing new is produced.

Context for the e2e step: `mobile-board.spec.ts` already declares `test.use({ hasTouch: true, ... })`. Verified in this Chromium build — `hasTouch: true` alone makes `(hover: none)` and `(pointer: coarse)` match, so the whole file runs on the touch branch of the stylesheet, at both the desktop and the phone viewport it uses. That is exactly the condition where the old code produced an invisible-but-clickable button.

- [ ] **Step 1: Write the failing e2e assertion**

Append this test to the end of `packages/client/e2e/mobile-board.spec.ts`:

```ts
// The card controls used to be revealed only by `.frame:hover`, which a touch
// device never fires — leaving an invisible but fully clickable "Удалить"
// button in the corner of every card. The stylesheet now hides them only where
// hover exists, so on a touch device they must be on screen without any hover.
test('card controls are visible on a touch device without hovering', async ({ page }) => {
  await seedTwoWidgets(page)

  const card = new BoardPage(page).getCard(0)
  const remove = card.getByRole('button', { name: 'Удалить' })

  await expect(remove).toBeVisible()
  await expect(remove).toHaveCSS('opacity', '1')
  await expect(remove).toHaveCSS('pointer-events', 'auto')
})
```

- [ ] **Step 2: Run it to verify it fails on the pre-Task-1 stylesheet**

This step is informational only if Task 1 is already committed — it will pass. To see it fail, `git stash` the Task 1 stylesheet first. Otherwise skip straight to Step 4.

- [ ] **Step 3: Delete the dead host rule**

In `packages/client/src/widget-host/ui/WidgetFrame.module.css`, delete lines 9-12 in full:

```css
.frame:hover :global(.widget-controls),
.frame:focus-within :global(.widget-controls) {
  opacity: 1;
}
```

The `widget-controls` global class it targeted is gone from `WidgetControls.tsx` as of Task 1, so the rule already matches nothing. Leave the rest of the file — `.frame`, `.skeleton`, the error card and its `.retry`/`.delete` buttons — untouched.

- [ ] **Step 4: Verify no stale references remain**

```bash
git grep -n "widget-controls" -- packages
```

Expected: no matches outside `packages/client/dist` (a stale build artifact) and the spec/plan documents.

- [ ] **Step 5: Run the client unit tests**

```bash
pnpm --filter client test
```

Expected: PASS. Note: on Node 26 a batch of ~40 phantom `localStorage` failures can appear from the webstorage change — that is a known environment issue, not damage from this branch. Compare against the baseline from Task 0 Step 2 before concluding anything.

- [ ] **Step 6: Commit**

```bash
git add packages/client/src/widget-host/ui/WidgetFrame.module.css \
        packages/client/e2e/mobile-board.spec.ts
git commit -m "fix(widget-host): stop hiding card controls where there is no hover"
```

---

### Task 3: Move clock onto the policy hook

**Files:**
- Modify: `packages/widgets/clock/ui/Clock.tsx:1-41`
- Test: `packages/widgets/clock/ui/Clock.test.tsx` (existing, unchanged)

**Interfaces:**
- Consumes: `WidgetControls`, `useWidgetChrome` from `widget-sdk/ui/WidgetControls` (Task 1).

- [ ] **Step 1: Confirm the existing tests describe the target behavior**

```bash
pnpm --filter widgets-clock test
```

Widget packages have no `src` directory — their sources sit directly under `ui/`, `model/` and `dev/` — so a single-file filter is `pnpm --filter widgets-clock exec vitest run ui/Clock.test.tsx`.

Expected: PASS. `Clock.test.tsx:53-67` already asserts both halves of the behavior this task must preserve — controls wired in the small view, none in the large view.

- [ ] **Step 2: Rewrite the component's wiring**

In `packages/widgets/clock/ui/Clock.tsx`, change the import block at lines 1-3 to:

```tsx
import { useWidgetContext } from 'widget-runtime'
import { reatomMemo } from 'widget-sdk/reatom/reatom-memo'
import { useWidgetChrome, WidgetControls } from 'widget-sdk/ui/WidgetControls'
```

Change line 23 from:

```tsx
  const { mode, requestFullscreen, requestDelete } = useWidgetContext()
```

to:

```tsx
  const { mode } = useWidgetContext()
  // Called before the mode branch below: it is a hook, so it cannot sit behind
  // an early return.
  const chrome = useWidgetChrome()
```

Change line 37 from:

```tsx
      <WidgetControls onExpand={requestFullscreen} onDelete={requestDelete} />
```

to:

```tsx
      <WidgetControls {...chrome} />
```

Leave the `mode === 'large'` branch exactly as it is — it deliberately renders no chrome, and `packages/client/e2e/widget-interactions.spec.ts:52` asserts that a fullscreen clock has no `Закрыть` button.

- [ ] **Step 3: Run the tests to verify they still pass**

```bash
pnpm --filter widgets-clock test
```

Expected: PASS, unchanged.

- [ ] **Step 4: Typecheck**

```bash
pnpm --filter widgets-clock typecheck
```

Expected: no errors.

- [ ] **Step 5: Commit**

```bash
git add packages/widgets/clock/ui/Clock.tsx
git commit -m "refactor(clock): take the card chrome from useWidgetChrome"
```

---

### Task 4: Move passport-checker onto the policy hook

**Files:**
- Modify: `packages/widgets/passport-checker/ui/PassportChecker.tsx:26-71`
- Test: `packages/widgets/passport-checker/ui/PassportChecker.test.tsx` (existing, unchanged)

**Interfaces:**
- Consumes: `useWidgetChrome` from `widget-sdk/ui/WidgetControls` (Task 1). The tiers keep their existing `onDelete?: () => void` prop; nothing about their signatures changes.

- [ ] **Step 1: Confirm the existing tests describe the target behavior**

```bash
pnpm --filter widgets-passport-checker test
```

Expected: PASS. `PassportChecker.test.tsx:134-167` already covers all three cases this task must preserve: delete present in the standard tier, present in the tiny tier, absent on the `mode="large"` fullscreen mount.

- [ ] **Step 2: Swap the hand-rolled policy for the hook**

In `packages/widgets/passport-checker/ui/PassportChecker.tsx`, add to the import block (after the `widget-runtime` imports at lines 2-3):

```tsx
import { useWidgetChrome } from 'widget-sdk/ui/WidgetControls'
```

Change the destructure at lines 27-37 to drop `mode` and `requestDelete`, which are no longer read here:

```tsx
  const { tier, typeId, instanceId, api, storage, requestClose, requestFullscreen } =
    useWidgetContext<PassportCheckerEvents>()
```

Replace the comment and constant at lines 68-71:

```tsx
  // Card management (delete) only makes sense on the board card itself: the
  // fullscreen mount always renders with mode="large" (see FullscreenOverlay),
  // so this excludes it the same way ofelia-poop-duty gates its own controls.
  const onDelete = mode === 'small' ? requestDelete : undefined
```

with:

```tsx
  // Only `onDelete`: this widget deliberately offers no expand affordance, and
  // `requestFullscreen` above exists solely to restore fullscreen after the
  // recovery modal closes.
  const { onDelete } = useWidgetChrome()
```

Note on placement: `useWidgetChrome()` must be called unconditionally, and this component has no early return before this point, so leaving it at line 68 is safe. Do not move it below any conditional.

- [ ] **Step 3: Run the tests to verify they still pass**

```bash
pnpm --filter widgets-passport-checker test
```

Expected: PASS, unchanged. In particular `is absent from the fullscreen mount (mode="large")` must still pass — that is the assertion proving the hook's policy matches the hand-rolled one it replaced.

- [ ] **Step 4: Typecheck**

```bash
pnpm --filter widgets-passport-checker typecheck
```

Expected: no errors. A `'mode' is declared but its value is never read` error means the destructure in Step 2 was not fully applied.

- [ ] **Step 5: Commit**

```bash
git add packages/widgets/passport-checker/ui/PassportChecker.tsx
git commit -m "refactor(passport-checker): take the delete control from useWidgetChrome"
```

---

### Task 5: Retire `OfeliaActionControls`

**Files:**
- Delete: `packages/widgets/ofelia-poop-duty/ui/parts/OfeliaActionControls.tsx`
- Delete: `packages/widgets/ofelia-poop-duty/ui/parts/OfeliaActionControls.module.css`
- Modify: `packages/widgets/ofelia-poop-duty/ui/parts/OfeliaMiniHeader.tsx`
- Modify: `packages/widgets/ofelia-poop-duty/ui/parts/RichLayout.tsx:15,86-91`
- Modify: `packages/widgets/ofelia-poop-duty/ui/OfeliaPoopDuty.tsx:22-23,147-151`
- Test: existing suites, unchanged

**Interfaces:**
- Consumes: `WidgetControls`, `useWidgetChrome` from `widget-sdk/ui/WidgetControls` (Task 1).
- Produces: `OfeliaActionControls` ceases to exist. Nothing else in the package imports it — the only two call sites are the two files modified here.

- [ ] **Step 1: Confirm the existing tests describe the target behavior**

```bash
pnpm --filter widgets-ofelia-poop-duty test
```

Expected: PASS. `Tiers.test.tsx`, `RichTiers.test.tsx`, `StandardTier.test.tsx`, `RichLayout.test.tsx` and `OfeliaPoopDuty.test.tsx` all query by `aria-label` (`Развернуть`, `Удалить`), so they hold across the swap.

- [ ] **Step 2: Rewrite `OfeliaMiniHeader`**

Replace the entire contents of `packages/widgets/ofelia-poop-duty/ui/parts/OfeliaMiniHeader.tsx` with:

```tsx
import { Cat } from 'lucide-react'
import { reatomMemo } from 'widget-sdk/reatom/reatom-memo'
import { WidgetControls } from 'widget-sdk/ui/WidgetControls'

import styles from './OfeliaMiniHeader.module.css'

export type OfeliaMiniHeaderProps = {
  onExpand?: () => void
  onDelete?: () => void
}

export const OfeliaMiniHeader = reatomMemo<OfeliaMiniHeaderProps>(({ onExpand, onDelete }) => {
  return (
    <div className={styles.root}>
      <div className={styles.title}>
        <Cat size={16} aria-hidden />
        <span className={styles.titleText}>Лоток Офелии</span>
      </div>
      {/* Inline: this header is the widget's own chrome row, so the controls
          belong in its flow rather than floating over the card corner. */}
      <WidgetControls placement="inline" onExpand={onExpand} onDelete={onDelete} />
    </div>
  )
}, 'OfeliaMiniHeader')
```

- [ ] **Step 3: Rewrite the `RichLayout` call site**

In `packages/widgets/ofelia-poop-duty/ui/parts/RichLayout.tsx`, delete the import at line 15:

```tsx
import { OfeliaActionControls } from './OfeliaActionControls'
```

and add to the top import block, after the `reatomMemo` import at line 3:

```tsx
import { WidgetControls } from 'widget-sdk/ui/WidgetControls'
```

Then replace lines 86-91:

```tsx
        <OfeliaActionControls
          className={styles.headerClose}
          onExpand={onExpand}
          onDelete={onDelete}
          onClose={onClose}
        />
```

with:

```tsx
        <WidgetControls
          placement="inline"
          className={styles.headerClose}
          onExpand={onExpand}
          onDelete={onDelete}
          onClose={onClose}
        />
```

`styles.headerClose` is `flex: none` plus a grid-area assignment under `@container rich-layout (max-width: 38rem)`; it applies to the controls root exactly as before, since `WidgetControls` appends `className` to its own root.

- [ ] **Step 4: Delete the retired component**

```bash
git rm packages/widgets/ofelia-poop-duty/ui/parts/OfeliaActionControls.tsx \
       packages/widgets/ofelia-poop-duty/ui/parts/OfeliaActionControls.module.css
```

- [ ] **Step 5: Move `OfeliaPoopDuty` onto the policy hook**

In `packages/widgets/ofelia-poop-duty/ui/OfeliaPoopDuty.tsx`, add to the import block after line 6:

```tsx
import { useWidgetChrome } from 'widget-sdk/ui/WidgetControls'
```

Change the destructure at lines 22-23 to drop `mode`, `requestFullscreen` and `requestDelete`, and add the hook immediately after it:

```tsx
  const { tier, storage, api, identity, requestClose } = useWidgetContext<OfeliaEvents>()
  // Called up here with the other hooks, not next to its use site below: this
  // component early-returns a loading/error view before the tier switch, and a
  // hook cannot sit behind that return. The file already keeps a fixed hook set
  // for the same reason (see the `ready`/`loadFailed` comment below).
  const chrome = useWidgetChrome()
```

Then replace lines 147-151:

```tsx
  // Card management controls (expand/delete) only make sense on the board
  // card itself — the fullscreen dialog already provides its own close
  // affordance, so neither callback is handed to that tier.
  const onExpand = mode === 'small' ? requestFullscreen : undefined
  const onDelete = mode === 'small' ? requestDelete : undefined
```

with:

```tsx
  // Card management controls (expand/delete) only make sense on the board card
  // itself; useWidgetChrome already withholds them on the fullscreen mount,
  // which renders with mode="large".
  const { onExpand, onDelete } = chrome
```

Leave line 168 (`<FullscreenTier onClose={requestClose} />`) as it is: that tier takes the close callback directly, and `requestClose` stays in the destructure for it.

- [ ] **Step 6: Verify nothing still imports the deleted component**

```bash
git grep -n "OfeliaActionControls" -- packages
```

Expected: no matches outside `packages/widgets/ofelia-poop-duty/dist` (a stale build artifact) and the spec/plan documents.

- [ ] **Step 7: Run the tests to verify they still pass**

```bash
pnpm --filter widgets-ofelia-poop-duty test
```

Expected: PASS, unchanged.

- [ ] **Step 8: Typecheck**

```bash
pnpm --filter widgets-ofelia-poop-duty typecheck
```

Expected: no errors.

- [ ] **Step 9: Commit**

```bash
git add packages/widgets/ofelia-poop-duty
git commit -m "refactor(ofelia): drop OfeliaActionControls for the shared WidgetControls"
```

---

### Task 6 (separable): Mount passport-checker's tiny chrome once

This task is independent of every other one. If the rewrite below turns out to be riskier than it looks, drop the task — the rest of the plan is complete without it.

**Files:**
- Modify: `packages/widgets/passport-checker/ui/tiers/TinyTier.tsx` (whole file)
- Test: `packages/widgets/passport-checker/ui/PassportChecker.test.tsx` (existing, unchanged)

**Interfaces:**
- Consumes: `WidgetControls` from `widget-sdk/ui/WidgetControls` (Task 1). `TinyTierProps` is unchanged, so no caller is affected.

The six view states currently each return their own root `<div>` and each mount `<WidgetControls onDelete>` again. One shell with a computed modifier class removes five of those mounts. The `ViewState` union is `idle | pending | success | retryable | invalidConfig | sessionRequired` (`packages/widgets/passport-checker/model/check-model.ts:38-45`).

- [ ] **Step 1: Confirm the existing tests cover every branch**

```bash
pnpm --filter widgets-passport-checker test
```

Expected: PASS. Note which tests exercise the tiny tier — `PassportChecker.test.tsx` has a `PassportChecker / tiny tier` describe block plus the delete-control cases at lines 134-167. These are the safety net for this rewrite; do not modify them.

- [ ] **Step 2: Rewrite the file**

Replace the entire contents of `packages/widgets/passport-checker/ui/tiers/TinyTier.tsx` with:

```tsx
import { wrap } from '@reatom/core'
import { Check, CircleAlert, IdCard, RefreshCw, TriangleAlert } from 'lucide-react'
import type { ReactNode } from 'react'
import { cn, reatomMemo } from 'widget-sdk'
import { WidgetControls } from 'widget-sdk/ui/WidgetControls'

import { usePassportChecker } from '../passport-checker-context'

import styles from '../passport-checker.module.css'

export type TinyTierProps = { onOpenRecovery: () => void; onDelete?: () => void }

export const TinyTier = reatomMemo(({ onOpenRecovery, onDelete }: TinyTierProps) => {
  const { checkModel } = usePassportChecker()
  const view = checkModel.viewState()
  const check = wrap(() => {
    void checkModel.checkPassport()
  })
  // Wrapped here, not in PassportChecker: this component re-renders on its
  // own viewState() changes independently of the parent, so the closure must
  // be bound to THIS render's frame or it goes stale (see PassportChecker.tsx).
  const openRecovery = wrap(onOpenRecovery)

  // Every state shares one shell, so the widget chrome is mounted once rather
  // than repeated in each branch. Only the modifier class, the ARIA role and
  // the body differ.
  let modifier: string | undefined
  let role: string | undefined
  let body: ReactNode

  switch (view.kind) {
    case 'sessionRequired':
      modifier = styles.tinyWarning
      body = (
        <>
          <div className={styles.tinyBody}>
            <span className={cn(styles.tinyChip, styles.tinyChipWarning)} aria-hidden>
              <TriangleAlert size={19} />
            </span>
            <span className={cn(styles.tinyLabel, styles.tinyLabelWarning)}>
              Требуется вход в браузер
            </span>
          </div>
          <button type="button" className={styles.tinyButton} onClick={openRecovery}>
            Открыть
          </button>
        </>
      )
      break

    case 'invalidConfig':
      modifier = styles.tinyCentered
      body = (
        <>
          <span className={cn(styles.tinyChip, styles.tinyChipMuted)} aria-hidden>
            <IdCard size={20} />
          </span>
          <span className={styles.tinyMutedLabel}>Не настроен</span>
        </>
      )
      break

    case 'pending':
      role = 'status'
      body = (
        <>
          <div className={cn(styles.tinyBody, styles.tinyBodyPending)}>
            <span className={cn(styles.spinner, styles.spinnerLarge)} aria-hidden />
            <span className={styles.tinyMono}>Проверяем…</span>
          </div>
          <button type="button" className={styles.tinyButton} disabled>
            Проверить
          </button>
        </>
      )
      break

    case 'success':
      body = (
        <>
          <div className={styles.tinyBody}>
            <span className={cn(styles.tinyBadge, styles.tinyBadgeSuccess)} aria-hidden>
              <Check size={21} strokeWidth={2.6} />
            </span>
            <span className={cn(styles.tinyLabel, styles.tinyLabelSuccess)}>{view.message}</span>
          </div>
          {/* The tiny tile has no room for a second banner line, but a restored
              result can be days old, so the timestamp rides along in the same
              chip rather than being dropped (see StandardTier's bannerMeta,
              which shows the same fact at full size). */}
          <span className={styles.tinyStatusChip}>
            СТАТУС {view.status} · {view.checkedAtLabel}
          </span>
        </>
      )
      break

    case 'retryable':
      body = (
        <>
          <div className={styles.tinyBody}>
            <span className={cn(styles.tinyBadge, styles.tinyBadgeError)} aria-hidden>
              <CircleAlert size={21} />
            </span>
            <span className={cn(styles.tinyMono, styles.tinyMonoError)}>ошибка</span>
          </div>
          <button type="button" className={styles.tinySecondaryButton} onClick={check}>
            <RefreshCw size={13} aria-hidden /> Повторить
          </button>
        </>
      )
      break

    case 'idle':
      body = (
        <>
          <div className={styles.tinyBody}>
            <span className={styles.tinyChip} aria-hidden>
              <IdCard size={21} />
            </span>
            <span className={styles.tinyTitle}>Паспорт</span>
          </div>
          <button type="button" className={styles.tinyButton} onClick={check}>
            Проверить
          </button>
        </>
      )
      break
  }

  return (
    <div className={cn(styles.tiny, modifier)} role={role}>
      <WidgetControls onDelete={onDelete} />
      {body}
    </div>
  )
}, 'PassportCheckerTinyTier')
```

- [ ] **Step 3: Run the tests to verify they still pass**

```bash
pnpm --filter widgets-passport-checker test
```

Expected: PASS, unchanged. A failure here means the rewrite changed rendered output — compare the failing branch against the original file before adjusting anything.

- [ ] **Step 4: Typecheck**

```bash
pnpm --filter widgets-passport-checker typecheck
```

Expected: no errors. If tsc reports that `body` is used before assignment, a `case` is missing from the switch — the union has exactly six members and all six must assign it.

- [ ] **Step 5: Commit**

```bash
git add packages/widgets/passport-checker/ui/tiers/TinyTier.tsx
git commit -m "refactor(passport-checker): mount the tiny tier chrome once"
```

---

### Task 7: Full local gate

There is no CI on this repository — these runs are the gate.

**Files:** none (may produce formatting-only diffs)

- [ ] **Step 1: Format, then lint and check dependencies**

```bash
pnpm format
pnpm lint
pnpm deps:check
```

Expected: `pnpm format` may rewrite files; `pnpm lint` and `pnpm deps:check` report no violations. Run `pnpm format` before `pnpm format:check` or the gate stops there.

- [ ] **Step 2: Typecheck and unit-test the whole workspace**

```bash
pnpm typecheck
pnpm test
```

Expected: PASS. Compare any failure against the Task 0 baseline before treating it as a regression.

- [ ] **Step 3: Run the browser suite**

```bash
pnpm test:e2e:docker
```

Expected: PASS, and specifically: `widget-interactions.spec.ts` (the desktop hover path through `BoardPage`) and `mobile-board.spec.ts` (including the new touch-visibility test) both green.

Read the summary line, not just the exit code — a dockerized run can report success while the suite never actually executed. Confirm the reported test count includes the new case.

- [ ] **Step 4: Commit any formatting fallout**

```bash
git status --short
git add -A
git commit -m "chore: apply oxfmt"
```

Skip this step if `git status --short` is empty.

- [ ] **Step 5: Push and open the PR against `dev`**

```bash
git push -u origin feat/widget-controls
gh pr create --base dev
```

The PR description must list the verification commands actually run and their results, and attach a before/after screenshot of a widget card at a phone viewport — the visible delete button is the whole point of the change.

---

## Manual verification

Not covered by any automated test, and worth one pass before the PR:

- [ ] `pnpm dev`, then open the board at a desktop width. Hover a clock card: the controls fade in as before. Move away: they fade out and are not clickable.
- [ ] Same board in a browser device-emulation touch profile: the controls are on screen without hovering and are finger-sized.
- [ ] Ofelia at the `standard` tier and at fullscreen: the header controls are the new 30px bordered buttons, delete shows a trash icon and close an `X` — the two are no longer the same glyph.
- [ ] `pnpm dev` also serves each widget's standalone `dev/` harness. Open ofelia's and confirm its controls render (previously an overlay in a harness had no frame to hover and stayed invisible).

---

## Self-review

**Spec coverage**

| Spec section | Task |
| --- | --- |
| Component API (`WidgetChrome`, `placement`, `className`, fixed order, `Trash2`) | Task 1 |
| Styling (inverted visibility, `pointer-events: none`, 44px coarse target) | Task 1 |
| Policy hook `useWidgetChrome` | Task 1 |
| Host rule at `WidgetFrame.module.css:9-12` deleted | Task 2 |
| Migration — clock | Task 3 |
| Migration — passport-checker | Task 4 |
| Migration — ofelia, `OfeliaActionControls` deleted | Task 5 |
| Separable `TinyTier` dedup | Task 6 |
| Testing — extended `WidgetControls.test.tsx`, new hook test | Task 1 |
| Testing — mobile e2e regression | Task 2 |
| Non-goal: error-card delete button untouched | Task 2 Step 3 states it explicitly |
| Non-goal: no close button added to fullscreen clock | Task 3 Step 2 states it explicitly |

One item is in the plan but not in the spec: the `BoardPage.ts` hover fix (Task 1 Step 6). It follows from the spec's `pointer-events: none` decision — Playwright checks the hit target before moving the mouse, so a desktop click on an unrevealed control would time out.

**Type consistency**

`WidgetChrome` and `WidgetControlsProps` are defined once in Task 1 and referenced by that spelling in Tasks 3, 4, 5 and 6. `useWidgetChrome()` returns `WidgetChrome` everywhere, destructured as `{ onDelete }` (Task 4), `{ onExpand, onDelete }` (Task 5) or spread whole (Task 3). `TinyTierProps` and `OfeliaMiniHeaderProps` keep their existing shapes, so no caller signature changes.
