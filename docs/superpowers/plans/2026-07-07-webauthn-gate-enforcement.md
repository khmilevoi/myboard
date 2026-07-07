# WebAuthn Gate Enforcement (Plan 3) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Enable the always-on nginx `auth_request` gate over the board and ship the hardening tail: CSRF guard, audit log, silent 401 re-login via ky, logout purge, five ops scripts, and gate tests.

**Architecture:** nginx gates `/`, `/assets/*`, `/widgets/*`, and `/api/*` (minus a public allowlist) by subrequesting `GET /api/auth/session`; a 401 on navigations serves the activation page. The server adds a router-level CSRF guard and stdout audit logging. The widget-runtime HTTP layer moves to a shared ky instance whose `afterResponse` hook consults a registered unauthorized-handler; the board registers a single-flight Reatom `ensureSession` model that runs the WebAuthn re-login ceremony.

**Tech Stack:** nginx `auth_request`/`limit_req`, ky (new dep in `widget-runtime` + `client`), `@simplewebauthn/browser`, Reatom v1001, errore, Zod, Vitest, Playwright (CDP virtual authenticator).

**Spec:** `docs/superpowers/specs/2026-07-07-webauthn-gate-enforcement-design.md` (read it first).

## Global Constraints

- errore everywhere: return `Error | T` unions, never throw across boundaries; map external throws in a single `.catch()` point. No `try/catch` in new code (existing `try { JSON.parse }` style stays as-is).
- Reatom rules (load the `reatom` skill): logic in `model/`, continuations after `await` via pre-created `wrap()` closures, actions named (`'relogin.ensureSession'`).
- Every command through `rtk` (e.g. `rtk git add`, `rtk pnpm ...` where applicable).
- UI copy for user-facing surfaces is Russian; this plan adds no new UI surfaces.
- The gate exists **only** in the nginx image. `pnpm dev`, `pnpm test:e2e` (vite preview) stay ungated and must keep passing.
- ky config invariants: `throwHttpErrors` stays default (on); automatic retries disabled via `retry: { limit: 1, methods: [], statusCodes: [] }`; exactly one forced retry per request via the `afterResponse` hook.
- CSRF rule: mutating methods (`POST`/`PUT`/`DELETE`/`PATCH`) on `/api/*` except `/api/test/*` require header `X-Requested-With: MyBoard` → else 403 `{ code: 'csrf_required' }`.
- Run tests per package: `pnpm --filter server exec vitest run <path>`, `pnpm --filter widget-runtime exec vitest run <path>`, `pnpm --filter client exec vitest run <path>`.
- Commit after every task. Do not enable the gate (Task 11) before Tasks 1–10 are green.

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
  - `createAuditLogger(write?: (line: string) => void): AuditLogger` — one JSON line per event with an ISO `ts` prepended.
  - `auditIp(req: Pick<IncomingMessage, 'headers' | 'socket'>, config: AuthConfig): string | null` — `CF-Connecting-IP` when `config.trustCfConnectingIp`, else `clientIp(req)`.
  - `AuthDeps` gains optional `audit?: AuditLogger` (no-op when absent, so existing tests stay green).

- [ ] **Step 1: Write the failing test**

`packages/server/src/auth/audit.test.ts`:

```ts
import { describe, expect, it, vi } from 'vitest'

import type { AuthConfig } from './config'
import { auditIp, createAuditLogger } from './audit'

const baseConfig = { trustCfConnectingIp: false } as AuthConfig

describe('createAuditLogger', () => {
  it('writes one JSON line with ts and the event fields', () => {
    const write = vi.fn()
    const audit = createAuditLogger(write)
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
export function createAuditLogger(write: (line: string) => void = console.log): AuditLogger {
  return (event) => write(JSON.stringify({ ts: new Date().toISOString(), ...event }))
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

1. Add to imports: `import { auditIp, type AuditLogger } from './audit'` and add `InviteLockedError` to the existing `./errors` import.
2. Extend the deps type:

```ts
export type AuthDeps = {
  ops: ValkeyOps
  config: AuthConfig
  now: () => number
  audit?: AuditLogger
}
```

3. Add a tiny local helper below `AuthDeps` (used by every emit site):

```ts
function uaOf(req: IncomingMessage): { ua?: string } {
  return req.headers['user-agent'] ? { ua: req.headers['user-agent'] } : {}
}
```

4. `postRegisterVerify`: extend the `fail` closure and the success return:

```ts
const fail = async (err: Error): Promise<AuthResult> => {
  await recordInviteFailure(deps.ops, deps.now, token)
  deps.audit?.({
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
deps.audit?.({
  event: 'register_failed',
  code: addResult.name,
  ip: auditIp(req, deps.config),
  ...uaOf(req),
})
```

Immediately before the final success `return { status: 200, ... }` add:

```ts
deps.audit?.({
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
  deps.audit?.({ event: 'login_failed', code: challenge.name, ip: auditIp(req, deps.config), ...uaOf(req) })
  return toAuthResult(challenge)
}
// ...
if (result instanceof Error) {
  deps.audit?.({ event: 'login_failed', credentialId, code: result.name, ip: auditIp(req, deps.config), ...uaOf(req) })
  return toAuthResult(result)
}
// ... before the success return:
deps.audit?.({ event: 'login', accountId: device.accountId, credentialId, ip: auditIp(req, deps.config), ...uaOf(req) })
```

6. `postLogout`: before the return:

```ts
deps.audit?.({ event: 'logout', ip: auditIp(req, deps.config), ...uaOf(req) })
```

In `packages/server/src/auth/device-handlers.ts`, using the same `auditIp`/`deps.audit?.` pattern (import `auditIp` from `./audit`), emit immediately before each success return, with the account/credential ids that are in scope in that function:

- `postAddToken` → `{ event: 'addtoken_minted', accountId: <the session's accountId> }`
- `postDeviceRegisterVerify` → `{ event: 'device_pending', accountId, credentialId: <the new pending device id> }`
- `postApproveDevice` → `{ event: 'device_approved', accountId: <session accountId>, credentialId: <params.credentialId> }`
- `postDenyDevice` → `{ event: 'device_denied', accountId, credentialId }`
- `postRevokeDevice` → `{ event: 'device_revoked', accountId, credentialId }`

All device events also get `ip: auditIp(req, deps.config)` and `...uaOf(req)` (export `uaOf` from `handlers.ts` or duplicate the two-liner locally — prefer exporting from `handlers.ts`).

In `packages/server/src/auth/index.ts`: add `audit?: AuditLogger` to `RegisterAuthRoutesDeps` (type import from `./audit`), destructure it, and include it in the local `authDeps`.

In `packages/server/src/app.ts`: add `audit?: AuditLogger` to `AppDeps` (type import from `./auth/audit`), and change the deps construction:

```ts
import { createAuditLogger, type AuditLogger } from './auth/audit'
// ...
const audit = deps.audit ?? createAuditLogger()
const authDeps = { ops, config: deps.authConfig, now, audit }
```

(`registerAuthRoutes({ router, ...authDeps })` then carries it automatically.)

- [ ] **Step 5: Extend handler tests**

In `packages/server/src/auth/handlers.test.ts`, inside the existing test setup add `audit: vi.fn()` to the deps object the file already builds, and add two tests following the file's existing arrange/act style:

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
Expected: PASS (existing tests unaffected — `audit` is optional).

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

### Task 5: widget-runtime — shared ky instance and unauthorized-handler registry

**Files:**
- Modify: `packages/widget-runtime/package.json` (add `ky`)
- Create: `packages/widget-runtime/src/http/client.ts`
- Create: `packages/widget-runtime/src/http/client.test.ts`
- Modify: `packages/widget-runtime/src/index.ts` (add `export * from './http/client'`)

(The `client` package does NOT get a ky dependency: `devices-http` stays on plain `fetch` with its own retry in Task 9.)

**Interfaces:**
- Produces:
  - `export type UnauthorizedHandler = () => Promise<boolean>`
  - `setUnauthorizedHandler(handler: UnauthorizedHandler | null): void`
  - `getUnauthorizedHandler(): UnauthorizedHandler | null`
  - `export const http: KyInstance` — hooks: CSRF header on mutating methods; single forced retry after `401` when the handler resolves `true`.

**ky API note:** this task relies on `ky.retry(...)` returned from an `afterResponse` hook (object-form hook arguments `{ request, response, retryCount }`) and named export `SchemaValidationError` (used in Task 6). These exist in current ky (see `node_modules/ky/readme.md` after install). Step 2's test locks the behavior; if the installed ky's hook signature differs, update the hook to the installed version's documented signature — the test is the contract.

- [ ] **Step 1: Add the dependency**

Run: `pnpm --filter widget-runtime add ky`
Expected: `ky` appears in `packages/widget-runtime/package.json` dependencies.

- [ ] **Step 2: Write the failing test**

`packages/widget-runtime/src/http/client.test.ts`:

```ts
import { afterEach, describe, expect, it, vi } from 'vitest'

import { http, setUnauthorizedHandler } from './client'

afterEach(() => {
  vi.unstubAllGlobals()
  setUnauthorizedHandler(null)
})

function stubFetchSequence(...responses: Response[]) {
  const fetchMock = vi.fn<(input: Request) => Promise<Response>>()
  for (const response of responses) fetchMock.mockResolvedValueOnce(response)
  vi.stubGlobal('fetch', fetchMock)
  return fetchMock
}

describe('http (shared ky instance)', () => {
  it('sets X-Requested-With on mutating requests only', async () => {
    const fetchMock = stubFetchSequence(new Response(null, { status: 204 }))
    await http.put('http://test.local/api/storage/k', { json: { value: 1 } })
    const putReq = fetchMock.mock.calls[0][0]
    expect(putReq.headers.get('x-requested-with')).toBe('MyBoard')

    const fetchMock2 = stubFetchSequence(new Response('{}', { status: 200 }))
    await http.get('http://test.local/api/storage/k')
    const getReq = fetchMock2.mock.calls[0][0]
    expect(getReq.headers.get('x-requested-with')).toBeNull()
  })

  it('retries once after 401 when the handler succeeds (POST included)', async () => {
    const handler = vi.fn(async () => true)
    setUnauthorizedHandler(handler)
    const fetchMock = stubFetchSequence(
      new Response(null, { status: 401 }),
      new Response(null, { status: 204 }),
    )

    const res = await http.post('http://test.local/api/storage/k/append', { json: { entry: {} } })
    expect(res.status).toBe(204)
    expect(handler).toHaveBeenCalledTimes(1)
    expect(fetchMock).toHaveBeenCalledTimes(2)
  })

  it('gives up after one forced retry', async () => {
    const handler = vi.fn(async () => true)
    setUnauthorizedHandler(handler)
    const fetchMock = stubFetchSequence(
      new Response(null, { status: 401 }),
      new Response(null, { status: 401 }),
    )

    await expect(http.get('http://test.local/x')).rejects.toMatchObject({
      response: expect.objectContaining({ status: 401 }),
    })
    expect(handler).toHaveBeenCalledTimes(1)
    expect(fetchMock).toHaveBeenCalledTimes(2)
  })

  it('passes 401 through when no handler is registered', async () => {
    const fetchMock = stubFetchSequence(new Response(null, { status: 401 }))
    await expect(http.get('http://test.local/x')).rejects.toMatchObject({
      response: expect.objectContaining({ status: 401 }),
    })
    expect(fetchMock).toHaveBeenCalledTimes(1)
  })

  it('does not retry on the handler saying false', async () => {
    setUnauthorizedHandler(async () => false)
    const fetchMock = stubFetchSequence(new Response(null, { status: 401 }))
    await expect(http.get('http://test.local/x')).rejects.toMatchObject({
      response: expect.objectContaining({ status: 401 }),
    })
    expect(fetchMock).toHaveBeenCalledTimes(1)
  })

  it('never auto-retries server errors', async () => {
    const fetchMock = stubFetchSequence(new Response(null, { status: 500 }))
    await expect(http.get('http://test.local/x')).rejects.toMatchObject({
      response: expect.objectContaining({ status: 500 }),
    })
    expect(fetchMock).toHaveBeenCalledTimes(1)
  })
})
```

- [ ] **Step 3: Run to verify failure**

Run: `pnpm --filter widget-runtime exec vitest run src/http/client.test.ts`
Expected: FAIL — `client.ts` does not exist.

- [ ] **Step 4: Implement `client.ts`**

```ts
import ky from 'ky'

/** Resolves true when the caller may retry the 401'd request once. */
export type UnauthorizedHandler = () => Promise<boolean>

let unauthorizedHandler: UnauthorizedHandler | null = null

/**
 * Host-app DI point (mirrors the SSE-manager singleton pattern): the board
 * registers its relogin action at bootstrap; standalone widget harnesses
 * register nothing and 401s pass through untouched.
 */
export function setUnauthorizedHandler(handler: UnauthorizedHandler | null): void {
  unauthorizedHandler = handler
}

export function getUnauthorizedHandler(): UnauthorizedHandler | null {
  return unauthorizedHandler
}

const MUTATING_METHODS = new Set(['POST', 'PUT', 'DELETE', 'PATCH'])

export const http = ky.create({
  // Empty methods/statusCodes: automatic retries never fire (today's storage
  // semantics have none); limit 1 leaves budget for the forced 401 retry below.
  retry: { limit: 1, methods: [], statusCodes: [] },
  hooks: {
    beforeRequest: [
      (request) => {
        if (MUTATING_METHODS.has(request.method)) {
          request.headers.set('X-Requested-With', 'MyBoard')
        }
      },
    ],
    afterResponse: [
      async ({ response, retryCount }) => {
        if (response.status !== 401 || retryCount > 0) return
        const handler = unauthorizedHandler
        if (!handler) return
        const ok = await handler().catch(() => false)
        if (ok) return ky.retry({ code: 'SESSION_REFRESHED' })
      },
    ],
  },
})
```

Add to `packages/widget-runtime/src/index.ts`:

```ts
export * from './http/client'
```

- [ ] **Step 5: Run to verify pass**

Run: `pnpm --filter widget-runtime exec vitest run src/http/client.test.ts`
Expected: PASS. If the `afterResponse` hook signature of the installed ky differs (positional `(request, options, response)` instead of one object), adapt the hook to the installed ky's readme — the tests define the required behavior.

- [ ] **Step 6: Commit**

```bash
rtk git add packages/widget-runtime/package.json packages/widget-runtime/src/http packages/widget-runtime/src/index.ts pnpm-lock.yaml
rtk git commit -m "feat(widget-runtime): shared ky instance with 401 relogin hook and CSRF header"
```

---

### Task 6: http-storage and widget-api on ky

**Files:**
- Modify: `packages/widget-runtime/src/storage/server/http-storage.ts` (rewrite fetch calls on `http`)
- Modify: `packages/widget-runtime/src/storage/server/http-storage.test.ts` (Request-based stubs, absolute base URL)
- Modify: `packages/widget-runtime/src/widget-api.ts` (CSRF header + one 401 retry through the registry)
- Modify: `packages/widget-runtime/src/widget-api.test.ts` (new cases)

**Interfaces:**
- Consumes: `http`, `getUnauthorizedHandler` from `../../http/client` (Task 5).
- Produces: `makeHttpStorage(namespace, baseUrl?)` — signature and `StorageApi` behavior unchanged (404→`null`/`false`, non-2xx→`StorageError`, network→`StorageError` with `cause`); response envelopes now Zod-validated (`SchemaValidationError` → `StorageError`).

- [ ] **Step 1: Update the tests first**

Rework `packages/widget-runtime/src/storage/server/http-storage.test.ts`: ky constructs `Request` objects, so stubs receive a `Request` (not `(url, init)`), and Node's `Request` needs absolute URLs — the fixture moves to an absolute base:

```ts
import { afterEach, describe, expect, it, vi } from 'vitest'

import { typeNamespace } from '../scope'
import { StorageError } from '../types'
import { makeHttpStorage } from './http-storage'

const ns = typeNamespace('clock')
const BASE = 'http://test.local/api/storage'
const storage = makeHttpStorage(ns, BASE)

afterEach(() => {
  vi.unstubAllGlobals()
})

function stubFetch(impl: (req: Request) => Response) {
  const fetchMock = vi.fn((input: Request) => Promise.resolve(impl(input)))
  vi.stubGlobal('fetch', fetchMock)
  return fetchMock
}

describe('makeHttpStorage on ky', () => {
  it('GET returns the value', async () => {
    stubFetch(() => new Response(JSON.stringify({ value: { a: 1 } }), { status: 200 }))
    expect(await storage.get('settings')).toEqual({ a: 1 })
  })

  it('GET maps 404 to null', async () => {
    stubFetch(() => new Response(null, { status: 404 }))
    expect(await storage.get('settings')).toBeNull()
  })

  it('GET maps other non-2xx to StorageError', async () => {
    stubFetch(() => new Response(null, { status: 503 }))
    expect(await storage.get('settings')).toBeInstanceOf(StorageError)
  })

  it('GET maps a malformed envelope to StorageError', async () => {
    stubFetch(() => new Response(JSON.stringify({ nope: true }), { status: 200 }))
    expect(await storage.get('settings')).toBeInstanceOf(StorageError)
  })

  it('SET sends a PUT with value, ttl, and the CSRF header', async () => {
    const fetchMock = stubFetch(() => new Response(null, { status: 204 }))
    await storage.set('settings', { a: 1 }, { ttlMs: 1000 })

    const req = fetchMock.mock.calls[0][0]
    expect(req.url).toBe(`${BASE}/${encodeURIComponent('w:t:clock:settings')}`)
    expect(req.method).toBe('PUT')
    expect(req.headers.get('x-requested-with')).toBe('MyBoard')
    expect(await req.json()).toEqual({ value: { a: 1 }, ttlMs: 1000 })
  })

  it('DELETE sends a DELETE', async () => {
    const fetchMock = stubFetch(() => new Response(null, { status: 204 }))
    await storage.delete('settings')
    expect(fetchMock.mock.calls[0][0].method).toBe('DELETE')
  })

  it('HAS maps 404 to false and 200 to true', async () => {
    stubFetch(() => new Response(null, { status: 404 }))
    expect(await storage.has('settings')).toBe(false)
    stubFetch(() => new Response(JSON.stringify({ value: 1 }), { status: 200 }))
    expect(await storage.has('settings')).toBe(true)
  })

  it('KEYS strips the namespace', async () => {
    stubFetch(() => new Response(JSON.stringify({ keys: ['w:t:clock:a', 'w:t:clock:b'] }), { status: 200 }))
    expect(await storage.keys()).toEqual(['a', 'b'])
  })

  it('APPEND posts the entry with the CSRF header', async () => {
    const fetchMock = stubFetch(() => new Response(null, { status: 204 }))
    await storage.append('log', { x: 1 }, { cap: 10 })
    const req = fetchMock.mock.calls[0][0]
    expect(req.url).toBe(`${BASE}/${encodeURIComponent('w:t:clock:log')}/append`)
    expect(req.method).toBe('POST')
    expect(req.headers.get('x-requested-with')).toBe('MyBoard')
    expect(await req.json()).toEqual({ entry: { x: 1 }, cap: 10 })
  })

  it('maps network failures to StorageError with the cause', async () => {
    vi.stubGlobal('fetch', vi.fn(() => Promise.reject(new Error('boom'))))
    const result = await storage.get('settings')
    expect(result).toBeInstanceOf(StorageError)
  })
})
```

Preserve any other existing cases in the file by porting them to the `Request`-based stub the same way (subscribe/SSE cases stay untouched — they use `FakeEventSource`).

- [ ] **Step 2: Run to verify failure**

Run: `pnpm --filter widget-runtime exec vitest run src/storage/server/http-storage.test.ts`
Expected: FAIL (old implementation still uses raw fetch tuples).

- [ ] **Step 3: Rewrite `http-storage.ts`**

```ts
import { HTTPError, SchemaValidationError } from 'ky'
import { z } from 'zod'

import { http } from '../../http/client'
import { toFullKey, toRelativeKey } from '../scope'
import { subscribeStorageKey } from '../subscribe-key'
import { StorageError, type StorageApi, type StorageListener, type StorageOptions } from '../types'
import { parseValue } from '../validate'
import { getSseManager } from './sse-client'

const NOT_FOUND = Symbol('not-found')

/** Single errore mapping point: ky throws, storage returns values. */
function mapError(op: string, cause: unknown): StorageError | typeof NOT_FOUND {
  if (cause instanceof HTTPError) {
    if (cause.response.status === 404) return NOT_FOUND
    return new StorageError({ reason: `server ${op} ${cause.response.status}`, cause })
  }
  if (cause instanceof SchemaValidationError) {
    return new StorageError({ reason: `server ${op} invalid response`, cause })
  }
  return new StorageError({ reason: `server ${op} failed`, cause })
}

const ValueEnvelopeSchema = z.object({ value: z.unknown() })
const KeysEnvelopeSchema = z.object({ keys: z.array(z.string()) })

export function makeHttpStorage(namespace: string, baseUrl = '/api/storage'): StorageApi {
  const keyUrl = (fullKey: string) => `${baseUrl}/${encodeURIComponent(fullKey)}`

  return {
    async get<T>(key: string, schema?: z.ZodType<T>): Promise<StorageError | T | null> {
      const body = await http
        .get(keyUrl(toFullKey(namespace, key)))
        .json(ValueEnvelopeSchema)
        .catch((cause) => mapError('GET', cause))
      if (body === NOT_FOUND) return null
      if (body instanceof StorageError) return body
      return parseValue(schema, body.value)
    },

    async set<T>(key: string, value: T, options?: StorageOptions): Promise<StorageError | void> {
      const result = await http
        .put(keyUrl(toFullKey(namespace, key)), { json: { value, ttlMs: options?.ttlMs } })
        .catch((cause) => mapError('PUT', cause))
      if (result === NOT_FOUND) return new StorageError({ reason: 'server PUT 404' })
      if (result instanceof StorageError) return result
    },

    async delete(key: string): Promise<StorageError | void> {
      const result = await http
        .delete(keyUrl(toFullKey(namespace, key)))
        .catch((cause) => mapError('DELETE', cause))
      if (result === NOT_FOUND) return new StorageError({ reason: 'server DELETE 404' })
      if (result instanceof StorageError) return result
    },

    async has(key: string): Promise<StorageError | boolean> {
      const result = await http
        .get(keyUrl(toFullKey(namespace, key)))
        .catch((cause) => mapError('HAS', cause))
      if (result === NOT_FOUND) return false
      if (result instanceof StorageError) return result
      return true
    },

    async keys(prefix?: string): Promise<StorageError | string[]> {
      const fullPrefix = toFullKey(namespace, prefix ?? '')
      const body = await http
        .get(`${baseUrl}?prefix=${encodeURIComponent(fullPrefix)}`)
        .json(KeysEnvelopeSchema)
        .catch((cause) => mapError('KEYS', cause))
      if (body === NOT_FOUND) return new StorageError({ reason: 'server KEYS 404' })
      if (body instanceof StorageError) return body
      return body.keys.map((full) => toRelativeKey(namespace, full))
    },

    async append<T extends Record<string, unknown>>(
      key: string,
      entry: T,
      options?: { cap?: number },
    ): Promise<StorageError | void> {
      const result = await http
        .post(`${keyUrl(toFullKey(namespace, key))}/append`, {
          json: { entry, ...(options?.cap !== undefined ? { cap: options.cap } : {}) },
        })
        .catch((cause) => mapError('APPEND', cause))
      if (result === NOT_FOUND) return new StorageError({ reason: 'server APPEND 404' })
      if (result instanceof StorageError) return result
    },

    subscribe<T>(key: string, listener: StorageListener<T>, schema?: z.ZodType<T>): () => void {
      const fullKey = toFullKey(namespace, key)
      return subscribeStorageKey({
        getCurrent: () => this.get<T>(key, schema),
        register: (deliver) => getSseManager(baseUrl).add(fullKey, deliver),
        listener,
        schema,
      })
    },
  }
}
```

Note: if the installed ky's `.json(schema)` types reject a Zod schema, wrap explicitly: `.json().then((raw) => ValueEnvelopeSchema.parse(raw))` inside the same chain — the `.catch` still maps `ZodError` via the final `mapError` branch. Prefer the native `.json(schema)` form.

- [ ] **Step 4: widget-api — header + one retry**

In `packages/widget-runtime/src/widget-api.ts`, replace the single `fetchRequest` call (lines 41–47) with:

```ts
const url = `/api/widgets/${encodeURIComponent(typeId)}/${encodeURIComponent(event)}`
const doRequest = () =>
  fetchRequest(url, {
    method: 'POST',
    headers: { 'content-type': 'application/json', 'X-Requested-With': 'MyBoard' },
    body,
  }).catch((cause) => new WidgetApiError({ reason: 'network request failed', cause }))

let response = await doRequest()
if (response instanceof Error) return response

if (response.status === 401) {
  const handler = getUnauthorizedHandler()
  if (handler && (await handler().catch(() => false))) {
    const retried = await doRequest()
    if (retried instanceof Error) return retried
    response = retried
  }
}
```

Add the import: `import { getUnauthorizedHandler } from './http/client'`.

Extend `packages/widget-runtime/src/widget-api.test.ts` with two cases in the file's existing style (it injects `fetch`):

```ts
it('sends the CSRF header', async () => {
  const fetchMock = vi.fn(async () => new Response(JSON.stringify({ data: 1 }), { status: 200 }))
  const api = makeWidgetApi({ typeId: 't', instanceId: 'i', fetch: fetchMock })
  await api.invoke('echo', {})
  expect(fetchMock.mock.calls[0][1]?.headers).toMatchObject({ 'X-Requested-With': 'MyBoard' })
})

it('retries once after 401 when the unauthorized handler succeeds', async () => {
  setUnauthorizedHandler(async () => true)
  const fetchMock = vi
    .fn()
    .mockResolvedValueOnce(new Response(JSON.stringify({ error: { code: 'x', message: 'x' } }), { status: 401 }))
    .mockResolvedValueOnce(new Response(JSON.stringify({ data: 42 }), { status: 200 }))
  const api = makeWidgetApi({ typeId: 't', instanceId: 'i', fetch: fetchMock })
  expect(await api.invoke('echo', {})).toBe(42)
  expect(fetchMock).toHaveBeenCalledTimes(2)
  setUnauthorizedHandler(null)
})
```

(Import `setUnauthorizedHandler` from `./http/client` in the test.)

- [ ] **Step 5: Run the widget-runtime suite**

Run: `pnpm --filter widget-runtime test`
Expected: PASS (including reatom-storage tests that go through `makeHttpStorage`; if any use relative-URL stubs, port them to the absolute-base pattern from Step 1).

- [ ] **Step 6: Commit**

```bash
rtk git add packages/widget-runtime/src
rtk git commit -m "refactor(widget-runtime): http-storage and widget-api on the shared ky instance"
```

---

### Task 7: SSE reconnect with re-auth + `purgeLocalData`

**Files:**
- Modify: `packages/widget-runtime/src/storage/server/sse-client.ts` (reconnect on fatal close, subscribe POST via `http`)
- Modify: `packages/widget-runtime/src/storage/test/fakes.ts` (`FakeEventSource` gains `onerror` + `emitError()`)
- Modify: `packages/widget-runtime/src/storage/server/sse-client.test.ts` (reconnect test)
- Modify: `packages/widget-runtime/src/storage/client/db.ts` (add `purgeLocalData`)
- Modify: `packages/widget-runtime/src/storage/index.ts` (re-export `purgeLocalData`)
- Create test in: `packages/widget-runtime/src/storage/client/dexie-storage.test.ts` (purge case)

**Interfaces:**
- Consumes: `http`, `getUnauthorizedHandler` from `../../http/client`.
- Produces: `purgeLocalData(): Promise<void>` (exported from the `widget-runtime` package root via `storage/index.ts`) — deletes the `myboard-storage` Dexie database.
- Behavior: on an `EventSource` fatal error (`readyState === CLOSED`), the manager awaits the unauthorized handler (if registered), then reconnects after `RECONNECT_DELAY_MS = 2000`; a new connection re-registers all desired keys (existing `ready` handler already resets `registered`).

- [ ] **Step 1: Extend the fake**

In `packages/widget-runtime/src/storage/test/fakes.ts`, add to `FakeEventSource`:

```ts
onerror: ((event: Event) => void) | null = null

/** Simulate a fatal close (e.g. the gate answered 401): readyState CLOSED + error event. */
emitError() {
  this.readyState = 2
  this.onerror?.({} as Event)
}
```

- [ ] **Step 2: Write the failing test**

Append to `packages/widget-runtime/src/storage/server/sse-client.test.ts` (reuse the file's existing setup helpers for `installFakeEventSource` and fetch stubbing; `vi.useFakeTimers()` where the file does):

```ts
it('re-authenticates and reconnects after a fatal EventSource error', async () => {
  vi.useFakeTimers()
  installFakeEventSource()
  const handler = vi.fn(async () => true)
  setUnauthorizedHandler(handler)
  vi.stubGlobal(
    'fetch',
    vi.fn(async () => new Response(null, { status: 204 })),
  )

  const manager = getSseManager('http://test.local/api/storage')
  manager.add('k1', () => {})

  const first = FakeEventSource.instances[0]
  first.emit('ready', { connId: 'c1' })
  await vi.runAllTimersAsync()

  first.emitError()
  await vi.runAllTimersAsync()

  expect(handler).toHaveBeenCalledTimes(1)
  expect(FakeEventSource.instances.length).toBe(2)

  // the fresh connection re-registers the desired key
  FakeEventSource.instances[1].emit('ready', { connId: 'c2' })
  await vi.runAllTimersAsync()
  const lastCall = (fetch as ReturnType<typeof vi.fn>).mock.calls.at(-1)
  expect(String(lastCall?.[0].url ?? lastCall?.[0])).toContain('/events/c2')
  setUnauthorizedHandler(null)
  vi.useRealTimers()
})
```

Import `setUnauthorizedHandler` from `../../http/client` and `FakeEventSource, installFakeEventSource` from `../test/fakes` (match the file's existing imports). Note: `getSseManager` memoizes per `baseUrl` — use a unique `baseUrl` per test to get a fresh manager.

- [ ] **Step 3: Run to verify failure**

Run: `pnpm --filter widget-runtime exec vitest run src/storage/server/sse-client.test.ts`
Expected: FAIL — no reconnect logic exists.

- [ ] **Step 4: Implement the reconnect + ky subscribe**

In `sse-client.ts`:

1. Import: `import { getUnauthorizedHandler, http } from '../../http/client'` and add `const RECONNECT_DELAY_MS = 2_000`.
2. Restructure `createSseManager` so the `EventSource` construction and its listeners live in a local `connect()` function; module state (`subscribers`, `desired`, `registered`, `connId`, sync fields) stays where it is. The existing `source.addEventListener('ready', ...)` and `source.onmessage` bodies move unchanged into `connect()`:

```ts
let source: EventSource | undefined
let reconnectTimer: ReturnType<typeof setTimeout> | undefined

function connect(): void {
  source = new EventSource(`${baseUrl}/events`)
  source.addEventListener('ready', onReady)
  source.onmessage = onMessage
  source.onerror = () => {
    // CONNECTING (0): the browser retries by itself. CLOSED (2): fatal — the
    // gate answered non-200 (e.g. 401) and EventSource will never retry.
    if (source && source.readyState !== 2) return
    source = undefined
    connId = undefined
    scheduleReconnect()
  }
}

function scheduleReconnect(): void {
  if (reconnectTimer) return
  reconnectTimer = setTimeout(() => {
    reconnectTimer = undefined
    void (async () => {
      const handler = getUnauthorizedHandler()
      if (handler) await handler().catch(() => false)
      connect()
    })()
  }, RECONNECT_DELAY_MS)
}

connect()
```

(Extract the current inline `ready`/`message` handlers into named `onReady`/`onMessage` functions so `connect()` can attach them.)

3. Switch the subscribe POST inside `sync()` to the shared instance (keeps the manual status handling — `throwHttpErrors: false` per request):

```ts
let response: Response | null
response = await http
  .post(`${baseUrl}/events/${requestConnId}`, {
    json: { subscribe, unsubscribe },
    throwHttpErrors: false,
  })
  .catch((cause) => {
    console.warn('storage SSE registration failed', cause)
    return null
  })
syncInFlight = false
```

(Replace the existing `try/catch/finally` block with this errore-style chain; keep everything after it — the `connId` drift check, retry scheduling, `registered` bookkeeping — unchanged.)

- [ ] **Step 5: `purgeLocalData`**

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

- [ ] **Step 6: Run the suite**

Run: `pnpm --filter widget-runtime test`
Expected: PASS.

- [ ] **Step 7: Commit**

```bash
rtk git add packages/widget-runtime/src
rtk git commit -m "feat(widget-runtime): SSE re-auth reconnect and purgeLocalData"
```

---

### Task 8: Client relogin model (`ensureSession`)

**Files:**
- Create: `packages/client/src/session/model/relogin.ts`
- Create: `packages/client/src/session/model/relogin.test.ts`

**Interfaces:**
- Consumes: `startAuthentication` from `@simplewebauthn/browser` (already a client dependency); Reatom v1001 (`action`, `atom`, `wrap`).
- Produces:
  - `createReloginModel(overrides?: Partial<ReloginDeps>): ReloginModel` with `ReloginDeps = { fetchImpl: typeof fetch; startAuthenticationCeremony: typeof startAuthentication; locationAssign: (path: string) => void; storage: { get(): string | null; clear(): void } }` and `ReloginModel = { ensureSession: () => Promise<boolean> }`
  - Module singleton: `export const ensureSession: () => Promise<boolean>` — the function Tasks 9 wires everywhere.
- Behavior contract:
  1. Single-flight: concurrent calls share one promise.
  2. Probe `GET /api/auth/session` → `200` ⇒ `true`, no ceremony.
  3. Probe network failure ⇒ `false`, **no redirect** (offline-first: the caller just sees its original error).
  4. Probe `401` ⇒ ceremony `POST /api/auth/login/options` (with `credentialIdHint` from `mb_cred_hint` when present) → `startAuthentication` → `POST /api/auth/login/verify` ⇒ `true`.
  5. Any ceremony/verify failure or cancel ⇒ clear the hint, `locationAssign('/')`, `false`.

- [ ] **Step 1: Write the failing test**

`packages/client/src/session/model/relogin.test.ts`:

```ts
import { describe, expect, it, vi } from 'vitest'

import { createReloginModel } from './relogin'

type FetchStep = { status: number; body?: unknown } | 'reject'

function fetchScript(steps: Record<string, FetchStep[]>) {
  const calls: Array<{ url: string; body: unknown }> = []
  const fetchImpl = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = String(input)
    const step = steps[url]?.shift()
    calls.push({ url, body: init?.body ? JSON.parse(init.body as string) : undefined })
    if (!step) throw new Error(`unexpected fetch ${url}`)
    if (step === 'reject') throw new Error('network down')
    return new Response(step.body === undefined ? null : JSON.stringify(step.body), {
      status: step.status,
    })
  }) as unknown as typeof fetch
  return { fetchImpl, calls }
}

const noStorage = { get: () => null, clear: vi.fn() }

describe('ensureSession', () => {
  it('returns true without a ceremony when the probe says 200', async () => {
    const { fetchImpl } = fetchScript({ '/api/auth/session': [{ status: 200, body: {} }] })
    const ceremony = vi.fn()
    const model = createReloginModel({
      fetchImpl,
      startAuthenticationCeremony: ceremony as never,
      locationAssign: vi.fn(),
      storage: noStorage,
    })
    expect(await model.ensureSession()).toBe(true)
    expect(ceremony).not.toHaveBeenCalled()
  })

  it('runs the ceremony on probe 401 and returns true on verified login', async () => {
    const { fetchImpl, calls } = fetchScript({
      '/api/auth/session': [{ status: 401 }],
      '/api/auth/login/options': [{ status: 200, body: { options: { challenge: 'x' } } }],
      '/api/auth/login/verify': [{ status: 200, body: { accountId: 'a', credentialId: 'c' } }],
    })
    const ceremony = vi.fn(async () => ({ id: 'c' }))
    const model = createReloginModel({
      fetchImpl,
      startAuthenticationCeremony: ceremony as never,
      locationAssign: vi.fn(),
      storage: { get: () => 'hint-1', clear: vi.fn() },
    })

    expect(await model.ensureSession()).toBe(true)
    expect(ceremony).toHaveBeenCalledTimes(1)
    const optionsCall = calls.find((c) => c.url === '/api/auth/login/options')
    expect(optionsCall?.body).toEqual({ credentialIdHint: 'hint-1' })
  })

  it('coalesces concurrent calls into one flight', async () => {
    const { fetchImpl } = fetchScript({ '/api/auth/session': [{ status: 200, body: {} }] })
    const model = createReloginModel({
      fetchImpl,
      startAuthenticationCeremony: vi.fn() as never,
      locationAssign: vi.fn(),
      storage: noStorage,
    })
    const [a, b, c] = await Promise.all([
      model.ensureSession(),
      model.ensureSession(),
      model.ensureSession(),
    ])
    expect([a, b, c]).toEqual([true, true, true])
    expect(fetchImpl).toHaveBeenCalledTimes(1)
  })

  it('redirects to / and returns false when the ceremony is cancelled', async () => {
    const { fetchImpl } = fetchScript({
      '/api/auth/session': [{ status: 401 }],
      '/api/auth/login/options': [{ status: 200, body: { options: { challenge: 'x' } } }],
    })
    const locationAssign = vi.fn()
    const storage = { get: () => 'hint', clear: vi.fn() }
    const model = createReloginModel({
      fetchImpl,
      startAuthenticationCeremony: vi.fn(async () => {
        throw new Error('NotAllowedError')
      }) as never,
      locationAssign,
      storage,
    })

    expect(await model.ensureSession()).toBe(false)
    expect(locationAssign).toHaveBeenCalledWith('/')
    expect(storage.clear).toHaveBeenCalled()
  })

  it('returns false without redirect when the probe network-fails (offline)', async () => {
    const { fetchImpl } = fetchScript({ '/api/auth/session': ['reject'] })
    const locationAssign = vi.fn()
    const model = createReloginModel({
      fetchImpl,
      startAuthenticationCeremony: vi.fn() as never,
      locationAssign,
      storage: noStorage,
    })
    expect(await model.ensureSession()).toBe(false)
    expect(locationAssign).not.toHaveBeenCalled()
  })

  it('allows a fresh flight after the previous one settles', async () => {
    const { fetchImpl } = fetchScript({
      '/api/auth/session': [
        { status: 200, body: {} },
        { status: 200, body: {} },
      ],
    })
    const model = createReloginModel({
      fetchImpl,
      startAuthenticationCeremony: vi.fn() as never,
      locationAssign: vi.fn(),
      storage: noStorage,
    })
    await model.ensureSession()
    await model.ensureSession()
    expect(fetchImpl).toHaveBeenCalledTimes(2)
  })
})
```

- [ ] **Step 2: Run to verify failure**

Run: `pnpm --filter client exec vitest run src/session/model/relogin.test.ts`
Expected: FAIL — module missing.

- [ ] **Step 3: Implement `relogin.ts`**

```ts
import { action, atom, wrap } from '@reatom/core'
import { startAuthentication } from '@simplewebauthn/browser'

// Same non-secret localStorage hint the activation app maintains
// (packages/client/activation/src/model/activation-model.ts).
export const CRED_HINT_STORAGE_KEY = 'mb_cred_hint'

export interface ReloginDeps {
  fetchImpl: typeof fetch
  startAuthenticationCeremony: typeof startAuthentication
  locationAssign: (path: string) => void
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

export function createReloginModel(overrides: Partial<ReloginDeps> = {}): ReloginModel {
  const deps: ReloginDeps = {
    fetchImpl: overrides.fetchImpl ?? ((...args) => fetch(...args)),
    startAuthenticationCeremony: overrides.startAuthenticationCeremony ?? startAuthentication,
    locationAssign: overrides.locationAssign ?? ((path) => window.location.assign(path)),
    storage: overrides.storage ?? defaultStorage(),
  }

  const inflight = atom<Promise<boolean> | null>(null, 'relogin.inflight')

  async function run(): Promise<boolean> {
    // Probe first: distinguishes "session expired" (401 → ceremony) from
    // network failures (offline-first: report false, change nothing) and
    // spurious per-endpoint 401s (200 → the session is fine, just retry).
    const probe = await deps
      .fetchImpl('/api/auth/session', { credentials: 'same-origin' })
      .catch(() => null)
    if (probe === null) return false
    if (probe.ok) return true
    if (probe.status !== 401) return false

    const bail = (): false => {
      deps.storage.clear()
      deps.locationAssign('/')
      return false
    }

    const hint = deps.storage.get()
    const optionsRes = await deps
      .fetchImpl('/api/auth/login/options', {
        method: 'POST',
        credentials: 'same-origin',
        headers: { 'Content-Type': 'application/json', 'X-Requested-With': 'MyBoard' },
        body: JSON.stringify(hint ? { credentialIdHint: hint } : {}),
      })
      .catch(() => null)
    if (optionsRes === null || !optionsRes.ok) return bail()

    const optionsBody = (await optionsRes.json().catch(() => null)) as {
      options?: Parameters<typeof startAuthentication>[0]['optionsJSON']
    } | null
    if (!optionsBody?.options) return bail()

    const assertion = await deps
      .startAuthenticationCeremony({ optionsJSON: optionsBody.options })
      .catch(() => null)
    if (assertion === null) return bail()

    const verifyRes = await deps
      .fetchImpl('/api/auth/login/verify', {
        method: 'POST',
        credentials: 'same-origin',
        headers: { 'Content-Type': 'application/json', 'X-Requested-With': 'MyBoard' },
        body: JSON.stringify({ authenticationResponse: assertion }),
      })
      .catch(() => null)
    if (verifyRes === null || !verifyRes.ok) return bail()

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

const model = createReloginModel()
export const ensureSession = model.ensureSession
```

- [ ] **Step 4: Run to verify pass**

Run: `pnpm --filter client exec vitest run src/session/model/relogin.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
rtk git add packages/client/src/session
rtk git commit -m "feat(client): single-flight ensureSession relogin model"
```

---

### Task 9: Client wiring — bootstrap, devices-http retry, logout purge

**Files:**
- Modify: `packages/client/src/app/main.tsx` (register the handler)
- Modify: `packages/client/src/account/model/devices-http.ts` (401 → `ensureSession` → one retry)
- Modify: `packages/client/src/account/model/devices-http.test.ts`
- Create: `packages/client/src/session/model/purge.ts` + `purge.test.ts`
- Modify: `packages/client/src/account/model/account-model.ts` (logout purge step)
- Modify: `packages/client/src/account/model/account-model.test.ts`

**Interfaces:**
- Consumes: `setUnauthorizedHandler`, `purgeLocalData` from `widget-runtime`; `ensureSession` from `@/session/model/relogin`.
- Produces: `purgeLocalSession(): Promise<void>` in `@/session/model/purge`; `AccountDeps` gains `purge: () => Promise<void>` (default `purgeLocalSession`).

- [ ] **Step 1: Bootstrap registration**

In `packages/client/src/app/main.tsx` add after `initTheme()`:

```ts
import { setUnauthorizedHandler } from 'widget-runtime'

import { ensureSession } from '@/session/model/relogin'
// ...
setUnauthorizedHandler(() => ensureSession())
```

- [ ] **Step 2: devices-http retry (test first)**

Append to `packages/client/src/account/model/devices-http.test.ts`:

```ts
import { ensureSession } from '@/session/model/relogin'

vi.mock('@/session/model/relogin', () => ({ ensureSession: vi.fn(async () => true) }))

it('retries once through ensureSession on a 401', async () => {
  const fetchImpl = vi
    .fn()
    .mockResolvedValueOnce(
      new Response(JSON.stringify({ code: 'session_missing' }), { status: 401 }),
    )
    .mockResolvedValueOnce(
      new Response(JSON.stringify({ id: 'a', name: 'N', deviceLimit: 10 }), { status: 200 }),
    ) as unknown as typeof fetch

  const result = await fetchAccount(fetchImpl)
  expect(result).toEqual({ id: 'a', name: 'N', deviceLimit: 10 })
  expect(ensureSession).toHaveBeenCalledTimes(1)
  expect(fetchImpl).toHaveBeenCalledTimes(2)
})

it('does not retry when ensureSession fails', async () => {
  ;(ensureSession as ReturnType<typeof vi.fn>).mockResolvedValueOnce(false)
  const fetchImpl = vi
    .fn()
    .mockResolvedValue(
      new Response(JSON.stringify({ code: 'session_missing' }), { status: 401 }),
    ) as unknown as typeof fetch

  const result = await fetchAccount(fetchImpl)
  expect(result).toBeInstanceOf(DeviceApiError)
  expect(fetchImpl).toHaveBeenCalledTimes(1)
})
```

Run: `pnpm --filter client exec vitest run src/account/model/devices-http.test.ts` → FAIL.

Implement in `devices-http.ts`: rename the current `request` body to `attemptRequest` and add on top:

```ts
import { ensureSession } from '@/session/model/relogin'
// ...
async function request<T>(
  fetchImpl: typeof fetch,
  url: string,
  options: RequestOptions = {},
): Promise<Error | T> {
  const first = await attemptRequest<T>(fetchImpl, url, options)
  if (first instanceof DeviceApiError && first.status === 401 && (await ensureSession())) {
    return attemptRequest<T>(fetchImpl, url, options)
  }
  return first
}
```

(`attemptRequest` is the existing implementation verbatim.) Run the test again → PASS.

- [ ] **Step 3: `purgeLocalSession` (test first)**

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

- [ ] **Step 4: Logout purge in the account model (test first)**

In `packages/client/src/account/model/account-model.test.ts`, find the existing logout test and extend the deps the file builds with `purge: vi.fn(async () => undefined)`; assert order:

```ts
it('purges local data after server logout and before navigation', async () => {
  const order: string[] = []
  const deps = {
    // the file's existing fetch fixture that returns 204 for /api/auth/logout
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

1. `AccountDeps` gains `purge: () => Promise<void>`; default in `createAccountModel`: `purge: overrides.purge ?? purgeLocalSession` (import from `@/session/model/purge`).
2. The `logout` action body, after the successful `logoutRequest`, becomes:

```ts
const logout = action(async () => {
  error.set(null)

  const result = await wrap(logoutRequest(deps.fetchImpl))
  if (result instanceof Error) {
    error.set(describeDeviceError(result))
    return
  }

  await wrap(deps.purge().catch(() => undefined))
  deps.navigate('/')
}, 'account.logout').extend(withAsync())
```

Run: `pnpm --filter client exec vitest run src/account/model/account-model.test.ts` → PASS.

- [ ] **Step 5: Full client suite + typecheck**

Run: `pnpm --filter client test && pnpm typecheck`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
rtk git add packages/client/src
rtk git commit -m "feat(client): wire relogin handler, devices-http retry, logout purge"
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
  - `createTestControls(ops: ValkeyOps): { now: () => number; controls: TestControls }` in `test-controls.ts`.

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
export function createTestControls(ops: ValkeyOps): {
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
import { createTestControls } from './test-controls'
// ...
const ops = createValkeyOps()
const testSetup = process.env.ALLOW_TEST_DB_RESET === '1' ? createTestControls(ops) : undefined

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
- Modify: `rpi.toml` (hostname + 401 healthcheck)

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

(Only the `[ingress]` and `[healthcheck]` sections change; the rest of the file stays.)

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

Ops (run inside the server container on the Pi):

```bash
docker compose exec server node dist/scripts/create-invite.cjs --label "Grandma's iPad" --ttl 7d
docker compose exec server node dist/scripts/list-devices.cjs
docker compose exec server node dist/scripts/revoke-device.cjs --credential-id <id>
docker compose exec server node dist/scripts/revoke-invite.cjs --id <inviteId>
docker compose exec server node dist/scripts/revoke-account.cjs --account <accountId>
# Stranded user (lost all devices) — re-enroll into the SAME account:
docker compose exec server node dist/scripts/mint-add-device-token.cjs --account <accountId>
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

## Plan self-review notes

- **Spec coverage:** nginx gate + allowlist + 401 fallback (T11), verifier subtleties `proxy_method GET` (T11), rate limits + 429 test (T11/T12), CSRF guard + both-frontends audit (T1), stdout audit log + CF IP (T2), ky instance + forced-retry + auto-retry-off + CSRF header (T5), `.json(schema)` + single `.catch` errore mapping (T6), widget-api coverage (T6), SSE re-auth reconnect (T7), `purgeLocalData` (T7), single-flight `ensureSession` + probe + offline no-redirect (T8), bootstrap DI + devices-http retry + logout purge order (T9), five ops scripts (T3/T4), seed-session/expire/revoke test routes + prod test mode + compose passthrough (T10), rpi.toml hostname + 401-tripwire healthcheck (T11), nginx suite + gated journeys (T12/T13), docs (T14). Delivery order matches the spec: client resilience (T5–T9) lands before the gate (T11).
- **Deliberate deviations from the spec text:** none in behavior; the spec's "bare 401" for assets/API means "no activation fallback" — nginx's default minimal 401 error body is acceptable and asserted as such (tests check the absence of activation markers, not an empty body).
- **Known adaptation points (flagged in-task, must be verified against code, not guessed):** ky hook signature (T5 Step 5), account-menu selectors and activation marker text (T13), the existing deps-factory helpers in `handlers.test.ts` / `account-model.test.ts` (T2/T9).
