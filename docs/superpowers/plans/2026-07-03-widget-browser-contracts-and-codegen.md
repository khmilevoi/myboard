# Widget Browser Contracts and Codegen Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add Playwright-free widget browser-task contracts, a pure duplicate-safe registry, and isolated optional `browser.ts` code generation.

**Architecture:** Shared code defines a Zod-backed widget-level browser contract with a caller-selected generic handler context. A minimal `browser-automation` package owns a nested `(widgetId, taskId)` registry and the generated runtime-definition list. Browser codegen mirrors server codegen by discovering root entrypoints and emitting static imports without evaluating widget modules.

**Tech Stack:** TypeScript 6, ESM, Zod 4, errore, pnpm 10 workspaces, Vitest 4.

**Design:** [Widget Browser Contracts and Codegen Design](../specs/2026-07-03-widget-browser-contracts-and-codegen-design.md)

---

## File Structure

### New files

- `packages/shared/widgets/browser-contracts.ts` — browser schema inference, authored definitions, runtime definitions, and directory-ID adaptation.
- `packages/browser-automation/package.json` — lightweight package scripts and dependencies.
- `packages/browser-automation/tsconfig.json` — strict Node-oriented typecheck with shared/widget aliases.
- `packages/browser-automation/vitest.config.ts` — Node test environment and aliases.
- `packages/browser-automation/src/tasks/contracts.test.ts` — contract inference and runtime-adapter tests.
- `packages/browser-automation/src/tasks/registry.ts` — nested readonly registry and tagged duplicate error.
- `packages/browser-automation/src/tasks/registry.test.ts` — registry construction and duplicate tests.
- `scripts/codegen/browser.ts` — optional browser entrypoint discovery and list emission.

### Modified files

- `scripts/codegen.test.ts` — reconcile the stale optional-server test, then add browser emitter, isolation, deterministic-output, and target tests.
- `scripts/codegen/shared.ts` — browser output path/types, browser target, and shared collision-safe bindings.
- `scripts/codegen/server.ts` — consume the extracted binding helper without changing optional-server behavior.
- `scripts/codegen.ts` — add isolated browser generation and combined atomic preparation.
- `scripts/infra.test.ts` — assert workspace/package and command integration.
- `package.json` — add `codegen:browser`.
- `pnpm-workspace.yaml` — include `packages/browser-automation`.
- `pnpm-lock.yaml` — register the new workspace package.
- `.gitignore` — ignore the browser generated list.
- `AGENTS.md` — document the package and optional browser entrypoint/codegen command.

### Generated, ignored file

- `packages/browser-automation/src/tasks/widget-browser-list.generated.ts` — static imports and runtime widget browser definitions.

---

### Task 1: Reconcile the stale optional-server codegen test

Commit `1f046b3f` made widget `server.ts` entrypoints optional but left one test asserting the old required-entrypoint behavior. Correct that test before adding browser coverage so the targeted suite represents the current production behavior.

**Files:**

- Modify: `scripts/codegen.test.ts`

- [ ] **Step 1: Run the current codegen test and record the existing failure**

Run from the repository root:

```powershell
pnpm test:scripts -- scripts/codegen.test.ts
```

Expected: FAIL in `fails server codegen when server.ts is missing` because `generateServer` now emits a list that omits widgets without `server.ts`.

- [ ] **Step 2: Replace the stale assertion with the current optional-entrypoint contract**

Replace that test with:

```ts
it('omits widgets without server.ts from server codegen', () => {
  const paths = createTempCodegenPaths('missing-server')
  writeFileSync(join(paths.widgetsDir, 'probe', 'client.ts'), 'export default {}')

  expect(generateServer(paths)).not.toBeInstanceOf(Error)
  expect(readFileSync(paths.serverListFile, 'utf8')).not.toContain('@widgets/probe/server')
})
```

Keep `MissingWidgetEntrypointError` imported because the client missing-entrypoint test still uses it.

- [ ] **Step 3: Run the codegen test again**

```powershell
pnpm test:scripts -- scripts/codegen.test.ts
```

Expected: PASS.

- [ ] **Step 4: Commit the test correction**

```powershell
git add scripts/codegen.test.ts
git commit -m "test: cover optional widget server entrypoints"
```

---

### Task 2: Scaffold the lightweight browser-automation package

**Files:**

- Create: `packages/browser-automation/package.json`
- Create: `packages/browser-automation/tsconfig.json`
- Create: `packages/browser-automation/vitest.config.ts`
- Modify: `pnpm-workspace.yaml`
- Modify: `pnpm-lock.yaml`
- Modify: `scripts/infra.test.ts`

- [ ] **Step 1: Write the failing workspace-package assertion**

Add this constant near the existing root file reads in `scripts/infra.test.ts`:

```ts
const workspace = readFileSync(resolve(root, 'pnpm-workspace.yaml'), 'utf8')
```

Add this test before the Docker assertions:

```ts
it('registers the lightweight browser automation workspace package', () => {
  expect(workspace).toContain('  - packages/browser-automation')
  const manifest = JSON.parse(
    readFileSync(resolve(root, 'packages/browser-automation/package.json'), 'utf8'),
  ) as {
    name: string
    scripts: Record<string, string>
  }

  expect(manifest.name).toBe('browser-automation')
  expect(manifest.scripts).toEqual({
    test: 'vitest run',
    typecheck: 'tsc --noEmit -p tsconfig.json',
  })
})
```

- [ ] **Step 2: Run the infrastructure test and verify it fails**

```powershell
pnpm test:scripts -- scripts/infra.test.ts
```

Expected: FAIL because the workspace entry and package do not exist.

- [ ] **Step 3: Add the package to the workspace**

Add this entry under `packages:` in `pnpm-workspace.yaml`:

```yaml
- packages/browser-automation
```

- [ ] **Step 4: Create the package manifest**

Create `packages/browser-automation/package.json`:

```json
{
  "name": "browser-automation",
  "version": "0.0.0",
  "private": true,
  "type": "module",
  "scripts": {
    "test": "vitest run",
    "typecheck": "tsc --noEmit -p tsconfig.json"
  },
  "dependencies": {
    "errore": "catalog:",
    "zod": "catalog:"
  },
  "devDependencies": {
    "@types/node": "^25.9.3",
    "typescript": "^6.0.3",
    "vitest": "catalog:"
  }
}
```

- [ ] **Step 5: Create the strict TypeScript configuration**

Create `packages/browser-automation/tsconfig.json`:

```json
{
  "compilerOptions": {
    "target": "ES2022",
    "lib": ["ES2022"],
    "module": "ESNext",
    "moduleResolution": "bundler",
    "strict": true,
    "noUnusedLocals": true,
    "noUnusedParameters": true,
    "skipLibCheck": true,
    "noEmit": true,
    "types": ["node", "vitest/globals"],
    "paths": {
      "@shared/*": ["../shared/*"],
      "@widgets/*": ["../widgets/*"]
    }
  },
  "include": ["src"]
}
```

- [ ] **Step 6: Create the Node Vitest configuration**

Create `packages/browser-automation/vitest.config.ts`:

```ts
import path from 'node:path'

import { defineConfig } from 'vitest/config'

export default defineConfig({
  resolve: {
    alias: {
      '@shared': path.resolve(import.meta.dirname, '../shared'),
      '@widgets': path.resolve(import.meta.dirname, '../widgets'),
    },
  },
  test: {
    environment: 'node',
  },
})
```

- [ ] **Step 7: Refresh the workspace lockfile**

```powershell
pnpm install --lockfile-only
```

Expected: exit 0 and a new `packages/browser-automation` importer in `pnpm-lock.yaml`.

- [ ] **Step 8: Run the package integration check**

```powershell
pnpm test:scripts -- scripts/infra.test.ts
```

Expected: PASS. Package typecheck begins in Task 3 after the first source and test
files exist, avoiding TypeScript's no-input diagnostic for an empty `src` tree.

- [ ] **Step 9: Commit the package scaffold**

```powershell
git add pnpm-workspace.yaml pnpm-lock.yaml scripts/infra.test.ts packages/browser-automation/package.json packages/browser-automation/tsconfig.json packages/browser-automation/vitest.config.ts
git commit -m "build: scaffold browser automation package"
```

---

### Task 3: Add widget browser task contracts

**Files:**

- Create: `packages/shared/widgets/browser-contracts.ts`
- Create: `packages/browser-automation/src/tasks/contracts.test.ts`

- [ ] **Step 1: Write the failing contract test**

Create `packages/browser-automation/src/tasks/contracts.test.ts`:

```ts
import {
  defineWidgetBrowser,
  toRuntimeWidgetBrowserDefinition,
  type InferWidgetBrowserTasks,
} from '@shared/widgets/browser-contracts'
import { describe, expect, expectTypeOf, it } from 'vitest'
import { z } from 'zod'

const schemas = {
  check: {
    payload: z.object({ value: z.string().transform(Number) }),
    result: z.object({ echoed: z.number().transform(String) }),
  },
} as const

type Tasks = InferWidgetBrowserTasks<typeof schemas>
type BrowserContext = { runId: string }

describe('widget browser contracts', () => {
  it('infers public input and validated output types from Zod schemas', () => {
    expectTypeOf<Tasks['check']['payload']>().toEqualTypeOf<{ value: string }>()
    expectTypeOf<Tasks['check']['result']>().toEqualTypeOf<{ echoed: string }>()
  })

  it('types handlers with validated payloads and caller-selected context', async () => {
    const definition = defineWidgetBrowser<BrowserContext>()({
      schemas,
      handlers: {
        async check(payload, context) {
          expectTypeOf(payload).toEqualTypeOf<{ value: number }>()
          expectTypeOf(context).toEqualTypeOf<BrowserContext>()
          expect(context.runId).toBe('run-1')
          return { echoed: payload.value }
        },
      },
    })

    expect(await definition.handlers.check({ value: 7 }, { runId: 'run-1' })).toEqual({
      echoed: 7,
    })
  })

  it('injects widget identity only at the runtime boundary', () => {
    const definition = defineWidgetBrowser<BrowserContext>()({
      schemas,
      handlers: {
        check: (payload) => ({ echoed: payload.value }),
      },
    })
    const runtime = toRuntimeWidgetBrowserDefinition({
      widgetId: 'passport-checker',
      definition,
    })

    expect('widgetId' in definition).toBe(false)
    expect(runtime.widgetId).toBe('passport-checker')
    expect(Object.keys(runtime.handlers)).toEqual(['check'])
  })
})
```

- [ ] **Step 2: Run the test and verify it fails**

```powershell
pnpm --filter browser-automation test -- src/tasks/contracts.test.ts
```

Expected: FAIL because `@shared/widgets/browser-contracts` does not exist.

- [ ] **Step 3: Implement the browser contract**

Create `packages/shared/widgets/browser-contracts.ts`:

```ts
import type { z } from 'zod'

import type { InferWidgetEvents, WidgetEventSchemas } from './contracts'

export type WidgetBrowserTaskSchemas = WidgetEventSchemas

export type InferWidgetBrowserTasks<Schemas extends WidgetBrowserTaskSchemas> =
  InferWidgetEvents<Schemas>

type Awaitable<T> = T | Promise<T>

export type WidgetBrowserDefinition<Schemas extends WidgetBrowserTaskSchemas, Context> = {
  schemas: Schemas
  handlers: {
    [Task in keyof Schemas]: (
      payload: z.output<Schemas[Task]['payload']>,
      context: Context,
    ) => Awaitable<Error | z.input<Schemas[Task]['result']>>
  }
}

export type RuntimeWidgetBrowserDefinition<Context> = {
  widgetId: string
  schemas: WidgetBrowserTaskSchemas
  handlers: Record<string, (payload: unknown, context: Context) => Awaitable<Error | unknown>>
}

export function defineWidgetBrowser<Context>() {
  return <const Schemas extends WidgetBrowserTaskSchemas>(
    definition: WidgetBrowserDefinition<Schemas, Context>,
  ) => definition
}

export function toRuntimeWidgetBrowserDefinition<
  const Schemas extends WidgetBrowserTaskSchemas,
  Context,
>({
  widgetId,
  definition,
}: {
  widgetId: string
  definition: WidgetBrowserDefinition<Schemas, Context>
}): RuntimeWidgetBrowserDefinition<Context> {
  return { widgetId, ...definition } as unknown as RuntimeWidgetBrowserDefinition<Context>
}
```

- [ ] **Step 4: Run the contract test and package typecheck**

```powershell
pnpm --filter browser-automation test -- src/tasks/contracts.test.ts
pnpm --filter browser-automation typecheck
```

Expected: both commands PASS.

- [ ] **Step 5: Commit the contract**

```powershell
git add packages/shared/widgets/browser-contracts.ts packages/browser-automation/src/tasks/contracts.test.ts
git commit -m "feat: add widget browser task contracts"
```

---

### Task 4: Build the duplicate-safe browser registry

**Files:**

- Create: `packages/browser-automation/src/tasks/registry.ts`
- Create: `packages/browser-automation/src/tasks/registry.test.ts`

- [ ] **Step 1: Write the failing registry tests**

Create `packages/browser-automation/src/tasks/registry.test.ts`:

```ts
import {
  defineWidgetBrowser,
  toRuntimeWidgetBrowserDefinition,
} from '@shared/widgets/browser-contracts'
import { describe, expect, it } from 'vitest'
import { z } from 'zod'

import { DuplicateWidgetBrowserTaskError, makeWidgetBrowserRegistry } from './registry'

type BrowserContext = { runId: string }

function makeDefinition(widgetId: string) {
  const schema = {
    payload: z.object({ value: z.string() }),
    result: z.object({ echoed: z.string() }),
  }
  const definition = defineWidgetBrowser<BrowserContext>()({
    schemas: { check: schema },
    handlers: { check: (payload) => ({ echoed: payload.value }) },
  })
  return toRuntimeWidgetBrowserDefinition({ widgetId, definition })
}

describe('widget browser registry', () => {
  it('indexes each task under its widget and task IDs', () => {
    const definition = makeDefinition('passport-checker')
    const registry = makeWidgetBrowserRegistry([definition])
    if (registry instanceof Error) throw registry

    const task = registry.get('passport-checker')?.get('check')
    expect(task).toMatchObject({ widgetId: 'passport-checker', taskId: 'check' })
    expect(task?.payloadSchema).toBe(definition.schemas.check.payload)
    expect(task?.resultSchema).toBe(definition.schemas.check.result)
    expect(task?.handler).toBe(definition.handlers.check)
  })

  it('returns a tagged error for a duplicate widget/task pair', () => {
    const first = makeDefinition('passport-checker')
    const second = makeDefinition('passport-checker')
    const result = makeWidgetBrowserRegistry([first, second])

    expect(result).toBeInstanceOf(DuplicateWidgetBrowserTaskError)
    expect(result).toMatchObject({ widgetId: 'passport-checker', taskId: 'check' })
  })

  it('allows the same task ID under different widgets', () => {
    const result = makeWidgetBrowserRegistry([makeDefinition('first'), makeDefinition('second')])

    expect(result).not.toBeInstanceOf(Error)
  })
})
```

- [ ] **Step 2: Run the registry test and verify it fails**

```powershell
pnpm --filter browser-automation test -- src/tasks/registry.test.ts
```

Expected: FAIL because `registry.ts` does not exist.

- [ ] **Step 3: Implement the nested registry and tagged duplicate error**

Create `packages/browser-automation/src/tasks/registry.ts`:

```ts
import type { RuntimeWidgetBrowserDefinition } from '@shared/widgets/browser-contracts'
import * as errore from 'errore'
import type { z } from 'zod'

export class DuplicateWidgetBrowserTaskError extends errore.createTaggedError({
  name: 'DuplicateWidgetBrowserTaskError',
  message: 'Duplicate browser task $widgetId/$taskId',
}) {}

export type RuntimeWidgetBrowserTask<Context> = {
  widgetId: string
  taskId: string
  payloadSchema: z.ZodType
  resultSchema: z.ZodType
  handler: RuntimeWidgetBrowserDefinition<Context>['handlers'][string]
}

export type WidgetBrowserRegistry<Context> = ReadonlyMap<
  string,
  ReadonlyMap<string, RuntimeWidgetBrowserTask<Context>>
>

export function makeWidgetBrowserRegistry<Context>(
  definitions: readonly RuntimeWidgetBrowserDefinition<Context>[],
): DuplicateWidgetBrowserTaskError | WidgetBrowserRegistry<Context> {
  const registry = new Map<string, Map<string, RuntimeWidgetBrowserTask<Context>>>()

  for (const definition of definitions) {
    const tasks =
      registry.get(definition.widgetId) ?? new Map<string, RuntimeWidgetBrowserTask<Context>>()
    registry.set(definition.widgetId, tasks)

    for (const [taskId, schemas] of Object.entries(definition.schemas)) {
      if (tasks.has(taskId)) {
        return new DuplicateWidgetBrowserTaskError({
          widgetId: definition.widgetId,
          taskId,
        })
      }
      tasks.set(taskId, {
        widgetId: definition.widgetId,
        taskId,
        payloadSchema: schemas.payload,
        resultSchema: schemas.result,
        handler: definition.handlers[taskId],
      })
    }
  }

  return registry
}
```

- [ ] **Step 4: Run registry, contract, and type checks**

```powershell
pnpm --filter browser-automation test -- src/tasks/registry.test.ts src/tasks/contracts.test.ts
pnpm --filter browser-automation typecheck
```

Expected: all checks PASS.

- [ ] **Step 5: Commit the registry**

```powershell
git add packages/browser-automation/src/tasks/registry.ts packages/browser-automation/src/tasks/registry.test.ts
git commit -m "feat: add widget browser task registry"
```

---

### Task 5: Add isolated browser entrypoint codegen

**Files:**

- Create: `scripts/codegen/browser.ts`
- Modify: `scripts/codegen/shared.ts`
- Modify: `scripts/codegen/server.ts`
- Modify: `scripts/codegen.test.ts`

- [ ] **Step 1: Write failing browser emitter and generation tests**

Add this import to `scripts/codegen.test.ts`:

```ts
import { emitBrowserList, generateBrowser } from './codegen/browser'
```

Add these emitter tests inside `describe('codegen emitters', ...)`:

```ts
it('emits browser definitions with directory-derived widget IDs', () => {
  const out = emitBrowserList(['clock', 'ofelia-poop-duty'])
  expect(out).toContain("import clock from '@widgets/clock/browser'")
  expect(out).toContain("import ofeliaPoopDuty from '@widgets/ofelia-poop-duty/browser'")
  expect(out).toContain('widgetId: "clock"')
  expect(out).toContain('definition: ofeliaPoopDuty')
})

it('emits a valid empty browser list', () => {
  const out = emitBrowserList([])
  expect(out).toContain('export const widgetBrowserList = [')
  expect(out).not.toContain('@widgets/')
})

it('disambiguates browser bindings with the same camel-case identifier', () => {
  const out = emitBrowserList(['foo-bar', 'fooBar'])
  expect(out).toContain("import fooBar from '@widgets/foo-bar/browser'")
  expect(out).toContain("import fooBar$2 from '@widgets/fooBar/browser'")
})
```

Add these generation tests inside `describe('codegen generation', ...)`:

```ts
it('discovers browser.ts without executing any widget entrypoint', () => {
  const paths = createTempCodegenPaths('browser-isolation')
  const widgetDir = join(paths.widgetsDir, 'probe')
  writeFileSync(join(widgetDir, 'browser.ts'), "throw new Error('must not import browser')")
  writeFileSync(join(widgetDir, 'client.ts'), "throw new Error('must not import client')")
  writeFileSync(join(widgetDir, 'server.ts'), "throw new Error('must not import server')")

  expect(generateBrowser(paths)).not.toBeInstanceOf(Error)
  const output = readFileSync(paths.browserListFile, 'utf8')
  expect(output).toContain('@widgets/probe/browser')
  expect(output).not.toContain('@widgets/probe/client')
  expect(output).not.toContain('@widgets/probe/server')
})

it('omits widgets without an optional browser.ts entrypoint', () => {
  const paths = createTempCodegenPaths('browser-optional')
  expect(generateBrowser(paths)).not.toBeInstanceOf(Error)
  expect(readFileSync(paths.browserListFile, 'utf8')).not.toContain('@widgets/probe/browser')
})

it('orders discovered browser entrypoints deterministically', () => {
  const paths = createTempCodegenPaths('browser-order')
  for (const widgetId of ['zeta', 'alpha']) {
    const widgetDir = join(paths.widgetsDir, widgetId)
    mkdirSync(widgetDir, { recursive: true })
    writeFileSync(join(widgetDir, 'package.json'), JSON.stringify({ name: `widgets-${widgetId}` }))
    writeFileSync(join(widgetDir, 'browser.ts'), 'export default {}')
  }

  expect(generateBrowser(paths)).not.toBeInstanceOf(Error)
  const output = readFileSync(paths.browserListFile, 'utf8')
  expect(output.indexOf('@widgets/alpha/browser')).toBeLessThan(
    output.indexOf('@widgets/zeta/browser'),
  )
})
```

Extend `createTempCodegenPaths` with:

```ts
browserListFile: join(root, 'widget-browser-list.generated.ts'),
```

- [ ] **Step 2: Run the codegen test and verify it fails**

```powershell
pnpm test:scripts -- scripts/codegen.test.ts
```

Expected: FAIL because `scripts/codegen/browser.ts` and `browserListFile` types do not exist.

- [ ] **Step 3: Extend shared codegen paths and extract collision-safe bindings**

In `scripts/codegen/shared.ts`, add `browserListFile` to `CodegenPaths`, add the focused path type, and keep the target union unchanged until Task 6:

```ts
export type CodegenPaths = {
  widgetsDir: string
  portsFile: string
  clientCatalogFile: string
  clientIconsFile: string
  serverListFile: string
  browserListFile: string
}

export type BrowserCodegenPaths = Pick<CodegenPaths, 'widgetsDir' | 'browserListFile'>
```

Add this path to `defaultCodegenPaths`:

```ts
browserListFile: path.resolve(
  packagesDir,
  'browser-automation/src/tasks/widget-browser-list.generated.ts',
),
```

Add this shared helper after `identifierFromDirectory`:

```ts
export function uniqueBindings(directories: string[]) {
  const counts = new Map<string, number>()
  return directories.map((dir) => {
    const base = identifierFromDirectory(dir)
    const count = (counts.get(base) ?? 0) + 1
    counts.set(base, count)
    return { dir, identifier: count === 1 ? base : `${base}$${count}` }
  })
}
```

- [ ] **Step 4: Reuse the shared binding helper in server codegen**

In `scripts/codegen/server.ts`, replace the `identifierFromDirectory` import with `uniqueBindings`, and delete the file-local `uniqueBindings` function. Keep `prepareServer` unchanged so widgets without `server.ts` remain omitted.

The import block must include:

```ts
import {
  BANNER,
  discoverWidgetDirs,
  uniqueBindings,
  writeGeneratedOutputs,
  type ServerCodegenPaths,
} from './shared'
```

- [ ] **Step 5: Implement browser codegen**

Create `scripts/codegen/browser.ts`:

```ts
import fs from 'node:fs'
import path from 'node:path'

import {
  BANNER,
  discoverWidgetDirs,
  uniqueBindings,
  writeGeneratedOutputs,
  type BrowserCodegenPaths,
} from './shared'

export function emitBrowserList(widgetDirs: string[]) {
  if (widgetDirs.length === 0) {
    return `${BANNER}export const widgetBrowserList = [
]
`
  }
  const bindings = uniqueBindings(widgetDirs)
  const imports = bindings
    .map(({ dir, identifier }) => `import ${identifier} from '@widgets/${dir}/browser'`)
    .join('\n')
  const list = bindings
    .map(
      ({ dir, identifier }) => `  toRuntimeWidgetBrowserDefinition({
    widgetId: ${JSON.stringify(dir)},
    definition: ${identifier},
  })`,
    )
    .join(',\n')
  return `${BANNER}import { toRuntimeWidgetBrowserDefinition } from '@shared/widgets/browser-contracts'
${imports}

export const widgetBrowserList = [
${list}
]
`
}

export function prepareBrowser({ widgetsDir, browserListFile }: BrowserCodegenPaths) {
  const widgetDirs = discoverWidgetDirs(widgetsDir)
  if (widgetDirs instanceof Error) return widgetDirs
  const browserWidgetDirs = widgetDirs.filter((dir) =>
    fs.existsSync(path.resolve(widgetsDir, dir, 'browser.ts')),
  )
  return [{ file: browserListFile, content: emitBrowserList(browserWidgetDirs) }]
}

export function generateBrowser(paths: BrowserCodegenPaths) {
  const outputs = prepareBrowser(paths)
  if (outputs instanceof Error) return outputs
  return writeGeneratedOutputs(outputs)
}
```

- [ ] **Step 6: Run focused codegen tests**

```powershell
pnpm test:scripts -- scripts/codegen.test.ts
```

Expected: PASS, including unchanged client/server emitter and generation tests.

- [ ] **Step 7: Commit browser discovery and emission**

```powershell
git add scripts/codegen/browser.ts scripts/codegen/shared.ts scripts/codegen/server.ts scripts/codegen.test.ts
git commit -m "build: generate widget browser entrypoints"
```

---

### Task 6: Wire browser codegen into commands and repository documentation

**Files:**

- Modify: `scripts/codegen.ts`
- Modify: `scripts/codegen/shared.ts`
- Modify: `scripts/codegen.test.ts`
- Modify: `scripts/infra.test.ts`
- Modify: `package.json`
- Modify: `.gitignore`
- Modify: `AGENTS.md`

- [ ] **Step 1: Write failing target and command assertions**

Extend the target parser test in `scripts/codegen.test.ts`:

```ts
it('parses supported targets and rejects unknown targets', () => {
  expect(parseCodegenTarget('invalid')).toBeInstanceOf(InvalidCodegenTargetError)
  expect(parseCodegenTarget('server')).toBe('server')
  expect(parseCodegenTarget('browser')).toBe('browser')
})
```

Add these constants in `scripts/infra.test.ts`:

```ts
const gitignore = readFileSync(resolve(root, '.gitignore'), 'utf8')
const rootCodegen = readFileSync(resolve(root, 'scripts/codegen.ts'), 'utf8')
```

Add this test:

```ts
it('wires browser codegen as an isolated target and into combined codegen', () => {
  expect(rootPackage.scripts['codegen:browser']).toBe('tsx scripts/codegen.ts browser')
  expect(rootCodegen).toContain("if (target === 'browser') return generateBrowser")
  expect(rootCodegen).toContain('const browserOutputs = prepareBrowser(defaultCodegenPaths)')
  expect(rootCodegen).toContain(
    'writeGeneratedOutputs([...clientOutputs, ...serverOutputs, ...browserOutputs])',
  )
  expect(gitignore).toContain(
    'packages/browser-automation/src/tasks/widget-browser-list.generated.ts',
  )
})
```

- [ ] **Step 2: Run script tests and verify they fail**

```powershell
pnpm test:scripts -- scripts/codegen.test.ts scripts/infra.test.ts
```

Expected: FAIL because the parser, CLI, root script, and ignore rule do not include browser codegen.

- [ ] **Step 3: Add the browser target to shared parsing**

In `scripts/codegen/shared.ts`, replace the target type and parser with:

```ts
export type CodegenTarget = 'client' | 'server' | 'browser' | 'all'

export function parseCodegenTarget(raw: string): InvalidCodegenTargetError | CodegenTarget {
  if (raw === 'client' || raw === 'server' || raw === 'browser' || raw === 'all') return raw
  return new InvalidCodegenTargetError({ target: raw })
}
```

- [ ] **Step 4: Replace the root CLI with browser-aware atomic coordination**

Replace `scripts/codegen.ts` with:

```ts
import { generateBrowser, prepareBrowser } from './codegen/browser'
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
  if (target === 'browser') return generateBrowser(defaultCodegenPaths)

  const clientOutputs = await prepareClient(defaultCodegenPaths)
  if (clientOutputs instanceof Error) return clientOutputs
  const serverOutputs = prepareServer(defaultCodegenPaths)
  if (serverOutputs instanceof Error) return serverOutputs
  const browserOutputs = prepareBrowser(defaultCodegenPaths)
  if (browserOutputs instanceof Error) return browserOutputs
  return writeGeneratedOutputs([...clientOutputs, ...serverOutputs, ...browserOutputs])
}

async function main() {
  const target = parseCodegenTarget(process.argv[2] ?? 'all')
  const result = target instanceof Error ? target : await run(target)
  if (result instanceof Error) {
    console.error(result)
    process.exitCode = 1
  }
}

void main()
```

- [ ] **Step 5: Add the root command and generated-file ignore rule**

Add this script to `package.json` beside the other codegen scripts:

```json
"codegen:browser": "tsx scripts/codegen.ts browser"
```

Add this exact line under the generated-registry section in `.gitignore`:

```text
packages/browser-automation/src/tasks/widget-browser-list.generated.ts
```

- [ ] **Step 6: Document the new boundary in AGENTS.md**

Update the package overview so it includes `browser-automation` as the future browser service and generated-task-registry owner.

Add this command bullet:

```markdown
- `pnpm codegen:browser`: generate the browser task registry from optional widget-root `browser.ts` entrypoints without loading widget modules.
```

Change the combined command bullet to:

```markdown
- `pnpm codegen`: run client, server, and browser generators for workspace-wide gates.
```

Extend the canonical entrypoint paragraph with:

```markdown
A widget may optionally add a root `browser.ts` that default-exports its browser definition without a `widgetId`; browser codegen injects the directory basename.
```

- [ ] **Step 7: Generate the empty production list and run integration checks**

```powershell
pnpm run codegen:browser
pnpm test:scripts -- scripts/codegen.test.ts scripts/infra.test.ts
pnpm --filter browser-automation test
pnpm --filter browser-automation typecheck
```

Expected: all commands PASS. The generated list is empty because no production widget has `browser.ts`, and `git status --short` does not show the ignored generated file.

- [ ] **Step 8: Commit command and documentation integration**

```powershell
git add scripts/codegen.ts scripts/codegen/shared.ts scripts/codegen.test.ts scripts/infra.test.ts package.json .gitignore AGENTS.md
git commit -m "build: wire browser task codegen"
```

---

### Task 7: Run full verification

**Files:**

- Verify only; modify files only for failures introduced by Tasks 2–6.

- [ ] **Step 1: Confirm generated output stability**

```powershell
pnpm run codegen
git status --short
pnpm run codegen
git status --short
```

Expected: both codegen runs exit 0; the second run produces no additional tracked changes; all generated registries remain ignored.

- [ ] **Step 2: Run focused script and package tests**

```powershell
pnpm test:scripts -- scripts/codegen.test.ts scripts/infra.test.ts
pnpm --filter browser-automation test
```

Expected: PASS.

- [ ] **Step 3: Run focused package typecheck**

```powershell
pnpm --filter browser-automation typecheck
```

Expected: PASS with no Playwright dependency installed or imported.

- [ ] **Step 4: Run workspace tests**

```powershell
pnpm test
```

Expected: PASS across scripts and all workspace packages.

- [ ] **Step 5: Run workspace typechecks**

```powershell
pnpm typecheck
```

Expected: PASS across all workspace packages, including the generated browser list.

- [ ] **Step 6: Build existing client and server artifacts**

```powershell
pnpm build
pnpm run codegen:server
pnpm --filter server build
```

Expected: client/widget builds and the server build PASS; neither build imports Playwright or executes browser entrypoints.

- [ ] **Step 7: Inspect the final repository state**

```powershell
git diff --check
git status --short
git log -6 --oneline
```

Expected: no whitespace errors, no tracked generated registries, and the six focused implementation commits from Tasks 1–6 are present. If a verification failure was caused by this plan, add a focused regression test, apply the smallest fix, rerun the failed command plus the focused package checks, and commit only those repair files with a conventional `fix:` message.
