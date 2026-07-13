# Add-device single-touch (mint session on approval) — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** After the owner approves a joining device, the server mints that device's session directly from its pending ticket, so the new device performs **one** WebAuthn ceremony (create passkey) instead of two — removing both the redundant second touch and the `DeviceNotFoundError`-on-stale-credential failure.

**Architecture:** The 2-second status poll (`GET /api/auth/devices/pending-status`) stays a pure, side-effect-free read. A new `POST /api/auth/devices/claim-session` endpoint, authenticated by the pending-ticket cookie, atomically consumes the single-use ticket and issues a session cookie once the device is `active`. The client drops its post-approval `startAuthentication` ceremony and instead calls claim-session on the first `approved` poll.

**Tech Stack:** TypeScript, `node:http` + `find-my-way` server, Valkey (Redis) via `ValkeyOps`, Zod, `@simplewebauthn/*`, Reatom v1001 client model, Vitest (unit), Playwright (e2e). Design source: `docs/superpowers/specs/2026-07-13-add-device-single-touch-design.md`.

## Global Constraints

These apply to **every** task; each task's requirements implicitly include this section.

- **errore, not throwing.** All server functions return `Error | T` unions and narrow with `instanceof Error` / `instanceof <TaggedError>`; never `throw` for control flow. Public auth errors carry `status`/`code`; surface them via `toAuthResult(err)`.
- **Reatom `wrap()` convention (client).** Inside a reatom `action`, every awaited external promise is individually `wrap()`ed. A plain async helper called from an action wraps each of *its own* awaited promises, and the caller *also* `wrap()`s the helper call (mirrors the existing `completeLoginAfterApproval` idiom). `.catch()` chains onto the **raw** ceremony/fetch promise *before* it is passed to `wrap(...)`, never onto `wrap(...)`'s result. Do not hoist a single `wrap(fn)` closure and reuse it across calls — call `wrap(fn)()` fresh per invocation.
- **Storage keys are a persistence contract.** This change adds no new stored key shapes and must not alter any existing key derivation (`pendingKey`, `sessionKey`, etc.).
- **User-facing strings are Russian; code, comments, commit messages are English.** New client error/reason strings match the existing Russian copy in `add-device-model.ts`.
- **Testing is local only.** Never test against the live Pi; never create test devices on production. Server/client unit tests run under Vitest; the e2e runs against the local dockerized stack.
- **Out of scope (do not touch):** the owner's `postAddToken` re-auth gate (device A), and the invite-activation flow (`postRegisterVerify`, already single-touch).

---

## File Structure

- `packages/server/src/auth/pending-tickets.ts` — **modify**: add `consumePendingTicket` (atomic read-and-delete). `readPendingTicket` kept for the status peek.
- `packages/server/src/auth/pending-tickets.test.ts` — **modify**: add `consumePendingTicket` unit tests.
- `packages/server/src/auth/handlers.ts` — **modify**: add exported `clearedPendingCookie(config)` next to `clearedChallengeCookie`.
- `packages/server/src/auth/device-handlers.ts` — **modify**: add `postClaimSession(deps, req)`.
- `packages/server/src/auth/device-handlers.test.ts` — **modify**: add `postClaimSession` tests.
- `packages/server/src/auth/index.ts` — **modify**: register `POST /api/auth/devices/claim-session`.
- `packages/client/activation/src/model/add-device-model.ts` — **modify**: remove `completeLoginAfterApproval` + `startAuthenticationCeremony`; add `claimSession`; rewire `pollPendingStatus` with a single-flight guard.
- `packages/client/activation/src/model/add-device-model.test.ts` — **modify**: replace the post-approval login assertions with claim-session assertions; add single-flight + claim-failure tests.
- `packages/client/e2e/add-device.spec.ts` — **modify**: assert the joining device reaches the board with a `claim-session` POST and **no** `login/verify` POST.
- **nginx: no change.** `/api/auth/devices/claim-session` falls under the existing public, rate-limited `location /api/auth/` block, like the other add-device endpoints (it is authenticated by the pending ticket, not a session).

---

### Task 1: `consumePendingTicket` (atomic single-use claim of a pending ticket)

**Files:**
- Modify: `packages/server/src/auth/pending-tickets.ts`
- Test: `packages/server/src/auth/pending-tickets.test.ts`

**Interfaces:**
- Consumes: existing `pendingKey`, `PendingTicketRecordSchema`, `PendingTicketRecord`, `getJson` (from `./records`); `parseCookies` (from `./cookies`); `PendingTicketInvalidError` (from `./errors`); `runExclusive` (from `../storage/key-lock`); `ValkeyOps`, `AuthConfig`.
- Produces (relied on by Task 2):
  ```ts
  export async function consumePendingTicket(
    ops: ValkeyOps,
    config: AuthConfig,
    now: () => number,
    cookieHeader: string | undefined,
  ): Promise<PendingTicketRecord | PendingTicketInvalidError | Error>
  ```
  Resolves the ticket id from the pending cookie, then under `runExclusive(pendingKey(ticketId))` re-reads the record, deletes it, and returns it. Missing cookie / missing / expired record → `PendingTicketInvalidError`. Single-use: a second call returns `PendingTicketInvalidError`.

- [ ] **Step 1: Write the failing tests**

Append this `describe` block to `packages/server/src/auth/pending-tickets.test.ts` (after the existing `describe('issuePendingTicket / readPendingTicket', ...)` block). Add `consumePendingTicket` to the existing import from `./pending-tickets`:

```ts
import {
  PENDING_TTL_MS,
  consumePendingTicket,
  issuePendingTicket,
  readPendingTicket,
} from './pending-tickets'
```

```ts
describe('consumePendingTicket', () => {
  it('deletes and returns the record; a follow-up read no longer finds it', async () => {
    const ops = makeOps()
    const clock = makeClock(0)
    const config = makeConfig()

    const { ticketId, cookie } = await issuePendingTicket(ops, config, clock.now, {
      credentialId: 'cred-1',
      accountId: 'acc-1',
    })
    const header = cookieHeaderFor(cookie)

    const consumed = await consumePendingTicket(ops, config, clock.now, header)
    expect(consumed).not.toBeInstanceOf(Error)
    if (consumed instanceof Error) throw consumed
    expect(consumed).toEqual({
      ticketId,
      credentialId: 'cred-1',
      accountId: 'acc-1',
      expiresAt: PENDING_TTL_MS,
    })

    const afterRead = await readPendingTicket(ops, config, clock.now, header)
    expect(afterRead).toBeInstanceOf(PendingTicketInvalidError)
  })

  it('is single-use: a second consume returns PendingTicketInvalidError', async () => {
    const ops = makeOps()
    const clock = makeClock(0)
    const config = makeConfig()

    const { cookie } = await issuePendingTicket(ops, config, clock.now, {
      credentialId: 'cred-1',
      accountId: 'acc-1',
    })
    const header = cookieHeaderFor(cookie)

    const first = await consumePendingTicket(ops, config, clock.now, header)
    expect(first).not.toBeInstanceOf(Error)

    const second = await consumePendingTicket(ops, config, clock.now, header)
    expect(second).toBeInstanceOf(PendingTicketInvalidError)
  })

  it('returns PendingTicketInvalidError once the ticket has expired', async () => {
    const ops = makeOps()
    const clock = makeClock(0)
    const config = makeConfig()

    const { cookie } = await issuePendingTicket(ops, config, clock.now, {
      credentialId: 'cred-1',
      accountId: 'acc-1',
    })
    clock.set(PENDING_TTL_MS + 1)

    const result = await consumePendingTicket(ops, config, clock.now, cookieHeaderFor(cookie))
    expect(result).toBeInstanceOf(PendingTicketInvalidError)
  })

  it('returns PendingTicketInvalidError when the cookie header is missing', async () => {
    const ops = makeOps()
    const clock = makeClock(0)
    const config = makeConfig()

    const result = await consumePendingTicket(ops, config, clock.now, undefined)
    expect(result).toBeInstanceOf(PendingTicketInvalidError)
  })
})
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `rtk pnpm --filter server exec vitest run src/auth/pending-tickets.test.ts`
Expected: FAIL — `consumePendingTicket is not a function` / no matching export.

- [ ] **Step 3: Implement `consumePendingTicket`**

In `packages/server/src/auth/pending-tickets.ts`, add the `runExclusive` import and the new function. Update the top imports to include:

```ts
import { runExclusive } from '../storage/key-lock'
```

Then append this function (after `readPendingTicket`):

```ts
// Atomic, single-use claim of a pending ticket. Guarded by
// runExclusive(pendingKey(ticketId)) so two concurrent claims (two overlapping
// "approved" polls from the same device) can never both consume it: the loser
// re-reads inside the lock, finds it already deleted, and returns
// PendingTicketInvalidError. readPendingTicket stays the non-consuming peek used
// by the status check.
export async function consumePendingTicket(
  ops: ValkeyOps,
  config: AuthConfig,
  now: () => number,
  cookieHeader: string | undefined,
): Promise<PendingTicketRecord | PendingTicketInvalidError | Error> {
  const ticketId = parseCookies(cookieHeader)[config.pendingCookieName]
  if (!ticketId) return new PendingTicketInvalidError()

  return runExclusive(pendingKey(ticketId), async () => {
    const record = await getJson(ops, pendingKey(ticketId), PendingTicketRecordSchema)
    if (record instanceof Error) return record
    if (record === null || now() >= record.expiresAt) return new PendingTicketInvalidError()

    await ops.del(pendingKey(ticketId))
    return record
  })
}
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `rtk pnpm --filter server exec vitest run src/auth/pending-tickets.test.ts`
Expected: PASS — all `consumePendingTicket` cases plus the untouched `issuePendingTicket / readPendingTicket` cases green.

- [ ] **Step 5: Commit**

```bash
rtk git add packages/server/src/auth/pending-tickets.ts packages/server/src/auth/pending-tickets.test.ts
rtk git commit -m "feat(auth): add consumePendingTicket for single-use ticket claim"
```

---

### Task 2: `postClaimSession` endpoint (mint session on approval)

**Files:**
- Modify: `packages/server/src/auth/handlers.ts` (add `clearedPendingCookie`)
- Modify: `packages/server/src/auth/device-handlers.ts` (add `postClaimSession`)
- Modify: `packages/server/src/auth/index.ts` (register the route)
- Test: `packages/server/src/auth/device-handlers.test.ts`

**Interfaces:**
- Consumes: `consumePendingTicket` (Task 1); `readPendingTicket` (`./pending-tickets`); `getDevice`, `DeviceNotFoundError` (already imported in `device-handlers.ts`); `issueSession` (`./sessions`); `clientIp` (`../http/client-ip`); `sessionCookieFor`, `clearedPendingCookie` (`./handlers`); `auditFor`, `toAuthResult` (already imported).
- Produces:
  ```ts
  export function clearedPendingCookie(config: AuthConfig): string
  export async function postClaimSession(deps: AuthDeps, req: IncomingMessage): Promise<AuthResult>
  ```
  The response body always carries a `status` discriminator (`'approved' | 'pending' | 'denied'`), mirroring `getPendingStatus`. Only `approved` sets cookies (session + cleared pending) and includes `credentialId`. Route: `POST /api/auth/devices/claim-session`.

- [ ] **Step 1: Add `clearedPendingCookie` to `handlers.ts`**

In `packages/server/src/auth/handlers.ts`, directly **after** the existing `clearedChallengeCookie` function (around line 131), add:

```ts
export function clearedPendingCookie(config: AuthConfig): string {
  return clearCookie(config.pendingCookieName, {
    httpOnly: true,
    secure: config.secureCookies,
    sameSite: 'Strict',
    path: '/',
  })
}
```

(`clearCookie` and `AuthConfig` are already imported in `handlers.ts`.)

- [ ] **Step 2: Write the failing tests for `postClaimSession`**

In `packages/server/src/auth/device-handlers.test.ts`, add `postClaimSession` to the existing import from `./device-handlers`:

```ts
import {
  getAccountInfo,
  getDevices,
  getPendingStatus,
  postAddToken,
  postAddTokenOptions,
  postApproveDevice,
  postClaimSession,
  postDenyDevice,
  postDeviceRegisterOptions,
  postDeviceRegisterVerify,
  postRevokeDevice,
} from './device-handlers'
```

Then append this `describe` block at the end of the file (after `describe('getPendingStatus', ...)`). It reuses the file's existing helpers (`makeOps`, `makeClock`, `makeConfig`, `fakeReq`, `cookieHeaderFor`, `getSetCookies`, `seedAccountWithDevice`, `seedPendingDevice`) and the already-imported `createAccount`, `addDeviceToAccount`, `storeDevice`, `issuePendingTicket`, `verifySession`:

```ts
describe('postClaimSession', () => {
  async function seedActiveJoiningDevice(ops: Ops, accountId: string, credentialId: string) {
    await storeDevice(ops, {
      credentialId,
      publicKey: 'pk',
      signCount: 0,
      label: 'New phone',
      createdAt: 0,
      lastSeenAt: 0,
      disabled: false,
      accountId,
      status: 'active',
      addedVia: 'add-token',
    })
    await addDeviceToAccount(ops, accountId, credentialId, { countsAgainstLimit: false })
  }

  it('returns 401 for a missing/invalid pending ticket', async () => {
    const ops = makeOps()
    const clock = makeClock(0)
    const config = makeConfig()
    const deps: AuthDeps = { ops, config, now: clock.now, audit: vi.fn() }

    const result = await postClaimSession(deps, fakeReq(undefined))

    expect(result.status).toBe(401)
    expect(result.body).toEqual({ code: 'pending_ticket_invalid' })
  })

  it('returns { status: pending } and leaves the ticket intact while the device awaits approval', async () => {
    const ops = makeOps()
    const clock = makeClock(0)
    const config = makeConfig()
    const account = await createAccount(ops, clock.now, { name: 'Acc', inviteId: 'inv-1' })
    await seedPendingDevice(ops, account.id, 'cred-pending')
    const { cookie } = await issuePendingTicket(ops, config, clock.now, {
      credentialId: 'cred-pending',
      accountId: account.id,
    })
    const deps: AuthDeps = { ops, config, now: clock.now, audit: vi.fn() }

    const result = await postClaimSession(
      deps,
      fakeReq(undefined, { cookie: cookieHeaderFor(cookie) }),
    )

    expect(result.status).toBe(200)
    expect(result.body).toEqual({ status: 'pending' })
    expect(getSetCookies(result.headers)).toHaveLength(0)

    // Ticket intact: a subsequent status peek still resolves it.
    const stillThere = await getPendingStatus(
      deps,
      fakeReq(undefined, { cookie: cookieHeaderFor(cookie) }),
    )
    expect(stillThere.body).toEqual({ status: 'pending' })
  })

  it('returns { status: denied } when the owner denied (device record gone)', async () => {
    const ops = makeOps()
    const clock = makeClock(0)
    const config = makeConfig()
    const account = await createAccount(ops, clock.now, { name: 'Acc', inviteId: 'inv-1' })
    // A ticket whose credential has no device record models a denied join
    // (deny deletes the pending device).
    const { cookie } = await issuePendingTicket(ops, config, clock.now, {
      credentialId: 'cred-gone',
      accountId: account.id,
    })
    const deps: AuthDeps = { ops, config, now: clock.now, audit: vi.fn() }

    const result = await postClaimSession(
      deps,
      fakeReq(undefined, { cookie: cookieHeaderFor(cookie) }),
    )

    expect(result.status).toBe(200)
    expect(result.body).toEqual({ status: 'denied' })
    expect(getSetCookies(result.headers)).toHaveLength(0)
  })

  it('mints a session for an approved device, clears the pending cookie, consumes the ticket, and audits a login', async () => {
    const ops = makeOps()
    const clock = makeClock(0)
    const config = makeConfig()
    const account = await seedAccountWithDevice(ops, clock.now, 'cred-active')
    await seedActiveJoiningDevice(ops, account.id, 'cred-new')
    const { cookie } = await issuePendingTicket(ops, config, clock.now, {
      credentialId: 'cred-new',
      accountId: account.id,
    })
    const deps: AuthDeps = { ops, config, now: clock.now, audit: vi.fn() }
    const cookieHeader = cookieHeaderFor(cookie)

    const result = await postClaimSession(deps, fakeReq(undefined, { cookie: cookieHeader }))

    expect(result.status).toBe(200)
    expect(result.body).toEqual({ status: 'approved', credentialId: 'cred-new' })

    const cookies = getSetCookies(result.headers)
    const sessionCookie = cookies.find((c) => c.startsWith(`${config.sessionCookieName}=`))
    expect(sessionCookie).toBeDefined()
    expect(sessionCookie).toContain('HttpOnly')
    expect(sessionCookie).toContain('SameSite=Lax')
    const clearedPending = cookies.find((c) => c.startsWith(`${config.pendingCookieName}=`))
    expect(clearedPending).toContain('Max-Age=0')

    // The minted session is valid.
    const sessionPair = cookieHeaderFor(sessionCookie as string)
    const sessionId = sessionPair.slice(config.sessionCookieName.length + 1)
    const verified = await verifySession(ops, config, clock.now, sessionId)
    expect(verified).not.toBeInstanceOf(Error)

    expect(deps.audit).toHaveBeenCalledWith(
      expect.objectContaining({ event: 'login', credentialId: 'cred-new' }),
    )

    // Single-use: a second claim on the same ticket now fails.
    const second = await postClaimSession(deps, fakeReq(undefined, { cookie: cookieHeader }))
    expect(second.status).toBe(401)
    expect(second.body).toEqual({ code: 'pending_ticket_invalid' })
  })

  it('rejects an expired ticket with 401', async () => {
    const ops = makeOps()
    const clock = makeClock(0)
    const config = makeConfig()
    const account = await seedAccountWithDevice(ops, clock.now, 'cred-active')
    await seedActiveJoiningDevice(ops, account.id, 'cred-new')
    const { cookie } = await issuePendingTicket(ops, config, clock.now, {
      credentialId: 'cred-new',
      accountId: account.id,
    })
    clock.set(15 * MINUTE + 1)
    const deps: AuthDeps = { ops, config, now: clock.now, audit: vi.fn() }

    const result = await postClaimSession(
      deps,
      fakeReq(undefined, { cookie: cookieHeaderFor(cookie) }),
    )

    expect(result.status).toBe(401)
    expect(result.body).toEqual({ code: 'pending_ticket_invalid' })
  })
})
```

- [ ] **Step 3: Run the tests to verify they fail**

Run: `rtk pnpm --filter server exec vitest run src/auth/device-handlers.test.ts`
Expected: FAIL — `postClaimSession` is not exported.

- [ ] **Step 4: Implement `postClaimSession` and register the route**

In `packages/server/src/auth/device-handlers.ts`, extend the imports:

- Add to the existing `./handlers` import (currently `clearedChallengeCookie, deviceLabelFromUa, toAuthResult`):
  ```ts
  import {
    clearedChallengeCookie,
    clearedPendingCookie,
    deviceLabelFromUa,
    sessionCookieFor,
    toAuthResult,
  } from './handlers'
  ```
- Add to the existing `./pending-tickets` import:
  ```ts
  import { consumePendingTicket, issuePendingTicket, readPendingTicket } from './pending-tickets'
  ```
- Add two new imports:
  ```ts
  import { clientIp } from '../http/client-ip'
  import { issueSession } from './sessions'
  ```

Then append `postClaimSession` at the end of the file (after `getPendingStatus`):

```ts
// Mint the joining device's session directly from its pending ticket once the
// owner has approved it — no second WebAuthn ceremony. The response mirrors
// getPendingStatus's discriminator so the client parses one shape regardless of
// outcome; only 'approved' sets cookies and returns credentialId.
export async function postClaimSession(deps: AuthDeps, req: IncomingMessage): Promise<AuthResult> {
  const emit = auditFor(deps, req)

  // Peek (non-consuming): a not-yet-approved device must keep its ticket so the
  // client can keep polling.
  const ticket = await readPendingTicket(deps.ops, deps.config, deps.now, req.headers.cookie)
  if (ticket instanceof Error) return toAuthResult(ticket)

  const device = await getDevice(deps.ops, ticket.credentialId)
  // A missing device record means the owner denied the join request: denying
  // deletes the pending device (see postDenyDevice / revokeDevice).
  if (device instanceof DeviceNotFoundError) return { status: 200, body: { status: 'denied' } }
  if (device instanceof Error) return toAuthResult(device)
  // Not yet approved — leave the ticket intact and let the client keep polling.
  if (device.status !== 'active') return { status: 200, body: { status: 'pending' } }

  // Approved. Consume the single-use ticket atomically before minting a session
  // so a racing second claim (two overlapping approved polls) finds it already
  // gone and fails cleanly here instead of minting a second session.
  const consumed = await consumePendingTicket(deps.ops, deps.config, deps.now, req.headers.cookie)
  if (consumed instanceof Error) return toAuthResult(consumed)

  const session = await issueSession(deps.ops, deps.config, deps.now, {
    accountId: device.accountId,
    credentialId: device.credentialId,
    ...(clientIp(req) ? { ip: clientIp(req) as string } : {}),
    ...(req.headers['user-agent'] ? { ua: req.headers['user-agent'] } : {}),
  })

  emit('login', { accountId: device.accountId, credentialId: device.credentialId })

  return {
    status: 200,
    body: { status: 'approved', credentialId: device.credentialId },
    headers: {
      'Set-Cookie': [
        sessionCookieFor(deps.config, session.sessionId, deps.config.sessionTtlSlidingMs),
        clearedPendingCookie(deps.config),
      ],
    },
  }
}
```

In `packages/server/src/auth/index.ts`, add `postClaimSession` to the import from `./device-handlers`, then register the route directly after the existing `GET /api/auth/devices/pending-status` route:

```ts
  router.on(
    'POST',
    '/api/auth/devices/claim-session',
    async (req: IncomingMessage, res: ServerResponse) => {
      sendAuth(res, await postClaimSession(authDeps, req))
    },
  )
```

- [ ] **Step 5: Run the tests to verify they pass**

Run: `rtk pnpm --filter server exec vitest run src/auth/device-handlers.test.ts`
Expected: PASS — the five `postClaimSession` cases plus all pre-existing device-handler cases green.

- [ ] **Step 6: Typecheck the server**

Run: `rtk pnpm --filter server exec tsc --noEmit`
Expected: no errors.

- [ ] **Step 7: Commit**

```bash
rtk git add packages/server/src/auth/handlers.ts packages/server/src/auth/device-handlers.ts packages/server/src/auth/index.ts packages/server/src/auth/device-handlers.test.ts
rtk git commit -m "feat(auth): mint device session via POST /api/auth/devices/claim-session"
```

---

### Task 3: Client — claim the session instead of a second ceremony

**Files:**
- Modify: `packages/client/activation/src/model/add-device-model.ts`
- Test: `packages/client/activation/src/model/add-device-model.test.ts`

**Interfaces:**
- Consumes (server contract from Task 2): `POST /api/auth/devices/claim-session` with **no body** (the pending-ticket cookie carries identity) → `200 { status: 'approved' | 'pending' | 'denied', credentialId? }`; a transport error or non-200 → treated as an `AddDeviceError`.
- Produces: no change to the public `AddDeviceModel` interface (`pollPendingStatus` keeps its `Action<[], Promise<void>>` signature). The `AddDeviceDeps.startAuthenticationCeremony` field is **removed**.

Note: only `packages/client/activation/src/model/add-device-model.ts` is touched. The separate models in `packages/client/activation/src/model/activation-model.ts` and `packages/client/src/account/model/add-device-model.ts` keep their own `startAuthenticationCeremony` and are out of scope.

- [ ] **Step 1: Rewrite the polling tests (red)**

In `packages/client/activation/src/model/add-device-model.test.ts`, inside `describe('registration + polling flow', ...)`:

**(a) Replace** the test `it('goes registering -> waiting -> done, logs in, and navigates on approval', ...)` (the whole `it(...)`) with:

```ts
  it('goes registering -> waiting -> done, claims a session, and navigates on approval', async () => {
    vi.useFakeTimers()

    const { http, calls } = makeScriptedHttp({
      '/api/auth/devices/register/options': [
        { status: 200, body: { options: { challenge: 'add-device-challenge' } } },
      ],
      '/api/auth/devices/register/verify': [{ status: 200, body: { credentialId: 'cred-b' } }],
      '/api/auth/devices/pending-status': [
        { status: 200, body: { status: 'pending' } },
        { status: 200, body: { status: 'approved' } },
      ],
      '/api/auth/devices/claim-session': [
        { status: 200, body: { status: 'approved', credentialId: 'cred-b' } },
      ],
    })
    const startRegistrationCeremony = vi.fn().mockResolvedValue({ id: 'cred-b', rawId: 'raw' })
    const navigate = vi.fn()
    const storage = createStorage()

    const model = createAddDeviceModel({
      currentOrigin: CURRENT_ORIGIN,
      http,
      startRegistrationCeremony,
      navigate,
      storage,
    })

    await model.submitManual('K7QP-3M9X')

    expect(model.token()).toBe('K7QP3M9X')
    expect(startRegistrationCeremony).toHaveBeenCalledWith({
      optionsJSON: { challenge: 'add-device-challenge' },
    })
    expect(model.mode()).toBe('waiting')

    // First poll tick: still pending.
    await vi.advanceTimersByTimeAsync(2_000)
    expect(model.mode()).toBe('waiting')

    // Second poll tick: approved -> claim-session mints the session, then navigate.
    await vi.advanceTimersByTimeAsync(2_000)

    const claimCall = calls.find((c) => c.url === '/api/auth/devices/claim-session')
    expect(claimCall).toEqual({
      method: 'POST',
      url: '/api/auth/devices/claim-session',
      json: undefined,
    })
    // No second WebAuthn ceremony: the login endpoints are never touched.
    expect(calls.some((c) => c.url === '/api/auth/login/options')).toBe(false)
    expect(calls.some((c) => c.url === '/api/auth/login/verify')).toBe(false)
    expect(storage.set).toHaveBeenCalledWith('cred-b')
    expect(model.mode()).toBe('done')
    expect(navigate).toHaveBeenCalledWith('/')

    // Polling has stopped -- no further pending-status calls on more ticks.
    const callsAfterDone = calls.length
    await vi.advanceTimersByTimeAsync(10_000)
    expect(calls.length).toBe(callsAfterDone)
  })
```

**(b) Add** these two tests inside the same `describe('registration + polling flow', ...)` block:

```ts
  it('keeps waiting and surfaces an error when the claim fails, then resumes polling', async () => {
    vi.useFakeTimers()

    const { http } = makeScriptedHttp({
      '/api/auth/devices/register/options': [
        { status: 200, body: { options: { challenge: 'add-device-challenge' } } },
      ],
      '/api/auth/devices/register/verify': [{ status: 200, body: { credentialId: 'cred-b' } }],
      // First poll: approved -> claim fails (500). Later poll: pending again.
      '/api/auth/devices/pending-status': [
        { status: 200, body: { status: 'approved' } },
        { status: 200, body: { status: 'pending' } },
      ],
      '/api/auth/devices/claim-session': [{ status: 500, body: {} }],
    })
    const startRegistrationCeremony = vi.fn().mockResolvedValue({ id: 'cred-b' })
    const navigate = vi.fn()

    const model = createAddDeviceModel({
      currentOrigin: CURRENT_ORIGIN,
      http,
      startRegistrationCeremony,
      navigate,
      storage: createStorage(),
    })

    await model.submitManual('K7QP-3M9X')
    expect(model.mode()).toBe('waiting')

    // Approved poll -> claim 500 -> stay on waiting with an error, do not navigate.
    await vi.advanceTimersByTimeAsync(2_000)
    expect(model.mode()).toBe('waiting')
    expect(model.error()).not.toBeNull()
    expect(navigate).not.toHaveBeenCalled()

    // Polling resumed: the next (pending) tick recovers and clears the error.
    await vi.advanceTimersByTimeAsync(2_000)
    expect(model.mode()).toBe('waiting')
    expect(model.error()).toBeNull()
  })

  it('single-flights the claim so two overlapping approved polls claim at most once', async () => {
    const { http, calls } = makeScriptedHttp({
      '/api/auth/devices/pending-status': [
        { status: 200, body: { status: 'approved' } },
        { status: 200, body: { status: 'approved' } },
      ],
      '/api/auth/devices/claim-session': [
        { status: 200, body: { status: 'approved', credentialId: 'cred-b' } },
      ],
    })
    const navigate = vi.fn()
    const storage = createStorage()

    const model = createAddDeviceModel({
      currentOrigin: CURRENT_ORIGIN,
      http,
      navigate,
      storage,
    })
    model.mode.set('waiting')

    // Two poll passes fired concurrently (models a slow GET overlapping the next
    // tick): both see 'approved', but the single-flight guard admits one claim.
    await Promise.all([model.pollPendingStatus(), model.pollPendingStatus()])

    const claimCalls = calls.filter((c) => c.url === '/api/auth/devices/claim-session')
    expect(claimCalls).toHaveLength(1)
    expect(storage.set).toHaveBeenCalledWith('cred-b')
    expect(navigate).toHaveBeenCalledWith('/')
  })
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `rtk pnpm --filter client exec vitest run activation/src/model/add-device-model.test.ts`
Expected: FAIL — the old model still calls `login/options` (unscripted → throws) and there is no single-flight guard.

- [ ] **Step 3: Rewrite the model**

Edit `packages/client/activation/src/model/add-device-model.ts`:

**(a) Imports** — replace the two `@simplewebauthn/browser` import statements (the `import type { ... }` block and the `import { startAuthentication as ..., startRegistration as ... }` block) with:

```ts
import type { PublicKeyCredentialCreationOptionsJSON } from '@simplewebauthn/browser'
import { startRegistration as browserStartRegistration } from '@simplewebauthn/browser'
```

**(b) `AddDeviceDeps`** — remove the `startAuthenticationCeremony` field and reword the ceremony comment to singular. The relevant part of the interface becomes:

```ts
  // Matches the real @simplewebauthn/browser signature exactly (takes a single
  // `{ optionsJSON }` object), mirroring activation-model.ts's ActivationDeps so
  // a test double stays call-compatible with the real ceremony.
  startRegistrationCeremony: typeof browserStartRegistration
}
```

**(c) `createAddDeviceModel` defaults** — remove the `startAuthenticationCeremony` default so the `deps` object ends:

```ts
    http: overrides.http ?? new HttpClient(),
    startRegistrationCeremony: overrides.startRegistrationCeremony ?? browserStartRegistration,
  }
```

**(d) Closure state** — remove the `registeredCredentialId` declaration and add a `claiming` single-flight flag. The block that currently declares `registeredCredentialId`, `pollIntervalId`, `pollTicks` becomes:

```ts
  let pollIntervalId: ReturnType<typeof window.setInterval> | undefined
  let pollTicks = 0
  // Single-flight guard: with the post-approval ceremony gone, an overlapping
  // duplicate claim is already harmless, but this also stops a second claim from
  // hitting an already-consumed (single-use) ticket.
  let claiming = false
```

**(e) Add a claim-result type** — after the `type JsonResult = ...` declaration, add:

```ts
type ClaimOutcome =
  | { status: 'approved'; credentialId: string }
  | { status: 'pending' }
  | { status: 'denied' }
```

**(f) Remove `completeLoginAfterApproval`** — delete the entire function (its doc comment through its closing brace) that begins `async function completeLoginAfterApproval(` and add `claimSession` in its place:

```ts
  // Claims the joining device's session once the owner approves it: a single
  // POST authenticated by the pending-ticket cookie. No WebAuthn assertion and
  // no authenticator credential selection — the server already holds everything
  // needed to mint the session (valid pending ticket + device now active). A
  // plain async helper (not a reatom action); its awaited fetch is wrap()ed
  // internally and the caller wrap()s the whole call, matching this file's
  // convention.
  async function claimSession(): Promise<AddDeviceError | ClaimOutcome> {
    const result = await wrap(postJson(deps.http, '/api/auth/devices/claim-session', undefined))
    if (result instanceof Error) return result
    if (result.status !== 200) {
      return new AddDeviceError({ reason: `не удалось получить сессию (код ${result.status})` })
    }

    const body = result.body as {
      status?: 'approved' | 'pending' | 'denied'
      credentialId?: string
    }
    if (body.status === 'approved') {
      if (!body.credentialId) {
        return new AddDeviceError({ reason: 'сервер не вернул идентификатор устройства' })
      }
      return { status: 'approved', credentialId: body.credentialId }
    }
    if (body.status === 'denied') return { status: 'denied' }
    return { status: 'pending' }
  }
```

**(g) Rewrite `pollPendingStatus`** — replace the whole `const pollPendingStatus = action(async () => { ... }, 'addDevice.pollPendingStatus')` with:

```ts
  const pollPendingStatus = action(async () => {
    const result = await wrap(getJson(deps.http, '/api/auth/devices/pending-status'))
    if (result instanceof Error) {
      error.set(result.message)
      return
    }
    if (result.status !== 200) {
      error.set(`Не удалось проверить статус (код ${result.status})`)
      return
    }

    // A successful response clears any stale error left behind by an earlier
    // transient failure (mirrors startRegistration/submitManual clearing `error`
    // at entry) -- otherwise a one-off blip's message would linger after
    // polling recovers.
    error.set(null)

    const { status } = result.body as { status: 'approved' | 'pending' | 'denied' }
    if (status === 'pending') return

    stopPolling()

    if (status === 'denied') {
      mode.set('rejected')
      return
    }

    // status === 'approved': mint the session with one server round-trip. The
    // single-flight guard means two overlapping approved polls (a GET slower
    // than the 2s interval) claim at most once.
    if (claiming) return
    claiming = true

    const claim = await wrap(claimSession())
    if (claim instanceof Error) {
      claiming = false
      error.set(claim.message)
      // Retry affordance: resume polling so a later approved tick re-attempts
      // the claim (the single-use ticket is untouched on a failed claim).
      beginPolling()
      return
    }

    if (claim.status === 'denied') {
      mode.set('rejected')
      return
    }

    if (claim.status === 'pending') {
      // Defensive: an `approved` poll should not see the device un-approved on
      // the claim. Resume polling rather than get stuck.
      claiming = false
      beginPolling()
      return
    }

    // claim.status === 'approved'
    deps.storage.set(claim.credentialId)
    mode.set('done')
    deps.navigate('/')
  }, 'addDevice.pollPendingStatus')
```

**(h) `startRegistration`** — remove the now-dead `registeredCredentialId` assignment. The tail of `startRegistration` (currently `const { credentialId } = verifyResult.body ...; registeredCredentialId = credentialId; mode.set('waiting'); beginPolling()`) becomes just:

```ts
    mode.set('waiting')
    beginPolling()
  }, 'addDevice.startRegistration')
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `rtk pnpm --filter client exec vitest run activation/src/model/add-device-model.test.ts`
Expected: PASS — the rewritten happy-path, the claim-failure test, the single-flight test, plus the untouched `stageScannedCode` / `submitManual` / ceremony-failure / rejected / stale-error / give-up tests.

- [ ] **Step 5: Typecheck the client**

Run: `rtk pnpm --filter client exec tsc --noEmit`
Expected: no errors (confirms the removed `startAuthenticationCeremony` field / import left no dangling references, and `AddDeviceScreen.tsx`'s `createAddDeviceModel()` call still type-checks).

- [ ] **Step 6: Commit**

```bash
rtk git add packages/client/activation/src/model/add-device-model.ts packages/client/activation/src/model/add-device-model.test.ts
rtk git commit -m "feat(activation): claim session on approval instead of a second ceremony"
```

---

### Task 4: e2e — prove the joining device reaches the board without a second ceremony

**Files:**
- Test: `packages/client/e2e/add-device.spec.ts`

**Interfaces:**
- Consumes: the full stack from Tasks 2–3 (`claim-session` route + client `claimSession`). Uses the existing page objects (`ActivatePage`, `AccountMenuPage`, `MyDevicesDialogPage`, `AddDeviceActivatePage`, `AddDeviceModalPage`) and helpers (`registerAccountAndDeviceA`, `mintAddDeviceCode`) already in the spec.

- [ ] **Step 1: Add network assertions to the happy-path e2e**

In `packages/client/e2e/add-device.spec.ts`, in the first test (`test('device B registers via a minted code, owner approves over SSE, device B auto-logs in', ...)`), attach a POST-path recorder to `pageB` immediately after `pageB` is created (right after `const pageB = await contextB.newPage()`):

```ts
  // Record device B's POST paths so we can prove it obtains its session via
  // claim-session and never runs a second login ceremony (login/verify).
  const deviceBPosts: string[] = []
  pageB.on('request', (req) => {
    if (req.method() === 'POST') deviceBPosts.push(new URL(req.url()).pathname)
  })
```

Then, after the existing board-redirect + session assertions (after `expect(sessionB.status()).toBe(200)`), add:

```ts
  expect(deviceBPosts).toContain('/api/auth/devices/claim-session')
  expect(deviceBPosts).not.toContain('/api/auth/login/verify')
```

Rename the test title to reflect the new mechanism:

```ts
test('device B registers via a minted code, owner approves over SSE, device B claims a session (no second ceremony)', async ({
  browser,
  request,
}) => {
```

- [ ] **Step 2: Run the e2e (local dockerized stack)**

The e2e needs a reachable Valkey and the assembled build (see project `CLAUDE.md`). Run the fully isolated dockerized suite, which includes this spec:

Run: `rtk pnpm test:e2e:docker`

Expected: PASS. In particular the renamed happy-path test passes with the new `claim-session` / no-`login/verify` assertions, and the denied / invalid-code / modal-stacking tests still pass unchanged. Tear down afterward with `rtk pnpm test:e2e:docker:down` if it does not auto-clean.

> If this agent's sandbox cannot run Docker, stop here and report that Step 2 needs the orchestrator (or a Docker-capable environment) to run `pnpm test:e2e:docker`; do not mark the task complete on unit tests alone.

- [ ] **Step 3: Commit**

```bash
rtk git add packages/client/e2e/add-device.spec.ts
rtk git commit -m "test(activation): assert joining device claims a session, runs no second ceremony"
```

---

## Final verification (after all tasks)

- [ ] Full local gate: `rtk pnpm check` (oxlint + oxfmt check + workspace typecheck + all Vitest). Expected: green.
- [ ] Confirm the audit trail for a new device now reads `device_pending → device_approved → login` (the `login` emitted by `postClaimSession`) with **no** `login_failed … DeviceNotFoundError`.

---

## Self-Review

**1. Spec coverage.**
- Server `consumePendingTicket` (atomic, runExclusive-guarded, single-use) → Task 1. ✅
- Server `clearedPendingCookie` → Task 2 Step 1. ✅
- Server `postClaimSession` with `status` discriminator, denied/pending/approved branches, ticket consume, `issueSession`, `emit('login')`, session + cleared-pending cookies → Task 2. ✅
- Route `POST /api/auth/devices/claim-session` → Task 2 Step 4. ✅
- nginx no change → documented in File Structure. ✅
- Client: remove `completeLoginAfterApproval` + `startAuthenticationCeremony`; add `claimSession`; `pollPendingStatus` approved→claim switch (approved/denied/pending/error); single-flight guard → Task 3. ✅
- Tests: `pending-tickets.test.ts` (Task 1), `device-handlers.test.ts` (Task 2), `add-device-model.test.ts` claim/no-`startAuthentication`/claim-failure/single-flight (Task 3), `add-device.spec.ts` no-`login/verify` (Task 4). ✅
- Edge cases from the spec — claim-before-approval (`pending`, ticket intact), denied-between-poll-and-claim (`denied`), poll race (single-flight + atomic consume), expired ticket — all have server and/or client tests. ✅

**2. Placeholder scan.** No `TODO`/`TBD`/"add error handling"/"similar to Task N"; every code step carries full code and every run step an exact command + expected outcome.

**3. Type consistency.** `consumePendingTicket(ops, config, now, cookieHeader) → PendingTicketRecord | Error` is produced in Task 1 and consumed with the same signature in Task 2. `postClaimSession(deps, req) → AuthResult` and its `{ status, credentialId? }` body shape match the client's `ClaimOutcome` parsing in Task 3. `clearedPendingCookie(config)` defined in Task 2 Step 1 and used in Task 2 Step 4. Client `claimSession(): AddDeviceError | ClaimOutcome` return type matches every branch of the rewritten `pollPendingStatus`.
