# Passport Checker Result Persistence Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Persist the last successful passport check in shared widget storage so it survives a reload and reaches every device, and show an honest timestamp for it.

**Architecture:** The single in-memory `viewState` atom splits into two atoms and a computed — `lastResult` (persisted through `withStorageKey` over `storage.shared.server`), `transient` (idle/pending/error states, in memory), and `viewState` as the computed merge the UI keeps reading. The timestamp is stored as epoch ms and formatted at render time.

**Tech Stack:** TypeScript, Reatom v1001 (`@reatom/core`), Zod, Vitest + Testing Library (jsdom), `widget-runtime` storage (Valkey over HTTP + SSE).

**Spec:** [Passport Checker Result Persistence Design](../specs/2026-07-26-passport-checker-result-persistence-design.md)

## Global Constraints

- Work inside the worktree `.worktrees/passport-checker-widget`, branch `feat/passport-checker-widget`. All paths below are relative to `packages/widgets/passport-checker/` unless stated otherwise.
- Storage key is `lastResult`, written to `storage.shared.server` — full key `w:t:passport-checker:lastResult`. It is a new key; never rename it later without a data migration (see the storage-key warning in `CLAUDE.md`).
- Errors are values (errore convention): nothing in this widget throws for control flow.
- Reatom rules that bite here: continuations after `await` must run through a `wrap()`ed closure created **before** the await; a `wrap()`ed closure must not be hoisted to module scope; connect hooks only run while an atom is connected.
- Every exported React function component stays wrapped in `reatomMemo`.
- User-facing copy is Russian; code, comments and commit messages are English.
- Run tests with `pnpm --filter widgets-passport-checker test`. The full gate is `pnpm check` from the worktree root.

---

### Task 1: `formatCheckedAt` — a timestamp label that admits its age

**Files:**
- Modify: `model/check-model.ts:49-53` (replace the private `formatCheckedAt`)
- Test: `model/check-model.test.ts` (new `describe` block)

**Interfaces:**
- Consumes: nothing from earlier tasks.
- Produces: `export function formatCheckedAt(checkedAt: number, now: Date): string` — same local calendar day → `"13:07"`, any other day → `"24.07 13:07"`.

- [ ] **Step 1: Write the failing test**

Add this block to `model/check-model.test.ts`, directly after the existing `describe('mapCheckError', …)` block. Add `formatCheckedAt` to the existing import from `./check-model`.

```ts
describe('formatCheckedAt', () => {
  it('renders only the time when the check happened today', () => {
    expect(
      formatCheckedAt(new Date('2026-07-24T13:07:00').getTime(), new Date('2026-07-24T21:40:00')),
    ).toBe('13:07')
  })

  it('renders the date when the check happened on another day', () => {
    expect(
      formatCheckedAt(new Date('2026-07-24T13:07:00').getTime(), new Date('2026-07-26T09:00:00')),
    ).toBe('24.07 13:07')
  })

  it('renders the date for a check exactly 24 hours old', () => {
    expect(
      formatCheckedAt(new Date('2026-07-25T13:07:00').getTime(), new Date('2026-07-26T13:07:00')),
    ).toBe('25.07 13:07')
  })

  it('pads single-digit days, months, hours and minutes', () => {
    expect(
      formatCheckedAt(new Date('2026-08-03T09:05:00').getTime(), new Date('2026-08-04T10:00:00')),
    ).toBe('03.08 09:05')
  })
})
```

- [ ] **Step 2: Run the test and watch it fail**

```bash
pnpm --filter widgets-passport-checker exec vitest run model/check-model.test.ts -t formatCheckedAt
```

Expected: FAIL — `formatCheckedAt is not a function` (it is currently private and takes a `Date`).

- [ ] **Step 3: Replace the private helper with the exported one**

In `model/check-model.ts`, replace lines 49-53:

```ts
function formatCheckedAt(date: Date): string {
  const hours = String(date.getHours()).padStart(2, '0')
  const minutes = String(date.getMinutes()).padStart(2, '0')
  return `${hours}:${minutes}`
}
```

with:

```ts
const pad = (value: number) => String(value).padStart(2, '0')

/**
 * A stored result outlives the day it was taken, so a bare HH:MM would read as
 * "today" forever. Same-day results keep the short form; older ones carry the
 * date. Recomputed only when the view state recomputes — a tab left open across
 * midnight keeps yesterday's short label until something else changes.
 */
export function formatCheckedAt(checkedAt: number, now: Date): string {
  const date = new Date(checkedAt)
  const time = `${pad(date.getHours())}:${pad(date.getMinutes())}`
  const sameDay =
    date.getFullYear() === now.getFullYear() &&
    date.getMonth() === now.getMonth() &&
    date.getDate() === now.getDate()
  return sameDay ? time : `${pad(date.getDate())}.${pad(date.getMonth() + 1)} ${time}`
}
```

Then fix its single call site in `checkPassport` (currently `checkedAtLabel: formatCheckedAt(now())`) so the file still compiles:

```ts
      checkedAtLabel: formatCheckedAt(now().getTime(), now()),
```

That call site is rewritten in Task 2; this keeps the tree green in between.

- [ ] **Step 4: Run the tests and watch them pass**

```bash
pnpm --filter widgets-passport-checker test
```

Expected: PASS — the four new cases plus every pre-existing case (the success test still asserts `checkedAtLabel: '13:07'`, which the same-day branch produces).

- [ ] **Step 5: Commit**

```bash
git add packages/widgets/passport-checker/model/check-model.ts packages/widgets/passport-checker/model/check-model.test.ts
git commit -m "feat(passport-checker): date-aware check timestamp label"
```

---

### Task 2: Persist the last successful check in shared storage

**Files:**
- Modify: `model/check-model.ts` (key, schema, `lastResult`, `transient`, `viewState` computed, `checkPassport`)
- Modify: `ui/PassportChecker.tsx:27-42` (pass `storage.shared.server`)
- Test: `model/check-model.test.ts` (new persistence cases + `storage` on existing model builds)
- Modify: `model/recovery-flow.test.ts:13-15`, `ui/RecoveryModal.test.tsx:51-54`, `ui/recovery-modal-radix-stack.test.tsx:54-57`, `ui/PassportChecker.test.tsx:9-28`

**Interfaces:**
- Consumes: `formatCheckedAt(checkedAt: number, now: Date): string` from Task 1.
- Produces:
  - `export const PASSPORT_LAST_RESULT_KEY = 'lastResult'`
  - `export const lastResultSchema` / `export type StoredCheckResult = { status: number; message: string; checkedAt: number }`
  - `export type TransientState = Exclude<ViewState, { kind: 'success' }>`
  - `makePassportCheckModel({ api, storage, deadlineMs?, now? })` where `storage: StorageApi`
  - The model returns `{ viewState, transient, lastResult, recoveryOpen, checkPassport }`. `viewState` is now a `Computed<ViewState>` — readable, not writable.

- [ ] **Step 1: Write the failing tests**

In `model/check-model.test.ts`:

(a) Add the imports:

```ts
import { createFakeStorage } from 'widget-runtime/storage/test/fakes'
import type { StorageApi } from 'widget-runtime'
```

and extend the existing import from `./check-model` with `PASSPORT_LAST_RESULT_KEY`.

(b) Add `storage: createFakeStorage()` to all five existing `makePassportCheckModel({ … })` calls in this file (lines 76, 109, 126, 142, 159). Example for the first one:

```ts
      const model = makePassportCheckModel({
        api,
        storage: createFakeStorage(),
        now: () => new Date('2026-07-24T13:07:00'),
      })
```

(c) Add this block at the end of the file, after the existing `describe('makePassportCheckModel', …)`:

```ts
const STORED = {
  status: 200,
  message: 'Документ готовий',
  checkedAt: new Date('2026-07-24T13:07:00').getTime(),
}

async function seed(storage: StorageApi) {
  const result = await storage.set(PASSPORT_LAST_RESULT_KEY, STORED)
  if (result instanceof Error) throw result
}

describe('makePassportCheckModel persistence', () => {
  it('writes a successful check to the shared key', async () => {
    const { api, invoke } = makeApi()
    invoke.mockResolvedValueOnce({ status: 200, send_status_msg: 'Документ готовий' })
    const storage = createFakeStorage()

    await context.start(async () => {
      const model = makePassportCheckModel({
        api,
        storage,
        now: () => new Date('2026-07-24T13:07:00'),
      })
      const run = wrap(() => model.checkPassport())
      await run()
    })

    // The change hook that performs the write is flushed on a microtask, so the
    // value is not in the fake the instant `checkPassport` resolves.
    await vi.waitFor(async () => {
      expect(await storage.get(PASSPORT_LAST_RESULT_KEY)).toEqual(STORED)
    })
  })

  it('restores a stored result into the view state without checking', async () => {
    const { api, invoke } = makeApi()
    const storage = createFakeStorage()
    await seed(storage)

    await context.start(async () => {
      const model = makePassportCheckModel({
        api,
        storage,
        now: () => new Date('2026-07-24T21:40:00'),
      })
      const read = wrap(() => model.viewState())
      // withStorageKey subscribes from a connect hook, so the atom only reads
      // storage while something is subscribed to it.
      const unsubscribe = model.viewState.subscribe(() => {})

      await vi.waitFor(() => {
        expect(read()).toEqual({
          kind: 'success',
          status: 200,
          message: 'Документ готовий',
          checkedAtLabel: '13:07',
        })
      })

      unsubscribe()
    })

    expect(invoke).not.toHaveBeenCalled()
  })

  it('dates a restored result taken on an earlier day', async () => {
    const { api } = makeApi()
    const storage = createFakeStorage()
    await seed(storage)

    await context.start(async () => {
      const model = makePassportCheckModel({
        api,
        storage,
        now: () => new Date('2026-07-26T09:00:00'),
      })
      const read = wrap(() => model.viewState())
      const unsubscribe = model.viewState.subscribe(() => {})

      await vi.waitFor(() => {
        expect(read()).toMatchObject({ kind: 'success', checkedAtLabel: '24.07 13:07' })
      })

      unsubscribe()
    })
  })

  it('shows a failed check without erasing the stored result', async () => {
    const { api, invoke } = makeApi()
    invoke.mockResolvedValueOnce(apiError('browser_unavailable'))
    const storage = createFakeStorage()
    await seed(storage)

    await context.start(async () => {
      const model = makePassportCheckModel({
        api,
        storage,
        now: () => new Date('2026-07-24T21:40:00'),
      })
      const read = wrap(() => model.viewState())
      const run = wrap(() => model.checkPassport())
      const unsubscribe = model.viewState.subscribe(() => {})

      await run()

      expect(read()).toEqual({
        kind: 'retryable',
        message: RETRYABLE_MESSAGES.browser_unavailable,
      })
      unsubscribe()
    })

    expect(await storage.get(PASSPORT_LAST_RESULT_KEY)).toEqual(STORED)
  })
})
```

- [ ] **Step 2: Run the tests and watch them fail**

```bash
pnpm --filter widgets-passport-checker exec vitest run model/check-model.test.ts
```

Expected: the four new cases FAIL — the write case because `storage.get` returns `null`, the two restore cases because `viewState` stays `{ kind: 'idle' }`. The pre-existing cases still pass (`storage` is an unknown option the factory ignores at runtime).

- [ ] **Step 3: Rewrite the model**

In `model/check-model.ts`:

(a) Extend the imports:

```ts
import { action, atom, computed, wrap } from '@reatom/core'
import type { WidgetApi } from '@shared/widgets/contracts'
import * as errore from 'errore'
import { WidgetApiError, withStorageKey } from 'widget-runtime'
import type { StorageApi } from 'widget-runtime'
import { z } from 'zod'
```

(b) Below the `ViewState` union, add the transient type and the storage contract:

```ts
/** Everything that describes the current attempt rather than a stored fact. */
export type TransientState = Exclude<ViewState, { kind: 'success' }>

export const PASSPORT_LAST_RESULT_KEY = 'lastResult'

export const lastResultSchema = z.object({
  status: z.number().int(),
  message: z.string(),
  checkedAt: z.number().int(),
})
export type StoredCheckResult = z.output<typeof lastResultSchema>
```

(c) Change `mapCheckError`'s return type from `ViewState` to `TransientState` (the body already returns only those variants).

(d) Extend the options type:

```ts
export type MakePassportCheckModelOptions = {
  api: WidgetApi<PassportCheckerEvents, WidgetApiError>
  /** The shared-scope server storage; the model never sees the scope itself. */
  storage: StorageApi
  deadlineMs?: number
  now?: () => Date
}
```

(e) Replace the factory body between the `viewState` atom and the `return` (currently lines 90-113):

```ts
export function makePassportCheckModel({
  api,
  storage,
  deadlineMs = CHECK_DEADLINE_MS,
  now = () => new Date(),
}: MakePassportCheckModelOptions) {
  // Persisted across reloads, placements and devices: the passport status is a
  // fact about the world, not a property of one tile. withStorageKey owns both
  // directions — it subscribes on connect and writes back on local change.
  const lastResult = atom<StoredCheckResult | null>(null, 'passportCheck.lastResult').extend(
    withStorageKey({ api: storage, key: PASSPORT_LAST_RESULT_KEY, schema: lastResultSchema }),
  )
  const transient = atom<TransientState>({ kind: 'idle' }, 'passportCheck.transient')
  const recoveryOpen = atom(false, 'passportCheck.recoveryOpen')

  const viewState = computed<ViewState>(() => {
    // Read `lastResult` unconditionally, ahead of the transient branch. Behind
    // an `if` the dependency would disappear whenever a check is pending or an
    // error is showing, disconnecting the atom and tearing down its storage
    // subscription — every check would then re-subscribe (and, on the HTTP
    // backend, re-GET) on the way back to idle.
    const stored = lastResult()
    const current = transient()
    if (current.kind !== 'idle') return current
    if (!stored) return { kind: 'idle' }
    return {
      kind: 'success',
      status: stored.status,
      message: stored.message,
      checkedAtLabel: formatCheckedAt(stored.checkedAt, now()),
    }
  }, 'passportCheck.viewState')

  const checkPassport = action(async () => {
    if (transient().kind === 'pending') return
    transient.set({ kind: 'pending' })
    // Continuations after `await` run outside the calling frame; capture the
    // frame-bound writers now (repo wrap rules — never hoist them to module scope).
    const fail = wrap((next: TransientState) => transient.set(next))
    const succeed = wrap((next: StoredCheckResult) => {
      // Order matters only for readability: the write is what persists, and
      // clearing `transient` is what lets the computed show it.
      lastResult.set(next)
      transient.set({ kind: 'idle' })
    })

    const result = await withDeadline(api.invoke('check', {}), deadlineMs)
    if (result instanceof Error) {
      fail(mapCheckError(result))
      return
    }
    succeed({
      status: result.status,
      message: result.send_status_msg,
      checkedAt: now().getTime(),
    })
  }, 'passportCheck.check')

  return { viewState, transient, lastResult, recoveryOpen, checkPassport }
}
```

- [ ] **Step 4: Run the model tests and watch them pass**

```bash
pnpm --filter widgets-passport-checker exec vitest run model/check-model.test.ts
```

Expected: PASS, all cases.

If the two restore cases still fail with `{ kind: 'idle' }` after this, the connect hook is not firing under a bare Vitest frame — the same wall `ofelia-poop-duty` hit with `withStorageKeyReadonly` (see the comment at `packages/widgets/ofelia-poop-duty/model/ofelia-duty.test.ts:18-23`). In that case delete the two restore cases from this file and add the equivalent coverage to `ui/PassportChecker.test.tsx` in Task 3, where React drives the connection; keep the write case and the failure case here, since neither depends on the connect hook.

- [ ] **Step 5: Wire the widget and repair the other call sites**

`ui/PassportChecker.tsx` — take `storage` from the context and pass its shared server API:

```tsx
  const { tier, typeId, instanceId, api, storage, requestClose, requestFullscreen } =
    useWidgetContext<PassportCheckerEvents>()

  const { checkModel, recoveryModel, recoveryFlow } = passportInstance(instanceId, () => {
    const checkModel = makePassportCheckModel({ api, storage: storage.shared.server })
```

`model/recovery-flow.test.ts` — add the storage to the model build in `setup()`:

```ts
import { createFakeStorage } from 'widget-runtime/storage/test/fakes'

  const checkModel = makePassportCheckModel({
    api: { invoke } as unknown as WidgetApi<PassportCheckerEvents, WidgetApiError>,
    storage: createFakeStorage(),
  })
```

`ui/RecoveryModal.test.tsx` — same import, plus the seed moves off the now-computed `viewState`:

```ts
  const checkModel = makePassportCheckModel({
    api: { invoke } as unknown as WidgetApi<PassportCheckerEvents, WidgetApiError>,
    storage: createFakeStorage(),
  })
  checkModel.transient.set({ kind: 'sessionRequired', sshTarget })
  checkModel.recoveryOpen.set(true)
```

`ui/recovery-modal-radix-stack.test.tsx` — identical change in `makeValue()`:

```ts
  const checkModel = makePassportCheckModel({
    api: { invoke } as unknown as WidgetApi<PassportCheckerEvents, WidgetApiError>,
    storage: createFakeStorage(),
  })
  checkModel.transient.set({ kind: 'sessionRequired', sshTarget: 'admin@pi' })
  checkModel.recoveryOpen.set(true)
```

`ui/PassportChecker.test.tsx` — replace the real host runtime storage with a fake. Drop `makeHostRuntime` from the `widget-runtime` import, add the fake import, and rewrite `makeProps`:

```tsx
import { createFakeStorage } from 'widget-runtime/storage/test/fakes'

/** Isolated in-memory storage. The real host runtime would issue HTTP requests
 *  to /api/storage from jsdom now that the widget reads shared storage. */
function makeFakeStorage(): WidgetRuntimeProps['storage'] {
  const instance = createFakeStorage()
  const shared = createFakeStorage()
  return {
    instance: { client: instance, server: instance },
    shared: { client: shared, server: shared },
  }
}

function makeProps(
  tier: WidgetRuntimeProps['tier'],
  invoke: () => Promise<InvokeResult>,
  instanceId = 'inst-passport',
  storage: WidgetRuntimeProps['storage'] = makeFakeStorage(),
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
    storage,
    api: { invoke: invoke as WidgetRuntimeProps['api']['invoke'] },
  }
  return props
}
```

`ui/recovery-flow.test.tsx` is deliberately left alone: both of its render helpers already stub `fetch` with a never-resolving promise, so its real widget storage issues no request.

- [ ] **Step 6: Run the whole package suite**

```bash
pnpm --filter widgets-passport-checker test
```

Expected: PASS. `gives separate instance ids separate state` still passes because `makeProps` hands each placement its own fake storage — add this comment above that test so the reason is on the record:

```tsx
  // Separate model graphs AND separate fake storages. In production the key is
  // type-scoped, so two placements do converge on the same stored result once
  // one of them checks — that is covered by the cross-placement test below.
```

- [ ] **Step 7: Typecheck**

```bash
pnpm --filter widgets-passport-checker typecheck
```

Expected: clean. A `Property 'set' does not exist` error here means a `viewState.set` call site was missed.

- [ ] **Step 8: Commit**

```bash
git add packages/widgets/passport-checker
git commit -m "feat(passport-checker): persist the last successful check"
```

---

### Task 3: Prove the behaviour end to end in the widget

**Files:**
- Test: `ui/PassportChecker.test.tsx` (two new cases in the `shared instance state` describe)

**Interfaces:**
- Consumes: `makeProps(tier, invoke, instanceId, storage)` and `makeFakeStorage()` from Task 2; the storage key literal `'lastResult'`.
- Produces: nothing consumed by later tasks.

- [ ] **Step 1: Write the failing tests**

Append both cases to the existing `describe('PassportChecker / shared instance state', …)` block in `ui/PassportChecker.test.tsx`:

```tsx
  it('renders a stored result on mount, without checking', async () => {
    const storage = makeFakeStorage()
    await storage.shared.server.set('lastResult', {
      status: 200,
      message: 'Документ готовий',
      checkedAt: Date.now(),
    })
    const invoke = vi.fn<() => Promise<InvokeResult>>()

    render(
      <WidgetRuntimeContext.Provider
        value={makeProps('standard', invoke, 'inst-restored', storage)}
      >
        <PassportChecker />
      </WidgetRuntimeContext.Provider>,
    )

    expect(await screen.findByText('Документ готовий')).toBeInTheDocument()
    expect(screen.getByText(/статус 200 · проверено \d{2}:\d{2}/)).toBeInTheDocument()
    expect(screen.getByRole('button', { name: /Проверить снова/ })).toBeInTheDocument()
    expect(invoke).not.toHaveBeenCalled()
  })

  it('shows a check from one placement in another placement', async () => {
    const storage = makeFakeStorage()
    const invoke = vi.fn(async () => ({ status: 200, send_status_msg: 'Готово' }))

    render(
      <>
        <WidgetRuntimeContext.Provider value={makeProps('standard', invoke, 'inst-shared-a', storage)}>
          <PassportChecker />
        </WidgetRuntimeContext.Provider>
        <WidgetRuntimeContext.Provider value={makeProps('standard', invoke, 'inst-shared-b', storage)}>
          <PassportChecker />
        </WidgetRuntimeContext.Provider>
      </>,
    )

    fireEvent.click(screen.getAllByRole('button', { name: /Проверить/ })[0])

    // Two independent model graphs, one type-scoped key: the second placement
    // learns the result through storage, not through a second check.
    await waitFor(() => expect(screen.getAllByText('Готово')).toHaveLength(2))
    expect(invoke).toHaveBeenCalledTimes(1)
  })
```

- [ ] **Step 2: Run them**

```bash
pnpm --filter widgets-passport-checker exec vitest run ui/PassportChecker.test.tsx
```

Expected: PASS — Task 2 already implemented the behaviour; these cases exist to pin it at the widget level. If either fails, the defect is real and belongs to Task 2's implementation, not to the test: fix the model rather than the assertion.

- [ ] **Step 3: Run the full package suite**

```bash
pnpm --filter widgets-passport-checker test
```

Expected: PASS.

- [ ] **Step 4: Run the repository gate**

```bash
pnpm check
```

Expected: lint, format, typecheck and every workspace test pass. `pnpm format:fix` (or `pnpm lint:fix`) resolves formatting complaints.

- [ ] **Step 5: Commit**

```bash
git add packages/widgets/passport-checker/ui/PassportChecker.test.tsx
git commit -m "test(passport-checker): cover restore-on-mount and cross-placement sync"
```

---

## Manual verification

Not required for the tasks above to be complete, but worth one pass before the PR:

```bash
pnpm dev
```

Open the board, run a check on the passport widget, reload the page — the result comes back with its timestamp. Open the board in a second tab and confirm the same result is already there.
