# Device Invite + WebAuthn Access Gate Design

**Date:** 2026-07-05
**Status:** Approved

## Goal

Turn the currently-open board into a private application that only invited
devices can reach, before it is published to the public internet. Access is
granted through single-use invite links created from the Raspberry Pi, and each
device proves itself with a WebAuthn/passkey credential. Until a device is
authorized, it must not even be able to download the board or widget code — the
protection is server-enforced, not cosmetic.

The end-to-end flow the user described:

1. Admin SSHs into the Raspberry Pi.
2. Admin runs an invite-creation script inside the app container.
3. The script writes an invite record (id, token hash, expiry, single-use, not
   yet used).
4. The script prints an activation link (`https://<host>/activate?token=…`).
5. Admin sends the link to a person.
6. The person opens the link.
7. Their device generates a credential keypair (private key stays on the
   device, public key goes to the server).
8. The server verifies the invite token.
9. If the invite is live and unused, the server stores the public key as a
   device, marks the invite used, and authorizes the device.
10. The link stops working.

## Key decisions

These were settled during brainstorming and drive the whole design:

- **Enforcement, not just enrollment.** The board API is currently wide open.
  Hiding only the frontend would be meaningless, so the API is gated too. This
  feature is "registration + API protection."
- **Server-enforced boundary.** An unauthorized device cannot even *download*
  the board/widget code. Gating is done by nginx `auth_request`, not by the
  client deciding what to render.
- **WebAuthn / passkey** for the device credential (not app-generated WebCrypto
  keys). Hardware-backed, phishing- and replay-resistant out of the box, which
  fits the "secure before publication" bar.
- **Valkey storage, no SQL.** Invites, devices, sessions, and challenges are
  Valkey keys with TTLs. The spec's "tables" map onto key namespaces. No new
  database is introduced.
- **One shared board.** An invite grants a device access to the whole board.
  There are no per-user boards or roles. Devices are still individually
  distinguishable (listable and revocable).
- **Gate the whole board, keep a tiny separate activation page (Approach A).**
  The board's Vite/Module Federation/PWA build is left untouched and served
  entirely behind the gate. A minimal standalone activation page (plain HTML +
  a small script, not a board build target) is served on the `401` fallback.
  We explicitly do **not** introduce a second Vite application or reroute board
  chunks into a gated directory.

## Non-goals

- No second Vite application and no build-level splitting of board chunks into a
  gated output directory.
- No SQL database; Valkey remains the only store.
- No per-user boards, roles, or permissions beyond "device is authorized".
- No in-board admin UI for managing invites/devices in this iteration (CLI ops
  scripts only; an in-board panel is future work).
- No change to the existing widget/board runtime, Module Federation wiring, or
  storage API contract other than placing them behind the gate.

## Architecture

### Two frontend shells

| Shell | Contents | Served to |
|-------|----------|-----------|
| **Board shell** (existing `packages/client`, `main.tsx`) | Full board, federated widgets, PWA/service worker | Only requests with a valid session |
| **Activation page** | Minimal HTML + a small script doing WebAuthn ceremonies and invite handling. Does **not** import board or widgets. Styled with the shared theme CSS variables | Unauthorized requests (the `401` fallback) |

### nginx as a single gate (`auth_request`)

- Internal `location = /internal/auth` proxies to the server's
  `GET /api/auth/session`, which returns `200` if the session cookie is valid
  and `401` otherwise.
- **Behind `auth_request`:** `/` and SPA routes, `/assets/*`, `/widgets/*`, and
  all `/api/*` except the auth allowlist. On `401`, `error_page 401` internally
  serves the activation page (URL does not change).
- **Public allowlist (no `auth_request`):** the activation page and its assets,
  plus `/api/auth/register/*`, `/api/auth/login/*`, `/api/auth/session`, and
  `/api/auth/logout`.

The gating credential for static files is the **session cookie**, which the
browser sends automatically with every request — including `<script src>`,
dynamic `import()`, and service-worker precache fetches. This is what makes
server-side protection of static chunks actually work (a JS-attached
`Authorization` header could not cover those request types).

### Enrollment flow (new device with an invite)

1. Open `/activate?token=…` → no session → nginx serves the activation page.
2. Activation script reads the token → `POST /api/auth/register/options {token}`
   → server checks the invite is live (without consuming it), returns WebAuthn
   creation options, and stores the challenge (bound to a short-lived
   `wa_chal` cookie).
3. `navigator.credentials.create()` → the platform authenticator (Face ID /
   Windows Hello / security key) generates the credential.
4. `POST /api/auth/register/verify {token, attestationResponse}` → server
   verifies the WebAuthn registration, then **atomically** consumes the invite,
   stores the `device`, and sets the session cookie.
5. Client `location.assign('/')` → `auth_request` now returns `200` → the board
   shell, assets, and widgets load and the service worker registers. The invite
   is now used, so the link no longer works.

### Return flow (known device, expired session)

`/` → no/expired session → activation page in "login" mode →
`POST /api/auth/login/options` → `navigator.credentials.get()` →
`POST /api/auth/login/verify` → session cookie → redirect to `/`. Silent, no new
invite required.

### PWA / service worker

The service worker and the board/widget precache are registered **only in the
board shell**, i.e. after authorization. The activation page registers no
service worker, so an unauthorized device never fetches board code. Service
worker fetches carry the session cookie, so `auth_request` passes for them.

## Data model (Valkey key namespaces)

| Key | Value (JSON) | TTL |
|-----|--------------|-----|
| `invite:{sha256(token)}` | `{ id, createdAt, expiresAt, maxUses, uses, usedAt, label?, createdBy? }` | `expiresAt` |
| `device:{credentialIdB64url}` | `{ credentialId, publicKey, signCount, transports?, label?, createdAt, inviteId, lastSeenAt, disabled }` | none (until revoked) |
| `session:{sessionId}` | `{ credentialId, createdAt, expiresAt, lastSeenAt, ip?, ua? }` | sliding, 30d |
| `wachal:{challengeId}` | `{ challenge, type: 'reg' \| 'auth', inviteHash? }` | 5 min |

- **Invites are looked up by hash.** The client sends `token`; the server
  computes `sha256(token)` and does `GET invite:{hash}`. Only the hash is stored
  (the spec's `token_hash`).
- **Single-use is enforced atomically.** Invite consumption runs under
  `runExclusive(inviteKey)` (existing `packages/server/src/storage/key-lock.ts`):
  re-check "live" + increment `uses`; when `uses >= maxUses` the invite is dead.
  Two concurrent activations cannot both succeed.
- **Challenges** are single-use, bound to the ceremony via the short-lived
  `wa_chal` httpOnly cookie, and deleted after verification.

## Endpoints (`/api/auth/*`, public allowlist)

| Method / path | Behavior |
|---------------|----------|
| `POST /register/options` | Verify the invite is live (no consumption) → return WebAuthn creation options → store challenge |
| `POST /register/verify` | `verifyRegistrationResponse` → **atomically** consume the invite → store `device` → set session cookie |
| `POST /login/options` | Return authentication options (challenge; `allowCredentials` from a local hint or discoverable credentials) |
| `POST /login/verify` | `verifyAuthenticationResponse` (check public key; sign-counter regression = clone → reject) → set session cookie |
| `GET /session` | The `auth_request` verifier: valid cookie → `200` + TTL refresh; otherwise `401`. Called on every gated request |
| `POST /logout` | Delete the session and clear the cookie |

Everything else (`/`, `/assets/*`, `/widgets/*`, `/api/storage/*`,
`/api/widgets/*`, `/api/time`) sits behind `auth_request`.

## WebAuthn parameters

- **Libraries:** `@simplewebauthn/server` (verification) and
  `@simplewebauthn/browser` (activation-page ceremony — a couple of KB, does not
  pull in the board). Attestation/COSE parsing is not hand-rolled.
- `rpID` / `rpName` / `expectedOrigin` come from env (`RP_ID`, `RP_NAME`,
  `PUBLIC_APP_URL`). Dev uses `localhost` (WebAuthn requires a secure context:
  HTTPS or localhost).
- `attestation: 'none'` (authenticator provenance is not needed).
- `userVerification: 'required'` (biometrics/PIN).
- `residentKey: 'preferred'`; both platform and cross-platform authenticators
  allowed (a security key works too).
- `pubKeyCredParams`: ES256 (−7) and EdDSA (−8).
- `excludeCredentials` on registration so one authenticator cannot register two
  devices from different invites.

## Invite creation and ops scripts

- `packages/server/scripts/create-invite.ts`, compiled into the server image.
  Run on the Pi: `docker compose exec server node dist/scripts/create-invite.js
  --label "Grandma's iPad" --ttl 7d`. (The compose service is `server`, not
  `app`, and it builds to `dist/`.)
- It generates a 256-bit token, writes `invite:{sha256}` to Valkey with a TTL,
  and prints `${PUBLIC_APP_URL}/activate?token=<token>`.
- Sibling ops scripts for the "secure before publication" posture:
  `list-devices.ts`, `revoke-device.ts`, `revoke-invite.ts`. A full in-board
  admin panel is future work.

## Security hardening (public internet)

- Cookies are `HttpOnly` + `Secure` + `SameSite=Lax`. The activation link
  arrives by email (a GET navigation), which `SameSite=Lax` tolerates.
- **CSRF:** WebAuthn login is origin-bound (phishing-resistant). Other
  state-changing requests require a custom header (`X-Requested-With`) that only
  the board sets, alongside `SameSite` cookies.
- **Rate limiting:** nginx `limit_req` by IP on `/api/auth/*`, plus a
  per-invite attempt counter in Valkey.
- Sign-counter regression → reject (clone detection). Sessions use a sliding TTL
  with an absolute lifetime cap.
- **Audit:** registrations and logins are logged with timestamp, IP, and user
  agent.
- All flows follow the errore pattern (tagged errors / `Error | T` unions, no
  throwing) and validate request bodies with Zod, matching the existing server.

## Testing

- **Server unit (Vitest, `memory-ops` as the Valkey stand-in):** invite
  create/consume/expire, double-activation race via `runExclusive`,
  `uses >= maxUses` death; `GET /session` `200`/`401` + TTL refresh; register /
  login verify success plus sign-counter regression (clone), stale/foreign
  challenge, and disabled device. Failure modes are errore tagged errors
  (`InviteExpiredError`, `InviteConsumedError`, `ChallengeInvalidError`,
  `WebAuthnVerificationError`, `SessionMissingError`).
- **nginx gating (extend `test:e2e:nginx` / `infra.test.ts`):** no cookie → `/`
  serves activation, `/assets/*` and `/widgets/*` return `401`; with a valid
  cookie the board is served.
- **E2e (Playwright, CDP virtual authenticator):** seed an invite in Valkey →
  `/activate?token` → register with a virtual authenticator → board loads →
  reload stays authorized → logout → activation → re-activating with the spent
  invite fails ("link is dead").

## File layout

```
packages/server/src/auth/
  invites.ts            # create/consume/lookup (errore + Zod)
  devices.ts            # store/list/revoke device
  sessions.ts           # issue/verify/refresh/revoke session
  webauthn.ts           # @simplewebauthn/server wrappers (reg/auth options+verify)
  challenge-store.ts    # wachal:* + cookie binding
  handlers.ts           # HTTP handlers for /api/auth/*
  schemas.ts            # Zod schemas for request bodies
  *.test.ts
packages/server/scripts/
  create-invite.ts, revoke-invite.ts, list-devices.ts, revoke-device.ts
packages/client/activation/   # standalone lightweight page (not a board build target)
  activate.html + activate.ts (@simplewebauthn/browser, theme CSS variables)
packages/client/nginx.conf     # auth_request, allowlist, error_page 401 → activation
docker-compose.yml             # env: RP_ID, RP_NAME, PUBLIC_APP_URL, SESSION_*
```

## Delivery order (incremental, each stays green)

1. **Server core, no gate yet:** invites/devices/sessions/webauthn +
   `/api/auth/*` + the `create-invite` script, with unit tests. The gate is not
   enabled; the board still works as before.
2. **Activation page:** `activate.html` / `activate.ts`, running the full
   WebAuthn flow against the core. E2e with a virtual authenticator.
3. **Enable the nginx gate:** `auth_request` + allowlist + `error_page 401`.
   From here the board is private. nginx tests.
4. **Hardening:** rate limiting, the CSRF header in the board client, audit
   logs, and the revoke/list ops scripts. Run `pnpm check` + e2e.

This order guarantees the door only closes (step 3) once activation already
works, so we cannot lock ourselves out.

## Operational & integration decisions (2026-07-05)

These decisions were locked in a focused follow-up brainstorm. They refine and,
where noted, supersede the defaults above.

### A. Production origin & TLS
- Public URL: `https://board.iiskelo.com`. TLS terminates at the Cloudflare
  edge; `cloudflared` on the Pi tunnels to the client nginx over HTTP. The
  browser always sees HTTPS, so `Secure` / `__Host-` cookies and the WebAuthn
  secure-context requirement are satisfied.
- `RP_ID = board.iiskelo.com`; `EXPECTED_ORIGIN = PUBLIC_APP_URL =
  https://board.iiskelo.com`. The WebAuthn origin is verified against the
  hardcoded `EXPECTED_ORIGIN` env, never a request header.
- The real client IP is taken from `CF-Connecting-IP` (Cloudflare Tunnel), not
  `X-Forwarded-For`, for rate limiting and audit. SSE (`/api/storage/events`)
  must be confirmed to pass through the tunnel unbuffered (`x-accel-buffering:
  no` is already set).

### B. Expired-session / 401 behavior (offline-first preserved)
- On an API `401`, the board client attempts a **silent WebAuthn re-login**
  (`login/options` → `navigator.credentials.get()` → `login/verify`). Success
  resumes seamlessly; failure or cancel redirects to the activation page. This
  lives as a `401` interceptor in the `widget-runtime` HTTP storage backend.
- SSE: auth is checked at stream open; a `401` at open triggers re-login;
  mid-stream expiry is tolerated until the next reconnect (which re-auths).
- Explicit logout purges the service-worker caches and Dexie board data and
  unregisters the service worker.
- The service worker caches the app shell/assets only for already-authorized
  devices, so offline-first is preserved. Data confidentiality is always
  enforced by the API gate; a never-authorized device cannot download board
  code (nginx gate). A previously-authorized device reusing its cached shell
  after expiry is acceptable — it shows no data until re-auth.

### C. Dev/test strategy (the gate is nginx-only)
- Server auth logic (invites/devices/sessions/webauthn/challenge) is covered by
  Vitest unit tests; no nginx needed.
- The activation flow, WebAuthn, and gate behavior are covered by Playwright
  with a CDP virtual authenticator against the **dockerized nginx** stack
  (extend `test:e2e:nginx` / `test:e2e:docker`), because the `auth_request`
  gate exists only there.
- `pnpm dev` (Vite, no nginx) serves `/api/auth/*` and the activation page for
  flow iteration, but gate behavior (`401` → activation, asset blocking) is
  verified only via the Docker path.
- E2e seeds invites through a test-only endpoint guarded by
  `ALLOW_TEST_DB_RESET` (mirrors the existing `/api/test/*`).
- **Activation page form (supersedes the base spec's file layout):** a
  self-contained **inline TS page** (`activate.html` with inlined JS + CSS,
  `@simplewebauthn/browser`, shared theme CSS variables), produced by an
  isolated mini-build outside the board's Vite graph. It emits nothing under
  `/assets/`, so it is served publicly with no gating chicken/egg. The board
  build is untouched.

### D. Session & cookies
- Session cookie `__Host-mb_session`: `Secure` + `HttpOnly` + `Path=/` +
  `SameSite=Lax` + no `Domain`.
- Challenge cookie `__Host-mb_chal`: `SameSite=Strict`, 5-minute TTL,
  single-use.
- Session lifetime: sliding **30 days**, absolute cap **90 days**. TTL refresh
  is throttled (rewritten at most ~every 5 minutes to avoid a Valkey write per
  request).
- `auth_request` is uncached in nginx initially (a Valkey `GET` is cheap);
  revisit under load.

### E. WebAuthn parameters (strict profile)
- `userVerification: 'required'` and `residentKey: 'required'` (discoverable
  credentials).
- Identity: a random 16-byte `user.id` per device; `user.name` / `displayName`
  from the invite label (fallback "Board device").
- Return-login uses an empty `allowCredentials` + discoverable credentials,
  plus a credential-ID hint in `localStorage` as a fast path.
- On the activation page, a spent invite with an existing credential offers
  login instead of an error.
- Unchanged from the base spec: `attestation: 'none'`, ES256 + EdDSA,
  `excludeCredentials` on registration, the `@simplewebauthn/*` libraries.

### F. Env, rate limiting, ops scripts, delivery split
- Env (`.env.example` + `docker-compose.yml`): `RP_ID`, `RP_NAME`,
  `PUBLIC_APP_URL`, `EXPECTED_ORIGIN`, `SESSION_TTL_SLIDING`,
  `SESSION_TTL_ABSOLUTE`, `SESSION_COOKIE_NAME`, and a flag to trust
  `CF-Connecting-IP`.
- Rate limiting: `/api/auth/*` at 30 req/min/IP via nginx `limit_req` (real IP
  from `CF-Connecting-IP`); per-invite 10 failed attempts locks the invite.
- Ops scripts: `create-invite`, `revoke-invite`, `list-devices`,
  `revoke-device`.
- **Delivery split (supersedes the single "Delivery order" above): two plans.**
  Plan 1 — dormant: the auth backend + activation page with the gate OFF
  (base-spec steps 1–2). Plan 2 — enforced: enable the nginx gate + hardening
  (base-spec steps 3–4). The gate is only enabled in Plan 2, after activation
  is proven, so we cannot lock ourselves out.

### Implementation loop (model routing)
Captured in `looper-output/loop.yaml`, not implemented as product code: Opus
4.8 orchestrates (writing-plans, triage, finishing-a-development-branch);
Sonnet 5 implements **all** tasks via the `sonnet-superpowers-implementer`
subagent (no Opus escalation); Codex GPT-5.5 reviews correctness
(`codex exec review --base <base> -m gpt-5.5`); the `/security-review` skill
runs in-session on Opus.
