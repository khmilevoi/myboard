# Widget Codegen Separation Design

## Context

The workspace currently has one widget codegen pipeline. It discovers widget directories, imports every `client.ts` to obtain client metadata, then emits both the client catalog and the server registry. As a result, any command that only needs the server registry still executes client modules and requires their toolchain and dependency graph.

The same widget identity is also repeated in several places: the directory name, the client definition's `id`, and the server definition's `typeId`. The directory is already the identifier used by widget ports, Module Federation names, import paths, and build output paths.

## Goals

- Make client and server code generation independent.
- Ensure server codegen never imports or executes widget client code.
- Keep one explicit root entrypoint for each widget side: `client.ts` and `server.ts`.
- Use the widget directory name as the only widget ID source.
- Preserve automatic widget discovery and lazy loading.
- Keep generated writes stable with `writeIfChanged`.

## Non-goals

- Introduce `widget.json` or another metadata manifest.
- Replace automatic discovery with a manually maintained host registry.
- Redesign widget storage, RPC, event schemas, or runtime behavior.
- Fully redesign workspace package boundaries or split client and server dependencies into separate widget packages.
- Add task-graph caching or CI in this change.

## Widget Contract

Each widget has this public shape:

```text
packages/widgets/<widget-id>/
  client.ts   # client definition and lazy component loader
  server.ts   # schemas and handlers
  types.ts    # shared event contract
  model/      # internal domain and Reatom logic
  ui/         # internal React implementation
  dev/        # standalone development harness
```

The directory basename is the canonical widget ID. Client definitions do not declare `id`, and server definitions do not declare `typeId`.

`client.ts` remains safe to execute during client codegen because it contains metadata and a lazy dynamic import rather than eagerly importing the UI module:

```ts
export default defineWidgetClient({
  title: 'Часы',
  description: 'Текущее время и дата',
  icon: 'Clock',
  defaultSize: { w: 3, h: 4, minW: 2, minH: 2 },
  loadComponent: () => import('./ui/Clock').then(({ Clock }) => ({ default: Clock })),
})
```

`server.ts` contains only the server implementation:

```ts
export default defineWidgetServer({
  schemas: clockEventSchemas,
  handlers: {},
})
```

## Codegen Architecture

The codegen implementation has shared filesystem helpers but exposes two independent flows.

### Client codegen

`codegen:client`:

1. Discovers widget directories from `packages/widgets/*/package.json`.
2. Assigns stable development ports in `.ports.json`.
3. Imports each widget's `client.ts` definition.
4. Adds the directory basename as `id`.
5. Emits the client widget catalog and icon map.

Client codegen is the only flow allowed to import `client.ts`. A client import failure is therefore isolated to client-facing commands.

### Server codegen

`codegen:server`:

1. Discovers widget directories using the same directory helper.
2. Verifies that each discovered widget has a root `server.ts` entrypoint.
3. Generates static imports from the directory names.
4. Adds the directory basename as `typeId` when adapting each module definition to a runtime definition.
5. Emits `widget-server-list.generated.ts`.

Server codegen does not import or execute `server.ts`. Rspack and TypeScript validate the generated static imports during their normal build and typecheck phases. It never reads or imports `client.ts`.

### Commands

The root package exposes:

- `codegen:client` for client-only work;
- `codegen:server` for server-only work;
- `codegen` for both flows in workspace-wide gates.

The implementation may keep a single CLI entry with an explicit target, but the target branches must remain dependency-isolated: choosing `server` must make importing a client module impossible.

## Client Runtime Flow

Module Federation exposes the root client definition:

```ts
exposes: { './client': './client.ts' }
```

The generated host catalog uses `${id}/client` instead of `${id}/ui`. Its loader:

1. Loads the remote client definition.
2. Normalizes the possible Module Federation default-export shapes.
3. Calls the remote definition's `loadComponent()`.
4. Returns the component module to the existing `toWidgetType` lazy-loading wrapper.

This keeps metadata available locally in the generated host catalog while preserving lazy loading of the actual UI. `ui/expose.ts` becomes redundant and is removed. Standalone widget harnesses use the root client definition and its loader instead of importing `ui/expose.ts`.

## Server Runtime Flow

The generated server list converts a module definition into a runtime definition while injecting the directory-derived ID. Conceptually:

```ts
toRuntimeWidgetServerDefinition({
  typeId: 'clock',
  definition: clock,
})
```

`WidgetServerDefinition` represents a widget module and excludes `typeId`. `RuntimeWidgetServerDefinition` includes `typeId`. The adapter is the single boundary that joins directory identity with a server implementation.

Tests and non-generated callers use the same adapter when they need a runtime definition, so the production and test paths exercise the same contract.

## Build and Development Integration

- Client development and client artifact builds run `codegen:client`.
- Server development and server artifact builds run `codegen:server`.
- Workspace-wide test and typecheck gates run the combined `codegen` command because both generated registries participate in those gates.
- The client Docker build runs only client codegen.
- The server Docker build runs only server codegen.
- Production widget builds continue to receive stable ports before their Vite configs are evaluated.

This change isolates code execution. Reducing the server image's dependency installation set is a follow-up because widget workspace packages still combine client and server dependencies in one `package.json`; it must be measured and designed separately.

## Error Handling

Codegen follows the repository's errors-as-values convention at filesystem and module-loading boundaries.

- Discovery failures include the directory path.
- A missing `client.ts` fails only client codegen.
- A missing `server.ts` fails only server codegen.
- Client module import failures include the widget directory.
- Invalid codegen targets fail before discovery or writes.
- All content is computed before generated files are written, so validation and import failures do not leave partially refreshed outputs.
- The CLI boundary logs the final error once and sets a non-zero exit code.

Generated files continue to use `writeIfChanged` so unchanged codegen runs do not trigger unnecessary HMR, incremental typecheck, or Docker layer invalidation.

## Testing

Unit and infrastructure tests cover:

- deterministic widget directory discovery;
- stable port assignment in client codegen;
- client metadata emission with directory-derived IDs;
- `${id}/client` remote loaders;
- icon map generation;
- server registry generation from directory names alone;
- injected server `typeId` values;
- client codegen failure when a client entrypoint is missing;
- server codegen success when a client entrypoint cannot be imported;
- server codegen failure when a server entrypoint is missing;
- Module Federation exposure of `./client` from `./client.ts`;
- standalone harness loading through the root client definition.

Repository verification runs:

- targeted codegen and infrastructure tests;
- `pnpm test`;
- `pnpm typecheck`;
- `pnpm build`;
- server package build;
- client and server Docker builds when the local Docker daemon is available.

## Migration

1. Split shared discovery/emission helpers from the target-specific orchestration.
2. Add client, server, and combined codegen commands.
3. Remove `id` from widget client definitions and inject it during client emission.
4. Remove `typeId` from widget server definitions and inject it in the generated server list.
5. Expose each root `client.ts` as `./client` and update the generated remote loader.
6. Remove `ui/expose.ts` and update standalone harnesses.
7. Route local and Docker commands to the narrowest codegen target.
8. Update tests and repository documentation describing widget entrypoints.

## Success Criteria

- Running server codegen performs no import of any widget `client.ts`.
- A broken client-only import cannot prevent server codegen from generating the server registry.
- A widget's ID appears as authored data only in its directory name.
- The host loads widget definitions from `${id}/client` and still lazy-loads UI components.
- Client-only and server-only commands generate only their required outputs.
- Existing unit, typecheck, build, and relevant Docker gates pass.
