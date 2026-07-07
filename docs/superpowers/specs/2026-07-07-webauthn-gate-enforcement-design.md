# WebAuthn Gate Enforcement (Plan 3) Design

**Date:** 2026-07-07
**Status:** Approved
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
- Silent re-login on 401 in the widget-runtime HTTP backend (via ky) + SSE
  re-auth + logout purge of local data.
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
- **Adopt ky** (sindresorhus/ky) as the HTTP client in the widget-runtime
  storage backend, using its hooks for the 401 re-login retry and the CSRF
  header, and its Zod-validating `.json(schema)`. The client's `devices-http`
  stays on plain `fetch` with a direct `ensureSession` retry (one retry does
  not justify the dependency). The 401 handler slot is a Reatom config atom
  (`unauthorizedHandlerAtom`), not a module setter — see 3.2.
  **Future work (explicitly out of Plan 3):** migrate the rest of the app
  (activation app, `devices-http`, `http-time`, remaining `fetch` call sites)
  to ky in a later app-wide refactor.

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
(immediate revocation), and refreshes the sliding TTL.

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
uniform rule is simpler than per-namespace exceptions.

**Audit log.** New `auth/audit.ts`: `audit(event, fields)` writes one JSON
line to stdout. Events: `register`, `register_failed`, `login`,
`login_failed`, `logout`, `device_pending`, `device_approved`,
`device_denied`, `device_revoked`, `invite_locked`, `addtoken_minted`.
Fields: `ts`, `event`, `accountId`/`credentialId`/`inviteId` (when known),
`ip`, `ua`, and the error code on failures. The IP helper honors
`TRUST_CF_CONNECTING_IP=1` → `CF-Connecting-IP`, else `X-Real-IP` (set by
nginx), else the socket address. The logger is a dependency in `AuthDeps`;
tests swap it and assert events fire and that tokens/challenges never appear
in output.

Everything else on the parent spec's hardening list already shipped in
Plans 1–2: per-invite/per-code failed-attempt locks, immediate revocation in
`verifySession`, `__Host-` cookies, sign-counter clone detection.

## 3. Client: silent re-login, SSE, logout

### 3.1 `packages/client/src/session/model/relogin.ts` — all logic, pure Reatom

Reatom action `ensureSession(): Promise<boolean>`:

- **Single-flight** via an atom `reloginPromise: Atom<Promise<boolean> | null>`:
  if a promise is already in flight, return it; otherwise start the chain and
  store its promise. Ten parallel 401s → one ceremony. (Continuations after
  `await` use pre-created `wrap()` closures per the reatom rules.)
- Chain: **probe** `GET /api/auth/session`. `200` → return `true` with no
  ceremony (session is alive; the failure was not auth). `401` → ceremony:
  `POST /api/auth/login/options` → `navigator.credentials.get()` →
  `POST /api/auth/login/verify` → `true`.
- Any failure or ceremony cancel → `location.assign('/')` (the gate serves
  activation in login mode) and `false`. `location` is an injected dependency
  for tests.
- The probe buys two properties: SSE can call `ensureSession` on any connect
  error without knowing the status (network blip → probe 200 → no biometric
  prompt), and for HTTP 401s it confirms the failure is session-level.

### 3.2 ky instance in widget-runtime — knows nothing about auth

`packages/widget-runtime/src/storage/server/http.ts` exports a `ky.create`
instance used by `makeHttpStorage` (all methods) and the SSE subscribe
`POST /events/:connId`:

- `throwHttpErrors` stays **on** (ky default). `makeHttpStorage` moves to
  ky-idiomatic chains with **no try/catch** — errors map to errore values in
  a single `.catch()` point:

  ```ts
  const body = await http.get(keyUrl(fullKey))
    .json(z.object({ value: schema ?? z.unknown() }))
    .catch(mapStorageError)
  ```

  `mapStorageError`: `HTTPError` 404 → `null` (for `get`/`has`), other
  `HTTPError` → `StorageError` with the status, `SchemaValidationError` →
  `StorageError` with the Zod issues (free response validation — today only
  `body.value` is checked), network errors → `StorageError` with `cause`.
- `hooks.beforeRequest`: sets `X-Requested-With: MyBoard` on mutating methods.
- `hooks.afterResponse`: on `401` with a registered handler and
  `retryCount === 0` → `await handler()`; `true` → `return ky.retry(...)`
  (exactly one forced retry); `false` or no handler → the 401 flows through.
  `afterResponse` runs before `HTTPError` is thrown, so this works with
  `throwHttpErrors` on.
- **Automatic retries are disabled** (ky defaults to 2 retries on 408/429/5xx
  for idempotent methods): today's storage semantics have no retries and must
  not change silently. Only the forced `ky.retry` path is used.
  Implementation-time check: a test must prove the forced retry fires with
  auto-retries disabled and for `POST` (append, subscribe) — ky auto-retries
  skip POST, but the `afterResponse` force path is method-independent.

The handler slot is a **Reatom config atom** exported next to the instance
(2026-07-07 revision — replaces the earlier `setUnauthorizedHandler` module
registry, rejected as hidden mutable module state):

```ts
export const unauthorizedHandlerAtom = atom<null | (() => Promise<boolean>)>(
  null,
  'http.unauthorizedHandler',
)
```

Process-wide config expressed as process-wide state: Reatom is already a hard
dependency and federation singleton of widget-runtime, reading the atom from
non-reactive spots (the ky hook) is well-defined in v1001 (global context),
tests set/reset it like any state, and future UI (a "session lost" indicator)
can subscribe to it. Alternatives rejected: threading an `onUnauthorized`
option through `makeWidgetStorage`/`makeWidgetApi`/`getSseManager` degrades to
first-caller-wins at the SSE singleton anyway (false explicitness); an event
emitter cannot return the required `Promise<boolean>` without reinventing
`respondWith`; a reactive auth-state machine hangs in standalone harnesses
where no effect answers the `recovering` state.

New dependency: `ky` (~4 KB, ESM, zero deps) in `widget-runtime` only.

### 3.3 Board bootstrap

One line at board-shell startup:
`unauthorizedHandlerAtom.set(() => ensureSession())`. Standalone widget
harnesses touch nothing — the atom stays `null` and 401s flow through
unchanged.

### 3.4 SSE reconnect (`sse-client.ts`)

On an `EventSource` `error`, before the next reconnect attempt: if
`unauthorizedHandlerAtom` holds a handler — `await handler()` (the probe
inside distinguishes network from session), then reconnect on the existing
backoff. Mid-stream expiry heals on the next reconnect, exactly as the parent
spec requires. The client-side auth SSE (device A) reuses the same approach
with a direct `ensureSession` import.

### 3.5 `devices-http.ts` (client)

Stays on plain `fetch` (no ky in the client — one retry does not justify the
dependency): on a 401 response it awaits a direct `ensureSession` import and
retries the request once.

### 3.6 Logout (account model)

`logout()`: `POST /api/auth/logout` → `purgeLocalData()` (new widget-runtime
storage export — deletes its Dexie databases; `client/db.ts` knows the names)
→ delete all Cache Storage caches → unregister all service workers →
`location.assign('/')`. Order matters: server-side invalidation first, so a
failed purge cannot leave a live session. `mb_cred_hint` in localStorage is
kept — a non-secret hint that speeds up return login.

## 4. Ops scripts and infrastructure

**Ops scripts** (`packages/server/scripts/`, following the `create-invite`
shape: `*.ts` logic with unit tests on `memory-ops`, `*.cli.ts` entry compiled
into the image, run via `docker compose exec server node dist/scripts/<name>.cjs`):

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

**rpi.toml.** Two changes:

- `ingress.hostname = "board.iiskelo.com"` — the public route for the user's
  Cloudflare Tunnel (the tunnel itself is the user's manual step).
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

**widget-runtime unit.** ky instance: 401 → handler → exactly one forced retry
(including `POST` append/subscribe); no handler → 401 flows through;
auto-retries disabled; `X-Requested-With` on mutations; `.json(schema)` error
mapping (404 → `null`, `SchemaValidationError` → `StorageError` with issues,
network → `StorageError` with cause). SSE: connect error → handler →
reconnect. `purgeLocalData` deletes the Dexie databases.

**Client unit.** Relogin model: single-flight (N parallel calls → one
ceremony), probe-200 → no ceremony, probe-401 → ceremony → `true`, failure →
redirect (injected `location`). Logout: server → purge → caches → SW →
redirect order on fakes. `devices-http`: retry on 401.

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
  (`login/verify` rejected) → redirect to activation.
- The existing `pnpm test:e2e` (vite preview, no nginx) is untouched — the
  gate lives only in the nginx image.

## Delivery order (each step stays green)

1. **Server hardening + ops scripts** — gate-independent: CSRF guard, audit
   log, the five scripts, unit tests.
2. **Client resilience** — ky in widget-runtime + `devices-http`, relogin
   model, SSE re-auth, logout purge. Dormant until 401s actually happen;
   fully unit-tested.
3. **The gate** — nginx `auth_request` + allowlist + `error_page 401` +
   `limit_req`, compose env, `rpi.toml`, nginx suite. The door closes here.
4. **Gated e2e + docs** — the journeys above; deployment doc.

The client learns to survive 401s (step 2) **before** the door closes
(step 3), so enabling the gate cannot strand an open board.
