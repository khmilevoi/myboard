# F5 — Comments (Ofelia) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a per-week comment thread to the Ofelia widget — a standalone `ofeliaCommentsModel` factory (reactive per-week read keyed by the viewed week + a `send` action that attributes the author to the global `currentUser`) plus a prop-driven `CommentThread` UI part.

**Architecture:** Comments live in a **new** model file `model/ofelia-comments.ts` with a factory `ofeliaCommentsModel({ storage, viewWeekStart, currentUser })`. Comments are decoupled from the debt/duty/undo logic and need only two things from the duty model — the viewed-week computed and the `currentUser` atom — so they are passed in as injected dependencies rather than folded into `ofelia-duty.ts` (this differs from F4's history, which folded into the duty model because it coupled to `undo`/debt). The reactive read mirrors the per-week subscription shape: an `effect` tracks `viewWeekStart()` and re-subscribes to `comments:<weekStartISO>` over `storage.shared.server.subscribe`, hosted inside a `withConnectHook` so it tears the live subscription down on widget unmount. Writes go through F2's `storage.shared.server.append`, which stamps `id`/`ts`/`ip` server-side and republishes the whole array over SSE (so the thread refreshes after every send for free). The UI part `ui/parts/CommentThread.tsx` is a `reatomMemo`-wrapped, prop-driven presentational component with a local input; wiring the part + model into the tier router is F6's job.

**Tech Stack:** TypeScript (ESM), Reatom v1001 (`atom`/`computed`/`action`/`effect`/`withConnectHook`/`withAsyncData`/`wrap`/`Atom`), Zod v4 (`import z from 'zod'`), Temporal (global polyfill), Vitest + jsdom, Testing Library (`render`/`screen`/`fireEvent`).

## Global Constraints

- **New files only.** F5 creates `model/ofelia-comments.{ts,test.ts}` and `ui/parts/CommentThread.{tsx,module.css,test.tsx}`. Do **not** modify `model/ofelia-duty.ts`, `ui/OfeliaPoopDuty.tsx` (the tier router is F6), the storage layer (F2 is merged), or the server.
- **Per-week key.** Comments are stored under `comments:<weekStartISO>` in `shared.server` (full namespaced key `w:t:ofelia-poop-duty:comments:<iso>`). `weekStartISO` is the Monday of the week, Europe/Warsaw — reuse the exported helper from `ofelia-duty.ts` (do not re-derive).
- **Injected dependencies.** The comments model takes `viewWeekStart: Atom<Temporal.PlainDate | null>` and `currentUser: Atom<Person>` as constructor props. It must **not** import or instantiate `ofeliaDutyModel`; F6 wires `dutyModel.viewWeekStart` / `dutyModel.currentUser` into it.
- **Author = `currentUser()` at send time** (spec §3.5, contract 4.6). There is **no** local author toggle in the thread. The UI never picks the author.
- **Reactive, SSE-backed read.** The key follows `viewWeekStart`, so the subscription **re-keys on week change** and tears down on disconnect (`withConnectHook` + `effect`). Before the first server-time sync `viewWeekStart()` is `null` → `comments` holds `[]`, **no** subscription is opened, and `send` is a no-op.
- **Errors as values (errore/Reatom).** Storage callbacks deliver `StorageError | StorageChange<T>`; narrow with `instanceof Error` and **ignore** errors inside the subscription listener (never throw from it). `send` re-throws the append error so `withAsyncData` captures it in `.error()`/`.status()`. Never use `try/catch` for control flow.
- **Async boundaries use `wrap`.** Every storage call / callback that touches an atom is wrapped with `wrap(...)` (matches `withStorageKey` and the rest of the repo).
- **Code style (oxfmt).** **Single quotes, no semicolons, 2-space indent, named exports**, and **every** atom/action/computed/effect carries an explicit `'ofeliaComments.<name>'` trace name. New UI files follow the single-quote/no-semicolon style of `AddWidgetMenu.tsx`. Run `pnpm format` before the final commit.
- **Reatom defaults.** Direct atom writes use `atom.set(...)` (no pass-through setter actions). The subscription is connection-scoped (`withConnectHook`), not an always-on top-level `effect`, so it auto-tears-down on widget unmount. `send` follows the local Ofelia convention of `action(async …).extend(withAsyncData({ status: true }))` (matches `confirmClean`/`goIntoDebt`/`forgive`/`undo`).
- **Before PR:** `pnpm test`, `pnpm typecheck`, `pnpm lint`, and `pnpm format:check` must pass (run from repo root).

---

## File Structure

- **Create** `client/widgets/ofelia-poop-duty/model/ofelia-comments.ts`
  - Types `Comment`, `CommentDraft`, `CommentView` (owns contract 4.4).
  - Zod schemas `CommentSchema`, `CommentsSchema` (module-private).
  - Free fn `commentsKey(date)` → `comments:<weekStartISO>`.
  - `OfeliaCommentsModelProps` + `ofeliaCommentsModel(...)` factory returning `{ comments, commentThread, send }`.
- **Create** `client/widgets/ofelia-poop-duty/model/ofelia-comments.test.ts`
- **Create** `client/widgets/ofelia-poop-duty/ui/parts/CommentThread.tsx`
- **Create** `client/widgets/ofelia-poop-duty/ui/parts/CommentThread.module.css`
- **Create** `client/widgets/ofelia-poop-duty/ui/parts/CommentThread.test.tsx`

Reused from `model/ofelia-duty.ts` (already merged via F3, consumed not redefined): exported `DUTY_ROTATION`, `weekStartISO(date)`, and the `Person` type. From F2 (merged): `StorageApi.append` and `StorageApi.subscribe` on `storage.shared.server`.

---

## Task 1: `comments` atom + reactive per-week subscription

**Files:**

- Create: `client/widgets/ofelia-poop-duty/model/ofelia-comments.ts`
- Test: `client/widgets/ofelia-poop-duty/model/ofelia-comments.test.ts`

**Interfaces:**

- Consumes: `DUTY_ROTATION`, `weekStartISO`, `Person` (from `./ofelia-duty`); `WidgetStorage` (`@/storage/model/widget-storage`); injected `viewWeekStart: Atom<Temporal.PlainDate | null>`, `currentUser: Atom<Person>`; `storage.shared.server.subscribe`.
- Produces:
  - `export type Comment = { id: string; ts: number; ip?: string; author: Person; text: string }`
  - `export type CommentDraft = Pick<Comment, 'author' | 'text'>`
  - `export function commentsKey(date: Temporal.PlainDate): string`
  - `export interface OfeliaCommentsModelProps { storage: WidgetStorage; viewWeekStart: Atom<Temporal.PlainDate | null>; currentUser: Atom<Person> }`
  - `ofeliaCommentsModel(...)` return gains `comments: Atom<Comment[]>` — `[]` by default and before the first sync; reflects the viewed week's thread; re-subscribes when the week changes; tears the subscription down on disconnect.

- [ ] **Step 1: Write the failing tests**

Create `client/widgets/ofelia-poop-duty/model/ofelia-comments.test.ts`:

```ts
import { atom, context } from '@reatom/core'
import { afterEach, describe, expect, it, vi } from 'vitest'

import type { StorageApi, StorageListener } from '@/storage/model/types'
import type { WidgetStorage } from '@/storage/model/widget-storage'

import type { Person } from './ofelia-duty'
import { commentsKey, ofeliaCommentsModel } from './ofelia-comments'
import type { Comment } from './ofelia-comments'

function createStorage(overrides: Partial<StorageApi> = {}): WidgetStorage {
  const api: StorageApi = {
    get: vi.fn(async () => null),
    set: vi.fn(async () => undefined),
    delete: vi.fn(async () => undefined),
    has: vi.fn(async () => false),
    keys: vi.fn(async () => []),
    append: vi.fn(async () => undefined),
    subscribe: vi.fn(() => () => {}),
    ...overrides,
  }

  return {
    instance: { client: api, server: api },
    shared: { client: api, server: api },
  }
}

type SubscribeCall = {
  key: string
  listener: StorageListener<Comment[]>
  unsubscribe: ReturnType<typeof vi.fn>
}

function createCommentsStorage() {
  const calls: SubscribeCall[] = []

  const subscribe = vi.fn((key: string, listener: StorageListener<Comment[]>) => {
    const unsubscribe = vi.fn()
    calls.push({ key, listener, unsubscribe })
    return unsubscribe
  }) as unknown as StorageApi['subscribe']

  const storage = createStorage({ subscribe })

  const emit = (key: string, value: Comment[] | null) => {
    for (const call of calls) {
      if (call.key === key) call.listener({ value })
    }
  }

  return { storage, subscribe, calls, emit }
}

const D = (iso: string) => Temporal.PlainDate.from(iso)

function makeDeps(weekStart: Temporal.PlainDate | null = D('2026-06-15'), user: Person = 'Леша') {
  return {
    viewWeekStart: atom<Temporal.PlainDate | null>(weekStart, 'test.viewWeekStart'),
    currentUser: atom<Person>(user, 'test.currentUser'),
  }
}

const cm = (overrides: Partial<Comment> = {}): Comment => ({
  id: 'comment-1',
  ts: 1,
  ip: '127.0.0.1',
  author: 'Леша',
  text: 'hello',
  ...overrides,
})

afterEach(() => {
  context.reset()
})

describe('commentsKey', () => {
  it('keys by the Monday of the week', () => {
    expect(commentsKey(D('2026-06-16'))).toBe('comments:2026-06-15')
    expect(commentsKey(D('2026-06-21'))).toBe('comments:2026-06-15')
    expect(commentsKey(D('2026-06-22'))).toBe('comments:2026-06-22')
  })
})

describe('ofeliaCommentsModel.comments', () => {
  it('defaults to an empty array', () => {
    const model = ofeliaCommentsModel({ storage: createStorage(), ...makeDeps() })

    expect(model.comments()).toEqual([])
  })

  it('subscribes to the viewed week key and reflects emitted comments', async () => {
    const { storage, subscribe, emit } = createCommentsStorage()
    const model = ofeliaCommentsModel({ storage, ...makeDeps(D('2026-06-15')) })

    await context.start(async () => {
      const off = model.comments.subscribe(() => {})

      await vi.waitFor(() =>
        expect(subscribe).toHaveBeenCalledWith(
          'comments:2026-06-15',
          expect.any(Function),
          expect.anything(),
        ),
      )

      emit('comments:2026-06-15', [cm({ id: 'c1', text: 'hi' })])

      await vi.waitFor(() => expect(model.comments()).toHaveLength(1))
      expect(model.comments()[0]?.text).toBe('hi')

      off()
    })
  })

  it('re-subscribes to the new week and drops the old subscription', async () => {
    const { storage, subscribe, calls } = createCommentsStorage()
    const deps = makeDeps(D('2026-06-15'))
    const model = ofeliaCommentsModel({ storage, ...deps })

    await context.start(async () => {
      const off = model.comments.subscribe(() => {})

      await vi.waitFor(() =>
        expect(subscribe).toHaveBeenCalledWith(
          'comments:2026-06-15',
          expect.any(Function),
          expect.anything(),
        ),
      )

      deps.viewWeekStart.set(D('2026-06-22'))

      await vi.waitFor(() =>
        expect(subscribe).toHaveBeenCalledWith(
          'comments:2026-06-22',
          expect.any(Function),
          expect.anything(),
        ),
      )
      expect(calls[0]?.unsubscribe).toHaveBeenCalled()

      off()
    })
  })

  it('opens no subscription until a week is available, then subscribes', async () => {
    const { storage, subscribe } = createCommentsStorage()
    const deps = makeDeps(null)
    const model = ofeliaCommentsModel({ storage, ...deps })

    await context.start(async () => {
      const off = model.comments.subscribe(() => {})

      // With no viewed week the connect effect must not open a subscription.
      await vi.waitFor(() => expect(model.comments()).toEqual([]))
      expect(subscribe).not.toHaveBeenCalled()

      deps.viewWeekStart.set(D('2026-06-15'))

      await vi.waitFor(() =>
        expect(subscribe).toHaveBeenCalledWith(
          'comments:2026-06-15',
          expect.any(Function),
          expect.anything(),
        ),
      )

      off()
    })
  })
})
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `pnpm --filter client test -- ofelia-comments`
Expected: FAIL — cannot resolve `./ofelia-comments` (module does not exist yet).

- [ ] **Step 3: Write minimal implementation**

Create `client/widgets/ofelia-poop-duty/model/ofelia-comments.ts`:

```ts
import { action, atom, computed, effect, withAsyncData, withConnectHook, wrap } from '@reatom/core'
import type { Atom } from '@reatom/core'
import z from 'zod'

import type { WidgetStorage } from '@/storage/model/widget-storage'

import { DUTY_ROTATION, weekStartISO } from './ofelia-duty'
import type { Person } from './ofelia-duty'

const AuthorSchema = z.enum(DUTY_ROTATION)

const CommentSchema = z.object({
  id: z.string(),
  ts: z.number(),
  ip: z.string().optional(),
  author: AuthorSchema,
  text: z.string(),
})

const CommentsSchema = z.array(CommentSchema)

// Derive the type from the schema so the runtime contract and the static type
// cannot drift. `author` infers to the `DUTY_ROTATION` union, which is exactly
// `Person` (`Person = (typeof DUTY_ROTATION)[number]`) — mirrors the
// `PersonSchema`/`Person` pairing in `ofelia-duty.ts`.
export type Comment = z.infer<typeof CommentSchema>

export type CommentDraft = Pick<Comment, 'author' | 'text'>

export type CommentView = {
  id: string
  author: Person
  text: string
}

export function commentsKey(date: Temporal.PlainDate): string {
  return `comments:${weekStartISO(date)}`
}

export interface OfeliaCommentsModelProps {
  storage: WidgetStorage
  viewWeekStart: Atom<Temporal.PlainDate | null>
  currentUser: Atom<Person>
}

export const ofeliaCommentsModel = ({
  storage,
  viewWeekStart,
  currentUser,
}: OfeliaCommentsModelProps) => {
  // The comment key follows the viewed week, so the subscription must re-key on
  // navigation. An `effect` tracks `viewWeekStart` and (re)opens the storage
  // subscription; the connect hook tears the live subscription down on disconnect
  // (the effect itself is disposed via `sync.unsubscribe()`), so unmounting the
  // widget releases the SSE subscription.
  //
  // Why not `withStorageKey`? That primitive is a fixed-key, two-way binding: it
  // write-backs the *whole* value via `withChangeHook` + `api.set` on every
  // change (see `reatom-storage.ts`). Comments are append-only and server-stamped
  // (id/ts/ip), so they must only ever be written through `append` — a full-array
  // `set` would be wrong. Reusing `withStorageKey` here would require generalizing
  // it to (a) accept a reactive `Atom<string | null>` key, (b) support a
  // read-only mode that skips the write-back, and (c) handle the null-key (no
  // subscription) case. That is a redesign of a shared primitive already consumed
  // by `ofeliaDutyModel`, and F5's constraints are "new files only; do not modify
  // the storage layer". A reactive-key + read-only variant is a worthwhile future
  // refactor (it would also DRY F4's per-week history), tracked as a follow-up.
  //
  // Optimistic UI is intentionally out of scope: the thread is server-authoritative.
  // `send` awaits `append`; the server stamps id/ts/ip and republishes the array
  // over SSE, which is what updates `comments`. Because a `Comment` is fully
  // server-stamped, an optimistic entry would need a synthetic id plus
  // reconciliation/dedup against the SSE echo and rollback on error — real
  // complexity for a LAN round-trip that is already fast (Valkey pub/sub fanout).
  // The interaction still feels responsive: the input clears immediately and
  // `withAsyncData({ status: true })` surfaces pending/error. Revisit if latency
  // proves noticeable in practice.
  const comments = atom<Comment[]>([], 'ofeliaComments.comments').extend(
    withConnectHook(() => {
      let off: () => void = () => {}

      const sync = effect(() => {
        const week = viewWeekStart()
        off()
        off = () => {}

        if (week == null) {
          comments.set([])
          return
        }

        off = storage.shared.server.subscribe<Comment[]>(
          commentsKey(week),
          wrap((event) => {
            if (event instanceof Error) return
            comments.set(event.value ?? [])
          }),
          CommentsSchema,
        )
      }, 'ofeliaComments.comments.sync')

      return () => {
        off()
        sync.unsubscribe()
      }
    }),
  )

  const commentThread = computed<CommentView[]>(
    () =>
      comments()
        .slice()
        .sort((a, b) => a.ts - b.ts)
        .map((comment) => ({
          id: comment.id,
          author: comment.author,
          text: comment.text,
        })),
    'ofeliaComments.commentThread',
  )

  const send = action(async (text: string) => {
    const week = viewWeekStart()
    if (week == null) return

    const trimmed = text.trim()
    if (trimmed.length === 0) return

    const draft: CommentDraft = { author: currentUser(), text: trimmed }

    const result = await wrap(storage.shared.server.append(commentsKey(week), draft))
    if (result instanceof Error) throw result
  }, 'ofeliaComments.send').extend(withAsyncData({ status: true }))

  return {
    comments,
    commentThread,
    send,
  }
}
```

> `commentThread` and `send` are written here in full so the file type-checks and the factory's `return` is complete, but they are **driven** by Tasks 2 and 3. If you prefer strict step-by-fail, you may stub `commentThread`/`send` minimally now; the cleaner path is to write the whole factory once (above) and let Tasks 2–3 add their tests against the already-present members.

- [ ] **Step 4: Run tests to verify they pass**

Run: `pnpm --filter client test -- ofelia-comments`
Expected: PASS (the `commentsKey` block + the four `comments` tests).

- [ ] **Step 5: Commit**

```bash
git add client/widgets/ofelia-poop-duty/model/ofelia-comments.ts client/widgets/ofelia-poop-duty/model/ofelia-comments.test.ts
git commit -m "feat(ofelia): reactive per-week comments subscription"
```

---

## Task 2: `commentThread` projection (chronological, view-only fields)

**Files:**

- Modify: `client/widgets/ofelia-poop-duty/model/ofelia-comments.ts` (the `commentThread` member already exists from Task 1 — this task adds its tests and locks behaviour)
- Test: `client/widgets/ofelia-poop-duty/model/ofelia-comments.test.ts`

**Interfaces:**

- Consumes: `comments` (Task 1).
- Produces: `ofeliaCommentsModel(...)` return member `commentThread: Computed<CommentView[]>` — comments oldest-first (`ts` ascending), each mapped to `{ id, author, text }` (server-only `ts`/`ip` are dropped from the view). `CommentView` is the exported type from Task 1.

- [ ] **Step 1: Write the failing test**

Extend the `./ofelia-comments` import in `ofelia-comments.test.ts` to add the view type:

```ts
import type { Comment, CommentView } from './ofelia-comments'
```

Add a describe block:

```ts
describe('ofeliaCommentsModel.commentThread', () => {
  it('orders comments oldest-first and exposes only view fields', () => {
    const model = ofeliaCommentsModel({ storage: createStorage(), ...makeDeps() })

    model.comments.set([
      cm({ id: 'b', ts: 3, author: 'Карина', text: 'third' }),
      cm({ id: 'a', ts: 1, author: 'Леша', text: 'first' }),
      cm({ id: 'c', ts: 2, author: 'Леша', text: 'second' }),
    ])

    const thread = model.commentThread()

    expect(thread.map((entry) => entry.id)).toEqual(['a', 'c', 'b'])

    const first: CommentView | undefined = thread[0]
    expect(first).toEqual({ id: 'a', author: 'Леша', text: 'first' })
    expect(first).not.toHaveProperty('ts')
    expect(first).not.toHaveProperty('ip')
  })
})
```

- [ ] **Step 2: Run the test to verify it fails (or passes against the Task 1 member)**

Run: `pnpm --filter client test -- ofelia-comments`
Expected: PASS if Task 1 wrote the full `commentThread` (recommended). If you stubbed it in Task 1, this is the failing test that drives the projection — implement `commentThread` exactly as shown in the Task 1 code block, then re-run to PASS.

- [ ] **Step 3: Implementation**

Already present from Task 1 (the `commentThread` computed). No change needed if Task 1 wrote the full factory. (If stubbed, paste the `commentThread` computed from the Task 1 code block now.)

- [ ] **Step 4: Run the test to verify it passes**

Run: `pnpm --filter client test -- ofelia-comments`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add client/widgets/ofelia-poop-duty/model/ofelia-comments.test.ts client/widgets/ofelia-poop-duty/model/ofelia-comments.ts
git commit -m "test(ofelia): lock commentThread chronological projection"
```

---

## Task 3: `send` action (author = currentUser, trimmed, per viewed week)

**Files:**

- Modify: `client/widgets/ofelia-poop-duty/model/ofelia-comments.ts` (the `send` member already exists from Task 1 — this task adds its tests and locks behaviour)
- Test: `client/widgets/ofelia-poop-duty/model/ofelia-comments.test.ts`

**Interfaces:**

- Consumes: injected `viewWeekStart`, `currentUser`; `storage.shared.server.append`; `commentsKey` (Task 1).
- Produces: `ofeliaCommentsModel(...)` return member `send: Action<(text: string) => Promise<void>>` — trims `text`; no-op on empty/whitespace; no-op when `viewWeekStart()` is `null`; otherwise appends `{ author: currentUser(), text: trimmed }` (a `CommentDraft`) to `commentsKey(viewWeekStart())`. Re-throws the storage error so `withAsyncData` captures it.

- [ ] **Step 1: Write the failing tests**

Add a describe block to `ofelia-comments.test.ts`:

```ts
describe('ofeliaCommentsModel.send', () => {
  it('appends a trimmed comment authored by the current user to the viewed week', async () => {
    const storage = createStorage()
    const model = ofeliaCommentsModel({ storage, ...makeDeps(D('2026-06-15'), 'Карина') })

    await model.send('  Привет  ')

    expect(storage.shared.server.append).toHaveBeenCalledWith('comments:2026-06-15', {
      author: 'Карина',
      text: 'Привет',
    })
  })

  it('ignores empty or whitespace-only text', async () => {
    const storage = createStorage()
    const model = ofeliaCommentsModel({ storage, ...makeDeps(D('2026-06-15')) })

    await model.send('   ')

    expect(storage.shared.server.append).not.toHaveBeenCalled()
  })

  it('is a no-op before the first sync (no viewed week)', async () => {
    const storage = createStorage()
    const model = ofeliaCommentsModel({ storage, ...makeDeps(null) })

    await model.send('hello')

    expect(storage.shared.server.append).not.toHaveBeenCalled()
  })

  it('writes to the currently viewed week after navigation', async () => {
    const storage = createStorage()
    const deps = makeDeps(D('2026-06-15'), 'Леша')
    const model = ofeliaCommentsModel({ storage, ...deps })

    deps.viewWeekStart.set(D('2026-06-22'))
    await model.send('next week note')

    expect(storage.shared.server.append).toHaveBeenCalledWith('comments:2026-06-22', {
      author: 'Леша',
      text: 'next week note',
    })
  })
})
```

- [ ] **Step 2: Run the tests to verify they fail (or pass against the Task 1 member)**

Run: `pnpm --filter client test -- ofelia-comments`
Expected: PASS if Task 1 wrote the full `send` (recommended). If you stubbed it in Task 1, these are the failing tests — implement `send` exactly as shown in the Task 1 code block, then re-run to PASS.

- [ ] **Step 3: Implementation**

Already present from Task 1 (the `send` action). No change needed if Task 1 wrote the full factory. (If stubbed, paste the `send` action from the Task 1 code block now.)

- [ ] **Step 4: Run tests + typecheck to verify green**

Run: `pnpm --filter client test -- ofelia-comments`
Expected: PASS.
Run: `pnpm typecheck`
Expected: PASS — the only callers of `ofeliaCommentsModel` are these tests (F6 wires the UI later).

- [ ] **Step 5: Commit**

```bash
git add client/widgets/ofelia-poop-duty/model/ofelia-comments.test.ts client/widgets/ofelia-poop-duty/model/ofelia-comments.ts
git commit -m "test(ofelia): lock send author/trim/week behaviour"
```

---

## Task 4: `CommentThread` UI part

**Files:**

- Create: `client/widgets/ofelia-poop-duty/ui/parts/CommentThread.tsx`
- Create: `client/widgets/ofelia-poop-duty/ui/parts/CommentThread.module.css`
- Test: `client/widgets/ofelia-poop-duty/ui/parts/CommentThread.test.tsx`

**Interfaces:**

- Consumes: `CommentView` (Task 1).
- Produces: `CommentThread` — a `reatomMemo`-wrapped, prop-driven presentational component. Props `{ comments: CommentView[]; onSend: (text: string) => void }`. Renders each comment (author + text) in order as supplied, an empty-state line when there are none, and a single-input form. On submit (button click or Enter, via native form submit) it trims the input, calls `onSend(trimmed)` only when non-empty, and clears the field. **No author selection lives here** — the author is the model's `currentUser` (F6 binds `onSend` to `model.send`).

- [ ] **Step 1: Write the failing test**

Create `client/widgets/ofelia-poop-duty/ui/parts/CommentThread.test.tsx`:

```tsx
// @vitest-environment jsdom
import { fireEvent, render, screen } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'

import type { CommentView } from '../../model/ofelia-comments'

import { CommentThread } from './CommentThread'

const view = (overrides: Partial<CommentView> = {}): CommentView => ({
  id: 'c1',
  author: 'Карина',
  text: 'Привет',
  ...overrides,
})

describe('CommentThread', () => {
  it('renders each comment with its author and text', () => {
    render(
      <CommentThread
        comments={[
          view({ id: 'c1', author: 'Карина', text: 'Первый' }),
          view({ id: 'c2', author: 'Леша', text: 'Второй' }),
        ]}
        onSend={vi.fn()}
      />,
    )

    expect(screen.getByText('Первый')).toBeInTheDocument()
    expect(screen.getByText('Второй')).toBeInTheDocument()
    expect(screen.getByText('Карина')).toBeInTheDocument()
    expect(screen.getByText('Леша')).toBeInTheDocument()
  })

  it('renders an empty state when there are no comments', () => {
    render(<CommentThread comments={[]} onSend={vi.fn()} />)

    expect(screen.getByText('Пока нет комментариев')).toBeInTheDocument()
  })

  it('sends the trimmed text and clears the input when the button is clicked', () => {
    const onSend = vi.fn()
    render(<CommentThread comments={[]} onSend={onSend} />)

    const input = screen.getByPlaceholderText('Добавить комментарий…') as HTMLInputElement
    fireEvent.change(input, { target: { value: '  Привет  ' } })
    fireEvent.click(screen.getByRole('button', { name: 'Отправить' }))

    expect(onSend).toHaveBeenCalledWith('Привет')
    expect(input.value).toBe('')
  })

  it('sends on Enter via native form submit', () => {
    const onSend = vi.fn()
    const { container } = render(<CommentThread comments={[]} onSend={onSend} />)

    const input = screen.getByPlaceholderText('Добавить комментарий…') as HTMLInputElement
    fireEvent.change(input, { target: { value: 'Ку' } })
    fireEvent.submit(container.querySelector('form') as HTMLFormElement)

    expect(onSend).toHaveBeenCalledWith('Ку')
    expect(input.value).toBe('')
  })

  it('does not send empty or whitespace-only text', () => {
    const onSend = vi.fn()
    render(<CommentThread comments={[]} onSend={onSend} />)

    fireEvent.change(screen.getByPlaceholderText('Добавить комментарий…'), {
      target: { value: '   ' },
    })
    fireEvent.click(screen.getByRole('button', { name: 'Отправить' }))

    expect(onSend).not.toHaveBeenCalled()
  })
})
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `pnpm --filter client test -- CommentThread`
Expected: FAIL — cannot resolve `./CommentThread`.

- [ ] **Step 3: Write the component and styles**

Create `client/widgets/ofelia-poop-duty/ui/parts/CommentThread.tsx`:

```tsx
import { useState } from 'react'

import { reatomMemo } from '@/shared/reatom/reatom-memo'

import type { CommentView } from '../../model/ofelia-comments'

import styles from './CommentThread.module.css'

export type CommentThreadProps = {
  comments: CommentView[]
  onSend: (text: string) => void
}

export const CommentThread = reatomMemo<CommentThreadProps>(({ comments, onSend }) => {
  const [text, setText] = useState('')

  const submit = () => {
    const trimmed = text.trim()
    if (trimmed.length === 0) return
    onSend(trimmed)
    setText('')
  }

  return (
    <div className={styles.root}>
      {comments.length === 0 ? (
        <div className={styles.empty}>Пока нет комментариев</div>
      ) : (
        <ul className={styles.list}>
          {comments.map((comment) => (
            <li key={comment.id} className={styles.item}>
              <span className={styles.author}>{comment.author}</span>
              <span className={styles.text}>{comment.text}</span>
            </li>
          ))}
        </ul>
      )}
      <form
        className={styles.form}
        onSubmit={(event) => {
          event.preventDefault()
          submit()
        }}
      >
        <input
          className={styles.input}
          value={text}
          onChange={(event) => setText(event.target.value)}
          placeholder="Добавить комментарий…"
          aria-label="Комментарий"
        />
        <button className={styles.send} type="submit">
          Отправить
        </button>
      </form>
    </div>
  )
}, 'CommentThread')
```

Create `client/widgets/ofelia-poop-duty/ui/parts/CommentThread.module.css` (minimal, theme-token based; F6 refines the visual to the design reference):

```css
.root {
  display: flex;
  flex-direction: column;
  gap: 8px;
  min-width: 0;
}

.list {
  margin: 0;
  padding: 0;
  list-style: none;
  display: flex;
  flex-direction: column;
  gap: 6px;
}

.item {
  display: flex;
  flex-direction: column;
  gap: 2px;
  min-width: 0;
}

.author {
  font-weight: 600;
  color: var(--text);
}

.text {
  color: var(--text-dim);
  overflow-wrap: anywhere;
}

.empty {
  font-size: 13px;
  color: var(--text-dim);
}

.form {
  display: flex;
  gap: 6px;
}

.input {
  flex: 1 1 auto;
  min-width: 0;
  padding: 6px 8px;
  border: 1px solid var(--border);
  border-radius: 8px;
  background: var(--surface);
  color: var(--text);
  font: inherit;
}

.send {
  flex: none;
  padding: 6px 12px;
  border: none;
  border-radius: 8px;
  background: var(--accent-soft);
  color: var(--text);
  font: inherit;
  cursor: pointer;
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `pnpm --filter client test -- CommentThread`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add client/widgets/ofelia-poop-duty/ui/parts/CommentThread.tsx client/widgets/ofelia-poop-duty/ui/parts/CommentThread.module.css client/widgets/ofelia-poop-duty/ui/parts/CommentThread.test.tsx
git commit -m "feat(ofelia): CommentThread UI part"
```

---

## Task 5: Verify & finalize

**Files:** none (verification only).

- [ ] **Step 1: Format**

Run: `pnpm format`
Expected: writes oxfmt formatting; re-stage if anything changed.

- [ ] **Step 2: Full workspace test + typecheck + lint + format check**

Run: `pnpm test`
Expected: PASS (whole monorepo).
Run: `pnpm typecheck`
Expected: PASS.
Run: `pnpm lint`
Expected: PASS.
Run: `pnpm format:check`
Expected: PASS.

- [ ] **Step 3: Commit any formatting**

```bash
git add -A
git commit -m "chore(ofelia): format F5 comments" || echo "nothing to format"
```

---

## Self-Review (against spec §F5 + §3.4 + §3.5 + contracts 4.4 / 4.6)

**1. Spec coverage:**

- **F5 goal — per-week thread with input; author = global `currentUser`:** `ofeliaCommentsModel.send` appends `{ author: currentUser(), text }` to the viewed week (Task 3); `CommentThread` renders the thread + input (Task 4). ✅
- **Key `comments:<weekStartISO>` (§3.4):** `commentsKey(date)` reuses the exported `weekStartISO` (Task 1, `commentsKey` test). ✅
- **Read + append (§5 F5 scope):** reactive read via `storage.shared.server.subscribe` re-keyed by `viewWeekStart` (Task 1); append via `storage.shared.server.append` (Task 3). ✅
- **"переключение недели меняет … комментарии" (§3.3/§3.4):** the `effect` tracks `viewWeekStart` and re-subscribes, dropping the previous subscription (Task 1 navigation test); `send` targets the currently viewed week (Task 3 navigation test). ✅
- **No local author toggle; author from `currentUser` (§3.4/§3.5, contract 4.6):** the UI has no author control; `send` reads injected `currentUser` (Task 3 + Task 4 "no author selection" note). ✅
- **IP stored, not displayed (§3.4):** `Comment.ip?` is validated/carried but `CommentView` drops it and `commentThread` never maps it (Tasks 1–2). ✅
- **Contract 4.4 (`Comment` / `CommentDraft` shape):** `Comment = { id; ts; ip?; author; text }`, `CommentDraft = Pick<Comment,'author'|'text'>` exported from the model (Task 1). ✅
- **Send on Enter/button, clear field (§5 F5 tests):** Task 4 covers button click, native-form-submit (Enter), trimming, and field clearing. ✅

**2. Placeholder scan:** none. Every code step shows full content; every run step shows the exact command and expected result.

**3. Type consistency:** `Comment`, `CommentDraft`, `CommentView`, `commentsKey`, `OfeliaCommentsModelProps`, and `ofeliaCommentsModel`'s return (`comments: Atom<Comment[]>`, `commentThread: Computed<CommentView[]>`, `send: Action<(text: string) => Promise<void>>`) are used identically across model, tests, and the UI part. The factory signature stays `ofeliaCommentsModel({ storage, viewWeekStart, currentUser })` everywhere. `CommentThreadProps` is `{ comments: CommentView[]; onSend: (text: string) => void }` in both component and test. Every Reatom unit carries an `'ofeliaComments.<name>'` trace name; injected test atoms use `'test.<name>'`.

**Spec deltas recorded (apply to the spec doc separately if desired):**

- **Comments model takes `viewWeekStart`/`currentUser` as injected atoms** (the spec names `model/ofelia-comments.ts` and the `currentUser` dependency but not the wiring mechanism). The model never imports `ofeliaDutyModel`; F6 passes `dutyModel.viewWeekStart` / `dutyModel.currentUser` in. This keeps comments unit-testable in isolation and decoupled from debt/duty/undo.
- **Per-week read uses a dynamic `effect` + `withConnectHook` re-keying subscription**, not the fixed-key `withStorageKey` (which cannot follow `viewWeekStart`). Same shape F4 designed for history; F5 is independent of F4 and carries its own copy.
- **`currentUser` is consumed as the duty model's atom** (set via `currentUser.set(...)`); F3 did not ship a separate `setCurrentUser` action, so contract 4.6's `setCurrentUser` is realised as the atom's `.set`. F5 only reads it.
- **`CommentThread` is prop-driven** (`onSend` callback + local input via `useState`); author attribution is verified at the **model** level (`send` uses `currentUser`) and field clearing/trimming at the **UI** level — mirroring F4's `HistoryList` split. Wiring `CommentThread` + `ofeliaCommentsModel` into the tiers (`RichLayout`) is **F6**, not F5.
- **`send` uses `withAsyncData({ status: true })`** to match the four existing Ofelia actions, rather than the Reatom skill's generic `withAsync` default for commands — local-file consistency for the reviewer.

---

## Execution Handoff

Plan complete and saved to `docs/superpowers/plans/2026-06-21-ofelia-f5-comments.md`. Two execution options:

**1. Subagent-Driven (recommended)** — dispatch a fresh subagent per task, review between tasks, fast iteration.

**2. Inline Execution** — execute tasks in this session using executing-plans, batch execution with checkpoints.

Which approach?
