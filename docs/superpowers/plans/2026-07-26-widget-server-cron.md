# Widget Server Cron Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Let a widget declare scheduled server-side jobs in its `server.ts`, and use that to auto-approve unresolved duty days in the Ofelia widget.

**Architecture:** `WidgetServerDefinition` gains an optional `crons` map. A tick scheduler inside the server walks those jobs every 30 seconds on the app's injected clock, keeps a per-job cursor in Valkey so a missed occurrence is caught up exactly once, and calls croner purely as a next-occurrence calculator. Ofelia's cron reuses the draft builder its `clean` event handler already uses, signing records with a new system author.

**Tech Stack:** Node 26, TypeScript 7, Valkey (iovalkey), zod 4, croner 10, Vitest, Playwright, rspack, Reatom 1001.

**Spec:** `docs/superpowers/specs/2026-07-26-widget-server-cron-design.md`

## Already done on `dev` — do not redo

This branch was merged with `dev` after the first draft of this plan. The following are **already in the tree** and must not be re-implemented:

- **Node 26 everywhere** — images, `.nvmrc`, `engines.node: ">=26"`, `@types/node@^26.1.1`, `packages/server/tsconfig.json` with `lib: ["ES2022", "ESNext"]`, no `--harmony-temporal` anywhere. `Temporal` is an unflagged global.
- **`packages/widgets/*/domain/`** with the `.oxlintrc.json` import allowlist override (and a stricter one for domain tests).
- **Ofelia's `server.ts`** with `clean` / `debt` / `forgive` / `undo` / `comment` handlers, `domain/drafts.ts` (`makeCleanDraft` over a `DraftInput`), `domain/ledger.ts`, `domain/roster.ts` (`plainDateIn`), `domain/author.ts`, and `packages/widgets/ofelia-poop-duty/server.test.ts`.
- **Account authorship**: records carry `createdBy: { accountId, name } | null` stamped from `WidgetServerContext.viewer`. `by: Person` is legacy read-only. The ledger has **no** `ip` field, and `createWidgetServerStorageApi` no longer takes one.

## Global Constraints

- **errore style.** Functions return `Error | T` unions and narrow with `instanceof Error`. Do not throw, do not use try/catch for control flow. Tagged errors come from `errore.createTaggedError`.
- **Factories are named `make*`, never `create*`.** Existing `create*` names stay; every new one here is `make*`.
- **No import may start with `../../`** — `.oxlintrc.json` bans it. This is why the new server modules are flat files in `src/widgets/`, not a `src/widgets/cron/` subfolder.
- **`packages/widgets/*/domain/**` may import only `zod`, `@shared/*` and `./` siblings** (domain tests additionally `vitest`). The oxlint override already enforces this; a violation fails `pnpm lint`.
- **Storage key shapes are a persistence contract.** New key in this plan: `cron:<typeId>:<jobName>`.
- **Every exported React component is wrapped in `reatomMemo` from `widget-sdk`.**
- **Code, comments, commit messages and docs in English. UI copy in Russian.**
- **Run one test file with** `pnpm --filter server exec vitest run <path>` or `pnpm --filter widgets-ofelia-poop-duty exec vitest run <path>`.

---

### Task 1: Add the cron contract to shared widget contracts

**Files:**
- Modify: `packages/shared/widgets/contracts.ts`
- Modify: `packages/server/src/widgets/registry.test.ts` (fixture gains `crons`)
- Test: `packages/server/src/widgets/contracts.test.ts`

**Interfaces:**
- Consumes: nothing.
- Produces:
  - `type WidgetCronContext = { typeId: string; now: () => number; scheduledFor: number; api: { storage: { shared: WidgetServerStorage }; browser: WidgetServerBrowserApi } }`
  - `type WidgetCronJob = { schedule: string; timeZone: string; run: (context: WidgetCronContext) => Awaitable<Error | void> }`
  - `WidgetServerDefinition` with an optional `crons?: Record<string, WidgetCronJob>`
  - `RuntimeWidgetServerDefinition` with a required `crons: Record<string, WidgetCronJob>`

`schemas` and `handlers` stay required — Ofelia has both, so there is no cron-only widget to design for.

- [ ] **Step 1: Write the failing test**

Append to `packages/server/src/widgets/contracts.test.ts`:

```ts
it('carries crons through to the runtime definition', () => {
  const definition = defineWidgetServer({
    schemas: { ping: { payload: z.object({}), result: z.object({}) } },
    handlers: { ping: () => ({}) },
    crons: {
      nightly: { schedule: '5 0 * * *', timeZone: 'Europe/Warsaw', run: () => undefined },
    },
  })

  const runtime = toRuntimeWidgetServerDefinition({ typeId: 'with-cron', definition })

  expect(runtime.crons.nightly?.schedule).toBe('5 0 * * *')
})

it('defaults crons to an empty map when a widget declares none', () => {
  const definition = defineWidgetServer({
    schemas: { ping: { payload: z.object({}), result: z.object({}) } },
    handlers: { ping: () => ({}) },
  })

  const runtime = toRuntimeWidgetServerDefinition({ typeId: 'no-cron', definition })

  expect(runtime.crons).toEqual({})
})
```

Make sure the file imports `defineWidgetServer` and `toRuntimeWidgetServerDefinition` from `@shared/widgets/contracts` and `z` from `zod`.

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm --filter server exec vitest run src/widgets/contracts.test.ts`
Expected: FAIL — `crons` is not a known property and `runtime.crons` is `undefined`.

- [ ] **Step 3: Implement the contract**

In `packages/shared/widgets/contracts.ts`, move the `type Awaitable<T> = T | Promise<T>` declaration above the new types, then add after `WidgetServerContext`:

```ts
export type WidgetCronContext = {
  typeId: string
  now: () => number
  /**
   * The scheduled moment this run stands for, in epoch ms. After a catch-up
   * this is the missed occurrence, not the wall clock — handlers that reason
   * about "which day is being closed" want this one, not now().
   */
  scheduledFor: number
  api: {
    storage: { shared: WidgetServerStorage }
    browser: WidgetServerBrowserApi
  }
}

export type WidgetCronJob = {
  /** Cron expression, 5 or 6 fields (croner syntax). */
  schedule: string
  /** IANA time zone the expression is evaluated in. */
  timeZone: string
  run: (context: WidgetCronContext) => Awaitable<Error | void>
}
```

There is deliberately no `viewer` on `WidgetCronContext`: a background run has no caller, so a cron that writes an authored record supplies the author itself.

Add `crons?: Record<string, WidgetCronJob>` to `WidgetServerDefinition`, add `crons: Record<string, WidgetCronJob>` to `RuntimeWidgetServerDefinition`, and normalize in the converter:

```ts
export function toRuntimeWidgetServerDefinition<const Schemas extends WidgetEventSchemas>({
  typeId,
  definition,
}: {
  typeId: string
  definition: WidgetServerDefinition<Schemas>
}): RuntimeWidgetServerDefinition {
  return {
    typeId,
    schemas: definition.schemas,
    handlers: definition.handlers,
    crons: definition.crons ?? {},
  } as unknown as RuntimeWidgetServerDefinition
}
```

- [ ] **Step 4: Fix the registry test fixture**

`packages/server/src/widgets/registry.test.ts` now fails to typecheck because `RuntimeWidgetServerDefinition` requires `crons`. Add `crons: {}` to the fixture object.

- [ ] **Step 5: Run tests to verify they pass**

Run: `pnpm --filter server exec vitest run src/widgets/`
Expected: PASS.

Run: `pnpm typecheck`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add packages/shared/widgets/contracts.ts packages/server/src/widgets/
git commit -m "feat(widgets): add the cron job contract to widget server definitions"
```

---

### Task 2: Validate cron schedules when the registry is built

**Files:**
- Modify: `packages/server/package.json` (add `croner`)
- Modify: `packages/server/src/widgets/errors.ts`
- Modify: `packages/server/src/widgets/registry.ts`
- Test: `packages/server/src/widgets/registry.test.ts`

**Interfaces:**
- Consumes: `RuntimeWidgetServerDefinition.crons` (Task 1).
- Produces:
  - `class InvalidCronScheduleError` — tagged, with `typeId`, `job`, `schedule`
  - `class WidgetCronRunError` — tagged, with `typeId`, `job`, `scheduledFor`
  - `createWidgetServerRegistry` returning `DuplicateWidgetTypeError | InvalidCronScheduleError | WidgetServerRegistry`

Validation lives here rather than in the scheduler so `production-registry.ts` fails at import — exactly as it already does for a duplicate `typeId` — and `createApp` keeps its signature.

- [ ] **Step 1: Add the dependency**

Run: `pnpm --filter server add croner@^10.0.1`
Expected: `croner` under `dependencies` in `packages/server/package.json`. It has no transitive dependencies; rspack externalizes it, so the runtime image resolves it from the installed prod deps.

- [ ] **Step 2: Write the failing test**

Append to `packages/server/src/widgets/registry.test.ts`:

```ts
function withCron(typeId: string, schedule: string, timeZone: string): RuntimeWidgetServerDefinition {
  return {
    typeId,
    schemas: {},
    handlers: {},
    crons: { nightly: { schedule, timeZone, run: () => undefined } },
  }
}

it('rejects an unparsable cron schedule', () => {
  expect(createWidgetServerRegistry([withCron('broken', 'not a cron', 'Europe/Warsaw')])).toBeInstanceOf(
    InvalidCronScheduleError,
  )
})

it('rejects an unknown time zone', () => {
  expect(createWidgetServerRegistry([withCron('bad-zone', '5 0 * * *', 'Mars/Olympus')])).toBeInstanceOf(
    InvalidCronScheduleError,
  )
})

it('accepts a valid schedule', () => {
  expect(createWidgetServerRegistry([withCron('ok', '5 0 * * *', 'Europe/Warsaw')])).not.toBeInstanceOf(
    Error,
  )
})
```

Add `InvalidCronScheduleError` to the existing `./errors` import.

- [ ] **Step 3: Run test to verify it fails**

Run: `pnpm --filter server exec vitest run src/widgets/registry.test.ts`
Expected: FAIL — `InvalidCronScheduleError` is not exported.

- [ ] **Step 4: Declare the errors**

Append to `packages/server/src/widgets/errors.ts`:

```ts
export class InvalidCronScheduleError extends errore.createTaggedError({
  name: 'InvalidCronScheduleError',
  message: 'Invalid cron schedule "$schedule" for $typeId.$job',
  extends: WidgetDispatchError,
}) {}

export class WidgetCronRunError extends errore.createTaggedError({
  name: 'WidgetCronRunError',
  message: 'Cron job $typeId.$job failed for scheduled moment $scheduledFor',
  extends: WidgetDispatchError,
}) {}
```

Both extend `WidgetDispatchError` only to reuse its shape; neither ever reaches a client, because a cron run has no HTTP response.

- [ ] **Step 5: Validate in the registry**

`packages/server/src/widgets/registry.ts`:

```ts
import type { RuntimeWidgetServerDefinition } from '@shared/widgets/contracts'
import { Cron } from 'croner'

import { DuplicateWidgetTypeError, InvalidCronScheduleError, UnknownWidgetTypeError } from './errors'

export type WidgetServerRegistry = ReadonlyMap<string, RuntimeWidgetServerDefinition>

export function createWidgetServerRegistry(
  definitions: readonly RuntimeWidgetServerDefinition[],
): DuplicateWidgetTypeError | InvalidCronScheduleError | WidgetServerRegistry {
  const registry = new Map<string, RuntimeWidgetServerDefinition>()
  for (const definition of definitions) {
    if (registry.has(definition.typeId)) {
      return new DuplicateWidgetTypeError({ typeId: definition.typeId })
    }
    for (const [job, cron] of Object.entries(definition.crons)) {
      const parsed = tryParseCron(cron.schedule, cron.timeZone)
      if (parsed instanceof Error) {
        return new InvalidCronScheduleError({
          typeId: definition.typeId,
          job,
          schedule: cron.schedule,
          cause: parsed,
        })
      }
    }
    registry.set(definition.typeId, definition)
  }
  return registry
}

/**
 * Constructed and discarded: a schedule that cannot be parsed must fail at
 * startup rather than silently never fire. The scheduler builds its own Cron
 * objects. croner throws on a malformed pattern or an unknown zone, and this is
 * the one place that throw is converted into a value.
 */
function tryParseCron(schedule: string, timeZone: string): Error | Cron {
  try {
    const cron = new Cron(schedule, { timezone: timeZone })
    if (cron.nextRun() === null) return new Error(`schedule "${schedule}" never runs`)
    return cron
  } catch (cause) {
    return cause instanceof Error ? cause : new Error(String(cause))
  }
}
```

- [ ] **Step 6: Run tests to verify they pass**

Run: `pnpm --filter server exec vitest run src/widgets/registry.test.ts`
Expected: PASS.

- [ ] **Step 7: Commit**

```bash
git add packages/server/package.json pnpm-lock.yaml packages/server/src/widgets/
git commit -m "feat(server): validate widget cron schedules when the registry is built"
```

---

### Task 3: Cron cursor state in Valkey

**Files:**
- Create: `packages/server/src/widgets/cron-state.ts`
- Test: `packages/server/src/widgets/cron-state.test.ts`

**Interfaces:**
- Consumes: `ValkeyOps` from `../storage/valkey`, `safeParse` from `@shared/json`.
- Produces:
  - `cronStateKey(typeId: string, jobName: string): string` → `cron:<typeId>:<jobName>`
  - `type CronState = { cursorMs: number; failures: number }`
  - `readCronState(ops, typeId, jobName): Promise<Error | CronState | null>`
  - `writeCronState(ops, typeId, jobName, state): Promise<Error | void>`

- [ ] **Step 1: Write the failing test**

Create `packages/server/src/widgets/cron-state.test.ts`:

```ts
import { describe, expect, it } from 'vitest'

import { createMemoryOps, createMemoryPubSub } from '../test/memory-ops'
import { cronStateKey, readCronState, writeCronState } from './cron-state'

const makeOps = () => createMemoryOps(createMemoryPubSub())

describe('cron state', () => {
  it('derives a key outside the widget storage namespace', () => {
    expect(cronStateKey('ofelia-poop-duty', 'autoApproveDay')).toBe(
      'cron:ofelia-poop-duty:autoApproveDay',
    )
  })

  it('returns null when no state was ever written', async () => {
    expect(await readCronState(makeOps(), 'w', 'j')).toBeNull()
  })

  it('round-trips a written state', async () => {
    const ops = makeOps()
    await writeCronState(ops, 'w', 'j', { cursorMs: 1234, failures: 2 })

    expect(await readCronState(ops, 'w', 'j')).toEqual({ cursorMs: 1234, failures: 2 })
  })

  it('returns an error for a corrupt stored value', async () => {
    const ops = makeOps()
    await ops.set(cronStateKey('w', 'j'), '{"cursorMs":"nope"}')

    expect(await readCronState(ops, 'w', 'j')).toBeInstanceOf(Error)
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm --filter server exec vitest run src/widgets/cron-state.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement**

Create `packages/server/src/widgets/cron-state.ts`:

```ts
import { safeParse } from '@shared/json'
import * as errore from 'errore'
import { z } from 'zod'

import type { ValkeyOps } from '../storage/valkey'

export class CronStateError extends errore.createTaggedError({
  name: 'CronStateError',
  message: 'Cron state $operation failed for $key',
}) {}

const CronStateSchema = z.object({
  cursorMs: z.number(),
  failures: z.number().int().nonnegative(),
})

export type CronState = z.infer<typeof CronStateSchema>

/**
 * Its own root namespace, not under `w:t:` — otherwise scheduler bookkeeping
 * would show up in widget storage listings and SSE fanout.
 */
export function cronStateKey(typeId: string, jobName: string): string {
  return `cron:${typeId}:${jobName}`
}

export async function readCronState(
  ops: ValkeyOps,
  typeId: string,
  jobName: string,
): Promise<Error | CronState | null> {
  const key = cronStateKey(typeId, jobName)
  const raw = await ops
    .get(key)
    .catch((cause) => new CronStateError({ operation: 'get', key, cause }))
  if (raw instanceof Error) return raw
  if (raw === null) return null

  const parsed = safeParse(raw)
  if (parsed instanceof Error) return new CronStateError({ operation: 'parse', key, cause: parsed })

  const validated = CronStateSchema.safeParse(parsed)
  if (!validated.success) {
    return new CronStateError({ operation: 'validate', key, cause: validated.error })
  }
  return validated.data
}

export async function writeCronState(
  ops: ValkeyOps,
  typeId: string,
  jobName: string,
  state: CronState,
): Promise<Error | void> {
  const key = cronStateKey(typeId, jobName)
  const written = await ops
    .set(key, JSON.stringify(state))
    .catch((cause) => new CronStateError({ operation: 'set', key, cause }))
  if (written instanceof Error) return written
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm --filter server exec vitest run src/widgets/cron-state.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add packages/server/src/widgets/cron-state.ts packages/server/src/widgets/cron-state.test.ts
git commit -m "feat(server): persist a per-job cron cursor in Valkey"
```

---

### Task 4: The tick scheduler

**Files:**
- Modify: `packages/server/src/widgets/storage.ts` (extract `makeWidgetScopedStorage`)
- Modify: `packages/server/src/widgets/api.ts` (add `makeWidgetCronApi`)
- Create: `packages/server/src/widgets/cron-scheduler.ts`
- Test: `packages/server/src/widgets/cron-scheduler.test.ts`

**Interfaces:**
- Consumes: `readCronState` / `writeCronState` (Task 3), `WidgetCronJob` / `WidgetCronContext` (Task 1), `WidgetCronRunError` (Task 2), `WidgetServerRegistry`.
- Produces:
  - `makeWidgetScopedStorage({ ops, namespace, now, createId? }): WidgetServerStorage`
  - `makeWidgetCronApi({ ops, typeId, now, browserClient }): WidgetCronContext['api']`
  - `dueOccurrence(cron: Cron, cursorMs: number, nowMs: number): number | null` — pure, exported for tests
  - `makeCronScheduler(options: CronSchedulerOptions): CronScheduler`
  - `type CronScheduler = { tick(): Promise<void>; start(): void; stop(): Promise<void> }`
  - `type CronSchedulerOptions = { registry: WidgetServerRegistry; ops: ValkeyOps; browserClient: BrowserAutomationClient; now: () => number; intervalMs?: number }`

- [ ] **Step 1: Extract the scope factory from the storage API**

`packages/server/src/widgets/storage.ts` builds both scopes inside `createWidgetServerStorageApi` via a local `createScope`. Lift that closure to a module-level export and have the existing function call it — no behavior change. Note there is no `ip` parameter any more:

```ts
export type MakeWidgetScopedStorageOptions = {
  ops: ValkeyOps
  namespace: string
  now: () => number
  createId?: () => string
}

export function makeWidgetScopedStorage({
  ops,
  namespace,
  now,
  createId = randomUUID,
}: MakeWidgetScopedStorageOptions): WidgetServerStorage {
  // body of the former createScope, verbatim
}

export function createWidgetServerStorageApi({
  ops,
  typeId,
  instanceId,
  now,
  createId = randomUUID,
}: CreateWidgetServerStorageApiOptions): {
  instance: WidgetServerStorage
  shared: WidgetServerStorage
} {
  const scope = (namespace: string) => makeWidgetScopedStorage({ ops, namespace, now, createId })
  return {
    instance: scope(instanceNamespace(instanceId)),
    shared: scope(typeNamespace(typeId)),
  }
}
```

A cron run has no instance, so it needs the shared scope constructible on its own.

- [ ] **Step 2: Add the cron API factory**

Append to `packages/server/src/widgets/api.ts`:

```ts
export type MakeWidgetCronApiOptions = {
  ops: ValkeyOps
  typeId: string
  now: () => number
  browserClient: BrowserAutomationClient
}

export function makeWidgetCronApi({
  ops,
  typeId,
  now,
  browserClient,
}: MakeWidgetCronApiOptions): WidgetCronContext['api'] {
  return {
    storage: {
      shared: makeWidgetScopedStorage({ ops, namespace: typeNamespace(typeId), now }),
    },
    browser: createWidgetBrowserApi({ widgetId: typeId, client: browserClient }),
  }
}
```

Add the imports it needs: `typeNamespace` from `@shared/storage/scope`, `makeWidgetScopedStorage` from `./storage`, `WidgetCronContext` from `@shared/widgets/contracts`, `ValkeyOps` from `../storage/valkey`.

- [ ] **Step 3: Write the failing test**

Create `packages/server/src/widgets/cron-scheduler.test.ts`:

```ts
import type {
  RuntimeWidgetServerDefinition,
  WidgetCronContext,
  WidgetCronJob,
} from '@shared/widgets/contracts'
import { Cron } from 'croner'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import { makeFakeBrowserAutomationClient } from '../browser/testing/fake-client'
import { createMemoryOps, createMemoryPubSub } from '../test/memory-ops'
import { dueOccurrence, makeCronScheduler } from './cron-scheduler'
import { readCronState, writeCronState } from './cron-state'
import { createWidgetServerRegistry, type WidgetServerRegistry } from './registry'

const NOON_0616 = Date.parse('2026-06-16T12:00:00+02:00')
const EVENING_0616 = Date.parse('2026-06-16T18:00:00+02:00')
const MIDNIGHT_0617 = Date.parse('2026-06-17T00:05:00+02:00')
const MORNING_0617 = Date.parse('2026-06-17T06:00:00+02:00')
const MIDNIGHT_0619 = Date.parse('2026-06-19T00:05:00+02:00')
const NOON_0619 = Date.parse('2026-06-19T12:00:00+02:00')

function makeRegistry(run: (context: WidgetCronContext) => unknown): WidgetServerRegistry {
  const definition: RuntimeWidgetServerDefinition = {
    typeId: 'test-widget',
    schemas: {},
    handlers: {},
    crons: {
      nightly: {
        schedule: '5 0 * * *',
        timeZone: 'Europe/Warsaw',
        run: run as WidgetCronJob['run'],
      },
    },
  }
  const registry = createWidgetServerRegistry([definition])
  if (registry instanceof Error) throw registry
  return registry
}

describe('dueOccurrence', () => {
  const cron = new Cron('5 0 * * *', { timezone: 'Europe/Warsaw' })

  it('returns null when the next occurrence is still in the future', () => {
    expect(dueOccurrence(cron, NOON_0616, EVENING_0616)).toBeNull()
  })

  it('returns the occurrence that just came due', () => {
    expect(dueOccurrence(cron, NOON_0616, MORNING_0617)).toBe(MIDNIGHT_0617)
  })

  it('collapses several missed occurrences into the most recent one', () => {
    expect(dueOccurrence(cron, NOON_0616, NOON_0619)).toBe(MIDNIGHT_0619)
  })
})

describe('cron scheduler', () => {
  let ops: ReturnType<typeof createMemoryOps>
  let nowMs: number

  beforeEach(() => {
    ops = createMemoryOps(createMemoryPubSub())
    nowMs = NOON_0616
  })

  const makeScheduler = (run: (context: WidgetCronContext) => unknown) =>
    makeCronScheduler({
      registry: makeRegistry(run),
      ops,
      browserClient: makeFakeBrowserAutomationClient().client,
      now: () => nowMs,
    })

  it('seeds the cursor on first sight without running the job', async () => {
    const run = vi.fn()
    await makeScheduler(run).tick()

    expect(run).not.toHaveBeenCalled()
    expect(await readCronState(ops, 'test-widget', 'nightly')).toEqual({
      cursorMs: NOON_0616,
      failures: 0,
    })
  })

  it('runs once when an occurrence comes due and advances the cursor', async () => {
    const run = vi.fn()
    const scheduler = makeScheduler(run)
    await scheduler.tick()

    nowMs = NOON_0619
    await scheduler.tick()

    expect(run).toHaveBeenCalledTimes(1)
    expect(run.mock.calls[0][0].scheduledFor).toBe(MIDNIGHT_0619)
    expect(await readCronState(ops, 'test-widget', 'nightly')).toEqual({
      cursorMs: MIDNIGHT_0619,
      failures: 0,
    })
  })

  it('does nothing on a tick where nothing is due', async () => {
    const run = vi.fn()
    const scheduler = makeScheduler(run)
    await scheduler.tick()
    await scheduler.tick()

    expect(run).not.toHaveBeenCalled()
  })

  it('keeps the cursor and counts a failure when the job returns an error', async () => {
    const scheduler = makeScheduler(() => new Error('boom'))
    await scheduler.tick()

    nowMs = NOON_0619
    await scheduler.tick()

    expect(await readCronState(ops, 'test-widget', 'nightly')).toEqual({
      cursorMs: NOON_0616,
      failures: 1,
    })
  })

  it('retries on the next tick after a failure', async () => {
    const run = vi.fn(() => new Error('boom'))
    const scheduler = makeScheduler(run)
    await scheduler.tick()

    nowMs = NOON_0619
    await scheduler.tick()
    await scheduler.tick()

    expect(run).toHaveBeenCalledTimes(2)
  })

  it('gives up and advances the cursor after five consecutive failures', async () => {
    const scheduler = makeScheduler(() => new Error('boom'))
    await scheduler.tick()

    nowMs = NOON_0619
    for (let attempt = 0; attempt < 5; attempt += 1) await scheduler.tick()

    expect(await readCronState(ops, 'test-widget', 'nightly')).toEqual({
      cursorMs: MIDNIGHT_0619,
      failures: 0,
    })
  })

  it('treats a thrown error like a returned one', async () => {
    const scheduler = makeScheduler(() => {
      throw new Error('boom')
    })
    await scheduler.tick()

    nowMs = NOON_0619
    await expect(scheduler.tick()).resolves.toBeUndefined()

    expect(await readCronState(ops, 'test-widget', 'nightly')).toEqual({
      cursorMs: NOON_0616,
      failures: 1,
    })
  })

  it('does not start a job that is still running from a previous tick', async () => {
    let release = () => {}
    const gate = new Promise<void>((resolve) => {
      release = resolve
    })
    const run = vi.fn(() => gate)

    await writeCronState(ops, 'test-widget', 'nightly', { cursorMs: NOON_0616, failures: 0 })
    nowMs = NOON_0619
    const scheduler = makeScheduler(run)

    const first = scheduler.tick()
    await scheduler.tick()
    release()
    await first

    expect(run).toHaveBeenCalledTimes(1)
  })

  it('gives the job a shared storage scope and nothing else', async () => {
    let seen: WidgetCronContext | null = null
    const scheduler = makeScheduler((context) => {
      seen = context
    })
    await scheduler.tick()
    nowMs = NOON_0619
    await scheduler.tick()

    expect(seen?.typeId).toBe('test-widget')
    expect(Object.keys(seen?.api.storage ?? {})).toEqual(['shared'])
  })
})
```

- [ ] **Step 4: Run test to verify it fails**

Run: `pnpm --filter server exec vitest run src/widgets/cron-scheduler.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 5: Implement the scheduler**

Create `packages/server/src/widgets/cron-scheduler.ts`:

```ts
import type { WidgetCronContext, WidgetCronJob } from '@shared/widgets/contracts'
import { Cron } from 'croner'

import type { BrowserAutomationClient } from '../browser/client'
import type { ValkeyOps } from '../storage/valkey'
import { makeWidgetCronApi } from './api'
import { readCronState, writeCronState } from './cron-state'
import { WidgetCronRunError } from './errors'
import type { WidgetServerRegistry } from './registry'

const DEFAULT_INTERVAL_MS = 30_000
/** Bounds catch-up work for minute-level schedules after a long outage. */
const MAX_CATCHUP_STEPS = 1000
const MAX_FAILURES = 5

export type CronSchedulerOptions = {
  registry: WidgetServerRegistry
  ops: ValkeyOps
  browserClient: BrowserAutomationClient
  now: () => number
  intervalMs?: number
}

export type CronScheduler = {
  tick(): Promise<void>
  start(): void
  stop(): Promise<void>
}

type ScheduledJob = {
  typeId: string
  name: string
  job: WidgetCronJob
  cron: Cron
}

/**
 * The most recent occurrence that is due at nowMs, or null if none is.
 * `nextRun` is strictly exclusive, so an occurrence already recorded in the
 * cursor never fires twice; missed occurrences collapse into the latest one.
 */
export function dueOccurrence(cron: Cron, cursorMs: number, nowMs: number): number | null {
  const first = cron.nextRun(new Date(cursorMs))
  if (first === null || first.getTime() > nowMs) return null

  let due = first.getTime()
  for (let step = 0; step < MAX_CATCHUP_STEPS; step += 1) {
    const next = cron.nextRun(new Date(due))
    if (next === null || next.getTime() > nowMs) return due
    due = next.getTime()
  }
  console.warn(
    `cron catch-up hit the ${MAX_CATCHUP_STEPS}-step cap; using ${new Date(due).toISOString()}`,
  )
  return due
}

export function makeCronScheduler(options: CronSchedulerOptions): CronScheduler {
  const intervalMs = options.intervalMs ?? DEFAULT_INTERVAL_MS
  const jobs: ScheduledJob[] = []
  for (const [typeId, definition] of options.registry) {
    for (const [name, job] of Object.entries(definition.crons)) {
      // Schedules were validated in createWidgetServerRegistry, so this cannot throw.
      jobs.push({ typeId, name, job, cron: new Cron(job.schedule, { timezone: job.timeZone }) })
    }
  }

  const running = new Set<string>()
  let timer: ReturnType<typeof setInterval> | null = null
  let inFlight: Promise<void> = Promise.resolve()

  async function runJob(scheduled: ScheduledJob): Promise<void> {
    const id = `${scheduled.typeId}:${scheduled.name}`
    if (running.has(id)) return
    running.add(id)
    try {
      const state = await readCronState(options.ops, scheduled.typeId, scheduled.name)
      if (state instanceof Error) {
        console.error(state)
        return
      }

      const nowMs = options.now()
      if (state === null) {
        // First sight: record where we are and do not fire, otherwise every
        // deploy would immediately run every job for the current period.
        const seeded = await writeCronState(options.ops, scheduled.typeId, scheduled.name, {
          cursorMs: nowMs,
          failures: 0,
        })
        if (seeded instanceof Error) console.error(seeded)
        return
      }

      const scheduledFor = dueOccurrence(scheduled.cron, state.cursorMs, nowMs)
      if (scheduledFor === null) return

      const context: WidgetCronContext = {
        typeId: scheduled.typeId,
        now: options.now,
        scheduledFor,
        api: makeWidgetCronApi({
          ops: options.ops,
          typeId: scheduled.typeId,
          now: options.now,
          browserClient: options.browserClient,
        }),
      }

      const outcome = await Promise.resolve(scheduled.job.run(context)).catch((cause: unknown) =>
        cause instanceof Error ? cause : new Error(String(cause)),
      )

      if (outcome instanceof Error) {
        const failures = state.failures + 1
        console.error(
          new WidgetCronRunError({
            typeId: scheduled.typeId,
            job: scheduled.name,
            scheduledFor: new Date(scheduledFor).toISOString(),
            cause: outcome,
          }),
        )
        // Keep the cursor so the next tick retries — a blinking Valkey should
        // not cost a whole occurrence. After MAX_FAILURES, move on loudly
        // rather than hammer a permanently broken job every interval.
        const giveUp = failures >= MAX_FAILURES
        if (giveUp) {
          console.error(
            `cron ${id}: giving up on ${new Date(scheduledFor).toISOString()} after ${failures} failures`,
          )
        }
        const written = await writeCronState(options.ops, scheduled.typeId, scheduled.name, {
          cursorMs: giveUp ? scheduledFor : state.cursorMs,
          failures: giveUp ? 0 : failures,
        })
        if (written instanceof Error) console.error(written)
        return
      }

      const written = await writeCronState(options.ops, scheduled.typeId, scheduled.name, {
        cursorMs: scheduledFor,
        failures: 0,
      })
      if (written instanceof Error) console.error(written)
    } finally {
      running.delete(id)
    }
  }

  async function tick(): Promise<void> {
    // Each job is isolated: one failure must not abort the pass for the rest.
    await Promise.all(jobs.map((scheduled) => runJob(scheduled)))
  }

  return {
    tick,
    start() {
      if (timer !== null || jobs.length === 0) return
      timer = setInterval(() => {
        inFlight = tick().catch((cause: unknown) => {
          console.error('cron tick failed', cause)
        })
      }, intervalMs)
    },
    async stop() {
      if (timer !== null) {
        clearInterval(timer)
        timer = null
      }
      await inFlight
    },
  }
}
```

- [ ] **Step 6: Run tests to verify they pass**

Run: `pnpm --filter server exec vitest run src/widgets/`
Expected: PASS, including the pre-existing `storage.test.ts` and `api.test.ts` — the Step 1 extraction must not change behavior.

- [ ] **Step 7: Commit**

```bash
git add packages/server/src/widgets/
git commit -m "feat(server): add the widget cron tick scheduler"
```

---

### Task 5: Wire the scheduler into the app

**Files:**
- Modify: `packages/server/src/app.ts`
- Test: `packages/server/src/app.test.ts`

**Interfaces:**
- Consumes: `makeCronScheduler` (Task 4).
- Produces:
  - `AppDeps` gains `cron?: { intervalMs?: number }`
  - `POST /api/test/cron/tick` — registered only when `testControls` is present, responds `204` after the pass completes

With `testControls` present the automatic interval is **not** started. That is what makes the e2e deterministic: the suite drives the real scheduler through the route instead of sleeping or bypassing it.

- [ ] **Step 1: Write the failing test**

Add a self-contained describe block at the end of `packages/server/src/app.test.ts` — the existing one is pinned to the module-level `testWidgetRegistry`, and this needs a registry with a cron in it:

```ts
describe('cron tick route', () => {
  let app: App
  let base: string
  let now: number
  const runs: number[] = []

  beforeEach(async () => {
    runs.length = 0
    const pubsub = createMemoryPubSub()
    const ops = createMemoryOps(pubsub)
    now = Date.parse('2026-06-16T12:00:00+02:00')

    const cronWidget = defineWidgetServer({
      schemas: {},
      handlers: {},
      crons: {
        nightly: {
          schedule: '5 0 * * *',
          timeZone: 'Europe/Warsaw',
          run: ({ scheduledFor }) => {
            runs.push(scheduledFor)
          },
        },
      },
    })
    const registry = createWidgetServerRegistry([
      toRuntimeWidgetServerDefinition({ typeId: 'cron-widget', definition: cronWidget }),
    ])
    if (registry instanceof Error) throw registry

    app = createApp({
      ops,
      subscribe: (onMessage) => pubsub.subscribe('storage:events', onMessage),
      now: () => now,
      widgetRegistry: registry,
      browserClient: makeFakeBrowserAutomationClient().client,
      authConfig: testAuthConfig,
      recovery: { tokenTtlMs: 60_000, maxSessionMs: 60_000, upstreamUrl: 'http://127.0.0.1:1' },
      testControls: {
        setNow: (ms) => {
          now = ms
        },
        reset: () => ops.clear(),
      },
    })
    await new Promise<void>((resolve) => app.server.listen(0, resolve))
    base = `http://localhost:${(app.server.address() as AddressInfo).port}`
  })

  afterEach(async () => {
    await app.close()
  })

  const tick = () => fetch(`${base}/api/test/cron/tick`, { method: 'POST' })

  it('seeds the cursor on the first tick without running anything', async () => {
    const res = await tick()

    expect(res.status).toBe(204)
    expect(runs).toEqual([])
  })

  it('runs the job once the occurrence is due', async () => {
    await tick()

    await fetch(`${base}/api/test/time`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ iso: '2026-06-17T00:06:00+02:00' }),
    })
    await tick()

    expect(runs).toEqual([Date.parse('2026-06-17T00:05:00+02:00')])
  })
})
```

Add `defineWidgetServer` / `toRuntimeWidgetServerDefinition` to the existing `@shared/widgets/contracts` import and `App` to the `./app` import.

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm --filter server exec vitest run src/app.test.ts -t "cron tick route"`
Expected: FAIL — the route 404s.

- [ ] **Step 3: Wire it up**

In `packages/server/src/app.ts` add the import `import { makeCronScheduler } from './widgets/cron-scheduler'` and `cron?: { intervalMs?: number }` to `AppDeps`.

After `browserClient` is built — the recovery-revoking wrapper, so the scheduler uses the same client the dispatcher does:

```ts
  const cronScheduler = makeCronScheduler({
    registry: deps.widgetRegistry,
    ops,
    browserClient,
    now,
    ...(deps.cron?.intervalMs !== undefined ? { intervalMs: deps.cron.intervalMs } : {}),
  })
  // In test mode the suite drives the scheduler explicitly through
  // /api/test/cron/tick; an interval racing a faked clock would only add
  // nondeterminism.
  if (!deps.testControls) cronScheduler.start()
```

Inside the `if (deps.testControls) { ... }` block, next to `/api/test/time`:

```ts
    router.on('POST', '/api/test/cron/tick', async (_req, res) => {
      await cronScheduler.tick()
      res.writeHead(204)
      res.end()
    })
```

And in `close`, before closing the server:

```ts
    await cronScheduler.stop()
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `pnpm --filter server exec vitest run`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add packages/server/src/app.ts packages/server/src/app.test.ts
git commit -m "feat(server): start the cron scheduler with the app and expose a test tick"
```

---

### Task 6: A system author for server-written records

**Files:**
- Modify: `packages/widgets/ofelia-poop-duty/domain/ledger.ts`
- Modify: `packages/widgets/ofelia-poop-duty/domain/author.ts`
- Modify: `packages/widgets/ofelia-poop-duty/domain/drafts.ts`
- Modify: `packages/widgets/ofelia-poop-duty/ui/parts/MemberAvatar.tsx`
- Modify: `packages/widgets/ofelia-poop-duty/ui/parts/HistoryList.tsx`
- Test: `packages/widgets/ofelia-poop-duty/domain/ledger.test.ts`, `domain/author.test.ts`, `ui/parts/MemberAvatar.test.tsx`, `ui/parts/HistoryList.test.tsx`

**Interfaces:**
- Produces:
  - `SystemCreatedBySchema` / `EntryCreatedBySchema` / `type EntryCreatedBy` in `domain/ledger.ts`
  - `SYSTEM_CREATED_BY: EntryCreatedBy` constant (`{ system: true }`)
  - `EntryAuthor` gains `{ kind: 'system' }`
  - `DraftInput.createdBy: EntryCreatedBy | null`

`resolveEntryAuthor` currently maps a `null` author to `{ kind: 'unknown' }`, which the UI renders as «автор неизвестен». A cron record must not land there — an auto-closed day would be indistinguishable from a pre-accounts orphan record, and the point is that a reader can tell nobody pressed the button.

- [ ] **Step 1: Write the failing tests**

In `domain/ledger.test.ts`:

```ts
it('accepts a system-authored entry', () => {
  const parsed = LedgerEntrySchema.safeParse({
    id: 'auto-1',
    ts: 1,
    date: '2026-06-16',
    type: 'cleaned',
    actor: 'Леша',
    createdBy: { system: true },
  })

  expect(parsed.success).toBe(true)
})

it('still accepts an account-authored entry', () => {
  const parsed = LedgerEntrySchema.safeParse({
    id: 'human-1',
    ts: 1,
    date: '2026-06-16',
    type: 'cleaned',
    actor: 'Леша',
    createdBy: { accountId: 'a1', name: 'Карина' },
  })

  expect(parsed.success).toBe(true)
})
```

In `domain/author.test.ts`:

```ts
it('resolves the system author to its own kind', () => {
  expect(resolveEntryAuthor({ system: true }, undefined, members)).toEqual({ kind: 'system' })
})
```

In `ui/parts/MemberAvatar.test.tsx`:

```ts
it('marks the system author', () => {
  const { container } = render(<MemberAvatar author={{ kind: 'system' }} />)

  expect(container.firstElementChild).toHaveAttribute('data-kind', 'system')
})
```

In `ui/parts/HistoryList.test.tsx` (mirror the existing `group(...)` / `view(...)` helpers):

```ts
it('phrases a system record as an automatic closure', () => {
  render(<HistoryList groups={[group({ current: view({ recordedBy: { kind: 'system' } }) })]} />)

  expect(screen.getByText('закрыто автоматически')).toBeInTheDocument()
})
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `pnpm --filter widgets-ofelia-poop-duty exec vitest run domain/ledger.test.ts domain/author.test.ts ui/parts/MemberAvatar.test.tsx ui/parts/HistoryList.test.tsx`
Expected: FAIL on all four.

- [ ] **Step 3: Widen the persisted author**

In `domain/ledger.ts`, keep `CreatedBySchema` exactly as it is and add:

```ts
/**
 * Records written by the server itself (cron jobs), with no session behind
 * them. A plain union rather than a discriminated one: the account shape is
 * already persisted without a discriminator field, and adding a required one
 * would invalidate every stored record.
 */
export const SystemCreatedBySchema = z.object({ system: z.literal(true) })
export const EntryCreatedBySchema = z.union([CreatedBySchema, SystemCreatedBySchema])
export type EntryCreatedBy = z.infer<typeof EntryCreatedBySchema>

export const SYSTEM_CREATED_BY: EntryCreatedBy = { system: true }
```

and change the field inside `LedgerEntrySchema`:

```ts
  createdBy: EntryCreatedBySchema.nullish().describe(
    'Account that created the record, the server for automatic records, or null when unattributed',
  ),
```

- [ ] **Step 4: Resolve the new author kind**

In `domain/author.ts`, add the variant and the branch — before the account branch, because a system record has no `accountId` to look up:

```ts
export type EntryAuthor =
  | { kind: 'account'; accountId: string; name: string; avatarUrl?: string }
  | { kind: 'person'; person: Person }
  | { kind: 'system' }
  | { kind: 'unknown' }

export function resolveEntryAuthor(
  createdBy: EntryCreatedBy | null | undefined,
  legacy: Person | undefined,
  members: MemberLookup,
): EntryAuthor {
  if (createdBy && 'system' in createdBy) return { kind: 'system' }
  if (createdBy) {
    // unchanged account branch
  }
  // unchanged legacy / unknown branches
}
```

Change its `CreatedBy` import to `EntryCreatedBy`.

- [ ] **Step 5: Let drafts carry it**

In `domain/drafts.ts`, widen the input type — nothing else in the file changes:

```ts
export type DraftInput = {
  entries: LedgerEntry[]
  today: Temporal.PlainDate
  target: Temporal.PlainDate
  createdBy: EntryCreatedBy | null
}
```

`makeCommentDraft` keeps the narrower `CreatedBy | null`: only humans write comments.

- [ ] **Step 6: Render it**

In `ui/parts/MemberAvatar.tsx`, add a branch before the `person` one:

```tsx
    if (author.kind === 'system') {
      return (
        <span
          className={styles.avatar}
          data-kind="system"
          style={style}
          title="Закрыто автоматически"
          aria-hidden
        >
          <Clock size={Math.round(px * 0.6)} aria-hidden />
        </span>
      )
    }
```

Import `Clock` from `lucide-react`, and give `data-kind='system'` its own muted tone in `MemberAvatar.module.css` alongside the existing `data-kind='unknown'` rule.

In `ui/parts/HistoryList.tsx`, extend the signature line so the system case gets its own phrasing rather than falling into «отметил(а) …»:

```tsx
        <span className={styles.signatureName} data-unknown={entry.recordedBy.kind === 'unknown'}>
          {entry.recordedBy.kind === 'unknown'
            ? 'автор неизвестен'
            : entry.recordedBy.kind === 'system'
              ? 'закрыто автоматически'
              : `отметил(а) ${authorName(entry)}`}
        </span>
```

`authorName` is a local const at the top of the same file and its fallback returns `'автор неизвестен'`, so a system entry must be branched on **before** it is called — which is what the code above does. Leave `authorName` itself alone.

- [ ] **Step 7: Run tests to verify they pass**

Run: `pnpm --filter widgets-ofelia-poop-duty exec vitest run`
Expected: PASS.

- [ ] **Step 8: Commit**

```bash
git add packages/widgets/ofelia-poop-duty
git commit -m "feat(ofelia): give server-written records a system author"
```

---

### Task 7: The auto-approve job

**Files:**
- Create: `packages/widgets/ofelia-poop-duty/domain/day-close.ts`
- Test: `packages/widgets/ofelia-poop-duty/domain/day-close.test.ts`
- Modify: `packages/widgets/ofelia-poop-duty/server.ts`
- Test: `packages/widgets/ofelia-poop-duty/server.test.ts`
- Test: `packages/server/src/widgets/ofelia-cron.test.ts`

**Interfaces:**
- Consumes: `makeCleanDraft` / `DraftInput` (`./drafts`), `resolveDays` / `LedgerEntry` / `LedgerEntryDraft` / `SYSTEM_CREATED_BY` (`./ledger`), `DUTY_TIME_ZONE` / `plainDateIn` (`./roster`), the cron contract (Task 1), the scheduler (Task 4).
- Produces:
  - `AUTO_APPROVE_WINDOW_DAYS = 7`
  - `autoApproveDrafts({ entries, scheduledForMs }): LedgerEntryDraft[]`
  - an `autoApproveDay` entry in Ofelia's `crons`

- [ ] **Step 1: Write the failing domain test**

Create `packages/widgets/ofelia-poop-duty/domain/day-close.test.ts`:

```ts
import { describe, expect, it } from 'vitest'

import { autoApproveDrafts } from './day-close'
import type { LedgerEntry } from './ledger'

// 2026-06-19T00:05:00+02:00 — the cron moment that closes 2026-06-12…2026-06-18.
const SCHEDULED_FOR = Date.parse('2026-06-19T00:05:00+02:00')

function entry(overrides: Partial<LedgerEntry>): LedgerEntry {
  return {
    id: 'seed',
    ts: 1,
    date: '2026-06-18',
    type: 'cleaned',
    actor: 'Карина',
    createdBy: { accountId: 'a1', name: 'Карина' },
    ...overrides,
  }
}

describe('autoApproveDrafts', () => {
  it('closes every unresolved day of the window as cleaned by the planned duty', () => {
    const drafts = autoApproveDrafts({ entries: [], scheduledForMs: SCHEDULED_FOR })

    expect(drafts.map((draft) => draft.date)).toEqual([
      '2026-06-12',
      '2026-06-13',
      '2026-06-14',
      '2026-06-15',
      '2026-06-16',
      '2026-06-17',
      '2026-06-18',
    ])
    expect(drafts.every((draft) => draft.type === 'cleaned')).toBe(true)
    expect(drafts.every((draft) => draft.createdBy?.system === true)).toBe(true)
    // 2026-06-16 is BASE_DUTY_DATE → Леша; the rotation alternates daily.
    expect(drafts.find((draft) => draft.date === '2026-06-16')?.actor).toBe('Леша')
    expect(drafts.find((draft) => draft.date === '2026-06-17')?.actor).toBe('Карина')
  })

  it('never touches the day the cron fires on', () => {
    const drafts = autoApproveDrafts({ entries: [], scheduledForMs: SCHEDULED_FOR })

    expect(drafts.some((draft) => draft.date === '2026-06-19')).toBe(false)
  })

  it('skips days that already have a closed outcome', () => {
    const drafts = autoApproveDrafts({
      entries: [entry({ date: '2026-06-18' })],
      scheduledForMs: SCHEDULED_FOR,
    })

    expect(drafts.some((draft) => draft.date === '2026-06-18')).toBe(false)
  })

  it('re-closes a day that was deliberately reset', () => {
    const drafts = autoApproveDrafts({
      entries: [entry({ date: '2026-06-18', type: 'reset', ts: 2 })],
      scheduledForMs: SCHEDULED_FOR,
    })

    expect(drafts.some((draft) => draft.date === '2026-06-18')).toBe(true)
  })

  it('is idempotent — feeding its own output back produces nothing', () => {
    const first = autoApproveDrafts({ entries: [], scheduledForMs: SCHEDULED_FOR })
    const applied: LedgerEntry[] = first.map((draft, index) => ({
      id: `auto-${index}`,
      ts: 100 + index,
      ...draft,
    }))

    expect(autoApproveDrafts({ entries: applied, scheduledForMs: SCHEDULED_FOR })).toEqual([])
  })

  it('does not settle anybody’s debt', () => {
    const drafts = autoApproveDrafts({
      entries: [
        entry({ date: '2026-06-11', type: 'went_into_debt', actor: 'Леша', onBehalfOf: 'Карина' }),
      ],
      scheduledForMs: SCHEDULED_FOR,
    })

    // getDebtDays hands debts forward from "today", so a past date carries no
    // debt assignment: every draft names the planned duty person and none
    // carries onBehalfOf, which is what keeps foldDebt from crediting a
    // repayment nobody made.
    expect(drafts.every((draft) => draft.onBehalfOf === undefined)).toBe(true)
  })
})
```

- [ ] **Step 2: Run it to verify it fails**

Run: `pnpm --filter widgets-ofelia-poop-duty exec vitest run domain/day-close.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement the domain module**

Create `packages/widgets/ofelia-poop-duty/domain/day-close.ts`:

```ts
import { makeCleanDraft } from './drafts'
import { resolveDays, SYSTEM_CREATED_BY, type LedgerEntry, type LedgerEntryDraft } from './ledger'
import { DUTY_TIME_ZONE, plainDateIn } from './roster'

/**
 * How far back auto-approval reaches. Bounded on purpose: without a window the
 * first deploy would retroactively close every unresolved day since the ledger
 * began, and days older than a week are not worth repairing.
 */
export const AUTO_APPROVE_WINDOW_DAYS = 7

export type AutoApproveInput = {
  entries: LedgerEntry[]
  /** The cron occurrence being handled, in epoch ms. */
  scheduledForMs: number
}

export function autoApproveDrafts({
  entries,
  scheduledForMs,
}: AutoApproveInput): LedgerEntryDraft[] {
  const today = plainDateIn(DUTY_TIME_ZONE, scheduledForMs)
  const resolution = resolveDays(entries)

  const drafts: LedgerEntryDraft[] = []
  for (let offset = AUTO_APPROVE_WINDOW_DAYS; offset >= 1; offset -= 1) {
    const target = today.subtract({ days: offset })
    // A day counts as handled only when its latest outcome closed it; a
    // deliberate `reset` leaves it open, and silence still means "cleaned".
    if (resolution.get(target.toString())?.status === 'closed') continue
    // The same builder the `clean` event handler uses, so the manual and the
    // automatic path cannot drift apart.
    drafts.push(makeCleanDraft({ entries, today, target, createdBy: SYSTEM_CREATED_BY }))
  }
  return drafts
}
```

- [ ] **Step 4: Run it to verify it passes**

Run: `pnpm --filter widgets-ofelia-poop-duty exec vitest run domain/day-close.test.ts`
Expected: PASS.

- [ ] **Step 5: Write the failing widget server test**

Append to `packages/widgets/ofelia-poop-duty/server.test.ts`, mirroring its existing `makeContext` style but for a cron context:

```ts
function makeCronContext(stored: unknown = null, scheduledFor = Date.parse('2026-06-17T00:05:00+02:00')) {
  const append = vi.fn<WidgetServerStorage['append']>(async () => undefined)
  const shared = {
    get: vi.fn(async () => stored as never),
    set: vi.fn(async () => undefined),
    delete: vi.fn(async () => undefined),
    has: vi.fn(async () => false),
    keys: vi.fn(async () => []),
    append,
  } as unknown as WidgetServerStorage

  const context = {
    typeId: 'ofelia-poop-duty',
    now: () => scheduledFor,
    scheduledFor,
    api: { storage: { shared }, browser: {} as never },
  } as unknown as WidgetCronContext

  return { context, append }
}

describe('ofelia auto-approve cron', () => {
  it('closes the unresolved window with system-authored entries', async () => {
    const { context, append } = makeCronContext([])

    expect(await ofeliaServer.crons?.autoApproveDay.run(context)).toBeUndefined()
    expect(append).toHaveBeenCalledTimes(7)
    expect(append).toHaveBeenLastCalledWith(LEDGER_KEY, {
      date: '2026-06-16',
      type: 'cleaned',
      actor: 'Леша',
      createdBy: { system: true },
    })
  })

  it('returns the storage error instead of throwing', async () => {
    const { context } = makeCronContext(null)
    context.api.storage.shared.get = vi.fn(async () => new Error('valkey down') as never)

    expect(await ofeliaServer.crons?.autoApproveDay.run(context)).toBeInstanceOf(Error)
  })
})
```

Add `WidgetCronContext` to the `@shared/widgets/contracts` type import.

- [ ] **Step 6: Add the cron to the server definition**

In `packages/widgets/ofelia-poop-duty/server.ts`, add the imports

```ts
import { autoApproveDrafts } from './domain/day-close'
```

and a `crons` block next to `handlers`:

```ts
  crons: {
    // 00:05 rather than midnight: clear of the day boundary and of DST shifts.
    autoApproveDay: {
      schedule: '5 0 * * *',
      timeZone: DUTY_TIME_ZONE,
      run: async ({ scheduledFor, api }) => {
        const entries = await api.storage.shared.get(LEDGER_KEY, LedgerEntriesSchema)
        if (entries instanceof Error) return entries

        // Derived from this fresh read, so a caught-up or retried run cannot
        // duplicate a day that was closed in the meantime.
        const drafts = autoApproveDrafts({ entries: entries ?? [], scheduledForMs: scheduledFor })

        for (const draft of drafts) {
          const appended = await api.storage.shared.append(LEDGER_KEY, draft)
          if (appended instanceof Error) return appended
        }
      },
    },
  },
```

- [ ] **Step 7: Write the server-side integration test**

Create `packages/server/src/widgets/ofelia-cron.test.ts`:

```ts
import { toRuntimeWidgetServerDefinition } from '@shared/widgets/contracts'
import ofeliaServer from '@widgets/ofelia-poop-duty/server'
import { describe, expect, it } from 'vitest'

import { makeFakeBrowserAutomationClient } from '../browser/testing/fake-client'
import { createMemoryOps, createMemoryPubSub } from '../test/memory-ops'
import { makeCronScheduler } from './cron-scheduler'
import { createWidgetServerRegistry } from './registry'

const LEDGER_KEY = 'w:t:ofelia-poop-duty:ledger'
const NOON_0616 = Date.parse('2026-06-16T12:00:00+02:00')
const AFTER_MIDNIGHT_0617 = Date.parse('2026-06-17T00:06:00+02:00')

function makeSetup() {
  const ops = createMemoryOps(createMemoryPubSub())
  const registry = createWidgetServerRegistry([
    toRuntimeWidgetServerDefinition({ typeId: 'ofelia-poop-duty', definition: ofeliaServer }),
  ])
  if (registry instanceof Error) throw registry

  let nowMs = NOON_0616
  const scheduler = makeCronScheduler({
    registry,
    ops,
    browserClient: makeFakeBrowserAutomationClient().client,
    now: () => nowMs,
  })
  return {
    ops,
    scheduler,
    setNow: (ms: number) => {
      nowMs = ms
    },
  }
}

async function readLedger(ops: ReturnType<typeof createMemoryOps>) {
  const raw = await ops.get(LEDGER_KEY)
  return raw === null ? [] : (JSON.parse(raw) as { date: string; createdBy: unknown }[])
}

describe('ofelia auto-approve cron end to end', () => {
  it('writes nothing on the seeding tick', async () => {
    const { ops, scheduler } = makeSetup()
    await scheduler.tick()

    expect(await readLedger(ops)).toEqual([])
  })

  it('closes the unresolved window once the occurrence comes due', async () => {
    const { ops, scheduler, setNow } = makeSetup()
    await scheduler.tick()

    setNow(AFTER_MIDNIGHT_0617)
    await scheduler.tick()

    const ledger = await readLedger(ops)
    expect(ledger.map((record) => record.date)).toEqual([
      '2026-06-10',
      '2026-06-11',
      '2026-06-12',
      '2026-06-13',
      '2026-06-14',
      '2026-06-15',
      '2026-06-16',
    ])
    expect(ledger.every((record) => (record.createdBy as { system?: true })?.system)).toBe(true)
  })

  it('adds nothing on a second tick for the same occurrence', async () => {
    const { ops, scheduler, setNow } = makeSetup()
    await scheduler.tick()
    setNow(AFTER_MIDNIGHT_0617)
    await scheduler.tick()
    const after = await readLedger(ops)

    await scheduler.tick()

    expect(await readLedger(ops)).toHaveLength(after.length)
  })
})
```

- [ ] **Step 8: Run everything**

Run: `pnpm --filter widgets-ofelia-poop-duty exec vitest run`
Then: `pnpm --filter server exec vitest run`
Expected: PASS.

- [ ] **Step 9: Commit**

```bash
git add packages/widgets/ofelia-poop-duty packages/server/src/widgets/ofelia-cron.test.ts
git commit -m "feat(ofelia): auto-approve unresolved duty days on a nightly cron"
```

---

### Task 8: End-to-end proof, docs and the gate

**Files:**
- Modify: `packages/client/e2e/ofelia-duty.spec.ts`
- Modify: `CLAUDE.md`

**Interfaces:**
- Consumes: `POST /api/test/cron/tick` (Task 5), the Ofelia cron (Task 7), the existing `OfeliaPage` page object.

The e2e is the only check that proves a server-side `append` reaches a live client through SSE fanout; everything else stops at the storage layer.

Why the assertion works: `ServerTime` syncs its offset on connect and on tab refocus, and Playwright triggers neither mid-test. After the clock is pushed past midnight the browser still believes "today" is the pinned 2026-06-16 — and that is exactly the day the cron closes, so the confirmed plaque appears for it.

- [ ] **Step 1: Write the failing test**

Append to `packages/client/e2e/ofelia-duty.spec.ts`:

```ts
test('auto-approve — a cron-closed day reaches the open board over SSE', async ({
  page,
  request,
}) => {
  const ofelia = new OfeliaPage(page)
  await ofelia.seedOfeliaWidget()
  await expect(ofelia.confirmButton).toBeVisible()

  // The first tick only seeds the job cursor — nothing may change yet.
  await request.post('/api/test/cron/tick')
  await expect(ofelia.confirmButton).toBeVisible()

  // Past the next 00:05 Warsaw, so the 2026-06-17 occurrence is due and closes
  // every unresolved day up to and including 2026-06-16.
  await request.post('/api/test/time', { data: { iso: '2026-06-17T00:06:00+02:00' } })
  await request.post('/api/test/cron/tick')

  // No reload: this must arrive through the storage SSE stream. Same assertion
  // pair the manual "confirm" test uses, so a pass means the cron write is
  // indistinguishable from a button press as far as the board is concerned.
  await expect(ofelia.confirmedPlaque).toBeVisible()
  await expect(ofelia.undoButton).toBeVisible()
  await expect(ofelia.confirmButton).toHaveCount(0)
})
```

- [ ] **Step 2: Run the suite**

Run: `pnpm test:e2e:docker`
Expected: PASS, including the pre-existing Ofelia specs — they never tick the scheduler, so they must be unaffected.

- [ ] **Step 3: Document the capability**

In `CLAUDE.md`, in the widget system section right after the paragraph about widgets writing shared state through `server.ts`, add:

```markdown
A widget's `server.ts` may also declare `crons: { <name>: { schedule, timeZone, run } }`. The tick
scheduler in `packages/server/src/widgets/cron-scheduler.ts` runs them on the app's injected clock,
keeps a cursor per job at `cron:<typeId>:<jobName>` in Valkey, and catches a missed occurrence up
exactly once — so handlers must be idempotent. A cron context has no `viewer` and no instance
scope: a background run has no caller, so a job that writes an authored record supplies the author
itself. In test mode the interval is off and `POST /api/test/cron/tick` drives one pass.
```

- [ ] **Step 4: Run the full local gate**

Run: `pnpm check`
Expected: PASS (lint + format:check + deps:check + typecheck + tests). If `format:check` fails, run `pnpm format` and re-run — the gate stops at the first failure and never reaches the tests.

- [ ] **Step 5: Commit and open the PR**

```bash
git add packages/client/e2e/ofelia-duty.spec.ts CLAUDE.md
git commit -m "test(e2e): cover the auto-approve cron reaching an open board"
git push -u origin feat/widget-server-cron
gh pr create --base dev
```

- [ ] **Step 6: Deploy to dev and watch a real midnight**

```bash
pnpm run deploy:dev
```

Confirm on dev that the deploy itself writes nothing (the first pass only seeds cursors), and that after the next real 00:05 Europe/Warsaw the unresolved days of the previous week are closed with system-authored records.
