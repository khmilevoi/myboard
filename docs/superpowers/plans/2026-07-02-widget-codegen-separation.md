# Widget Codegen Separation Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Split widget code generation into isolated client and server flows, derive widget identity from directory names, and publish root `client.ts` definitions as lazy Module Federation remotes.

**Architecture:** `client.ts` remains the authored client definition and lazy UI loader; `server.ts` remains the authored schemas/handlers module. Client codegen may import `client.ts`, while server codegen only discovers directories and emits imports without executing either widget entrypoint. Both generated registries inject the directory basename as the runtime widget ID.

**Tech Stack:** TypeScript 6, pnpm 10 workspace scripts, Vitest 4, Vite 8, `@module-federation/vite`, Rspack, React 19, errore.

---

## File Structure

### New files

- `scripts/codegen/shared.ts` — filesystem paths, discovery, stable writes, target-neutral errors, and port assignment.
- `scripts/codegen/client.ts` — client definition loading plus catalog/icon emission.
- `scripts/codegen/server.ts` — server entrypoint checks plus server-list emission.

### Modified files

- `scripts/codegen.ts` — thin `client | server | all` CLI coordinator.
- `scripts/codegen.test.ts` — pure emitter tests and server/client isolation fixtures.
- `scripts/infra.test.ts` — scoped package-script and Docker codegen assertions.
- `packages/shared/widgets/contracts.ts` — separate module definitions from runtime definitions with directory-injected `typeId`.
- `packages/server/src/widgets/contracts.test.ts` — verify module definitions omit `typeId` and the adapter injects it.
- `packages/server/src/widgets/dispatch.test.ts` — use the object-argument runtime adapter.
- `packages/server/src/app.test.ts` — use the object-argument runtime adapter.
- `packages/widgets/clock/server.ts` — remove authored `typeId`.
- `packages/widgets/ofelia-poop-duty/server.ts` — remove authored `typeId`.
- `packages/widget-sdk/src/define-widget-client.ts` — separate client definitions without `id` from host widget types with `id`.
- `packages/widget-sdk/src/define-widget-client.test.ts` — verify the two client contracts and preserve loader caching/retry behavior.
- `packages/widgets/clock/client.ts` — remove authored `id`.
- `packages/widgets/ofelia-poop-duty/client.ts` — remove authored `id`.
- `packages/widget-sdk/src/vite/widget-vite-config.ts` — expose `./client` from root `client.ts`.
- `packages/widgets/clock/dev/harness.tsx` — lazy-load through the root client definition.
- `packages/widgets/ofelia-poop-duty/dev/harness.tsx` — lazy-load through the root client definition.
- `packages/widgets/clock/dev/harness.test.tsx` — await the lazy standalone widget.
- `packages/client/src/widget-host/ui/WidgetFrame.test.tsx` — mock a remote client definition and assert `clock/client`.
- `packages/client/src/board/ui/Board.test.tsx` — mock a remote client definition.
- `packages/client/src/widget-host/ui/FullscreenOverlay.test.tsx` — mock a remote client definition.
- `package.json` — add scoped codegen commands and route client/server scripts to the narrowest target.
- `packages/client/Dockerfile` — run client codegen only.
- `packages/server/Dockerfile` — run server codegen only and remove the obsolete client-import explanation.
- `AGENTS.md` — document scoped codegen and the root widget entrypoint contract.

### Deleted files

- `packages/widgets/clock/ui/expose.ts`
- `packages/widgets/ofelia-poop-duty/ui/expose.ts`

Generated registry files remain git-ignored and must not be committed.

---

### Task 1: Derive server runtime IDs at the registry boundary

**Files:**
- Modify: `packages/shared/widgets/contracts.ts`
- Modify: `packages/server/src/widgets/contracts.test.ts`
- Modify: `packages/server/src/widgets/dispatch.test.ts`
- Modify: `packages/server/src/app.test.ts`
- Modify: `packages/widgets/clock/server.ts`
- Modify: `packages/widgets/ofelia-poop-duty/server.ts`

- [ ] **Step 1: Write the failing server-contract test**

Change the contract test so authored module definitions omit `typeId`, and the runtime adapter receives the directory-derived ID explicitly:

```ts
import {
  defineWidgetServer,
  toRuntimeWidgetServerDefinition,
  type InferWidgetEvents,
  type WidgetServerContext,
} from '@shared/widgets/contracts'

it('keeps server handlers aligned and injects identity at the runtime boundary', async () => {
  const definition = defineWidgetServer({
    schemas,
    handlers: {
      echo(payload, context: WidgetServerContext) {
        expect(context.typeId).toBe('test-widget')
        return { echoed: payload.value }
      },
    },
  })
  const runtime = toRuntimeWidgetServerDefinition({
    typeId: 'test-widget',
    definition,
  })

  expect('typeId' in definition).toBe(false)
  expect(runtime.typeId).toBe('test-widget')
  expect(Object.keys(runtime.handlers)).toEqual(['echo'])
})
```

- [ ] **Step 2: Run the contract test and verify it fails**

Run from the repository root:

```powershell
pnpm --filter server test -- src/widgets/contracts.test.ts
```

Expected: FAIL because `defineWidgetServer` still requires `typeId` and `toRuntimeWidgetServerDefinition` still accepts the old single argument.

- [ ] **Step 3: Split module and runtime server definitions**

Replace the relevant contract types and adapter with:

```ts
export type WidgetServerDefinition<Schemas extends WidgetEventSchemas> = {
  schemas: Schemas
  handlers: {
    [Event in keyof Schemas]: (
      payload: z.output<Schemas[Event]['payload']>,
      context: WidgetServerContext,
    ) => Awaitable<Error | z.input<Schemas[Event]['result']>>
  }
}

export type RuntimeWidgetServerDefinition = {
  typeId: string
  schemas: WidgetEventSchemas
  handlers: Record<
    string,
    (payload: unknown, context: WidgetServerContext) => Awaitable<Error | unknown>
  >
}

export function defineWidgetServer<const Schemas extends WidgetEventSchemas>(
  definition: WidgetServerDefinition<Schemas>,
): WidgetServerDefinition<Schemas> {
  return definition
}

export function toRuntimeWidgetServerDefinition<const Schemas extends WidgetEventSchemas>({
  typeId,
  definition,
}: {
  typeId: string
  definition: WidgetServerDefinition<Schemas>
}): RuntimeWidgetServerDefinition {
  return { typeId, ...definition } as unknown as RuntimeWidgetServerDefinition
}
```

Keep `WidgetServerContext.typeId`; handlers still receive the runtime identity through context.

- [ ] **Step 4: Update widget modules and test adapters**

Remove `typeId` from both widget `server.ts` definitions. Update every adapter call in `dispatch.test.ts` and `app.test.ts` to the same object form:

```ts
const createdRegistry = createRegistry([
  toRuntimeWidgetServerDefinition({
    typeId: 'test-widget',
    definition,
  }),
])
```

Apply the same form to `testWidgetRegistry` in `app.test.ts`.

- [ ] **Step 5: Run focused server tests**

```powershell
pnpm --filter server test -- src/widgets/contracts.test.ts src/widgets/dispatch.test.ts src/app.test.ts
```

Expected: all selected tests PASS.

- [ ] **Step 6: Commit the server contract change**

```powershell
git add packages/shared/widgets/contracts.ts packages/server/src/widgets/contracts.test.ts packages/server/src/widgets/dispatch.test.ts packages/server/src/app.test.ts packages/widgets/clock/server.ts packages/widgets/ofelia-poop-duty/server.ts
git commit -m "refactor: derive widget server ids at registry boundary"
```

---

### Task 2: Separate client definitions from directory identity

**Files:**
- Modify: `packages/widget-sdk/src/define-widget-client.ts`
- Modify: `packages/widget-sdk/src/define-widget-client.test.ts`
- Modify: `packages/widgets/clock/client.ts`
- Modify: `packages/widgets/ofelia-poop-duty/client.ts`

- [ ] **Step 1: Write failing client-contract tests**

Update both loader tests so the authored definition has no `id`, then inject the ID only when creating a host widget type:

```ts
const definition = defineWidgetClient({
  title: 'Probe',
  description: 'Probe widget',
  icon: 'Clock',
  defaultSize: { w: 1, h: 1 },
  loadComponent: loader,
})
const type = toWidgetType({ id: 'probe', ...definition })

expect('id' in definition).toBe(false)
expect(type.id).toBe('probe')
```

Keep the existing assertions that successful loads are cached and rejected loads can be retried.

- [ ] **Step 2: Run the SDK test and verify it fails**

```powershell
pnpm --filter widget-sdk test -- src/define-widget-client.test.ts
```

Expected: FAIL because `WidgetClientDefinition` still requires `id`.

- [ ] **Step 3: Implement distinct authored and runtime client types**

Use these type boundaries:

```ts
export type WidgetMetadata = {
  id: string
  title: string
  description: string
  defaultSize: { w: number; h: number; minW?: number; minH?: number }
  tiers?: TierConfig
  icon: string
}

export type WidgetClientMetadata = Omit<WidgetMetadata, 'id'>

export type WidgetClientDefinition<
  Events extends WidgetEventMap = WidgetEventMap,
> = WidgetClientMetadata & {
  loadComponent: WidgetLoader<Events>
}

type WidgetTypeDefinition<Events extends WidgetEventMap> = WidgetMetadata & {
  loadComponent: WidgetLoader<Events>
}

export type WidgetType = WidgetMetadata & {
  loadComponent: WidgetLoader
  preloadComponent?: () => void
}

export function defineWidgetClient<const Events extends WidgetEventMap>(
  definition: WidgetClientDefinition<Events>,
): WidgetClientDefinition<Events> {
  return definition
}

export function toWidgetType<const Events extends WidgetEventMap>(
  definition: WidgetTypeDefinition<Events>,
): WidgetType {
  let pending: Promise<WidgetComponentModule> | null = null
  const loader = definition.loadComponent as unknown as WidgetLoader
  const loadComponent = () => {
    pending ??= loader().catch((error: unknown) => {
      pending = null
      throw error
    })
    return pending.then((module) => {
      ensureSingleReatomRoot()
      return module
    })
  }

  return {
    ...definition,
    loadComponent,
    preloadComponent() {
      void loadComponent().catch((error: unknown) => {
        console.warn('Widget chunk preload failed:', error)
      })
    },
  }
}
```

Retain the explanatory comments already present around promise branding and Reatom-root repair when applying this body.

- [ ] **Step 4: Remove authored IDs from widget client modules**

Delete `id: 'clock'` and `id: 'ofelia-poop-duty'` from the two `defineWidgetClient` calls. Keep metadata and lazy imports unchanged.

- [ ] **Step 5: Run SDK and widget typechecks**

```powershell
pnpm --filter widget-sdk test -- src/define-widget-client.test.ts
pnpm --filter widget-sdk typecheck
pnpm --filter "./packages/widgets/*" typecheck
```

Expected: the SDK test and every selected typecheck PASS.

- [ ] **Step 6: Commit the client contract change**

```powershell
git add packages/widget-sdk/src/define-widget-client.ts packages/widget-sdk/src/define-widget-client.test.ts packages/widgets/clock/client.ts packages/widgets/ofelia-poop-duty/client.ts
git commit -m "refactor: derive widget client ids from directories"
```

---

### Task 3: Split client and server codegen flows

**Files:**
- Create: `scripts/codegen/shared.ts`
- Create: `scripts/codegen/client.ts`
- Create: `scripts/codegen/server.ts`
- Modify: `scripts/codegen.ts`
- Modify: `scripts/codegen.test.ts`
- Modify: `scripts/infra.test.ts`
- Modify: `package.json`

- [ ] **Step 1: Replace emitter tests with directory-derived expectations**

Use client metadata without authored IDs:

```ts
const metas: WidgetMeta[] = [
  {
    dir: 'clock',
    title: 'Часы',
    description: 'Текущее время и дата',
    defaultSize: { w: 3, h: 4, minW: 2, minH: 2 },
    icon: 'Clock',
  },
]

it('injects directory IDs and loads remote client definitions', () => {
  const out = emitCatalog(metas)
  expect(out).toContain('id: "clock"')
  expect(out).toContain('loadRemote<')
  expect(out).toContain('`${id}/client`')
  expect(out).toContain('definition.loadComponent()')
  expect(out).not.toContain('/ui')
})

it('emits the server list from directory names alone', () => {
  const out = emitServerList(['clock', 'ofelia-poop-duty'])
  expect(out).toContain("import clock from '@widgets/clock/server'")
  expect(out).toContain('typeId: "clock"')
  expect(out).toContain('definition: clock')
})
```

- [ ] **Step 2: Add a failing isolation fixture**

Create a temporary widget package whose `client.ts` throws if imported, then call server generation:

```ts
it('generates a server registry without importing client entrypoints', () => {
  const root = mkdtempSync(join(tmpdir(), 'server-codegen-'))
  const widgetsDir = join(root, 'widgets')
  const widgetDir = join(widgetsDir, 'probe')
  const serverListFile = join(root, 'widget-server-list.generated.ts')
  mkdirSync(widgetDir, { recursive: true })
  writeFileSync(join(widgetDir, 'package.json'), '{"name":"widgets-probe"}')
  writeFileSync(join(widgetDir, 'server.ts'), 'export default {}')
  writeFileSync(join(widgetDir, 'client.ts'), "throw new Error('must not import client')")

  const result = generateServer({ widgetsDir, serverListFile })

  expect(result).not.toBeInstanceOf(Error)
  expect(readFileSync(serverListFile, 'utf8')).toContain("@widgets/probe/server")
})
```

Import the required Node helpers from `node:fs`, `node:os`, and `node:path`.

Add focused missing-entrypoint cases using temporary directories:

```ts
it('fails client codegen when client.ts is missing', async () => {
  const paths = createTempCodegenPaths('missing-client')
  writeFileSync(join(paths.widgetsDir, 'probe', 'server.ts'), 'export default {}')

  expect(await generateClient(paths)).toBeInstanceOf(MissingWidgetEntrypointError)
})

it('fails server codegen when server.ts is missing', () => {
  const paths = createTempCodegenPaths('missing-server')
  writeFileSync(join(paths.widgetsDir, 'probe', 'client.ts'), 'export default {}')

  expect(generateServer(paths)).toBeInstanceOf(MissingWidgetEntrypointError)
})
```

`createTempCodegenPaths(name)` creates the widget directory and its `package.json`, then returns all five `CodegenPaths` pointing inside the same temporary root so neither test writes into the workspace:

```ts
function createTempCodegenPaths(name: string): CodegenPaths {
  const root = mkdtempSync(join(tmpdir(), `${name}-`))
  const widgetsDir = join(root, 'widgets')
  const widgetDir = join(widgetsDir, 'probe')
  mkdirSync(widgetDir, { recursive: true })
  writeFileSync(join(widgetDir, 'package.json'), '{"name":"widgets-probe"}')
  return {
    widgetsDir,
    portsFile: join(widgetsDir, '.ports.json'),
    clientCatalogFile: join(root, 'widget-catalog.generated.ts'),
    clientIconsFile: join(root, 'widget-icons.generated.ts'),
    serverListFile: join(root, 'widget-server-list.generated.ts'),
  }
}
```

- [ ] **Step 3: Run codegen tests and verify they fail**

```powershell
pnpm test:scripts -- scripts/codegen.test.ts
```

Expected: FAIL because `emitServerList` still accepts metadata, the remote path is `/ui`, and `generateServer` does not exist.

- [ ] **Step 4: Extract target-neutral helpers**

Create `scripts/codegen/shared.ts` with these public boundaries:

```ts
export type CodegenPaths = {
  widgetsDir: string
  portsFile: string
  clientCatalogFile: string
  clientIconsFile: string
  serverListFile: string
}

export type ClientCodegenPaths = Pick<
  CodegenPaths,
  'widgetsDir' | 'portsFile' | 'clientCatalogFile' | 'clientIconsFile'
>

export type ServerCodegenPaths = Pick<
  CodegenPaths,
  'widgetsDir' | 'serverListFile'
>

export type CodegenTarget = 'client' | 'server' | 'all'

export type GeneratedOutput = {
  file: string
  content: string
}

export const BANNER = '// AUTO-GENERATED by scripts/codegen.ts. Do not edit.\n\n'

export class CodegenIoError extends errore.createTaggedError({
  name: 'CodegenIoError',
  message: 'Failed to $operation codegen path $path',
}) {}

export class MissingWidgetEntrypointError extends errore.createTaggedError({
  name: 'MissingWidgetEntrypointError',
  message: 'Widget $widgetId is missing its $side entrypoint at $path',
}) {}

export class InvalidCodegenTargetError extends errore.createTaggedError({
  name: 'InvalidCodegenTargetError',
  message: 'Unknown codegen target: $target',
}) {}

export function parseCodegenTarget(raw: string): InvalidCodegenTargetError | CodegenTarget {
  if (raw === 'client' || raw === 'server' || raw === 'all') return raw
  return new InvalidCodegenTargetError({ target: raw })
}

export const defaultCodegenPaths: CodegenPaths = {
  widgetsDir,
  portsFile,
  clientCatalogFile,
  clientIconsFile,
  serverListFile,
}

export function discoverWidgetDirs(dir: string): CodegenIoError | string[]
export function assignPorts(
  widgetDirs: string[],
  current: Record<string, number>,
): Record<string, number>
export function writeIfChanged(file: string, next: string): Error | void
export function writeGeneratedOutputs(outputs: GeneratedOutput[]): Error | void
export function identifierFromDirectory(dir: string): string
export function stableJson(value: unknown): string
```

Wrap `readdirSync`, `readFileSync`, `mkdirSync`, and `writeFileSync` with `errore.try`, returning a tagged `CodegenIoError` that includes `operation` and `path`. Add `"errore": "catalog:"` to the root `devDependencies` because root scripts now import it directly.

Because `scripts/infra.test.ts` also calls `discoverWidgetDirs`, narrow its result before using `.map`:

```ts
const widgetDirsResult = discoverWidgetDirs(resolve(root, 'packages/widgets'))
if (widgetDirsResult instanceof Error) throw widgetDirsResult
const widgetDirs = widgetDirsResult
```

Add a pure target-parser assertion to `scripts/codegen.test.ts`:

```ts
expect(parseCodegenTarget('invalid')).toBeInstanceOf(InvalidCodegenTargetError)
expect(parseCodegenTarget('server')).toBe('server')
```

- [ ] **Step 5: Implement the client generator**

Create `scripts/codegen/client.ts` with:

```ts
type WidgetClientLike = {
  title: string
  description: string
  defaultSize: { w: number; h: number; minW?: number; minH?: number }
  tiers?: unknown
  icon: string
  loadComponent: unknown
}

export type WidgetMeta = Omit<WidgetClientLike, 'loadComponent'> & {
  dir: string
}

export class WidgetClientImportError extends errore.createTaggedError({
  name: 'WidgetClientImportError',
  message: 'Failed to import client definition for widget $widgetId',
}) {}

export function emitCatalog(metas: WidgetMeta[]): string
export function emitIcons(metas: WidgetMeta[]): string
export async function prepareClient(
  paths: ClientCodegenPaths,
): Promise<Error | GeneratedOutput[]>
export async function generateClient(paths: ClientCodegenPaths): Promise<Error | void>
```

`prepareClient` discovers directories, assigns ports in memory, checks each root client entrypoint, imports it with `pathToFileURL`, maps only the serializable metadata, and uses `dir` as the emitted `id`. The entrypoint guard is:

```ts
const entrypoint = resolve(widgetsDir, dir, 'client.ts')
if (!existsSync(entrypoint)) {
  return new MissingWidgetEntrypointError({
    side: 'client',
    widgetId: dir,
    path: entrypoint,
  })
}
```

Wrap rejected dynamic imports in `WidgetClientImportError` with `widgetId` and `cause`, then return immediately. Only after every import succeeds does `prepareClient` return three `GeneratedOutput` values for ports, catalog, and icons. `generateClient` calls `prepareClient`, returns early on `Error`, and otherwise passes the complete array to `writeGeneratedOutputs`.

Generate a remote loader with this behavior:

```ts
async function loadRemoteModule(id: string) {
  const module = await loadRemote<
    WidgetClientDefinition | { default: WidgetClientDefinition }
  >(`${id}/client`)
  const definition =
    module && typeof module === 'object' && 'default' in module
      ? module.default
      : module
  if (!definition) throw new Error(`Remote widget ${id}/client returned no definition`)
  return definition.loadComponent()
}
```

Keep the existing generated `toWidgetType`, `WidgetType`, and icon-map structure.

- [ ] **Step 6: Implement the server generator**

Create `scripts/codegen/server.ts` with:

```ts
export function emitServerList(widgetDirs: string[]) {
  const imports = widgetDirs
    .map((dir) => `import ${identifierFromDirectory(dir)} from '@widgets/${dir}/server'`)
    .join('\n')
  const list = widgetDirs
    .map(
      (dir) => `  toRuntimeWidgetServerDefinition({
    typeId: ${JSON.stringify(dir)},
    definition: ${identifierFromDirectory(dir)},
  })`,
    )
    .join(',\n')

  return `${BANNER}import { toRuntimeWidgetServerDefinition } from '@shared/widgets/contracts'
${imports}

export const widgetServerList = [
${list}
]
`
}

export function prepareServer({ widgetsDir, serverListFile }: ServerCodegenPaths) {
  const widgetDirs = discoverWidgetDirs(widgetsDir)
  if (widgetDirs instanceof Error) return widgetDirs

  for (const dir of widgetDirs) {
    const entrypoint = resolve(widgetsDir, dir, 'server.ts')
    if (!existsSync(entrypoint)) {
      return new MissingWidgetEntrypointError({ side: 'server', widgetId: dir, path: entrypoint })
    }
  }

  return [{ file: serverListFile, content: emitServerList(widgetDirs) }]
}

export function generateServer(paths: ServerCodegenPaths) {
  const outputs = prepareServer(paths)
  if (outputs instanceof Error) return outputs
  return writeGeneratedOutputs(outputs)
}
```

The function must not call `import()`.

- [ ] **Step 7: Make the root CLI target-aware**

Replace `scripts/codegen.ts` with a thin coordinator:

```ts
import { generateClient, prepareClient } from './codegen/client'
import { generateServer, prepareServer } from './codegen/server'
import {
  defaultCodegenPaths,
  parseCodegenTarget,
  writeGeneratedOutputs,
  type CodegenTarget,
} from './codegen/shared'

async function run(target: CodegenTarget) {
  if (target === 'client') return generateClient(defaultCodegenPaths)
  if (target === 'server') return generateServer(defaultCodegenPaths)

  const clientOutputs = await prepareClient(defaultCodegenPaths)
  if (clientOutputs instanceof Error) return clientOutputs

  const serverOutputs = prepareServer(defaultCodegenPaths)
  if (serverOutputs instanceof Error) return serverOutputs

  return writeGeneratedOutputs([...clientOutputs, ...serverOutputs])
}

const target = parseCodegenTarget(process.argv[2] ?? 'all')

const result = target instanceof Error ? target : await run(target)
if (result instanceof Error) {
  console.error(result)
  process.exitCode = 1
}
```

Export errors from the focused modules or shared module so the CLI does not throw for expected failures.

- [ ] **Step 8: Add root codegen scripts and run the tests**

Use these scripts:

```json
{
  "codegen": "tsx scripts/codegen.ts all",
  "codegen:client": "tsx scripts/codegen.ts client",
  "codegen:server": "tsx scripts/codegen.ts server"
}
```

Then run:

```powershell
pnpm install --lockfile-only
pnpm test:scripts -- scripts/codegen.test.ts
pnpm run codegen:client
pnpm run codegen:server
```

Expected: codegen tests PASS, both commands exit 0, and each command updates only its own generated outputs plus `.ports.json` for the client command.

- [ ] **Step 9: Commit the split codegen**

```powershell
git add package.json pnpm-lock.yaml scripts/codegen.ts scripts/codegen.test.ts scripts/infra.test.ts scripts/codegen/shared.ts scripts/codegen/client.ts scripts/codegen/server.ts
git commit -m "build: split widget client and server codegen"
```

Do not stage git-ignored generated registries.

---

### Task 4: Publish root client definitions through Module Federation

**Files:**
- Modify: `scripts/infra.test.ts`
- Modify: `packages/widget-sdk/src/vite/widget-vite-config.ts`
- Modify: `packages/widgets/clock/dev/harness.tsx`
- Modify: `packages/widgets/ofelia-poop-duty/dev/harness.tsx`
- Modify: `packages/widgets/clock/dev/harness.test.tsx`
- Modify: `packages/client/src/widget-host/ui/WidgetFrame.test.tsx`
- Modify: `packages/client/src/board/ui/Board.test.tsx`
- Modify: `packages/client/src/widget-host/ui/FullscreenOverlay.test.tsx`
- Delete: `packages/widgets/clock/ui/expose.ts`
- Delete: `packages/widgets/ofelia-poop-duty/ui/expose.ts`

- [ ] **Step 1: Write a failing Federation entrypoint assertion**

Read the shared widget Vite config in `scripts/infra.test.ts` and assert the new public exposure:

```ts
const widgetViteConfig = readFileSync(
  resolve(root, 'packages/widget-sdk/src/vite/widget-vite-config.ts'),
  'utf8',
)

it('exposes each root client definition as the remote client entrypoint', () => {
  expect(widgetViteConfig).toContain("exposes: { './client': './client.ts' }")
  expect(widgetViteConfig).not.toContain("'./ui': './ui/expose.ts'")
})
```

- [ ] **Step 2: Update the client integration test to the new remote contract**

In `WidgetFrame.test.tsx`, replace the remote component mock with a client definition:

```ts
const RemoteClock = () => <div>12:34</div>
federation.loadRemote.mockResolvedValue({
  default: {
    loadComponent: async () => ({ default: RemoteClock }),
  },
})

// After rendering:
expect(federation.loadRemote).toHaveBeenCalledWith('clock/client')
```

Apply the same remote shape in the `Board.test.tsx` and `FullscreenOverlay.test.tsx` `beforeEach` blocks:

```ts
federation.loadRemote.mockResolvedValue({
  default: {
    loadComponent: async () => ({ default: StubClockWidget }),
  },
})
```

- [ ] **Step 3: Run the infrastructure assertion and verify it fails**

```powershell
pnpm test:scripts -- scripts/infra.test.ts
```

Expected: FAIL because the widget Vite config still exposes `./ui` from `ui/expose.ts`.

- [ ] **Step 4: Expose the root client definition**

Change the federation exposure to:

```ts
federation({
  name: id,
  filename: 'remoteEntry.js',
  exposes: { './client': './client.ts' },
  shared: federationShared(),
  dev: { remoteHmr: true },
  manifest: false,
  dts: false,
})
```

Delete both `ui/expose.ts` files.

- [ ] **Step 5: Make standalone harnesses use the same root entrypoint**

Replace the direct `ui/expose` import in each harness with:

```tsx
import { lazy, Suspense } from 'react'

import client from '../client'

const Widget = lazy(client.loadComponent)

export const HarnessApp = reatomMemo(
  () => (
    <Suspense fallback={null}>
      <Widget {...harnessProps()} />
    </Suspense>
  ),
  'ClockHarness',
)
```

Use `'OfeliaHarness'` in the Ofelia harness. Keep the existing `harnessProps()` implementations unchanged.

- [ ] **Step 6: Await the standalone lazy component test**

Change the clock harness render test to:

```ts
it('renders the widget standalone', async () => {
  render(<HarnessApp />)
  expect(await screen.findByText(/:/)).toBeInTheDocument()
})
```

- [ ] **Step 7: Regenerate the client catalog and run integration tests**

```powershell
pnpm run codegen:client
pnpm test:scripts -- scripts/infra.test.ts
pnpm --filter client test -- src/widget-host/ui/WidgetFrame.test.tsx src/board/ui/Board.test.tsx src/widget-host/ui/FullscreenOverlay.test.tsx
pnpm --filter widgets-clock test -- dev/harness.test.tsx
```

Expected: all selected tests PASS and runtime mocks observe `${id}/client`.

- [ ] **Step 8: Commit the remote entrypoint migration**

```powershell
git add scripts/infra.test.ts packages/widget-sdk/src/vite/widget-vite-config.ts packages/widgets/clock/client.ts packages/widgets/clock/dev/harness.tsx packages/widgets/clock/dev/harness.test.tsx packages/widgets/clock/ui/expose.ts packages/widgets/ofelia-poop-duty/client.ts packages/widgets/ofelia-poop-duty/dev/harness.tsx packages/widgets/ofelia-poop-duty/ui/expose.ts packages/client/src/widget-host/ui/WidgetFrame.test.tsx packages/client/src/board/ui/Board.test.tsx packages/client/src/widget-host/ui/FullscreenOverlay.test.tsx
git commit -m "build: expose widget client definitions as remotes"
```

---

### Task 5: Route commands and Docker builds to scoped codegen

**Files:**
- Modify: `scripts/infra.test.ts`
- Modify: `package.json`
- Modify: `packages/client/Dockerfile`
- Modify: `packages/server/Dockerfile`
- Modify: `AGENTS.md`

- [ ] **Step 1: Write failing infrastructure assertions**

Read the root package and both Dockerfiles in `scripts/infra.test.ts`, then assert the narrow targets:

```ts
const rootPackage = JSON.parse(readFileSync(resolve(root, 'package.json'), 'utf8')) as {
  scripts: Record<string, string>
}
const clientDockerfile = readFileSync(resolve(root, 'packages/client/Dockerfile'), 'utf8')
const serverDockerfile = readFileSync(resolve(root, 'packages/server/Dockerfile'), 'utf8')

it('routes local commands to the narrowest codegen target', () => {
  expect(rootPackage.scripts.dev).toContain('codegen:client')
  expect(rootPackage.scripts['dev:server']).toContain('codegen:server')
  expect(rootPackage.scripts.build).toContain('codegen:client')
  expect(rootPackage.scripts.test).toContain('pnpm run codegen')
  expect(rootPackage.scripts.typecheck).toContain('pnpm run codegen')
})

it('runs only client codegen in the client image', () => {
  expect(clientDockerfile).toContain('pnpm run codegen:client')
})

it('runs only server codegen in the server image', () => {
  expect(serverDockerfile).toContain('pnpm run codegen:server')
  expect(serverDockerfile).not.toContain('imports every widgets/*/client.ts')
})
```

Keep the Docker dev-stack assertion on the combined `pnpm run codegen`: that service prepares client and server processes together.

- [ ] **Step 2: Run infrastructure tests and verify they fail**

```powershell
pnpm test:scripts -- scripts/infra.test.ts
```

Expected: FAIL because root and Docker commands still invoke the combined codegen target.

- [ ] **Step 3: Scope root commands**

Update the root scripts to:

```json
{
  "dev": "pnpm run codegen:client && pnpm -r --parallel --filter \"./packages/widgets/*\" --filter client dev",
  "dev:server": "pnpm run codegen:server && pnpm --filter server dev",
  "build": "pnpm run codegen:client && concurrently -g --kill-others-on-fail \"pnpm --filter ./packages/widgets/* build\" \"pnpm --filter client typecheck\" && pnpm --filter client build",
  "build:widgets": "pnpm run codegen:client && pnpm --filter \"./packages/widgets/*\" build",
  "test": "pnpm run codegen && pnpm run test:scripts && pnpm -r test",
  "typecheck": "pnpm run codegen && pnpm -r typecheck"
}
```

Arguments after a pnpm script name are forwarded to that script, and `pnpm -r` excludes the workspace root for run/test commands unless configured otherwise; retain the explicit root `test:scripts` invocation.

- [ ] **Step 4: Scope production Docker codegen**

Change the client build step to:

```dockerfile
RUN pnpm run codegen:client \
    && pnpm --filter "./packages/widgets/*" build \
    && pnpm --filter client exec vite-build-exit
```

Change the server build step to:

```dockerfile
RUN pnpm run codegen:server && pnpm --filter server build
```

Replace the server Docker comment claiming codegen imports every `client.ts` with a factual note that server codegen only emits directory-derived server imports. Do not change dependency installation scope in this task.

- [ ] **Step 5: Update repository instructions**

In `AGENTS.md` document:

```markdown
- `pnpm codegen:client`: generate widget ports, the client catalog, and the icon map by loading root `client.ts` definitions.
- `pnpm codegen:server`: generate the server registry from widget directory names and root `server.ts` entrypoints without loading client code.
- `pnpm codegen`: run both generators for workspace-wide gates.
```

Also state that the widget directory basename is the canonical ID, `client.ts` exports the client definition/lazy loader without `id`, and `server.ts` exports schemas/handlers without `typeId`.

- [ ] **Step 6: Run infrastructure tests**

```powershell
pnpm test:scripts -- scripts/infra.test.ts scripts/codegen.test.ts
```

Expected: all script and infrastructure tests PASS.

- [ ] **Step 7: Commit command and Docker integration**

```powershell
git add package.json packages/client/Dockerfile packages/server/Dockerfile scripts/infra.test.ts AGENTS.md
git commit -m "build: scope widget codegen by target"
```

---

### Task 6: Run full verification

**Files:**
- Verify only; modify files only to fix failures caused by this plan.

- [ ] **Step 1: Confirm generated output stability**

```powershell
pnpm run codegen
git status --short
pnpm run codegen
git status --short
```

Expected: the second run does not create additional tracked changes. Generated registries remain ignored.

- [ ] **Step 2: Run all unit and component tests**

```powershell
pnpm test
```

Expected: PASS across the workspace.

- [ ] **Step 3: Run workspace typechecks**

```powershell
pnpm typecheck
```

Expected: PASS across the workspace. If an unrelated pre-existing error appears, record its exact file and diagnostic without changing unrelated code.

- [ ] **Step 4: Build the client artifact and widget remotes**

```powershell
pnpm build
```

Expected: every widget remote builds, the host builds, and staged widget assets contain remote client definitions reachable through `${id}/client`.

- [ ] **Step 5: Build the server artifact from server-only codegen**

```powershell
pnpm run codegen:server
pnpm --filter server build
```

Expected: PASS without running `codegen:client`.

- [ ] **Step 6: Build production Docker images when Docker is available**

```powershell
docker compose build server client
```

Expected: both images build successfully; logs show `codegen:server` in the server image and `codegen:client` in the client image. If the Docker daemon is unavailable, report that environmental limitation and retain the static Dockerfile assertions as verification.

- [ ] **Step 7: Inspect the final diff**

```powershell
git status --short
git diff --check
git log -5 --oneline
```

Expected: no whitespace errors, no generated registries staged, and the five focused implementation commits are present. If verification exposes a defect, return to the task that introduced it, add a failing regression test there, fix it, rerun that task's focused checks, and commit the exact files named by that task before repeating Task 6.
