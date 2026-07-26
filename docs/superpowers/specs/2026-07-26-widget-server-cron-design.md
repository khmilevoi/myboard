# Widget server cron — design

Date: 2026-07-26
Status: approved (revised after merging `dev`)

## Problem

A widget's server side only ever reacts to a client request. `packages/widgets/*/server.ts` exposes
`schemas` + `handlers`, and the only way into a handler is `POST /api/widgets/:typeId/:event`,
dispatched from a mounted widget in a live browser tab. Nothing on the server runs on its own
schedule.

The driving case is the Ofelia poop-duty widget. A duty day is only "resolved" when somebody
presses a button and a `cleaned` / `went_into_debt` / `forgiven` record lands in the ledger. If
nobody opens the board that day, the day stays unresolved forever. We want the server to close such
days by itself shortly after midnight.

## Goals

- Widgets declare scheduled server-side jobs in `server.ts`, next to `schemas` and `handlers`.
- Jobs survive server restarts: a missed occurrence is caught up once, not skipped and not replayed
  per missed tick.
- The scheduler runs on the injected clock, so e2e can drive it deterministically instead of waiting
  for a real midnight.
- Ofelia auto-approves unresolved past days as the first consumer, and those records are visibly
  server-authored rather than silently anonymous.

## Non-goals

- User-configurable schedules (schedules are code, not data).
- Per-widget-instance crons. Jobs are per widget *type*.
- Distributed locking / multi-replica coordination.
- Any UI for cron observability (last run, failures).

## Already in place on `dev`

This spec was first written against an older `dev`. Three things it treated as work have since
landed and are now assumed, not planned:

- **Node 26 everywhere.** Images are `node:26-alpine` / `node:26-bookworm-slim`, `.nvmrc` is `26`,
  the root `engines.node` is `>=26`, `@types/node` is `^26.1.1`, `packages/server/tsconfig.json`
  already has `lib: ["ES2022", "ESNext"]`, and no Vitest config passes `--harmony-temporal` any
  more. `Temporal` is therefore an unflagged global in server code and in the domain modules below.
- **`packages/widgets/*/domain/`** exists as dependency-free code shared by a widget's `model/` and
  its `server.ts`, with an `.oxlintrc.json` override enforcing an import allowlist (`zod`,
  `@shared/*`, `./` siblings) plus a stricter one for domain tests.
- **Ofelia already has a `server.ts`.** Its ledger and comment writes go through widget server
  events, so `packages/server/src/widgets/widget-server-list.generated.ts` is non-empty and the
  "rspack bundles `@widgets/...`" path is proven in production. Draft construction already lives in
  `domain/drafts.ts` (`makeCleanDraft` and friends over a `DraftInput`), and authorship is
  `createdBy: { accountId, name } | null` stamped from `WidgetServerContext.viewer`; the old
  `by: Person` field is legacy and read-only, and `ip` is gone from the ledger entirely.

What remains is the scheduler itself, plus the auto-approve job on top of the existing Ofelia
domain.

## Architecture

### Contract

`packages/shared/widgets/contracts.ts` gains an optional `crons` field. `schemas` and `handlers`
stay required — Ofelia already has both, so there is no cron-only widget to design for.

```ts
export type WidgetCronContext = {
  typeId: string
  now: () => number
  /**
   * The scheduled moment this run stands for, in epoch ms. When a missed
   * occurrence is caught up this is the occurrence, not the wall clock.
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

export type WidgetServerDefinition<Schemas extends WidgetEventSchemas> = {
  schemas: Schemas
  handlers: { /* unchanged */ }
  crons?: Record<string, WidgetCronJob>
}
```

`WidgetCronContext` is deliberately **not** `WidgetServerContext`:

- **No `viewer`.** A background run has no caller, so there is no session to stamp an author from.
  A cron that writes an authored record supplies the author itself (see the system author below).
- **No instance scope and no `instanceId`.** The widget may sit on the board three times or zero
  times; a type-level job does not depend on that, and handing it an `instance` scope would mean
  inventing an `instanceId` to write under. A job that genuinely needs to walk instances does it
  through `storage.shared.keys()`.
- **`scheduledFor` separate from `now()`.** After a catch-up the wall clock (10:00, right after a
  deploy) is not the scheduled moment (00:05). Handlers want the second one; `now()` stays for
  timestamps.

`run` returns `Error | void` in the errore style. The scheduler also catches throws and treats them
as returned errors.

### Scheduler

New flat modules in `packages/server/src/widgets/` — `cron-state.ts` and `cron-scheduler.ts`, not a
`cron/` subfolder, because `.oxlintrc.json` bans `../../` imports and a subfolder would need them
to reach `../../storage/valkey`.

`makeCronScheduler({ registry, ops, browserClient, now, intervalMs })` returns
`{ tick, start, stop }`, is constructed in `createApp` and stopped in `close()`.

New server dependency: `croner` (no transitive dependencies), used purely as a calculator —
`new Cron(job.schedule, { timezone: job.timeZone })` with no callback (croner spells the option
`timezone`; the widget-facing field is `timeZone`), then `nextRun(fromDate)`, which returns the
first occurrence strictly after `fromDate`. Croner never owns a timer here; the tick loop does, and
it reads the injected clock.

**State.** Valkey key `cron:<typeId>:<jobName>`, value `{ cursorMs, failures }`. `cursorMs` is the
moment up to which the job counts as handled. The key sits in its own root namespace rather than
under `w:t:`, so it stays out of widget storage listings and SSE fanout. Per the storage-key
contract in CLAUDE.md, this shape is fixed from day one.

**Tick pass** (every 30s by default — lateness is bounded by the interval). Jobs are processed
independently; one failing job must not abort the pass for the others.

1. No cursor stored: write `cursorMs = now()` and **do not run**. Otherwise deploying at 15:00 would
   immediately auto-approve the current day. The first real run is the next occurrence.
2. Compute `nextRun(cursorMs)`. Because it is strictly exclusive, an occurrence already recorded in
   the cursor never fires twice. If the result is in the future (or `null`), stop.
3. Collapse missed occurrences: walk forward while occurrences are `<= now()` and keep the last.
   Three missed midnights produce one run whose `scheduledFor` is the most recent of them. The walk
   is capped at 1000 steps to bound work for minute-level schedules after a long outage.
4. Run `run(context)` with that `scheduledFor`. If the same job is still running from a previous
   tick, skip it — a job never overlaps itself.
5. On success: `cursorMs = scheduledFor`, `failures = 0`.

**Failures.** A returned `Error` (or a caught throw) is logged, `failures` is incremented, and the
cursor is **not** advanced, so the next tick retries 30 seconds later. After 5 consecutive failures
the cursor advances anyway with a loud log and `failures` resets. A blinking Valkey should not cost
a whole day; a job with a permanent bug should not hammer every 30 seconds forever.

**No distributed lock.** The server runs as a single replica. The real protection against a double
run is handler idempotency, which catch-up semantics require regardless. If a second replica ever
appears, a `SET NX PX` guard is a local addition.

### Wiring

**Codegen needs no changes.** `scripts/codegen/server.ts` imports the whole default export of
`@widgets/<dir>/server` and wraps it with `toRuntimeWidgetServerDefinition`; `crons` rides along.

**Schedule validation lives in `createWidgetServerRegistry`**, not in the scheduler. It already
returns `DuplicateWidgetTypeError | WidgetServerRegistry`; it gains `InvalidCronScheduleError`.
`production-registry.ts` then fails at import exactly as it already does for a duplicate `typeId`,
`createApp` receives an already-valid registry, and its signature does not change. The scheduler
constructs its own `Cron` objects, which keeps `croner` inside `packages/server` —
`@shared/widgets/contracts` stays zod-only.

**`createApp`** builds the scheduler from `deps.widgetRegistry` and starts it. `close()` stops the
timer and awaits an in-flight pass, otherwise integration tests leak handles. `AppDeps` gains an
optional `cron?: { intervalMs?: number }`.

**Test mode.** When `testControls` are present, the automatic interval is **not** started and
`POST /api/test/cron/tick` is registered next to `/api/test/time` and `/api/test/reset`. It responds
after the pass completes, so e2e exercises the real scheduler deterministically instead of sleeping
or calling handlers behind its back.

**Errors** follow errore, in `packages/server/src/widgets/errors.ts`: `InvalidCronScheduleError`
(startup) and `WidgetCronRunError` (wraps a handler failure for logging). Neither is part of
`PublicWidgetDispatchError` — a cron run has no HTTP response.

## Ofelia: the auto-approve job

### A system author

Records currently carry `createdBy: { accountId, name } | null`, and `resolveEntryAuthor` maps
`null` to `{ kind: 'unknown' }`, which the UI renders as «автор неизвестен» with a `?` avatar. A
cron-written record must not land there: an auto-closed day would be indistinguishable from a
pre-accounts orphan record, and the whole point is that a reader can tell nobody actually pressed
the button.

So `createdBy` widens to a union and gains a system arm:

```ts
export const CreatedBySchema = z.object({ accountId: z.string(), name: z.string() })
export const SystemCreatedBySchema = z.object({ system: z.literal(true) })
export const EntryCreatedBySchema = z.union([CreatedBySchema, SystemCreatedBySchema])
```

Backward compatible: every stored record matches the account arm exactly as before, so there is no
migration and the `ledger` key is untouched. A plain `z.union` rather than a
`z.discriminatedUnion` because the account shape is already persisted without a discriminator field
and adding a required one would invalidate every existing record.

`EntryAuthor` gains `{ kind: 'system' }`, checked before the account branch in
`resolveEntryAuthor`. `MemberAvatar` renders it with its own `data-kind="system"` mark, and the
history signature reads «закрыто автоматически» instead of «отметил(а) …».

### The `autoApproveDay` job

Schedule `5 0 * * *`, time zone `DUTY_TIME_ZONE` (`Europe/Warsaw`) — a few minutes past midnight,
clear of the day boundary and of DST shifts.

Let `D` be the Warsaw calendar date of `scheduledFor`. The job inspects the seven dates `D-7 … D-1`
inclusive; today (`D`) is never touched because it is not over. The window is bounded on purpose:
without it the first deploy would retroactively close every unresolved day back to the start of the
ledger, and days older than a week are not worth repairing.

A date counts as handled only when its latest outcome **closed** it. A deliberate `reset` leaves the
day open, and silence still means "cleaned", so a reset day is re-closed.

For every remaining date the job reuses the existing `makeCleanDraft` from `domain/drafts.ts` with
`createdBy: { system: true }` — the same builder the `clean` event handler uses, so the manual and
automatic paths cannot drift apart. Before writing, the job re-reads the ledger and derives the
drafts from that fresh read; catch-up and retry correctness depend on it.

**Debts are not settled by auto-approval**, which is worth stating because it is not obvious.
`getDebtDays` hands out debt days forward from "today", so a past date carries no debt assignment
and `makeCleanDraft` falls back to the planned rotation for it: the entry names the planned duty
person, carries no `onBehalfOf`, and `foldDebt` ignores it for debt purposes. That is correct —
nobody worked off anybody's debt, and the debt simply moves to the next free future day, exactly
what the UI already draws.

## Testing

- **Scheduler unit tests** (fake `ops`, fake `now`) — the core of the feature: first sight writes a
  cursor and does not fire; a due occurrence fires once; three missed midnights collapse into one
  run carrying the last of them; an error keeps the cursor and retries; the fifth consecutive
  failure advances it; a job already running is not started again.
- **Domain unit tests** over a ledger fixture: unresolved days inside the window are closed, closed
  days are skipped, a `reset` day is re-closed, today is untouched, the window boundary holds, a
  repeat run adds nothing, debts are unchanged.
- **Registry unit test**: an invalid cron expression or unknown time zone yields
  `InvalidCronScheduleError`.
- **Widget server test**: the cron `run` against a fake `WidgetCronContext`, in the style
  `packages/widgets/ofelia-poop-duty/server.test.ts` already uses for the event handlers.
- **Server integration test**: the real scheduler over the real Ofelia definition with in-memory
  ops, clock moved forward, ledger inspected.
- **Client tests**: the system author renders as its own thing, not as «автор неизвестен».
- **E2E**: Ofelia on the board, clock set past the next 00:05, one tick through
  `POST /api/test/cron/tick`, and the board updates **without a reload**. This is the only check
  that proves a server-side `append` reaches a live client through SSE fanout.
- Gate before the PR: `pnpm check` and `pnpm test:e2e:docker`.

## Rollout

The risk this spec originally carried — Ofelia being the first widget with a `server.ts`, so the
rspack `@widgets` path and the `codegen:server` Docker step had never run against real content — is
retired: `dev` already ships that path.

Deploy to dev (`pnpm run deploy:dev`), confirm nothing is written by the deploy itself (the first
pass only seeds cursors), and watch one real 00:05 Europe/Warsaw before opening the PR from `dev`
into `main`.
