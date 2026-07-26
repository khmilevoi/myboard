# Widget Server Cron Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Let a widget declare scheduled server-side jobs in its `server.ts`, and use that to auto-approve unresolved duty days in the Ofelia widget.

**Architecture:** `WidgetServerDefinition` gains an optional `crons` map. A tick scheduler inside the server walks those jobs every 30 seconds using the app's injected clock, keeps a per-job cursor in Valkey so a missed occurrence is caught up exactly once, and calls croner purely as a next-occurrence calculator. Ofelia's date/ledger logic moves into a dependency-free `domain/` folder shared by its Reatom model and its new `server.ts`.

**Tech Stack:** Node 26, TypeScript 7, Valkey (iovalkey), zod 4, croner 10, Vitest, Playwright, rspack, Reatom 1001.

**Spec:** `docs/superpowers/specs/2026-07-26-widget-server-cron-design.md`

## Global Constraints

- **Node 26 everywhere.** Docker images `node:26-alpine` / `node:26-bookworm-slim`, `.nvmrc` = `26`, `engines.node` = `>=26`. Tasks 2+ assume `node -v` reports v26 locally.
- **errore style.** Functions return `Error | T` unions and narrow with `instanceof Error`. Do not throw, do not use try/catch for control flow. Tagged errors are declared with `errore.createTaggedError`.
- **Factories are named `make*`, never `create*`.** Existing `create*` names stay as they are; every new one in this plan is `make*`.
- **No import may start with `../../`.** `.oxlintrc.json` bans it (`^(\.\./){2,}`). This is why new server modules are flat files in `src/widgets/`, not a `src/widgets/cron/` subfolder.
- **Widget `domain/**` may import only `zod` and JS/Temporal globals.** No Reatom, React, `widget-runtime`, `widget-sdk`, and no `@/` alias — rspack externalizes any request that does not start with `.`, `@shared` or `@widgets`, and the server runtime image installs only `packages/server`'s prod dependencies.
- **Storage key shapes are a persistence contract.** Never change how an existing key is derived without a migration. New keys in this plan: `cron:<typeId>:<jobName>`.
- **Every exported React component is wrapped in `reatomMemo` from `widget-sdk`.**
- **Code, comments, commit messages and docs in English. UI copy in Russian.**
- **Run a single test file with** `pnpm --filter <pkg> exec vitest run <path>`; widget packages are `--filter widgets-ofelia-poop-duty`.

---

### Task 1: Align every Node version on 26

**Files:**
- Modify: `packages/server/Dockerfile:7,13,41`
- Modify: `packages/client/Dockerfile:8,13`
- Modify: `packages/browser-automation/Dockerfile:6,12,38`
- Modify: `docker-compose.dev.yml:56,64,90,104`
- Modify: `pnpm-workspace.yaml` (catalog `@types/node`)
- Modify: `package.json` (add `engines`)
- Create: `.nvmrc`
- Modify: `packages/server/tsconfig.json:4`
- Modify: `packages/widget-runtime/vitest.config.ts:15`
- Modify: `packages/client/vite.config.ts:302`
- Modify: `packages/widget-sdk/src/vite/widget-vite-config.ts:65`

**Interfaces:**
- Consumes: nothing.
- Produces: a toolchain where `Temporal` is a real global in Node code (`packages/server` included), which every later task depends on.

- [ ] **Step 1: Confirm the local runtime is already 26**

Run: `node -v`
Expected: `v26.x.x`. If it is not, install Node 26 first (`nvm install 26 && nvm use 26`) — the rest of this plan assumes it.

- [ ] **Step 2: Bump the base images**

In `packages/server/Dockerfile`, `packages/client/Dockerfile` and `packages/browser-automation/Dockerfile` replace every `FROM node:22-alpine` with `FROM node:26-alpine`, and the single `FROM node:22-bookworm-slim AS runtime` in `packages/browser-automation/Dockerfile` with `FROM node:26-bookworm-slim AS runtime`.

In `docker-compose.dev.yml` replace all four `image: node:22-alpine` with `image: node:26-alpine`.

- [ ] **Step 3: Pin the toolchain**

In `pnpm-workspace.yaml`, catalog entry:

```yaml
  '@types/node': ^26.1.1
```

Create `.nvmrc`:

```
26
```

In the root `package.json`, add next to `"private"`:

```json
  "engines": {
    "node": ">=26"
  },
```

- [ ] **Step 4: Give server code the Temporal types**

`packages/server/tsconfig.json` — `lib` must include `ESNext`, which is what pulls in `lib.esnext.temporal.d.ts` under TypeScript 7:

```json
    "lib": ["ES2022", "ESNext"],
```

- [ ] **Step 5: Drop the now-redundant harmony flag**

Node 26 ships Temporal unflagged. Remove the line `execArgv: ['--harmony-temporal'],` from `packages/widget-runtime/vitest.config.ts`, `packages/client/vite.config.ts` and `packages/widget-sdk/src/vite/widget-vite-config.ts`.

Do **not** touch the `vm.runInThisContext('Temporal')` blocks in `packages/client/src/vitest.setup.ts`, `packages/widget-runtime/vitest.setup.ts` or `packages/widget-sdk/src/test/widget-setup.ts`. jsdom is a separate realm and does not inherit Node's global `Temporal`; those blocks are what copy it across and they are still required.

- [ ] **Step 6: Reinstall and verify the workspace**

Run: `pnpm install`
Then: `pnpm typecheck`
Expected: PASS.

Then: `pnpm test`
Expected: PASS. If a Temporal-using widget test fails with `Temporal is not defined`, Step 5 removed a flag that was still doing work — restore it in that package and note it in the commit message.

- [ ] **Step 7: Verify the images that can actually break**

Run: `docker build -f packages/server/Dockerfile -t myboard-server:node26 .`
Expected: build succeeds.

Run: `docker build -f packages/browser-automation/Dockerfile -t myboard-browser:node26 .`
Expected: build succeeds. This is the risky one — it installs Playwright with system dependencies on `bookworm-slim`.

- [ ] **Step 8: Commit**

```bash
git add -A
git commit -m "chore(node): align every runtime and image on Node 26"
```

---

### Task 2: Add the cron contract to shared widget contracts

**Files:**
- Modify: `packages/shared/widgets/contracts.ts`
- Modify: `packages/server/src/widgets/registry.test.ts:7-11` (fixture gains `crons`)
- Test: `packages/server/src/widgets/contracts.test.ts`

**Interfaces:**
- Consumes: nothing.
- Produces:
  - `type WidgetCronJob = { schedule: string; timeZone: string; run: (context: WidgetCronContext) => Awaitable<Error | void> }`
  - `type WidgetCronContext = { typeId: string; now: () => number; scheduledFor: number; api: { storage: { shared: WidgetServerStorage }; browser: WidgetServerBrowserApi } }`
  - `WidgetServerDefinition` with all three of `schemas?`, `handlers?`, `crons?` optional
  - `RuntimeWidgetServerDefinition` with a required `crons: Record<string, WidgetCronJob>`

- [ ] **Step 1: Write the failing test**

Append to `packages/server/src/widgets/contracts.test.ts`:

```ts
it('normalizes a cron-only definition to empty schemas and handlers', () => {
  const definition = defineWidgetServer({
    crons: {
      nightly: {
        schedule: '5 0 * * *',
        timeZone: 'Europe/Warsaw',
        run: () => undefined,
      },
    },
  })

  const runtime = toRuntimeWidgetServerDefinition({ typeId: 'cron-only', definition })

  expect(runtime.schemas).toEqual({})
  expect(runtime.handlers).toEqual({})
  expect(runtime.crons.nightly?.schedule).toBe('5 0 * * *')
})

it('defaults crons to an empty map for an event-only definition', () => {
  const definition = defineWidgetServer({
    schemas: { ping: { payload: z.object({}), result: z.object({}) } },
    handlers: { ping: () => ({}) },
  })

  const runtime = toRuntimeWidgetServerDefinition({ typeId: 'events-only', definition })

  expect(runtime.crons).toEqual({})
})
```

Make sure the file imports `defineWidgetServer`, `toRuntimeWidgetServerDefinition` from `@shared/widgets/contracts` and `z` from `zod`.

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm --filter server exec vitest run src/widgets/contracts.test.ts`
Expected: FAIL — a cron-only definition does not typecheck and `runtime.crons` is `undefined`.

- [ ] **Step 3: Implement the contract**

In `packages/shared/widgets/contracts.ts`, add above `WidgetServerDefinition`:

```ts
export type WidgetCronContext = {
  typeId: string
  now: () => number
  /**
   * The scheduled moment this run stands for, in epoch ms. When a missed
   * occurrence is caught up this is the occurrence, not the wall clock —
   * handlers that reason about "which day is being closed" want this one.
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

`Awaitable` is already declared further down the file — move its declaration above these types.

Replace `WidgetServerDefinition`, `RuntimeWidgetServerDefinition`, `defineWidgetServer` and `toRuntimeWidgetServerDefinition` with:

```ts
// The generic carries a default so a cron-only definition, which gives TS no
// inference site for Schemas, resolves to an empty event map rather than the
// full WidgetEventSchemas index signature.
export type WidgetServerDefinition<Schemas extends WidgetEventSchemas = {}> = {
  schemas?: Schemas
  handlers?: {
    [Event in keyof Schemas]: (
      payload: z.output<Schemas[Event]['payload']>,
      context: WidgetServerContext,
    ) => Awaitable<Error | z.input<Schemas[Event]['result']>>
  }
  crons?: Record<string, WidgetCronJob>
}

export type RuntimeWidgetServerDefinition = {
  typeId: string
  schemas: WidgetEventSchemas
  handlers: Record<
    string,
    (payload: unknown, context: WidgetServerContext) => Awaitable<Error | unknown>
  >
  crons: Record<string, WidgetCronJob>
}

export function defineWidgetServer<const Schemas extends WidgetEventSchemas = {}>(
  definition: WidgetServerDefinition<Schemas>,
): WidgetServerDefinition<Schemas> {
  return definition
}

export function toRuntimeWidgetServerDefinition<const Schemas extends WidgetEventSchemas = {}>({
  typeId,
  definition,
}: {
  typeId: string
  definition: WidgetServerDefinition<Schemas>
}): RuntimeWidgetServerDefinition {
  return {
    typeId,
    schemas: definition.schemas ?? {},
    handlers: definition.handlers ?? {},
    crons: definition.crons ?? {},
  } as unknown as RuntimeWidgetServerDefinition
}
```

- [ ] **Step 4: Fix the registry test fixture**

`packages/server/src/widgets/registry.test.ts` now fails to typecheck because `RuntimeWidgetServerDefinition` requires `crons`:

```ts
const definition: RuntimeWidgetServerDefinition = {
  typeId: 'test-widget',
  schemas: {},
  handlers: {},
  crons: {},
}
```

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

### Task 3: Validate cron schedules when the registry is built

**Files:**
- Modify: `packages/server/package.json` (add `croner`)
- Modify: `packages/server/src/widgets/errors.ts`
- Modify: `packages/server/src/widgets/registry.ts`
- Test: `packages/server/src/widgets/registry.test.ts`

**Interfaces:**
- Consumes: `RuntimeWidgetServerDefinition.crons` (Task 2).
- Produces:
  - `class InvalidCronScheduleError` — tagged error with `typeId`, `job`, `schedule`
  - `class WidgetCronRunError` — tagged error with `typeId`, `job`, `scheduledFor`
  - `createWidgetServerRegistry` now returns `DuplicateWidgetTypeError | InvalidCronScheduleError | WidgetServerRegistry`

Validation lives here rather than in the scheduler so that `production-registry.ts` fails at import — exactly as it already does for a duplicate `typeId` — and `createApp` keeps its current signature.

- [ ] **Step 1: Add the dependency**

Run: `pnpm --filter server add croner@^10.0.1`
Expected: `croner` appears under `dependencies` in `packages/server/package.json`. It has no transitive dependencies, and rspack externalizes it, so the runtime image resolves it from the installed prod deps.

- [ ] **Step 2: Write the failing test**

Append to `packages/server/src/widgets/registry.test.ts`:

```ts
it('rejects an unparsable cron schedule', () => {
  const broken: RuntimeWidgetServerDefinition = {
    typeId: 'broken-cron',
    schemas: {},
    handlers: {},
    crons: {
      nightly: { schedule: 'not a cron', timeZone: 'Europe/Warsaw', run: () => undefined },
    },
  }

  expect(createWidgetServerRegistry([broken])).toBeInstanceOf(InvalidCronScheduleError)
})

it('rejects an unknown time zone', () => {
  const broken: RuntimeWidgetServerDefinition = {
    typeId: 'broken-zone',
    schemas: {},
    handlers: {},
    crons: {
      nightly: { schedule: '5 0 * * *', timeZone: 'Mars/Olympus', run: () => undefined },
    },
  }

  expect(createWidgetServerRegistry([broken])).toBeInstanceOf(InvalidCronScheduleError)
})

it('accepts a valid schedule', () => {
  const valid: RuntimeWidgetServerDefinition = {
    typeId: 'valid-cron',
    schemas: {},
    handlers: {},
    crons: {
      nightly: { schedule: '5 0 * * *', timeZone: 'Europe/Warsaw', run: () => undefined },
    },
  }

  expect(createWidgetServerRegistry([valid])).not.toBeInstanceOf(Error)
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

Both extend `WidgetDispatchError` only to reuse its shape; neither is ever sent to a client, because a cron run has no HTTP response.

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
      // Constructed and discarded: a schedule that cannot be parsed must fail
      // at startup, not silently never fire. The scheduler builds its own.
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

function tryParseCron(schedule: string, timeZone: string): Error | Cron {
  // croner throws on a malformed pattern or an unknown zone; this is the one
  // place we convert that into a value.
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

### Task 4: Cron cursor state in Valkey

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

The key deliberately sits in its own root namespace rather than under `w:t:`, so it never appears in widget storage listings or SSE fanout.

- [ ] **Step 1: Write the failing test**

Create `packages/server/src/widgets/cron-state.test.ts`:

```ts
import { describe, expect, it } from 'vitest'

import { createMemoryOps, createMemoryPubSub } from '../test/memory-ops'
import { cronStateKey, readCronState, writeCronState } from './cron-state'

function makeOps() {
  return createMemoryOps(createMemoryPubSub())
}

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

export function cronStateKey(typeId: string, jobName: string): string {
  return `cron:${typeId}:${jobName}`
}

export async function readCronState(
  ops: ValkeyOps,
  typeId: string,
  jobName: string,
): Promise<Error | CronState | null> {
  const key = cronStateKey(typeId, jobName)
  const raw = await ops.get(key).catch((cause) => new CronStateError({ operation: 'get', key, cause }))
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

### Task 5: The tick scheduler

**Files:**
- Modify: `packages/server/src/widgets/storage.ts` (extract `makeWidgetScopedStorage`)
- Modify: `packages/server/src/widgets/api.ts` (add `makeWidgetCronApi`)
- Create: `packages/server/src/widgets/cron-scheduler.ts`
- Test: `packages/server/src/widgets/cron-scheduler.test.ts`

**Interfaces:**
- Consumes: `readCronState` / `writeCronState` (Task 4), `WidgetCronJob` / `WidgetCronContext` (Task 2), `WidgetCronRunError` (Task 3), `WidgetServerRegistry`.
- Produces:
  - `dueOccurrence(cron: Cron, cursorMs: number, nowMs: number): number | null` — pure, exported for tests
  - `makeCronScheduler(options: CronSchedulerOptions): CronScheduler`
  - `type CronScheduler = { tick(): Promise<void>; start(): void; stop(): Promise<void> }`
  - `type CronSchedulerOptions = { registry: WidgetServerRegistry; ops: ValkeyOps; browserClient: BrowserAutomationClient; now: () => number; intervalMs?: number }`
  - `makeWidgetScopedStorage({ ops, namespace, ip, now, createId? }): WidgetServerStorage`
  - `makeWidgetCronApi({ ops, typeId, now, browserClient }): WidgetCronContext['api']`

- [ ] **Step 1: Extract the scope factory from the storage API**

`packages/server/src/widgets/storage.ts` currently builds both scopes inside `createWidgetServerStorageApi` via a local `createScope`. Lift that closure to a module-level export and have the existing function call it — no behavior change:

```ts
export type MakeWidgetScopedStorageOptions = {
  ops: ValkeyOps
  namespace: string
  ip: string | null
  now: () => number
  createId?: () => string
}

export function makeWidgetScopedStorage({
  ops,
  namespace,
  ip,
  now,
  createId = randomUUID,
}: MakeWidgetScopedStorageOptions): WidgetServerStorage {
  // body of the former createScope, verbatim
}

export function createWidgetServerStorageApi({
  ops,
  typeId,
  instanceId,
  ip,
  now,
  createId = randomUUID,
}: CreateWidgetServerStorageApiOptions): {
  instance: WidgetServerStorage
  shared: WidgetServerStorage
} {
  const scope = (namespace: string) =>
    makeWidgetScopedStorage({ ops, namespace, ip, now, createId })
  return {
    instance: scope(instanceNamespace(instanceId)),
    shared: scope(typeNamespace(typeId)),
  }
}
```

A cron run has no instance and no request IP, so it builds only the shared scope with `ip: null` — which is why the shared scope must be constructible on its own.

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
      shared: makeWidgetScopedStorage({
        ops,
        namespace: typeNamespace(typeId),
        ip: null,
        now,
      }),
    },
    browser: createWidgetBrowserApi({ widgetId: typeId, client: browserClient }),
  }
}
```

Add the imports it needs: `typeNamespace` from `@shared/storage/scope`, `makeWidgetScopedStorage` from `./storage`, `WidgetCronContext` from `@shared/widgets/contracts`, `ValkeyOps` from `../storage/valkey`.

- [ ] **Step 3: Write the failing test**

Create `packages/server/src/widgets/cron-scheduler.test.ts`:

```ts
import type { RuntimeWidgetServerDefinition, WidgetCronContext, WidgetCronJob } from '@shared/widgets/contracts'
import { Cron } from 'croner'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import { makeFakeBrowserAutomationClient } from '../browser/testing/fake-client'
import { createMemoryOps, createMemoryPubSub } from '../test/memory-ops'
import { makeCronScheduler, dueOccurrence } from './cron-scheduler'
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

  function makeScheduler(run: (context: WidgetCronContext) => unknown) {
    return makeCronScheduler({
      registry: makeRegistry(run),
      ops,
      browserClient: makeFakeBrowserAutomationClient(),
      now: () => nowMs,
    })
  }

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
    const run = vi.fn(() => new Error('boom'))
    const scheduler = makeScheduler(run)
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
    const run = vi.fn(() => new Error('boom'))
    const scheduler = makeScheduler(run)
    await scheduler.tick()

    nowMs = NOON_0619
    for (let attempt = 0; attempt < 5; attempt += 1) await scheduler.tick()

    expect(await readCronState(ops, 'test-widget', 'nightly')).toEqual({
      cursorMs: MIDNIGHT_0619,
      failures: 0,
    })
  })

  it('treats a thrown error like a returned one', async () => {
    const run = vi.fn(() => {
      throw new Error('boom')
    })
    const scheduler = makeScheduler(run)
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

  it('gives the job a shared storage scope and no instance scope', async () => {
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
  console.warn(`cron catch-up hit the ${MAX_CATCHUP_STEPS}-step cap; using ${new Date(due).toISOString()}`)
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
        // instead of hammering a permanently broken job every interval.
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

### Task 6: Wire the scheduler into the app

**Files:**
- Modify: `packages/server/src/app.ts`
- Test: `packages/server/src/app.test.ts`

**Interfaces:**
- Consumes: `makeCronScheduler` (Task 5).
- Produces:
  - `AppDeps` gains `cron?: { intervalMs?: number }`
  - `POST /api/test/cron/tick` — registered only when `testControls` is present, responds `204` after the pass completes

When `testControls` are present the automatic interval is **not** started. That is what makes the e2e deterministic: the suite drives the real scheduler through the route instead of sleeping or calling handlers behind its back.

- [ ] **Step 1: Write the failing test**

Add a self-contained describe block at the end of `packages/server/src/app.test.ts` — the existing one is pinned to the module-level `testWidgetRegistry`, and this test needs a registry with a cron in it:

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

Add `defineWidgetServer` and `toRuntimeWidgetServerDefinition` to the existing `@shared/widgets/contracts` import, and `App` to the `./app` import.

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm --filter server exec vitest run src/app.test.ts -t "cron tick route"`
Expected: FAIL — the route 404s.

- [ ] **Step 3: Wire it up**

In `packages/server/src/app.ts`:

```ts
import { makeCronScheduler } from './widgets/cron-scheduler'
```

Add to `AppDeps`:

```ts
  cron?: { intervalMs?: number }
```

After `browserClient` is built (the recovery-revoking wrapper — the scheduler must use the same client the dispatcher does):

```ts
  const cronScheduler = makeCronScheduler({
    registry: deps.widgetRegistry,
    ops,
    browserClient,
    now,
    ...(deps.cron?.intervalMs !== undefined ? { intervalMs: deps.cron.intervalMs } : {}),
  })
  // In test mode the suite drives the scheduler explicitly through
  // /api/test/cron/tick, so an interval racing a faked clock would only add
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

And in `close`:

```ts
  const close = async (): Promise<void> => {
    unsubscribe()
    await cronScheduler.stop()
    recoveryStore.revokeAll()
    await new Promise<void>((resolve) => server.close(() => resolve()))
  }
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

### Task 7: Extract Ofelia's pure domain out of the Reatom model

**Files:**
- Create: `packages/widgets/ofelia-poop-duty/domain/roster.ts`
- Create: `packages/widgets/ofelia-poop-duty/domain/ledger.ts`
- Create: `packages/widgets/ofelia-poop-duty/domain/debt.ts`
- Modify: `packages/widgets/ofelia-poop-duty/model/ofelia-duty.ts`
- Modify: 15 consumer files (see the mapping table below)
- Modify: `.oxlintrc.json`
- Test: existing suites must stay green; move `model/ledger.test.ts` and the pure half of `model/ofelia-duty.test.ts` to `domain/`

This is a pure move — no behavior changes. Everything that follows depends on it, because `server.ts` cannot import a file that pulls in Reatom.

**Interfaces:**
- Produces (all named exactly as they are today unless noted):
  - `domain/roster.ts`: `DUTY_TIME_ZONE`, `BASE_DUTY_DATE_ISO` (**renamed**, now a string), `DUTY_ROTATION`, `DutyPerson`, `Person`, `PersonSchema`, `getOfeliaDutyByDate`, `otherPerson`, `getStartOfWeek`, `weekStartISO`, `plainDateIn` (**new**)
  - `domain/ledger.ts`: `LEDGER_KEY`, `LedgerTypeSchema`, `LedgerType`, `LedgerEntrySchema`, `LedgerEntry`, `LedgerEntryDraft`, `LedgerEntriesSchema`, `latestOutcomesByDate`, `DayResolution`, `resolveDays`
  - `domain/debt.ts`: `DEBT_WARNING_THRESHOLD`, `NumberOfDebtsSchema`, `NumberOfDebts`, `DebtDay`, `foldDebt`, `normalizeDebts`, `getDebtDays`, `effectiveDuty`, `isDebtDay`, `isOverDebtWarning`
  - `model/ofelia-duty.ts` keeps only: `OfeliaDutyModelProps`, `HistoryEntryView`, `IP_TAIL_LENGTH`, `ofeliaDutyModel`

- [ ] **Step 1: Create `domain/roster.ts`**

```ts
import { z } from 'zod'

export const DUTY_TIME_ZONE = 'Europe/Warsaw' as const
/**
 * Kept as an ISO string rather than a Temporal.PlainDate so this module can be
 * imported before the browser Temporal polyfill has been installed — Temporal
 * is only touched inside function bodies.
 */
export const BASE_DUTY_DATE_ISO = '2026-06-16' as const
export const DUTY_ROTATION = ['Леша', 'Карина'] as const

export type DutyPerson = (typeof DUTY_ROTATION)[number]
export type Person = DutyPerson

export const PersonSchema = z.enum(DUTY_ROTATION)

export function plainDateIn(timeZone: string, epochMs: number): Temporal.PlainDate {
  return Temporal.Instant.fromEpochMilliseconds(epochMs).toZonedDateTimeISO(timeZone).toPlainDate()
}

export function getOfeliaDutyByDate(date: Temporal.PlainDate): DutyPerson {
  const base = Temporal.PlainDate.from(BASE_DUTY_DATE_ISO)
  const diffDays = base.until(date, { largestUnit: 'day' }).days
  return DUTY_ROTATION[positiveModulo(diffDays, DUTY_ROTATION.length)]
}

export function otherPerson(person: Person): Person {
  return DUTY_ROTATION.find((candidate) => candidate !== person) ?? person
}

export function getStartOfWeek(date: Temporal.PlainDate): Temporal.PlainDate {
  return date.subtract({ days: date.dayOfWeek - 1 })
}

export function weekStartISO(date: Temporal.PlainDate): string {
  return getStartOfWeek(date).toString()
}

function positiveModulo(value: number, divisor: number): number {
  return ((value % divisor) + divisor) % divisor
}
```

- [ ] **Step 2: Create `domain/ledger.ts` and `domain/debt.ts`**

Move the corresponding declarations out of `model/ofelia-duty.ts` **verbatim**, changing only the imports:

- `domain/ledger.ts` takes `LEDGER_KEY`, `LedgerTypeSchema`, `LedgerType`, `LedgerEntrySchema`, `LedgerEntry`, `LedgerEntryDraft`, `LedgerEntriesSchema`, `DAY_OUTCOME_TYPES` (keep it module-private), `latestOutcomesByDate`, `DayResolution`, `resolveDays`. It imports `PersonSchema` from `./roster`.
- `domain/debt.ts` takes `DEBT_WARNING_THRESHOLD`, `NumberOfDebtsSchema`, `NumberOfDebts`, `foldDebt`, `normalizeDebts`, `DebtDay`, `getDebtDays`, `effectiveDuty`, `isDebtDay`, `isOverDebtWarning`. It imports from `./roster` and `./ledger`.

`getDebtDays` moves from module-private to exported — `domain/day-close.ts` (Task 9) needs it.

- [ ] **Step 3: Add the boundary lint rule**

In `.oxlintrc.json`, after the top-level `rules` block:

```json
  "overrides": [
    {
      "files": ["packages/widgets/*/domain/**"],
      "rules": {
        "no-restricted-imports": [
          "error",
          {
            "patterns": [
              {
                "regex": "^(\\.\\./){2,}",
                "message": "Deep relative imports are not allowed."
              },
              {
                "regex": "^(@reatom/|react|react-dom|widget-runtime|widget-sdk|@/)",
                "message": "Widget domain code is shared with the server bundle: it may only import zod and globals. No Reatom, React, widget runtime/SDK, and no '@/' alias (rspack externalizes it)."
              }
            ]
          }
        ]
      }
    }
  ]
```

- [ ] **Step 4: Update the consumers**

Delete the moved declarations from `model/ofelia-duty.ts` and import what the model still needs from `@/domain/...`. Then repoint every other consumer. Find them with:

Run: `rg -l "from '@/model/ofelia-duty'" packages/widgets/ofelia-poop-duty`

Mapping — the symbol tells you the new module:

| Symbols | New import |
|---|---|
| `DUTY_ROTATION`, `DutyPerson`, `Person`, `PersonSchema`, `DUTY_TIME_ZONE`, `getOfeliaDutyByDate`, `otherPerson`, `weekStartISO`, `plainDateIn` | `@/domain/roster` |
| `LEDGER_KEY`, `LedgerEntry`, `LedgerEntryDraft`, `LedgerEntriesSchema`, `LedgerEntrySchema`, `LedgerType`, `DayResolution`, `resolveDays`, `latestOutcomesByDate` | `@/domain/ledger` |
| `NumberOfDebts`, `foldDebt`, `normalizeDebts`, `getDebtDays`, `effectiveDuty`, `isDebtDay`, `isOverDebtWarning`, `DEBT_WARNING_THRESHOLD` | `@/domain/debt` |
| `HistoryEntryView`, `IP_TAIL_LENGTH`, `ofeliaDutyModel`, `OfeliaDutyModelProps` | `@/model/ofelia-duty` (unchanged) |

For example `ui/parts/HistoryList.tsx` changes from

```ts
import type { HistoryEntryView } from '@/model/ofelia-duty'
```

to the same line (it only uses a view type), while `ui/person.ts` changes from

```ts
import { DUTY_ROTATION, type Person } from '@/model/ofelia-duty'
```

to

```ts
import { DUTY_ROTATION, type Person } from '@/domain/roster'
```

Note `BASE_DUTY_DATE` no longer exists. Every reader of it now calls `Temporal.PlainDate.from(BASE_DUTY_DATE_ISO)` or, better, uses `getOfeliaDutyByDate`.

- [ ] **Step 5: Move the pure tests**

Move `model/ledger.test.ts` to `domain/ledger.test.ts` and split `model/ofelia-duty.test.ts`: assertions over `foldDebt` / `getDebtDays` / `effectiveDuty` / `getOfeliaDutyByDate` go to `domain/debt.test.ts` and `domain/roster.test.ts`; anything that constructs `ofeliaDutyModel` stays in `model/ofelia-duty.test.ts`. Update their imports the same way.

- [ ] **Step 6: Verify nothing changed**

Run: `pnpm --filter widgets-ofelia-poop-duty exec vitest run`
Expected: PASS — same test count as before the move (minus none; tests were relocated, not deleted).

Run: `pnpm lint`
Expected: PASS. Then deliberately add `import { atom } from '@reatom/core'` to `domain/roster.ts`, re-run `pnpm lint`, confirm it now FAILS with the boundary message, and remove the line.

Run: `pnpm typecheck`
Expected: PASS.

- [ ] **Step 7: Commit**

```bash
git add packages/widgets/ofelia-poop-duty .oxlintrc.json
git commit -m "refactor(ofelia): extract the pure duty domain out of the Reatom model"
```

---

### Task 8: Widen the ledger for system-authored entries

**Files:**
- Modify: `packages/widgets/ofelia-poop-duty/domain/ledger.ts`
- Modify: `packages/widgets/ofelia-poop-duty/model/ofelia-duty.ts` (`HistoryEntryView`, `historyView`)
- Modify: `packages/widgets/ofelia-poop-duty/ui/parts/HistoryList.tsx`
- Test: `packages/widgets/ofelia-poop-duty/ui/parts/HistoryList.test.tsx`
- Test: `packages/widgets/ofelia-poop-duty/domain/ledger.test.ts`

**Interfaces:**
- Produces: `AuthorSchema`, `type Author = Person | 'system'`; `LedgerEntry.by: Author`; `LedgerEntry.ip: string | null`; `HistoryEntryView.by: Author`; `HistoryEntryView.ipTail: string | null`.

Both widenings are backward compatible — every existing stored entry stays valid, so there is no migration and the `ledger` key is untouched.

- [ ] **Step 1: Write the failing tests**

In `domain/ledger.test.ts`:

```ts
it('accepts a system-authored entry with no IP', () => {
  const parsed = LedgerEntrySchema.safeParse({
    id: 'auto-1',
    ts: 1,
    ip: null,
    date: '2026-06-16',
    type: 'cleaned',
    actor: 'Леша',
    by: 'system',
  })

  expect(parsed.success).toBe(true)
})

it('still accepts a human entry with an IP', () => {
  const parsed = LedgerEntrySchema.safeParse({
    id: 'human-1',
    ts: 1,
    ip: '127.0.0.1',
    date: '2026-06-16',
    type: 'cleaned',
    actor: 'Леша',
    by: 'Карина',
  })

  expect(parsed.success).toBe(true)
})
```

In `ui/parts/HistoryList.test.tsx` (the file already has an `entry` helper whose defaults include `by: 'Карина'` and `ipTail: '0.0.22'`; add `screen` to the `@testing-library/react` import if it is not there yet):

```ts
it('marks a system-authored entry instead of showing an IP tail', () => {
  render(<HistoryList entries={[entry({ by: 'system', ipTail: null })]} />)

  expect(screen.getByText('авто')).toBeInTheDocument()
  expect(screen.queryByText('0.0.22')).not.toBeInTheDocument()
})
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `pnpm --filter widgets-ofelia-poop-duty exec vitest run domain/ledger.test.ts ui/parts/HistoryList.test.tsx`
Expected: FAIL — `by: 'system'` is rejected and no `авто` text is rendered.

- [ ] **Step 3: Widen the schema**

In `domain/ledger.ts`:

```ts
import { DUTY_ROTATION, PersonSchema } from './roster'

/** Entry authors: a roster member, or the server for auto-approved days. */
export const AuthorSchema = z.enum([...DUTY_ROTATION, 'system'])
export type Author = z.infer<typeof AuthorSchema>
```

and inside `LedgerEntrySchema`:

```ts
  ip: z
    .string()
    .nullable()
    .describe('IP of the entry author, null for server-authored entries; only its tail is shown'),
  by: AuthorSchema.describe('Who created this entry — a roster member, or the server'),
```

`actor` and `onBehalfOf` keep `PersonSchema`: only a human can be on duty.

- [ ] **Step 4: Widen the view model**

In `model/ofelia-duty.ts`:

```ts
export type HistoryEntryView = {
  id: string
  date: string
  type: LedgerType
  actor: Person
  onBehalfOf?: Person
  by: Author
  ipTail: string | null
}
```

and in the `historyView` computed:

```ts
        ipTail: entry.ip === null ? null : entry.ip.slice(-IP_TAIL_LENGTH),
```

- [ ] **Step 5: Render the marker**

In `ui/parts/HistoryList.tsx`, replace the IP chip line:

```tsx
              {entry.by === 'system' ? (
                <span className={styles.ip}>авто</span>
              ) : entry.ipTail ? (
                <span className={styles.ip}>{entry.ipTail}</span>
              ) : null}
```

Without this a server-authored entry would differ from a manual one only by a missing IP chip, which reads as a bug.

- [ ] **Step 6: Run tests to verify they pass**

Run: `pnpm --filter widgets-ofelia-poop-duty exec vitest run`
Expected: PASS.

- [ ] **Step 7: Commit**

```bash
git add packages/widgets/ofelia-poop-duty
git commit -m "feat(ofelia): allow server-authored ledger entries"
```

---

### Task 9: Auto-approve decision logic in the domain

**Files:**
- Create: `packages/widgets/ofelia-poop-duty/domain/day-close.ts`
- Test: `packages/widgets/ofelia-poop-duty/domain/day-close.test.ts`
- Modify: `packages/widgets/ofelia-poop-duty/model/ofelia-duty.ts` (`confirmClean` reuses the shared builder)

**Interfaces:**
- Consumes: `getDebtDays`, `foldDebt` (`@/domain/debt`), `resolveDays`, `LedgerEntry`, `LedgerEntryDraft`, `Author` (`@/domain/ledger`), `getOfeliaDutyByDate`, `plainDateIn`, `DUTY_TIME_ZONE` (`@/domain/roster`).
- Produces:
  - `AUTO_APPROVE_WINDOW_DAYS = 7`
  - `makeCleanedDraft(input: { date: Temporal.PlainDate; today: Temporal.PlainDate; debts: Partial<NumberOfDebts>; resolution: ReadonlyMap<string, DayResolution>; by: Author }): LedgerEntryDraft`
  - `autoApproveDrafts(input: { entries: LedgerEntry[]; scheduledForMs: number }): LedgerEntryDraft[]`

- [ ] **Step 1: Write the failing test**

Create `packages/widgets/ofelia-poop-duty/domain/day-close.test.ts`:

```ts
import { describe, expect, it } from 'vitest'

import type { LedgerEntry } from './ledger'
import { autoApproveDrafts } from './day-close'

// 2026-06-19T00:05:00+02:00 — the cron moment that closes 2026-06-12…2026-06-18.
const SCHEDULED_FOR = Date.parse('2026-06-19T00:05:00+02:00')

function humanEntry(overrides: Partial<LedgerEntry>): LedgerEntry {
  return {
    id: 'seed',
    ts: 1,
    ip: '127.0.0.1',
    date: '2026-06-18',
    type: 'cleaned',
    actor: 'Карина',
    by: 'Карина',
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
    expect(drafts.every((draft) => draft.by === 'system')).toBe(true)
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
      entries: [humanEntry({ date: '2026-06-18' })],
      scheduledForMs: SCHEDULED_FOR,
    })

    expect(drafts.some((draft) => draft.date === '2026-06-18')).toBe(false)
  })

  it('re-closes a day that was deliberately reset', () => {
    const drafts = autoApproveDrafts({
      entries: [humanEntry({ date: '2026-06-18', type: 'reset', ts: 2 })],
      scheduledForMs: SCHEDULED_FOR,
    })

    expect(drafts.some((draft) => draft.date === '2026-06-18')).toBe(true)
  })

  it('is idempotent — feeding its own output back produces nothing', () => {
    const first = autoApproveDrafts({ entries: [], scheduledForMs: SCHEDULED_FOR })
    const applied: LedgerEntry[] = first.map((draft, index) => ({
      id: `auto-${index}`,
      ts: 100 + index,
      ip: null,
      ...draft,
    }))

    expect(autoApproveDrafts({ entries: applied, scheduledForMs: SCHEDULED_FOR })).toEqual([])
  })

  it('does not settle anybody’s debt', () => {
    const drafts = autoApproveDrafts({
      entries: [
        humanEntry({
          date: '2026-06-11',
          type: 'went_into_debt',
          actor: 'Леша',
          onBehalfOf: 'Карина',
        }),
      ],
      scheduledForMs: SCHEDULED_FOR,
    })

    // A past date carries no debt assignment (getDebtDays hands debts forward
    // from today), so every draft names the planned duty person and none of
    // them carries onBehalfOf — which is what keeps foldDebt from crediting a
    // repayment nobody made.
    expect(drafts.every((draft) => draft.onBehalfOf === undefined)).toBe(true)
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm --filter widgets-ofelia-poop-duty exec vitest run domain/day-close.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement**

Create `packages/widgets/ofelia-poop-duty/domain/day-close.ts`:

```ts
import { foldDebt, getDebtDays, type NumberOfDebts } from './debt'
import {
  resolveDays,
  type Author,
  type DayResolution,
  type LedgerEntry,
  type LedgerEntryDraft,
} from './ledger'
import { DUTY_TIME_ZONE, getOfeliaDutyByDate, plainDateIn } from './roster'

/**
 * How far back auto-approval reaches. Bounded on purpose: without a window the
 * first deploy would retroactively close every unresolved day since the ledger
 * began, and days older than a week are not worth repairing.
 */
export const AUTO_APPROVE_WINDOW_DAYS = 7

export type MakeCleanedDraftInput = {
  date: Temporal.PlainDate
  today: Temporal.PlainDate
  debts: Partial<NumberOfDebts>
  resolution: ReadonlyMap<string, DayResolution>
  by: Author
}

/**
 * The single place a "cleaned" entry is shaped. Both the confirm button and the
 * auto-approve cron go through here, so they cannot drift apart.
 */
export function makeCleanedDraft({
  date,
  today,
  debts,
  resolution,
  by,
}: MakeCleanedDraftInput): LedgerEntryDraft {
  const debtDay = getDebtDays(debts, today, resolution).find((day) => day.date.equals(date))
  const plannedDuty = getOfeliaDutyByDate(date)
  return {
    date: date.toString(),
    type: 'cleaned',
    actor: debtDay?.person ?? plannedDuty,
    by,
    ...(debtDay ? { onBehalfOf: plannedDuty } : {}),
  }
}

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
  const debts = foldDebt(entries)

  const drafts: LedgerEntryDraft[] = []
  for (let offset = AUTO_APPROVE_WINDOW_DAYS; offset >= 1; offset -= 1) {
    const date = today.subtract({ days: offset })
    // A day counts as handled only when its latest outcome closed it; a
    // deliberate `reset` leaves it open, and silence still means "cleaned".
    if (resolution.get(date.toString())?.status === 'closed') continue
    drafts.push(makeCleanedDraft({ date, today, debts, resolution, by: 'system' }))
  }
  return drafts
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm --filter widgets-ofelia-poop-duty exec vitest run domain/day-close.test.ts`
Expected: PASS.

- [ ] **Step 5: Make the confirm button use the same builder**

In `model/ofelia-duty.ts`, replace the draft construction inside `confirmClean`:

```ts
  const confirmClean = action(async (date?: Temporal.PlainDate) => {
    const currentToday = today()
    const debts = numberOfDebts()
    if (currentToday == null || debts === null) return
    const target = date ?? selectedDate() ?? currentToday

    const draft = makeCleanedDraft({
      date: target,
      today: currentToday,
      debts,
      resolution: dayResolution(),
      by: currentUser(),
    })
    const result = await wrap(storage.shared.server.append(LEDGER_KEY, draft))
    if (result instanceof Error) throw result
  }, 'ofeliaDuty.confirmClean').extend(withAsyncData({ status: true }))
```

- [ ] **Step 6: Run the whole widget suite**

Run: `pnpm --filter widgets-ofelia-poop-duty exec vitest run`
Expected: PASS — in particular the existing `confirmClean` tests, which pin the debt-day `onBehalfOf` behavior that `makeCleanedDraft` now owns.

- [ ] **Step 7: Commit**

```bash
git add packages/widgets/ofelia-poop-duty
git commit -m "feat(ofelia): share the cleaned-draft builder and add auto-approve selection"
```

---

### Task 10: Ofelia's server definition and its cron

**Files:**
- Create: `packages/widgets/ofelia-poop-duty/server.ts`
- Test: `packages/server/src/widgets/ofelia-cron.test.ts`
- Verify: `packages/server/src/widgets/widget-server-list.generated.ts` stops being empty

**Interfaces:**
- Consumes: `defineWidgetServer` (Task 2), `autoApproveDrafts` (Task 9), `LEDGER_KEY` / `LedgerEntriesSchema` (Task 7), `DUTY_TIME_ZONE` (Task 7).
- Produces: a default-exported `WidgetServerDefinition` picked up by `scripts/codegen/server.ts`, which discovers widget directories that contain a `server.ts`.

Note the import style: `server.ts` and everything it reaches use **relative** paths, never `@/`. rspack externalizes anything that is not `.`, `@shared` or `@widgets`, so an aliased import would become a `require('@/domain/...')` at runtime.

- [ ] **Step 1: Write the failing test**

Create `packages/server/src/widgets/ofelia-cron.test.ts`:

```ts
import ofeliaServer from '@widgets/ofelia-poop-duty/server'
import { toRuntimeWidgetServerDefinition } from '@shared/widgets/contracts'
import { describe, expect, it } from 'vitest'

import { makeFakeBrowserAutomationClient } from '../browser/testing/fake-client'
import { createMemoryOps, createMemoryPubSub } from '../test/memory-ops'
import { makeCronScheduler } from './cron-scheduler'
import { createWidgetServerRegistry } from './registry'

const LEDGER_KEY = 'w:t:ofelia-poop-duty:ledger'
const NOON_0616 = Date.parse('2026-06-16T12:00:00+02:00')
const MIDNIGHT_0617 = Date.parse('2026-06-17T00:06:00+02:00')

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
    browserClient: makeFakeBrowserAutomationClient(),
    now: () => nowMs,
  })
  return { ops, scheduler, setNow: (ms: number) => { nowMs = ms } }
}

async function readLedger(ops: ReturnType<typeof createMemoryOps>) {
  const raw = await ops.get(LEDGER_KEY)
  return raw === null ? [] : (JSON.parse(raw) as { date: string; by: string; actor: string }[])
}

describe('ofelia auto-approve cron', () => {
  it('writes nothing on the seeding tick', async () => {
    const { ops, scheduler } = makeSetup()
    await scheduler.tick()

    expect(await readLedger(ops)).toEqual([])
  })

  it('closes the unresolved window once the occurrence comes due', async () => {
    const { ops, scheduler, setNow } = makeSetup()
    await scheduler.tick()

    setNow(MIDNIGHT_0617)
    await scheduler.tick()

    const ledger = await readLedger(ops)
    expect(ledger.map((entry) => entry.date)).toEqual([
      '2026-06-10',
      '2026-06-11',
      '2026-06-12',
      '2026-06-13',
      '2026-06-14',
      '2026-06-15',
      '2026-06-16',
    ])
    expect(ledger.every((entry) => entry.by === 'system')).toBe(true)
  })

  it('adds nothing on a second run for the same occurrence', async () => {
    const { ops, scheduler, setNow } = makeSetup()
    await scheduler.tick()
    setNow(MIDNIGHT_0617)
    await scheduler.tick()
    const after = await readLedger(ops)

    await scheduler.tick()

    expect(await readLedger(ops)).toHaveLength(after.length)
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm --filter server exec vitest run src/widgets/ofelia-cron.test.ts`
Expected: FAIL — `@widgets/ofelia-poop-duty/server` does not exist.

- [ ] **Step 3: Implement the server definition**

Create `packages/widgets/ofelia-poop-duty/server.ts`:

```ts
import { defineWidgetServer } from '@shared/widgets/contracts'

import { autoApproveDrafts } from './domain/day-close'
import { LEDGER_KEY, LedgerEntriesSchema } from './domain/ledger'
import { DUTY_TIME_ZONE } from './domain/roster'

export const ofeliaServer = defineWidgetServer({
  crons: {
    // 00:05 rather than midnight: clear of the day boundary and of DST shifts.
    autoApproveDay: {
      schedule: '5 0 * * *',
      timeZone: DUTY_TIME_ZONE,
      run: async ({ scheduledFor, api }) => {
        const entries = await api.storage.shared.get(LEDGER_KEY, LedgerEntriesSchema)
        if (entries instanceof Error) return entries

        // Re-derived from the freshly read ledger, so a retry or a caught-up
        // run cannot duplicate a day that was closed in the meantime.
        const drafts = autoApproveDrafts({
          entries: entries ?? [],
          scheduledForMs: scheduledFor,
        })

        for (const draft of drafts) {
          const appended = await api.storage.shared.append(LEDGER_KEY, draft)
          if (appended instanceof Error) return appended
        }
      },
    },
  },
})

export default ofeliaServer
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `pnpm --filter server exec vitest run src/widgets/ofelia-cron.test.ts`
Expected: PASS.

- [ ] **Step 5: Regenerate and check the codegen output**

Run: `pnpm run codegen:server`
Then read `packages/server/src/widgets/widget-server-list.generated.ts`.
Expected: it now imports `@widgets/ofelia-poop-duty/server` and the list has one entry. This file is generated and git-ignored — do not commit it.

- [ ] **Step 6: Prove the real server bundle carries the widget**

This path has never run against real content before, so verify it explicitly rather than assuming.

Run: `pnpm --filter server build`
Expected: build succeeds.

Run: `grep -c "autoApproveDay" packages/server/dist/index.cjs`
Expected: at least 1 — the widget's cron is bundled, not left as an unresolved external.

- [ ] **Step 7: Commit**

```bash
git add packages/widgets/ofelia-poop-duty/server.ts packages/server/src/widgets/ofelia-cron.test.ts
git commit -m "feat(ofelia): auto-approve unresolved duty days on a nightly cron"
```

---

### Task 11: End-to-end proof that a cron write reaches the browser

**Files:**
- Modify: `packages/client/e2e/ofelia-duty.spec.ts`

**Interfaces:**
- Consumes: `POST /api/test/cron/tick` (Task 6), the Ofelia cron (Task 10), the existing `OfeliaPage` page object.

This is the only check that proves a server-side `append` reaches a live client through SSE fanout; every other test stops at the storage layer.

Why the assertion works: `ServerTime` syncs its offset on connect and on tab refocus, and Playwright triggers neither mid-test. So after the clock is pushed to the next day the browser still believes "today" is the pinned 2026-06-16 — and that is precisely the day the cron closes, so the confirmed plaque appears for it.

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

  // First tick only seeds the job cursor — nothing may change yet.
  await request.post('/api/test/cron/tick')
  await expect(ofelia.confirmButton).toBeVisible()

  // Past the next 00:05 Warsaw, so the occurrence for 2026-06-17 is due and
  // closes every unresolved day up to and including 2026-06-16.
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

- [ ] **Step 2: Run it to verify it fails**

Run: `ALLOW_TEST_DB_RESET=1 pnpm --filter client exec playwright test e2e/ofelia-duty.spec.ts -g "auto-approve"`
Expected: FAIL before Tasks 6 and 10 are deployed into the built server; with them in place it should pass. If the run cannot reach Valkey, use `pnpm test:e2e:docker` instead.

- [ ] **Step 3: Run the full e2e suite**

Run: `pnpm test:e2e:docker`
Expected: PASS — the pre-existing Ofelia specs must be unaffected, since they never tick the scheduler.

- [ ] **Step 4: Commit**

```bash
git add packages/client/e2e/ofelia-duty.spec.ts
git commit -m "test(e2e): cover the auto-approve cron reaching an open board"
```

---

### Task 12: Full gate and documentation

**Files:**
- Modify: `CLAUDE.md` (architecture notes — widget server section)

- [ ] **Step 1: Document the cron capability**

In `CLAUDE.md`, under the widget system section, after the `packages/widgets/<widget-name>` bullet, add:

```markdown
- **Widget server crons**: a widget's `server.ts` may declare `crons: { <name>: { schedule, timeZone, run } }`. A tick scheduler in `packages/server/src/widgets/cron-scheduler.ts` runs them on the app's injected clock, keeps a cursor per job at `cron:<typeId>:<jobName>` in Valkey, and catches a missed occurrence up exactly once. Cron handlers get shared (type-scoped) storage only — no instance scope, no request IP — so they must be idempotent. In test mode the interval is off and `POST /api/test/cron/tick` drives one pass.
```

- [ ] **Step 2: Run the full local gate**

Run: `pnpm check`
Expected: PASS (lint + format:check + deps:check + typecheck + tests).

Run: `pnpm test:e2e:docker`
Expected: PASS.

- [ ] **Step 3: Commit and open the PR**

```bash
git add CLAUDE.md
git commit -m "docs: describe widget server crons"
git push -u origin feat/widget-server-cron
gh pr create --base dev
```

- [ ] **Step 4: Deploy to dev and watch a real midnight**

```bash
rpi deploy --env dev
```

Then confirm on dev: nothing is written on the deploy itself (the first pass only seeds cursors), and after the next real 00:05 Europe/Warsaw the unresolved days of the previous week are closed with `by: 'system'` entries.
