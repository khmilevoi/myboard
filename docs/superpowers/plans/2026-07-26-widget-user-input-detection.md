# Widget User-Input Detection Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Move the "a human must act on this browser session" mechanism out of the passport-checker widget and into the automation platform, so the handler receives a function that runs the check and Cloudflare detection becomes a helper any widget can reuse.

**Architecture:** `BrowserTaskContext` gains `detectUserInput(detector, options?)`. It runs a widget-supplied detector against the live page, and on a match optionally prepares the page, retains it, and returns the canonical `UserInputRequiredError` — one indivisible step. `retainPageForRecovery` then leaves the public context entirely, so the two halves cannot be separated. Cloudflare ships as `browser-automation/user-input/cloudflare` with probe and predicate together.

**Tech Stack:** TypeScript, pnpm workspace, Vitest, Playwright, Zod, `errore` (errors as values), oxlint + oxfmt.

**Spec:** `docs/superpowers/specs/2026-07-26-widget-user-input-detection-design.md`

**Worktree:** `C:\Users\Khmil\JsProjects\myboard\.worktrees\passport-checker-widget`, branch `feat/passport-checker-widget`. All commands run from that directory.

## Global Constraints

- **`'browser_session_required'` moves byte for byte.** `packages/widgets/passport-checker/server.ts`, `packages/widgets/passport-checker/model/check-model.ts` and the noVNC recovery UI key off this exact string, and the public meta key must stay `sshTarget`. No file under `packages/widgets/passport-checker/ui/` and no line of `server.ts` may be edited by this plan. The only permitted edit to `check-model.ts` is adding a `user_input_probe` entry to `RETRYABLE_MESSAGES`.
- **An invalid `AUTOMATION_SSH_TARGET` must never fail config loading.** `loadBrowserServiceConfig` errors reach `process.exit(1)` in `src/index.ts`. A value that fails validation degrades to `null`; it never produces a `BrowserServiceConfigError`.
- **`evidenceFromResponseText` stays pure and self-contained.** Its source text is spliced into Chromium via `Function.prototype.toString()`. No module-scope constant, no import, no helper may be referenced from inside it — a free identifier makes the spliced copy throw `ReferenceError` in the page.
- **No DOM lib.** `browser-automation` compiles Node-only. `page.evaluate` callbacks that touch `window`/`document` need module-local `declare const` declarations, copied from `packages/widgets/passport-checker/browser/check.ts`.
- **errore, not exceptions.** Functions return `Error | T` unions and callers narrow with `instanceof`. Never `throw` for control flow.
- **Factories are named `make*`**, never `create*`.
- Formatting is `oxfmt`; run `pnpm format` before committing if `pnpm format:check` complains.

---

## File Structure

**Created**

| File | Responsibility |
|---|---|
| `packages/browser-automation/src/user-input/detector.ts` | The `UserInputDetector` and `DetectUserInputOptions` types. Types only. |
| `packages/browser-automation/src/user-input/errors.ts` | `UserInputRequiredError`, `UserInputProbeError`. |
| `packages/browser-automation/src/user-input/errors.test.ts` | Error-contract tests. |
| `packages/browser-automation/src/user-input/detect.ts` | `makeDetectUserInput` — the escalation semantics (detect → prepare → retain → error), independent of Chromium. |
| `packages/browser-automation/src/user-input/index.ts` | Public barrel for `browser-automation/user-input`. |
| `packages/browser-automation/src/user-input/cloudflare.ts` | Cloudflare evidence type, predicate, response-text derivation, and the two detector factories. |
| `packages/browser-automation/src/user-input/cloudflare.test.ts` | Everything about Cloudflare, including the splice guard. |

**Modified**

| File | Change |
|---|---|
| `packages/browser-automation/src/browser/context.ts` | `detectUserInput` in, `retainPageForRecovery` out. |
| `packages/browser-automation/src/browser/chromium-executor.ts` | Implements `detectUserInput`; optional `recoverySshTarget` dep. |
| `packages/browser-automation/src/config.ts` | Reads and normalizes `AUTOMATION_SSH_TARGET`. |
| `packages/browser-automation/src/index.ts` | Threads `recoverySshTarget` into the executor. |
| `packages/browser-automation/package.json` | Two new export subpaths. |
| `packages/browser-automation/README.md` | Operator/author section on requesting manual input. |
| `packages/widgets/passport-checker/browser.ts` | Loses the forced-recovery lever and the ssh-target parsing. |
| `packages/widgets/passport-checker/browser/check.ts` | Loses `collectNavigationEvidence` and the manual escalation pairs. |
| `packages/widgets/passport-checker/browser/errors.ts` | Loses `BrowserSessionRequiredError`. |
| `packages/widgets/passport-checker/model/check-model.ts` | One new `RETRYABLE_MESSAGES` entry. |
| `docker-compose.yml`, `.env.dev.example` | Lever env removed. |

**Deleted**

| File | Reason |
|---|---|
| `packages/widgets/passport-checker/browser/challenge.ts` | Moved to `browser-automation/src/user-input/cloudflare.ts`. |

---

## Task 1: Remove the forced-recovery lever

Reverts commit `45c604f1`. This is deletion work, so the cycle is inverted: remove the tests that assert the behaviour, prove the rest of the suite still passes, then remove the code and prove nothing else referenced it.

**Files:**
- Modify: `packages/widgets/passport-checker/browser.ts`
- Modify: `packages/widgets/passport-checker/browser.test.ts`
- Modify: `packages/widgets/passport-checker/browser/check.ts`
- Modify: `packages/widgets/passport-checker/browser/check.test.ts`
- Modify: `docker-compose.yml:95`
- Modify: `.env.dev.example:46`

**Interfaces:**
- Consumes: nothing.
- Produces: `PassportCheckHandlerOptions` narrows to `{ checkerUrl: string; recoverySshTarget: string | null }`; `makePassportCheckerBrowser` takes the same two fields. `isForcedRecoveryEnabled` no longer exists.

- [ ] **Step 1: Delete the five lever tests**

In `packages/widgets/passport-checker/browser.test.ts`, delete this whole `it` block:

```ts
  it('enables the forced recovery lever only for an exact "1"', () => {
    expect(isForcedRecoveryEnabled('1')).toBe(true)
    for (const value of [undefined, '', '0', 'true', ' 1 ', 'yes', 'on', '11']) {
      expect(isForcedRecoveryEnabled(value)).toBe(false)
    }
  })
```

and drop `isForcedRecoveryEnabled` from the import at the top, leaving:

```ts
import browser, {
  makePassportCheckerBrowser,
  normalizeRecoverySshTarget,
  PASSPORT_CHECKER_URL,
} from './browser'
```

In `packages/widgets/passport-checker/browser/check.test.ts`, delete these four `it` blocks in full (they are contiguous, from `'ignores the forced recovery lever when it is off'` through `'gives every constructed handler its own forced recovery latch'`):

- `it('ignores the forced recovery lever when it is off', ...)`
- `it('forces exactly one recovery on the first check and lets the second complete normally', ...)`
- `it('keeps the forced recovery latch armed when navigation fails', ...)`
- `it('gives every constructed handler its own forced recovery latch', ...)`

- [ ] **Step 2: Run the suite to confirm nothing else depended on them**

Run: `pnpm --filter widgets-passport-checker test`
Expected: PASS. Test count drops by 5 (was `138 passed | 7 skipped`, now `133 passed | 7 skipped`).

- [ ] **Step 3: Delete the lever from `browser.ts`**

Remove the `isForcedRecoveryEnabled` function together with its whole doc comment, and the `forceRecovery` option. The file becomes:

```ts
import { defineWidgetBrowser } from '@shared/widgets/browser-contracts'
import type { BrowserTaskContext } from 'browser-automation/task-context'

import { makePassportCheckHandler } from './browser/check'
import { passportCheckerBrowserSchemas } from './types'

export const PASSPORT_CHECKER_URL = 'https://pasport.org.ua/solutions/checker'

export function normalizeRecoverySshTarget(value: string | undefined) {
  const target = value?.trim()
  if (!target) return null
  return /^(?:[A-Za-z0-9._-]+@)?[A-Za-z0-9.-]+$/.test(target) ? target : null
}

export function makePassportCheckerBrowser(options: {
  checkerUrl: string
  recoverySshTarget: string | null
}) {
  return defineWidgetBrowser<BrowserTaskContext>()({
    schemas: passportCheckerBrowserSchemas,
    handlers: {
      check: makePassportCheckHandler(options),
    },
  })
}

export default makePassportCheckerBrowser({
  checkerUrl: PASSPORT_CHECKER_URL,
  recoverySshTarget: normalizeRecoverySshTarget(process.env.AUTOMATION_SSH_TARGET),
})
```

- [ ] **Step 4: Delete the lever from `browser/check.ts`**

Narrow the options type to:

```ts
export type PassportCheckHandlerOptions = {
  checkerUrl: string
  recoverySshTarget: string | null
}
```

(the whole `forceRecovery` field and its doc comment go). Then in `makePassportCheckHandler`, delete the `forcedRecoveryArmed` latch declaration together with its comment, and delete this branch together with its comment:

```ts
    if (forcedRecoveryArmed) {
      forcedRecoveryArmed = false
      context.retainPageForRecovery()
      return new BrowserSessionRequiredError({ sshTarget: options.recoverySshTarget })
    }
```

The function head becomes:

```ts
export function makePassportCheckHandler(options: PassportCheckHandlerOptions) {
  return async (_payload: PassportCheckPayload, context: BrowserTaskContext) => {
```

- [ ] **Step 5: Run tests and typecheck**

Run: `pnpm --filter widgets-passport-checker test && pnpm --filter widgets-passport-checker typecheck`
Expected: PASS, and typecheck prints nothing (exit 0).

- [ ] **Step 6: Remove the environment plumbing**

In `docker-compose.yml`, delete lines 90–95: the five-line `# Testing lever, NEVER set in production...` comment block and the `      PASSPORT_FORCE_RECOVERY: ${PASSPORT_FORCE_RECOVERY:-}` line under it. Lines 88–89 (`# Non-secret operational config...` and `AUTOMATION_SSH_TARGET: ${AUTOMATION_SSH_TARGET:-}`) stay — that variable is still used and moves to the service config in Task 4.

In `.env.dev.example`, delete lines 34–46: the blank separator line, the `# --- Testing lever: force one Cloudflare recovery per service start ---` heading, its eleven-line explanation, and `#PASSPORT_FORCE_RECOVERY=1`. The file then ends with `NOVNC_HOST_PORT=6180`.

Verify with `rg -n 'PASSPORT_FORCE_RECOVERY|Testing lever' docker-compose.yml .env.dev.example` — expected: no output.

- [ ] **Step 7: Commit**

```bash
git add packages/widgets/passport-checker docker-compose.yml .env.dev.example
git commit -m "revert(passport-checker): drop the env-gated forced recovery lever

The lever forced one trip through the Cloudflare recovery path per service
start so Subproject 8 could exercise noVNC on the Pi on demand. It is being
retired deliberately ahead of moving user-input detection into the platform;
the Pi smoke test needs another answer.

This reverts the behaviour added in 45c604f1."
```

---

## Task 2: Platform user-input types and errors

**Files:**
- Create: `packages/browser-automation/src/user-input/detector.ts`
- Create: `packages/browser-automation/src/user-input/errors.ts`
- Create: `packages/browser-automation/src/user-input/index.ts`
- Test: `packages/browser-automation/src/user-input/errors.test.ts`
- Modify: `packages/browser-automation/package.json`

**Interfaces:**
- Consumes: `BrowserTaskError` from `@shared/browser-automation/task-errors`.
- Produces:
  - `type UserInputDetector = (page: Page) => Promise<Error | boolean>`
  - `type DetectUserInputOptions = { prepare?: (page: Page) => Promise<unknown> }`
  - `class UserInputRequiredError` — constructor `({ sshTarget: string | null, cause?: unknown })`, fields `sshTarget`, `code = 'browser_session_required'`, `publicMessage`, getter `publicMeta`.
  - `class UserInputProbeError` — constructor `({ cause?: unknown })`, `code = 'user_input_probe'`.
  - Import path for both plus the types: `browser-automation/user-input`.

- [ ] **Step 1: Write the failing test**

Create `packages/browser-automation/src/user-input/errors.test.ts`:

```ts
import { describe, expect, it } from 'vitest'

import { BrowserTaskError } from '../errors'
import { UserInputProbeError, UserInputRequiredError } from './errors'

describe('UserInputRequiredError', () => {
  // The passport-checker server maps this code to HTTP 409 and the widget UI
  // switches to its noVNC recovery view on it. Renaming either the code or the
  // meta key silently breaks recovery for every deployed client.
  it('keeps the browser_session_required contract the recovery flow depends on', () => {
    const error = new UserInputRequiredError({ sshTarget: 'pi@myboard.local' })
    expect(error).toBeInstanceOf(BrowserTaskError)
    expect(error.code).toBe('browser_session_required')
    expect(error.sshTarget).toBe('pi@myboard.local')
    expect(error.publicMeta).toEqual({ sshTarget: 'pi@myboard.local' })
  })

  it('omits public meta entirely when no ssh target is configured', () => {
    const error = new UserInputRequiredError({ sshTarget: null })
    expect(error.sshTarget).toBeNull()
    expect(error.publicMeta).toBeUndefined()
  })
})

describe('UserInputProbeError', () => {
  it('carries its own code and preserves the detector failure as cause', () => {
    const cause = new Error('page.evaluate failed')
    const error = new UserInputProbeError({ cause })
    expect(error).toBeInstanceOf(BrowserTaskError)
    expect(error.code).toBe('user_input_probe')
    expect(error.cause).toBe(cause)
  })

  it('accepts a non-Error cause, because a rejected probe may throw anything', () => {
    const error = new UserInputProbeError({ cause: 'string rejection' })
    expect(error.code).toBe('user_input_probe')
    expect(error.cause).toBe('string rejection')
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm --filter browser-automation exec vitest run src/user-input/errors.test.ts`
Expected: FAIL — `Failed to resolve import "./errors"`.

- [ ] **Step 3: Write the implementation**

Create `packages/browser-automation/src/user-input/detector.ts`:

```ts
import type { Page } from 'playwright'

/**
 * Decides whether a browser task can continue without a human.
 *
 * Returns `true` when the task is blocked and someone must act on the live
 * page, `false` when it may continue, and an `Error` when the check itself
 * could not be carried out — a broken probe is not the same as "no challenge",
 * and the platform must not confuse the two.
 */
export type UserInputDetector = (page: Page) => Promise<Error | boolean>

export type DetectUserInputOptions = {
  /**
   * Runs only after the detector matched, before the page is retained. Use it
   * to leave the retained page in a state a human can act on. A failure here is
   * logged and does not cancel the escalation.
   */
  prepare?: (page: Page) => Promise<unknown>
}
```

Create `packages/browser-automation/src/user-input/errors.ts`:

```ts
import { BrowserTaskError } from '@shared/browser-automation/task-errors'
import * as errore from 'errore'

type UserInputRequiredErrorOptions = {
  sshTarget: string | null
  cause?: unknown
}

/**
 * The canonical "a human must act on this browser session" error.
 *
 * `code` and the `sshTarget` meta key are a cross-package contract: the widget
 * server maps the code to HTTP 409, and the client switches to the noVNC
 * recovery view on it. Neither may be renamed without migrating both.
 */
export class UserInputRequiredError extends errore.createTaggedError({
  name: 'UserInputRequiredError',
  message: 'The browser session requires manual input',
  extends: BrowserTaskError,
}) {
  readonly sshTarget: string | null
  code = 'browser_session_required'
  publicMessage = 'The browser session requires attention'

  constructor({ sshTarget, ...options }: UserInputRequiredErrorOptions) {
    super(options)
    this.sshTarget = sshTarget
  }

  get publicMeta(): Record<string, unknown> | undefined {
    return this.sshTarget ? { sshTarget: this.sshTarget } : undefined
  }
}

/**
 * The detector could not decide. The page is deliberately left unretained: we
 * do not know whether a human could do anything with it, and holding a browser
 * page open for a recovery nobody will perform is worse than failing the task.
 */
export class UserInputProbeError extends errore.createTaggedError({
  name: 'UserInputProbeError',
  message: 'Failed to check whether the browser session requires manual input',
  extends: BrowserTaskError,
}) {
  code = 'user_input_probe'
  publicMessage = 'Could not determine whether the browser needs attention'
}
```

Create `packages/browser-automation/src/user-input/index.ts`:

```ts
export type { DetectUserInputOptions, UserInputDetector } from './detector'
export { UserInputProbeError, UserInputRequiredError } from './errors'
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm --filter browser-automation exec vitest run src/user-input/errors.test.ts`
Expected: PASS, 4 tests.

- [ ] **Step 5: Add the export subpaths**

In `packages/browser-automation/package.json`, replace the `exports` block with:

```json
  "exports": {
    "./task-context": "./src/browser/context.ts",
    "./user-input": "./src/user-input/index.ts",
    "./user-input/cloudflare": "./src/user-input/cloudflare.ts"
  },
```

`./user-input/cloudflare` points at a file Task 3 creates. That is deliberate — the map is written once, and nothing imports the subpath until Task 3 lands.

- [ ] **Step 6: Run the package suite and typecheck**

Run: `pnpm --filter browser-automation test && pnpm --filter browser-automation typecheck`
Expected: PASS, typecheck silent.

- [ ] **Step 7: Commit**

```bash
git add packages/browser-automation
git commit -m "feat(browser-automation): add user-input detector and error contracts

UserInputRequiredError carries the browser_session_required code and sshTarget
meta the recovery flow keys off, moved out of the passport-checker widget where
a platform contract had no business living. UserInputProbeError distinguishes
a broken check from a negative one."
```

---

## Task 3: Cloudflare helper in the platform

Moves the widget's `browser/challenge.ts` into the platform and reunites it with the DOM probe that was left behind in `check.ts`. This is a move, not a copy: the widget switches to the new import in this same task, so the classifier never exists in two places. The widget's own escalation code still calls it by hand — that changes in Task 5.

**Files:**
- Create: `packages/browser-automation/src/user-input/cloudflare.ts`
- Test: `packages/browser-automation/src/user-input/cloudflare.test.ts`
- Delete: `packages/widgets/passport-checker/browser/challenge.ts`
- Modify: `packages/widgets/passport-checker/browser/check.ts` (import path only)
- Modify: `packages/widgets/passport-checker/browser/check.test.ts` (move three describes out)
- Modify: `packages/widgets/passport-checker/package.json`

**Interfaces:**
- Consumes: `UserInputDetector` from `./detector`.
- Produces, all from `browser-automation/user-input/cloudflare`:
  - `type ChallengeEvidence` — `{ url: string; title: string; status: number | null; server: string | null; cfRay: string | null; hasChallengeForm: boolean; hasChallengePlatform: boolean; hasChallengeContent: boolean }`
  - `type EvidenceFromResponseTextInput` — `{ url: string; status: number; server: string | null; cfRay: string | null; text: string | null }`
  - `function isCloudflareChallenge(evidence: ChallengeEvidence): boolean`
  - `function evidenceFromResponseText(input: EvidenceFromResponseTextInput): ChallengeEvidence`
  - `function makeCloudflarePageDetector(navigation: Response | null): UserInputDetector`
  - `function makeCloudflareEvidenceDetector(evidence: ChallengeEvidence): UserInputDetector`
  - `class CloudflareProbeError`

- [ ] **Step 1: Write the failing test**

Create `packages/browser-automation/src/user-input/cloudflare.test.ts`:

```ts
// @vitest-environment node
import type { Page, Response } from 'playwright'
import { describe, expect, it, vi } from 'vitest'

import {
  CloudflareProbeError,
  evidenceFromResponseText,
  isCloudflareChallenge,
  makeCloudflareEvidenceDetector,
  makeCloudflarePageDetector,
  type ChallengeEvidence,
} from './cloudflare'

const baseEvidence: ChallengeEvidence = {
  url: 'https://pasport.org.ua/solutions/checker',
  title: 'Checker',
  status: 200,
  server: null,
  cfRay: null,
  hasChallengeForm: false,
  hasChallengePlatform: false,
  hasChallengeContent: false,
}

type DomEvidence = Pick<
  ChallengeEvidence,
  'url' | 'title' | 'hasChallengeForm' | 'hasChallengePlatform' | 'hasChallengeContent'
>

function makePage(dom: Partial<DomEvidence>, options?: { evaluateError?: unknown }) {
  const evaluate = vi.fn(async () => {
    if (options?.evaluateError !== undefined) throw options.evaluateError
    return {
      url: baseEvidence.url,
      title: baseEvidence.title,
      hasChallengeForm: false,
      hasChallengePlatform: false,
      hasChallengeContent: false,
      ...dom,
    }
  })
  return { page: { evaluate } as unknown as Page, evaluate }
}

function makeResponse(
  status: number,
  headers: Record<string, string>,
  options?: { headersError?: unknown },
) {
  return {
    status: () => status,
    allHeaders: async () => {
      if (options?.headersError !== undefined) throw options.headersError
      return headers
    },
  } as unknown as Response
}

describe('Cloudflare challenge classifier', () => {
  it.each([
    [{ ...baseEvidence, url: 'https://pasport.org.ua/cdn-cgi/challenge-platform/h/g' }],
    [{ ...baseEvidence, title: 'Just a moment...' }],
    [{ ...baseEvidence, hasChallengeForm: true }],
    [
      {
        ...baseEvidence,
        status: 503,
        server: 'cloudflare',
        cfRay: 'fixture-ray',
        hasChallengeContent: true,
      },
    ],
    [
      {
        ...baseEvidence,
        status: 503,
        server: 'cloudflare',
        cfRay: 'fixture-ray',
        hasChallengePlatform: true,
      },
    ],
  ])('accepts positive challenge evidence', (evidence) => {
    expect(isCloudflareChallenge(evidence)).toBe(true)
  })

  it.each([
    [{ ...baseEvidence, status: 403 }],
    [{ ...baseEvidence, status: 429 }],
    [{ ...baseEvidence, status: 503, server: 'fixture' }],
    [{ ...baseEvidence, status: 503, server: 'cloudflare', cfRay: 'fixture-ray' }],
  ])('does not treat status alone as a challenge', (evidence) => {
    expect(isCloudflareChallenge(evidence)).toBe(false)
  })

  // Cloudflare's "JS Detections" / Bot Fight Mode script is injected into
  // normally served pages too, not only interstitials, so the platform marker
  // alone must never classify a healthy origin as challenged.
  it('does not classify a 200 page carrying only the JS Detections/Bot Fight Mode script as a challenge', () => {
    expect(isCloudflareChallenge({ ...baseEvidence, hasChallengePlatform: true })).toBe(false)
  })
})

describe('evidenceFromResponseText', () => {
  it('does not classify a 200 body carrying only the JS Detections/Bot Fight Mode script as a challenge', () => {
    const evidence = evidenceFromResponseText({
      url: 'https://pasport.org.ua/solutions/checker',
      status: 200,
      server: null,
      cfRay: null,
      text: '<!doctype html><head><script src="/cdn-cgi/challenge-platform/h/g/jsd/r2.js"></script></head><body>ready</body>',
    })
    expect(evidence.hasChallengePlatform).toBe(true)
    expect(isCloudflareChallenge(evidence)).toBe(false)
  })

  it('extracts a bounded title and both challenge markers from a real challenge body', () => {
    const evidence = evidenceFromResponseText({
      url: 'https://pasport.org.ua/solutions/checker',
      status: 503,
      server: 'cloudflare',
      cfRay: 'fixture-ray',
      text: '<!doctype html><title>Just a moment...</title><div id="challenge-form" class="cf-chl-widget"></div>',
    })
    expect(evidence).toEqual({
      url: 'https://pasport.org.ua/solutions/checker',
      title: 'Just a moment...',
      status: 503,
      server: 'cloudflare',
      cfRay: 'fixture-ray',
      hasChallengeForm: true,
      hasChallengePlatform: false,
      hasChallengeContent: true,
    })
    expect(isCloudflareChallenge(evidence)).toBe(true)
  })

  it('detects an unquoted id=challenge-form attribute', () => {
    const evidence = evidenceFromResponseText({
      url: 'https://pasport.org.ua/solutions/checker',
      status: 503,
      server: 'cloudflare',
      cfRay: 'fixture-ray',
      text: '<!doctype html><div id=challenge-form></div>',
    })
    expect(evidence.hasChallengeForm).toBe(true)
  })

  it('produces all-false evidence and an empty title for a plain JSON success body', () => {
    const evidence = evidenceFromResponseText({
      url: 'https://pasport.org.ua/solutions/checker',
      status: 200,
      server: null,
      cfRay: null,
      text: '{"status":1,"send_status_msg":"ok"}',
    })
    expect(evidence).toEqual({
      url: 'https://pasport.org.ua/solutions/checker',
      title: '',
      status: 200,
      server: null,
      cfRay: null,
      hasChallengeForm: false,
      hasChallengePlatform: false,
      hasChallengeContent: false,
    })
    expect(isCloudflareChallenge(evidence)).toBe(false)
  })

  it('caps an oversized title at 200 characters instead of returning it unbounded', () => {
    const longTitle = 'A'.repeat(400)
    const evidence = evidenceFromResponseText({
      url: 'https://pasport.org.ua/solutions/checker',
      status: 200,
      server: null,
      cfRay: null,
      text: `<title>${longTitle}</title>`,
    })
    expect(evidence.title).toBe('A'.repeat(200))
    expect(evidence.title.length).toBe(200)
  })

  it('does not take a <title occurrence with no matching close tag, such as inside a script literal', () => {
    const evidence = evidenceFromResponseText({
      url: 'https://pasport.org.ua/solutions/checker',
      status: 200,
      server: null,
      cfRay: null,
      text: '<script>var markup = "<title>fake";</script><title>Real Title</title>',
    })
    expect(evidence.title).toBe('Real Title')
  })

  it('returns all-false evidence with no title when the response has no text', () => {
    const evidence = evidenceFromResponseText({
      url: 'https://pasport.org.ua/solutions/checker',
      status: 502,
      server: null,
      cfRay: null,
      text: null,
    })
    expect(evidence).toEqual({
      url: 'https://pasport.org.ua/solutions/checker',
      title: '',
      status: 502,
      server: null,
      cfRay: null,
      hasChallengeForm: false,
      hasChallengePlatform: false,
      hasChallengeContent: false,
    })
  })
})

describe('evidenceFromResponseText spliced into a page callback', () => {
  // The passport-checker widget never calls evidenceFromResponseText by
  // reference: it splices its *source text* (via Function.prototype.toString())
  // into a `new Function(...)` that runs inside Chromium via page.evaluate,
  // because Playwright serializes evaluate callbacks by source alone and cannot
  // close over a Node-side import. Every other test in this file calls the
  // function directly, which still resolves free identifiers (a hoisted
  // module-scope regex, an imported helper, ...) against this module's scope and
  // would pass even if the function stopped being self-contained. Reconstructing
  // it the way production does has no such scope to fall back on: a free
  // identifier makes this throw ReferenceError instead of silently succeeding.
  // Do NOT simplify this back into a direct call.
  const reconstructed = new Function(
    `return ${evidenceFromResponseText.toString()}`,
  )() as typeof evidenceFromResponseText

  it('reconstructs identically to the direct call for a real challenge body', () => {
    const input = {
      url: 'https://pasport.org.ua/solutions/checker',
      status: 503,
      server: 'cloudflare',
      cfRay: 'fixture-ray',
      text: '<!doctype html><title>Just a moment...</title><div id="challenge-form" class="cf-chl-widget"></div>',
    }
    expect(reconstructed(input)).toEqual(evidenceFromResponseText(input))
  })

  it('reconstructs identically to the direct call for a plain success body', () => {
    const input = {
      url: 'https://pasport.org.ua/solutions/checker',
      status: 200,
      server: null,
      cfRay: null,
      text: '{"status":1,"send_status_msg":"ok"}',
    }
    expect(reconstructed(input)).toEqual(evidenceFromResponseText(input))
  })
})

describe('makeCloudflarePageDetector', () => {
  it('combines DOM markers with response headers to report a challenge', async () => {
    const { page } = makePage({ title: 'Just a moment...' })
    const detector = makeCloudflarePageDetector(
      makeResponse(503, { server: 'cloudflare', 'cf-ray': 'fixture-ray' }),
    )
    expect(await detector(page)).toBe(true)
  })

  it('reports no challenge for a clean page and a clean response', async () => {
    const { page } = makePage({})
    const detector = makeCloudflarePageDetector(makeResponse(200, {}))
    expect(await detector(page)).toBe(false)
  })

  it('needs a Cloudflare-attributed response before a challenge status counts', async () => {
    const { page } = makePage({ hasChallengeContent: true })
    const detector = makeCloudflarePageDetector(makeResponse(503, { server: 'fixture' }))
    expect(await detector(page)).toBe(false)
  })

  it('treats a null navigation response as an absent status and no headers', async () => {
    const { page } = makePage({ hasChallengeContent: true })
    const detector = makeCloudflarePageDetector(null)
    expect(await detector(page)).toBe(false)
  })

  it('returns a probe error when the page evaluation rejects', async () => {
    const { page } = makePage({}, { evaluateError: new Error('evaluate failed') })
    const detector = makeCloudflarePageDetector(makeResponse(200, {}))
    const result = await detector(page)
    expect(result).toBeInstanceOf(CloudflareProbeError)
  })

  it('returns a probe error when reading response headers rejects', async () => {
    const { page } = makePage({})
    const detector = makeCloudflarePageDetector(
      makeResponse(200, {}, { headersError: new Error('headers failed') }),
    )
    expect(await detector(page)).toBeInstanceOf(CloudflareProbeError)
  })

  it('returns a probe error when the page rejects with a non-Error value', async () => {
    const { page } = makePage({}, { evaluateError: 'target closed' })
    const detector = makeCloudflarePageDetector(makeResponse(200, {}))
    expect(await detector(page)).toBeInstanceOf(CloudflareProbeError)
  })
})

describe('makeCloudflareEvidenceDetector', () => {
  it('classifies pre-collected evidence without touching the page', async () => {
    const { page, evaluate } = makePage({})
    const detector = makeCloudflareEvidenceDetector({ ...baseEvidence, hasChallengeForm: true })
    expect(await detector(page)).toBe(true)
    expect(evaluate).not.toHaveBeenCalled()
  })

  it('reports no challenge for clean evidence', async () => {
    const { page } = makePage({})
    expect(await makeCloudflareEvidenceDetector(baseEvidence)(page)).toBe(false)
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm --filter browser-automation exec vitest run src/user-input/cloudflare.test.ts`
Expected: FAIL — `Failed to resolve import "./cloudflare"`.

- [ ] **Step 3: Write the implementation**

Create `packages/browser-automation/src/user-input/cloudflare.ts`:

```ts
import * as errore from 'errore'
import type { Response } from 'playwright'

import type { UserInputDetector } from './detector'

// The callback below is serialized into Chromium by page.evaluate, so the
// browser globals exist at runtime. Declaring them module-locally keeps the DOM
// lib out of this Node-only package's tsconfig.
declare const window: { location: { href: string } }
declare const document: {
  title: string
  documentElement: { innerHTML: string }
  querySelector(selectors: string): unknown
}

export class CloudflareProbeError extends errore.createTaggedError({
  name: 'CloudflareProbeError',
  message: 'Failed to probe the page for a Cloudflare challenge',
}) {}

export type ChallengeEvidence = {
  url: string
  title: string
  status: number | null
  server: string | null
  cfRay: string | null
  hasChallengeForm: boolean
  hasChallengePlatform: boolean
  hasChallengeContent: boolean
}

const challengeStatuses = new Set([403, 503])

export function isCloudflareChallenge(evidence: ChallengeEvidence) {
  // Cloudflare's "JS Detections" / Bot Fight Mode script
  // (/cdn-cgi/challenge-platform/...) is injected into normally served pages
  // too, not only interstitials, so hasChallengePlatform alone must never be
  // treated as an explicit marker (see the docstring on evidenceFromResponseText
  // for the fixture that motivated this). It only counts alongside a
  // challenge-shaped status and a Cloudflare-attributed response, below.
  const explicitMarker =
    /\/cdn-cgi\/challenge-platform/i.test(evidence.url) ||
    /just a moment|attention required/i.test(evidence.title) ||
    evidence.hasChallengeForm
  if (explicitMarker) return true

  const cloudflareResponse =
    evidence.server?.toLowerCase().includes('cloudflare') === true || evidence.cfRay !== null
  return (
    evidence.status !== null &&
    challengeStatuses.has(evidence.status) &&
    cloudflareResponse &&
    (evidence.hasChallengeContent || evidence.hasChallengePlatform)
  )
}

export type EvidenceFromResponseTextInput = {
  url: string
  status: number
  server: string | null
  cfRay: string | null
  text: string | null
}

// Derives ChallengeEvidence from a response's raw text/headers. This function is
// pure and intentionally self-contained: no references to anything outside its
// own parameters, no closures over module-level consts, no DOM/Node APIs. That
// is what lets a widget splice this function's compiled source (via
// Function.prototype.toString()) into the same page.evaluate() argument that
// performs a same-origin POST, instead of calling it by reference — Playwright
// serializes evaluate callbacks by source text alone and cannot close over a
// Node-side import. Splicing keeps the exact code that runs in-page identical to
// the code exercised by the unit tests, and it never requires the raw response
// text to leave the page.
export function evidenceFromResponseText({
  url,
  status,
  server,
  cfRay,
  text,
}: EvidenceFromResponseTextInput): ChallengeEvidence {
  // Requires an actual closing </title> tag (not merely the next '<' of any
  // kind), so a <title occurrence inside a script literal or comment with no
  // real closing tag of its own cannot match. The captured text is then
  // trimmed and capped at 200 characters so an unusually large title cannot
  // carry unbounded page text back into Node.
  const titleMatch = text === null ? null : /<title[^>]*>([^<]*)<\/title>/i.exec(text)
  return {
    url,
    title: titleMatch ? titleMatch[1].trim().slice(0, 200) : '',
    status,
    server,
    cfRay,
    hasChallengeForm:
      text !== null &&
      (/id=["']?challenge-form["']?/i.test(text) ||
        /<form[^>]+action=["'][^"']*challenge[^"']*["']/i.test(text)),
    hasChallengePlatform:
      text !== null &&
      /<script[^>]+src=["'][^"']*\/cdn-cgi\/challenge-platform\/[^"']*["']/i.test(text),
    hasChallengeContent: text !== null && /cf-chl-|challenge-platform/i.test(text),
  }
}

/**
 * Probes the live page for Cloudflare interstitial markers and combines them
 * with the navigation response's status and Cloudflare headers.
 */
export function makeCloudflarePageDetector(navigation: Response | null): UserInputDetector {
  return async (page) => {
    const pageEvidence = await page
      .evaluate(() => ({
        url: window.location.href,
        title: document.title,
        hasChallengeForm:
          document.querySelector('#challenge-form, form[action*="challenge"]') !== null,
        hasChallengePlatform:
          document.querySelector('script[src*="/cdn-cgi/challenge-platform/"]') !== null,
        hasChallengeContent: /cf-chl-|challenge-platform/i.test(document.documentElement.innerHTML),
      }))
      .catch((cause: unknown) => new CloudflareProbeError({ cause }))
    if (pageEvidence instanceof Error) return pageEvidence

    const headers = navigation
      ? await navigation.allHeaders().catch((cause: unknown) => new CloudflareProbeError({ cause }))
      : {}
    if (headers instanceof Error) return headers

    return isCloudflareChallenge({
      ...pageEvidence,
      status: navigation?.status() ?? null,
      server: headers.server ?? null,
      cfRay: headers['cf-ray'] ?? null,
    })
  }
}

/**
 * Classifies evidence that was already collected — typically derived inside the
 * page from a fetch response body, which never reaches the DOM and so cannot be
 * probed. The page argument is ignored.
 */
export function makeCloudflareEvidenceDetector(evidence: ChallengeEvidence): UserInputDetector {
  return async () => isCloudflareChallenge(evidence)
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm --filter browser-automation exec vitest run src/user-input/cloudflare.test.ts`
Expected: PASS, 26 tests.

- [ ] **Step 5: Move the widget off its own copy**

Delete `packages/widgets/passport-checker/browser/challenge.ts`.

In `packages/widgets/passport-checker/browser/check.ts`, change only the import — the handler body stays exactly as it is in this task:

```ts
import {
  evidenceFromResponseText,
  isCloudflareChallenge,
  type ChallengeEvidence,
} from 'browser-automation/user-input/cloudflare'
```

In `packages/widgets/passport-checker/package.json`, move `"browser-automation": "workspace:*"` from `devDependencies` to `dependencies`: `check.ts` now imports runtime values from it, not only types.

In `packages/widgets/passport-checker/browser/check.test.ts`, delete the three describes that now live in the platform suite — `'Cloudflare challenge classifier'`, `'evidenceFromResponseText'` and `'evidenceFromResponseText spliced into a page callback'` — and retarget the remaining imports, keeping `baseEvidence` and everything else in the file:

```ts
import type { ChallengeEvidence } from 'browser-automation/user-input/cloudflare'
```

- [ ] **Step 6: Run both suites and both typechecks**

Run: `pnpm --filter browser-automation test && pnpm --filter browser-automation typecheck && pnpm --filter widgets-passport-checker test && pnpm --filter widgets-passport-checker typecheck`
Expected: all PASS, typechecks silent. The widget suite loses the 15 tests that moved to the platform and gains none.

- [ ] **Step 7: Commit**

```bash
git add packages/browser-automation packages/widgets/passport-checker
git commit -m "feat(browser-automation): move Cloudflare detection into the platform

The classifier lived in the passport-checker widget while the DOM probe feeding
it lived in that widget's check handler, so the only reusable half was the half
without the probe. Both now sit in browser-automation behind two detector
factories: one that probes the live page, one that classifies evidence already
derived inside the page from a fetch response.

The widget imports the moved module rather than keeping a copy; it still calls
the classifier by hand, which the next commit changes."
```

---

## Task 4: `detectUserInput` on the task context

Additive. `retainPageForRecovery` stays on the context so the widget keeps compiling; Task 6 removes it.

**Files:**
- Create: `packages/browser-automation/src/user-input/detect.ts`
- Modify: `packages/browser-automation/src/user-input/index.ts`
- Modify: `packages/browser-automation/src/browser/context.ts`
- Modify: `packages/browser-automation/src/browser/chromium-executor.ts`
- Modify: `packages/browser-automation/src/config.ts`
- Modify: `packages/browser-automation/src/index.ts`
- Test: `packages/browser-automation/src/browser/chromium-executor.test.ts`
- Test: `packages/browser-automation/src/config.test.ts`
- Modify: `packages/browser-automation/src/diagnostics.test.ts`
- Modify: `packages/widgets/passport-checker/browser/check.test.ts`
- Modify: `packages/widgets/passport-checker/browser/check.integration.test.ts`

**Interfaces:**
- Consumes: `UserInputDetector`, `DetectUserInputOptions`, `UserInputRequiredError`, `UserInputProbeError` from Task 2.
- Produces:
  - `type DetectUserInput = (detector: UserInputDetector, options?: DetectUserInputOptions) => Promise<UserInputProbeError | UserInputRequiredError | null>`
  - `function makeDetectUserInput(deps: { page: Page; recoverySshTarget: string | null; retain: () => void }): DetectUserInput`
  - `BrowserTaskContext.detectUserInput: DetectUserInput`
  - `makeChromiumExecutor` deps gain optional `recoverySshTarget?: string | null` (default `null`).
  - `BrowserServiceConfig` gains `recoverySshTarget: string | null`.

The escalation semantics live in `makeDetectUserInput` rather than inline in the
executor because `check.integration.test.ts` builds a `BrowserTaskContext` by
hand around a real Playwright page (Task 5, Step 5). An inline implementation
would force that suite to reimplement retain/prepare/escalate ordering in test
code, and a test that reimplements the thing it is testing proves nothing. The
ordering contract itself is still asserted through the executor, where handlers
actually meet it.

- [ ] **Step 1: Write the failing config test**

Append to `packages/browser-automation/src/config.test.ts`, inside the existing `describe`:

```ts
  it('normalizes a usable AUTOMATION_SSH_TARGET', () => {
    expect(
      loadBrowserServiceConfig({ AUTOMATION_SSH_TARGET: ' pi@myboard.local ' }),
    ).toMatchObject({ recoverySshTarget: 'pi@myboard.local' })
    expect(loadBrowserServiceConfig({ AUTOMATION_SSH_TARGET: '192.168.1.10' })).toMatchObject({
      recoverySshTarget: '192.168.1.10',
    })
  })

  // The value is public recovery metadata the UI shows, and config failures
  // reach process.exit(1) in index.ts. A typo in .env must cost the SSH hint,
  // never the whole automation service.
  it.each(['pi@host; shutdown', '', 'pi@host/../etc'])(
    'degrades an unusable AUTOMATION_SSH_TARGET to null instead of failing the config',
    (value) => {
      const config = loadBrowserServiceConfig({ AUTOMATION_SSH_TARGET: value })
      expect(config).not.toBeInstanceOf(BrowserServiceConfigError)
      expect(config).toMatchObject({ recoverySshTarget: null })
    },
  )
```

Then update the two existing tests that assert an exact object with `toEqual` — `'applies defaults when nothing is set'` and `'parses positive integer overrides'` — by adding `recoverySshTarget: null` to each expected object.

- [ ] **Step 2: Run the config test to verify it fails**

Run: `pnpm --filter browser-automation exec vitest run src/config.test.ts`
Expected: FAIL — the new assertions report `recoverySshTarget: undefined`, and the two updated `toEqual` tests report a missing key.

- [ ] **Step 3: Implement the config change**

In `packages/browser-automation/src/config.ts`, add `recoverySshTarget: string | null` to `BrowserServiceConfig`, and add above `ConfigSchema`:

```ts
// Public recovery metadata surfaced to the UI, so only a bare host or user@host
// may pass. Deliberately NOT part of ConfigSchema: a parse failure there reaches
// process.exit(1) in index.ts, and an unusable value must only cost the SSH
// fallback hint, never the whole automation service.
const sshTargetPattern = /^(?:[A-Za-z0-9._-]+@)?[A-Za-z0-9.-]+$/

function normalizeRecoverySshTarget(value: string | undefined) {
  const target = value?.trim()
  if (!target) return null
  return sshTargetPattern.test(target) ? target : null
}
```

and extend the returned object with:

```ts
    recoverySshTarget: normalizeRecoverySshTarget(env.AUTOMATION_SSH_TARGET),
```

- [ ] **Step 4: Run the config test to verify it passes**

Run: `pnpm --filter browser-automation exec vitest run src/config.test.ts`
Expected: PASS.

- [ ] **Step 5: Write the failing executor tests**

In `packages/browser-automation/src/browser/chromium-executor.test.ts`, add these tests inside the existing `describe('makeChromiumExecutor', ...)`:

```ts
  it('returns null and leaves the page unretained when the detector declines', async () => {
    const created: FakeContext[] = []
    const executor = makeChromiumExecutor(makeDeps(created))
    const context = await executor.acquire(new AbortController().signal, 'passport-checker')
    if (context instanceof Error) throw context

    expect(await context.detectUserInput(async () => false)).toBeNull()
    await executor.release(context)

    expect(executor.hasRetainedPage('passport-checker')).toBe(false)
  })

  it('retains the page and returns the canonical error when the detector matches', async () => {
    const created: FakeContext[] = []
    const executor = makeChromiumExecutor({
      ...makeDeps(created),
      recoverySshTarget: 'pi@myboard.local',
    })
    const context = await executor.acquire(new AbortController().signal, 'passport-checker')
    if (context instanceof Error) throw context

    const escalation = await context.detectUserInput(async () => true)
    expect(escalation).toBeInstanceOf(UserInputRequiredError)
    expect((escalation as UserInputRequiredError).sshTarget).toBe('pi@myboard.local')

    await executor.release(context)
    expect(executor.hasRetainedPage('passport-checker')).toBe(true)
  })

  it('reports a null ssh target when none is configured', async () => {
    const created: FakeContext[] = []
    const executor = makeChromiumExecutor(makeDeps(created))
    const context = await executor.acquire(new AbortController().signal, 'passport-checker')
    if (context instanceof Error) throw context

    const escalation = await context.detectUserInput(async () => true)
    expect((escalation as UserInputRequiredError).sshTarget).toBeNull()
    await executor.release(context)
  })

  it('hands the acquired page to the detector', async () => {
    const created: FakeContext[] = []
    const executor = makeChromiumExecutor(makeDeps(created))
    const context = await executor.acquire(new AbortController().signal, 'passport-checker')
    if (context instanceof Error) throw context

    const detector = vi.fn(async () => false)
    await context.detectUserInput(detector)
    expect(detector).toHaveBeenCalledWith(context.page)
    await executor.release(context)
  })

  // An undecidable check is not the same as "no challenge": nobody knows whether
  // a human could act on this page, so pinning it open for a recovery that will
  // never happen is worse than failing the task.
  it.each<[string, UserInputDetector]>([
    ['returned an Error', async () => new Error('probe failed')],
    ['rejected with an Error', () => Promise.reject(new Error('probe threw'))],
    ['rejected with a non-Error', () => Promise.reject('target closed')],
  ])(
    'wraps a detector that %s as a probe error and leaves the page unretained',
    async (_kind, detector) => {
      const created: FakeContext[] = []
      const executor = makeChromiumExecutor(makeDeps(created))
      const context = await executor.acquire(new AbortController().signal, 'passport-checker')
      if (context instanceof Error) throw context

      const result = await context.detectUserInput(detector)
      expect(result).toBeInstanceOf(UserInputProbeError)

      await executor.release(context)
      expect(executor.hasRetainedPage('passport-checker')).toBe(false)
    },
  )

  it('runs prepare before retaining, and only when the detector matched', async () => {
    const created: FakeContext[] = []
    const executor = makeChromiumExecutor(makeDeps(created))

    const declined = await executor.acquire(new AbortController().signal, 'passport-checker')
    if (declined instanceof Error) throw declined
    const skippedPrepare = vi.fn(async () => undefined)
    await declined.detectUserInput(async () => false, { prepare: skippedPrepare })
    expect(skippedPrepare).not.toHaveBeenCalled()
    await executor.release(declined)

    const matched = await executor.acquire(new AbortController().signal, 'passport-checker')
    if (matched instanceof Error) throw matched
    // The explicit parameter is what makes toHaveBeenCalledWith below type-check:
    // an inferred zero-argument mock accepts no expected arguments.
    const prepare = vi.fn(async (_page: Page) => {
      expect(executor.hasRetainedPage('passport-checker')).toBe(false)
    })
    await matched.detectUserInput(async () => true, { prepare })
    expect(prepare).toHaveBeenCalledOnce()
    expect(prepare).toHaveBeenCalledWith(matched.page)
    await executor.release(matched)
    expect(executor.hasRetainedPage('passport-checker')).toBe(true)
  })

  it('escalates even when prepare fails, and says so in the log', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined)
    const created: FakeContext[] = []
    const executor = makeChromiumExecutor(makeDeps(created))
    const context = await executor.acquire(new AbortController().signal, 'passport-checker')
    if (context instanceof Error) throw context

    const escalation = await context.detectUserInput(async () => true, {
      prepare: async () => {
        throw new Error('prepare failed')
      },
    })
    expect(escalation).toBeInstanceOf(UserInputRequiredError)
    expect(warn).toHaveBeenCalled()

    await executor.release(context)
    expect(executor.hasRetainedPage('passport-checker')).toBe(true)
    warn.mockRestore()
  })
```

Add the imports at the top of the file, and widen the existing playwright type import to `import type { BrowserContext, Page } from 'playwright'`:

```ts
import {
  UserInputProbeError,
  UserInputRequiredError,
  type UserInputDetector,
} from '../user-input'
```

- [ ] **Step 6: Run the executor tests to verify they fail**

Run: `pnpm --filter browser-automation exec vitest run src/browser/chromium-executor.test.ts`
Expected: FAIL — `context.detectUserInput is not a function`.

- [ ] **Step 7: Implement the escalation semantics**

Create `packages/browser-automation/src/user-input/detect.ts`:

```ts
import type { Page } from 'playwright'

import type { DetectUserInputOptions, UserInputDetector } from './detector'
import { UserInputProbeError, UserInputRequiredError } from './errors'

export type DetectUserInput = (
  detector: UserInputDetector,
  options?: DetectUserInputOptions,
) => Promise<UserInputProbeError | UserInputRequiredError | null>

/**
 * Builds the context's `detectUserInput`. Kept separate from the Chromium
 * executor so a caller that owns a page by other means — an integration test
 * driving a real Playwright page, a future non-Chromium executor — gets the same
 * semantics instead of reimplementing them.
 */
export function makeDetectUserInput(deps: {
  page: Page
  recoverySshTarget: string | null
  retain: () => void
}): DetectUserInput {
  return async (detector, options) => {
    // A detector may reject as well as return an Error, and a rejected
    // Playwright call can carry a non-Error value, so anything that is not a
    // boolean means the check could not be carried out. The page is left
    // unretained on purpose: an undecidable check is not a challenge.
    const detected: unknown = await detector(deps.page).catch((cause: unknown) => cause)
    if (typeof detected !== 'boolean') return new UserInputProbeError({ cause: detected })
    if (!detected) return null

    if (options?.prepare) {
      const prepared = await options
        .prepare(deps.page)
        .then(() => null)
        .catch((cause: unknown) => cause)
      if (prepared !== null) {
        console.warn('Failed to prepare the page for manual recovery', prepared)
      }
    }

    deps.retain()
    return new UserInputRequiredError({ sshTarget: deps.recoverySshTarget })
  }
}
```

Extend the barrel at `packages/browser-automation/src/user-input/index.ts`:

```ts
export { makeDetectUserInput, type DetectUserInput } from './detect'
export type { DetectUserInputOptions, UserInputDetector } from './detector'
export { UserInputProbeError, UserInputRequiredError } from './errors'
```

Then in `packages/browser-automation/src/browser/context.ts`:

```ts
import type { DetectUserInput } from '../user-input/detect'
import type { WidgetSecrets } from './secrets'

export type { WidgetSecrets } from './secrets'
export type { DetectUserInputOptions, UserInputDetector } from '../user-input/detector'

export type BrowserTaskContext = {
  page: import('playwright').Page
  secrets: WidgetSecrets
  retainPageForRecovery(): void
  /**
   * Runs `detector` against the page. On a match it prepares the page (if a
   * prepare hook was given), retains it for manual recovery, and returns the
   * canonical error — one indivisible step, so a handler cannot retain a page
   * without escalating or escalate without retaining.
   */
  detectUserInput: DetectUserInput
}
```

In `packages/browser-automation/src/browser/chromium-executor.ts`, add the import:

```ts
import { makeDetectUserInput } from '../user-input'
```

widen the deps type:

```ts
export function makeChromiumExecutor(deps: {
  profileDir: string
  secretsDir: string
  /** Public SSH fallback hint put into escalation error meta. */
  recoverySshTarget?: string | null
  launch?: LaunchPersistentContext
}): BrowserExecutor<BrowserTaskContext> {
```

and add the property to the `managedContext` literal, directly after `retainPageForRecovery`:

```ts
          detectUserInput: makeDetectUserInput({
            page,
            recoverySshTarget: deps.recoverySshTarget ?? null,
            retain: () => {
              managedContext.retained = true
            },
          }),
```

The `retain` arrow closes over `managedContext` while that same `const` is still
being initialized. That is safe because the arrow is only created here, never
called — the identical pattern already in use one property above, in
`abortListener`.

- [ ] **Step 8: Add the missing member to every `BrowserTaskContext` literal**

Three literals in `packages/browser-automation/src/diagnostics.test.ts` (in the tests `'reports ok, the user agent, and secret presence'`, `'reports secretPresent false when the probe is absent'`, `'never echoes the secret value'`). Add to each, next to `retainPageForRecovery`:

```ts
      detectUserInput: async () => null,
```

The same addition goes into the `BrowserTaskContext` literal in `packages/widgets/passport-checker/browser/check.test.ts` (inside `makeContext`) and in `packages/widgets/passport-checker/browser/check.integration.test.ts`. Both are temporary stubs; Task 5 replaces the first properly.

- [ ] **Step 9: Thread the config value through `index.ts`**

```ts
const executor = makeChromiumExecutor({
  profileDir: config.profileDir,
  secretsDir: config.secretsDir,
  recoverySshTarget: config.recoverySshTarget,
})
```

- [ ] **Step 10: Run everything**

Run: `pnpm --filter browser-automation test && pnpm --filter browser-automation typecheck && pnpm --filter widgets-passport-checker test && pnpm --filter widgets-passport-checker typecheck`
Expected: all PASS, both typechecks silent.

- [ ] **Step 11: Commit**

```bash
git add packages/browser-automation packages/widgets/passport-checker
git commit -m "feat(browser-automation): run user-input detection from the task context

detectUserInput runs a widget-supplied detector and, on a match, prepares the
page, retains it and returns UserInputRequiredError as one step, so the two
halves cannot drift apart. A detector that fails yields UserInputProbeError and
deliberately leaves the page unretained: an undecidable check is not a challenge,
and pinning a browser page for a recovery nobody will perform is worse.

AUTOMATION_SSH_TARGET moves into the service config, where an unusable value
degrades to null rather than failing config loading and killing the service."
```

---

## Task 5: Rewire the widget onto the platform mechanism

**Files:**
- Modify: `packages/widgets/passport-checker/browser/check.ts`
- Modify: `packages/widgets/passport-checker/browser/check.test.ts`
- Modify: `packages/widgets/passport-checker/browser/check.integration.test.ts`
- Modify: `packages/widgets/passport-checker/browser/errors.ts`
- Modify: `packages/widgets/passport-checker/model/check-model.ts`
- Modify: `packages/widgets/passport-checker/package.json`
- Delete: `packages/widgets/passport-checker/browser/challenge.ts`

**Interfaces:**
- Consumes: `makeCloudflarePageDetector`, `makeCloudflareEvidenceDetector`, `evidenceFromResponseText`, `type ChallengeEvidence` from `browser-automation/user-input/cloudflare`; `UserInputRequiredError`, `UserInputProbeError` from `browser-automation/user-input`; `context.detectUserInput` from Task 4.
- Produces: nothing new. `BrowserSessionRequiredError` ceases to exist.

- [ ] **Step 1: Rewrite the handler tests**

In `packages/widgets/passport-checker/browser/check.test.ts` — Task 3 already moved the three Cloudflare describes out and retargeted the `ChallengeEvidence` import, so this task only rewrites the handler tests. The import block becomes:

```ts
// @vitest-environment node
import type { BrowserTaskContext, WidgetSecrets } from 'browser-automation/task-context'
import { UserInputProbeError, UserInputRequiredError } from 'browser-automation/user-input'
import type { ChallengeEvidence } from 'browser-automation/user-input/cloudflare'
import type { Page, Response } from 'playwright'
import { describe, expect, it, vi } from 'vitest'

import { makePassportCheckHandler, readPassportIdentity } from './check'
import {
  BrowserConfigurationError,
  InvalidCheckerResponseError,
  UpstreamResponseError,
} from './errors'
```

Replace `PageScenario` and `makeContext` with:

```ts
type PageScenario = {
  navigationError?: Error
  submissionError?: Error
  navigationStatus?: number
  submit?: SubmitScenario
  /** Consumed in call order by context.detectUserInput. */
  escalations?: Array<UserInputProbeError | UserInputRequiredError | null>
}

function makeContext(scenario: PageScenario) {
  const escalations = [...(scenario.escalations ?? [])]
  // Typed from the context member, not inferred: the tests below read
  // detectUserInput.mock.calls[n][1] to assert which options the handler passed,
  // and an inferred zero-argument mock would type those calls as empty tuples.
  const detectUserInput = vi.fn<BrowserTaskContext['detectUserInput']>(
    async () => escalations.shift() ?? null,
  )
  const goto = vi.fn(async () => {
    if (scenario.navigationError) throw scenario.navigationError
    const status = scenario.navigationStatus ?? 200
    return {
      status: () => status,
      ok: () => status >= 200 && status < 400,
      allHeaders: async () => ({}),
    } as unknown as Response
  })
  // The navigation evidence probe now lives behind detectUserInput, so the only
  // page.evaluate this handler still makes is the passport submission.
  const evaluate = vi.fn(async (_fn: unknown) => {
    if (scenario.submissionError) throw scenario.submissionError

    const submit: SubmitScenario = scenario.submit ?? {
      kind: 'response',
      ok: true,
      body: defaultSubmitBody,
    }
    if (submit.kind === 'network_error') return submit
    return {
      kind: 'response',
      evidence: { ...baseEvidence, ...submit.evidence },
      ok: submit.ok ?? true,
      body: submit.body ?? defaultSubmitBody,
    }
  })
  const context: BrowserTaskContext = {
    page: { goto, evaluate } as unknown as Page,
    secrets: secrets('АБ', '123456'),
    retainPageForRecovery: () => undefined,
    detectUserInput,
  }
  return { context, evaluate, goto, detectUserInput }
}
```

Rewrite the handler describe. Every existing test that asserted `expect(evaluate).toHaveBeenCalledTimes(2)` becomes `1`, and every `expect(retainPageForRecovery).not.toHaveBeenCalled()` becomes an assertion on `detectUserInput` instead:

```ts
const handlerOptions = {
  checkerUrl: 'http://fixture.local/solutions/checker',
  recoverySshTarget: null,
}

describe('passport check handler', () => {
  it('returns only the validated checker result after one submission', async () => {
    const { context, evaluate, detectUserInput } = makeContext({
      submit: {
        kind: 'response',
        ok: true,
        body: { kind: 'json', data: { status: 2, send_status_msg: 'valid', ignored: true } },
      },
    })
    const result = await makePassportCheckHandler(handlerOptions)({}, context)

    expect(result).toEqual({ status: 2, send_status_msg: 'valid' })
    expect(evaluate).toHaveBeenCalledTimes(1)
    expect(detectUserInput).toHaveBeenCalledTimes(2)
  })

  it('returns the navigation escalation without submitting', async () => {
    const escalation = new UserInputRequiredError({ sshTarget: 'pi@myboard.local' })
    const { context, evaluate } = makeContext({ escalations: [escalation] })
    const result = await makePassportCheckHandler(handlerOptions)({}, context)

    expect(result).toBe(escalation)
    expect(evaluate).not.toHaveBeenCalled()
  })

  it('returns a navigation probe failure without submitting', async () => {
    const probeFailure = new UserInputProbeError({ cause: new Error('evaluate failed') })
    const { context, evaluate } = makeContext({ escalations: [probeFailure] })
    const result = await makePassportCheckHandler(handlerOptions)({}, context)

    expect(result).toBe(probeFailure)
    expect(evaluate).not.toHaveBeenCalled()
  })

  it('returns the submission escalation and never re-submits', async () => {
    const escalation = new UserInputRequiredError({ sshTarget: 'pi@myboard.local' })
    const { context, evaluate } = makeContext({
      escalations: [null, escalation],
      submit: { kind: 'response', ok: false, evidence: { hasChallengeForm: true } },
    })
    const result = await makePassportCheckHandler(handlerOptions)({}, context)

    expect(result).toBe(escalation)
    expect(evaluate).toHaveBeenCalledTimes(1)
  })

  // The POST goes through fetch, so the DOM is still the ordinary checker form:
  // without a fresh navigation the human staring at noVNC has no challenge to
  // solve. The prepare hook is how the retained page gets one.
  it('asks for a page reload only on the submission check', async () => {
    const { context, detectUserInput } = makeContext({})
    await makePassportCheckHandler(handlerOptions)({}, context)

    expect(detectUserInput.mock.calls[0]?.[1]).toBeUndefined()
    const submissionOptions = detectUserInput.mock.calls[1]?.[1]
    expect(typeof submissionOptions?.prepare).toBe('function')

    const goto = vi.fn(async () => null)
    await submissionOptions?.prepare?.({ goto } as unknown as Page)
    expect(goto).toHaveBeenCalledWith('http://fixture.local/solutions/checker', {
      waitUntil: 'domcontentloaded',
    })
  })

  it.each([
    [{ kind: 'response', ok: false, evidence: { status: 502 } } as const, UpstreamResponseError],
    [
      { kind: 'response', ok: true, body: { kind: 'invalid_json' } } as const,
      InvalidCheckerResponseError,
    ],
    [{ kind: 'network_error' } as const, UpstreamResponseError],
  ])('maps safe submission outcomes to domain errors', async (submit, ErrorType) => {
    const { context } = makeContext({ submit })
    const result = await makePassportCheckHandler(handlerOptions)({}, context)
    expect(result).toBeInstanceOf(ErrorType)
  })

  it.each([
    ['navigation', { navigationError: new Error('navigation failed') }],
    ['submission', { submissionError: new Error('submission failed') }],
  ] as const)('wraps a Playwright %s rejection as an upstream error', async (_phase, scenario) => {
    const { context } = makeContext(scenario)
    const result = await makePassportCheckHandler(handlerOptions)({}, context)
    expect(result).toBeInstanceOf(UpstreamResponseError)
  })

  it('rejects schema mismatches and responses that echo document identity', async () => {
    for (const data of [
      { status: '1', send_status_msg: 'bad' },
      { status: 1, send_status_msg: 'passport АБ 123456' },
    ]) {
      const { context } = makeContext({
        submit: { kind: 'response', ok: true, body: { kind: 'json', data } },
      })
      const result = await makePassportCheckHandler(handlerOptions)({}, context)
      expect(result).toBeInstanceOf(InvalidCheckerResponseError)
      expect(JSON.stringify(result)).not.toContain('123456')
    }
  })
})
```

Keep `baseEvidence`, `SubmitScenario`, `defaultSubmitBody`, `secrets` and the whole `describe('passport identity', ...)` block exactly as they are.

- [ ] **Step 2: Run the widget tests to verify they fail**

Run: `pnpm --filter widgets-passport-checker exec vitest run browser/check.test.ts`
Expected: FAIL — the handler still calls its own `collectNavigationEvidence`, so `evaluate` is called twice and `detectUserInput` never.

- [ ] **Step 3: Rewrite the handler**

In `packages/widgets/passport-checker/browser/check.ts`:

Replace the challenge import with the platform one:

```ts
import {
  evidenceFromResponseText,
  makeCloudflareEvidenceDetector,
  makeCloudflarePageDetector,
  type ChallengeEvidence,
} from 'browser-automation/user-input/cloudflare'
```

Drop `BrowserSessionRequiredError` from the `./errors` import. Delete the entire `collectNavigationEvidence` function and the module-local `declare const window` / `declare const document` block that only it used. Then replace the handler body's escalation logic:

```ts
export function makePassportCheckHandler(options: PassportCheckHandlerOptions) {
  return async (_payload: PassportCheckPayload, context: BrowserTaskContext) => {
    const identity = readPassportIdentity(context.secrets)
    if (identity instanceof Error) return identity

    const navigation = await context.page
      .goto(options.checkerUrl, { waitUntil: 'domcontentloaded' })
      .catch((cause) => new UpstreamResponseError({ phase: 'navigation', cause }))
    if (navigation instanceof Error) return navigation

    const navigationEscalation = await context.detectUserInput(
      makeCloudflarePageDetector(navigation),
    )
    if (navigationEscalation instanceof Error) return navigationEscalation

    if (navigation && !navigation.ok()) {
      return new UpstreamResponseError({ phase: 'navigation', status: navigation.status() })
    }

    const outcome = await submitPassport(context, identity)
    if (outcome instanceof Error) return outcome
    if (outcome.kind === 'network_error') {
      return new UpstreamResponseError({ phase: 'submission' })
    }

    // The POST went through fetch, so the page still shows the ordinary checker
    // form and a human in the noVNC stream would have nothing to solve. The
    // prepare hook re-navigates so the retained page carries the real challenge;
    // it runs only if the detector matched, and its failure does not cancel the
    // escalation.
    const submissionEscalation = await context.detectUserInput(
      makeCloudflareEvidenceDetector(outcome.evidence),
      { prepare: (page) => page.goto(options.checkerUrl, { waitUntil: 'domcontentloaded' }) },
    )
    if (submissionEscalation instanceof Error) return submissionEscalation

    if (!outcome.ok) {
      return new UpstreamResponseError({
        phase: 'submission',
        status: outcome.evidence.status ?? undefined,
      })
    }
    if (outcome.body.kind === 'invalid_json') return new InvalidCheckerResponseError()

    const parsed = passportCheckResultSchema.safeParse(outcome.body.data)
    if (!parsed.success) return new InvalidCheckerResponseError()
    if (containsIdentity(parsed.data, identity)) return new InvalidCheckerResponseError()
    return parsed.data
  }
}
```

Leave `submitPassportInPage` and its comment untouched — it still splices `evidenceFromResponseText.toString()`, only the import path changed.

- [ ] **Step 4: Run the widget tests to verify they pass**

Run: `pnpm --filter widgets-passport-checker exec vitest run browser/check.test.ts`
Expected: PASS.

- [ ] **Step 5: Delete the widget's leftovers**

In `packages/widgets/passport-checker/browser/errors.ts`, delete `BrowserSessionRequiredErrorOptions` and the whole `BrowserSessionRequiredError` class.

In `packages/widgets/passport-checker/browser/check.integration.test.ts`, change the error import to take the escalation type from the platform:

```ts
import { makeDetectUserInput, UserInputRequiredError } from 'browser-automation/user-input'

import { InvalidCheckerResponseError, UpstreamResponseError } from './errors'
```

Replace every `BrowserSessionRequiredError` occurrence in that file with `UserInputRequiredError` (there are four: the import and one assertion in each of the three recovery tests).

This suite builds its `BrowserTaskContext` by hand around a real Playwright page, and three of its tests assert that the page was retained. Rewire `runCheck` to drive the real escalation semantics and observe retention through the `retain` callback, replacing the `retainPageForRecovery` spy and the temporary `detectUserInput` stub Task 4 added:

```ts
  async function runCheck() {
    const page = await browser.newPage()
    const browserRequests: string[] = []
    page.on('request', (request) => browserRequests.push(request.url()))
    const evaluateSpy = vi.spyOn(page, 'evaluate')
    const retain = vi.fn()
    const definition = makePassportCheckerBrowser({ checkerUrl, recoverySshTarget: null })
    const context: BrowserTaskContext = {
      page,
      secrets: fixtureSecrets(),
      detectUserInput: makeDetectUserInput({ page, recoverySshTarget: null, retain }),
    }
    const result = await definition.handlers.check({}, context)
    if (!retain.mock.calls.length) await page.close()
    return { browserRequests, evaluateSpy, page, result, retain }
  }
```

Then in the three tests that destructure `retainPageForRecovery` from `runCheck()` — `'retains a visible navigation challenge without POST'`, `'maps a POST challenge and prepares recovery without repeating POST'`, and the recovery-navigation-failure test — rename the destructured binding to `retain` and change `expect(retainPageForRecovery).toHaveBeenCalledOnce()` to `expect(retain).toHaveBeenCalledOnce()`.

The recovery-navigation-failure test asserts `expect(warn).toHaveBeenCalledOnce()`. It still holds: the prepare failure is now logged by `makeDetectUserInput` under a different message, still exactly once, and still with the raw cause — so the neighbouring assertion that the log does not contain the passport series stays meaningful.

- [ ] **Step 6: Add the new error message**

In `packages/widgets/passport-checker/model/check-model.ts`, add one entry to `RETRYABLE_MESSAGES`, after `automation_timeout`:

```ts
  user_input_probe: 'Не удалось проверить состояние браузера',
```

Change nothing else in this file — the `browser_session_required` branch and the `sessionRequired` view state stay exactly as they are.

- [ ] **Step 7: Run the full widget and platform suites**

Run: `pnpm --filter widgets-passport-checker test && pnpm --filter widgets-passport-checker typecheck && pnpm --filter browser-automation test`
Expected: all PASS, typecheck silent.

- [ ] **Step 8: Commit**

```bash
git add packages/widgets/passport-checker
git commit -m "refactor(passport-checker): detect required user input through the platform

The handler no longer collects Cloudflare evidence, classifies it, retains the
page and builds the escalation error by hand at every site; it passes a detector
to context.detectUserInput and returns what comes back. browser/challenge.ts and
the widget-local BrowserSessionRequiredError are gone — the classifier now lives
in browser-automation next to the probe that feeds it, and the
browser_session_required contract belongs to the platform that owns the recovery
flow."
```

---

## Task 6: Remove `retainPageForRecovery` from the public context

The point of the design: with only `detectUserInput` exposed, a handler cannot retain a page without escalating, or escalate without retaining.

**Files:**
- Modify: `packages/browser-automation/src/browser/context.ts`
- Modify: `packages/browser-automation/src/browser/chromium-executor.ts`
- Modify: `packages/browser-automation/src/browser/chromium-executor.test.ts`
- Modify: `packages/browser-automation/src/diagnostics.test.ts`
- Modify: `packages/widgets/passport-checker/browser/check.test.ts`

**Interfaces:**
- Consumes: `detectUserInput` from Task 4.
- Produces: `BrowserTaskContext` is `{ page, secrets, detectUserInput }`. `ManagedBrowserTaskContext.retained` stays an internal field.

- [ ] **Step 1: Update the tests to stop using the removed method**

In `packages/browser-automation/src/browser/chromium-executor.test.ts`, replace each of the six `retainPageForRecovery()` calls with the supported equivalent. They appear in these tests:

- `'retains a marked page until the same widget acquires again'` — `first.retainPageForRecovery()` → `await first.detectUserInput(async () => true)`
- `'does not discard another widget recovery page'` — `recovery.retainPageForRecovery()` → `await recovery.detectUserInput(async () => true)`
- `'abort closes a page even after it was marked for recovery'` — `context.retainPageForRecovery()` → `await context.detectUserInput(async () => true)`
- `'shutdown closes a retained recovery page with its persistent context'` — same substitution
- `'reports a retained page only while it is open'` — same substitution
- `'forgets a retained page that Chromium closed on its own'` — same substitution

In `packages/browser-automation/src/diagnostics.test.ts`, delete the `retainPageForRecovery: () => undefined,` line from all three `BrowserTaskContext` literals, leaving `detectUserInput: async () => null,`.

In `packages/widgets/passport-checker/browser/check.test.ts`, delete the `retainPageForRecovery: () => undefined,` line from the literal in `makeContext`.

- [ ] **Step 2: Run tests to confirm they still pass against the current context**

Run: `pnpm --filter browser-automation test`
Expected: PASS. `detectUserInput(async () => true)` retains exactly like the direct call did, so the substitution is behaviour-preserving.

- [ ] **Step 3: Remove the method**

In `packages/browser-automation/src/browser/context.ts`, delete the `retainPageForRecovery(): void` member from `BrowserTaskContext`.

In `packages/browser-automation/src/browser/chromium-executor.ts`, delete the `retainPageForRecovery() { managedContext.retained = true }` property from the `managedContext` literal. `ManagedBrowserTaskContext` keeps its `retained: boolean` field, and `detectUserInput` remains its only writer.

- [ ] **Step 4: Run everything**

Run: `pnpm --filter browser-automation test && pnpm --filter browser-automation typecheck && pnpm --filter widgets-passport-checker test && pnpm --filter widgets-passport-checker typecheck`
Expected: all PASS, typechecks silent. A typecheck error here means something still calls the removed method — fix that caller rather than restoring the member.

- [ ] **Step 5: Commit**

```bash
git add packages/browser-automation packages/widgets/passport-checker
git commit -m "refactor(browser-automation): expose only detectUserInput on the task context

retainPageForRecovery was half of a pair a handler had to assemble correctly by
hand: retaining without escalating strands a browser page, escalating without
retaining hands the UI a recovery session with nothing behind it. With the retain
flag reachable only through detectUserInput, neither mistake is expressible."
```

---

## Task 7: Document the mechanism and run the full gate

**Files:**
- Modify: `packages/browser-automation/README.md`

**Interfaces:**
- Consumes: everything above.
- Produces: nothing in code.

- [ ] **Step 1: Add the author-facing section**

In `packages/browser-automation/README.md`, insert a new section directly after the existing `## Browser recovery: embedded panel and SSH fallback` section and before `## Profile volume`:

````markdown
## Requesting manual input from a widget task

A browser task that cannot finish without a human — a Cloudflare challenge, a
login wall, a captcha — asks the platform to escalate instead of assembling the
escalation itself:

```ts
import { makeCloudflarePageDetector } from 'browser-automation/user-input/cloudflare'

const navigation = await context.page.goto(url, { waitUntil: 'domcontentloaded' })

const escalation = await context.detectUserInput(makeCloudflarePageDetector(navigation))
if (escalation instanceof Error) return escalation
```

`detectUserInput` runs the detector against the live page. If it matches, the
platform retains the page for manual recovery and returns `UserInputRequiredError`
(`code: 'browser_session_required'`), which the widget server turns into HTTP 409
and the client turns into the noVNC recovery view. If the detector cannot decide,
it returns `UserInputProbeError` (`code: 'user_input_probe'`) and leaves the page
unretained. Otherwise it returns `null`.

Retention is not separately reachable: a task cannot hold a page open without
escalating, or escalate without leaving a page behind.

When the evidence does not come from the DOM — for example a `fetch` response
body read inside the page — classify it directly and, if the retained page needs
to be brought into a state a human can act on, pass a `prepare` hook. It runs
only when the detector matched, before the page is retained, and its failure is
logged without cancelling the escalation:

```ts
import { makeCloudflareEvidenceDetector } from 'browser-automation/user-input/cloudflare'

const escalation = await context.detectUserInput(makeCloudflareEvidenceDetector(evidence), {
  prepare: (page) => page.goto(url, { waitUntil: 'domcontentloaded' }),
})
```

A detector is any `(page) => Promise<Error | boolean>`, so a widget facing
something other than Cloudflare writes its own and gets the same handling.

`AUTOMATION_SSH_TARGET` is read once by the service config and attached to the
escalation error as public `sshTarget` meta; widgets neither read nor pass it.
An unusable value degrades to no hint rather than failing service startup.
````

- [ ] **Step 2: Run the full local gate**

Run: `pnpm check`
Expected: lint, format check, workspace typecheck and all tests PASS. If `format:check` complains, run `pnpm format` and re-run `pnpm check`.

- [ ] **Step 3: Run the real-browser integration suite**

This is the only check that proves the spliced `evidenceFromResponseText` source still executes inside Chromium now that it is bundled from a different package. It is `describe.skipIf(!run)` and skipped by every other command in this plan, so it must be run explicitly here.

PowerShell:
```powershell
$env:BROWSER_IT = '1'
pnpm --filter widgets-passport-checker exec vitest run browser/check.integration.test.ts
$env:BROWSER_IT = ''
```

Bash:
```bash
BROWSER_IT=1 pnpm --filter widgets-passport-checker exec vitest run browser/check.integration.test.ts
```

Expected: PASS with the previously skipped tests now executing. Requires Playwright's Chromium to be installed (`pnpm --filter widgets-passport-checker exec playwright install chromium` if it is missing).

If the `post-challenge` fixture fails with a `ReferenceError` from inside the
page, the splice broke: something in `evidenceFromResponseText` now references an
identifier outside its own parameters. Fix the function, not the test.

- [ ] **Step 4: Confirm the untouchable files were not touched**

Run: `git diff --stat main...HEAD -- packages/widgets/passport-checker/ui packages/widgets/passport-checker/server.ts`
Expected: empty output for `ui/` and `server.ts`. Any change there means the `browser_session_required` contract moved and must be restored.

- [ ] **Step 5: Commit**

```bash
git add packages/browser-automation/README.md
git commit -m "docs(browser-automation): document how a widget requests manual input"
```

---

## Definition of done

- `pnpm check` passes.
- The `BROWSER_IT=1` integration run passes.
- `packages/widgets/passport-checker/ui/**` and `server.ts` are byte-identical to their state before Task 1.
- `packages/widgets/passport-checker/browser/challenge.ts` no longer exists, and `rg 'retainPageForRecovery|BrowserSessionRequiredError|PASSPORT_FORCE_RECOVERY' packages docker-compose.yml .env.dev.example` returns nothing.
