# Passport Checker Widget Design

**Date:** 2026-07-24

**Master design:** [Passport Checker and Browser Automation Runtime Design](./2026-07-03-passport-checker-browser-automation-design.md)

**Recovery transport:** [Tokenized Browser Recovery Transport Design](./2026-07-24-browser-recovery-websocket-design.md)

**Subproject:** 7 — Passport checker widget

**Status:** Approved

**Visual design:** Claude Design project `myboard`, file `Паспорт-чекер.dc.html`
(`https://claude.ai/design/p/1d140473-1ef3-46e2-b23d-f909fb3c2a02`). All token
values, tier layouts, states, and the recovery modal below are transcribed from
it. Where this spec and the visual mockup disagree, this spec wins (see
[Reconciliation with the visual design](#reconciliation-with-the-visual-design)).

> **Amendment (2026-07-25):** the fullscreen-stack limitations this widget
> shipped with — mount autofocus losing to the underlying trapped Radix
> `FocusScope`, and `hideOthers` marking the portal `aria-hidden` — are removed
> by collapsing fullscreen instead of stacking over it. That required the
> widget's models to be shared between the tile and fullscreen mounts. See
> [Passport Checker Tier-Shared State Design](./2026-07-25-passport-checker-tier-shared-state-design.md).

## Goal

Deliver the user-facing passport-checker widget and its widget RPC handler on top
of the stable browser gateway (Subproject 4), the passport browser task
(Subproject 5), and the tokenized recovery transport (Subproject 6). The widget
runs one no-input check, renders every resulting state, and — when the remote
browser session needs a human — embeds a live noVNC recovery panel and an SSH
fallback, both driven by the Subproject 6 transport.

The widget sends no passport identity through client RPC; the document is a
server-side deployment secret consumed only inside the browser task.

## Scope

- widget client and server definitions for `packages/widgets/passport-checker`;
- a single no-input `check` widget RPC event and its server handler;
- a **generic widget-RPC change** that lets a handler return a public, coded
  error whose `code`/`message`/`meta` survive dispatch and reach the client
  structurally (needed so the UI can narrow on `browser_session_required`);
- a Reatom async model with timeout/cancellation state and safe error mapping to
  a discriminated view state;
- `reatomMemo` UI for idle, pending, success, retryable-error, invalid
  configuration, and session-required states across the `tiny` and `standard`
  tiers;
- a self-contained recovery modal embedding `@novnc/novnc`, an access-capability
  countdown, SSH fallback instructions, and explicit retry;
- model, component, contract, and accessibility tests, plus tests for the
  generic widget-RPC change.

## Non-goals

- No browser runtime behavior, Docker provisioning, or infra wiring (Subproject
  8).
- No automatic polling, background refresh, or persisted results — the last
  result lives only in in-memory Reatom state and disappears on reload.
- No additional document types, no passport input fields, no widget settings
  panel.
- No new design system: the widget reuses existing myboard tokens.
- No change to the Subproject 6 transport contract; the widget only consumes it.

## Architecture

### Module layout

New files under `packages/widgets/passport-checker/`:

```text
client.ts                 defineWidgetClient (tiers, loadComponent)
server.ts                 defineWidgetServer (check event + handler)
model/
  check-model.ts          named async check action + derived viewState
  recovery-model.ts       recovery capability + RFB lifecycle
  rfb.ts                  RfbLike interface + prod @novnc/novnc adapter
  recovery-transport.ts   RecoveryTransport interface + prod fetch adapter
ui/
  PassportChecker.tsx     tier switch (root component)
  tiers/StandardTier.tsx
  tiers/TinyTier.tsx
  parts/StatusBanner.tsx  success / retryable-error / sessionRequired banners
  RecoveryModal.tsx       portal modal: header, noVNC frame, SSH, footer
  parts/NoVncCanvas.tsx   ref container + RFB mount/unmount glue
  *.module.css
dev/                      standalone harness (as other widgets)
index.html
vite.config.ts
```

The widget package already exists from Subproject 5 with `browser.ts`,
`types.ts`, `browser/`, and `secrets/`. This subproject adds the client, server,
model, and UI without touching the browser task.

### Data flow

```text
PassportChecker (ui)
  | api.invoke('check', {})              typed widget RPC
  v
server.ts check handler
  | context.api.browser.invoke(passportCheckerBrowserTasks.check, {})
  v
browser gateway (SP4) -> browser task (SP5) -> pasport.org.ua
  ^                                        |
  | BrowserGatewayError / result          |
  |----------------------------------------|
  v
check handler maps gateway error -> PublicWidgetError (code + meta)
  v
dispatchWidgetEvent passes PublicWidgetError through unchanged
  v
envelope { error: { code, message, meta } }
  v
makeWidgetApi -> WidgetApiError { code, meta } (structural)
  v
check-model maps to viewState; sessionRequired opens RecoveryModal
  v
RecoveryModal: POST /api/browser/recovery/:widgetId -> WS /api/browser/recovery/socket (SP6)
```

## Generic widget-RPC error-code propagation

This is the one change outside the widget package. It is generic and reusable by
any future browser-backed widget.

### Problem

Today the `browser_session_required` code is lost twice:

1. `dispatchWidgetEvent` wraps **every** handler error in `WidgetHandlerError`
   (`code = 'internal_error'`, `publicMessage = 'Widget event failed'`), so the
   original code and `meta.sshTarget` never leave the server.
2. The client `makeWidgetApi` collapses the envelope `{ code, message }` into a
   single `WidgetApiError.reason` string, so the model cannot narrow on a code or
   read structured meta.

### Design (chosen approach: extend the generic contract)

**Shared (`packages/shared/widgets`).** Introduce a public, coded error base that
a handler may return to signal "surface this to the client verbatim":

```text
class PublicWidgetError extends Error {
  status: number            // HTTP status, default 400
  code: string              // stable machine code
  publicMessage: string     // safe message
  meta?: Record<string, unknown>   // safe structured data (e.g. { sshTarget })
}
```

A handler that returns any **other** `Error` still gets wrapped as
`internal_error` (unchanged behavior). Only `PublicWidgetError` passes through.

**Server dispatch (`packages/server/src/widgets/dispatch.ts`,
`errors.ts`).** After the handler runs, if the returned error
`instanceof PublicWidgetError`, return it as the dispatch result instead of
wrapping it in `WidgetHandlerError`. `PublicWidgetDispatchError` becomes
`WidgetDispatchError | PublicWidgetError`.

**Envelope (`sendWidgetError` in `app.ts`).** Extend the serialized error to
carry optional meta:

```text
{ error: { code, message, meta? } }
```

`meta` is only present for `PublicWidgetError` and only contains
already-safe values.

**Client (`packages/widget-runtime/src/widget-api.ts`).** Extend
`WidgetApiEnvelopeSchema`'s error branch with `meta: z.record(z.unknown()).optional()`.
Give `WidgetApiError` first-class fields:

```text
class WidgetApiError extends taggedError {
  reason: string                    // kept for message/debug
  code?: string                     // server error code, or synthetic:
                                    //   'network' | 'invalid_response'
  meta?: Record<string, unknown>
}
```

Network and envelope-parse failures get synthetic codes (`network`,
`invalid_response`) so the model can always switch on `err.code`.

### Why not the alternatives

- **Passport-specific (encode the error inside a success result):** pushes error
  handling through the success channel, forces manual meta threading, and leaves
  the next browser widget to re-solve the same problem. Rejected.
- **Hybrid (client-only code passthrough, passport-local mapping):** still needs
  the dispatch change to stop erasing the code, so it saves nothing on the server
  and splits the contract. Rejected.

## Passport widget server definition

`server.ts` uses `defineWidgetServer` with one event:

- **`check`** — payload `passportCheckPayloadSchema` (`z.strictObject({})`),
  result `passportCheckResultSchema` (`{ status: int, send_status_msg: string }`),
  reusing the schemas already exported from `types.ts`.

The handler:

1. calls `context.api.browser.invoke(passportCheckerBrowserTasks.check, {})`;
2. on a validated result, returns it (dispatch re-validates against the result
   schema);
3. on a `BrowserGatewayError`, maps it to a `PublicWidgetError` with a stable
   code and safe meta:

| Gateway error                                              | code                       | meta                           | UI view         |
| ---------------------------------------------------------- | -------------------------- | ------------------------------ | --------------- |
| `BrowserTaskRejectedError` code `browser_session_required` | `browser_session_required` | `{ sshTarget }` (when present) | sessionRequired |
| `BrowserTaskRejectedError` code `browser_configuration`    | `browser_configuration`    | —                              | invalidConfig   |
| `BrowserTaskRejectedError` code `upstream_response`        | `upstream_response`        | —                              | retryable error |
| `BrowserTaskRejectedError` code `invalid_checker_response` | `invalid_checker_response` | —                              | retryable error |
| `BrowserAutomationUnavailableError`                        | `browser_unavailable`      | —                              | retryable error |
| `BrowserAutomationDeadlineError`                           | `automation_timeout`       | —                              | retryable error |
| `BrowserAutomationProtocolError`                           | `automation_protocol`      | —                              | retryable error |

`browser_configuration` maps to the **non-retryable** invalidConfig view; every
other non-session error is retryable. The handler never returns raw causes; meta
carries only already-public values (the `sshTarget` originates from the task's
`publicMeta`).

The widget must be registered in the server widget registry via codegen (the
generated `widget-server-list`), the same path other widgets use. Confirm during
implementation that a widget-root `server.ts` is discovered by server codegen; if
the current codegen only wires storage-less widgets implicitly, add the passport
widget to the generated server list.

## Passport widget client definition

`client.ts` uses `defineWidgetClient`:

- `title: 'Паспорт'`, `description: 'Проверка статуса паспорта'`,
  `icon`: a passport glyph from the shared icon map (choose the closest existing
  entry during implementation; the mock uses a passport-booklet outline);
- `defaultSize`: standard-tier friendly (~`{ w: 4, h: 4 }`), `minW/minH` small
  enough to reach the `tiny` tier;
- `tiers`:
  - `tiny`: `{ minWidthPx: 0, minHeightPx: 0 }`
  - `standard`: `{ minWidthPx: 321, minHeightPx: 0 }`
- `loadComponent`: dynamic import of `ui/PassportChecker`.

The RPC event map is typed from the `check` schema so `api.invoke('check', {})`
is fully typed in the UI. Passport is the first widget to call widget RPC;
confirm the `WidgetRuntimeProps.api` reaches the component (it does via
`WidgetFrame` → `hostRuntime.makeWidgetApi`) and that its `Events` generic is
bound to the passport schema.

## Reatom model

All business logic, async orchestration, timers, and error mapping live in
`model/`; `ui/` holds refs and DOM glue only. Follow the repo's known Reatom
pitfalls: do not hoist a single `wrap()` closure (it aborts after reset — call
`wrap(fn)()` fresh per call); pre-create wrapped continuations before `await`
so post-await reads/writes do not hit the global context; use `effect()` inside
connect hooks for dynamic keys because `withConnectHook` is not reactive.

### Check model (`check-model.ts`)

- A named async action `checkPassport` extended with `withAsync`, calling
  `api.invoke('check', {})`. A bounded client-side deadline maps a slow/aborted
  request to the `automation_timeout` view (independent of the server-side
  deadline).
- The submit button stays enabled for native focus/validation, then disables
  while a request is pending to prevent duplicate queue entries.
- A derived discriminated `viewState`:

```text
type ViewState =
  | { kind: 'idle' }
  | { kind: 'pending' }
  | { kind: 'success'; status: number; message: string; checkedAtLabel: string }
  | { kind: 'retryable'; message: string }          // browser_unavailable,
  |                                                 // automation_timeout,
  |                                                 // upstream_response,
  |                                                 // invalid_checker_response,
  |                                                 // automation_protocol
  | { kind: 'invalidConfig' }                        // browser_configuration
  | { kind: 'sessionRequired'; sshTarget: string | null }
```

`checkedAtLabel` is a client-local `HH:MM` stamp of the last successful check,
in-memory only. The mapping switches on `WidgetApiError.code`; an unrecognized
code falls back to a generic retryable message.

### Recovery model (`recovery-model.ts`)

Activated when the user opens the modal from the `sessionRequired` view. Injected
dependencies (both faked in tests):

- `RecoveryTransport.issue(widgetId): Promise<Error | { expiresInMs: number }>` —
  prod adapter does `fetch('/api/browser/recovery/' + widgetId, { method: 'POST', credentials: 'same-origin' })` and maps status codes;
- `createRfb(target, url, opts): RfbLike` — prod adapter wraps
  `new RFB(...)` from `@novnc/novnc`; `RfbLike` exposes `disconnect()` and the
  events `connect` / `disconnect` / `securityfailure`.

Recovery connection state:

```text
type RecoveryState =
  | { kind: 'issuing' }                 // POST in flight
  | { kind: 'connecting'; expiresInMs } // WS opening, RFB not yet connected
  | { kind: 'connected'; expiresInMs }  // RFB connected, canvas live
  | { kind: 'disconnected' }            // WS/RFB dropped -> reconnect re-issues
  | { kind: 'expired' }                 // capability countdown hit 0
  | { kind: 'unavailable' }             // issue() -> 404 recovery_unavailable
  | { kind: 'busy' }                    // issue() -> 409 recovery_busy
  | { kind: 'automationDown' }          // issue() -> 503 automation_unavailable
```

Flow and lifecycle:

1. On open, call `issue(widgetId)`. On `{ expiresInMs }`, build the WS URL from
   `location` (`wss:`/`ws:` + host + `/api/browser/recovery/socket`) and mount
   RFB via `createRfb`; the capability cookie rides the same-origin handshake
   automatically. Start a countdown from `expiresInMs`.
2. `connect` → `connected`; `disconnect` → `disconnected`; `securityfailure` →
   `disconnected` with a distinct log.
3. **Reconnect** (button in the `disconnected`/`expired` frame) re-runs the full
   `issue` + connect flow, because the Subproject 6 capability is single-use and
   is already dead after a disconnect, expiry, or retry.
4. **Retry the check** (footer) tears down RFB + WS, closes the modal, and
   re-invokes `checkPassport`. If still challenged, the widget returns to
   `sessionRequired`.
5. **Close** / Esc / backdrop tears down RFB + WS and closes the modal without
   re-checking.
6. RFB and the WS are torn down on modal unmount via Reatom lifecycle so no
   socket leaks; the teardown must run exactly once per connection (fresh wrapped
   closures, not a hoisted one).

The `issue()` non-success mappings (`unavailable`/`busy`/`automationDown`) reuse
the dark disconnected/expired frame visual with distinct copy — these states are
not drawn in the mockup but follow its treatment.

## UI and visual design

The widget reuses existing myboard tokens; no new design system. Fonts: **Hanken
Grotesk** for UI/headings, **JetBrains Mono** for labels, numbers, the status
code, the access timer, and the SSH command.

### Tokens (from the visual design)

| Role                                       | Value                                                                                          |
| ------------------------------------------ | ---------------------------------------------------------------------------------------------- |
| Accent (primary)                           | `oklch(0.55 0.17 281)`                                                                         |
| Accent soft (icon chip bg)                 | `oklch(0.955 0.032 285)`                                                                       |
| Success / soft / border                    | `oklch(0.55 0.13 155)` / `oklch(0.95 0.05 155)` / `oklch(0.86 0.08 155)`                       |
| Error (retryable) icon / soft / border     | `oklch(0.55 0.21 27)` / `oklch(0.968 0.028 27)` / `oklch(0.88 0.07 27)` (`--destructive-soft`) |
| sessionRequired (amber) bg / border / icon | `oklch(0.96 0.05 80)` / `oklch(0.85 0.1 80)` / `oklch(0.58 0.13 70)`                           |
| Text / secondary / muted                   | `#22232a` / `#5b5e69` / `#9396a0`                                                              |
| Borders                                    | `#e3e4e8` / `#eceef1`                                                                          |
| Surfaces                                   | tile `#fff`, panel `#f5f6f8`, board `#e6e7ea`                                                  |
| noVNC frame                                | bg `#16171d`, border `#2a2c36`                                                                 |

Spacing scale: `6–8` (icon↔text, in-row buttons), `10–12` (banner internals,
footer gaps), `14–16` (standard tile / modal body padding), `18–22` (modal
header/footer padding), `44–56` (section gaps). Radii: `7–9` controls, `10–12`
buttons/banners, `14` tile, `18` modal, `999` pills/dots.

The amber sessionRequired accent deliberately sits outside the success/error
palette (same chroma as success, warm hue) so "needs a human" reads as neither
error nor success.

### Standard tier (≥ 321px wide)

Tile: white, radius 14, padding 16px, shadow. Header row on every state: a 30×30
accent-soft icon chip + "Паспорт" (600/15). Below, per state:

- **idle** — description "Проверка статуса паспорта" (400/13.5); primary button
  "Проверить" with a check glyph (full-width, 40px, radius 11, accent).
- **pending** — 18px accent spinner + "Проверяем…" (500/14); button disabled at
  opacity .4.
- **success** — green soft banner: 30px circle-check + "{send_status_msg}"
  (600/15) + mono "статус {status} · проверено {HH:MM}"; secondary button
  "Проверить снова" with a refresh glyph.
- **retryable error** — red soft banner (`--destructive-soft`): alert icon +
  bold message (600/14) + "Попробуйте ещё раз." (400/12); secondary button
  "Повторить" with a refresh glyph. One layout for all retryable messages; only
  the string changes.
- **invalidConfig** — neutral grey: greyed icon chip, grey banner "Паспорт-чекер
  не настроен" + "Обратитесь к администратору." No action button; a muted footer
  line "действие недоступно · нужна настройка на сервере".
- **sessionRequired** — amber banner: warning triangle + "Требуется вход в
  браузер"; primary button "Открыть восстановление" with a browser-window glyph.

### Tiny tier (< 321px wide)

Tile 150×168-style, padding 14, centered; no description or header row text.

- **idle** — 40px accent-soft icon chip + "Паспорт" (600/12.5); button
  "Проверить" (36px).
- **pending** — 26px spinner + "Проверяем…" (mono 500/11); button disabled.
- **success** — 40px green circle-check + "{send_status_msg}" (2 lines,
  centered); full-width mono chip "СТАТУС {status}".
- **error** — 40px red circle-alert + "ошибка" (mono); button "Повторить".
- **invalidConfig** — greyed icon + "Не настроен"; no button.
- **sessionRequired** — the **whole tile** takes the amber background: 34px
  warning chip + "Требуется вход в браузер" (2 lines); button "Открыть".

### Recovery modal

Self-contained inside the widget package (widgets cannot import
`packages/client/src`; `widget-sdk` has no dialog). Rendered via
`createPortal(document.body)` over the board with a backdrop
`rgba(20,22,40,.45)` + `blur(2px)` — not the browser fullscreen.

- **Sizing / responsive:** desktop dialog 920px wide, height up to
  `min(620px, 90vh)`, radius 18, shadow-lg, centered. `≤ 960px`: width `92vw`.
  `≤ 640px`: fullscreen sheet (radius 0, body stretches, footer sticks to
  bottom). Header and footer are fixed; the body scrolls.
- **Header:** 30px browser-icon chip + "Восстановление сессии браузера"
  (600/15.5) + subtitle "Пройдите проверку в живом окне Chromium"; a
  remaining-time pill "доступ · M:SS" (mono tabular, driven by `expiresInMs`);
  a 32px close (×) button (title "Закрыть (Esc)").
- **Body (panel `#f5f6f8`):** the noVNC frame — `aspect-ratio: 16/9`, dark
  `#16171d`, radius 12, overflow hidden. The 1280×720 canvas scales `contain`
  (fit width, letterbox top/bottom). A pulsing "LIVE · 1280×720" badge top-left;
  a scale caption bottom-right. Connection sub-states rendered inside this frame:
  - `connecting` — spinner + "Подключение…" + "устанавливаем WebSocket к noVNC";
  - `connected` — live canvas + LIVE badge;
  - `disconnected` — red-bordered frame, broken-link icon + "Соединение
    разорвано" + dark "Переподключиться" button;
  - `expired` — timer at "0:00", "Срок доступа истёк" + "Переподключиться";
  - `unavailable` / `busy` / `automationDown` — same dark frame with copy
    "Нет активной сессии для восстановления" / "Восстановление уже идёт" /
    "Сервис автоматизации недоступен".
- **SSH fallback:** a collapsible "Запасной вход по SSH" / "для продвинутых"
  row. Expanded: a short explanation + a dark mono code block with the **real**
  command `ssh -L 6080:127.0.0.1:6080 {sshTarget}` + a copy button + note
  "ssh-цель из конфигурации виджета · тот же одноразовый срок доступа". When
  `sshTarget` is null the SSH section is hidden.
- **Footer:** "Закрыть" (secondary) + "Повторить проверку" (primary, check
  glyph).

### Accessibility

- On open, focus moves into the dialog; a focus-trap cycles Tab through header →
  body → SSH → footer → close. Esc closes (equivalent to "Закрыть"); backdrop
  click closes. On close, focus returns to the "Открыть восстановление" tile
  button.
- While the noVNC canvas holds focus, arrow/typing input goes to RFB, but Esc is
  intercepted by the modal (so the user is never trapped in the canvas).
- Respect the repo note on the Radix nested-dialog dismiss race: the "modal
  open" ref is cleared one tick late rather than via a reactive guard, so a
  single Esc/backdrop dismiss does not also collapse an underlying surface.
- Buttons, status banners, and the live/timer indicators carry accessible labels
  and roles; the retryable/error banners use `role="status"`/`alert`
  appropriately.

## Reconciliation with the visual design

The mockup is authoritative for layout and tokens, with three corrections:

1. **SSH command.** The mock's `ssh -L 5900:localhost:5900 recovery@…` is
   illustrative. The real command forwards noVNC on 6080 to the target from
   `meta.sshTarget`: `ssh -L 6080:127.0.0.1:6080 {sshTarget}` (per the master
   spec and Subproject 6).
2. **invalidConfig copy.** The passport is a server deployment secret; the widget
   has no settings panel. Replace "Задайте параметры в настройках виджета" with
   "Обратитесь к администратору" and the footer "нужна настройка на сервере".
3. **Reconnect + extra issue states.** The capability is single-use, so
   "Переподключиться" re-issues (`POST /recovery/:widgetId`) and opens a fresh
   WS. The `unavailable`/`busy`/`automationDown` issue outcomes are added on top
   of the drawn `disconnected`/`expired` frames.

## Testing strategy

No test contacts the real checker, the real recovery service, or a real RFB.

- **Generic widget-RPC change:** `dispatchWidgetEvent` returns a
  `PublicWidgetError` unchanged and still wraps other errors as `internal_error`;
  the envelope includes `meta`; the client `makeWidgetApi` exposes structural
  `code`/`meta` and synthesizes `network`/`invalid_response` codes.
- **Server handler:** each `BrowserGatewayError` maps to the right code/meta;
  success passes through; no raw cause or secret leaks into the public error.
- **Check model (Reatom + fake gateway):** idle → pending → success; every error
  code → its view state; client deadline → `automation_timeout`; duplicate submit
  is prevented while pending; unrecognized code → generic retryable.
- **Recovery model (fake `RecoveryTransport` + fake `createRfb`):** issue success
  → connecting → connected; disconnect → disconnected → reconnect re-issues;
  countdown → expired; 404/409/503 → unavailable/busy/automationDown; retry tears
  down and re-checks; unmount tears down exactly once (no leak, no post-reset
  abort).
- **Components (jsdom):** each tier renders each state; the sessionRequired tile
  exposes the open action in both tiers; opening the modal mounts the canvas
  container and wires RFB lifecycle (RFB faked); SSH section hidden when
  `sshTarget` is null.
- **Contract:** `check` payload/result schema round-trip.
- **Accessibility:** focus moves in on open and returns on close; Tab is trapped;
  Esc/backdrop close; banner roles/labels present.

## Dependencies

Subprojects 4 (browser gateway), 5 (passport task), and 6 (recovery transport).
All are merged or in review; the widget consumes their public contracts as-is.

## Risks and mitigations

- **First widget to use RPC / a portal modal.** Verify the `api` plumbing and the
  server-registry codegen path early; build the modal once, locally, and keep it
  extractable to `widget-sdk` later (YAGNI now).
- **Reatom lifecycle leaks around RFB/WS.** Bind teardown to atom connection with
  freshly-wrapped closures; assert single teardown in tests.
- **noVNC bundle in a federation remote.** `@novnc/novnc` bundles into the remote,
  self-contained, no CDN; keep it out of the federation singletons.
- **Capability race / reuse.** Treat every disconnect/expiry as terminal for the
  capability; reconnect always re-issues; never reuse a token.
- **Secret leakage.** The client sends an empty payload, renders only
  `status`/`send_status_msg`, and never receives the passport identity.
