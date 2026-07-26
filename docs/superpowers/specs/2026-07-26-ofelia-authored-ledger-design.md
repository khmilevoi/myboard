# Ofelia: authored ledger and comments — design

Date: 2026-07-26
Branch: `feat/ofelia-authored-ledger`
Design mock: `design/Офелия - история и комментарии.dc.html` + `design/OfeliaPanels.dc.html`
Design prompt: `docs/superpowers/specs/designs/2026-07-26-ofelia-history-comments-prompt.md`

## Problem

Every record the Ofelia widget writes — a ledger entry or a comment — is signed with `currentUser`,
an atom fed by a "Я: Леша / Карина" toggle that is persisted in `storage.shared.client`, i.e. **per
device**. Two people sharing one tablet sign as the same person. The signature is a preference, not
an identity.

The board now has real authentication (WebAuthn passkeys, accounts, sessions). Records should carry
the account that actually created them.

Three further defects in the same surface:

- The history row prints the raw ISO duty date (`2026-06-16`).
- It prints an IP tail, which is noise.
- The ledger is append-only and `latestOutcomesByDate` picks one winner per day, but **a superseded
  entry renders identically to the live one**. A day that was reopened and re-closed shows three
  rows and nothing says which one counts.

## Goals

- Ledger entries and comments carry the authenticated account that created them, stamped by the
  server and not forgeable by the client.
- Widgets can resolve *any* account to a display name (and later an avatar), not just their own.
- The widget knows who is viewing, so it can mark the viewer's own records.
- The history row becomes readable: human dates, plain-language phrases, explicit debt effect,
  visible supersession, visible late recording.
- The IP disappears from records and from the UI.

## Non-goals

- Linking accounts to duty-rotation people. They stay independent axes (decided below).
- Avatar upload. The contract leaves room for `avatarUrl`; nothing renders it yet.
- Per-account gender in copy. Generic forms are used instead (decided below).
- Moving any other widget to `server.ts`.

## Decisions

| # | Decision | Rejected alternative |
|---|---|---|
| 1 | Two accounts exist, one per person; account identity meaningfully distinguishes people. | — |
| 2 | Duty rotation and account stay **unlinked**. Every record shows both the duty person and the recording account, even when they are the same human. | Matching `account.name` against `DUTY_ROTATION`; an explicit `accountId → Person` map. |
| 3 | The "Я:" toggle is **removed**. Identity comes from the session; there is nothing to choose. | Repurposing it as an "acting on behalf of" selector — `actor`/`onBehalfOf` are already derived from the schedule and debts. |
| 4 | Write logic moves into the widget's own `server.ts`, which resolves the session from the cookie. The generic `/api/storage/:key/append` is not given an identity. | Stamping identity inside `handleAppend`; passing identity from the client into the draft. |
| 5 | Records store `createdBy: { accountId, name }`; **display resolves through a members directory** by `accountId`, falling back to the stored `name`. | Storing only a denormalized name (renames and future avatars would never reach old rows); storing only `accountId` (another account's name is not resolvable client-side). |
| 6 | `createdBy` carries account only, **no device label**. | Adding `deviceLabel` from the session's `credentialId`. |
| 7 | Node moves to 26 as part of this work, taking the prerequisite out of the widget-server-cron spec. | Shipping `@js-temporal/polyfill` into the server bundle. |
| 8 | Copy uses generic gender forms: `убрал(а)`, `ушёл(ла)`, `простил(а)`, `отметил(а)`. | A gender field on the roster and on `AccountRecord`. |
| 9 | Account circle colour is derived from a hash of `accountId`. | A fixed two-colour palette; reusing the duty-rotation palette. |
| 10 | No "signed in as" affordance in the panel header. The freed `UserToggle` slot stays empty; the viewer's circle appears only as the comment composer's left adornment. | Adding a header avatar. |

## Prerequisite: align Node on 26

Lifted verbatim from `2026-07-26-widget-server-cron-design.md`, which no longer has to carry it.

Node versions are currently split: Docker images run 22, local development runs 24, and the
`@types/node` catalog entry is `^25.9.3` — types ahead of every runtime. Everything moves to 26.

Node 26 ships `Temporal` natively (verified in that spec: `node:26-alpine`, V8 14.6), and
TypeScript 7 already ships `lib.esnext.temporal.d.ts` via `lib: ["ESNext"]`. That is what makes it
possible to move Ofelia's `Temporal`-heavy date logic into code the server executes.

Node 26 is Current, not LTS — it becomes LTS in October 2026. Accepted knowingly.

Changes:

- `packages/server/Dockerfile` (3 stages), `packages/client/Dockerfile` (2 stages),
  `packages/browser-automation/Dockerfile` (2 alpine stages + `node:22-bookworm-slim` runtime)
  → `node:26-alpine` / `node:26-bookworm-slim`.
- `docker-compose.dev.yml`: 4 services on `node:22-alpine` → `node:26-alpine`.
- Catalog `@types/node`: `^25.9.3` → `^26`.
- Add `.nvmrc` (`26`) and `engines.node` in the root `package.json` so the split cannot silently
  return.
- `packages/server/tsconfig.json`: `lib: ["ES2022"]` → include `ESNext`, otherwise `Temporal` has
  no global types in server code.
- Drop `execArgv: ['--harmony-temporal']` from `packages/widget-runtime/vitest.config.ts`,
  `packages/client/vite.config.ts` and `packages/widget-sdk/src/vite/widget-vite-config.ts`. On 26
  the flag is a no-op that would break silently if V8 ever dropped it.
- The `vm.runInThisContext('Temporal')` shims in `packages/client/src/vitest.setup.ts`,
  `packages/widget-runtime/vitest.setup.ts` and `packages/widget-sdk/src/test/widget-setup.ts`
  **stay**: jsdom is a separate realm and does not inherit Node's global `Temporal`.
- `ensureTemporal` in the widget's `client.ts` **stays**: it is about browsers, not Node.

The one image that can actually break is `browser-automation` — it installs Playwright with system
dependencies on `bookworm-slim`. Build and exercise it explicitly.

## Architecture

### Identity on the server

`WidgetServerContext` (`packages/shared/widgets/contracts.ts:48`) gains one field:

```ts
export type WidgetViewer = { accountId: string; name: string }

export type WidgetServerContext = {
  typeId: string
  instanceId: string
  ip: string | null
  viewer: WidgetViewer | null
  now: () => number
  api: { storage: …; browser: … }
}
```

Resolved once per request in `POST /api/widgets/:typeId/:event` (`packages/server/src/app.ts:293`):
`requireSession(authDeps, req)` → `SessionRecord.accountId` → account record → `{ accountId, name }`.

`null` is a valid state, not an error: the widget dev harness and e2e runs without nginx have no
session. The event still executes and the record is written with `createdBy: null`. A failed
session lookup does **not** reject the request — the nginx `auth_request` gate
(`packages/client/nginx.conf:88`) is what actually guards `/api/`, and duplicating a hard 401 here
would break the harnesses for no security gain.

### Members directory

New session-gated endpoint `GET /api/auth/accounts` returning every account on the board, plus
which one the caller is:

```ts
type AccountsResult = {
  accounts: Array<{ accountId: string; name: string }>
  viewerAccountId: string
}
```

`viewerAccountId` comes from the request's own `SessionRecord`, the same way `getDevices` already
derives `thisCredentialId`. It exists so the client needs exactly one fetch to answer both "who is
everyone" and "which one am I".

`avatarUrl` joins this shape when avatars ship. This endpoint is the reason a rename or a future
avatar reaches *old* history rows: display resolves by `accountId`, and only falls back to the
`name` frozen in the record when the account is absent from the directory.

Storage is already board-wide and unscoped by account, so exposing the roster introduces no new
access model.

### Identity on the client

`WidgetRuntimeProps` (`packages/widget-runtime/src/types.ts:11`) gains `identity`:

```ts
export type BoardMember = { accountId: string; name: string; avatarUrl?: string }

export type WidgetIdentity = {
  viewer: Computed<BoardMember | null>
  members: Computed<ReadonlyMap<string, BoardMember>>
}
```

Built in `makeHostRuntime` (`packages/widget-runtime/src/host-runtime.ts:36`), next to the
`HttpClient` and the SSE manager and with the same laziness: the first read triggers the fetch,
every other widget reuses it, harnesses that never read it never fetch. One directory per document.

`viewer` is `members.get(viewerAccountId)` from that single response, so no second endpoint is
involved.

Two Reatom hazards this repo has already been bitten by, both to be respected in the
implementation, not re-litigated:

- an atom read inside `withConnectHook` resolves once and is not reactive — dynamic work belongs in
  an `effect()` inside the hook;
- a `wrap()`ed closure hoisted to module scope aborts after `context.reset()` — call `wrap(fn)()`
  fresh per invocation.

### Widget domain module

New `packages/widgets/ofelia-poop-duty/domain/`, moved out of `model/ofelia-duty.ts`:

- ledger schemas and types (`LedgerEntrySchema`, `LedgerEntriesSchema`, `LedgerType`, `Person`);
- constants `DUTY_ROTATION`, `BASE_DUTY_DATE`, `DUTY_TIME_ZONE`, `LEDGER_KEY`, `commentsKey`;
- pure functions `latestOutcomesByDate`, `resolveDays`, `foldDebt`, `normalizeDebts`,
  `getOfeliaDutyByDate`, `getDebtDays`, `effectiveDuty`, `isDebtDay`, `weekStartISO`, `otherPerson`,
  `isOverDebtWarning`;
- **draft construction** for all four ledger actions, as pure functions (see below).

`model/ofelia-duty.ts` keeps only the Reatom model.

The module boundary is dictated by the server build and the constraint is hard:

- the runtime image runs `pnpm install --filter server --prod`, so **none** of the widget's own
  dependencies exist there. `domain/**` may import only what `packages/server` depends on — in
  practice `zod` — plus the `Temporal` global;
- rspack externalizes every request that does not start with `.`, `@shared` or `@widgets`, so the
  widget's `@/` alias must not appear in `domain/**` or `server.ts`; those files use relative
  imports. Client-side `model/` and `ui/` keep using `@/domain/...` exactly as they use
  `@/model/...` today.

Enforced with an `overrides` entry in `.oxlintrc.json` for `packages/widgets/*/domain/**`, banning
`@reatom/*`, `react`, `react-dom`, `widget-runtime`, `widget-sdk` and `@/` via
`no-restricted-imports`. `pnpm deps:check` is syncpack — it checks versions, not boundaries.

`BASE_DUTY_DATE` stops being a `Temporal.PlainDate` evaluated at module load and becomes an ISO
string; `Temporal` is only touched inside function bodies, so the module is safe to import before
any polyfill has been installed.

### Widget server events

New `packages/widgets/ofelia-poop-duty/server.ts`:

| event | payload | effect |
|---|---|---|
| `clean` | `{ date: IsoDate }` | appends `cleaned` |
| `debt` | `{ date: IsoDate }` | appends `went_into_debt` |
| `forgive` | `{ date: IsoDate }` | appends `forgiven` |
| `undo` | `{ date: IsoDate }` | appends `reset` |
| `comment` | `{ weekStart: IsoDate; text: string }` | appends to `comments:<weekStart>` |

All results are `{ ok: true }`; the new state reaches every client over SSE, exactly as it does
today.

Each ledger handler:

1. reads the ledger through `context.api.storage.shared.get(LEDGER_KEY, LedgerEntriesSchema)`;
2. derives `today` in `Europe/Warsaw` from `context.now()`;
3. folds debts and day resolutions with the domain functions;
4. builds the draft with the matching domain function;
5. appends it with `createdBy: context.viewer`.

The client sends intent only. `actor`, `onBehalfOf`, `id`, `ts` and `createdBy` are all computed
server-side, so no client can write a record that claims something the schedule does not support.

**Guards become no-ops, not errors.** Today `forgive` returns early when the target is not a debt
day and `undo` returns early when the day is not closed. Server-side those become silent successful
no-ops, mirroring the current behaviour. Only genuine failures (storage unavailable, malformed
stored value) return an `Error`, which `dispatchWidgetEvent` turns into a `WidgetHandlerError`.

**The read-then-append race is benign and stays.** `WidgetServerStorage.append`
(`packages/server/src/widgets/storage.ts:110`) runs under `runExclusive`, but the handler's read
happens outside that lock, so two simultaneous clicks can both append. That cannot corrupt the
balance: `latestOutcomesByDate` keeps one winner per date, so the loser renders as a superseded row
and `foldDebt` ignores it. If it ever needs fixing, the shape is a lock-scoped `update(key, fn)`
primitive on `WidgetServerStorage`, not a client-side guard.

### Records

```ts
const CreatedBySchema = z.object({ accountId: z.string(), name: z.string() })

const LedgerEntrySchema = z.object({
  id: z.string(),
  ts: z.number(),
  date: z.string(),
  type: LedgerTypeSchema,
  actor: PersonSchema,
  onBehalfOf: PersonSchema.optional(),
  createdBy: CreatedBySchema.nullish(),
  by: PersonSchema.optional(),        // legacy: pre-account signature, read-only
})

const CommentSchema = z.object({
  id: z.string(),
  ts: z.number(),
  text: z.string(),
  createdBy: CreatedBySchema.nullish(),
  author: PersonSchema.optional(),    // legacy: pre-account signature, read-only
})
```

The `ledger` and `comments:<weekStart>` **keys do not change**, so there is no migration and no risk
of the orphaning failure documented in `CLAUDE.md`. `ip` simply stops being declared: Zod strips it
from old records, and both append paths stop writing it —
`packages/server/src/storage/handlers.ts:40` and `packages/server/src/widgets/storage.ts:127`. The
generic `/api/storage/:key/append` gets no identity in exchange; after this change Ofelia is its
only former caller. `clientIp` stays in use for the auth audit log and for `WidgetServerContext.ip`.

Authorship reaches the UI as a discriminated union so the view knows which circle to draw:

```ts
type EntryAuthor =
  | { kind: 'account'; accountId: string; name: string; avatarUrl?: string }
  | { kind: 'person'; person: Person }   // legacy `by` / `author`
  | { kind: 'unknown' }                  // createdBy: null
```

One pure resolver takes `createdBy`, the legacy field and `identity.members()` and returns
`EntryAuthor`. It is unit-tested without atoms and shared by history and comments.

## Widget model

Removed: `currentUser`, `UserToggle` (+ CSS + test), `onSetUser` from `OfeliaActions`, `currentUser`
from `ofelia-context` and the fixture, the `currentUser` key in `storage.shared.client`,
`IP_TAIL_LENGTH`, and `ipTail` from both view types.

The four ledger actions and `send` stop calling `storage.shared.server.append` and call
`api.invoke(...)`. `withAsyncData({ status: true })` stays — the pending state is unchanged.

```ts
type HistoryEntryView = {
  id: string
  type: LedgerType
  actor: Person
  onBehalfOf?: Person
  dutyDate: string                 // ISO
  recordedAt: number
  recordedBy: EntryAuthor
  isViewerRecord: boolean
  recordedLate: boolean            // Warsaw calendar date of recordedAt ≠ dutyDate
  debtDelta: { person: Person; amount: 1 | -1 } | null
}

type HistoryDayGroup = {
  dutyDate: string
  current: HistoryEntryView        // the day's winner; always present
  superseded: HistoryEntryView[]   // newest first
}

type CommentView = {
  id: string
  text: string
  author: EntryAuthor
  createdAt: number
  isViewerComment: boolean
}
```

`current` is always present because every `LedgerType` is in `DAY_OUTCOME_TYPES`, so a group cannot
exist without a winner. `debtDelta` follows the same rules as `foldDebt`: `cleaned` with
`onBehalfOf` → −1 for `actor`; `went_into_debt` → +1 for `onBehalfOf`; `forgiven` → −1 for
`onBehalfOf`; everything else → `null`.

Groups descend by `dutyDate`; `superseded` descends by `recordedAt`.

All formatting — dates, weekday names, relative day labels, pluralization, action phrases — lives in
`ui/format.ts` alongside `MONTHS_GENITIVE`, `pluralizeDays` and `formatWeekRange`. Components
receive finished strings.

## UI

Only `large` and `fullscreen` are touched; both render `RichLayout`. `tiny`, `compact` and
`standard` show neither panel and are untouched. The mock is authoritative for spacing and colour;
this section records the decisions it encodes.

**Two circle kinds, distinguished by shape.** Duty person → a circle (existing `Avatar`), initial
plus the rotation-slot colour. Account → a rounded square (`MemberAvatar`, new): an image slot that
currently falls back to the initial, coloured from a hash of `accountId` over a palette of six
token pairs. Colour alone must not be the differentiator — the two kinds sit in the same row.

**Row anatomy.** Line one is the action phrase with duty circles inline plus the debt pill (the
affected person's mini circle and `+1 день` / `−1 день`, red for `+`, green for `−`). Line two is
the signature: account square, `отметил(а) <имя>`, monospace time, and — when `recordedLate` — a
Clock chip with the duty-relative date.

**Phrases**, with generic gender forms:

| `type` | phrase | debt |
|---|---|---|
| `cleaned`, no `onBehalfOf` | `[Л] убрал(а)` | — |
| `cleaned` with `onBehalfOf` | `[Л] убрал(а) за [К]` | −1 for `actor` |
| `went_into_debt` | `[К] ушёл(ла) в долг → убирает [Л]` | +1 for `onBehalfOf` |
| `forgiven` | `[Л] простил(а) день [К]` | −1 for `onBehalfOf` |
| `reset` | `день переоткрыт` | — |

On a `reset` entry `actor` is *whose closure was undone*, not who undid it (`undo` writes
`actor: resolution.actor`). The phrase must never name a person as the one who reopened the day.

**Supersession.** The winner renders first; superseded entries are nested beneath it, indented
behind a dashed rail, dimmed, phrase struck through, tagged `перекрыто`. Two implementation traps
from the mock: `line-through` propagates into inline circles and must be neutralized on the pill's
mini circle, and the dimming must be re-checked for contrast in dark theme.

**Author states.** Viewer's own record → a ring on the account square, never the word "вы". Legacy
author → the duty circle stands in, with a `без аккаунта` marker. Unknown author → dashed square
with `?` and `автор неизвестен`. Directory still loading → neutral square plus a skeleton bar of
the same size, so nothing reflows when names arrive.

**Groups.** Sticky header per duty day: `сегодня` / `вчера` / `19 июня`, weekday, hairline rule, and
an entry counter when the day holds more than one record. The column header carries the week's total.

**Comments.** Account square, name, time (relative day for older ones), text. The single-line
composer stays pinned to the bottom, with the viewer's account square as its left adornment,
placeholder `Написать комментарий…` and a `Send` button (`aria-label="Отправить"`).

**Header.** `UserToggle` is removed and nothing replaces it.

**Responsive.** `RichLayout.module.css` already collapses the two columns into `MobileTabs` at
`@container rich-layout (max-width: 52rem)`. The mock expresses the same collapse as
`@container (max-width: 480px)` on a container scoped to the panels themselves. Keep the existing
`rich-layout` container query — one container, one breakpoint — rather than introducing a second
container box.

New tokens on `.widget` in `ofelia-poop-duty.module.css`, defined for both themes: a debt pair
(`--ofelia-debt-soft`, `--ofelia-debt-fg`) and six account pairs
(`--ofelia-member-{1..6}-bg` / `-fg`). Icons: `Clock`, `Undo2`, `Send` from `lucide-react`.

Empty states are unchanged: `Пока нет событий` / `Пока нет комментариев`.

## Testing

- **Domain** (`domain/*.test.ts`, no atoms): draft construction for each of the four actions against
  a ledger fixture, including the debt-day and forgiveness branches; `foldDebt` / `resolveDays`
  regressions kept from `model/ledger.test.ts`.
- **Author resolver**: account present in the directory, account missing (falls back to the frozen
  name), legacy `by` / `author`, `createdBy: null`, and the viewer match.
- **Widget server handlers** (fake storage, fixed `now`, `viewer` present and `null`): each event
  writes the expected entry; `forgive` on a non-debt day and `undo` on an open day are silent
  no-ops; a storage error surfaces as an `Error`.
- **Dispatch**: `viewer` is resolved from the session cookie and is `null` without one.
- **`GET /api/auth/accounts`**: 401 without a session, full roster with one.
- **Model** (`model/*.test.ts`): the four actions invoke the right events with the right payloads;
  `historyView` grouping puts the winner in `current` and the rest in `superseded`; `debtDelta`,
  `recordedLate` and `isViewerRecord` per type.
- **UI** (`ui/parts/*.test.tsx`): every author state renders its own circle kind; a superseded row is
  marked; no IP is rendered anywhere; `UserToggle` is gone from every tier.
- **e2e** (`packages/client/e2e`): the existing Ofelia journeys must keep passing with the toggle
  removed and the actions going through `api.invoke`.

`pnpm check` plus `pnpm test:e2e:docker` are the gate. The `browser-automation` image is built and
exercised explicitly because of the Node bump.

## Impact on the widget-server-cron spec

`docs/superpowers/specs/2026-07-26-widget-server-cron-design.md` (approved, not started) overlaps
this work and needs four edits once this lands:

1. **"Prerequisite: align Node on 26"** — done here, drop it.
2. **"Shared domain module"** and **"Shared draft construction"** — done here, reduce to a reference.
3. **`by: Person | 'system'`** — `by` is legacy and read-only after this change. A cron-written entry
   is `createdBy: null` plus an explicit source marker; pick that marker in the cron spec rather
   than widening `by`.
4. **"the same slot that holds the IP tail shows an `авто` marker"** — there is no IP slot any more.
   The system marker belongs in the signature line, next to where the account square would be.

## Rollout

Ordinary feature flow: branch → PR into `dev` → `rpi deploy --env dev` → verify → PR into `main`.

Nothing about the data needs coordination: keys are unchanged, old records stay valid, and old
clients keep reading new records (they ignore `createdBy` and find `ip` missing, which only blanks
a chip). The one-way step is that a client deployed after this change writes through `api.invoke`
and a server deployed before it has no such event — so the server ships in the same release as the
client, which the single-image deploy already guarantees.
