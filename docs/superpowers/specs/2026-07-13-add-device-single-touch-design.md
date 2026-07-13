# Add-device: one touch on the new device (mint session on approval)

Date: 2026-07-13
Status: Design (approved for planning)

## Problem

Adding a new device (e.g. a phone) makes the new device's authenticator prompt
the user **twice**: once to create the passkey, and again — after the owner
approves — to "log in". On password managers that sync passkeys across devices
(observed with NordPass), the flow is also **fragile**, not just noisy.

Observed on the live deployment (audit log, account `Diag Double Touch`):

```
device_pending   OGJ…                       ← new device created a passkey
device_approved  OGJ…                       ← owner approved
login            OGJ…                        ← new device ran a SECOND ceremony
...
device_revoked   OGJ…                        ← old test device revoked
device_pending   2098…                       ← new device created a fresh passkey
device_approved  2098…
login_failed     OGJ…  code=DeviceNotFoundError   ← login re-selected the STALE key
```

The `login_failed … DeviceNotFoundError` is the fragility: the post-approval
login ceremony asks the *authenticator* to choose a credential, and a synced
password manager can return a previously-registered (now revoked) credential
instead of the one just created. The server then rejects it, the new device
never obtains a session, and it never reaches the board.

## Root cause

`POST /api/auth/devices/register/verify` (`packages/server/src/auth/device-handlers.ts`)
deliberately issues only a **pending ticket** cookie (`issuePendingTicket`,
`packages/server/src/auth/pending-tickets.ts`), not a session — correct, because
the device is not yet approved.

After the owner approves, the new device polls
`GET /api/auth/devices/pending-status`, sees `approved`, and the client
(`packages/client/activation/src/model/add-device-model.ts` →
`completeLoginAfterApproval`, line ~244/311) runs a **full
`startAuthentication` ceremony** solely to obtain a session. That second
ceremony is the redundant touch, and its dependence on authenticator credential
selection is the source of the `DeviceNotFoundError` failure.

By the time the device is approved, the server already has everything needed to
mint a session without a new assertion:

- the pending ticket cryptographically identifies exactly this device (it is
  issued only after a valid registration attestation, which proves possession
  of the private key), and
- the device's status is now `active` (the authenticated owner approved it).

A second WebAuthn assertion adds no security here.

## Goal & scope

- The new device performs **one** ceremony (create the passkey). After the
  owner approves, the server mints the device's session directly. New device:
  **2 → 1 touch**.
- This also removes the `DeviceNotFoundError`-on-stale-credential failure class
  entirely (no authenticator credential selection is involved after approval).

### Out of scope

- The owner's re-authentication before minting the add-device QR
  (`postAddToken`, device A) stays — it is a deliberate "confirm it's really
  you" gate.
- The invite-activation flow already issues a session at `register/verify`
  (single touch) and is unchanged.

## Approach: two requests

The status poll stays a pure read; a new explicit endpoint mints the session.
This keeps the 2-second poll idempotent and side-effect-free, and isolates the
session-issuing side effect to a single POST. (The alternatives — issuing the
session as a side effect of the GET poll, or turning the poll into a POST — were
rejected: the first is a GET with side effects; the second gives poll requests
mutating semantics.)

### Server

1. **`packages/server/src/auth/pending-tickets.ts` — add `consumePendingTicket`.**
   Atomic read-and-delete of the ticket, guarded by
   `runExclusive(pendingKey(ticketId))` so two concurrent claims cannot both
   consume it:

   - resolve `ticketId` from the pending cookie; missing → `PendingTicketInvalidError`;
   - inside the lock: re-read the record; `null` or expired → `PendingTicketInvalidError`;
   - `ops.del(pendingKey(ticketId))`, return the record.

   `readPendingTicket` (non-consuming peek) is kept for the status check.

2. **`packages/server/src/auth/handlers.ts` — add `clearedPendingCookie(config)`**,
   mirroring `clearedChallengeCookie` but with the pending cookie's attributes
   (`config.pendingCookieName`, `httpOnly`, `secure: config.secureCookies`,
   `sameSite: 'Strict'`, `path: '/'`).

3. **`packages/server/src/auth/device-handlers.ts` — add `postClaimSession(deps, req)`:**

   The response body always carries a `status` discriminator
   (`'approved' | 'pending' | 'denied'`), mirroring `getPendingStatus`, so the
   client parses one shape regardless of outcome. Only `approved` sets cookies
   and includes `credentialId`.

   - `readPendingTicket(...)` (peek). `Error` → `toAuthResult(err)` (invalid /
     missing ticket → 4xx).
   - `getDevice(ticket.credentialId)`:
     - `DeviceNotFoundError` → `{ status: 200, body: { status: 'denied' } }`
       (owner denied — denial deletes the pending device);
     - other `Error` → `toAuthResult(err)`;
     - device `status !== 'active'` → `{ status: 200, body: { status: 'pending' } }`
       (not yet approved; ticket left intact so the client can keep polling).
   - Device is `active`: `consumePendingTicket(...)`; if `Error` (already
     consumed by a racing claim / expired) → `toAuthResult(err)`.
   - `issueSession({ accountId, credentialId, ip: clientIp(req), ua })`
     (same shape as `postLoginVerify`).
   - `emit('login', { accountId, credentialId })` — a session was established.
   - Return `{ status: 200, body: { status: 'approved', credentialId },
     headers: { 'Set-Cookie': [sessionCookieFor(...), clearedPendingCookie(config)] } }`.

4. **`packages/server/src/auth/index.ts` — register the route:**
   `router.on('POST', '/api/auth/devices/claim-session', … postClaimSession …)`.
   `GET /api/auth/devices/pending-status` is unchanged.

5. **nginx:** no change. `/api/auth/devices/claim-session` falls under the
   public, rate-limited `location /api/auth/` block (authenticated by the
   pending ticket, not a session — the new device has none yet), like the other
   add-device endpoints.

### Client (`packages/client/activation/src/model/add-device-model.ts`)

1. **Remove `completeLoginAfterApproval`** and the `startAuthenticationCeremony`
   dependency from `AddDeviceDeps` (its defaults and the interface). It is used
   nowhere else in this file. `startRegistrationCeremony` stays (create passkey).
2. **Add a `claimSession` step**: `POST /api/auth/devices/claim-session` (no
   body — the pending ticket cookie carries identity). Parse the `status`
   discriminator from the `200` body; a transport error or 4xx → `AddDeviceError`.
3. **`pollPendingStatus`** stays a pure status read. On `approved`:
   `stopPolling()` → `claimSession()`, then switch on the claim's `status`:
   - `approved` → `deps.storage.set(credentialId)` (login hint for future
     sign-ins) → `mode.set('done')` → `deps.navigate('/')`;
   - `denied` → `mode.set('rejected')`;
   - `pending` (defensive; a real `approved` poll should not see this) →
     resume polling (`beginPolling()`);
   - `AddDeviceError` → `error.set(...)`, stay on `waiting` with a retry
     affordance.
   On a poll `denied` → `rejected`; on poll `pending` → keep polling.
4. **Single-flight guard** so overlapping polls (slow mobile network, GET > 2s
   poll interval) fire `claimSession` at most once. With the ceremony gone a
   duplicate is already harmless, but the guard also avoids a second claim
   hitting an already-consumed ticket.

### Data flow (after change)

```
new device: create passkey (1 ceremony) → register/verify → pending ticket
new device: GET pending-status (poll, pure read) → pending → pending → approved
new device: POST claim-session  → server mints session (Set-Cookie), consumes ticket
new device: navigate('/')       → board loads, gated requests carry the session → 200
```

No second WebAuthn ceremony; no authenticator credential selection after
approval.

## Error handling & edge cases

- **Claim before approval** (client bug / race): device not `active` → `200
  { status: 'pending' }`, ticket untouched, client resumes polling.
- **Owner denied between poll and claim**: device deleted → `denied`, no session.
- **Poll race (two overlapping approved polls → two claims)**: ticket consume is
  atomic and single-use; the loser gets `PendingTicketInvalidError`; the client
  single-flights claim, so the user sees one outcome.
- **Lost claim response** (network drop after server consumed the ticket):
  the device is already `active`, so the user can sign in normally from the
  login landing. Acceptable, rare.
- **Ticket TTL** (`PENDING_TTL_MS = 15 min`) bounds the approval window,
  unchanged.

## Security

- A session is minted only when **both** a valid pending ticket is presented
  **and** the device is `active` (owner-approved). The pending ticket is issued
  only after a successful registration attestation, is `httpOnly` +
  `SameSite=Strict`, lives only on the new device, and is single-use on claim.
- Removing the post-approval assertion does not weaken the trust chain
  (attestation already proved key possession; the owner already approved) and
  removes the stale-credential failure mode.

## Testing (local only — do not test on the live Pi)

- **`packages/server/src/auth/device-handlers.test.ts`** — `postClaimSession`:
  active → `{ status: 'approved', credentialId }` + session cookie set + pending
  cookie cleared + ticket consumed; device pending → `{ status: 'pending' }`,
  ticket intact, no cookies; device missing → `{ status: 'denied' }`; missing /
  expired ticket → 4xx; second claim after consume → 4xx (single-use).
- **`packages/server/src/auth/pending-tickets.test.ts`** — `consumePendingTicket`
  deletes and returns the record; second call → invalid; expired → invalid.
- **`packages/client/activation/src/model/add-device-model.test.ts`** —
  `approved` → `claimSession` → `navigate('/')` + `storage.set`;
  `startAuthentication` is no longer called; claim failure keeps `waiting` and
  sets `error`; single-flight fires claim once under overlapping polls.
- **`packages/client/e2e/add-device.spec.ts`** — a new device reaches the board
  after approval with **no** `/api/auth/login/verify` from the new device
  (poll → claim → board), under the virtual authenticator.
- Manual: dev-docker (`pnpm dev:docker`) with a virtual authenticator. No live-Pi
  testing; do not create test devices on production.
