# Plan 2 — Accounts & Multi-Device Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.
>
> **Workflow note (2026-07-06):** this feature is NO LONGER driven by the Looper loop. Build it **sequentially**, task by task, in this worktree (`./.worktrees/webauthn-gate`, branch `feat/device-invite-webauthn-gate`). After each task: run the relevant `pnpm --filter … test` / `typecheck`, then a Codex review (`codex exec review --uncommitted -m gpt-5.5` while iterating, `--base main` at phase boundaries) before moving on.

**Goal:** Let an account own multiple devices — a signed-in device mints a short, single-use add-device code (QR / link / manual), a second device self-enrolls into the *same account* as a `pending` device, and the owner approves it in-app over a realtime channel; expose a "My devices" panel to list/approve/deny/revoke devices.

**Architecture:** Extends the already-implemented Plan 1 dormant core. New server endpoints under `/api/auth/devices/*` reuse the existing Valkey key-lock, WebAuthn wrappers, session/challenge stores, and the SSE fanout (via `publishChange` under an `auth:account:{id}` key). The board host gains an account avatar → dropdown → "My devices" dialog + add-device QR modal (Reatom models + shadcn). The standalone activation app gains an `/add-device` mode (scan via `react-zxing` / manual code / register / wait-for-approval). **The nginx gate stays OFF — that is Plan 3.**

**Tech Stack:** Node `http` + `find-my-way`; Valkey via `ValkeyOps`; `@simplewebauthn/server` + `@simplewebauthn/browser`; errore (errors-as-values) + Zod; Reatom v1001 (`reatomMemo`, `reatomForm`, `atom`/`computed`/`action`, `wrap`); shadcn/`radix-ui` + `lucide-react`; new deps `qr-code-styling` (board) and `react-zxing` (activation).

## Global Constraints

Every task's requirements implicitly include these (verbatim from the spec / repo conventions):

- **errore everywhere:** return `Error | T` unions, never throw; narrow with `instanceof Error`. Public auth errors extend `AuthError` (carry `status`/`code`/`publicMessage`), already in `packages/server/src/auth/errors.ts`. All Plan 2 error types already exist there: `AddTokenInvalidError`, `PendingTicketInvalidError`, `DeviceLimitError`, `LastActiveDeviceError`, `NotAuthorizedError`, `AccountNotFoundError`, `DeviceNotFoundError`, `DeviceDisabledError`.
- **Zod on every request body/param;** validation failure → `422` with `formatZodError`.
- **Reatom convention:** every exported React component is wrapped with `reatomMemo` from `widget-sdk/reatom/reatom-memo`. Business logic/derived state/async/timers live in `model/`; `ui/` holds only refs, DOM interop, view glue. After an `await`, only touch atoms through pre-created `wrap()`ed closures (see [[reatom-context-start-unwrapped-continuations]]).
- **Strict WebAuthn profile:** `userVerification: 'required'`, `residentKey: 'required'`, ES256 (−7) + EdDSA (−8), `attestation: 'none'`, `excludeCredentials` = the account's existing devices on registration. Use the existing wrappers in `auth/webauthn.ts` — never hand-roll COSE/attestation.
- **Add-device code:** Crockford base32 (`0123456789ABCDEFGHJKMNPQRSTVWXYZ`, no I/L/O/U), canonical = 8 upper-case chars; displayed grouped `XXXX-XXXX`. The **QR encodes the full URL** `${PUBLIC_APP_URL}/add-device?token=<canonical>`; manual entry and the in-app scanner both normalize to the canonical form. The code alone never grants access — registration yields a `pending` device with no session; the owner must approve. Guards: single-use, 5-min TTL, per-code failed-attempt lock (mirror `recordInviteFailure`), plus (Plan 3) the nginx IP limit.
- **Code inputs accept a pasted link.** Any code-entry field listens for the `paste` event and runs the shared `extractAddCode` regex extractor: when the pasted text is a full `/add-device?token=…` URL (or a bare code), it `preventDefault()`s the raw paste and fills the field with the extracted, formatted code. This is the same extractor the scanner and manual typing use — one implementation, three entry points.
- **Cookies:** session `__Host-mb_session` (`SameSite=Lax`), challenge `__Host-mb_chal` (`Strict`), pending `__Host-mb_pending` (`Strict`) — names already resolved in `auth/config.ts` (`sessionCookieName`/`challengeCookieName`/`pendingCookieName`), `__Host-` prefix auto-stripped when `secureCookies` is false (dev).
- **UI copy is all Russian** (see the design file for exact strings).
- **Visual source of truth:** `docs/superpowers/specs/designs/Мультиустройства.dc.html`. UI tasks must match the named state's spacing/measurements exactly (same convention already used for `Activate.dc.html`). Tokens from `packages/client/src/shared/theme/tokens.css`; light/dark via `data-theme`.
- **Gate OFF:** do not touch `nginx.conf` / `auth_request` / rate-limit config. That is Plan 3.
- **TDD + frequent commits.** Server tests use the in-memory Valkey stand-in (`memory-ops`, the pattern already used by `invites.test.ts`/`handlers.test.ts`). Run `pnpm --filter server test` / `pnpm --filter client test` / `pnpm typecheck` per touched package; `pnpm lint:fix` + `pnpm format` before each commit.

---

## File Structure

**Server (`packages/server/src/`)**

| File | Responsibility | Status |
| --- | --- | --- |
| `auth/add-tokens.ts` (+`.test.ts`) | Short add-device code: generate/normalize, `deviceadd:*` store, lookup/consume/fail-lock | **create** |
| `auth/pending-tickets.ts` (+`.test.ts`) | `pending:*` ticket store + `__Host-mb_pending` cookie | **create** |
| `auth/device-handlers.ts` (+`.test.ts`) | HTTP handlers for `/api/auth/devices/*` + `/api/auth/account` | **create** |
| `auth/device-events.ts` (+`.test.ts`) | `authAccountKey` + `publishAuthDeviceEvent` (reuses `publishChange`) | **create** |
| `auth/schemas.ts` | Add Zod bodies for the new endpoints | modify |
| `auth/records.ts` | Extend `AddTokenRecordSchema` with `failedAttempts`; add `authAccountKey` helper | modify |
| `auth/session-guard.ts` (+`.test.ts`) | `requireSession(deps, req)` shared helper | **create** |
| `auth/index.ts` | Register the new `/api/auth/devices/*` + `/api/auth/account` routes | modify |
| `app.ts` | Add the session-gated `GET /api/auth/devices/events` SSE endpoint (co-located with `/api/storage/events`) | modify |

**Board client (`packages/client/src/`)**

| File | Responsibility | Status |
| --- | --- | --- |
| `components/ui/dropdown-menu.tsx` | shadcn dropdown-menu wrapper over `radix-ui` | **create** |
| `account/model/account-model.ts` (+`.test.ts`) | Account/devices atoms, GET `/account`+`/devices`, current-credential, logout, SSE subscription | **create** |
| `account/model/add-device-model.ts` (+`.test.ts`) | Fresh-UV mint ceremony, code/URL, countdown, approve/deny | **create** |
| `account/model/devices-http.ts` (+`.test.ts`) | Typed fetch helpers for the device endpoints | **create** |
| `account/ui/AccountMenu.tsx` | Avatar + dropdown (My devices / Logout, pending badge) | **create** |
| `account/ui/MyDevicesDialog.tsx` | Devices list, pending section, revoke confirm, add button | **create** |
| `account/ui/AddDeviceModal.tsx` | QR + code + countdown, flips to approval | **create** |
| `app/ui/Header.tsx` | Mount `<AccountMenu/>` in the actions group | modify |

**Activation app (`packages/client/activation/src/`)**

| File | Responsibility | Status |
| --- | --- | --- |
| `model/add-device-model.ts` (+`.test.ts`) | Read token from URL, scan→URL parse, manual code, register ceremony, poll pending-status | **create** |
| `ui/AddDeviceScreen.tsx` (+`.module.css`) | Chooser / scanner / manual / register / waiting / done / rejected | **create** |
| `App.tsx` | Replace the `/add-device` stub with `<AddDeviceScreen/>` | modify |

**Deps:** add `qr-code-styling` and `react-zxing` to `packages/client/package.json` (the activation app builds from the client package).

**E2E (`packages/client/e2e/`)**

| File | Responsibility | Status |
| --- | --- | --- |
| `add-device.spec.ts` | Two virtual authenticators: mint → register → pending → approve → login; negatives | **create** |

---

# Phase A — Server

## Task A1: Add-device code store (`auth/add-tokens.ts`)

**Files:**
- Create: `packages/server/src/auth/add-tokens.ts`, `packages/server/src/auth/add-tokens.test.ts`
- Modify: `packages/server/src/auth/records.ts` (extend `AddTokenRecordSchema`)

**Interfaces:**
- Consumes: `ValkeyOps`, `runExclusive`, `sha256hex`, `addTokenKey`, `getJson`/`setJson`, `AddTokenInvalidError`.
- Produces:
  - `generateAddCode(): string` — 8-char canonical Crockford base32.
  - `normalizeAddCode(input: string): string | null` — upper-case, strip non-alphabet chars (dashes/spaces), validate length 8 + alphabet; `null` if invalid.
  - `formatAddCode(canonical: string): string` — `"XXXX-XXXX"`.
  - `mintAddToken(ops, now, { accountId, ttlMs }): Promise<{ code: string; record: AddTokenRecord }>`
  - `lookupAddToken(ops, now, code): Promise<AddTokenRecord | AddTokenInvalidError | Error>`
  - `consumeAddToken(ops, now, code): Promise<AddTokenRecord | AddTokenInvalidError | Error>` (deletes on success)
  - `recordAddTokenFailure(ops, now, code): Promise<void>`

- [ ] **Step 1: Extend the record schema.** In `records.ts` change `AddTokenRecordSchema` to:

```ts
export const AddTokenRecordSchema = z.object({
  accountId: z.string(),
  expiresAt: z.number(),
  failedAttempts: z.number(),
})
```

- [ ] **Step 2: Write the failing test** `add-tokens.test.ts` (memory-ops pattern from `invites.test.ts`):

```ts
import { describe, expect, it } from 'vitest'
import { createMemoryOps } from '../storage/memory-ops'
import {
  consumeAddToken, generateAddCode, lookupAddToken, mintAddToken,
  normalizeAddCode, recordAddTokenFailure,
} from './add-tokens'
import { AddTokenInvalidError } from './errors'

const TTL = 5 * 60_000

describe('add-tokens', () => {
  it('generates an 8-char Crockford code with no ambiguous letters', () => {
    for (let i = 0; i < 50; i++) {
      const code = generateAddCode()
      expect(code).toMatch(/^[0-9ABCDEFGHJKMNPQRSTVWXYZ]{8}$/)
    }
  })

  it('normalizes dashes/case/spaces and rejects bad input', () => {
    expect(normalizeAddCode('k7qp-3m9x')).toBe('K7QP3M9X')
    expect(normalizeAddCode(' K7QP 3M9X ')).toBe('K7QP3M9X')
    expect(normalizeAddCode('short')).toBeNull()
    expect(normalizeAddCode('K7QP3M9I')).toBeNull() // I is not in the alphabet
  })

  it('mints, looks up, and single-use consumes', async () => {
    const ops = createMemoryOps()
    const now = () => 1000
    const { code, record } = await mintAddToken(ops, now, { accountId: 'acc1', ttlMs: TTL })
    expect(record.accountId).toBe('acc1')
    expect(await lookupAddToken(ops, now, code)).toMatchObject({ accountId: 'acc1' })
    expect(await consumeAddToken(ops, now, code)).toMatchObject({ accountId: 'acc1' })
    expect(await lookupAddToken(ops, now, code)).toBeInstanceOf(AddTokenInvalidError)
  })

  it('expires and locks after too many failures', async () => {
    const ops = createMemoryOps()
    let t = 1000
    const now = () => t
    const { code } = await mintAddToken(ops, now, { accountId: 'acc1', ttlMs: TTL })
    for (let i = 0; i < 10; i++) await recordAddTokenFailure(ops, now, code)
    expect(await lookupAddToken(ops, now, code)).toBeInstanceOf(AddTokenInvalidError)

    const fresh = await mintAddToken(ops, now, { accountId: 'acc1', ttlMs: TTL })
    t = 1000 + TTL + 1
    expect(await lookupAddToken(ops, now, fresh.code)).toBeInstanceOf(AddTokenInvalidError)
  })
})
```

- [ ] **Step 3: Run it — expect FAIL** (`Cannot find module './add-tokens'`).

Run: `pnpm --filter server exec vitest run src/auth/add-tokens.test.ts`

- [ ] **Step 4: Implement `add-tokens.ts`:**

```ts
import crypto from 'node:crypto'
import { runExclusive } from '../storage/key-lock'
import type { ValkeyOps } from '../storage/valkey'
import { AddTokenInvalidError } from './errors'
import { type AddTokenRecord, AddTokenRecordSchema, addTokenKey, getJson, setJson } from './records'
import { sha256hex } from './tokens'

const ALPHABET = '0123456789ABCDEFGHJKMNPQRSTVWXYZ' // Crockford base32, no I L O U
const CODE_LEN = 8
const FAILED_ATTEMPTS_LIMIT = 10

export function generateAddCode(): string {
  const bytes = crypto.randomBytes(CODE_LEN)
  let out = ''
  for (let i = 0; i < CODE_LEN; i++) out += ALPHABET[bytes[i] % ALPHABET.length]
  return out
}

export function normalizeAddCode(input: string): string | null {
  const cleaned = input.toUpperCase().replace(/[^0-9A-Z]/g, '')
  if (cleaned.length !== CODE_LEN) return null
  for (const ch of cleaned) if (!ALPHABET.includes(ch)) return null
  return cleaned
}

export function formatAddCode(canonical: string): string {
  return `${canonical.slice(0, 4)}-${canonical.slice(4)}`
}

function checkLive(record: AddTokenRecord, now: () => number): AddTokenInvalidError | undefined {
  if (record.expiresAt <= now()) return new AddTokenInvalidError()
  if (record.failedAttempts >= FAILED_ATTEMPTS_LIMIT) return new AddTokenInvalidError()
  return undefined
}

export async function mintAddToken(
  ops: ValkeyOps,
  now: () => number,
  { accountId, ttlMs }: { accountId: string; ttlMs: number },
): Promise<{ code: string; record: AddTokenRecord }> {
  const code = generateAddCode()
  const record: AddTokenRecord = { accountId, expiresAt: now() + ttlMs, failedAttempts: 0 }
  await setJson(ops, addTokenKey(sha256hex(code)), record, ttlMs)
  return { code, record }
}

export async function lookupAddToken(
  ops: ValkeyOps,
  now: () => number,
  code: string,
): Promise<AddTokenRecord | AddTokenInvalidError | Error> {
  const canonical = normalizeAddCode(code)
  if (!canonical) return new AddTokenInvalidError()
  const record = await getJson(ops, addTokenKey(sha256hex(canonical)), AddTokenRecordSchema)
  if (record instanceof Error) return record
  if (record === null) return new AddTokenInvalidError()
  const live = checkLive(record, now)
  if (live) return live
  return record
}

export async function consumeAddToken(
  ops: ValkeyOps,
  now: () => number,
  code: string,
): Promise<AddTokenRecord | AddTokenInvalidError | Error> {
  const canonical = normalizeAddCode(code)
  if (!canonical) return new AddTokenInvalidError()
  const key = addTokenKey(sha256hex(canonical))
  return runExclusive(key, async () => {
    const record = await getJson(ops, key, AddTokenRecordSchema)
    if (record instanceof Error) return record
    if (record === null) return new AddTokenInvalidError()
    const live = checkLive(record, now)
    if (live) return live
    await ops.del(key)
    return record
  })
}

export async function recordAddTokenFailure(
  ops: ValkeyOps,
  now: () => number,
  code: string,
): Promise<void> {
  const canonical = normalizeAddCode(code)
  if (!canonical) return
  const key = addTokenKey(sha256hex(canonical))
  await runExclusive(key, async () => {
    const record = await getJson(ops, key, AddTokenRecordSchema)
    if (record instanceof Error || record === null) return
    if (record.expiresAt - now() <= 0) return
    await setJson(ops, key, { ...record, failedAttempts: record.failedAttempts + 1 }, Math.max(0, record.expiresAt - now()))
  })
}
```

- [ ] **Step 5: Run tests — expect PASS.** Run: `pnpm --filter server exec vitest run src/auth/add-tokens.test.ts`
- [ ] **Step 6: Commit.**

```bash
rtk git add packages/server/src/auth/add-tokens.ts packages/server/src/auth/add-tokens.test.ts packages/server/src/auth/records.ts
rtk git commit -m "feat(auth): add-device short code store"
```

---

## Task A2: Request schemas + session guard

**Files:**
- Modify: `packages/server/src/auth/schemas.ts`
- Create: `packages/server/src/auth/session-guard.ts`, `packages/server/src/auth/session-guard.test.ts`

**Interfaces:**
- Produces (schemas): `AddDeviceRegisterOptionsBodySchema` `{ token: string }`, `AddDeviceRegisterVerifyBodySchema` `{ token: string; attestationResponse: WebAuthnResponse }`, `AddTokenVerifyBodySchema` `{ authenticationResponse: WebAuthnResponse }`, `DeviceIdParamsSchema` `{ credentialId: string }`.
- Produces: `requireSession(deps: AuthDeps, req): Promise<SessionRecord | AuthResult>` — resolves + verifies the session cookie, returning the `SessionRecord` or an `AuthResult` (`401`) to return directly. (`AuthResult` from `handlers.ts`.)

- [ ] **Step 1: Add schemas** to `schemas.ts` (reuse the existing `WebAuthnResponseSchema` — export it):

```ts
export const AddDeviceRegisterOptionsBodySchema = z.object({ token: z.string().min(1) })
export const AddDeviceRegisterVerifyBodySchema = z.object({
  token: z.string().min(1),
  attestationResponse: WebAuthnResponseSchema,
})
export const AddTokenVerifyBodySchema = z.object({ authenticationResponse: WebAuthnResponseSchema })
export const DeviceIdParamsSchema = z.object({ credentialId: z.string().min(1) })
```

Change `const WebAuthnResponseSchema` → `export const WebAuthnResponseSchema`.

- [ ] **Step 2: Write the failing test** `session-guard.test.ts` — a request with no cookie returns a `401` AuthResult; a valid session returns the record. (Build a memory-ops + config + issue a session + device via the existing helpers, mirror `handlers.test.ts` setup.)
- [ ] **Step 3: Run — expect FAIL.** Run: `pnpm --filter server exec vitest run src/auth/session-guard.test.ts`
- [ ] **Step 4: Implement `session-guard.ts`:**

```ts
import type { IncomingMessage } from 'node:http'
import type { AuthDeps, AuthResult } from './handlers'
import { parseCookies } from './cookies'
import type { SessionRecord } from './records'
import { verifySession } from './sessions'

export function isAuthResult(v: unknown): v is AuthResult {
  return typeof v === 'object' && v !== null && typeof (v as AuthResult).status === 'number'
}

export async function requireSession(
  deps: AuthDeps,
  req: IncomingMessage,
): Promise<SessionRecord | AuthResult> {
  const sessionId = parseCookies(req.headers.cookie)[deps.config.sessionCookieName]
  if (!sessionId) return { status: 401, body: { code: 'session_missing' } }
  const result = await verifySession(deps.ops, deps.config, deps.now, sessionId)
  if (result instanceof Error) return { status: 401, body: { code: 'session_missing' } }
  return result.record
}
```

> Note: export `AuthDeps`/`AuthResult` from `handlers.ts` if not already (they are). Return-type discrimination in callers: `const s = await requireSession(...); if (isAuthResult(s)) return s`.

- [ ] **Step 5: Run — expect PASS.**
- [ ] **Step 6: Commit.** `rtk git commit -m "feat(auth): device request schemas + requireSession guard"`

---

## Task A3: Auth device-event publisher (`auth/device-events.ts`)

**Files:** Create `auth/device-events.ts` (+ `.test.ts`); modify `records.ts` (add `authAccountKey`).

**Interfaces:**
- Produces: `authAccountKey(accountId: string): string` → `"auth:account:" + accountId` (in `records.ts`).
- Produces: `AuthDeviceEvent = { type: 'device-pending' | 'device-approved' | 'device-denied' | 'device-revoked'; credentialId: string; label?: string }`.
- Produces: `publishAuthDeviceEvent(ops: ValkeyOps, accountId: string, event: AuthDeviceEvent): Promise<void>` — wraps `publishChange(ops, authAccountKey(accountId), event)`.

- [ ] **Step 1:** add `authAccountKey` to `records.ts`.
- [ ] **Step 2: Write failing test** — a fake `ValkeyOps` capturing `publish(channel, message)` asserts `channel === 'storage:events'` and the message parses to `{ key: 'auth:account:acc1', value: { type: 'device-pending', credentialId: 'c1', label: 'Chrome' } }`.
- [ ] **Step 3: Run — FAIL.**
- [ ] **Step 4: Implement:**

```ts
import { publishChange } from '../storage/handlers'
import type { ValkeyOps } from '../storage/valkey'
import { authAccountKey } from './records'

export type AuthDeviceEvent = {
  type: 'device-pending' | 'device-approved' | 'device-denied' | 'device-revoked'
  credentialId: string
  label?: string
}

export async function publishAuthDeviceEvent(
  ops: ValkeyOps,
  accountId: string,
  event: AuthDeviceEvent,
): Promise<void> {
  await publishChange(ops, authAccountKey(accountId), event)
}
```

- [ ] **Step 5: Run — PASS.** **Step 6: Commit** `rtk git commit -m "feat(auth): auth-domain device SSE event publisher"`

---

## Task A4: Pending-ticket store (`auth/pending-tickets.ts`)

**Files:** Create `auth/pending-tickets.ts` (+ `.test.ts`).

**Interfaces:**
- Produces:
  - `issuePendingTicket(ops, config, now, { credentialId, accountId }): Promise<{ ticketId: string; cookie: string }>` — store `pending:{ticketId}` (`PendingTicketRecord`, TTL 15 min), set `pendingCookieName` cookie (`SameSite=Strict`, httpOnly, path `/`, 15-min max-age).
  - `readPendingTicket(ops, config, now, cookieHeader): Promise<PendingTicketRecord | PendingTicketInvalidError | Error>` — read (no delete; polling reuses it) + expiry check.
- Consumes: `serializeCookie`, `parseCookies`, `randomId`, `pendingKey`, `PendingTicketRecordSchema`, `PendingTicketInvalidError`.

Constant: `PENDING_TTL_MS = 15 * 60_000`.

- [ ] **Step 1: Write failing test** — issue → read returns record; after `now()` past expiry → `PendingTicketInvalidError`; missing cookie → `PendingTicketInvalidError`.
- [ ] **Step 2: Run — FAIL.**
- [ ] **Step 3: Implement** (mirror `challenge-store.ts` cookie handling, but no consume-on-read):

```ts
import type { ValkeyOps } from '../storage/valkey'
import type { AuthConfig } from './config'
import { parseCookies, serializeCookie } from './cookies'
import { PendingTicketInvalidError } from './errors'
import { type PendingTicketRecord, PendingTicketRecordSchema, getJson, pendingKey, setJson } from './records'
import { randomId } from './tokens'

export const PENDING_TTL_MS = 15 * 60_000

export async function issuePendingTicket(
  ops: ValkeyOps, config: AuthConfig, now: () => number,
  { credentialId, accountId }: { credentialId: string; accountId: string },
): Promise<{ ticketId: string; cookie: string }> {
  const ticketId = randomId()
  const record: PendingTicketRecord = { ticketId, credentialId, accountId, expiresAt: now() + PENDING_TTL_MS }
  await setJson(ops, pendingKey(ticketId), record, PENDING_TTL_MS)
  const cookie = serializeCookie(config.pendingCookieName, ticketId, {
    maxAgeMs: PENDING_TTL_MS, httpOnly: true, secure: config.secureCookies, sameSite: 'Strict', path: '/',
  })
  return { ticketId, cookie }
}

export async function readPendingTicket(
  ops: ValkeyOps, config: AuthConfig, now: () => number, cookieHeader: string | undefined,
): Promise<PendingTicketRecord | PendingTicketInvalidError | Error> {
  const ticketId = parseCookies(cookieHeader)[config.pendingCookieName]
  if (!ticketId) return new PendingTicketInvalidError()
  const record = await getJson(ops, pendingKey(ticketId), PendingTicketRecordSchema)
  if (record instanceof Error) return record
  if (record === null || now() >= record.expiresAt) return new PendingTicketInvalidError()
  return record
}
```

- [ ] **Step 4: Run — PASS.** **Step 5: Commit** `rtk git commit -m "feat(auth): pending-device ticket store"`

---

## Task A5: Add-token mint handlers (fresh UV) — `device-handlers.ts` (part 1)

**Files:** Create `auth/device-handlers.ts` (+ `.test.ts`).

**Interfaces (produced):**
- `postAddTokenOptions(deps, req): Promise<AuthResult>` — session required; returns WebAuthn **authentication** options whose `allowCredentials` = the account's active devices; saves an `auth` challenge bound to `accountId`.
- `postAddToken(deps, req): Promise<AuthResult>` — session required; consumes the `auth` challenge, verifies the assertion against one of the account's active devices (fresh UV), updates its sign count, mints an add-token, returns `{ code, formatted, url, expiresAt }` where `url = ${PUBLIC_APP_URL}/add-device?token=<code>`.

Add near the top: `const PUBLIC_APP_URL = () => process.env.PUBLIC_APP_URL ?? 'http://localhost:5173'` and `const ADD_TOKEN_TTL_MS = 5 * 60_000`.

- [ ] **Step 1: Write failing tests** (memory-ops; seed an account + one active device via `createAccount`/`storeDevice`/`addDeviceToAccount`, issue a session): options with no session → 401; options with session → 200 with `body.options.allowCredentials` listing the device; `postAddToken` with a stubbed assertion (use the same virtual-response approach as `handlers.test.ts` login tests) mints a code and returns a `url` containing `/add-device?token=`.
- [ ] **Step 2: Run — FAIL.**
- [ ] **Step 3: Implement** (uses `requireSession`, `listDevices` filtered to active, `buildAuthenticationOptions`, `saveChallenge` type `'auth'` with `accountId`, `consumeChallenge`, `verifyAuthentication`, `updateSignCount`, `mintAddToken`, `runExclusive(deviceKey(...))` around verify+count like `postLoginVerify`). Publish nothing here. Return the challenge cookie on options; clear it on verify.

Key verify logic:

```ts
// inside postAddToken, after consumeChallenge(type 'auth') and reading response.id:
const device = await getDevice(deps.ops, credentialId)
if (device instanceof Error) return toAuthResult(device)
if (device.accountId !== session.accountId) return toAuthResult(new NotAuthorizedError())
if (device.disabled || device.status !== 'active') return toAuthResult(new DeviceDisabledError())
// verify assertion (runExclusive on deviceKey), updateSignCount ...
const { code } = await mintAddToken(deps.ops, deps.now, { accountId: session.accountId, ttlMs: ADD_TOKEN_TTL_MS })
return { status: 200, body: {
  code, formatted: formatAddCode(code),
  url: `${PUBLIC_APP_URL()}/add-device?token=${code}`,
  expiresAt: deps.now() + ADD_TOKEN_TTL_MS,
}, headers: { 'Set-Cookie': clearedChallengeCookie(deps.config) } }
```

> `toAuthResult`, `clearedChallengeCookie`, `sessionCookieFor` etc. are in `handlers.ts` — export the small helpers you reuse (`toAuthResult`, `clearedChallengeCookie`) or re-declare them locally in `device-handlers.ts`. Prefer exporting from `handlers.ts` to stay DRY.

- [ ] **Step 4: Run — PASS.** **Step 5: Commit** `rtk git commit -m "feat(auth): fresh-UV add-token mint handlers"`

---

## Task A6: Add-device registration handlers (pending device) — `device-handlers.ts` (part 2)

**Interfaces (produced):**
- `postDeviceRegisterOptions(deps, req): Promise<AuthResult>` — **no session**; body `{ token }`; `lookupAddToken` live → `buildRegistrationOptions` (`excludeCredentials` = the token account's devices, `userName`/`displayName` from the account name) → save `add-device` challenge bound to `accountId`; return options + challenge cookie.
- `postDeviceRegisterVerify(deps, req): Promise<AuthResult>` — **no session**; body `{ token, attestationResponse }`; consume `add-device` challenge → `verifyRegistration` → re-`lookupAddToken` live & `accountId === challenge.accountId` → create device `status:'pending'`, `addedVia:'add-token'` under the account (`addDeviceToAccount(..., { countsAgainstLimit: false })`) → `consumeAddToken` → `issuePendingTicket` → `publishAuthDeviceEvent('device-pending')` → return `{ credentialId }` + pending cookie + cleared challenge cookie. On any post-challenge failure, `recordAddTokenFailure`.

- [ ] **Step 1: Write failing tests** — options for an unknown/expired code → 400 (`add_token_invalid`); a full happy path (stub registration like `handlers.test.ts`) yields a `pending` device in the account's device set, a spent add-token, a pending cookie, and a published `device-pending` event (assert via a capturing ops).
- [ ] **Step 2: Run — FAIL.**
- [ ] **Step 3: Implement** — mirror `postRegisterVerify` in `handlers.ts` but: no invite/account creation (account already exists), device `status:'pending'`, `countsAgainstLimit:false`, no session issued, pending cookie instead. Get the account name via `getAccount` for the WebAuthn user fields.
- [ ] **Step 4: Run — PASS.** **Step 5: Commit** `rtk git commit -m "feat(auth): add-device registration -> pending device"`

---

## Task A7: Device management + account + pending-status handlers — `device-handlers.ts` (part 3)

**Interfaces (produced):**
- `getAccountInfo(deps, req): Promise<AuthResult>` — session; `{ id, name, deviceLimit }`.
- `getDevices(deps, req): Promise<AuthResult>` — session; `{ devices: DeviceDto[], thisCredentialId }` where `DeviceDto = { credentialId, label, status, addedVia, createdAt, lastSeenAt }` (never expose `publicKey`).
- `postApproveDevice(deps, req, params): Promise<AuthResult>` — session; the device must belong to the account and be `pending`; enforce the device limit on active count (+1); `setDeviceStatus('active')`; publish `device-approved`; `{ ok: true }`.
- `postDenyDevice(deps, req, params): Promise<AuthResult>` — session; device pending & owned; `revokeDevice`; publish `device-denied`; `204`.
- `postRevokeDevice(deps, req, params): Promise<AuthResult>` — session; device active & owned; **last-active guard** (if it is the account's only `active` device → `LastActiveDeviceError`); `revokeDevice`; publish `device-revoked`; `204`.
- `getPendingStatus(deps, req): Promise<AuthResult>` — pending ticket (no session); resolve the pending device → `{ status: 'pending' | 'approved' | 'denied' }` (`denied` when the device record is gone; `approved` when `status === 'active'`); invalid ticket → 401.

Ownership helper (local): `assertOwnedDevice(deps, accountId, credentialId): Promise<DeviceRecord | AuthResult>` → `getDevice`; if missing → 404; if `device.accountId !== accountId` → `NotAuthorizedError` (403).

- [ ] **Step 1: Write failing tests** covering: list returns DTOs without `publicKey`; approve flips pending→active and is limit-guarded; approve/deny/revoke reject a foreign device (403); revoke of the only active device → 409 `last_active_device`; deny deletes; pending-status transitions pending→approved after approve and pending→denied after deny; wrong ticket → 401.
- [ ] **Step 2: Run — FAIL.**
- [ ] **Step 3: Implement** each handler using `requireSession`/`readPendingTicket`, `listDevices`, `setDeviceStatus`, `revokeDevice`, `getAccount`, `publishAuthDeviceEvent`. Approve limit check: count `active` devices in the account; if `active >= deviceLimit` → `DeviceLimitError`.
- [ ] **Step 4: Run — PASS.** **Step 5: Commit** `rtk git commit -m "feat(auth): device list/approve/deny/revoke + account + pending-status"`

---

## Task A8: Wire routes + auth SSE endpoint

**Files:** Modify `auth/index.ts` (routes) and `app.ts` (SSE endpoint). Test: extend `auth/index`-level integration or add `app`-level test if one exists; otherwise assert via the handler tests already written + a small routing smoke test.

**Interfaces (produced):** registered routes —
```
POST /api/auth/devices/add-token/options
POST /api/auth/devices/add-token
POST /api/auth/devices/register/options
POST /api/auth/devices/register/verify
GET  /api/auth/devices
GET  /api/auth/devices/pending-status
POST /api/auth/devices/:credentialId/approve
POST /api/auth/devices/:credentialId/deny
POST /api/auth/devices/:credentialId/revoke
GET  /api/auth/account
GET  /api/auth/devices/events   (SSE, in app.ts)
```

> Route-ordering caution with `find-my-way`: static `pending-status`/`add-token`/`register`/`events` under `/api/auth/devices/*` must not be shadowed by the `:credentialId` param routes. `find-my-way` prefers static over parametric at the same position, but keep `pending-status` etc. as distinct static segments (they are — `:credentialId` is a single segment sibling of `add-token`, `register`, `pending-status`, `events`).

- [ ] **Step 1:** In `auth/index.ts`, import the new handlers and register the non-SSE routes (param routes parse `DeviceIdParamsSchema` from `params`). Each wraps `sendAuth(res, await handler(authDeps, req[, params]))`.
- [ ] **Step 2:** In `app.ts`, add the SSE endpoint next to `/api/storage/events`:

```ts
router.on('GET', '/api/auth/devices/events', async (req, res) => {
  const sessionId = parseCookies(req.headers.cookie)[deps.authConfig.sessionCookieName]
  const session = sessionId
    ? await verifySession(ops, deps.authConfig, now, sessionId)
    : new Error('no session')
  if (session instanceof Error) { res.writeHead(401); res.end(); return }
  res.writeHead(200, { 'content-type': 'text/event-stream', 'cache-control': 'no-cache', connection: 'keep-alive', 'x-accel-buffering': 'no' })
  const connId = randomUUID()
  registry.add(connId, res)
  registry.subscribe(connId, [authAccountKey(session.record.accountId)]) // server-scoped: A only sees its own account
  writeSseEvent(res, 'ready', { connId })
  const heartbeat = setInterval(() => res.write(': ping\n\n'), HEARTBEAT_MS)
  req.on('close', () => { clearInterval(heartbeat); registry.remove(connId) })
})
```

Add imports in `app.ts`: `parseCookies` from `./auth/cookies`, `verifySession` from `./auth/sessions`, `authAccountKey` from `./auth/records`.

- [ ] **Step 3: Run** `pnpm --filter server test` and `pnpm --filter server exec tsc --noEmit` — expect PASS.
- [ ] **Step 4: Commit** `rtk git commit -m "feat(auth): register device routes + auth SSE channel"`
- [ ] **Step 5: Phase gate** — `codex exec review --base main -m gpt-5.5`; triage & fix before Phase B.

---

# Phase B — Board client (account UI)

## Task B1: Deps + shadcn dropdown-menu

**Files:** Modify `packages/client/package.json`; create `packages/client/src/components/ui/dropdown-menu.tsx`.

- [ ] **Step 1:** `pnpm --filter client add qr-code-styling` (board QR) — leave `react-zxing` for Phase C.
- [ ] **Step 2:** Create `dropdown-menu.tsx` — a shadcn wrapper over `radix-ui`'s `DropdownMenu` (the repo uses the unified `radix-ui` package; see `popover.tsx`/`dialog.tsx` for the local `cn` import + styling conventions). Export `DropdownMenu`, `DropdownMenuTrigger`, `DropdownMenuContent`, `DropdownMenuItem`, `DropdownMenuSeparator`.
- [ ] **Step 3:** Add a `components/ui/primitives.test.tsx` case (or a new small test) that renders the menu and asserts the trigger toggles content — expect PASS.
- [ ] **Step 4: Commit** `rtk git commit -m "chore(client): qr-code-styling dep + shadcn dropdown-menu"`

## Task B2: `devices-http.ts` + `account-model.ts`

**Files:** Create `account/model/devices-http.ts` (+test), `account/model/account-model.ts` (+test).

**Interfaces (produced):**
- `devices-http.ts`: typed `fetch` helpers returning `Error | T` (errore) with `credentials:'same-origin'` + `X-Requested-With:'MyBoard'` (mirror `activation-model.ts`'s `postJson`): `fetchAccount()`, `fetchDevices()`, `approveDevice(id)`, `denyDevice(id)`, `revokeDevice(id)`, `logout()`.
- `account-model.ts`: `createAccountModel(overrides?)` exposing atoms `account`, `devices`, `pending` (computed split of devices by `status`), `thisCredentialId` (from `localStorage[CRED_HINT_STORAGE_KEY]`), `loading`, `error`, and actions `refresh`, `approve(id)`, `deny(id)`, `revoke(id)`, `logout`, plus `connectEvents()` opening an `EventSource('/api/auth/devices/events')` that calls `refresh` on any `device-*` message. Logic pre-`wrap()`ed per [[reatom-context-start-unwrapped-continuations]].

- [ ] **Step 1: Write failing model test** — inject a fake fetch + fake storage: `refresh()` populates `account`/`devices`; `pending` computes only `status:'pending'`; `thisCredentialId` marks the matching device; `revoke` on the last active device surfaces the server's `last_active_device` error into `error`.
- [ ] **Step 2: Run — FAIL.** **Step 3: Implement** both files. **Step 4: Run — PASS.**
- [ ] **Step 5: Commit** `rtk git commit -m "feat(client): account/devices model + http"`

## Task B3: `add-device-model.ts` (device A)

**Interfaces (produced):** `createAddDeviceModel(overrides?)` exposing: `start()` — runs the fresh-UV ceremony (`add-token/options` → `startAuthentication` → `add-token`) and stores `{ code, formatted, url, expiresAt }`; `countdown` (computed mm:ss from `expiresAt` and a ticking `now` atom); `phase` atom (`'idle'|'verifying'|'showing'|'expired'|'approving'`); `pendingDevice` atom (set when the model's owning `account-model` sees a `device-pending` event — wire via a shared callback or by having the dialog read `account-model.pending`); `approve()`/`deny()` delegate to the account model; `error`.

- [ ] **Step 1: Write failing test** — stubbed ceremony + fetch: `start()` transitions idle→verifying→showing and exposes `url` containing `/add-device?token=`; countdown reaches `0:00` → `phase='expired'`.
- [ ] **Step 2–4: TDD implement.** **Step 5: Commit** `rtk git commit -m "feat(client): add-device (device A) model"`

## Task B4: `AccountMenu.tsx`

**Design:** match `Мультиустройства.dc.html` panel **1 · Хедер** states (a) closed, (b) open, (c) badge + pending. Avatar = 36px circle, initials from `account.name`, `--accent-soft` bg / `--primary` text; badge dot when `pending.length > 0`. Dropdown items: «Мои устройства» (opens `MyDevicesDialog`), «Выйти» (calls `logout`).

- [ ] **Step 1:** Build `AccountMenu` (`reatomMemo`) consuming `account-model`; open state via a local atom; render `DropdownMenu`. **Step 2:** `connectEvents()` on mount (via `useEffect`-equivalent/`withConnectHook`; see [[reatom-withconnecthook-not-reactive]] — use `effect()` inside the hook if wiring a dynamic key). **Step 3:** Commit `rtk git commit -m "feat(client): account menu (avatar + dropdown)"`

## Task B5: `MyDevicesDialog.tsx`

**Design:** match panel **2** states (a)–(e): pending section (Approve/Deny), device rows with «Это устройство» chip + «Отозвать», inline revoke confirm, limit-reached note, «Добавить устройство» button (opens `AddDeviceModal`). Uses shadcn `Dialog`. Revoke disabled/hidden on the current device when it is the only active one.

- [ ] **Step 1–2:** Build the dialog (`reatomMemo`), wire actions to `account-model`, match the design states. **Step 3:** Commit `rtk git commit -m "feat(client): My devices dialog"`

## Task B6: `AddDeviceModal.tsx`

**Design:** match panel **3** states (a)–(e). Render the QR with `qr-code-styling` — build the instance in the model (URL + options derived from `resolvedTheme`, `--primary` on `--accent-soft`, light chip), the view holds only the container ref + `.append`/`.update` and regenerates on theme change. Show `formatted` code (JetBrains Mono), «Скопировать ссылку», countdown; flip to the approval card when a `device-pending` arrives (read `account-model.pending`), with Approve/Deny.

- [ ] **Step 1–2:** Build the modal, QR in model, flip-to-approval. **Step 3:** Commit `rtk git commit -m "feat(client): add-device QR modal + in-place approval"`

## Task B7: Mount in Header

- [ ] **Step 1:** In `app/ui/Header.tsx` add `<AccountMenu/>` to the `actions` div (after `AddWidgetMenu`). Update `Header.test.tsx` to assert the avatar renders. **Step 2:** `pnpm --filter client test` + `tsc --noEmit` — PASS. **Step 3:** Commit `rtk git commit -m "feat(client): mount account menu in header"`
- [ ] **Step 4: Phase gate** — `codex exec review --base main -m gpt-5.5`; triage & fix.

---

# Phase C — Activation app (device B)

## Task C1: Dep

- [ ] `pnpm --filter client add react-zxing`. Commit `rtk git commit -m "chore(client): react-zxing dep"`

## Task C2: activation `add-device-model.ts`

**Interfaces (produced):** `createAddDeviceModel(overrides?)` — `token` atom (from `?token=`); `mode` atom (`'choose'|'scanning'|'manual'|'registering'|'waiting'|'done'|'rejected'`); `extractAddCode(text): string | null` — the **single** extractor shared by the scanner, manual typing, and paste: accept a full `/add-device?token=…` URL (validate same-origin + path, extract `token`) **or** a bare code, then run `normalizeAddCode`; returns the canonical code or `null`; `submitManual(input)`; `startRegistration()` (`devices/register/options` → `startRegistration` ceremony → `devices/register/verify`) → on success `mode='waiting'` + begin polling; `pollPendingStatus()` every 2 s, give up after 10 min, `mode='done'` on `approved` (then run a normal login → navigate `/`), `mode='rejected'` on `denied`; `error`.

> The scanner in the view (react-zxing `useZxing`) forwards decoded text into `extractAddCode`; the manual code input forwards both its typed value and its `paste` payload through the same `extractAddCode`; camera permission/error state lives in the model.

- [ ] **Step 1: Write failing tests** — `extractAddCode` accepts `https://host/add-device?token=K7QP3M9X`, a bare `K7QP-3M9X`, and a full pasted URL with a dashed code `https://host/add-device?token=K7QP-3M9X`; it rejects other-origin/other-path URLs and junk; the happy path transitions registering→waiting→done and calls `navigate('/')`; a `denied` poll → `rejected`. (Stub fetch, ceremony, navigate, timers.)
- [ ] **Step 2–4: TDD implement.** **Step 5:** Commit `rtk git commit -m "feat(activation): add-device model (scan/manual/register/poll)"`

## Task C3: `AddDeviceScreen.tsx` (+ `.module.css`)

**Design:** match panel **4** states (a) choose, (b) scanner, (b2) camera denied, (c1) invalid code, (c2) expired code, (d1) register ready, (d2) register loading, (e) waiting, (f) done, (g) rejected, and honor the section **5 · Анимации и переходы** transitions (scanline, fades). Reuse the activation card shell (brand mark + `myboard` label + footer note) and the `ActivateScreen.module.css` control styles. Scanner uses `useZxing` from `react-zxing`; video ref in the view, all logic via the model.

**Paste-to-extract on the code input:** the manual `____-____` field gets an `onPaste` handler:

```tsx
onPaste={(e) => {
  const text = e.clipboardData.getData('text')
  const code = model.extractAddCode(text) // shared URL-or-code extractor
  if (code) { e.preventDefault(); model.submitManual(code) } // fill formatted + proceed
}}
```

- [ ] **Step 1: Write a failing view test** — pasting `https://host/add-device?token=K7QP-3M9X` into the code input calls `submitManual` with the extracted code and does not leave the raw URL in the field. (React Testing Library `fireEvent.paste` with a `clipboardData` stub.)
- [ ] **Step 2–3:** Build the screen (`reatomMemo`), one model instance per mount (mirror `ActivateScreen`); wire the `onPaste` handler on the code input; match each design state + transitions. **Step 4:** Run `pnpm --filter client test` — PASS. **Step 5:** Commit `rtk git commit -m "feat(activation): add-device screen + paste-a-link code input"`

## Task C4: Route it

- [ ] **Step 1:** In `activation/src/App.tsx` replace the `/add-device` stub with `<AddDeviceScreen/>`. **Step 2:** `pnpm --filter client test` + `tsc --noEmit` — PASS. **Step 3:** Commit `rtk git commit -m "feat(activation): wire /add-device route"`
- [ ] **Step 4: Phase gate** — `codex exec review --base main -m gpt-5.5`; triage & fix.

---

# Phase D — E2E

## Task D1: Two-authenticator add-device e2e

**Files:** Create `packages/client/e2e/add-device.spec.ts` (extend the existing CDP virtual-authenticator setup from the Plan 1 activation e2e).

- [ ] **Step 1: Write the spec** (against the assembled Vite output; gate OFF): context A seeds an invite → registers an account+device (reuse the Plan 1 helper) → opens "My devices" → "Add device" (fresh UV via a virtual authenticator) → reads the code/url. Context B (second browser context + its own virtual authenticator) opens `/add-device?token=<code>` → registers → sees "waiting". Context A receives the pending device (SSE) → Approve. Context B polls → logs in → lands on the board. **Negatives:** expired code → error; deny → context B shows "rejected".
- [ ] **Step 2: Run** `pnpm --filter client exec playwright test e2e/add-device.spec.ts` (needs Valkey; use `pnpm test:e2e:docker` path). Expect PASS.
- [ ] **Step 3: Commit** `rtk git commit -m "test(auth): add-device two-authenticator e2e"`
- [ ] **Step 4: Full gate** — `pnpm check` + `codex exec review --base main -m gpt-5.5` + `/security-review`; triage & fix.

---

## Self-Review (completed while writing)

- **Spec coverage:** short-code (A1), fresh-UV mint (A5), pending device + ticket (A4/A6), device list/approve/deny/revoke + last-active guard + limit (A7), account endpoint (A7), auth SSE channel (A3/A8), avatar/dropdown + My-devices dialog + QR modal + in-place approval (B4–B6), activation scan/manual/register/wait (C2–C3), all-Russian copy + design fidelity (B/C tasks reference the named `.dc.html` states), gate stays OFF (Global Constraints). Immediate revocation is covered by the existing `revokeDevice` (deletes device + sessions) reused in A7. ✔
- **Placeholder scan:** none — server logic is fully coded; UI tasks intentionally defer pixel values to the design file (the established `Activate.dc.html` convention) rather than inventing CSS. ✔
- **Type consistency:** `mintAddToken`/`lookupAddToken`/`consumeAddToken`/`recordAddTokenFailure` share the `AddTokenRecord` shape; `AuthDeviceEvent.type` values match between publisher (A3) and consumers (A7 publishes, B2 refreshes on any `device-*`); `requireSession` returns `SessionRecord | AuthResult` consistently across A5–A7; `normalizeAddCode` is the single canonicalizer, wrapped by the activation `extractAddCode` (C2) that the scanner, manual typing, and paste all share. ✔

## Open follow-ups (not in this plan)
- Rate limiting (`pending-status` own bucket; `/api/auth/*` IP limit) is **Plan 3** (nginx), not built here.
- Device rename, avatar images, and stranded-user recovery ops scripts (`revoke-account`, `mint-add-device-token`) are separate follow-ups.
