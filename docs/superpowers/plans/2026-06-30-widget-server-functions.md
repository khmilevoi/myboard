# Widget Server Functions Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add typed, Zod-validated widget RPC infrastructure with isolated client/server entrypoints and server-side access to instance- and type-scoped storage.

**Architecture:** Every widget exports an explicit client definition, server definition, and shared event contract. The client host injects a type-safe API bound to the widget type and placement; the server route dispatches through an explicit registry, validates payloads and results, and gives handlers a restricted storage capability. The existing Storage API remains unchanged and supported.

**Tech Stack:** TypeScript 6, React 19, Reatom v1001, Zod 4, errore, find-my-way, Vitest 4, Vite 8, Rspack 1

---

## Preconditions

- Execute from `C:\Users\Khmil\JsProjects\myboard`.
- Preserve the user's uncommitted move from `client/widgets` to root `widgets`.
- Preserve the existing `@widgets` aliases in client Vite/TypeScript and server Rspack/TypeScript configuration.
- Run every `pnpm`, `node`, `npm`, and `corepack` command outside the default sandbox as required by `AGENTS.md`.
- Do not stage unrelated user changes. Each commit command below lists only files owned by that task.

## File Map

### Shared contracts

- Create `shared/widgets/contracts.ts`: event-schema inference, typed client API, server handler/context/storage contracts, and typed server-definition helper.
- Create `shared/storage/scope.ts`: shared widget namespace/key helpers.
- Modify `client/src/storage/model/scope.ts`: re-export the shared scope helpers so current imports remain stable.

### Client

- Create `client/src/widget-api/widget-api.ts`: bound HTTP transport and `WidgetApiError`.
- Create `client/src/widget-api/widget-api.test.ts`: transport, envelope, and type-inference tests.
- Create `client/src/widget-registry/model/widget-definition.ts`: client definition types, lazy-loader caching, and controlled generic erasure.
- Create `client/src/widget-registry/model/widget-definition.test.ts`: loader caching and retry tests.
- Modify `client/src/widget-registry/model/registry.ts`: consume explicit widget client definitions.
- Modify `client/src/widget-host/model/types.ts`: make runtime props/loaders event-map aware and add `api`.
- Modify `client/src/widget-host/ui/WidgetFrame.context.ts`: expose the API through context.
- Modify `client/src/widget-host/ui/WidgetFrame.tsx`: construct one bound API per widget placement and pass it through props/context.
- Modify `client/src/widget-host/ui/WidgetFrame.test.tsx`: verify the API is bound and shared between props/context.
- Modify `client/vite.config.ts`: include root widget tests in Vitest discovery.
- Modify `client/tsconfig.json`: include `../widgets` in typechecking.
- Modify `client/Dockerfile`: copy root widgets into the client build image.

### Widgets

- Create `widgets/clock/types.ts`, `widgets/clock/client.ts`, and `widgets/clock/server.ts`.
- Create `widgets/ofelia-poop-duty/types.ts`, `widgets/ofelia-poop-duty/client.ts`, and `widgets/ofelia-poop-duty/server.ts`.
- Modify `widgets/clock/ui/Clock.tsx` and `widgets/ofelia-poop-duty/ui/OfeliaPoopDuty.tsx`: use their concrete event-map props.

### Server

- Modify `server/package.json` and `pnpm-lock.yaml`: add `errore` to the server package.
- Create `server/src/widgets/storage.ts` and `storage.test.ts`: scoped server storage adapter.
- Create `server/src/widgets/errors.ts`: safe tagged dispatch errors and HTTP metadata.
- Create `server/src/widgets/registry.ts` and `registry.test.ts`: explicit runtime registry with duplicate detection.
- Create `server/src/widgets/dispatch.ts` and `dispatch.test.ts`: lookup, Zod validation, handler execution, and result validation.
- Create `server/src/widgets/production-registry.ts`: explicit imports of widget server definitions.
- Modify `server/src/app.ts` and `server/src/app.test.ts`: add the RPC route and integration tests.
- Modify `server/src/index.ts` and `server/src/test-server.ts`: inject the production registry.
- Modify `server/vitest.config.ts`: add the `@widgets` alias used by production-registry tests.
- Modify `server/rspack.config.ts`: bundle `@widgets` imports instead of externalizing them.
- Modify `server/Dockerfile`: copy root widgets into the server build image.

---

### Task 1: Shared event and server-definition contracts

**Files:**

- Create: `shared/widgets/contracts.ts`
- Create: `server/src/widgets/contracts.test.ts`
- Modify: `server/package.json`
- Modify: `pnpm-lock.yaml`

- [ ] **Step 1: Add errore to the server package**

Run:

```powershell
pnpm --filter server add errore@^0.14.1
```

Expected: `server/package.json` contains `"errore": "^0.14.1"` and the lockfile records the server importer dependency.

- [ ] **Step 2: Write the failing shared-contract test**

Create `server/src/widgets/contracts.test.ts`:

```ts
import { describe, expect, expectTypeOf, it } from 'vitest'
import { z } from 'zod'

import {
  defineWidgetServer,
  type InferWidgetEvents,
  type WidgetServerContext,
} from '@shared/widgets/contracts'

const schemas = {
  echo: {
    payload: z.object({ value: z.string() }),
    result: z.object({ echoed: z.string() }),
  },
} as const

type Events = InferWidgetEvents<typeof schemas>

describe('widget contracts', () => {
  it('infers the client payload and result from Zod schemas', () => {
    expectTypeOf<Events['echo']['payload']>().toEqualTypeOf<{ value: string }>()
    expectTypeOf<Events['echo']['result']>().toEqualTypeOf<{ echoed: string }>()
  })

  it('keeps server handlers aligned with the schemas', async () => {
    const definition = defineWidgetServer({
      typeId: 'test-widget',
      schemas,
      handlers: {
        echo(payload, context: WidgetServerContext) {
          expect(context.typeId).toBe('test-widget')
          return { echoed: payload.value }
        },
      },
    })

    expect(definition.typeId).toBe('test-widget')
    expect(Object.keys(definition.handlers)).toEqual(['echo'])
  })
})
```

- [ ] **Step 3: Run the test and verify the missing module failure**

Run:

```powershell
pnpm --filter server test -- src/widgets/contracts.test.ts
```

Expected: FAIL because `@shared/widgets/contracts` does not exist.

- [ ] **Step 4: Implement the neutral shared contracts**

Create `shared/widgets/contracts.ts`:

```ts
import type { z } from 'zod'

export type WidgetEventSchemas = Record<
  string,
  {
    payload: z.ZodType
    result: z.ZodType
  }
>

export type WidgetEventMap = Record<
  string,
  {
    payload: unknown
    result: unknown
  }
>

export type InferWidgetEvents<Schemas extends WidgetEventSchemas> = {
  [Event in keyof Schemas]: {
    payload: z.input<Schemas[Event]['payload']>
    result: z.output<Schemas[Event]['result']>
  }
}

export type WidgetApi<Events extends WidgetEventMap, ApiError extends Error = Error> = {
  invoke<Event extends keyof Events & string>(
    event: Event,
    payload: Events[Event]['payload'],
  ): Promise<ApiError | Events[Event]['result']>
}

export type WidgetServerStorage = {
  get<T>(key: string, schema?: z.ZodType<T>): Promise<Error | T | null>
  set<T>(key: string, value: T, options?: { ttlMs?: number }): Promise<Error | void>
  delete(key: string): Promise<Error | void>
  has(key: string): Promise<Error | boolean>
  keys(prefix?: string): Promise<Error | string[]>
  append<T extends Record<string, unknown>>(
    key: string,
    entry: T,
    options?: { cap?: number },
  ): Promise<Error | void>
}

export type WidgetServerContext = {
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

type Awaitable<T> = T | Promise<T>

export type WidgetServerDefinition<Schemas extends WidgetEventSchemas> = {
  typeId: string
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

export function toRuntimeWidgetServerDefinition<const Schemas extends WidgetEventSchemas>(
  definition: WidgetServerDefinition<Schemas>,
): RuntimeWidgetServerDefinition {
  return definition as unknown as RuntimeWidgetServerDefinition
}
```

- [ ] **Step 5: Run the contract test**

Run:

```powershell
pnpm --filter server test -- src/widgets/contracts.test.ts
```

Expected: PASS with 2 tests.

- [ ] **Step 6: Commit the shared contracts**

```powershell
git add -- shared/widgets/contracts.ts server/src/widgets/contracts.test.ts server/package.json pnpm-lock.yaml
git commit -m "feat: add widget event contracts"
```

---

### Task 2: Typed bound client transport

**Files:**

- Create: `client/src/widget-api/widget-api.ts`
- Create: `client/src/widget-api/widget-api.test.ts`
- Modify: `client/src/widget-host/model/types.ts`
- Modify: `client/src/widget-host/ui/WidgetFrame.context.ts`
- Modify: `client/src/widget-host/ui/WidgetFrame.tsx`
- Modify: `client/src/widget-host/ui/WidgetFrame.test.tsx`

- [ ] **Step 1: Write failing transport and type tests**

Create `client/src/widget-api/widget-api.test.ts`:

```ts
import { describe, expect, expectTypeOf, it, vi } from 'vitest'

import { makeWidgetApi, WidgetApiError } from './widget-api'

type TestEvents = {
  save: {
    payload: { value: string }
    result: { id: string }
  }
}

describe('makeWidgetApi', () => {
  it('binds type and instance identity and returns typed data', async () => {
    const fetchRequest = vi.fn(
      async () =>
        new Response(JSON.stringify({ data: { id: 'entry-1' } }), {
          status: 200,
          headers: { 'content-type': 'application/json' },
        }),
    )
    const api = makeWidgetApi<TestEvents>({
      typeId: 'notes/widget',
      instanceId: 'placement-1',
      fetch: fetchRequest,
    })

    const result = await api.invoke('save', { value: 'hello' })

    expectTypeOf(result).toEqualTypeOf<WidgetApiError | { id: string }>()
    expect(result).toEqual({ id: 'entry-1' })
    expect(fetchRequest).toHaveBeenCalledWith('/api/widgets/notes%2Fwidget/save', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ instanceId: 'placement-1', payload: { value: 'hello' } }),
    })
  })

  it('returns WidgetApiError for a safe server error envelope', async () => {
    const api = makeWidgetApi<TestEvents>({
      typeId: 'notes',
      instanceId: 'placement-1',
      fetch: async () =>
        new Response(
          JSON.stringify({
            error: { code: 'payload_invalid', message: 'Widget event payload is invalid' },
          }),
          { status: 422 },
        ),
    })

    const result = await api.invoke('save', { value: 'hello' })

    expect(result).toBeInstanceOf(WidgetApiError)
    expect((result as WidgetApiError).message).toContain('payload_invalid')
  })

  it('wraps network rejection as WidgetApiError with a cause', async () => {
    const cause = new Error('offline')
    const api = makeWidgetApi<TestEvents>({
      typeId: 'notes',
      instanceId: 'placement-1',
      fetch: async () => Promise.reject(cause),
    })

    const result = await api.invoke('save', { value: 'hello' })

    expect(result).toBeInstanceOf(WidgetApiError)
    expect((result as WidgetApiError).cause).toBe(cause)
  })
})
```

- [ ] **Step 2: Run the client test and verify the missing module failure**

Run:

```powershell
pnpm --filter client test -- src/widget-api/widget-api.test.ts
```

Expected: FAIL because `./widget-api` does not exist.

- [ ] **Step 3: Implement the bound transport**

Create `client/src/widget-api/widget-api.ts`:

```ts
import * as errore from 'errore'
import { z } from 'zod'

import type { WidgetApi, WidgetEventMap } from '@shared/widgets/contracts'

const WidgetApiEnvelopeSchema = z.union([
  z.object({ data: z.unknown() }),
  z.object({
    error: z.object({
      code: z.string(),
      message: z.string(),
    }),
  }),
])

export class WidgetApiError extends errore.createTaggedError({
  name: 'WidgetApiError',
  message: 'Widget API request failed: $reason',
}) {}

export type MakeWidgetApiOptions = {
  typeId: string
  instanceId: string
  fetch?: typeof globalThis.fetch
}

export function makeWidgetApi<Events extends WidgetEventMap>({
  typeId,
  instanceId,
  fetch: fetchRequest = globalThis.fetch,
}: MakeWidgetApiOptions): WidgetApi<Events, WidgetApiError> {
  return {
    async invoke<Event extends keyof Events & string>(
      event: Event,
      payload: Events[Event]['payload'],
    ): Promise<WidgetApiError | Events[Event]['result']> {
      const body = errore.try(
        () => JSON.stringify({ instanceId, payload }),
        (cause) => new WidgetApiError({ reason: 'request serialization failed', cause }),
      )
      if (body instanceof Error) return body

      const url = `/api/widgets/${encodeURIComponent(typeId)}/${encodeURIComponent(event)}`
      const response = await fetchRequest(url, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body,
      }).catch((cause) => new WidgetApiError({ reason: 'network request failed', cause }))
      if (response instanceof Error) return response

      const raw = await (response.json() as Promise<unknown>).catch(
        (cause) => new WidgetApiError({ reason: 'response JSON is invalid', cause }),
      )
      if (raw instanceof Error) return raw

      const envelope = WidgetApiEnvelopeSchema.safeParse(raw)
      if (!envelope.success) {
        return new WidgetApiError({ reason: 'response envelope is invalid', cause: envelope.error })
      }

      if ('error' in envelope.data) {
        return new WidgetApiError({
          reason: `${envelope.data.error.code}: ${envelope.data.error.message}`,
        })
      }
      if (!response.ok) return new WidgetApiError({ reason: `HTTP ${response.status}` })

      return envelope.data.data as Events[Event]['result']
    },
  }
}
```

- [ ] **Step 4: Add the typed API to widget runtime props**

Modify `client/src/widget-host/model/types.ts` so its public types are:

```ts
import type { ComponentType } from 'react'

import type { WidgetApi, WidgetEventMap } from '@shared/widgets/contracts'

import type { ResolvedTheme } from '@/shared/theme/types'
import type { WidgetStorage } from '@/storage/model/storage'
import type { WidgetApiError } from '@/widget-api/widget-api'

import type { WidgetTier } from './tier'

export type WidgetMode = 'small' | 'large'

export type WidgetRuntimeProps<Events extends WidgetEventMap = WidgetEventMap> = {
  instanceId: string
  typeId: string
  mode: WidgetMode
  tier: WidgetTier
  theme: ResolvedTheme
  requestFullscreen: () => void
  requestClose: () => void
  requestDelete: () => void
  reportError: (error: Error) => void
  storage: WidgetStorage
  api: WidgetApi<Events, WidgetApiError>
}

export type WidgetComponent<Events extends WidgetEventMap = WidgetEventMap> = ComponentType<
  WidgetRuntimeProps<Events>
>
export type WidgetComponentModule<Events extends WidgetEventMap = WidgetEventMap> = {
  default: WidgetComponent<Events>
}
export type WidgetLoader<Events extends WidgetEventMap = WidgetEventMap> = () => Promise<
  WidgetComponentModule<Events>
>
```

- [ ] **Step 5: Add a failing host-binding test**

Add this import to `client/src/widget-host/ui/WidgetFrame.test.tsx`:

```ts
import { useWidgetFrameContext } from './WidgetFrame.context'
```

Add this test:

```tsx
it('passes one type- and instance-bound API through props and context', async () => {
  const fetchRequest = vi.fn(
    async () => new Response(JSON.stringify({ data: { ok: true } }), { status: 200 }),
  )
  vi.stubGlobal('fetch', fetchRequest)

  const Probe = (props: WidgetRuntimeProps) => {
    const context = useWidgetFrameContext()
    return (
      <button onClick={() => props.api.invoke('probe', { value: 1 })}>
        {props.api === context.api ? 'same-api' : 'different-api'}
      </button>
    )
  }
  vi.mocked(findWidgetType).mockReturnValue({
    id: 'probe/type',
    title: 'Probe',
    description: 'probe widget',
    loadComponent: async () => ({ default: Probe }),
    defaultSize: { w: 1, h: 1 },
    icon: 'Clock',
  })

  render(<WidgetFrame instanceId="instance-7" typeId="probe/type" mode="small" />)
  fireEvent.click(await screen.findByRole('button', { name: 'same-api' }))

  await vi.waitFor(() => {
    expect(fetchRequest).toHaveBeenCalledWith(
      '/api/widgets/probe%2Ftype/probe',
      expect.objectContaining({
        body: JSON.stringify({ instanceId: 'instance-7', payload: { value: 1 } }),
      }),
    )
  })
  vi.unstubAllGlobals()
})
```

- [ ] **Step 6: Run transport and host tests and verify host failure**

Run:

```powershell
pnpm --filter client test -- src/widget-api/widget-api.test.ts src/widget-host/ui/WidgetFrame.test.tsx
```

Expected: transport tests PASS and the new WidgetFrame test FAILS because the
host does not yet construct or provide `api`.

- [ ] **Step 7: Add API to context and WidgetFrame**

In `WidgetFrame.context.ts`, import `WidgetApi`, `WidgetEventMap`, and
`WidgetApiError`, then add this field to `WidgetFrameContext`:

```ts
api: WidgetApi<WidgetEventMap, WidgetApiError>
```

In `WidgetFrame.tsx`, import `makeWidgetApi` and create the bound API next to
`widgetStorage`:

```ts
const widgetApi = useMemo(() => {
  return makeWidgetApi({ instanceId, typeId })
}, [instanceId, typeId])
```

Add `api: widgetApi` to the context value, add `widgetApi` to its dependency
array, and pass `api={context.api}` to `LazyWidget`.

- [ ] **Step 8: Run transport, host tests, and client typecheck**

Run:

```powershell
pnpm --filter client test -- src/widget-api/widget-api.test.ts src/widget-host/ui/WidgetFrame.test.tsx
pnpm --filter client typecheck
```

Expected: both test files PASS and client typecheck exits 0.

- [ ] **Step 9: Commit the transport and host integration**

```powershell
git add -- client/src/widget-api/widget-api.ts client/src/widget-api/widget-api.test.ts client/src/widget-host/model/types.ts client/src/widget-host/ui/WidgetFrame.context.ts client/src/widget-host/ui/WidgetFrame.tsx client/src/widget-host/ui/WidgetFrame.test.tsx
git commit -m "feat: inject typed widget client api"
```

---

### Task 3: Explicit widget client/server entrypoints and client registry

**Files:**

- Create: `client/src/widget-registry/model/widget-definition.ts`
- Create: `client/src/widget-registry/model/widget-definition.test.ts`
- Create: `widgets/clock/types.ts`
- Create: `widgets/clock/client.ts`
- Create: `widgets/clock/server.ts`
- Create: `widgets/ofelia-poop-duty/types.ts`
- Create: `widgets/ofelia-poop-duty/client.ts`
- Create: `widgets/ofelia-poop-duty/server.ts`
- Modify: `widgets/clock/ui/Clock.tsx`
- Modify: `widgets/ofelia-poop-duty/ui/OfeliaPoopDuty.tsx`
- Modify: `client/src/widget-registry/model/registry.ts`
- Modify: `client/vite.config.ts`
- Modify: `client/tsconfig.json`
- Modify: `client/Dockerfile`

- [ ] **Step 1: Make root widget tests discoverable**

In `client/vite.config.ts`, add `include` to the existing `test` block:

```ts
include: [
  'src/**/*.{test,spec}.?(c|m)[jt]s?(x)',
  '../widgets/**/*.{test,spec}.?(c|m)[jt]s?(x)',
],
```

In `client/tsconfig.json`, replace the current include array with:

```json
"include": ["src", "../widgets", "tests"]
```

In `client/Dockerfile`, add this beside `COPY shared ./shared`:

```dockerfile
COPY widgets ./widgets
```

- [ ] **Step 2: Write the failing client-definition test**

Create `client/src/widget-registry/model/widget-definition.test.ts`:

```ts
import { describe, expect, it, vi } from 'vitest'

import { defineWidgetClient, toWidgetType } from './widget-definition'

describe('widget client definition', () => {
  it('caches a successful component load', async () => {
    const component = () => null
    const loader = vi.fn(async () => ({ default: component }))
    const type = toWidgetType(
      defineWidgetClient({
        id: 'probe',
        title: 'Probe',
        description: 'Probe widget',
        icon: 'Clock',
        defaultSize: { w: 1, h: 1 },
        loadComponent: loader,
      }),
    )

    await type.loadComponent()
    await type.loadComponent()

    expect(loader).toHaveBeenCalledTimes(1)
  })

  it('allows retry after a rejected component load', async () => {
    const component = () => null
    const loader = vi
      .fn<() => Promise<{ default: typeof component }>>()
      .mockRejectedValueOnce(new Error('chunk failed'))
      .mockResolvedValueOnce({ default: component })
    const type = toWidgetType(
      defineWidgetClient({
        id: 'probe',
        title: 'Probe',
        description: 'Probe widget',
        icon: 'Clock',
        defaultSize: { w: 1, h: 1 },
        loadComponent: loader,
      }),
    )

    await expect(type.loadComponent()).rejects.toThrow('chunk failed')
    await expect(type.loadComponent()).resolves.toEqual({ default: component })
    expect(loader).toHaveBeenCalledTimes(2)
  })
})
```

- [ ] **Step 3: Run the definition test and verify the missing module failure**

Run:

```powershell
pnpm --filter client test -- src/widget-registry/model/widget-definition.test.ts
```

Expected: FAIL because `./widget-definition` does not exist.

- [ ] **Step 4: Implement the client-definition boundary**

Move `WidgetIconName`, `WidgetType`, `IdleDeadline`, `WindowWithIdleCallback`, and lazy-loader logic from `registry.ts` into `client/src/widget-registry/model/widget-definition.ts`. Export these shapes and helpers:

```ts
import type { WidgetEventMap } from '@shared/widgets/contracts'

import type { TierConfig } from '@/widget-host/model/tier'
import type { WidgetComponentModule, WidgetLoader } from '@/widget-host/model/types'

export type WidgetIconName = 'Clock' | 'CalendarDays' | 'Cat'

export type WidgetMetadata = {
  id: string
  title: string
  description: string
  defaultSize: { w: number; h: number; minW?: number; minH?: number }
  tiers?: TierConfig
  icon: WidgetIconName
}

export type WidgetClientDefinition<Events extends WidgetEventMap> = WidgetMetadata & {
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
  definition: WidgetClientDefinition<Events>,
): WidgetType {
  let pending: Promise<WidgetComponentModule> | null = null
  const loader = definition.loadComponent as unknown as WidgetLoader
  const loadComponent = () => {
    pending ??= loader().catch((error: unknown) => {
      pending = null
      throw error
    })
    return pending
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

Keep the idle-window types in `registry.ts` because they are used only by registry preloading.

- [ ] **Step 5: Add empty event contracts and isolated entrypoints**

Create `widgets/clock/types.ts`:

```ts
import type { InferWidgetEvents, WidgetEventSchemas } from '@shared/widgets/contracts'

export const clockEventSchemas = {} as const satisfies WidgetEventSchemas
export type ClockEvents = InferWidgetEvents<typeof clockEventSchemas>
```

Create `widgets/clock/client.ts`:

```ts
import { defineWidgetClient } from '@/widget-registry/model/widget-definition'

import type { ClockEvents } from './types'

export const clockWidget = defineWidgetClient<ClockEvents>({
  id: 'clock',
  title: 'Часы',
  description: 'Текущее время и дата',
  defaultSize: { w: 3, h: 4, minW: 2, minH: 2 },
  icon: 'Clock',
  loadComponent: () => import('./ui/Clock').then(({ Clock }) => ({ default: Clock })),
})
```

Create `widgets/clock/server.ts`:

```ts
import { defineWidgetServer } from '@shared/widgets/contracts'

import { clockEventSchemas } from './types'

export const clockServer = defineWidgetServer({
  typeId: 'clock',
  schemas: clockEventSchemas,
  handlers: {},
})
```

Create `widgets/ofelia-poop-duty/types.ts`:

```ts
import type { InferWidgetEvents, WidgetEventSchemas } from '@shared/widgets/contracts'

export const ofeliaEventSchemas = {} as const satisfies WidgetEventSchemas
export type OfeliaEvents = InferWidgetEvents<typeof ofeliaEventSchemas>
```

Create `widgets/ofelia-poop-duty/client.ts`:

```ts
import { defineWidgetClient } from '@/widget-registry/model/widget-definition'

import type { OfeliaEvents } from './types'

export const ofeliaWidget = defineWidgetClient<OfeliaEvents>({
  id: 'ofelia-poop-duty',
  title: 'Лоток Офелии',
  description: 'Чья сегодня очередь убирать',
  defaultSize: { w: 3, h: 5, minW: 2, minH: 3 },
  icon: 'Cat',
  tiers: {
    tiny: { minWidthPx: 0, minHeightPx: 0 },
    compact: { minWidthPx: 200, minHeightPx: 200 },
    standard: { minWidthPx: 400, minHeightPx: 200 },
    large: { minWidthPx: 500, minHeightPx: 400 },
  },
  loadComponent: () =>
    import('./ui/OfeliaPoopDuty').then(({ OfeliaPoopDuty }) => ({ default: OfeliaPoopDuty })),
})
```

Create `widgets/ofelia-poop-duty/server.ts`:

```ts
import { defineWidgetServer } from '@shared/widgets/contracts'

import { ofeliaEventSchemas } from './types'

export const ofeliaServer = defineWidgetServer({
  typeId: 'ofelia-poop-duty',
  schemas: ofeliaEventSchemas,
  handlers: {},
})
```

- [ ] **Step 6: Give each component its concrete event-map props**

In `widgets/clock/ui/Clock.tsx`, add:

```ts
import type { ClockEvents } from '../types'
```

and change the declaration to:

```ts
export const Clock = reatomMemo<WidgetRuntimeProps<ClockEvents>>(
```

In `widgets/ofelia-poop-duty/ui/OfeliaPoopDuty.tsx`, add:

```ts
import type { OfeliaEvents } from '../types'
```

and change the declaration to:

```ts
export const OfeliaPoopDuty = reatomMemo<WidgetRuntimeProps<OfeliaEvents>>(
```

- [ ] **Step 7: Replace inline registry definitions with explicit client entries**

In `client/src/widget-registry/model/registry.ts`:

- import `clockWidget` from `@widgets/clock/client`;
- import `ofeliaWidget` from `@widgets/ofelia-poop-duty/client`;
- import and re-export `WidgetIconName` and `WidgetType` from `./widget-definition`;
- remove inline metadata, UI imports, and the old lazy-loader helper;
- define the catalog as:

```ts
export const widgetTypes: WidgetType[] = [toWidgetType(clockWidget), toWidgetType(ofeliaWidget)]
```

Keep `preloadWidgetChunks` and `findWidgetType` behavior unchanged.

- [ ] **Step 8: Run registry, definition, and root widget tests**

Run:

```powershell
pnpm --filter client test -- src/widget-registry/model/widget-definition.test.ts src/widget-registry/model/registry.test.ts ../widgets/clock/ui/Clock.test.tsx ../widgets/ofelia-poop-duty/ui/OfeliaPoopDuty.test.tsx
```

Expected: all selected tests PASS and both widgets retain their existing metadata and component loading behavior.

- [ ] **Step 9: Commit the isolated widget entries**

```powershell
git add -- client/src/widget-registry/model/widget-definition.ts client/src/widget-registry/model/widget-definition.test.ts client/src/widget-registry/model/registry.ts client/vite.config.ts client/tsconfig.json client/Dockerfile widgets/clock/types.ts widgets/clock/client.ts widgets/clock/server.ts widgets/clock/ui/Clock.tsx widgets/ofelia-poop-duty/types.ts widgets/ofelia-poop-duty/client.ts widgets/ofelia-poop-duty/server.ts widgets/ofelia-poop-duty/ui/OfeliaPoopDuty.tsx
git commit -m "refactor: isolate widget client and server entries"
```

---

### Task 4: Server-side scoped widget storage

**Files:**

- Create: `shared/storage/scope.ts`
- Modify: `client/src/storage/model/scope.ts`
- Create: `server/src/widgets/storage.ts`
- Create: `server/src/widgets/storage.test.ts`

- [ ] **Step 1: Write failing server storage tests**

Create `server/src/widgets/storage.test.ts` with tests that:

```ts
import { describe, expect, it } from 'vitest'
import { z } from 'zod'

import { createMemoryOps, createMemoryPubSub } from '../test/memory-ops'
import { createWidgetServerApi } from './storage'

describe('createWidgetServerApi', () => {
  it('isolates instance and shared namespaces', async () => {
    const pubsub = createMemoryPubSub()
    const ops = createMemoryOps(pubsub)
    const api = createWidgetServerApi({
      ops,
      typeId: 'clock',
      instanceId: 'placement-1',
      ip: '127.0.0.1',
      now: () => 123,
      createId: () => 'entry-1',
    })

    expect(await api.storage.instance.set('settings', { zone: 'UTC' })).toBeUndefined()
    expect(await api.storage.shared.set('settings', { format: '24h' })).toBeUndefined()
    expect(await ops.get('w:i:placement-1:settings')).toBe('{"zone":"UTC"}')
    expect(await ops.get('w:t:clock:settings')).toBe('{"format":"24h"}')
  })

  it('validates reads and publishes append enrichment', async () => {
    const pubsub = createMemoryPubSub()
    const ops = createMemoryOps(pubsub)
    const messages: string[] = []
    pubsub.subscribe('storage:events', (message) => messages.push(message))
    const api = createWidgetServerApi({
      ops,
      typeId: 'notes',
      instanceId: 'placement-1',
      ip: '10.0.0.7',
      now: () => 456,
      createId: () => 'entry-7',
    })

    expect(await api.storage.shared.append('items', { text: 'hello' })).toBeUndefined()
    expect(
      await api.storage.shared.get(
        'items',
        z.array(z.object({ id: z.string(), ts: z.number(), ip: z.string(), text: z.string() })),
      ),
    ).toEqual([{ id: 'entry-7', ts: 456, ip: '10.0.0.7', text: 'hello' }])
    expect(messages).toEqual([
      JSON.stringify({
        key: 'w:t:notes:items',
        value: [{ id: 'entry-7', ts: 456, ip: '10.0.0.7', text: 'hello' }],
      }),
    ])
  })
})
```

- [ ] **Step 2: Run the storage test and verify the missing module failure**

Run:

```powershell
pnpm --filter server test -- src/widgets/storage.test.ts
```

Expected: FAIL because `./storage` does not exist.

- [ ] **Step 3: Move pure namespace helpers to shared code**

Create `shared/storage/scope.ts` with the current implementation from `client/src/storage/model/scope.ts`:

```ts
export function instanceNamespace(instanceId: string): string {
  return `w:i:${instanceId}:`
}

export function typeNamespace(typeId: string): string {
  return `w:t:${typeId}:`
}

export function toFullKey(namespace: string, relativeKey: string): string {
  return namespace + relativeKey
}

export function toRelativeKey(namespace: string, fullKey: string): string {
  return fullKey.startsWith(namespace) ? fullKey.slice(namespace.length) : fullKey
}
```

Replace `client/src/storage/model/scope.ts` with:

```ts
export { instanceNamespace, typeNamespace, toFullKey, toRelativeKey } from '@shared/storage/scope'
```

- [ ] **Step 4: Implement the server storage adapter**

Create `server/src/widgets/storage.ts`:

```ts
import { randomUUID } from 'node:crypto'

import * as errore from 'errore'
import type { z } from 'zod'

import type { WidgetServerContext, WidgetServerStorage } from '@shared/widgets/contracts'
import { safeParse } from '@shared/json'
import { instanceNamespace, typeNamespace, toFullKey, toRelativeKey } from '@shared/storage/scope'

import { publishChange } from '../storage/handlers'
import { runExclusive } from '../storage/key-lock'
import type { ValkeyOps } from '../storage/valkey'

export class WidgetServerStorageError extends errore.createTaggedError({
  name: 'WidgetServerStorageError',
  message: 'Widget storage $operation failed for $key',
}) {}

export type CreateWidgetServerApiOptions = {
  ops: ValkeyOps
  typeId: string
  instanceId: string
  ip: string | null
  now: () => number
  createId?: () => string
}

function storageError(operation: string, key: string, cause?: unknown) {
  return new WidgetServerStorageError({ operation, key, cause })
}

function serialize(operation: string, key: string, value: unknown) {
  const serialized = errore.try(
    () => JSON.stringify(value),
    (cause) => storageError(operation, key, cause),
  )
  if (serialized instanceof Error) return serialized
  if (serialized === undefined) return storageError(operation, key)
  return serialized
}

export function createWidgetServerApi({
  ops,
  typeId,
  instanceId,
  ip,
  now,
  createId = randomUUID,
}: CreateWidgetServerApiOptions): WidgetServerContext['api'] {
  const createScope = (namespace: string): WidgetServerStorage => ({
    async get<T>(key: string, schema?: z.ZodType<T>) {
      const fullKey = toFullKey(namespace, key)
      const raw = await ops.get(fullKey).catch((cause) => storageError('get', fullKey, cause))
      if (raw instanceof Error) return raw
      if (raw === null) return null

      const parsed = safeParse(raw)
      if (parsed instanceof Error) return storageError('parse', fullKey, parsed)
      if (!schema) return parsed as T

      const validated = schema.safeParse(parsed)
      if (!validated.success) return storageError('validate', fullKey, validated.error)
      return validated.data
    },

    async set<T>(key: string, value: T, options?: { ttlMs?: number }) {
      const fullKey = toFullKey(namespace, key)
      const serialized = serialize('set', fullKey, value)
      if (serialized instanceof Error) return serialized

      const written = await ops
        .set(fullKey, serialized, options?.ttlMs)
        .catch((cause) => storageError('set', fullKey, cause))
      if (written instanceof Error) return written

      const published = await publishChange(ops, fullKey, value).catch((cause) =>
        storageError('publish', fullKey, cause),
      )
      if (published instanceof Error) return published
    },

    async delete(key: string) {
      const fullKey = toFullKey(namespace, key)
      const deleted = await ops
        .del(fullKey)
        .catch((cause) => storageError('delete', fullKey, cause))
      if (deleted instanceof Error) return deleted

      const published = await publishChange(ops, fullKey, null).catch((cause) =>
        storageError('publish', fullKey, cause),
      )
      if (published instanceof Error) return published
    },

    async has(key: string) {
      const fullKey = toFullKey(namespace, key)
      const raw = await ops.get(fullKey).catch((cause) => storageError('has', fullKey, cause))
      if (raw instanceof Error) return raw
      return raw !== null
    },

    async keys(prefix = '') {
      const fullPrefix = toFullKey(namespace, prefix)
      const keys = await ops
        .scanKeys(fullPrefix)
        .catch((cause) => storageError('keys', fullPrefix, cause))
      if (keys instanceof Error) return keys
      return keys.map((key) => toRelativeKey(namespace, key))
    },

    async append<T extends Record<string, unknown>>(
      key: string,
      entry: T,
      options?: { cap?: number },
    ) {
      const fullKey = toFullKey(namespace, key)
      return runExclusive(fullKey, async () => {
        const raw = await ops
          .get(fullKey)
          .catch((cause) => storageError('append.get', fullKey, cause))
        if (raw instanceof Error) return raw

        const parsed = raw === null ? [] : safeParse(raw)
        if (parsed instanceof Error) return storageError('append.parse', fullKey, parsed)
        if (!Array.isArray(parsed)) return storageError('append.shape', fullKey)
        const current: unknown[] = parsed

        const enriched = errore.try(
          () => ({ ...entry, id: createId(), ts: now(), ip }),
          (cause) => storageError('append.enrich', fullKey, cause),
        )
        if (enriched instanceof Error) return enriched

        const next = [...current, enriched]
        const value =
          options?.cap != null && next.length > options.cap
            ? next.slice(next.length - options.cap)
            : next
        const serialized = serialize('append.set', fullKey, value)
        if (serialized instanceof Error) return serialized

        const written = await ops
          .set(fullKey, serialized)
          .catch((cause) => storageError('append.set', fullKey, cause))
        if (written instanceof Error) return written

        const published = await publishChange(ops, fullKey, value).catch((cause) =>
          storageError('publish', fullKey, cause),
        )
        if (published instanceof Error) return published
      })
    },
  })

  return {
    storage: {
      instance: createScope(instanceNamespace(instanceId)),
      shared: createScope(typeNamespace(typeId)),
    },
  }
}
```

- [ ] **Step 5: Run storage and existing scope tests**

Run:

```powershell
pnpm --filter server test -- src/widgets/storage.test.ts
pnpm --filter client test -- src/storage/model/scope.test.ts
```

Expected: both test files PASS.

- [ ] **Step 6: Commit server storage**

```powershell
git add -- shared/storage/scope.ts client/src/storage/model/scope.ts server/src/widgets/storage.ts server/src/widgets/storage.test.ts
git commit -m "feat: add server widget storage api"
```

---

### Task 5: Server registry and dispatcher

**Files:**

- Create: `server/src/widgets/errors.ts`
- Create: `server/src/widgets/registry.ts`
- Create: `server/src/widgets/registry.test.ts`
- Create: `server/src/widgets/dispatch.ts`
- Create: `server/src/widgets/dispatch.test.ts`

- [ ] **Step 1: Write failing registry and dispatcher tests**

Create `server/src/widgets/registry.test.ts`:

```ts
import { describe, expect, it } from 'vitest'

import type { RuntimeWidgetServerDefinition } from '@shared/widgets/contracts'

import { DuplicateWidgetTypeError, UnknownWidgetTypeError } from './errors'
import { createWidgetServerRegistry, findWidgetServer } from './registry'

const definition: RuntimeWidgetServerDefinition = {
  typeId: 'test-widget',
  schemas: {},
  handlers: {},
}

describe('widget server registry', () => {
  it('finds a registered definition', () => {
    const registry = createWidgetServerRegistry([definition])
    if (registry instanceof Error) throw registry
    expect(findWidgetServer(registry, 'test-widget')).toBe(definition)
  })

  it('returns an error for an unknown widget', () => {
    const registry = createWidgetServerRegistry([definition])
    if (registry instanceof Error) throw registry
    expect(findWidgetServer(registry, 'missing')).toBeInstanceOf(UnknownWidgetTypeError)
  })

  it('rejects duplicate type IDs', () => {
    expect(createWidgetServerRegistry([definition, definition])).toBeInstanceOf(
      DuplicateWidgetTypeError,
    )
  })
})
```

Create `server/src/widgets/dispatch.test.ts`:

```ts
import { describe, expect, it } from 'vitest'
import { z } from 'zod'

import {
  defineWidgetServer,
  toRuntimeWidgetServerDefinition,
  type RuntimeWidgetServerDefinition,
} from '@shared/widgets/contracts'

import { createMemoryOps, createMemoryPubSub } from '../test/memory-ops'
import { dispatchWidgetEvent } from './dispatch'
import {
  InvalidWidgetPayloadError,
  InvalidWidgetResultError,
  UnknownWidgetEventError,
  UnknownWidgetTypeError,
  WidgetHandlerError,
} from './errors'
import { createWidgetServerRegistry } from './registry'

const schemas = {
  echo: {
    payload: z.object({ value: z.string() }),
    result: z.object({ echoed: z.string(), instanceId: z.string() }),
  },
} as const

const definition = defineWidgetServer({
  typeId: 'test-widget',
  schemas,
  handlers: {
    echo(payload, context) {
      return { echoed: payload.value, instanceId: context.instanceId }
    },
  },
})

const createdRegistry = createWidgetServerRegistry([toRuntimeWidgetServerDefinition(definition)])
if (createdRegistry instanceof Error) throw createdRegistry

const invalidResultDefinition: RuntimeWidgetServerDefinition = {
  typeId: 'invalid-result',
  schemas,
  handlers: {
    echo: () => ({ echoed: 1, instanceId: 'placement-1' }),
  },
}
const invalidResultRegistry = createWidgetServerRegistry([invalidResultDefinition])
if (invalidResultRegistry instanceof Error) throw invalidResultRegistry

const failingDefinition: RuntimeWidgetServerDefinition = {
  typeId: 'failing-widget',
  schemas,
  handlers: {
    echo: () => new Error('handler failed'),
  },
}
const failingRegistry = createWidgetServerRegistry([failingDefinition])
if (failingRegistry instanceof Error) throw failingRegistry

function dispatch(overrides: Partial<Parameters<typeof dispatchWidgetEvent>[0]> = {}) {
  const pubsub = createMemoryPubSub()
  return dispatchWidgetEvent({
    registry: createdRegistry,
    ops: createMemoryOps(pubsub),
    typeId: 'test-widget',
    event: 'echo',
    instanceId: 'placement-1',
    payload: { value: 'ok' },
    ip: '127.0.0.1',
    now: () => 100,
    ...overrides,
  })
}

describe('dispatchWidgetEvent', () => {
  it('returns an error for an unknown widget', async () => {
    expect(await dispatch({ typeId: 'missing' })).toBeInstanceOf(UnknownWidgetTypeError)
  })

  it('returns an error for an unknown event', async () => {
    expect(await dispatch({ event: 'missing' })).toBeInstanceOf(UnknownWidgetEventError)
  })

  it('validates the event payload', async () => {
    expect(await dispatch({ payload: { value: 1 } })).toBeInstanceOf(InvalidWidgetPayloadError)
  })

  it('returns a validated handler result', async () => {
    expect(await dispatch()).toEqual({
      data: { echoed: 'ok', instanceId: 'placement-1' },
    })
  })

  it('rejects a handler result that does not match its schema', async () => {
    expect(
      await dispatch({ registry: invalidResultRegistry, typeId: 'invalid-result' }),
    ).toBeInstanceOf(InvalidWidgetResultError)
  })

  it('wraps errors returned by handlers', async () => {
    expect(await dispatch({ registry: failingRegistry, typeId: 'failing-widget' })).toBeInstanceOf(
      WidgetHandlerError,
    )
  })
})
```

- [ ] **Step 2: Run both tests and verify missing-module failures**

Run:

```powershell
pnpm --filter server test -- src/widgets/registry.test.ts src/widgets/dispatch.test.ts
```

Expected: FAIL because the registry, dispatcher, and error modules do not exist.

- [ ] **Step 3: Implement tagged dispatch errors**

Create `server/src/widgets/errors.ts` with these exported classes and fixed HTTP metadata:

```ts
import * as errore from 'errore'

class WidgetDispatchError extends Error {
  status = 500
  code = 'internal_error'
  publicMessage = 'Widget event failed'
}

export class DuplicateWidgetTypeError extends errore.createTaggedError({
  name: 'DuplicateWidgetTypeError',
  message: 'Duplicate widget server type: $typeId',
  extends: WidgetDispatchError,
}) {}

export class UnknownWidgetTypeError extends errore.createTaggedError({
  name: 'UnknownWidgetTypeError',
  message: 'Unknown widget server type: $typeId',
  extends: WidgetDispatchError,
}) {
  status = 404
  code = 'unknown_widget'
  publicMessage = 'Unknown widget type'
}

export class UnknownWidgetEventError extends errore.createTaggedError({
  name: 'UnknownWidgetEventError',
  message: 'Unknown event $event for widget $typeId',
  extends: WidgetDispatchError,
}) {
  status = 404
  code = 'unknown_event'
  publicMessage = 'Unknown widget event'
}

export class InvalidWidgetPayloadError extends errore.createTaggedError({
  name: 'InvalidWidgetPayloadError',
  message: 'Invalid payload for $typeId.$event',
  extends: WidgetDispatchError,
}) {
  status = 422
  code = 'payload_invalid'
  publicMessage = 'Widget event payload is invalid'
}

export class InvalidWidgetResultError extends errore.createTaggedError({
  name: 'InvalidWidgetResultError',
  message: 'Invalid result from $typeId.$event',
  extends: WidgetDispatchError,
}) {}

export class WidgetHandlerError extends errore.createTaggedError({
  name: 'WidgetHandlerError',
  message: 'Handler failed for $typeId.$event',
  extends: WidgetDispatchError,
}) {}

export class WidgetRequestBodyError extends errore.createTaggedError({
  name: 'WidgetRequestBodyError',
  message: 'Widget request body could not be read',
  extends: WidgetDispatchError,
}) {}

export type PublicWidgetDispatchError = WidgetDispatchError
```

- [ ] **Step 4: Implement the runtime registry**

Create `registry.ts` with:

```ts
import type { RuntimeWidgetServerDefinition } from '@shared/widgets/contracts'

import { DuplicateWidgetTypeError, UnknownWidgetTypeError } from './errors'

export type WidgetServerRegistry = ReadonlyMap<string, RuntimeWidgetServerDefinition>

export function createWidgetServerRegistry(
  definitions: readonly RuntimeWidgetServerDefinition[],
): DuplicateWidgetTypeError | WidgetServerRegistry {
  const registry = new Map<string, RuntimeWidgetServerDefinition>()
  for (const definition of definitions) {
    if (registry.has(definition.typeId)) {
      return new DuplicateWidgetTypeError({ typeId: definition.typeId })
    }
    registry.set(definition.typeId, definition)
  }
  return registry
}

export function findWidgetServer(
  registry: WidgetServerRegistry,
  typeId: string,
): UnknownWidgetTypeError | RuntimeWidgetServerDefinition {
  return registry.get(typeId) ?? new UnknownWidgetTypeError({ typeId })
}
```

- [ ] **Step 5: Implement dispatch with validation and context construction**

Create `server/src/widgets/dispatch.ts`:

```ts
import type { WidgetServerContext } from '@shared/widgets/contracts'

import type { ValkeyOps } from '../storage/valkey'
import {
  InvalidWidgetPayloadError,
  InvalidWidgetResultError,
  UnknownWidgetEventError,
  WidgetHandlerError,
  type PublicWidgetDispatchError,
} from './errors'
import { findWidgetServer, type WidgetServerRegistry } from './registry'
import { createWidgetServerApi } from './storage'

export type DispatchWidgetEventOptions = {
  registry: WidgetServerRegistry
  ops: ValkeyOps
  typeId: string
  event: string
  instanceId: string
  payload: unknown
  ip: string | null
  now: () => number
}

export type WidgetDispatchSuccess = { data: unknown }

export async function dispatchWidgetEvent(
  options: DispatchWidgetEventOptions,
): Promise<PublicWidgetDispatchError | WidgetDispatchSuccess> {
  const definition = findWidgetServer(options.registry, options.typeId)
  if (definition instanceof Error) return definition

  const schema = definition.schemas[options.event]
  const handler = definition.handlers[options.event]
  if (!Object.hasOwn(definition.schemas, options.event) || !schema) {
    return new UnknownWidgetEventError({ typeId: options.typeId, event: options.event })
  }
  if (!Object.hasOwn(definition.handlers, options.event) || !handler) {
    return new UnknownWidgetEventError({ typeId: options.typeId, event: options.event })
  }

  const payload = schema.payload.safeParse(options.payload)
  if (!payload.success) {
    return new InvalidWidgetPayloadError({
      typeId: options.typeId,
      event: options.event,
      cause: payload.error,
    })
  }

  const context: WidgetServerContext = {
    typeId: options.typeId,
    instanceId: options.instanceId,
    ip: options.ip,
    now: options.now,
    api: createWidgetServerApi({
      ops: options.ops,
      typeId: options.typeId,
      instanceId: options.instanceId,
      ip: options.ip,
      now: options.now,
    }),
  }
  const handlerResult = await Promise.resolve(handler(payload.data, context)).catch(
    (cause) =>
      new WidgetHandlerError({
        typeId: options.typeId,
        event: options.event,
        cause,
      }),
  )
  if (handlerResult instanceof WidgetHandlerError) return handlerResult
  if (handlerResult instanceof Error) {
    return new WidgetHandlerError({
      typeId: options.typeId,
      event: options.event,
      cause: handlerResult,
    })
  }

  const result = schema.result.safeParse(handlerResult)
  if (!result.success) {
    return new InvalidWidgetResultError({
      typeId: options.typeId,
      event: options.event,
      cause: result.error,
    })
  }

  return { data: result.data }
}
```

- [ ] **Step 6: Run registry and dispatcher tests**

Run:

```powershell
pnpm --filter server test -- src/widgets/registry.test.ts src/widgets/dispatch.test.ts
```

Expected: both files PASS, including lookup, duplicate, payload, event, result, and success cases.

- [ ] **Step 7: Commit registry and dispatch**

```powershell
git add -- server/src/widgets/errors.ts server/src/widgets/registry.ts server/src/widgets/registry.test.ts server/src/widgets/dispatch.ts server/src/widgets/dispatch.test.ts
git commit -m "feat: dispatch widget server events"
```

---

### Task 6: HTTP route and production server registry

**Files:**

- Create: `server/src/widgets/production-registry.ts`
- Modify: `server/src/app.ts`
- Modify: `server/src/app.test.ts`
- Modify: `server/src/index.ts`
- Modify: `server/src/test-server.ts`
- Modify: `server/vitest.config.ts`
- Modify: `server/rspack.config.ts`
- Modify: `server/Dockerfile`

- [ ] **Step 1: Write failing HTTP integration tests**

In `server/src/app.test.ts`, create a test-only server definition with an `echo`
event, construct a registry in `beforeEach`, and pass it to `createApp` as
`widgetRegistry`.

Add these imports and module-level fixtures:

```ts
import { z } from 'zod'

import { defineWidgetServer, toRuntimeWidgetServerDefinition } from '@shared/widgets/contracts'

import { createWidgetServerRegistry } from './widgets/registry'

const testWidget = defineWidgetServer({
  typeId: 'test-widget',
  schemas: {
    echo: {
      payload: z.object({ value: z.string() }),
      result: z.object({ echoed: z.string(), instanceId: z.string() }),
    },
  },
  handlers: {
    echo(payload, context) {
      return { echoed: payload.value, instanceId: context.instanceId }
    },
  },
})

const testWidgetRegistry = createWidgetServerRegistry([toRuntimeWidgetServerDefinition(testWidget)])
if (testWidgetRegistry instanceof Error) throw testWidgetRegistry
```

Add this field to the existing `createApp` options in `beforeEach`:

```ts
widgetRegistry: testWidgetRegistry,
```

Add integration tests for:

```ts
it('dispatches a validated widget event', async () => {
  const res = await fetch(`${base}/api/widgets/test-widget/echo`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ instanceId: 'placement-1', payload: { value: 'hello' } }),
  })

  expect(res.status).toBe(200)
  expect(await res.json()).toEqual({
    data: { echoed: 'hello', instanceId: 'placement-1' },
  })
})

it.each([
  ['missing widget', '/api/widgets/missing/echo', 404, 'unknown_widget'],
  ['missing event', '/api/widgets/test-widget/missing', 404, 'unknown_event'],
])('%s returns a safe error', async (_label, path, status, code) => {
  const res = await fetch(`${base}${path}`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ instanceId: 'placement-1', payload: { value: 'hello' } }),
  })
  expect(res.status).toBe(status)
  expect(await res.json()).toMatchObject({ error: { code } })
})

it('rejects an invalid widget request body', async () => {
  const res = await fetch(`${base}/api/widgets/test-widget/echo`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ instanceId: '', payload: { value: 'hello' } }),
  })
  expect(res.status).toBe(422)
  expect(await res.json()).toMatchObject({ error: { code: 'request_invalid' } })
})

it('rejects malformed JSON', async () => {
  const res = await fetch(`${base}/api/widgets/test-widget/echo`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: '{',
  })
  expect(res.status).toBe(400)
  expect(await res.json()).toMatchObject({ error: { code: 'invalid_json' } })
})

it('rejects an oversized body', async () => {
  const res = await fetch(`${base}/api/widgets/test-widget/echo`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: 'x'.repeat(1_048_577),
  })
  expect(res.status).toBe(413)
  expect(await res.json()).toMatchObject({ error: { code: 'body_too_large' } })
})

it('rejects a payload that does not match the event schema', async () => {
  const res = await fetch(`${base}/api/widgets/test-widget/echo`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ instanceId: 'placement-1', payload: { value: 1 } }),
  })
  expect(res.status).toBe(422)
  expect(await res.json()).toMatchObject({ error: { code: 'payload_invalid' } })
})
```

- [ ] **Step 2: Run app tests and verify route failure**

Run:

```powershell
pnpm --filter server test -- src/app.test.ts
```

Expected: new route tests FAIL with 404 while existing storage/time tests remain green.

- [ ] **Step 3: Create the production registry**

Add `@widgets` to `server/vitest.config.ts`:

```ts
'@widgets': path.resolve(import.meta.dirname, '../widgets'),
```

In `server/rspack.config.ts`, keep `@widgets` inside the bundle by adding this
condition beside the existing `@shared` condition:

```ts
!request.startsWith('@widgets') &&
```

In `server/Dockerfile`, add this beside `COPY shared ./shared`:

```dockerfile
COPY widgets ./widgets
```

Create `server/src/widgets/production-registry.ts`:

```ts
import { toRuntimeWidgetServerDefinition } from '@shared/widgets/contracts'
import { clockServer } from '@widgets/clock/server'
import { ofeliaServer } from '@widgets/ofelia-poop-duty/server'

import { createWidgetServerRegistry } from './registry'

const registry = createWidgetServerRegistry([
  toRuntimeWidgetServerDefinition(clockServer),
  toRuntimeWidgetServerDefinition(ofeliaServer),
])

if (registry instanceof Error) throw registry

export const productionWidgetServerRegistry = registry
```

The bootstrap throw is reserved for static duplicate configuration and cannot
be produced by a user request.

- [ ] **Step 4: Add the route schema and route handler**

In `server/src/app.ts`:

1. Add `widgetRegistry: WidgetServerRegistry` to `AppDeps`.
2. Add the imports for `z`, `dispatchWidgetEvent`,
   `PublicWidgetDispatchError`, and `WidgetRequestBodyError`.
3. Define:

```ts
const WidgetRequestSchema = z.object({
  instanceId: z.string().min(1),
  payload: z.unknown(),
})
```

4. Add a `sendWidgetError` helper:

```ts
function sendWidgetError(res: ServerResponse, error: PublicWidgetDispatchError): void {
  if (error.status === 500) console.error(error)
  res.writeHead(error.status, { 'content-type': 'application/json' })
  res.end(
    JSON.stringify({
      error: { code: error.code, message: error.publicMessage },
    }),
  )
}
```

5. Register this route before the test-only routes:

```ts
router.on('POST', '/api/widgets/:typeId/:event', async (req, res, params) => {
  const raw = await readJsonBody(req).catch((cause) => new WidgetRequestBodyError({ cause }))
  if (raw instanceof WidgetRequestBodyError) {
    const tooLarge = raw.cause instanceof Error && raw.cause.message === 'request body too large'
    res.writeHead(tooLarge ? 413 : 400, { 'content-type': 'application/json' })
    res.end(
      JSON.stringify({
        error: {
          code: tooLarge ? 'body_too_large' : 'invalid_json',
          message: tooLarge ? 'Request body is too large' : 'Request JSON is invalid',
        },
      }),
    )
    return
  }

  const body = WidgetRequestSchema.safeParse(raw)
  if (!body.success) {
    res.writeHead(422, { 'content-type': 'application/json' })
    res.end(
      JSON.stringify({
        error: { code: 'request_invalid', message: 'Widget request is invalid' },
      }),
    )
    return
  }

  const result = await dispatchWidgetEvent({
    registry: deps.widgetRegistry,
    ops,
    typeId: params.typeId as string,
    event: params.event as string,
    instanceId: body.data.instanceId,
    payload: body.data.payload,
    ip: clientIp(req),
    now,
  })
  if (result instanceof Error) {
    sendWidgetError(res, result)
    return
  }

  res.writeHead(200, { 'content-type': 'application/json' })
  res.end(JSON.stringify(result))
})
```

- [ ] **Step 5: Inject registries at every app construction site**

Import `productionWidgetServerRegistry` in `server/src/index.ts` and
`server/src/test-server.ts`, then add:

```ts
widgetRegistry: productionWidgetServerRegistry,
```

to both `createApp` calls.

In `app.test.ts`, pass the test registry created from the echo definition.

- [ ] **Step 6: Run HTTP, server-entry, and production registry tests**

Run:

```powershell
pnpm --filter server test -- src/app.test.ts src/widgets/registry.test.ts src/widgets/dispatch.test.ts src/widgets/storage.test.ts
pnpm --filter server typecheck
pnpm --filter server build
```

Expected: all selected tests PASS; server typecheck and Rspack build succeed
without resolving React or a widget UI module.

- [ ] **Step 7: Commit HTTP integration**

```powershell
git add -- server/src/widgets/production-registry.ts server/src/app.ts server/src/app.test.ts server/src/index.ts server/src/test-server.ts server/vitest.config.ts server/rspack.config.ts server/Dockerfile
git commit -m "feat: expose widget server rpc route"
```

---

### Task 7: Full verification and scope audit

**Files:**

- Verify only; modify a task-owned file only if a verification command exposes a defect caused by this feature.

- [ ] **Step 1: Verify formatting and static checks**

Run:

```powershell
pnpm format:check
pnpm lint
pnpm typecheck
```

Expected: all commands exit 0. If formatting fails only in task-owned files,
run `pnpm format`, inspect the diff, and repeat `pnpm format:check`.

- [ ] **Step 2: Run the full test suite**

Run:

```powershell
pnpm test
```

Expected: all client, root-widget, and server Vitest suites PASS. Confirm from
the output that tests under `../widgets` were collected by the client project.

- [ ] **Step 3: Build both packages**

Run:

```powershell
pnpm build
pnpm --filter server build
```

Expected: client Vite build and server Rspack build exit 0.

- [ ] **Step 4: Verify production Docker build contexts**

Run:

```powershell
docker compose config
docker compose build server client
```

Expected: Compose configuration is valid and both images build with root
`widgets` available inside their build stages.

- [ ] **Step 5: Audit dependency isolation and retained Storage API**

Run:

```powershell
Get-ChildItem server/src,server/dist -Recurse -File | Select-String -Pattern '@widgets/.*/(client|ui)|react'
Get-ChildItem client/src,server/src -Recurse -File | Select-String -Pattern '/api/storage|makeWidgetStorage'
git status --short
```

Expected:

- no server source or emitted server bundle imports widget `client.ts`, widget
  `ui/`, or React;
- existing `/api/storage` routes and `makeWidgetStorage` remain present;
- only intended task files plus the user's pre-existing uncommitted move are
  shown by Git.

- [ ] **Step 6: Commit verification-only fixes if any were required**

If verification required changes, return to the task that owns those files,
repeat its targeted test and full commit step, then rerun Task 7 from Step 1.
Check the final state with:

```powershell
git status --short
```

If no changes were required, do not create an empty commit.
