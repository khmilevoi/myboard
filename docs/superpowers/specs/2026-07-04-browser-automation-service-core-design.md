# Browser Automation Service Core Design

**Date:** 2026-07-04
**Status:** Approved
**Parent design:** [Passport Checker and Browser Automation Runtime Design](./2026-07-03-passport-checker-browser-automation-design.md)
**Depends on:** [Widget Browser Contracts and Codegen Design](./2026-07-03-widget-browser-contracts-and-codegen-design.md)

## Goal

Turn `packages/browser-automation` from the lightweight owner of the generated
browser registry into a reusable, executable internal service. The service
validates and dispatches allowlisted widget-owned browser tasks through a single
FIFO lane with deadlines, cancellation, health reporting, and graceful shutdown,
while keeping its core tests decoupled from a real browser through a fake
executor seam.

This subproject builds everything around the generated task definitions _except_
the real browser. Subproject 3 replaces the fake executor with a persistent
Chromium host.

## Scope

This subproject includes:

- promoting `packages/browser-automation` to an executable service package;
- a transport-agnostic service core plus a thin `node:http`/`find-my-way` layer;
- validated internal HTTP request/response envelopes (Zod on both sides);
- registry lookup and single-task dispatch mirroring the widget server;
- a `BrowserExecutor<Context>` context-provider seam and a reusable fake executor;
- a single-lane FIFO queue with queue-wait and execution deadlines, abort-based
  cancellation, and a strict one-task-at-a-time invariant;
- liveness-only `/health` and graceful shutdown;
- a service-owned tagged error taxonomy, safe envelope serialization, and redaction;
- environment-based configuration parsed as errors-as-values;
- focused dispatch, queue, health, shutdown, redaction, and HTTP tests.

It excludes real Playwright launch, persistent contexts, Xvfb/noVNC, Docker and
Compose wiring, production bundling, the main-server browser gateway, the
passport widget, and any passport-specific task, secret, or domain error code.

## Design Decisions

The following decisions were resolved during brainstorming and fix the local
architecture without reopening any master-design boundary.

1. **Context-provider executor seam.** The service owns the entire dispatch
   (registry lookup, payload/result validation, handler invocation, queueing,
   deadlines, error mapping). The injected executor only owns per-task context
   lifecycle. `Context` stays generic; its concrete shape is defined in
   Subproject 3.
2. **In-band 200 envelope.** The task endpoint always responds `HTTP 200` with a
   discriminated `{ ok: true, result } | { ok: false, error }` body. Any
   transport-level failure (non-200, timeout, connection refused) unambiguously
   means the service is unreachable and is mapped to `BrowserUnavailableError` by
   the gateway in Subproject 4. `/health` uses real `200`/`503` status codes.
3. **Service-fixed deadlines.** Queue-wait and execution deadlines come from the
   service's own environment configuration with sane defaults. Callers do not
   pass timing. Per-task tuning is deferred until a later subproject proves a
   need (which would amend the Subproject 1 contract).
4. **Service-owned error taxonomy.** The base `BrowserTaskError` class and the
   service-core error classes live in `packages/browser-automation`. The wire
   contract is the Zod-validated `{ code, message, meta? }` envelope. Subproject 5
   domain errors extend the same base class; the gateway re-maps codes.
5. **Liveness-only `/health`, no session endpoint.** `/health` reports dispatcher
   liveness and readiness only. A session-required task outcome never changes it.
   Manual recovery travels purely in-band through the envelope error's code and
   `publicMeta`. No polling endpoint is added.

## Package Shape and Module Layout

`packages/browser-automation` becomes an executable service. The service core is
transport-agnostic and is tested without HTTP; the HTTP layer is a thin wrapper
mirroring `packages/server/src/app.ts`.

```text
src/
  tasks/registry.ts                       (exists) nested registry + DuplicateWidgetBrowserTaskError
  tasks/widget-browser-list.generated.ts  (exists, empty) generated runtime definitions
  errors.ts        base BrowserTaskError + service-core error classes
  executor.ts      BrowserExecutor<Context> seam (acquire / release / shutdown)
  dispatch.ts      pure single-task dispatch (lookup -> validate -> handler -> validate)
  queue.ts         single FIFO lane, deadlines, cancellation, concurrency=1 invariant
  service.ts       createBrowserService: composes registry + executor + queue + dispatch
  schemas.ts       Zod schemas for request/success/error/health envelopes
  config.ts        environment parsing as errors-as-values
  http/app.ts      node:http + find-my-way routing and serialization
  index.ts         process entrypoint: env -> registry (generated) -> fake executor -> HTTP
  testing/fake-executor.ts  reusable fake executor and helpers
```

Dependencies add `find-my-way`; the package keeps `errore` and `zod`. It imports
**no Playwright and no Reatom**. `index.ts` wires the fake executor in this
subproject — that construction is the single line Subproject 3 replaces with the
Playwright host. The production rspack bundle and Docker image are deferred to
Subproject 3; a `tsx`-based local dev entrypoint is sufficient here.

## Wire Protocol

The service is reachable only on the internal Compose network (Subproject 3) and
has no public route. It exposes two endpoints.

### Task endpoint

`POST /tasks/:widgetId/:taskId` with body `{ payload: unknown }`.

The endpoint always responds `HTTP 200` with a discriminated envelope:

- `{ ok: true, result }` — the validated task result;
- `{ ok: false, error: { code, message, meta? } }` — a safe tagged failure.

The widget and task identifiers ride in the path because they are safe to log;
the sensitive payload rides in the body, which is never logged.

Body handling:

- an unreadable, oversized, or non-JSON body returns `HTTP 400` (a transport-level
  caller bug, not a task result);
- a valid JSON body without `payload` dispatches with `payload = undefined`, so a
  schema mismatch produces the in-band `payload_invalid` error rather than a 400.

All envelopes are validated with Zod schemas in `schemas.ts`, symmetric to
`packages/server/src/storage/schemas.ts`.

### Health endpoint

`GET /health` returns `200 { status: 'ok' }` when the service is ready and
accepting work, and `503` during startup-before-ready and during
graceful-shutdown draining. A Cloudflare challenge or any session-required task
outcome must never flip `/health`, and must never cause a restart loop.

## Service Core: Dispatch and Executor Seam

The executor seam (`executor.ts`) is the only browser-facing boundary:

```ts
type BrowserExecutor<Context> = {
  acquire(signal: AbortSignal): Promise<Error | Context>
  release(context: Context): Promise<void>
  shutdown(): Promise<void>
}
```

Dispatch (`dispatch.ts`) mirrors `packages/server/src/widgets/dispatch.ts` and
runs as flat errors-as-values early returns:

1. Look up `(widgetId, taskId)` in the registry; a miss returns
   `UnknownBrowserTaskError`.
2. `payload.safeParse`; a failure returns `InvalidBrowserPayloadError` with the
   Zod error kept only in the internal cause.
3. `context = await executor.acquire(signal)`; a failure returns
   `BrowserExecutorError` (Subproject 3 refines acquire semantics).
4. `handler(payload, context)` inside a `.catch(...)` boundary; a thrown error
   becomes `BrowserTaskHandlerError`; a returned `Error` value is propagated (see
   Error Model).
5. `result.safeParse`; a failure returns `InvalidBrowserResultError`.
6. `executor.release(context)` runs in a `finally` boundary.

The service owns all of this; `Context` is generic and never inspected by the
core. The fake executor returns a trivial context and, in tests, asserts that it
received the abort `signal`.

## FIFO Queue: Deadlines, Cancellation, Invariant

All tasks for the profile pass through one FIFO lane in `queue.ts`.

- **Concurrency is exactly one.** The first version runs one task at a time to
  avoid profile locking, page interference, excess Raspberry Pi memory, and
  ambiguous cancellation.
- **Two deadlines**, both from configuration:
  - exceeding the queue-wait deadline returns `AutomationTimeoutError` with
    `phase: 'queue'`;
  - exceeding the execution deadline returns `AutomationTimeoutError` with
    `phase: 'execution'`.
- **Cancellation.** The execution deadline drives an `AbortController`; its signal
  is passed to `executor.acquire(signal)`. On timeout the service resolves the
  task immediately as `AutomationTimeoutError`, and the executor is expected to
  tear down the aborted context.
- **Correctness invariant.** Even after a timeout, the lane waits for
  `executor.release`/teardown to settle before starting the next task, so two
  tasks never touch the profile concurrently. This is an explicit test target.

Timeout or executor failure terminates the current task but never triggers an
automatic retry; the caller retries explicitly.

## Error Model and Redaction

The base `BrowserTaskError` lives in `packages/browser-automation` and carries a
stable machine `code`, a safe `publicMessage`, and optional safe `publicMeta`.
The service-core `BrowserTaskError` subclasses (all returned as values) are:

| Class                        | Code                 | Meaning                                                   |
| ---------------------------- | -------------------- | --------------------------------------------------------- |
| `UnknownBrowserTaskError`    | `unknown_task`       | no such `(widgetId, taskId)`                              |
| `InvalidBrowserPayloadError` | `payload_invalid`    | payload failed Zod                                        |
| `InvalidBrowserResultError`  | `result_invalid`     | handler result failed Zod                                 |
| `AutomationTimeoutError`     | `automation_timeout` | queue-wait or execution deadline; `phase` in `publicMeta` |
| `BrowserTaskHandlerError`    | `internal`           | handler threw rather than returned                        |
| `BrowserExecutorError`       | `internal`           | `executor.acquire` failed (refined in SP3)                |

Envelope serialization mirrors the existing server: an error value that is a
`BrowserTaskError` is serialized with its own `code`, `publicMessage`, and
`publicMeta`; any other `Error` is wrapped as a generic `internal` error. Raw
`cause` chains, Zod details, payloads, and results **never** cross the envelope,
are logged only after redaction, and request/response bodies are never logged.

Deferred handler-owned domain errors (`BrowserSessionRequiredError`,
`UpstreamResponseError`, `InvalidCheckerResponseError`, `BrowserConfigurationError`
from Subproject 5) simply extend `BrowserTaskError` and travel the same path with
no special case in the core. `BrowserUnavailableError` is owned by the gateway in
Subproject 4, not by this service.

Service availability is distinct from task failure. `service.invoke(...)` returns
a dedicated `BrowserServiceUnavailableError` when the service is not accepting
work; `http/app.ts` maps it to `HTTP 503` rather than the `200` envelope, so the
gateway treats it as unreachable.

## Health and Graceful Shutdown

`shutdown()` sequences:

1. transition to `draining`, so `/health` reports `503`;
2. reject new invokes as `BrowserServiceUnavailableError` (`503`, not in-band);
3. let the in-flight task finish or hit its deadline;
4. reject still-queued tasks as `BrowserServiceUnavailableError`;
5. call `executor.shutdown()` exactly once;
6. close the HTTP server.

An unexpected executor failure fails the active task and leaves retry control to
the caller; recreating the underlying browser context is a Subproject 3 concern.

## Configuration

Environment configuration (`config.ts`), parsed as errors-as-values with sane
defaults:

- `PORT` — internal service port;
- `BROWSER_QUEUE_WAIT_MS` — queue-wait deadline;
- `BROWSER_TASK_TIMEOUT_MS` — execution deadline.

Invalid configuration fails startup with a redacted log and a non-zero exit code.
No passport or secret configuration is introduced here.

## Testing Strategy

All tests use the fake executor and fake registered tasks; no test launches a
real browser.

### Dispatch and registry

- unknown `(widgetId, taskId)` returns `UnknownBrowserTaskError`;
- invalid payload returns `InvalidBrowserPayloadError`;
- invalid handler result returns `InvalidBrowserResultError`;
- a handler that returns a public `BrowserTaskError` propagates its `code`;
- a handler that throws becomes `internal`;
- a valid task returns `{ ok: true, result }`.

### Queue

- tasks run in FIFO order;
- concurrency is one: the second task does not start until the first has
  released, including after a timeout teardown;
- the queue-wait deadline returns `AutomationTimeoutError{ phase: 'queue' }`;
- the execution deadline returns `AutomationTimeoutError{ phase: 'execution' }`,
  aborts the signal, and awaits release before the next task.

### Health and shutdown

- ready returns `200`; startup-before-ready and draining return `503`;
- a session-required task result leaves `/health` at `200`;
- draining rejects new and queued tasks as unavailable (`503`);
- the in-flight task completes or cancels and `executor.shutdown()` is called once.

### Redaction

- an envelope error carries only `code`, `message`, and `meta`;
- logs never include payloads, results, or raw causes, proven with a spy logger
  and a payload/cause that carries a sentinel secret value.

### HTTP app

- success and error both serialize as `HTTP 200` envelopes;
- unavailable maps to `HTTP 503`;
- path parameters are parsed into `(widgetId, taskId)`;
- an unreadable or non-JSON body returns `HTTP 400`.

### Verification gates

- targeted `browser-automation` package tests and typecheck;
- workspace `pnpm test` and `pnpm typecheck` remain green;
- existing client, server, and codegen behavior is unaffected.

## Success Criteria

- The service executes fake registered tasks sequentially through one FIFO lane.
- Both sides of every task are validated with Zod.
- Every failure surfaces as a stable machine code with a safe public message and
  no sensitive detail.
- Queue-wait and execution deadlines return typed timeouts and cancel through the
  abort signal, preserving the one-task-at-a-time invariant.
- `/health` reports liveness only and is never degraded by a session-required
  outcome or a challenge.
- Graceful shutdown drains the in-flight task, rejects the rest as unavailable,
  and shuts the executor down once.
- The fake executor is the only browser boundary, and `index.ts` swaps to the
  real host in a single construction site.

## Deferred Work

Subproject 3 supplies the concrete `Context`, the persistent Chromium host under
Xvfb, the x11vnc/noVNC recovery surface, the pinned Playwright Docker image, the
profile volume, and Compose wiring. Subproject 4 adds the main-server
`WidgetServerContext.api.browser` gateway and `BrowserUnavailableError`.
Subproject 5 adds the passport task, its scoped secrets, and its domain error
codes. None of those responsibilities are pulled into this service-core change.
