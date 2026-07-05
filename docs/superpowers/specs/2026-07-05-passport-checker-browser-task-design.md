# Passport Checker Browser Task Design

**Date:** 2026-07-05
**Status:** Approved
**Parent design:** [Passport Checker and Browser Automation Runtime Design](./2026-07-03-passport-checker-browser-automation-design.md)

## Goal

Implement the `passport-checker/check` browser task as the first production
consumer of the browser-automation runtime. The task reads one preconfigured
Ukrainian passport booklet from scoped runtime secrets, performs the fixed
same-origin checker request in persistent Chromium, validates the response, and
returns only the checker status and message.

This subproject also closes three integration gaps discovered during
brainstorming: browser-only widget packages must not require a client entrypoint,
widget-owned task errors need a cycle-free shared base, and a detected challenge
page must remain open for manual recovery rather than being closed at task
release.

## Scope

This subproject includes:

- a browser-only `packages/widgets/passport-checker` workspace package;
- shared request/result schemas and the root `browser.ts` definition;
- a production definition with a fixed checker URL and a test-only definition
  factory for local fixtures;
- scoped passport secret loading and format validation;
- navigation, evidence-based Cloudflare challenge classification, same-origin
  `FormData` submission, and checker-response validation;
- typed task-domain errors with safe public envelopes;
- optional client entrypoints in widget discovery;
- retained recovery-page lifecycle in the Chromium executor;
- fast unit/contract tests and opt-in real-Chromium tests against a local
  fixture server.

It excludes:

- a widget server RPC handler;
- Reatom state, React UI, or a client federation build;
- recovery tokens, WebSocket proxying, and embedded noVNC;
- automatic retry or automatic Cloudflare challenge solving;
- live calls to `pasport.org.ua` from tests or CI;
- ID cards, foreign passports, multiple documents, and configurable checker
  services.

## Approved Amendments to Earlier Subprojects

### Browser-only widget packages

The client generator currently treats every package-bearing widget directory as
a client widget and fails if `client.ts` is missing. That prevents the passport
task from landing independently of its later UI.

Client codegen is refined to keep only discovered widget packages that contain a
root `client.ts`. Port assignment, client metadata import, catalog output, and
icon output operate on that filtered list. A package with `browser.ts` but no
`client.ts` is therefore valid and invisible to the client catalog. A present but
invalid `client.ts` remains an error. Server and browser discovery retain their
existing optional-entrypoint behavior.

This change establishes a consistent multi-entry package model: `client.ts`,
`server.ts`, and `browser.ts` are independently optional, while a package may
provide any meaningful combination of them.

### Shared browser-task error base

Widget-owned task errors must extend the service-recognized `BrowserTaskError`
for stable `code`, `publicMessage`, and `publicMeta` serialization. Importing a
runtime class from `browser-automation` back into a widget would create a package
cycle because browser-automation already bundles generated widget entrypoints.

The lightweight base moves to a Playwright-free shared module under
`packages/shared/browser-automation/`. Browser-automation imports and re-exports
the base for compatibility; its existing core errors continue to extend it. The
passport package imports the shared base directly and owns its domain subclasses.
`toEnvelopeError` continues to serialize only recognized subclasses and never
their cause chains.

### Retained recovery pages

The existing executor closes every task page at release. A challenge task needs
to leave its page visible in the persistent Xvfb display so an operator, and the
later embedded recovery client, can interact with the exact Chromium profile that
received the challenge.

`BrowserTaskContext` gains `retainPageForRecovery(): void`. Calling it marks the
current managed page; normal release removes the abort listener and active-task
accounting but keeps that page open. The executor retains at most one recovery
page per widget ID. The next acquire for the same widget closes the previous
recovery page before opening a fresh task page. Acquires for other widgets do not
discard it.

Abort and timeout always win over retention and close the page. Browser shutdown
closes the persistent context and all retained pages. This refinement does not
change the FIFO queue contract, add an automatic retry, or make a challenge fail
service health.

## Package Structure

The browser-only package has no `client.ts`, `server.ts`, Vite federation config,
or UI dependencies in this subproject.

```text
packages/widgets/passport-checker/
├── package.json
├── tsconfig.json
├── vitest.config.ts
├── types.ts
├── browser.ts
└── browser/
    ├── challenge.ts
    ├── check.ts
    ├── errors.ts
    ├── check.test.ts
    └── check.integration.test.ts
```

`types.ts` owns schemas that later client and server entrypoints can reuse without
importing browser implementation code. `browser.ts` is a thin production
entrypoint. Browser-specific orchestration, classification, and errors stay under
`browser/`.

The package has only test and typecheck scripts until the user-facing widget is
added. Browser codegen discovers `browser.ts`; client and server codegen omit the
package.

Reatom is intentionally absent because this subproject contains no reactive
state or React integration.

## Task Contract

The generated dispatch key is `(passport-checker, check)`. The client-visible
task ID is therefore `passport-checker/check`, but neither identity component is
accepted from request input.

The payload schema accepts exactly an empty object and rejects unknown keys. This
prevents a caller from smuggling a document identity or a target URL through the
otherwise empty task request.

The result schema accepts:

```text
{
  status: integer,
  send_status_msg: string
}
```

Unknown checker fields are not returned. The shared schema is the sole source for
handler validation now and server/client typing in later subprojects.

## Definition Factory and Fixed Production Target

The root entrypoint default-exports a definition built with:

```text
checkerUrl = https://pasport.org.ua/solutions/checker
recoverySshTarget = validated AUTOMATION_SSH_TARGET or null
```

An internal factory accepts those two dependencies so integration tests can use
a local fixture origin. The factory is source-level dependency injection only:
neither URL nor SSH target is accepted by the browser HTTP protocol, task
payload, widget RPC, or a general runtime environment override. Production
therefore remains a single reviewed allowlisted flow rather than an arbitrary
browser API.

`AUTOMATION_SSH_TARGET` is optional fallback metadata for the existing SSH/noVNC
recovery path. It is normalized and validated before it can enter public error
metadata. The later embedded-recovery subproject becomes the primary LAN flow but
does not remove the SSH fallback.

## Secret Loading and Validation

The handler reads `series` and `number` once through the widget-scoped secret
reader. Those calls resolve to:

```text
<secretsDir>/passport-checker_series
<secretsDir>/passport-checker_number
```

Validation rules are fixed:

- `series`: exactly two uppercase letters from the Ukrainian Cyrillic alphabet;
- `number`: exactly six ASCII digits (`0` through `9`).

Missing and malformed values both return `BrowserConfigurationError`. Public
messages do not reveal which value was present, its length, its characters, or
the raw validation issue. The successfully validated strings live only in local
task variables and as the argument to the page-context submission function.

## Checker Execution Flow

The handler executes one linear errors-as-values flow:

1. Read and validate both scoped secrets.
2. Navigate the fresh task page to the configured checker URL and wait for
   `domcontentloaded`.
3. Classify the navigation response and loaded page for positive Cloudflare
   challenge evidence.
4. If challenged, mark the page for recovery and return
   `BrowserSessionRequiredError`.
5. In the loaded page, create `FormData` with exactly:
   - `service=1`;
   - `doc_1_select=1`;
   - `doc_1_series=<validated series>`;
   - `doc_1_number6=<validated number>`.
6. Execute `fetch('/solutions/checker', { method: 'POST', body: formData })`.
   The browser generates the multipart boundary and automatically supplies the
   persistent profile's cookies, referrer, user agent, and browser metadata.
7. Convert the page-context response to a small discriminated outcome.
8. Map an error outcome to a task-domain error, or validate and return the
   successful data with the shared result schema.

There is no task-level retry. Queue or execution deadlines remain owned by the
service core. Closing the page on abort interrupts pending Playwright work and
the service returns its existing `AutomationTimeoutError`.

## Challenge Classification

HTTP status alone is insufficient: a normal upstream 403, 429, or 503 does not
necessarily require manual browser attention. Conversely, relying only on one
DOM selector would miss a challenge returned specifically to the POST.

The classifier requires positive Cloudflare evidence from a combination of:

- a Cloudflare challenge URL or `/cdn-cgi/challenge-platform` reference;
- known challenge form or running-challenge DOM markers;
- known challenge titles such as `Just a moment`;
- a suspicious response status combined with Cloudflare response headers such
  as `server: cloudflare` or `cf-ray` and challenge-shaped content.

Marker matching is case-insensitive where appropriate and is isolated in a pure
classifier so fixtures can cover additions without changing task orchestration.
A cross-origin redirect or non-success response without positive challenge
evidence is an upstream error, not a session-required error.

Navigation challenges already occupy the visible page and are retained directly.
If the same-origin POST returns a confirmed challenge, page-context code returns
only the `session_required` discriminator; it does not return the challenge body
to Node. Before retention, the handler navigates the visible tab back to the
checker URL with GET so the browser-attention surface is present without
automatically repeating the document POST. The operator or later embedded
recovery client works in that retained tab, and only an explicit caller retry
submits the document again.

## Page-Context Response Boundary

The page-context submission returns exactly one of these internal outcomes:

```text
success(data)
session_required
upstream_error(status)
invalid_json
```

For a success response, only the parsed JSON value crosses the Playwright
boundary and is then validated in Node. For error responses, the body is
inspected only inside the remote page as needed for challenge classification and
is discarded. Raw HTML, invalid JSON text, request bodies, response bodies, and
passport values are never returned from `page.evaluate` or placed in an error.

Failures of `page.goto`, `page.evaluate`, or browser `fetch` are converted at the
lowest uncontrolled boundary to typed errors with their original cause. The
happy path uses flat `instanceof Error` early returns following the repository's
errore convention.

## Error Model

All expected domain failures extend the shared `BrowserTaskError` and travel
through the existing service envelope without a dispatcher special case.

| Class                         | Code                       | Safe public metadata                       |
| ----------------------------- | -------------------------- | ------------------------------------------ |
| `BrowserConfigurationError`   | `browser_configuration`    | none                                       |
| `BrowserSessionRequiredError` | `browser_session_required` | validated `sshTarget` when configured      |
| `UpstreamResponseError`       | `upstream_response`        | `phase` and optional numeric HTTP `status` |
| `InvalidCheckerResponseError` | `invalid_checker_response` | none                                       |

`phase` is a closed safe value such as `navigation` or `submission`. Network and
Playwright failures map to `UpstreamResponseError`; invalid JSON and result-schema
failures map to `InvalidCheckerResponseError`. Missing or malformed deployment
secrets map to `BrowserConfigurationError`.

The service's existing `AutomationTimeoutError`, gateway-owned
`BrowserUnavailableError`, and generic `internal` behavior remain unchanged.
Unexpected thrown errors are still wrapped as internal handler failures. Domain
handlers return expected errors as values.

## Redaction and Data Lifetime

The task observes stricter rules than ordinary browser tasks:

- request payload is a strict empty object;
- secret values are read fresh per invocation and are not cached;
- no log includes the task payload, request body, response body, secret value,
  or page-evaluation argument;
- no error message template interpolates a secret or upstream body;
- screenshots, traces, videos, and HAR recording remain disabled;
- the task stores no result or identity in Valkey, IndexedDB, widget storage,
  local storage, session storage, or browser history;
- the same-origin `fetch` request body is not represented by visible DOM fields;
- only Chromium's normal session state, such as Cloudflare cookies, persists in
  the browser profile.

Tests use distinctive fake series and number sentinels and assert their absence
from serialized errors, service envelopes, logger calls, snapshots, and generated
artifacts.

## Testing Strategy

### Client-codegen regression tests

- omit a package that has `browser.ts` but no `client.ts` from the client catalog;
- do not allocate a client development port to that package;
- continue importing and validating packages that do provide `client.ts`;
- continue failing for a present but malformed client definition;
- keep browser and server discovery unchanged.

### Shared error and executor tests

- recognize widget-owned subclasses through the shared error base;
- serialize stable code, message, and safe metadata without causes;
- retain a marked page after normal release;
- close ordinary pages;
- close a previous retained page on the next same-widget acquire;
- leave another widget's retained page intact;
- force-close a retained-marked page on abort/timeout;
- close all retained pages during shutdown.

### Fast passport task tests

Focused fakes and pure classifier tests cover:

- missing, malformed, and valid secrets;
- strict empty payload and exact result schema;
- navigation challenge signals and non-challenge error statuses;
- POST success, challenge, non-success, invalid JSON, and schema mismatch;
- domain error mapping and safe metadata;
- no automatic POST retry;
- secret-sentinel absence from every observable output.

### Opt-in real-browser fixture tests

With `BROWSER_IT=1`, a local HTTP fixture server and real Chromium cover:

- a normal checker GET followed by same-origin POST;
- browser-generated `multipart/form-data` content type and boundary;
- exact field names and values from injected fake scoped secrets;
- valid success parsing;
- navigation and POST challenge fixtures;
- non-success HTTP responses;
- invalid JSON and schema mismatch;
- absence of any request to `pasport.org.ua`;
- absence of fake passport values from logs, errors, and test artifacts.

The real-browser suite is opt-in because it requires an installed Chromium and a
display/Xvfb. A successful opt-in run is nevertheless a completion gate for this
subproject, normally executed in the existing browser container or on a
headed-capable development host.

## Verification Gates

- focused codegen, shared, executor, and passport-package tests;
- passport package and browser-automation typechecks;
- browser codegen emits exactly the passport widget definition in the generated
  widget list (the composed runtime registry also retains built-in diagnostics);
- browser-automation production build bundles the generated widget entrypoint;
- workspace `pnpm check`;
- one successful `BROWSER_IT=1` local-fixture run.

No verification command contacts the real checker.

## Success Criteria

- The browser-only passport package participates in browser codegen without
  appearing in client catalog, client ports, or server registry.
- The task accepts no document or URL input and submits exactly the four fixed
  form fields from scoped secrets.
- Real Chromium generates the multipart request against a local same-origin
  fixture and the validated checker result contains only `status` and
  `send_status_msg`.
- Positive Cloudflare evidence returns `browser_session_required`, retains a
  visible recovery page, and does not fail process health.
- Ordinary upstream and invalid-response failures remain distinguishable from
  session recovery.
- Timeout, retry, release, and shutdown page lifecycles are deterministic.
- Passport sentinels do not appear in serialized errors, envelopes, logs,
  snapshots, traces, generated files, or persisted application state.

## Deferred Work and Delivery Update

The next subproject is a dedicated tokenized recovery transport. It will expose
the retained Xvfb/noVNC session to the trusted local-network board through a
short-lived, single-use capability and a temporary same-origin WebSocket. The
existing SSE connection may report low-frequency recovery state but does not
carry RFB frames or input. The VNC port remains non-public, and SSH forwarding
remains an operational fallback.

The user-facing passport widget follows that recovery transport and consumes the
stable `browser_session_required` error without changing this task contract. The
final Raspberry Pi rollout then verifies the assembled eight-subproject delivery.
