# Activation SPA → reatomRouter Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the activation SPA's hand-written router with Reatom's `reatomRoute`, using a `rootRoute` layout + `outlet()` for the shared card shell, route `loader`s to build/initialize page models, route `render` to mount screens, and zod `search` schemas for `token`/`scan`.

**Architecture:** Four tasks. (1) Add the `RouteChild` type augmentation and extract the duplicated card chrome into a shared `Shell` + `LoadingCard`. (2) Render both screens as card *bodies* inside that `Shell`, still on the old router (low-risk CSS/structure dedup). (3) Swap the hand-written router for `reatomRoute` — routes, loaders, render, authoritative `token`/`scan` from search, screens receive the model by prop. (4) Delete the now-dead `validating` atom, whose role `loader.ready()` took over.

**Tech Stack:** `@reatom/core@1001.1.0` (`reatomRoute`, `urlAtom`, `RouteChild`), `@reatom/react` (`reatomMemo` via `widget-sdk`), `zod@^4.4.3`, React 19, Vite, Vitest + `@testing-library/react`, CSS modules.

## Global Constraints

- Reatom core is `@reatom/core@1001.1.0`; zod is `^4.4.3` (native Standard Schema). Both are existing client deps.
- The board (`/`) is a **separate bundle**: `deps.navigate('/')` stays a hard load (`window.location.assign('/')`) and is **never** routed through reatomRouter.
- The router manages **only** in-app `/activate` ↔ `/add-device` transitions. Real pathnames are top-level `/activate` and `/add-device`; the router base is `/`. (`base: '/activate/'` in `vite.activation.config.ts` affects assets only.)
- Token → screen mapping preserved 1:1: no `token` → `home`; `?token=` empty → `activate-no-code`; `?token=abc` → `activate`.
- Reatom conventions: every exported React component is wrapped with `reatomMemo` (from `widget-sdk/reatom/reatom-memo`); every atom/action/computed/route is named; async boundaries use `wrap`.
- `urlAtom.catchLinks` is typed `Atom<boolean>`; set it with `urlAtom.catchLinks.set(false)` (not the doc's `catchLinks(false)` call form).
- Tests reset Reatom state with `context.reset()` and, for component tests, use `beforeEach` (not `afterEach`) to avoid the `@testing-library` unmount-cleanup race (documented precedent in the repo).
- Run everything from the repo root. Client tests: `pnpm --filter client exec vitest run <path>`. Full gate at the end: `pnpm --filter client test`, `pnpm typecheck`, `pnpm lint`, `pnpm format:check`.

All paths below are relative to `packages/client/activation/`.

---

### Task 1: Shared shell + LoadingCard + RouteChild typing

Additive only — nothing consumes the new pieces yet, so the suite stays green. Moves the duplicated card chrome and the theme-toggle styles into dedicated modules.

**Files:**
- Create: `src/reatom.d.ts`
- Create: `src/ui/shell.module.css`
- Create: `src/ui/Shell.tsx`
- Create: `src/ui/Shell.test.tsx`
- Create: `src/ui/LoadingCard.tsx`
- Create: `src/ui/LoadingCard.test.tsx`
- Create: `src/ui/ThemeTogglePill.module.css`
- Modify: `src/ui/ThemeTogglePill.tsx:10` (import its own module)

**Interfaces:**
- Produces:
  - `Shell` — `reatomMemo<{ children: ReactNode }>` rendering `.page > ThemeTogglePill + .card > BrandMark + {children}`.
  - `LoadingCard` — `reatomMemo` rendering a centered spinner (card body).
  - `shell.module.css` exports `.page .card .brandMark .brandCell .brandCellDim .brandLabel .footerNote .spinnerLarge` (+ `@keyframes spin`).
  - `reatom.d.ts` augments `@reatom/core`'s `RouteChild` to `extends JSX.Element`.

- [ ] **Step 1: Create the `RouteChild` type augmentation**

Create `src/reatom.d.ts`:

```ts
import { type JSX } from 'react/jsx-runtime'

// Makes reatomRouter's `render`/`outlet` produce React elements. Picked up by
// the client tsconfig via `include: ["activation/src"]`. `import type` makes
// this a module so the `declare module` augmentation applies.
declare module '@reatom/core' {
  interface RouteChild extends JSX.Element {}
}
```

- [ ] **Step 2: Create `shell.module.css`**

Create `src/ui/shell.module.css` (shared card chrome extracted from `ActivateScreen.module.css`, plus `.footerNote` and the `LoadingCard` spinner):

```css
.page {
  position: relative;
  display: flex;
  min-height: 100vh;
  width: 100%;
  align-items: center;
  justify-content: center;
  padding: 24px;
}

.card {
  display: flex;
  width: 100%;
  max-width: 392px;
  flex-direction: column;
  align-items: center;
  padding: 36px 34px 30px;
  background: var(--card);
  color: var(--card-foreground);
  border: 1px solid var(--border);
  border-radius: 22px;
  box-shadow: var(--shadow-elevated);
  transition:
    background 0.2s var(--ease),
    border-color 0.2s var(--ease);
}

.brandMark {
  display: grid;
  width: 54px;
  height: 54px;
  grid-template-columns: 1fr 1fr;
  gap: 5px;
  padding: 12px;
  background: var(--accent-soft);
  border-radius: 16px;
}

.brandCell {
  border-radius: 4px;
  background: var(--primary);
}

.brandCellDim {
  border-radius: 4px;
  background: var(--primary);
  opacity: 0.5;
}

.brandLabel {
  margin-top: 14px;
  font-family: var(--font-mono);
  font-size: 12px;
  font-weight: 600;
  letter-spacing: 0.14em;
  text-transform: uppercase;
  color: var(--muted-foreground);
}

.footerNote {
  display: flex;
  align-items: center;
  gap: 6px;
  margin-top: 22px;
  font-size: 12px;
  color: var(--muted-foreground);
}

/* LoadingCard spinner (route `!loader.ready()` fallback). */
.spinnerLarge {
  display: inline-block;
  width: 34px;
  height: 34px;
  margin-top: 22px;
  border: 3px solid var(--border);
  border-top-color: var(--primary);
  border-radius: 50%;
  animation: spin 0.8s linear infinite;
}
@keyframes spin {
  to {
    transform: rotate(360deg);
  }
}
```

- [ ] **Step 3: Create `ThemeTogglePill.module.css` and repoint the component**

Create `src/ui/ThemeTogglePill.module.css` (moved verbatim from `ActivateScreen.module.css`):

```css
.themeToggle {
  position: fixed;
  top: 20px;
  right: 20px;
  z-index: 10;
  display: flex;
  gap: 3px;
  padding: 4px;
  background: var(--muted);
  border: 1px solid var(--border);
  border-radius: 999px;
}

.themeToggleItem {
  display: flex;
  width: 34px;
  height: 34px;
  align-items: center;
  justify-content: center;
  padding: 0;
  background: transparent;
  color: var(--muted-foreground);
  border: none;
  border-radius: 999px;
  cursor: pointer;
  transition:
    background 0.15s var(--ease),
    color 0.15s var(--ease),
    box-shadow 0.15s var(--ease);
}
.themeToggleItem[data-state='on'] {
  background: var(--card);
  color: var(--foreground);
  box-shadow: var(--shadow-seg);
}
```

In `src/ui/ThemeTogglePill.tsx`, change line 10 from:

```tsx
import styles from './ActivateScreen.module.css'
```

to:

```tsx
import styles from './ThemeTogglePill.module.css'
```

- [ ] **Step 4: Write the failing `Shell` + `LoadingCard` tests**

Create `src/ui/Shell.test.tsx`:

```tsx
// @vitest-environment jsdom
import { context } from '@reatom/core'
import { render, screen } from '@testing-library/react'
import { beforeEach, describe, expect, it } from 'vitest'

import { Shell } from './Shell'

beforeEach(() => {
  context.reset()
  localStorage.clear()
})

describe('Shell', () => {
  it('renders children inside the card with the brand mark and theme toggle', () => {
    render(
      <Shell>
        <div>BODY CONTENT</div>
      </Shell>,
    )

    expect(screen.getByText('BODY CONTENT')).toBeInTheDocument()
    expect(screen.getByText('myboard')).toBeInTheDocument()
    expect(screen.getByRole('radiogroup', { name: 'Тема' })).toBeInTheDocument()
  })
})
```

Create `src/ui/LoadingCard.test.tsx`:

```tsx
// @vitest-environment jsdom
import { context } from '@reatom/core'
import { render } from '@testing-library/react'
import { beforeEach, describe, expect, it } from 'vitest'

import { LoadingCard } from './LoadingCard'

beforeEach(() => context.reset())

describe('LoadingCard', () => {
  it('renders a spinner element', () => {
    const { container } = render(<LoadingCard />)
    expect(container.querySelector('span[aria-hidden]')).not.toBeNull()
  })
})
```

- [ ] **Step 5: Run the tests to verify they fail**

Run: `pnpm --filter client exec vitest run activation/src/ui/Shell.test.tsx activation/src/ui/LoadingCard.test.tsx`
Expected: FAIL — `Shell` / `LoadingCard` modules do not exist.

- [ ] **Step 6: Implement `Shell.tsx` and `LoadingCard.tsx`**

Create `src/ui/Shell.tsx`:

```tsx
import type { ReactNode } from 'react'
import { reatomMemo } from 'widget-sdk/reatom/reatom-memo'

import { ThemeTogglePill } from './ThemeTogglePill'

import styles from './shell.module.css'

const BrandMark = reatomMemo(
  () => (
    <>
      <div aria-hidden className={styles.brandMark}>
        <div className={styles.brandCell} />
        <div className={styles.brandCellDim} />
        <div className={styles.brandCellDim} />
        <div className={styles.brandCell} />
      </div>
      <div className={styles.brandLabel}>myboard</div>
    </>
  ),
  'BrandMark',
)

export const Shell = reatomMemo<{ children: ReactNode }>(
  ({ children }) => (
    <div className={styles.page}>
      <ThemeTogglePill />
      <div className={styles.card}>
        <BrandMark />
        {children}
      </div>
    </div>
  ),
  'Shell',
)
```

Create `src/ui/LoadingCard.tsx`:

```tsx
import { reatomMemo } from 'widget-sdk/reatom/reatom-memo'

import styles from './shell.module.css'

// Card body shown by a route's `render` while its loader is not ready
// (only reached on the /add-device?token=CODE deep link while the embedded
// code is server-validated). The surrounding .page/.card come from Shell.
export const LoadingCard = reatomMemo(
  () => <span aria-hidden className={styles.spinnerLarge} />,
  'LoadingCard',
)
```

- [ ] **Step 7: Run tests to verify they pass**

Run: `pnpm --filter client exec vitest run activation/src/ui/Shell.test.tsx activation/src/ui/LoadingCard.test.tsx activation/src/ui/ThemeTogglePill.test.tsx`
Expected: PASS (all three).

- [ ] **Step 8: Commit**

```bash
git add packages/client/activation/src/reatom.d.ts \
  packages/client/activation/src/ui/shell.module.css \
  packages/client/activation/src/ui/Shell.tsx \
  packages/client/activation/src/ui/Shell.test.tsx \
  packages/client/activation/src/ui/LoadingCard.tsx \
  packages/client/activation/src/ui/LoadingCard.test.tsx \
  packages/client/activation/src/ui/ThemeTogglePill.module.css \
  packages/client/activation/src/ui/ThemeTogglePill.tsx
git commit -m "$(cat <<'EOF'
refactor(activation): extract shared Shell + LoadingCard, add RouteChild typing

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>
EOF
)"
```

---

### Task 2: Render screens as card bodies inside the shared Shell

Wrap the current pathname-branched output in `Shell`, and reduce both screens to card *bodies* (they stop emitting `.page` / `.card` / brand mark / theme toggle). Still on the hand-written router — no routing behavior changes. The theme toggle now appears on both screens (via `Shell`), an accepted change.

**Files:**
- Modify: `src/App.tsx`
- Modify: `src/ui/ActivateScreen.tsx`
- Modify: `src/ui/ActivateScreen.module.css` (drop shared shell + theme-toggle classes)
- Modify: `src/ui/AddDeviceScreen.tsx`
- Modify: `src/ui/AddDeviceScreen.module.css` (drop shared shell classes)

**Interfaces:**
- Consumes: `Shell` (Task 1), `shell.module.css` `.footerNote` (Task 1).
- Produces: `ActivateScreen` / `AddDeviceScreen` render only card-body content (a fragment), no outer chrome. Props unchanged this task (`ActivateScreen` keeps `model` + `navigate`; `AddDeviceScreen` keeps `model`).

- [ ] **Step 1: Wrap App output in `Shell`**

In `src/App.tsx`, replace the whole file with:

```tsx
import { reatomMemo } from 'widget-sdk/reatom/reatom-memo'

import { pathname } from './model/router'
import { ActivateScreen } from './ui/ActivateScreen'
import { AddDeviceScreen } from './ui/AddDeviceScreen'
import { Shell } from './ui/Shell'

export const App = reatomMemo(() => {
  const path = pathname()

  return <Shell>{path === '/add-device' ? <AddDeviceScreen /> : <ActivateScreen />}</Shell>
}, 'App')
```

- [ ] **Step 2: Reduce `ActivateScreen` to a card body**

In `src/ui/ActivateScreen.tsx`:

1. Remove the `ThemeTogglePill` import (line 12: `import { ThemeTogglePill } from './ThemeTogglePill'`).
2. Add a shell-styles import next to the existing `import styles from './ActivateScreen.module.css'`:

   ```tsx
   import shellStyles from './shell.module.css'
   ```

3. Replace the outer wrapper. Change the top of the returned JSX from:

   ```tsx
   return (
     <div className={styles.page}>
       <ThemeTogglePill />
       <div className={styles.card}>
         <div aria-hidden className={styles.brandMark}>
           <div className={styles.brandCell} />
           <div className={styles.brandCellDim} />
           <div className={styles.brandCellDim} />
           <div className={styles.brandCell} />
         </div>
         <div className={styles.brandLabel}>myboard</div>

         {screen === 'home' ? (
   ```

   to:

   ```tsx
   return (
     <>
       {screen === 'home' ? (
   ```

4. Change the footer note + closing tags at the bottom from:

   ```tsx
           <div className={styles.footerNote}>
             <Lock size={12} strokeWidth={2} aria-hidden />
             Защищено passkey на этом устройстве
           </div>
         </div>
       </div>
     )
   ```

   to:

   ```tsx
         <div className={shellStyles.footerNote}>
           <Lock size={12} strokeWidth={2} aria-hidden />
           Защищено passkey на этом устройстве
         </div>
       </>
     )
   ```

- [ ] **Step 3: Drop the now-unused shell + toggle classes from `ActivateScreen.module.css`**

In `src/ui/ActivateScreen.module.css`, delete these rule blocks (now owned by `shell.module.css` / `ThemeTogglePill.module.css`): `.page`, `.themeToggle`, `.themeToggleItem`, `.themeToggleItem[data-state='on']`, `.card`, `.brandMark`, `.brandCell`, `.brandCellDim`, `.brandLabel`, `.footerNote`. Keep everything else (`.heading`, `.description*`, `.fieldGroup`, `.primaryButton*`, `.fieldError*`, `.serverError*`, `.secondaryButtonGap`, `.crossLink*`, `.adminHint`).

- [ ] **Step 4: Reduce `AddDeviceScreen` to a card body**

In `src/ui/AddDeviceScreen.tsx`:

1. Add a shell-styles import next to `import styles from './AddDeviceScreen.module.css'`:

   ```tsx
   import shellStyles from './shell.module.css'
   ```

2. Remove the `showBrandMark` computation (the line `const showBrandMark = mode !== 'scanning'`). The brand mark now lives in `Shell` and is covered by the scanner overlay when scanning.

3. Replace the outer wrapper. Change the main returned JSX from:

   ```tsx
   return (
     <div className={styles.page}>
       <div className={styles.card}>
         {showBrandMark ? (
           <>
             <div aria-hidden className={styles.brandMark}>
               <div className={styles.brandCell} />
               <div className={styles.brandCellDim} />
               <div className={styles.brandCellDim} />
               <div className={styles.brandCell} />
             </div>
             <div className={styles.brandLabel}>myboard</div>
           </>
         ) : null}

         <div key={stepKey} className={styles.stepContent}>
   ```

   to:

   ```tsx
   return (
     <div key={stepKey} className={styles.stepContent}>
   ```

4. Change the closing tags at the very bottom from:

   ```tsx
         </div>
       </div>
     </div>
   )
   ```

   to:

   ```tsx
     </div>
   )
   ```

   (The middle `stepContent` `<div>` now closes the returned fragment directly.)

5. Update the two `styles.footerNote` usages (in the `choose` and `registering` blocks) to `shellStyles.footerNote`.

- [ ] **Step 5: Drop the now-unused shell classes from `AddDeviceScreen.module.css`**

In `src/ui/AddDeviceScreen.module.css`, delete these rule blocks (now in `shell.module.css`): `.page`, `.card`, `.brandMark`, `.brandCell`, `.brandCellDim`, `.brandLabel`, `.footerNote`. Keep everything else, notably `.stepContent`/`@keyframes stepIn`, the scanner classes, `.spinnerLarge`/`@keyframes spin` (the `waiting` spinner keeps its own copy), and all body classes. Also delete the now-stale "Shell classes ... intentional near-copy" comment block at the top.

- [ ] **Step 6: Run the affected tests**

Run: `pnpm --filter client exec vitest run activation/src`
Expected: PASS. `App.test.tsx`, `ActivateScreen.test.tsx`, `AddDeviceScreen.test.tsx`, `ThemeTogglePill.test.tsx`, `Shell.test.tsx`, `LoadingCard.test.tsx`, and the model/router tests all still pass (headings/buttons live in the bodies; the router is untouched).

- [ ] **Step 7: Commit**

```bash
git add packages/client/activation/src/App.tsx \
  packages/client/activation/src/ui/ActivateScreen.tsx \
  packages/client/activation/src/ui/ActivateScreen.module.css \
  packages/client/activation/src/ui/AddDeviceScreen.tsx \
  packages/client/activation/src/ui/AddDeviceScreen.module.css
git commit -m "$(cat <<'EOF'
refactor(activation): render screens as card bodies inside shared Shell

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>
EOF
)"
```

---

### Task 3: Replace the hand-written router with reatomRouter

Create the route tree, wire loaders/render, make `token`/`scan` authoritative from the route search, pass the model to each screen by prop, and delete the old router. This is the actual migration.

**Files:**
- Create: `src/model/routes.tsx`
- Create: `src/model/routes.test.tsx`
- Delete: `src/model/router.ts`
- Delete: `src/model/router.test.ts`
- Modify: `src/App.tsx`
- Modify: `src/main.tsx`
- Modify: `src/model/activation-model.ts` (token authoritative)
- Modify: `src/model/add-device-model.ts` (token/scan authoritative)
- Modify: `src/ui/ActivateScreen.tsx` (`model` required; `navigate` → `onScan`)
- Modify: `src/ui/AddDeviceScreen.tsx` (`model` required; drop init `useEffect`; `activateRoute.go`)
- Modify: `src/App.test.tsx` (drive via `urlAtom.go` / route `.go`)
- Modify: `src/ui/ActivateScreen.test.tsx` (`navigate` → `onScan`)

**Interfaces:**
- Consumes: `makeActivationModel`, `ActivationModel` (`src/model/activation-model.ts`); `createAddDeviceModel`, `AddDeviceModel` (`src/model/add-device-model.ts`); `Shell`, `LoadingCard` (Task 1); `ActivateScreen`, `AddDeviceScreen` (Task 2).
- Produces:
  - `rootRoute` — layout route rendering `<Shell>{outlet}</Shell>`.
  - `activateRoute` — path `activate`, `search { token? }`, sync loader `{ model: ActivationModel }`.
  - `addDeviceRoute` — path `add-device`, `search { token?, scan? }`, async loader `{ model: AddDeviceModel }` after `await model.init()`.
  - `ActivateScreen` prop shape: `{ model: ActivationModel; onScan?: () => void }`.
  - `AddDeviceScreen` prop shape: `{ model: AddDeviceModel }`.

- [ ] **Step 1: Make `token` authoritative in `activation-model.ts`**

In `src/model/activation-model.ts`:

1. Delete the `readTokenFromLocation` function (lines ~52–55).
2. In `makeActivationModel`, change the `token` default resolution from:

   ```tsx
   token: overrides.token ?? readTokenFromLocation(),
   ```

   to:

   ```tsx
   token: overrides.token ?? null,
   ```

- [ ] **Step 2: Make `token`/`scan` authoritative in `add-device-model.ts`**

In `src/model/add-device-model.ts`:

1. Delete the `readTokenFromLocation` and `readScanFromLocation` functions.
2. In `createAddDeviceModel`, change:

   ```tsx
   token: overrides.token ?? readTokenFromLocation(),
   scan: overrides.scan ?? readScanFromLocation(),
   ```

   to:

   ```tsx
   token: overrides.token ?? null,
   scan: overrides.scan ?? false,
   ```

- [ ] **Step 3: Run model tests to confirm they still pass**

Run: `pnpm --filter client exec vitest run activation/src/model/activation-model.test.ts activation/src/model/add-device-model.test.ts`
Expected: PASS — every test injects `token`/`scan`/`currentOrigin` explicitly, so removing the location readers changes nothing for them.

- [ ] **Step 4: Convert `ActivateScreen` to `model`-required + `onScan`**

In `src/ui/ActivateScreen.tsx`:

1. Change the imports: remove `import { navigateInApp } from '../model/router'`; remove `makeActivationModel` from the model import (keep the `ActivationModel` type); add `import { addDeviceRoute } from '../model/routes'`. Remove the now-unused `useState` import if nothing else uses it (it is used only for the model fallback removed below).
2. Remove the `SCAN_PATH` constant and replace the prop type + signature. Change:

   ```tsx
   const SCAN_PATH = '/add-device?scan=1'

   export type ActivateScreenProps = {
     model?: ActivationModel
     navigate?: (path: string) => void
   }
   ```

   to:

   ```tsx
   export type ActivateScreenProps = {
     model: ActivationModel
     onScan?: () => void
   }
   ```

3. Change the component signature + drop the `useState` fallback. From:

   ```tsx
   export const ActivateScreen = reatomMemo<ActivateScreenProps>(
     ({ model: injectedModel, navigate = navigateInApp }) => {
       const [model] = useState(() => injectedModel ?? makeActivationModel())
   ```

   to:

   ```tsx
   export const ActivateScreen = reatomMemo<ActivateScreenProps>(
     ({ model, onScan = () => addDeviceRoute.go({ scan: '1' }) }) => {
   ```

4. Replace the two `onClick={() => navigate(SCAN_PATH)}` handlers (the two "Сканировать QR-код" buttons) with `onClick={onScan}`.

- [ ] **Step 5: Convert `AddDeviceScreen` to `model`-required + drop the init `useEffect`**

In `src/ui/AddDeviceScreen.tsx`:

1. Change imports: remove `import { navigateInApp } from '../model/router'`; remove `createAddDeviceModel` from the model import (keep the `AddDeviceModel` type); add `import { activateRoute } from '../model/routes'`. Remove `useEffect` from the React import (keep `useState`).
2. Change the prop type + signature. From:

   ```tsx
   export type AddDeviceScreenProps = {
     model?: AddDeviceModel
   }

   export const AddDeviceScreen = reatomMemo<AddDeviceScreenProps>(({ model: injectedModel }) => {
     const [model] = useState(() => injectedModel ?? createAddDeviceModel())
   ```

   to:

   ```tsx
   export type AddDeviceScreenProps = {
     model: AddDeviceModel
   }

   export const AddDeviceScreen = reatomMemo<AddDeviceScreenProps>(({ model }) => {
   ```

3. Delete the mount effect (init now runs in the route loader):

   ```tsx
   useEffect(() => {
     void model.init()
   }, [model])
   ```

4. In `closeScanner`, replace the `navigateInApp('/activate')` fallback with `activateRoute.go({})`:

   ```tsx
   function closeScanner() {
     if (enteredScanDirectly) {
       if (typeof window !== 'undefined' && window.history.length > 1) {
         window.history.back()
       } else {
         activateRoute.go({})
       }
       return
     }
     goToChoose()
   }
   ```

- [ ] **Step 6: Write the route tree `src/model/routes.tsx`**

Create `src/model/routes.tsx`:

```tsx
import { reatomRoute, type RouteChild } from '@reatom/core'
import { z } from 'zod'

import { ActivateScreen } from '../ui/ActivateScreen'
import { AddDeviceScreen } from '../ui/AddDeviceScreen'
import { LoadingCard } from '../ui/LoadingCard'
import { Shell } from '../ui/Shell'
import { createAddDeviceModel } from './add-device-model'
import { makeActivationModel } from './activation-model'

// Pathless layout: renders the shared card shell and composes the active page
// through `outlet()`. Always active. See the design spec for why the shell
// lives here and the scanner escapes it as a fixed overlay.
export const rootRoute = reatomRoute(
  {
    layout: true,
    render: (self): RouteChild => <Shell>{self.outlet()}</Shell>,
  },
  'rootRoute',
)

// `/activate` (and `/activate?token=...`). Sync loader → the login/registration
// model. `token ?? null` preserves the home / no-code / activate mapping.
export const activateRoute = rootRoute.reatomRoute(
  {
    path: 'activate',
    search: z.object({ token: z.string().optional() }),
    loader: ({ token }) => ({ model: makeActivationModel({ token: token ?? null }) }),
    render: (self): RouteChild => {
      // `loader.data()` is `Payload | undefined` (undefined until the first
      // successful load), so narrow via the value, not `loader.ready()`.
      const data = self.loader.data()
      return data ? <ActivateScreen model={data.model} /> : <LoadingCard />
    },
  },
  'activateRoute',
)

// `/add-device` (optionally `?scan=1` or `?token=CODE`). Async loader awaits
// `init()`, so a deep-linked embedded code is server-validated before render
// (the loader's own async context aborts it on navigation — no `effect` needed).
export const addDeviceRoute = rootRoute.reatomRoute(
  {
    path: 'add-device',
    search: z.object({ token: z.string().optional(), scan: z.literal('1').optional() }),
    async loader({ token, scan }) {
      const model = createAddDeviceModel({ token: token ?? null, scan: scan === '1' })
      await model.init()
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

- [ ] **Step 7: Point `App` at the route tree**

Replace `src/App.tsx` with:

```tsx
import { reatomMemo } from 'widget-sdk/reatom/reatom-memo'

import { rootRoute } from './model/routes'

export const App = reatomMemo(() => rootRoute.render(), 'App')
```

- [ ] **Step 8: Update the bootstrap in `main.tsx`**

Replace `src/main.tsx` with:

```tsx
import { urlAtom } from '@reatom/core'
import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'

import { initTheme } from '@/theme/model/theme-model'

import { App } from './App'

import './global.css'

// Resolve stored/system theme and apply <html data-theme> before first paint,
// mirroring the board host so the activation app themes identically.
initTheme()
// No in-app <a> navigation; the board '/' is a hard load to a separate bundle.
// Disabling link interception keeps a future <a href="/"> from being hijacked
// into SPA navigation. urlAtom subscribes to popstate itself once connected.
urlAtom.catchLinks.set(false)

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
  </StrictMode>,
)
```

- [ ] **Step 9: Delete the hand-written router**

```bash
git rm packages/client/activation/src/model/router.ts \
  packages/client/activation/src/model/router.test.ts
```

- [ ] **Step 10: Rewrite `App.test.tsx` to drive via the router**

Replace `src/App.test.tsx` with:

```tsx
// @vitest-environment jsdom
import { context } from '@reatom/core'
import { act, render, screen } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import { App } from './App'
import { addDeviceRoute } from './model/routes'

// Stub the QR scanner screen: its real `useZxing` touches camera APIs and
// crashes under jsdom. The stub lets us assert the router lands on the
// add-device page without mounting the scanner.
vi.mock('./ui/AddDeviceScreen', () => ({
  AddDeviceScreen: () => <div>ADD DEVICE STUB</div>,
}))

beforeEach(() => {
  context.reset()
  window.history.replaceState(null, '', '/activate')
})

describe('App routing', () => {
  it('renders the HOME login card at /activate with no token', async () => {
    render(<App />)

    expect(await screen.findByRole('heading', { name: 'Вход в myboard' })).toBeInTheDocument()
  })

  it('renders the ACTIVATE card at /activate?token=abc', async () => {
    window.history.replaceState(null, '', '/activate?token=abc')

    render(<App />)

    expect(await screen.findByRole('heading', { name: 'Активация устройства' })).toBeInTheDocument()
  })

  it('renders the NO-CODE card at /activate?token= (empty)', async () => {
    window.history.replaceState(null, '', '/activate?token=')

    render(<App />)

    expect(await screen.findByRole('heading', { name: 'Нужен код приглашения' })).toBeInTheDocument()
  })

  it('switches to the add-device page via addDeviceRoute.go without remounting', async () => {
    render(<App />)
    await screen.findByRole('heading', { name: 'Вход в myboard' })

    act(() => {
      addDeviceRoute.go({ scan: '1' })
    })

    expect(await screen.findByText('ADD DEVICE STUB')).toBeInTheDocument()
    expect(screen.queryByRole('heading', { name: 'Вход в myboard' })).not.toBeInTheDocument()
  })
})
```

- [ ] **Step 11: Write `routes.test.tsx`**

Create `src/model/routes.test.tsx`:

```tsx
// @vitest-environment jsdom
import { context, urlAtom } from '@reatom/core'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'

import { activateRoute, addDeviceRoute } from './routes'

beforeEach(() => {
  window.history.replaceState(null, '', '/activate')
})
afterEach(() => context.reset())

describe('activation routes', () => {
  it('addDeviceRoute.go({ scan: "1" }) navigates to /add-device?scan=1', () => {
    addDeviceRoute.go({ scan: '1' })

    expect(urlAtom().pathname).toBe('/add-device')
    expect(urlAtom().search).toBe('?scan=1')
  })

  it('activateRoute.go({}) navigates back to /activate', () => {
    urlAtom.go('/add-device?scan=1')

    activateRoute.go({})

    expect(urlAtom().pathname).toBe('/activate')
  })
})
```

- [ ] **Step 12: Update `ActivateScreen.test.tsx` (`navigate` → `onScan`)**

In `src/ui/ActivateScreen.test.tsx`:

1. Replace every `navigate={vi.fn()}` prop with `onScan={vi.fn()}`.
2. Rewrite the last test to spy `onScan`:

   ```tsx
   it('the scan button invokes onScan', () => {
     const onScan = vi.fn()
     render(<ActivateScreen model={model(null)} onScan={onScan} />)

     fireEvent.click(screen.getByRole('button', { name: /Сканировать QR-код/ }))

     expect(onScan).toHaveBeenCalledTimes(1)
   })
   ```

- [ ] **Step 13: Run the full activation suite + typecheck**

Run: `pnpm --filter client exec vitest run activation/src`
Expected: PASS (routes, App, both screens, both models, Shell, LoadingCard, ThemeTogglePill).

Run: `pnpm typecheck`
Expected: PASS — `render` returns `RouteChild` (React element via the Task 1 augmentation); `self.loader.data().model` is typed.

- [ ] **Step 14: Commit**

```bash
git add packages/client/activation/src
git commit -m "$(cat <<'EOF'
feat(activation): replace hand-written router with reatomRouter

rootRoute layout + outlet renders the shared shell; activate/add-device
routes carry zod search schemas, build their model in the loader, and
render via `render`. token/scan now come from the route, not location.

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>
EOF
)"
```

---

### Task 4: Drop the `validating` atom (superseded by `loader.ready()`)

`await model.init()` in the add-device loader means the screen only renders once validation is done, so `validating` is always false at render time. Remove it. The `initialized` re-entrancy guard in `init()` **stays** (defensive; its idempotency test stays green).

**Files:**
- Modify: `src/model/add-device-model.ts`
- Modify: `src/ui/AddDeviceScreen.tsx`
- Modify: `src/model/add-device-model.test.ts`

**Interfaces:**
- Consumes: `AddDeviceModel` (Task 3).
- Produces: `AddDeviceModel` without the `validating: Atom<boolean>` member; `init()` no longer touches `validating`.

- [ ] **Step 1: Remove the two `validating` tests**

In `src/model/add-device-model.test.ts`, delete these two `it(...)` blocks from the `init (...)` describe:
- `'flags validating while the URL code is being checked, then clears it'`
- `'never flags validating when there is no URL code'`

Keep all other tests, including `'is idempotent: a second init call ... does not re-fetch'` (the `initialized` guard stays).

- [ ] **Step 2: Run the test file to confirm it still passes without those tests**

Run: `pnpm --filter client exec vitest run activation/src/model/add-device-model.test.ts`
Expected: PASS (the two deleted tests are gone; the rest are unaffected).

- [ ] **Step 3: Remove `validating` from the model**

In `src/model/add-device-model.ts`:

1. In the `AddDeviceModel` interface, delete the `validating: Atom<boolean>` member and its doc comment.
2. Delete the atom creation `const validating = atom(Boolean(urlCode), 'addDevice.validating')`.
3. In `init`, delete the trailing `validating.set(false)` line. The action body becomes:

   ```tsx
   const init = action(async () => {
     if (initialized) return
     initialized = true
     if (!urlCode) return
     await wrap(stageScannedCode(urlCode))
   }, 'addDevice.init')
   ```

4. Remove `validating` from the returned object at the end of `createAddDeviceModel`.

- [ ] **Step 4: Remove `validating` usage from `AddDeviceScreen`**

In `src/ui/AddDeviceScreen.tsx`:

1. Delete `const validating = model.validating()`.
2. Change `showRegisterLoading` from:

   ```tsx
   const showRegisterLoading = mode === 'registering' && (ceremonyPending || validating)
   ```

   to:

   ```tsx
   const showRegisterLoading = mode === 'registering' && ceremonyPending
   ```

- [ ] **Step 5: Run the activation suite + typecheck**

Run: `pnpm --filter client exec vitest run activation/src`
Expected: PASS.

Run: `pnpm typecheck`
Expected: PASS (no remaining references to `model.validating`).

- [ ] **Step 6: Commit**

```bash
git add packages/client/activation/src/model/add-device-model.ts \
  packages/client/activation/src/model/add-device-model.test.ts \
  packages/client/activation/src/ui/AddDeviceScreen.tsx
git commit -m "$(cat <<'EOF'
refactor(activation): drop validating atom, superseded by loader.ready

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>
EOF
)"
```

---

## Final verification gate

- [ ] **Run the full local gate**

Run: `pnpm --filter client test`
Expected: PASS (whole client suite).

Run: `pnpm typecheck && pnpm lint && pnpm format:check`
Expected: PASS. If `format:check` flags the new/edited files, run `pnpm format` and commit the formatting-only change.

- [ ] **Manual smoke (dev server or built activation app)**

Verify each surface renders and the theme toggle is present on both:
- `/activate` → HOME login card.
- `/activate?token=abc` → activation/registration card.
- `/activate?token=` → "Нужен код приглашения".
- `/add-device` → choose (scan/manual).
- `/add-device?scan=1` → scanner overlay (covers the shell + toggle).
- `/add-device?token=<valid-code>` → brief spinner card, then "Добавить устройство…".
- Browser back/forward moves between `/activate` and `/add-device` without a full reload; a successful login/registration still hard-navigates to `/`.

## Notes / deviations from the spec

- **`initialized` guard kept** (spec listed it for removal): it is defensive and its idempotency test stays green — removing it would break that test for no real benefit. Only `validating` is removed.
- **`createAddDeviceModel` not renamed.** The spec flagged the `make*`-over-`create*` convention as an optional, out-of-scope cleanup; this plan leaves the name as-is.
