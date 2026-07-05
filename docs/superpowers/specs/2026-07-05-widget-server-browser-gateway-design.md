# Widget Server Browser Gateway Design

**Date:** 2026-07-05

**Master design:** [Passport Checker and Browser Automation Runtime Design](./2026-07-03-passport-checker-browser-automation-design.md)

**Subproject:** 4 — Widget server browser gateway

## Goal

Give every widget server handler a typed, widget-scoped, error-as-value API for
invoking that widget's allowlisted browser tasks through the internal browser
automation service.

The main server must remain healthy when browser automation is absent. Browser
task contracts stay owned by their widget packages, while transport and context
plumbing remain reusable infrastructure.

## Scope

This subproject includes:

- widget-owned browser task descriptors with inferred payload and result types;
- a shared browser automation wire protocol used by both processes;
- `WidgetServerContext.api.browser` as an always-present capability;
- an internal HTTP client with a single server-owned deadline;
- automatic scoping from the current widget `typeId` to the remote `widgetId`;
- result-schema validation at the main-server boundary;
- safe tagged transport, deadline, protocol, and remote-task errors;
- fake clients and integration tests through normal widget RPC dispatch;
- production and development Compose configuration without a browser startup
  dependency.

This subproject excludes:

- Passport Checker task implementation and its widget package;
- Playwright handlers, browser lifecycle, secrets, and profile management;
- client-side RPC, Reatom models, React UI, or end-to-end browser tests;
- automatic retries and per-task timeout overrides;
- compile-time prevention of importing another widget's task descriptor.

## Approved Decisions

1. Browser task contracts are explicit descriptors passed to `invoke`; the
   gateway does not use a generated global type map.
2. Concrete descriptors live in `packages/widgets/<widget>/browser-tasks.ts`.
   Shared code owns only descriptor factories, types, and protocol machinery.
3. `context.api.browser` always exists. An unavailable browser service produces
   an error value rather than an optional capability.
4. The server owns one configurable request deadline. Widget handlers cannot
   override it in this subproject.
5. The gateway distinguishes local transport/deadline/protocol errors from a
   valid remote task rejection.
6. No automatic retry occurs because a remote task may have performed an
   externally visible action before the connection failed.
7. `pnpm check` is the final local verification gate. Targeted package tests may
   be used during development but do not replace or duplicate that gate.

## Ownership and Package Boundaries

### Widget-owned task contracts

A browser-backed widget will use this shape:

```text
packages/widgets/passport-checker/
├─ browser-tasks.ts   # task IDs and payload/result schemas
├─ browser.ts         # Playwright handlers
├─ server.ts          # widget RPC handlers
├─ client.ts
└─ types.ts
```

`browser-tasks.ts` is a neutral module. It may import Zod schemas, widget-local
types, and shared browser contract helpers. It must not import React,
Playwright, browser runtime context, server runtime internals, or client-only
modules.

The separate file prevents `server.ts` from importing `browser.ts`. Importing
the executable browser entry point into the main server would break build
isolation and could pull Playwright and secret-reading code into the wrong
bundle.

Subproject 4 does not create `passport-checker`; it proves this ownership model
with test-local descriptors. Subproject 5 creates the first production
`browser-tasks.ts` file.

### Shared infrastructure

Proposed shared files:

```text
packages/shared/
├─ browser-automation/
│  ├─ protocol.ts
│  └─ protocol.test.ts
└─ widgets/
   ├─ browser-contracts.ts
   ├─ browser-errors.ts
   └─ contracts.ts
```

- `browser-automation/protocol.ts` is the sole definition of request, success,
  error, and health envelope schemas.
- `widgets/browser-contracts.ts` owns task descriptor factories and the
  `WidgetServerBrowserApi` type.
- `widgets/browser-errors.ts` owns the public tagged errors returned to widget
  server handlers.
- `widgets/contracts.ts` exposes the required `api.browser` capability on
  `WidgetServerContext`.

The existing `packages/browser-automation/src/schemas.ts` re-exports or imports
the shared wire schemas so existing browser-service modules do not retain a
second protocol definition.

### Main-server infrastructure

```text
packages/server/src/
├─ browser/
│  ├─ client.ts
│  ├─ http-client.ts
│  ├─ http-client.test.ts
│  ├─ widget-api.ts
│  ├─ widget-api.test.ts
│  ├─ config.ts
│  ├─ config.test.ts
│  └─ testing/
│     └─ fake-client.ts
├─ widgets/
│  ├─ api.ts
│  ├─ api.test.ts
│  ├─ storage.ts
│  ├─ storage.test.ts
│  ├─ dispatch.ts
│  └─ dispatch.test.ts
├─ app.ts
├─ app.test.ts
└─ index.ts
```

- `browser/client.ts` defines the low-level dependency-injection seam.
- `browser/http-client.ts` implements fetch, deadline handling, envelope
  validation, and error conversion.
- `browser/widget-api.ts` binds a low-level client to one widget `typeId`,
  accepts descriptors, and validates results.
- `browser/config.ts` parses browser gateway configuration.
- `browser/testing/fake-client.ts` records calls and returns programmed results.
- `widgets/api.ts` composes storage scopes and the scoped browser API into the
  complete `WidgetServerContext.api`.
- `widgets/storage.ts` remains responsible only for widget storage scopes.
- `widgets/dispatch.ts`, `app.ts`, and `index.ts` receive or construct the
  browser client through dependency injection.

## Task Descriptor API

Shared code adds a factory with literal key preservation:

```ts
export const passportBrowserTasks = defineWidgetBrowserTasks({
  check: {
    payload: z.object({}),
    result: PassportCheckResultSchema,
  },
})
```

The returned `passportBrowserTasks.check` contains:

- `id: 'check'` as a literal type;
- the payload schema;
- the result schema.

The enriched descriptor map remains structurally compatible with the existing
`WidgetBrowserTaskSchemas`, so it can be passed directly to
`defineWidgetBrowser`:

```ts
export default defineWidgetBrowser<BrowserTaskContext>()({
  schemas: passportBrowserTasks,
  handlers: {
    async check(payload, context) {
      // Implemented in Subproject 5.
    },
  },
})
```

The widget server handler uses the same descriptor:

```ts
const result = await context.api.browser.invoke(
  passportBrowserTasks.check,
  {},
)
if (result instanceof Error) return result

return result
```

`invoke` infers its payload from `z.input` of the payload schema and its success
value from `z.output` of the result schema. Its failure type is the shared
browser gateway error union.

Descriptors intentionally do not contain `widgetId`. The widget directory name
remains canonical, and the main server injects its current `typeId`. TypeScript
can technically import another widget's descriptor, but doing so cannot cross
the runtime boundary: the task is still requested under the current widget ID.
Making descriptor ownership a compile-time brand would require a generic
`WidgetServerContext<WidgetId>` across registry and dispatch for little
practical benefit, so it is deferred.

## Low-Level Client and Scoped API

The low-level `BrowserAutomationClient` accepts transport-oriented arguments:

```ts
type BrowserAutomationClient = {
  invoke(args: {
    widgetId: string
    taskId: string
    payload: unknown
  }): Promise<BrowserGatewayError | { result: unknown }>
}
```

The explicit success wrapper is required because `Error | unknown` collapses to
`unknown` and prevents `instanceof Error` narrowing. It also mirrors the wire
success envelope without exposing transport details to the scoped API.

The scoped widget API closes over `typeId` and exposes only descriptor-oriented
invocation:

```ts
type WidgetServerBrowserApi = {
  invoke<PayloadSchema extends z.ZodType, ResultSchema extends z.ZodType>(
    task: WidgetBrowserTaskDescriptor<PayloadSchema, ResultSchema>,
    payload: z.input<PayloadSchema>,
  ): Promise<BrowserGatewayError | z.output<ResultSchema>>
}
```

The scoped API performs result validation after the low-level client returns a
successful envelope. Payload validation remains authoritative in the browser
service, which already validates against the same schema before execution.

## Shared Wire Protocol

The existing wire shape remains stable:

```ts
type TaskRequest = { payload?: unknown }

type TaskResponse =
  | { ok: true; result: unknown }
  | {
      ok: false
      error: {
        code: string
        message: string
        meta?: Record<string, unknown>
      }
    }
```

The browser service and gateway import the same Zod schemas. Moving the schemas
to shared code is a protocol extraction, not a wire-format change.

## Invocation Flow

1. A widget handler calls `context.api.browser.invoke(descriptor, payload)`.
2. The scoped API supplies the current widget `typeId` as `widgetId` and the
   descriptor's literal `id` as `taskId`.
3. The HTTP client sends `POST /tasks/:widgetId/:taskId` with `{ payload }`.
4. A typed abort reason enforces the main-server deadline.
5. The client validates HTTP state, JSON, and the shared response envelope.
6. A valid remote error becomes `BrowserTaskRejectedError`, preserving its
   public `code`, mapping `message` to `publicMessage`, and retaining `meta`.
7. A successful low-level response is `{ result: unknown }`; the scoped API
   validates its `result` against `descriptor.result` and returns the inferred
   output type.
8. The widget handler maps any gateway error to its own safe RPC result. If it
   returns an error directly, the existing dispatcher wraps it in
   `WidgetHandlerError`.

## Error Model

All expected failures are returned as values. The gateway exposes four tagged
error categories:

### `BrowserAutomationUnavailableError`

Used for DNS failures, refused connections, other non-abort fetch failures, and
an HTTP `503` from a draining browser service.

### `BrowserAutomationDeadlineError`

Extends `errore.AbortError` and is passed as the `AbortController.abort` reason.
The client detects it with `errore.isAbortError` before the general
`instanceof Error` check.

### `BrowserAutomationProtocolError`

Used for unexpected HTTP status, invalid JSON, an invalid response envelope, or
a successful envelope whose result fails the descriptor result schema. The
error identifies only the safe phase and task identifiers; it does not include
the raw response, payload, result, or validation input.

### `BrowserTaskRejectedError`

Represents a valid `{ ok: false }` envelope. It preserves the browser service's
already-redacted public `code`, maps `message` to `publicMessage`, and retains
optional `meta`, including future task-specific codes such as
`browser_session_required`.

The gateway does not reconstruct browser-process error classes. Class identity
does not cross HTTP, and an open remote error code is required for future
widget-owned tasks.

At uncontrolled async boundaries, promise rejections are converted with
`.catch((cause) => new TaggedError({ cause }))`. No payloads or task results are
logged. Errors that are propagated do not need duplicate logging; any failure
that is intentionally swallowed must be logged without sensitive values.

## Configuration and Availability

The main server reads:

- `BROWSER_AUTOMATION_URL`, default `http://browser-automation:8788`;
- `BROWSER_AUTOMATION_TIMEOUT_MS`, default `100000`, parsed as a positive
  integer.

The default gateway deadline exceeds the browser service defaults of 30 seconds
for queue wait plus 60 seconds for task execution, allowing the browser service
to return its structured timeout before the HTTP caller aborts. Deployments that
change the browser-service limits must keep the gateway deadline above their
combined maximum.

Invalid configured values fail server startup with a safe configuration error.
An unreachable but syntactically valid URL does not affect startup or health;
only an invocation returns `BrowserAutomationUnavailableError`.

Production and development Compose pass the internal service URL and timeout to
the server. They do not add `depends_on: browser-automation`. The production
server already shares `browser_internal`; the development services share their
default network. Browser health is deliberately excluded from the main server's
healthcheck.

## Context Composition

The current `createWidgetServerApi` lives in `widgets/storage.ts`, even though it
returns the full API object. This subproject gives that boundary one purpose per
module:

- `createWidgetServerStorageApi` in `widgets/storage.ts` creates only instance
  and shared storage scopes;
- `createWidgetServerApi` in `widgets/api.ts` combines storage with
  `createWidgetBrowserApi({ typeId, client })`;
- `dispatchWidgetEvent` receives the low-level browser client and uses the
  composed factory when constructing `WidgetServerContext`.

This is a targeted refactor required by the new capability; unrelated storage
behavior and public APIs do not change.

## Testing Strategy

No test in this subproject launches Chromium or contacts a real browser service.

### Descriptor and protocol tests

- preserve literal task IDs;
- infer payload input and result output types;
- remain compatible with `defineWidgetBrowser` schemas;
- accept valid request, success, error, and health envelopes;
- reject malformed envelope variants.

### HTTP client tests

Use a local fake HTTP server or injected fetch boundary to cover:

- successful invocation;
- valid remote task rejection with preserved `code`, `message`, and `meta`;
- `503` and connection failure;
- local deadline and typed abort detection;
- unexpected status;
- invalid JSON and invalid envelope;
- absence of payload, result, and raw response data from returned errors and
  logs;
- no automatic retry.

### Scoped API tests

- always uses the current widget `typeId` as `widgetId`;
- uses the descriptor's task ID;
- forwards the payload once;
- returns a schema-validated typed result;
- converts an invalid success result to `BrowserAutomationProtocolError`;
- propagates every other gateway error unchanged.

### Widget dispatch integration tests

- a test widget invokes a fake browser task through normal widget RPC;
- the fake observes the expected widget and task IDs;
- all four public error categories reach the handler;
- storage-only and non-browser widget handlers remain unchanged.

### App and infrastructure tests

- the main server starts and serves health/storage/non-browser widget requests
  while the browser endpoint is absent;
- Compose exposes browser configuration to the server without making browser
  startup a dependency;
- browser codegen and bundle isolation remain intact.

### Verification

During implementation, focused package tests may be used for fast feedback.
The final local gate is:

```bash
pnpm check
```

`pnpm check` already performs codegen, lint, format checking, workspace
typechecking, and workspace tests. Packaging-sensitive changes are additionally
covered by the existing build or infrastructure tests when required by their
specific implementation task, without duplicating the final check list.

## Done When

- concrete task descriptors are owned by widget packages, not shared or server
  infrastructure;
- `WidgetServerContext.api.browser` is always present and descriptor-typed;
- a widget cannot select a remote `widgetId`; the server scopes it from
  `typeId`;
- the client validates the shared envelope and descriptor result schema;
- unavailable, deadline, protocol, and remote-task failures remain distinct
  error values;
- a test widget completes an invocation through normal server dispatch using a
  fake client;
- the main server stays healthy without browser automation;
- no sensitive payload or result appears in errors or logs;
- no Playwright, passport task, secrets, Reatom, or UI work enters this
  subproject;
- `pnpm check` passes.

## Deferred Work

Subproject 5 adds the `passport-checker` package, its widget-owned
`browser-tasks.ts`, Playwright handler, scoped secret reads, fixture site, and
browser-level tests. Subproject 6 adds the widget server RPC mapping, Reatom
model, React UI, and user-visible recovery states. Subproject 7 performs the
full Raspberry Pi rollout and real checker smoke test.
