# Widget server cron — design

Date: 2026-07-26
Status: approved

## Problem

A widget's server side can only react to a client request. `defineWidgetServer` exposes
`schemas` + `handlers`, and the only way into a handler is `POST /api/widgets/:typeId/:event`,
dispatched from a mounted widget in a live browser tab. Nothing on the server runs on its own
schedule.

The driving case is the Ofelia poop-duty widget. A duty day is only "resolved" when somebody
presses a button and a `cleaned` / `went_into_debt` / `forgiven` entry lands in the ledger. If
nobody opens the board that day, the day stays unresolved forever. We want the server to close
such days by itself shortly after midnight.

## Goals

- Widgets declare scheduled server-side jobs in `server.ts`, next to `schemas` and `handlers`.
- Jobs survive server restarts: a missed occurrence is caught up once, not skipped and not
  replayed per missed tick.
- The scheduler runs on the injected clock, so e2e can drive it deterministically instead of
  waiting for a real midnight.
- Ofelia auto-approves unresolved past days as the first real consumer.
- Domain logic shared between the widget's client model and its server code lives in one place
  and pulls in neither Reatom nor server-only dependencies.

## Non-goals

- User-configurable schedules (schedules are code, not data).
- Per-widget-instance crons. Jobs are per widget *type*.
- Distributed locking / multi-replica coordination.
- Any UI for cron observability (last run, failures).

## Prerequisite: align Node on 26

Node versions are currently split: Docker images run Node 22, local development runs 24, and the
`@types/node` catalog entry is `^25.9.3` — types ahead of every runtime. Everything moves to 26.

Node 26 ships `Temporal` natively (verified: `node:26-alpine` → `typeof Temporal === 'object'`,
V8 14.6), and TypeScript 7 already ships `lib.esnext.temporal.d.ts` via `lib: ["ESNext"]`. That
removes the reason to rewrite Ofelia's date logic away from `Temporal` when it moves to shared
code.

Node 26 is Current, not LTS — it becomes LTS in October 2026. Accepted knowingly.

Changes:

- `packages/server/Dockerfile` (3 stages), `packages/client/Dockerfile` (2 stages),
  `packages/browser-automation/Dockerfile` (2 alpine stages + `node:22-bookworm-slim` runtime)
  → `node:26-alpine` / `node:26-bookworm-slim`.
- `docker-compose.dev.yml`: 4 services on `node:22-alpine` → `node:26-alpine`.
- Catalog `@types/node`: `^25.9.3` → `^26` (latest published: 26.1.1).
- Add `.nvmrc` (`26`) and `engines.node` in the root `package.json` so the split cannot silently
  return.
- `packages/server/tsconfig.json`: `lib: ["ES2022"]` → include `ESNext`, otherwise `Temporal`
  has no global types in server code.
- Drop `execArgv: ['--harmony-temporal']` from the three vitest configs that carry it
  (`packages/widget-runtime/vitest.config.ts`, `packages/client/vite.config.ts`,
  `packages/widget-sdk/src/vite/widget-vite-config.ts`). Node 26 ships Temporal unflagged; the flag
  is still accepted (verified on `node:26-alpine`) but is now a no-op that would break silently if
  V8 ever drops it.

  The `vm.runInThisContext('Temporal')` shims in `packages/client/src/vitest.setup.ts`,
  `packages/widget-runtime/vitest.setup.ts` and `packages/widget-sdk/src/test/widget-setup.ts`
  **stay**. jsdom is a separate realm and does not inherit Node's global `Temporal`; the shim is
  what copies it across, and that is still true on 26.

The one image that can actually break is `browser-automation`: it installs Playwright with system
dependencies on `bookworm-slim`. It must be built and exercised explicitly, not assumed free.

## Architecture

### Contract

`packages/shared/widgets/contracts.ts` grows an optional `crons` field. `schemas` and `handlers`
become optional too, so a cron-only widget does not carry two empty objects;
`toRuntimeWidgetServerDefinition` normalizes all three to `{}` and
`RuntimeWidgetServerDefinition` keeps them required, so consumers never check for `undefined`.

```ts
export type WidgetCronJob = {
  /** Cron expression, 5 or 6 fields (croner syntax). */
  schedule: string
  /** IANA time zone the expression is evaluated in. */
  timeZone: string
  run: (context: WidgetCronContext) => Awaitable<Error | void>
}

export type WidgetCronContext = {
  typeId: string
  now: () => number
  /** The scheduled moment this run stands for (epoch ms). */
  scheduledFor: number
  api: {
    storage: { shared: WidgetServerStorage }
    browser: WidgetServerBrowserApi
  }
}

// The generic gets a default so a cron-only definition, which offers no inference site for
// `Schemas`, still resolves to an empty event map instead of the full `WidgetEventSchemas`.
export type WidgetServerDefinition<Schemas extends WidgetEventSchemas = {}> = {
  schemas?: Schemas
  handlers?: { /* unchanged */ }
  crons?: Record<string, WidgetCronJob>
}
```

Three decisions are baked into `WidgetCronContext`:

- **No instance scope and no `instanceId`.** A background run has no instance: the widget may sit
  on the board three times or zero times, and a type-level job does not depend on that. Handing it
  an `instance` storage scope would mean inventing an `instanceId` to write under. A job that
  genuinely needs to walk instances does it honestly through `storage.shared.keys()`.
- **`scheduledFor` is separate from `now()`.** When a missed occurrence is caught up, the wall
  clock (10:00, right after a deploy) is not the scheduled moment (00:05). Handlers almost always
  want the second one; `now()` stays for timestamps written into records.
- **No `ip`.** Server-side `append` records `ip: null` for cron runs, which widens Ofelia's ledger
  schema (see below).

`run` returns `Error | void` in the errore style and does not throw. The scheduler catches throws
anyway and treats them as returned errors.

### Scheduler

New module under `packages/server/src/widgets/cron/`, built by
`makeCronScheduler({ registry, ops, browserClient, now, intervalMs })` and returning
`{ tick, start, stop }`. It is constructed in `createApp` and stopped in `close()`.

New server dependency: `croner` (no transitive dependencies). It is used purely as a calculator —
`new Cron(job.schedule, { timezone: job.timeZone })` without a callback (note croner spells the
option `timezone`; the widget-facing field is `timeZone`), then `nextRun(fromDate)`, which returns
the first occurrence strictly after `fromDate`. Croner never owns a timer here; the tick loop does,
and it reads the injected clock.

**State.** Valkey key `cron:<typeId>:<jobName>`, value `{ cursorMs, failures }`. `cursorMs` is the
moment up to which the job counts as handled. The key deliberately lives in its own root namespace
rather than under `w:t:`, so it stays out of widget storage listings and SSE fanout. Per the
storage-key contract in CLAUDE.md, this shape is fixed from day one.

**Tick pass** (every 30s by default — lateness is bounded by the interval). Each job is processed
independently; one failing job must not abort the pass for the others.

1. No cursor stored: write `cursorMs = now()` and **do not run**. Otherwise deploying at 15:00
   would immediately auto-approve the current day. The first real run is the next occurrence.
2. Compute `nextRun(cursorMs)`. Because `nextRun` is strictly exclusive, an occurrence already
   recorded in the cursor never fires twice. If the result is in the future (or `null`), stop.
3. Collapse missed occurrences: walk forward while occurrences are `<= now()` and keep the last
   one. Three missed midnights produce one run whose `scheduledFor` is the most recent of them.
   The walk is capped at 1000 iterations to bound work for minute-level schedules after a long
   outage; hitting the cap logs and uses the last occurrence reached.
4. Run `run(context)` with that `scheduledFor`. If the same job is still running from a previous
   tick, skip it — a job never overlaps itself.
5. On success: `cursorMs = scheduledFor`, `failures = 0`.

**Failures.** A returned `Error` (or a caught throw) is logged, `failures` is incremented, and the
cursor is **not** advanced, so the next tick retries 30 seconds later. After 5 consecutive failures
the cursor advances anyway with a loud log and `failures` resets to 0. A blinking Valkey should not
cost a whole day; a job with a permanent bug should not hammer every 30 seconds forever.

**No distributed lock.** The server runs as a single replica. The real protection against a double
run is handler idempotency, which catch-up semantics require regardless. If a second replica ever
appears, a `SET NX PX` guard is a local addition.

### Wiring

**Codegen needs no changes.** `scripts/codegen/server.ts` imports the whole default export of
`@widgets/<dir>/server` and wraps it with `toRuntimeWidgetServerDefinition`; `crons` rides along.
The only observable change is that Ofelia gains a `server.ts`, so the generated list stops being
empty for the first time.

**Schedule validation lives in `createWidgetServerRegistry`**, not in the scheduler. It already
returns `DuplicateWidgetTypeError | WidgetServerRegistry`; it gains `InvalidCronScheduleError`.
`production-registry.ts` then fails at import exactly as it already does for a duplicate `typeId`,
`createApp` receives an already-valid registry, and its signature does not change. The scheduler
constructs its own `Cron` objects, which keeps `croner` inside `packages/server` —
`@shared/widgets/contracts` stays zod-only.

**`createApp`** builds the scheduler from `deps.widgetRegistry` and starts it. `close()` stops the
timer and awaits an in-flight pass, otherwise integration tests leak handles. `AppDeps` gains an
optional `cron?: { intervalMs?: number }`.

**Test mode.** When `testControls` are present (`ALLOW_TEST_DB_RESET=1`), the automatic interval is
**not** started, and `POST /api/test/cron/tick` is registered next to `/api/test/time` and
`/api/test/reset`. It responds after the pass completes. E2E then exercises the real scheduler
deterministically instead of sleeping or calling handlers behind its back.

**Errors** follow errore, in `packages/server/src/widgets/errors.ts`: `InvalidCronScheduleError`
(startup) and `WidgetCronRunError` (wraps a handler failure for logging, carrying `typeId`, job
name and `scheduledFor`). Neither is part of `PublicWidgetDispatchError` — a cron run has no HTTP
response.

## Ofelia: shared domain and auto-approve

### Shared domain module

New `packages/widgets/ofelia-poop-duty/domain/`. Moved out of `model/ofelia-duty.ts`:

- ledger schemas and types (`LedgerEntrySchema`, `LedgerEntriesSchema`, `LedgerType`, `Person`);
- constants (`DUTY_ROTATION`, `BASE_DUTY_DATE`, `DUTY_TIME_ZONE`, `LEDGER_KEY`);
- pure functions: `latestOutcomesByDate`, `resolveDays`, `foldDebt`, `normalizeDebts`,
  `getOfeliaDutyByDate`, `getDebtDays`, `effectiveDuty`, `isDebtDay`, `weekStartISO`,
  `otherPerson`, `isOverDebtWarning`.

`model/ofelia-duty.ts` keeps only the Reatom model.

The module boundary is dictated by the server build, and the constraint is hard:

- The runtime image runs `pnpm install --filter server --prod`, so **none** of the widget's own
  dependencies exist there. The domain module may only import what `packages/server` depends on —
  in practice `zod` — plus the `Temporal` global.
- rspack externalizes every request that does not start with `.`, `@shared` or `@widgets`, so the
  widget's `@/` alias must not appear in `domain/**` or `server.ts`; those files use relative
  imports (`./domain/ledger`). Client-side `model/` and `ui/` keep using `@/domain/...` exactly as
  they use `@/model/...` today.

Enforced with an `overrides` entry in `.oxlintrc.json` for `packages/widgets/*/domain/**`, banning
`@reatom/*`, `react`, `react-dom`, `widget-runtime`, `widget-sdk` and `@/` via
`no-restricted-imports`. `pnpm deps:check` is syncpack — it checks versions, not boundaries.

`BASE_DUTY_DATE` stops being a `Temporal.PlainDate` evaluated at module load and becomes an ISO
string; `Temporal` is only touched inside function bodies. The module is then safe to import
anywhere, including places where the browser polyfill has not been installed yet.

### Shared draft construction

`confirmClean` currently builds the ledger draft inside the Reatom action — which is exactly what
the cron has to reproduce. That construction moves into the domain module as a pure function;
`confirmClean` calls it, and the cron calls it with `by: 'system'`. One source of truth instead of
two similar blocks.

### The `autoApproveDay` job

Schedule `5 0 * * *`, time zone `Europe/Warsaw` — a few minutes past midnight, to keep clear of the
day boundary and of DST shifts.

Let `D` be the Warsaw calendar date of `scheduledFor` (not of `now()`). The job inspects the seven
dates `D-7 … D-1` inclusive. Today (`D`) is never touched — it is not over. The window is bounded on purpose: without
it the first deploy would retroactively close every unresolved day back to 16 June, and days older
than a week are not worth repairing anyway.

For every unresolved date in the window it appends
`{ type: 'cleaned', actor: getOfeliaDutyByDate(date), by: 'system' }`. Before writing, it re-reads
the ledger and skips dates that already have an outcome; catch-up and retry correctness depend on
that check.

**Debts are not settled by auto-approval**, and this is worth stating because it is not obvious.
`getDebtDays` hands out debt days forward from "today", so a past date no longer carries a debt
assignment and `effectiveDuty` collapses to the planned rotation for it. The entry therefore names
the planned duty person, carries no `onBehalfOf`, and `foldDebt` ignores it for debt purposes. That
is correct: nobody worked off anybody's debt, and the debt simply moves to the next free future day
— exactly what the UI already draws.

### Ledger schema and UI

`LedgerEntrySchema` widens `by` to `Person | 'system'` and `ip` to `string | null`. Both are
backward compatible: existing entries stay valid, no migration, the `ledger` key is unchanged.

`HistoryEntryView.by` widens to `Person | 'system'` and `ipTail` to `string | null`.

`HistoryList` today renders `actor`, a badge and the IP tail, and never renders `by`. A system
entry would therefore differ from a manual one only by a missing IP chip, which reads as a bug. So
the same slot that holds the IP tail shows an `авто` marker for system entries.

## Testing

- **Scheduler unit tests** (fake `ops`, fake `now`) — the core of the feature: first sight writes a
  cursor and does not fire; a due occurrence fires once; three missed midnights collapse into one
  run carrying the last of them; an error keeps the cursor and retries on the next tick; the fifth
  consecutive failure advances it; a job already running is not started again.
- **Domain unit tests** over a ledger fixture: unresolved days inside the window are closed,
  resolved days are skipped, today is untouched, the window boundary holds, a repeat run adds
  nothing, debts are unchanged.
- **Registry unit test**: an invalid cron expression yields `InvalidCronScheduleError`.
- **Server integration test**: a real app with the Ofelia registry and in-memory ops, clock moved
  forward, `POST /api/test/cron/tick` → system entries appear under `ledger`; a second tick adds
  nothing.
- **Client tests** updated for the moved imports and for the `авто` marker.
- **E2E** (`packages/client/e2e`): Ofelia on the board, clock set to 00:05 of the next day, one
  tick, and the week strip plus history update **without a reload**. This is the only check that
  proves the server-side `append` reaches the client through SSE fanout.
- Gate before the PR: `pnpm check` and `pnpm test:e2e:docker`.

## Rollout

Ofelia becomes the first widget with a `server.ts` at all. The generated list is empty today, which
means the "rspack pulls `@widgets/...` into the bundle" path and the `codegen:server` step of the
Docker build have never actually run against real content. So: build and boot the server image with
the widget bundled first, then `rpi deploy --env dev`, live through one real midnight on dev, and
only then open the PR into `main`.

Nothing happens retroactively on deploy day — the first pass only writes cursors.
