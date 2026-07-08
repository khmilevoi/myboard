# WebAuthn Gate Enforcement (Plan 3) Design

**Date:** 2026-07-07
**Status:** Approved — revised 2026-07-08 (`unauthorizedHandlerAtom` →
`makeHostRuntime` composition root; raw ky adoption → owned
`HttpClient`/`EventStream` ports in `@shared/http`, ky as adapter detail);
second review pass 2026-07-08 (SW-aware bail target `/activate/` +
`navigateFallbackDenylist`; SSE reconnect without re-auth — session heals
only via the 401 retry hook; shared CSRF constants in `@shared/http/csrf`)
**Parent spec:** [2026-07-05-device-invite-webauthn-gate-design.md](./2026-07-05-device-invite-webauthn-gate-design.md)

## Goal

Close the door. Plans 1–2 delivered the full dormant auth system: invites,
accounts, devices, sessions, WebAuthn ceremonies, the standalone activation app
(`/activate`, `/add-device`), the board-side account menu / My-devices / QR
add-device flow, and their tests — all with the gate OFF. Plan 3 enables the
nginx `auth_request` gate and ships the hardening tail, making the board private
end to end:

- nginx gate: `auth_request` + public allowlist + `error_page 401` → activation.
- Rate limiting (nginx `limit_req`).
- Server-side CSRF check of `X-Requested-With`.
- Audit logging of auth events to stdout.
- Silent re-login on 401 in the widget-runtime HTTP backend (via the shared
  `HttpClient` port) + SSE reconnect + logout purge of local data.
- The five missing ops scripts.
- Gate tests (nginx suite) and gated e2e.

## Decisions locked in this brainstorm

- **Full Plan 3 scope** as listed above — no further splitting.
- **Gate is always on** in the nginx image. No env toggle: one config variant,
  impossible to deploy unprotected. Locally, `pnpm start:docker` requires a
  one-time activation via `create-invite` (session then persists in the local
  Valkey volume); e2e seeds via the `ALLOW_TEST_DB_RESET` test endpoints.
- **Repo becomes gate-ready; the Cloudflare Tunnel is a manual ops step.**
  Plan 3 updates `rpi.toml` / compose env; the user runs `rpi deploy` and sets
  up cloudflared/DNS themselves.
- **Audit logs go to stdout** (structured JSON lines, read via
  `docker compose logs server`). No Valkey audit stream.
- **Own transport ports in `packages/shared/http/`** (2026-07-08 revision —
  supersedes "adopt ky as the HTTP client interface"). An `HttpClient` class
  (`new HttpClient({ baseUrl, onRequest, onResponse })`) with errore-value
  semantics wraps ky as a swappable implementation detail; an `EventStream`
  port wraps `EventSource`. Every hand-rolled fetch layer migrates to the
  ports **in this plan**: widget-runtime (`http-storage`, `widget-api`,
  `http-time`, SSE subscribe), the client's `devices-http` and the new
  relogin model, and the activation app's two `postJson` copies. `typeof
  fetch` survives only inside the adapter. The 401 handler reaches
  widget-runtime as a `makeHostRuntime` option at each host's composition
  root — no global handler slot — see 3.2–3.4.

## Non-goals

- No gate on the Vite dev/preview paths (`pnpm dev`, `pnpm test:e2e`) — the
  gate exists only in the nginx image, per the parent spec.
- No cloudflared service or DNS automation in the repo.
- No admin UI; ops stay CLI scripts.
- No migration of the activation app's existing English copy (separate task).
- No change to WebAuthn parameters, cookie policy, or the auth data model —
  those shipped in Plans 1–2.

## 1. nginx gate

**Verifier.** `location = /internal/auth` (marked `internal`) proxies to the
server's `GET /api/auth/session` with `proxy_method GET`,
`proxy_pass_request_body off`, and `Content-Length ""` — without these the
subrequest would inherit the original method/body and miss the find-my-way
route. `/api/auth/session` already does everything required: validates the
`__Host-mb_session` cookie, rejects revoked/pending/disabled devices
(immediate revocation), and refreshes the sliding TTL. Cost, accepted
knowingly: every gated request adds one verifier subrequest to Node+Valkey;
at this scale that is noise, and if it ever hurts, `proxy_cache` on the
verifier location keyed by the session cookie is the known escape hatch.

**Behind `auth_request /internal/auth`:**

- `location /` — the SPA shell and all navigations;
- `/assets/*`, `/widgets/*` — all board and federation code;
- `/api/*` — everything except the allowlist below.

**Public allowlist (no `auth_request`):**

- `/activate/` — the activation app's static files (HTML + its assets;
  the activation build uses `base: '/activate/'`);
- `/add-device` — serves the same `/activate/index.html`;
- `/api/auth/*` — the whole namespace: session-required endpoints inside it
  (`/devices`, `add-token`, `approve`, `revoke`, `events`, `account`) already
  enforce sessions in Node via `requireSession`; duplicating that split in
  nginx would add config for no security gain;
- `/api/test/*` — e2e seeding; dead in production without
  `ALLOW_TEST_DB_RESET=1` on the server.

**401 fallback.** `error_page 401 /activate/index.html` is set **only in
`location /`** (navigations): an expired-session user sees the activation page
in login mode, the URL does not change, and the response status stays 401.
`/assets/`, `/widgets/`, and `/api/` return a bare 401 with no HTML body — the
client interceptor keys on the status, and an HTML body would only get in the
way.

**Rate limiting.** Two `limit_req_zone`s keyed by `$binary_remote_addr` (the
real client IP is already restored by the existing `set_real_ip_from` +
`real_ip_header X-Forwarded-For` block, which cloudflared populates):

- `auth`: 30 r/min, `burst=15 nodelay`, applied to `/api/auth/` — a login
  ceremony is a burst of ~5 requests;
- `pending`: 60 r/min on `location = /api/auth/devices/pending-status` so
  device B's ~2 s polling never trips the auth limit.

No limit on `/internal/auth` — those are internal subrequests of every gated
request.

## 2. Server hardening

**CSRF guard.** A small guard in the router layer (`app.ts`): every
**mutating** request (`POST`/`PUT`/`DELETE`/`PATCH`) to `/api/*` must carry
`X-Requested-With: MyBoard`, else 403 `{ code: 'csrf_required' }` (errore
style, like the rest of the handlers). Exception: `/api/test/*` (already dead
without the env flag; keeps e2e helpers untouched). Both frontends already
send the header (board `devices-http`, activation `postJson`); the missing
sender is the widget-runtime HTTP backend, fixed in section 3. GET/HEAD and
the SSE streams are exempt. WebAuthn is origin-bound by itself, but one
uniform rule is simpler than per-namespace exceptions. The header name/value
pair lives once in `@shared/http/csrf` (`CSRF_HEADER`, `CSRF_HEADER_VALUE`,
lowercase name — valid verbatim in Node's `req.headers` and in `Headers.set`);
the server guard and the client port both import it, while tests keep raw
strings so the contract stays pinned from outside.

**Audit log.** New `auth/audit.ts`: `audit(event, fields)` writes one JSON
line to stdout. Events: `register`, `register_failed`, `login`,
`login_failed`, `logout`, `device_pending`, `device_approved`,
`device_denied`, `device_revoked`, `invite_locked`, `addtoken_minted`.
Fields: `ts`, `event`, `accountId`/`credentialId`/`inviteId` (when known),
`ip`, `ua`, and the error code on failures. The IP helper honors
`TRUST_CF_CONNECTING_IP=1` → `CF-Connecting-IP`, else `X-Real-IP` (set by
nginx), else the socket address. The logger is a dependency in `AuthDeps`;
handlers bind the request context once via a request-scoped emitter
(`auditFor(deps, req)` → `emit(event, extra)`), so emission sites state only
the event-specific fields. Tests swap the logger and assert events fire and
that tokens/challenges never appear in output.

Everything else on the parent spec's hardening list already shipped in
Plans 1–2: per-invite/per-code failed-attempt locks, immediate revocation in
`verifySession`, `__Host-` cookies, sign-counter clone detection.

## 3. Client: transport ports, silent re-login, SSE, logout

### 3.1 `packages/client/src/session/model/relogin.ts` — all logic, pure Reatom

Reatom action `ensureSession(): Promise<boolean>`:

- **Single-flight** via an atom `reloginPromise: Atom<Promise<boolean> | null>`:
  if a promise is already in flight, return it; otherwise start the chain and
  store its promise. Ten parallel 401s → one ceremony. (Continuations after
  `await` use pre-created `wrap()` closures per the reatom rules.)
- Chain: **probe** `GET /api/auth/session`. `200` → return `true` with no
  ceremony (session is alive; the failure was not auth). `401` → ceremony:
  `POST /api/auth/login/options` → `navigator.credentials.get()` →
  `POST /api/auth/login/verify` → `true`. The probe and ceremony calls go
  through the model's **own bare `new HttpClient()`** (no retry hook — the
  re-login path must never recurse into itself; also keeps the import graph
  acyclic, see 3.4).
- Any failure or ceremony cancel → clear the credential hint,
  `navigate('/activate/')`, and `false`. The target is `/activate/`, **not**
  `/` (2026-07-08 second-pass revision): the installed PWA service worker
  serves the cached board shell for `/` (`navigateFallback`), which would
  loop a revoked device through endless ceremonies without ever reaching
  nginx; `/activate/` is public and excluded from the SW fallback (denylist
  below), so it always reaches the gate. `navigate` is an injected
  dependency (the shared `Navigate` type, 3.2) for tests.
- The probe separates concerns before any ceremony: transport failure →
  `false` with no redirect (offline-first — the caller just sees its
  original error), 200 → the session is fine and the caller's 401 was
  spurious, 401 → the ceremony is actually needed.
- The client PWA config gains
  `navigateFallbackDenylist: [/^\/activate/, /^\/add-device/]` — the service
  worker must never mask the activation surfaces with the cached board
  shell. SW-active e2e coverage of this is deliberately out of scope (fresh
  Playwright contexts do not run the installed SW); the denylist is the
  product fix, the revoked-device journey asserts the visible outcome.

### 3.2 `@shared/http` — owned transport ports (ky stays, behind the port)

(2026-07-08 revision — supersedes raw ky adoption. The codebase has four
independently written fetch/JSON/errore layers: `devices-http.ts`'s
`request<T>`, two mirrored `postJson`/`getJson` copies in the activation
models, and the raw `fetch` chains in widget-runtime's `http-storage.ts`,
`widget-api.ts`, and `http-time.ts` — each threading `fetchImpl: typeof
fetch` through its API and re-mapping errors by hand. The ports replace all
of them.)

`packages/shared/http/client.ts`:

```ts
export type HttpResponse = { status: number; ok: boolean; body: unknown }

export class HttpTransportError extends errore.createTaggedError(/* … */) {}

export type RequestHook = (ctx: HttpRequestContext) => void | Promise<void>
export type ResponseHook = (
  ctx: { response: HttpResponse; retryCount: number },
) => void | 'retry' | Promise<void | 'retry'>

export type HttpClientOptions = {
  baseUrl?: string
  onRequest?: RequestHook[]
  onResponse?: ResponseHook[]
  fetch?: typeof globalThis.fetch // the ONE legitimate typeof-fetch seam: the adapter
}

export class HttpClient {
  constructor(options?: HttpClientOptions) // ky.create inside
  get(path: string, options?): Promise<HttpTransportError | HttpResponse>
  post(path: string, options?: { json?: unknown }): Promise<HttpTransportError | HttpResponse>
  // put / delete / patch — same shape
}

export function makeUnauthorizedRetryHook(
  onUnauthorized: () => Promise<boolean>,
): ResponseHook // 401 && retryCount === 0 && await onUnauthorized() → 'retry'
```

Semantics:

- **Errors are values.** Only transport failures return `HttpTransportError`:
  network failure, or a 2xx body that fails JSON parsing. A non-2xx status is
  a normal `HttpResponse` — domain layers decide what it means (404 → `null`
  in storage, error-code extraction in `devices-http`).
- **Non-JSON or empty body on a non-2xx → `body: undefined`**, status
  preserved. This matters behind the gate: nginx serves bare-bodied 401s,
  which today's unconditional `res.json()` in `devices-http` would turn into
  the wrong error class (`DeviceHttpError` instead of a 401 `DeviceApiError`).
- **Immutable after construction.** Hooks are constructor options, composed
  at the composition root — no post-construction registration (that would be
  the `unauthorizedHandlerAtom` disease in instance form).
- **CSRF built in**: `X-Requested-With: MyBoard` on mutating methods is this
  server's protocol convention, so the client sets it by default — no
  per-root hook noise. Both sides import the constants from
  `@shared/http/csrf` (section 2).
- **`'retry'` from an `onResponse` hook replays the request exactly once**
  (`retryCount` guards the hook). `json` bodies are plain values,
  re-serialized per attempt — no body-stream cloning problem, POST included.
- **ky is the implementation detail** inside the class: baseUrl joining, JSON
  handling, and the forced-retry mechanics (`afterResponse` → `ky.retry()`).
  It stays swappable behind the port; its thrown `HTTPError`s are mapped back
  to values at this single adapter boundary. Automatic retries and ky's
  default 10 s timeout are **off** — today's semantics must not change
  silently. Implementation-time check: a test proves the forced retry fires
  for `POST` (append, subscribe) with auto-retries disabled.

`packages/shared/http/event-stream.ts` — the same treatment for SSE:

```ts
export type EventStreamMessage = { event?: string; data: string }
export type EventStream = { close(): void }
export type OpenEventStream = (
  url: string,
  handlers: {
    onMessage: (message: EventStreamMessage) => void
    onError?: () => void
    /** named SSE events to forward besides plain messages, e.g. ['ready'] */
    events?: string[]
  },
) => EventStream

export function makeEventSourceStream(): OpenEventStream // over native EventSource
```

Reconnection policy stays in consumers; the port only opens/closes and
delivers. Tests pass a fake `OpenEventStream` — this retires the
`EventSource` polyfills currently duplicated across three vitest setups.

`packages/shared/navigation.ts`: `export type Navigate = (path: string) =>
void` — the type the activation models already invented ad hoc
(`overrides.navigate`); relogin and logout take the same. Implementations
stay one-liners at composition roots.

New dependency: `ky` (~4 KB, ESM, zero deps), resolved by the packages that
consume `@shared/http` (exact package.json placement is a plan detail).

Considered and left alone: WebAuthn ceremonies stay injected as
`@simplewebauthn/browser` functions (the library is already the abstraction);
Dexie already sits behind the `StorageApi` port.

### 3.3 `makeHostRuntime` in widget-runtime — knows nothing about auth

(2026-07-08 revision — replaces the `unauthorizedHandlerAtom` config atom,
which itself replaced a `setUnauthorizedHandler` module registry. Both were
global mutable state papering over a missing composition root: the SSE
manager was a lazily-created module singleton — `getSseManager`'s
module-level map — so a per-call `onUnauthorized` option would have degraded
to first-caller-wins. The fix is to make construction explicit, not to hide
the config deeper in a global slot.)

`packages/widget-runtime/src/host-runtime.ts`:

```ts
export type HostRuntimeOptions = {
  serverBaseUrl?: string            // default '/api/storage'
  http?: HttpClient                 // the host's shared client (the board passes its retry-hooked one); default: bare new HttpClient()
  openEventStream?: OpenEventStream // test seam; default makeEventSourceStream()
}

export type HostRuntime = {
  makeWidgetStorage(options: { instanceId: string; typeId: string }): WidgetStorage
  makeScopedStorage(scope: string): ScopedStorage
  makeWidgetApi<Events extends WidgetEventMap>(options: {
    instanceId: string
    typeId: string
  }): WidgetApi<Events, WidgetApiError>
}

export function makeHostRuntime(options?: HostRuntimeOptions): HostRuntime
```

When `http` is absent the runtime builds its own **bare** `new HttpClient()`
(2026-07-08 second-pass revision: no `onUnauthorized` option at all — auth
never exists below a composition root; the board's 401 healing arrives
solely through the retry hook on the client it injects, and SSE reconnect
needs no re-auth, see 3.5).

One `HostRuntime` per document, built once at the host's composition root
(3.4). It owns **one SSE manager** and runs every request through **one
`HttpClient`** (used by `makeHttpStorage` for all methods, `makeWidgetApi`,
and the SSE subscribe `POST /events/:connId`) — the board injects its shared
retry-hooked client so the whole document uses a single hooked instance;
bare hosts get an internally built one. The module-level `getSseManager` map and the free
`makeWidgetStorage` / `makeScopedStorage` / `makeWidgetApi` package exports
are deleted: the factories exist only on the runtime, so no ambient path
around the composition root remains. Building two runtimes opens two SSE
connections — legitimate only in tests; hosts build exactly one.

Below the client, **no 401 code exists at all** — the retry hook handles it:

- `makeHttpStorage`: `http.get/put/delete/post` → `HttpTransportError` →
  `StorageError` with `cause`; `status === 404` → `null`/`false`; other
  non-ok → `StorageError` with the status; `body.value` through the existing
  `parseValue` (Zod). No try/catch, no error-mapping chains.
- `makeWidgetApi`: drops its `fetch` option and hand-rolled headers; parses
  its `{ data } / { error }` envelope from `HttpResponse.body`.
- `fetchServerTime` (`http-time.ts`): same port, keeps its `TimeError`
  mapping.

### 3.4 Composition roots

The board's is one module:

```ts
// packages/client/src/runtime.ts
const relogin = makeReloginModel() // the app's single relogin instance

export const http = new HttpClient({
  onResponse: [makeUnauthorizedRetryHook(relogin.ensureSession)],
}) // devices-http, account models (via UI wiring), and the runtime below

export const hostRuntime = makeHostRuntime({
  http, // ONE hooked client per document — the app's only 401-healing path
})
```

- `WidgetFrame` calls `hostRuntime.makeWidgetStorage` / `.makeWidgetApi`
  instead of the deleted free factories.
- `board/storage.ts` — a binding module deliberately **outside** `model/`:
  `rootStorage = hostRuntime.makeScopedStorage('root')`. With the binding
  there, the rule "nothing under `model/` imports `runtime.ts`" holds
  absolutely and stays mechanically greppable; `board/model/board-storage.ts`
  imports the binding, never the root.
- Standalone widget harnesses build their own bare `makeHostRuntime()`: no
  handler, 401s flow through unchanged, nothing auth-shaped exists there.
- The activation app's root builds one bare `new HttpClient()` for its two
  models — no retry hook: activation **is** the login surface.

No bootstrap mutation and no init-order requirement: the binding is
declarative at module init and the calls are lazy. `relogin.ts` constructs
its own bare `HttpClient` (3.1) rather than importing one from `runtime.ts`,
which keeps the import graph acyclic: `runtime.ts` → `relogin.ts`, never
back. Instance ownership follows the same direction: `relogin.ts` exports
only the factory — `runtime.ts` builds the single instance (no module
singleton in the model), and models take `http` as a **required** dep passed
by the UI wiring; a model module never imports `runtime.ts`.

### 3.5 SSE reconnect (`sse-client.ts`)

The manager opens its stream through the runtime's `OpenEventStream` port.
On a fatal `onError` it simply reconnects after a fixed 2 s delay, forever —
**no re-auth hook** (2026-07-08 second-pass revision). The connect attempt
itself is the probe: a dead session means the gate answers non-200 → fatal
close → next attempt in 2 s; a probe call before connecting would ask the
same server the same question twice, and running a WebAuthn ceremony from a
background timer would pop a passkey prompt with no user gesture. Session
healing lives in exactly one place — the shared client's 401 retry hook —
and once any board-driven request heals the session, the loop's next attempt
connects and re-registers every desired key. Known residual, accepted: a
timer-driven widget fetch after absolute-TTL expiry still reaches the
ceremony through the retry hook without a gesture; sliding TTL makes that a
once-per-absolute-TTL event. The client-side auth SSE (device A —
`connectEvents` in the account model) consumes the same `OpenEventStream`
port, also without re-auth: it lives only while the devices dialog is open,
and every action in that dialog goes through the retry-hooked client.

### 3.6 `devices-http.ts` (client)

The hand-rolled `request<T>` helper and its `fetchImpl: typeof fetch`
threading (ten exported functions, dozens of `as unknown as typeof fetch`
test casts) collapse onto the port: functions take `http: HttpClient` (the
board's retry-hooked instance from 3.4), so the previously planned manual
`ensureSession`-and-retry code disappears here entirely. `DeviceHttpError`
maps from `HttpTransportError`; `DeviceApiError` from non-2xx statuses —
now robust to bare-bodied nginx 401s (3.2). Exception: `logout()` goes
through a bare client — a dead session is already logged out; prompting a
WebAuthn ceremony in order to log out would be absurd.

### 3.7 Activation models

`activation-model.ts` and `add-device-model.ts` drop their duplicated
`postJson`/`getJson`/`JsonResult` helpers and their `fetchImpl: typeof
fetch` deps for `http: HttpClient` (the bare instance from 3.4). `navigate`
switches to the shared `Navigate` type. WebAuthn ceremony injection stays
as is. Tests hand in a fake port object (`{ status, ok, body }` values)
instead of `Response` mocks behind `as unknown as typeof fetch`.

### 3.8 Logout (account model)

`logout()`: `POST /api/auth/logout` → `purgeLocalData()` (new widget-runtime
storage export — deletes its Dexie databases; `client/db.ts` knows the names)
→ delete all Cache Storage caches → unregister all service workers →
`navigate('/')`. Order matters: server-side invalidation first, so a
failed purge cannot leave a live session. `mb_cred_hint` in localStorage is
kept — a non-secret hint that speeds up return login.

### 3.9 BroadcastChannel port (last task, cuttable)

`storage/client/channel.ts`'s module-singleton `BroadcastChannel` shows the
same missing-port symptom: a `FakeBroadcastChannel` + `vi.stubGlobal` in
widget-runtime tests and jsdom polyfills duplicated across two vitest
setups. A small broadcast port owned by `makeHostRuntime` (option with a
native-`BroadcastChannel` default) retires the global fakes. Purely internal
to widget-runtime and independent of the gate — scheduled last so it can be
cut without touching anything else in this plan.

## 4. Ops scripts and infrastructure

**Ops scripts** (`packages/server/scripts/`, following the `create-invite`
shape: `*.ts` logic with unit tests on `memory-ops`, `*.cli.ts` entry compiled
into the image; each registered as an `rpi.toml` `[commands]` entry like the
existing `create-invite`, so the normal invocation is `rpi command <name> --
<args>` from the dev machine — `docker compose exec server node
dist/scripts/<name>.cjs` stays the on-Pi fallback):

- `list-devices` — all accounts with their devices: id, label, status,
  createdAt, lastSeenAt, disabled marker.
- `revoke-device --credential-id <id>` — deletes the device **and all its
  sessions** (reuses the same logic in `auth/devices.ts` that immediate
  revocation relies on; no duplication).
- `revoke-invite --id <id>` — kills a live invite.
- `revoke-account --account <id>` — deletes the account, all its devices, and
  their sessions.
- `mint-add-device-token --account <id>` — the stranded-user recovery path:
  mints an add-device code for an existing account (identity preserved),
  prints `${PUBLIC_APP_URL}/add-device?token=…` and the bare code.

Each script prints a human-readable result and exits non-zero on failure
(errore pattern inside).

**docker-compose / env.** The server service gains the production env values:
`RP_ID`, `RP_NAME`, `PUBLIC_APP_URL`, `EXPECTED_ORIGIN`, `SESSION_*`,
`TRUST_CF_CONNECTING_IP` — all already read by the config since Plan 1; only
the wiring is new. `.env.example` is already complete.

**rpi.toml.** Three changes:

- `ingress.hostname = "board.iiskelo.com"` — the public route for the user's
  Cloudflare Tunnel (the tunnel itself is the user's manual step).
- `[commands]` entries for the five ops scripts (table form,
  `service = "server"`) plus `[commands.backup]` (`service = "valkey"`):
  `valkey-cli SAVE` and a dated `dump.rdb` copy into `/data/backups` inside
  the `valkey_data` volume — a logical backup that survives `FLUSHDB` and bad
  deploys (files are not keys), though not volume deletion.
- `healthcheck`: with the gate, `/` answers 401 (activation page). Set
  `path = "/"`, `expect = "401"` — deliberately: the health probe exercises
  the whole nginx → auth_request → server → Valkey chain **and** asserts the
  door is locked. If the gate ever disappears, `/` returns 200 and the deploy
  fails as unhealthy — a built-in tripwire.

**Docs.** A short deployment section: creating the first invite on the Pi,
recovering access (`mint-add-device-token`), reading the audit log.

## 5. Testing

**Server unit (Vitest, `memory-ops`).** CSRF guard: mutating `/api/*` without
the header → 403, with it → passes; GET and `/api/test/*` exempt. Audit: every
event fires through an injected sink as a JSON line; tokens/challenges never
leak into output. Ops scripts: device revocation kills its sessions,
`revoke-account` cascades, `mint-add-device-token` yields a valid code.

**shared http unit.** `HttpClient`: errore semantics (network →
`HttpTransportError`; non-2xx → value; non-JSON body on a non-2xx →
`body: undefined` with status preserved; broken JSON on a 2xx → error);
CSRF header on mutating methods only; `makeUnauthorizedRetryHook` → exactly
one forced retry including `POST`, no retry when the handler returns
`false` or is absent; ky auto-retries and timeout stay off. Event stream:
named events forwarded, `close()` stops delivery.

**widget-runtime unit.** Each test builds its own
`makeHostRuntime({ http: fakeHttpClient, openEventStream: fakeStream })`
— isolation by construction, no global set/reset and no `vi.stubGlobal`.
Cases: storage mapping over the port (404 → `null`/`false`, transport error
→ `StorageError` with cause, other non-ok → `StorageError` with status,
`body.value` Zod-validated); `makeWidgetApi` envelope parsing over
`HttpResponse.body`; the default internal client is bare. SSE: fatal error →
reconnect after 2 s → desired keys re-registered on the fresh connection.
`purgeLocalData` deletes the Dexie databases.

**Client unit.** Relogin model: single-flight (N parallel calls → one
ceremony), probe-200 → no ceremony, probe-401 → ceremony → `true`, failure →
hard-navigate to `/activate/` (injected `Navigate`). Logout: server → purge → caches → SW →
redirect order on fakes; logout uses the bare client. `devices-http` and the
activation models: fake `HttpClient` ports instead of `Response` mocks; a
bare-bodied 401 maps to `DeviceApiError`, not a transport error.

**nginx suite (`test:e2e:nginx`).** No cookie: `/` → 401 with activation HTML;
`/assets/*.js`, `/widgets/*/remoteEntry.js`, `/api/storage/*` → bare 401
without an HTML body; `/activate/` statics and `/add-device` → 200;
`/api/auth/session` reachable (allowlist). With a seeded session cookie (via
`/api/test/*`): `/`, assets, storage → 200. Rate limit: a burst over 30/min on
`/api/auth/*` → 429 while `pending-status` lives under its own limit. CSRF
through nginx: `PUT /api/storage/*` with a cookie but no header → 403.

**Gated e2e (Playwright + CDP virtual authenticator, dockerized nginx
stack).**

- Full journey: seed invite → `/activate` → register → board loads (assets
  through the gate) → reload stays in → logout → activation shown, local data
  purged → passkey login → board again.
- Silent re-login: with the board open, kill the session server-side (test
  endpoint) → next storage operation → ceremony with the virtual
  authenticator → data flows **without a page reload**.
- Revocation: revoke the device → next request → re-login fails
  (`login/verify` rejected) → hard-navigate to `/activate/` (the SW-proof
  target) with the activation page visible.
- The existing `pnpm test:e2e` (vite preview, no nginx) is untouched — the
  gate lives only in the nginx image.

## Delivery order (each step stays green)

1. **Server hardening + ops scripts** — gate-independent: CSRF guard, audit
   log, the five scripts, unit tests.
2. **Client resilience** — the `@shared/http` ports (`HttpClient` over ky,
   `EventStream`), `makeHostRuntime` in widget-runtime, the
   board/harness/activation composition roots, `devices-http` and activation
   migration to the ports, relogin model, SSE reconnect, logout purge.
   Dormant until 401s actually happen; fully unit-tested.
3. **The gate** — nginx `auth_request` + allowlist + `error_page 401` +
   `limit_req`, compose env, `rpi.toml`, nginx suite. The door closes here.
4. **Gated e2e + docs** — the journeys above; deployment doc.

The client learns to survive 401s (step 2) **before** the door closes
(step 3), so enabling the gate cannot strand an open board.
