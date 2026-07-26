# Ofelia Authored Ledger Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Ledger entries and comments in the Ofelia widget carry the authenticated account that created them, written by the widget's own server code, and the history panel becomes readable.

**Architecture:** Ofelia's pure date/ledger logic moves into a dependency-free `domain/` folder shared by its Reatom model and a new `server.ts`. The widget dispatch route resolves the session cookie into a `viewer` and hands it to the handler, which builds the entry and appends it — the client only sends intent. A new board-members endpoint lets any widget resolve an `accountId` to a display name, so renames and future avatars reach old rows.

**Tech Stack:** Node 26, TypeScript 7, Valkey (iovalkey), zod 4, Vitest, Playwright, rspack, Reatom 1001, React 19.

**Spec:** `docs/superpowers/specs/2026-07-26-ofelia-authored-ledger-design.md`
**Design mock:** `design/OfeliaPanels.dc.html` (the component) and `design/Офелия - история и комментарии.dc.html` (the frames). Open them in a browser before Tasks 12–14.

## Global Constraints

- **Node 26 everywhere.** Docker images `node:26-alpine` / `node:26-bookworm-slim`, `.nvmrc` = `26`, `engines.node` = `>=26`. Tasks 2+ assume `node -v` reports v26 locally.
- **errore style.** Functions return `Error | T` unions and narrow with `instanceof Error`. Do not throw, do not use try/catch for control flow. Tagged errors are declared with `errore.createTaggedError`.
- **Factories are named `make*`, never `create*`.** Existing `create*` names stay as they are; every new one in this plan is `make*`.
- **No import may start with `../../`.** `.oxlintrc.json` bans it (`^(\.\./){2,}`).
- **Widget `domain/**` may import only `zod`, `@shared/*` and JS/Temporal globals.** No Reatom, React, `widget-runtime`, `widget-sdk`, and no `@/` alias — rspack externalizes any request that does not start with `.`, `@shared` or `@widgets`, and the server runtime image installs only `packages/server`'s prod dependencies.
- **Storage key shapes are a persistence contract.** This plan changes **no** key: `ledger` and `comments:<weekStartISO>` stay byte-identical.
- **Every exported React component is wrapped in `reatomMemo` from `widget-sdk`.**
- **Code, comments, commit messages and docs in English. UI copy in Russian.**
- **UI copy uses generic gender forms**: `убрал(а)`, `ушёл(ла)`, `простил(а)`, `отметил(а)`. Never a gendered form, never a gender field.
- **Run a single test file with** `pnpm --filter <pkg> exec vitest run <path>`; the widget package is `--filter widgets-ofelia-poop-duty`.
- **This plan overlaps `feat/widget-server-cron`.** It lands first; that branch rebases onto it. Do not implement anything cron-related here.

## File Structure

**Server**

| File | Responsibility |
|---|---|
| `packages/server/src/auth/accounts.ts` | +`listAccounts` — every account record on the board |
| `packages/server/src/auth/device-handlers.ts` | +`getAccounts` — the `/api/auth/accounts` handler |
| `packages/server/src/auth/index.ts` | +route registration |
| `packages/server/src/widgets/viewer.ts` | **new** — session cookie → `WidgetViewer \| null` |
| `packages/server/src/widgets/dispatch.ts` | threads `viewer` into `WidgetServerContext` |
| `packages/server/src/widgets/storage.ts` | stops stamping `ip` |
| `packages/server/src/storage/handlers.ts` | stops stamping `ip` |
| `packages/shared/widgets/contracts.ts` | +`WidgetViewer`, +`WidgetServerContext.viewer` |

**Widget runtime**

| File | Responsibility |
|---|---|
| `packages/widget-runtime/src/identity.ts` | **new** — `WidgetIdentity`, its fetch, and a static test double |
| `packages/widget-runtime/src/host-runtime.ts` | owns the one identity per document |
| `packages/widget-runtime/src/types.ts` | +`WidgetRuntimeProps.identity` |

**Widget domain** (all new, all dependency-free)

| File | Responsibility |
|---|---|
| `domain/roster.ts` | rotation, time zone, duty-by-date, week start |
| `domain/ledger.ts` | ledger schemas, `latestOutcomesByDate`, `resolveDays` |
| `domain/debt.ts` | debt folding and debt-day assignment |
| `domain/comments.ts` | comment schema and `commentsKey` |
| `domain/author.ts` | `EntryAuthor` and the pure resolver |
| `domain/drafts.ts` | one pure draft builder per action |
| `domain/events.ts` | the five event schemas, shared by `server.ts` and the client model |

**Widget**

| File | Responsibility |
|---|---|
| `server.ts` | **new** — five handlers, the only writer of ledger and comments |
| `model/ofelia-duty.ts` | Reatom model only; actions become `api.invoke` calls |
| `model/ofelia-comments.ts` | same, for comments |
| `ui/member.ts` | **new** — account tone hash and initial |
| `ui/parts/MemberAvatar.tsx` | **new** — the account circle, one per `EntryAuthor` kind |
| `ui/parts/HistoryList.tsx` | rebuilt around day groups |
| `ui/parts/CommentThread.tsx` | rebuilt around `EntryAuthor` |
| `ui/parts/UserToggle.tsx` | **deleted** |

---

### Task 1: Align every Node version on 26

**Files:**
- Modify: `packages/server/Dockerfile:7,13,41`
- Modify: `packages/client/Dockerfile:8,13`
- Modify: `packages/browser-automation/Dockerfile:6,12,38`
- Modify: `docker-compose.dev.yml:56,64,90,104`
- Modify: `pnpm-workspace.yaml` (catalog `@types/node`)
- Modify: `package.json` (add `engines`)
- Create: `.nvmrc`
- Modify: `packages/server/tsconfig.json:4`
- Modify: `packages/widget-runtime/vitest.config.ts:15`
- Modify: `packages/client/vite.config.ts:302`
- Modify: `packages/widget-sdk/src/vite/widget-vite-config.ts:65`

**Interfaces:**
- Consumes: nothing.
- Produces: a toolchain where `Temporal` is a real global in Node code (`packages/server` included), which Tasks 7–9 depend on.

- [ ] **Step 1: Confirm the local runtime is already 26**

Run: `node -v`
Expected: `v26.x.x`. If it is not, install Node 26 first (`nvm install 26 && nvm use 26`) — the rest of this plan assumes it.

- [ ] **Step 2: Bump the base images**

In `packages/server/Dockerfile`, `packages/client/Dockerfile` and `packages/browser-automation/Dockerfile` replace every `FROM node:22-alpine` with `FROM node:26-alpine`, and the single `FROM node:22-bookworm-slim AS runtime` in `packages/browser-automation/Dockerfile` with `FROM node:26-bookworm-slim AS runtime`.

In `docker-compose.dev.yml` replace all four `image: node:22-alpine` with `image: node:26-alpine`.

- [ ] **Step 3: Pin the toolchain**

In `pnpm-workspace.yaml`, catalog entry:

```yaml
  '@types/node': ^26.1.1
```

Create `.nvmrc`:

```
26
```

In the root `package.json`, add next to `"private"`:

```json
  "engines": {
    "node": ">=26"
  },
```

- [ ] **Step 4: Give server code the Temporal types**

`packages/server/tsconfig.json` — `lib` must include `ESNext`, which is what pulls in `lib.esnext.temporal.d.ts` under TypeScript 7:

```json
    "lib": ["ES2022", "ESNext"],
```

- [ ] **Step 5: Drop the now-redundant harmony flag**

Node 26 ships Temporal unflagged. Remove the line `execArgv: ['--harmony-temporal'],` from `packages/widget-runtime/vitest.config.ts`, `packages/client/vite.config.ts` and `packages/widget-sdk/src/vite/widget-vite-config.ts`.

Do **not** touch the `vm.runInThisContext('Temporal')` blocks in `packages/client/src/vitest.setup.ts`, `packages/widget-runtime/vitest.setup.ts` or `packages/widget-sdk/src/test/widget-setup.ts`. jsdom is a separate realm and does not inherit Node's global `Temporal`; those blocks are what copy it across and they are still required.

- [ ] **Step 6: Reinstall and verify the workspace**

Run: `pnpm install`
Then: `pnpm typecheck`
Expected: PASS.

Then: `pnpm test`
Expected: PASS. If a Temporal-using test fails with `Temporal is not defined`, Step 5 removed a flag that was still doing work — restore it in that package and note it in the commit message.

- [ ] **Step 7: Verify the images that can actually break**

Run: `docker build -f packages/server/Dockerfile -t myboard-server:node26 .`
Expected: build succeeds.

Run: `docker build -f packages/browser-automation/Dockerfile -t myboard-browser:node26 .`
Expected: build succeeds. This is the risky one — it installs Playwright with system dependencies on `bookworm-slim`.

- [ ] **Step 8: Commit**

```bash
git add -A
git commit -m "chore(node): align every runtime and image on Node 26"
```

---

### Task 2: Extract Ofelia's pure domain out of the Reatom model

**Files:**
- Create: `packages/widgets/ofelia-poop-duty/domain/roster.ts`
- Create: `packages/widgets/ofelia-poop-duty/domain/ledger.ts`
- Create: `packages/widgets/ofelia-poop-duty/domain/debt.ts`
- Create: `packages/widgets/ofelia-poop-duty/domain/comments.ts`
- Modify: `packages/widgets/ofelia-poop-duty/model/ofelia-duty.ts`
- Modify: `packages/widgets/ofelia-poop-duty/model/ofelia-comments.ts`
- Modify: every consumer of the moved symbols (mapping table below)
- Modify: `.oxlintrc.json`
- Test: move `model/ledger.test.ts` → `domain/ledger.test.ts`; split the pure half of `model/ofelia-duty.test.ts` into `domain/debt.test.ts` and `domain/roster.test.ts`

This is a pure move — **no behaviour changes**. Everything after it depends on it, because `server.ts` cannot import a file that pulls in Reatom.

**Interfaces:**
- Consumes: Task 1's Node 26 toolchain.
- Produces (named exactly as today unless noted):
  - `domain/roster.ts`: `DUTY_TIME_ZONE`, `BASE_DUTY_DATE_ISO` (**renamed**, now a string), `DUTY_ROTATION`, `DutyPerson`, `Person`, `PersonSchema`, `IsoDateSchema` (**new**), `plainDateIn` (**new**), `getOfeliaDutyByDate`, `otherPerson`, `getStartOfWeek`, `weekStartISO`
  - `domain/ledger.ts`: `LEDGER_KEY`, `LedgerTypeSchema`, `LedgerType`, `LedgerEntrySchema`, `LedgerEntry`, `LedgerEntryDraft`, `LedgerEntriesSchema`, `latestOutcomesByDate`, `DayResolution`, `resolveDays`
  - `domain/debt.ts`: `DEBT_WARNING_THRESHOLD`, `NumberOfDebtsSchema`, `NumberOfDebts`, `DebtDay`, `foldDebt`, `normalizeDebts`, `getDebtDays` (**now exported**), `effectiveDuty`, `isDebtDay`, `isOverDebtWarning`
  - `domain/comments.ts`: `CommentSchema`, `Comment`, `CommentsSchema`, `commentsKey` (**signature changes**, see Step 3)
  - `model/ofelia-duty.ts` keeps only `OfeliaDutyModelProps`, `HistoryEntryView`, `IP_TAIL_LENGTH`, `ofeliaDutyModel`
  - `model/ofelia-comments.ts` keeps only `CommentView`, `OfeliaCommentsModelProps`, `ofeliaCommentsModel`

- [ ] **Step 1: Create `domain/roster.ts`**

```ts
import { z } from 'zod'

export const DUTY_TIME_ZONE = 'Europe/Warsaw' as const
/**
 * Kept as an ISO string rather than a Temporal.PlainDate so this module can be
 * imported before the browser Temporal polyfill has been installed — Temporal
 * is only touched inside function bodies.
 */
export const BASE_DUTY_DATE_ISO = '2026-06-16' as const
export const DUTY_ROTATION = ['Леша', 'Карина'] as const

export type DutyPerson = (typeof DUTY_ROTATION)[number]
export type Person = DutyPerson

export const PersonSchema = z.enum(DUTY_ROTATION)
export const IsoDateSchema = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'expected an ISO calendar date')

export function plainDateIn(timeZone: string, epochMs: number): Temporal.PlainDate {
  return Temporal.Instant.fromEpochMilliseconds(epochMs).toZonedDateTimeISO(timeZone).toPlainDate()
}

export function getOfeliaDutyByDate(date: Temporal.PlainDate): DutyPerson {
  const base = Temporal.PlainDate.from(BASE_DUTY_DATE_ISO)
  const diffDays = base.until(date, { largestUnit: 'day' }).days
  return DUTY_ROTATION[positiveModulo(diffDays, DUTY_ROTATION.length)]
}

export function otherPerson(person: Person): Person {
  return DUTY_ROTATION.find((candidate) => candidate !== person) ?? person
}

export function getStartOfWeek(date: Temporal.PlainDate): Temporal.PlainDate {
  return date.subtract({ days: date.dayOfWeek - 1 })
}

export function weekStartISO(date: Temporal.PlainDate): string {
  return getStartOfWeek(date).toString()
}

function positiveModulo(value: number, divisor: number): number {
  return ((value % divisor) + divisor) % divisor
}
```

- [ ] **Step 2: Create `domain/ledger.ts` and `domain/debt.ts`**

Move the corresponding declarations out of `model/ofelia-duty.ts` **verbatim**, changing only the imports:

- `domain/ledger.ts` takes `LEDGER_KEY`, `LedgerTypeSchema`, `LedgerType`, `LedgerEntrySchema`, `LedgerEntry`, `LedgerEntryDraft`, `LedgerEntriesSchema`, `DAY_OUTCOME_TYPES` (keep it module-private), `latestOutcomesByDate`, `DayResolution`, `resolveDays`. It imports `PersonSchema` from `./roster`.
- `domain/debt.ts` takes `DEBT_WARNING_THRESHOLD`, `NumberOfDebtsSchema`, `NumberOfDebts`, `foldDebt`, `normalizeDebts`, `DebtDay`, `getDebtDays`, `effectiveDuty`, `isDebtDay`, `isOverDebtWarning`. It imports from `./roster` and `./ledger`.

`getDebtDays` changes from module-private to exported — `domain/drafts.ts` (Task 7) needs it.

Leave `LedgerEntrySchema`'s `ip` field exactly as it is for now. Task 6 removes it; keeping this task a pure move is what makes it reviewable.

- [ ] **Step 3: Create `domain/comments.ts`**

Move `CommentSchema`, `CommentsSchema`, `Comment` and `commentsKey` out of `model/ofelia-comments.ts`. `commentsKey` changes signature — it now takes the already-computed ISO week start instead of a date:

```ts
import { z } from 'zod'

import { PersonSchema } from './roster'

export const CommentSchema = z.object({
  id: z.string(),
  ts: z.number(),
  ip: z.string().optional(),
  author: PersonSchema,
  text: z.string(),
})

export const CommentsSchema = z.array(CommentSchema)
export type Comment = z.infer<typeof CommentSchema>

/**
 * `weekStartIso` MUST be the output of `weekStartISO(date)`. The produced key is
 * a persistence contract — it is byte-identical to the previous
 * `comments:${weekStartISO(date)}`.
 */
export function commentsKey(weekStartIso: string): string {
  return `comments:${weekStartIso}`
}
```

Every existing call site `commentsKey(date)` becomes `commentsKey(weekStartISO(date))`.

- [ ] **Step 4: Add the boundary lint rule**

In `.oxlintrc.json`, after the top-level `rules` block:

```json
  "overrides": [
    {
      "files": ["packages/widgets/*/domain/**"],
      "rules": {
        "no-restricted-imports": [
          "error",
          {
            "patterns": [
              {
                "regex": "^(\\.\\./){2,}",
                "message": "Deep relative imports are not allowed."
              },
              {
                "regex": "^(@reatom/|react|react-dom|widget-runtime|widget-sdk|@/)",
                "message": "Widget domain code is shared with the server bundle: it may only import zod, @shared/* and globals. No Reatom, React, widget runtime/SDK, and no '@/' alias (rspack externalizes it)."
              }
            ]
          }
        ]
      }
    }
  ]
```

- [ ] **Step 5: Update the consumers**

Delete the moved declarations from `model/ofelia-duty.ts` and `model/ofelia-comments.ts` and import what they still need from `@/domain/...`. Then repoint every other consumer:

Run: `grep -rl "from '@/model/ofelia-duty'\|from '@/model/ofelia-comments'\|from '../model/ofelia-duty'\|from './ofelia-duty'" packages/widgets/ofelia-poop-duty`

Mapping — the symbol tells you the new module:

| Symbols | New import |
|---|---|
| `DUTY_ROTATION`, `DutyPerson`, `Person`, `PersonSchema`, `IsoDateSchema`, `DUTY_TIME_ZONE`, `getOfeliaDutyByDate`, `otherPerson`, `weekStartISO`, `getStartOfWeek`, `plainDateIn` | `@/domain/roster` |
| `LEDGER_KEY`, `LedgerEntry`, `LedgerEntryDraft`, `LedgerEntriesSchema`, `LedgerEntrySchema`, `LedgerType`, `DayResolution`, `resolveDays`, `latestOutcomesByDate` | `@/domain/ledger` |
| `NumberOfDebts`, `foldDebt`, `normalizeDebts`, `getDebtDays`, `effectiveDuty`, `isDebtDay`, `isOverDebtWarning`, `DEBT_WARNING_THRESHOLD` | `@/domain/debt` |
| `Comment`, `CommentSchema`, `CommentsSchema`, `commentsKey` | `@/domain/comments` |
| `HistoryEntryView`, `IP_TAIL_LENGTH`, `ofeliaDutyModel`, `OfeliaDutyModelProps`, `CommentView`, `ofeliaCommentsModel` | unchanged (`@/model/...`) |

For example `ui/person.ts` changes from

```ts
import { DUTY_ROTATION } from '../model/ofelia-duty'
import type { Person } from '../model/ofelia-duty'
```

to

```ts
import { DUTY_ROTATION } from '../domain/roster'
import type { Person } from '../domain/roster'
```

`BASE_DUTY_DATE` no longer exists. Every reader of it now calls `Temporal.PlainDate.from(BASE_DUTY_DATE_ISO)` or, better, `getOfeliaDutyByDate`.

- [ ] **Step 6: Move the pure tests**

Move `model/ledger.test.ts` to `domain/ledger.test.ts`. Split `model/ofelia-duty.test.ts`: assertions over `foldDebt` / `getDebtDays` / `effectiveDuty` go to `domain/debt.test.ts`, over `getOfeliaDutyByDate` / `weekStartISO` to `domain/roster.test.ts`; anything that constructs `ofeliaDutyModel` stays. Update their imports the same way.

- [ ] **Step 7: Verify nothing changed**

Run: `pnpm --filter widgets-ofelia-poop-duty exec vitest run`
Expected: PASS, with the same total test count as before the move — tests were relocated, not deleted.

Run: `pnpm lint`
Expected: PASS. Then deliberately add `import { atom } from '@reatom/core'` to `domain/roster.ts`, re-run `pnpm lint`, confirm it FAILS with the boundary message, and remove the line.

Run: `pnpm typecheck`
Expected: PASS.

- [ ] **Step 8: Commit**

```bash
git add packages/widgets/ofelia-poop-duty .oxlintrc.json
git commit -m "refactor(ofelia): extract the pure duty domain out of the Reatom model"
```

---

### Task 3: Board members directory endpoint

**Files:**
- Modify: `packages/server/src/auth/accounts.ts`
- Modify: `packages/server/src/auth/device-handlers.ts`
- Modify: `packages/server/src/auth/index.ts`
- Test: `packages/server/src/auth/accounts.test.ts`, `packages/server/src/auth/device-handlers.test.ts`

**Interfaces:**
- Consumes: nothing from earlier tasks.
- Produces: `listAccounts(ops: ValkeyOps): Promise<AccountRecord[]>`; `getAccounts(deps: AuthDeps, req: IncomingMessage): Promise<AuthResult>`; the route `GET /api/auth/accounts` returning `{ accounts: Array<{ accountId: string; name: string }>; viewerAccountId: string }`. Task 4 consumes that response shape.

- [ ] **Step 1: Write the failing test for `listAccounts`**

Append to `packages/server/src/auth/accounts.test.ts`, reusing its existing `makeOps` (`createMemoryOps(createMemoryPubSub())`) and `makeClock` helpers, and adding `listAccounts` to the import from `./accounts`:

```ts
describe('listAccounts', () => {
  it('returns every account record, oldest first', async () => {
    const ops = makeOps()
    const clock = makeClock(100)
    const first = await createAccount(ops, clock.now, { name: 'Лёша', inviteId: 'inv-1' })
    clock.set(200)
    const second = await createAccount(ops, clock.now, { name: 'Карина', inviteId: 'inv-2' })

    const accounts = await listAccounts(ops)

    expect(accounts.map((account) => account.id)).toEqual([first.id, second.id])
    expect(accounts.map((account) => account.name)).toEqual(['Лёша', 'Карина'])
  })

  it('ignores the per-account device index key', async () => {
    const ops = makeOps()
    const clock = makeClock(0)
    const account = await createAccount(ops, clock.now, { name: 'Карина', inviteId: 'inv-1' })
    await addDeviceToAccount(ops, account.id, 'cred-1', { countsAgainstLimit: false })

    expect(await listAccounts(ops)).toHaveLength(1)
  })
})
```

`createAccount` already writes `account:<id>:devices` alongside `account:<id>`, so the first test would also fail on a naive prefix scan — the second one just makes the reason explicit.

- [ ] **Step 2: Run it to confirm it fails**

Run: `pnpm --filter server exec vitest run src/auth/accounts.test.ts`
Expected: FAIL — `listAccounts is not a function`.

- [ ] **Step 3: Implement `listAccounts`**

In `packages/server/src/auth/accounts.ts`:

```ts
const ACCOUNT_KEY_PREFIX = 'account:'

/**
 * Scans rather than reading an index: there is no account registry, and at this
 * scale (a household) a SCAN over `account:*` is cheaper than maintaining one
 * and backfilling the accounts that already exist.
 */
export async function listAccounts(ops: ValkeyOps): Promise<AccountRecord[]> {
  const keys = await ops.scanKeys(ACCOUNT_KEY_PREFIX)
  const accounts: AccountRecord[] = []

  for (const key of keys) {
    // `account:<id>` only. `account:<id>:devices` is the device index, and ids
    // are base64url (`randomId`), so they never contain a colon themselves.
    if (key.indexOf(':', ACCOUNT_KEY_PREFIX.length) !== -1) continue

    const record = await getJson(ops, key, AccountRecordSchema)
    if (record instanceof Error || record === null) continue
    accounts.push(record)
  }

  return accounts.sort((left, right) => left.createdAt - right.createdAt)
}
```

- [ ] **Step 4: Run it to confirm it passes**

Run: `pnpm --filter server exec vitest run src/auth/accounts.test.ts`
Expected: PASS.

- [ ] **Step 5: Write the failing handler test**

Append to `packages/server/src/auth/device-handlers.test.ts`, copying the shape of the `getAccountInfo` block already in that file (`makeOps` / `makeClock` / `makeConfig` / `seedAccountWithDevice` / `issueSession` / `fakeReq`, and note the cookie name is `mb_session` in `makeConfig`):

```ts
describe('getAccounts', () => {
  it('returns 401 without a session', async () => {
    const ops = makeOps()
    const clock = makeClock(0)
    const config = makeConfig()
    const deps: AuthDeps = { ops, config, now: clock.now, audit: vi.fn() }

    expect((await getAccounts(deps, fakeReq(undefined))).status).toBe(401)
  })

  it('returns the roster and which account is calling', async () => {
    const ops = makeOps()
    const clock = makeClock(0)
    const config = makeConfig()
    const account = await seedAccountWithDevice(ops, clock.now, 'cred-active')
    const other = await createAccount(ops, clock.now, { name: 'Карина', inviteId: 'inv-2' })
    const session = await issueSession(ops, config, clock.now, {
      accountId: account.id,
      credentialId: 'cred-active',
    })
    const deps: AuthDeps = { ops, config, now: clock.now, audit: vi.fn() }

    const result = await getAccounts(
      deps,
      fakeReq(undefined, { cookie: `mb_session=${session.sessionId}` }),
    )

    expect(result.status).toBe(200)
    expect(result.body).toEqual({
      viewerAccountId: account.id,
      accounts: expect.arrayContaining([
        { accountId: account.id, name: 'Acc' },
        { accountId: other.id, name: 'Карина' },
      ]),
    })
  })
})
```

`seedAccountWithDevice` names its account `'Acc'` — that is why the expectation reads that way.

- [ ] **Step 6: Run it to confirm it fails**

Run: `pnpm --filter server exec vitest run src/auth/device-handlers.test.ts`
Expected: FAIL — `getAccounts is not a function`.

- [ ] **Step 7: Implement the handler and register the route**

In `packages/server/src/auth/device-handlers.ts`, next to `getAccountInfo`:

```ts
export async function getAccounts(deps: AuthDeps, req: IncomingMessage): Promise<AuthResult> {
  const session = await requireSession(deps, req)
  if (isAuthResult(session)) return session

  const accounts = await listAccounts(deps.ops)

  return {
    status: 200,
    body: {
      accounts: accounts.map((account) => ({ accountId: account.id, name: account.name })),
      viewerAccountId: session.accountId,
    },
  }
}
```

Import `listAccounts` from `./accounts`.

In `packages/server/src/auth/index.ts`, next to the existing `/api/auth/account` registration:

```ts
  router.on('GET', '/api/auth/accounts', async (req: IncomingMessage, res: ServerResponse) => {
    sendAuth(res, await getAccounts(authDeps, req))
  })
```

- [ ] **Step 8: Run the server suite**

Run: `pnpm --filter server test`
Expected: PASS.

- [ ] **Step 9: Commit**

```bash
git add packages/server/src/auth
git commit -m "feat(auth): expose the board members directory"
```

---

### Task 4: Widget identity in the host runtime

**Files:**
- Create: `packages/widget-runtime/src/identity.ts`
- Create: `packages/widget-runtime/src/identity.test.ts`
- Modify: `packages/widget-runtime/src/host-runtime.ts`
- Modify: `packages/widget-runtime/src/types.ts`
- Modify: `packages/widget-runtime/src/index.ts`
- Modify: `packages/client/src/widget-host/ui/WidgetFrame.tsx:68-93`
- Modify: `packages/widgets/ofelia-poop-duty/dev/harness.tsx`, `packages/widgets/clock/dev/harness.tsx`
- Modify: `packages/widgets/clock/ui/Clock.test.tsx`, `packages/widgets/ofelia-poop-duty/ui/OfeliaPoopDuty.test.tsx`

**Interfaces:**
- Consumes: Task 3's `GET /api/auth/accounts`.
- Produces:
  - `type BoardMember = { accountId: string; name: string; avatarUrl?: string }`
  - `type WidgetIdentity = { viewer: Computed<BoardMember | null>; members: Computed<ReadonlyMap<string, BoardMember>> }`
  - `makeWidgetIdentity({ http }: { http: HttpLike }): WidgetIdentity`
  - `makeStaticWidgetIdentity(options?: { members?: BoardMember[]; viewerAccountId?: string }): WidgetIdentity` — the test/harness double
  - `HostRuntime.identity: WidgetIdentity`, `WidgetRuntimeProps.identity: WidgetIdentity`

- [ ] **Step 1: Write the failing test**

Create `packages/widget-runtime/src/identity.test.ts`:

```ts
import { context, wrap } from '@reatom/core'
import { afterEach, describe, expect, it, vi } from 'vitest'

import { makeStaticWidgetIdentity, makeWidgetIdentity } from './identity'

afterEach(() => context.reset())

const okResponse = (body: unknown) => ({ ok: true, status: 200, body })

function makeHttp(body: unknown) {
  return { get: vi.fn(async () => okResponse(body)), post: vi.fn() } as never
}

describe('makeWidgetIdentity', () => {
  it('is empty until something subscribes', () => {
    const http = makeHttp({ accounts: [], viewerAccountId: 'a1' })
    makeWidgetIdentity({ http })
    expect(http.get).not.toHaveBeenCalled()
  })

  it('loads the roster on first subscription and resolves the viewer', async () => {
    const http = makeHttp({
      accounts: [
        { accountId: 'a1', name: 'Карина' },
        { accountId: 'a2', name: 'Лёша' },
      ],
      viewerAccountId: 'a2',
    })
    const identity = makeWidgetIdentity({ http })

    const off = identity.members.subscribe(() => {})
    await vi.waitFor(() => {
      expect(wrap(() => identity.members().size)()).toBe(2)
    })
    expect(wrap(() => identity.viewer()?.name)()).toBe('Лёша')
    off()
  })

  it('stays empty when the request fails', async () => {
    const http = { get: vi.fn(async () => new Error('offline')), post: vi.fn() } as never
    const identity = makeWidgetIdentity({ http })

    const off = identity.members.subscribe(() => {})
    await vi.waitFor(() => expect(http.get).toHaveBeenCalled())
    expect(wrap(() => identity.members().size)()).toBe(0)
    expect(wrap(() => identity.viewer())()).toBeNull()
    off()
  })
})

describe('makeStaticWidgetIdentity', () => {
  it('serves the members it was given without any request', () => {
    const identity = makeStaticWidgetIdentity({
      members: [{ accountId: 'a1', name: 'Карина' }],
      viewerAccountId: 'a1',
    })
    expect(wrap(() => identity.viewer()?.name)()).toBe('Карина')
  })
})
```

- [ ] **Step 2: Run it to confirm it fails**

Run: `pnpm --filter widget-runtime exec vitest run src/identity.test.ts`
Expected: FAIL — cannot resolve `./identity`.

- [ ] **Step 3: Implement `identity.ts`**

```ts
import { atom, computed, withConnectHook, wrap, type Computed } from '@reatom/core'
import type { HttpLike } from '@shared/http/client'
import * as errore from 'errore'
import { z } from 'zod'

export type BoardMember = { accountId: string; name: string; avatarUrl?: string }

export type WidgetIdentity = {
  /** The account this document is signed in as; null before the roster loads and in unauthenticated hosts. */
  viewer: Computed<BoardMember | null>
  /** Every account on the board, by id. Empty before the roster loads. */
  members: Computed<ReadonlyMap<string, BoardMember>>
}

export class BoardMembersError extends errore.createTaggedError({
  name: 'BoardMembersError',
  message: 'Could not load the board members directory',
}) {}

const AccountsResultSchema = z.object({
  accounts: z.array(
    z.object({
      accountId: z.string(),
      name: z.string(),
      avatarUrl: z.string().optional(),
    }),
  ),
  viewerAccountId: z.string(),
})

type IdentityState = {
  members: ReadonlyMap<string, BoardMember>
  viewerAccountId: string
}

const EMPTY: ReadonlyMap<string, BoardMember> = new Map()

async function fetchIdentity(http: HttpLike): Promise<BoardMembersError | IdentityState> {
  const response = await http.get('/api/auth/accounts')
  if (response instanceof Error) return new BoardMembersError({ cause: response })
  if (!response.ok) return new BoardMembersError()

  const parsed = AccountsResultSchema.safeParse(response.body)
  if (!parsed.success) return new BoardMembersError({ cause: parsed.error })

  return {
    members: new Map(parsed.data.accounts.map((member) => [member.accountId, member])),
    viewerAccountId: parsed.data.viewerAccountId,
  }
}

export type MakeWidgetIdentityOptions = { http: HttpLike }

/**
 * One directory per document. The fetch is deferred to the first subscriber via
 * withConnectHook, so a harness or a board with no identity-reading widget
 * never calls the endpoint. `wrap` is called fresh inside the hook on purpose —
 * a hoisted wrapped closure aborts after `context.reset()`.
 */
export function makeWidgetIdentity({ http }: MakeWidgetIdentityOptions): WidgetIdentity {
  const state = atom<IdentityState | null>(null, 'identity.state').extend(
    withConnectHook(() => {
      void wrap(fetchIdentity(http)).then((result) => {
        if (result instanceof Error) return
        state.set(result)
      })
    }),
  )

  return buildIdentity(state)
}

export type MakeStaticWidgetIdentityOptions = {
  members?: BoardMember[]
  viewerAccountId?: string
}

/** Test and harness double: no request, no connect hook. */
export function makeStaticWidgetIdentity({
  members = [],
  viewerAccountId = '',
}: MakeStaticWidgetIdentityOptions = {}): WidgetIdentity {
  const state = atom<IdentityState | null>(
    { members: new Map(members.map((member) => [member.accountId, member])), viewerAccountId },
    'identity.staticState',
  )

  return buildIdentity(state)
}

function buildIdentity(state: { (): IdentityState | null }): WidgetIdentity {
  const members = computed(() => state()?.members ?? EMPTY, 'identity.members')
  const viewer = computed(() => {
    const current = state()
    if (!current) return null
    return current.members.get(current.viewerAccountId) ?? null
  }, 'identity.viewer')

  return { members, viewer }
}
```

- [ ] **Step 4: Run it to confirm it passes**

Run: `pnpm --filter widget-runtime exec vitest run src/identity.test.ts`
Expected: PASS.

- [ ] **Step 5: Wire it into the host runtime and the props**

`packages/widget-runtime/src/host-runtime.ts` — add to `HostRuntime`:

```ts
export type HostRuntime = {
  identity: WidgetIdentity
  makeWidgetStorage(options: { instanceId: string; typeId: string }): WidgetStorage
  // …unchanged
}
```

and in `makeHostRuntime`, before the `return`:

```ts
  // Cheap to construct — the request itself is deferred to the first subscriber.
  const identity = makeWidgetIdentity({ http })
```

then add `identity,` to the returned object.

`packages/widget-runtime/src/types.ts` — add to `WidgetRuntimeProps`:

```ts
  identity: WidgetIdentity
```

with `import type { WidgetIdentity } from './identity'`.

`packages/widget-runtime/src/index.ts` — add `export * from './identity'`.

- [ ] **Step 6: Update every props constructor**

`packages/client/src/widget-host/ui/WidgetFrame.tsx` — add `identity: hostRuntime.identity,` to the `context` object and `hostRuntime.identity` is a stable reference, so the dependency array does not change.

`packages/widgets/ofelia-poop-duty/dev/harness.tsx` and `packages/widgets/clock/dev/harness.tsx` — add `identity: runtime.identity,`. The harness runs unauthenticated, so the request 401s and the directory stays empty; that is the intended harness behaviour, not a bug.

`packages/widgets/clock/ui/Clock.test.tsx` and `packages/widgets/ofelia-poop-duty/ui/OfeliaPoopDuty.test.tsx` — add `identity: makeStaticWidgetIdentity(),` to the props they build.

- [ ] **Step 7: Verify**

Run: `pnpm typecheck`
Expected: PASS. Any remaining error is a props constructor that Step 6 missed — fix it there.

Run: `pnpm test`
Expected: PASS.

- [ ] **Step 8: Commit**

```bash
git add packages/widget-runtime packages/client/src/widget-host packages/widgets
git commit -m "feat(widget-runtime): expose the board identity to widgets"
```

---

### Task 5: The viewer in the widget server context

**Files:**
- Modify: `packages/shared/widgets/contracts.ts:48-60`
- Create: `packages/server/src/widgets/viewer.ts`
- Create: `packages/server/src/widgets/viewer.test.ts`
- Modify: `packages/server/src/widgets/dispatch.ts:15-66`
- Modify: `packages/server/src/app.ts:257-285,293-338`
- Modify: `packages/server/src/widgets/storage.ts:18-25,110-148`
- Modify: `packages/server/src/storage/handlers.ts:31-51`
- Test: `packages/server/src/widgets/dispatch.test.ts`, `packages/server/src/storage/handlers.test.ts`, `packages/server/src/widgets/storage.test.ts`

**Interfaces:**
- Consumes: nothing from earlier tasks.
- Produces:
  - `type WidgetViewer = { accountId: string; name: string }` from `@shared/widgets/contracts`
  - `WidgetServerContext.viewer: WidgetViewer | null`
  - `resolveWidgetViewer(deps: AuthDeps, req: IncomingMessage): Promise<WidgetViewer | null>`
  - Appended records no longer carry `ip`. Task 8 consumes `context.viewer`.

- [ ] **Step 1: Write the failing test for the resolver**

These helpers currently live as private functions inside `packages/server/src/auth/device-handlers.test.ts`. Lift them into `packages/server/src/test/auth-fixtures.ts` — moved verbatim, not copied — and re-import them there:

```ts
import type { IncomingMessage } from 'node:http'
import { Readable } from 'node:stream'

import { addDeviceToAccount, createAccount } from '../auth/accounts'
import type { AuthConfig } from '../auth/config'
import { storeDevice } from '../auth/devices'
import { issueSession } from '../auth/sessions'
import { createMemoryOps, createMemoryPubSub } from './memory-ops'

const MINUTE = 60_000

export function makeOps() {
  return createMemoryOps(createMemoryPubSub())
}

export type Ops = ReturnType<typeof makeOps>

export function makeClock(start = 0) {
  let time = start
  return { now: () => time, set: (value: number) => { time = value } }
}

export function makeConfig(overrides: Partial<AuthConfig> = {}): AuthConfig {
  return {
    rpID: 'localhost',
    rpName: 'Board',
    expectedOrigin: 'http://localhost',
    sessionCookieName: 'mb_session',
    challengeCookieName: 'mb_chal',
    pendingCookieName: 'mb_pending',
    sessionTtlSlidingMs: 30 * 24 * 60 * MINUTE,
    sessionTtlAbsoluteMs: 90 * 24 * 60 * MINUTE,
    secureCookies: false,
    trustCfConnectingIp: false,
    ...overrides,
  }
}

export function fakeReq(body: unknown, headers: Record<string, string> = {}): IncomingMessage {
  const chunks = body === undefined ? [] : [Buffer.from(JSON.stringify(body))]
  const req = Readable.from(chunks) as unknown as IncomingMessage
  req.headers = headers as IncomingMessage['headers']
  req.socket = { remoteAddress: '127.0.0.1' } as IncomingMessage['socket']
  return req
}

export async function seedAccountWithDevice(
  ops: Ops,
  now: () => number,
  credentialId: string,
  overrides: { name?: string; status?: 'active' | 'pending'; disabled?: boolean } = {},
) {
  const account = await createAccount(ops, now, {
    name: overrides.name ?? 'Acc',
    inviteId: 'inv-1',
  })
  await storeDevice(ops, {
    credentialId,
    publicKey: 'pk',
    signCount: 5,
    label: 'Board device',
    createdAt: 0,
    lastSeenAt: 0,
    disabled: overrides.disabled ?? false,
    accountId: account.id,
    status: overrides.status ?? 'active',
    addedVia: 'invite',
  })
  await addDeviceToAccount(ops, account.id, credentialId, { countsAgainstLimit: false })
  return account
}

/** A live session plus a request already carrying its cookie. */
export async function seedSessionCookie(
  ops: Ops,
  config: AuthConfig,
  now: () => number,
  overrides: { name?: string } = {},
) {
  const account = await seedAccountWithDevice(ops, now, 'cred-active', overrides)
  const session = await issueSession(ops, config, now, {
    accountId: account.id,
    credentialId: 'cred-active',
  })
  return {
    account,
    req: fakeReq(undefined, { cookie: `${config.sessionCookieName}=${session.sessionId}` }),
  }
}
```

`seedAccountWithDevice` gains a `name` override; every existing call site keeps working because it defaults to `'Acc'`.

Then create `packages/server/src/widgets/viewer.test.ts`:

```ts
import { describe, expect, it } from 'vitest'

import { fakeReq, makeClock, makeConfig, makeOps, seedSessionCookie } from '../test/auth-fixtures'
import type { AuthDeps } from '../auth/handlers'
import { resolveWidgetViewer } from './viewer'

function makeDeps() {
  const ops = makeOps()
  const clock = makeClock(0)
  const config = makeConfig()
  const deps: AuthDeps = { ops, config, now: clock.now, audit: () => {} }
  return { ops, clock, config, deps }
}

describe('resolveWidgetViewer', () => {
  it('is null without a session cookie', async () => {
    const { deps } = makeDeps()
    expect(await resolveWidgetViewer(deps, fakeReq(undefined))).toBeNull()
  })

  it('is null when the cookie does not match a live session', async () => {
    const { deps } = makeDeps()
    const req = fakeReq(undefined, { cookie: 'mb_session=nope' })
    expect(await resolveWidgetViewer(deps, req)).toBeNull()
  })

  it('resolves the account behind a live session', async () => {
    const { ops, clock, config, deps } = makeDeps()
    const { account, req } = await seedSessionCookie(ops, config, clock.now, { name: 'Карина' })

    expect(await resolveWidgetViewer(deps, req)).toEqual({
      accountId: account.id,
      name: 'Карина',
    })
  })
})
```

- [ ] **Step 2: Run it to confirm it fails**

Run: `pnpm --filter server exec vitest run src/widgets/viewer.test.ts`
Expected: FAIL — cannot resolve `./viewer`.

- [ ] **Step 3: Implement the resolver and the contract**

`packages/shared/widgets/contracts.ts`:

```ts
export type WidgetViewer = { accountId: string; name: string }
```

and inside `WidgetServerContext`, after `ip`:

```ts
  /** The signed-in account, or null when the request carries no live session
   * (widget dev harnesses and e2e runs without the nginx gate). Not an error:
   * the event still runs and the record is written unattributed. */
  viewer: WidgetViewer | null
```

`packages/server/src/widgets/viewer.ts`:

```ts
import type { IncomingMessage } from 'node:http'

import type { WidgetViewer } from '@shared/widgets/contracts'

import { getAccount } from '../auth/accounts'
import type { AuthDeps } from '../auth/handlers'
import { isAuthResult, requireSession } from '../auth/session-guard'

export async function resolveWidgetViewer(
  deps: AuthDeps,
  req: IncomingMessage,
): Promise<WidgetViewer | null> {
  const session = await requireSession(deps, req)
  if (isAuthResult(session)) return null

  const account = await getAccount(deps.ops, session.accountId)
  if (account instanceof Error) return null

  return { accountId: account.id, name: account.name }
}
```

- [ ] **Step 4: Run it to confirm it passes**

Run: `pnpm --filter server exec vitest run src/widgets/viewer.test.ts`
Expected: PASS.

- [ ] **Step 5: Thread the viewer through dispatch**

`packages/server/src/widgets/dispatch.ts` — add `viewer: WidgetViewer | null` to `DispatchWidgetEventOptions`, and to the constructed `context`:

```ts
  const context: WidgetServerContext = {
    typeId: options.typeId,
    instanceId: options.instanceId,
    ip: options.ip,
    viewer: options.viewer,
    now: options.now,
    api: createWidgetServerApi({ … }),
  }
```

`packages/server/src/app.ts`, in the `POST /api/widgets/:typeId/:event` handler, before `dispatchWidgetEvent`:

```ts
    const viewer = await resolveWidgetViewer(authDeps, req)
```

and pass `viewer,` in the options object. Import `resolveWidgetViewer` from `./widgets/viewer`.

- [ ] **Step 6: Stop stamping the IP**

`packages/server/src/storage/handlers.ts` — `handleAppend` loses its `ip` parameter:

```ts
export async function handleAppend(
  ops: ValkeyOps,
  key: string,
  payload: AppendPayload,
): Promise<{ status: number; value: unknown[] }> {
  const raw = await ops.get(key)
  const parsed = raw === null ? [] : safeParse(raw)
  const current: unknown[] = Array.isArray(parsed) ? parsed : []
  const enriched = { ...payload.entry, id: randomUUID(), ts: Date.now() }
  …
```

`packages/server/src/app.ts` — drop `const ip = clientIp(req)` from that route and call `handleAppend(ops, key, parsed.data)`. `clientIp` stays imported: the audit log and `WidgetServerContext.ip` still use it.

`packages/server/src/widgets/storage.ts` — remove `ip` from `CreateWidgetServerStorageApiOptions`, from the destructured parameters, and from the enriched entry:

```ts
        const enriched = errore.try(() => ({ id: createId(), ts: now(), ...entry }))
```

Then remove `ip: options.ip,` from `createWidgetServerApi`'s call in `packages/server/src/widgets/api.ts` and from `dispatch.ts`'s `createWidgetServerApi({ … })` argument.

Update the assertions in `packages/server/src/storage/handlers.test.ts` and `packages/server/src/widgets/storage.test.ts` that expect an `ip` field — they should now assert its **absence**:

```ts
    expect(written).not.toHaveProperty('ip')
```

- [ ] **Step 7: Add the dispatch coverage**

In `packages/server/src/widgets/dispatch.test.ts`:

```ts
  it('hands the viewer to the handler', async () => {
    let seen: WidgetViewer | null | undefined
    const registry = makeRegistryWith('probe', (_payload, context) => {
      seen = context.viewer
      return { ok: true }
    })

    await dispatchWidgetEvent({
      …baseOptions(registry),
      viewer: { accountId: 'a1', name: 'Карина' },
    })

    expect(seen).toEqual({ accountId: 'a1', name: 'Карина' })
  })

  it('hands null through when there is no session', async () => {
    let seen: WidgetViewer | null | undefined
    const registry = makeRegistryWith('probe', (_payload, context) => {
      seen = context.viewer
      return { ok: true }
    })

    await dispatchWidgetEvent({ …baseOptions(registry), viewer: null })

    expect(seen).toBeNull()
  })
```

Match the helper names already present in that file rather than introducing `makeRegistryWith`/`baseOptions` if equivalents exist.

- [ ] **Step 8: Verify**

Run: `pnpm --filter server test`
Expected: PASS.

Run: `pnpm typecheck`
Expected: PASS.

- [ ] **Step 9: Commit**

```bash
git add packages/shared/widgets packages/server/src
git commit -m "feat(widgets): resolve the signed-in viewer for widget server events"
```

---

### Task 6: Record schemas and the author resolver

**Files:**
- Modify: `packages/widgets/ofelia-poop-duty/domain/ledger.ts`
- Modify: `packages/widgets/ofelia-poop-duty/domain/comments.ts`
- Create: `packages/widgets/ofelia-poop-duty/domain/author.ts`
- Create: `packages/widgets/ofelia-poop-duty/domain/author.test.ts`
- Test: `packages/widgets/ofelia-poop-duty/domain/ledger.test.ts`

**Interfaces:**
- Consumes: Task 2's domain modules.
- Produces:
  - `CreatedBySchema`, `type CreatedBy = { accountId: string; name: string }` from `domain/ledger`
  - `LedgerEntry` with `createdBy?: CreatedBy | null` and `by?: Person`, **without** `ip`
  - `type LedgerEntryDraft = Omit<LedgerEntry, 'id' | 'ts' | 'by'>`
  - `Comment` with `createdBy?: CreatedBy | null` and `author?: Person`, **without** `ip`
  - `type CommentDraft = Omit<Comment, 'id' | 'ts' | 'author'>`
  - `domain/author.ts`: `EntryAuthor`, `MemberLookup`, `resolveEntryAuthor`

- [ ] **Step 1: Write the failing schema tests**

Append to `packages/widgets/ofelia-poop-duty/domain/ledger.test.ts`:

```ts
describe('LedgerEntrySchema', () => {
  it('accepts a legacy entry and drops its ip', () => {
    const parsed = LedgerEntrySchema.parse({
      id: 'e1', ts: 1, ip: '10.0.0.7', date: '2026-06-16',
      type: 'cleaned', actor: 'Леша', by: 'Леша',
    })

    expect(parsed).not.toHaveProperty('ip')
    expect(parsed.by).toBe('Леша')
    expect(parsed.createdBy).toBeUndefined()
  })

  it('accepts an authored entry', () => {
    const parsed = LedgerEntrySchema.parse({
      id: 'e2', ts: 2, date: '2026-06-16', type: 'cleaned', actor: 'Леша',
      createdBy: { accountId: 'a1', name: 'Карина' },
    })

    expect(parsed.createdBy).toEqual({ accountId: 'a1', name: 'Карина' })
  })

  it('accepts an unattributed entry', () => {
    const parsed = LedgerEntrySchema.parse({
      id: 'e3', ts: 3, date: '2026-06-16', type: 'cleaned', actor: 'Леша', createdBy: null,
    })

    expect(parsed.createdBy).toBeNull()
  })
})
```

- [ ] **Step 2: Run it to confirm it fails**

Run: `pnpm --filter widgets-ofelia-poop-duty exec vitest run domain/ledger.test.ts`
Expected: FAIL — the current schema requires `ip` and rejects `createdBy`.

- [ ] **Step 3: Widen the schemas**

`domain/ledger.ts` — replace the `ip` field and the `by` field:

```ts
export const CreatedBySchema = z.object({
  accountId: z.string(),
  name: z.string().describe('Display name frozen at write time; the members directory overrides it'),
})
export type CreatedBy = z.infer<typeof CreatedBySchema>

const LedgerEntrySchema = z.object({
  id: z.string().describe('Unique id of the append-only record'),
  ts: z.number().describe('Server timestamp; orders the day and picks its latest outcome'),
  date: z.string().describe('ISO duty date the action refers to'),
  type: LedgerTypeSchema,
  actor: PersonSchema.describe('Duty person who cleaned, went into debt, or whose debt moved'),
  onBehalfOf: PersonSchema.optional().describe('Person the action was done for, or whose debt changes'),
  createdBy: CreatedBySchema.nullish().describe('Account that created the record; null when unattributed'),
  by: PersonSchema.optional().describe('LEGACY pre-account signature. Read-only: never written again'),
})

export type LedgerEntryDraft = Omit<LedgerEntry, 'id' | 'ts' | 'by'>
```

Note that `ip` is simply gone — zod strips unknown keys, so every stored record still parses.

`domain/comments.ts` — the same treatment:

```ts
export const CommentSchema = z.object({
  id: z.string(),
  ts: z.number(),
  text: z.string(),
  createdBy: CreatedBySchema.nullish(),
  author: PersonSchema.optional().describe('LEGACY pre-account signature. Read-only'),
})

export type CommentDraft = Omit<Comment, 'id' | 'ts' | 'author'>
```

importing `CreatedBySchema` from `./ledger`.

- [ ] **Step 4: Run it to confirm it passes**

Run: `pnpm --filter widgets-ofelia-poop-duty exec vitest run domain/ledger.test.ts`
Expected: PASS. Other suites will now fail to typecheck — Tasks 7–11 fix them; do not chase them here beyond what Step 7 requires.

- [ ] **Step 5: Write the failing resolver test**

Create `packages/widgets/ofelia-poop-duty/domain/author.test.ts`:

```ts
// @vitest-environment node
import { describe, expect, it } from 'vitest'

import { resolveEntryAuthor, type MemberLookup } from './author'

const members: MemberLookup = new Map([
  ['a1', { accountId: 'a1', name: 'Карина', avatarUrl: 'https://example.test/k.png' }],
])

describe('resolveEntryAuthor', () => {
  it('prefers the directory over the frozen snapshot', () => {
    expect(resolveEntryAuthor({ accountId: 'a1', name: 'старое имя' }, undefined, members)).toEqual({
      kind: 'account',
      accountId: 'a1',
      name: 'Карина',
      avatarUrl: 'https://example.test/k.png',
    })
  })

  it('falls back to the snapshot when the account is gone', () => {
    expect(resolveEntryAuthor({ accountId: 'gone', name: 'Лёша' }, undefined, members)).toEqual({
      kind: 'account',
      accountId: 'gone',
      name: 'Лёша',
    })
  })

  it('falls back to the legacy duty signature', () => {
    expect(resolveEntryAuthor(null, 'Леша', members)).toEqual({ kind: 'person', person: 'Леша' })
  })

  it('is unknown when there is neither', () => {
    expect(resolveEntryAuthor(null, undefined, members)).toEqual({ kind: 'unknown' })
  })

  it('prefers createdBy over a legacy signature when both are present', () => {
    expect(resolveEntryAuthor({ accountId: 'a1', name: 'x' }, 'Леша', members).kind).toBe('account')
  })
})
```

- [ ] **Step 6: Run it to confirm it fails, then implement**

Run: `pnpm --filter widgets-ofelia-poop-duty exec vitest run domain/author.test.ts`
Expected: FAIL — cannot resolve `./author`.

Create `packages/widgets/ofelia-poop-duty/domain/author.ts`:

```ts
import type { CreatedBy } from './ledger'
import type { Person } from './roster'

export type EntryAuthor =
  | { kind: 'account'; accountId: string; name: string; avatarUrl?: string }
  | { kind: 'person'; person: Person }
  | { kind: 'unknown' }

/**
 * Structurally compatible with widget-runtime's
 * `ReadonlyMap<string, BoardMember>`, declared locally because domain code may
 * not import widget-runtime.
 */
export type MemberLookup = ReadonlyMap<
  string,
  { accountId: string; name: string; avatarUrl?: string }
>

export function resolveEntryAuthor(
  createdBy: CreatedBy | null | undefined,
  legacy: Person | undefined,
  members: MemberLookup,
): EntryAuthor {
  if (createdBy) {
    const member = members.get(createdBy.accountId)
    return {
      kind: 'account',
      accountId: createdBy.accountId,
      name: member?.name ?? createdBy.name,
      ...(member?.avatarUrl ? { avatarUrl: member.avatarUrl } : {}),
    }
  }

  if (legacy) return { kind: 'person', person: legacy }
  return { kind: 'unknown' }
}
```

Run it again.
Expected: PASS.

- [ ] **Step 7: Commit**

Type errors in `model/` and `ui/` are expected at this point and are resolved by the next tasks; commit the domain layer alone so the diff stays reviewable.

```bash
git add packages/widgets/ofelia-poop-duty/domain
git commit -m "feat(ofelia): carry the authoring account on ledger and comment records"
```

---

### Task 7: Draft construction and event schemas in the domain

**Files:**
- Create: `packages/widgets/ofelia-poop-duty/domain/drafts.ts`
- Create: `packages/widgets/ofelia-poop-duty/domain/drafts.test.ts`
- Create: `packages/widgets/ofelia-poop-duty/domain/events.ts`

**Interfaces:**
- Consumes: Tasks 2 and 6.
- Produces:
  - `type DraftInput = { entries: LedgerEntry[]; today: Temporal.PlainDate; target: Temporal.PlainDate; createdBy: CreatedBy | null }`
  - `makeCleanDraft(input: DraftInput): LedgerEntryDraft`
  - `makeDebtDraft(input: DraftInput): LedgerEntryDraft`
  - `makeForgiveDraft(input: DraftInput): LedgerEntryDraft | null`
  - `makeUndoDraft(input: DraftInput): LedgerEntryDraft | null`
  - `makeCommentDraft(input: { text: string; createdBy: CreatedBy | null }): CommentDraft | null`
  - `domain/events.ts`: `ofeliaEventSchemas`, `type OfeliaEvents`
- The `null` returns are the "not applicable" cases that today are silent early returns in the Reatom actions. Task 8 turns them into successful no-ops.

- [ ] **Step 1: Write the failing tests**

Create `packages/widgets/ofelia-poop-duty/domain/drafts.test.ts`:

```ts
// @vitest-environment node
import { describe, expect, it } from 'vitest'

import { makeCleanDraft, makeCommentDraft, makeDebtDraft, makeForgiveDraft, makeUndoDraft } from './drafts'
import type { LedgerEntry } from './ledger'

const D = (iso: string) => Temporal.PlainDate.from(iso)
const KARINA = { accountId: 'a1', name: 'Карина' }

// 2026-06-16 is BASE_DUTY_DATE_ISO, so it is Леша's day; 06-17 is Карина's.
const base = { entries: [] as LedgerEntry[], today: D('2026-06-16'), createdBy: KARINA }

let seq = 0
const entry = (o: Partial<LedgerEntry> = {}): LedgerEntry => ({
  id: `e${seq++}`, ts: seq, date: '2026-06-16', type: 'cleaned', actor: 'Леша', ...o,
})

describe('makeCleanDraft', () => {
  it('credits the scheduled duty person on a plain day', () => {
    expect(makeCleanDraft({ ...base, target: D('2026-06-16') })).toEqual({
      date: '2026-06-16', type: 'cleaned', actor: 'Леша', createdBy: KARINA,
    })
  })

  it('credits the debtor and names the scheduled person on a debt day', () => {
    const entries = [entry({ type: 'went_into_debt', actor: 'Леша', onBehalfOf: 'Карина' })]
    // Карина owes one day, so the next day that is not hers (06-17 is hers,
    // 06-18 is Лешa's) becomes her debt day.
    const draft = makeCleanDraft({ ...base, entries, target: D('2026-06-18') })

    expect(draft).toEqual({
      date: '2026-06-18', type: 'cleaned', actor: 'Карина', onBehalfOf: 'Леша', createdBy: KARINA,
    })
  })
})

describe('makeDebtDraft', () => {
  it('puts the scheduled person into debt and hands the day to the other one', () => {
    expect(makeDebtDraft({ ...base, target: D('2026-06-16') })).toEqual({
      date: '2026-06-16', type: 'went_into_debt', actor: 'Карина', onBehalfOf: 'Леша',
      createdBy: KARINA,
    })
  })
})

describe('makeForgiveDraft', () => {
  it('is null when the target is not a debt day', () => {
    expect(makeForgiveDraft({ ...base, target: D('2026-06-16') })).toBeNull()
  })

  it('forgives the debtor on a debt day', () => {
    const entries = [entry({ type: 'went_into_debt', actor: 'Леша', onBehalfOf: 'Карина' })]

    expect(makeForgiveDraft({ ...base, entries, target: D('2026-06-18') })).toEqual({
      date: '2026-06-18', type: 'forgiven', actor: 'Леша', onBehalfOf: 'Карина', createdBy: KARINA,
    })
  })
})

describe('makeUndoDraft', () => {
  it('is null when the day is still open', () => {
    expect(makeUndoDraft({ ...base, target: D('2026-06-16') })).toBeNull()
  })

  it('reopens a closed day and names whose closure was undone', () => {
    const entries = [entry({ type: 'cleaned', actor: 'Леша' })]

    expect(makeUndoDraft({ ...base, entries, target: D('2026-06-16') })).toEqual({
      date: '2026-06-16', type: 'reset', actor: 'Леша', createdBy: KARINA,
    })
  })
})

describe('makeCommentDraft', () => {
  it('trims the text', () => {
    expect(makeCommentDraft({ text: '  привет  ', createdBy: KARINA })).toEqual({
      text: 'привет', createdBy: KARINA,
    })
  })

  it('is null for blank text', () => {
    expect(makeCommentDraft({ text: '   ', createdBy: KARINA })).toBeNull()
  })
})
```

- [ ] **Step 2: Run it to confirm it fails**

Run: `pnpm --filter widgets-ofelia-poop-duty exec vitest run domain/drafts.test.ts`
Expected: FAIL — cannot resolve `./drafts`.

- [ ] **Step 3: Implement `domain/drafts.ts`**

The bodies are lifted from the four Reatom actions in `model/ofelia-duty.ts` — same branches, same order, with `by: currentUser()` replaced by `createdBy`.

```ts
import type { CommentDraft } from './comments'
import { foldDebt, getDebtDays } from './debt'
import type { CreatedBy, LedgerEntry, LedgerEntryDraft } from './ledger'
import { resolveDays } from './ledger'
import { getOfeliaDutyByDate, otherPerson } from './roster'

export type DraftInput = {
  entries: LedgerEntry[]
  today: Temporal.PlainDate
  target: Temporal.PlainDate
  createdBy: CreatedBy | null
}

function debtDayFor({ entries, today, target }: DraftInput) {
  return getDebtDays(foldDebt(entries), today, resolveDays(entries)).find((day) =>
    day.date.equals(target),
  )
}

export function makeCleanDraft(input: DraftInput): LedgerEntryDraft {
  const debtDay = debtDayFor(input)
  const duty = getOfeliaDutyByDate(input.target)

  return {
    date: input.target.toString(),
    type: 'cleaned',
    actor: debtDay?.person ?? duty,
    ...(debtDay ? { onBehalfOf: duty } : {}),
    createdBy: input.createdBy,
  }
}

export function makeDebtDraft(input: DraftInput): LedgerEntryDraft {
  const actor = debtDayFor(input)?.person ?? getOfeliaDutyByDate(input.target)

  return {
    date: input.target.toString(),
    type: 'went_into_debt',
    actor: otherPerson(actor),
    onBehalfOf: actor,
    createdBy: input.createdBy,
  }
}

export function makeForgiveDraft(input: DraftInput): LedgerEntryDraft | null {
  const debtDay = debtDayFor(input)
  if (debtDay == null) return null

  const duty = getOfeliaDutyByDate(input.target)
  if (debtDay.person === duty) return null

  return {
    date: input.target.toString(),
    type: 'forgiven',
    actor: duty,
    onBehalfOf: debtDay.person,
    createdBy: input.createdBy,
  }
}

export function makeUndoDraft(input: DraftInput): LedgerEntryDraft | null {
  const resolution = resolveDays(input.entries).get(input.target.toString())
  if (resolution?.status !== 'closed') return null

  return {
    date: input.target.toString(),
    type: 'reset',
    // The day's previous outcome — whose closure is being undone, NOT who is
    // undoing it. The UI must never phrase this as "X reopened the day".
    actor: resolution.actor,
    createdBy: input.createdBy,
  }
}

export function makeCommentDraft({
  text,
  createdBy,
}: {
  text: string
  createdBy: CreatedBy | null
}): CommentDraft | null {
  const trimmed = text.trim()
  if (trimmed.length === 0) return null
  return { text: trimmed, createdBy }
}
```

- [ ] **Step 4: Run it to confirm it passes**

Run: `pnpm --filter widgets-ofelia-poop-duty exec vitest run domain/drafts.test.ts`
Expected: PASS. If the debt-day expectations are off by a day, print `getDebtDays(...)` for the fixture and correct the **test** to the real schedule — the production behaviour is not being changed here.

- [ ] **Step 5: Declare the event schemas**

Create `packages/widgets/ofelia-poop-duty/domain/events.ts`. It lives in `domain/` so both `server.ts` and the client model can import it without the client pulling in server code:

```ts
import type { InferWidgetEvents } from '@shared/widgets/contracts'
import { z } from 'zod'

import { IsoDateSchema } from './roster'

const OkSchema = z.object({ ok: z.literal(true) })
const DayPayloadSchema = z.object({ date: IsoDateSchema })

export const ofeliaEventSchemas = {
  clean: { payload: DayPayloadSchema, result: OkSchema },
  debt: { payload: DayPayloadSchema, result: OkSchema },
  forgive: { payload: DayPayloadSchema, result: OkSchema },
  undo: { payload: DayPayloadSchema, result: OkSchema },
  comment: {
    payload: z.object({ weekStart: IsoDateSchema, text: z.string().min(1).max(2000) }),
    result: OkSchema,
  },
} as const

export type OfeliaEvents = InferWidgetEvents<typeof ofeliaEventSchemas>
```

- [ ] **Step 6: Verify the boundary still holds**

Run: `pnpm lint`
Expected: PASS — `@shared/widgets/contracts` is allowed in `domain/**`; only `@reatom/*`, React, the widget runtime/SDK and `@/` are banned.

- [ ] **Step 7: Commit**

```bash
git add packages/widgets/ofelia-poop-duty/domain
git commit -m "feat(ofelia): move draft construction and event schemas into the domain"
```

---

### Task 8: Ofelia's server definition

**Files:**
- Create: `packages/widgets/ofelia-poop-duty/server.ts`
- Create: `packages/widgets/ofelia-poop-duty/server.test.ts`

**Interfaces:**
- Consumes: Task 5's `context.viewer`, Task 7's draft builders and `ofeliaEventSchemas`.
- Produces: the five handlers, and a server registry entry generated by `pnpm codegen:server`. Task 9 calls them through `api.invoke`.

- [ ] **Step 1: Write the failing test**

Create `packages/widgets/ofelia-poop-duty/server.test.ts`:

```ts
// @vitest-environment node
import { describe, expect, it, vi } from 'vitest'
import type { WidgetServerContext, WidgetServerStorage } from '@shared/widgets/contracts'

import { LEDGER_KEY } from './domain/ledger'
import ofeliaServer from './server'

const KARINA = { accountId: 'a1', name: 'Карина' }
// 2026-06-16 12:00 Europe/Warsaw
const NOW = Date.UTC(2026, 5, 16, 10, 0, 0)

function makeContext(stored: unknown = null, viewer = KARINA) {
  const append = vi.fn(async () => undefined)
  const shared: WidgetServerStorage = {
    get: vi.fn(async () => stored),
    set: vi.fn(async () => undefined),
    delete: vi.fn(async () => undefined),
    has: vi.fn(async () => false),
    keys: vi.fn(async () => []),
    append,
  }

  const context = {
    typeId: 'ofelia-poop-duty',
    instanceId: 'i1',
    ip: null,
    viewer,
    now: () => NOW,
    api: { storage: { instance: shared, shared }, browser: {} as never },
  } as unknown as WidgetServerContext

  return { context, append }
}

const run = (event: keyof typeof ofeliaServer.handlers, payload: unknown, context: WidgetServerContext) =>
  ofeliaServer.handlers[event](ofeliaServer.schemas[event].payload.parse(payload), context)

describe('ofelia server', () => {
  it('appends a cleaned entry stamped with the viewer', async () => {
    const { context, append } = makeContext([])

    expect(await run('clean', { date: '2026-06-16' }, context)).toEqual({ ok: true })
    expect(append).toHaveBeenCalledWith(LEDGER_KEY, {
      date: '2026-06-16', type: 'cleaned', actor: 'Леша', createdBy: KARINA,
    })
  })

  it('stamps null when there is no session', async () => {
    const { context, append } = makeContext([], null as never)

    await run('clean', { date: '2026-06-16' }, context)

    expect(append.mock.calls[0][1]).toMatchObject({ createdBy: null })
  })

  it('is a silent no-op when forgiving a day that carries no debt', async () => {
    const { context, append } = makeContext([])

    expect(await run('forgive', { date: '2026-06-16' }, context)).toEqual({ ok: true })
    expect(append).not.toHaveBeenCalled()
  })

  it('is a silent no-op when undoing an open day', async () => {
    const { context, append } = makeContext([])

    expect(await run('undo', { date: '2026-06-16' }, context)).toEqual({ ok: true })
    expect(append).not.toHaveBeenCalled()
  })

  it('appends a comment under the viewed week key', async () => {
    const { context, append } = makeContext([])

    await run('comment', { weekStart: '2026-06-15', text: '  привет ' }, context)

    expect(append).toHaveBeenCalledWith('comments:2026-06-15', {
      text: 'привет', createdBy: KARINA,
    })
  })

  it('surfaces a storage read failure', async () => {
    const { context } = makeContext(new Error('valkey down'))

    expect(await run('clean', { date: '2026-06-16' }, context)).toBeInstanceOf(Error)
  })
})
```

- [ ] **Step 2: Run it to confirm it fails**

Run: `pnpm --filter widgets-ofelia-poop-duty exec vitest run server.test.ts`
Expected: FAIL — cannot resolve `./server`.

- [ ] **Step 3: Implement `server.ts`**

Relative imports only — `@/` is externalized by rspack and would break the server bundle.

```ts
import { defineWidgetServer, type WidgetServerContext } from '@shared/widgets/contracts'

import { commentsKey } from './domain/comments'
import {
  makeCleanDraft,
  makeCommentDraft,
  makeDebtDraft,
  makeForgiveDraft,
  makeUndoDraft,
  type DraftInput,
} from './domain/drafts'
import { ofeliaEventSchemas } from './domain/events'
import { LEDGER_KEY, LedgerEntriesSchema, type LedgerEntryDraft } from './domain/ledger'
import { DUTY_TIME_ZONE, plainDateIn } from './domain/roster'

const OK = { ok: true } as const

async function readDraftInput(
  context: WidgetServerContext,
  date: string,
): Promise<Error | DraftInput> {
  const entries = await context.api.storage.shared.get(LEDGER_KEY, LedgerEntriesSchema)
  if (entries instanceof Error) return entries

  return {
    entries: entries ?? [],
    today: plainDateIn(DUTY_TIME_ZONE, context.now()),
    target: Temporal.PlainDate.from(date),
    createdBy: context.viewer,
  }
}

/**
 * A null draft is a "not applicable" case (forgiving a day with no debt,
 * undoing an open day) and stays a silent success — it mirrors the early
 * returns these actions had while they lived on the client.
 */
async function appendLedger(
  context: WidgetServerContext,
  draft: LedgerEntryDraft | null,
): Promise<Error | typeof OK> {
  if (draft === null) return OK
  const written = await context.api.storage.shared.append(LEDGER_KEY, draft)
  if (written instanceof Error) return written
  return OK
}

const ofeliaServer = defineWidgetServer({
  schemas: ofeliaEventSchemas,
  handlers: {
    clean: async ({ date }, context) => {
      const input = await readDraftInput(context, date)
      if (input instanceof Error) return input
      return appendLedger(context, makeCleanDraft(input))
    },

    debt: async ({ date }, context) => {
      const input = await readDraftInput(context, date)
      if (input instanceof Error) return input
      return appendLedger(context, makeDebtDraft(input))
    },

    forgive: async ({ date }, context) => {
      const input = await readDraftInput(context, date)
      if (input instanceof Error) return input
      return appendLedger(context, makeForgiveDraft(input))
    },

    undo: async ({ date }, context) => {
      const input = await readDraftInput(context, date)
      if (input instanceof Error) return input
      return appendLedger(context, makeUndoDraft(input))
    },

    comment: async ({ weekStart, text }, context) => {
      const draft = makeCommentDraft({ text, createdBy: context.viewer })
      if (draft === null) return OK

      const written = await context.api.storage.shared.append(commentsKey(weekStart), draft)
      if (written instanceof Error) return written
      return OK
    },
  },
})

export default ofeliaServer
```

The **default export is what the codegen consumes**: `scripts/codegen/server.ts:15` emits `import <identifier> from '@widgets/<dir>/server'` and wraps it in `toRuntimeWidgetServerDefinition({ typeId: <dir>, definition: <identifier> })`. The directory basename supplies `typeId`, so this file must not declare one, and it must not rely on any named export.

Two behaviours worth stating so they are not "fixed" later:

- **A null draft is a successful no-op, not an error.** Forgiving a day with no debt and undoing an open day were silent early returns while these actions lived on the client; they stay silent.
- **The read-then-append race is benign and stays.** `WidgetServerStorage.append` runs under `runExclusive`, but `readDraftInput` reads outside that lock, so two simultaneous clicks can both append. That cannot corrupt the balance: `latestOutcomesByDate` keeps one winner per date, the loser renders as a superseded row, and `foldDebt` ignores it. Do not add a client-side guard; if it ever needs fixing the shape is a lock-scoped `update(key, fn)` primitive on `WidgetServerStorage`.

- [ ] **Step 4: Run it to confirm it passes**

Run: `pnpm --filter widgets-ofelia-poop-duty exec vitest run server.test.ts`
Expected: PASS.

- [ ] **Step 5: Regenerate and check the registry**

Run: `pnpm codegen:server`
Expected: the generated server registry now lists `ofelia-poop-duty`.

Run: `pnpm --filter server build`
Expected: the bundle builds. If rspack complains about an unresolved `@/…`, a `domain/` or `server.ts` file still uses the alias — convert it to a relative import.

- [ ] **Step 6: Commit**

```bash
git add packages/widgets/ofelia-poop-duty
git commit -m "feat(ofelia): write the ledger and comments from the widget server"
```

---

### Task 9: Rewire the Reatom model and delete the toggle

**Files:**
- Modify: `packages/widgets/ofelia-poop-duty/model/ofelia-duty.ts`
- Modify: `packages/widgets/ofelia-poop-duty/model/ofelia-comments.ts`
- Modify: `packages/widgets/ofelia-poop-duty/ui/OfeliaPoopDuty.tsx`
- Modify: `packages/widgets/ofelia-poop-duty/ui/ofelia-context.ts`
- Modify: `packages/widgets/ofelia-poop-duty/ui/view-model.ts` (`OfeliaActions`)
- Modify: `packages/widgets/ofelia-poop-duty/ui/ofelia.fixture.ts`
- Modify: `packages/widgets/ofelia-poop-duty/ui/parts/RichLayout.tsx`
- Delete: `ui/parts/UserToggle.tsx`, `ui/parts/UserToggle.module.css`, `ui/parts/UserToggle.test.tsx`
- Test: `packages/widgets/ofelia-poop-duty/model/ofelia-duty.test.ts`, `model/ofelia-comments.test.ts`

**Interfaces:**
- Consumes: Task 4's `identity`, Task 8's events.
- Produces: `ofeliaDutyModel({ storage, timer, api, identity })` and `ofeliaCommentsModel({ storage, viewWeekStart, api, identity })`; `OfeliaActions` without `onSetUser`; `OfeliaContextValue` without `currentUser`.

- [ ] **Step 1: Write the failing model test**

Replace the `ofeliaDutyModel.currentUser` block in `model/ofelia-duty.test.ts` with:

```ts
describe('ofeliaDutyModel actions', () => {
  it('invokes the clean event with the target date', async () => {
    const invoke = vi.fn(async () => ({ ok: true }))
    const model = ofeliaDutyModel({
      storage: createStorage(),
      timer: fixedTimer('2026-06-16'),
      api: { invoke } as never,
      identity: makeStaticWidgetIdentity(),
    })

    await wrap(() => model.confirmClean(Temporal.PlainDate.from('2026-06-18')))()

    expect(invoke).toHaveBeenCalledWith('clean', { date: '2026-06-18' })
  })

  it('does not write through storage any more', async () => {
    const storage = createStorage()
    const model = ofeliaDutyModel({
      storage,
      timer: fixedTimer('2026-06-16'),
      api: { invoke: vi.fn(async () => ({ ok: true })) } as never,
      identity: makeStaticWidgetIdentity(),
    })

    await wrap(() => model.confirmClean(Temporal.PlainDate.from('2026-06-16')))()

    expect(storage.shared.server.append).not.toHaveBeenCalled()
  })
})
```

Reuse the file's existing `createStorage` / timer helpers rather than inventing new ones; add `fixedTimer` only if no equivalent exists.

- [ ] **Step 2: Run it to confirm it fails**

Run: `pnpm --filter widgets-ofelia-poop-duty exec vitest run model/ofelia-duty.test.ts`
Expected: FAIL — `ofeliaDutyModel` does not accept `api`.

- [ ] **Step 3: Rewrite the actions**

`model/ofelia-duty.ts`:

```ts
import type { WidgetApi } from '@shared/widgets/contracts'
import type { WidgetIdentity } from 'widget-runtime'

import type { OfeliaEvents } from '@/domain/events'

export interface OfeliaDutyModelProps {
  storage: WidgetStorage
  timer: ServerTime
  api: WidgetApi<OfeliaEvents>
  identity: WidgetIdentity
}
```

Delete the whole `currentUser` atom (both hooks). Replace each of the four actions with an invoke — all the derivation now lives on the server:

```ts
  const invokeDay = async (
    event: 'clean' | 'debt' | 'forgive' | 'undo',
    date: Temporal.PlainDate | undefined,
  ) => {
    const target = date ?? selectedDate() ?? today()
    if (target == null) return
    const result = await wrap(api.invoke(event, { date: target.toString() }))
    if (result instanceof Error) throw result
  }

  const confirmClean = action(
    (date?: Temporal.PlainDate) => invokeDay('clean', date),
    'ofeliaDuty.confirmClean',
  ).extend(withAsyncData({ status: true }))

  const goIntoDebt = action(
    (date?: Temporal.PlainDate) => invokeDay('debt', date),
    'ofeliaDuty.goIntoDebt',
  ).extend(withAsyncData({ status: true }))

  const forgive = action(
    (date?: Temporal.PlainDate) => invokeDay('forgive', date),
    'ofeliaDuty.forgive',
  ).extend(withAsyncData({ status: true }))

  const undo = action(
    (date?: Temporal.PlainDate) => invokeDay('undo', date),
    'ofeliaDuty.undo',
  ).extend(withAsyncData({ status: true }))
```

`selectedDate()` and `today()` are read **before** the first `await`, so they resolve against the widget's own context.

Remove `currentUser` from the returned object.

`model/ofelia-comments.ts` — `send` becomes:

```ts
  const send = action(async (text: string) => {
    const week = viewWeekStart()
    if (week == null) return
    if (text.trim().length === 0) return

    const result = await wrap(api.invoke('comment', { weekStart: weekStartISO(week), text }))
    if (result instanceof Error) throw result
  }, 'ofeliaComments.send').extend(withAsyncData({ status: true }))
```

and its props lose `currentUser` and gain `api` and `identity`.

- [ ] **Step 4: Run it to confirm it passes**

Run: `pnpm --filter widgets-ofelia-poop-duty exec vitest run model/`
Expected: PASS.

- [ ] **Step 5: Delete the toggle and its plumbing**

```bash
git rm packages/widgets/ofelia-poop-duty/ui/parts/UserToggle.tsx \
       packages/widgets/ofelia-poop-duty/ui/parts/UserToggle.module.css \
       packages/widgets/ofelia-poop-duty/ui/parts/UserToggle.test.tsx
```

- Remove `onSetUser` from `OfeliaActions` in `ui/view-model.ts`.
- Remove `currentUser` from `OfeliaContextValue` in `ui/ofelia-context.ts` and from `makeOfeliaValue` in `ui/ofelia.fixture.ts` (drop the `currentUser` option too).
- In `ui/OfeliaPoopDuty.tsx`: pull `api` and `identity` out of `useWidgetContext()`, pass them into both model factories, drop `currentUser` from the context value and `onSetUser` from `actions`.
- In `ui/parts/RichLayout.tsx`: delete the `UserToggle` import, the `currentUser` destructure and the `<div className={styles.headerActions}>` block that wraps it. Leave `.headerActions` in the CSS for now; Task 14 removes it with the rest of the header work.
- `ui/ofelia-context.test.tsx` renders `currentUser()` — repoint it at another context field (`view.selected()?.person`) or delete the assertion.
- `ui/tiers/StandardTier.test.tsx` and `ui/tiers/Tiers.test.tsx` assert `does not render UserToggle`. Keep those tests; they now assert something that is structurally true, which is the correct regression guard.

- [ ] **Step 6: Verify**

Run: `pnpm --filter widgets-ofelia-poop-duty exec vitest run`
Expected: PASS except the history/comment view tests, which Tasks 10–14 rewrite.

Run: `pnpm typecheck`
Expected: PASS.

- [ ] **Step 7: Commit**

```bash
git add -A packages/widgets/ofelia-poop-duty
git commit -m "feat(ofelia): drive ledger and comment writes through widget server events"
```

---

### Task 10: The history view model

**Files:**
- Modify: `packages/widgets/ofelia-poop-duty/model/ofelia-duty.ts` (`HistoryEntryView`, `historyView`)
- Create: `packages/widgets/ofelia-poop-duty/model/history-view.ts`
- Create: `packages/widgets/ofelia-poop-duty/model/history-view.test.ts`

**Interfaces:**
- Consumes: Tasks 4, 6.
- Produces:

```ts
export type HistoryEntryView = {
  id: string
  type: LedgerType
  actor: Person
  onBehalfOf?: Person
  dutyDate: string
  recordedAt: number
  recordedBy: EntryAuthor
  isViewerRecord: boolean
  recordedLate: boolean
  debtDelta: { person: Person; amount: 1 | -1 } | null
}

export type HistoryDayGroup = {
  dutyDate: string
  current: HistoryEntryView
  superseded: HistoryEntryView[]
}

export function toHistoryGroups(options: {
  entries: LedgerEntry[]
  weekStartIso: string
  members: MemberLookup
  viewerAccountId: string | null
}): HistoryDayGroup[]
```

`ofeliaDutyModel.historyView` becomes `Computed<HistoryDayGroup[]>`.

- [ ] **Step 1: Write the failing test**

Create `packages/widgets/ofelia-poop-duty/model/history-view.test.ts`:

```ts
// @vitest-environment node
import { describe, expect, it } from 'vitest'

import type { LedgerEntry } from '@/domain/ledger'

import { toHistoryGroups } from './history-view'

const KARINA = { accountId: 'a1', name: 'Карина' }
const members = new Map([['a1', { accountId: 'a1', name: 'Карина' }]])

const entry = (o: Partial<LedgerEntry> & Pick<LedgerEntry, 'id' | 'ts'>): LedgerEntry => ({
  date: '2026-06-16', type: 'cleaned', actor: 'Леша', ...o,
})

// 2026-06-16 22:00 Europe/Warsaw
const ON_TIME = Date.UTC(2026, 5, 16, 20, 0, 0)
// 2026-06-18 22:00 Europe/Warsaw
const LATE = Date.UTC(2026, 5, 18, 20, 0, 0)

const call = (entries: LedgerEntry[]) =>
  toHistoryGroups({ entries, weekStartIso: '2026-06-15', members, viewerAccountId: 'a1' })

describe('toHistoryGroups', () => {
  it('puts the newest entry of a day in `current` and the rest in `superseded`', () => {
    const groups = call([
      entry({ id: 'old', ts: 1, type: 'cleaned', actor: 'Леша' }),
      entry({ id: 'mid', ts: 2, type: 'reset', actor: 'Леша' }),
      entry({ id: 'new', ts: 3, type: 'cleaned', actor: 'Карина' }),
    ])

    expect(groups).toHaveLength(1)
    expect(groups[0].current.id).toBe('new')
    expect(groups[0].superseded.map((view) => view.id)).toEqual(['mid', 'old'])
  })

  it('orders groups newest duty day first', () => {
    const groups = call([
      entry({ id: 'a', ts: 1, date: '2026-06-16' }),
      entry({ id: 'b', ts: 2, date: '2026-06-18' }),
    ])

    expect(groups.map((group) => group.dutyDate)).toEqual(['2026-06-18', '2026-06-16'])
  })

  it('drops entries outside the viewed week', () => {
    expect(call([entry({ id: 'a', ts: 1, date: '2026-06-08' })])).toEqual([])
  })

  it('computes the debt delta per type', () => {
    const [plain, onBehalf, debt, forgiven] = [
      call([entry({ id: '1', ts: 1 })])[0].current,
      call([entry({ id: '2', ts: 1, actor: 'Карина', onBehalfOf: 'Леша' })])[0].current,
      call([entry({ id: '3', ts: 1, type: 'went_into_debt', actor: 'Леша', onBehalfOf: 'Карина' })])[0].current,
      call([entry({ id: '4', ts: 1, type: 'forgiven', actor: 'Леша', onBehalfOf: 'Карина' })])[0].current,
    ]

    expect(plain.debtDelta).toBeNull()
    expect(onBehalf.debtDelta).toEqual({ person: 'Карина', amount: -1 })
    expect(debt.debtDelta).toEqual({ person: 'Карина', amount: 1 })
    expect(forgiven.debtDelta).toEqual({ person: 'Карина', amount: -1 })
  })

  it('flags a record written on a different calendar day than the duty day', () => {
    const onTime = call([entry({ id: '1', ts: ON_TIME })])[0].current
    const late = call([entry({ id: '2', ts: LATE })])[0].current

    expect(onTime.recordedLate).toBe(false)
    expect(late.recordedLate).toBe(true)
  })

  it('resolves the author and marks the viewer', () => {
    const mine = call([entry({ id: '1', ts: 1, createdBy: KARINA })])[0].current
    const theirs = call([entry({ id: '2', ts: 1, createdBy: { accountId: 'a2', name: 'Лёша' } })])[0].current
    const legacy = call([entry({ id: '3', ts: 1, by: 'Леша' })])[0].current

    expect(mine.recordedBy).toMatchObject({ kind: 'account', name: 'Карина' })
    expect(mine.isViewerRecord).toBe(true)
    expect(theirs.isViewerRecord).toBe(false)
    expect(legacy.recordedBy).toEqual({ kind: 'person', person: 'Леша' })
  })
})
```

- [ ] **Step 2: Run it to confirm it fails**

Run: `pnpm --filter widgets-ofelia-poop-duty exec vitest run model/history-view.test.ts`
Expected: FAIL — cannot resolve `./history-view`.

- [ ] **Step 3: Implement `history-view.ts`**

```ts
import { resolveEntryAuthor, type EntryAuthor, type MemberLookup } from '@/domain/author'
import { latestOutcomesByDate, type LedgerEntry, type LedgerType } from '@/domain/ledger'
import { DUTY_TIME_ZONE, plainDateIn, weekStartISO, type Person } from '@/domain/roster'

export type HistoryEntryView = {
  id: string
  type: LedgerType
  actor: Person
  onBehalfOf?: Person
  dutyDate: string
  recordedAt: number
  recordedBy: EntryAuthor
  isViewerRecord: boolean
  recordedLate: boolean
  debtDelta: { person: Person; amount: 1 | -1 } | null
}

export type HistoryDayGroup = {
  dutyDate: string
  /** The day's live outcome. Always present: every ledger type resolves a day. */
  current: HistoryEntryView
  /** Everything the live outcome overrides, newest first. */
  superseded: HistoryEntryView[]
}

/** Mirrors foldDebt: the same branches, expressed per entry. */
function debtDelta(entry: LedgerEntry): HistoryEntryView['debtDelta'] {
  if (!entry.onBehalfOf) return null
  if (entry.type === 'went_into_debt') return { person: entry.onBehalfOf, amount: 1 }
  if (entry.type === 'cleaned') return { person: entry.actor, amount: -1 }
  if (entry.type === 'forgiven') return { person: entry.onBehalfOf, amount: -1 }
  return null
}

export type ToHistoryGroupsOptions = {
  entries: LedgerEntry[]
  weekStartIso: string
  members: MemberLookup
  viewerAccountId: string | null
}

export function toHistoryGroups({
  entries,
  weekStartIso,
  members,
  viewerAccountId,
}: ToHistoryGroupsOptions): HistoryDayGroup[] {
  const inWeek = entries.filter(
    (entry) => weekStartISO(Temporal.PlainDate.from(entry.date)) === weekStartIso,
  )
  const winners = latestOutcomesByDate(inWeek)

  const toView = (entry: LedgerEntry): HistoryEntryView => {
    const recordedBy = resolveEntryAuthor(entry.createdBy, entry.by, members)
    return {
      id: entry.id,
      type: entry.type,
      actor: entry.actor,
      ...(entry.onBehalfOf ? { onBehalfOf: entry.onBehalfOf } : {}),
      dutyDate: entry.date,
      recordedAt: entry.ts,
      recordedBy,
      isViewerRecord:
        recordedBy.kind === 'account' &&
        viewerAccountId !== null &&
        recordedBy.accountId === viewerAccountId,
      recordedLate: plainDateIn(DUTY_TIME_ZONE, entry.ts).toString() !== entry.date,
      debtDelta: debtDelta(entry),
    }
  }

  const byDate = new Map<string, LedgerEntry[]>()
  for (const entry of inWeek) {
    const bucket = byDate.get(entry.date)
    if (bucket) bucket.push(entry)
    else byDate.set(entry.date, [entry])
  }

  return [...byDate.entries()]
    .sort(([left], [right]) => right.localeCompare(left))
    .flatMap(([dutyDate, dayEntries]) => {
      const winner = winners.get(dutyDate)
      if (!winner) return []

      return [
        {
          dutyDate,
          current: toView(winner),
          superseded: dayEntries
            .filter((entry) => entry.id !== winner.id)
            .toSorted((left, right) => right.ts - left.ts)
            .map(toView),
        },
      ]
    })
}
```

- [ ] **Step 4: Run it to confirm it passes**

Run: `pnpm --filter widgets-ofelia-poop-duty exec vitest run model/history-view.test.ts`
Expected: PASS.

- [ ] **Step 5: Wire it into the model**

In `model/ofelia-duty.ts`, delete the old `HistoryEntryView` type and `IP_TAIL_LENGTH`, re-export the new types from `./history-view`, and replace `historyView`:

```ts
  const historyView = computed<HistoryDayGroup[]>(() => {
    const week = viewWeekStart()
    const entries = ledger()
    if (!week || entries === null) return []

    return toHistoryGroups({
      entries,
      weekStartIso: week.toString(),
      members: identity.members(),
      viewerAccountId: identity.viewer()?.accountId ?? null,
    })
  }, 'ofeliaDuty.historyView')
```

- [ ] **Step 6: Commit**

```bash
git add packages/widgets/ofelia-poop-duty
git commit -m "feat(ofelia): group history by duty day and mark superseded records"
```

---

### Task 11: The comment view model

**Files:**
- Modify: `packages/widgets/ofelia-poop-duty/model/ofelia-comments.ts`
- Test: `packages/widgets/ofelia-poop-duty/model/ofelia-comments.test.ts`

**Interfaces:**
- Consumes: Tasks 4, 6.
- Produces:

```ts
export type CommentView = {
  id: string
  text: string
  author: EntryAuthor
  createdAt: number
  isViewerComment: boolean
}
```

- [ ] **Step 1: Write the failing test**

Replace the `commentThread` assertions in `model/ofelia-comments.test.ts` with:

```ts
  it('resolves the author and marks the viewer', async () => {
    const { storage, emit } = createCommentsStorage()
    const model = ofeliaCommentsModel({
      storage,
      viewWeekStart: atom(D('2026-06-15'), 'test.viewWeekStart'),
      api: { invoke: vi.fn(async () => ({ ok: true })) } as never,
      identity: makeStaticWidgetIdentity({
        members: [{ accountId: 'a1', name: 'Карина' }],
        viewerAccountId: 'a1',
      }),
    })

    const off = model.commentThread.subscribe(() => {})
    emit('comments:2026-06-15', [
      { id: 'c1', ts: 2, text: 'мой', createdBy: { accountId: 'a1', name: 'старое' } },
      { id: 'c2', ts: 1, text: 'старый', author: 'Леша' },
    ])

    await vi.waitFor(() => {
      expect(wrap(() => model.commentThread().length)()).toBe(2)
    })

    const [first, second] = wrap(() => model.commentThread())()
    expect(first).toMatchObject({
      id: 'c2',
      author: { kind: 'person', person: 'Леша' },
      isViewerComment: false,
    })
    expect(second).toMatchObject({
      id: 'c1',
      author: { kind: 'account', name: 'Карина' },
      isViewerComment: true,
    })
    off()
  })
```

Keep the file's existing `createCommentsStorage` helper and its oldest-first ordering (`commentThread` is sorted by `ts` ascending; `CommentThread.tsx` reverses it for display).

- [ ] **Step 2: Run it to confirm it fails**

Run: `pnpm --filter widgets-ofelia-poop-duty exec vitest run model/ofelia-comments.test.ts`
Expected: FAIL — `CommentView` still carries `authorName`, `date` and `ipTail`.

- [ ] **Step 3: Implement**

```ts
export type CommentView = {
  id: string
  text: string
  author: EntryAuthor
  createdAt: number
  isViewerComment: boolean
}

  const commentThread = computed<CommentView[]>(() => {
    const members = identity.members()
    const viewerAccountId = identity.viewer()?.accountId ?? null

    return comments()
      .toSorted((left, right) => left.ts - right.ts)
      .map((comment) => {
        const author = resolveEntryAuthor(comment.createdBy, comment.author, members)
        return {
          id: comment.id,
          text: comment.text,
          author,
          createdAt: comment.ts,
          isViewerComment:
            author.kind === 'account' &&
            viewerAccountId !== null &&
            author.accountId === viewerAccountId,
        }
      })
  }, 'ofeliaComments.commentThread')
```

Formatting moves out of the model entirely — `formatDateShort` is no longer imported here; `CommentThread.tsx` formats `createdAt` in Task 14.

- [ ] **Step 4: Run it to confirm it passes**

Run: `pnpm --filter widgets-ofelia-poop-duty exec vitest run model/ofelia-comments.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add packages/widgets/ofelia-poop-duty
git commit -m "feat(ofelia): resolve comment authors through the members directory"
```

---

### Task 12: The account circle and its tokens

**Files:**
- Create: `packages/widgets/ofelia-poop-duty/ui/member.ts`
- Create: `packages/widgets/ofelia-poop-duty/ui/member.test.ts`
- Create: `packages/widgets/ofelia-poop-duty/ui/parts/MemberAvatar.tsx`
- Create: `packages/widgets/ofelia-poop-duty/ui/parts/MemberAvatar.module.css`
- Create: `packages/widgets/ofelia-poop-duty/ui/parts/MemberAvatar.test.tsx`
- Modify: `packages/widgets/ofelia-poop-duty/ui/ofelia-poop-duty.module.css`

**Interfaces:**
- Consumes: Task 6's `EntryAuthor`.
- Produces: `memberTone(accountId: string): MemberTone`, `memberInitial(name: string): string`, and `<MemberAvatar author={…} isViewer={…} px={…} />`. Tasks 13 and 14 render it.

Open `design/OfeliaPanels.dc.html` before this task: the account circle is a **rounded square** (`border-radius` 6–7px at 18–22px), while the duty circle stays a full circle. That shape difference is the only thing separating the two, so it must not be softened.

- [ ] **Step 1: Write the failing tone test**

Create `packages/widgets/ofelia-poop-duty/ui/member.test.ts`:

```ts
// @vitest-environment node
import { describe, expect, it } from 'vitest'

import { MEMBER_TONES, memberInitial, memberTone } from './member'

describe('memberTone', () => {
  it('is stable for the same id', () => {
    expect(memberTone('abc')).toBe(memberTone('abc'))
  })

  it('always lands inside the palette', () => {
    for (const id of ['', 'a', 'zzzzzzzzzzzz', '9f-_A']) {
      expect(MEMBER_TONES).toContain(memberTone(id))
    }
  })

  it('spreads different ids across more than one tone', () => {
    const tones = new Set(Array.from({ length: 50 }, (_, i) => memberTone(`account-${i}`)))
    expect(tones.size).toBeGreaterThan(1)
  })
})

describe('memberInitial', () => {
  it('takes the first letter, upper-cased', () => {
    expect(memberInitial('карина')).toBe('К')
  })

  it('ignores surrounding whitespace', () => {
    expect(memberInitial('  Лёша ')).toBe('Л')
  })

  it('is a placeholder for an empty name', () => {
    expect(memberInitial('   ')).toBe('?')
  })
})
```

- [ ] **Step 2: Run it to confirm it fails, then implement**

Run: `pnpm --filter widgets-ofelia-poop-duty exec vitest run ui/member.test.ts`
Expected: FAIL — cannot resolve `./member`.

Create `packages/widgets/ofelia-poop-duty/ui/member.ts`:

```ts
/**
 * Account tones are hashed from the account id, deliberately NOT taken from the
 * duty rotation: accounts and duty people are independent axes and there may be
 * more accounts than roster slots.
 */
export const MEMBER_TONES = ['1', '2', '3', '4', '5', '6'] as const

export type MemberTone = (typeof MEMBER_TONES)[number]

export function memberTone(accountId: string): MemberTone {
  let hash = 0
  for (let index = 0; index < accountId.length; index++) {
    hash = (hash * 31 + accountId.charCodeAt(index)) >>> 0
  }
  return MEMBER_TONES[hash % MEMBER_TONES.length]
}

export function memberInitial(name: string): string {
  const trimmed = name.trim()
  return trimmed.length === 0 ? '?' : trimmed.slice(0, 1).toUpperCase()
}
```

Run it again.
Expected: PASS.

- [ ] **Step 3: Add the tokens**

In `packages/widgets/ofelia-poop-duty/ui/ofelia-poop-duty.module.css`, inside `.widget`:

```css
  --ofelia-debt-soft: oklch(0.955 0.035 25);
  --ofelia-debt-fg: oklch(0.5 0.15 27);
  --ofelia-member-1-bg: oklch(0.9 0.05 300);
  --ofelia-member-1-fg: oklch(0.4 0.13 300);
  --ofelia-member-2-bg: oklch(0.9 0.048 197);
  --ofelia-member-2-fg: oklch(0.4 0.1 200);
  --ofelia-member-3-bg: oklch(0.9 0.05 145);
  --ofelia-member-3-fg: oklch(0.4 0.12 150);
  --ofelia-member-4-bg: oklch(0.91 0.05 65);
  --ofelia-member-4-fg: oklch(0.42 0.12 60);
  --ofelia-member-5-bg: oklch(0.9 0.05 345);
  --ofelia-member-5-fg: oklch(0.41 0.13 345);
  --ofelia-member-6-bg: oklch(0.9 0.045 255);
  --ofelia-member-6-fg: oklch(0.4 0.11 258);
```

and inside `:root[data-theme='dark'] .widget`:

```css
  --ofelia-debt-soft: oklch(0.35 0.085 25);
  --ofelia-debt-fg: oklch(0.88 0.09 28);
  --ofelia-member-1-bg: oklch(0.38 0.09 300);
  --ofelia-member-1-fg: oklch(0.92 0.06 300);
  --ofelia-member-2-bg: oklch(0.36 0.07 200);
  --ofelia-member-2-fg: oklch(0.92 0.05 200);
  --ofelia-member-3-bg: oklch(0.36 0.075 148);
  --ofelia-member-3-fg: oklch(0.92 0.06 150);
  --ofelia-member-4-bg: oklch(0.38 0.075 62);
  --ofelia-member-4-fg: oklch(0.93 0.06 65);
  --ofelia-member-5-bg: oklch(0.37 0.085 345);
  --ofelia-member-5-fg: oklch(0.92 0.06 345);
  --ofelia-member-6-bg: oklch(0.36 0.07 256);
  --ofelia-member-6-fg: oklch(0.92 0.05 256);
```

- [ ] **Step 4: Write the failing component test**

Create `packages/widgets/ofelia-poop-duty/ui/parts/MemberAvatar.test.tsx`:

```tsx
// @vitest-environment jsdom
import { render, screen } from '@testing-library/react'
import { describe, expect, it } from 'vitest'

import { MemberAvatar } from './MemberAvatar'

describe('MemberAvatar', () => {
  it('renders the account initial', () => {
    render(<MemberAvatar author={{ kind: 'account', accountId: 'a1', name: 'Карина' }} />)
    expect(screen.getByTitle('Карина')).toHaveTextContent('К')
  })

  it('renders the avatar image when the directory has one', () => {
    render(
      <MemberAvatar
        author={{ kind: 'account', accountId: 'a1', name: 'Карина', avatarUrl: '/k.png' }}
      />,
    )
    expect(screen.getByRole('img', { name: 'Карина' })).toHaveAttribute('src', '/k.png')
  })

  it('marks the viewer', () => {
    const { container } = render(
      <MemberAvatar author={{ kind: 'account', accountId: 'a1', name: 'Карина' }} isViewer />,
    )
    expect(container.firstElementChild).toHaveAttribute('data-viewer', 'true')
  })

  it('falls back to a duty circle for a legacy author', () => {
    const { container } = render(<MemberAvatar author={{ kind: 'person', person: 'Леша' }} />)
    expect(container.firstElementChild).toHaveAttribute('data-kind', 'person')
    expect(screen.getByText('Л')).toBeInTheDocument()
  })

  it('renders a placeholder for an unknown author', () => {
    const { container } = render(<MemberAvatar author={{ kind: 'unknown' }} />)
    expect(container.firstElementChild).toHaveAttribute('data-kind', 'unknown')
    expect(screen.getByText('?')).toBeInTheDocument()
  })
})
```

- [ ] **Step 5: Run it to confirm it fails, then implement**

Run: `pnpm --filter widgets-ofelia-poop-duty exec vitest run ui/parts/MemberAvatar.test.tsx`
Expected: FAIL — cannot resolve `./MemberAvatar`.

Create `packages/widgets/ofelia-poop-duty/ui/parts/MemberAvatar.tsx`:

```tsx
import { reatomMemo } from 'widget-sdk/reatom/reatom-memo'

import type { EntryAuthor } from '@/domain/author'

import { memberInitial, memberTone } from '../member'
import { personInitial, personTone } from '../person'

import styles from './MemberAvatar.module.css'

export type MemberAvatarProps = {
  author: EntryAuthor
  isViewer?: boolean
  px?: number
}

export const MemberAvatar = reatomMemo<MemberAvatarProps>(({ author, isViewer = false, px = 18 }) => {
  const style = { inlineSize: `${px}px`, blockSize: `${px}px`, fontSize: `${px * 0.5}px` }

  if (author.kind === 'unknown') {
    return (
      <span
        className={styles.avatar}
        data-kind="unknown"
        style={style}
        title="Автор неизвестен"
        aria-hidden
      >
        ?
      </span>
    )
  }

  // A record written before accounts existed carries only a duty signature, so
  // the duty circle stands in — deliberately the round shape, not the square.
  if (author.kind === 'person') {
    return (
      <span
        className={styles.avatar}
        data-kind="person"
        data-tone={personTone(author.person)}
        style={style}
        title={`${author.person} · без аккаунта`}
        aria-hidden
      >
        {personInitial(author.person)}
      </span>
    )
  }

  return (
    <span
      className={styles.avatar}
      data-kind="account"
      data-tone={memberTone(author.accountId)}
      data-viewer={isViewer}
      style={style}
      title={author.name}
    >
      {author.avatarUrl ? (
        <img className={styles.image} src={author.avatarUrl} alt={author.name} />
      ) : (
        memberInitial(author.name)
      )}
    </span>
  )
}, 'MemberAvatar')
```

`MemberAvatar.module.css`:

```css
.avatar {
  flex: none;
  display: grid;
  place-items: center;
  overflow: hidden;
  font-weight: 600;
  line-height: 1;
  /* Square-with-radius is what separates an account from a duty person. */
  border-radius: 0.375rem;
}

.avatar[data-kind='person'] {
  border-radius: 999px;
}

.avatar[data-kind='unknown'] {
  border: 1.5px dashed var(--border-strong);
  color: var(--text-3);
}

.avatar[data-viewer='true'] {
  box-shadow:
    0 0 0 1.5px var(--surface),
    0 0 0 3px var(--primary);
}

.avatar[data-tone='k'] {
  background: var(--ofelia-k-bg);
  color: var(--ofelia-k-fg);
}

.avatar[data-tone='l'] {
  background: var(--ofelia-l-bg);
  color: var(--ofelia-l-fg);
}

.avatar[data-tone='1'] {
  background: var(--ofelia-member-1-bg);
  color: var(--ofelia-member-1-fg);
}

.avatar[data-tone='2'] {
  background: var(--ofelia-member-2-bg);
  color: var(--ofelia-member-2-fg);
}

.avatar[data-tone='3'] {
  background: var(--ofelia-member-3-bg);
  color: var(--ofelia-member-3-fg);
}

.avatar[data-tone='4'] {
  background: var(--ofelia-member-4-bg);
  color: var(--ofelia-member-4-fg);
}

.avatar[data-tone='5'] {
  background: var(--ofelia-member-5-bg);
  color: var(--ofelia-member-5-fg);
}

.avatar[data-tone='6'] {
  background: var(--ofelia-member-6-bg);
  color: var(--ofelia-member-6-fg);
}

.image {
  inline-size: 100%;
  block-size: 100%;
  object-fit: cover;
}
```

Run the test again.
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add packages/widgets/ofelia-poop-duty/ui
git commit -m "feat(ofelia): add the account avatar and its palette"
```

---

### Task 13: Rebuild the history list

**Files:**
- Create: `packages/widgets/ofelia-poop-duty/ui/history-format.ts`
- Create: `packages/widgets/ofelia-poop-duty/ui/history-format.test.ts`
- Modify: `packages/widgets/ofelia-poop-duty/ui/format.ts`
- Rewrite: `packages/widgets/ofelia-poop-duty/ui/parts/HistoryList.tsx`, `HistoryList.module.css`, `HistoryList.test.tsx`
- Modify: `packages/widgets/ofelia-poop-duty/ui/parts/RichLayout.tsx` (`HistoryColumn`)

**Interfaces:**
- Consumes: Tasks 10 and 12.
- Produces: `<HistoryList groups={HistoryDayGroup[]} today={string | null} />`, and from `history-format.ts`: `formatDayMonth(iso: string)`, `formatDutyDay(dutyDate: string, todayIso: string | null)`, `formatWeekdayShort(dutyDate: string)`, `formatTimeOfDay(epochMs: number)`, `formatRecordedDate(epochMs: number)`, `describeEntry(entry): ActionPhrase`, plus the `PhrasePart` / `ActionPhrase` types. Task 14 consumes `formatDayMonth` and `formatTimeOfDay`.

The mock (`design/OfeliaPanels.dc.html`, the `.ofp-hist` column) is the reference for layout. Copy: sticky group headers, the inline circles inside the phrase, the debt pill, the dashed rail under superseded records.

- [ ] **Step 1: Write the failing formatter test**

Create `packages/widgets/ofelia-poop-duty/ui/history-format.test.ts`:

```ts
// @vitest-environment node
import { describe, expect, it } from 'vitest'

import { describeEntry, formatDutyDay, formatTimeOfDay, formatWeekdayShort } from './history-format'
import type { HistoryEntryView } from '@/model/history-view'

const view = (o: Partial<HistoryEntryView> = {}): HistoryEntryView => ({
  id: 'e1', type: 'cleaned', actor: 'Леша', dutyDate: '2026-06-16', recordedAt: 0,
  recordedBy: { kind: 'unknown' }, isViewerRecord: false, recordedLate: false, debtDelta: null,
  ...o,
})

describe('formatDutyDay', () => {
  it('says сегодня for the current duty day', () => {
    expect(formatDutyDay('2026-06-16', '2026-06-16')).toBe('сегодня')
  })

  it('says вчера for the day before', () => {
    expect(formatDutyDay('2026-06-15', '2026-06-16')).toBe('вчера')
  })

  it('falls back to a day and month', () => {
    expect(formatDutyDay('2026-06-12', '2026-06-16')).toBe('12 июня')
  })

  it('falls back to a day and month when today is unknown', () => {
    expect(formatDutyDay('2026-06-16', null)).toBe('16 июня')
  })
})

describe('formatWeekdayShort', () => {
  it('is the lowercase two-letter weekday', () => {
    expect(formatWeekdayShort('2026-06-16')).toBe('вт')
  })
})

describe('formatTimeOfDay', () => {
  it('is zero-padded 24-hour local time in the duty time zone', () => {
    // 2026-06-16 21:40 Europe/Warsaw
    expect(formatTimeOfDay(Date.UTC(2026, 5, 16, 19, 40))).toBe('21:40')
  })
})

describe('describeEntry', () => {
  it('describes a plain cleaned day', () => {
    expect(describeEntry(view())).toEqual({ parts: [{ person: 'Леша' }, ' убрал(а)'] })
  })

  it('describes cleaning on behalf of someone', () => {
    expect(describeEntry(view({ onBehalfOf: 'Карина' }))).toEqual({
      parts: [{ person: 'Леша' }, ' убрал(а) за ', { person: 'Карина' }],
    })
  })

  it('describes going into debt', () => {
    expect(describeEntry(view({ type: 'went_into_debt', actor: 'Леша', onBehalfOf: 'Карина' }))).toEqual({
      parts: [{ person: 'Карина' }, ' ушёл(ла) в долг → убирает ', { person: 'Леша' }],
    })
  })

  it('describes forgiveness', () => {
    expect(describeEntry(view({ type: 'forgiven', actor: 'Леша', onBehalfOf: 'Карина' }))).toEqual({
      parts: [{ person: 'Леша' }, ' простил(а) день ', { person: 'Карина' }],
    })
  })

  it('never names a person on a reset', () => {
    expect(describeEntry(view({ type: 'reset', actor: 'Леша' }))).toEqual({
      parts: ['день переоткрыт'],
    })
  })
})
```

- [ ] **Step 2: Run it to confirm it fails, then implement**

Run: `pnpm --filter widgets-ofelia-poop-duty exec vitest run ui/history-format.test.ts`
Expected: FAIL — cannot resolve `./history-format`.

Create `packages/widgets/ofelia-poop-duty/ui/history-format.ts`:

```ts
import { DUTY_TIME_ZONE, plainDateIn, type Person } from '@/domain/roster'
import type { HistoryEntryView } from '@/model/history-view'

import { MONTHS_GENITIVE } from './format'

const WEEKDAYS_SHORT = ['пн', 'вт', 'ср', 'чт', 'пт', 'сб', 'вс'] as const

/** A phrase is a mix of literal text and duty circles rendered inline. */
export type PhrasePart = string | { person: Person }
export type ActionPhrase = { parts: PhrasePart[] }

export function formatDayMonth(iso: string): string {
  const date = Temporal.PlainDate.from(iso)
  return `${date.day} ${MONTHS_GENITIVE[date.month - 1]}`
}

export function formatDutyDay(dutyDate: string, todayIso: string | null): string {
  if (todayIso === null) return formatDayMonth(dutyDate)
  if (dutyDate === todayIso) return 'сегодня'

  const yesterday = Temporal.PlainDate.from(todayIso).subtract({ days: 1 }).toString()
  if (dutyDate === yesterday) return 'вчера'

  return formatDayMonth(dutyDate)
}

export function formatWeekdayShort(dutyDate: string): string {
  return WEEKDAYS_SHORT[Temporal.PlainDate.from(dutyDate).dayOfWeek - 1]
}

export function formatTimeOfDay(epochMs: number): string {
  const zoned = Temporal.Instant.fromEpochMilliseconds(epochMs).toZonedDateTimeISO(DUTY_TIME_ZONE)
  return `${String(zoned.hour).padStart(2, '0')}:${String(zoned.minute).padStart(2, '0')}`
}

export function formatRecordedDate(epochMs: number): string {
  return formatDayMonth(plainDateIn(DUTY_TIME_ZONE, epochMs).toString())
}

/**
 * Generic gender forms throughout: neither the roster nor an account carries a
 * gender, and adding one is explicitly out of scope.
 *
 * `reset` never names anyone: its `actor` is whose closure was undone, not who
 * undid it.
 */
export function describeEntry(entry: HistoryEntryView): ActionPhrase {
  if (entry.type === 'reset') return { parts: ['день переоткрыт'] }

  if (entry.type === 'went_into_debt' && entry.onBehalfOf) {
    return {
      parts: [{ person: entry.onBehalfOf }, ' ушёл(ла) в долг → убирает ', { person: entry.actor }],
    }
  }

  if (entry.type === 'forgiven' && entry.onBehalfOf) {
    return { parts: [{ person: entry.actor }, ' простил(а) день ', { person: entry.onBehalfOf }] }
  }

  if (entry.onBehalfOf) {
    return { parts: [{ person: entry.actor }, ' убрал(а) за ', { person: entry.onBehalfOf }] }
  }

  return { parts: [{ person: entry.actor }, ' убрал(а)'] }
}
```

Export `MONTHS_GENITIVE` from `ui/format.ts` (it is currently module-private).

Run it again.
Expected: PASS.

- [ ] **Step 3: Write the failing list test**

Rewrite `packages/widgets/ofelia-poop-duty/ui/parts/HistoryList.test.tsx`:

```tsx
// @vitest-environment jsdom
import { render, screen, within } from '@testing-library/react'
import { describe, expect, it } from 'vitest'

import type { HistoryDayGroup, HistoryEntryView } from '@/model/history-view'

import { HistoryList } from './HistoryList'

const KARINA = { kind: 'account', accountId: 'a1', name: 'Карина' } as const

const view = (o: Partial<HistoryEntryView> = {}): HistoryEntryView => ({
  id: 'e1', type: 'cleaned', actor: 'Леша', dutyDate: '2026-06-16',
  recordedAt: Date.UTC(2026, 5, 16, 19, 40), recordedBy: KARINA,
  isViewerRecord: false, recordedLate: false, debtDelta: null, ...o,
})

const group = (o: Partial<HistoryDayGroup> = {}): HistoryDayGroup => ({
  dutyDate: '2026-06-16', current: view(), superseded: [], ...o,
})

describe('HistoryList', () => {
  it('renders the day header and the signature', () => {
    render(<HistoryList groups={[group()]} today="2026-06-16" />)

    expect(screen.getByText('сегодня')).toBeInTheDocument()
    expect(screen.getByText('вт')).toBeInTheDocument()
    expect(screen.getByText('отметил(а) Карина')).toBeInTheDocument()
    expect(screen.getByText('21:40')).toBeInTheDocument()
  })

  it('never renders an ip', () => {
    const { container } = render(<HistoryList groups={[group()]} today="2026-06-16" />)
    expect(container.textContent).not.toMatch(/\d+\.\d+\.\d+/)
  })

  it('renders the debt pill with its amount', () => {
    render(
      <HistoryList
        groups={[group({ current: view({ debtDelta: { person: 'Карина', amount: 1 } }) })]}
        today="2026-06-16"
      />,
    )
    expect(screen.getByText('+1 день')).toBeInTheDocument()
  })

  it('marks superseded records and counts them in the header', () => {
    render(
      <HistoryList
        groups={[group({ superseded: [view({ id: 'old', type: 'reset' })] })]}
        today="2026-06-16"
      />,
    )

    expect(screen.getByText('2 записи')).toBeInTheDocument()
    const stale = screen.getByTestId('history-superseded-old')
    expect(within(stale).getByText('перекрыто')).toBeInTheDocument()
  })

  it('shows the recording date when it differs from the duty day', () => {
    render(
      <HistoryList
        groups={[group({ current: view({ recordedLate: true, recordedAt: Date.UTC(2026, 5, 18, 19, 40) }) })]}
        today="2026-06-18"
      />,
    )
    expect(screen.getByText('18 июня')).toBeInTheDocument()
  })

  it('renders an empty state', () => {
    render(<HistoryList groups={[]} today="2026-06-16" />)
    expect(screen.getByText('Пока нет событий')).toBeInTheDocument()
  })
})
```

- [ ] **Step 4: Run it to confirm it fails, then rewrite the component**

Run: `pnpm --filter widgets-ofelia-poop-duty exec vitest run ui/parts/HistoryList.test.tsx`
Expected: FAIL — `HistoryList` still takes `entries`.

Rewrite `HistoryList.tsx`. Structure, mirroring the mock:

```tsx
import { reatomMemo } from 'widget-sdk/reatom/reatom-memo'

import type { HistoryDayGroup, HistoryEntryView } from '@/model/history-view'

import {
  describeEntry,
  formatDutyDay,
  formatRecordedDate,
  formatTimeOfDay,
  formatWeekdayShort,
} from '../history-format'
import { Avatar } from './Avatar'
import { MemberAvatar } from './MemberAvatar'

import styles from './HistoryList.module.css'

const authorName = (entry: HistoryEntryView): string => {
  if (entry.recordedBy.kind === 'account') return entry.recordedBy.name
  if (entry.recordedBy.kind === 'person') return entry.recordedBy.person
  return 'автор неизвестен'
}

const Phrase = reatomMemo<{ entry: HistoryEntryView }>(({ entry }) => (
  <span className={styles.phrase}>
    {describeEntry(entry).parts.map((part, index) =>
      typeof part === 'string' ? (
        <span key={index}>{part}</span>
      ) : (
        <Avatar key={index} person={part.person} px={18} />
      ),
    )}
  </span>
), 'HistoryPhrase')

const Entry = reatomMemo<{ entry: HistoryEntryView; superseded?: boolean }>(
  ({ entry, superseded = false }) => (
    <div
      className={styles.entry}
      data-superseded={superseded}
      {...(superseded ? { 'data-testid': `history-superseded-${entry.id}` } : {})}
    >
      <div className={styles.action}>
        <Phrase entry={entry} />
        {entry.debtDelta ? (
          <span className={styles.debt} data-sign={entry.debtDelta.amount > 0 ? 'up' : 'down'}>
            <Avatar person={entry.debtDelta.person} px={13} />
            {entry.debtDelta.amount > 0 ? '+1 день' : '−1 день'}
          </span>
        ) : null}
        {superseded ? <span className={styles.stale}>перекрыто</span> : null}
      </div>
      <div className={styles.signature}>
        <MemberAvatar author={entry.recordedBy} isViewer={entry.isViewerRecord} px={18} />
        <span className={styles.signatureName}>
          {entry.recordedBy.kind === 'unknown'
            ? 'автор неизвестен'
            : `отметил(а) ${authorName(entry)}`}
        </span>
        {entry.recordedBy.kind === 'person' ? (
          <span className={styles.legacy}>без аккаунта</span>
        ) : null}
        {entry.recordedLate ? (
          <span className={styles.late}>
            <Clock size={9} aria-hidden />
            {formatRecordedDate(entry.recordedAt)}
          </span>
        ) : null}
        <span className={styles.time}>{formatTimeOfDay(entry.recordedAt)}</span>
      </div>
    </div>
  ),
  'HistoryEntry',
)
```

and the exported list:

```tsx
export type HistoryListProps = {
  groups: HistoryDayGroup[]
  today: string | null
}

export const HistoryList = reatomMemo<HistoryListProps>(({ groups, today }) => {
  if (groups.length === 0) return <div className={styles.empty}>Пока нет событий</div>

  return (
    <div className={styles.list}>
      {groups.map((group) => (
        <section key={group.dutyDate} className={styles.group}>
          <header className={styles.groupHeader}>
            <span className={styles.groupDay}>{formatDutyDay(group.dutyDate, today)}</span>
            <span className={styles.groupWeekday}>{formatWeekdayShort(group.dutyDate)}</span>
            <span className={styles.groupRule} />
            {group.superseded.length > 0 ? (
              <span className={styles.groupCount}>
                {pluralizeRecords(group.superseded.length + 1)}
              </span>
            ) : null}
          </header>
          <Entry entry={group.current} />
          {group.superseded.length > 0 ? (
            <div className={styles.supersededRail}>
              {group.superseded.map((entry) => (
                <Entry key={entry.id} entry={entry} superseded />
              ))}
            </div>
          ) : null}
        </section>
      ))}
    </div>
  )
}, 'HistoryList')
```

Add `pluralizeRecords(n)` next to `pluralizeDays` in `ui/format.ts` — `запись` / `записи` / `записей`, same 11–14 exception.

Import `Clock` from `lucide-react`.

Rewrite `HistoryList.module.css` from the mock's `.ofp-hist` block: sticky headers (`position: sticky; top: 0; background: var(--surface)`), the debt pill (`--ofelia-debt-*` for `data-sign="up"`, `--ofelia-ok-soft`/`--ofelia-ok-fg` for `down`), and the superseded rail (`border-inline-start: 1.5px dashed var(--border-strong)`, dimmed, `text-decoration: line-through` on `.phrase`). **Set `text-decoration: none` on the pill's inner `Avatar`** — `line-through` otherwise propagates into it, which the mock had to defeat the same way.

Verify the dimmed superseded text against `--text-dim` in dark theme; if contrast is poor, dim with a `color` token instead of `opacity`.

- [ ] **Step 5: Run it to confirm it passes**

Run: `pnpm --filter widgets-ofelia-poop-duty exec vitest run ui/`
Expected: PASS.

- [ ] **Step 6: Update the column wiring**

In `ui/parts/RichLayout.tsx`, `HistoryColumn` becomes:

```tsx
const HistoryColumn = reatomMemo(() => {
  const { history, today } = useOfelia()
  return <HistoryList groups={history()} today={today()?.toString() ?? null} />
}, 'HistoryColumn')
```

In `ui/ofelia-context.ts`, `history` changes type and `today` is added:

```ts
  history: AtomLike<HistoryDayGroup[]>
  today: AtomLike<Temporal.PlainDate | null>
```

Feed `today` from `dutyModel.today` in `OfeliaPoopDuty.tsx`, and in `ui/ofelia.fixture.ts` change the `history` atom to `atom<HistoryDayGroup[]>(o.history ?? [], 'fixture.history')` and add `today: atom<Temporal.PlainDate | null>(o.today ?? Temporal.PlainDate.from('2026-06-16'), 'fixture.today')`.

- [ ] **Step 7: Commit**

```bash
git add packages/widgets/ofelia-poop-duty/ui
git commit -m "feat(ofelia): rebuild the history list around duty-day groups"
```

---

### Task 14: Rebuild the comment thread and clean up the header

**Files:**
- Rewrite: `packages/widgets/ofelia-poop-duty/ui/parts/CommentThread.tsx`, `CommentThread.module.css`, `CommentThread.test.tsx`
- Modify: `packages/widgets/ofelia-poop-duty/ui/parts/RichLayout.tsx`, `RichLayout.module.css`
- Modify: `packages/widgets/ofelia-poop-duty/ui/ofelia-context.ts`, `ui/ofelia.fixture.ts`

**Interfaces:**
- Consumes: Tasks 11 and 12.
- Produces: `<CommentThread comments={CommentView[]} viewer={EntryAuthor | null} onSend={…} />`; `OfeliaContextValue.viewer: AtomLike<BoardMember | null>`.

- [ ] **Step 1: Write the failing test**

Rewrite `CommentThread.test.tsx`:

```tsx
// @vitest-environment jsdom
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it, vi } from 'vitest'

import type { CommentView } from '@/model/ofelia-comments'

import { CommentThread } from './CommentThread'

const comment = (o: Partial<CommentView> = {}): CommentView => ({
  id: 'c1',
  text: 'привет',
  author: { kind: 'account', accountId: 'a1', name: 'Карина' },
  createdAt: Date.UTC(2026, 5, 16, 19, 44),
  isViewerComment: false,
  ...o,
})

const TODAY = '2026-06-16'

const renderThread = (props: Partial<Parameters<typeof CommentThread>[0]> = {}) =>
  render(
    <CommentThread comments={[]} viewer={null} today={TODAY} onSend={vi.fn()} {...props} />,
  )

describe('CommentThread', () => {
  it('renders the author, the time and the text', () => {
    renderThread({ comments: [comment()] })

    expect(screen.getByText('Карина')).toBeInTheDocument()
    expect(screen.getByText('21:44')).toBeInTheDocument()
    expect(screen.getByText('привет')).toBeInTheDocument()
  })

  it('prefixes older comments with their date', () => {
    renderThread({ comments: [comment({ createdAt: Date.UTC(2026, 5, 14, 19, 44) })] })

    expect(screen.getByText('14 июня, 21:44')).toBeInTheDocument()
  })

  it('labels a legacy author', () => {
    renderThread({ comments: [comment({ author: { kind: 'person', person: 'Леша' } })] })

    expect(screen.getByText('без аккаунта')).toBeInTheDocument()
  })

  it('labels an unknown author', () => {
    renderThread({ comments: [comment({ author: { kind: 'unknown' } })] })

    expect(screen.getByText('автор неизвестен')).toBeInTheDocument()
  })

  it('never renders an ip', () => {
    const { container } = renderThread({ comments: [comment()] })

    expect(container.textContent).not.toMatch(/\d+\.\d+\.\d+/)
  })

  it('sends the trimmed text and clears the field', async () => {
    const onSend = vi.fn(async () => {})
    renderThread({ onSend })

    const input = screen.getByLabelText('Комментарий')
    await userEvent.type(input, '  тест  ')
    await userEvent.click(screen.getByLabelText('Отправить'))

    expect(onSend).toHaveBeenCalledWith('тест')
    expect(input).toHaveValue('')
  })

  it('renders an empty state', () => {
    renderThread()

    expect(screen.getByText('Пока нет комментариев')).toBeInTheDocument()
  })
})
```

Note the separators: the middot before a timestamp is a CSS `::before`, never a text node, so `getByText('21:44')` matches. Do the same in `HistoryList.module.css`.

- [ ] **Step 2: Run it to confirm it fails, then rewrite**

Run: `pnpm --filter widgets-ofelia-poop-duty exec vitest run ui/parts/CommentThread.test.tsx`
Expected: FAIL — the component still reads `comment.authorName` / `comment.date` / `comment.ipTail`.

Rewrite `CommentThread.tsx`. The composer keeps its current behaviour and every aria label; only the row body and the left adornment are new:

```tsx
import { Send } from 'lucide-react'
import { useRef, useState } from 'react'
import { reatomMemo } from 'widget-sdk/reatom/reatom-memo'

import type { EntryAuthor } from '@/domain/author'
import type { CommentView } from '@/model/ofelia-comments'

import { DUTY_TIME_ZONE, plainDateIn } from '@/domain/roster'

import { formatDayMonth, formatTimeOfDay } from '../history-format'
import { MemberAvatar } from './MemberAvatar'

import styles from './CommentThread.module.css'

function authorName(author: EntryAuthor): string {
  if (author.kind === 'account') return author.name
  if (author.kind === 'person') return author.person
  return 'автор неизвестен'
}

// Same-day comments show only a time; anything older is prefixed with its date.
// `today` is a prop rather than `Temporal.Now` so the component stays pure and
// testable, exactly like HistoryList.
function formatCommentStamp(createdAt: number, todayIso: string | null): string {
  const time = formatTimeOfDay(createdAt)
  const day = plainDateIn(DUTY_TIME_ZONE, createdAt).toString()
  return day === todayIso ? time : `${formatDayMonth(day)}, ${time}`
}

const Row = reatomMemo<{ comment: CommentView; today: string | null }>(({ comment, today }) => (
  <li className={styles.item}>
    <MemberAvatar author={comment.author} isViewer={comment.isViewerComment} px={22} />
    <div className={styles.body}>
      <div className={styles.meta}>
        <span className={styles.author}>{authorName(comment.author)}</span>
        {comment.author.kind === 'person' ? (
          <span className={styles.legacy}>без аккаунта</span>
        ) : null}
        <span className={styles.date}>{formatCommentStamp(comment.createdAt, today)}</span>
      </div>
      <div className={styles.text}>{comment.text}</div>
    </div>
  </li>
), 'CommentRow')

export type CommentThreadProps = {
  comments: CommentView[]
  /** The signed-in account, or null while the members directory is still loading. */
  viewer: EntryAuthor | null
  today: string | null
  onSend: (text: string) => Promise<void>
}

export const CommentThread = reatomMemo<CommentThreadProps>(({ comments, viewer, today, onSend }) => {
  const [text, setText] = useState('')
  const inputRef = useRef<HTMLInputElement>(null)
  const listRef = useRef<HTMLUListElement>(null)

  const submit = () => {
    const trimmed = text.trim()
    if (trimmed.length === 0) return

    onSend(trimmed).then(() => {
      listRef.current?.scrollTo(0, 0)
    })
    setText('')
  }

  return (
    <div className={styles.root}>
      {comments.length === 0 ? (
        <div className={styles.empty}>Пока нет комментариев</div>
      ) : (
        <ul ref={listRef} className={styles.list}>
          {[...comments].reverse().map((comment) => (
            <Row key={comment.id} comment={comment} today={today} />
          ))}
        </ul>
      )}

      <form
        className={styles.form}
        onSubmit={(event) => {
          event.preventDefault()
          submit()
          inputRef.current?.focus()
        }}
      >
        {viewer ? (
          <MemberAvatar author={viewer} isViewer px={22} />
        ) : (
          <span className={styles.viewerPending} aria-hidden />
        )}
        <input
          ref={inputRef}
          className={styles.input}
          value={text}
          onChange={(event) => setText(event.target.value)}
          placeholder="Написать комментарий…"
          aria-label="Комментарий"
        />
        <button className={styles.send} type="submit" aria-label="Отправить">
          <Send size={15} aria-hidden />
        </button>
      </form>
    </div>
  )
}, 'CommentThread')
```

`viewerPending` is a neutral 22px square with the same radius as `MemberAvatar` — the **only** loading state in this feature, because every record carries its own name snapshot while `viewer` does not exist until the directory arrives.

In `CommentThread.module.css`, delete `.ip` and add `.legacy` (mono, `0.6rem`, `--text-3`) and `.viewerPending` (`inline-size: 22px; block-size: 22px; border-radius: 0.375rem; background: var(--muted); border: 1px solid var(--border)`).

Run the test again.
Expected: PASS.

- [ ] **Step 3: Wire the viewer through the context**

`ui/ofelia-context.ts` — add `viewer: AtomLike<BoardMember | null>`.
`ui/OfeliaPoopDuty.tsx` — `viewer: identity.viewer`.
`ui/ofelia.fixture.ts` — `viewer: atom<BoardMember | null>(o.viewer ?? null, 'fixture.viewer')`.
`ui/parts/RichLayout.tsx` — `CommentsColumn` passes it:

```tsx
const CommentsColumn = reatomMemo(() => {
  const { comments, viewer, today, onSend } = useOfelia()
  const current = viewer()
  return (
    <CommentThread
      comments={comments()}
      viewer={current ? { kind: 'account', ...current } : null}
      today={today()?.toString() ?? null}
      onSend={onSend}
    />
  )
}, 'CommentsColumn')
```

`{ kind: 'account', ...current }` works because `BoardMember` is `{ accountId, name, avatarUrl? }` — exactly the payload of the `account` variant of `EntryAuthor`.

- [ ] **Step 4: Clean up the header**

In `RichLayout.tsx` the `<div className={styles.headerActions}>` wrapper is now empty — delete it. Delete `.headerActions` from `RichLayout.module.css`, including any rule for it inside the `@container rich-layout` blocks.

Nothing replaces the slot: per the spec there is no "signed in as" affordance in the header.

Leave the `@container rich-layout (max-width: 52rem)` breakpoint and `MobileTabs` exactly as they are. The mock expresses the same collapse with its own container at 480px; keeping one container box and one breakpoint is deliberate.

- [ ] **Step 5: Verify the whole widget**

Run: `pnpm --filter widgets-ofelia-poop-duty exec vitest run`
Expected: PASS.

Run: `pnpm --filter widgets-ofelia-poop-duty exec vite build`
Expected: the federation remote builds.

- [ ] **Step 6: Look at it**

Run: `pnpm dev`
Open the Ofelia harness, drag the card to `large`, then open fullscreen, then narrow the window past the tab breakpoint. Compare against `design/Офелия - история и комментарии.dc.html` frames 1a, 1b, 1c and 1d, and toggle the board theme to check the dark variants (1e, 1f).

- [ ] **Step 7: Commit**

```bash
git add packages/widgets/ofelia-poop-duty/ui
git commit -m "feat(ofelia): rebuild the comment thread around account authors"
```

---

### Task 15: Full gate, end-to-end proof and documentation

**Files:**
- Modify: `packages/client/e2e/ofelia-duty.spec.ts` (only if it breaks)
- Modify: `CLAUDE.md`
- Modify: `docs/superpowers/specs/2026-07-26-widget-server-cron-design.md` and `docs/superpowers/plans/2026-07-26-widget-server-cron.md` — **only if that branch has already been rebased onto this one**; otherwise leave a note in the PR body instead

**Interfaces:**
- Consumes: everything.
- Produces: a branch ready for a PR into `dev`.

- [ ] **Step 1: Run the full local gate**

Run: `pnpm check`
Expected: PASS (lint + format:check + deps:check + typecheck + tests).

- [ ] **Step 2: Prove the write path end to end**

Run: `pnpm test:e2e:docker`
Expected: PASS.

`packages/client/e2e/ofelia-duty.spec.ts` drives the `standard` tier, which renders neither panel, so it should survive untouched — but its actions now travel through `POST /api/widgets/ofelia-poop-duty/clean` instead of `POST /api/storage/.../append`. If it fails, check that route first; the e2e stack has no nginx and therefore no session, so `viewer` is `null` and entries are written unattributed. That is expected, not a failure.

- [ ] **Step 3: Add e2e coverage for the new write path**

Append to `packages/client/e2e/ofelia-duty.spec.ts`:

```ts
test('a confirmed day is written through the widget server event', async ({ page }) => {
  const ofelia = new OfeliaPage(page)
  await ofelia.seedOfeliaWidget()

  const request = page.waitForRequest((candidate) =>
    candidate.url().includes('/api/widgets/ofelia-poop-duty/clean'),
  )
  await ofelia.confirmButton.click()
  await request

  await expect(ofelia.confirmedPlaque).toBeVisible()
})
```

Run: `pnpm --filter client exec playwright test e2e/ofelia-duty.spec.ts`
Expected: PASS.

- [ ] **Step 4: Update the repository guide**

In `CLAUDE.md`, under **Architecture → Widget system**, add a paragraph:

```markdown
Widgets that write shared state do it from their own `server.ts` rather than through
`/api/storage/:key/append`: the widget dispatch route resolves the session cookie into
`WidgetServerContext.viewer`, so the record's author is stamped by the server and cannot be forged.
`WidgetRuntimeProps.identity` gives the client side the same roster (`GET /api/auth/accounts`) for
display — records store an `accountId` plus a frozen name, and display resolves through the
directory so renames and avatars reach old records.
```

Also add a line under **Project structure** noting that `packages/widgets/*/domain/` is
dependency-free code shared by the widget's model and its `server.ts`, enforced by `.oxlintrc.json`.

- [ ] **Step 5: Commit and open the PR**

```bash
git add CLAUDE.md packages/client/e2e
git commit -m "docs: describe server-authored widget records"
git push -u origin feat/ofelia-authored-ledger
gh pr create --base dev
```

The PR body must list the commands actually run (`pnpm check`, `pnpm test:e2e:docker`, both Docker builds from Task 1), attach a screenshot of the large and fullscreen panels in both themes, and state that `feat/widget-server-cron` needs the five revisions listed in the spec's "Impact" section before it can be rebased onto `dev`.
