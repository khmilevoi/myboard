# Tokenized Browser Recovery Transport Design

**Date:** 2026-07-24

**Master design:** [Passport Checker and Browser Automation Runtime Design](./2026-07-03-passport-checker-browser-automation-design.md)

**Subproject:** 6 — Tokenized browser recovery transport

## Goal

Let an operator take manual control of a retained browser challenge page from
the board itself, over one short-lived, single-use, same-origin WebSocket,
without publishing the VNC port and without requiring an SSH tunnel for the
normal flow.

The transport is delivered and verified without any widget UI. The passport
checker widget (Subproject 7) consumes it later; nothing in this subproject is
passport-specific.

## Scope

This subproject includes:

- a retained-page availability query in the browser automation service;
- short-lived, single-use, session-bound recovery capabilities held in main
  server memory;
- a same-origin WebSocket upgrade tunnel from the board ingress to the internal
  websockify endpoint;
- capability invalidation on use, expiry, disconnect, session cap, task retry,
  and server shutdown;
- ingress and development-proxy configuration for the WebSocket path;
- tagged, error-as-value failures with stable public codes;
- unit, integration, static-configuration, and opt-in browser tests;
- master-spec amendments for the changed threat model and the dropped SSE
  requirement.

This subproject excludes:

- widget client code, recovery panel UI, and the choice of a browser-side RFB
  library (Subproject 7);
- live recovery-state events over SSE (dropped, see Approved Decisions);
- more than one concurrent recovery session;
- a general-purpose remote browser-control API;
- LAN or public exposure of the VNC/websockify port;
- assembled-stack and ARM64 verification (Subproject 8).

## Approved Decisions

1. **Two layers of access control.** The WebSocket path is gated by the existing
   WebAuthn session gate, and a single-use capability is required on top of it.
   The capability binds a connection to one widget and one session; it is not
   the only authentication.
2. **The main server proxies raw bytes.** The upgrade is tunneled: the server
   validates the handshake, opens a TCP connection to websockify, replays the
   upgrade request, and pipes sockets. It never parses WebSocket frames and adds
   no runtime WebSocket dependency; `ws` is a test-only devDependency used to
   drive real handshakes.
3. **The internal leg terminates at websockify, not at RFB.** `x11vnc` runs with
   `-localhost`, so port 5900 exists only inside the browser container;
   `browser-automation:6080` is the only reachable hop.
4. **Capabilities are minted on demand, after an availability check.** The server
   asks the browser service whether a retained page exists and only then issues a
   token, so a token never points at a page that is already gone.
5. **The capability travels in a narrowly scoped cookie**, not in the query
   string and not in a WebSocket subprotocol. It stays out of URLs, access logs,
   and `Referer`, and `SameSite=Strict` keeps a cross-site page from opening the
   socket with it.
6. **One active recovery connection service-wide.** The X display is shared by
   the whole persistent context, so a second viewer would see the same screen and
   fight for the pointer.
7. **Retry revokes recovery in the main server, before dispatch.** Any browser
   task invocation for a widget first tears down that widget's capability and
   live socket, so the executor never closes a retained page underneath a
   connected operator.
8. **No live recovery-state channel.** Availability is request/response. The SSE
   requirement listed for this subproject in the master design is dropped as
   YAGNI; a retained page is closed only by a retry the client itself initiates.
9. New factories follow the repository's `make*` naming; existing `create*`
   helpers in touched files are left alone.
10. `pnpm check` is the final local verification gate.

## Threat Model Amendment

The master design describes the board as trusted-LAN-only with no user
authentication, and treats the capability as the only barrier. That is no longer
true on `main`: the board is published at `https://board.iiskelo.com` through
cloudflared, and every `/api/` route, every board asset, and the SPA shell sit
behind the WebAuthn device gate enforced by `auth_request /internal/auth` in
`packages/client/nginx.conf`.

Consequences for this subproject:

- the recovery WebSocket lives under the gated `/api/` prefix and is unreachable
  without a valid session;
- the capability is a second layer that scopes a session to one widget's retained
  page, bounds its lifetime, and makes replay useless — not the primary
  authentication;
- the main server verifies the session itself on upgrade rather than trusting the
  ingress, because the Vite dev server has no `auth_request` equivalent.

The master design is amended with this change and with the removal of its SSE
recovery-state requirement.

## Components and Data Flow

```
widget: check → browser_session_required
   ↓ operator opens the recovery panel
POST /api/browser/recovery/:widgetId
   nginx auth_request → session verified
   server → GET browser-automation:8788/recovery/:widgetId → { retained: true }
   server: issue(widgetId, sessionId) → Set-Cookie + 200 { expiresInMs }
   ↓
WS /api/browser/recovery/socket
   nginx: auth_request + Upgrade/Connection → server:8787
   server upgrade handler: session + consume(cookie) → TCP browser-automation:6080 → pipe
   ↓
websockify ↔ x11vnc :5900 ↔ Xvfb :99 ↔ Chromium (retained page)
```

New and changed files:

- `packages/browser-automation/src/executor.ts` — `BrowserExecutor` gains
  `hasRetainedPage(widgetId: string): boolean`;
- `packages/browser-automation/src/browser/chromium-executor.ts` — implements it
  over the existing `retainedPages` map;
- `packages/browser-automation/src/service.ts` — `recoveryState(widgetId)`;
- `packages/browser-automation/src/http/app.ts` — `GET /recovery/:widgetId`;
- `packages/server/src/browser/recovery/capability.ts` — capability store;
- `packages/server/src/browser/recovery/tunnel.ts` — upgrade handler;
- `packages/server/src/browser/recovery/handlers.ts` — issue endpoint;
- `packages/server/src/browser/config.ts` — recovery configuration;
- `packages/server/src/browser/client.ts` + `http-client.ts` — availability query
  and revoke-before-invoke wiring;
- `packages/server/src/app.ts` — route registration and the `upgrade` listener;
- `packages/client/nginx.conf` — the exact-match WebSocket location;
- `packages/widget-sdk/src/vite/vite-dev-config.ts` — `ws: true` proxy entry.

## Availability in the Browser Service

`makeChromiumExecutor` already keeps `retainedPages: Map<string, Page>` and
closes a widget's retained page at the start of its next acquire. The map is
private; this subproject exposes exactly one read:

```ts
hasRetainedPage(widgetId: string): boolean
```

The implementation treats a closed page as absent and deletes the stale entry,
because Chromium or a context crash can close a page without going through
`closeRetainedPage`. Fake executors in `src/testing` and in tests return `false`
unless a test sets otherwise.

`BrowserService` gains `recoveryState(widgetId): { retained: boolean } | Error`,
which returns `BrowserServiceUnavailableError` unless the service state is
`ready`, mirroring `invoke`. The HTTP surface is:

```
GET /recovery/:widgetId
  200 { "retained": true | false }
  503 { "status": "draining" }
```

The query does not enqueue work: it must answer while a task occupies the single
lane, since the whole point is to inspect a page a finished task left behind.

## Capability Store

State lives in main-server memory only:

```ts
type RecoveryCapability = {
  widgetId: string
  sessionId: string
  expiresAt: number
}
```

`makeRecoveryCapabilityStore({ now, ttlMs, maxSessionMs })` exposes:

- `issue({ widgetId, sessionId })` — returns a token
  (`randomBytes(32).toString('base64url')`) and drops any previous unused token
  for the same widget, so the map cannot grow without bound; expired entries are
  swept on issue and on consume, with no background timer;
- `consume({ token, sessionId })` — returns the capability and deletes it, or a
  `RecoveryCapabilityError` when the token is unknown, expired, or bound to a
  different session;
- `attach(connection)` / `detach()` — track the single active connection;
- `revoke(widgetId)` — drop the widget's unused token and destroy its live
  connection;
- `revokeAll()` — shutdown path.

Invalidation triggers, in full:

1. **use** — the token is deleted at upgrade time, before the upstream socket is
   opened;
2. **expiry** — `BROWSER_RECOVERY_TOKEN_TTL_MS` (default 60 000) bounds the
   window between issuing and connecting;
3. **disconnect** — either side closing or erroring tears down the other and
   clears the active connection;
4. **session cap** — `BROWSER_RECOVERY_MAX_SESSION_MS` (default 900 000) destroys
   both sockets; the operator can issue a fresh capability;
5. **retry** — `revoke(widgetId)` runs before any browser task for that widget is
   dispatched;
6. **shutdown** — `revokeAll()` runs with the server's close path so no open
   socket keeps the process alive.

## Server HTTP and WebSocket Surface

### `POST /api/browser/recovery/:widgetId`

1. `requireSession` (`packages/server/src/auth/session-guard.ts`) resolves the
   session record; no session is `401`.
2. The widget id must match the safe id shape (`[a-z0-9-]+`, length-capped)
   before it is placed in an upstream URL; otherwise
   `404 { code: 'recovery_unavailable' }`. The server does not consult its widget
   registry here: browser tasks and their retained pages are owned by
   `browser-automation`, and its availability answer is the single source of
   truth for whether recovery is possible.
3. A live connection anywhere in the service returns
   `409 { code: 'recovery_busy' }`.
4. The availability query runs; `retained: false` returns
   `404 { code: 'recovery_unavailable' }`, an unreachable or draining service
   returns `503 { code: 'automation_unavailable' }`.
5. On success the response is `200 { expiresInMs }` plus:

```
Set-Cookie: __Secure-mb_recovery=<token>; Path=/api/browser/recovery;
            Max-Age=60; HttpOnly; Secure; SameSite=Strict
```

The `__Host-` prefix used by the session cookie is unavailable here: it requires
`Path=/`, and this cookie is deliberately scoped to the recovery paths.
`__Secure-` allows a narrow path and still demands HTTPS. As with the auth
cookies, both the prefix and the `Secure` attribute are dropped when
`secureCookies` is false, so the cookie also works on a plain-HTTP dev origin.

The cookie is not cleared on success: the `101` response is produced by
websockify and the tunnel does not rewrite it. Clearing is unnecessary — the
token is already burned server-side, and the cookie itself expires in 60 seconds.

### `GET /api/browser/recovery/socket` (upgrade)

Registered on the HTTP server's `upgrade` event, not on the `find-my-way` router.
The handler:

1. rejects any path other than the socket path;
2. resolves the session from the request cookies, in process;
3. reads the capability cookie and calls `consume`;
4. rejects when a connection is already active;
5. opens a TCP socket to `BROWSER_RECOVERY_URL`, writes a reconstructed upgrade
   request — original request line replaced with `GET / HTTP/1.1`, `Host` set to
   the upstream authority, WebSocket handshake headers (`Upgrade`, `Connection`,
   `Sec-WebSocket-Key`, `Sec-WebSocket-Version`, and `Sec-WebSocket-Protocol` /
   `Sec-WebSocket-Extensions` when present) forwarded verbatim so the browser and
   websockify negotiate end to end, and **`Cookie`, `Authorization`, and
   forwarding headers dropped** so no session or capability material reaches
   websockify;
6. writes the `head` buffer handed to the `upgrade` listener upstream, then pipes
   both directions;
7. arms the session-cap timer and registers teardown on `close`/`error` for both
   sockets.

Every rejection writes a minimal status line (`401`, `404`, `409`, `503`) with no
body and destroys the socket, because there is no negotiated protocol yet in
which to describe an error.

## Retry Invalidation

The revoke-before-dispatch rule lives in the main server, wrapping the browser
automation client used by widget handlers (`packages/server/src/browser/`), not
in the executor. A hook on `closeRetainedPage` would fire inside
`browser-automation` after the page is already closing, with no way to reach the
socket held in the other process; the server-side wrapper drops the socket first
and only then lets the task travel.

## Configuration

Added to `loadBrowserGatewayConfig`:

| Variable | Default | Meaning |
| --- | --- | --- |
| `BROWSER_RECOVERY_URL` | `http://browser-automation:6080` | websockify origin for the internal leg |
| `BROWSER_RECOVERY_TOKEN_TTL_MS` | `60000` | issue → connect window |
| `BROWSER_RECOVERY_MAX_SESSION_MS` | `900000` | maximum length of one recovery session |

`docker-compose.yml` keeps `127.0.0.1:6080:6080` on `browser-automation`, so the
documented SSH fallback is unchanged, and the service stays on the
`browser_internal` network with only `server` able to reach it.

## Ingress and Development Proxy

`packages/client/nginx.conf` gains an exact-match location, which outranks the
prefix `/api/` location regardless of file order:

```nginx
location = /api/browser/recovery/socket {
    auth_request /internal/auth;
    proxy_pass $upstream$request_uri;
    proxy_http_version 1.1;
    proxy_set_header Upgrade $http_upgrade;
    proxy_set_header Connection "upgrade";
    proxy_set_header Host $host;
    proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
    proxy_set_header X-Forwarded-Proto $scheme;
    proxy_read_timeout 960s;
    proxy_send_timeout 960s;
    proxy_buffering off;
}
```

The existing `/api/` block cannot serve this path: it forwards no `Upgrade` or
`Connection` header, and its default 60-second read timeout would drop an idle
VNC session. The timeouts here sit above `BROWSER_RECOVERY_MAX_SESSION_MS` so the
server, not nginx, owns session expiry. `auth_request` works normally on an
upgrade request, which is an ordinary `GET` carrying cookies. Cloudflared
supports WebSockets by default; no tunnel configuration changes.

`apiProxy()` in `packages/widget-sdk/src/vite/vite-dev-config.ts` currently
returns a single `/api` entry without `ws`, so Vite would not proxy the upgrade.
It gains a dedicated entry for the socket path with `ws: true`, keyed before the
generic `/api` entry.

## Error Model

Nothing throws for control flow. The capability store returns a tagged
`RecoveryCapabilityError`; the issue handler returns a typed result carrying the
status and public code, since its outcomes never propagate past the route.
Gateway failures arrive as the existing `@shared/widgets/browser-errors` values.

| Outcome | Cause | Public surface |
| --- | --- | --- |
| unavailable | unsafe widget id, or no retained page | `404 recovery_unavailable` |
| busy | a recovery connection is already active | `409 recovery_busy` |
| `RecoveryCapabilityError` | missing, expired, burned, or foreign-session token | `401` on upgrade |
| gateway error | websockify unreachable or the availability query failed | `503 automation_unavailable` |

No error message includes the token, the session id, or upstream response bodies.
Logs record `widgetId` and the error tag only.

## Security Considerations

- **A recovery session controls the whole display.** `Xvfb :99` hosts one
  persistent Chromium with full browser chrome, so an operator can reach any tab
  of any widget and browse from inside the `browser_internal` network. Scoping to
  a single page is not possible with a shared display. Accepted, and compensated
  by: the WebAuthn gate, one active connection, the 15-minute cap, single-use
  tokens, and a VNC port that is published only on the Pi's loopback.
- **A retained challenge page may show passport data**, because the panel shows
  the real screen. Tests must not capture screenshots, videos, or traces of a
  recovery connection.
- **The token never enters a URL**, an access log, or a `Referer` header, and
  `SameSite=Strict` prevents a cross-site document from opening the socket with
  the victim's cookies.
- **No credential material crosses into the browser container**: the tunnel
  strips `Cookie` and `Authorization` from the replayed upgrade request.
- **The VNC port stays loopback-bound**; embedded recovery reaches it only
  through the gated proxy, and the SSH fallback from the master design keeps
  working unchanged.

## Testing Strategy

### Capability store tests

Single use, TTL expiry, session mismatch, re-issue invalidating the previous
token, busy detection, `revoke(widgetId)` destroying the live connection, and
`revokeAll()`.

### Issue endpoint tests

Status and code mapping for success, unknown widget, no retained page, busy,
draining service, and unreachable service; exact cookie attributes (`Path`,
`Max-Age`, `HttpOnly`, `Secure`, `SameSite=Strict`) including the non-secure dev
variant with the stripped prefix.

### Tunnel integration tests

A real HTTP server carrying the tunnel plus a real `ws` server standing in for
websockify, driven by a real `ws` client so the handshake and binary frames are
genuine, with no browser involved:

- a `101` handshake passes through and bytes flow verbatim in both directions;
- the replayed upgrade request carries no `Cookie` or `Authorization` header;
- upgrade without a session, with no capability cookie, with an expired token,
  with an already-consumed token, and with a token issued to another session are
  each rejected with the documented status and the socket destroyed;
- a second concurrent upgrade is rejected while the first stays alive;
- `invoke` for the widget destroys the live connection before dispatching;
- the session cap destroys both sockets;
- server shutdown destroys the connection and completes.

### Browser service tests

`hasRetainedPage` semantics including a closed page and stale-entry cleanup;
`GET /recovery/:widgetId` returning both states; `503` while draining.

### Static configuration tests

`packages/client/nginx.conf` contains the exact-match socket location with
`auth_request` and both upgrade headers; `docker-compose.yml` still binds 6080
only on `127.0.0.1` and keeps `browser-automation` off the default network.

### Opt-in browser test

Under `BROWSER_IT=1`, against the real container: a genuine RFB handshake through
the proxy followed by one key event, proving an operator can control the retained
page. No screenshots or traces are recorded.

### Verification

`pnpm check` is the gate. Targeted package tests may be used during development
but do not replace it.

## Done When

- a retained fixture page can be controlled through one token-authorized,
  same-origin WebSocket;
- reused, expired, foreign-session, and missing tokens are all rejected, and a
  request without a board session never reaches the tunnel;
- a second concurrent recovery attempt is refused rather than sharing the display;
- issuing a task for the widget tears down an active recovery session before the
  task is dispatched;
- the VNC port is not reachable from the LAN and the SSH fallback still works;
- no token, session id, or upstream body appears in any log or error message;
- `pnpm check` passes.

## Master Design Amendments

The master design is updated in the same branch:

1. the Cloudflare Recovery section records that the board is no longer LAN-only
   and that the capability is a second layer over the WebAuthn gate;
2. the Subproject 6 scope drops "recovery availability/state events over the
   existing SSE channel", with the reason;
3. the Subproject 6 section gains its `**Design:**` and `**Plan:**` back-links.

## Deferred Work

- the recovery panel, the browser-side RFB client, and all user-visible states
  (Subproject 7);
- any live availability channel, if the widget UI turns out to need one;
- multi-viewer or view-only recovery sessions;
- assembled-stack and ARM64 verification (Subproject 8).
