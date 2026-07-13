# PR #20 Review Fixes — Design

**Date:** 2026-07-13
**Branch:** `feat/activate-redesign-login`
**Scope:** Address review findings #1, #2, #4, #5 on PR #20 (activate redesign + passkey login + add-device single-touch + reatomRouter migration). Finding #3 (the global `@reatom/react` `useEffect → useLayoutEffect` patch) is deliberately **out of scope** — it stays as shipped.

## Goal

Fix four review findings without touching the `@reatom/react` patch:

1. **#1 — stale PR diff.** Local branch is ahead of the pushed PR head; ensure the merged code matches what reviewers see.
2. **#2 — invite token lost on scanner close.** Closing the QR scanner reached from `/activate?token=abc` drops the token and lands on the home login screen.
3. **#4 — cross-instance double-mint.** `consumePendingTicket` uses an in-process lock (`runExclusive`); two overlapping approved claims across server instances could both mint a session for the same approved device.
4. **#5 — manual `notify()` calls.** Verify whether the hand-placed `notify()` calls after `set()` / `route.go()` are still required after the `@reatom/react` patch; remove the redundant ones.

Non-goals: any change to the `@reatom/react` patch; unrelated refactoring; new product behavior beyond restoring the lost token.

---

## Finding #2 — Return from scanner via in-memory `returnTo` (option C)

The activation app is a single-page SPA with one JS context, so the return target can live in memory — more reliable than `history.back()` (fragile on external deep-links) and cleaner than threading the token through the add-device route URL (leaks the invite token into an unrelated route).

**Design:**

- New module-level reatom atom in `activation/src/model/routes.tsx`:
  `scanReturn: Atom<{ path: string } | null>`, named `activation.scanReturn`, initial `null`.
- Any screen that opens the scanner (`ActivateScreen` `onScan`, the `activate-no-code` scan button) records the current location first, then navigates:
  - write `urlAtom().href` (path + search) into `scanReturn`
  - `addDeviceRoute.go({ scan: '1' })`
- `closeScanner` in `AddDeviceScreen` (the `enteredScanDirectly` branch):
  - read `scanReturn` → if set: `urlAtom.go(saved.path, true)` (replace, so browser Back does not reopen the scanner), then clear the atom
  - if `null` (reached `/add-device?scan=1` directly from an external QR, no in-app history): fall back to `activateRoute.go({}, true)` (home)
- The scanner reached from the add-device `choose` screen (`goToScan`, an in-page mode switch with no route change) is unchanged — its close stays `goToChoose()`.
- Generalizes correctly to all entry screens (activate-with-token, home, no-code) — each returns to exactly where it came from.

**Boundary/decision extraction:** the return decision (saved path vs. home fallback) is extracted into a pure helper (e.g. `resolveScanReturn(saved: { path: string } | null): { path: string; replace: true } | { home: true }`) so it is unit-testable without mounting `useZxing` (which cannot mount under jsdom).

**Tests:**

- Unit on `scanReturn` + the pure resolver: set → close restores the saved URL; empty → home fallback.
- The `useZxing`-bound render branch stays unmounted in jsdom (unchanged constraint); logic coverage lives at the atom/helper level.

---

## Finding #4 — Atomic single-use consume via `GETDEL`

`GETDEL` is atomic at the Valkey level, so it removes the cross-instance race that the in-process `runExclusive` lock could not close.

**Design:**

- `ValkeyOps` (`packages/server/src/storage/valkey.ts`): add `getdel(key: string): Promise<string | null>` → `client.getdel(key)` (supported by iovalkey). Mirror it in the in-memory test ops (`packages/server/src/test/memory-ops.ts`): return the current value and delete the key in one call.
- `consumePendingTicket` (`packages/server/src/auth/pending-tickets.ts`): rewrite on `getdel` — one atomic get-and-delete, then parse with `PendingTicketRecordSchema` and check expiry. Since `GETDEL` is already atomic cross-instance, **remove** the `runExclusive` wrapper and the `key-lock` import from this file (the lock was added in PR #20 solely for consume and is now redundant).
  - Behavior nuance: an expired ticket is now deleted on read (previously it lingered until TTL). This is acceptable — an expired ticket is due for deletion anyway; the return value stays `PendingTicketInvalidError`.
- `readPendingTicket` (the non-consuming peek used by the pending-status poll) is unchanged — stays a plain `get`.

**Tests:**

- Existing 4 `consumePendingTicket` cases (single-use / expired / missing-cookie / consume-then-read) must stay green.
- Add a case for two concurrent consume calls against the memory ops: `GETDEL` semantics guarantee the record is delivered to exactly one caller; the other gets `PendingTicketInvalidError`.

---

## Finding #5 — Review the manual `notify()` calls

Not a predetermined removal — an investigation. The `@reatom/react` patch (kept as-is) fixed subscription timing at **mount**; the hand-placed `notify()` after `set()` / `route.go()` in raw DOM handlers addresses a different concern (synchronous flush after a write made outside `useAction`). Default assumption: they are still needed.

**Action:** for each remaining call site (`ActivateScreen.goHome`, the default `onScan`, and the new `closeScanner`), remove the `notify()`, run the client test suite; if the screen stays green **and** a real-browser smoke confirms the transition still happens synchronously, drop it as redundant — otherwise keep it with a clarified comment. No judgment by eye: remove only when tests + manual smoke confirm. Realistic outcome: likely retained, but each is reviewed explicitly and documented.

---

## Finding #1 — Re-sync the PR diff

No dedicated code. The local commits `e0df4e6` (refactor) and `a36b13e` (docs) are already on the branch; the new fixes land on top. The finding closes when the branch is **pushed**: origin receives both the earlier two commits and the new fixes, and the PR diff matches the merged code.

**Explicit final plan step:** `git push` the branch, then verify `gh pr diff 20` reflects the current tree.

---

## Full verification gate

- `pnpm --filter server test`
- `pnpm --filter client test`
- `pnpm typecheck`
- `pnpm lint`
- `pnpm format:check`
- e2e (`add-device.spec.ts`, `auth-activation.spec.ts`) — run against a reachable Valkey (`pnpm test:e2e:docker`), or flag for CI if unavailable locally.

## Out of scope

- Finding #3 — the `@reatom/react` `useEffect → useLayoutEffect` patch remains as shipped.
