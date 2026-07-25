# Passport Checker Tier-Shared State Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make one placed passport widget share a single model graph across its board-tile and fullscreen mounts, so recovery can collapse fullscreen instead of stacking a modal over a Radix dialog.

**Architecture:** The three per-widget models move out of `useMemo` into a reference-counted module store keyed by `instanceId`, leased by a hook. `StrictMode` is removed because reference counting cannot survive its development-only double mount. The board-tile mount becomes the sole owner of the recovery modal; opening recovery from fullscreen collapses it through `requestClose`, closing or retrying restores it through `requestFullscreen`. The modal gains focus containment so Radix's deferred unmount focus restore cannot pull focus out.

**Tech Stack:** TypeScript, React 19, Reatom v1001 (`@reatom/core`), Vitest + jsdom + Testing Library, radix-ui, oxlint/oxfmt.

## Global Constraints

- Spec: [Passport Checker Tier-Shared State Design](../specs/2026-07-25-passport-checker-tier-shared-state-design.md).
- All work happens in the worktree `./.worktrees/passport-checker-widget` on branch `feat/passport-checker-widget`; every command below is run from that worktree root.
- Every exported React function component is wrapped with `reatomMemo` from `widget-sdk`.
- Business logic, derived state and cross-model transitions live in `model/`; `ui/` keeps refs, DOM interop and view glue.
- `wrap()` closures are created fresh per call — never hoisted to module scope or memoized across contexts.
- Errors are values (errore); nothing in this plan throws for control flow.
- Widget tests run with `pnpm --filter widgets-passport-checker exec vitest run <path>`; client tests with `pnpm --filter client test`.
- Commit messages use conventional-commit prefixes and end with the trailer `Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>`.
- User-visible Russian copy is never changed by this plan.

---

### Task 1: Clear the repository formatting debt

`pnpm format:check` is red on 18 files that this branch never touched, which makes the branch's own gate unreadable. Clear it first so every later task's verification is meaningful.

**Files:**
- Modify: nine plans under `docs/superpowers/plans/`, five specs under `docs/superpowers/specs/`, `docs/superpowers/specs/designs/Мультиустройства.dc.html`, `docs/typescript-7-migration.md`, `docs/typescript-7-migration/benchmarks.json`, `scripts/bench-typecheck-build.ts`

**Interfaces:**
- Consumes: nothing.
- Produces: a green `pnpm format:check`, relied on by every later task's gate.

- [ ] **Step 1: Confirm the failure and capture the file list**

Run: `pnpm format:check`
Expected: FAIL, ending with `Format issues found in above 18 files.`

- [ ] **Step 2: Format**

Run: `pnpm format`

- [ ] **Step 3: Verify**

Run: `pnpm format:check`
Expected: PASS, no `Format issues found` line.

- [ ] **Step 4: Confirm no source file changed**

Run: `git status --short`
Expected: exactly the 18 documentation and script files listed above, and nothing under `packages/`.

- [ ] **Step 5: Commit**

```bash
git add -A
git commit -m "chore(format): apply oxfmt to pre-existing drift

These 18 files predate this branch and were already failing
pnpm format:check on main. Formatting them here makes the branch
gate readable.

Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>"
```

---

### Task 2: Reference-counted per-instance model store

**Files:**
- Create: `packages/widgets/passport-checker/model/instance-store.ts`
- Test: `packages/widgets/passport-checker/model/instance-store.test.ts`

**Interfaces:**
- Consumes: `PassportCheckModel` (`model/check-model.ts`), `RecoveryModel` (`model/recovery-model.ts`), `RecoveryFlow` (`model/recovery-flow.ts`).
- Produces:
  - `type PassportInstanceModels = { checkModel: PassportCheckModel; recoveryModel: RecoveryModel; recoveryFlow: RecoveryFlow }`
  - `type PassportInstanceLease = { models: PassportInstanceModels; release: () => void }`
  - `acquirePassportInstance(key: string, make: () => PassportInstanceModels): PassportInstanceLease`

- [ ] **Step 1: Write the failing test**

Create `packages/widgets/passport-checker/model/instance-store.test.ts`:

```ts
import { acquirePassportInstance } from './instance-store'
import type { PassportInstanceModels } from './instance-store'

function fakeModels(teardown: () => void = () => {}): PassportInstanceModels {
  return {
    checkModel: {},
    recoveryModel: { teardown },
    recoveryFlow: {},
  } as unknown as PassportInstanceModels
}

describe('acquirePassportInstance', () => {
  it('returns the same models for the same key', () => {
    const make = vi.fn(() => fakeModels())

    const first = acquirePassportInstance('inst-a', make)
    const second = acquirePassportInstance('inst-a', make)

    expect(second.models).toBe(first.models)
    expect(make).toHaveBeenCalledTimes(1)

    first.release()
    second.release()
  })

  it('keeps separate entries per key', () => {
    const first = acquirePassportInstance('inst-a', () => fakeModels())
    const second = acquirePassportInstance('inst-b', () => fakeModels())

    expect(second.models).not.toBe(first.models)

    first.release()
    second.release()
  })

  it('disposes only when the last lease is released', () => {
    const teardown = vi.fn()
    const make = () => fakeModels(teardown)

    const first = acquirePassportInstance('inst-c', make)
    const second = acquirePassportInstance('inst-c', make)

    first.release()
    expect(teardown).not.toHaveBeenCalled()

    second.release()
    expect(teardown).toHaveBeenCalledTimes(1)
  })

  it('ignores repeated releases of the same lease', () => {
    const teardown = vi.fn()
    const make = () => fakeModels(teardown)

    const first = acquirePassportInstance('inst-d', make)
    const second = acquirePassportInstance('inst-d', make)

    first.release()
    first.release()
    first.release()
    expect(teardown).not.toHaveBeenCalled()

    second.release()
    expect(teardown).toHaveBeenCalledTimes(1)
  })

  it('builds a fresh entry after the key was disposed', () => {
    const make = vi.fn(() => fakeModels())

    const first = acquirePassportInstance('inst-e', make)
    first.release()
    const second = acquirePassportInstance('inst-e', make)

    expect(second.models).not.toBe(first.models)
    expect(make).toHaveBeenCalledTimes(2)

    second.release()
  })
})
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `pnpm --filter widgets-passport-checker exec vitest run model/instance-store.test.ts`
Expected: FAIL — `Failed to resolve import "./instance-store"`.

- [ ] **Step 3: Write the implementation**

Create `packages/widgets/passport-checker/model/instance-store.ts`:

```ts
import type { PassportCheckModel } from './check-model'
import type { RecoveryFlow } from './recovery-flow'
import type { RecoveryModel } from './recovery-model'

export type PassportInstanceModels = {
  checkModel: PassportCheckModel
  recoveryModel: RecoveryModel
  recoveryFlow: RecoveryFlow
}

export type PassportInstanceLease = {
  models: PassportInstanceModels
  release: () => void
}

type Entry = { models: PassportInstanceModels; refs: number }

/**
 * One model graph per placed widget, shared by every mount of that instance.
 * The board renders a tile for every instance and the fullscreen overlay
 * renders a SECOND frame for the expanded one, so a widget that kept its state
 * in `useMemo` would lose it on every tier switch — and collapsing fullscreen
 * to escape the Radix stack would destroy the recovery flow mid-use.
 */
const entries = new Map<string, Entry>()

export function acquirePassportInstance(
  key: string,
  make: () => PassportInstanceModels,
): PassportInstanceLease {
  const entry = entries.get(key) ?? { models: make(), refs: 0 }
  entry.refs += 1
  entries.set(key, entry)

  let released = false
  return {
    models: entry.models,
    release: () => {
      // Idempotent per lease: the lease hook releases in render on an id change
      // and again from the matching effect cleanup.
      if (released) return
      released = true
      entry.refs -= 1
      if (entry.refs > 0) return
      if (entries.get(key) === entry) entries.delete(key)
      entry.models.recoveryModel.teardown()
    },
  }
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `pnpm --filter widgets-passport-checker exec vitest run model/instance-store.test.ts`
Expected: PASS, 5 tests.

- [ ] **Step 5: Commit**

```bash
git add packages/widgets/passport-checker/model/instance-store.ts packages/widgets/passport-checker/model/instance-store.test.ts
git commit -m "feat(passport-checker): add a reference-counted per-instance model store

Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>"
```

---

### Task 3: Lease the store from the widget and drop StrictMode

After this task both mounts of one placed widget share state, and only the non-fullscreen mount renders the recovery modal.

**Files:**
- Create: `packages/widgets/passport-checker/ui/use-passport-instance.ts`
- Modify: `packages/widgets/passport-checker/ui/PassportChecker.tsx:25-54`
- Modify: `packages/client/src/app/main.tsx:1-20`
- Test: `packages/widgets/passport-checker/ui/PassportChecker.test.tsx` (append a new `describe`)

**Interfaces:**
- Consumes: `acquirePassportInstance`, `PassportInstanceLease`, `PassportInstanceModels` from Task 2.
- Produces: `usePassportInstance(instanceId: string, make: () => PassportInstanceModels): PassportInstanceModels`.

- [ ] **Step 1: Write the failing test**

Append to `packages/widgets/passport-checker/ui/PassportChecker.test.tsx`:

```tsx
describe('PassportChecker / shared instance state', () => {
  afterEach(() => {
    vi.unstubAllGlobals()
  })

  function renderPair(
    tiers: [WidgetRuntimeProps['tier'], WidgetRuntimeProps['tier']],
    invoke: () => Promise<InvokeResult>,
    ids: [string, string] = ['inst-passport', 'inst-passport'],
  ) {
    return render(
      <>
        <WidgetRuntimeContext.Provider value={makeProps(tiers[0], invoke, ids[0])}>
          <PassportChecker />
        </WidgetRuntimeContext.Provider>
        <WidgetRuntimeContext.Provider value={makeProps(tiers[1], invoke, ids[1])}>
          <PassportChecker />
        </WidgetRuntimeContext.Provider>
      </>,
    )
  }

  it('shares one model graph between the tile and fullscreen mounts', async () => {
    const invoke = vi.fn(async () => ({ status: 200, send_status_msg: 'Готово' }))
    renderPair(['standard', 'fullscreen'], invoke)

    fireEvent.click(screen.getAllByRole('button', { name: /Проверить/ })[0])

    // One check, one result, rendered by BOTH mounts.
    expect(await screen.findAllByText('Готово')).toHaveLength(2)
    expect(invoke).toHaveBeenCalledTimes(1)
  })

  it('gives separate instance ids separate state', async () => {
    const invoke = vi.fn(async () => ({ status: 200, send_status_msg: 'Готово' }))
    renderPair(['standard', 'standard'], invoke, ['inst-one', 'inst-two'])

    fireEvent.click(screen.getAllByRole('button', { name: /Проверить/ })[0])

    expect(await screen.findAllByText('Готово')).toHaveLength(1)
  })

  it('renders the recovery modal from the tile mount, never from fullscreen', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(() => new Promise<never>(() => {})),
    )
    const invoke = vi.fn(async () => apiError('browser_session_required', { sshTarget: 'admin@pi' }))
    renderPair(['standard', 'fullscreen'], invoke)

    fireEvent.click(screen.getAllByRole('button', { name: /Проверить/ })[0])
    const openButtons = await screen.findAllByRole('button', { name: /Открыть восстановление/ })
    expect(openButtons).toHaveLength(2)

    fireEvent.click(openButtons[0])

    // Exactly one modal, even though two mounts observe recoveryOpen.
    expect(await screen.findAllByRole('dialog')).toHaveLength(1)
  })
})
```

Change the existing helper at the top of the same file so tests can choose an instance id — replace the current `makeProps(tier, invoke)` signature and both `instanceId` literals inside it:

```tsx
function makeProps(
  tier: WidgetRuntimeProps['tier'],
  invoke: () => Promise<InvokeResult>,
  instanceId = 'inst-passport',
) {
  const props: WidgetRuntimeProps = {
    instanceId,
    typeId: 'passport-checker',
    mode: 'small',
    tier,
    theme: 'light',
    requestFullscreen: vi.fn(),
    requestClose: vi.fn(),
    requestDelete: vi.fn(),
    reportError: vi.fn(),
    storage: makeHostRuntime().makeWidgetStorage({ instanceId, typeId: 'passport-checker' }),
    api: { invoke: invoke as WidgetRuntimeProps['api']['invoke'] },
  }
  return props
}
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `pnpm --filter widgets-passport-checker exec vitest run ui/PassportChecker.test.tsx`
Expected: FAIL — the first new test finds one `Готово`, not two, because each mount still builds its own models; the third finds two dialogs.

- [ ] **Step 3: Write the lease hook**

Create `packages/widgets/passport-checker/ui/use-passport-instance.ts`:

```ts
import { useEffect, useRef } from 'react'

// oxlint-disable-next-line no-restricted-imports -- ui/ sits beside model/ in the same package.
import { acquirePassportInstance } from '../model/instance-store'
import type { PassportInstanceLease, PassportInstanceModels } from '../model/instance-store'

type Held = { key: string; lease: PassportInstanceLease }

/**
 * Leases this instance's shared models. The lease is taken during render — a
 * ref guard keeps a repeated render of the same fiber from taking a second one
 * — and released from effect cleanup. A render React discards before commit
 * leaks one lease, which only delays disposal to the next page load: by then
 * the entry holds no live resource, because the RFB socket and the countdown
 * interval belong to the recovery canvas effect.
 */
export function usePassportInstance(
  instanceId: string,
  make: () => PassportInstanceModels,
): PassportInstanceModels {
  const held = useRef<Held | null>(null)

  if (held.current?.key !== instanceId) {
    held.current?.lease.release()
    held.current = { key: instanceId, lease: acquirePassportInstance(instanceId, make) }
  }
  const current = held.current

  useEffect(() => {
    return () => {
      current.lease.release()
      if (held.current === current) held.current = null
    }
  }, [current])

  return current.lease.models
}
```

- [ ] **Step 4: Wire the widget to the hook**

Rewrite the body of `packages/widgets/passport-checker/ui/PassportChecker.tsx` (keep `isStandardLayout` and the imports it needs; add `usePassportInstance`, drop the three model `useMemo`s):

```tsx
export const PassportChecker = reatomMemo(() => {
  const { tier, typeId, instanceId, api } = useWidgetContext<PassportCheckerEvents>()

  const { checkModel, recoveryModel, recoveryFlow } = usePassportInstance(instanceId, () => {
    const checkModel = makePassportCheckModel({ api })
    const recoveryModel = makeRecoveryModel({
      widgetId: typeId,
      transport: makeRecoveryTransport(),
      makeRfb: makeNoVncRfb,
    })
    return {
      checkModel,
      recoveryModel,
      recoveryFlow: makeRecoveryFlow({ checkModel, recoveryModel }),
    }
  })

  const value = useMemo<PassportCheckerContextValue>(
    () => ({ checkModel, recoveryModel, recoveryFlow }),
    [checkModel, recoveryModel, recoveryFlow],
  )

  return (
    <passportCheckerContext.Provider value={value}>
      <div className={styles.widget} data-tier={tier}>
        {isStandardLayout(tier) ? <StandardTier /> : <TinyTier />}
      </div>
      {/* The fullscreen mount never owns the modal: recovery collapses
          fullscreen, and with shared state both mounts would otherwise render
          one modal each. */}
      {tier !== 'fullscreen' && checkModel.recoveryOpen() && <RecoveryModal />}
    </passportCheckerContext.Provider>
  )
}, 'PassportChecker')
```

- [ ] **Step 5: Run the tests to verify they pass**

Run: `pnpm --filter widgets-passport-checker exec vitest run ui/PassportChecker.test.tsx`
Expected: PASS, including the three new tests.

- [ ] **Step 6: Remove StrictMode**

In `packages/client/src/app/main.tsx`, drop the `StrictMode` import and wrapper:

```tsx
// StrictMode is deliberately absent. It double-invokes render and runs
// mount -> unmount -> mount on every effect in development only, which breaks
// reference-counted per-instance stores (packages/widgets/passport-checker/
// model/instance-store.ts): the first cleanup disposes the entry while the
// component still renders against it, and nothing re-acquires. Reinstating it
// requires making those stores tolerate double mounting first.
createRoot(document.getElementById('root')!).render(<App />)
```

- [ ] **Step 7: Run the full widget and client suites**

Run: `pnpm --filter widgets-passport-checker test`
Expected: PASS.

Run: `pnpm --filter client test`
Expected: PASS.

- [ ] **Step 8: Commit**

```bash
git add packages/widgets/passport-checker/ui/use-passport-instance.ts packages/widgets/passport-checker/ui/PassportChecker.tsx packages/widgets/passport-checker/ui/PassportChecker.test.tsx packages/client/src/app/main.tsx
git commit -m "feat(passport-checker): share one model graph across widget mounts

The board tile and the fullscreen overlay mount the same instance twice, so
per-mount useMemo models lost every result on a tier switch. Lease the shared
store instead, and let only the non-fullscreen mount own the recovery modal.

StrictMode is removed: its development-only double mount is incompatible with
reference counting, and it never runs in production.

Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>"
```

---

### Task 4: Collapse fullscreen on open, restore it on close

**Files:**
- Modify: `packages/widgets/passport-checker/model/recovery-flow.ts:17-30`
- Modify: `packages/widgets/passport-checker/ui/RecoveryModal.tsx:21-28`
- Modify: `packages/widgets/passport-checker/ui/tiers/StandardTier.tsx:10-16,59-63`
- Modify: `packages/widgets/passport-checker/ui/tiers/TinyTier.tsx:9-15,24-26`
- Modify: `packages/widgets/passport-checker/ui/PassportChecker.tsx`
- Modify: `packages/widgets/passport-checker/ui/RecoveryModal.test.tsx:80-84`
- Modify: `packages/widgets/passport-checker/ui/recovery-modal-radix-stack.test.tsx:83-96`
- Create: `packages/widgets/passport-checker/model/recovery-flow.test.ts`
- Test: `packages/widgets/passport-checker/ui/recovery-flow.test.tsx` (append)

**Interfaces:**
- Consumes: `PassportCheckModel`, `RecoveryModel`, and the shared models from Task 3.
- Produces:
  - `openRecovery({ fromFullscreen: boolean; collapse: () => void }): void`
  - `closeRecovery({ restore: () => void }): void`
  - `retryCheck({ restore: () => void }): void`
  - `RecoveryModal` prop `restoreFullscreen: () => void`
  - `StandardTier` and `TinyTier` prop `onOpenRecovery: () => void`

- [ ] **Step 1: Write the failing model test**

Create `packages/widgets/passport-checker/model/recovery-flow.test.ts`:

```ts
import type { WidgetApi } from '@shared/widgets/contracts'
import { WidgetApiError } from 'widget-runtime'

import type { PassportCheckerEvents } from '../types'
import { makePassportCheckModel } from './check-model'
import { makeRecoveryFlow } from './recovery-flow'
import type { RecoveryModel } from './recovery-model'

function setup() {
  const invoke = vi.fn(
    async () => new WidgetApiError({ reason: 'x', code: 'browser_session_required' }),
  )
  const checkModel = makePassportCheckModel({
    api: { invoke } as unknown as WidgetApi<PassportCheckerEvents, WidgetApiError>,
  })
  const teardown = vi.fn()
  const recoveryModel = { teardown } as unknown as RecoveryModel
  const flow = makeRecoveryFlow({ checkModel, recoveryModel })
  return { checkModel, flow, teardown, invoke }
}

describe('makeRecoveryFlow', () => {
  it('collapses fullscreen when recovery opens from the fullscreen mount', () => {
    const { checkModel, flow } = setup()
    const collapse = vi.fn()

    flow.openRecovery({ fromFullscreen: true, collapse })

    expect(checkModel.recoveryOpen()).toBe(true)
    expect(collapse).toHaveBeenCalledTimes(1)
  })

  it('does not collapse when recovery opens from the tile', () => {
    const { checkModel, flow } = setup()
    const collapse = vi.fn()

    flow.openRecovery({ fromFullscreen: false, collapse })

    expect(checkModel.recoveryOpen()).toBe(true)
    expect(collapse).not.toHaveBeenCalled()
  })

  it('restores fullscreen on close only when it collapsed it', () => {
    const { flow, teardown } = setup()
    const restore = vi.fn()

    flow.openRecovery({ fromFullscreen: true, collapse: vi.fn() })
    flow.closeRecovery({ restore })

    expect(teardown).toHaveBeenCalledTimes(1)
    expect(restore).toHaveBeenCalledTimes(1)

    flow.openRecovery({ fromFullscreen: false, collapse: vi.fn() })
    flow.closeRecovery({ restore })

    expect(restore).toHaveBeenCalledTimes(1)
  })

  it('restores at most once per collapse', () => {
    const { flow } = setup()
    const restore = vi.fn()

    flow.openRecovery({ fromFullscreen: true, collapse: vi.fn() })
    flow.closeRecovery({ restore })
    flow.closeRecovery({ restore })

    expect(restore).toHaveBeenCalledTimes(1)
  })

  it('restores fullscreen and re-runs the check on retry', async () => {
    const { checkModel, flow, invoke, teardown } = setup()
    const restore = vi.fn()

    flow.openRecovery({ fromFullscreen: true, collapse: vi.fn() })
    flow.retryCheck({ restore })

    expect(checkModel.recoveryOpen()).toBe(false)
    expect(teardown).toHaveBeenCalledTimes(1)
    expect(restore).toHaveBeenCalledTimes(1)
    await vi.waitFor(() => expect(invoke).toHaveBeenCalledTimes(1))
  })
})
```

- [ ] **Step 2: Run it to verify it fails**

Run: `pnpm --filter widgets-passport-checker exec vitest run model/recovery-flow.test.ts`
Expected: FAIL — `flow.openRecovery is not a function`.

- [ ] **Step 3: Implement the flow**

Replace the body of `packages/widgets/passport-checker/model/recovery-flow.ts`:

```ts
import { action, atom } from '@reatom/core'

import type { PassportCheckModel } from './check-model'
import type { RecoveryModel } from './recovery-model'

export type RecoveryFlowDeps = {
  checkModel: PassportCheckModel
  recoveryModel: RecoveryModel
}

export type OpenRecoveryOptions = { fromFullscreen: boolean; collapse: () => void }
export type FinishRecoveryOptions = { restore: () => void }

export type RecoveryFlow = ReturnType<typeof makeRecoveryFlow>

/**
 * Named transitions that span the two models. The check and recovery models
 * stay unaware of each other; this is the one place that composes them.
 *
 * The host callbacks arrive as arguments rather than as construction deps
 * because the two mounts of one widget do not have the same ones: only the
 * fullscreen mount has a working `requestClose`, and only the tile mount has a
 * working `requestFullscreen`. Each call therefore comes from the mount whose
 * callback is live — opening from a tier, finishing from the modal.
 */
export function makeRecoveryFlow({ checkModel, recoveryModel }: RecoveryFlowDeps) {
  const restorePending = atom(false, 'passportRecovery.restorePending')

  const openRecovery = action(({ fromFullscreen, collapse }: OpenRecoveryOptions) => {
    restorePending.set(fromFullscreen)
    checkModel.recoveryOpen.set(true)
    if (fromFullscreen) collapse()
  }, 'passportRecovery.open')

  const finish = (restore: () => void) => {
    recoveryModel.teardown()
    checkModel.recoveryOpen.set(false)
    if (!restorePending()) return
    restorePending.set(false)
    restore()
  }

  const closeRecovery = action(({ restore }: FinishRecoveryOptions) => {
    finish(restore)
  }, 'passportRecovery.close')

  const retryCheck = action(({ restore }: FinishRecoveryOptions) => {
    finish(restore)
    void checkModel.checkPassport()
  }, 'passportRecovery.retryCheck')

  return { openRecovery, closeRecovery, retryCheck }
}
```

- [ ] **Step 4: Run the model test to verify it passes**

Run: `pnpm --filter widgets-passport-checker exec vitest run model/recovery-flow.test.ts`
Expected: PASS, 5 tests.

- [ ] **Step 5: Thread the callbacks through the components**

In `packages/widgets/passport-checker/ui/RecoveryModal.tsx`, take the restore callback as a prop:

```tsx
export type RecoveryModalProps = { restoreFullscreen: () => void }

export const RecoveryModal = reatomMemo(({ restoreFullscreen }: RecoveryModalProps) => {
  const { checkModel, recoveryModel, recoveryFlow } = usePassportChecker()
  const rootRef = useRef<HTMLDivElement | null>(null)

  const close = wrap(() => recoveryFlow.closeRecovery({ restore: restoreFullscreen }))
  const retry = wrap(() => recoveryFlow.retryCheck({ restore: restoreFullscreen }))
  // …rest of the component is unchanged
```

In `packages/widgets/passport-checker/ui/tiers/StandardTier.tsx`, take the open callback as a prop and delete the local `openRecovery`:

```tsx
export type StandardTierProps = { onOpenRecovery: () => void }

export const StandardTier = reatomMemo(({ onOpenRecovery }: StandardTierProps) => {
  const { checkModel } = usePassportChecker()
  const view = checkModel.viewState()
  const check = wrap(() => {
    void checkModel.checkPassport()
  })
  // …markup unchanged except the sessionRequired button:
  //   <button type="button" className={styles.primaryButton} onClick={onOpenRecovery}>
```

Apply the same change to `packages/widgets/passport-checker/ui/tiers/TinyTier.tsx`:

```tsx
export type TinyTierProps = { onOpenRecovery: () => void }

export const TinyTier = reatomMemo(({ onOpenRecovery }: TinyTierProps) => {
  // …delete `const openRecovery = …`; the sessionRequired button becomes
  //   <button type="button" className={styles.tinyButton} onClick={onOpenRecovery}>
```

In `packages/widgets/passport-checker/ui/PassportChecker.tsx`, build both callbacks once from the runtime props (add `wrap` to the `@reatom/core` import):

```tsx
const { tier, typeId, instanceId, api, requestClose, requestFullscreen } =
  useWidgetContext<PassportCheckerEvents>()

// …lease + context value as in Task 3…

const openRecovery = wrap(() =>
  recoveryFlow.openRecovery({ fromFullscreen: tier === 'fullscreen', collapse: requestClose }),
)

return (
  <passportCheckerContext.Provider value={value}>
    <div className={styles.widget} data-tier={tier}>
      {isStandardLayout(tier) ? (
        <StandardTier onOpenRecovery={openRecovery} />
      ) : (
        <TinyTier onOpenRecovery={openRecovery} />
      )}
    </div>
    {tier !== 'fullscreen' && checkModel.recoveryOpen() && (
      <RecoveryModal restoreFullscreen={requestFullscreen} />
    )}
  </passportCheckerContext.Provider>
)
```

- [ ] **Step 6: Fix the two isolated modal test harnesses**

`RecoveryModal.test.tsx` renders the modal without the widget around it, so it must pass the new prop. In its `setup`, change the render call:

```tsx
  render(
    <passportCheckerContext.Provider value={{ checkModel, recoveryModel, recoveryFlow }}>
      <RecoveryModal restoreFullscreen={vi.fn()} />
    </passportCheckerContext.Provider>,
  )
```

Apply the same one-line change inside `renderNested` in `recovery-modal-radix-stack.test.tsx`:

```tsx
          <passportCheckerContext.Provider value={value}>
            <RecoveryModal restoreFullscreen={vi.fn()} />
          </passportCheckerContext.Provider>
```

- [ ] **Step 7: Write the failing UI test for the fullscreen round trip**

Append to `packages/widgets/passport-checker/ui/recovery-flow.test.tsx`:

```tsx
function renderSessionRequiredIn(tier: WidgetRuntimeProps['tier']) {
  vi.stubGlobal(
    'fetch',
    vi.fn(() => new Promise<never>(() => {})),
  )
  const invoke = vi.fn(
    async () =>
      new WidgetApiError({
        reason: 'x',
        code: 'browser_session_required',
        meta: { sshTarget: 'admin@pi' },
      }),
  )
  const requestClose = vi.fn()
  const requestFullscreen = vi.fn()
  const props: WidgetRuntimeProps = {
    instanceId: 'inst-passport-tier',
    typeId: 'passport-checker',
    mode: 'large',
    tier,
    theme: 'light',
    requestFullscreen,
    requestClose,
    requestDelete: vi.fn(),
    reportError: vi.fn(),
    storage: makeHostRuntime().makeWidgetStorage({
      instanceId: 'inst-passport-tier',
      typeId: 'passport-checker',
    }),
    api: { invoke: invoke as WidgetRuntimeProps['api']['invoke'] },
  }
  const view = render(
    <WidgetRuntimeContext.Provider value={props}>
      <PassportChecker />
    </WidgetRuntimeContext.Provider>,
  )
  return { view, requestClose, requestFullscreen }
}

describe('recovery flow across tiers', () => {
  it('collapses fullscreen when recovery opens from the fullscreen mount', async () => {
    const { requestClose } = renderSessionRequiredIn('fullscreen')

    fireEvent.click(screen.getByRole('button', { name: /Проверить/ }))
    fireEvent.click(await screen.findByRole('button', { name: /Открыть восстановление/ }))

    expect(requestClose).toHaveBeenCalledTimes(1)
  })

  it('does not collapse when recovery opens from the tile', async () => {
    const { requestClose, requestFullscreen } = renderSessionRequiredIn('standard')

    fireEvent.click(screen.getByRole('button', { name: /Проверить/ }))
    fireEvent.click(await screen.findByRole('button', { name: /Открыть восстановление/ }))
    await screen.findByRole('dialog')

    fireEvent.keyDown(document, { key: 'Escape' })
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull())

    expect(requestClose).not.toHaveBeenCalled()
    expect(requestFullscreen).not.toHaveBeenCalled()
  })
})
```

- [ ] **Step 8: Run the widget suite**

Run: `pnpm --filter widgets-passport-checker test`
Expected: PASS. The fullscreen-mount test relies on Task 3's ownership rule: that mount renders no modal, so nothing but `requestClose` is asserted.

- [ ] **Step 9: Typecheck**

Run: `pnpm --filter widgets-passport-checker typecheck`
Expected: PASS — every `RecoveryModal`, `StandardTier` and `TinyTier` call site now passes its required prop.

- [ ] **Step 10: Commit**

```bash
git add packages/widgets/passport-checker
git commit -m "feat(passport-checker): collapse fullscreen for recovery and restore it after

Opening recovery from the fullscreen mount now collapses the board's Radix
dialog through requestClose, so the modal is never stacked over a trapped
FocusScope; closing or retrying restores fullscreen through requestFullscreen.

Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>"
```

---

### Task 5: Hold focus inside the recovery modal

Radix's `FocusScope` cleanup schedules `setTimeout(…, 0)` and then focuses the element that had focus before the dialog opened (`@radix-ui/react-focus-scope/dist/index.mjs:87-99`). Collapsing fullscreen therefore hands focus to the board one tick after the modal mounted and focused itself.

**Files:**
- Modify: `packages/widgets/passport-checker/ui/use-modal-isolation.ts:38-95`
- Modify: `packages/widgets/passport-checker/ui/recovery-modal-radix-stack.test.tsx:132-145`
- Test: `packages/widgets/passport-checker/ui/RecoveryModal.test.tsx` (append)

**Interfaces:**
- Consumes: `useModalIsolation(rootRef, onClose)` — signature unchanged.
- Produces: no new exports; the modal now returns focus to itself whenever focus lands outside it.

- [ ] **Step 1: Write the failing test**

Append to `packages/widgets/passport-checker/ui/RecoveryModal.test.tsx`:

```tsx
describe('RecoveryModal focus containment', () => {
  it('pulls focus back when something outside steals it', async () => {
    setup([{ expiresInMs: 60_000 }])
    const dialog = await screen.findByRole('dialog')

    const outside = document.createElement('button')
    outside.textContent = 'outside'
    document.body.append(outside)
    outside.focus()

    expect(dialog.contains(document.activeElement)).toBe(true)
    outside.remove()
  })

  it('leaves focus alone once the modal is gone', async () => {
    setup([{ expiresInMs: 60_000 }])
    await screen.findByRole('dialog')

    const outside = document.createElement('button')
    document.body.append(outside)

    fireEvent.keyDown(document, { key: 'Escape' })
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull())

    outside.focus()
    expect(document.activeElement).toBe(outside)
    outside.remove()
  })
})
```

- [ ] **Step 2: Run it to verify the first test fails**

Run: `pnpm --filter widgets-passport-checker exec vitest run ui/RecoveryModal.test.tsx`
Expected: FAIL on `pulls focus back when something outside steals it` — focus stays on the outside button.

- [ ] **Step 3: Add containment**

In `packages/widgets/passport-checker/ui/use-modal-isolation.ts`, add the listener next to the existing `focusout` guard, and remove it first in the cleanup so the unmount focus restore is not intercepted:

```ts
    // Focus containment. Radix's FocusScope restores focus on unmount from a
    // setTimeout(…, 0), so collapsing the board's fullscreen dialog to show
    // this modal would otherwise hand focus to the board one tick after we
    // mounted. Pull it back instead. No ping-pong with a Radix layer beneath:
    // focusin raised inside the modal is stopped at the root below and never
    // reaches document, so its FocusScope never sees our focus.
    const onFocusIn = (event: FocusEvent) => {
      const target = event.target
      if (target instanceof Node && root.contains(target)) return
      focusables()[0]?.focus()
    }
    window.addEventListener('focusin', onFocusIn, true)
```

and in the returned cleanup, before `previouslyFocused?.focus()`:

```ts
      window.removeEventListener('focusin', onFocusIn, true)
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `pnpm --filter widgets-passport-checker exec vitest run ui/RecoveryModal.test.tsx`
Expected: PASS.

- [ ] **Step 5: Update the stacked-layer focus test**

Containment changes what the stacked test asserts: focus can no longer rest on the underlying dialog while our modal is open. In `recovery-modal-radix-stack.test.tsx`, replace the `holds focus in our modal when refocused after Radix content held it` test and delete the `NOTE:` block above `describe`'s first test that says mount autofocus is intentionally untested:

```tsx
  it('pulls focus back when the underlying Radix content takes it', () => {
    const { ourDialog } = renderNested()
    const dialog = ourDialog()

    screen.getByRole('button', { name: 'inside radix' }).focus()

    expect(dialog.contains(document.activeElement)).toBe(true)
  })
```

- [ ] **Step 6: Run the widget suite**

Run: `pnpm --filter widgets-passport-checker test`
Expected: PASS.

- [ ] **Step 7: Commit**

```bash
git add packages/widgets/passport-checker/ui
git commit -m "fix(passport-checker): hold focus inside the recovery modal

Radix restores focus from a zero-delay timeout when its dialog unmounts, so
collapsing fullscreen for recovery handed focus to the board a tick after the
modal mounted. Pull focus back whenever it lands outside the modal.

Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>"
```

---

### Task 6: Pin the focusout guard with the test that was missing

The backlog proposed narrowing the guard with `&& !root.contains(event.target)`. That is a regression: Radix's `handleFocusOut` inspects only `relatedTarget` and never `event.target` (`@radix-ui/react-focus-scope/dist/index.mjs:44-51`), so a focus move entirely inside our modal has both endpoints outside its container and makes it pull focus to itself. The existing stacked test only exercises focus entering from outside, so the narrowing would have gone green. Add the test that catches it, and record why the guard stays broad.

**Files:**
- Modify: `packages/widgets/passport-checker/ui/use-modal-isolation.ts:57-61`
- Modify: `packages/widgets/passport-checker/ui/recovery-modal-radix-stack.test.tsx:79-109`

**Interfaces:**
- Consumes: `useModalIsolation` from Task 5.
- Produces: no new exports.

- [ ] **Step 1: Write the failing test**

In `recovery-modal-radix-stack.test.tsx`, first make the underlying dialog mount in its own render pass, mirroring production, by splitting `renderNested`:

```tsx
function renderNested(overrides?: Array<RecoveryIssueError | RecoveryIssue>) {
  const { checkModel, value } = makeValue(overrides)
  const onOpenChange = vi.fn()

  // Production mounts the board's fullscreen dialog first and the recovery
  // modal later. Mirror that here — our listeners sit on window in the capture
  // phase and Radix's on document, so window still wins whatever the order,
  // but the fixture should not claim an ordering that never happens.
  const view = render(
    <Dialog.Root open onOpenChange={onOpenChange}>
      <Dialog.Portal>
        <Dialog.Overlay />
        <Dialog.Content aria-describedby={undefined}>
          <Dialog.Title>underlying surface</Dialog.Title>
          <button type="button">inside radix</button>
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>,
  )

  view.rerender(
    <Dialog.Root open onOpenChange={onOpenChange}>
      <Dialog.Portal>
        <Dialog.Overlay />
        <Dialog.Content aria-describedby={undefined}>
          <Dialog.Title>underlying surface</Dialog.Title>
          <button type="button">inside radix</button>
          <passportCheckerContext.Provider value={value}>
            <RecoveryModal restoreFullscreen={vi.fn()} />
          </passportCheckerContext.Provider>
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>,
  )

  // Both surfaces are role="dialog". Radix's modal `hideOthers` stamps
  // aria-hidden onto every document.body child outside its own content —
  // including our portal — so an accessible-name query can't see ours. Select
  // it by its stable aria-labelledby instead; the focus/keyboard behavior these
  // tests exercise is unaffected by the a11y-tree hiding.
  const ourDialog = () => {
    const el = document.querySelector<HTMLElement>('[aria-labelledby="passport-recovery-title"]')
    if (!el) throw new Error('our recovery dialog was not rendered')
    return el
  }
  return { checkModel, onOpenChange, ourDialog }
}
```

Then add the regression test to the same `describe`:

```tsx
  it('keeps focus inside when it moves between two of our own controls', () => {
    const { ourDialog } = renderNested()
    const dialog = ourDialog()

    const buttons = dialog.querySelectorAll('button')
    const first = buttons[0]
    const last = buttons[buttons.length - 1]
    if (!(first instanceof HTMLElement) || !(last instanceof HTMLElement)) {
      throw new Error('expected at least two buttons in our modal')
    }
    expect(first).not.toBe(last)

    first.focus()
    last.focus()

    // Radix's handleFocusOut looks only at relatedTarget, so an intra-modal
    // move would make it reclaim focus unless our guard swallows the event.
    expect(document.activeElement).toBe(last)
  })
```

- [ ] **Step 2: Run it and confirm it passes against the current broad guard**

Run: `pnpm --filter widgets-passport-checker exec vitest run ui/recovery-modal-radix-stack.test.tsx`
Expected: PASS.

- [ ] **Step 3: Prove the test has teeth**

Temporarily narrow the guard in `use-modal-isolation.ts` to the rejected form:

```ts
    const onFocusOut = (event: FocusEvent) => {
      const related = event.relatedTarget
      if (!(related instanceof Node) || !root.contains(related)) return
      if (event.target instanceof Node && root.contains(event.target)) return
      event.stopPropagation()
    }
```

Run: `pnpm --filter widgets-passport-checker exec vitest run ui/recovery-modal-radix-stack.test.tsx`
Expected: FAIL on `keeps focus inside when it moves between two of our own controls` — with containment from Task 5 the failure may surface as focus landing on the modal's first button instead of `last`; either way the assertion must not pass.

- [ ] **Step 4: Revert the narrowing and record why**

Restore the original guard and extend its comment in the doc block of `useModalIsolation`:

```ts
 * - window-capture `focusout` guard: any focusout whose `relatedTarget` lands
 *   inside our root is swallowed, so Radix's trapped FocusScope never yanks
 *   focus out of the modal. The guard deliberately does NOT also require the
 *   event's target to be outside the root: Radix's `handleFocusOut` inspects
 *   only `relatedTarget`, so a focus move BETWEEN two of our own controls has
 *   both endpoints outside its container and would make it reclaim focus.
```

Run: `pnpm --filter widgets-passport-checker exec vitest run ui/recovery-modal-radix-stack.test.tsx`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add packages/widgets/passport-checker/ui
git commit -m "test(passport-checker): pin the modal focusout guard against narrowing

Mount the underlying Radix dialog in its own pass, as production does, and
cover the intra-modal focus move that the proposed guard narrowing would have
broken silently.

Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>"
```

---

### Task 7: Documentation and the full gate

**Files:**
- Modify: `docs/superpowers/specs/2026-07-24-passport-checker-widget-design.md` (add an amendment block)
- Modify: `docs/superpowers/specs/2026-07-03-passport-checker-browser-automation-design.md:592-598`

**Interfaces:**
- Consumes: the spec and plan written for this work.
- Produces: navigable back-links, as the master spec requires.

- [ ] **Step 1: Amend the Subproject 7 spec**

Add near the top of `docs/superpowers/specs/2026-07-24-passport-checker-widget-design.md`, after its intro paragraph:

```markdown
> **Amendment (2026-07-25):** the fullscreen-stack limitations this widget
> shipped with — mount autofocus losing to the underlying trapped Radix
> `FocusScope`, and `hideOthers` marking the portal `aria-hidden` — are removed
> by collapsing fullscreen instead of stacking over it. That required the
> widget's models to be shared between the tile and fullscreen mounts. See
> [Passport Checker Tier-Shared State Design](./2026-07-25-passport-checker-tier-shared-state-design.md).
```

- [ ] **Step 2: Complete the master spec's back-links**

In `docs/superpowers/specs/2026-07-03-passport-checker-browser-automation-design.md`, the Subproject 7 section has a `**Design:**` link but no `**Plan:**` link, which the document's own back-linking rule requires. Add both the missing plan link and this follow-up:

```markdown
**Design:** [Passport Checker Widget Design](./2026-07-24-passport-checker-widget-design.md)

**Plan:** [Passport Checker Widget Implementation Plan](../plans/2026-07-24-passport-checker-widget.md)

**Follow-up:** [Passport Checker Tier-Shared State Design](./2026-07-25-passport-checker-tier-shared-state-design.md) · [Plan](../plans/2026-07-25-passport-checker-tier-shared-state.md)
```

- [ ] **Step 3: Run the full repository gate**

Run: `pnpm check`
Expected: PASS — lint, format:check, deps:check, workspace typecheck and the workspace test suite all green. Task 1 is what makes `format:check` pass here.

- [ ] **Step 4: Commit**

```bash
git add docs
git commit -m "docs(passport-checker): link the tier-shared-state follow-up

Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>"
```

- [ ] **Step 5: Push and update the pull request**

```bash
git push
```

Then update the PR #23 description: the "Known limitations (fullscreen stack only)" section is now obsolete — replace it with a note that recovery collapses fullscreen, that state is shared across mounts, and that `StrictMode` was removed from the client with the reason.

---

## Notes for the implementer

- **Why the store is not in `widget-sdk`:** only this widget needs shared per-mount state today. Extract it when a second widget does.
- **Why `api` is captured from whichever mount arrives first:** `makeWidgetApi` is a stateless wrapper over the shared http port (`packages/widget-runtime/src/host-runtime.ts:64`), so the two mounts' `api` objects are interchangeable.
- **Why test isolation needs no reset hook:** Testing Library's automatic cleanup (`globals: true` in `defineWidgetVitestConfig`) unmounts after every test, which drops the reference count to zero and disposes the entry.
- **What is deliberately out of scope:** a host-level per-instance state slot in `widget-runtime`, persistence of check results, and any change to the recovery transport, capability lifecycle, server handler or browser task.
