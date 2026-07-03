# Widget Browser Contracts and Codegen Design

**Date:** 2026-07-03
**Status:** Approved
**Parent design:** [Passport Checker and Browser Automation Runtime Design](./2026-07-03-passport-checker-browser-automation-design.md)

## Goal

Establish the lightweight, Playwright-free browser-task contract and deterministic
code generation required by later browser-automation subprojects. A widget may own
an optional root `browser.ts` entrypoint, while browser codegen discovers and emits
only those entrypoints without loading widget client, server, or browser modules.

## Scope

This subproject includes:

- Zod-backed browser task schemas and inferred payload/result types;
- `defineWidgetBrowser` and runtime-definition conversion;
- a generic handler context with no Playwright dependency;
- optional widget-root `browser.ts` discovery;
- deterministic browser registry code generation;
- a pure `makeWidgetBrowserRegistry` duplicate guard;
- a minimal `packages/browser-automation` workspace package that owns the
  generated registry boundary, tests, and typecheck configuration;
- focused contract, registry, codegen, command, and isolation tests.

It excludes HTTP transport, task dispatch and execution, payload/result validation
at dispatch time, queueing, deadlines, cancellation, Playwright, browser lifecycle,
Docker, server context changes, and the passport-checker widget.

## Design Decisions

The browser contract follows the existing widget server contract: one widget-level
definition contains parallel `schemas` and `handlers` maps. Mapped types keep task
names aligned between both maps.

The handler context is a generic selected by the browser runtime rather than a
Playwright-shaped interface in shared code. The concrete runtime context is added
by later subprojects. This prevents the shared contract and codegen from depending
on Playwright or predicting a partial browser API prematurely.

Browser codegen follows the server generator's static-import approach. It checks
filesystem entrypoint presence and emits imports, but does not execute `browser.ts`.
TypeScript and the eventual browser package build validate the generated imports.

The browser-automation package is introduced here only as a lightweight owner of
the generated list and pure registry. It becomes an executable service in
Subproject 2.

## Browser Task Contract

The contract lives in `packages/shared/widgets/browser-contracts.ts`. It may reuse
the existing generic widget schema primitives internally, while exposing
browser-specific names for the public task surface.

Conceptually, a widget definition has this shape:

```ts
const browser = defineWidgetBrowser<BrowserContext>()({
  schemas: {
    check: {
      payload: checkPayloadSchema,
      result: checkResultSchema,
    },
  },
  handlers: {
    check(payload, context) {
      return runCheck({ payload, context })
    },
  },
})

export default browser
```

Each root `browser.ts` default-exports exactly one widget browser definition. The
entrypoint contains no authored `widgetId`; codegen supplies it from the directory.

`defineWidgetBrowser` is curried so the caller can select the context type while
the exact schema map remains inferred. For each task:

- the public payload type is `z.input` of the payload schema;
- the handler receives `z.output` of the payload schema after future dispatch
  validation;
- the handler returns `Error | z.input` of the result schema, synchronously or
  asynchronously;
- the public result type is `z.output` of the result schema after future dispatch
  validation.

Expected handler failures are returned as values. The contract does not prescribe
specific domain error classes; those belong to the service and task subprojects.

The authored definition contains neither `widgetId` nor `taskId` outside its map
keys. `toRuntimeWidgetBrowserDefinition` receives the directory-derived
`widgetId` and returns a type-erased runtime definition while preserving the
generic context type. This is the same identity-injection boundary used by widget
server definitions.

## Browser Registry

`packages/browser-automation/src/tasks/registry.ts` owns a pure
`makeWidgetBrowserRegistry` function. It accepts runtime widget browser
definitions and creates a nested readonly index:

```text
widgetId
  -> taskId
      -> payload schema, result schema, handler
```

A nested map represents the `(widgetId, taskId)` pair directly and avoids delimiter
or escaping rules for a synthesized string key. Repeating the same pair returns a
tagged `DuplicateWidgetBrowserTaskError` containing only `widgetId` and `taskId`.
The function does not throw for this expected failure.

The registry does not execute handlers, validate payloads or results, or define
unknown-task behavior. Those responsibilities begin in the service-core
subproject.

## Browser Codegen

The shared codegen paths gain a browser-list output under
`packages/browser-automation/src/tasks/widget-browser-list.generated.ts`.
`scripts/codegen/browser.ts` implements `prepareBrowser` and `generateBrowser`.

The browser flow:

1. Discovers widget directories through the existing `package.json`-based helper.
2. Keeps only directories containing a root `browser.ts` file.
3. Retains deterministic directory ordering.
4. Creates legal, collision-safe import bindings with the existing identifier
   helper.
5. Emits static imports from `@widgets/<widgetId>/browser`.
6. Converts each module with `toRuntimeWidgetBrowserDefinition`, injecting the
   directory basename as `widgetId`.
7. Exports the generated runtime-definition list for the browser package.

Widgets without `browser.ts` are valid and produce no entry. An empty generated
list is valid before the first browser-backed widget is implemented. The generated
file is ignored by Git.

The generator never imports or evaluates `client.ts`, `server.ts`, or `browser.ts`.
A syntactically invalid entrypoint or wrong export therefore fails the generated
import during typecheck/build rather than during codegen.

## Commands and Atomic Writes

The codegen target union adds `browser`. Root scripts expose:

- `codegen:client` for client artifacts only;
- `codegen:server` for the server registry only;
- `codegen:browser` for the browser registry only;
- `codegen` for all three targets.

The browser-only command prepares and writes only its generated list. The combined
command prepares client, server, and browser outputs before calling the existing
atomic writer once. A failure in any prepare phase leaves all generated outputs
untouched.

Existing workspace-wide `test` and `typecheck` commands continue to invoke the
combined codegen command. No browser-specific dev, build, or Docker command is
introduced until the package becomes an executable service.

## Package Boundary

`packages/browser-automation` is added to `pnpm-workspace.yaml` with only the
configuration needed for this subproject:

- package manifest;
- TypeScript configuration and path aliases for shared and widget imports;
- Vitest configuration;
- registry implementation and tests;
- generated-list destination.

The package does not expose a process entrypoint, open a port, import Playwright,
or define browser runtime lifecycle. Reatom is not used because this subproject has
no reactive state, async orchestration, or React integration.

## Error Handling

Codegen preserves the repository's errors-as-values convention:

- existing filesystem failures remain `CodegenIoError` values with causes;
- invalid CLI targets remain `InvalidCodegenTargetError` values;
- the new `browser` target is accepted by the target parser;
- a missing optional `browser.ts` is not an error;
- duplicate registry pairs return `DuplicateWidgetBrowserTaskError`;
- the CLI logs a final unhandled error once and sets a non-zero exit code.

No payloads, results, or task inputs are included in duplicate or codegen errors.

## Testing Strategy

### Contract tests

- infer browser payload and result types from Zod schemas;
- preserve a caller-selected generic handler context;
- keep schema and handler task names aligned;
- inject `widgetId` only at runtime-definition conversion;
- retain `Error | result` handler return behavior.

### Registry tests

- construct the nested registry from multiple widgets and tasks;
- retain schemas and handlers under the correct pair;
- return `DuplicateWidgetBrowserTaskError` for a repeated pair;
- avoid throwing for expected duplicate failures.

### Codegen tests

- emit an empty list when no widget has `browser.ts`;
- include only root browser entrypoints from discovered widget packages;
- sort output deterministically;
- create legal unique bindings for colliding directory-derived identifiers;
- inject directory-derived widget IDs;
- leave unchanged output files untouched.

### Isolation fixtures

- browser codegen succeeds when client or server entrypoints are absent;
- browser codegen succeeds when client or server modules would throw if imported;
- browser codegen succeeds when a browser fixture would throw if evaluated, proving
  that it emits rather than executes entrypoints;
- existing client and server generators retain their current behavior.

### Command and repository checks

- parse the new browser target and reject unknown targets;
- verify `codegen:browser` and combined `codegen` script wiring;
- run targeted script and browser-package tests;
- run browser-package typecheck;
- run workspace `pnpm test` and `pnpm typecheck`.

## Success Criteria

- Browser schemas infer exact public and handler-side payload/result types.
- Shared browser contracts and codegen have no Playwright dependency.
- Browser codegen includes exactly discovered root `browser.ts` entrypoints and
  does not execute any widget entrypoint.
- Widget identity is injected exclusively from the directory basename.
- `makeWidgetBrowserRegistry` returns a tagged error for duplicate
  `(widgetId, taskId)` pairs.
- `codegen:browser` changes only browser output, while combined codegen retains
  atomic writes across all targets.
- Existing client/server codegen behavior and repository verification remain
  green.

## Deferred Work

Subproject 2 adds the executable browser service, request/response envelopes,
lookup and dispatch, runtime schema validation, scheduling, deadlines,
cancellation, health, shutdown, and safe error mapping. Subproject 3 adds the
concrete Playwright host and browser lifecycle. No part of those responsibilities
is pulled into this contract/codegen change.
