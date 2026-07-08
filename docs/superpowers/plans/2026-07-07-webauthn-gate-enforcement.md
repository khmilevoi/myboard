# WebAuthn Gate Enforcement (Plan 3) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Enable the always-on nginx `auth_request` gate over the board and ship the hardening tail: CSRF guard, audit log, silent 401 re-login via the shared `HttpClient` port, logout purge, five ops scripts, and gate tests.

**Architecture:** nginx gates `/`, `/assets/*`, `/widgets/*`, and `/api/*` (minus a public allowlist) by subrequesting `GET /api/auth/session`; a 401 on navigations serves the activation page. The server adds a router-level CSRF guard and stdout audit logging. Client transport moves to owned ports in `packages/shared/http/`: a `HttpClient` class (ky inside as a swappable adapter, errore values out, CSRF header built in) and an `EventStream` port over `EventSource`. widget-runtime gains a `makeHostRuntime` composition-root factory owning one SSE manager over an injected `HttpClient`; the board’s root (`packages/client/src/runtime.ts`) builds the single-flight Reatom relogin model (WebAuthn re-login ceremony) and the ONE retry-hooked `HttpClient` shared by board models and the runtime (`makeHostRuntime({ http, onUnauthorized })`), harnesses build a bare runtime, and every hand-rolled fetch/EventSource layer (http-storage, widget-api, http-time, devices-http, account device-events SSE, activation) migrates to the ports.

**Tech Stack:** nginx `auth_request`/`limit_req`, ky (new dep in `shared`, hidden behind the `HttpClient` port), `@simplewebauthn/browser`, Reatom v1001, errore, Zod, Vitest, Playwright (CDP virtual authenticator).

**Spec:** `docs/superpowers/specs/2026-07-07-webauthn-gate-enforcement-design.md` (read it first).

## Global Constraints

- errore everywhere: return `Error | T` unions, never throw across boundaries; map external throws in a single `.catch()` point. No `try/catch` in new code (existing `try { JSON.parse }` style stays as-is).
- Reatom rules (load the `reatom` skill): logic in `model/`, continuations after `await` via pre-created `wrap()` closures, actions named (`'relogin.ensureSession'`).
- Every command through `rtk` (e.g. `rtk git add`, `rtk pnpm ...` where applicable).
- UI copy for user-facing surfaces is Russian; this plan adds no new UI surfaces.
- The gate exists **only** in the nginx image. `pnpm dev`, `pnpm test:e2e` (vite preview) stay ungated and must keep passing.
- Transport port invariants: consumers depend on `HttpClient`/`HttpLike` from `@shared/http/client`, never on `fetch` (`typeof fetch` appears ONLY inside the adapter and its options). Errors are values: network failure or broken 2xx JSON → `HttpTransportError`; any non-2xx status → a normal `HttpResponse`; empty/non-JSON body on a non-2xx → `body: undefined`. CSRF header automatic on mutating methods; hooks fixed at construction; exactly one forced replay per request (`ResponseHook` → `'retry'`), and a `'retry'` verdict short-circuits the remaining response hooks for that response (every hook runs again on the replayed one). Inside the adapter ky runs with `throwHttpErrors: false`, `retry: 0`, `timeout: false`.
- One hooked client per document: the board root builds it and passes it both to its models (via UI wiring) and to `makeHostRuntime({ http, ... })`. Bare clients (no retry hook) are a closed list: the relogin model (must never recurse), account logout `bareHttp` (a ceremony to log out is absurd), the activation models (they ARE the login surface), and `fetchServerTime`'s default (a 401 there is a non-fatal `TimeError`).
- Naming: new factories are `make*` (never `create*`); classes are instantiated with `new`. Pre-existing `create*` exports keep their names — renames are out of scope.
- CSRF rule: mutating methods (`POST`/`PUT`/`DELETE`/`PATCH`) on `/api/*` except `/api/test/*` require header `X-Requested-With: MyBoard` → else 403 `{ code: 'csrf_required' }`.
- Run tests per package: `pnpm --filter server exec vitest run <path>`, `pnpm --filter widget-runtime exec vitest run <path>`, `pnpm --filter client exec vitest run <path>`.
- Commit after every task. Do not enable the gate (Task 11) before Tasks 1–10 are green. Tasks 15–16 are post-gate port migrations; Task 16 is cuttable.

---

### Task 1: Server CSRF guard

**Files:**
- Create: `packages/server/src/http/csrf.ts`
- Create: `packages/server/src/http/csrf.test.ts`
- Modify: `packages/server/src/app.ts` (the `createServer` callback, ~line 375)
- Modify: `packages/server/src/app.test.ts` (add the header to mutating non-`/api/test/` fetches; new 403 test)
- Modify: `packages/client/e2e/auth-activation.spec.ts:50` (add the header)

**Interfaces:**
- Produces: `csrfBlocked(req: Pick<IncomingMessage, 'method' | 'url' | 'headers'>): boolean` — `true` when the request must be rejected with 403.

- [ ] **Step 1: Write the failing test**

`packages/server/src/http/csrf.test.ts`:

```ts
import { describe, expect, it } from 'vitest'

import { csrfBlocked } from './csrf'

const req = (method: string, url: string, header?: string) => ({
  method,
  url,
  headers: header === undefined ? {} : { 'x-requested-with': header },
})

describe('csrfBlocked', () => {
  it('blocks mutating /api requests without the header', () => {
    expect(csrfBlocked(req('POST', '/api/storage/k/append'))).toBe(true)
    expect(csrfBlocked(req('PUT', '/api/storage/k'))).toBe(true)
    expect(csrfBlocked(req('DELETE', '/api/storage/k'))).toBe(true)
    expect(csrfBlocked(req('POST', '/api/auth/logout'))).toBe(true)
  })

  it('passes mutating /api requests with the exact header', () => {
    expect(csrfBlocked(req('POST', '/api/storage/k/append', 'MyBoard'))).toBe(false)
    expect(csrfBlocked(req('PUT', '/api/storage/k', 'MyBoard'))).toBe(false)
  })

  it('rejects a wrong header value', () => {
    expect(csrfBlocked(req('POST', '/api/auth/logout', 'Other'))).toBe(true)
  })

  it('ignores reads and non-api paths', () => {
    expect(csrfBlocked(req('GET', '/api/storage/k'))).toBe(false)
    expect(csrfBlocked(req('HEAD', '/api/storage/k'))).toBe(false)
    expect(csrfBlocked(req('POST', '/healthz'))).toBe(false)
  })

  it('exempts /api/test/*', () => {
    expect(csrfBlocked(req('POST', '/api/test/reset'))).toBe(false)
    expect(csrfBlocked(req('POST', '/api/test/seed-invite'))).toBe(false)
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm --filter server exec vitest run src/http/csrf.test.ts`
Expected: FAIL — `csrf.ts` does not exist.

- [ ] **Step 3: Implement**

`packages/server/src/http/csrf.ts`:

```ts
import type { IncomingMessage } from 'node:http'

const MUTATING_METHODS = new Set(['POST', 'PUT', 'DELETE', 'PATCH'])
const CSRF_HEADER = 'x-requested-with'
const CSRF_VALUE = 'MyBoard'

/**
 * Router-level CSRF check: mutating /api requests must carry the custom
 * header only same-origin app code sets. /api/test/* is exempt (dead in
 * production without ALLOW_TEST_DB_RESET=1; keeps e2e seeding helpers plain).
 */
export function csrfBlocked(req: Pick<IncomingMessage, 'method' | 'url' | 'headers'>): boolean {
  if (!MUTATING_METHODS.has(req.method ?? '')) return false
  const url = req.url ?? ''
  if (!url.startsWith('/api/')) return false
  if (url.startsWith('/api/test/')) return false
  return req.headers[CSRF_HEADER] !== CSRF_VALUE
}
```

In `packages/server/src/app.ts`, import it and wrap the router dispatch (the existing `createServer` callback):

```ts
import { csrfBlocked } from './http/csrf'
// ...
const server = createServer((req, res) => {
  if (csrfBlocked(req)) {
    res.writeHead(403, { 'content-type': 'application/json' })
    res.end(JSON.stringify({ code: 'csrf_required' }))
    return
  }
  Promise.resolve(router.lookup(req, res)).catch(() => {
    if (!res.writableEnded) {
      res.writeHead(500)
      res.end()
    }
  })
})
```

- [ ] **Step 4: Update existing callers that now need the header**

`packages/server/src/app.test.ts` drives the real server with raw `fetch`. Every **mutating** call that is **not** under `/api/test/` needs the header. Example for the PUT at ~line 133:

```ts
const put = await fetch(`${base}/api/storage/${DEBTS_KEY}`, {
  method: 'PUT',
  headers: { 'content-type': 'application/json', 'X-Requested-With': 'MyBoard' },
  body: JSON.stringify({ value: [] }),
})
```

Apply the same `'X-Requested-With': 'MyBoard'` addition to every `fetch(..., { method: 'POST' | 'PUT' | 'DELETE' ... })` in the file whose path starts with `/api/` but not `/api/test/` (the `/api/widgets/...` and `/api/storage/...` calls). Then add a regression test in the same file:

```ts
it('rejects a mutating /api request without the CSRF header', async () => {
  const res = await fetch(`${base}/api/storage/${DEBTS_KEY}`, {
    method: 'PUT',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ value: [] }),
  })
  expect(res.status).toBe(403)
  expect(await res.json()).toEqual({ code: 'csrf_required' })
})
```

In `packages/client/e2e/auth-activation.spec.ts` (~line 50) add the header:

```ts
const spentOptions = await page.request.post('/api/auth/register/options', {
  headers: { 'X-Requested-With': 'MyBoard' },
  data: { token },
})
```

- [ ] **Step 5: Run the affected suites**

Run: `pnpm --filter server exec vitest run src/http/csrf.test.ts src/app.test.ts`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
rtk git add packages/server/src/http/csrf.ts packages/server/src/http/csrf.test.ts packages/server/src/app.ts packages/server/src/app.test.ts packages/client/e2e/auth-activation.spec.ts
rtk git commit -m "feat(server): CSRF guard - mutating /api requires X-Requested-With"
```

---

### Task 2: Audit log

**Files:**
- Create: `packages/server/src/auth/audit.ts`
- Create: `packages/server/src/auth/audit.test.ts`
- Modify: `packages/server/src/auth/handlers.ts` (AuthDeps + register/login/logout events)
- Modify: `packages/server/src/auth/device-handlers.ts` (device events)
- Modify: `packages/server/src/auth/index.ts` (`RegisterAuthRoutesDeps` passthrough)
- Modify: `packages/server/src/app.ts` (inject the logger)
- Modify: `packages/server/src/auth/handlers.test.ts`, `packages/server/src/auth/device-handlers.test.ts` (event assertions)

**Interfaces:**
- Produces:
  - `type AuditEventName = 'register' | 'register_failed' | 'login' | 'login_failed' | 'logout' | 'device_pending' | 'device_approved' | 'device_denied' | 'device_revoked' | 'invite_locked' | 'addtoken_minted'`
  - `type AuditEvent = { event: AuditEventName; accountId?: string; credentialId?: string; inviteId?: string; code?: string; ip?: string | null; ua?: string }`
  - `type AuditLogger = (event: AuditEvent) => void`
  - `makeAuditLogger(write?: (line: string) => void): AuditLogger` — one JSON line per event with an ISO `ts` prepended.
  - `noopAudit: AuditLogger` — the null object for hosts that don't audit; handler code never null-checks.
  - `auditIp(req: Pick<IncomingMessage, 'headers' | 'socket'>, config: AuthConfig): string | null` — `CF-Connecting-IP` when `config.trustCfConnectingIp`, else `clientIp(req)`.
  - `uaOf(req: Pick<IncomingMessage, 'headers'>): { ua?: string }` — audit-payload helper, lives next to `auditIp`.
  - `AuthDeps` gains **required** `audit: AuditLogger`; the optionality lives only at the boundary — `RegisterAuthRoutesDeps` takes `audit?` and fills it with `?? noopAudit`.

- [ ] **Step 1: Write the failing test**

`packages/server/src/auth/audit.test.ts`:

```ts
import { describe, expect, it, vi } from 'vitest'

import type { AuthConfig } from './config'
import { auditIp, makeAuditLogger } from './audit'

const baseConfig = { trustCfConnectingIp: false } as AuthConfig

describe('makeAuditLogger', () => {
  it('writes one JSON line with ts and the event fields', () => {
    const write = vi.fn()
    const audit = makeAuditLogger(write)
    audit({ event: 'login', accountId: 'a1', credentialId: 'c1', ip: '1.2.3.4', ua: 'UA' })

    expect(write).toHaveBeenCalledTimes(1)
    const parsed = JSON.parse(write.mock.calls[0][0] as string)
    expect(parsed).toMatchObject({
      event: 'login',
      accountId: 'a1',
      credentialId: 'c1',
      ip: '1.2.3.4',
      ua: 'UA',
    })
    expect(typeof parsed.ts).toBe('string')
    expect(Number.isNaN(Date.parse(parsed.ts))).toBe(false)
  })
})

describe('auditIp', () => {
  const req = (headers: Record<string, string>) =>
    ({ headers, socket: { remoteAddress: '10.0.0.9' } }) as never

  it('ignores CF-Connecting-IP unless trusted', () => {
    expect(auditIp(req({ 'cf-connecting-ip': '203.0.113.7' }), baseConfig)).toBe('10.0.0.9')
  })

  it('uses CF-Connecting-IP when trusted', () => {
    const config = { ...baseConfig, trustCfConnectingIp: true } as AuthConfig
    expect(auditIp(req({ 'cf-connecting-ip': '203.0.113.7' }), config)).toBe('203.0.113.7')
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm --filter server exec vitest run src/auth/audit.test.ts`
Expected: FAIL — `audit.ts` does not exist.

- [ ] **Step 3: Implement `audit.ts`**

```ts
import type { IncomingMessage } from 'node:http'

import { clientIp } from '../http/client-ip'
import type { AuthConfig } from './config'

export type AuditEventName =
  | 'register'
  | 'register_failed'
  | 'login'
  | 'login_failed'
  | 'logout'
  | 'device_pending'
  | 'device_approved'
  | 'device_denied'
  | 'device_revoked'
  | 'invite_locked'
  | 'addtoken_minted'

export type AuditEvent = {
  event: AuditEventName
  accountId?: string
  credentialId?: string
  inviteId?: string
  code?: string
  ip?: string | null
  ua?: string
}

export type AuditLogger = (event: AuditEvent) => void

/** One structured JSON line per auth event, read via `docker compose logs server`. */
export function makeAuditLogger(write: (line: string) => void = console.log): AuditLogger {
  return (event) => write(JSON.stringify({ ts: new Date().toISOString(), ...event }))
}

/** Null object for hosts that don't audit — handler code never null-checks. */
export const noopAudit: AuditLogger = () => {}

/** Audit-payload helper: include `ua` only when the request carries one. */
export function uaOf(req: Pick<IncomingMessage, 'headers'>): { ua?: string } {
  return req.headers['user-agent'] ? { ua: req.headers['user-agent'] } : {}
}

/** Real client IP for audit: CF header only behind the trusted tunnel. */
export function auditIp(
  req: Pick<IncomingMessage, 'headers' | 'socket'>,
  config: AuthConfig,
): string | null {
  if (config.trustCfConnectingIp) {
    const cf = req.headers['cf-connecting-ip']
    const value = Array.isArray(cf) ? cf[0] : cf
    if (value) return value
  }
  return clientIp(req)
}
```

- [ ] **Step 4: Wire `audit` into AuthDeps and emit events**

In `packages/server/src/auth/handlers.ts`:

1. Add to imports: `import { auditIp, uaOf, type AuditLogger } from './audit'` and add `InviteLockedError` to the existing `./errors` import.
2. Extend the deps type (`audit` is **required** — the null object lives at the boundary, see `index.ts` below):

```ts
export type AuthDeps = {
  ops: ValkeyOps
  config: AuthConfig
  now: () => number
  audit: AuditLogger
}
```

3. (`uaOf` comes from `./audit` — no local helper.)

4. `postRegisterVerify`: extend the `fail` closure and the success return:

```ts
const fail = async (err: Error): Promise<AuthResult> => {
  await recordInviteFailure(deps.ops, deps.now, token)
  deps.audit({
    event: err instanceof InviteLockedError ? 'invite_locked' : 'register_failed',
    code: err.name,
    ip: auditIp(req, deps.config),
    ...uaOf(req),
  })
  return toAuthResult(err)
}
```

In the `addResult instanceof Error` rollback branch, before `return toAuthResult(addResult)` add:

```ts
deps.audit({
  event: 'register_failed',
  code: addResult.name,
  ip: auditIp(req, deps.config),
  ...uaOf(req),
})
```

Immediately before the final success `return { status: 200, ... }` add:

```ts
deps.audit({
  event: 'register',
  accountId: account.id,
  credentialId: verified.credentialId,
  inviteId: invite.id,
  ip: auditIp(req, deps.config),
  ...uaOf(req),
})
```

5. `postLoginVerify`: at the two failure exits and the success exit:

```ts
if (challenge instanceof Error) {
  deps.audit({ event: 'login_failed', code: challenge.name, ip: auditIp(req, deps.config), ...uaOf(req) })
  return toAuthResult(challenge)
}
// ...
if (result instanceof Error) {
  deps.audit({ event: 'login_failed', credentialId, code: result.name, ip: auditIp(req, deps.config), ...uaOf(req) })
  return toAuthResult(result)
}
// ... before the success return:
deps.audit({ event: 'login', accountId: device.accountId, credentialId, ip: auditIp(req, deps.config), ...uaOf(req) })
```

6. `postLogout`: before the return:

```ts
deps.audit({ event: 'logout', ip: auditIp(req, deps.config), ...uaOf(req) })
```

In `packages/server/src/auth/device-handlers.ts`, using the same `auditIp`/`deps.audit` pattern (import `auditIp` and `uaOf` from `./audit`), emit immediately before each success return, with the account/credential ids that are in scope in that function:

- `postAddToken` → `{ event: 'addtoken_minted', accountId: <the session's accountId> }`
- `postDeviceRegisterVerify` → `{ event: 'device_pending', accountId, credentialId: <the new pending device id> }`
- `postApproveDevice` → `{ event: 'device_approved', accountId: <session accountId>, credentialId: <params.credentialId> }`
- `postDenyDevice` → `{ event: 'device_denied', accountId, credentialId }`
- `postRevokeDevice` → `{ event: 'device_revoked', accountId, credentialId }`

All device events also get `ip: auditIp(req, deps.config)` and `...uaOf(req)` (both from `./audit`).

In `packages/server/src/auth/index.ts`: add `audit?: AuditLogger` to `RegisterAuthRoutesDeps` (type import from `./audit`), destructure it as `audit = noopAudit` (value import of `noopAudit` from `./audit`), and include it in the local `authDeps` — handlers always receive a real function.

In `packages/server/src/app.ts`: add `audit?: AuditLogger` to `AppDeps` (type import from `./auth/audit`), and change the deps construction:

```ts
import { makeAuditLogger, type AuditLogger } from './auth/audit'
// ...
const audit = deps.audit ?? makeAuditLogger()
const authDeps = { ops, config: deps.authConfig, now, audit }
```

(`registerAuthRoutes({ router, ...authDeps })` then carries it automatically.)

- [ ] **Step 5: Extend handler tests**

In `packages/server/src/auth/handlers.test.ts`, inside the existing test setup add `audit: vi.fn()` to the deps object the file already builds (the dep is required now — every fixture that constructs `AuthDeps` needs it, `device-handlers.test.ts` included), and add two tests following the file's existing arrange/act style:

```ts
it('audits a successful login', async () => {
  // arrange: the file's existing happy-path login fixture
  // act: await postLoginVerify(deps, req)
  expect(deps.audit).toHaveBeenCalledWith(
    expect.objectContaining({ event: 'login', credentialId: expect.any(String) }),
  )
  // No secrets in the event payload:
  const events = (deps.audit as ReturnType<typeof vi.fn>).mock.calls.map((c) => c[0])
  for (const event of events) {
    expect(JSON.stringify(event)).not.toMatch(/challenge|token/i)
  }
})

it('audits a failed login as login_failed', async () => {
  // arrange: the file's existing stale/foreign-challenge fixture
  expect(deps.audit).toHaveBeenCalledWith(expect.objectContaining({ event: 'login_failed' }))
})
```

In `packages/server/src/auth/device-handlers.test.ts` add one assertion to the existing approve happy-path test:

```ts
expect(deps.audit).toHaveBeenCalledWith(
  expect.objectContaining({ event: 'device_approved', credentialId: pendingDeviceId }),
)
```

- [ ] **Step 6: Run the suites**

Run: `pnpm --filter server exec vitest run src/auth`
Expected: PASS (fixtures updated with `audit: vi.fn()` — the dep is required, the null object lives only at the `registerAuthRoutes` boundary).

- [ ] **Step 7: Commit**

```bash
rtk git add packages/server/src/auth packages/server/src/app.ts
rtk git commit -m "feat(auth): stdout audit log for auth events"
```

---

### Task 3: Ops scripts — list-devices, revoke-device

**Files:**
- Create: `packages/server/scripts/list-devices.ts`, `packages/server/scripts/list-devices.cli.ts`, `packages/server/scripts/list-devices.test.ts`
- Create: `packages/server/scripts/revoke-device.ts`, `packages/server/scripts/revoke-device.cli.ts`, `packages/server/scripts/revoke-device.test.ts`
- Modify: `packages/server/rspack.config.ts` (two new `scripts/*` entries)

**Interfaces:**
- Consumes: `listAllDeviceCredentialIds`, `getDevice`, `revokeDevice` from `../src/auth/devices`; `getAccount` from `../src/auth/accounts`; `createMemoryOps`, `createMemoryPubSub` from `../src/test/memory-ops` (tests).
- Produces: `runListDevices(ops: ValkeyOps): Promise<DeviceListing[]>` where `DeviceListing = { accountId: string; accountName: string; devices: Array<{ credentialId: string; label: string; status: 'active' | 'pending'; disabled: boolean; createdAt: string; lastSeenAt: string }> }`; `runRevokeDevice(ops: ValkeyOps, credentialId: string): Promise<{ accountId: string } | DeviceNotFoundError | Error>`.

- [ ] **Step 1: Write the failing tests**

`packages/server/scripts/list-devices.test.ts`:

```ts
import { describe, expect, it } from 'vitest'

import { createAccount } from '../src/auth/accounts'
import { storeDevice } from '../src/auth/devices'
import { createMemoryOps, createMemoryPubSub } from '../src/test/memory-ops'
import { runListDevices } from './list-devices'

const now = () => 1_700_000_000_000

async function seed(ops: ReturnType<typeof createMemoryOps>) {
  const account = await createAccount(ops, now, { name: 'Alice', inviteId: 'inv-1' })
  await storeDevice(ops, {
    credentialId: 'cred-1',
    publicKey: 'pk',
    signCount: 0,
    label: 'Chrome on Windows',
    createdAt: now(),
    lastSeenAt: now(),
    disabled: false,
    accountId: account.id,
    status: 'active',
    addedVia: 'invite',
  })
  return account
}

describe('runListDevices', () => {
  it('groups devices by account with the account name', async () => {
    const ops = createMemoryOps(createMemoryPubSub())
    const account = await seed(ops)

    const listing = await runListDevices(ops)
    expect(listing).toHaveLength(1)
    expect(listing[0]).toMatchObject({ accountId: account.id, accountName: 'Alice' })
    expect(listing[0].devices).toEqual([
      expect.objectContaining({ credentialId: 'cred-1', status: 'active', disabled: false }),
    ])
  })

  it('returns [] on an empty store', async () => {
    const ops = createMemoryOps(createMemoryPubSub())
    expect(await runListDevices(ops)).toEqual([])
  })
})
```

`packages/server/scripts/revoke-device.test.ts`:

```ts
import { describe, expect, it } from 'vitest'

import { createAccount, listAccountDeviceIds, addDeviceToAccount } from '../src/auth/accounts'
import { getDevice, storeDevice } from '../src/auth/devices'
import { DeviceNotFoundError } from '../src/auth/errors'
import { sessionKey } from '../src/auth/records'
import { createMemoryOps, createMemoryPubSub } from '../src/test/memory-ops'
import { runRevokeDevice } from './revoke-device'

const now = () => 1_700_000_000_000

describe('runRevokeDevice', () => {
  it('deletes the device, its account link, and its sessions', async () => {
    const ops = createMemoryOps(createMemoryPubSub())
    const account = await createAccount(ops, now, { name: 'Bob', inviteId: 'inv-1' })
    await storeDevice(ops, {
      credentialId: 'cred-1',
      publicKey: 'pk',
      signCount: 0,
      label: 'iPad',
      createdAt: now(),
      lastSeenAt: now(),
      disabled: false,
      accountId: account.id,
      status: 'active',
      addedVia: 'invite',
    })
    await addDeviceToAccount(ops, account.id, 'cred-1', { countsAgainstLimit: false })
    await ops.set(
      sessionKey('s1'),
      JSON.stringify({
        sessionId: 's1',
        accountId: account.id,
        credentialId: 'cred-1',
        createdAt: now(),
        expiresAt: now() + 1000,
        absoluteExpiresAt: now() + 1000,
        lastSeenAt: now(),
      }),
    )

    const result = await runRevokeDevice(ops, 'cred-1')
    expect(result).toEqual({ accountId: account.id })
    expect(await getDevice(ops, 'cred-1')).toBeInstanceOf(DeviceNotFoundError)
    expect(await listAccountDeviceIds(ops, account.id)).toEqual([])
    expect(await ops.get(sessionKey('s1'))).toBeNull()
  })

  it('returns DeviceNotFoundError for an unknown credential', async () => {
    const ops = createMemoryOps(createMemoryPubSub())
    expect(await runRevokeDevice(ops, 'nope')).toBeInstanceOf(DeviceNotFoundError)
  })
})
```

- [ ] **Step 2: Run to verify failure**

Run: `pnpm --filter server exec vitest run scripts/list-devices.test.ts scripts/revoke-device.test.ts`
Expected: FAIL — modules do not exist.

- [ ] **Step 3: Implement**

`packages/server/scripts/list-devices.ts`:

```ts
import { getAccount } from '../src/auth/accounts'
import { getDevice, listAllDeviceCredentialIds } from '../src/auth/devices'
import type { ValkeyOps } from '../src/storage/valkey'

export type DeviceListing = {
  accountId: string
  accountName: string
  devices: Array<{
    credentialId: string
    label: string
    status: 'active' | 'pending'
    disabled: boolean
    createdAt: string
    lastSeenAt: string
  }>
}

export async function runListDevices(ops: ValkeyOps): Promise<DeviceListing[]> {
  const ids = await listAllDeviceCredentialIds(ops)
  const byAccount = new Map<string, DeviceListing>()

  for (const id of ids) {
    const device = await getDevice(ops, id)
    if (device instanceof Error) continue

    let listing = byAccount.get(device.accountId)
    if (!listing) {
      const account = await getAccount(ops, device.accountId)
      listing = {
        accountId: device.accountId,
        accountName: account instanceof Error ? '<unknown>' : account.name,
        devices: [],
      }
      byAccount.set(device.accountId, listing)
    }

    listing.devices.push({
      credentialId: device.credentialId,
      label: device.label,
      status: device.status,
      disabled: device.disabled,
      createdAt: new Date(device.createdAt).toISOString(),
      lastSeenAt: new Date(device.lastSeenAt).toISOString(),
    })
  }

  return [...byAccount.values()]
}
```

`packages/server/scripts/list-devices.cli.ts` (mirror the `create-invite.cli.ts` entry shape — it simply imports and runs the `runCli` from its logic module; keep the same structure):

```ts
import { runListDevicesCli } from './list-devices'

void runListDevicesCli()
```

Add to `list-devices.ts` (same pattern as `runCli` in `create-invite.ts`):

```ts
import { createValkeyOps } from '../src/storage/valkey'

export async function runListDevicesCli(): Promise<void> {
  const ops = createValkeyOps()
  const listing = await runListDevices(ops)
  if (listing.length === 0) {
    console.log('No devices.')
    process.exit(0)
  }
  for (const account of listing) {
    console.log(`${account.accountName} (${account.accountId})`)
    for (const device of account.devices) {
      const flags = [device.status, device.disabled ? 'disabled' : null].filter(Boolean).join(', ')
      console.log(`  ${device.credentialId}  ${device.label}  [${flags}]  last seen ${device.lastSeenAt}`)
    }
  }
  process.exit(0)
}
```

`packages/server/scripts/revoke-device.ts`:

```ts
import { getDevice, revokeDevice } from '../src/auth/devices'
import { DeviceNotFoundError } from '../src/auth/errors'
import { createValkeyOps, type ValkeyOps } from '../src/storage/valkey'

export async function runRevokeDevice(
  ops: ValkeyOps,
  credentialId: string,
): Promise<{ accountId: string } | DeviceNotFoundError | Error> {
  const device = await getDevice(ops, credentialId)
  if (device instanceof Error) return device

  await revokeDevice(ops, credentialId)
  return { accountId: device.accountId }
}

export async function runRevokeDeviceCli(): Promise<void> {
  const flagIndex = process.argv.indexOf('--credential-id')
  const credentialId = flagIndex === -1 ? undefined : process.argv[flagIndex + 1]
  if (!credentialId) {
    console.error('Usage: revoke-device --credential-id <id>')
    process.exit(1)
  }

  const ops = createValkeyOps()
  const result = await runRevokeDevice(ops, credentialId)
  if (result instanceof Error) {
    console.error(result.message)
    process.exit(1)
  }
  console.log(`Revoked ${credentialId} (account ${result.accountId}); its sessions are gone.`)
  process.exit(0)
}
```

`packages/server/scripts/revoke-device.cli.ts`:

```ts
import { runRevokeDeviceCli } from './revoke-device'

void runRevokeDeviceCli()
```

`packages/server/rspack.config.ts` — extend the `entry` map:

```ts
'scripts/list-devices': './scripts/list-devices.cli.ts',
'scripts/revoke-device': './scripts/revoke-device.cli.ts',
```

- [ ] **Step 4: Run tests + build**

Run: `pnpm --filter server exec vitest run scripts/list-devices.test.ts scripts/revoke-device.test.ts`
Expected: PASS.
Run: `pnpm --filter server build`
Expected: emits `dist/scripts/list-devices.cjs` and `dist/scripts/revoke-device.cjs` (check the `dist/scripts/` directory).

- [ ] **Step 5: Commit**

```bash
rtk git add packages/server/scripts packages/server/rspack.config.ts
rtk git commit -m "feat(server): list-devices and revoke-device ops scripts"
```

---

### Task 4: Ops scripts — revoke-invite, revoke-account, mint-add-device-token

**Files:**
- Modify: `packages/server/src/auth/invites.ts` (add `revokeInviteById`)
- Modify: `packages/server/src/auth/invites.test.ts` (its test)
- Create: `packages/server/scripts/revoke-invite.ts`, `.cli.ts`, `.test.ts`
- Create: `packages/server/scripts/revoke-account.ts`, `.cli.ts`, `.test.ts`
- Create: `packages/server/scripts/mint-add-device-token.ts`, `.cli.ts`, `.test.ts`
- Modify: `packages/server/rspack.config.ts` (three new entries)

**Interfaces:**
- Consumes: `mintAddToken`, `formatAddCode` from `../src/auth/add-tokens`; `getAccount`, `listAccountDeviceIds` from `../src/auth/accounts`; `revokeDevice` from `../src/auth/devices`; `accountKey`, `accountDevicesKey`, `inviteKey`, `getJson`, `InviteRecordSchema` from `../src/auth/records`; `parseDuration` from `../src/auth/config`.
- Produces:
  - `revokeInviteById(ops: ValkeyOps, id: string): Promise<boolean>` (in `invites.ts`) — scans `invite:*`, deletes the record whose `id` matches; `false` if none.
  - `runRevokeAccount(ops: ValkeyOps, accountId: string): Promise<{ devices: number } | AccountNotFoundError | Error>`
  - `runMintAddDeviceToken(ops: ValkeyOps, now: () => number, publicAppUrl: string, args: { accountId: string; ttlMs: number }): Promise<{ url: string; code: string } | AccountNotFoundError | Error>`

- [ ] **Step 1: Write the failing tests**

Append to `packages/server/src/auth/invites.test.ts`:

```ts
describe('revokeInviteById', () => {
  it('deletes the invite with the matching id and reports true', async () => {
    const ops = createMemoryOps(createMemoryPubSub())
    const { record, token } = await createInvite(ops, now, { ttlMs: 60_000 })

    expect(await revokeInviteById(ops, record.id)).toBe(true)
    expect(await lookupInvite(ops, now, token)).toBeInstanceOf(InviteNotFoundError)
  })

  it('returns false when no invite has that id', async () => {
    const ops = createMemoryOps(createMemoryPubSub())
    expect(await revokeInviteById(ops, 'missing')).toBe(false)
  })
})
```

(Reuse the file's existing imports/`now` helper; add `revokeInviteById` to the import list.)

`packages/server/scripts/revoke-account.test.ts`:

```ts
import { describe, expect, it } from 'vitest'

import { addDeviceToAccount, createAccount, getAccount } from '../src/auth/accounts'
import { getDevice, storeDevice } from '../src/auth/devices'
import { AccountNotFoundError, DeviceNotFoundError } from '../src/auth/errors'
import { createMemoryOps, createMemoryPubSub } from '../src/test/memory-ops'
import { runRevokeAccount } from './revoke-account'

const now = () => 1_700_000_000_000

describe('runRevokeAccount', () => {
  it('deletes the account, every device, and their sessions', async () => {
    const ops = createMemoryOps(createMemoryPubSub())
    const account = await createAccount(ops, now, { name: 'Carol', inviteId: 'inv' })
    for (const credentialId of ['c1', 'c2']) {
      await storeDevice(ops, {
        credentialId,
        publicKey: 'pk',
        signCount: 0,
        label: credentialId,
        createdAt: now(),
        lastSeenAt: now(),
        disabled: false,
        accountId: account.id,
        status: 'active',
        addedVia: 'invite',
      })
      await addDeviceToAccount(ops, account.id, credentialId, { countsAgainstLimit: false })
    }

    const result = await runRevokeAccount(ops, account.id)
    expect(result).toEqual({ devices: 2 })
    expect(await getAccount(ops, account.id)).toBeInstanceOf(AccountNotFoundError)
    expect(await getDevice(ops, 'c1')).toBeInstanceOf(DeviceNotFoundError)
    expect(await getDevice(ops, 'c2')).toBeInstanceOf(DeviceNotFoundError)
  })

  it('returns AccountNotFoundError for an unknown account', async () => {
    const ops = createMemoryOps(createMemoryPubSub())
    expect(await runRevokeAccount(ops, 'missing')).toBeInstanceOf(AccountNotFoundError)
  })
})
```

`packages/server/scripts/mint-add-device-token.test.ts`:

```ts
import { describe, expect, it } from 'vitest'

import { createAccount } from '../src/auth/accounts'
import { lookupAddToken } from '../src/auth/add-tokens'
import { AccountNotFoundError } from '../src/auth/errors'
import { createMemoryOps, createMemoryPubSub } from '../src/test/memory-ops'
import { runMintAddDeviceToken } from './mint-add-device-token'

const now = () => 1_700_000_000_000

describe('runMintAddDeviceToken', () => {
  it('mints a live add-device code for an existing account', async () => {
    const ops = createMemoryOps(createMemoryPubSub())
    const account = await createAccount(ops, now, { name: 'Dave', inviteId: 'inv' })

    const result = await runMintAddDeviceToken(ops, now, 'https://board.example', {
      accountId: account.id,
      ttlMs: 300_000,
    })
    if (result instanceof Error) throw result

    expect(result.code).toMatch(/^[0-9A-Z]{4}-[0-9A-Z]{4}$/)
    expect(result.url).toBe(`https://board.example/add-device?token=${result.code.replace('-', '')}`)

    const record = await lookupAddToken(ops, now, result.code)
    if (record instanceof Error) throw record
    expect(record.accountId).toBe(account.id)
  })

  it('refuses an unknown account', async () => {
    const ops = createMemoryOps(createMemoryPubSub())
    const result = await runMintAddDeviceToken(ops, now, 'https://board.example', {
      accountId: 'missing',
      ttlMs: 300_000,
    })
    expect(result).toBeInstanceOf(AccountNotFoundError)
  })
})
```

`packages/server/scripts/revoke-invite.test.ts`:

```ts
import { describe, expect, it } from 'vitest'

import { createInvite, lookupInvite } from '../src/auth/invites'
import { InviteNotFoundError } from '../src/auth/errors'
import { createMemoryOps, createMemoryPubSub } from '../src/test/memory-ops'
import { runRevokeInvite } from './revoke-invite'

const now = () => 1_700_000_000_000

describe('runRevokeInvite', () => {
  it('kills a live invite by id', async () => {
    const ops = createMemoryOps(createMemoryPubSub())
    const { record, token } = await createInvite(ops, now, { ttlMs: 60_000 })

    expect(await runRevokeInvite(ops, record.id)).toBe(true)
    expect(await lookupInvite(ops, now, token)).toBeInstanceOf(InviteNotFoundError)
  })
})
```

- [ ] **Step 2: Run to verify failure**

Run: `pnpm --filter server exec vitest run src/auth/invites.test.ts scripts/revoke-invite.test.ts scripts/revoke-account.test.ts scripts/mint-add-device-token.test.ts`
Expected: FAIL — new symbols missing.

- [ ] **Step 3: Implement**

Append to `packages/server/src/auth/invites.ts`:

```ts
const INVITE_KEY_PREFIX = 'invite:'

/** Ops-script path: invites are stored by token hash, so find by record id via scan. */
export async function revokeInviteById(ops: ValkeyOps, id: string): Promise<boolean> {
  const keys = await ops.scanKeys(INVITE_KEY_PREFIX)
  for (const key of keys) {
    const record = await getJson(ops, key, InviteRecordSchema)
    if (record instanceof Error || record === null) continue
    if (record.id !== id) continue
    await ops.del(key)
    return true
  }
  return false
}
```

(`getJson` is already imported in `invites.ts` via `./records`; extend that import with `getJson` if absent.)

`packages/server/scripts/revoke-invite.ts`:

```ts
import { revokeInviteById } from '../src/auth/invites'
import { createValkeyOps, type ValkeyOps } from '../src/storage/valkey'

export function runRevokeInvite(ops: ValkeyOps, id: string): Promise<boolean> {
  return revokeInviteById(ops, id)
}

export async function runRevokeInviteCli(): Promise<void> {
  const flagIndex = process.argv.indexOf('--id')
  const id = flagIndex === -1 ? undefined : process.argv[flagIndex + 1]
  if (!id) {
    console.error('Usage: revoke-invite --id <inviteId>')
    process.exit(1)
  }

  const ops = createValkeyOps()
  const revoked = await runRevokeInvite(ops, id)
  if (!revoked) {
    console.error(`No live invite with id ${id}`)
    process.exit(1)
  }
  console.log(`Invite ${id} revoked.`)
  process.exit(0)
}
```

`packages/server/scripts/revoke-account.ts`:

```ts
import { getAccount, listAccountDeviceIds } from '../src/auth/accounts'
import { revokeDevice } from '../src/auth/devices'
import type { AccountNotFoundError } from '../src/auth/errors'
import { accountDevicesKey, accountKey } from '../src/auth/records'
import { createValkeyOps, type ValkeyOps } from '../src/storage/valkey'

export async function runRevokeAccount(
  ops: ValkeyOps,
  accountId: string,
): Promise<{ devices: number } | AccountNotFoundError | Error> {
  const account = await getAccount(ops, accountId)
  if (account instanceof Error) return account

  const ids = await listAccountDeviceIds(ops, accountId)
  for (const credentialId of ids) {
    await revokeDevice(ops, credentialId) // cascades that device's sessions
  }
  await ops.del(accountDevicesKey(accountId))
  await ops.del(accountKey(accountId))
  return { devices: ids.length }
}

export async function runRevokeAccountCli(): Promise<void> {
  const flagIndex = process.argv.indexOf('--account')
  const accountId = flagIndex === -1 ? undefined : process.argv[flagIndex + 1]
  if (!accountId) {
    console.error('Usage: revoke-account --account <accountId>')
    process.exit(1)
  }

  const ops = createValkeyOps()
  const result = await runRevokeAccount(ops, accountId)
  if (result instanceof Error) {
    console.error(result.message)
    process.exit(1)
  }
  console.log(`Account ${accountId} removed (${result.devices} device(s) revoked).`)
  process.exit(0)
}
```

`packages/server/scripts/mint-add-device-token.ts`:

```ts
import { getAccount } from '../src/auth/accounts'
import { formatAddCode, mintAddToken } from '../src/auth/add-tokens'
import { parseDuration } from '../src/auth/config'
import type { AccountNotFoundError } from '../src/auth/errors'
import { createValkeyOps, type ValkeyOps } from '../src/storage/valkey'

const DEFAULT_TTL_MS = 5 * 60_000

export async function runMintAddDeviceToken(
  ops: ValkeyOps,
  now: () => number,
  publicAppUrl: string,
  { accountId, ttlMs }: { accountId: string; ttlMs: number },
): Promise<{ url: string; code: string } | AccountNotFoundError | Error> {
  const account = await getAccount(ops, accountId)
  if (account instanceof Error) return account

  const { code } = await mintAddToken(ops, now, { accountId, ttlMs })
  return {
    url: `${publicAppUrl}/add-device?token=${code}`,
    code: formatAddCode(code),
  }
}

export async function runMintAddDeviceTokenCli(): Promise<void> {
  const accountIndex = process.argv.indexOf('--account')
  const accountId = accountIndex === -1 ? undefined : process.argv[accountIndex + 1]
  if (!accountId) {
    console.error('Usage: mint-add-device-token --account <accountId> [--ttl 5m]')
    process.exit(1)
  }

  const ttlIndex = process.argv.indexOf('--ttl')
  let ttlMs = DEFAULT_TTL_MS
  if (ttlIndex !== -1) {
    const parsed = parseDuration(process.argv[ttlIndex + 1] ?? '')
    if (parsed instanceof Error) {
      console.error(parsed.message)
      process.exit(1)
    }
    ttlMs = parsed
  }

  const publicAppUrl = process.env.PUBLIC_APP_URL
  if (!publicAppUrl) {
    console.error('PUBLIC_APP_URL is not set')
    process.exit(1)
  }

  const ops = createValkeyOps()
  const result = await runMintAddDeviceToken(ops, Date.now, publicAppUrl, { accountId, ttlMs })
  if (result instanceof Error) {
    console.error(result.message)
    process.exit(1)
  }
  console.log(result.url)
  console.log(`Code: ${result.code}`)
  process.exit(0)
}
```

Three `.cli.ts` entries (same one-liner shape as Task 3), and three `rspack.config.ts` entries:

```ts
'scripts/revoke-invite': './scripts/revoke-invite.cli.ts',
'scripts/revoke-account': './scripts/revoke-account.cli.ts',
'scripts/mint-add-device-token': './scripts/mint-add-device-token.cli.ts',
```

- [ ] **Step 4: Run tests + build**

Run: `pnpm --filter server exec vitest run src/auth/invites.test.ts scripts/`
Expected: PASS.
Run: `pnpm --filter server build`
Expected: five `dist/scripts/*.cjs` files (incl. `create-invite.cjs`).

- [ ] **Step 5: Commit**

```bash
rtk git add packages/server/scripts packages/server/src/auth/invites.ts packages/server/src/auth/invites.test.ts packages/server/rspack.config.ts
rtk git commit -m "feat(server): revoke-invite, revoke-account, mint-add-device-token ops scripts"
```

---

### Task 5: `@shared/http` — HttpClient port (ky adapter), EventStream port, Navigate

**Files:**
- Modify: `packages/shared/package.json` (add `ky`)
- Create: `packages/shared/http/client.ts`
- Create: `packages/shared/http/client.test.ts`
- Create: `packages/shared/http/event-stream.ts`
- Create: `packages/shared/http/event-stream.test.ts`
- Create: `packages/shared/http/test/scripted-http.ts` (test helper used by later tasks)
- Create: `packages/shared/http/test/fake-event-stream.ts` (EventStream test double used by Tasks 7 and 9)
- Create: `packages/shared/navigation.ts`

**Interfaces:**
- Consumes: `ky` (new dep in `shared` only — resolved from `packages/shared/node_modules` by every consumer since `@shared/*` is a source alias), `errore` (already a `shared` dep).
- Produces (all from `@shared/http/client`):
  - `type HttpMethod = 'GET' | 'POST' | 'PUT' | 'DELETE' | 'PATCH'`
  - `type HttpResponse = { status: number; ok: boolean; body: unknown }`
  - `class HttpTransportError` — errore tagged (`reason`, optional `cause`)
  - `type HttpRequestContext = { method: HttpMethod; url: string; headers: Headers }`
  - `type RequestHook = (ctx: HttpRequestContext) => void | Promise<void>`
  - `type ResponseHookContext = { response: HttpResponse; retryCount: number }`
  - `type ResponseHook = (ctx: ResponseHookContext) => void | 'retry' | Promise<void | 'retry'>`
  - `type HttpRequestOptions = { json?: unknown; searchParams?: Record<string, string> }`
  - `type HttpClientOptions = { baseUrl?: string; onRequest?: RequestHook[]; onResponse?: ResponseHook[]; fetch?: typeof globalThis.fetch }`
  - `class HttpClient` — `new HttpClient(options?)`; methods `get/post/put/delete/patch(url, options?): Promise<HttpTransportError | HttpResponse>`
  - `type HttpLike = Pick<HttpClient, 'get' | 'post' | 'put' | 'delete' | 'patch'>` — the structural view consumers and test fakes type against (the class has `#private` state, so object fakes cannot satisfy the class type directly)
  - `makeUnauthorizedRetryHook(onUnauthorized: () => Promise<boolean>): ResponseHook`
- From `@shared/http/event-stream`: `EventStreamMessage`, `EventStreamHandlers`, `EventStream`, `OpenEventStream`, `makeEventSourceStream(EventSourceImpl?)`.
- From `@shared/http/test/scripted-http`: `makeScriptedHttp(script)` — the `test/` path segment is the structural tests-only boundary (same pattern as `server/src/test/` and widget-runtime's `storage/test/`); a production import of `@shared/http/test/*` is a review error and greppable.
- From `@shared/http/test/fake-event-stream`: `FakeEventStream`, `makeFakeOpenEventStream()` (tests only).
- From `@shared/navigation`: `type Navigate = (path: string) => void`.

- [ ] **Step 1: Add the dependency**

Run: `pnpm --filter shared add ky`
Expected: `ky` appears in `packages/shared/package.json` dependencies.

- [ ] **Step 2: Write the failing HttpClient test**

`packages/shared/http/client.test.ts`:

```ts
import { describe, expect, it, vi } from 'vitest'

import { HttpClient, HttpTransportError, makeUnauthorizedRetryHook } from './client'

function stubFetch(...responses: Array<Response | Error>) {
  const impl = vi.fn<(request: Request) => Promise<Response>>()
  for (const item of responses) {
    if (item instanceof Error) impl.mockRejectedValueOnce(item)
    else impl.mockResolvedValueOnce(item)
  }
  return impl
}

const json = (value: unknown, status = 200) => new Response(JSON.stringify(value), { status })

describe('HttpClient', () => {
  it('returns status, ok, and the parsed body for 2xx JSON', async () => {
    const http = new HttpClient({ fetch: stubFetch(json({ a: 1 })) })
    expect(await http.get('http://test.local/x')).toEqual({ status: 200, ok: true, body: { a: 1 } })
  })

  it('returns a non-2xx as a value with its parsed body', async () => {
    const http = new HttpClient({ fetch: stubFetch(json({ code: 'nope' }, 403)) })
    expect(await http.get('http://test.local/x')).toEqual({
      status: 403,
      ok: false,
      body: { code: 'nope' },
    })
  })

  it('maps an empty or non-JSON body on a non-2xx to body undefined (bare nginx 401)', async () => {
    const empty = new HttpClient({ fetch: stubFetch(new Response(null, { status: 401 })) })
    expect(await empty.get('http://test.local/x')).toEqual({
      status: 401,
      ok: false,
      body: undefined,
    })

    const html = new HttpClient({
      fetch: stubFetch(new Response('<html>401</html>', { status: 401 })),
    })
    expect(await html.get('http://test.local/x')).toMatchObject({ status: 401, body: undefined })
  })

  it('maps broken JSON on a 2xx to HttpTransportError', async () => {
    const http = new HttpClient({ fetch: stubFetch(new Response('{oops', { status: 200 })) })
    expect(await http.get('http://test.local/x')).toBeInstanceOf(HttpTransportError)
  })

  it('maps a network failure to HttpTransportError', async () => {
    const http = new HttpClient({ fetch: stubFetch(new Error('boom')) })
    expect(await http.get('http://test.local/x')).toBeInstanceOf(HttpTransportError)
  })

  it('sets the CSRF header on mutating methods only', async () => {
    const fetchMock = stubFetch(new Response(null, { status: 204 }), json({}))
    const http = new HttpClient({ fetch: fetchMock })
    await http.put('http://test.local/x', { json: { a: 1 } })
    expect(fetchMock.mock.calls[0][0].headers.get('x-requested-with')).toBe('MyBoard')
    await http.get('http://test.local/x')
    expect(fetchMock.mock.calls[1][0].headers.get('x-requested-with')).toBeNull()
  })

  it('joins baseUrl with the request path', async () => {
    const fetchMock = stubFetch(json({}))
    const http = new HttpClient({ baseUrl: 'http://test.local/api/', fetch: fetchMock })
    await http.get('/storage/k')
    expect(fetchMock.mock.calls[0][0].url).toBe('http://test.local/api/storage/k')
  })

  it('lets an onRequest hook add headers', async () => {
    const fetchMock = stubFetch(json({}))
    const http = new HttpClient({
      fetch: fetchMock,
      onRequest: [({ headers }) => headers.set('x-extra', '1')],
    })
    await http.get('http://test.local/x')
    expect(fetchMock.mock.calls[0][0].headers.get('x-extra')).toBe('1')
  })
})

describe('makeUnauthorizedRetryHook', () => {
  it('replays exactly once after 401 when the handler recovers (POST body re-sent)', async () => {
    const handler = vi.fn(async () => true)
    const fetchMock = stubFetch(
      new Response(null, { status: 401 }),
      new Response(null, { status: 204 }),
    )
    const http = new HttpClient({ fetch: fetchMock, onResponse: [makeUnauthorizedRetryHook(handler)] })

    const result = await http.post('http://test.local/append', { json: { entry: { x: 1 } } })
    expect(result).toMatchObject({ status: 204 })
    expect(handler).toHaveBeenCalledTimes(1)
    expect(fetchMock).toHaveBeenCalledTimes(2)
    expect(await fetchMock.mock.calls[1][0].json()).toEqual({ entry: { x: 1 } })
  })

  it('gives up after one forced replay', async () => {
    const handler = vi.fn(async () => true)
    const fetchMock = stubFetch(
      new Response(null, { status: 401 }),
      new Response(null, { status: 401 }),
    )
    const http = new HttpClient({ fetch: fetchMock, onResponse: [makeUnauthorizedRetryHook(handler)] })
    expect(await http.get('http://test.local/x')).toMatchObject({ status: 401 })
    expect(handler).toHaveBeenCalledTimes(1)
    expect(fetchMock).toHaveBeenCalledTimes(2)
  })

  it('does not replay when the handler fails or is absent', async () => {
    const failMock = stubFetch(new Response(null, { status: 401 }))
    const failing = new HttpClient({
      fetch: failMock,
      onResponse: [makeUnauthorizedRetryHook(async () => false)],
    })
    expect(await failing.get('http://test.local/x')).toMatchObject({ status: 401 })
    expect(failMock).toHaveBeenCalledTimes(1)

    const bareMock = stubFetch(new Response(null, { status: 401 }))
    const bare = new HttpClient({ fetch: bareMock })
    expect(await bare.get('http://test.local/x')).toMatchObject({ status: 401 })
    expect(bareMock).toHaveBeenCalledTimes(1)
  })

  it('never touches non-401 responses', async () => {
    const handler = vi.fn(async () => true)
    const http = new HttpClient({
      fetch: stubFetch(new Response(null, { status: 500 })),
      onResponse: [makeUnauthorizedRetryHook(handler)],
    })
    expect(await http.get('http://test.local/x')).toMatchObject({ status: 500 })
    expect(handler).not.toHaveBeenCalled()
  })
})
```

- [ ] **Step 3: Run to verify failure**

Run: `pnpm --filter shared exec vitest run http/client.test.ts`
Expected: FAIL — `client.ts` does not exist.

- [ ] **Step 4: Implement `client.ts`**

```ts
import * as errore from 'errore'
import ky from 'ky'

export type HttpMethod = 'GET' | 'POST' | 'PUT' | 'DELETE' | 'PATCH'

export type HttpResponse = { status: number; ok: boolean; body: unknown }

export class HttpTransportError extends errore.createTaggedError({
  name: 'HttpTransportError',
  message: 'HTTP transport failed: $reason',
}) {}

export type HttpRequestContext = { method: HttpMethod; url: string; headers: Headers }
export type RequestHook = (ctx: HttpRequestContext) => void | Promise<void>
export type ResponseHookContext = { response: HttpResponse; retryCount: number }
export type ResponseHook = (ctx: ResponseHookContext) => void | 'retry' | Promise<void | 'retry'>

export type HttpRequestOptions = {
  json?: unknown
  searchParams?: Record<string, string>
}

export type HttpClientOptions = {
  baseUrl?: string
  onRequest?: RequestHook[]
  onResponse?: ResponseHook[]
  /** The ONE legitimate `typeof fetch` seam in the app: the adapter boundary. */
  fetch?: typeof globalThis.fetch
}

/** Structural view of HttpClient for consumers and test fakes. */
export type HttpLike = Pick<HttpClient, 'get' | 'post' | 'put' | 'delete' | 'patch'>

const MUTATING_METHODS = new Set<HttpMethod>(['POST', 'PUT', 'DELETE', 'PATCH'])

/**
 * The app's HTTP port: errore values out (HttpTransportError | HttpResponse),
 * non-2xx statuses are values, hooks are fixed at construction. ky runs inside
 * as a swappable adapter detail — throwHttpErrors off, no auto-retries, no
 * default timeout, so the port's semantics stay ours.
 */
export class HttpClient {
  readonly #options: HttpClientOptions

  constructor(options: HttpClientOptions = {}) {
    this.#options = options
  }

  get(url: string, options?: HttpRequestOptions) {
    return this.#send('GET', url, options, 0)
  }
  post(url: string, options?: HttpRequestOptions) {
    return this.#send('POST', url, options, 0)
  }
  put(url: string, options?: HttpRequestOptions) {
    return this.#send('PUT', url, options, 0)
  }
  delete(url: string, options?: HttpRequestOptions) {
    return this.#send('DELETE', url, options, 0)
  }
  patch(url: string, options?: HttpRequestOptions) {
    return this.#send('PATCH', url, options, 0)
  }

  async #send(
    method: HttpMethod,
    url: string,
    options: HttpRequestOptions | undefined,
    retryCount: number,
  ): Promise<HttpTransportError | HttpResponse> {
    const headers = new Headers()
    if (MUTATING_METHODS.has(method)) headers.set('X-Requested-With', 'MyBoard')
    const ctx: HttpRequestContext = { method, url: this.#resolve(url), headers }
    for (const hook of this.#options.onRequest ?? []) await hook(ctx)

    const raw = await ky(ctx.url, {
      method,
      headers,
      credentials: 'same-origin',
      throwHttpErrors: false, // non-2xx is a value in this port
      retry: 0,
      timeout: false,
      ...(options?.json !== undefined ? { json: options.json } : {}),
      ...(options?.searchParams ? { searchParams: options.searchParams } : {}),
      ...(this.#options.fetch ? { fetch: this.#options.fetch } : {}),
    }).catch((cause) => new HttpTransportError({ reason: 'network request failed', cause }))
    if (raw instanceof Error) return raw

    const parsed = await parseBody(raw)
    if (parsed instanceof HttpTransportError) return parsed
    const response: HttpResponse = { status: raw.status, ok: raw.ok, body: parsed.body }

    for (const hook of this.#options.onResponse ?? []) {
      const verdict = await hook({ response, retryCount })
      // 'retry' short-circuits: the remaining hooks are skipped for this
      // response and every hook runs again on the replayed one. json bodies
      // are plain values re-serialized per attempt — no body-stream cloning
      // problem, POST included.
      if (verdict === 'retry' && retryCount === 0) return this.#send(method, url, options, 1)
    }
    return response
  }

  #resolve(url: string): string {
    const base = this.#options.baseUrl
    if (!base) return url
    return `${base.replace(/\/+$/, '')}/${url.replace(/^\/+/, '')}`
  }
}

/**
 * Body semantics: empty body → undefined; broken JSON on a 2xx → transport
 * error; broken/empty body on a non-2xx → undefined (nginx error pages carry
 * no JSON — the status is the signal). The `{ body }` wrapper keeps the
 * union discriminable — `HttpTransportError | unknown` would collapse to
 * `unknown` and lose the error branch for the type checker.
 */
async function parseBody(raw: Response): Promise<HttpTransportError | { body: unknown }> {
  const text = await raw.text().catch(() => '')
  if (text === '') return { body: undefined }
  const parsed = errore.try(() => JSON.parse(text) as unknown)
  if (parsed instanceof Error) {
    return raw.ok
      ? new HttpTransportError({ reason: 'invalid JSON in a 2xx response', cause: parsed })
      : { body: undefined }
  }
  return { body: parsed }
}

/** 401 → ask the host to recover the session → replay the request once. */
export function makeUnauthorizedRetryHook(
  onUnauthorized: () => Promise<boolean>,
): ResponseHook {
  return async ({ response, retryCount }) => {
    if (response.status !== 401 || retryCount > 0) return
    const recovered = await onUnauthorized().catch(() => false)
    if (recovered) return 'retry'
  }
}
```

**ky API note:** only stable surface is used (`ky(url, options)` with `throwHttpErrors`, `retry: 0`, `timeout: false`, `json`, `searchParams`, `fetch`). No ky hooks, no `ky.retry`, no `HTTPError` — the retry loop and error mapping are ours, so ky version drift cannot change port semantics. If `errore.try` is not available in the installed errore version, inline `try { JSON.parse } catch` inside `parseBody` (allowed by the global constraint's existing-`JSON.parse` exception).

- [ ] **Step 5: Run to verify pass**

Run: `pnpm --filter shared exec vitest run http/client.test.ts`
Expected: PASS.

- [ ] **Step 6: EventStream port — failing test**

`packages/shared/http/event-stream.test.ts`:

```ts
import { describe, expect, it, vi } from 'vitest'

import { makeEventSourceStream } from './event-stream'

class FakeES {
  static instances: FakeES[] = []
  onmessage: ((event: MessageEvent) => void) | null = null
  onerror: (() => void) | null = null
  readyState = 0
  closed = false
  listeners = new Map<string, (event: MessageEvent) => void>()
  constructor(public url: string) {
    FakeES.instances.push(this)
  }
  addEventListener(type: string, listener: (event: MessageEvent) => void) {
    this.listeners.set(type, listener)
  }
  close() {
    this.closed = true
  }
}

function open(events?: string[]) {
  FakeES.instances = []
  const onMessage = vi.fn()
  const onError = vi.fn()
  const stream = makeEventSourceStream(FakeES as unknown as typeof EventSource)('/api/x/events', {
    onMessage,
    onError,
    events,
  })
  return { stream, source: FakeES.instances[0], onMessage, onError }
}

describe('makeEventSourceStream', () => {
  it('forwards plain messages without an event tag', () => {
    const { source, onMessage } = open()
    source.onmessage?.({ data: '{"key":"k"}' } as MessageEvent)
    expect(onMessage).toHaveBeenCalledWith({ data: '{"key":"k"}' })
  })

  it('forwards named events with their tag', () => {
    const { source, onMessage } = open(['ready'])
    source.listeners.get('ready')?.({ data: '{"connId":"c1"}' } as MessageEvent)
    expect(onMessage).toHaveBeenCalledWith({ event: 'ready', data: '{"connId":"c1"}' })
  })

  it('fires onError only when the source is CLOSED (fatal)', () => {
    const { source, onError } = open()
    source.readyState = 0 // CONNECTING: the browser retries by itself
    source.onerror?.()
    expect(onError).not.toHaveBeenCalled()
    source.readyState = 2 // CLOSED: fatal, e.g. the gate answered 401
    source.onerror?.()
    expect(onError).toHaveBeenCalledTimes(1)
  })

  it('close() closes the underlying source', () => {
    const { stream, source } = open()
    stream.close()
    expect(source.closed).toBe(true)
  })
})
```

Run: `pnpm --filter shared exec vitest run http/event-stream.test.ts` → FAIL (module missing).

- [ ] **Step 7: Implement `event-stream.ts`**

```ts
export type EventStreamMessage = { event?: string; data: string }

export type EventStreamHandlers = {
  onMessage: (message: EventStreamMessage) => void
  /** Fires only when the stream is dead (CLOSED) and will not retry by itself. */
  onError?: () => void
  /** Named SSE events to forward in addition to plain `message` frames. */
  events?: string[]
}

export type EventStream = { close(): void }

export type OpenEventStream = (url: string, handlers: EventStreamHandlers) => EventStream

const CLOSED = 2

export function makeEventSourceStream(
  EventSourceImpl: typeof EventSource = globalThis.EventSource,
): OpenEventStream {
  return (url, handlers) => {
    const source = new EventSourceImpl(url)
    source.onmessage = (event) => handlers.onMessage({ data: event.data as string })
    for (const name of handlers.events ?? []) {
      source.addEventListener(name, (event) =>
        handlers.onMessage({ event: name, data: (event as MessageEvent).data as string }),
      )
    }
    source.onerror = () => {
      // CONNECTING (0): the browser retries by itself. CLOSED (2): fatal —
      // e.g. the gate answered non-200 and EventSource will never reconnect.
      if (source.readyState === CLOSED) handlers.onError?.()
    }
    return { close: () => source.close() }
  }
}
```

Run: `pnpm --filter shared exec vitest run http/event-stream.test.ts` → PASS.

- [ ] **Step 8: Test doubles + Navigate type (no own tests)**

`packages/shared/http/test/scripted-http.ts` — the fake port every later task's tests use instead of `Response` mocks. The `test/` directory is the structural tests-only boundary (same pattern as `server/src/test/memory-ops.ts` and widget-runtime's `storage/test/fakes.ts`):

```ts
import {
  HttpTransportError,
  type HttpLike,
  type HttpRequestOptions,
  type HttpResponse,
} from '../client'

export type ScriptedStep = { status: number; body?: unknown } | 'network-error'
export type ScriptedCall = { method: string; url: string; json?: unknown }

/**
 * Test-only scripted HttpLike: each URL maps to a queue of steps consumed one
 * per call. Import from tests only, never from production code.
 */
export function makeScriptedHttp(script: Record<string, ScriptedStep[]>) {
  const calls: ScriptedCall[] = []
  const run = async (
    method: string,
    url: string,
    options?: HttpRequestOptions,
  ): Promise<HttpTransportError | HttpResponse> => {
    calls.push({ method, url, json: options?.json })
    const step = script[url]?.shift()
    if (!step) throw new Error(`unexpected ${method} ${url}`)
    if (step === 'network-error') {
      return new HttpTransportError({ reason: 'scripted network failure' })
    }
    return { status: step.status, ok: step.status >= 200 && step.status < 300, body: step.body }
  }
  const http: HttpLike = {
    get: (url, options) => run('GET', url, options),
    post: (url, options) => run('POST', url, options),
    put: (url, options) => run('PUT', url, options),
    delete: (url, options) => run('DELETE', url, options),
    patch: (url, options) => run('PATCH', url, options),
  }
  return { http, calls }
}
```

`packages/shared/http/test/fake-event-stream.ts` — the EventStream double (in-memory streams, manual frame pushes) that Task 7 (SSE manager tests) and Task 9 (account device-events tests) consume:

```ts
import type { EventStream, EventStreamHandlers, OpenEventStream } from '../event-stream'

/** In-memory EventStream double: capture opened streams and push frames manually. */
export class FakeEventStream implements EventStream {
  closed = false
  constructor(
    public url: string,
    public handlers: EventStreamHandlers,
  ) {}
  /** Simulate a server frame; `event` undefined = plain message. */
  emit(event: string | undefined, data: unknown) {
    this.handlers.onMessage({ event, data: JSON.stringify(data) })
  }
  /** Simulate a fatal close (e.g. the gate answered 401). */
  fail() {
    this.handlers.onError?.()
  }
  close() {
    this.closed = true
  }
}

export function makeFakeOpenEventStream() {
  const streams: FakeEventStream[] = []
  const open: OpenEventStream = (url, handlers) => {
    const stream = new FakeEventStream(url, handlers)
    streams.push(stream)
    return stream
  }
  return { open, streams }
}
```

`packages/shared/navigation.ts`:

```ts
/**
 * One navigation seam for models. Implementations stay one-liners at
 * composition roots (e.g. `(path) => window.location.assign(path)`).
 */
export type Navigate = (path: string) => void
```

- [ ] **Step 9: Run the shared suite**

Run: `pnpm --filter shared test`
Expected: PASS (new tests + pre-existing shared tests).

- [ ] **Step 10: Commit**

```bash
rtk git add packages/shared pnpm-lock.yaml
rtk git commit -m "feat(shared): HttpClient port over ky, EventStream port, Navigate type"
```

---

### Task 6: widget-runtime — `makeHostRuntime` + http-storage/widget-api/http-time on the port

**Files:**
- Create: `packages/widget-runtime/src/host-runtime.ts`
- Create: `packages/widget-runtime/src/host-runtime.test.ts`
- Modify: `packages/widget-runtime/src/storage/server/http-storage.ts` (deps-injected rewrite)
- Modify: `packages/widget-runtime/src/storage/server/http-storage.test.ts` (fake-port stubs)
- Modify: `packages/widget-runtime/src/widget-api.ts` (`http: HttpLike` instead of `fetch`)
- Modify: `packages/widget-runtime/src/widget-api.test.ts`
- Modify: `packages/widget-runtime/src/timer/http-time.ts` + `http-time.test.ts`
- Modify: `packages/widget-runtime/src/storage/index.ts` (free factories removed — they move to host-runtime as transitional wrappers)
- Modify: `packages/widget-runtime/src/index.ts` (`export * from './host-runtime'`)

**Interfaces:**
- Consumes: `HttpClient`, `HttpLike`, `makeUnauthorizedRetryHook` from `@shared/http/client`; `OpenEventStream`, `makeEventSourceStream` from `@shared/http/event-stream`; `makeScriptedHttp` from `@shared/http/test/scripted-http` (tests).
- Produces:
  - `makeHostRuntime(options?: HostRuntimeOptions): HostRuntime` with
    `HostRuntimeOptions = { serverBaseUrl?: string; onUnauthorized?: () => Promise<boolean>; http?: HttpLike; openEventStream?: OpenEventStream }` and
    `HostRuntime = { makeWidgetStorage({instanceId, typeId}): WidgetStorage; makeScopedStorage(scope): ScopedStorage; makeWidgetApi<Events>({instanceId, typeId}): WidgetApi<Events, WidgetApiError> }`
  - `makeRuntimeHttp(onUnauthorized?: () => Promise<boolean>): HttpClient` (exported so the default 401 wiring is unit-testable)
  - `makeHttpStorage(namespace: string, deps: HttpStorageDeps)` with `HttpStorageDeps = { baseUrl: string; http: HttpLike; registerKey: (fullKey: string, deliver: SseDeliver) => () => void }`
  - **Transitional** free `makeWidgetStorage` / `makeScopedStorage` / `makeWidgetApi` package exports delegating to a lazy default runtime — keep every current consumer compiling; **deleted in Task 9**.
  - `fetchServerTime(baseUrl?, http?)` — same return contract as today.

- [ ] **Step 1: Rewrite the http-storage tests on the fake port**

Replace the body of `packages/widget-runtime/src/storage/server/http-storage.test.ts` (no more global fetch stubs — each test builds its own scripted port):

```ts
import { makeScriptedHttp } from '@shared/http/test/scripted-http'
import { describe, expect, it, vi } from 'vitest'

import { typeNamespace } from '../scope'
import { StorageError } from '../types'
import { makeHttpStorage } from './http-storage'

const ns = typeNamespace('clock')
const BASE = '/api/storage'
const KEY = `${BASE}/${encodeURIComponent('w:t:clock:settings')}`

function storageWith(script: Parameters<typeof makeScriptedHttp>[0]) {
  const { http, calls } = makeScriptedHttp(script)
  const registerKey = vi.fn(() => () => {})
  return { storage: makeHttpStorage(ns, { baseUrl: BASE, http, registerKey }), calls, registerKey }
}

describe('makeHttpStorage on the HttpClient port', () => {
  it('GET returns the value', async () => {
    const { storage } = storageWith({ [KEY]: [{ status: 200, body: { value: { a: 1 } } }] })
    expect(await storage.get('settings')).toEqual({ a: 1 })
  })

  it('GET maps 404 to null', async () => {
    const { storage } = storageWith({ [KEY]: [{ status: 404 }] })
    expect(await storage.get('settings')).toBeNull()
  })

  it('GET maps other non-2xx to StorageError', async () => {
    const { storage } = storageWith({ [KEY]: [{ status: 503 }] })
    expect(await storage.get('settings')).toBeInstanceOf(StorageError)
  })

  it('GET maps a malformed envelope to StorageError', async () => {
    const { storage } = storageWith({ [KEY]: [{ status: 200, body: { nope: true } }] })
    expect(await storage.get('settings')).toBeInstanceOf(StorageError)
  })

  it('GET maps transport failures to StorageError with the cause', async () => {
    const { storage } = storageWith({ [KEY]: ['network-error'] })
    expect(await storage.get('settings')).toBeInstanceOf(StorageError)
  })

  it('SET sends a PUT with value and ttl', async () => {
    const { storage, calls } = storageWith({ [KEY]: [{ status: 204 }] })
    await storage.set('settings', { a: 1 }, { ttlMs: 1000 })
    expect(calls[0]).toEqual({
      method: 'PUT',
      url: KEY,
      json: { value: { a: 1 }, ttlMs: 1000 },
    })
  })

  it('DELETE sends a DELETE', async () => {
    const { storage, calls } = storageWith({ [KEY]: [{ status: 204 }] })
    await storage.delete('settings')
    expect(calls[0]?.method).toBe('DELETE')
  })

  it('HAS maps 404 to false and 200 to true', async () => {
    const { storage } = storageWith({ [KEY]: [{ status: 404 }, { status: 200, body: { value: 1 } }] })
    expect(await storage.has('settings')).toBe(false)
    expect(await storage.has('settings')).toBe(true)
  })

  it('KEYS strips the namespace', async () => {
    const url = `${BASE}?prefix=${encodeURIComponent('w:t:clock:')}`
    const { storage } = storageWith({
      [url]: [{ status: 200, body: { keys: ['w:t:clock:a', 'w:t:clock:b'] } }],
    })
    expect(await storage.keys()).toEqual(['a', 'b'])
  })

  it('APPEND posts the entry', async () => {
    const url = `${BASE}/${encodeURIComponent('w:t:clock:log')}/append`
    const { storage, calls } = storageWith({ [url]: [{ status: 204 }] })
    await storage.append('log', { x: 1 }, { cap: 10 })
    expect(calls[0]).toEqual({ method: 'POST', url, json: { entry: { x: 1 }, cap: 10 } })
  })

  it('subscribe registers the full key through the injected registerKey', () => {
    const { storage, registerKey } = storageWith({})
    const unsubscribe = storage.subscribe('settings', () => {})
    expect(registerKey).toHaveBeenCalledWith('w:t:clock:settings', expect.any(Function))
    unsubscribe()
  })
})
```

Port any other existing cases in the file the same way. The CSRF-header assertions are **deleted here** — the header now lives in `HttpClient` and is covered by the shared suite (Task 5).

- [ ] **Step 2: Run to verify failure**

Run: `pnpm --filter widget-runtime exec vitest run src/storage/server/http-storage.test.ts`
Expected: FAIL — `makeHttpStorage` still has the `(namespace, baseUrl?)` signature and raw fetch.

- [ ] **Step 3: Rewrite `http-storage.ts`**

```ts
import type { HttpLike } from '@shared/http/client'
import { z } from 'zod'

import { toFullKey, toRelativeKey } from '../scope'
import { subscribeStorageKey } from '../subscribe-key'
import { StorageError, type StorageApi, type StorageListener, type StorageOptions } from '../types'
import { parseValue } from '../validate'
import type { SseDeliver } from './sse-client'

export type HttpStorageDeps = {
  baseUrl: string
  http: HttpLike
  registerKey: (fullKey: string, deliver: SseDeliver) => () => void
}

const ValueEnvelopeSchema = z.object({ value: z.unknown() })
const KeysEnvelopeSchema = z.object({ keys: z.array(z.string()) })

export function makeHttpStorage(namespace: string, deps: HttpStorageDeps): StorageApi {
  const { http, baseUrl } = deps
  const keyUrl = (fullKey: string) => `${baseUrl}/${encodeURIComponent(fullKey)}`

  return {
    async get<T>(key: string, schema?: z.ZodType<T>): Promise<StorageError | T | null> {
      const res = await http.get(keyUrl(toFullKey(namespace, key)))
      if (res instanceof Error) return new StorageError({ reason: 'server GET failed', cause: res })
      if (res.status === 404) return null
      if (!res.ok) return new StorageError({ reason: `server GET ${res.status}` })
      const envelope = ValueEnvelopeSchema.safeParse(res.body)
      if (!envelope.success) {
        return new StorageError({ reason: 'server GET invalid response', cause: envelope.error })
      }
      return parseValue(schema, envelope.data.value)
    },

    async set<T>(key: string, value: T, options?: StorageOptions): Promise<StorageError | void> {
      const res = await http.put(keyUrl(toFullKey(namespace, key)), {
        json: { value, ttlMs: options?.ttlMs },
      })
      if (res instanceof Error) return new StorageError({ reason: 'server PUT failed', cause: res })
      if (!res.ok) return new StorageError({ reason: `server PUT ${res.status}` })
    },

    async delete(key: string): Promise<StorageError | void> {
      const res = await http.delete(keyUrl(toFullKey(namespace, key)))
      if (res instanceof Error) {
        return new StorageError({ reason: 'server DELETE failed', cause: res })
      }
      if (!res.ok) return new StorageError({ reason: `server DELETE ${res.status}` })
    },

    async has(key: string): Promise<StorageError | boolean> {
      const res = await http.get(keyUrl(toFullKey(namespace, key)))
      if (res instanceof Error) return new StorageError({ reason: 'server HAS failed', cause: res })
      if (res.status === 404) return false
      if (!res.ok) return new StorageError({ reason: `server HAS ${res.status}` })
      return true
    },

    async keys(prefix?: string): Promise<StorageError | string[]> {
      const fullPrefix = toFullKey(namespace, prefix ?? '')
      const res = await http.get(`${baseUrl}?prefix=${encodeURIComponent(fullPrefix)}`)
      if (res instanceof Error) return new StorageError({ reason: 'server KEYS failed', cause: res })
      if (!res.ok) return new StorageError({ reason: `server KEYS ${res.status}` })
      const envelope = KeysEnvelopeSchema.safeParse(res.body)
      if (!envelope.success) {
        return new StorageError({ reason: 'server KEYS invalid response', cause: envelope.error })
      }
      return envelope.data.keys.map((full) => toRelativeKey(namespace, full))
    },

    async append<T extends Record<string, unknown>>(
      key: string,
      entry: T,
      options?: { cap?: number },
    ): Promise<StorageError | void> {
      const res = await http.post(`${keyUrl(toFullKey(namespace, key))}/append`, {
        json: { entry, ...(options?.cap !== undefined ? { cap: options.cap } : {}) },
      })
      if (res instanceof Error) {
        return new StorageError({ reason: 'server APPEND failed', cause: res })
      }
      if (!res.ok) return new StorageError({ reason: `server APPEND ${res.status}` })
    },

    subscribe<T>(key: string, listener: StorageListener<T>, schema?: z.ZodType<T>): () => void {
      const fullKey = toFullKey(namespace, key)
      return subscribeStorageKey({
        getCurrent: () => this.get<T>(key, schema),
        register: (deliver) => deps.registerKey(fullKey, deliver),
        listener,
        schema,
      })
    },
  }
}
```

No 401 code anywhere — the retry hook inside the runtime's `HttpClient` handles it. Run Step 1's file again → PASS.

- [ ] **Step 4: widget-api on the port (test first)**

Rework `packages/widget-runtime/src/widget-api.test.ts`: replace the injected-fetch fixtures with the scripted port. Representative rewrite (port every existing case in this style — same assertions, `makeScriptedHttp` instead of `Response` mocks):

```ts
import { makeScriptedHttp } from '@shared/http/test/scripted-http'

const URL_ECHO = '/api/widgets/t/echo'

it('invokes the server function and returns data', async () => {
  const { http, calls } = makeScriptedHttp({ [URL_ECHO]: [{ status: 200, body: { data: 42 } }] })
  const api = makeWidgetApi<TestEvents>({ typeId: 't', instanceId: 'i', http })
  expect(await api.invoke('echo', { x: 1 })).toBe(42)
  expect(calls[0]).toEqual({ method: 'POST', url: URL_ECHO, json: { instanceId: 'i', payload: { x: 1 } } })
})

it('maps the error envelope to WidgetApiError', async () => {
  const { http } = makeScriptedHttp({
    [URL_ECHO]: [{ status: 400, body: { error: { code: 'bad', message: 'nope' } } }],
  })
  const api = makeWidgetApi<TestEvents>({ typeId: 't', instanceId: 'i', http })
  expect(await api.invoke('echo', { x: 1 })).toBeInstanceOf(WidgetApiError)
})

it('maps transport failures to WidgetApiError', async () => {
  const { http } = makeScriptedHttp({ [URL_ECHO]: ['network-error'] })
  const api = makeWidgetApi<TestEvents>({ typeId: 't', instanceId: 'i', http })
  expect(await api.invoke('echo', { x: 1 })).toBeInstanceOf(WidgetApiError)
})
```

Run → FAIL. Then rewrite `widget-api.ts`:

```ts
import type { WidgetApi, WidgetEventMap } from '@shared/widgets/contracts'
import type { HttpLike } from '@shared/http/client'
import * as errore from 'errore'
import { z } from 'zod'

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
  http: HttpLike
}

export function makeWidgetApi<Events extends WidgetEventMap>({
  typeId,
  instanceId,
  http,
}: MakeWidgetApiOptions): WidgetApi<Events, WidgetApiError> {
  return {
    async invoke<Event extends keyof Events & string>(
      event: Event,
      payload: Events[Event]['payload'],
    ): Promise<WidgetApiError | Events[Event]['result']> {
      const url = `/api/widgets/${encodeURIComponent(typeId)}/${encodeURIComponent(event)}`
      const response = await http.post(url, { json: { instanceId, payload } })
      if (response instanceof Error) {
        return new WidgetApiError({ reason: 'network request failed', cause: response })
      }

      const envelope = WidgetApiEnvelopeSchema.safeParse(response.body)
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

(The CSRF header and the 401 replay both come from the `HttpClient` — no auth code here. The old `errore.try(JSON.stringify)` guard is gone: serialization now happens inside the adapter and surfaces as `HttpTransportError` → the network branch.) Run → PASS.

- [ ] **Step 5: http-time on the port (test first)**

Rework `packages/widget-runtime/src/timer/http-time.test.ts` cases onto the scripted port (same four assertions the file has today: value, network failure, non-2xx, invalid shape), e.g.:

```ts
import { makeScriptedHttp } from '@shared/http/test/scripted-http'

it('returns server epoch ms', async () => {
  const { http } = makeScriptedHttp({ '/api/time': [{ status: 200, body: { now: 1_700_000_000_000 } }] })
  expect(await fetchServerTime('/api/time', http)).toBe(1_700_000_000_000)
})
```

Run → FAIL. Then rewrite `http-time.ts`:

```ts
import { HttpClient, type HttpLike } from '@shared/http/client'
import * as errore from 'errore'
import { z } from 'zod'

export class TimeError extends errore.createTaggedError({
  name: 'TimeError',
  message: 'Server time fetch failed: $reason',
}) {}

export const ServerTimeSchema = z.object({ now: z.number() })
export type ServerTimeResponse = z.infer<typeof ServerTimeSchema>

/**
 * Fetches server epoch ms. Network/parse failures are returned as TimeError,
 * never thrown. The default client is bare (no auth hook) — deliberate:
 * server-time is a pre-existing module-level model outside the HostRuntime;
 * a 401 here is a non-fatal TimeError and the session heals via any
 * storage-triggered relogin. Built per call: construction just stores an
 * options object, and stateless beats a module-level cache.
 */
export async function fetchServerTime(
  baseUrl = '/api/time',
  http: HttpLike = new HttpClient(),
): Promise<number | TimeError> {
  const res = await http.get(baseUrl)
  if (res instanceof Error) return new TimeError({ reason: 'fetch failed', cause: res })
  if (!res.ok) return new TimeError({ reason: `status ${res.status}` })
  const parsed = ServerTimeSchema.safeParse(res.body)
  if (!parsed.success) {
    return new TimeError({ reason: 'invalid response shape', cause: parsed.error })
  }
  return parsed.data.now
}
```

(`server-time.ts` keeps its injectable `fetchTime` default — no change there.) Run → PASS.

- [ ] **Step 6: host-runtime — failing test**

`packages/widget-runtime/src/host-runtime.test.ts`:

```ts
import { makeScriptedHttp } from '@shared/http/test/scripted-http'
import { describe, expect, it, vi } from 'vitest'

import { makeHostRuntime, makeRuntimeHttp } from './host-runtime'

describe('makeHostRuntime', () => {
  it('scopes widget storage to instance and type namespaces over the injected port', async () => {
    const instanceKey = `/api/storage/${encodeURIComponent('w:i:inst-1:k')}`
    const typeKey = `/api/storage/${encodeURIComponent('w:t:clock:k')}`
    const { http, calls } = makeScriptedHttp({
      [instanceKey]: [{ status: 200, body: { value: 1 } }],
      [typeKey]: [{ status: 200, body: { value: 2 } }],
    })
    const runtime = makeHostRuntime({ http })
    const storage = runtime.makeWidgetStorage({ instanceId: 'inst-1', typeId: 'clock' })

    expect(await storage.instance.server.get('k')).toBe(1)
    expect(await storage.shared.server.get('k')).toBe(2)
    expect(calls.map((c) => c.url)).toEqual([instanceKey, typeKey])
  })

  it('makeScopedStorage uses the raw scope', async () => {
    const rootKey = `/api/storage/${encodeURIComponent('root:k')}`
    const { http } = makeScriptedHttp({ [rootKey]: [{ status: 404 }] })
    const runtime = makeHostRuntime({ http })
    expect(await runtime.makeScopedStorage('root').server.get('k')).toBeNull()
  })

  it('makeWidgetApi posts through the same injected port', async () => {
    const { http, calls } = makeScriptedHttp({
      '/api/widgets/t/echo': [{ status: 200, body: { data: 7 } }],
    })
    const runtime = makeHostRuntime({ http })
    const api = runtime.makeWidgetApi<{ echo: { payload: unknown; result: number } }>({
      instanceId: 'i',
      typeId: 't',
    })
    expect(await api.invoke('echo', {})).toBe(7)
    expect(calls[0]?.method).toBe('POST')
  })
})

describe('makeRuntimeHttp', () => {
  it('wires exactly one 401 replay through onUnauthorized', async () => {
    const handler = vi.fn(async () => true)
    const fetchMock = vi
      .fn<(request: Request) => Promise<Response>>()
      .mockResolvedValueOnce(new Response(null, { status: 401 }))
      .mockResolvedValueOnce(new Response(null, { status: 204 }))
    vi.stubGlobal('fetch', fetchMock)

    const result = await makeRuntimeHttp(handler).get('http://test.local/x')
    expect(result).toMatchObject({ status: 204 })
    expect(handler).toHaveBeenCalledTimes(1)
    vi.unstubAllGlobals()
  })

  it('is bare without onUnauthorized: the 401 flows through', async () => {
    const fetchMock = vi
      .fn<(request: Request) => Promise<Response>>()
      .mockResolvedValue(new Response(null, { status: 401 }))
    vi.stubGlobal('fetch', fetchMock)

    expect(await makeRuntimeHttp().get('http://test.local/x')).toMatchObject({ status: 401 })
    expect(fetchMock).toHaveBeenCalledTimes(1)
    vi.unstubAllGlobals()
  })
})
```

Run: `pnpm --filter widget-runtime exec vitest run src/host-runtime.test.ts` → FAIL (module missing).

- [ ] **Step 7: Implement `host-runtime.ts` and rewire the package**

`packages/widget-runtime/src/host-runtime.ts`:

```ts
import { HttpClient, makeUnauthorizedRetryHook, type HttpLike } from '@shared/http/client'
import type { OpenEventStream } from '@shared/http/event-stream'
import type { WidgetApi, WidgetEventMap } from '@shared/widgets/contracts'

import type { ScopedStorage, WidgetStorage } from './storage'
import { makeDexieStorage } from './storage/client/dexie-storage'
import { instanceNamespace, typeNamespace } from './storage/scope'
import { makeHttpStorage } from './storage/server/http-storage'
import { getSseManager, type SseDeliver } from './storage/server/sse-client'
import { makeWidgetApi as makeWidgetApiWith, type WidgetApiError } from './widget-api'

export type HostRuntimeOptions = {
  serverBaseUrl?: string                  // default '/api/storage'
  onUnauthorized?: () => Promise<boolean> // board: ensureSession; harnesses: absent
  http?: HttpLike                         // the host's shared client (the board passes its own); default makeRuntimeHttp(onUnauthorized)
  openEventStream?: OpenEventStream       // test seam; wired to the SSE manager in Task 7
}

export type HostRuntime = {
  makeWidgetStorage(options: { instanceId: string; typeId: string }): WidgetStorage
  makeScopedStorage(scope: string): ScopedStorage
  makeWidgetApi<Events extends WidgetEventMap>(options: {
    instanceId: string
    typeId: string
  }): WidgetApi<Events, WidgetApiError>
}

/** The runtime's default client: bare, or with the single 401 replay hook. */
export function makeRuntimeHttp(onUnauthorized?: () => Promise<boolean>): HttpClient {
  return new HttpClient({
    onResponse: onUnauthorized ? [makeUnauthorizedRetryHook(onUnauthorized)] : [],
  })
}

/**
 * The widget-runtime composition root: one per document, owning the SSE
 * manager and running every request through ONE HttpClient — the board
 * injects its shared retry-hooked client, bare hosts (harnesses) get an
 * internally built one. Hosts build exactly one runtime; two runtimes would
 * open two SSE connections — tests only.
 */
export function makeHostRuntime(options: HostRuntimeOptions = {}): HostRuntime {
  const baseUrl = options.serverBaseUrl ?? '/api/storage'
  const http = options.http ?? makeRuntimeHttp(options.onUnauthorized)
  // Task 7 replaces this with a lazily constructed makeSseManager({ baseUrl,
  // http, openEventStream, onUnauthorized }); until then the legacy
  // module-level manager keeps serving subscriptions unchanged.
  const registerKey = (fullKey: string, deliver: SseDeliver) =>
    getSseManager(baseUrl).add(fullKey, deliver)

  const makeScoped = (scope: string): ScopedStorage => {
    const scopeWithColon = scope.endsWith(':') ? scope : `${scope}:`
    return {
      client: makeDexieStorage(scopeWithColon),
      server: makeHttpStorage(scopeWithColon, { baseUrl, http, registerKey }),
    }
  }

  return {
    makeScopedStorage: makeScoped,
    makeWidgetStorage: ({ instanceId, typeId }) => ({
      instance: makeScoped(instanceNamespace(instanceId)),
      shared: makeScoped(typeNamespace(typeId)),
    }),
    makeWidgetApi: ({ instanceId, typeId }) => makeWidgetApiWith({ instanceId, typeId, http }),
  }
}

/* --------------------------------------------------------------------------
 * Transitional free factories — DELETED in Task 9. A lazy module default
 * runtime keeps WidgetFrame / rootStorage / harnesses / widget tests
 * compiling until the composition roots land. No auth behavior: identical to
 * the pre-plan state.
 * ------------------------------------------------------------------------ */
let defaultRuntime: HostRuntime | undefined
function getDefaultRuntime(): HostRuntime {
  return (defaultRuntime ??= makeHostRuntime())
}

/** @deprecated transitional — build a HostRuntime at your composition root. */
export function makeWidgetStorage(options: { instanceId: string; typeId: string }): WidgetStorage {
  return getDefaultRuntime().makeWidgetStorage(options)
}

/** @deprecated transitional — build a HostRuntime at your composition root. */
export function makeScopedStorage(scope: string): ScopedStorage {
  return getDefaultRuntime().makeScopedStorage(scope)
}

/** @deprecated transitional — build a HostRuntime at your composition root. */
export function makeWidgetApi<Events extends WidgetEventMap>(options: {
  instanceId: string
  typeId: string
}): WidgetApi<Events, WidgetApiError> {
  return getDefaultRuntime().makeWidgetApi<Events>(options)
}
```

Rewire the package surface:

1. `packages/widget-runtime/src/storage/index.ts` — delete the `makeWidgetStorage` / `makeScopedStorage` functions and `MakeWidgetStorageOptions`; keep (and still export) the `ScopedStorage` / `WidgetStorage` types. Its `makeHttpStorage` / `makeDexieStorage` imports move with the deleted code.
2. `packages/widget-runtime/src/index.ts` — the package root must not double-export names:

```ts
export * from './types'
export * from './widget-context'
export * from './theme'
export * from './tier'
export { WidgetApiError } from './widget-api'
export * from './storage'
export * from './storage/types'
export * from './storage/reatom'
export * from './timer/server-time'
export * from './host-runtime'
```

(`makeWidgetApi` now reaches consumers through `./host-runtime`'s transitional wrapper, not `./widget-api` — the internal one requires `http` and is not part of the package surface.)

3. `packages/widget-runtime/src/storage/storage.test.ts` and `src/index.test.ts` keep passing unchanged — they consume the transitional wrappers.

Run Step 6's file → PASS.

- [ ] **Step 8: Suite + typecheck**

Run: `pnpm --filter widget-runtime test && pnpm typecheck`
Expected: PASS — the transitional wrappers keep `client` and `widgets/*` compiling; reatom-storage tests run through the default runtime exactly as before.

- [ ] **Step 9: Commit**

```bash
rtk git add packages/widget-runtime/src
rtk git commit -m "feat(widget-runtime): makeHostRuntime composition root over the HttpClient port"
```

---

### Task 7: SSE manager on the EventStream port + re-auth reconnect + `purgeLocalData`

**Files:**
- Modify: `packages/widget-runtime/src/storage/server/sse-client.ts` (constructor-injected `makeSseManager`; the `getSseManager` module map dies)
- Modify: `packages/widget-runtime/src/host-runtime.ts` (own the SSE manager lazily)
- Modify: `packages/widget-runtime/src/storage/test/fakes.ts` (delete `FakeEventSource`/`installFakeEventSource` once unreferenced — the EventStream doubles live in `@shared/http/test/fake-event-stream` since Task 5)
- Modify: `packages/widget-runtime/src/storage/server/sse-client.test.ts` (rewrite on injected fakes)
- Modify: `packages/widget-runtime/src/storage/client/db.ts` (add `purgeLocalData`)
- Modify: `packages/widget-runtime/src/storage/index.ts` (re-export `purgeLocalData`)
- Test in: `packages/widget-runtime/src/storage/client/dexie-storage.test.ts` (purge case)

**Interfaces:**
- Consumes: `HttpLike` from `@shared/http/client`; `OpenEventStream`, `EventStream`, `makeEventSourceStream` from `@shared/http/event-stream`.
- Produces:
  - `makeSseManager(deps: SseManagerDeps): SseManager` with `SseManagerDeps = { baseUrl: string; http: HttpLike; openEventStream: OpenEventStream; onUnauthorized?: () => Promise<boolean> }` and `SseManager = { add(fullKey, deliver): () => void }`
  - `purgeLocalData(): Promise<void>` (exported from the `widget-runtime` package root via `storage/index.ts`) — deletes the `myboard-storage` Dexie database.
- Behavior: on the stream's fatal `onError`, the manager awaits `onUnauthorized` (when present), then reconnects after `RECONNECT_DELAY_MS = 2000`; a fresh connection re-registers all desired keys (the existing `ready` handler already resets `registered`).

- [ ] **Step 1: Fakes come from the port**

The EventStream doubles ship with the port (Task 5 Step 8): import `FakeEventStream` / `makeFakeOpenEventStream` from `@shared/http/test/fake-event-stream`. Nothing is added to `fakes.ts` in this task — it only loses code (Step 5).

- [ ] **Step 2: Rewrite the sse-client tests on injected deps**

Replace `packages/widget-runtime/src/storage/server/sse-client.test.ts` with per-test construction (no `vi.resetModules`, no global fetch/EventSource stubs). Setup helper + the two key new cases in full; port the file's remaining cases (re-register on fresh ready, pending-unsubscribe race, registration retry) onto this helper mechanically — same assertions, `post.mock.calls` instead of `fetch.mock.calls`:

```ts
import type { HttpLike } from '@shared/http/client'
import { afterEach, describe, expect, it, vi } from 'vitest'

import { FakeEventStream, makeFakeOpenEventStream } from '@shared/http/test/fake-event-stream'

import { makeSseManager, type SseManagerDeps } from './sse-client'

afterEach(() => {
  vi.useRealTimers()
})

function makeStubHttp(
  post = vi.fn(async () => ({ status: 204, ok: true, body: undefined as unknown })),
) {
  const reject = () => {
    throw new Error('unexpected non-POST call')
  }
  const http = { get: reject, put: reject, delete: reject, patch: reject, post } as unknown as HttpLike
  return { http, post }
}

function setup(overrides: Partial<SseManagerDeps> = {}) {
  const fake = makeFakeOpenEventStream()
  const { http, post } = makeStubHttp()
  const manager = makeSseManager({
    baseUrl: '/api/storage',
    http,
    openEventStream: fake.open,
    ...overrides,
  })
  return { manager, streams: fake.streams, post }
}

describe('makeSseManager', () => {
  it('registers interest after ready and delivers matching events', async () => {
    const { manager, streams, post } = setup()
    const seen: unknown[] = []
    manager.add('w:t:clock:settings', (raw) => seen.push(raw))

    expect(streams[0].url).toBe('/api/storage/events')
    streams[0].emit('ready', { connId: 'c1' })
    await vi.waitFor(() => {
      expect(post).toHaveBeenCalledWith(
        '/api/storage/events/c1',
        expect.objectContaining({ json: expect.objectContaining({ subscribe: ['w:t:clock:settings'] }) }),
      )
    })

    streams[0].emit(undefined, { key: 'w:t:clock:settings', value: 7 })
    expect(seen).toEqual([7])
  })

  it('re-authenticates and reconnects after a fatal stream error', async () => {
    vi.useFakeTimers()
    const onUnauthorized = vi.fn(async () => true)
    const { manager, streams, post } = setup({ onUnauthorized })
    manager.add('k1', () => {})

    streams[0].emit('ready', { connId: 'c1' })
    await vi.runAllTimersAsync()

    streams[0].fail()
    await vi.runAllTimersAsync()

    expect(onUnauthorized).toHaveBeenCalledTimes(1)
    expect(streams.length).toBe(2)

    // the fresh connection re-registers the desired key
    streams[1].emit('ready', { connId: 'c2' })
    await vi.runAllTimersAsync()
    expect(String(post.mock.calls.at(-1)?.[0])).toContain('/events/c2')
  })
})
```

Run: `pnpm --filter widget-runtime exec vitest run src/storage/server/sse-client.test.ts`
Expected: FAIL — `makeSseManager` does not exist yet.

- [ ] **Step 3: Rewrite `sse-client.ts`**

Keep the file's state machine (subscribers/desired/registered/connId/sync fields, `scheduleSync`, the drift check) and change construction + I/O:

1. Delete `getSseManager` and the module-level `managers` map. New surface:

```ts
import type { HttpLike } from '@shared/http/client'
import type { EventStream, OpenEventStream } from '@shared/http/event-stream'
import { z } from 'zod'

export type SseDeliver = (rawValue: unknown) => void
export type SseManager = { add(fullKey: string, deliver: SseDeliver): () => void }

export type SseManagerDeps = {
  baseUrl: string
  http: HttpLike
  openEventStream: OpenEventStream
  onUnauthorized?: () => Promise<boolean>
}

const REGISTER_RETRY_MS = 1_000
const RECONNECT_DELAY_MS = 2_000

export function makeSseManager(deps: SseManagerDeps): SseManager {
```

2. Connection lifecycle — extract the current inline `ready`/`message` handler bodies into named `onReady(raw: unknown)` / `onStorageEvent(raw: unknown)` functions (their Zod parsing stays byte-identical; they now receive the already-JSON-parsed value):

```ts
  let stream: EventStream | undefined
  let reconnectTimer: ReturnType<typeof setTimeout> | undefined

  function parseFrame(data: string): unknown | Error {
    try {
      return JSON.parse(data) as unknown
    } catch (cause) {
      return new Error('invalid SSE JSON', { cause })
    }
  }

  function connect(): void {
    stream = deps.openEventStream(`${deps.baseUrl}/events`, {
      events: ['ready'],
      onMessage: (message) => {
        const raw = parseFrame(message.data)
        if (raw instanceof Error) {
          console.warn('invalid storage SSE frame', raw)
          return
        }
        if (message.event === 'ready') onReady(raw)
        else onStorageEvent(raw)
      },
      onError: () => {
        // The port only reports fatal closes (e.g. the gate answered 401);
        // transient blips are retried by EventSource itself.
        stream?.close()
        stream = undefined
        connId = undefined
        scheduleReconnect()
      },
    })
  }

  // Fixed 2 s, no backoff, retry forever — deliberate: the common fatal
  // close is a server deploy/restart (nginx up, upstream down → non-200 →
  // CLOSED), where fast indefinite retry is what brings the board back by
  // itself; the per-tab probe load is negligible for nginx.
  function scheduleReconnect(): void {
    if (reconnectTimer) return
    reconnectTimer = setTimeout(() => {
      reconnectTimer = undefined
      void (async () => {
        // The probe inside the handler distinguishes network from session.
        if (deps.onUnauthorized) await deps.onUnauthorized().catch(() => false)
        connect()
      })()
    }, RECONNECT_DELAY_MS)
  }

  connect()
```

3. The subscribe POST inside `sync()` goes through the port — replace the `try/catch/finally` around `fetch` with:

```ts
    syncInFlight = true
    const result = await deps.http.post(`${deps.baseUrl}/events/${requestConnId}`, {
      json: { subscribe, unsubscribe },
    })
    syncInFlight = false

    if (connId !== requestConnId) {
      syncDirty = false
      scheduleSync()
      return
    }

    if (result instanceof Error || !result.ok) {
      console.warn('storage SSE registration failed', result instanceof Error ? result : result.status)
      syncDirty = false
      scheduleRetry()
      return
    }
```

(Everything after — `registered` bookkeeping, `needsResync` — stays unchanged.)

Run Step 2's file → PASS.

- [ ] **Step 4: Own the manager in `makeHostRuntime`**

In `host-runtime.ts`, replace the Task 6 transitional `registerKey` (and the `getSseManager` import) with lazy ownership:

```ts
import { makeEventSourceStream } from '@shared/http/event-stream'
import { makeSseManager, type SseDeliver, type SseManager } from './storage/server/sse-client'
// ...inside makeHostRuntime():
  let sse: SseManager | undefined
  const getSse = () =>
    (sse ??= makeSseManager({
      baseUrl,
      http,
      openEventStream: options.openEventStream ?? makeEventSourceStream(),
      onUnauthorized: options.onUnauthorized,
    }))
  const registerKey = (fullKey: string, deliver: SseDeliver) => getSse().add(fullKey, deliver)
```

(Lazy: building a runtime must not open an SSE connection until the first subscription — harness pages and unit tests never connect.)

Add to `host-runtime.test.ts`:

```ts
it('opens the SSE stream lazily through the injected openEventStream', () => {
  const fake = makeFakeOpenEventStream()
  const { http } = makeScriptedHttp({})
  const runtime = makeHostRuntime({ http, openEventStream: fake.open })
  expect(fake.streams.length).toBe(0)

  const storage = runtime.makeScopedStorage('root')
  const unsubscribe = storage.server.subscribe('k', () => {})
  expect(fake.streams.length).toBe(1)
  unsubscribe()
})
```

(Import `makeFakeOpenEventStream` from `@shared/http/test/fake-event-stream`.)

- [ ] **Step 5: Delete the EventSource fakes**

Remove `FakeEventSource` and `installFakeEventSource` from `fakes.ts`; port any remaining widget-runtime test that used them onto `makeFakeOpenEventStream` (check `http-storage.test.ts` subscribe cases and `reatom-storage.test.ts`; the `EventSourcePolyfill` stubs in `vitest.setup.ts` files stay — they feed the real `makeEventSourceStream` default in tests that don't inject).

- [ ] **Step 6: `purgeLocalData`**

Append to `packages/widget-runtime/src/storage/client/db.ts`:

```ts
/**
 * Logout hygiene: drop the whole client-side storage database. The page must
 * be reloaded afterwards — the module-level `db` handle is closed by delete().
 */
export async function purgeLocalData(): Promise<void> {
  await db.delete()
}
```

Re-export from `packages/widget-runtime/src/storage/index.ts`:

```ts
export { purgeLocalData } from './client/db'
```

Test (append to `packages/widget-runtime/src/storage/client/dexie-storage.test.ts`, following its existing async style):

```ts
it('purgeLocalData drops the database', async () => {
  const storage = makeDexieStorage('w:t:purge:')
  await storage.set('k', 1)
  await purgeLocalData()
  expect(await Dexie.exists('myboard-storage')).toBe(false)
})
```

(Import `purgeLocalData` from `./db` and `Dexie` from `dexie`. Place it last in the file — it destroys the shared db.)

- [ ] **Step 7: Run the suite**

Run: `pnpm --filter widget-runtime test`
Expected: PASS.

- [ ] **Step 8: Commit**

```bash
rtk git add packages/widget-runtime/src
rtk git commit -m "feat(widget-runtime): SSE manager on the EventStream port with re-auth reconnect; purgeLocalData"
```

---

### Task 8: Client relogin model (`ensureSession`)

**Files:**
- Create: `packages/client/src/session/model/relogin.ts`
- Create: `packages/client/src/session/model/relogin.test.ts`

**Interfaces:**
- Consumes: `startAuthentication` from `@simplewebauthn/browser` (already a client dependency); `HttpClient`, `HttpLike` from `@shared/http/client`; `Navigate` from `@shared/navigation`; Reatom v1001 (`action`, `atom`, `wrap`); `makeScriptedHttp` (tests).
- Produces:
  - `makeReloginModel(overrides?: Partial<ReloginDeps>): ReloginModel` with `ReloginDeps = { http: HttpLike; startAuthenticationCeremony: typeof startAuthentication; navigate: Navigate; storage: { get(): string | null; clear(): void } }` and `ReloginModel = { ensureSession: () => Promise<boolean> }`
  - No module singleton: the file exports only the factory (and `CRED_HINT_STORAGE_KEY`). The board's composition root (Task 9 `runtime.ts`) builds the single instance; anything needing `ensureSession` imports it from `@/runtime`, never from this module.
- Behavior contract:
  1. Single-flight: concurrent calls share one promise.
  2. Probe `GET /api/auth/session` → `200` ⇒ `true`, no ceremony.
  3. Probe transport failure ⇒ `false`, **no redirect** (offline-first: the caller just sees its original error).
  4. Probe `401` ⇒ ceremony `POST /api/auth/login/options` (with `credentialIdHint` from `mb_cred_hint` when present) → `startAuthentication` → `POST /api/auth/login/verify` ⇒ `true`.
  5. Any ceremony/verify failure or cancel ⇒ clear the hint, `navigate('/')`, `false`.
  6. The model builds its **own bare `new HttpClient()`** by default — no retry hook: the re-login path must never recurse into itself, and constructing it here keeps `runtime.ts` → `relogin.ts` acyclic.

- [ ] **Step 1: Write the failing test**

`packages/client/src/session/model/relogin.test.ts`:

```ts
import { makeScriptedHttp } from '@shared/http/test/scripted-http'
import { describe, expect, it, vi } from 'vitest'

import { makeReloginModel } from './relogin'

const noStorage = { get: () => null, clear: vi.fn() }

describe('ensureSession', () => {
  it('returns true without a ceremony when the probe says 200', async () => {
    const { http } = makeScriptedHttp({ '/api/auth/session': [{ status: 200, body: {} }] })
    const ceremony = vi.fn()
    const model = makeReloginModel({
      http,
      startAuthenticationCeremony: ceremony as never,
      navigate: vi.fn(),
      storage: noStorage,
    })
    expect(await model.ensureSession()).toBe(true)
    expect(ceremony).not.toHaveBeenCalled()
  })

  it('runs the ceremony on probe 401 and returns true on verified login', async () => {
    const { http, calls } = makeScriptedHttp({
      '/api/auth/session': [{ status: 401 }],
      '/api/auth/login/options': [{ status: 200, body: { options: { challenge: 'x' } } }],
      '/api/auth/login/verify': [{ status: 200, body: { accountId: 'a', credentialId: 'c' } }],
    })
    const ceremony = vi.fn(async () => ({ id: 'c' }))
    const model = makeReloginModel({
      http,
      startAuthenticationCeremony: ceremony as never,
      navigate: vi.fn(),
      storage: { get: () => 'hint-1', clear: vi.fn() },
    })

    expect(await model.ensureSession()).toBe(true)
    expect(ceremony).toHaveBeenCalledTimes(1)
    const optionsCall = calls.find((c) => c.url === '/api/auth/login/options')
    expect(optionsCall?.json).toEqual({ credentialIdHint: 'hint-1' })
  })

  it('coalesces concurrent calls into one flight', async () => {
    const { http, calls } = makeScriptedHttp({
      '/api/auth/session': [{ status: 200, body: {} }],
    })
    const model = makeReloginModel({
      http,
      startAuthenticationCeremony: vi.fn() as never,
      navigate: vi.fn(),
      storage: noStorage,
    })
    const [a, b, c] = await Promise.all([
      model.ensureSession(),
      model.ensureSession(),
      model.ensureSession(),
    ])
    expect([a, b, c]).toEqual([true, true, true])
    expect(calls.length).toBe(1)
  })

  it('redirects to / and returns false when the ceremony is cancelled', async () => {
    const { http } = makeScriptedHttp({
      '/api/auth/session': [{ status: 401 }],
      '/api/auth/login/options': [{ status: 200, body: { options: { challenge: 'x' } } }],
    })
    const navigate = vi.fn()
    const storage = { get: () => 'hint', clear: vi.fn() }
    const model = makeReloginModel({
      http,
      startAuthenticationCeremony: vi.fn(async () => {
        throw new Error('NotAllowedError')
      }) as never,
      navigate,
      storage,
    })

    expect(await model.ensureSession()).toBe(false)
    expect(navigate).toHaveBeenCalledWith('/')
    expect(storage.clear).toHaveBeenCalled()
  })

  it('returns false without redirect when the probe network-fails (offline)', async () => {
    const { http } = makeScriptedHttp({ '/api/auth/session': ['network-error'] })
    const navigate = vi.fn()
    const model = makeReloginModel({
      http,
      startAuthenticationCeremony: vi.fn() as never,
      navigate,
      storage: noStorage,
    })
    expect(await model.ensureSession()).toBe(false)
    expect(navigate).not.toHaveBeenCalled()
  })

  it('allows a fresh flight after the previous one settles', async () => {
    const { http, calls } = makeScriptedHttp({
      '/api/auth/session': [
        { status: 200, body: {} },
        { status: 200, body: {} },
      ],
    })
    const model = makeReloginModel({
      http,
      startAuthenticationCeremony: vi.fn() as never,
      navigate: vi.fn(),
      storage: noStorage,
    })
    await model.ensureSession()
    await model.ensureSession()
    expect(calls.length).toBe(2)
  })
})
```

- [ ] **Step 2: Run to verify failure**

Run: `pnpm --filter client exec vitest run src/session/model/relogin.test.ts`
Expected: FAIL — module missing.

- [ ] **Step 3: Implement `relogin.ts`**

```ts
import { HttpClient, type HttpLike } from '@shared/http/client'
import type { Navigate } from '@shared/navigation'
import { action, atom, wrap } from '@reatom/core'
import { startAuthentication } from '@simplewebauthn/browser'

// Same non-secret localStorage hint the activation app maintains
// (packages/client/activation/src/model/activation-model.ts).
export const CRED_HINT_STORAGE_KEY = 'mb_cred_hint'

export interface ReloginDeps {
  http: HttpLike
  startAuthenticationCeremony: typeof startAuthentication
  navigate: Navigate
  storage: { get(): string | null; clear(): void }
}

export interface ReloginModel {
  /** Single-flight session recovery: true — retry the failed request. */
  ensureSession: () => Promise<boolean>
}

function defaultStorage(): ReloginDeps['storage'] {
  return {
    get: () =>
      typeof localStorage === 'undefined' ? null : localStorage.getItem(CRED_HINT_STORAGE_KEY),
    clear: () => {
      if (typeof localStorage !== 'undefined') localStorage.removeItem(CRED_HINT_STORAGE_KEY)
    },
  }
}

export function makeReloginModel(overrides: Partial<ReloginDeps> = {}): ReloginModel {
  const deps: ReloginDeps = {
    // Own bare client (no retry hook): the re-login path must never recurse
    // into itself; building it here also keeps runtime.ts → relogin.ts acyclic.
    http: overrides.http ?? new HttpClient(),
    startAuthenticationCeremony: overrides.startAuthenticationCeremony ?? startAuthentication,
    navigate: overrides.navigate ?? ((path) => window.location.assign(path)),
    storage: overrides.storage ?? defaultStorage(),
  }

  const inflight = atom<Promise<boolean> | null>(null, 'relogin.inflight')

  async function run(): Promise<boolean> {
    // Probe first: distinguishes "session expired" (401 → ceremony) from
    // transport failures (offline-first: report false, change nothing) and
    // spurious per-endpoint 401s (200 → the session is fine, just retry).
    const probe = await deps.http.get('/api/auth/session')
    if (probe instanceof Error) return false
    if (probe.ok) return true
    if (probe.status !== 401) return false

    const bail = (): false => {
      deps.storage.clear()
      deps.navigate('/')
      return false
    }

    const hint = deps.storage.get()
    const optionsRes = await deps.http.post('/api/auth/login/options', {
      json: hint ? { credentialIdHint: hint } : {},
    })
    if (optionsRes instanceof Error || !optionsRes.ok) return bail()

    const options = (
      optionsRes.body as
        | { options?: Parameters<typeof startAuthentication>[0]['optionsJSON'] }
        | undefined
    )?.options
    if (!options) return bail()

    const assertion = await deps
      .startAuthenticationCeremony({ optionsJSON: options })
      .catch(() => null)
    if (assertion === null) return bail()

    const verifyRes = await deps.http.post('/api/auth/login/verify', {
      json: { authenticationResponse: assertion },
    })
    if (verifyRes instanceof Error || !verifyRes.ok) return bail()

    return true
  }

  const ensureSession = action(async () => {
    const existing = inflight()
    if (existing) return existing

    const clear = wrap(() => inflight.set(null))
    const promise = run().finally(clear)
    inflight.set(promise)
    return promise
  }, 'relogin.ensureSession')

  return { ensureSession: () => ensureSession() }
}
```

(No CSRF/`credentials` code — both come from `HttpClient`. No module-level instance either — instance ownership belongs to the composition root (Task 9), and a singleton here would be exactly the module state this plan removes elsewhere. Existing `create*` factory names elsewhere in the codebase stay; new factories are `make*`.)

- [ ] **Step 4: Run to verify pass**

Run: `pnpm --filter client exec vitest run src/session/model/relogin.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
rtk git add packages/client/src/session
rtk git commit -m "feat(client): single-flight ensureSession relogin model on the HttpClient port"
```

---

### Task 9: Composition roots — board `runtime.ts`, consumer migration, devices-http on the port, logout purge

**Files:**
- Create: `packages/client/src/runtime.ts` (the board's composition root)
- Modify: `packages/client/src/widget-host/ui/WidgetFrame.tsx` (use `hostRuntime`)
- Modify: `packages/client/src/board/model/storage.ts` (`rootStorage` via `hostRuntime`)
- Modify: `packages/widgets/clock/dev/harness.tsx`, `packages/widgets/ofelia-poop-duty/dev/harness.tsx` (bare `makeHostRuntime()`)
- Modify: `packages/widgets/clock/ui/Clock.test.tsx`, `packages/widgets/ofelia-poop-duty/ui/OfeliaPoopDuty.test.tsx` (if they call the free factories — same one-line swap)
- Modify: `packages/client/src/account/model/devices-http.ts` + `devices-http.test.ts` (port-based `request`)
- Modify: `packages/client/src/account/model/account-model.ts` + test (required `http` dep, `openEventStream` port for device events, `bareHttp`, logout purge)
- Modify: `packages/client/src/account/model/add-device-model.ts` + tests, `packages/client/src/account/ui/AddDeviceModal.test.tsx` (required `http` dep)
- Modify: `packages/client/src/account/ui/AccountMenu.tsx`, `packages/client/src/account/ui/MyDevicesDialog.tsx` (UI wiring passes `http` from `@/runtime`)
- Create: `packages/client/src/session/model/purge.ts` + `purge.test.ts`
- Modify: `packages/widget-runtime/src/host-runtime.ts` (delete the transitional free factories + default runtime)
- Modify: `packages/widget-runtime/src/storage/storage.test.ts`, `packages/widget-runtime/src/index.test.ts` (construct via `makeHostRuntime`)

**Interfaces:**
- Consumes: `makeHostRuntime`, `purgeLocalData` from `widget-runtime`; `HttpClient`, `HttpLike`, `makeUnauthorizedRetryHook` from `@shared/http/client`; `makeReloginModel` from `@/session/model/relogin`; `OpenEventStream`, `makeEventSourceStream` from `@shared/http/event-stream`; `makeScriptedHttp`, `makeFakeOpenEventStream` (tests).
- Produces:
  - `@/runtime`: the board's private relogin instance, `export const http: HttpClient` (the ONE retry-hooked board client), and `export const hostRuntime: HostRuntime` built with `{ http, onUnauthorized }` — board models (via UI wiring), storage, widget API, and SSE subscribe all share this client.
  - `devices-http.ts`: every exported function's first parameter becomes `http: HttpLike` (was `fetchImpl: typeof fetch`); behavior contract otherwise unchanged, plus: a non-2xx without a JSON body (bare nginx 401) now maps to `DeviceApiError` with `code: 'unknown_error'`, not a transport error.
  - Account models: `http: HttpLike` becomes a **required** dep (no default — model modules never import `@/runtime`; the UI wiring passes the client); `AccountDeps` swaps `eventSourceCtor?: typeof EventSource` for `openEventStream: OpenEventStream` (default `makeEventSourceStream()`); `createAddDeviceModel` loses its dead `accountModel` default.
  - `purgeLocalSession(): Promise<void>` in `@/session/model/purge`; `AccountDeps` gains `purge: () => Promise<void>` (default `purgeLocalSession`) and `bareHttp: HttpLike` (default `new HttpClient()`) for logout.
- After this task **no transitional factory exists**: the only way to obtain storage/api is a `HostRuntime` from a composition root.

- [ ] **Step 1: The board composition root**

`packages/client/src/runtime.ts`:

```ts
import { HttpClient, makeUnauthorizedRetryHook } from '@shared/http/client'
import { makeHostRuntime } from 'widget-runtime'

import { makeReloginModel } from '@/session/model/relogin'

/** The app's single relogin instance — built here, at the root, not as a
 * module singleton inside the model. */
const relogin = makeReloginModel()

/** Board-wide HTTP: silent 401 re-login via a single forced replay. */
export const http = new HttpClient({
  onResponse: [makeUnauthorizedRetryHook(relogin.ensureSession)],
})

/** The board's single widget-runtime composition root (one per document).
 * Shares the board client — onUnauthorized only drives SSE reconnect. */
export const hostRuntime = makeHostRuntime({
  http,
  onUnauthorized: relogin.ensureSession,
})
```

(`relogin.ts` builds its own bare client and does not import this module — the graph is `runtime.ts` → `relogin.ts`, acyclic. Anything else needing `ensureSession` would import it from here, never from the model module.)

- [ ] **Step 2: devices-http on the port (test first)**

Rework `packages/client/src/account/model/devices-http.test.ts` onto `makeScriptedHttp`. Representative rewrites (port every case in this style — the old `as unknown as typeof fetch` casts all disappear); the old "retries once through ensureSession" cases are **replaced** by the bare-401 mapping case (the retry now lives in the board client's hook, covered by Task 5):

```ts
import { makeScriptedHttp } from '@shared/http/test/scripted-http'

it('fetchAccount returns the account payload', async () => {
  const { http } = makeScriptedHttp({
    '/api/auth/account': [{ status: 200, body: { id: 'a', name: 'N', deviceLimit: 10 } }],
  })
  expect(await fetchAccount(http)).toEqual({ id: 'a', name: 'N', deviceLimit: 10 })
})

it('maps a bare-bodied 401 (nginx gate) to DeviceApiError, not a transport error', async () => {
  const { http } = makeScriptedHttp({ '/api/auth/account': [{ status: 401 }] })
  const result = await fetchAccount(http)
  expect(result).toBeInstanceOf(DeviceApiError)
  expect(result).toMatchObject({ status: 401, code: 'unknown_error' })
})

it('maps transport failures to DeviceHttpError', async () => {
  const { http } = makeScriptedHttp({ '/api/auth/account': ['network-error'] })
  expect(await fetchAccount(http)).toBeInstanceOf(DeviceHttpError)
})
```

(Check the file's existing URL fixtures for the exact paths — keep them.) Run → FAIL.

Rewrite the `request` helper in `devices-http.ts` (the exported functions only swap their first parameter's type; their bodies keep calling `request`):

```ts
import type { HttpLike } from '@shared/http/client'

type RequestOptions = {
  method?: 'GET' | 'POST'
  body?: unknown
}

async function request<T>(
  http: HttpLike,
  url: string,
  options: RequestOptions = {},
): Promise<Error | T> {
  const res =
    options.method === 'POST'
      ? await http.post(url, options.body !== undefined ? { json: options.body } : undefined)
      : await http.get(url)
  if (res instanceof Error) {
    return new DeviceHttpError({ reason: 'сбой сетевого запроса', cause: res })
  }

  // 204 No Content is the success response for deny/revoke/logout.
  if (res.status === 204) return undefined as T

  if (!res.ok) {
    const code =
      typeof (res.body as { code?: unknown } | undefined)?.code === 'string'
        ? (res.body as { code: string }).code
        : 'unknown_error'
    return new DeviceApiError({ code, status: res.status })
  }

  return res.body as T
}
```

Change every exported function signature from `(fetchImpl: typeof fetch, ...)` to `(http: HttpLike, ...)` (`fetchAccount`, `fetchDevices`, `approveDevice`, `denyDevice`, `revokeDevice`, `logout`, `fetchAddTokenOptions`, `mintAddToken` — match the file's actual export list). Run → PASS.

- [ ] **Step 3: account models on the port**

In `packages/client/src/account/model/account-model.ts` and `packages/client/src/account/model/add-device-model.ts`:

1. Replace the `fetchImpl: typeof fetch` dep with **required** `http: HttpLike` — no default. A model must not import `@/runtime` for a fallback: that points a model at the composition root and executes the root's import side effects (relogin model, clients, hostRuntime) in every unit test. Factory signatures become `createAccountModel(deps: Partial<AccountDeps> & { http: HttpLike })` (same shape for `createAddDeviceModel`); every `deps.fetchImpl` argument to a devices-http function becomes `deps.http`.
2. The UI wiring passes the board client — the UI layer is the app's binding point (it already imports `hostRuntime` in `WidgetFrame`). In `AccountMenu.tsx` and `MyDevicesDialog.tsx`:

```ts
import { http } from '@/runtime'
// ...
const [model] = useState(() => modelOverride ?? createAccountModel({ http }))
```

3. `createAddDeviceModel` loses its dead `accountModel: overrides.accountModel ?? createAccountModel()` default — `accountModel` becomes required (production always passes it, tests already do).
4. `AccountDeps` swaps `eventSourceCtor?: typeof EventSource` for `openEventStream: OpenEventStream` (default `makeEventSourceStream()` — a local, import-free construction) and `connectEvents` moves onto the port, retiring the last raw `EventSource` in client models:

```ts
function connectEvents(): () => void {
  const stream = deps.openEventStream('/api/auth/devices/events', {
    onMessage: wrap((message) => {
      const parsed = parseDeviceEventMessage(message.data)
      if (parsed) void refresh()
    }),
  })
  return () => stream.close()
}
```

No re-auth reconnect here — deliberate asymmetry with the storage SSE manager, documented in a comment: device events live only while the devices dialog is open, and every action in that dialog goes through the retry-hooked `http`, which heals the session by itself.

5. `account-model.ts` additionally gains `bareHttp: HttpLike` (default `new HttpClient()` — a local construction, so a default is fine here) — see Step 5.

Port the deps fixtures in `account-model.test.ts`, `add-device-model.test.ts`, and `AddDeviceModal.test.tsx` from `Response`-mock `fetchImpl`s to `makeScriptedHttp` (same URL scripts, `{ status, body }` steps instead of `new Response(JSON.stringify(...))`); `connectEvents` cases move from fake `EventSource` constructors to `makeFakeOpenEventStream()`. `AccountMenu.test.tsx` / `MyDevicesDialog.test.tsx` fixtures pass their scripted `http` explicitly (they already pass overrides).

Run: `pnpm --filter client exec vitest run src/account` → PASS.

- [ ] **Step 4: `purgeLocalSession` (test first)**

`packages/client/src/session/model/purge.test.ts`:

```ts
import { describe, expect, it, vi } from 'vitest'

vi.mock('widget-runtime', () => ({ purgeLocalData: vi.fn(async () => undefined) }))

import { purgeLocalData } from 'widget-runtime'

import { purgeLocalSession } from './purge'

describe('purgeLocalSession', () => {
  it('purges Dexie, caches, and service workers', async () => {
    const cacheDelete = vi.fn(async () => true)
    vi.stubGlobal('caches', { keys: async () => ['a', 'b'], delete: cacheDelete })
    const unregister = vi.fn(async () => true)
    vi.stubGlobal('navigator', {
      serviceWorker: { getRegistrations: async () => [{ unregister }] },
    })

    await purgeLocalSession()

    expect(purgeLocalData).toHaveBeenCalledTimes(1)
    expect(cacheDelete).toHaveBeenCalledWith('a')
    expect(cacheDelete).toHaveBeenCalledWith('b')
    expect(unregister).toHaveBeenCalledTimes(1)
    vi.unstubAllGlobals()
  })

  it('survives environments without caches/serviceWorker', async () => {
    vi.stubGlobal('navigator', {})
    await expect(purgeLocalSession()).resolves.toBeUndefined()
    vi.unstubAllGlobals()
  })
})
```

`packages/client/src/session/model/purge.ts`:

```ts
import { purgeLocalData } from 'widget-runtime'

/**
 * Local-data hygiene on logout: Dexie board data, every Cache Storage cache
 * (the PWA precache included), and the service worker registration. Runs
 * best-effort — a failed step must not block the logout redirect.
 */
export async function purgeLocalSession(): Promise<void> {
  await purgeLocalData().catch(() => undefined)

  if (typeof caches !== 'undefined') {
    const keys = await caches.keys().catch(() => [] as string[])
    await Promise.all(keys.map((key) => caches.delete(key).catch(() => false)))
  }

  if (typeof navigator !== 'undefined' && 'serviceWorker' in navigator) {
    const registrations = await navigator.serviceWorker.getRegistrations().catch(() => [])
    await Promise.all(registrations.map((reg) => reg.unregister().catch(() => false)))
  }
}
```

Run: `pnpm --filter client exec vitest run src/session/model/purge.test.ts` → PASS.

- [ ] **Step 5: Logout purge + bare client in the account model (test first)**

In `packages/client/src/account/model/account-model.test.ts`, extend the deps the file's helper builds with `purge: vi.fn(async () => undefined)` and assert order:

```ts
it('purges local data after server logout and before navigation', async () => {
  const order: string[] = []
  // extend the file's existing deps helper: script POST /api/auth/logout → 204 on bareHttp
  const deps = {
    bareHttp: makeScriptedHttp({ '/api/auth/logout': [{ status: 204 }] }).http,
    purge: vi.fn(async () => {
      order.push('purge')
    }),
    navigate: vi.fn(() => {
      order.push('navigate')
    }),
  }
  // build the model with these overrides using the file's existing helper
  await model.logout()
  expect(order).toEqual(['purge', 'navigate'])
})
```

In `account-model.ts`:

1. `AccountDeps` gains `purge: () => Promise<void>` (default `overrides.purge ?? purgeLocalSession`, import from `@/session/model/purge`) and `bareHttp: HttpLike` (default `overrides.bareHttp ?? new HttpClient()`).
2. The `logout` action body, after the successful `logoutRequest`, becomes:

```ts
const logout = action(async () => {
  error.set(null)

  // Bare client deliberately: a dead session is already logged out — running
  // a WebAuthn ceremony in order to log out would be absurd.
  const result = await wrap(logoutRequest(deps.bareHttp))
  if (result instanceof Error) {
    error.set(describeDeviceError(result))
    return
  }

  await wrap(deps.purge().catch(() => undefined))
  deps.navigate('/')
}, 'account.logout').extend(withAsync())
```

Run: `pnpm --filter client exec vitest run src/account/model/account-model.test.ts` → PASS.

- [ ] **Step 6: Migrate the remaining consumers and delete the transitional factories**

1. `packages/client/src/widget-host/ui/WidgetFrame.tsx` — drop `makeWidgetApi`/`makeWidgetStorage` from the `widget-runtime` import; import `{ hostRuntime }` from `'@/runtime'`; the two `useMemo`s become `hostRuntime.makeWidgetStorage({ instanceId, typeId })` / `hostRuntime.makeWidgetApi({ instanceId, typeId })`.
2. `packages/client/src/board/model/storage.ts`:

```ts
import { hostRuntime } from '@/runtime'

export const rootStorage = hostRuntime.makeScopedStorage('root')
```

3. Both dev harnesses (`packages/widgets/clock/dev/harness.tsx`, `packages/widgets/ofelia-poop-duty/dev/harness.tsx`):

```ts
import { makeHostRuntime, WidgetRuntimeContext } from 'widget-runtime'

const runtime = makeHostRuntime() // bare: no auth anywhere in a harness

// in harnessProps():
storage: runtime.makeWidgetStorage({ instanceId: `dev:${DEV_ID}`, typeId: DEV_ID }),
api: runtime.makeWidgetApi({ instanceId: `dev:${DEV_ID}`, typeId: DEV_ID }),
```

4. `packages/widgets/clock/ui/Clock.test.tsx` (and `OfeliaPoopDuty.test.tsx` if it does the same): `makeWidgetStorage({...})` → `makeHostRuntime().makeWidgetStorage({...})`.
5. `packages/widget-runtime/src/storage/storage.test.ts` and `src/index.test.ts`: construct via `makeHostRuntime()` (for storage.test.ts pass `makeScriptedHttp({}).http` to avoid network); `index.test.ts` asserts `runtime.makeHostRuntime` is exported instead of the free factories.
6. Delete from `packages/widget-runtime/src/host-runtime.ts`: `defaultRuntime`, `getDefaultRuntime`, and the three `@deprecated` wrappers. `rtk grep "makeWidgetStorage\|makeScopedStorage\|makeWidgetApi" packages` must show only `HostRuntime` members, internal implementations, and their tests.

- [ ] **Step 7: Full client suite + typecheck**

Run: `pnpm --filter client test && pnpm --filter widget-runtime test && pnpm typecheck`
Expected: PASS.

- [ ] **Step 8: Commit**

```bash
rtk git add packages/client/src packages/widgets packages/widget-runtime/src
rtk git commit -m "feat(client): composition roots on makeHostRuntime; devices-http on the HttpClient port; logout purge"
```

---

### Task 10: Test routes (seed-session / expire-sessions / revoke-device) + prod test mode + compose passthrough

**Files:**
- Modify: `packages/server/src/auth/handlers.ts` (export `sessionCookieFor`)
- Modify: `packages/server/src/app.ts` (three new `/api/test/*` routes inside the existing `deps.testControls` block)
- Modify: `packages/server/src/app.test.ts` (route tests)
- Create: `packages/server/src/test-controls.ts`
- Modify: `packages/server/src/index.ts` (enable test mode via `ALLOW_TEST_DB_RESET=1`)
- Modify: `docker-compose.yml` (env passthrough)

**Interfaces:**
- Consumes: `createAccount`, `addDeviceToAccount` from `./auth/accounts`; `storeDevice`, `revokeDevice` from `./auth/devices`; `issueSession` from `./auth/sessions`; `sessionCookieFor` from `./auth/handlers` (newly exported).
- Produces:
  - `POST /api/test/seed-session` → `200 { accountId, credentialId, sessionId }` + `Set-Cookie` with a live session.
  - `POST /api/test/expire-sessions` → `204`, deletes every `session:*` key.
  - `POST /api/test/revoke-device` body `{ credentialId }` → `204` (runs the real `revokeDevice`).
  - `makeTestControls(ops: ValkeyOps): { now: () => number; controls: TestControls }` in `test-controls.ts`.

- [ ] **Step 1: Write the failing tests**

Append to `packages/server/src/app.test.ts` (inside the existing describe that has `testControls` enabled; reuse its `base` and `ops`):

```ts
it('seed-session issues a working session cookie', async () => {
  const res = await fetch(`${base}/api/test/seed-session`, { method: 'POST' })
  expect(res.status).toBe(200)
  const { accountId, credentialId } = (await res.json()) as {
    accountId: string
    credentialId: string
  }
  expect(accountId).toBeTruthy()

  const cookie = res.headers.get('set-cookie')!.split(';')[0]
  const session = await fetch(`${base}/api/auth/session`, { headers: { cookie } })
  expect(session.status).toBe(200)
  expect(await session.json()).toEqual({ accountId })

  // expire-sessions kills it
  await fetch(`${base}/api/test/expire-sessions`, { method: 'POST' })
  expect((await fetch(`${base}/api/auth/session`, { headers: { cookie } })).status).toBe(401)
})

it('revoke-device cuts a seeded session on the next request', async () => {
  const res = await fetch(`${base}/api/test/seed-session`, { method: 'POST' })
  const { credentialId } = (await res.json()) as { credentialId: string }
  const cookie = res.headers.get('set-cookie')!.split(';')[0]

  await fetch(`${base}/api/test/revoke-device`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ credentialId }),
  })
  expect((await fetch(`${base}/api/auth/session`, { headers: { cookie } })).status).toBe(401)
})
```

- [ ] **Step 2: Run to verify failure**

Run: `pnpm --filter server exec vitest run src/app.test.ts`
Expected: FAIL — 404 on the new routes.

- [ ] **Step 3: Implement**

Export the cookie helper in `handlers.ts`: change `function sessionCookieFor(` to `export function sessionCookieFor(`.

In `app.ts`, inside the `if (deps.testControls)` block, add (new imports: `addDeviceToAccount` from `./auth/accounts`, `createAccount` is already imported? it is **not** — add it; `storeDevice`, `revokeDevice` from `./auth/devices`; `issueSession` from `./auth/sessions`; `sessionCookieFor` from `./auth/handlers`):

```ts
router.on('POST', '/api/test/seed-session', async (_req, res) => {
  const account = await createAccount(ops, now, { name: 'E2E', inviteId: 'test-seed' })
  const credentialId = randomUUID()
  const createdAt = now()
  await storeDevice(ops, {
    credentialId,
    publicKey: 'test-seed',
    signCount: 0,
    label: 'e2e seeded',
    createdAt,
    lastSeenAt: createdAt,
    disabled: false,
    accountId: account.id,
    status: 'active',
    addedVia: 'invite',
  })
  await addDeviceToAccount(ops, account.id, credentialId, { countsAgainstLimit: false })
  const session = await issueSession(ops, deps.authConfig, now, {
    accountId: account.id,
    credentialId,
  })
  res.writeHead(200, {
    'content-type': 'application/json',
    'set-cookie': sessionCookieFor(
      deps.authConfig,
      session.sessionId,
      deps.authConfig.sessionTtlSlidingMs,
    ),
  })
  res.end(
    JSON.stringify({ accountId: account.id, credentialId, sessionId: session.sessionId }),
  )
})

router.on('POST', '/api/test/expire-sessions', async (_req, res) => {
  const keys = await ops.scanKeys('session:')
  for (const key of keys) await ops.del(key)
  res.writeHead(204)
  res.end()
})

const RevokeDeviceBodySchema = z.object({ credentialId: z.string().min(1) })

router.on('POST', '/api/test/revoke-device', async (req, res) => {
  let raw: unknown
  try {
    raw = await readJsonBody(req)
  } catch {
    res.writeHead(400)
    res.end()
    return
  }
  const parsed = RevokeDeviceBodySchema.safeParse(raw)
  if (!parsed.success) {
    res.writeHead(422, { 'content-type': 'application/json' })
    res.end(JSON.stringify(formatZodError(parsed.error)))
    return
  }
  await revokeDevice(ops, parsed.data.credentialId)
  res.writeHead(204)
  res.end()
})
```

`packages/server/src/test-controls.ts`:

```ts
import type { TestControls } from './app'
import type { ValkeyOps } from './storage/valkey'

/**
 * Test mode for the production entry: enabled only by ALLOW_TEST_DB_RESET=1
 * (the same guard the dedicated test-server uses). Gives the dockerized nginx
 * e2e suite time control, reset, and the /api/test seeding routes.
 */
export function makeTestControls(ops: ValkeyOps): {
  now: () => number
  controls: TestControls
} {
  let offset = 0
  return {
    now: () => Date.now() + offset,
    controls: {
      setNow: (ms) => {
        offset = ms - Date.now()
      },
      reset: async () => {
        const keys = await ops.scanKeys('')
        for (const key of keys) await ops.del(key)
      },
    },
  }
}
```

`packages/server/src/index.ts` — replace the `createApp` call block:

```ts
import { makeTestControls } from './test-controls'
// ...
const ops = createValkeyOps()
const testSetup = process.env.ALLOW_TEST_DB_RESET === '1' ? makeTestControls(ops) : undefined

const { server } = createApp({
  ops,
  subscribe: (onMessage) => createValkeySubscriber('storage:events', onMessage),
  now: testSetup?.now ?? Date.now,
  widgetRegistry: productionWidgetServerRegistry,
  browserClient,
  authConfig,
  ...(testSetup ? { testControls: testSetup.controls } : {}),
})
```

`docker-compose.yml` — in the `server` service `environment` block add:

```yaml
      # Test seeding/reset endpoints for the nginx e2e suite. NEVER set in
      # production; empty/absent keeps them disabled.
      ALLOW_TEST_DB_RESET: ${ALLOW_TEST_DB_RESET:-}
```

- [ ] **Step 4: Run tests**

Run: `pnpm --filter server test`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
rtk git add packages/server/src docker-compose.yml
rtk git commit -m "feat(server): e2e session seeding routes and opt-in test mode for the prod entry"
```

---

### Task 11: The gate — nginx.conf + rpi.toml

**Files:**
- Modify: `packages/client/nginx.conf` (full rewrite below)
- Modify: `rpi.toml` (hostname + 401 healthcheck + ops `[commands]`)

**Interfaces:**
- Consumes: `GET /api/auth/session` (the Plan-1 verifier — 200/401), the activation build at `/usr/share/nginx/html/activate/`.
- Produces: the gate contract Tasks 12–13 test: no cookie ⇒ `/` = 401 + activation HTML, assets/API = bare 401, allowlist = reachable; cookie ⇒ everything 200; `/api/auth/*` limited 30 r/min (burst 15), `pending-status` 60 r/min (burst 10).

- [ ] **Step 1: Replace `packages/client/nginx.conf`**

```nginx
# Auth-gate zones: keyed by the real client IP ($binary_remote_addr after the
# real_ip block below). A login ceremony is a burst of ~5 requests, so the
# auth zone gets a generous burst; pending-status polls every ~2s and gets its
# own zone so device-B polling never starves the auth endpoints.
limit_req_zone $binary_remote_addr zone=auth_zone:1m rate=30r/m;
limit_req_zone $binary_remote_addr zone=pending_zone:1m rate=60r/m;
limit_req_status 429;

server {
    listen 80;
    server_name _;
    root /usr/share/nginx/html;
    index index.html;

    # The app can sit behind a host/pi ingress proxy before this nginx container.
    # Trust private-network proxy hops so $remote_addr becomes the real client
    # from X-Forwarded-For (cloudflared populates it) before rate limiting and
    # before /api requests are proxied to the Node server.
    set_real_ip_from 127.0.0.1;
    set_real_ip_from 10.0.0.0/8;
    set_real_ip_from 172.16.0.0/12;
    set_real_ip_from 192.168.0.0/16;
    real_ip_header X-Forwarded-For;
    real_ip_recursive on;

    # Runtime DNS resolver (Docker's embedded DNS) so a restarted `server`
    # container with a new IP is picked up without restarting nginx.
    resolver 127.0.0.11 valid=10s;
    set $upstream http://server:8787;

    # ---- auth_request verifier -------------------------------------------
    # Every gated request triggers this subrequest. The verifier must always
    # see a bodyless GET regardless of the original request's method/body.
    location = /internal/auth {
        internal;
        proxy_pass $upstream/api/auth/session;
        proxy_method GET;
        proxy_pass_request_body off;
        proxy_set_header Content-Length "";
        proxy_set_header X-Original-URI $request_uri;
    }

    # ---- public: activation app (static, ungated) ------------------------
    # The activation build ships with base /activate/ so its HTML and assets
    # all live under this prefix; unknown sub-paths fall back to its shell.
    location /activate/ {
        try_files $uri /activate/index.html;
    }

    location = /add-device {
        try_files /activate/index.html =404;
    }

    # ---- public: auth API (rate limited, session checks live in Node) ----
    location = /api/auth/devices/pending-status {
        limit_req zone=pending_zone burst=10 nodelay;
        proxy_pass $upstream$request_uri;
        proxy_http_version 1.1;
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
    }

    location /api/auth/ {
        limit_req zone=auth_zone burst=15 nodelay;
        proxy_pass $upstream$request_uri;
        proxy_http_version 1.1;
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
    }

    # ---- public: e2e seeding (server-side dead without ALLOW_TEST_DB_RESET=1)
    location /api/test/ {
        proxy_pass $upstream$request_uri;
        proxy_http_version 1.1;
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
    }

    # ---- gated: everything else under /api -------------------------------
    location /api/ {
        auth_request /internal/auth;
        proxy_pass $upstream$request_uri;
        proxy_http_version 1.1;
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
    }

    # ---- gated: board statics (bare 401, no activation fallback) ---------
    location /assets/ {
        auth_request /internal/auth;
        try_files $uri =404;
    }

    # Federation assets are real release files. Never fall back to index.html:
    # a missing remote/chunk must be a 404 so WidgetErrorBoundary gets a real
    # load failure instead of trying to parse the SPA shell as JavaScript.
    location ~ ^/widgets/[^/]+/remoteEntry\.js$ {
        auth_request /internal/auth;
        try_files $uri =404;
        add_header Cache-Control "no-cache" always;
    }

    location /widgets/ {
        auth_request /internal/auth;
        try_files $uri =404;
    }

    # ---- gated: SPA shell and navigations ---------------------------------
    # 401 here (and only here) serves the activation page in login mode; the
    # URL does not change and the status stays 401 (the rpi healthcheck
    # asserts exactly that — the deploy is healthy only if the door is locked).
    location / {
        auth_request /internal/auth;
        error_page 401 /activate/index.html;
        try_files $uri $uri/ /index.html;
    }
}
```

- [ ] **Step 2: Update `rpi.toml`**

```toml
[ingress]
service = "client"
port = 80
expose = "lan"
hostname = "board.iiskelo.com"

[healthcheck]
# With the gate on, / answers 401 (activation page) for anonymous probes.
# Expecting 401 checks the whole nginx -> auth_request -> server -> Valkey
# chain AND that the door is locked: if the gate ever disappears, / returns
# 200 and the deploy fails as unhealthy.
path = "/"
expect = "401"
timeout = "60s"
```

Also append the five ops scripts from Tasks 3–4 (same table shape as the
existing `create-invite` entry) plus a Valkey backup, so every ops action is
one `rpi command <name>` from the dev machine (extra args pass through after
`--`, e.g. `rpi command revoke-device -- --credential-id <id>`):

```toml
[commands.list-devices]
run = "node dist/scripts/list-devices.cjs"
service = "server"

[commands.revoke-device]
run = "node dist/scripts/revoke-device.cjs"
service = "server"

[commands.revoke-invite]
run = "node dist/scripts/revoke-invite.cjs"
service = "server"

[commands.revoke-account]
run = "node dist/scripts/revoke-account.cjs"
service = "server"

[commands.mint-add-device-token]
run = "node dist/scripts/mint-add-device-token.cjs"
service = "server"

# Logical backup INSIDE the valkey_data volume: SAVE is synchronous (fine at
# this DB size), the dated copy survives FLUSHDB and bad deploys (files are
# not keys) — but not volume deletion. Restore = stop stack, copy a dump over
# /data/dump.rdb, start with AOF disabled once (or delete the AOF files).
[commands.backup]
run = "sh -c 'valkey-cli SAVE && mkdir -p /data/backups && cp /data/dump.rdb /data/backups/dump-$(date +%Y%m%d-%H%M%S).rdb && ls -lh /data/backups'"
service = "valkey"
```

(`[ingress]`, `[healthcheck]`, and `[commands]` change; the rest of the file
stays. The `run` string is shell-word split with quotes respected, so the
`sh -c '...'` one-liner is a single argv element — same pattern as the
rpi.toml schema's own backup example.)

- [ ] **Step 3: Verify the config parses and the gate closes**

```powershell
$env:ALLOW_TEST_DB_RESET = '1'
pnpm start:docker
```

Wait for healthy, then:

```powershell
curl.exe -s -o NUL -w "%{http_code}" http://127.0.0.1:8080/            # expect 401
curl.exe -s http://127.0.0.1:8080/ | Select-String "активация"          # activation HTML served
curl.exe -s -o NUL -w "%{http_code}" http://127.0.0.1:8080/assets/x.js  # expect 401
curl.exe -s -o NUL -w "%{http_code}" http://127.0.0.1:8080/activate/    # expect 200
curl.exe -s -o NUL -w "%{http_code}" http://127.0.0.1:8080/api/auth/session  # expect 401 (reachable, JSON)
```

- [ ] **Step 4: Commit**

```bash
rtk git add packages/client/nginx.conf rpi.toml
rtk git commit -m "feat(gate): enable nginx auth_request gate, rate limits, 401 healthcheck"
```

---

### Task 12: nginx suite — config, smoke update, request-level gate tests

**Files:**
- Modify: `packages/client/playwright.nginx.config.ts` (two spec files, one worker)
- Create: `packages/client/e2e/support/gate.ts`
- Modify: `packages/client/e2e/nginx-smoke.spec.ts` (seed a session first)
- Create: `packages/client/e2e/nginx-gate.spec.ts` (request-level matrix; browser journeys arrive in Task 13; the rate-limit test MUST stay the last test in the file)

**Interfaces:**
- Consumes: `/api/test/seed-session`, `/api/test/expire-sessions`, `/api/test/revoke-device`, `/api/test/seed-invite` (Task 10) through the nginx origin; the stack from Task 11 running with `ALLOW_TEST_DB_RESET=1`.
- Produces: `seedSession(request): Promise<{ accountId: string; credentialId: string; sessionId: string }>`, `expireSessions(request)`, `revokeDeviceViaGate(request, credentialId)`, `seedInviteViaGate(request): Promise<{ token: string }>` in `e2e/support/gate.ts`.

- [ ] **Step 1: Playwright config**

`packages/client/playwright.nginx.config.ts`:

```ts
import { defineConfig, devices } from '@playwright/test'

export default defineConfig({
  testDir: 'e2e',
  testMatch: ['nginx-smoke.spec.ts', 'nginx-gate.spec.ts'],
  outputDir: 'test-results/nginx',
  // Serial: the rate-limit test consumes the shared per-IP limit_req budget;
  // parallel workers would poison each other's auth calls.
  workers: 1,
  use: {
    baseURL: 'http://127.0.0.1:8080',
    screenshot: 'only-on-failure',
  },
  projects: [
    {
      name: 'nginx-chromium',
      use: { ...devices['Desktop Chrome'] },
    },
  ],
})
```

- [ ] **Step 2: `e2e/support/gate.ts`**

```ts
import type { APIRequestContext } from '@playwright/test'

export type SeededSession = { accountId: string; credentialId: string; sessionId: string }

/** Playwright request contexts keep Set-Cookie automatically, so one call
 * authenticates every subsequent request (and page.request shares the
 * browser context's cookies). */
export async function seedSession(request: APIRequestContext): Promise<SeededSession> {
  const response = await request.post('/api/test/seed-session')
  if (!response.ok()) throw new Error(`seed-session failed: ${response.status()}`)
  return (await response.json()) as SeededSession
}

export async function expireSessions(request: APIRequestContext): Promise<void> {
  const response = await request.post('/api/test/expire-sessions')
  if (!response.ok()) throw new Error(`expire-sessions failed: ${response.status()}`)
}

export async function revokeDeviceViaGate(
  request: APIRequestContext,
  credentialId: string,
): Promise<void> {
  const response = await request.post('/api/test/revoke-device', { data: { credentialId } })
  if (!response.ok()) throw new Error(`revoke-device failed: ${response.status()}`)
}

export async function seedInviteViaGate(
  request: APIRequestContext,
): Promise<{ token: string }> {
  const response = await request.post('/api/test/seed-invite', { data: {} })
  if (!response.ok()) throw new Error(`seed-invite failed: ${response.status()}`)
  return (await response.json()) as { token: string }
}
```

- [ ] **Step 3: Update `nginx-smoke.spec.ts`**

Both existing tests now need a session:

```ts
import { expect, test } from '@playwright/test'

import { BoardPage } from './pages/BoardPage.js'
import { HeaderPage } from './pages/HeaderPage.js'
import { seedSession } from './support/gate.js'

test('nginx serves remote entries as JavaScript and never falls back for a missing remote', async ({
  request,
}) => {
  await seedSession(request)

  const remote = await request.get('/widgets/clock/remoteEntry.js')
  expect(remote.status()).toBe(200)
  expect(remote.headers()['content-type']).toContain('javascript')
  expect(remote.headers()['cache-control']).toContain('no-cache')
  expect(await remote.text()).not.toContain('<!doctype html>')

  const missing = await request.get('/widgets/missing/remoteEntry.js')
  expect(missing.status()).toBe(404)
  expect(await missing.text()).not.toContain('<div id="root">')
})

test('the production nginx image mounts Clock through the same-origin remote', async ({ page }) => {
  await seedSession(page.request)
  await page.goto('/')
  await page.evaluate(() => localStorage.clear())
  await page.reload()

  await new HeaderPage(page).addWidget('Часы')

  const card = new BoardPage(page).getCard(0)
  await expect(card.getByText(/:/)).toBeVisible()
  await expect(card.locator('[class*="skeleton"]')).toHaveCount(0)
})
```

- [ ] **Step 4: `nginx-gate.spec.ts` — request-level matrix**

```ts
import { expect, test } from '@playwright/test'

import { revokeDeviceViaGate, seedSession } from './support/gate.js'

test.describe('gate: no session', () => {
  test('a navigation gets the activation page with status 401', async ({ request }) => {
    const res = await request.get('/')
    expect(res.status()).toBe(401)
    expect(await res.text()).toContain('активация')
  })

  test('board statics are blocked without the activation fallback', async ({ request }) => {
    for (const path of ['/assets/anything.js', '/widgets/clock/remoteEntry.js', '/widgets/x/y.js']) {
      const res = await request.get(path)
      expect(res.status(), path).toBe(401)
      expect(await res.text(), path).not.toContain('активация')
    }
  })

  test('the storage and widget APIs are blocked', async ({ request }) => {
    expect((await request.get('/api/storage?prefix=')).status()).toBe(401)
    expect(
      (
        await request.post('/api/widgets/clock/echo', {
          headers: { 'X-Requested-With': 'MyBoard' },
          data: { instanceId: 'i', payload: {} },
        })
      ).status(),
    ).toBe(401)
  })

  test('the auth allowlist is reachable', async ({ request }) => {
    const session = await request.get('/api/auth/session')
    expect(session.status()).toBe(401)
    expect(await session.json()).toEqual({ code: 'session_missing' })

    const activate = await request.get('/activate/')
    expect(activate.status()).toBe(200)
    expect(await activate.text()).toContain('активация')

    const addDevice = await request.get('/add-device')
    expect(addDevice.status()).toBe(200)
    expect(await addDevice.text()).toContain('активация')
  })
})

test.describe('gate: seeded session', () => {
  test('the board, statics, and APIs open up with a session cookie', async ({ request }) => {
    await seedSession(request)

    const shell = await request.get('/')
    expect(shell.status()).toBe(200)
    expect(await shell.text()).toContain('<div id="root">')

    expect((await request.get('/api/storage?prefix=')).status()).toBe(200)
    expect((await request.get('/api/time')).status()).toBe(200)
  })

  test('a session survives; revocation cuts access on the next request', async ({ request }) => {
    const seeded = await seedSession(request)
    expect((await request.get('/api/auth/session')).status()).toBe(200)

    await revokeDeviceViaGate(request, seeded.credentialId)

    expect((await request.get('/api/auth/session')).status()).toBe(401)
    expect((await request.get('/')).status()).toBe(401)
  })

  test('a mutating storage call without the CSRF header is 403 even with a session', async ({
    request,
  }) => {
    await seedSession(request)
    const noHeader = await request.put('/api/storage/e2e%3Acsrf', { data: { value: 1 } })
    expect(noHeader.status()).toBe(403)
    expect(await noHeader.json()).toEqual({ code: 'csrf_required' })

    const withHeader = await request.put('/api/storage/e2e%3Acsrf', {
      headers: { 'X-Requested-With': 'MyBoard' },
      data: { value: 1 },
    })
    expect(withHeader.ok()).toBe(true)
  })
})

// Task 13 inserts the browser journeys here — BEFORE the rate-limit test.

// LAST TEST IN THE FILE: consumes the shared per-IP limit_req budget.
test('auth endpoints are rate limited', async ({ request }) => {
  const responses = await Promise.all(
    Array.from({ length: 50 }, () => request.get('/api/auth/session')),
  )
  const statuses = responses.map((r) => r.status())
  // Only assert throttling kicked in: earlier tests share this IP's budget,
  // so whether any of the 50 still reach the server (401) is timing-dependent.
  expect(statuses).toContain(429)
})
```

- [ ] **Step 5: Run the suite**

With the Task-11 stack still running (`ALLOW_TEST_DB_RESET=1`):

Run: `pnpm test:e2e:nginx`
Expected: PASS. (If a previous run consumed rate-limit budget, wait ~60s and rerun.)

- [ ] **Step 6: Commit**

```bash
rtk git add packages/client/playwright.nginx.config.ts packages/client/e2e
rtk git commit -m "test(gate): nginx gate request-level matrix and authenticated smoke"
```

---

### Task 13: Gated browser journeys

**Files:**
- Modify: `packages/client/e2e/nginx-gate.spec.ts` (insert the three journeys BEFORE the rate-limit test)

**Interfaces:**
- Consumes: `ActivatePage` (`e2e/pages/ActivatePage.js` — `gotoActivate`, `fillName`, `submitRegister`, `waitForBoardRedirect`, `signInButton`), `HeaderPage.addWidget`, `BoardPage.getCard`, `enableVirtualAuthenticator` (`e2e/support/webauthn.js`), `seedInviteViaGate`, `expireSessions`, `revokeDeviceViaGate` (Task 12). For the logout journey, reuse the account-menu selectors that `add-device.spec.ts` already uses to open the avatar menu.

- [ ] **Step 1: Insert the journeys**

```ts
import { BoardPage } from './pages/BoardPage.js'
import { HeaderPage } from './pages/HeaderPage.js'
import { ActivatePage } from './pages/ActivatePage.js'
import { enableVirtualAuthenticator } from './support/webauthn.js'
import { expireSessions, seedInviteViaGate } from './support/gate.js'

async function activateToBoard(page: import('@playwright/test').Page): Promise<void> {
  const { token } = await seedInviteViaGate(page.request)
  await enableVirtualAuthenticator(page)
  const activate = new ActivatePage(page)
  await activate.gotoActivate(token)
  await activate.fillName('Гейт-аккаунт')
  await activate.submitRegister()
  await activate.waitForBoardRedirect()
}

test.describe('gate: browser journeys', () => {
  test('invite → activation → board → logout purge → passkey re-login', async ({ page }) => {
    await activateToBoard(page)

    // The board shell actually came through the gate.
    expect(new URL(page.url()).pathname).toBe('/')
    await page.reload()
    expect((await page.request.get('/api/auth/session')).status()).toBe(200)

    // Logout through the account menu (same selectors add-device.spec.ts uses).
    // Open the avatar menu and click "Выйти".
    await page.getByRole('button', { name: /Г/ }).click() // avatar shows the account initial
    await page.getByRole('menuitem', { name: 'Выйти' }).click()

    // Back on the activation page (login mode), local data purged.
    await expect(page.getByText('активация', { exact: false })).toBeVisible()
    expect(await page.evaluate(() => caches.keys())).toEqual([])
    const dbNames = await page.evaluate(() =>
      indexedDB.databases().then((dbs) => dbs.map((db) => db.name)),
    )
    expect(dbNames).not.toContain('myboard-storage')

    // Passkey re-login from the served activation page.
    const activate = new ActivatePage(page)
    await activate.signInButton.click()
    await activate.waitForBoardRedirect()
    expect((await page.request.get('/api/auth/session')).status()).toBe(200)
  })

  test('an expired session re-logs in silently on a storage call', async ({ page }) => {
    await activateToBoard(page)

    await expireSessions(page.request)

    // The next storage mutation hits a 401, ensureSession runs the ceremony
    // against the virtual authenticator, and the request is retried — all
    // without a navigation.
    await new HeaderPage(page).addWidget('Часы')
    await expect(new BoardPage(page).getCard(0).getByText(/:/)).toBeVisible()

    expect(new URL(page.url()).pathname).toBe('/')
    expect((await page.request.get('/api/auth/session')).status()).toBe(200)
  })

  test('a revoked device is bounced to the activation page', async ({ page }) => {
    await activateToBoard(page)

    const credentialId = await page.evaluate(() => localStorage.getItem('mb_cred_hint'))
    expect(credentialId).toBeTruthy()
    const { revokeDeviceViaGate } = await import('./support/gate.js')
    await revokeDeviceViaGate(page.request, credentialId!)

    // Trigger a storage call: relogin's ceremony verifies against a deleted
    // device, login/verify rejects, and the model hard-navigates to '/',
    // where the gate serves activation.
    await new HeaderPage(page).addWidget('Часы')
    await expect(page.getByText('активация', { exact: false })).toBeVisible()
  })
})
```

Adaptation notes (verify against the actual code, do not guess): the avatar-button selector must match the account-menu trigger the board renders (see `add-device.spec.ts` / `packages/client/src/account/ui`); the activation-page marker text must match the real `<title>`/heading of `packages/client/activation/index.html` (the auth spec asserts `'myboard — активация'`). Move the `revokeDeviceViaGate` import to the top of the file with the others.

- [ ] **Step 2: Run the suite**

Run: `pnpm test:e2e:nginx`
Expected: PASS, journeys before the rate-limit test.

- [ ] **Step 3: Commit**

```bash
rtk git add packages/client/e2e/nginx-gate.spec.ts
rtk git commit -m "test(gate): gated activation, silent relogin, and revocation journeys"
```

---

### Task 14: Docs + full verification

**Files:**
- Modify: `README.md` (new "Access control" section)
- Modify: `CLAUDE.md` (the `test:e2e:nginx` command line note)

- [ ] **Step 1: README section**

Append to the deployment-related part of `README.md`:

```markdown
## Access control

The board is private: nginx `auth_request` gates every route, asset, and API
behind a WebAuthn device session. Anonymous requests to `/` receive the
activation page with status 401 (the deploy healthcheck asserts exactly that).

Ops (from the dev machine via `rpi command` — each is an `rpi.toml`
`[commands]` entry; on the Pi itself the same scripts run via
`docker compose exec server node dist/scripts/<name>.cjs`):

```bash
rpi command create-invite -- --label "Grandma's iPad" --ttl 7d
rpi command list-devices
rpi command revoke-device -- --credential-id <id>
rpi command revoke-invite -- --id <inviteId>
rpi command revoke-account -- --account <accountId>
# Stranded user (lost all devices) — re-enroll into the SAME account:
rpi command mint-add-device-token -- --account <accountId>
# Dated Valkey snapshot into the valkey_data volume (survives FLUSHDB, not volume deletion):
rpi command backup
```

Audit: every register/login/logout/device event is one JSON line in
`docker compose logs server`.

Local gated stack & nginx e2e: the gate is always on in the nginx image, so
`pnpm test:e2e:nginx` needs the stack started with the test endpoints enabled:

```powershell
$env:ALLOW_TEST_DB_RESET = '1'; pnpm start:docker
pnpm test:e2e:nginx
```

Never set `ALLOW_TEST_DB_RESET` in production.
```

- [ ] **Step 2: CLAUDE.md command note**

Update the `pnpm test:e2e:nginx` line in `CLAUDE.md`'s command list to:

```markdown
pnpm test:e2e:nginx            # gate + nginx image tests; needs `ALLOW_TEST_DB_RESET=1 pnpm start:docker` running
```

- [ ] **Step 3: Full local gate**

Run: `pnpm check`
Expected: lint + format + typecheck + all unit tests PASS.

Run: `pnpm test:e2e` (vite preview suite; needs a reachable Valkey per repo docs)
Expected: PASS — the ungated path is untouched.

Run (stack from Task 11 still up): `pnpm test:e2e:nginx`
Expected: PASS.

- [ ] **Step 4: Commit**

```bash
rtk git add README.md CLAUDE.md
rtk git commit -m "docs: access-control ops and gated e2e instructions"
```

---

### Task 15: Activation models on the HttpClient port

Post-gate port migration (activation already sends the CSRF header and sits on
the public allowlist — nothing here blocks the gate; that is why this task
runs after Task 14).

**Files:**
- Modify: `packages/client/activation/src/model/activation-model.ts` + `activation-model.test.ts`
- Modify: `packages/client/activation/src/model/add-device-model.ts` + `add-device-model.test.ts`
- Modify: `packages/client/activation/src/ui/AddDeviceScreen.test.tsx`

**Interfaces:**
- Consumes: `HttpClient`, `HttpLike` from `@shared/http/client`; `Navigate` from `@shared/navigation`; `makeScriptedHttp` (tests).
- Produces: `ActivationDeps` / `AddDeviceDeps` swap `fetchImpl: typeof fetch` for `http: HttpLike` (default `new HttpClient()` — bare: activation **is** the login surface, a 401-retry hook here would be circular) and type `navigate` as `Navigate`. Factory names `createActivationModel` / `createAddDeviceModel` stay (pre-existing names are out of scope for the `make*` rule).
- Deliberate scope note: the local `postJson`/`getJson`/`requestJson` names survive as **4-line adapters over the port** so their ~10 call sites stay untouched; what disappears is the duplicated transport code (headers, CSRF, `credentials`, JSON parsing, network `.catch`) and the `fetchImpl` threading.

- [ ] **Step 1: Port the activation-model tests**

In `activation-model.test.ts`, replace every `fetchImpl: fetchImpl as unknown as typeof fetch` fixture with `http` from `makeScriptedHttp` — same URL scripts, `{ status, body }` steps instead of `Response` mocks. Example of the pattern (apply to each case):

```ts
import { makeScriptedHttp } from '@shared/http/test/scripted-http'

const { http, calls } = makeScriptedHttp({
  '/api/auth/register/options': [{ status: 200, body: { options: { challenge: 'x' } } }],
  '/api/auth/register/verify': [{ status: 200, body: { credentialId: 'c' } }],
})
const model = createActivationModel({ http /* was fetchImpl */, ...restOverrides })
```

Run: `pnpm --filter client exec vitest run activation/src/model/activation-model.test.ts` → FAIL (deps shape).

- [ ] **Step 2: Migrate `activation-model.ts`**

1. `ActivationDeps`: `fetchImpl: typeof fetch` → `http: HttpLike`; `navigate: (path: string) => void` → `navigate: Navigate`.
2. Default in `createActivationModel`: `http: overrides.http ?? new HttpClient()`.
3. The `postJson` helper shrinks to an adapter (its `JsonResult` type and every call site stay untouched — they just pass `deps.http`):

```ts
import { HttpClient, type HttpLike } from '@shared/http/client'
import type { Navigate } from '@shared/navigation'

type JsonResult = { status: number; body: Record<string, unknown> }

async function postJson(
  http: HttpLike,
  url: string,
  payload: unknown,
): Promise<ActivationError | JsonResult> {
  const res = await http.post(url, { json: payload })
  if (res instanceof Error) {
    return new ActivationError({ reason: 'сбой сетевого запроса', cause: res })
  }
  return { status: res.status, body: (res.body ?? {}) as Record<string, unknown> }
}
```

4. Every `postJson(deps.fetchImpl, ...)` call becomes `postJson(deps.http, ...)`.

Run Step 1's file → PASS.

- [ ] **Step 3: Migrate `add-device-model.ts` the same way (test first)**

Port `add-device-model.test.ts` fixtures to `makeScriptedHttp` (same pattern as Step 1) → FAIL. Then in `add-device-model.ts`:

1. `AddDeviceDeps`: `fetchImpl` → `http: HttpLike`; `navigate` → `Navigate`; default `http: overrides.http ?? new HttpClient()`.
2. `requestJson` shrinks to the adapter (its `postJson`/`getJson` wrappers and all call sites stay):

```ts
async function requestJson(
  http: HttpLike,
  url: string,
  init: { method: 'GET' | 'POST'; body?: unknown },
): Promise<AddDeviceError | JsonResult> {
  const res =
    init.method === 'POST'
      ? await http.post(url, init.body !== undefined ? { json: init.body } : undefined)
      : await http.get(url)
  if (res instanceof Error) {
    return new AddDeviceError({ reason: 'сбой сетевого запроса', cause: res })
  }
  return { status: res.status, body: (res.body ?? {}) as Record<string, unknown> }
}
```

3. `AddDeviceScreen.test.tsx`: `fetchImpl: vi.fn() as unknown as typeof fetch` → `http: makeScriptedHttp({}).http`.

Run: `pnpm --filter client exec vitest run activation` → PASS.

- [ ] **Step 4: Suite + typecheck**

Run: `pnpm --filter client test && pnpm typecheck`
Expected: PASS. `rtk grep "typeof fetch" packages/client packages/widget-runtime packages/widgets` must return only test-setup polyfill casts (`vitest.setup.ts`) — no production seams.

- [ ] **Step 5: Commit**

```bash
rtk git add packages/client/activation
rtk git commit -m "refactor(activation): models on the HttpClient port"
```

---

### Task 16 (cuttable): BroadcastChannel hub injection

The same missing-port symptom, lowest stakes: `storage/client/channel.ts`
builds its `BroadcastChannel` ambiently, so widget-runtime tests stub the
global (`installFakeBroadcastChannel`) and two vitest setups carry duplicated
jsdom polyfills. This task is deliberately last and independent — cutting it
loses nothing gate-related.

**Files:**
- Modify: `packages/widget-runtime/src/storage/client/channel.ts`
- Modify: `packages/widget-runtime/src/storage/test/fakes.ts`
- Modify: `packages/widget-runtime/src/storage/client/channel.test.ts` + the tests currently calling `installFakeBroadcastChannel` (`dexie-storage.test.ts`, `reatom-storage.test.ts`)
- Modify: `packages/widget-runtime/vitest.setup.ts` (drop the polyfill if nothing needs it afterwards)

**Interfaces:**
- Produces: `type BroadcastChannelLike = Pick<BroadcastChannel, 'postMessage' | 'addEventListener' | 'close'>`; `setStorageChannelFactory` is NOT introduced (module setters are the disease this plan removes) — instead `channel.ts` exports `makeChannelHub(makeChannel: (name: string) => BroadcastChannelLike)` and keeps one module-level hub built with the native constructor, mirroring the deliberate module-singleton design of `db.ts` (cross-tab fanout is per-document by nature; documented in-code).
- `registerLocal` / `publishChange` / `notifyLocal` keep their exact signatures — `dexie-storage.ts` and other consumers stay untouched; they delegate to the module hub.

- [ ] **Step 1: Restructure `channel.ts`**

Wrap the current module state (`subscribers`, `channel`, `listening`, `ensureChannelListener`) into `makeChannelHub(makeChannel)` returning `{ registerLocal, publishChange, notifyLocal }` with byte-identical logic; then:

```ts
/**
 * Per-document module hub — deliberate module state, like client/db.ts: the
 * BroadcastChannel fans key changes out to OTHER tabs, so one hub per
 * document is the correct cardinality. Tests build their own hubs.
 */
const hub = makeChannelHub((name) => new BroadcastChannel(name))
export const registerLocal = hub.registerLocal
export const publishChange = hub.publishChange
export const notifyLocal = hub.notifyLocal
```

- [ ] **Step 2: De-globalize the fakes**

In `fakes.ts`: keep `FakeBroadcastChannel` but delete `installFakeBroadcastChannel`; add `makeFakeChannelHub()` returning a hub built over `FakeBroadcastChannel`. Port `channel.test.ts` to construct hubs directly; `dexie-storage.test.ts` / `reatom-storage.test.ts` keep exercising the module hub — if jsdom still lacks `BroadcastChannel` for them, the `vitest.setup.ts` polyfill stays and only the `vi.stubGlobal` fake dies (decide by running the suite; both outcomes are acceptable, state which happened in the commit message).

- [ ] **Step 3: Suite + full local gate**

Run: `pnpm --filter widget-runtime test`
Expected: PASS.

Run: `pnpm check` (this task is now the plan's last code change — re-run the full local gate from Task 14 Step 3)
Expected: PASS.

- [ ] **Step 4: Commit**

```bash
rtk git add packages/widget-runtime
rtk git commit -m "refactor(widget-runtime): injectable BroadcastChannel hub, de-globalized fakes"
```

---

## Plan self-review notes

- **Spec coverage:** nginx gate + allowlist + 401 fallback (T11), verifier subtleties `proxy_method GET` (T11), rate limits + 429 test (T11/T12), CSRF guard + both-frontends audit (T1), stdout audit log + CF IP (T2), `@shared/http` HttpClient port over ky + errore semantics + bare-401 body rule + CSRF header + forced single replay (T5, spec 3.2), EventStream port + Navigate type (T5), `makeHostRuntime` composition root owning one SSE manager over the board-injected shared HttpClient, free factories deleted (T6/T9, spec 3.3), storage/widget-api/http-time with zero 401 code below the client (T6), SSE re-auth reconnect on the port (T7, spec 3.5), `purgeLocalData` (T7), single-flight `ensureSession` + probe + offline no-redirect + own bare client, instance built in `runtime.ts` (T8/T9, spec 3.1), board/harness/activation composition roots + devices-http on the port + account device-events SSE on the `OpenEventStream` port + bare-client logout + purge order (T9/T15, spec 3.4/3.5/3.6/3.7/3.8), five ops scripts (T3/T4), seed-session/expire/revoke test routes + prod test mode + compose passthrough (T10), rpi.toml hostname + 401-tripwire healthcheck + ops `[commands]` incl. the valkey backup (T11), nginx suite + gated journeys (T12/T13), docs (T14), BroadcastChannel hub (T16, spec 3.9). Delivery order matches the spec: client resilience (T5–T9) lands before the gate (T11); T15/T16 are post-gate port refactors, T16 cuttable.
- **Deliberate deviations from the spec text:** (1) `fetchServerTime` keeps a per-call **bare** default client (`http: HttpLike = new HttpClient()`, no module state) instead of the runtime's — `server-time` is a pre-existing module-level model outside `HostRuntime`; a 401 there is a non-fatal `TimeError` and the session heals via any storage-triggered relogin. (2) The activation models keep 4-line `postJson`/`requestJson` **adapters** over the port so ~10 call sites stay untouched; the spec's target (no duplicated transport layers, no `fetchImpl` threading) is met. (3) The spec's "bare 401" for assets/API means "no activation fallback" — nginx's default minimal 401 body is acceptable and asserted as such (tests check the absence of activation markers, not an empty body).
- **Known adaptation points (flagged in-task, must be verified against code, not guessed):** exact URL fixtures and deps-helper shapes in `devices-http.test.ts` / `account-model.test.ts` / activation model tests (T9/T15), account-menu selectors and activation marker text (T13), the existing deps-factory helpers in `handlers.test.ts` (T2), which widget-runtime tests still reference `FakeEventSource` after T7 Step 5, and whether the jsdom `BroadcastChannel` polyfill is still needed after T16 Step 2.
- **2026-07-08 architecture review revisions:** one shared retry-hooked client per document — the board passes `http` into `makeHostRuntime` (bare clients are a closed, documented list); the relogin instance is built in `runtime.ts`, not as a module singleton; account models take **required** `http` via UI wiring instead of importing `@/runtime`; `connectEvents` migrates to the `OpenEventStream` port without re-auth (deliberate, documented asymmetry); `makeAuditLogger`/`makeTestControls` follow the `make*` rule; `noopAudit` null object + required `AuthDeps.audit`, `uaOf` lives in `audit.ts`; test doubles live under `@shared/http/test/`; `parseBody` returns `HttpTransportError | { body: unknown }` (discriminable union); `'retry'` short-circuit semantics documented in the global constraints; `fetchServerTime`'s default client is per-call (no module `let`); SSE reconnect stays fixed 2 s / no backoff, documented as deliberate.
- **Type-consistency spine:** `HttpLike`/`HttpResponse`/`HttpTransportError`/`makeUnauthorizedRetryHook` (T5) are consumed with these exact names in T6 (`HttpStorageDeps`, `MakeWidgetApiOptions`, `makeRuntimeHttp`), T7 (`SseManagerDeps`), T8 (`ReloginDeps`), T9 (`request`, `AccountDeps`, `runtime.ts`), and T15 (`ActivationDeps`/`AddDeviceDeps`); `makeHostRuntime`/`HostRuntime` (T6) are consumed in T7 (SSE ownership) and T9 (roots); naming is `make*`/`new` — never `create*` for new exports.
