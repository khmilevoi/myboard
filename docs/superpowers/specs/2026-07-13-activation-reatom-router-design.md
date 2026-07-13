# Activation SPA — replace the hand-written router with reatomRouter

Date: 2026-07-13
Status: design approved, ready for implementation plan

## Context & goal

The standalone activation SPA (`packages/client/activation/`) ships a hand-written
router in `src/model/router.ts`:

- two atoms `pathname` / `search`, seeded from `location`;
- `navigateInApp(path)` — `history.pushState` + re-sync the atoms;
- `initRouter()` — a `popstate` listener that re-syncs the atoms.

`App.tsx` branches on `pathname()` to pick `ActivateScreen` (`/activate` and
everything else) or `AddDeviceScreen` (`/add-device`). Each screen constructs its
own model with `useState(() => makeActivationModel())` /
`createAddDeviceModel()`, and the models read `token` / `scan` straight from
`location` (`readTokenFromLocation`, `readScanFromLocation`). `AddDeviceScreen`
also runs `useEffect(() => void model.init())` on mount to auto-validate a code
embedded in the activation link.

**Goal:** replace the hand-written router with Reatom's `reatomRoute`
(`@reatom/core@1001.1.0`) and use its full feature set:

- a `rootRoute` layout that renders the shared card shell and composes pages via
  `outlet()`;
- route `loader`s as the single place a page's model is created and initialized
  (the "computed factory" pattern);
- route `render` to mount the page components;
- zod `search` schemas to validate/parse `token` / `scan`;
- a `.d.ts` module augmentation typing `RouteChild` as a React element.

`@reatom/core@1001.1.0` exports everything needed: `reatomRoute`, `urlAtom` (with
`catchLinks`, `syncFromSource`), `RouteChild` (an empty interface meant for
augmentation), `RouteAtom`, `RouteOptions`. `zod` (`^4.4.3`, native Standard
Schema) is already a client dependency.

## Invariants (must not change)

- The board (`/`) is a **separate bundle**. `deps.navigate('/')` stays a hard
  load (`window.location.assign('/')`) and is **not** routed through reatomRouter.
- The router manages **only** the in-app `/activate` ↔ `/add-device` transitions.
- Storage-key derivation, WebAuthn ceremonies, and server endpoints are untouched.
- Token → screen semantics are preserved 1:1 (see the mapping table below).

## Deliberate behavior changes (accepted)

1. **Theme toggle now appears on both screens.** `ThemeTogglePill` moves into the
   shared shell (previously only `ActivateScreen` rendered it). It is
   `position: fixed` at `z-index: 10`; the scanner overlay (`z-index: 60`, opaque)
   naturally covers it while scanning, so there is no conflict.
2. **Deep-link `/add-device?token=CODE` shows a loading card during validation.**
   `model.init()` moves into the route loader and is `await`ed, so while the
   embedded code is server-validated the route is `!loader.ready()` and `render`
   shows a small spinner card instead of the previous optimistic `registering`
   card with a disabled spinner button. Once validation resolves the fully-formed
   card renders (owner name already present). `/add-device` and `/add-device?scan=1`
   are unaffected — `init` is a no-op there and the loader resolves immediately.
   The `validating` atom is removed; `loader.ready()` takes over its role.

## Real URLs & router base

`vite.activation.config.ts` sets `base: '/activate/'`, which only rewrites asset
URLs — it is **not** a router base. The real pathnames are the top-level
`/activate` and `/add-device`. The router base is therefore `/`, with two routes
mounted at `activate` and `add-device`.

## Route tree — `src/model/routes.tsx` (new)

`.tsx` because `render` returns JSX.

```tsx
import { reatomRoute, type RouteChild } from '@reatom/core'
import { z } from 'zod'

import { makeActivationModel } from './activation-model'
import { createAddDeviceModel } from './add-device-model'
import { ActivateScreen } from '../ui/ActivateScreen'
import { AddDeviceScreen } from '../ui/AddDeviceScreen'
import { LoadingCard } from '../ui/LoadingCard'
import { Shell } from '../ui/Shell'

export const rootRoute = reatomRoute(
  {
    layout: true,
    render: (self): RouteChild => <Shell>{self.outlet()}</Shell>,
  },
  'rootRoute',
)

export const activateRoute = rootRoute.reatomRoute(
  {
    path: 'activate',
    search: z.object({ token: z.string().optional() }),
    loader: ({ token }) => ({ model: makeActivationModel({ token: token ?? null }) }),
    render: (self): RouteChild => {
      const data = self.loader.data()
      return data ? <ActivateScreen model={data.model} /> : <LoadingCard />
    },
  },
  'activateRoute',
)

export const addDeviceRoute = rootRoute.reatomRoute(
  {
    path: 'add-device',
    search: z.object({ token: z.string().optional(), scan: z.literal('1').optional() }),
    async loader({ token, scan }) {
      const model = createAddDeviceModel({ token: token ?? null, scan: scan === '1' })
      await model.init() // init() wraps its own awaits → loader's abort covers it
      return { model }
    },
    render: (self): RouteChild => {
      const data = self.loader.data()
      return data ? <AddDeviceScreen model={data.model} /> : <LoadingCard />
    },
  },
  'addDeviceRoute',
)
```

Notes:

- `render` must return a `RouteChild` (never `null`): when a route is not
  matched/exact the framework itself yields `null` and does not call `render`. The
  fallback branch therefore returns a `<LoadingCard />` element, not `null`.
- `loader.data()` is typed `Payload | undefined` (undefined until the first
  successful load), so `render` narrows via the value (`const data = self.loader.data()`)
  rather than `self.loader.ready()` — this also type-narrows `data.model`.
- `activateRoute`'s loader is synchronous, so `data()` is populated almost
  immediately; its `LoadingCard` branch is a type-satisfying fallback that does
  not visibly render in practice.
- No `effect` wrapper is needed: the add-device loader `await`s `init()`, so the
  loader's own async context is the abort scope (documented "loaders are
  automatically aborted on navigation"). There is no detached side-effect to
  re-scope.
- `render` reads route state through its `self` argument (`self.loader`,
  `self.outlet()`) and annotates its return type as `RouteChild` to avoid the
  recursive-inference error the routing handbook calls out.

### Token → screen mapping (preserved 1:1)

| URL | zod `token` output | `makeActivationModel` initial screen |
| --- | --- | --- |
| `/activate` (no param) | `undefined` → mapped to `null` | `home` |
| `/activate?token=` (empty) | `''` | `activate-no-code` |
| `/activate?token=abc` | `'abc'` | `activate` |

`token ?? null` maps `undefined → null`; the model's existing `initialScreen()`
does the rest.

### `scan` parsing

`scan: z.literal('1').optional()` yields `'1' | undefined`; the loader passes
`scan === '1'` (a `boolean`) to the factory, matching today's
`readScanFromLocation() === '1'` semantics exactly. A present `token` still
overrides `scan` inside the model (unchanged model logic).

## Shared shell & CSS reorganization

The two screens duplicate their card chrome — `AddDeviceScreen.module.css`
documents `.page/.card/.brandMark/.brandCell/.brandCellDim/.brandLabel/.footerNote`
as an "intentional near-copy" of `ActivateScreen.module.css`. The layout route
removes this duplication.

New files:

- **`src/ui/Shell.tsx`** — presentational shell used by `rootRoute.render`:

  ```tsx
  export const Shell = reatomMemo<{ children: ReactNode }>(({ children }) => (
    <div className={styles.page}>
      <ThemeTogglePill />
      <div className={styles.card}>
        <BrandMark />
        {children}
      </div>
    </div>
  ), 'Shell')
  ```

  (`BrandMark` is a tiny local component for the 2×2 mark + label; may live in
  `Shell.tsx`.)

- **`src/ui/shell.module.css`** — the shared chrome:
  `.page/.card/.brandMark/.brandCell/.brandCellDim/.brandLabel` **plus**
  `.footerNote` (also duplicated today; both bodies import `shell.module.css`'s
  `.footerNote`) **plus** the `LoadingCard` spinner style.

- **`src/ui/ThemeTogglePill.module.css`** — `.themeToggle` / `.themeToggleItem`
  moved out of `ActivateScreen.module.css`; `ThemeTogglePill` imports its own
  module and becomes self-contained.

- **`src/ui/LoadingCard.tsx`** — a centered spinner rendered as card body for the
  `!loader.ready()` branch; its spinner style lives in `shell.module.css`
  (visually matching the add-device `waiting` spinner, which keeps its own copy).

Both `ActivateScreen` and `AddDeviceScreen` become **card-body** components: they
render only the inner, page-specific content into `outlet()`; they no longer emit
`.page` / `.card` / brand mark. Their `.module.css` files drop the shared shell
classes and keep only body-specific ones.

### Scanner overlay stays a full-screen escape

`AddDeviceScreen` still early-returns `<ScannerOverlay />` while scanning. Its CSS
is `position: fixed; inset: 0; z-index: 60; background: #000`. `.card` sets no
`transform` / `filter` / `contain`, so it establishes **no containing block** — a
`position: fixed` child escapes to the viewport even though the body is rendered
inside the shell's `.card` via `outlet()`. The opaque z-60 overlay fully covers the
shell behind it, so the visual result is identical to today. The `showBrandMark`
crutch is removed (the overlay hides the shell regardless).

## Model changes

`activation-model.ts`:

- `token` comes from the loader argument; remove the `readTokenFromLocation()`
  default. `makeActivationModel({ token })` is always called with an explicit value
  by the loader.

`add-device-model.ts`:

- `token` / `scan` come from the loader; remove `readTokenFromLocation()` and
  `readScanFromLocation()` helpers and their default wiring.
- `currentOrigin` **keeps** its `location.origin` default — it is the app's own
  origin used for the anti-phishing same-origin check, not a URL parameter.
- Remove the `validating` atom and its member on `AddDeviceModel`; the loader's
  `ready()` now represents "embedded code is being validated". `init()` no longer
  sets `validating`.
- Remove the `initialized` re-entrancy guard in `init()` — its sole reason
  (React StrictMode double-invoking the mount `useEffect`) is gone now that the
  loader (called once per activation) drives `init`. `init` remains a plain action
  whose awaits are `wrap`ped.
- `AddDeviceScreen` view-local logic that read `validating` (`showRegisterLoading`)
  now depends only on `ceremonyPending`.

## Navigation changes

In-app navigation (only `/activate` ↔ `/add-device`) goes through route `.go()`:

- `ActivateScreen` "Сканировать QR-код": replace the `navigate(SCAN_PATH)` prop
  call with `addDeviceRoute.go({ scan: '1' })`. For test isolation the screen
  exposes `onScan?: () => void` defaulting to `() => addDeviceRoute.go({ scan: '1' })`
  (replaces the old `navigate?: (path: string) => void` prop).
- `AddDeviceScreen.closeScanner` (entered scanner directly): keep
  `window.history.back()` (reatom's `urlAtom` listens to `popstate`); the fallback
  `navigateInApp('/activate')` becomes `activateRoute.go({})`.
- `deps.navigate('/')` on success — **unchanged** (hard load to the board bundle).

The `SCAN_PATH` string constant and the `navigate` prop plumbing are removed.

## Typing — `src/reatom.d.ts` (new)

Picked up by the client `tsconfig.json` (`include: ["src", "tests", "activation/src"]`).

```ts
import { type JSX } from 'react/jsx-runtime'

declare module '@reatom/core' {
  interface RouteChild extends JSX.Element {}
}
```

`import type` makes the file a module so the `declare module` augmentation applies.
`render` now returns `JSX.Element`, `outlet()` returns `JSX.Element[]`, and
`rootRoute.render()` types as `JSX.Element | null`. The augmentation is
module-wide across the client TS project; the board does not use routing so it is
harmless (and would be consistent — React — if it ever adopts it).

## Bootstrap — `main.tsx`

```tsx
import { urlAtom } from '@reatom/core'
// ...
initTheme()                 // unchanged: applies <html data-theme> before first paint
urlAtom.catchLinks(false)   // no in-app <a> navigation; board '/' stays a hard load
createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
  </StrictMode>,
)
```

- Remove the `initRouter` import and call — `urlAtom` subscribes to `popstate`
  itself once the route computeds are connected (via `App` reading
  `rootRoute.render()`).
- `catchLinks(false)` is defensive: there are no `<a>`-based nav links today, and
  disabling interception guarantees a future `<a href="/">` to the board is not
  hijacked into SPA navigation.

`App.tsx`:

```tsx
import { reatomMemo } from 'widget-sdk/reatom/reatom-memo'
import { rootRoute } from './model/routes'

export const App = reatomMemo(() => rootRoute.render(), 'App')
```

Reading `rootRoute.render()` reactively subscribes `App` to route changes; the
`pathname()` branch is gone.

## File change summary

| File | Action |
| --- | --- |
| `src/model/routes.tsx` | **new** — route tree (loader + render) |
| `src/reatom.d.ts` | **new** — `RouteChild` augmentation |
| `src/ui/Shell.tsx` | **new** — shared shell (page/card/brand + theme toggle + outlet) |
| `src/ui/shell.module.css` | **new** — shared chrome + `.footerNote` + spinner |
| `src/ui/ThemeTogglePill.module.css` | **new** — theme-toggle styles moved here |
| `src/ui/LoadingCard.tsx` | **new** — spinner card body for `!ready()` |
| `src/model/router.ts` | **delete** |
| `src/model/router.test.ts` | **delete** → replaced by `routes.test.tsx` |
| `src/model/routes.test.tsx` | **new** — route matching, search parsing, `.go()`, loader/deep-link |
| `src/App.tsx` | render `rootRoute.render()` |
| `src/App.test.tsx` | drive via `urlAtom.go` / `route.go` |
| `src/main.tsx` | drop `initRouter`; add `catchLinks(false)` |
| `src/ui/ActivateScreen.tsx` | card-body only; `onScan` prop → `addDeviceRoute.go` |
| `src/ui/AddDeviceScreen.tsx` | card-body only; drop `useEffect`/init; model via prop; scanner escape kept |
| `src/ui/ActivateScreen.module.css` | drop shared shell + theme-toggle classes |
| `src/ui/AddDeviceScreen.module.css` | drop shared shell classes; keep scanner + body |
| `src/ui/ThemeTogglePill.tsx` | import own module |
| `src/model/activation-model.ts` | `token` from loader; drop `readTokenFromLocation` |
| `src/model/add-device-model.ts` | `token`/`scan` from loader; drop `validating`, location readers, `initialized` guard |
| `src/model/activation-model.test.ts` | drop location-reader tests; token via arg |
| `src/model/add-device-model.test.ts` | drop `validating`/location-reader tests |
| `src/ui/AddDeviceScreen.test.tsx` | model via prop; deep-link/init tests → route/model level |
| `src/ui/ActivateScreen.test.tsx` | `onScan` spy in place of `navigate` spy |

## Testing plan

- **`model/routes.test.tsx`** (new): `activateRoute` matches `/activate`,
  `addDeviceRoute` matches `/add-device`; search parsing (`token` → screen,
  `scan=1` → scanning); `addDeviceRoute.go({ scan: '1' })` updates `urlAtom`
  (pathname `/add-device`, search `scan=1`); the sync activate loader yields a
  model; the async add-device loader `await`s `init` and lands the model in
  `registering` (mocked http) or `manual` (bad code). Reset with `context.reset()`
  between tests (existing convention).
- **`App.test.tsx`**: driven through `urlAtom.go(...)` / `route.go(...)` instead of
  `pathname.set(...)`. "HOME at `/activate` with no token", "ACTIVATE at
  `/activate?token=abc`", "reactive switch to `/add-device` via
  `addDeviceRoute.go`". The old "`/` → HOME" case becomes "`/activate` (no token)
  → HOME" (the activation bundle is only served at `/activate` / `/add-device`).
- **Screen tests**: still render `<Screen model={fake} />` directly (model prop
  preserved); headings/buttons live in the body and remain assertable. The scan
  button is tested via an injected `onScan` spy. `AddDeviceScreen` deep-link
  auto-validation moves to route/model tests (init runs in the loader now).
- **Model tests**: already inject `token`/`scan` overrides, so mostly unchanged;
  remove assertions on the deleted `validating` atom and on the removed
  `readTokenFromLocation` / `readScanFromLocation` behavior.

Full gate: `pnpm --filter client test`, `pnpm typecheck`, `pnpm lint`,
`pnpm format:check`. Manual smoke: `/activate` (home + activate + no-code + used),
`/add-device` (choose/manual/scan), `/add-device?scan=1`, `/add-device?token=CODE`,
and back/forward navigation.

## Optional cleanups (out of scope unless requested)

- Rename `createAddDeviceModel` → `makeAddDeviceModel` to match the repo's
  "prefer `make*` over `create*`" convention (touches its test file). Not part of
  this change unless requested.
