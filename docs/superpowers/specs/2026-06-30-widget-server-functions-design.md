# Widget Server Functions Design

**Date:** 2026-06-30  
**Status:** Approved

## Goal

Add a typed RPC path through which a widget can invoke its own server-side
functions. Each widget owns separate client and server entrypoints and a shared
Zod contract. The host binds calls to the widget type and placement, while the
server dispatches calls through an explicit registry.

This capability complements the existing Storage API. The Storage API remains
a supported platform feature for direct client-side widget persistence and is
not being deprecated, migrated, or removed.

## Scope

The first iteration builds infrastructure only:

- explicit client and server widget entrypoints;
- per-widget Zod event contracts and inferred payload/result types;
- a widget-bound client API exposed through props and context;
- one generic HTTP RPC route;
- an explicit server registry and dispatcher;
- a restricted server context with request metadata and server-side widget
  storage;
- server-side `instance` and `shared` storage scopes;
- tests using test-only widget definitions.

Clock and Ofelia receive empty production event contracts and handler objects.
No existing feature is migrated to widget server functions in this iteration.

## Chosen Approach

Use explicit client and server registries. Client code imports only
`widgets/*/client.ts`; server code imports only `widgets/*/server.ts`.

Automatic glob discovery is deferred because Vite and Rspack require separate
integration and do not improve the initial contract. Making every widget a
workspace package with conditional exports is also deferred because it adds
package-management overhead without a current need.

## Widget Structure

```text
widgets/<widget>/
├── client.ts          # client definition: metadata and lazy UI loader
├── server.ts          # server definition: schemas and handlers
├── types.ts           # Zod schemas and inferred shared types
├── model/
├── ui/
└── server/            # server-only handler implementations as they grow
```

There is no root `index.ts`. A single runtime entrypoint would weaken the
client/server dependency boundary: static imports are added to the module graph,
and dynamic imports produce async chunks. Tree shaking is an optimization, not
an isolation guarantee.

### Dependency rules

- `client.ts` may import React/UI code. It imports widget event types with
  `import type` so Zod schemas are not added to the client bundle merely for
  typing.
- `server.ts` imports runtime Zod schemas from `types.ts` and server-only
  handler implementations.
- `types.ts` must not import React, browser APIs, Node.js APIs, Valkey, or server
  application modules.
- The client registry must never import a widget's `server.ts`.
- The server registry must never import a widget's `client.ts`, `ui/`, or
  client model modules.
- Shared platform contracts must remain runtime-neutral unless a file is
  explicitly client-only or server-only.

## Platform Modules

The implementation should introduce focused platform modules with these
responsibilities:

```text
shared/widgets/                 # neutral event/storage/context type contracts
client/src/widget-api/          # HTTP transport and WidgetApiError
client/src/widget-registry/     # explicit imports of widgets/*/client
server/src/widgets/             # registry, dispatcher, HTTP adapter, storage API
```

The exact file split may follow existing package conventions, but transport,
dispatch, and storage adaptation must remain separately testable.

## Client Definition

Each `client.ts` exports one typed client definition containing the metadata
currently held in `client/src/widget-registry/model/registry.ts` and the lazy UI
loader:

```ts
export const clockWidget = defineWidgetClient<ClockEvents>({
  id: 'clock',
  title: 'Часы',
  description: 'Текущее время и дата',
  icon: 'Clock',
  defaultSize: { w: 3, h: 4, minW: 2, minH: 2 },
  loadComponent: () =>
    import('./ui/Clock').then(({ Clock }) => ({ default: Clock })),
})
```

The existing lazy-loader caching and preload behavior stays in the client
platform. Widget definitions provide the underlying loader rather than
reimplementing caching.

The client registry explicitly imports the definitions and forms the catalog.
The registry remains heterogeneous, so generic event types are erased only at
the internal host boundary. Concrete widget code retains its own event map and
fully typed API. Runtime Zod validation is the corresponding safety boundary.

## Widget Event Contract

`types.ts` owns both runtime schemas and types inferred from those schemas:

```ts
export const eventSchemas = {
  clean: {
    payload: z.object({ date: z.string() }),
    result: z.object({ entryId: z.string() }),
  },
  undo: {
    payload: z.object({ date: z.string() }),
    result: z.null(),
  },
} as const

export type OfeliaEvents = InferWidgetEvents<typeof eventSchemas>
```

Every event has both a payload schema and a result schema. Commands that have no
meaningful result use `z.null()` so the wire response remains explicit and
serializable. Events without input use an empty object schema rather than an
omitted payload in the first version; this keeps the transport and generic API
simple.

The infrastructure event map models each event as:

```ts
type WidgetEvent = {
  payload: unknown
  result: unknown
}
```

`InferWidgetEvents` maps Zod input/output types into this shape.

## Client Widget API

`WidgetRuntimeProps` and `WidgetFrameContext` receive an `api` capability. The
host constructs it with `typeId` and `instanceId` already bound:

```ts
type WidgetApi<Events extends WidgetEventMap> = {
  invoke<Event extends keyof Events & string>(
    event: Event,
    payload: Events[Event]['payload'],
  ): Promise<WidgetApiError | Events[Event]['result']>
}
```

Widget code calls:

```ts
const result = await api.invoke('clean', { date })
if (result instanceof Error) return result
```

The widget cannot supply another `typeId` or `instanceId`. The host transport is
the only code that adds those identifiers.

Transport and expected failures follow the repository's errore convention:
the API returns tagged errors as values and does not throw. Network rejection,
non-success status, and a malformed response envelope become `WidgetApiError`
values with preserved causes where applicable. Per-event result validation runs
on the server; after the generic envelope is checked, the client uses the result
type associated with the invoked event.

## HTTP Protocol

Use one RPC route:

```http
POST /api/widgets/:typeId/:event
Content-Type: application/json

{
  "instanceId": "placement-id",
  "payload": {}
}
```

The request body is validated as an object containing a non-empty `instanceId`
string and a `payload` value. Successful calls return the validated result as:

```json
{ "data": null }
```

`null` is a valid result for commands. Errors use this envelope:

```json
{
  "error": {
    "code": "payload_invalid",
    "message": "Widget event payload is invalid"
  }
}
```

Initial error codes are `invalid_json`, `body_too_large`, `unknown_widget`,
`unknown_event`, `request_invalid`, `payload_invalid`, and `internal_error`.
Internal tagged errors and causes are logged only on the server. All unexpected
server failures, including invalid handler results, use the generic
`internal_error` response.

Status mapping for the first version:

- `400` for malformed JSON;
- `404` for an unknown widget type or event;
- `413` for an oversized request body;
- `422` when route/body data or the event payload fails Zod validation;
- `500` for storage failures, handler failures, unexpected exceptions at the
  HTTP boundary, or a handler result that fails its result schema.

Public domain errors and additional statuses such as `409` are deferred. The
response envelope must allow them to be added later without changing the route.

## Server Definition and Registry

Each `server.ts` exports a server definition with a stable type ID, schemas, and
handlers:

```ts
export const ofeliaServer = defineWidgetServer({
  typeId: 'ofelia-poop-duty',
  schemas: eventSchemas,
  handlers: {
    async clean(payload, context) {
      // server-only business logic
      return { entryId: '...' }
    },
  },
})
```

`defineWidgetServer` enforces that:

- every schema has exactly one handler;
- unknown handler keys are rejected;
- each handler receives the inferred payload;
- each handler returns `Error | Result` or a promise of that union.

The production server registry explicitly imports all `widgets/*/server.ts`
definitions and builds a lookup object keyed by `typeId`. Duplicate type IDs
must fail during registry construction. The app accepts the registry as a
dependency so tests can inject test-only widget definitions.

For the infrastructure-only iteration, Clock and Ofelia export empty schemas
and handlers. Dispatcher tests use a local test definition with real events;
production does not gain artificial `ping`, `echo`, or test actions.

## Server Handler Context

A handler receives its validated payload and a restricted context:

```ts
type WidgetServerContext = {
  typeId: string
  instanceId: string
  ip: string | null
  now: () => number
  api: {
    storage: {
      instance: WidgetServerStorage
      shared: WidgetServerStorage
    }
  }
}
```

Handlers do not receive the raw Node request/response, router objects, or
`ValkeyOps`. This keeps them independent of HTTP and directly unit-testable.

## Server Widget Storage

The server-side API exposes both existing namespace concepts:

- `instance` prefixes keys with `w:i:<instanceId>:`;
- `shared` prefixes keys with `w:t:<typeId>:`.

Each scope exposes server-appropriate equivalents of the current Storage API:

- `get` with optional Zod validation;
- `set`;
- `delete`;
- `has`;
- `keys`;
- `append` with an optional cap.

It does not expose client subscriptions; server mutations publish through the
existing storage events channel so current SSE subscribers continue to receive
updates.

The adapter owns namespacing, JSON parsing/serialization, conversion of
third-party rejections into tagged storage errors, and mutation notifications.
`append` also owns locking and enrichment with `id`, `ts`, and `ip`; it uses the
injected clock rather than a hard-coded `Date.now`. Handlers must not construct
full storage keys or publish SSE messages themselves.

The existing HTTP Storage API and client `WidgetStorage` behavior remain
unchanged. Widgets may continue to use direct storage calls even after server
functions are available.

## Error Handling

Expected failures are returned as values throughout client transport, server
dispatch, and widget handlers. Tagged errors use `errore.createTaggedError`,
carry causes, and are handled through flat early returns. The server package
will declare `errore` as a dependency because it participates in this contract.

At the outer Node HTTP boundary, unexpected thrown values are caught once,
logged, and converted to a safe `500` response. This boundary catch does not
change the rule that application functions and widget handlers return expected
errors as values.

## Testing

### Shared and type-level tests

- Event schemas infer the expected payload and result types.
- `defineWidgetServer` rejects missing, extra, or incorrectly typed handlers.
- `WidgetApi.invoke` accepts only declared event names and corresponding
  payloads.

### Client tests

- The API transport generates the expected URL and body.
- `typeId` and `instanceId` come from the host binding, not widget input.
- Network, HTTP, JSON, and response validation failures return
  `WidgetApiError` values.
- `WidgetFrame` supplies the same API through component props and context.
- The client registry loads both existing widget components and preserves their
  metadata, lazy-loading, and preload behavior.

### Server tests

- Registry lookup succeeds and duplicate type IDs are rejected.
- Unknown widget/event, malformed body, oversized body, and invalid payload
  produce the specified statuses.
- Test handlers receive validated payload, identity, IP, injected time, and
  scoped storage.
- Handler results are validated before serialization.
- Handler/storage failures are logged and returned as safe `500` responses.
- `instance` and `shared` storage generate the correct namespaces.
- Mutations publish compatible SSE events.
- Concurrent append calls remain serialized and use platform-generated IDs plus
  the injected clock and request IP for enrichment.

### Verification

- targeted client and server tests;
- `pnpm test`;
- `pnpm typecheck`;
- `pnpm build`;
- `pnpm --filter server build`.

The server build and typecheck must succeed without resolving React or other
client-only widget dependencies.

## Out of Scope

- Migrating `/api/time` to a widget function.
- Migrating Ofelia mutations or comments.
- Removing, deprecating, or replacing the existing Storage API.
- Automatic widget discovery or generated registries.
- Per-widget workspace packages or conditional exports.
- Authentication, authorization, permissions, or rate limiting.
- Public domain-error protocols beyond the generic safe error envelope.
- Multi-operation transactions beyond the existing append lock semantics.

## Success Criteria

- Both existing widgets have isolated `client.ts`, `server.ts`, and `types.ts`
  entrypoints.
- Client and server registries import only their respective entrypoints.
- Widgets receive a type-safe API bound to their type and placement.
- The generic route validates, dispatches, and validates results using injected
  test definitions.
- Server handlers can use both widget storage scopes without access to raw
  Valkey or full keys.
- Existing Storage API behavior and tests remain intact.
- Client tests, server tests, typechecks, and builds pass.
