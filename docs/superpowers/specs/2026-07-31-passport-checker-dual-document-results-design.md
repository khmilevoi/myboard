# Passport Checker Dual-Document Results Design

**Date:** 2026-07-31

**Status:** Approved

**Builds on:**

- [Passport Checker Widget Design](./2026-07-24-passport-checker-widget-design.md)
- [Passport Checker Tier-Shared State Design](./2026-07-25-passport-checker-tier-shared-state-design.md)
- [Passport Checker Result Persistence Design](./2026-07-26-passport-checker-result-persistence-design.md)

## Goal

Extend the existing passport checker so one user action checks both supported Ukrainian document
types:

1. the ID-card check already in production;
2. an international-passport check using the second `pasport.org.ua` service.

The two requests run sequentially in one retained browser task and produce independent document
results. A technical failure for one document must not erase or suppress a successful result for
the other. Browser challenges remain task-level because they require one human recovery session,
not document-specific handling.

## Current baseline

The widget currently performs one browser POST with `service=1`, returns one
`{ status, send_status_msg }` result, and persists it at the type-scoped shared-server storage key
`lastResult`. The model exposes one success/error state, and both UI tiers render one result.

This change keeps the existing widget RPC event (`check`), browser task, recovery flow, storage
key, widget identity, width breakpoints, and server-side passport secret. It changes the result
contract and the state rendered behind that one action. The user later approved three delivery
exceptions required to keep the result contract truthful in production: height-aware tier floors,
a passport `minH: 4` floor with one-shot migration of older layouts, and explicit empty dev own
secret files so the `dev` group owns the non-production combined identity.

## Scope

- add the international-passport POST to the existing browser task;
- make the browser-task and widget-RPC result describe both documents independently;
- continue to the second POST after a safe technical failure of the first;
- preserve task-level Cloudflare/recovery/configuration failures;
- migrate `lastResult` in place without losing legacy ID-card results;
- render two document rows in standard and tiny tiers using the existing myboard theme;
- cover the new contract, ordering, partial-result, migration, persistence, and UI behavior.

## Non-goals

- No document selector, separate buttons, or separate schedules.
- No new secrets or user-entered passport fields. Both checks use the existing combined `number`
  deployment secret.
- No parallel requests. The service is exercised sequentially and predictably.
- No result history, TTL, background polling, or automatic check on mount.
- No change to the recovery transport, noVNC modal, widget RPC error propagation, or width tier
  breakpoints. Compact/standard/large tiers use the approved 280px height floor, while the
  passport widget's `minH: 4` and one-shot layout migration prevent users from resizing TinyTier
  below its title, two visible outcomes, and action.
- No new design system. The widget continues to use myboard's existing tokens and component
  language.

## Chosen architecture

One browser task performs one navigation followed by two sequential POSTs:

```text
widget check action
  -> widget RPC check
  -> browser task check
      -> read and validate the existing number secret
      -> navigate to /solutions/checker once
      -> detect a navigation challenge
      -> POST ID-card fields
      -> detect a challenge in that response
      -> convert a safe technical outcome to a document result
      -> POST international-passport fields
      -> detect a challenge in that response
      -> convert a safe technical outcome to a document result
      -> return { idCard, internationalPassport }
  -> merge successful document results into lastResult v2
  -> overlay current document errors in memory
  -> render both rows
```

This keeps one browser/profile/session boundary, avoids an extra RPC or queue entry, and gives the
handler enough control to continue after a document-local failure. Two separate browser tasks were
rejected because they would navigate twice, introduce avoidable queue/interleaving behavior, and
make one user action harder to reason about.

## Contracts

### External service response

The response from each `pasport.org.ua` POST keeps its existing validation shape, but receives a
name that distinguishes it from the new aggregate result:

```ts
const passportServiceResponseSchema = z.object({
  status: z.number().int(),
  send_status_msg: z.string(),
})
```

As today, unknown response fields are stripped and any response containing the configured series
or number is rejected before it can cross the browser-task boundary.

### Per-document result

Only errors that are safe and useful to render beside one document travel inside the success
envelope:

```ts
const passportDocumentSuccessSchema = z.object({
  kind: z.literal('success'),
  status: z.number().int(),
  send_status_msg: z.string(),
})

const passportDocumentErrorSchema = z.object({
  kind: z.literal('error'),
  code: z.enum(['upstream_response', 'invalid_checker_response']),
})

const passportDocumentResultSchema = z.discriminatedUnion('kind', [
  passportDocumentSuccessSchema,
  passportDocumentErrorSchema,
])
```

`upstream_response` covers fetch/network failures, a rejected page evaluation, and non-success
HTTP status. `invalid_checker_response` covers invalid JSON, schema mismatch, or an identity echo.
No raw cause, upstream body, document identity, HTTP headers, or status metadata is returned.

### Aggregate check result

The existing `passportCheckResultSchema` becomes the aggregate browser-task and widget-RPC result:

```ts
const passportCheckResultSchema = z.object({
  idCard: passportDocumentResultSchema,
  internationalPassport: passportDocumentResultSchema,
})
```

The event name and payload stay `check` and `{}`. Keeping both branches required makes an omitted
request a contract failure instead of silently rendering stale or incomplete data.

## Browser flow

### Request definitions

The browser module owns a small fixed definition for each document. Both definitions receive the
same validated identity:

| Document | Form fields |
| --- | --- |
| ID card | `service=1`, `doc_1_select=1`, `doc_1_series=<series>`, `doc_1_number6=<number>` |
| International passport | `service=2`, `doc_age=0`, `doc_2_select=1`, `doc_1_series=<series>`, `doc_1_number6=<number>` |

The international-passport request intentionally uses the upstream field names
`doc_1_series` and `doc_1_number6`; those names come from the observed working request and must not
be normalized to a new `doc_2_*` identity shape.

The page-side function continues to construct `FormData` and call
`fetch('/solutions/checker', { method: 'POST', body: formData })`. Browser-generated cookies,
origin, referer, and multipart boundaries remain authoritative; copied request headers and cookie
values are never stored in code.

### Navigation and ordering

The handler reads the secret and navigates once before either request. After the existing
navigation challenge probe succeeds, it loops through the fixed request definitions in this exact
order: ID card, then international passport. The second request is never started before the first
has produced either a success or a safe document error.

### Challenge handling

Every POST response still passes through `makeCloudflareEvidenceDetector`. If user input is
required, `detectUserInput` returns the existing task-level error and the handler stops
immediately:

- a challenge on the first POST prevents the second POST;
- a challenge on the second POST discards the new first-POST outcome from this invocation because
  no aggregate result is returned;
- the `prepare` hook re-navigates the retained page so noVNC shows the real challenge;
- retry after recovery reruns both document requests from the beginning.

Existing stored results are not deleted by this task-level state. They remain masked while the UI
shows recovery, just as the current single-result model behaves.

### Safe failures and continuation

A non-challenge failure while submitting or validating one document becomes that document's
`{ kind: 'error', code }` branch. The loop then proceeds to the next document. This includes a
first-request page-evaluation rejection: the second request is still attempted, even though a
broken page will normally make it fail independently as well.

Navigation failures, invalid configuration, user-input probe failures, browser automation
availability/deadline/protocol errors, and session-required errors remain task-level. The server
continues to map them through the existing `PublicWidgetError` path.

## Server behavior

`server.ts` keeps one `check` handler and invokes the same browser task once. A validated aggregate
result passes through unchanged. The existing mappings for `browser_session_required`,
`browser_configuration`, `user_input_probe`, `browser_unavailable`, `automation_timeout`, and
`automation_protocol` remain global widget errors.

Document-local errors do not pass through `PublicWidgetError`; they are already safe,
schema-validated data in the aggregate result.

## Persistence and migration

### Storage key

The key remains `lastResult` in `storage.shared.server`. Changing it would orphan the existing
cross-placement and cross-device result, so this design migrates only the value schema.

### Schemas

The legacy shape remains readable:

```ts
type LegacyStoredResult = {
  status: number
  message: string
  checkedAt: number
}
```

The new shape stores successful documents independently:

```ts
type StoredDocumentResult = {
  status: number
  message: string
  checkedAt: number
}

type StoredCheckResultV2 = {
  version: 2
  idCard?: StoredDocumentResult
  internationalPassport?: StoredDocumentResult
}
```

`lastResultSchema` is a union of the legacy object and the version-2 object. The v2 schema requires
`version: 2` and allows either document field to be absent so a partial first successful run is
valid.

### Normalization and writes

The model normalizes a legacy value in memory as
`{ version: 2, idCard: legacyValue }`. Hydration does not write this normalized object back; merely
viewing an old result must not create storage traffic or change the persistence contract.

After an invocation returns:

1. normalize the currently stored value;
2. replace each successful document field with its new result;
3. preserve the stored field for each document that failed;
4. write a v2 value only if at least one document succeeded;
5. leave storage untouched if both documents failed.

Before the first storage snapshot, accepted partial successes accumulate in memory and merge over
that snapshot. Only the latest document-error overlay remains transient, so retry feedback still
describes the current failed document without discarding an earlier complementary success.

Each document owns its own `checkedAt`. All successes delivered by one aggregate response may
receive the same client-observation timestamp; separate fields matter because a later partial run
can update one timestamp while preserving the other.

## Model and view state

### Document views

The rendered document state is explicit:

```ts
type DocumentView =
  | { kind: 'success'; status: number; message: string; checkedAtLabel: string }
  | { kind: 'retryable'; message: string }
  | { kind: 'unchecked' }
```

The top-level `ViewState` keeps the current global branches (`idle`, `pending`, `retryable`,
`invalidConfig`, and `sessionRequired`) and replaces the single `success` branch with:

```ts
{
  kind: 'results'
  idCard: DocumentView
  internationalPassport: DocumentView
}
```

`idle` is used only when neither stored document exists and no current document outcome is being
shown. A hydrated legacy value therefore renders `results` with a successful ID card and an
unchecked international passport.

### Transient overlays

The transient atom gains a document-error state containing a partial map by document key. The
computed view always reads storage, then applies transient state:

- global `pending`, retryable, configuration, and recovery states mask the whole result area;
- a current document error masks only the stored result for that document;
- an unaffected document continues to render its stored or newly persisted success;
- a missing stored result without a current error renders `unchecked`;
- a successful retry clears that document's transient error.

This means an ID-card success can remain visible beside a current international-passport error.
The older international-passport success, if one exists, remains in storage but is deliberately
hidden by the current error until a later successful check clears the overlay.

### Deadline and attempt ordering

The current client deadline and attempt-id guard remain. Completion handling now applies the whole
aggregate result: merge successes, then set either the document-error overlay or idle. A late
aggregate result is accepted only if its attempt is still current; a superseded invocation can
never overwrite either document from a newer invocation.

## UI design

The approved mockup uses the actual tokens from `packages/client/src/shared/theme/tokens.css`, the
existing Hanken Grotesk and JetBrains Mono fonts, current widget-frame treatment, and the
passport-checker's existing success/error colors. Light, dark, and system themes continue to come
from the host; no widget-local theme control is added to production.

### Standard tier

- Header: existing ID-card icon chip, title `Паспорт`, and subtitle
  `Проверка ID-карты и загранпаспорта`.
- Results: two stacked status banners labelled `ID-карта` and `Загранпаспорт`.
- Success row: current green treatment, full upstream message, status, and per-document timestamp.
- Error row: current red treatment, safe mapped message, and `техническая ошибка` meta.
- Unchecked row: neutral treatment with `Запустите общую проверку.` and `ещё не проверен` meta.
- Action: `Проверить снова` when both rows are successful, `Повторить` when either row has a
  current error, and `Проверить` when either row is unchecked.

Idle, pending, invalid configuration, session-required, and global retryable states retain their
current layouts and actions. Pending continues to block duplicate queue entries.

### Tiny tier

The tiny tile keeps a compact `Паспорт` header and renders two rows:

- `ID` plus status code, `ошибка`, or `не проверен`;
- `Загран` plus status code, `ошибка`, or `не проверен`.

Rows use the same success/error/neutral semantics as the standard tier but omit full messages and
timestamps. The shared action below them follows the same label rules as the standard tier. The
current global pending/configuration/recovery states remain single-state layouts because no
document result exists for those task-level outcomes.

### Accessibility

- The two standard rows expose their document label as part of the status/alert content.
- Successful and unchecked rows use status semantics; a document-local failure uses alert
  semantics without turning the successful sibling into an alert.
- Tiny rows keep visible text for both the document and outcome; icon-only state is insufficient.
- The single action has an accessible name equal to its visible label.
- Existing widget controls and recovery-modal focus behavior are unchanged.

## Failure behavior summary

| Failure | Scope | Continue to next document? | Storage effect | UI |
| --- | --- | --- | --- | --- |
| Initial navigation/configuration failure | Task | No | None | Existing global error/config state |
| Cloudflare/user input on either POST | Task | No | None | Existing recovery state |
| User-input probe failure | Task | No | None | Existing global retryable state |
| Fetch/evaluate/non-2xx for one POST | Document | Yes | Preserve that document; persist sibling success | Error row beside sibling row |
| Invalid JSON/schema/identity echo for one POST | Document | Yes | Preserve that document; persist sibling success | Error row beside sibling row |
| Browser gateway unavailable/deadline/protocol failure | Task | No aggregate result | None | Existing global retryable state |
| Storage read failure | Persistence | Not applicable | No hydrated value | Idle/current transient state |
| Storage write failure | Persistence | Not applicable | Optimistic local value only | New result remains visible locally |

## Testing

### Contract and server tests

- aggregate schema requires both document branches;
- each success is stripped to safe service fields;
- document errors accept only the two public codes;
- server passes an aggregate result through unchanged and still invokes one empty-payload task;
- existing task-level `PublicWidgetError` mappings remain covered.

### Browser unit tests

- one navigation, then exactly two submissions in ID-card/international-passport order;
- exact form fields for each request, including `doc_age=0` and `doc_2_select=1` only on the
  international-passport request;
- two successes produce the aggregate result;
- first safe technical failure still performs and returns the second result;
- second safe technical failure preserves the first result in the aggregate response;
- two safe failures return two document-error branches;
- navigation challenge performs no POST;
- first-POST challenge stops before the second POST;
- second-POST challenge returns the task-level recovery error and does not repeat either POST;
- invalid response and identity-echo outcomes never serialize the configured identity.

### Real-browser fixture

The opt-in Playwright fixture records both multipart forms and the full request sequence. It covers
the successful two-POST path, safe failure followed by continuation, challenges on each POST,
recovery navigation without POST repetition, and redaction of series/number from every returned or
logged error.

### Model and persistence tests

- legacy `lastResult` hydrates as ID-card success plus unchecked international passport without an
  RPC call or migration write;
- v2 with either or both document fields hydrates correctly;
- two successes replace both stored fields;
- one success plus one error updates only the successful field and overlays the failed field;
- a failed document preserves but masks its older stored success;
- both document errors leave the stored value unchanged;
- a later successful retry clears the affected error overlay;
- complementary partial successes completed before delayed hydration preserve both document fields
  and their individual timestamps;
- per-document timestamp formatting retains the existing same-day/older-day rules;
- live storage updates affect unmasked documents;
- late and superseded aggregate results preserve the existing attempt-order guarantees.

### UI tests

- standard and tiny tiers render two successes, each partial-error direction, two errors, and the
  legacy success/unchecked combination;
- action labels follow success/error/unchecked precedence;
- standard rows expose full messages and timestamps; tiny rows expose compact outcomes only;
- document-local alerts do not replace successful sibling content;
- existing global idle, pending, retryable, invalidConfig, sessionRequired, shared-instance,
  storage-fanout, fullscreen, and recovery tests stay green with aggregate fixtures.

### Verification gate

From the feature worktree:

```powershell
pnpm --filter widgets-passport-checker test
$env:BROWSER_IT='1'; pnpm --filter widgets-passport-checker exec vitest run browser/check.integration.test.ts
pnpm check
pnpm test:e2e:docker
```

The opt-in fixture command runs separately because the normal package suite deliberately skips a
real headed browser unless `BROWSER_IT=1`.

## Expected files

| Area | Files |
| --- | --- |
| Contracts | `packages/widgets/passport-checker/types.ts` |
| Browser flow | `browser/check.ts`, `browser/check.test.ts`, `browser/check.integration.test.ts` |
| Server pass-through | `server.test.ts` and fixture updates where required |
| Model/persistence | `model/check-model.ts`, `model/check-model.test.ts` |
| UI | `ui/parts/StatusBanner.tsx`, `ui/tiers/StandardTier.tsx`, `ui/tiers/TinyTier.tsx`, `ui/passport-checker.module.css`, `ui/PassportChecker.test.tsx` |
| Mechanical contract fixtures | Other passport-checker tests or dev-harness tests that construct the old single result |

No change is expected in recovery transport/model/modal files beyond mechanical type-fixture
updates if their tests construct a check result directly.

## Delivery

Implementation follows the repository feature workflow: create a dedicated worktree and feature
branch from `origin/dev`, implement and verify there, then open a PR into `dev`. This specification
does not authorize deployment or release work.

## Decision summary

One check action remains one RPC and one browser task. That task navigates once and performs the ID
card and international-passport POSTs sequentially. Safe technical failures become independent
document results so the second request still runs; Cloudflare and infrastructure failures stay
global. The existing `lastResult` key accepts both its legacy ID-only value and a versioned v2
value, merges successful document fields, and retains failed documents' older successes without
displaying them over a current error. Standard and tiny tiers render two rows using the current
myboard theme and retain the existing recovery flow unchanged.
