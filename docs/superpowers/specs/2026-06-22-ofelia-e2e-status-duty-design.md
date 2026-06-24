# Ofelia e2e — Phase 1 design (status / undo / debt)

- **Branch:** `f6-ofelia-widget-finalisation`
- **Date:** 2026-06-22
- **Status:** Approved, ready for implementation planning

## 1. Goal & scope

Deliver Playwright e2e coverage for the Ofelia widget's **core duty feature**:

- the action buttons — **Какашки убраны** (confirm clean), **В долг** (go into debt), **Простить** (forgive);
- the **Откатить** undo control;
- the **debt counter** (DebtChips).

These are exercised on the **board card** at the `standard` tier (default widget size 3×5 → `resolveTier` returns `standard`).

**Out of scope (Phase 1):** the history list and the comment thread. They render only in the `large`/`fullscreen` `RichLayout`, so the standard board card excludes them for free — no extra gating needed.

**End state of this plan:** harness built, specs written, and the widget/server module **fixed until the status/undo/debt specs are green**. The concrete failures discovered when the specs first run define the fix scope.

## 2. Backend strategy

The Ofelia widget is fully server-backed:

- the widget's `ready` gate waits on `/api/time` (server time → `today()`);
- the core feature reads/writes `debts` and `history` through `/api/storage/*` (GET / PUT / POST `append`);
- live updates arrive over an **SSE** stream (`/api/storage/events`).

Critical behaviour: after a status action (`confirmClean` / `goIntoDebt`), the day's "closed" state is reflected **only when the new history event comes back via SSE** — the model does not refetch history on append. So the status-button flow genuinely depends on the SSE round-trip.

Chosen approach: **hybrid — real `/api/storage` + SSE against an in-memory server, with a deterministic, controllable clock.** This keeps the real client code paths (HTTP storage, SSE client, the model) under test, needs no Docker/Valkey, and gives a deterministic "today".

## 3. Server test-mode (new plumbing)

`server/src/index.ts` today hard-wires `createValkeyOps()`, a real Valkey pub/sub subscriber, and `Date.now()` in `handleTime`. Refactor into an injectable factory (matching the repo's DI style, e.g. `createServerTime(fetchTime)`, `createWidgetStorage(options)`).

- **`createApp({ ops, subscribe, now })`** (or `startServer(...)`) — the routing + handlers extracted from the current top-level module code.
  - `ops: ValkeyOps` — storage backend.
  - `subscribe` — the storage-events fanout source (the `storage:events` channel listener path).
  - `now: () => number` — feeds `handleTime`.
- **Production entry** stays behaviour-identical: Valkey ops + `createValkeySubscriber('storage:events', …)` + `Date.now`.
- **Test entry** (`server/src/test-server.ts`, started only under a `TEST_MODE` env flag):
  - **in-memory `ValkeyOps`** — a `Map`-backed `get` / `set` / `del` / `scanKeys`, and a `publish` that drives an in-process emitter so the SSE fanout fires exactly like the Valkey subscriber path. This is what makes the status-flip SSE round-trip work without Docker. The in-memory pub/sub must mirror the Valkey fanout contract exactly (`publishChange` → `EVENTS_CHANNEL` → `fanout(registry, event)`).
  - **controllable clock** — `now()` returns a settable timestamp (defaults to real time) so `/api/time` yields a deterministic "today".
  - **test control routes** (registered only in test mode):
    - `POST /api/test/time { iso | ms }` — pin the clock.
    - `POST /api/test/reset` — clear the in-memory store between tests.

`handleAppend`'s `ts` stays real wall-clock (monotonic ordering for `getDayStatus`, whose sort is stable); only the client-facing "today" clock is overridden via `handleTime`.

## 4. Client / Playwright wiring

- **`client/vite.config.ts`**: add a `preview.proxy` for `/api` → the test server. (Vite preview is a static server today and 404s `/api`; the existing `server.proxy` is dev-only.) Keeps the production build while routing the API.
- **`client/playwright.config.ts`**: switch `webServer` to an **array** —
  1. test server in `TEST_MODE` on `:8787`,
  2. client `npm run build && npm run preview` on `:4173`.
- **Isolation**: Playwright gives each test a fresh browser context (empty IndexedDB/localStorage), so the client-side `currentUser` (stored in Dexie) resets automatically. `beforeEach` only needs:
  - `POST /api/test/reset` — reset the shared server store, and
  - `POST /api/test/time` — pin the date.

## 5. Test surface

### Page object — `client/e2e/pages/OfeliaPage.ts`

Locators for:

- duty-person name (`StandardTier` `styles.name`);
- status plaque — text **"Уборка подтверждена"** (closed state);
- the four controls:
  - confirm — `getByRole('button', { name: 'Какашки убраны' })`,
  - debt — `getByRole('button', { name: 'В долг' })`,
  - forgive — `getByRole('button', { name: 'Простить' })`,
  - undo — `getByRole('button', { name: 'Откатить' })` (aria-label);
- debt chips (per-person debt count).

Plus a `seedOfeliaWidget()` helper: add the **"Лоток Офелии"** widget via the header, await the card, and wait past the **"Загрузка…"** loading state.

### Determinism

Pin "today" via `POST /api/test/time` to a fixed instant — **`2026-06-16T12:00` Europe/Warsaw** (noon avoids the midnight boundary). With `BASE_DUTY_DATE = 2026-06-16` and rotation `['Леша', 'Карина']`, that date resolves to **Леша** on duty (`getOfeliaDutyByDate`, `diffDays % 2 === 0`). Expected persons in each scenario are derived from the same rotation rule.

### Specs — `client/e2e/ofelia-duty.spec.ts`

1. **Render** — the added widget shows today's duty person and the pending state (primary "Какашки убраны").
2. **Confirm** — click "Какашки убраны" → status flips to "Уборка подтверждена" and "Откатить" appears (verifies the SSE round-trip).
3. **Undo** — click "Откатить" → returns to pending (primary button reappears).
4. **В долг** — click → the on-duty person's debt chip increments; the day closes.
5. **Простить** — visible once a debt exists; click → the debt count decrements.
6. **Persistence** — after a confirm, reload the page → state is still closed (server-persisted history).

## 6. Fix loop (until green)

Run the specs. For each red spec:

1. Root-cause with **systematic-debugging** before touching any code.
2. Apply the **minimal** fix in `client/widgets/ofelia-poop-duty/model/`, `…/ui/`, or `server/`.
3. Re-run.

**Guardrail:** existing unit suites must stay green — `pnpm --filter client test` and `pnpm --filter server test` (notably `ofelia-duty.test.ts`, `view-model.test.ts`, and the storage/server handler tests).

## 7. Risks / suspected fix areas

- The in-memory pub/sub must mirror the Valkey fanout contract exactly, or the SSE status-flip will never fire.
- **Not pre-diagnosed**, to be confirmed via systematic-debugging when specs go red:
  - the model does not refetch history on append — it relies wholly on the SSE delivery to flip day status;
  - `withStorageKey`'s connect-hook `target.set(event.value)` can re-trigger its own change-hook (`api.set`), a possible server write-back echo loop for `debts`.

## 8. Deliverables checklist

- [ ] `server` refactored into an injectable `createApp` / `startServer` factory; production entry behaviour-identical.
- [ ] `server/src/test-server.ts` — in-memory ops + in-process pub/sub + controllable clock + `POST /api/test/time` + `POST /api/test/reset`, gated behind `TEST_MODE`.
- [ ] `client/vite.config.ts` — `preview.proxy` for `/api`.
- [ ] `client/playwright.config.ts` — `webServer` array (test server + client preview).
- [ ] `client/e2e/pages/OfeliaPage.ts` + `seedOfeliaWidget()` helper.
- [ ] `client/e2e/ofelia-duty.spec.ts` — the 6 scenarios.
- [ ] Module fixes until the specs pass; existing unit suites remain green.
