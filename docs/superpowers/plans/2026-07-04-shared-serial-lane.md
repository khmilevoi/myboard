# Shared Serial-Lane Primitive Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Extract the duplicated "serialize async tasks on a FIFO promise-tail" idiom into one shared primitive in `packages/shared`, then adopt it in the two existing per-key serializers (server `runExclusive`, widget-runtime `runAppendExclusive`).

**Architecture:** `packages/shared/async/serial-lane.ts` exports `makeSerialLane` (single lane) and `makeKeyedSerialLane` (a per-key map of tails). Both preserve the existing semantics: tasks run one at a time, a rejecting task does not block the next, and finished keys are dropped to bound memory. The single-lane variant also powers the browser-automation queue (see the SP2 plan, Task 6), which is a separate change and out of scope here.

**Tech Stack:** TypeScript (ESM), Vitest (node environment). No new runtime dependencies.

## Global Constraints

Every task's requirements implicitly include this section.

- **Behaviour must not change** at the two existing call sites. `runExclusive(key, task)` and the widget-runtime append path keep their exact signatures and observable ordering/error semantics; their existing tests stay green unchanged.
- **`packages/shared` stays dependency-light.** The primitive imports nothing but language built-ins (`Promise`, `Map`); no zod, no node APIs.
- **Errors-as-values elsewhere is unaffected** — this primitive is a control-flow utility and deliberately passes task rejections straight through to the caller (it only prevents them from blocking the lane).
- **Commits** prefix commands with `rtk` and end messages with the `Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>` trailer.

## File Structure

```text
packages/shared/
  package.json                  modify: add test script + vitest devDependency
  vitest.config.ts              create: node environment
  async/serial-lane.ts          create: makeSerialLane + makeKeyedSerialLane
  async/serial-lane.test.ts     create
packages/server/
  src/storage/key-lock.ts       modify: delegate runExclusive to makeKeyedSerialLane
packages/widget-runtime/
  src/storage/client/dexie-storage.ts  modify: delegate append serialization to makeKeyedSerialLane
```

---

### Task 1: Shared serial-lane primitive

**Files:**
- Create: `packages/shared/async/serial-lane.ts`
- Create: `packages/shared/async/serial-lane.test.ts`
- Create: `packages/shared/vitest.config.ts`
- Modify: `packages/shared/package.json`

**Interfaces:**
- Produces:
  - `type SerialLane = { run<T>(task: () => Promise<T>): Promise<T>; whenIdle(): Promise<void> }`.
  - `function makeSerialLane(): SerialLane` — one FIFO lane; a rejecting task does not block the next; `whenIdle` resolves after the currently-queued tail settles.
  - `type KeyedSerialLane = { run<T>(key: string, task: () => Promise<T>): Promise<T> }`.
  - `function makeKeyedSerialLane(): KeyedSerialLane` — independent lanes per key; finished keys are dropped from the internal map.

- [ ] **Step 1: Give `packages/shared` a test runner**

Create `packages/shared/vitest.config.ts`:

```ts
import { defineConfig } from 'vitest/config'

export default defineConfig({
  test: {
    environment: 'node',
  },
})
```

In `packages/shared/package.json`, add a `scripts` block and a `devDependencies` block (keep the existing `dependencies`):

```json
{
  "name": "shared",
  "version": "0.0.0",
  "private": true,
  "type": "module",
  "scripts": {
    "test": "vitest run"
  },
  "dependencies": {
    "zod": "catalog:"
  },
  "devDependencies": {
    "vitest": "catalog:"
  }
}
```

Run: `pnpm install`
Expected: `vitest` linked into `packages/shared`.

- [ ] **Step 2: Write the failing test**

Create `packages/shared/async/serial-lane.test.ts`:

```ts
import { describe, expect, it } from 'vitest'

import { makeKeyedSerialLane, makeSerialLane } from './serial-lane'

describe('makeSerialLane', () => {
  it('runs tasks one at a time in FIFO order', async () => {
    const lane = makeSerialLane()
    const order: string[] = []
    const first = Promise.withResolvers<void>()

    const a = lane.run(async () => {
      order.push('a-start')
      await first.promise
      order.push('a-end')
      return 'a'
    })
    const b = lane.run(async () => {
      order.push('b')
      return 'b'
    })

    await Promise.resolve()
    expect(order).toEqual(['a-start'])
    first.resolve()
    expect(await a).toBe('a')
    expect(await b).toBe('b')
    expect(order).toEqual(['a-start', 'a-end', 'b'])
  })

  it('does not let a rejecting task block the next one', async () => {
    const lane = makeSerialLane()
    const failed = lane.run(async () => {
      throw new Error('boom')
    })
    await expect(failed).rejects.toThrow('boom')
    expect(await lane.run(async () => 'ok')).toBe('ok')
  })

  it('resolves whenIdle after queued tasks settle', async () => {
    const lane = makeSerialLane()
    const gate = Promise.withResolvers<void>()
    let done = false
    void lane.run(async () => {
      await gate.promise
      done = true
    })
    const idle = lane.whenIdle().then(() => done)
    gate.resolve()
    expect(await idle).toBe(true)
  })
})

describe('makeKeyedSerialLane', () => {
  it('serializes tasks for the same key', async () => {
    const lane = makeKeyedSerialLane()
    const order: string[] = []
    const first = Promise.withResolvers<void>()

    const a = lane.run('k', async () => {
      order.push('a-start')
      await first.promise
      order.push('a-end')
    })
    const b = lane.run('k', async () => {
      order.push('b')
    })

    await Promise.resolve()
    expect(order).toEqual(['a-start'])
    first.resolve()
    await Promise.all([a, b])
    expect(order).toEqual(['a-start', 'a-end', 'b'])
  })

  it('runs different keys concurrently', async () => {
    const lane = makeKeyedSerialLane()
    const order: string[] = []
    const blocker = Promise.withResolvers<void>()

    const a = lane.run('a', async () => {
      order.push('a-start')
      await blocker.promise
    })
    await lane.run('b', async () => {
      order.push('b')
    })

    expect(order).toEqual(['a-start', 'b'])
    blocker.resolve()
    await a
  })

  it('does not let a rejecting task block the same key', async () => {
    const lane = makeKeyedSerialLane()
    await expect(
      lane.run('k', async () => {
        throw new Error('boom')
      }),
    ).rejects.toThrow('boom')
    expect(await lane.run('k', async () => 'ok')).toBe('ok')
  })
})
```

- [ ] **Step 3: Run test to verify it fails**

Run: `pnpm --filter shared exec vitest run async/serial-lane.test.ts`
Expected: FAIL — module `./serial-lane` not found.

- [ ] **Step 4: Write minimal implementation**

Create `packages/shared/async/serial-lane.ts`:

```ts
export type SerialLane = {
  run<T>(task: () => Promise<T>): Promise<T>
  whenIdle(): Promise<void>
}

export function makeSerialLane(): SerialLane {
  let tail: Promise<unknown> = Promise.resolve()

  function run<T>(task: () => Promise<T>): Promise<T> {
    const result = tail.then(() => task())
    tail = result.then(
      () => undefined,
      () => undefined,
    )
    return result
  }

  function whenIdle(): Promise<void> {
    return tail.then(
      () => undefined,
      () => undefined,
    )
  }

  return { run, whenIdle }
}

export type KeyedSerialLane = {
  run<T>(key: string, task: () => Promise<T>): Promise<T>
}

export function makeKeyedSerialLane(): KeyedSerialLane {
  const tails = new Map<string, Promise<unknown>>()

  function run<T>(key: string, task: () => Promise<T>): Promise<T> {
    const previous = tails.get(key) ?? Promise.resolve()
    const result = previous.then(() => task())
    const tail = result.then(
      () => undefined,
      () => undefined,
    )
    tails.set(key, tail)
    void tail.then(() => {
      if (tails.get(key) === tail) tails.delete(key)
    })
    return result
  }

  return { run }
}
```

- [ ] **Step 5: Run test to verify it passes**

Run: `pnpm --filter shared exec vitest run async/serial-lane.test.ts`
Expected: PASS (6 tests).

- [ ] **Step 6: Commit**

```bash
rtk git add packages/shared/async packages/shared/vitest.config.ts packages/shared/package.json pnpm-lock.yaml
rtk git commit -m "feat(shared): add serial-lane serialization primitive"
```

---

### Task 2: Adopt the primitive in the server key lock

**Files:**
- Modify: `packages/server/src/storage/key-lock.ts`
- Test (existing, unchanged): `packages/server/src/storage/key-lock.test.ts`

**Interfaces:**
- Consumes: `makeKeyedSerialLane` from `@shared/async/serial-lane`.
- Produces: unchanged `runExclusive<T>(key: string, task: () => Promise<T>): Promise<T>` (now a thin delegate).

- [ ] **Step 1: Confirm the existing test passes before the change**

Run: `pnpm --filter server exec vitest run src/storage/key-lock.test.ts`
Expected: PASS (3 tests) — this is the behavioural contract to preserve.

- [ ] **Step 2: Replace the implementation with a delegate**

Replace the entire contents of `packages/server/src/storage/key-lock.ts`:

```ts
import { makeKeyedSerialLane } from '@shared/async/serial-lane'

/**
 * In-process per-key serialization. Each task waits for the previous task on the
 * same key to settle; different keys are independent.
 */
const lane = makeKeyedSerialLane()

export function runExclusive<T>(key: string, task: () => Promise<T>): Promise<T> {
  return lane.run(key, task)
}
```

- [ ] **Step 3: Run the existing test to verify behaviour is unchanged**

Run: `pnpm --filter server exec vitest run src/storage/key-lock.test.ts`
Expected: PASS (3 tests, unchanged).

- [ ] **Step 4: Commit**

```bash
rtk git add packages/server/src/storage/key-lock.ts
rtk git commit -m "refactor(server): delegate runExclusive to shared serial-lane"
```

---

### Task 3: Adopt the primitive in the widget-runtime append path

**Files:**
- Modify: `packages/widget-runtime/src/storage/client/dexie-storage.ts`
- Test (existing, unchanged): the widget-runtime dexie storage suite.

**Interfaces:**
- Consumes: `makeKeyedSerialLane` from `@shared/async/serial-lane`.
- Produces: no exported API change; the local `appendTails`/`runAppendExclusive` are replaced by a module-level `appendLane`.

- [ ] **Step 1: Confirm the widget-runtime suite passes before the change**

Run: `pnpm --filter widget-runtime test`
Expected: PASS — the current append behaviour is the contract to preserve.

- [ ] **Step 2: Replace the local serializer with the shared lane**

In `packages/widget-runtime/src/storage/client/dexie-storage.ts`, add the import near the other imports (after `import { db as defaultDb, type StorageDb } from './db'`):

```ts
import { makeKeyedSerialLane } from '@shared/async/serial-lane'
```

Replace the local serializer block:

```ts
const appendTails = new Map<string, Promise<unknown>>()

function runAppendExclusive<T>(key: string, task: () => Promise<T>): Promise<T> {
  const previous = appendTails.get(key) ?? Promise.resolve()
  const result = previous.then(() => task())
  const tail = result.then(
    () => undefined,
    () => undefined,
  )

  appendTails.set(key, tail)
  void tail.then(() => {
    if (appendTails.get(key) === tail) appendTails.delete(key)
  })

  return result
}
```

with:

```ts
const appendLane = makeKeyedSerialLane()
```

- [ ] **Step 3: Update the call site**

In the `append` method, change the call from `runAppendExclusive` to `appendLane.run` (the closure body is unchanged):

```ts
      return appendLane.run(fullKey, async () => {
```

- [ ] **Step 4: Run the widget-runtime suite to verify behaviour is unchanged**

Run: `pnpm --filter widget-runtime test`
Expected: PASS (unchanged).

- [ ] **Step 5: Commit**

```bash
rtk git add packages/widget-runtime/src/storage/client/dexie-storage.ts
rtk git commit -m "refactor(widget-runtime): delegate append serialization to shared serial-lane"
```

---

### Task 4: Workspace verification

**Files:** none (verification only).

- [ ] **Step 1: Typecheck the workspace**

Run: `pnpm typecheck`
Expected: PASS — server and widget-runtime resolve `@shared/async/serial-lane`; no type errors.

- [ ] **Step 2: Run all workspace tests**

Run: `pnpm test`
Expected: PASS — new `shared` serial-lane suite runs, and server/widget-runtime suites remain green.

- [ ] **Step 3: Lint and format**

Run: `pnpm lint`
Expected: PASS.

Run: `pnpm format:check`
Expected: PASS, or run `pnpm format` and commit the result.

- [ ] **Step 4: Commit any formatting fixes**

```bash
rtk git add -A
rtk git commit -m "chore: formatting after shared serial-lane extraction"
```

(If nothing changed, skip this commit.)

---

## Self-Review

**1. Spec coverage** — the extraction goal maps to Task 1 (primitive + shared test runner); the two existing duplicates map to Tasks 2 and 3; the single-lane variant's third consumer (browser-automation queue) is intentionally handled in the SP2 plan (Task 6), not here.

**2. Placeholder scan** — no `TBD`/`TODO`; every code step contains complete source, including the exact block to remove in Task 3.

**3. Type consistency** — `makeSerialLane` (`run`/`whenIdle`) and `makeKeyedSerialLane` (`run(key, task)`) names and signatures are identical across the primitive definition, the server delegate, and the widget-runtime call site. `runExclusive`'s public signature is preserved verbatim.
