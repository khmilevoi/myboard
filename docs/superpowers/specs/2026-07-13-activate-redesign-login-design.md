# Activate page redesign + login flow — design

Date: 2026-07-13
Status: approved (pre-plan)
Source design: Claude Design project `myboard` → `Activate.dc.html`

## Goal

Reshape the activation entry into the four-screen card from the updated
`Activate.dc.html`, and add a first-class **login** landing that today does not
exist. The card the visitor sees is chosen from the URL (plus one runtime
transition), and a shared QR scanner reuses the existing `/add-device` flow via
smooth client-side routing rather than a full page reload.

The WebAuthn ceremonies (register / authenticate) and every server endpoint are
already implemented and stay unchanged; this is a UI/UX restructure plus routing
glue.

## Background: current state

The activation app is a standalone Vite build (`vite.activation.config.ts`,
base `/activate/`) with no Module Federation, PWA, or board imports. It reuses
the shared shadcn leaf primitives and design tokens under `@/…`.

nginx serves the *same* activation shell for three URL shapes:

- `/activate/…` — static activation app (ungated).
- `/add-device` — `try_files /activate/index.html`.
- `/` **when unauthenticated** — the gated SPA location returns 401, and
  `error_page 401 /activate/index.html` serves the activation shell while the
  URL and 401 status stay put (the rpi healthcheck asserts the 401).

`App.tsx` routes purely on `location.pathname`, read once (not reactive):
`/add-device` → `AddDeviceScreen`, everything else → `ActivateScreen`.

`ActivateScreen` + `activation-model.ts` today:

- `mode: 'new-account' | 'login'`. Reads the invite from `?token=`.
- `new-account`: name field + "Создать ключ доступа" → `startRegistration`
  (register/options → ceremony → register/verify → `navigate('/')`).
- On `register/options` returning **409 `invite_consumed`**, it flips to
  `mode: 'login'` ("С возвращением", inline).
- `login`: "Войти с ключом доступа" → `startLogin` (login/options → ceremony →
  login/verify → `navigate('/')`). `startLogin` runs **usernameless** when no
  credential hint is stored — confirmed server-side: `postLoginOptions` sends
  `allowCredentials: undefined` without a `credentialIdHint`, so the browser
  offers any resident passkey.
- `navigate` default = `window.location.assign` (a hard navigation).

`AddDeviceScreen` + `add-device-model.ts` is a separate island at `/add-device`:
`choose → scanning → manual → registering → waiting → done | rejected`, with a
real `react-zxing` camera scanner, `stageScannedCode`, the WebAuthn ceremony,
and pending-status polling. It starts in `choose`.

`ThemeTogglePill` already renders the design's theme pill wired to the board
theme model — kept as is.

### The gap this fixes

Visiting `/` unauthenticated currently renders `ActivateScreen` with **no
token**, i.e. "Активируйте устройство" with an empty name field; clicking Create
fails with "Отсутствует токен приглашения". The redesign replaces that dead end
with the proper **HOME** login card.

## Design ↔ code mapping

| Design screen (`Activate.dc.html`) | Trigger | Backing behavior |
| --- | --- | --- |
| **HOME** "Вход в myboard" — [Войти с passkey] + [Сканировать QR] + admin hint | no `token` in URL (pathname `/`, `/activate` without token) | existing `startLogin` (usernameless) → `navigate('/')` |
| **ACTIVATE** "Активация устройства" — name + [Создать passkey] + [Сканировать QR] + "Уже активировано? Войти с passkey" | `token` present, non-empty (design's `?code=`) | existing `startRegistration` |
| **ACTIVATE-NO-CODE** "Нужен код приглашения" — [Сканировать QR] + "Уже есть passkey? Войти" | `token` param present but empty/whitespace | navigation only |
| **ACTIVATE-USED** "Приглашение уже использовано" — [Войти с passkey] + "Перейти к входу" | **runtime**: `register/options` → 409 `invite_consumed` (design's `?used` is a preview-only hack) | `startLogin` on this screen; replaces today's inline `mode:'login'` |
| QR scanner overlay | [Сканировать QR] on any screen | existing `/add-device` scanner + ceremony + polling |

The mock's self-contained theme handling (its own `myboard.activate.theme`
localStorage key and inline `--accent/--surface/…` tokens) is **not** ported: we
keep the existing `ThemeTogglePill` + board theme model, and translate the mock's
tokens to the shadcn token names already used in `ActivateScreen.module.css`
(`--surface`→`--card`, `--text`→`--foreground`, `--text-2`→`--muted-foreground`,
`--accent`→`--primary`, `--shadow-lg`→`--shadow-elevated`, `--accent-soft`,
`--destructive`, `--destructive-soft`, `--shadow-seg` already exist).

## Screen model

Replace `mode: 'new-account' | 'login'` with:

```ts
screen: Atom<'home' | 'activate' | 'activate-no-code' | 'activate-used'>
```

Initial value, derived synchronously from the URL at model creation:

- no `token` param → `home`
- `token` present, non-empty after trim → `activate`
- `token` present but empty/whitespace → `activate-no-code`

Runtime transitions:

- **ACTIVATE** → click "Создать passkey" → `startRegistration`:
  - 409 `invite_consumed` → `screen.set('activate-used')`
  - success → `navigate('/')` (hard)
  - other failure → `error` alert, stay on `activate`
- **ACTIVATE** → "Уже активировано? Войти с passkey" → `screen.set('home')`
- **HOME** → "Войти с passkey" → `startLogin` → success `navigate('/')`
- **ACTIVATE-USED** → "Войти с passkey" → `startLogin`; "Перейти к входу" →
  `screen.set('home')`
- **ACTIVATE-NO-CODE** → "Уже есть passkey? Войти" → `screen.set('home')`
- **any** → "Сканировать QR-код" → in-app navigate to `/add-device?scan=1`

`loading` (computed from the registration submit + `startLogin` pending flags)
and `error` (server/network alert) stay as they are. Cross-links that go home
may `replaceState('/activate')` to drop a stale `token` from the address bar;
optional, decided in the plan.

Note there are now two "Войти с passkey" call sites (HOME and ACTIVATE-USED),
both the same `startLogin` action.

## Routing: reactive in-app router

`/activate` and `/add-device` are the same bundle, so the scanner hand-off can be
a client-side transition instead of a reload.

Add `activation/src/model/router.ts`:

- `pathname: Atom<string>` (+ a `search`/params atom), initialized from
  `location`.
- `navigateInApp(path)`: `history.pushState(null, '', path)` then update the
  atoms (via `wrap`).
- `initRouter()`: a `popstate` listener that syncs the atoms; called from
  `main.tsx` alongside `initTheme()`.

`App.tsx` reads `pathname()` reactively and picks `AddDeviceScreen` vs
`ActivateScreen`.

Hard navigation stays for `navigate('/')` after a successful login/activation —
`/` is the *board* bundle, so nginx must re-auth against the new session cookie
and serve a different app. Only `/activate ↔ /add-device` are client-side.

## Scanner integration

- `AddDeviceScreen` model gains an initial mode derived from `?scan=1`
  (`scanning` when present, else `choose`), overridable in tests. Entering via
  `/add-device?scan=1` opens the camera immediately, skipping the `choose`
  screen and its redundant second "Сканировать QR" tap.
- The scanner surface adopts the design's **full-screen overlay** look from
  `Activate.dc.html` (black backdrop, 250px cutout frame with corner brackets,
  top bar with title + close ✕, bottom hint; the camera-unavailable hint text
  from the design). This is shared by both entry points (add-device `choose` →
  scan, and activation card → scan).
- Close (✕) behavior:
  - entered via `?scan=1` (from the activation card): return to the activation
    card (`history.back()`, falling back to `navigateInApp('/activate')`).
  - entered via add-device `choose`: return to `choose` (mode transition).
- Everything after a successful decode is unchanged: `stageScannedCode` → the
  "Добавить устройство в аккаунт «…»?" confirm → ceremony → `waiting` polling →
  `done`/`rejected`. Those post-scan cards keep their current styling (same
  token language, brandmark, card); only the scanner itself is restyled.

## Component & file changes

- `activation/src/model/router.ts` — new reactive router (above).
- `activation/src/App.tsx` — reactive pathname routing.
- `activation/src/main.tsx` — `initRouter()`.
- `activation/src/model/activation-model.ts` — `screen` atom replacing `mode`;
  `invite_consumed` → `activate-used`; rename factory
  `createActivationModel` → `makeActivationModel` (user preference: `make*` over
  `create*`; `createAddDeviceModel` left as is unless requested).
- `activation/src/ui/ActivateScreen.tsx` (+ `.module.css`) — the four card
  states, scan button, cross-links; per-screen copy verbatim from the design.
- `activation/src/model/add-device-model.ts` — `?scan=1` initial mode.
- `activation/src/ui/AddDeviceScreen.tsx` (+ `.module.css`) — full-screen scanner
  overlay + close affordance; wire the scan-entry close to the router.

Out of scope: the non-scanner add-device cards' visuals, any server/auth
endpoint, and nginx (the `activate-used` transition is a `screen` atom change,
not a URL-addressable route).

## Testing (TDD)

- `activation-model` unit: initial `screen` from token (home / activate /
  no-code); `invite_consumed` → `activate-used`; `startLogin` reachable from
  HOME and ACTIVATE-USED; success paths call `navigate('/')`.
- `router` unit: `navigateInApp` pushState + atom update; `popstate` sync.
- `ActivateScreen`: renders each of the four states; cross-links set `screen`;
  scan button routes to `/add-device?scan=1`.
- `add-device-model` / `AddDeviceScreen`: `?scan=1` starts in `scanning`;
  scanner close returns correctly per entry point.
- e2e (`packages/client/e2e`): update `ActivatePage`; add a HOME login scenario;
  assert `/` unauthenticated shows HOME (not the no-token "Активируйте
  устройство"). Reuse the existing `add-device.spec.ts` scan path.

## Open questions

None — the four-screen model and the `invite_consumed → activate-used`
transition are fixed by the updated design.
