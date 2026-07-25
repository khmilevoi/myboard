# Widget user-input detection — design

Date: 2026-07-26
Branch: `feat/passport-checker-widget`

## Problem

A browser task sometimes cannot finish without a human: the site serves a
Cloudflare challenge, and someone has to solve it in the live browser over
noVNC. Today the whole mechanism for reaching that state lives inside
`packages/widgets/passport-checker/`, hand-assembled at every call site.

`BrowserTaskContext` gives a widget exactly one platform primitive —
`retainPageForRecovery()` — which marks the page as retained. Everything else is
the widget's own code:

- `collectNavigationEvidence` in `browser/check.ts` probes the DOM for
  Cloudflare markers (`#challenge-form`, `script[src*="/cdn-cgi/challenge-platform/"]`,
  `cf-chl-`) and reads `status` / `server` / `cf-ray` off the navigation response.
- `isCloudflareChallenge` in `browser/challenge.ts` is the pure predicate over
  that evidence.
- `BrowserSessionRequiredError` in `browser/errors.ts` carries
  `code = 'browser_session_required'` and `publicMeta = { sshTarget }`.
- `browser.ts` parses `AUTOMATION_SSH_TARGET` out of `process.env` and validates
  it with `normalizeRecoverySshTarget`.

Four consequences:

1. **The helper is not reusable.** `challenge.ts` sits in a widget package.
   Widget packages have no `exports` map, so a second widget could only reach it
   through a widget-to-widget dependency.
2. **The helper is cut in half.** The predicate is in `challenge.ts`; the probe
   that feeds it is in `check.ts`. Only the predicate is portable.
3. **There is no single entry point.** Each site hand-assembles four steps —
   collect evidence, run the predicate, retain the page, construct the error —
   and each step can be got wrong independently. Forgetting
   `retainPageForRecovery()` produces an error the UI understands with no page
   behind it; retaining without returning the error strands a browser page.
4. **The canonical error is widget-local**, although its `code` is a platform
   contract that `server.ts`, `model/check-model.ts` and the entire noVNC flow
   key off. A second widget needing manual input would have to duplicate it
   byte for byte.

## Goals

- The handler passed to `defineWidgetBrowser` receives a function that invokes
  the detection, instead of assembling it.
- The Cloudflare check becomes a helper any widget can reuse — probe and
  predicate together, not just the predicate.
- Retaining the page and returning the canonical error become one indivisible
  operation owned by the platform.
- Delete the `PASSPORT_FORCE_RECOVERY` lever.

## Decisions

| # | Question | Decision |
|---|----------|----------|
| 1 | Shape of the mechanism | The platform runs a detector the widget passes in (`context.detectUserInput(detector)`), rather than the widget detecting on its own or detectors being registered declaratively. |
| 2 | Reaching the third call site (evidence derived inside the page from a POST body) | A detector is a plain function `(page) => Promise<Error \| boolean>`; the helper ships two factories — one that probes the page, one that closes over already-collected evidence. |
| 3 | Preparing the page before escalating | `detectUserInput` takes an optional `prepare` hook, invoked only after the detector matched and before the page is retained. |
| 4 | Probe failure | The platform returns its own `UserInputProbeError`; the widget no longer maps it into `UpstreamResponseError`. |

Declarative registration (detectors run automatically after each navigation) was
rejected: the post-submit call site evaluates evidence computed inside the page
from a `fetch` response body, which no automatic post-navigation hook can reach.
It would have required keeping a manual path alongside the automatic one — two
mechanisms instead of one.

Dropping the post-submit path entirely (re-navigate and re-run the DOM detector
instead) was rejected too: the decision would then be made from a fresh `GET`
rather than the actual `POST` response, and a challenge issued specifically on
the `POST` may not reproduce, turning a recoverable session into a bare
`upstream_response`.

## Architecture

### New — `packages/browser-automation/src/user-input/`

`detector.ts`

```ts
export type UserInputDetector = (page: Page) => Promise<Error | boolean>

export type DetectUserInputOptions = {
  /** Runs only after the detector matched, before the page is retained. */
  prepare?: (page: Page) => Promise<unknown>
}
```

`errors.ts` — both built with `errore.createTaggedError` on top of
`BrowserTaskError`, matching the existing vocabulary in
`packages/browser-automation/src/errors.ts`:

- `UserInputRequiredError` — `code = 'browser_session_required'`,
  `publicMeta = { sshTarget }` when a target is configured.
- `UserInputProbeError` — `code = 'user_input_probe'`, carries the detector's
  error as `cause`.

`cloudflare.ts` — the reusable helper (below).

### Changed

- `src/browser/context.ts` — `BrowserTaskContext` gains `detectUserInput` and
  **loses `retainPageForRecovery`**. The retain flag stays an internal field of
  `ManagedBrowserTaskContext`, settable only through `detectUserInput`. This is
  the point of the design: the two halves cannot be separated because only one
  of them is exposed.
- `src/browser/chromium-executor.ts` — builds `detectUserInput` into the managed
  context; takes a new `recoverySshTarget` dependency.
- `src/config.ts` — parses and validates `AUTOMATION_SSH_TARGET`;
  `normalizeRecoverySshTarget`'s regex moves here.
- `src/index.ts` — passes `config.recoverySshTarget` to the executor.
- `src/testing/fake-executor.ts` — same context shape, with a recording
  `detectUserInput` for widget tests.
- `packages/browser-automation/package.json` — new export subpaths
  `./user-input` and `./user-input/cloudflare`.

### Removed from the widget

`browser/challenge.ts`; `collectNavigationEvidence` from `browser/check.ts`;
`BrowserSessionRequiredError` from `browser/errors.ts`;
`normalizeRecoverySshTarget` and the `recoverySshTarget` / `forceRecovery`
options from `browser.ts`. The widget stops importing anything recovery-related
and only calls the context method.

`browser/errors.ts` keeps `BrowserConfigurationError`, `UpstreamResponseError`
and `InvalidCheckerResponseError`.

## Contract

```ts
detectUserInput(
  detector: UserInputDetector,
  options?: DetectUserInputOptions,
): Promise<UserInputProbeError | UserInputRequiredError | null>
```

Ordered semantics:

1. Call `detector(page)`.
2. Detector returned an `Error` → wrap it in `UserInputProbeError({ cause })` and
   return. **The page is not retained** — the probe broke, so whether a challenge
   exists is unknown, and holding a browser page open for a recovery nobody will
   perform is worse than failing.
3. Detector returned `false` → return `null`. Nothing is touched.
4. Detector returned `true` → run `options.prepare?.(page)` if given; a failure
   there is caught, logged with `console.warn`, and does **not** cancel the
   escalation. Then raise the internal retain flag and return
   `new UserInputRequiredError({ sshTarget })`.

`sshTarget` is supplied by the executor from service config. The widget never
sees it and cannot supply a wrong one.

Cancellation needs no new handling: `releaseManagedContext` already gates
retention on `context.retained && !context.signal.aborted`, so a retain raised
after the task was aborted never reaches `retainedPages`. Repeat calls are
idempotent — the flag is a boolean.

A failed `page.goto` still produces the widget's own
`UpstreamResponseError({ phase: 'navigation' })`; that is about `pasport.org.ua`
being unreachable and stays widget business. Only *probe* failure changes shape.

## The Cloudflare helper

`browser-automation/user-input/cloudflare` exports five things — three move
unchanged, two are new:

```ts
export type ChallengeEvidence = { url, title, status, server, cfRay,
  hasChallengeForm, hasChallengePlatform, hasChallengeContent }

export function isCloudflareChallenge(evidence: ChallengeEvidence): boolean
export function evidenceFromResponseText(input): ChallengeEvidence

export function makeCloudflarePageDetector(navigation: Response | null): UserInputDetector
export function makeCloudflareEvidenceDetector(evidence: ChallengeEvidence): UserInputDetector
```

`makeCloudflarePageDetector` absorbs `collectNavigationEvidence` whole — the
`page.evaluate` DOM probe plus `status` / `server` / `cf-ray` from the navigation
`Response` — and runs the predicate. A rejection from `page.evaluate` or
`allHeaders()` is returned as an `Error`, which the platform converts into
`UserInputProbeError`.

`makeCloudflareEvidenceDetector` is `async () => isCloudflareChallenge(evidence)`;
the page argument is ignored.

Two constraints survive the move:

1. **`evidenceFromResponseText` stays pure and self-contained.** Its source text
   is spliced into Chromium through `Function.prototype.toString()` by
   `submitPassportInPage` in `browser/check.ts`, because Playwright serializes
   `page.evaluate` callbacks by source alone and cannot close over a Node-side
   import. It crosses a package boundary but not a bundle boundary — the service
   is one rspack pass — so the risk is unchanged, not new. Nothing may be hoisted
   out of it.
2. **The local `window` / `document` declarations move with the probe.**
   `browser-automation` also compiles without the DOM lib, so the same
   module-local declaration trick is needed there for the same reason.

## The widget afterwards

```ts
const navigationEscalation = await context.detectUserInput(
  makeCloudflarePageDetector(navigation),
)
if (navigationEscalation instanceof Error) return navigationEscalation

if (navigation && !navigation.ok()) {
  return new UpstreamResponseError({ phase: 'navigation', status: navigation.status() })
}

// ... submit ...

const submissionEscalation = await context.detectUserInput(
  makeCloudflareEvidenceDetector(outcome.evidence),
  { prepare: (page) => page.goto(options.checkerUrl, { waitUntil: 'domcontentloaded' }) },
)
if (submissionEscalation instanceof Error) return submissionEscalation
```

Two call sites, not three: the third was the `forceRecovery` branch, deleted
below. `model/check-model.ts` gains one line —
`user_input_probe: 'Не удалось проверить состояние браузера'` in
`RETRYABLE_MESSAGES`, so the new code does not fall back to the generic message.

## Removing `PASSPORT_FORCE_RECOVERY`

Commit `45c604f1` added an env-gated lever that forced one trip through the
recovery path per service start. It is removed: `isForcedRecoveryEnabled` and its
doc block from `browser.ts`, the option, latch and branch from `browser/check.ts`,
`PASSPORT_FORCE_RECOVERY` from `docker-compose.yml`, the commented line from
`.env.dev.example`, and the five tests covering it.

Accepted consequence: there is no longer an on-demand way to reach the recovery
branch on the Raspberry Pi. Subproject 8's acceptance item "embedded noVNC
Cloudflare recovery … smoke test on the Raspberry Pi" stays unmet and will need
another answer.

## Commits

1. Remove `forceRecovery` — a clean revert of `45c604f1`, so the history shows
   the lever was retired deliberately rather than dissolved into a refactor.
2. The refactor itself.

## Testing

Platform (`packages/browser-automation`):

- `src/user-input/cloudflare.test.ts` — the existing `isCloudflareChallenge` and
  `evidenceFromResponseText` tests move here from
  `widgets/passport-checker/browser/check.test.ts`, including the unit-level
  splice guard that reconstructs the function via
  `new Function('return ' + toString())`. New tests cover both detector
  factories.
- Ordering contract, point by point: probe error → `UserInputProbeError` and the
  page is **not** retained; `false` → `null` and nothing touched; `true` →
  `prepare` ran before retention; `prepare` failure → escalation happens anyway;
  `prepare` not called when the detector did not match.
- `chromium-executor.test.ts` — `detectUserInput` actually raises the flag, and
  `hasRetainedPage` reports `true` after release.
- `testing/fake-executor.ts` — recording `detectUserInput` for widget tests.

Widget (`packages/widgets/passport-checker`):

- `browser/check.test.ts` stops mocking `page.evaluate` for evidence and asserts
  only its own concerns: which detector was passed, that the submit site supplies
  `prepare`, and that the returned error passes through untouched.
- `browser/check.integration.test.ts` retargets its
  `BrowserSessionRequiredError` import to the platform's
  `UserInputRequiredError`.

Gate: `pnpm check`, plus **one run of the integration suite with `BROWSER_IT=1`**.
That suite is `describe.skipIf(!run)` and skipped by default. The unit splice
guard catches "someone edited the function and broke its purity"; only the real
Chromium run catches "the function moved to another package and the bundler
treated its source differently", which is precisely this change's risk. The
`BROWSER_IT=1` run is an acceptance requirement here, not an option.

## Risks and constraints

- **`'browser_session_required'` moves byte for byte.** `passport-checker/server.ts`
  (409), `model/check-model.ts` (`kind: 'sessionRequired'`) and the noVNC flow key
  off it, and `publicMeta.sshTarget` must keep its name or the UI loses the SSH
  fallback. Verification: `server.ts` and every `ui/` file stay untouched, and the
  only edit to `check-model.ts` is the new `user_input_probe` entry added to
  `RETRYABLE_MESSAGES` — its `browser_session_required` branch and the
  `sessionRequired` view state are not touched. Any edit beyond that means the
  contract has moved — stop.
- **An invalid `AUTOMATION_SSH_TARGET` must not kill the service.**
  `loadBrowserServiceConfig` failures reach `process.exit(1)` in `index.ts`.
  Today an invalid value silently becomes `null` via the widget's regex. Preserve
  that: fails the regex → `null`, never a `BrowserServiceConfigError`. Otherwise a
  typo in `.env` takes down browser automation.
- **No `docker-compose.yml` change for `AUTOMATION_SSH_TARGET`.** It is already
  declared on the `browser-automation` service, and the widget's `browser.ts`
  executes inside that same process — it was reading that same variable all along.

## Also in scope

A short section in `packages/browser-automation/README.md` on how a new widget
requests manual input.

## Out of scope

- Any change to the recovery UI, the noVNC transport, or the capability flow.
- Detectors for anything other than Cloudflare.
- Replacing the removed on-demand trigger for the Pi recovery smoke test.
