# Passport Checker Widget Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Spec:** [docs/superpowers/specs/2026-07-24-passport-checker-widget-design.md](../specs/2026-07-24-passport-checker-widget-design.md) (Subproject 7). Read it alongside this plan — visual details (exact paddings, radii, copy) live there.

**Goal:** Ship the user-facing passport-checker widget: one no-input `check` RPC, every result state rendered in `tiny`/`standard` tiers, and a self-contained noVNC recovery modal driven by the Subproject 6 transport — plus the one generic widget-RPC change (`PublicWidgetError`) that lets coded errors reach the client structurally.

**Architecture:** Four layers, implemented bottom-up: (1) generic `PublicWidgetError` passthrough in shared/server dispatch + structural `code`/`meta` on the client `WidgetApiError`; (2) the passport `server.ts` handler mapping `BrowserGatewayError` → stable public codes; (3) Reatom models (`check-model`, `recovery-model`) with injected adapters (`recovery-transport`, `rfb`); (4) `reatomMemo` UI (tier switch, banners, portal modal). No polling, no persistence — last result lives in in-memory Reatom state.

**Tech Stack:** TypeScript 7, React 19, Reatom v1001, errore, zod v4, Vite 8 + Module Federation (`defineWidgetViteConfig`), `@novnc/novnc` 1.7.0 (bundled into the remote, NOT a federation singleton), Vitest 4 + @testing-library/react (jsdom).

## Global Constraints

- The client sends an **empty payload** (`z.strictObject({})`) and renders only `status` / `send_status_msg`. The passport identity is a server-side deployment secret; it must never appear in client code, RPC payloads, public error messages, or `meta`.
- **No persistence, no polling**: the last result is in-memory Reatom state only; it disappears on reload.
- **No new design system**: reuse myboard tokens (`--primary`, `--accent-soft`, `--success`, `--success-soft`, `--destructive`, `--destructive-soft`, `--card`, `--border`, `--font-ui`, `--font-mono`, …) with literal fallbacks; the amber sessionRequired trio is widget-local (no such token exists in the repo).
- **No change to the Subproject 6 transport contract** (`POST /api/browser/recovery/:widgetId` → `200 { expiresInMs }` + single-use cookie; `WS /api/browser/recovery/socket`). The widget only consumes it. Every reconnect re-issues; a token is never reused.
- **errore**: errors as values (`Error | T` unions, `instanceof` narrowing, no throwing for expected failures). `import * as errore from 'errore'`.
- **Reatom**: business logic, timers, async flows in `model/`; `ui/` holds refs and DOM glue. Every exported React component is wrapped in `reatomMemo` from `widget-sdk`. Known pitfalls (repo memory): never hoist a single `wrap()` closure to module level (aborts after `context.reset()`); pre-create `wrap()`ed closures **before** the first `await` and route all post-await atom reads/writes through them; `withConnectHook` is not reactive.
- **Naming**: factories are `make*`, never `create*` (repo owner preference). Atom/action debug names are `'<modelNamespace>.<member>'`.
- **Widgets cannot import `packages/client/src`** — only `widget-runtime` and `widget-sdk` cross that boundary. The recovery modal is hand-rolled inside the widget package (no Radix dependency).
- **Widget RPC envelope on the wire**: success `200 { data: <result> }`; error `{ error: { code, message, meta? } }` at the error's HTTP status. `meta` appears only for `PublicWidgetError` and carries only already-public values (`sshTarget` originates from the browser task's `publicMeta`).
- All UI copy is Russian, verbatim from the spec (e.g. «Паспорт», «Проверить», «Проверяем…», «Требуется вход в браузер», «Открыть восстановление», «Обратитесь к администратору.», «Восстановление сессии браузера», «Повторить проверку»).
- Commands run from the repo root of the worktree `.worktrees/passport-checker-widget` (branch `feat/passport-checker-widget`). Prefix shell commands with `rtk` (token-optimized pass-through wrapper; safe for every command).
- Commit after every task with the conventional-commit messages given in the task.

## Verified codebase facts the plan builds on

(Собраны из кода; проверять повторно не нужно, но если реальность разойдётся — реальность важнее плана.)

- `dispatchWidgetEvent` (`packages/server/src/widgets/dispatch.ts`) wraps every **returned** error and every **async** throw/rejection into `WidgetHandlerError` (500 / `internal_error` / `'Widget event failed'`); a _synchronous_ throw escapes `Promise.resolve(handler(...)).catch(...)` and rejects dispatch itself — handlers must never throw synchronously. `sendWidgetError` lives in `packages/server/src/app.ts` and serializes `{ error: { code, message } }`.
- `PublicWidgetDispatchError` is currently `type PublicWidgetDispatchError = WidgetDispatchError` in `packages/server/src/widgets/errors.ts`; `WidgetDispatchError` is a plain (non-tagged) base class with `status = 500`, `code = 'internal_error'`, `publicMessage = 'Widget event failed'`.
- Server codegen (`scripts/codegen/server.ts`) auto-discovers `packages/widgets/<dir>/server.ts` (package-root file) and emits `packages/server/src/widgets/widget-server-list.generated.ts` (gitignored) importing the **default export** via `@widgets/<dir>/server` and wrapping it with `toRuntimeWidgetServerDefinition({ typeId: '<dir>', definition })`. `packages/server/tsconfig.json` already maps `@widgets/*` → `../widgets/*`; rspack aliases it too. Command: `rtk pnpm codegen:server` (also runs inside `pnpm dev:server`, `pnpm test`, `pnpm typecheck`, `pnpm check`).
- `defineWidgetServer` returns `{ schemas, handlers }` verbatim; handler signature is `(payload, context: WidgetServerContext) => Awaitable<Error | z.input<result>>`; `context.api.browser.invoke(task, payload)` returns `Promise<BrowserGatewayError | z.output<ResultSchema>>`.
- The gateway error family (`packages/shared/widgets/browser-errors.ts`): `BrowserTaskRejectedError` (fields `widgetId`, `taskId`, `code: string`, `publicMessage: string`, `meta?: Record<string, unknown>`), `BrowserAutomationUnavailableError`, `BrowserAutomationDeadlineError`, `BrowserAutomationProtocolError`. The passport-specific codes (`browser_session_required`, `browser_configuration`, `upstream_response`, `invalid_checker_response`) arrive as `BrowserTaskRejectedError.code` strings; `sshTarget` arrives inside `BrowserTaskRejectedError.meta` (copied from the task's `publicMeta`).
- `packages/widgets/passport-checker/types.ts` already exports `passportCheckPayloadSchema` (`z.strictObject({})`), `passportCheckResultSchema` (`{ status: z.number().int(), send_status_msg: z.string() }`), `passportCheckerBrowserSchemas` (`{ check: { payload, result } }`), and `passportCheckerBrowserTasks`.
- Client `makeWidgetApi` (`packages/widget-runtime/src/widget-api.ts`) POSTs `/api/widgets/:typeId/:event` with `{ instanceId, payload }` through an injected `HttpLike`; `WidgetApiError` is an errore tagged error with only `$reason` today. Envelope schema: `z.union([{ data: z.unknown() }, { error: { code, message } }])`. Tests use `makeScriptedHttp` from `@shared/http/test/scripted-http`.
- `WidgetRuntimeProps.api` reaches components via `WidgetRuntimeContext` / `useWidgetContext<Events>()`. `InferWidgetEvents<Schemas>` (in `@shared/widgets/contracts`) bridges zod schemas → the `Events` map; it has zero call sites so far — passport is the first.
- Recovery transport (merged, Subproject 6): `POST /api/browser/recovery/:widgetId` → `200 { expiresInMs }` + single-use `HttpOnly` cookie scoped to `/api/browser/recovery`; errors `404 { code: 'recovery_unavailable' }`, `409 { code: 'recovery_busy' }`, `503 { code: 'automation_unavailable' }`; `401` (session) handled one layer up. WS upgrade at exactly `/api/browser/recovery/socket`, cookie validated on the handshake, token deleted at first `consume` regardless of outcome. Both the Vite dev proxy (`ws: true` on that exact path) and prod nginx (`location = … Upgrade`) route the same same-origin URL.
- Widget template (clock / ofelia-poop-duty): `client.ts` uses `defineWidgetClient` from `widget-sdk/define-widget-client`; `icon` must be an exact **lucide-react export name** (codegen emits `WIDGET_ICONS` from it; `IdCard` exists in lucide-react 1.19.0); `vite.config.ts` = `defineWidgetViteConfig(import.meta.dirname)`; `vitest.config.ts` (jsdom + `widget-sdk/test-setup`) = `defineWidgetVitestConfig(import.meta.dirname)`; dev harness hand-builds `WidgetRuntimeProps` with `makeHostRuntime()`. Ports are auto-assigned by codegen into `packages/widgets/.ports.json` (next free = 5182) — never hand-pick.
- `TierConfig` requires **all four** keys (`tiny`, `compact`, `standard`, `large`); `resolveTier` walks `['large', 'standard', 'compact']` and falls back to `'tiny'`. There is no way to declare "only tiny and standard" in config — the component collapses the five tier names into two layouts instead (see Task 4).
- `widget-setup.ts` (`widget-sdk/test-setup`) is node-env-safe (guards on `typeof window`); existing passport tests keep working under the jsdom-default config once they carry a `// @vitest-environment node` pragma (same pragma convention as `widget-runtime/src/widget-api.test.ts`).
- Tokens: `--success-soft`/`--destructive-soft` exist only in `packages/client/src/app/global.css` (board document), NOT in `tokens.css`; **no amber/warning token exists anywhere**. The standalone dev harness page has NO tokens at all — widget CSS must use `var(--token, <literal fallback>)` and the dev harness gets a dev-only token stylesheet.
- `@novnc/novnc@1.7.0`: `"exports": "./core/rfb.js"` (bare specifier only — deep imports fail), plain modern ESM, zero deps, no workers, **no TypeScript types shipped** (a local ambient `.d.ts` is required). `new RFB(target, urlOrChannel, options?)`; events `connect`, `disconnect` (`detail.clean`), `securityfailure` (`detail.status`/`detail.reason`); `disconnect()`, `scaleViewport` (contain-fit + letterbox via flex `margin: auto`), `viewOnly`, `background`, `focus()`/`blur()`. Not a federation singleton — it bundles into the remote.
- All mutating API calls require the `'X-Requested-With': 'MyBoard'` header (CSRF gate in `packages/server/src/http/csrf.ts`); the widget-RPC path goes through `HttpClient` which already sets it, but the recovery transport uses raw `fetch` and must set it explicitly.
- Existing modal-dismiss precedent: Radix-on-Radix stacking needs the "ref cleared one tick late" idiom (`MyDevicesDialog.tsx`). Our modal is **not** Radix, and it cannot patch the underlying Radix dialogs (`FullscreenOverlay`), so it uses the strictly-stronger equivalent: native capture-phase Esc handling + `stopPropagation` of `pointerdown`/`focusin` born inside the modal, so underlying Radix layers never see the events at all (their deferred outside-dismiss checks never queue). This satisfies the spec's a11y requirement by construction.

## Task order and parallelism

```
Task 1 (shared+server PublicWidgetError)  ─┐
Task 2 (client WidgetApiError code/meta)  ─┼─ independent of each other
Task 3 (package scaffolding + client.ts)  ─┘
Task 4 (passport server.ts)        needs Task 1
Task 5 (check-model)               needs Tasks 2+3
Task 6 (recovery adapters)         needs Task 3
Task 7 (recovery-model)            needs Task 6
Task 8 (tier UI + banners)         needs Task 5
Task 9 (recovery modal UI + a11y)  needs Tasks 7+8
Task 10 (final gate)               needs everything
```

Tasks 1, 2, 3 can run in parallel (disjoint files). Tasks 4, 5, 6 can run in parallel after their prerequisites. Tasks 8 and 9 are sequential (9 renders inside 8's tree).

---

### Task 1: `PublicWidgetError` — shared class, dispatch passthrough, envelope `meta`

**Files:**

- Create: `packages/shared/widgets/public-error.ts`
- Modify: `packages/server/src/widgets/errors.ts` (extend the `PublicWidgetDispatchError` type)
- Modify: `packages/server/src/widgets/dispatch.ts` (passthrough before the generic wrap)
- Modify: `packages/server/src/app.ts` (`sendWidgetError` serializes `meta`)
- Test: `packages/server/src/widgets/dispatch.test.ts` (add cases)
- Test: `packages/server/src/app.test.ts` (add cases)

**Interfaces:**

- Consumes: existing `WidgetDispatchError` base (`status`/`code`/`publicMessage` fields), `dispatchWidgetEvent`, `sendWidgetError`.
- Produces: `class PublicWidgetError extends Error` with `readonly status: number` (default 400), `readonly code: string`, `readonly publicMessage: string`, `readonly meta: Record<string, unknown> | undefined`, constructor `new PublicWidgetError({ code, publicMessage, status?, meta?, cause? })`, exported from `@shared/widgets/public-error`. Later tasks (4) construct it in handlers; the wire envelope gains an optional `meta`.

- [ ] **Step 1: Write the shared class**

`packages/shared/widgets/public-error.ts` (new file, complete):

```ts
export type PublicWidgetErrorOptions = {
  code: string
  publicMessage: string
  status?: number
  meta?: Record<string, unknown>
  cause?: unknown
}

/**
 * A handler-returned error that crosses widget dispatch verbatim: dispatch
 * returns it unwrapped and the HTTP envelope carries its code/message/meta to
 * the client. Anything else a handler returns or throws still collapses to the
 * internal_error envelope. `meta` must only ever contain already-public values.
 */
export class PublicWidgetError extends Error {
  readonly status: number
  readonly code: string
  readonly publicMessage: string
  readonly meta: Record<string, unknown> | undefined

  constructor({ code, publicMessage, status = 400, meta, cause }: PublicWidgetErrorOptions) {
    super(`Public widget error: ${code}`, cause === undefined ? undefined : { cause })
    this.name = 'PublicWidgetError'
    this.status = status
    this.code = code
    this.publicMessage = publicMessage
    this.meta = meta
  }
}
```

(Plain `Error` subclass, not `createTaggedError` — it mirrors the existing plain `WidgetDispatchError` base in `packages/server/src/widgets/errors.ts` and is a transport contract, not a domain error.)

- [ ] **Step 2: Write the failing dispatch tests**

In `packages/server/src/widgets/dispatch.test.ts`, extend the existing test-widget `defineWidgetServer({...})` fixture with one more event (add to both `schemas` and `handlers`, reusing the file's existing imports of `z` and `defineWidgetServer`):

```ts
// add to the fixture's schemas:
publicReject: {
  payload: z.object({}),
  result: z.object({ ok: z.boolean() }),
},
// add to the fixture's handlers:
publicReject() {
  return new PublicWidgetError({
    status: 409,
    code: 'browser_session_required',
    publicMessage: 'The browser session requires attention',
    meta: { sshTarget: 'admin@pi' },
  })
},
```

and add the import `import { PublicWidgetError } from '@shared/widgets/public-error'` plus these tests (reuse the file's existing `dispatch(overrides)` helper):

```ts
it('returns a PublicWidgetError from a handler unchanged', async () => {
  const result = await dispatch({ event: 'publicReject', payload: {} })

  expect(result).toBeInstanceOf(PublicWidgetError)
  if (!(result instanceof PublicWidgetError)) throw new Error('expected PublicWidgetError')
  expect(result.status).toBe(409)
  expect(result.code).toBe('browser_session_required')
  expect(result.publicMessage).toBe('The browser session requires attention')
  expect(result.meta).toEqual({ sshTarget: 'admin@pi' })
})

it('still wraps a thrown PublicWidgetError as WidgetHandlerError', async () => {
  // Passthrough is a return-value contract (errore style); throwing stays internal.
  // Add a `publicThrow` event to the fixture whose handler is ASYNC — dispatch
  // catches rejections via Promise.resolve(handler(...)).catch(...); a
  // synchronous throw would escape that and reject dispatch itself:
  //   async publicThrow(): Promise<{ ok: boolean }> {
  //     throw new PublicWidgetError({ code: 'x', publicMessage: 'x' })
  //   }
  const result = await dispatch({ event: 'publicThrow', payload: {} })
  expect(result).toBeInstanceOf(WidgetHandlerError)
})
```

(`publicThrow` needs its own `schemas` entry too: `publicThrow: { payload: z.object({}), result: z.object({ ok: z.boolean() }) }`.)

- [ ] **Step 3: Run the tests to verify they fail**

Run: `rtk pnpm --filter server exec vitest run src/widgets/dispatch.test.ts`
Expected: FAIL — `publicReject` case returns a `WidgetHandlerError` (today every returned error is wrapped), and the import of `@shared/widgets/public-error` resolves only after Step 1 (if Step 1 is done, the class exists but dispatch still wraps).

- [ ] **Step 4: Implement the dispatch passthrough**

In `packages/server/src/widgets/errors.ts`:

```ts
// add at the top:
import { PublicWidgetError } from '@shared/widgets/public-error'
// replace the last line:
export type PublicWidgetDispatchError = WidgetDispatchError | PublicWidgetError
```

In `packages/server/src/widgets/dispatch.ts`, add the import and insert the passthrough between the `WidgetHandlerError` check and the generic `instanceof Error` wrap:

```ts
import { PublicWidgetError } from '@shared/widgets/public-error'
```

```ts
if (handlerResult instanceof WidgetHandlerError) return handlerResult
if (handlerResult instanceof PublicWidgetError) return handlerResult
if (handlerResult instanceof Error) {
  return new WidgetHandlerError({
    typeId: options.typeId,
    event: options.event,
    cause: handlerResult,
  })
}
```

- [ ] **Step 5: Run the dispatch tests to verify they pass**

Run: `rtk pnpm --filter server exec vitest run src/widgets/dispatch.test.ts`
Expected: PASS (all pre-existing cases too — the wrap behavior for non-`PublicWidgetError` errors is unchanged).

- [ ] **Step 6: Write the failing HTTP-envelope tests**

In `packages/server/src/app.test.ts`, extend the file's `testWidget` fixture with the same `publicReject` event (schemas + handler, identical code to Step 2) and add:

```ts
it('serializes a PublicWidgetError with its code, status and meta', async () => {
  const res = await fetch(`${base}/api/widgets/test-widget/publicReject`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', 'X-Requested-With': 'MyBoard' },
    body: JSON.stringify({ instanceId: 'placement-1', payload: {} }),
  })

  expect(res.status).toBe(409)
  expect(await res.json()).toEqual({
    error: {
      code: 'browser_session_required',
      message: 'The browser session requires attention',
      meta: { sshTarget: 'admin@pi' },
    },
  })
})
```

Also add a no-meta variant to pin that `meta` is omitted (not `null`) when absent — add a `publicRejectNoMeta` event whose handler returns `new PublicWidgetError({ code: 'browser_configuration', publicMessage: 'Passport checker is not configured', status: 500 })` and assert:

```ts
expect(await res.json()).toEqual({
  error: { code: 'browser_configuration', message: 'Passport checker is not configured' },
})
```

(with `res.status` 500; note `sendWidgetError` will `console.error` it — that is intended behavior for 500s.)

- [ ] **Step 7: Run to verify failure, then implement `sendWidgetError`**

Run: `rtk pnpm --filter server exec vitest run src/app.test.ts`
Expected: FAIL — envelope has no `meta` and status/code collapse is gone only after implementation.

In `packages/server/src/app.ts`, add the import and replace `sendWidgetError`:

```ts
import { PublicWidgetError } from '@shared/widgets/public-error'
```

```ts
function sendWidgetError(res: ServerResponse, error: PublicWidgetDispatchError): void {
  if (error.status === 500) console.error(error)
  res.writeHead(error.status, { 'content-type': 'application/json' })
  const meta = error instanceof PublicWidgetError ? error.meta : undefined
  res.end(
    JSON.stringify({
      error:
        meta === undefined
          ? { code: error.code, message: error.publicMessage }
          : { code: error.code, message: error.publicMessage, meta },
    }),
  )
}
```

- [ ] **Step 8: Run the full server suite and typecheck**

Run: `rtk pnpm --filter server test && rtk pnpm --filter server typecheck`
Expected: PASS.

- [ ] **Step 9: Commit**

```bash
rtk git add packages/shared/widgets/public-error.ts packages/server/src/widgets/errors.ts packages/server/src/widgets/dispatch.ts packages/server/src/app.ts packages/server/src/widgets/dispatch.test.ts packages/server/src/app.test.ts
rtk git commit -m "feat(server): pass PublicWidgetError through widget dispatch with meta"
```

---

### Task 2: structural `code`/`meta` on the client `WidgetApiError`

**Files:**

- Modify: `packages/widget-runtime/src/widget-api.ts`
- Test: `packages/widget-runtime/src/widget-api.test.ts` (add cases)

**Interfaces:**

- Consumes: existing `makeWidgetApi`, `WidgetApiEnvelopeSchema`, `makeScriptedHttp` test helper.
- Produces: `WidgetApiError` gains `readonly code: string` (**required** — every construction site sets one; synthetic codes are `'network'` and `'invalid_response'`) and `readonly meta: Record<string, unknown> | undefined`. Constructor: `new WidgetApiError({ reason, code, meta?, cause? })`. The envelope schema's error branch gains `meta: z.record(z.string(), z.unknown()).optional()` (zod v4 — two-argument `z.record`). Task 5's model narrows on `err.code` and reads `err.meta.sshTarget`.

Note: the spec sketches `code?: string`; making it required is a strict improvement (the model can always switch on it) and is safe — the repo has no other `new WidgetApiError(...)` construction site (verified by grep; tests stub `api.invoke` instead).

- [ ] **Step 1: Write the failing tests**

Add to `packages/widget-runtime/src/widget-api.test.ts` (file already has `makeScriptedHttp`, `makeWidgetApi`, `WidgetApiError`, `TestEvents`, `URL_SAVE` — reuse them):

```ts
it('exposes the server error code and meta structurally', async () => {
  const { http } = makeScriptedHttp({
    [URL_SAVE]: [
      {
        status: 409,
        body: {
          error: {
            code: 'browser_session_required',
            message: 'The browser session requires attention',
            meta: { sshTarget: 'admin@pi' },
          },
        },
      },
    ],
  })
  const api = makeWidgetApi<TestEvents>({ typeId: 'notes/widget', instanceId: 'placement-1', http })

  const result = await api.invoke('save', { value: 'hello' })

  expect(result).toBeInstanceOf(WidgetApiError)
  if (!(result instanceof WidgetApiError)) throw new Error('expected WidgetApiError')
  expect(result.code).toBe('browser_session_required')
  expect(result.meta).toEqual({ sshTarget: 'admin@pi' })
})

it('keeps meta undefined when the server sends none', async () => {
  const { http } = makeScriptedHttp({
    [URL_SAVE]: [{ status: 422, body: { error: { code: 'payload_invalid', message: 'nope' } } }],
  })
  const api = makeWidgetApi<TestEvents>({ typeId: 'notes/widget', instanceId: 'placement-1', http })

  const result = await api.invoke('save', { value: 'hello' })

  expect(result).toBeInstanceOf(WidgetApiError)
  if (!(result instanceof WidgetApiError)) throw new Error('expected WidgetApiError')
  expect(result.code).toBe('payload_invalid')
  expect(result.meta).toBeUndefined()
})

it('synthesizes the network code on transport failure', async () => {
  const { http } = makeScriptedHttp({ [URL_SAVE]: ['network-error'] })
  const api = makeWidgetApi<TestEvents>({ typeId: 'notes/widget', instanceId: 'placement-1', http })

  const result = await api.invoke('save', { value: 'hello' })

  expect(result).toBeInstanceOf(WidgetApiError)
  if (!(result instanceof WidgetApiError)) throw new Error('expected WidgetApiError')
  expect(result.code).toBe('network')
})

it('synthesizes the invalid_response code on an unparseable envelope', async () => {
  const { http } = makeScriptedHttp({
    [URL_SAVE]: [{ status: 200, body: { nonsense: true } }],
  })
  const api = makeWidgetApi<TestEvents>({ typeId: 'notes/widget', instanceId: 'placement-1', http })

  const result = await api.invoke('save', { value: 'hello' })

  expect(result).toBeInstanceOf(WidgetApiError)
  if (!(result instanceof WidgetApiError)) throw new Error('expected WidgetApiError')
  expect(result.code).toBe('invalid_response')
})
```

- [ ] **Step 2: Run to verify failure**

Run: `rtk pnpm --filter widget-runtime exec vitest run src/widget-api.test.ts`
Expected: FAIL — TypeScript compile error first (`code` does not exist on `WidgetApiError`), which counts as the red step.

- [ ] **Step 3: Implement**

Replace the envelope schema and error class in `packages/widget-runtime/src/widget-api.ts`:

```ts
const WidgetApiEnvelopeSchema = z.union([
  z.object({ data: z.unknown() }),
  z.object({
    error: z.object({
      code: z.string(),
      message: z.string(),
      meta: z.record(z.string(), z.unknown()).optional(),
    }),
  }),
])

type WidgetApiErrorOptions = {
  reason: string
  code: string
  meta?: Record<string, unknown>
  cause?: unknown
}

export class WidgetApiError extends errore.createTaggedError({
  name: 'WidgetApiError',
  message: 'Widget API request failed: $reason',
}) {
  readonly code: string
  readonly meta: Record<string, unknown> | undefined

  constructor({ code, meta, ...options }: WidgetApiErrorOptions) {
    super(options)
    this.code = code
    this.meta = meta
  }
}
```

and update the four construction sites inside `invoke`:

```ts
const response = await http.post(url, { json: { instanceId, payload } })
if (response instanceof Error) {
  return new WidgetApiError({ reason: 'network request failed', code: 'network', cause: response })
}

const envelope = WidgetApiEnvelopeSchema.safeParse(response.body)
if (!envelope.success) {
  return new WidgetApiError({
    reason: 'response envelope is invalid',
    code: 'invalid_response',
    cause: envelope.error,
  })
}
if ('error' in envelope.data) {
  return new WidgetApiError({
    reason: `${envelope.data.error.code}: ${envelope.data.error.message}`,
    code: envelope.data.error.code,
    meta: envelope.data.error.meta,
  })
}
if (!response.ok) {
  return new WidgetApiError({ reason: `HTTP ${response.status}`, code: 'invalid_response' })
}

return envelope.data.data as Events[Event]['result']
```

- [ ] **Step 4: Run the widget-runtime suite and typecheck**

Run: `rtk pnpm --filter widget-runtime test && rtk pnpm --filter widget-runtime typecheck`
Expected: PASS (pre-existing widget-api and host-runtime tests included).

- [ ] **Step 5: Commit**

```bash
rtk git add packages/widget-runtime/src/widget-api.ts packages/widget-runtime/src/widget-api.test.ts
rtk git commit -m "feat(widget-runtime): expose structural code and meta on WidgetApiError"
```

---

### Task 3: widget package scaffolding — deps, configs, `client.ts`, dev harness, codegen

**Files:**

- Modify: `packages/widgets/passport-checker/package.json`
- Modify: `packages/widgets/passport-checker/tsconfig.json`
- Modify: `packages/widgets/passport-checker/vitest.config.ts`
- Modify: `packages/widgets/passport-checker/types.ts` (add `PassportCheckerEvents`)
- Modify (pragma only): `packages/widgets/passport-checker/browser.test.ts`, `browser/check.test.ts`, `browser/check.integration.test.ts`, `browser/contracts.test.ts`
- Create: `packages/widgets/passport-checker/novnc.d.ts`
- Create: `packages/widgets/passport-checker/client.ts`
- Create: `packages/widgets/passport-checker/client.test.ts`
- Create: `packages/widgets/passport-checker/ui/PassportChecker.tsx` (stub — replaced in Task 8)
- Create: `packages/widgets/passport-checker/index.html`
- Create: `packages/widgets/passport-checker/vite.config.ts`
- Create: `packages/widgets/passport-checker/dev/main.tsx`, `dev/harness.tsx`, `dev/harness.test.tsx`, `dev/dev-tokens.css`
- Modify (via codegen): `packages/widgets/.ports.json`

**Interfaces:**

- Consumes: `defineWidgetClient` (`widget-sdk/define-widget-client`), `InferWidgetEvents` (`@shared/widgets/contracts`), `passportCheckerBrowserSchemas` (`./types`), `defineWidgetViteConfig`/`defineWidgetVitestConfig` (`widget-sdk/vite`), `makeHostRuntime`/`WidgetRuntimeContext`/`resolveTier` (`widget-runtime`).
- Produces: `export type PassportCheckerEvents = InferWidgetEvents<typeof passportCheckerBrowserSchemas>` (in `types.ts` — Tasks 5/8 import it); `passportCheckerWidget` client definition (default export of `client.ts`); a jsdom-by-default vitest config; ambient types for `@novnc/novnc` (Tasks 6/9 import `RFB`); a stub `PassportChecker` component export (named export `PassportChecker`, same signature Task 8 keeps).

- [ ] **Step 1: Update `package.json`**

Replace `packages/widgets/passport-checker/package.json` with:

```json
{
  "name": "widgets-passport-checker",
  "version": "0.0.0",
  "private": true,
  "type": "module",
  "scripts": {
    "dev": "vite",
    "build": "vite-build-exit",
    "preview": "vite preview",
    "test": "vitest run",
    "typecheck": "tsc --noEmit"
  },
  "dependencies": {
    "@novnc/novnc": "1.7.0",
    "@reatom/core": "catalog:",
    "@reatom/react": "catalog:",
    "errore": "catalog:",
    "lucide-react": "catalog:",
    "react": "catalog:",
    "react-dom": "catalog:",
    "widget-runtime": "workspace:*",
    "widget-sdk": "workspace:*",
    "zod": "catalog:"
  },
  "devDependencies": {
    "@module-federation/vite": "catalog:",
    "@testing-library/jest-dom": "catalog:",
    "@testing-library/react": "catalog:",
    "@types/node": "catalog:",
    "@types/react": "catalog:",
    "@types/react-dom": "catalog:",
    "@vitejs/plugin-react": "catalog:",
    "browser-automation": "workspace:*",
    "playwright": "1.61.0",
    "typescript": "catalog:",
    "vite": "catalog:",
    "vitest": "catalog:"
  }
}
```

(`@novnc/novnc` is an exact pin — it is not in the pnpm catalog; precedent: `playwright: "1.61.0"` in this same package. The `build`/`dev` scripts mirror `packages/widgets/clock/package.json` verbatim.)

Run: `rtk pnpm install`
Expected: lockfile gains `@novnc/novnc@1.7.0` and the React/widget-sdk deps for this package; no peer warnings that don't already exist.

- [ ] **Step 2: Update `tsconfig.json`**

Replace `packages/widgets/passport-checker/tsconfig.json` with (merges clock's JSX/testing settings with this package's existing `node` types, which `browser/` needs):

```json
{
  "compilerOptions": {
    "target": "ESNext",
    "lib": ["ES2024", "DOM", "DOM.Iterable"],
    "module": "ESNext",
    "moduleResolution": "bundler",
    "jsx": "react-jsx",
    "strict": true,
    "noUnusedLocals": true,
    "noUnusedParameters": true,
    "skipLibCheck": true,
    "noEmit": true,
    "allowImportingTsExtensions": true,
    "types": ["node", "vite/client", "vitest/globals", "@testing-library/jest-dom"],
    "paths": {
      "@/*": ["./*"],
      "@shared/*": ["../../shared/*"]
    }
  },
  "include": ["."]
}
```

- [ ] **Step 3: Switch vitest to the shared widget config and pin existing tests to node**

Replace `packages/widgets/passport-checker/vitest.config.ts` with:

```ts
import { defineWidgetVitestConfig } from 'widget-sdk/vite'

export default defineWidgetVitestConfig(import.meta.dirname)
```

Add this pragma as the **first line** of each of the four existing test files (`browser.test.ts`, `browser/check.test.ts`, `browser/check.integration.test.ts`, `browser/contracts.test.ts`):

```ts
// @vitest-environment node
```

Run: `rtk pnpm --filter widgets-passport-checker test`
Expected: PASS — all pre-existing browser tests still green under the new config (the shared setup file is node-env-safe; if any file fails on a jsdom-only global, the pragma is missing on it).

- [ ] **Step 4: Ambient types for `@novnc/novnc`**

Create `packages/widgets/passport-checker/novnc.d.ts` (the package ships no types; this declares only the surface the widget touches — verified against `core/rfb.js` of v1.7.0):

```ts
// Minimal ambient types for @novnc/novnc@1.7.0 (the package ships no .d.ts).
// Only the surface the recovery panel touches; see docs/API.md in the package.
declare module '@novnc/novnc' {
  export type NoVncCredentials = { username?: string; password?: string; target?: string }
  export type NoVncOptions = {
    shared?: boolean
    credentials?: NoVncCredentials
    repeaterID?: string
    wsProtocols?: string[]
  }

  export default class RFB extends EventTarget {
    constructor(target: HTMLElement, urlOrChannel: string | WebSocket, options?: NoVncOptions)
    disconnect(): void
    focus(options?: FocusOptions): void
    blur(): void
    scaleViewport: boolean
    clipViewport: boolean
    resizeSession: boolean
    viewOnly: boolean
    background: string
  }
}
```

- [ ] **Step 5: Add the events type to `types.ts`**

Append to `packages/widgets/passport-checker/types.ts`:

```ts
import type { InferWidgetEvents } from '@shared/widgets/contracts'
```

(add to the existing import block at the top), and at the bottom:

```ts
export type PassportCheckerEvents = InferWidgetEvents<typeof passportCheckerBrowserSchemas>
```

- [ ] **Step 6: Stub root component + `client.ts`**

Create `packages/widgets/passport-checker/ui/PassportChecker.tsx` (stub; Task 8 replaces the body but keeps the export shape):

```tsx
import { reatomMemo } from 'widget-sdk/reatom/reatom-memo'

export const PassportChecker = reatomMemo(() => {
  return <div>Паспорт</div>
}, 'PassportChecker')
```

Create `packages/widgets/passport-checker/client.ts`:

```ts
import { defineWidgetClient } from 'widget-sdk/define-widget-client'

import type { PassportCheckerEvents } from './types'

export const passportCheckerWidget = defineWidgetClient<PassportCheckerEvents>({
  title: 'Паспорт',
  description: 'Проверка статуса паспорта',
  defaultSize: { w: 4, h: 4, minW: 2, minH: 2 },
  icon: 'IdCard',
  tiers: {
    tiny: { minWidthPx: 0, minHeightPx: 0 },
    compact: { minWidthPx: 0, minHeightPx: 0 },
    standard: { minWidthPx: 321, minHeightPx: 0 },
    large: { minWidthPx: 321, minHeightPx: 0 },
  },
  loadComponent: () =>
    import('./ui/PassportChecker').then(({ PassportChecker }) => ({ default: PassportChecker })),
})

export default passportCheckerWidget
```

Tier note (spec wants exactly two visual tiers with a 321px boundary, but `TierConfig` requires all four keys): with this config `resolveTier` yields `'large'` at ≥ 321px width and `'compact'` below (never `'tiny'`/`'standard'` literally). The component collapses tier names into the two spec layouts via `isStandardLayout` (Task 8): `standard | large | fullscreen` → standard layout, `tiny | compact` → tiny layout.

- [ ] **Step 7: Write the client contract test**

Create `packages/widgets/passport-checker/client.test.ts`:

```ts
import { resolveTier } from 'widget-runtime'

import { passportCheckerWidget } from './client'

describe('passport checker client definition', () => {
  it('collapses to two layouts at the 321px breakpoint', () => {
    const tiers = passportCheckerWidget.tiers
    if (!tiers) throw new Error('expected a tiers config')
    expect(resolveTier({ width: 320, height: 400 }, tiers)).toBe('compact')
    expect(resolveTier({ width: 321, height: 400 }, tiers)).toBe('large')
  })

  it('declares the passport catalog metadata', () => {
    expect(passportCheckerWidget.title).toBe('Паспорт')
    expect(passportCheckerWidget.description).toBe('Проверка статуса паспорта')
    expect(passportCheckerWidget.icon).toBe('IdCard')
    expect(passportCheckerWidget.defaultSize).toEqual({ w: 4, h: 4, minW: 2, minH: 2 })
  })
})
```

(`resolveTier` is re-exported from the `widget-runtime` barrel — `packages/widget-runtime/src/index.ts` has `export * from './tier'`; verified.)

Run: `rtk pnpm --filter widgets-passport-checker exec vitest run client.test.ts`
Expected: PASS.

- [ ] **Step 8: `index.html`, `vite.config.ts`, dev harness**

Create `packages/widgets/passport-checker/index.html`:

```html
<!doctype html>
<html lang="ru">
  <head>
    <meta charset="UTF-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1.0" />
    <title>passport-checker - standalone</title>
  </head>
  <body>
    <div id="root" style="width: 100vw; height: 100vh"></div>
    <script type="module" src="/dev/main.tsx"></script>
  </body>
</html>
```

Create `packages/widgets/passport-checker/vite.config.ts`:

```ts
import { defineWidgetViteConfig } from 'widget-sdk/vite'

export default defineWidgetViteConfig(import.meta.dirname)
```

Create `packages/widgets/passport-checker/dev/dev-tokens.css` — the standalone page has no board stylesheet, so the harness ships the light-theme token subset the widget consumes (dev-only file, values copied from `packages/client/src/shared/theme/tokens.css` + `packages/client/src/app/global.css`):

```css
:root {
  --background: oklch(0.975 0.003 255);
  --foreground: oklch(0.27 0.02 262);
  --card: oklch(1 0 0);
  --primary: oklch(0.55 0.17 281);
  --primary-foreground: #ffffff;
  --primary-hover: color-mix(in oklch, var(--primary), black 12%);
  --muted-foreground: oklch(0.5 0.018 262);
  --secondary: oklch(0.972 0.004 255);
  --secondary-foreground: oklch(0.5 0.018 262);
  --border: oklch(0.91 0.005 255);
  --border-strong: oklch(0.84 0.006 255);
  --board: oklch(0.96 0.004 255);
  --accent-soft: oklch(0.955 0.032 285);
  --scrim: oklch(0.45 0.02 262 / 0.34);
  --success: oklch(0.55 0.13 155);
  --success-soft: oklch(0.95 0.05 155);
  --destructive: oklch(0.577 0.245 27.325);
  --destructive-soft: oklch(0.968 0.028 27);
  --text-3: oklch(0.66 0.012 262);
  --shadow-card: 0 1px 2px rgba(20, 22, 40, 0.05), 0 2px 8px rgba(20, 22, 40, 0.05);
  --shadow-overlay: 0 24px 50px -18px rgba(30, 32, 55, 0.22);
  --surface: var(--card);
  --text: var(--foreground);
  --text-dim: var(--muted-foreground);
  --font-ui: 'Hanken Grotesk', system-ui, sans-serif;
  --font-display: var(--font-ui);
  --font-mono: ui-monospace, 'JetBrains Mono', monospace;
  --accent-2: var(--primary);
}

body {
  margin: 0;
  background: var(--board);
  font-family: var(--font-ui);
}
```

Create `packages/widgets/passport-checker/dev/harness.tsx` (clock's pattern verbatim, passport ids):

```tsx
import { lazy, Suspense } from 'react'
import { makeHostRuntime, WidgetRuntimeContext } from 'widget-runtime'
import type { WidgetRuntimeProps } from 'widget-runtime'
import { reatomMemo } from 'widget-sdk'

import client from '../client'

const Widget = lazy(client.loadComponent)

const DEV_ID = 'passport-checker'

const runtime = makeHostRuntime() // bare: no auth anywhere in a harness

export function harnessProps(): WidgetRuntimeProps {
  return {
    instanceId: `dev:${DEV_ID}`,
    typeId: DEV_ID,
    mode: 'large',
    tier: 'standard',
    theme: 'light',
    requestFullscreen: () => {},
    requestClose: () => {},
    requestDelete: () => {},
    reportError: (error) => console.warn('[harness]', error),
    storage: runtime.makeWidgetStorage({ instanceId: `dev:${DEV_ID}`, typeId: DEV_ID }),
    api: runtime.makeWidgetApi({ instanceId: `dev:${DEV_ID}`, typeId: DEV_ID }),
  }
}

export const HarnessApp = reatomMemo(
  () => (
    <Suspense fallback={null}>
      <WidgetRuntimeContext.Provider value={harnessProps()}>
        <Widget />
      </WidgetRuntimeContext.Provider>
    </Suspense>
  ),
  'PassportCheckerHarness',
)
```

Create `packages/widgets/passport-checker/dev/main.tsx`:

```tsx
import { createRoot } from 'react-dom/client'

import { HarnessApp } from './harness'

import './dev-tokens.css'

const root = document.getElementById('root')
if (root) createRoot(root).render(<HarnessApp />)
```

Create `packages/widgets/passport-checker/dev/harness.test.tsx`:

```tsx
import { render, screen } from '@testing-library/react'

import { HarnessApp, harnessProps } from './harness'

describe('passport-checker harness', () => {
  it('builds real runtime props bound to the dev instance', () => {
    const props = harnessProps()

    expect(props.typeId).toBe('passport-checker')
    expect(typeof props.storage.instance.client.get).toBe('function')
    expect(typeof props.api.invoke).toBe('function')
  })

  it('renders the widget standalone', async () => {
    render(<HarnessApp />)
    expect(await screen.findByText('Паспорт')).toBeInTheDocument()
  })
})
```

- [ ] **Step 9: Run codegen and the package suite**

Run: `rtk pnpm codegen`
Expected: `packages/widgets/.ports.json` gains `"passport-checker": 5182`; the generated client catalog/icons and browser/server lists regenerate without error (`IdCard` is a valid lucide-react export).

Run: `rtk pnpm --filter widgets-passport-checker test && rtk pnpm --filter widgets-passport-checker typecheck`
Expected: PASS.

- [ ] **Step 10: Commit**

```bash
rtk git add packages/widgets/passport-checker packages/widgets/.ports.json
rtk git commit -m "feat(passport-checker): scaffold the widget client package"
```

(If `rtk git status` shows `.ports.json` as untracked-ignored, commit without it.)

---

### Task 4: passport widget `server.ts` — gateway-error → public-code mapping

**Files:**

- Create: `packages/widgets/passport-checker/server.ts`
- Test: `packages/widgets/passport-checker/server.test.ts`

**Interfaces:**

- Consumes: `defineWidgetServer`, `WidgetServerContext` (`@shared/widgets/contracts`), `PublicWidgetError` (`@shared/widgets/public-error`, Task 1), the gateway error family (`@shared/widgets/browser-errors`), `passportCheckerBrowserSchemas` + `passportCheckerBrowserTasks` (`./types`).
- Produces: default export `WidgetServerDefinition` with one `check` handler; exported `makePassportCheckerServer()` factory and `mapRejectedTask(error: BrowserTaskRejectedError): PublicWidgetError` (unit-tested directly). Discovered by `codegen:server` as typeId `passport-checker`.

Error mapping contract (the client narrows on `code`; statuses are for ops/logs — 500 triggers server-side `console.error` in `sendWidgetError`, deliberately used for admin-actionable misconfiguration):

| Gateway result                                        | status | code                        | meta                                                   |
| ----------------------------------------------------- | ------ | --------------------------- | ------------------------------------------------------ |
| `BrowserTaskRejectedError` `browser_session_required` | 409    | `browser_session_required`  | `{ sshTarget }` only when `meta.sshTarget` is a string |
| `BrowserTaskRejectedError` `browser_configuration`    | 500    | `browser_configuration`     | —                                                      |
| `BrowserTaskRejectedError` `upstream_response`        | 502    | `upstream_response`         | —                                                      |
| `BrowserTaskRejectedError` `invalid_checker_response` | 502    | `invalid_checker_response`  | —                                                      |
| `BrowserTaskRejectedError` any other code             | 502    | passthrough of `error.code` | —                                                      |
| `BrowserAutomationUnavailableError`                   | 503    | `browser_unavailable`       | —                                                      |
| `BrowserAutomationDeadlineError`                      | 504    | `automation_timeout`        | —                                                      |
| `BrowserAutomationProtocolError`                      | 502    | `automation_protocol`       | —                                                      |

`publicMessage` passes through from `BrowserTaskRejectedError.publicMessage` (already safe by construction — it comes from the task's public copy); the three automation errors get static English messages. Meta is **filtered to exactly `sshTarget`** — no other key is ever copied (the upstream task also puts `phase`/`status` into meta for other codes; those must not leak).

- [ ] **Step 1: Write the failing tests**

Create `packages/widgets/passport-checker/server.test.ts`:

```ts
// @vitest-environment node
import {
  BrowserAutomationDeadlineError,
  BrowserAutomationProtocolError,
  BrowserAutomationUnavailableError,
  BrowserTaskRejectedError,
} from '@shared/widgets/browser-errors'
import type { WidgetServerContext } from '@shared/widgets/contracts'
import { PublicWidgetError } from '@shared/widgets/public-error'

import { makePassportCheckerServer, mapRejectedTask } from './server'

function rejected(code: string, meta?: Record<string, unknown>) {
  return new BrowserTaskRejectedError({
    widgetId: 'passport-checker',
    taskId: 'check',
    code,
    publicMessage: `public message for ${code}`,
    meta,
  })
}

function makeContext(invokeResult: unknown) {
  const calls: Array<{ taskId: string; payload: unknown }> = []
  const context = {
    typeId: 'passport-checker',
    instanceId: 'placement-1',
    ip: null,
    now: () => 0,
    api: {
      browser: {
        invoke: async (task: { id: string }, payload: unknown) => {
          calls.push({ taskId: task.id, payload })
          return invokeResult
        },
      },
    },
  } as unknown as WidgetServerContext
  return { context, calls }
}

async function runCheck(invokeResult: unknown) {
  const definition = makePassportCheckerServer()
  const { context, calls } = makeContext(invokeResult)
  const result = await definition.handlers.check({}, context)
  return { result, calls }
}

describe('passport checker server', () => {
  it('passes a validated result through and sends an empty payload', async () => {
    const { result, calls } = await runCheck({ status: 200, send_status_msg: 'Готово' })

    expect(result).toEqual({ status: 200, send_status_msg: 'Готово' })
    expect(calls).toEqual([{ taskId: 'check', payload: {} }])
  })

  it.each([
    [
      rejected('browser_session_required', { sshTarget: 'admin@pi' }),
      409,
      'browser_session_required',
      { sshTarget: 'admin@pi' },
    ],
    [rejected('browser_session_required'), 409, 'browser_session_required', undefined],
    [rejected('browser_configuration'), 500, 'browser_configuration', undefined],
    [
      rejected('upstream_response', { phase: 'submission', status: 502 }),
      502,
      'upstream_response',
      undefined,
    ],
    [rejected('invalid_checker_response'), 502, 'invalid_checker_response', undefined],
    [rejected('some_future_code'), 502, 'some_future_code', undefined],
    [
      new BrowserAutomationUnavailableError({ operation: 'invoke' }),
      503,
      'browser_unavailable',
      undefined,
    ],
    [new BrowserAutomationDeadlineError({ timeoutMs: 1000 }), 504, 'automation_timeout', undefined],
    [
      new BrowserAutomationProtocolError({
        phase: 'result',
        widgetId: 'passport-checker',
        taskId: 'check',
      }),
      502,
      'automation_protocol',
      undefined,
    ],
  ])('maps %s to a public widget error', async (gatewayError, status, code, meta) => {
    const { result } = await runCheck(gatewayError)

    expect(result).toBeInstanceOf(PublicWidgetError)
    if (!(result instanceof PublicWidgetError)) throw new Error('expected PublicWidgetError')
    expect(result.status).toBe(status)
    expect(result.code).toBe(code)
    expect(result.meta).toEqual(meta)
  })

  it('filters meta down to sshTarget only', () => {
    const mapped = mapRejectedTask(
      rejected('browser_session_required', { sshTarget: 'admin@pi', secret: 'never' }),
    )

    expect(mapped.meta).toEqual({ sshTarget: 'admin@pi' })
  })

  it('drops a non-string sshTarget', () => {
    const mapped = mapRejectedTask(rejected('browser_session_required', { sshTarget: 42 }))

    expect(mapped.meta).toBeUndefined()
  })

  it('keeps the rejected error public message', () => {
    const mapped = mapRejectedTask(rejected('upstream_response'))

    expect(mapped.publicMessage).toBe('public message for upstream_response')
  })
})
```

- [ ] **Step 2: Run to verify failure**

Run: `rtk pnpm --filter widgets-passport-checker exec vitest run server.test.ts`
Expected: FAIL — `./server` does not exist.

- [ ] **Step 3: Implement `server.ts`**

Create `packages/widgets/passport-checker/server.ts`:

```ts
import {
  BrowserAutomationDeadlineError,
  BrowserAutomationProtocolError,
  BrowserAutomationUnavailableError,
  BrowserTaskRejectedError,
} from '@shared/widgets/browser-errors'
import { defineWidgetServer } from '@shared/widgets/contracts'
import { PublicWidgetError } from '@shared/widgets/public-error'

import { passportCheckerBrowserSchemas, passportCheckerBrowserTasks } from './types'

export function mapRejectedTask(error: BrowserTaskRejectedError): PublicWidgetError {
  if (error.code === 'browser_session_required') {
    const sshTarget = error.meta?.sshTarget
    return new PublicWidgetError({
      status: 409,
      code: 'browser_session_required',
      publicMessage: error.publicMessage,
      meta: typeof sshTarget === 'string' ? { sshTarget } : undefined,
      cause: error,
    })
  }
  if (error.code === 'browser_configuration') {
    return new PublicWidgetError({
      status: 500,
      code: 'browser_configuration',
      publicMessage: error.publicMessage,
      cause: error,
    })
  }
  return new PublicWidgetError({
    status: 502,
    code: error.code,
    publicMessage: error.publicMessage,
    cause: error,
  })
}

export function makePassportCheckerServer() {
  return defineWidgetServer({
    schemas: passportCheckerBrowserSchemas,
    handlers: {
      async check(_payload, context) {
        const result = await context.api.browser.invoke(passportCheckerBrowserTasks.check, {})
        if (result instanceof BrowserTaskRejectedError) return mapRejectedTask(result)
        if (result instanceof BrowserAutomationUnavailableError) {
          return new PublicWidgetError({
            status: 503,
            code: 'browser_unavailable',
            publicMessage: 'Browser automation is unavailable',
            cause: result,
          })
        }
        if (result instanceof BrowserAutomationDeadlineError) {
          return new PublicWidgetError({
            status: 504,
            code: 'automation_timeout',
            publicMessage: 'The passport check timed out',
            cause: result,
          })
        }
        if (result instanceof BrowserAutomationProtocolError) {
          return new PublicWidgetError({
            status: 502,
            code: 'automation_protocol',
            publicMessage: 'Browser automation returned an unexpected response',
            cause: result,
          })
        }
        return result
      },
    },
  })
}

export default makePassportCheckerServer()
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `rtk pnpm --filter widgets-passport-checker exec vitest run server.test.ts`
Expected: PASS.

- [ ] **Step 5: Wire through server codegen and verify the server side compiles**

Run: `rtk pnpm codegen:server`
Expected: `packages/server/src/widgets/widget-server-list.generated.ts` now imports `@widgets/passport-checker/server` and lists `typeId: "passport-checker"`.

Run: `rtk pnpm --filter server typecheck && rtk pnpm --filter widgets-passport-checker typecheck`
Expected: PASS (the server tsconfig maps `@widgets/*`; the handler's return union `PublicWidgetError | PassportCheckResult` satisfies `Awaitable<Error | z.input<result>>`).

- [ ] **Step 6: Commit**

```bash
rtk git add packages/widgets/passport-checker/server.ts packages/widgets/passport-checker/server.test.ts
rtk git commit -m "feat(passport-checker): add the widget server check handler"
```

---

### Task 5: `check-model.ts` — async check action, deadline, view-state mapping

**Files:**

- Create: `packages/widgets/passport-checker/model/check-model.ts`
- Test: `packages/widgets/passport-checker/model/check-model.test.ts`

**Interfaces:**

- Consumes: `WidgetApi` (`@shared/widgets/contracts`), `WidgetApiError` (class, from `widget-runtime` — Task 2 shape: `code: string`, `meta?`), `PassportCheckerEvents` (`../types`, Task 3).
- Produces (Task 8 consumes all of it):
  - `type ViewState = { kind: 'idle' } | { kind: 'pending' } | { kind: 'success'; status: number; message: string; checkedAtLabel: string } | { kind: 'retryable'; message: string } | { kind: 'invalidConfig' } | { kind: 'sessionRequired'; sshTarget: string | null }`
  - `makePassportCheckModel({ api, deadlineMs?, now? })` → `{ viewState: Atom<ViewState>, recoveryOpen: Atom<boolean>, checkPassport: Action }`
  - `type PassportCheckModel = ReturnType<typeof makePassportCheckModel>`
  - `mapCheckError(error): ViewState`, `RETRYABLE_MESSAGES`, `GENERIC_RETRYABLE_MESSAGE`, `CHECK_DEADLINE_MS = 25_000`, `CheckDeadlineError`.

Design notes (deliberate, do not "fix" during implementation):

- The model is an explicit state machine on one `viewState` atom rather than `withAsync` status atoms: `api.invoke` returns errors **as values** (errore), so `withAsync`'s thrown-error tracking would never see them, and the client deadline race needs a single settle point anyway.
- Duplicate submits are prevented in the model (`if (viewState().kind === 'pending') return`) _and_ the UI disables the button while pending (spec: button stays enabled otherwise for native focus).
- `wrap()`ed continuations are created **inside the action, before the first `await`** — never hoisted to module scope (repo pitfalls: post-await writes hit the global context; a hoisted wrap aborts after `context.reset()`).
- The client-side deadline maps to the same view as the server's `automation_timeout` (spec).

- [ ] **Step 1: Write the failing tests**

Create `packages/widgets/passport-checker/model/check-model.test.ts`:

```ts
import { context, wrap } from '@reatom/core'
import type { WidgetApi } from '@shared/widgets/contracts'
import { WidgetApiError } from 'widget-runtime'

import type { PassportCheckerEvents } from '../types'
import {
  GENERIC_RETRYABLE_MESSAGE,
  makePassportCheckModel,
  mapCheckError,
  RETRYABLE_MESSAGES,
} from './check-model'

type CheckResult = { status: number; send_status_msg: string }

function makeApi() {
  const invoke =
    vi.fn<
      (event: 'check', payload: Record<string, never>) => Promise<WidgetApiError | CheckResult>
    >()
  const api = { invoke } as unknown as WidgetApi<PassportCheckerEvents, WidgetApiError>
  return { api, invoke }
}

function apiError(code: string, meta?: Record<string, unknown>) {
  return new WidgetApiError({ reason: `${code}: message`, code, meta })
}

afterEach(() => {
  vi.useRealTimers()
  context.reset()
})

describe('mapCheckError', () => {
  it.each([
    ['browser_unavailable', RETRYABLE_MESSAGES.browser_unavailable],
    ['automation_timeout', RETRYABLE_MESSAGES.automation_timeout],
    ['upstream_response', RETRYABLE_MESSAGES.upstream_response],
    ['invalid_checker_response', RETRYABLE_MESSAGES.invalid_checker_response],
    ['automation_protocol', RETRYABLE_MESSAGES.automation_protocol],
    ['network', GENERIC_RETRYABLE_MESSAGE],
    ['some_future_code', GENERIC_RETRYABLE_MESSAGE],
  ])('maps %s to a retryable view', (code, message) => {
    expect(mapCheckError(apiError(code))).toEqual({ kind: 'retryable', message })
  })

  it('maps browser_session_required with sshTarget', () => {
    expect(mapCheckError(apiError('browser_session_required', { sshTarget: 'admin@pi' }))).toEqual({
      kind: 'sessionRequired',
      sshTarget: 'admin@pi',
    })
  })

  it('maps browser_session_required without sshTarget to null', () => {
    expect(mapCheckError(apiError('browser_session_required'))).toEqual({
      kind: 'sessionRequired',
      sshTarget: null,
    })
  })

  it('maps browser_configuration to invalidConfig', () => {
    expect(mapCheckError(apiError('browser_configuration'))).toEqual({ kind: 'invalidConfig' })
  })
})

describe('makePassportCheckModel', () => {
  it('goes idle -> pending -> success with a local HH:MM stamp', async () => {
    const { api, invoke } = makeApi()
    let resolveInvoke: (value: WidgetApiError | CheckResult) => void = () => {}
    invoke.mockReturnValueOnce(
      new Promise<WidgetApiError | CheckResult>((resolve) => {
        resolveInvoke = resolve
      }),
    )

    await context.start(async () => {
      const model = makePassportCheckModel({
        api,
        now: () => new Date('2026-07-24T13:07:00'),
      })
      const read = wrap(() => model.viewState())
      expect(read()).toEqual({ kind: 'idle' })

      const run = wrap(() => model.checkPassport())
      const pending = run()
      expect(read()).toEqual({ kind: 'pending' })

      resolveInvoke({ status: 200, send_status_msg: 'Документ готовий' })
      await pending

      expect(read()).toEqual({
        kind: 'success',
        status: 200,
        message: 'Документ готовий',
        checkedAtLabel: '13:07',
      })
    })
  })

  it('ignores a duplicate submit while pending', async () => {
    const { api, invoke } = makeApi()
    let resolveInvoke: (value: WidgetApiError | CheckResult) => void = () => {}
    invoke.mockReturnValueOnce(
      new Promise<WidgetApiError | CheckResult>((resolve) => {
        resolveInvoke = resolve
      }),
    )

    await context.start(async () => {
      const model = makePassportCheckModel({ api })
      const run = wrap(() => model.checkPassport())

      const first = run()
      const second = run()
      expect(invoke).toHaveBeenCalledTimes(1)

      resolveInvoke({ status: 200, send_status_msg: 'ok' })
      await Promise.all([first, second])
    })
  })

  it('maps an error code to its view state', async () => {
    const { api, invoke } = makeApi()
    invoke.mockResolvedValueOnce(apiError('browser_session_required', { sshTarget: 'admin@pi' }))

    await context.start(async () => {
      const model = makePassportCheckModel({ api })
      const read = wrap(() => model.viewState())
      const run = wrap(() => model.checkPassport())

      await run()

      expect(read()).toEqual({ kind: 'sessionRequired', sshTarget: 'admin@pi' })
    })
  })

  it('settles to the timeout view when the deadline fires first', async () => {
    vi.useFakeTimers()
    const { api, invoke } = makeApi()
    invoke.mockReturnValueOnce(new Promise<never>(() => {}))

    await context.start(async () => {
      const model = makePassportCheckModel({ api, deadlineMs: 1_000 })
      const read = wrap(() => model.viewState())
      const run = wrap(() => model.checkPassport())

      const pending = run()
      await vi.advanceTimersByTimeAsync(1_000)
      await pending

      expect(read()).toEqual({
        kind: 'retryable',
        message: RETRYABLE_MESSAGES.automation_timeout,
      })
    })
  })

  it('starts with the recovery modal closed', () => {
    const { api } = makeApi()
    const model = makePassportCheckModel({ api })
    expect(model.recoveryOpen()).toBe(false)
  })
})
```

- [ ] **Step 2: Run to verify failure**

Run: `rtk pnpm --filter widgets-passport-checker exec vitest run model/check-model.test.ts`
Expected: FAIL — `./check-model` does not exist.

- [ ] **Step 3: Implement the model**

Create `packages/widgets/passport-checker/model/check-model.ts`:

```ts
import type { WidgetApi } from '@shared/widgets/contracts'
import { action, atom, wrap } from '@reatom/core'
import * as errore from 'errore'
import { WidgetApiError } from 'widget-runtime'

import type { PassportCheckerEvents } from '../types'

export const CHECK_DEADLINE_MS = 25_000

export class CheckDeadlineError extends errore.createTaggedError({
  name: 'CheckDeadlineError',
  message: 'Passport check exceeded $timeoutMs ms',
  extends: errore.AbortError,
}) {}

export type ViewState =
  | { kind: 'idle' }
  | { kind: 'pending' }
  | { kind: 'success'; status: number; message: string; checkedAtLabel: string }
  | { kind: 'retryable'; message: string }
  | { kind: 'invalidConfig' }
  | { kind: 'sessionRequired'; sshTarget: string | null }

export const RETRYABLE_MESSAGES: Record<string, string> = {
  browser_unavailable: 'Сервис автоматизации недоступен',
  automation_timeout: 'Проверка не уложилась в отведённое время',
  upstream_response: 'Сервис проверки временно недоступен',
  invalid_checker_response: 'Сервис проверки вернул неожиданный ответ',
  automation_protocol: 'Внутренняя ошибка автоматизации',
}

export const GENERIC_RETRYABLE_MESSAGE = 'Не удалось выполнить проверку'

export function mapCheckError(error: WidgetApiError | CheckDeadlineError): ViewState {
  if (error instanceof CheckDeadlineError) {
    return { kind: 'retryable', message: RETRYABLE_MESSAGES.automation_timeout }
  }
  if (error.code === 'browser_session_required') {
    const sshTarget = error.meta?.sshTarget
    return {
      kind: 'sessionRequired',
      sshTarget: typeof sshTarget === 'string' ? sshTarget : null,
    }
  }
  if (error.code === 'browser_configuration') return { kind: 'invalidConfig' }
  return { kind: 'retryable', message: RETRYABLE_MESSAGES[error.code] ?? GENERIC_RETRYABLE_MESSAGE }
}

function formatCheckedAt(date: Date): string {
  const hours = String(date.getHours()).padStart(2, '0')
  const minutes = String(date.getMinutes()).padStart(2, '0')
  return `${hours}:${minutes}`
}

function withDeadline<T>(
  promise: Promise<T>,
  timeoutMs: number,
): Promise<T | CheckDeadlineError | WidgetApiError> {
  return new Promise((resolve) => {
    const timer = setTimeout(() => resolve(new CheckDeadlineError({ timeoutMs })), timeoutMs)
    promise.then(
      (value) => {
        clearTimeout(timer)
        resolve(value)
      },
      (cause: unknown) => {
        clearTimeout(timer)
        // invoke returns errors as values; a rejection here is an unexpected bug.
        resolve(
          new WidgetApiError({ reason: 'invoke rejected unexpectedly', code: 'network', cause }),
        )
      },
    )
  })
}

export type MakePassportCheckModelOptions = {
  api: WidgetApi<PassportCheckerEvents, WidgetApiError>
  deadlineMs?: number
  now?: () => Date
}

export type PassportCheckModel = ReturnType<typeof makePassportCheckModel>

export function makePassportCheckModel({
  api,
  deadlineMs = CHECK_DEADLINE_MS,
  now = () => new Date(),
}: MakePassportCheckModelOptions) {
  const viewState = atom<ViewState>({ kind: 'idle' }, 'passportCheck.viewState')
  const recoveryOpen = atom(false, 'passportCheck.recoveryOpen')

  const checkPassport = action(async () => {
    if (viewState().kind === 'pending') return
    viewState.set({ kind: 'pending' })
    // Continuations after `await` run outside the calling frame; capture the
    // frame-bound writer now (repo wrap rules — never hoist it to module scope).
    const settle = wrap((next: ViewState) => viewState.set(next))

    const result = await withDeadline(api.invoke('check', {}), deadlineMs)
    if (result instanceof Error) {
      settle(mapCheckError(result))
      return
    }
    settle({
      kind: 'success',
      status: result.status,
      message: result.send_status_msg,
      checkedAtLabel: formatCheckedAt(now()),
    })
  }, 'passportCheck.check')

  return { viewState, recoveryOpen, checkPassport }
}
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `rtk pnpm --filter widgets-passport-checker exec vitest run model/check-model.test.ts`
Expected: PASS.

- [ ] **Step 5: Typecheck and commit**

Run: `rtk pnpm --filter widgets-passport-checker typecheck`
Expected: PASS.

```bash
rtk git add packages/widgets/passport-checker/model/check-model.ts packages/widgets/passport-checker/model/check-model.test.ts
rtk git commit -m "feat(passport-checker): add the check model with deadline and error mapping"
```

---

### Task 6: recovery adapters — `recovery-transport.ts` and `rfb.ts`

**Files:**

- Create: `packages/widgets/passport-checker/model/recovery-transport.ts`
- Create: `packages/widgets/passport-checker/model/recovery-transport.test.ts`
- Create: `packages/widgets/passport-checker/model/rfb.ts` (no unit test — see note)

**Interfaces:**

- Consumes: Subproject 6 endpoint (`POST /api/browser/recovery/:widgetId`), `@novnc/novnc` (typed by Task 3's `novnc.d.ts`).
- Produces (Task 7 injects both, tests fake them):
  - `type RecoveryIssue = { expiresInMs: number }`
  - `type RecoveryIssueCode = 'recovery_unavailable' | 'recovery_busy' | 'automation_unavailable' | 'network' | 'invalid_response'`
  - `class RecoveryIssueError` (errore tagged, `code: RecoveryIssueCode`)
  - `type RecoveryTransport = { issue(widgetId: string): Promise<RecoveryIssueError | RecoveryIssue> }`
  - `makeRecoveryTransport(fetchFn?: typeof fetch): RecoveryTransport`
  - `type RfbLike = { addEventListener/removeEventListener('connect' | 'disconnect' | 'securityfailure', listener), disconnect(): void }`
  - `type MakeRfb = (target: HTMLElement, url: string) => RfbLike`
  - `makeNoVncRfb: MakeRfb`

- [ ] **Step 1: Write the failing transport tests**

Create `packages/widgets/passport-checker/model/recovery-transport.test.ts`:

```ts
import { makeRecoveryTransport, RecoveryIssueError } from './recovery-transport'

function fakeResponse(status: number, body?: unknown): Response {
  return {
    ok: status >= 200 && status < 300,
    status,
    json: async () => body,
  } as Response
}

async function issueWith(response: Response | 'reject') {
  const fetchFn = vi.fn(async () => {
    if (response === 'reject') throw new Error('offline')
    return response
  })
  const transport = makeRecoveryTransport(fetchFn as unknown as typeof fetch)
  const result = await transport.issue('passport-checker')
  return { result, fetchFn }
}

describe('makeRecoveryTransport', () => {
  it('POSTs same-origin with the CSRF header and parses expiresInMs', async () => {
    const { result, fetchFn } = await issueWith(fakeResponse(200, { expiresInMs: 60_000 }))

    expect(result).toEqual({ expiresInMs: 60_000 })
    expect(fetchFn).toHaveBeenCalledWith('/api/browser/recovery/passport-checker', {
      method: 'POST',
      credentials: 'same-origin',
      headers: { 'X-Requested-With': 'MyBoard' },
    })
  })

  it.each([
    [404, 'recovery_unavailable'],
    [409, 'recovery_busy'],
    [503, 'automation_unavailable'],
    [418, 'invalid_response'],
  ])('maps HTTP %s to %s', async (status, code) => {
    const { result } = await issueWith(fakeResponse(status, { code }))

    expect(result).toBeInstanceOf(RecoveryIssueError)
    if (!(result instanceof RecoveryIssueError)) throw new Error('expected RecoveryIssueError')
    expect(result.code).toBe(code)
  })

  it('maps a network failure to the network code', async () => {
    const { result } = await issueWith('reject')

    expect(result).toBeInstanceOf(RecoveryIssueError)
    if (!(result instanceof RecoveryIssueError)) throw new Error('expected RecoveryIssueError')
    expect(result.code).toBe('network')
  })

  it('maps an unparseable success body to invalid_response', async () => {
    const { result } = await issueWith(fakeResponse(200, { nonsense: true }))

    expect(result).toBeInstanceOf(RecoveryIssueError)
    if (!(result instanceof RecoveryIssueError)) throw new Error('expected RecoveryIssueError')
    expect(result.code).toBe('invalid_response')
  })
})
```

- [ ] **Step 2: Run to verify failure**

Run: `rtk pnpm --filter widgets-passport-checker exec vitest run model/recovery-transport.test.ts`
Expected: FAIL — module does not exist.

- [ ] **Step 3: Implement the transport**

Create `packages/widgets/passport-checker/model/recovery-transport.ts`:

```ts
import * as errore from 'errore'
import { z } from 'zod'

const RecoveryIssueResponseSchema = z.object({ expiresInMs: z.number().int().positive() })

export type RecoveryIssue = z.output<typeof RecoveryIssueResponseSchema>

export type RecoveryIssueCode =
  | 'recovery_unavailable'
  | 'recovery_busy'
  | 'automation_unavailable'
  | 'network'
  | 'invalid_response'

type RecoveryIssueErrorOptions = { code: RecoveryIssueCode; cause?: unknown }

export class RecoveryIssueError extends errore.createTaggedError({
  name: 'RecoveryIssueError',
  message: 'Recovery issue failed with $code',
}) {
  declare readonly code: RecoveryIssueCode

  constructor(options: RecoveryIssueErrorOptions) {
    super(options)
  }
}

export type RecoveryTransport = {
  issue(widgetId: string): Promise<RecoveryIssueError | RecoveryIssue>
}

/**
 * Prod adapter for the Subproject 6 issue endpoint. The single-use capability
 * cookie is set by the response and rides the same-origin WS handshake
 * automatically — the token itself never crosses this interface.
 */
export function makeRecoveryTransport(fetchFn: typeof fetch = fetch): RecoveryTransport {
  return {
    async issue(widgetId) {
      const response = await fetchFn(`/api/browser/recovery/${encodeURIComponent(widgetId)}`, {
        method: 'POST',
        credentials: 'same-origin',
        headers: { 'X-Requested-With': 'MyBoard' },
      }).catch((cause: unknown) => new RecoveryIssueError({ code: 'network', cause }))
      if (response instanceof Error) return response

      if (response.status === 404) return new RecoveryIssueError({ code: 'recovery_unavailable' })
      if (response.status === 409) return new RecoveryIssueError({ code: 'recovery_busy' })
      if (response.status === 503) return new RecoveryIssueError({ code: 'automation_unavailable' })
      if (!response.ok) return new RecoveryIssueError({ code: 'invalid_response' })

      const body = await (response.json() as Promise<unknown>).catch(
        (cause: unknown) => new RecoveryIssueError({ code: 'invalid_response', cause }),
      )
      if (body instanceof Error) return body

      const parsed = RecoveryIssueResponseSchema.safeParse(body)
      if (!parsed.success) {
        return new RecoveryIssueError({ code: 'invalid_response', cause: parsed.error })
      }
      return parsed.data
    },
  }
}
```

(A `401` — expired board session — falls into the `!response.ok` branch → `invalid_response` → the modal's `automationDown` copy; the board's own session handling owns re-login, deliberately out of scope here.)

- [ ] **Step 4: Implement the RFB adapter**

Create `packages/widgets/passport-checker/model/rfb.ts`:

```ts
import RFB from '@novnc/novnc'

export type RfbEventName = 'connect' | 'disconnect' | 'securityfailure'

export type RfbLike = {
  addEventListener(type: RfbEventName, listener: (event: Event) => void): void
  removeEventListener(type: RfbEventName, listener: (event: Event) => void): void
  disconnect(): void
}

export type MakeRfb = (target: HTMLElement, url: string) => RfbLike

/**
 * Prod adapter around @novnc/novnc. scaleViewport gives contain-fit with
 * letterboxing inside the 16:9 frame (RFB centers its canvas via flex +
 * margin auto against `background`).
 */
export const makeNoVncRfb: MakeRfb = (target, url) => {
  // A previous attempt may have left its screen element behind.
  target.replaceChildren()
  const rfb = new RFB(target, url, { shared: true })
  rfb.scaleViewport = true
  rfb.viewOnly = false
  rfb.background = '#16171d'
  return rfb
}
```

No unit test for `rfb.ts`: constructing a real `RFB` opens a `WebSocket` and touches canvas APIs jsdom does not provide; the adapter is 8 lines of config, faked everywhere else, and exercised only in a real browser. (If importing `@novnc/novnc` at module scope ever crashes jsdom test files that transitively import `rfb.ts`, the fallback is a lazy `await import('@novnc/novnc')` inside an async `MakeRfb` — do NOT preemptively complicate it.)

- [ ] **Step 5: Run tests + typecheck, commit**

Run: `rtk pnpm --filter widgets-passport-checker exec vitest run model/recovery-transport.test.ts && rtk pnpm --filter widgets-passport-checker typecheck`
Expected: PASS.

```bash
rtk git add packages/widgets/passport-checker/model/recovery-transport.ts packages/widgets/passport-checker/model/recovery-transport.test.ts packages/widgets/passport-checker/model/rfb.ts
rtk git commit -m "feat(passport-checker): add recovery transport and noVNC adapters"
```

---

### Task 7: `recovery-model.ts` — capability lifecycle state machine

**Files:**

- Create: `packages/widgets/passport-checker/model/recovery-model.ts`
- Test: `packages/widgets/passport-checker/model/recovery-model.test.ts`

**Interfaces:**

- Consumes: `RecoveryTransport`/`RecoveryIssueError` (Task 6), `MakeRfb`/`RfbLike` (Task 6).
- Produces (Task 9 consumes):
  - `type RecoveryState = { kind: 'issuing' } | { kind: 'connecting'; expiresInMs: number } | { kind: 'connected'; expiresInMs: number } | { kind: 'disconnected' } | { kind: 'expired' } | { kind: 'unavailable' } | { kind: 'busy' } | { kind: 'automationDown' }`
  - `makeRecoveryModel({ widgetId, transport, makeRfb, nowMs?, location? })` → `{ state: Atom<RecoveryState>, remainingMs: Atom<number>, start: Action<(target: HTMLElement)>, teardown: Action }`
  - `type RecoveryModel = ReturnType<typeof makeRecoveryModel>`
  - `recoverySocketUrl(loc: { protocol: string; host: string }): string`
  - `RECOVERY_TICK_MS = 500`

Design decisions (deliberate):

- **Reconnect = `start` again.** The Subproject 6 capability is single-use and dies at the first `consume` regardless of outcome — every attempt does a fresh `POST` (never reuse).
- **The countdown keeps running after `connect` and tears the session down at 0** (literal spec: the pill is "driven by `expiresInMs`", the `expired` frame is drawn from the live view, and the SSH note says «тот же одноразовый срок доступа»). The server's separate 15-min session cap arrives as a plain `disconnect` → `disconnected` → one-click reconnect. If the default 60s window proves too tight operationally, raise `BROWSER_RECOVERY_TOKEN_TTL_MS` on the deployment — do not soften it client-side.
- **Teardown runs exactly once per connection**: the session handle is non-reactive (`let session`), its `dispose` is idempotent, and listeners are removed **before** `rfb.disconnect()` so the RFB's own disconnect event cannot re-enter the state machine during teardown.
- **Stale-attempt guard**: a monotonically increasing `attempt` counter; continuations and event handlers from a superseded attempt return early.
- All post-await atom writes go through `wrap()`ed closures created inside the action before the first `await` (repo Reatom rules).
- Issue-error mapping: `recovery_unavailable` → `unavailable`, `recovery_busy` → `busy`, everything else (`automation_unavailable`, `network`, `invalid_response`) → `automationDown` (logged).

- [ ] **Step 1: Write the failing tests**

Create `packages/widgets/passport-checker/model/recovery-model.test.ts`:

```ts
import { context, wrap } from '@reatom/core'

import { makeRecoveryModel, recoverySocketUrl } from './recovery-model'
import {
  RecoveryIssueError,
  type RecoveryIssue,
  type RecoveryTransport,
} from './recovery-transport'
import type { RfbLike } from './rfb'

class FakeRfb implements RfbLike {
  listeners = new Map<string, Set<(event: Event) => void>>()
  disconnectCalls = 0

  constructor(public url: string) {}

  addEventListener(type: string, listener: (event: Event) => void) {
    const set = this.listeners.get(type) ?? new Set()
    set.add(listener)
    this.listeners.set(type, set)
  }

  removeEventListener(type: string, listener: (event: Event) => void) {
    this.listeners.get(type)?.delete(listener)
  }

  disconnect() {
    this.disconnectCalls += 1
  }

  emit(type: string) {
    for (const listener of [...(this.listeners.get(type) ?? [])]) listener(new Event(type))
  }
}

function makeFakes(results: Array<RecoveryIssueError | RecoveryIssue>) {
  const issueCalls: string[] = []
  const transport: RecoveryTransport = {
    issue: async (widgetId) => {
      issueCalls.push(widgetId)
      const next = results.shift()
      if (!next) throw new Error('unexpected issue call')
      return next
    },
  }
  const rfbs: FakeRfb[] = []
  const makeRfb = (_target: HTMLElement, url: string) => {
    const rfb = new FakeRfb(url)
    rfbs.push(rfb)
    return rfb
  }
  return { transport, makeRfb, issueCalls, rfbs }
}

const LOCATION = { protocol: 'https:', host: 'board.test' }

function makeModel(fakes: ReturnType<typeof makeFakes>, nowMs?: () => number) {
  return makeRecoveryModel({
    widgetId: 'passport-checker',
    transport: fakes.transport,
    makeRfb: fakes.makeRfb,
    location: LOCATION,
    ...(nowMs ? { nowMs } : {}),
  })
}

afterEach(() => {
  vi.useRealTimers()
  context.reset()
})

describe('recoverySocketUrl', () => {
  it('builds wss for https and ws for http', () => {
    expect(recoverySocketUrl({ protocol: 'https:', host: 'a.b' })).toBe(
      'wss://a.b/api/browser/recovery/socket',
    )
    expect(recoverySocketUrl({ protocol: 'http:', host: 'localhost:5173' })).toBe(
      'ws://localhost:5173/api/browser/recovery/socket',
    )
  })
})

describe('makeRecoveryModel', () => {
  it('issues, connects and reflects RFB connect', async () => {
    const fakes = makeFakes([{ expiresInMs: 60_000 }])

    await context.start(async () => {
      const model = makeModel(fakes)
      const read = wrap(() => model.state())
      const start = wrap((el: HTMLElement) => model.start(el))

      await start(document.createElement('div'))

      expect(fakes.issueCalls).toEqual(['passport-checker'])
      expect(read()).toEqual({ kind: 'connecting', expiresInMs: 60_000 })
      expect(fakes.rfbs[0]?.url).toBe('wss://board.test/api/browser/recovery/socket')

      fakes.rfbs[0]?.emit('connect')
      expect(read()).toEqual({ kind: 'connected', expiresInMs: 60_000 })
    })
  })

  it.each([
    [new RecoveryIssueError({ code: 'recovery_unavailable' }), 'unavailable'],
    [new RecoveryIssueError({ code: 'recovery_busy' }), 'busy'],
    [new RecoveryIssueError({ code: 'automation_unavailable' }), 'automationDown'],
    [new RecoveryIssueError({ code: 'network' }), 'automationDown'],
  ])('maps an issue error to %s', async (error, kind) => {
    const fakes = makeFakes([error])

    await context.start(async () => {
      const model = makeModel(fakes)
      const read = wrap(() => model.state())
      const start = wrap((el: HTMLElement) => model.start(el))

      await start(document.createElement('div'))

      expect(read()).toEqual({ kind })
      expect(fakes.rfbs).toHaveLength(0)
    })
  })

  it('drops to disconnected on RFB disconnect and reissues on reconnect', async () => {
    const fakes = makeFakes([{ expiresInMs: 60_000 }, { expiresInMs: 60_000 }])

    await context.start(async () => {
      const model = makeModel(fakes)
      const read = wrap(() => model.state())
      const start = wrap((el: HTMLElement) => model.start(el))
      const target = document.createElement('div')

      await start(target)
      fakes.rfbs[0]?.emit('connect')
      fakes.rfbs[0]?.emit('disconnect')
      expect(read()).toEqual({ kind: 'disconnected' })
      expect(fakes.rfbs[0]?.disconnectCalls).toBe(1)

      await start(target)
      expect(fakes.issueCalls).toHaveLength(2)
      expect(read()).toEqual({ kind: 'connecting', expiresInMs: 60_000 })
    })
  })

  it('maps securityfailure to disconnected', async () => {
    const fakes = makeFakes([{ expiresInMs: 60_000 }])

    await context.start(async () => {
      const model = makeModel(fakes)
      const read = wrap(() => model.state())
      const start = wrap((el: HTMLElement) => model.start(el))

      await start(document.createElement('div'))
      fakes.rfbs[0]?.emit('securityfailure')

      expect(read()).toEqual({ kind: 'disconnected' })
    })
  })

  it('counts down and expires the session at zero', async () => {
    vi.useFakeTimers()
    const fakes = makeFakes([{ expiresInMs: 2_000 }])

    await context.start(async () => {
      const model = makeModel(fakes)
      const read = wrap(() => model.state())
      const readRemaining = wrap(() => model.remainingMs())
      const start = wrap((el: HTMLElement) => model.start(el))

      await start(document.createElement('div'))
      fakes.rfbs[0]?.emit('connect')
      expect(readRemaining()).toBe(2_000)

      await vi.advanceTimersByTimeAsync(1_000)
      expect(readRemaining()).toBe(1_000)

      await vi.advanceTimersByTimeAsync(1_000)
      expect(read()).toEqual({ kind: 'expired' })
      expect(readRemaining()).toBe(0)
      expect(fakes.rfbs[0]?.disconnectCalls).toBe(1)
    })
  })

  it('supersedes a stale attempt: old RFB events are ignored, old session disposed', async () => {
    const fakes = makeFakes([{ expiresInMs: 60_000 }, { expiresInMs: 60_000 }])

    await context.start(async () => {
      const model = makeModel(fakes)
      const read = wrap(() => model.state())
      const start = wrap((el: HTMLElement) => model.start(el))
      const target = document.createElement('div')

      await start(target)
      const firstRfb = fakes.rfbs[0]

      await start(target)
      expect(firstRfb?.disconnectCalls).toBe(1)

      firstRfb?.emit('disconnect')
      expect(read()).toEqual({ kind: 'connecting', expiresInMs: 60_000 })
    })
  })

  it('tears down exactly once', async () => {
    const fakes = makeFakes([{ expiresInMs: 60_000 }])

    await context.start(async () => {
      const model = makeModel(fakes)
      const start = wrap((el: HTMLElement) => model.start(el))
      const teardown = wrap(() => model.teardown())

      await start(document.createElement('div'))
      teardown()
      teardown()

      expect(fakes.rfbs[0]?.disconnectCalls).toBe(1)
    })
  })
})
```

- [ ] **Step 2: Run to verify failure**

Run: `rtk pnpm --filter widgets-passport-checker exec vitest run model/recovery-model.test.ts`
Expected: FAIL — module does not exist.

- [ ] **Step 3: Implement the model**

Create `packages/widgets/passport-checker/model/recovery-model.ts`:

```ts
import { action, atom, wrap } from '@reatom/core'
import * as errore from 'errore'

import type { RecoveryTransport } from './recovery-transport'
import type { MakeRfb } from './rfb'

export type RecoveryState =
  | { kind: 'issuing' }
  | { kind: 'connecting'; expiresInMs: number }
  | { kind: 'connected'; expiresInMs: number }
  | { kind: 'disconnected' }
  | { kind: 'expired' }
  | { kind: 'unavailable' }
  | { kind: 'busy' }
  | { kind: 'automationDown' }

export const RECOVERY_TICK_MS = 500

export function recoverySocketUrl(loc: { protocol: string; host: string }): string {
  const scheme = loc.protocol === 'https:' ? 'wss:' : 'ws:'
  return `${scheme}//${loc.host}/api/browser/recovery/socket`
}

export type MakeRecoveryModelOptions = {
  widgetId: string
  transport: RecoveryTransport
  makeRfb: MakeRfb
  nowMs?: () => number
  location?: { protocol: string; host: string }
}

export type RecoveryModel = ReturnType<typeof makeRecoveryModel>

export function makeRecoveryModel({
  widgetId,
  transport,
  makeRfb,
  nowMs = () => Date.now(),
  location: loc,
}: MakeRecoveryModelOptions) {
  const state = atom<RecoveryState>({ kind: 'issuing' }, 'passportRecovery.state')
  const remainingMs = atom(0, 'passportRecovery.remainingMs')

  // Non-reactive handle for the live RFB + countdown pair. dispose is
  // idempotent, so teardown runs exactly once per connection no matter how
  // many paths (unmount, retry, expiry, supersede) race to it.
  let session: { dispose: () => void } | null = null
  let attempt = 0

  const disposeSession = () => {
    session?.dispose()
    session = null
  }

  const start = action(async (target: HTMLElement) => {
    attempt += 1
    const current = attempt
    disposeSession()
    state.set({ kind: 'issuing' })
    remainingMs.set(0)

    // Frame-bound continuations, created before the first await (repo wrap
    // rules — post-await writes would otherwise hit the global context).
    const isStale = wrap(() => current !== attempt)
    const setState = wrap((next: RecoveryState) => state.set(next))
    const tick = wrap((left: number) => {
      remainingMs.set(left)
      if (left > 0) return
      disposeSession()
      state.set({ kind: 'expired' })
    })
    const dropConnection = wrap(() => {
      disposeSession()
      state.set({ kind: 'disconnected' })
    })

    const issued = await transport.issue(widgetId)
    if (isStale()) return
    if (issued instanceof Error) {
      if (issued.code === 'recovery_busy') return setState({ kind: 'busy' })
      if (issued.code === 'recovery_unavailable') return setState({ kind: 'unavailable' })
      console.warn('recovery issue failed:', issued.message)
      return setState({ kind: 'automationDown' })
    }

    setState({ kind: 'connecting', expiresInMs: issued.expiresInMs })
    tick(issued.expiresInMs)

    const rfb = makeRfb(target, recoverySocketUrl(loc ?? window.location))
    const expiresAt = nowMs() + issued.expiresInMs

    const onConnect = () => {
      if (current !== attempt) return
      setState({ kind: 'connected', expiresInMs: issued.expiresInMs })
    }
    const onDisconnect = () => {
      if (current !== attempt) return
      dropConnection()
    }
    const onSecurityFailure = (event: Event) => {
      if (current !== attempt) return
      console.warn('recovery RFB security failure:', event)
      dropConnection()
    }
    rfb.addEventListener('connect', onConnect)
    rfb.addEventListener('disconnect', onDisconnect)
    rfb.addEventListener('securityfailure', onSecurityFailure)

    const timer = setInterval(() => {
      if (current !== attempt) return
      tick(Math.max(0, expiresAt - nowMs()))
    }, RECOVERY_TICK_MS)

    let disposed = false
    session = {
      dispose: () => {
        if (disposed) return
        disposed = true
        clearInterval(timer)
        // Listeners come off before disconnect() so the RFB's own disconnect
        // event cannot re-enter the state machine during teardown.
        rfb.removeEventListener('connect', onConnect)
        rfb.removeEventListener('disconnect', onDisconnect)
        rfb.removeEventListener('securityfailure', onSecurityFailure)
        const result = errore.try({
          try: () => rfb.disconnect(),
          catch: (cause) => new Error('rfb disconnect failed', { cause }),
        })
        if (result instanceof Error) console.warn(result.message)
      },
    }
  }, 'passportRecovery.start')

  const teardown = action(() => {
    disposeSession()
  }, 'passportRecovery.teardown')

  return { state, remainingMs, start, teardown }
}
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `rtk pnpm --filter widgets-passport-checker exec vitest run model/recovery-model.test.ts`
Expected: PASS.

- [ ] **Step 5: Typecheck and commit**

Run: `rtk pnpm --filter widgets-passport-checker typecheck`
Expected: PASS.

```bash
rtk git add packages/widgets/passport-checker/model/recovery-model.ts packages/widgets/passport-checker/model/recovery-model.test.ts
rtk git commit -m "feat(passport-checker): add the recovery capability state machine"
```

---

### Task 8: tier UI — root component, StandardTier, TinyTier, StatusBanner, styles

**Files:**

- Create: `packages/widgets/passport-checker/ui/passport-checker-context.ts`
- Replace: `packages/widgets/passport-checker/ui/PassportChecker.tsx` (Task 3 stub → real root)
- Create: `packages/widgets/passport-checker/ui/tiers/StandardTier.tsx`
- Create: `packages/widgets/passport-checker/ui/tiers/TinyTier.tsx`
- Create: `packages/widgets/passport-checker/ui/parts/StatusBanner.tsx`
- Create: `packages/widgets/passport-checker/ui/passport-checker.module.css`
- Test: `packages/widgets/passport-checker/ui/PassportChecker.test.tsx`

**Interfaces:**

- Consumes: `makePassportCheckModel`/`ViewState` (Task 5), `useWidgetContext` + `PassportCheckerEvents`, `reatomMemo`/`cn` (`widget-sdk`), lucide icons `IdCard`, `Check`, `RefreshCw`, `TriangleAlert`, `CircleCheck`, `CircleAlert`, `AppWindow`.
- Produces: `PassportChecker` (root, same export name as the Task 3 stub), `isStandardLayout(tier)`, `passportCheckerContext`/`usePassportChecker` (Task 9 extends the context value with `recoveryModel`; in this task the value is `{ checkModel }` — declare the type with `recoveryModel` **optional absent** — no: declare only `checkModel` here, Task 9 adds the field and updates both providers/consumers in the same commit).
- Every exported component is `reatomMemo`-wrapped; every event handler that touches Reatom goes through `wrap()` created during render (RTM-C02); atoms are read lazily inside render (RTM-C01).

Spec-fidelity checklist for this task (verify against the spec's «Standard tier» / «Tiny tier» sections while implementing): header row on every standard state (30×30 accent-soft chip + «Паспорт» 600/15); idle description 400/13.5 + full-width 40px accent button «Проверить» with a check glyph; pending 18px spinner + «Проверяем…» + button disabled at opacity .4; success green soft banner with 30px circle-check, `{send_status_msg}` 600/15 and mono «статус {status} · проверено {HH:MM}» + secondary «Проверить снова» with refresh glyph; retryable red soft banner (alert icon, bold message 600/14, «Попробуйте ещё раз.» 400/12) + «Повторить»; invalidConfig greyed chip, grey banner «Паспорт-чекер не настроен» / «Обратитесь к администратору.», no action button, muted footer «действие недоступно · нужна настройка на сервере»; sessionRequired amber banner (warning triangle + «Требуется вход в браузер») + primary «Открыть восстановление» with a browser-window glyph. Tiny: centered 14px-padding tile, 40px chip; sessionRequired paints the whole tile amber with button «Открыть»; tiny error shows mono «ошибка» + «Повторить»; tiny invalidConfig «Не настроен» with no button; tiny success mono chip «СТАТУС {status}».

- [ ] **Step 1: Write the failing component tests**

Create `packages/widgets/passport-checker/ui/PassportChecker.test.tsx`:

```tsx
import { fireEvent, render, screen } from '@testing-library/react'
import { makeHostRuntime, WidgetApiError, WidgetRuntimeContext } from 'widget-runtime'
import type { WidgetRuntimeProps } from 'widget-runtime'

import { PassportChecker } from './PassportChecker'

type InvokeResult = WidgetApiError | { status: number; send_status_msg: string }

function makeProps(tier: WidgetRuntimeProps['tier'], invoke: () => Promise<InvokeResult>) {
  const props: WidgetRuntimeProps = {
    instanceId: 'inst-passport',
    typeId: 'passport-checker',
    mode: 'small',
    tier,
    theme: 'light',
    requestFullscreen: vi.fn(),
    requestClose: vi.fn(),
    requestDelete: vi.fn(),
    reportError: vi.fn(),
    storage: makeHostRuntime().makeWidgetStorage({
      instanceId: 'inst-passport',
      typeId: 'passport-checker',
    }),
    api: { invoke: invoke as WidgetRuntimeProps['api']['invoke'] },
  }
  return props
}

function renderWidget(tier: WidgetRuntimeProps['tier'], invoke: () => Promise<InvokeResult>) {
  return render(
    <WidgetRuntimeContext.Provider value={makeProps(tier, invoke)}>
      <PassportChecker />
    </WidgetRuntimeContext.Provider>,
  )
}

function apiError(code: string, meta?: Record<string, unknown>) {
  return new WidgetApiError({ reason: `${code}: message`, code, meta })
}

describe('PassportChecker / standard tier', () => {
  it('renders the idle state', () => {
    renderWidget('standard', vi.fn())

    expect(screen.getByText('Паспорт')).toBeInTheDocument()
    expect(screen.getByText('Проверка статуса паспорта')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: /Проверить/ })).toBeEnabled()
  })

  it('disables the button and shows the pending row while checking', async () => {
    renderWidget('standard', () => new Promise<never>(() => {}))

    fireEvent.click(screen.getByRole('button', { name: /Проверить/ }))

    expect(await screen.findByText('Проверяем…')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: /Проверить/ })).toBeDisabled()
  })

  it('renders success with status and local time', async () => {
    renderWidget('standard', async () => ({ status: 200, send_status_msg: 'Документ готовий' }))

    fireEvent.click(screen.getByRole('button', { name: /Проверить/ }))

    expect(await screen.findByText('Документ готовий')).toBeInTheDocument()
    expect(screen.getByText(/статус 200 · проверено \d{2}:\d{2}/)).toBeInTheDocument()
    expect(screen.getByRole('button', { name: /Проверить снова/ })).toBeInTheDocument()
  })

  it('renders a retryable error with an alert role', async () => {
    renderWidget('standard', async () => apiError('browser_unavailable'))

    fireEvent.click(screen.getByRole('button', { name: /Проверить/ }))

    expect(await screen.findByRole('alert')).toHaveTextContent('Сервис автоматизации недоступен')
    expect(screen.getByText('Попробуйте ещё раз.')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: /Повторить/ })).toBeInTheDocument()
  })

  it('renders invalidConfig without an action button', async () => {
    renderWidget('standard', async () => apiError('browser_configuration'))

    fireEvent.click(screen.getByRole('button', { name: /Проверить/ }))

    expect(await screen.findByText('Паспорт-чекер не настроен')).toBeInTheDocument()
    expect(screen.getByText('Обратитесь к администратору.')).toBeInTheDocument()
    expect(screen.getByText('действие недоступно · нужна настройка на сервере')).toBeInTheDocument()
    expect(screen.queryByRole('button')).toBeNull()
  })

  it('renders sessionRequired with the open-recovery action', async () => {
    renderWidget('standard', async () =>
      apiError('browser_session_required', { sshTarget: 'admin@pi' }),
    )

    fireEvent.click(screen.getByRole('button', { name: /Проверить/ }))

    expect(await screen.findByText('Требуется вход в браузер')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: /Открыть восстановление/ })).toBeInTheDocument()
  })

  it('retries after a retryable error', async () => {
    const invoke = vi
      .fn<() => Promise<InvokeResult>>()
      .mockResolvedValueOnce(apiError('upstream_response'))
      .mockResolvedValueOnce({ status: 200, send_status_msg: 'Готово' })
    renderWidget('standard', invoke)

    fireEvent.click(screen.getByRole('button', { name: /Проверить/ }))
    fireEvent.click(await screen.findByRole('button', { name: /Повторить/ }))

    expect(await screen.findByText('Готово')).toBeInTheDocument()
    expect(invoke).toHaveBeenCalledTimes(2)
  })
})

describe('PassportChecker / tiny tier', () => {
  it('renders the compact idle state', () => {
    renderWidget('compact', vi.fn())

    expect(screen.getByText('Паспорт')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: /Проверить/ })).toBeInTheDocument()
    expect(screen.queryByText('Проверка статуса паспорта')).toBeNull()
  })

  it('renders the compact pending state', async () => {
    renderWidget('compact', () => new Promise<never>(() => {}))

    fireEvent.click(screen.getByRole('button', { name: /Проверить/ }))

    expect(await screen.findByText('Проверяем…')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: /Проверить/ })).toBeDisabled()
  })

  it('renders the compact error state', async () => {
    renderWidget('compact', async () => apiError('upstream_response'))

    fireEvent.click(screen.getByRole('button', { name: /Проверить/ }))

    expect(await screen.findByText('ошибка')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: /Повторить/ })).toBeInTheDocument()
  })

  it('renders the compact success state with a status chip', async () => {
    renderWidget('compact', async () => ({ status: 200, send_status_msg: 'Готово' }))

    fireEvent.click(screen.getByRole('button', { name: /Проверить/ }))

    expect(await screen.findByText('Готово')).toBeInTheDocument()
    expect(screen.getByText('СТАТУС 200')).toBeInTheDocument()
  })

  it('renders the compact sessionRequired state', async () => {
    renderWidget('compact', async () => apiError('browser_session_required'))

    fireEvent.click(screen.getByRole('button', { name: /Проверить/ }))

    expect(await screen.findByText('Требуется вход в браузер')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Открыть' })).toBeInTheDocument()
  })

  it('renders the compact invalidConfig state without a button', async () => {
    renderWidget('compact', async () => apiError('browser_configuration'))

    fireEvent.click(screen.getByRole('button', { name: /Проверить/ }))

    expect(await screen.findByText('Не настроен')).toBeInTheDocument()
    expect(screen.queryByRole('button')).toBeNull()
  })
})
```

- [ ] **Step 2: Run to verify failure**

Run: `rtk pnpm --filter widgets-passport-checker exec vitest run ui/PassportChecker.test.tsx`
Expected: FAIL — the stub renders only «Паспорт».

- [ ] **Step 3: Implement the context, root, tiers, banner and styles**

Create `packages/widgets/passport-checker/ui/passport-checker-context.ts`:

```ts
import { createContext, useContext } from 'react'

import type { PassportCheckModel } from '../model/check-model'

export type PassportCheckerContextValue = {
  checkModel: PassportCheckModel
}

export const passportCheckerContext = createContext<PassportCheckerContextValue | null>(null)

export function usePassportChecker(): PassportCheckerContextValue {
  const value = useContext(passportCheckerContext)
  if (!value) throw new Error('passportCheckerContext is not available')
  return value
}
```

Replace `packages/widgets/passport-checker/ui/PassportChecker.tsx`:

```tsx
import { useMemo } from 'react'
import { useWidgetContext } from 'widget-runtime'
import type { WidgetTier } from 'widget-runtime'
import { reatomMemo } from 'widget-sdk/reatom/reatom-memo'

import { makePassportCheckModel } from '../model/check-model'
import type { PassportCheckerEvents } from '../types'
import { passportCheckerContext } from './passport-checker-context'
import type { PassportCheckerContextValue } from './passport-checker-context'
import { StandardTier } from './tiers/StandardTier'
import { TinyTier } from './tiers/TinyTier'

import styles from './passport-checker.module.css'

/** The widget has exactly two layouts; the five runtime tier names collapse. */
export function isStandardLayout(tier: WidgetTier): boolean {
  return tier === 'standard' || tier === 'large' || tier === 'fullscreen'
}

export const PassportChecker = reatomMemo(() => {
  const { tier, api } = useWidgetContext<PassportCheckerEvents>()
  const checkModel = useMemo(() => makePassportCheckModel({ api }), [api])
  const value = useMemo<PassportCheckerContextValue>(() => ({ checkModel }), [checkModel])

  return (
    <passportCheckerContext.Provider value={value}>
      <div className={styles.widget} data-tier={tier}>
        {isStandardLayout(tier) ? <StandardTier /> : <TinyTier />}
      </div>
    </passportCheckerContext.Provider>
  )
}, 'PassportChecker')
```

Create `packages/widgets/passport-checker/ui/parts/StatusBanner.tsx`:

```tsx
import { CircleCheck, TriangleAlert } from 'lucide-react'
import { cn, reatomMemo } from 'widget-sdk'

import type { ViewState } from '../../model/check-model'

import styles from '../passport-checker.module.css'

export const StatusBanner = reatomMemo<{ view: ViewState }>(({ view }) => {
  if (view.kind === 'success') {
    return (
      <div className={cn(styles.banner, styles.bannerSuccess)} role="status">
        <CircleCheck className={styles.bannerIcon} size={30} aria-hidden />
        <div className={styles.bannerBody}>
          <div className={styles.bannerTitle}>{view.message}</div>
          <div className={styles.bannerMeta}>
            статус {view.status} · проверено {view.checkedAtLabel}
          </div>
        </div>
      </div>
    )
  }
  if (view.kind === 'retryable') {
    return (
      <div className={cn(styles.banner, styles.bannerError)} role="alert">
        <TriangleAlert className={styles.bannerIcon} size={20} aria-hidden />
        <div className={styles.bannerBody}>
          <div className={styles.bannerTitle}>{view.message}</div>
          <div className={styles.bannerHint}>Попробуйте ещё раз.</div>
        </div>
      </div>
    )
  }
  if (view.kind === 'invalidConfig') {
    return (
      <div className={cn(styles.banner, styles.bannerMuted)} role="status">
        <div className={styles.bannerBody}>
          <div className={styles.bannerTitle}>Паспорт-чекер не настроен</div>
          <div className={styles.bannerHint}>Обратитесь к администратору.</div>
        </div>
      </div>
    )
  }
  if (view.kind === 'sessionRequired') {
    return (
      <div className={cn(styles.banner, styles.bannerWarning)} role="status">
        <TriangleAlert className={styles.bannerIcon} size={20} aria-hidden />
        <div className={styles.bannerBody}>
          <div className={styles.bannerTitle}>Требуется вход в браузер</div>
        </div>
      </div>
    )
  }
  return null
}, 'PassportCheckerStatusBanner')
```

Create `packages/widgets/passport-checker/ui/tiers/StandardTier.tsx`:

```tsx
import { wrap } from '@reatom/core'
import { AppWindow, Check, IdCard, RefreshCw } from 'lucide-react'
import { cn, reatomMemo } from 'widget-sdk'

import { usePassportChecker } from '../passport-checker-context'
import { StatusBanner } from '../parts/StatusBanner'

import styles from '../passport-checker.module.css'

export const StandardTier = reatomMemo(() => {
  const { checkModel } = usePassportChecker()
  const view = checkModel.viewState()
  const check = wrap(() => {
    void checkModel.checkPassport()
  })
  const openRecovery = wrap(() => checkModel.recoveryOpen.set(true))

  return (
    <div className={styles.standard}>
      <header className={styles.header}>
        <span
          className={cn(styles.iconChip, view.kind === 'invalidConfig' && styles.iconChipMuted)}
          aria-hidden
        >
          <IdCard size={16} />
        </span>
        <span className={styles.title}>Паспорт</span>
      </header>

      {view.kind === 'idle' && <p className={styles.description}>Проверка статуса паспорта</p>}
      {view.kind === 'pending' && (
        <div className={styles.pendingRow} role="status">
          <span className={styles.spinner} aria-hidden />
          Проверяем…
        </div>
      )}
      <StatusBanner view={view} />

      {(view.kind === 'idle' || view.kind === 'pending') && (
        <button
          type="button"
          className={styles.primaryButton}
          disabled={view.kind === 'pending'}
          onClick={check}
        >
          <Check size={16} aria-hidden /> Проверить
        </button>
      )}
      {view.kind === 'success' && (
        <button type="button" className={styles.secondaryButton} onClick={check}>
          <RefreshCw size={15} aria-hidden /> Проверить снова
        </button>
      )}
      {view.kind === 'retryable' && (
        <button type="button" className={styles.secondaryButton} onClick={check}>
          <RefreshCw size={15} aria-hidden /> Повторить
        </button>
      )}
      {view.kind === 'sessionRequired' && (
        <button type="button" className={styles.primaryButton} onClick={openRecovery}>
          <AppWindow size={16} aria-hidden /> Открыть восстановление
        </button>
      )}
      {view.kind === 'invalidConfig' && (
        <div className={styles.footerNote}>действие недоступно · нужна настройка на сервере</div>
      )}
    </div>
  )
}, 'PassportCheckerStandardTier')
```

Create `packages/widgets/passport-checker/ui/tiers/TinyTier.tsx`:

```tsx
import { wrap } from '@reatom/core'
import { CircleAlert, CircleCheck, IdCard, TriangleAlert } from 'lucide-react'
import { cn, reatomMemo } from 'widget-sdk'

import { usePassportChecker } from '../passport-checker-context'

import styles from '../passport-checker.module.css'

export const TinyTier = reatomMemo(() => {
  const { checkModel } = usePassportChecker()
  const view = checkModel.viewState()
  const check = wrap(() => {
    void checkModel.checkPassport()
  })
  const openRecovery = wrap(() => checkModel.recoveryOpen.set(true))

  if (view.kind === 'sessionRequired') {
    return (
      <div className={cn(styles.tiny, styles.tinyWarning)}>
        <span className={cn(styles.tinyChip, styles.tinyChipWarning)} aria-hidden>
          <TriangleAlert size={18} />
        </span>
        <span className={styles.tinyLabel}>Требуется вход в браузер</span>
        <button type="button" className={styles.tinyButton} onClick={openRecovery}>
          Открыть
        </button>
      </div>
    )
  }
  if (view.kind === 'invalidConfig') {
    return (
      <div className={styles.tiny}>
        <span className={cn(styles.tinyChip, styles.tinyChipMuted)} aria-hidden>
          <IdCard size={20} />
        </span>
        <span className={styles.tinyLabel}>Не настроен</span>
      </div>
    )
  }
  if (view.kind === 'pending') {
    return (
      <div className={styles.tiny} role="status">
        <span className={cn(styles.spinner, styles.spinnerLarge)} aria-hidden />
        <span className={styles.tinyMono}>Проверяем…</span>
        <button type="button" className={styles.tinyButton} disabled>
          Проверить
        </button>
      </div>
    )
  }
  if (view.kind === 'success') {
    return (
      <div className={styles.tiny}>
        <CircleCheck className={styles.tinySuccessIcon} size={40} aria-hidden />
        <span className={styles.tinyLabel}>{view.message}</span>
        <span className={styles.tinyStatusChip}>СТАТУС {view.status}</span>
      </div>
    )
  }
  if (view.kind === 'retryable') {
    return (
      <div className={styles.tiny}>
        <CircleAlert className={styles.tinyErrorIcon} size={40} aria-hidden />
        <span className={styles.tinyMono}>ошибка</span>
        <button type="button" className={styles.tinyButton} onClick={check}>
          Повторить
        </button>
      </div>
    )
  }
  return (
    <div className={styles.tiny}>
      <span className={styles.tinyChip} aria-hidden>
        <IdCard size={20} />
      </span>
      <span className={styles.tinyTitle}>Паспорт</span>
      <button type="button" className={styles.tinyButton} onClick={check}>
        Проверить
      </button>
    </div>
  )
}, 'PassportCheckerTinyTier')
```

Create `packages/widgets/passport-checker/ui/passport-checker.module.css` (token-driven with literal fallbacks; the amber trio is widget-local — no such token exists in the repo):

```css
.widget {
  --pc-warning-bg: oklch(0.96 0.05 80);
  --pc-warning-border: oklch(0.85 0.1 80);
  --pc-warning-icon: oklch(0.58 0.13 70);
  --pc-success: var(--success, oklch(0.55 0.13 155));
  --pc-success-soft: var(--success-soft, oklch(0.95 0.05 155));
  --pc-success-border: oklch(0.86 0.08 155);
  --pc-error: var(--destructive, oklch(0.55 0.21 27));
  --pc-error-soft: var(--destructive-soft, oklch(0.968 0.028 27));
  --pc-error-border: oklch(0.88 0.07 27);

  height: 100%;
  font-family: var(--font-ui, system-ui, sans-serif);
  color: var(--text, #22232a);
}

.standard {
  height: 100%;
  display: flex;
  flex-direction: column;
  gap: 12px;
  padding: 16px;
  background: var(--card, #fff);
  border-radius: 14px;
  box-shadow: var(--shadow-card, 0 1px 2px rgba(20, 22, 40, 0.05));
}

.header {
  display: flex;
  align-items: center;
  gap: 8px;
}

.iconChip {
  width: 30px;
  height: 30px;
  border-radius: 9px;
  display: grid;
  place-items: center;
  background: var(--accent-soft, oklch(0.955 0.032 285));
  color: var(--primary, oklch(0.55 0.17 281));
}

.iconChipMuted {
  background: var(--secondary, #eceef1);
  color: var(--text-dim, #9396a0);
}

.title {
  font-weight: 600;
  font-size: 15px;
}

.description {
  margin: 0;
  font-size: 13.5px;
  color: var(--text-dim, #5b5e69);
}

.pendingRow {
  display: flex;
  align-items: center;
  gap: 8px;
  font-weight: 500;
  font-size: 14px;
}

.spinner {
  width: 18px;
  height: 18px;
  flex: none;
  border: 2px solid var(--border, #e3e4e8);
  border-top-color: var(--primary, oklch(0.55 0.17 281));
  border-radius: 50%;
  animation: pc-spin 0.8s linear infinite;
}

.spinnerLarge {
  width: 26px;
  height: 26px;
}

@keyframes pc-spin {
  to {
    transform: rotate(360deg);
  }
}

.primaryButton,
.secondaryButton,
.tinyButton {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  gap: 7px;
  width: 100%;
  border: 1px solid transparent;
  border-radius: 11px;
  font: inherit;
  font-weight: 600;
  font-size: 13.5px;
  cursor: pointer;
}

.primaryButton {
  height: 40px;
  background: var(--primary, oklch(0.55 0.17 281));
  color: var(--primary-foreground, #fff);
}

.primaryButton:disabled {
  opacity: 0.4;
  cursor: default;
}

.secondaryButton {
  height: 38px;
  background: var(--card, #fff);
  border-color: var(--border, #e3e4e8);
  color: var(--text, #22232a);
}

.banner {
  display: flex;
  align-items: flex-start;
  gap: 10px;
  padding: 12px;
  border-radius: 12px;
  border: 1px solid transparent;
}

.bannerBody {
  min-width: 0;
}

.bannerIcon {
  flex: none;
}

.bannerTitle {
  font-weight: 600;
  font-size: 14px;
}

.bannerMeta {
  margin-top: 4px;
  font-family: var(--font-mono, ui-monospace, monospace);
  font-size: 11.5px;
  color: var(--text-dim, #5b5e69);
}

.bannerHint {
  margin-top: 2px;
  font-size: 12px;
  color: var(--text-dim, #5b5e69);
}

.bannerSuccess {
  background: var(--pc-success-soft);
  border-color: var(--pc-success-border);
}

.bannerSuccess .bannerIcon,
.tinySuccessIcon {
  color: var(--pc-success);
}

.bannerError {
  background: var(--pc-error-soft);
  border-color: var(--pc-error-border);
}

.bannerError .bannerIcon,
.tinyErrorIcon {
  color: var(--pc-error);
}

.bannerMuted {
  background: var(--secondary, #f5f6f8);
  border-color: var(--border, #eceef1);
}

.bannerWarning {
  background: var(--pc-warning-bg);
  border-color: var(--pc-warning-border);
}

.bannerWarning .bannerIcon {
  color: var(--pc-warning-icon);
}

.footerNote {
  margin-top: auto;
  font-size: 11px;
  color: var(--text-3, #9396a0);
}

.tiny {
  height: 100%;
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  gap: 8px;
  padding: 14px;
  text-align: center;
  background: var(--card, #fff);
  border-radius: 14px;
}

.tinyWarning {
  background: var(--pc-warning-bg);
}

.tinyChip {
  width: 40px;
  height: 40px;
  border-radius: 12px;
  display: grid;
  place-items: center;
  background: var(--accent-soft, oklch(0.955 0.032 285));
  color: var(--primary, oklch(0.55 0.17 281));
}

.tinyChipWarning {
  width: 34px;
  height: 34px;
  background: transparent;
  color: var(--pc-warning-icon);
}

.tinyChipMuted {
  background: var(--secondary, #eceef1);
  color: var(--text-dim, #9396a0);
}

.tinyTitle {
  font-weight: 600;
  font-size: 12.5px;
}

.tinyLabel {
  font-weight: 600;
  font-size: 12px;
  display: -webkit-box;
  -webkit-line-clamp: 2;
  -webkit-box-orient: vertical;
  overflow: hidden;
}

.tinyMono {
  font-family: var(--font-mono, ui-monospace, monospace);
  font-weight: 500;
  font-size: 11px;
}

.tinyStatusChip {
  width: 100%;
  padding: 4px 6px;
  border-radius: 999px;
  font-family: var(--font-mono, ui-monospace, monospace);
  font-size: 10.5px;
  background: var(--pc-success-soft);
  color: var(--pc-success);
}

.tinyButton {
  height: 36px;
  background: var(--primary, oklch(0.55 0.17 281));
  color: var(--primary-foreground, #fff);
  font-size: 12.5px;
}

.tinyButton:disabled {
  opacity: 0.4;
  cursor: default;
}
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `rtk pnpm --filter widgets-passport-checker exec vitest run ui/PassportChecker.test.tsx`
Expected: PASS. Also run `rtk pnpm --filter widgets-passport-checker test` — the Task 3 harness test must still pass (the real root still renders «Паспорт» in the standard tier).

- [ ] **Step 5: Typecheck and commit**

Run: `rtk pnpm --filter widgets-passport-checker typecheck`
Expected: PASS.

```bash
rtk git add packages/widgets/passport-checker/ui
rtk git commit -m "feat(passport-checker): render the check flow across both tiers"
```

---

### Task 9: recovery modal — portal, noVNC frame, SSH fallback, a11y

**Files:**

- Create: `packages/widgets/passport-checker/ui/use-modal-isolation.ts`
- Create: `packages/widgets/passport-checker/ui/parts/NoVncCanvas.tsx`
- Create: `packages/widgets/passport-checker/ui/parts/SshFallback.tsx`
- Create: `packages/widgets/passport-checker/ui/RecoveryModal.tsx`
- Create: `packages/widgets/passport-checker/ui/recovery-modal.module.css`
- Modify: `packages/widgets/passport-checker/ui/passport-checker-context.ts` (add `recoveryModel`)
- Modify: `packages/widgets/passport-checker/ui/PassportChecker.tsx` (build `recoveryModel`, render the modal)
- Test: `packages/widgets/passport-checker/ui/RecoveryModal.test.tsx`
- Test: `packages/widgets/passport-checker/ui/recovery-flow.test.tsx` (root-level a11y round-trip)

**Interfaces:**

- Consumes: `makeRecoveryModel`/`RecoveryModel`/`RecoveryState` (Task 7), `makeRecoveryTransport` (Task 6), `makeNoVncRfb` (Task 6), `usePassportChecker` (Task 8), lucide `AppWindow`, `Check`, `Copy`, `Unlink`, `X`.
- Produces: `RecoveryModal` (portal to `document.body`), `useModalIsolation(rootRef, onClose)`, `formatAccessCountdown(ms): string` (`M:SS`), `NoVncCanvas`, `SshFallback`. Context value becomes `{ checkModel, recoveryModel }` (update the type, the root provider, and Task 8's consumers compile unchanged — they only read `checkModel`).

Design notes (deliberate):

- **Isolation instead of the Radix ref-dance.** The modal may stack above Radix layers the widget cannot patch (the board's `FullscreenOverlay` is itself a Radix Dialog). The spec's "modal open ref cleared one tick late" pattern requires cooperation from the _underlying_ dialog — unavailable from a widget. `useModalIsolation` achieves the same guarantee at the source: a capture-phase document `keydown` handles Esc first and stops propagation (Radix's bubble-phase escape listener never fires), and `pointerdown`/`focusin` events born inside the modal stop propagating before document-level `DismissableLayer`/`FocusScope` listeners see them, so the underlying dialog's deferred outside-dismiss check is never even queued.
- Focus: moves to the first focusable in the dialog on mount; Tab/Shift+Tab cycle inside; on unmount focus returns to the previously-focused element (the «Открыть восстановление» tile button). The noVNC canvas has `tabIndex=-1` (RFB's own) — reachable by click, skipped by Tab, and Esc still works from it because the document capture listener sees it first.
- «Повторить проверку» tears down, closes, and re-invokes `checkPassport`; if the checker is still challenged the widget lands back on `sessionRequired`.
- The «Переподключиться» button appears in every non-live frame (`disconnected`, `expired`, `unavailable`, `busy`, `automationDown`) — the spec draws it for the first two; extending it to the issue-error frames is deliberate (each retry is a fresh single-use `POST`).
- `SshFallback` uses `useState` for the expand toggle — pure view glue, no Reatom involved (atoms must not be created in a component body).

- [ ] **Step 1: Write the failing modal tests**

Create `packages/widgets/passport-checker/ui/RecoveryModal.test.tsx`:

```tsx
import { fireEvent, render, screen } from '@testing-library/react'
import { WidgetApiError } from 'widget-runtime'
import type { WidgetApi } from '@shared/widgets/contracts'

import { makePassportCheckModel } from '../model/check-model'
import { makeRecoveryModel } from '../model/recovery-model'
import {
  RecoveryIssueError,
  type RecoveryIssue,
  type RecoveryTransport,
} from '../model/recovery-transport'
import type { RfbLike } from '../model/rfb'
import type { PassportCheckerEvents } from '../types'
import { passportCheckerContext } from './passport-checker-context'
import { formatAccessCountdown, RecoveryModal } from './RecoveryModal'

class FakeRfb implements RfbLike {
  listeners = new Map<string, Set<(event: Event) => void>>()
  disconnectCalls = 0

  constructor(public url: string) {}

  addEventListener(type: string, listener: (event: Event) => void) {
    const set = this.listeners.get(type) ?? new Set()
    set.add(listener)
    this.listeners.set(type, set)
  }

  removeEventListener(type: string, listener: (event: Event) => void) {
    this.listeners.get(type)?.delete(listener)
  }

  disconnect() {
    this.disconnectCalls += 1
  }

  emit(type: string) {
    for (const listener of [...(this.listeners.get(type) ?? [])]) listener(new Event(type))
  }
}

function setup(
  issueResults: Array<RecoveryIssueError | RecoveryIssue>,
  sshTarget: string | null = 'admin@pi',
) {
  const invoke = vi.fn(
    async () => new WidgetApiError({ reason: 'x', code: 'browser_session_required' }),
  )
  const checkModel = makePassportCheckModel({
    api: { invoke } as unknown as WidgetApi<PassportCheckerEvents, WidgetApiError>,
  })
  checkModel.viewState.set({ kind: 'sessionRequired', sshTarget })
  checkModel.recoveryOpen.set(true)

  const issueCalls: string[] = []
  const results = [...issueResults]
  const transport: RecoveryTransport = {
    issue: async (widgetId) => {
      issueCalls.push(widgetId)
      const next = results.shift()
      if (!next) return new RecoveryIssueError({ code: 'automation_unavailable' })
      return next
    },
  }
  const rfbs: FakeRfb[] = []
  const recoveryModel = makeRecoveryModel({
    widgetId: 'passport-checker',
    transport,
    makeRfb: (_target, url) => {
      const rfb = new FakeRfb(url)
      rfbs.push(rfb)
      return rfb
    },
    location: { protocol: 'https:', host: 'board.test' },
  })

  render(
    <passportCheckerContext.Provider value={{ checkModel, recoveryModel }}>
      <RecoveryModal />
    </passportCheckerContext.Provider>,
  )

  return { checkModel, recoveryModel, invoke, issueCalls, rfbs }
}

describe('formatAccessCountdown', () => {
  it('formats M:SS', () => {
    expect(formatAccessCountdown(60_000)).toBe('1:00')
    expect(formatAccessCountdown(59_000)).toBe('0:59')
    expect(formatAccessCountdown(0)).toBe('0:00')
    expect(formatAccessCountdown(-500)).toBe('0:00')
  })
})

describe('RecoveryModal', () => {
  it('opens as a dialog, issues a capability and goes live on connect', async () => {
    const { issueCalls, rfbs } = setup([{ expiresInMs: 60_000 }])

    const dialog = await screen.findByRole('dialog')
    expect(dialog).toHaveAttribute('aria-modal', 'true')
    expect(screen.getByText('Восстановление сессии браузера')).toBeInTheDocument()
    expect(issueCalls).toEqual(['passport-checker'])

    await screen.findByText(/доступ · 1:00/)
    rfbs[0]?.emit('connect')
    expect(await screen.findByText(/LIVE · 1280×720/)).toBeInTheDocument()
  })

  it('moves focus into the dialog on open', async () => {
    setup([{ expiresInMs: 60_000 }])

    const dialog = await screen.findByRole('dialog')
    expect(dialog.contains(document.activeElement)).toBe(true)
  })

  it('closes and tears down on Escape', async () => {
    const { checkModel, rfbs } = setup([{ expiresInMs: 60_000 }])
    await screen.findByRole('dialog')
    await screen.findByText(/доступ · 1:00/)

    fireEvent.keyDown(document, { key: 'Escape' })

    expect(checkModel.recoveryOpen()).toBe(false)
    expect(rfbs[0]?.disconnectCalls).toBe(1)
  })

  it('closes on backdrop click but not on dialog click', async () => {
    const { checkModel } = setup([{ expiresInMs: 60_000 }])
    const dialog = await screen.findByRole('dialog')

    fireEvent.click(dialog)
    expect(checkModel.recoveryOpen()).toBe(true)

    const overlay = dialog.parentElement
    if (!overlay) throw new Error('expected the overlay element')
    fireEvent.click(overlay)
    expect(checkModel.recoveryOpen()).toBe(false)
  })

  it('retries the check from the footer: teardown, close, re-invoke', async () => {
    const { checkModel, invoke, rfbs } = setup([{ expiresInMs: 60_000 }])
    await screen.findByText(/доступ · 1:00/)

    fireEvent.click(screen.getByRole('button', { name: /Повторить проверку/ }))

    expect(checkModel.recoveryOpen()).toBe(false)
    expect(rfbs[0]?.disconnectCalls).toBe(1)
    expect(invoke).toHaveBeenCalledTimes(1)
  })

  it('reconnect after a disconnect re-issues a fresh capability', async () => {
    const { issueCalls, rfbs } = setup([{ expiresInMs: 60_000 }, { expiresInMs: 60_000 }])
    await screen.findByText(/доступ · 1:00/)

    rfbs[0]?.emit('disconnect')
    expect(await screen.findByText('Соединение разорвано')).toBeInTheDocument()

    fireEvent.click(screen.getByRole('button', { name: 'Переподключиться' }))
    await screen.findByText(/доступ · 1:00/)
    expect(issueCalls).toHaveLength(2)
    expect(rfbs).toHaveLength(2)
  })

  it.each([
    [
      new RecoveryIssueError({ code: 'recovery_unavailable' }),
      'Нет активной сессии для восстановления',
    ],
    [new RecoveryIssueError({ code: 'recovery_busy' }), 'Восстановление уже идёт'],
    [new RecoveryIssueError({ code: 'automation_unavailable' }), 'Сервис автоматизации недоступен'],
  ])('renders the issue-error frame: %s', async (error, copy) => {
    setup([error])

    expect(await screen.findByText(copy)).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Переподключиться' })).toBeInTheDocument()
  })

  it('shows the SSH fallback with the real command', async () => {
    setup([{ expiresInMs: 60_000 }])
    await screen.findByRole('dialog')

    fireEvent.click(screen.getByRole('button', { name: /Запасной вход по SSH/ }))

    expect(screen.getByText('ssh -L 6080:127.0.0.1:6080 admin@pi')).toBeInTheDocument()
    expect(
      screen.getByText('ssh-цель из конфигурации виджета · тот же одноразовый срок доступа'),
    ).toBeInTheDocument()
  })

  it('hides the SSH section when sshTarget is null', async () => {
    setup([{ expiresInMs: 60_000 }], null)
    await screen.findByRole('dialog')

    expect(screen.queryByRole('button', { name: /Запасной вход по SSH/ })).toBeNull()
  })

  it('cycles Tab within the dialog', async () => {
    setup([{ expiresInMs: 60_000 }])
    const dialog = await screen.findByRole('dialog')

    const buttons = dialog.querySelectorAll('button')
    const last = buttons[buttons.length - 1]
    if (!(last instanceof HTMLElement)) throw new Error('expected a focusable footer button')
    last.focus()

    fireEvent.keyDown(document, { key: 'Tab' })
    expect(dialog.contains(document.activeElement)).toBe(true)
    expect(document.activeElement).not.toBe(last)
  })
})
```

Create `packages/widgets/passport-checker/ui/recovery-flow.test.tsx` (root-level round-trip; the real transport is used with `fetch` stubbed pending, the real `makeNoVncRfb` is imported but never constructed):

```tsx
import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { makeHostRuntime, WidgetApiError, WidgetRuntimeContext } from 'widget-runtime'
import type { WidgetRuntimeProps } from 'widget-runtime'

import { PassportChecker } from './PassportChecker'

function renderSessionRequired() {
  vi.stubGlobal(
    'fetch',
    vi.fn(() => new Promise<never>(() => {})),
  )
  const invoke = vi.fn(
    async () =>
      new WidgetApiError({
        reason: 'x',
        code: 'browser_session_required',
        meta: { sshTarget: 'admin@pi' },
      }),
  )
  const props: WidgetRuntimeProps = {
    instanceId: 'inst-passport',
    typeId: 'passport-checker',
    mode: 'small',
    tier: 'standard',
    theme: 'light',
    requestFullscreen: vi.fn(),
    requestClose: vi.fn(),
    requestDelete: vi.fn(),
    reportError: vi.fn(),
    storage: makeHostRuntime().makeWidgetStorage({
      instanceId: 'inst-passport',
      typeId: 'passport-checker',
    }),
    api: { invoke: invoke as WidgetRuntimeProps['api']['invoke'] },
  }
  return render(
    <WidgetRuntimeContext.Provider value={props}>
      <PassportChecker />
    </WidgetRuntimeContext.Provider>,
  )
}

afterEach(() => {
  vi.unstubAllGlobals()
})

describe('recovery flow from the tile', () => {
  it('opens the modal from sessionRequired, closes on Esc and returns focus', async () => {
    renderSessionRequired()

    fireEvent.click(screen.getByRole('button', { name: /Проверить/ }))
    const openButton = await screen.findByRole('button', { name: /Открыть восстановление/ })

    // jsdom's fireEvent.click does not focus the target the way a real
    // browser does — focus explicitly so the focus-return assertion is real.
    openButton.focus()
    fireEvent.click(openButton)
    const dialog = await screen.findByRole('dialog')
    expect(dialog.contains(document.activeElement)).toBe(true)

    fireEvent.keyDown(document, { key: 'Escape' })
    // Reatom flushes subscribers on a microtask, so the unmount (and the
    // focus-return cleanup) land after the synchronous event — await them.
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull())
    await waitFor(() => expect(document.activeElement).toBe(openButton))
  })
})
```

- [ ] **Step 2: Run to verify failure**

Run: `rtk pnpm --filter widgets-passport-checker exec vitest run ui/RecoveryModal.test.tsx ui/recovery-flow.test.tsx`
Expected: FAIL — modules do not exist.

- [ ] **Step 3: Implement the isolation hook, canvas, SSH section, modal, and wiring**

Create `packages/widgets/passport-checker/ui/use-modal-isolation.ts`:

```ts
import { useEffect, useRef } from 'react'
import type { RefObject } from 'react'

const FOCUSABLE_SELECTOR =
  'button:not([disabled]), [href], input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])'

/**
 * Self-contained modal behavior for a portal that may sit above Radix layers
 * the widget cannot patch (e.g. the board's fullscreen dialog):
 * - capture-phase Esc on document closes ONLY this modal (stopPropagation
 *   keeps Radix's bubble-phase escape handler from ever seeing the key);
 * - pointerdown/focusin born inside the modal stop propagating, so underlying
 *   DismissableLayer/FocusScope document listeners never queue their deferred
 *   outside-dismiss checks (the nested-dialog dismiss race cannot start);
 * - Tab cycles within the modal; focus moves in on mount and returns to the
 *   previously focused element on unmount.
 */
export function useModalIsolation(rootRef: RefObject<HTMLElement | null>, onClose: () => void) {
  const onCloseRef = useRef(onClose)
  onCloseRef.current = onClose

  useEffect(() => {
    const root = rootRef.current
    if (!root) return

    const previouslyFocused =
      document.activeElement instanceof HTMLElement ? document.activeElement : null

    const focusables = () => Array.from(root.querySelectorAll<HTMLElement>(FOCUSABLE_SELECTOR))
    focusables()[0]?.focus()

    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        event.preventDefault()
        event.stopPropagation()
        onCloseRef.current()
        return
      }
      if (event.key !== 'Tab') return
      const items = focusables()
      const first = items[0]
      const last = items[items.length - 1]
      if (!first || !last) return
      const active = document.activeElement
      if (event.shiftKey && (active === first || !root.contains(active))) {
        event.preventDefault()
        last.focus()
        return
      }
      if (!event.shiftKey && (active === last || !root.contains(active))) {
        event.preventDefault()
        first.focus()
      }
    }
    document.addEventListener('keydown', onKeyDown, true)

    const stop = (event: Event) => event.stopPropagation()
    root.addEventListener('pointerdown', stop)
    root.addEventListener('focusin', stop)

    return () => {
      document.removeEventListener('keydown', onKeyDown, true)
      root.removeEventListener('pointerdown', stop)
      root.removeEventListener('focusin', stop)
      previouslyFocused?.focus()
    }
  }, [rootRef])
}
```

Create `packages/widgets/passport-checker/ui/parts/NoVncCanvas.tsx`:

```tsx
import { wrap } from '@reatom/core'
import { Unlink } from 'lucide-react'
import { useEffect, useRef } from 'react'
import { cn, reatomMemo } from 'widget-sdk'

import type { RecoveryState } from '../../model/recovery-model'
import { usePassportChecker } from '../passport-checker-context'

import styles from '../recovery-modal.module.css'

const FRAME_COPY: Record<RecoveryState['kind'], { title: string; hint?: string }> = {
  issuing: { title: 'Подключение…', hint: 'запрашиваем доступ к сессии' },
  connecting: { title: 'Подключение…', hint: 'устанавливаем WebSocket к noVNC' },
  connected: { title: '' },
  disconnected: { title: 'Соединение разорвано' },
  expired: { title: 'Срок доступа истёк' },
  unavailable: { title: 'Нет активной сессии для восстановления' },
  busy: { title: 'Восстановление уже идёт' },
  automationDown: { title: 'Сервис автоматизации недоступен' },
}

const RECONNECT_KINDS: ReadonlySet<RecoveryState['kind']> = new Set([
  'disconnected',
  'expired',
  'unavailable',
  'busy',
  'automationDown',
])

export const NoVncCanvas = reatomMemo(() => {
  const { recoveryModel } = usePassportChecker()
  const containerRef = useRef<HTMLDivElement | null>(null)
  const state = recoveryModel.state()

  const start = wrap((el: HTMLElement) => {
    void recoveryModel.start(el)
  })
  const teardown = wrap(() => recoveryModel.teardown())
  const reconnect = wrap(() => {
    const el = containerRef.current
    if (el) void recoveryModel.start(el)
  })

  useEffect(() => {
    const el = containerRef.current
    if (el) start(el)
    return () => teardown()
    // Mount-once: reconnects go through the model, not remounts.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  const spinning = state.kind === 'issuing' || state.kind === 'connecting'
  const broken = state.kind === 'disconnected' || state.kind === 'expired'

  return (
    <div className={styles.frame}>
      <div ref={containerRef} className={styles.canvas} />
      {state.kind === 'connected' && (
        <>
          <span className={styles.liveBadge}>LIVE · 1280×720</span>
          <span className={styles.scaleCaption}>масштаб по ширине</span>
        </>
      )}
      {state.kind !== 'connected' && (
        <div className={cn(styles.frameOverlay, broken && styles.frameOverlayError)} role="status">
          {spinning && <span className={styles.frameSpinner} aria-hidden />}
          {broken && <Unlink size={22} aria-hidden />}
          <div className={styles.frameTitle}>{FRAME_COPY[state.kind].title}</div>
          {FRAME_COPY[state.kind].hint && (
            <div className={styles.frameHint}>{FRAME_COPY[state.kind].hint}</div>
          )}
          {RECONNECT_KINDS.has(state.kind) && (
            <button type="button" className={styles.reconnectButton} onClick={reconnect}>
              Переподключиться
            </button>
          )}
        </div>
      )}
    </div>
  )
}, 'PassportCheckerNoVncCanvas')
```

Create `packages/widgets/passport-checker/ui/parts/SshFallback.tsx`:

```tsx
import { Copy } from 'lucide-react'
import { useState } from 'react'
import { reatomMemo } from 'widget-sdk'

import styles from '../recovery-modal.module.css'

export const SshFallback = reatomMemo<{ sshTarget: string | null }>(({ sshTarget }) => {
  const [expanded, setExpanded] = useState(false)
  if (sshTarget === null) return null

  const command = `ssh -L 6080:127.0.0.1:6080 ${sshTarget}`
  const copy = () => {
    void navigator.clipboard.writeText(command).catch((cause: unknown) => {
      console.warn('clipboard write failed:', cause)
    })
  }

  return (
    <section className={styles.ssh}>
      <button
        type="button"
        className={styles.sshToggle}
        aria-expanded={expanded}
        onClick={() => setExpanded((value) => !value)}
      >
        <span>Запасной вход по SSH</span>
        <span className={styles.sshTag}>для продвинутых</span>
      </button>
      {expanded && (
        <div className={styles.sshBody}>
          <p className={styles.sshHint}>
            Если встроенное окно не работает, пробросьте noVNC по SSH и откройте
            http://localhost:6080 в браузере.
          </p>
          <div className={styles.sshCommandRow}>
            <code className={styles.sshCommand}>{command}</code>
            <button
              type="button"
              className={styles.copyButton}
              onClick={copy}
              aria-label="Скопировать команду"
            >
              <Copy size={14} aria-hidden />
            </button>
          </div>
          <p className={styles.sshNote}>
            ssh-цель из конфигурации виджета · тот же одноразовый срок доступа
          </p>
        </div>
      )}
    </section>
  )
}, 'PassportCheckerSshFallback')
```

Create `packages/widgets/passport-checker/ui/RecoveryModal.tsx`:

```tsx
import { wrap } from '@reatom/core'
import { AppWindow, Check, X } from 'lucide-react'
import { useRef } from 'react'
import type { MouseEvent } from 'react'
import { createPortal } from 'react-dom'
import { reatomMemo } from 'widget-sdk'

import { usePassportChecker } from './passport-checker-context'
import { NoVncCanvas } from './parts/NoVncCanvas'
import { SshFallback } from './parts/SshFallback'
import { useModalIsolation } from './use-modal-isolation'

import styles from './recovery-modal.module.css'

export function formatAccessCountdown(ms: number): string {
  const totalSeconds = Math.max(0, Math.floor(ms / 1000))
  const minutes = Math.floor(totalSeconds / 60)
  const seconds = String(totalSeconds % 60).padStart(2, '0')
  return `${minutes}:${seconds}`
}

export const RecoveryModal = reatomMemo(() => {
  const { checkModel, recoveryModel } = usePassportChecker()
  const rootRef = useRef<HTMLDivElement | null>(null)

  const close = wrap(() => {
    recoveryModel.teardown()
    checkModel.recoveryOpen.set(false)
  })
  const retry = wrap(() => {
    recoveryModel.teardown()
    checkModel.recoveryOpen.set(false)
    void checkModel.checkPassport()
  })
  const onBackdrop = wrap((event: MouseEvent<HTMLDivElement>) => {
    if (event.target === event.currentTarget) close()
  })

  useModalIsolation(rootRef, close)

  const view = checkModel.viewState()
  const sshTarget = view.kind === 'sessionRequired' ? view.sshTarget : null
  const remaining = recoveryModel.remainingMs()

  return createPortal(
    <div ref={rootRef} className={styles.overlay} onClick={onBackdrop}>
      <div
        className={styles.dialog}
        role="dialog"
        aria-modal="true"
        aria-labelledby="passport-recovery-title"
      >
        <header className={styles.header}>
          <span className={styles.headerChip} aria-hidden>
            <AppWindow size={16} />
          </span>
          <div className={styles.headerText}>
            <div id="passport-recovery-title" className={styles.headerTitle}>
              Восстановление сессии браузера
            </div>
            <div className={styles.headerSubtitle}>Пройдите проверку в живом окне Chromium</div>
          </div>
          <span className={styles.accessPill} aria-label="Оставшееся время доступа">
            доступ · {formatAccessCountdown(remaining)}
          </span>
          <button
            type="button"
            className={styles.closeButton}
            title="Закрыть (Esc)"
            aria-label="Закрыть"
            onClick={close}
          >
            <X size={16} aria-hidden />
          </button>
        </header>
        <div className={styles.body}>
          <NoVncCanvas />
          <SshFallback sshTarget={sshTarget} />
        </div>
        <footer className={styles.footer}>
          <button type="button" className={styles.secondaryButton} onClick={close}>
            Закрыть
          </button>
          <button type="button" className={styles.primaryButton} onClick={retry}>
            <Check size={16} aria-hidden /> Повторить проверку
          </button>
        </footer>
      </div>
    </div>,
    document.body,
  )
}, 'PassportCheckerRecoveryModal')
```

Update `packages/widgets/passport-checker/ui/passport-checker-context.ts` — the value type becomes:

```ts
import type { PassportCheckModel } from '../model/check-model'
import type { RecoveryModel } from '../model/recovery-model'

export type PassportCheckerContextValue = {
  checkModel: PassportCheckModel
  recoveryModel: RecoveryModel
}
```

Update `packages/widgets/passport-checker/ui/PassportChecker.tsx` — build the recovery model with prod adapters and render the modal:

```tsx
// add imports:
import { makeRecoveryModel } from '../model/recovery-model'
import { makeRecoveryTransport } from '../model/recovery-transport'
import { makeNoVncRfb } from '../model/rfb'
import { RecoveryModal } from './RecoveryModal'
```

```tsx
export const PassportChecker = reatomMemo(() => {
  const { tier, typeId, api } = useWidgetContext<PassportCheckerEvents>()
  const checkModel = useMemo(() => makePassportCheckModel({ api }), [api])
  const recoveryModel = useMemo(
    () =>
      makeRecoveryModel({
        widgetId: typeId,
        transport: makeRecoveryTransport(),
        makeRfb: makeNoVncRfb,
      }),
    [typeId],
  )
  const value = useMemo<PassportCheckerContextValue>(
    () => ({ checkModel, recoveryModel }),
    [checkModel, recoveryModel],
  )

  return (
    <passportCheckerContext.Provider value={value}>
      <div className={styles.widget} data-tier={tier}>
        {isStandardLayout(tier) ? <StandardTier /> : <TinyTier />}
      </div>
      {checkModel.recoveryOpen() && <RecoveryModal />}
    </passportCheckerContext.Provider>
  )
}, 'PassportChecker')
```

Create `packages/widgets/passport-checker/ui/recovery-modal.module.css`:

```css
.overlay {
  position: fixed;
  inset: 0;
  z-index: 120;
  display: grid;
  place-items: center;
  background: rgba(20, 22, 40, 0.45);
  backdrop-filter: blur(2px);
}

.dialog {
  display: flex;
  flex-direction: column;
  width: 920px;
  max-width: 92vw;
  max-height: min(620px, 90vh);
  border-radius: 18px;
  overflow: hidden;
  background: var(--card, #fff);
  box-shadow: var(--shadow-overlay, 0 24px 50px -18px rgba(30, 32, 55, 0.22));
  font-family: var(--font-ui, system-ui, sans-serif);
  color: var(--text, #22232a);
}

.header {
  display: flex;
  align-items: center;
  gap: 10px;
  padding: 18px 22px;
  border-bottom: 1px solid var(--border, #e3e4e8);
}

.headerChip {
  width: 30px;
  height: 30px;
  flex: none;
  border-radius: 9px;
  display: grid;
  place-items: center;
  background: var(--accent-soft, oklch(0.955 0.032 285));
  color: var(--primary, oklch(0.55 0.17 281));
}

.headerText {
  min-width: 0;
  flex: 1;
}

.headerTitle {
  font-weight: 600;
  font-size: 15.5px;
}

.headerSubtitle {
  font-size: 12px;
  color: var(--text-dim, #5b5e69);
}

.accessPill {
  flex: none;
  padding: 5px 10px;
  border-radius: 999px;
  border: 1px solid var(--border, #e3e4e8);
  font-family: var(--font-mono, ui-monospace, monospace);
  font-variant-numeric: tabular-nums;
  font-size: 11.5px;
  color: var(--text-dim, #5b5e69);
}

.closeButton {
  width: 32px;
  height: 32px;
  flex: none;
  display: grid;
  place-items: center;
  border: 1px solid var(--border, #e3e4e8);
  border-radius: 9px;
  background: var(--card, #fff);
  color: var(--text-dim, #5b5e69);
  cursor: pointer;
}

.body {
  flex: 1;
  min-height: 0;
  overflow-y: auto;
  display: flex;
  flex-direction: column;
  gap: 12px;
  padding: 16px;
  background: var(--secondary, #f5f6f8);
}

.frame {
  position: relative;
  aspect-ratio: 16 / 9;
  border-radius: 12px;
  overflow: hidden;
  background: #16171d;
  border: 1px solid #2a2c36;
}

.canvas {
  position: absolute;
  inset: 0;
}

.liveBadge {
  position: absolute;
  top: 10px;
  left: 10px;
  padding: 4px 8px;
  border-radius: 999px;
  background: rgba(0, 0, 0, 0.55);
  color: #fff;
  font-family: var(--font-mono, ui-monospace, monospace);
  font-size: 10.5px;
  animation: pc-pulse 1.6s ease-in-out infinite;
}

@keyframes pc-pulse {
  50% {
    opacity: 0.55;
  }
}

.scaleCaption {
  position: absolute;
  bottom: 8px;
  right: 10px;
  font-family: var(--font-mono, ui-monospace, monospace);
  font-size: 10px;
  color: rgba(255, 255, 255, 0.55);
}

.frameOverlay {
  position: absolute;
  inset: 0;
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  gap: 8px;
  color: #d7d9e2;
  text-align: center;
  padding: 16px;
}

.frameOverlayError {
  border: 1px solid oklch(0.55 0.21 27 / 0.6);
  border-radius: 12px;
}

.frameSpinner {
  width: 22px;
  height: 22px;
  border: 2px solid #2a2c36;
  border-top-color: #d7d9e2;
  border-radius: 50%;
  animation: pc-frame-spin 0.8s linear infinite;
}

@keyframes pc-frame-spin {
  to {
    transform: rotate(360deg);
  }
}

.frameTitle {
  font-weight: 600;
  font-size: 14px;
}

.frameHint {
  font-size: 12px;
  color: #9396a0;
}

.reconnectButton {
  margin-top: 6px;
  padding: 8px 14px;
  border: 1px solid #2a2c36;
  border-radius: 10px;
  background: #22232a;
  color: #fff;
  font: inherit;
  font-size: 12.5px;
  font-weight: 600;
  cursor: pointer;
}

.ssh {
  border: 1px solid var(--border, #e3e4e8);
  border-radius: 12px;
  background: var(--card, #fff);
}

.sshToggle {
  width: 100%;
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 8px;
  padding: 10px 12px;
  border: 0;
  background: none;
  font: inherit;
  font-weight: 600;
  font-size: 13px;
  cursor: pointer;
}

.sshTag {
  font-weight: 400;
  font-size: 11px;
  color: var(--text-3, #9396a0);
}

.sshBody {
  padding: 0 12px 12px;
}

.sshHint {
  margin: 0 0 8px;
  font-size: 12px;
  color: var(--text-dim, #5b5e69);
}

.sshCommandRow {
  display: flex;
  align-items: center;
  gap: 8px;
}

.sshCommand {
  flex: 1;
  min-width: 0;
  overflow-x: auto;
  padding: 10px 12px;
  border-radius: 10px;
  background: #16171d;
  color: #d7d9e2;
  font-family: var(--font-mono, ui-monospace, monospace);
  font-size: 12px;
  white-space: nowrap;
}

.copyButton {
  width: 34px;
  height: 34px;
  flex: none;
  display: grid;
  place-items: center;
  border: 1px solid var(--border, #e3e4e8);
  border-radius: 9px;
  background: var(--card, #fff);
  cursor: pointer;
}

.sshNote {
  margin: 8px 0 0;
  font-size: 11px;
  color: var(--text-3, #9396a0);
}

.footer {
  display: flex;
  justify-content: flex-end;
  gap: 10px;
  padding: 14px 22px;
  border-top: 1px solid var(--border, #e3e4e8);
  background: var(--card, #fff);
}

.primaryButton,
.secondaryButton {
  display: inline-flex;
  align-items: center;
  gap: 7px;
  height: 38px;
  padding: 0 16px;
  border: 1px solid transparent;
  border-radius: 11px;
  font: inherit;
  font-weight: 600;
  font-size: 13.5px;
  cursor: pointer;
}

.primaryButton {
  background: var(--primary, oklch(0.55 0.17 281));
  color: var(--primary-foreground, #fff);
}

.secondaryButton {
  background: var(--card, #fff);
  border-color: var(--border, #e3e4e8);
  color: var(--text, #22232a);
}

@media (max-width: 640px) {
  .overlay {
    place-items: stretch;
  }

  .dialog {
    width: 100vw;
    max-width: 100vw;
    height: 100dvh;
    max-height: none;
    border-radius: 0;
  }
}
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `rtk pnpm --filter widgets-passport-checker exec vitest run ui/RecoveryModal.test.tsx ui/recovery-flow.test.tsx`
Expected: PASS.

Run the whole package: `rtk pnpm --filter widgets-passport-checker test`
Expected: PASS (models, tiers, harness, browser tests unchanged).

- [ ] **Step 5: Typecheck and commit**

Run: `rtk pnpm --filter widgets-passport-checker typecheck`
Expected: PASS.

```bash
rtk git add packages/widgets/passport-checker/ui
rtk git commit -m "feat(passport-checker): add the noVNC recovery modal with ssh fallback"
```

---

### Task 10: final gate — codegen, workspace checks, visual smoke

**Files:** none new (formatting fixes only, if any).

- [ ] **Step 1: Full workspace gate**

Run: `rtk pnpm check`
(This runs codegen + oxlint + oxfmt --check + syncpack + workspace typecheck + every workspace test.)
Expected: PASS. If `format:check` complains, run `rtk pnpm format` and re-run; if oxlint complains, fix the specific findings (do not blanket-disable rules).

- [ ] **Step 2: Standalone visual smoke (optional but recommended)**

Run: `rtk pnpm --filter widgets-passport-checker dev` and open `http://localhost:5182`.
Expected: the idle tile renders with correct colors (dev tokens), «Проверить» flips to «Проверяем…» and then to a red retryable banner (no API behind the harness → `network` code → generic message). This validates layout/tokens only; the full session-required → recovery flow needs the real board + automation stack and is out of scope here.

- [ ] **Step 3: Commit any formatting deltas and finish**

```bash
rtk git status
rtk git add -A && rtk git commit -m "chore(passport-checker): formatting after full gate"   # only if there are changes
```

Then follow superpowers:finishing-a-development-branch (typically: push `feat/passport-checker-widget` and open a PR titled "feat: passport checker widget (Subproject 7)").

---

## Deviations from the spec (all deliberate — carry them into review)

1. **`WidgetApiError.code` is required**, not optional — every construction site sets a real or synthetic code, so the model never branches on `undefined`.
2. **`makeRfb`/`makeNoVncRfb`/`makeRecoveryTransport`/`makePassportCheckModel` naming** — the spec sketches `createRfb`; the repo owner's standing preference is `make*` factories.
3. **Tier config declares all four tiers** (`TierConfig` requires them); the runtime tier names collapse to the spec's two layouts in `isStandardLayout`.
4. **«Переподключиться» also appears in `unavailable`/`busy`/`automationDown` frames** (spec draws it only for `disconnected`/`expired`); every press is a fresh single-use issue.
5. **The dismiss-race mitigation is event isolation from outside the document boundary**, not the "ref cleared one tick late" pattern — the latter needs cooperation from the underlying dialog, which a widget cannot patch. Radix's modal dialog attaches its `useEscapeKeydown`/`FocusScope`/`DismissableLayer` listeners to `document` in the CAPTURE phase (the original notes wrongly called the escape handler bubble-phase), so the modal neutralizes each axis on `window` in the capture phase — the first stop of the capture path, ahead of any document-capture listener. Concretely: (a) a window-capture `keydown` `stopPropagation`s Escape before Radix's document-capture handler runs, so only our modal closes; (b) `pointer-events: auto` on the overlay restores input, since a Radix modal layer sets `pointer-events: none` on `document.body` and the body-portaled overlay inherits it; (c) a window-capture `focusout` guard swallows the focusout whose `relatedTarget` lands inside our root, so the trapped `FocusScope` cannot yank focus back out of the modal; (d) backdrop dismissal is press-based in the hook's native `pointerdown` listener (`root` is the backdrop; a press starting on it closes, one starting on the panel never does), matching Radix and avoiding the drag-release-over-backdrop false close. Isolation prevents the race from starting at all.
6. **The access countdown keeps running after connect and expires the live session at 0** (literal reading of the spec's pill/expired frame); the server's 15-min cap independently surfaces as `disconnected`. Raise `BROWSER_RECOVERY_TOKEN_TTL_MS` in deployment if 60s proves too tight.
7. **Handler statuses**: `browser_configuration` maps to HTTP 500 so `sendWidgetError` logs it server-side (admin-actionable); the client keys off `code`, never the status.
8. **`checkPassport` is an explicit `viewState` state machine, not `withAsync`** (the spec sketches `withAsync`): `api.invoke` returns errors **as values** (errore), so `withAsync`'s thrown-error tracking would never observe them, and the client-deadline race needs a single settle point.
