# PR #20 Review Fixes Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Fix review findings #1, #2, #4, #5 on PR #20 without touching the `@reatom/react` patch (finding #3, out of scope).

**Architecture:** Three independent slices. (Server) `consumePendingTicket` moves from an in-process lock to an atomic Valkey `GETDEL`, closing the cross-instance double-mint race. (Client) the QR scanner remembers where it was opened from via an in-memory reatom atom, so closing it returns to the exact screen (invite token intact) instead of dropping to the home login. (Cleanup) the hand-placed `notify()` calls are reviewed and removed where redundant. A final task pushes the branch so the PR diff matches the merged tree.

**Tech Stack:** TypeScript, `@reatom/core@1001.1.0` (`urlAtom`, `reatomRoute`, `atom`), React 19, Vitest + `@testing-library/react` (jsdom), iovalkey, zod, Playwright e2e.

## Global Constraints

- errore: server + client model code returns `Error | T` unions and checks `instanceof Error`; never throw across the seam.
- Reatom: exported React components are wrapped with `reatomMemo` (`widget-sdk/reatom/reatom-memo`); atoms/actions are named. Reads/writes in raw DOM handlers follow the existing precedent in `ActivateScreen`/`AddDeviceScreen`.
- Storage keys are a persistence contract — this plan changes none.
- The `@reatom/react` `useEffect → useLayoutEffect` patch (finding #3) is **out of scope** — do not touch `patches/@reatom__react.patch`, `pnpm-workspace.yaml`, or the patch rationale.
- Run workspace commands from the repo root with `pnpm`; per `CLAUDE.md`, prefix shell commands with `rtk` (it passes through).
- End every commit message with the trailer `Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>`.
- Single client test file: `pnpm --filter client exec vitest run <path-relative-to-packages/client>`.
- Single server test file: `pnpm --filter server exec vitest run <path-relative-to-packages/server>`.
- `urlAtom` API (confirmed from `@reatom/core` d.ts): `urlAtom(): URL` (so `urlAtom().pathname`, `urlAtom().search`); `urlAtom.go(path: string, replace?: boolean): URL`. Route `.go(params, replace?)` is an Action.

---

### Task 1: Server — atomic single-use consume via `GETDEL`

**Files:**

- Modify: `packages/server/src/storage/valkey.ts` (add `getdel` to `ValkeyOps` type + `buildOps`)
- Modify: `packages/server/src/test/memory-ops.ts` (add `getdel` to the in-memory ops)
- Modify: `packages/server/src/auth/records.ts` (add `getdelJson` helper)
- Modify: `packages/server/src/auth/pending-tickets.ts` (rewrite `consumePendingTicket`)
- Test: `packages/server/src/auth/pending-tickets.test.ts` (add a concurrent-consume case)

**Interfaces:**

- Consumes: existing `PendingTicketRecordSchema`, `pendingKey`, `parseCookies`, `PendingTicketInvalidError`.
- Produces:
  - `ValkeyOps.getdel(key: string): Promise<string | null>`
  - `getdelJson<T>(ops: ValkeyOps, key: string, schema: z.ZodType<T>): Promise<T | null | Error>`
  - `consumePendingTicket(ops, config, now, cookieHeader)` — unchanged signature/return type `Promise<PendingTicketRecord | PendingTicketInvalidError | Error>`, now backed by `getdel` with no `runExclusive`.

- [ ] **Step 1: Add the concurrent-consume failing test**

Append inside the existing `describe('consumePendingTicket', ...)` block in `packages/server/src/auth/pending-tickets.test.ts` (the helpers `makeOps`, `makeClock`, `makeConfig`, `cookieHeaderFor` already exist at the top of that file):

```ts
it('single-use under concurrency: two simultaneous consumes yield exactly one record', async () => {
  const ops = makeOps()
  const clock = makeClock(0)
  const config = makeConfig()

  const { cookie } = await issuePendingTicket(ops, config, clock.now, {
    credentialId: 'cred-1',
    accountId: 'acc-1',
  })
  const header = cookieHeaderFor(cookie)

  const [a, b] = await Promise.all([
    consumePendingTicket(ops, config, clock.now, header),
    consumePendingTicket(ops, config, clock.now, header),
  ])

  const records = [a, b].filter((r) => !(r instanceof Error))
  const invalid = [a, b].filter((r) => r instanceof PendingTicketInvalidError)
  expect(records).toHaveLength(1)
  expect(invalid).toHaveLength(1)
})
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `pnpm --filter server exec vitest run src/auth/pending-tickets.test.ts`
Expected: the new test compiles and runs but is not yet meaningful (the current lock-based `consumePendingTicket` still passes it by luck); this step primarily confirms the file compiles before refactor. If it already passes, proceed — Steps 3–6 replace the implementation and Step 7 re-confirms all cases stay green.

- [ ] **Step 3: Add `getdel` to `ValkeyOps`**

In `packages/server/src/storage/valkey.ts`, add the method to the type and both `buildOps` implementations.

Type (after the `del` line):

```ts
export type ValkeyOps = {
  get(key: string): Promise<string | null>
  set(key: string, value: string, ttlMs?: number): Promise<void>
  del(key: string): Promise<void>
  getdel(key: string): Promise<string | null>
  scanKeys(matchPrefix: string): Promise<string[]>
  publish(channel: string, message: string): Promise<void>
}
```

Implementation inside `buildOps` (after the `del` impl):

```ts
    async getdel(key) {
      return client.getdel(key)
    },
```

- [ ] **Step 4: Add `getdel` to the in-memory test ops**

In `packages/server/src/test/memory-ops.ts`, add inside `createMemoryOps`'s returned object (after `del`):

```ts
    async getdel(key) {
      const value = store.has(key) ? (store.get(key) as string) : null
      store.delete(key)
      return value
    },
```

- [ ] **Step 5: Add the `getdelJson` helper**

In `packages/server/src/auth/records.ts`, add after `getJson`:

```ts
export async function getdelJson<T>(
  ops: ValkeyOps,
  key: string,
  schema: z.ZodType<T>,
): Promise<T | null | Error> {
  const raw = await ops.getdel(key)
  if (raw === null) return null

  const parsed = safeParse(raw)
  if (parsed instanceof JSONParseError) return parsed

  const result = schema.safeParse(parsed)
  if (!result.success) return result.error
  return result.data
}
```

- [ ] **Step 6: Rewrite `consumePendingTicket` on `getdel`**

In `packages/server/src/auth/pending-tickets.ts`:

Remove the `runExclusive` import (line 1: `import { runExclusive } from '../storage/key-lock'`).

Add `getdelJson` to the `./records` import (it currently imports `getJson`, `pendingKey`, `setJson`, `PendingTicketRecord`, `PendingTicketRecordSchema`):

```ts
import {
  type PendingTicketRecord,
  PendingTicketRecordSchema,
  getJson,
  getdelJson,
  pendingKey,
  setJson,
} from './records'
```

Replace the entire `consumePendingTicket` function body (comment included) with:

```ts
// Atomic, single-use claim of a pending ticket via Valkey GETDEL: the
// get-and-delete is one atomic server-side op, so two concurrent claims (two
// overlapping "approved" polls from the same device) can never both consume it
// — even across separate server instances. The loser's GETDEL finds the key
// already gone and returns PendingTicketInvalidError. readPendingTicket stays
// the non-consuming peek used by the status check.
export async function consumePendingTicket(
  ops: ValkeyOps,
  config: AuthConfig,
  now: () => number,
  cookieHeader: string | undefined,
): Promise<PendingTicketRecord | PendingTicketInvalidError | Error> {
  const ticketId = parseCookies(cookieHeader)[config.pendingCookieName]
  if (!ticketId) return new PendingTicketInvalidError()

  const record = await getdelJson(ops, pendingKey(ticketId), PendingTicketRecordSchema)
  if (record instanceof Error) return record
  if (record === null || now() >= record.expiresAt) return new PendingTicketInvalidError()
  return record
}
```

- [ ] **Step 7: Run the pending-tickets + device-handlers suites to verify they pass**

Run: `pnpm --filter server exec vitest run src/auth/pending-tickets.test.ts src/auth/device-handlers.test.ts`
Expected: PASS — all existing `consumePendingTicket` cases (single-use / expired / missing-cookie / consume-then-read), the new concurrent case, and all `postClaimSession` cases (which call `consumePendingTicket` unchanged) are green.

- [ ] **Step 8: Commit**

```bash
rtk git add packages/server/src/storage/valkey.ts packages/server/src/test/memory-ops.ts packages/server/src/auth/records.ts packages/server/src/auth/pending-tickets.ts packages/server/src/auth/pending-tickets.test.ts
rtk git commit -m "fix(auth): atomic single-use pending-ticket consume via GETDEL

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

### Task 2: Client — `scanReturn` atom + `closeScan` in routes

**Files:**

- Modify: `packages/client/activation/src/model/routes.tsx` (add `scanReturn`, `recordScanReturn`, `closeScan`)
- Test: `packages/client/activation/src/model/routes.test.tsx` (add coverage)

**Interfaces:**

- Consumes: existing `activateRoute`, `addDeviceRoute`, and `urlAtom` from `@reatom/core`.
- Produces:
  - `scanReturn: Atom<{ path: string } | null>` (named `activation.scanReturn`)
  - `recordScanReturn(): void` — snapshots the current in-app location into `scanReturn`
  - `closeScan(): void` — if `scanReturn` is set, navigates back to it (`urlAtom.go(path, true)`) and clears the atom; otherwise falls back to `activateRoute.go({}, true)` (home)

- [ ] **Step 1: Write the failing test**

Append to `packages/client/activation/src/model/routes.test.tsx` (it already imports `context`, `urlAtom` and sets `window.history.replaceState(null, '', '/activate')` in `beforeEach`). Update the import line and add a new describe:

```ts
import { activateRoute, addDeviceRoute, closeScan, recordScanReturn, scanReturn } from './routes'
```

```ts
describe('scanner return target', () => {
  it('closeScan returns to the recorded in-app location (token intact)', () => {
    urlAtom.go('/activate?token=abc')
    recordScanReturn()
    addDeviceRoute.go({ scan: '1' })
    expect(urlAtom().pathname).toBe('/add-device')

    closeScan()

    expect(urlAtom().pathname).toBe('/activate')
    expect(urlAtom().search).toBe('?token=abc')
    expect(scanReturn()).toBeNull()
  })

  it('closeScan falls back to home when nothing was recorded (external deep-link)', () => {
    urlAtom.go('/add-device?scan=1')

    closeScan()

    expect(urlAtom().pathname).toBe('/activate')
    expect(urlAtom().search).toBe('')
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm --filter client exec vitest run activation/src/model/routes.test.tsx`
Expected: FAIL — `closeScan`, `recordScanReturn`, `scanReturn` are not exported from `./routes`.

- [ ] **Step 3: Implement in `routes.tsx`**

In `packages/client/activation/src/model/routes.tsx`, change the top import to add `atom` and `urlAtom`:

```ts
import { atom, reatomRoute, type RouteChild, urlAtom } from '@reatom/core'
```

Add, after the imports and before `rootRoute`:

```ts
// In-memory return target for the QR scanner. The activation app is a single
// JS context (SPA), so the screen the scanner was opened from is remembered
// here rather than via history.back() (fragile on external deep-links) or a
// URL param (would leak the invite token into the add-device route). null means
// the scanner was reached directly (external QR to /add-device?scan=1) with no
// in-app screen behind it.
export const scanReturn = atom<{ path: string } | null>(null, 'activation.scanReturn')

// Snapshot the current in-app location before navigating into the scanner.
// Called by every "Сканировать QR-код" entry point (home / activate / no-code).
export function recordScanReturn(): void {
  scanReturn.set({ path: urlAtom().pathname + urlAtom().search })
}

// Close the scanner: return to the recorded screen (replace, so browser Back
// does not reopen the scanner), clearing the one-shot target. With nothing
// recorded (external deep-link), fall back to the home login card.
export function closeScan(): void {
  const target = scanReturn()
  if (target) {
    scanReturn.set(null)
    urlAtom.go(target.path, true)
    return
  }
  activateRoute.go({}, true)
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm --filter client exec vitest run activation/src/model/routes.test.tsx`
Expected: PASS (existing 2 route tests + 2 new scanner-return tests).

- [ ] **Step 5: Commit**

```bash
rtk git add packages/client/activation/src/model/routes.tsx packages/client/activation/src/model/routes.test.tsx
rtk git commit -m "feat(activation): in-memory scanner return target (scanReturn/closeScan)

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

### Task 3: Client — wire scan entry/close to `scanReturn`

**Files:**

- Modify: `packages/client/activation/src/ui/ActivateScreen.tsx` (default `onScan` records the return target)
- Modify: `packages/client/activation/src/ui/AddDeviceScreen.tsx` (`closeScanner` delegates to `closeScan`)

**Interfaces:**

- Consumes: `recordScanReturn`, `closeScan` (Task 2); existing `addDeviceRoute` (ActivateScreen).
- Produces: nothing new. All three scan buttons funnel through `ActivateScreen`'s single `onScan` prop, so recording in the default handler covers home / activate / no-code.

**Note:** Keep the `notify()` calls exactly as they are in this task — Task 4 reviews/removes them separately, so they are not conflated with the routing change. The `closeScanner` in `AddDeviceScreen` is only reachable through `useZxing` (cannot mount under jsdom); its return logic now lives in the unit-tested `closeScan` (Task 2), so this task is verified by typecheck + the unchanged paste test + the manual/e2e smoke in Task 5.

- [ ] **Step 1: Record the return target in `ActivateScreen`'s default `onScan`**

In `packages/client/activation/src/ui/ActivateScreen.tsx`, change the import (currently `import { addDeviceRoute } from '../model/routes'`) to:

```ts
import { addDeviceRoute, recordScanReturn } from '../model/routes'
```

Change the default `onScan` prop (currently `addDeviceRoute.go({ scan: '1' }); notify()`):

```tsx
    onScan = () => {
      recordScanReturn()
      addDeviceRoute.go({ scan: '1' })
      notify()
    },
```

- [ ] **Step 2: Delegate `closeScanner` to `closeScan` in `AddDeviceScreen`**

In `packages/client/activation/src/ui/AddDeviceScreen.tsx`, change the import (currently `import { activateRoute } from '../model/routes'`) to:

```ts
import { closeScan } from '../model/routes'
```

Replace the `closeScanner` function body (currently the `activateRoute.go({}, true); notify()` branch) with:

```tsx
function closeScanner() {
  if (enteredScanDirectly) {
    // Return to wherever the scanner was opened from (recorded in
    // scanReturn), replacing the /add-device?scan=1 history entry so browser
    // Back does not reopen the scanner. Falls back to the home card only for
    // a true external deep-link with no in-app screen behind it.
    closeScan()
    notify()
    return
  }
  goToChoose()
}
```

- [ ] **Step 3: Typecheck + run the affected component suites**

Run: `pnpm --filter client exec vitest run activation/src/ui/AddDeviceScreen.test.tsx activation/src/ui/ActivateScreen.test.tsx activation/src/App.test.tsx`
Expected: PASS — the paste test (choose mode) and the ActivateScreen/App tests are unaffected; `activateRoute` is no longer referenced in `AddDeviceScreen`.

Run: `pnpm typecheck`
Expected: no type errors (the removed `activateRoute` import in `AddDeviceScreen` is replaced by `closeScan`).

- [ ] **Step 4: Commit**

```bash
rtk git add packages/client/activation/src/ui/ActivateScreen.tsx packages/client/activation/src/ui/AddDeviceScreen.tsx
rtk git commit -m "fix(activation): scanner close returns to the origin screen, keeping the invite token

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

### Task 4: Client — review the manual `notify()` calls

**Files:**

- Modify (conditionally): `packages/client/activation/src/ui/ActivateScreen.tsx`, `packages/client/activation/src/ui/AddDeviceScreen.tsx`

**Interfaces:** none changed. This is an investigation with a deterministic decision rule, not a predetermined edit.

**Background:** The kept `@reatom/react` patch (finding #3) fixed subscription timing at _mount_. The hand-placed `notify()` after `set()` / `route.go()` in raw DOM handlers addresses a different concern (synchronous flush after a write made outside `useAction`), so the default expectation is that they stay. The call sites are: `ActivateScreen` default `onScan` (line ~42), `ActivateScreen.goHome` (line ~61), and `AddDeviceScreen.closeScanner` (from Task 3).

- [ ] **Step 1: Remove the three `notify()` calls and drop the now-unused import**

In `ActivateScreen.tsx`, remove `notify()` from both `onScan` and `goHome`. In `AddDeviceScreen.tsx`, remove `notify()` from `closeScanner`. In each file, if `notify` is now unused, remove `import { notify } from '@reatom/core'` (in `AddDeviceScreen.tsx` `notify` is imported alone; in `ActivateScreen.tsx` confirm no other usage remains before removing).

- [ ] **Step 2: Run the client component suites**

Run: `pnpm --filter client exec vitest run activation/src/ui/ActivateScreen.test.tsx activation/src/App.test.tsx activation/src/model/routes.test.tsx`
Expected: one of two outcomes —

- **All green** → the `notify()` calls were redundant. Keep them removed. Proceed to Step 3 to confirm the real-browser transition, then commit.
- **A test fails** on a synchronous assertion after a screen switch / navigation (e.g. a heading not yet swapped) → the flush is still required. Revert this task's edits (`rtk git checkout -- packages/client/activation/src/ui/ActivateScreen.tsx packages/client/activation/src/ui/AddDeviceScreen.tsx`), leaving the `notify()` calls in place, and record the finding in the commit-or-skip note below. This task then makes no code change.

- [ ] **Step 3: Real-browser smoke (only if Step 2 was all-green)**

Use the `run` (or `verify`) skill to launch the activation app (`pnpm dev`, open the `/activate/` dev URL) and confirm each in-place transition still happens without a visible one-frame lag:

- ACTIVATE cross-link "Уже активировано? Войти с passkey" → HOME switches immediately.
- HOME/ACTIVATE "Сканировать QR-код" → scanner opens; ✕ returns to the origin screen immediately.
  If any transition visibly lags or fails, treat as the "flush still required" outcome: revert (as in Step 2) and make no code change.

- [ ] **Step 4: Commit (only if `notify()` was actually removed)**

```bash
rtk git add packages/client/activation/src/ui/ActivateScreen.tsx packages/client/activation/src/ui/AddDeviceScreen.tsx
rtk git commit -m "refactor(activation): drop redundant notify() calls (superseded by the @reatom/react patch)

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

If Step 2/Step 3 showed the calls are still required, skip this commit — the task's outcome is "verified still needed; no change".

---

### Task 5: Full gate + push (re-sync the PR diff, finding #1)

**Files:** none (verification + git only; commit only if a gate fix is required).

- [ ] **Step 1: Run the full local gate**

Run: `pnpm --filter server test`
Run: `pnpm --filter client test`
Run: `pnpm typecheck`
Run: `pnpm lint`
Run: `pnpm format:check`
Expected: all green. Fix any surfaced issue in the owning file, re-run, and commit the fix with a `fix(activation): …` / `fix(auth): …` message before proceeding.

- [ ] **Step 2: Run the affected e2e (or flag for CI)**

If a reachable Valkey is available:
Run: `pnpm test:e2e:docker` (or filter to the two specs once the stack is up)
Expected: `add-device.spec.ts` and `auth-activation.spec.ts` pass — in particular the add-device happy path still records device B hitting `/api/auth/devices/claim-session` and never `/api/auth/login/verify`, now backed by the GETDEL consume.
If Valkey is not available locally: run `pnpm --filter client exec tsc -p tsconfig.json --noEmit` over the e2e project to confirm the specs still typecheck, and flag in the PR that the suite must run in CI.

- [ ] **Step 3: Push the branch and verify the PR diff**

```bash
rtk git push origin feat/activate-redesign-login
```

Then confirm the PR diff now reflects the full tree (closing finding #1 — the previously unpushed `e0df4e6` refactor + `a36b13e` docs plus these fixes):

```bash
rtk gh pr diff 20
```

Expected: the diff includes the atomic `GETDEL` consume, the `scanReturn`/`closeScan` return logic, and the design/plan docs; the `add-device-model.ts` shown is the idiomatic `withConnectHook`/`poll` version (not the old `beginPolling`).

---

## Self-Review

**Spec coverage:**

- #2 (invite token lost on scanner close) → Tasks 2–3 (in-memory `scanReturn` / `closeScan`, wired into all scan entry points and the close ✕). ✅
- #4 (cross-instance double-mint) → Task 1 (`GETDEL` atomic consume, `runExclusive` removed). ✅
- #5 (manual `notify()` review) → Task 4 (deterministic remove-or-keep with test + browser verification). ✅
- #1 (stale PR diff) → Task 5 Step 3 (push + `gh pr diff 20` verification). ✅
- #3 (@reatom/react patch) → explicitly out of scope; Global Constraints forbid touching the patch. ✅
- Full verification gate (server/client tests, typecheck, lint, format, e2e) → Task 5 Steps 1–2. ✅

**Placeholder scan:** No TBD/TODO. Task 4 is an investigation but carries exact call sites, exact commands, and a binary decision rule with a concrete revert command — not a vague "handle it".

**Type consistency:** `getdel` typed identically in `ValkeyOps`, `buildOps`, and `memory-ops` (`(key: string) => Promise<string | null>`); `getdelJson<T>` mirrors `getJson<T>`'s signature; `consumePendingTicket`'s signature/return type is unchanged so `postClaimSession` needs no edit. `scanReturn: Atom<{ path: string } | null>`, `recordScanReturn(): void`, `closeScan(): void` are named identically across Tasks 2 and 3. `urlAtom.go(path, true)` / `activateRoute.go({}, true)` match the confirmed `@reatom/core` signatures.
