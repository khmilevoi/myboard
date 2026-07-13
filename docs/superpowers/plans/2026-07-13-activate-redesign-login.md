# Activate Redesign + Login Flow Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Reshape the activation card into the four-screen model from `Activate.dc.html` (home / activate / activate-no-code / activate-used) and add a first-class passkey login landing, reusing the existing `/add-device` scanner via smooth client-side routing.

**Architecture:** The standalone activation SPA gains a tiny reactive router (a `pathname`/`search` atom pair + `navigateInApp`) so `/activate ↔ /add-device` transitions are client-side pushState instead of full reloads. `activation-model` replaces its `mode: 'new-account' | 'login'` with a `screen` atom derived from the `?token=` param, with the `invite_consumed` (409) response transitioning to `activate-used`. `ActivateScreen` renders the four states; the scan buttons route to `/add-device?scan=1`, which opens the existing `AddDeviceScreen` scanner directly.

**Tech Stack:** React 19, Reatom v1001 (`@reatom/core`, `@reatom/react`), shadcn leaf primitives under `@/components/ui`, lucide-react icons, `@simplewebauthn/browser`, Vitest + @testing-library/react (jsdom), Playwright e2e.

## Global Constraints

- Reatom: every exported React component is wrapped with `reatomMemo` from `widget-sdk`; business/derived/async logic lives in `model/`, `ui/` keeps view glue. Reads in event handlers are fine; sync atom writes from `onClick` follow the existing `AddDeviceScreen` precedent (`model.mode.set(...)`). Never leave an unwrapped read/write after an `await` — pre-wrap continuations (see existing model code).
- errore: models return `Error | T` unions and check `instanceof Error`; never throw across the seam. This feature reuses the existing error handling.
- Copy: use the Russian strings **verbatim** from `Activate.dc.html` (quoted in each task). Note the design says **"passkey"**, not "ключ доступа" — this changes existing button copy.
- The invite URL param is **`?token=`** (the design's `?code=`/`?used` are preview-only aliases; do not use them).
- New factories use `make*`, not `create*` (rename `createActivationModel` → `makeActivationModel`; leave `createAddDeviceModel` as is).
- No server, auth-endpoint, or nginx changes. No storage-key changes.
- Run workspace commands from the repo root with `pnpm`; per `CLAUDE.md`, prefix shell commands with `rtk` (it passes through). End every commit message with the `Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>` trailer.
- Single test file: `pnpm --filter client exec vitest run <path-relative-to-packages/client>`.

---

### Task 1: Reactive router

**Files:**
- Create: `packages/client/activation/src/model/router.ts`
- Test: `packages/client/activation/src/model/router.test.ts`

**Interfaces:**
- Produces: `pathname: Atom<string>`, `search: Atom<string>`, `navigateInApp(path: string): void`, `initRouter(): void`.

- [ ] **Step 1: Write the failing test**

```ts
// @vitest-environment jsdom
import { context } from '@reatom/core'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'

import { initRouter, navigateInApp, pathname, search } from './router'

beforeEach(() => {
  window.history.replaceState(null, '', '/activate')
})
afterEach(() => context.reset())

describe('activation router', () => {
  it('navigateInApp pushes browser history and updates the reactive atoms', () => {
    navigateInApp('/add-device?scan=1')

    expect(location.pathname).toBe('/add-device')
    expect(pathname()).toBe('/add-device')
    expect(search()).toBe('?scan=1')
  })

  it('syncs the atoms on popstate', () => {
    initRouter()
    window.history.replaceState(null, '', '/add-device?scan=1')

    window.dispatchEvent(new PopStateEvent('popstate'))

    expect(pathname()).toBe('/add-device')
    expect(search()).toBe('?scan=1')
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm --filter client exec vitest run activation/src/model/router.test.ts`
Expected: FAIL — `Cannot find module './router'`.

- [ ] **Step 3: Write minimal implementation**

```ts
import { atom, wrap } from '@reatom/core'

// Reactive location for the standalone activation SPA. `/activate` and
// `/add-device` are the same bundle (nginx serves both from
// /activate/index.html), so in-app moves between them can be client-side
// pushState transitions instead of full reloads. Navigation to `/` after a
// successful login/activation stays a hard load (that is the board bundle) and
// is NOT routed here -- see each model's `navigate` dep.

function currentPathname(): string {
  return typeof location === 'undefined' ? '/activate' : location.pathname
}

function currentSearch(): string {
  return typeof location === 'undefined' ? '' : location.search
}

export const pathname = atom(currentPathname(), 'activation.router.pathname')
export const search = atom(currentSearch(), 'activation.router.search')

// Deferred/event-driven writes run through `wrap` so they keep the reatom
// context, matching the `wrap`ped interval/timer callbacks elsewhere in this app.
const sync = wrap(() => {
  pathname.set(currentPathname())
  search.set(currentSearch())
})

// Push a new in-app location and update the reactive atoms. Only for paths
// served by THIS bundle (`/activate*`, `/add-device*`).
export function navigateInApp(path: string): void {
  if (typeof history !== 'undefined') history.pushState(null, '', path)
  sync()
}

let initialized = false

export function initRouter(): void {
  if (initialized || typeof window === 'undefined') return
  initialized = true
  window.addEventListener('popstate', () => sync())
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm --filter client exec vitest run activation/src/model/router.test.ts`
Expected: PASS (2 tests).

- [ ] **Step 5: Commit**

```bash
git add packages/client/activation/src/model/router.ts packages/client/activation/src/model/router.test.ts
git commit -m "feat(activation): reactive in-app router for /activate <-> /add-device"
```

---

### Task 2: activation-model → `screen` atom

**Files:**
- Modify: `packages/client/activation/src/model/activation-model.ts`
- Test: `packages/client/activation/src/model/activation-model.test.ts`

**Interfaces:**
- Produces: `makeActivationModel(overrides?): ActivationModel` where `ActivationModel.screen: Atom<'home' | 'activate' | 'activate-no-code' | 'activate-used'>` (replaces `mode`); `startRegistration`, `startLogin`, `registrationForm`, `loading`, `error` unchanged.
- Consumes: nothing new.

- [ ] **Step 1: Update the failing tests**

In `activation-model.test.ts`, change the import and the two `mode`-based assertions, and add initial-screen coverage:

```ts
import { makeActivationModel } from './activation-model'
```

Replace every `createActivationModel(` with `makeActivationModel(` in this file.

Replace the `invite_consumed` test body's assertion:

```ts
  it('moves to the activate-used screen when register/options returns 409 invite_consumed', async () => {
    const { http } = makeScriptedHttp({
      '/api/auth/register/options': [
        { status: 409, body: { code: 'invite_consumed', canLogin: true } },
      ],
    })
    const model = makeActivationModel({ token: 'invite-token', http })

    model.registrationForm.fields.name.change('Alice')
    await model.startRegistration()

    expect(model.screen()).toBe('activate-used')
  })
```

In the `startLogin` "sends the stored credential hint ... after invite_consumed" test, replace `expect(model.mode()).toBe('login')` with `expect(model.screen()).toBe('activate-used')`.

Add a new describe block:

```ts
describe('initial screen', () => {
  it('is home when there is no invite token', () => {
    const model = makeActivationModel({ token: null, http: makeScriptedHttp({}).http })
    expect(model.screen()).toBe('home')
  })

  it('is activate when a non-empty token is present', () => {
    const model = makeActivationModel({ token: 'invite-token', http: makeScriptedHttp({}).http })
    expect(model.screen()).toBe('activate')
  })

  it('is activate-no-code when the token param is present but empty', () => {
    const model = makeActivationModel({ token: '', http: makeScriptedHttp({}).http })
    expect(model.screen()).toBe('activate-no-code')
  })
})
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `pnpm --filter client exec vitest run activation/src/model/activation-model.test.ts`
Expected: FAIL — `makeActivationModel` is not exported / `model.screen` is undefined.

- [ ] **Step 3: Edit the model**

In `activation-model.ts`:

Replace the mode type:

```ts
export type ActivationScreen = 'home' | 'activate' | 'activate-no-code' | 'activate-used'
```

Add a derivation helper (near `readTokenFromLocation`):

```ts
// home = no invite in the URL; activate-no-code = the `?token=` param is present
// but empty/whitespace (a malformed activation link); activate = a real token.
function initialScreen(token: string | null): ActivationScreen {
  if (token === null) return 'home'
  if (token.trim() === '') return 'activate-no-code'
  return 'activate'
}
```

In `ActivationModel`, replace `mode: Atom<ActivationMode>` with:

```ts
  screen: Atom<ActivationScreen>
```

Rename the factory and swap the atom:

```ts
export function makeActivationModel(overrides: Partial<ActivationDeps> = {}): ActivationModel {
```

```ts
  const screen = atom<ActivationScreen>(initialScreen(deps.token), 'activation.screen')
```

(Delete the old `const mode = atom<ActivationMode>('new-account', 'activation.mode')` line and the `ActivationMode` type export.)

In the `onSubmit` 409 branch:

```ts
        if (optionsResult.status === 409 && optionsResult.body.code === 'invite_consumed') {
          screen.set('activate-used')
          return
        }
```

In the final `return`, replace `mode` with `screen`:

```ts
  return { screen, loading, error, registrationForm, startRegistration, startLogin }
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `pnpm --filter client exec vitest run activation/src/model/activation-model.test.ts`
Expected: PASS (all tests, including the 3 new initial-screen tests).

- [ ] **Step 5: Commit**

```bash
git add packages/client/activation/src/model/activation-model.ts packages/client/activation/src/model/activation-model.test.ts
git commit -m "refactor(activation): screen atom replaces mode; invite_consumed -> activate-used"
```

---

### Task 3: ActivateScreen — four screens

**Files:**
- Modify (full rewrite): `packages/client/activation/src/ui/ActivateScreen.tsx`
- Modify: `packages/client/activation/src/ui/ActivateScreen.module.css`
- Test: `packages/client/activation/src/ui/ActivateScreen.test.tsx` (new)

**Interfaces:**
- Consumes: `makeActivationModel`, `ActivationModel` (Task 2); `navigateInApp` (Task 1).
- Produces: `ActivateScreen` accepting `{ model?: ActivationModel; navigate?: (path: string) => void }` (both optional, for test injection).

- [ ] **Step 1: Write the failing test**

```tsx
// @vitest-environment jsdom
import { context } from '@reatom/core'
import { makeScriptedHttp } from '@shared/http/test/scripted-http'
import { fireEvent, render, screen } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import { makeActivationModel } from '../model/activation-model'
import { ActivateScreen } from './ActivateScreen'

beforeEach(() => context.reset())

function model(token: string | null) {
  return makeActivationModel({ token, http: makeScriptedHttp({}).http })
}

describe('ActivateScreen', () => {
  it('renders the HOME login landing when there is no token', () => {
    render(<ActivateScreen model={model(null)} navigate={vi.fn()} />)

    expect(screen.getByRole('heading', { name: 'Вход в myboard' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: /Войти с passkey/ })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: /Сканировать QR-код/ })).toBeInTheDocument()
  })

  it('renders the ACTIVATE registration screen when a token is present', () => {
    render(<ActivateScreen model={model('invite')} navigate={vi.fn()} />)

    expect(screen.getByRole('heading', { name: 'Активация устройства' })).toBeInTheDocument()
    expect(screen.getByLabelText('Ваше имя')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: /Создать passkey/ })).toBeInTheDocument()
  })

  it('renders the NO-CODE screen when the token param is empty', () => {
    render(<ActivateScreen model={model('')} navigate={vi.fn()} />)

    expect(screen.getByRole('heading', { name: 'Нужен код приглашения' })).toBeInTheDocument()
  })

  it('renders the USED screen and offers login', () => {
    const m = model('invite')
    m.screen.set('activate-used')
    render(<ActivateScreen model={m} navigate={vi.fn()} />)

    expect(screen.getByRole('heading', { name: 'Приглашение уже использовано' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: /Войти с passkey/ })).toBeInTheDocument()
  })

  it('the ACTIVATE cross-link switches to the HOME screen', () => {
    render(<ActivateScreen model={model('invite')} navigate={vi.fn()} />)

    fireEvent.click(screen.getByText(/Уже активировано\?/))

    expect(screen.getByRole('heading', { name: 'Вход в myboard' })).toBeInTheDocument()
  })

  it('the scan button routes to /add-device?scan=1', () => {
    const navigate = vi.fn()
    render(<ActivateScreen model={model(null)} navigate={navigate} />)

    fireEvent.click(screen.getByRole('button', { name: /Сканировать QR-код/ }))

    expect(navigate).toHaveBeenCalledWith('/add-device?scan=1')
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm --filter client exec vitest run activation/src/ui/ActivateScreen.test.tsx`
Expected: FAIL — old `ActivateScreen` renders "Активируйте устройство"/mode-based UI; new headings/labels absent.

- [ ] **Step 3: Rewrite `ActivateScreen.tsx`**

```tsx
import { bindField } from '@reatom/react'
import { AlertCircle, AlertTriangle, Loader2, Lock, QrCode, ShieldCheck } from 'lucide-react'
import { useState } from 'react'
import { reatomMemo } from 'widget-sdk/reatom/reatom-memo'

import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'

import { type ActivationModel, makeActivationModel } from '../model/activation-model'
import { navigateInApp } from '../model/router'
import { ThemeTogglePill } from './ThemeTogglePill'

import styles from './ActivateScreen.module.css'

const SCAN_PATH = '/add-device?scan=1'

export type ActivateScreenProps = {
  // Both optional so App.tsx mounts `<ActivateScreen />` with a fresh internal
  // model + the real router, while tests inject a preset model and a navigate spy.
  model?: ActivationModel
  navigate?: (path: string) => void
}

function passkeyButtonContent(loading: boolean, idleLabel: string, loadingLabel: string) {
  if (loading) {
    return (
      <>
        <Loader2 size={16} strokeWidth={2.2} className="animate-spin" aria-hidden />
        {loadingLabel}
      </>
    )
  }
  return (
    <>
      <ShieldCheck size={18} strokeWidth={2} aria-hidden />
      {idleLabel}
    </>
  )
}

export const ActivateScreen = reatomMemo<ActivateScreenProps>(
  ({ model: injectedModel, navigate = navigateInApp }) => {
    const [model] = useState(() => injectedModel ?? makeActivationModel())
    const screen = model.screen()
    const error = model.error()
    const loading = model.loading()
    const nameField = model.registrationForm.fields.name
    const nameError = nameField.validation().error
    const hasNameError = Boolean(nameError)

    const scanButton = (
      <Button
        type="button"
        variant="outline"
        disabled={loading}
        onClick={() => navigate(SCAN_PATH)}
        className={`h-12 w-full gap-[9px] rounded-[13px] text-[15px] font-semibold ${styles.secondaryButtonGap}`}
      >
        <QrCode size={18} strokeWidth={2} aria-hidden />
        Сканировать QR-код
      </Button>
    )

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
            <>
              <h1 className={styles.heading}>Вход в myboard</h1>
              <p className={`${styles.description} ${styles.descriptionLogin}`}>
                Используйте passkey или отсканируйте QR-код с другого устройства, где вы уже
                вошли.
              </p>
              <Button
                type="button"
                disabled={loading}
                onClick={() => model.startLogin()}
                className={`h-12 w-full gap-[9px] rounded-[13px] text-[15px] font-semibold ${styles.primaryButtonStandalone}`}
              >
                {passkeyButtonContent(loading, 'Войти с passkey', 'Вход…')}
              </Button>
              {scanButton}
              <div className={styles.adminHint}>
                Новое устройство? Запросите ссылку-приглашение у администратора.
              </div>
            </>
          ) : null}

          {screen === 'activate' ? (
            <>
              <h1 className={styles.heading}>Активация устройства</h1>
              <p className={`${styles.description} ${styles.descriptionNew}`}>
                Создайте passkey, чтобы завершить настройку этого устройства.
              </p>
              <div className={styles.fieldGroup}>
                <Input
                  type="text"
                  placeholder="Ваше имя"
                  aria-label="Ваше имя"
                  aria-invalid={hasNameError}
                  aria-describedby="activate-name-error"
                  disabled={loading}
                  className="h-12 rounded-[13px] px-[15px] text-[15px]"
                  onKeyDown={(event) => {
                    if (event.key === 'Enter') model.startRegistration()
                  }}
                  {...bindField(nameField)}
                />
                <p
                  role="alert"
                  id="activate-name-error"
                  aria-hidden={!hasNameError}
                  className={`${styles.fieldError} ${hasNameError ? '' : styles.fieldErrorHidden} text-destructive`}
                >
                  <AlertCircle size={13} strokeWidth={2.2} aria-hidden />
                  {nameError || ' '}
                </p>
              </div>
              <Button
                type="button"
                disabled={loading}
                onClick={() => model.startRegistration()}
                className={`h-12 w-full gap-[9px] rounded-[13px] text-[15px] font-semibold ${styles.primaryButtonAfterField}`}
              >
                {passkeyButtonContent(loading, 'Создать passkey', 'Создание passkey…')}
              </Button>
              {scanButton}
              <button
                type="button"
                disabled={loading}
                onClick={() => model.screen.set('home')}
                className={styles.crossLink}
              >
                Уже активировано? <span className={styles.crossLinkAccent}>Войти с passkey</span>
              </button>
            </>
          ) : null}

          {screen === 'activate-no-code' ? (
            <>
              <h1 className={styles.heading}>Нужен код приглашения</h1>
              <p className={`${styles.description} ${styles.descriptionLogin}`}>
                В этой ссылке нет кода приглашения. Запросите новое приглашение у администратора
                или отсканируйте QR-код, который он отправил.
              </p>
              <Button
                type="button"
                onClick={() => navigate(SCAN_PATH)}
                className={`h-12 w-full gap-[9px] rounded-[13px] text-[15px] font-semibold ${styles.primaryButtonStandalone}`}
              >
                <QrCode size={18} strokeWidth={2} aria-hidden />
                Сканировать QR-код
              </Button>
              <button
                type="button"
                onClick={() => model.screen.set('home')}
                className={styles.crossLink}
              >
                Уже есть passkey? <span className={styles.crossLinkAccent}>Войти</span>
              </button>
            </>
          ) : null}

          {screen === 'activate-used' ? (
            <>
              <h1 className={styles.heading}>Приглашение уже использовано</h1>
              <p className={`${styles.description} ${styles.descriptionLogin}`}>
                Эта ссылка-приглашение уже была активирована на другом устройстве. Запросите новое
                приглашение у администратора.
              </p>
              <Button
                type="button"
                disabled={loading}
                onClick={() => model.startLogin()}
                className={`h-12 w-full gap-[9px] rounded-[13px] text-[15px] font-semibold ${styles.primaryButtonStandalone}`}
              >
                {passkeyButtonContent(loading, 'Войти с passkey', 'Вход…')}
              </Button>
              <button
                type="button"
                disabled={loading}
                onClick={() => model.screen.set('home')}
                className={styles.crossLink}
              >
                Нет passkey на этом устройстве?{' '}
                <span className={styles.crossLinkAccent}>Перейти к входу</span>
              </button>
            </>
          ) : null}

          {error ? (
            <div role="alert" className={styles.serverError}>
              <AlertTriangle
                size={15}
                strokeWidth={2.2}
                className={styles.serverErrorIcon}
                aria-hidden
              />
              <p className={`${styles.serverErrorText} text-destructive`}>{error}</p>
            </div>
          ) : null}

          <div className={styles.footerNote}>
            <Lock size={12} strokeWidth={2} aria-hidden />
            Защищено passkey на этом устройстве
          </div>
        </div>
      </div>
    )
  },
  'ActivateScreen',
)
```

- [ ] **Step 4: Add the CSS**

Append to `packages/client/activation/src/ui/ActivateScreen.module.css`:

```css
/* Secondary (outline) button — the "Сканировать QR-код" action, 10px below the
   primary button above it. */
.secondaryButtonGap {
  margin-top: 10px;
}

/* Cross-screen text links ("Уже активировано? Войти с passkey", etc.). */
.crossLink {
  margin-top: 18px;
  padding: 2px;
  background: none;
  border: none;
  font-size: 13.5px;
  font-weight: 500;
  color: var(--muted-foreground);
  text-align: center;
  cursor: pointer;
}
.crossLink:disabled {
  cursor: default;
  opacity: 0.6;
}
.crossLinkAccent {
  color: var(--primary);
}

/* HOME admin hint line. */
.adminHint {
  margin-top: 18px;
  padding: 2px;
  font-size: 13.5px;
  font-weight: 500;
  color: var(--muted-foreground);
  text-align: center;
}
```

- [ ] **Step 5: Run test to verify it passes**

Run: `pnpm --filter client exec vitest run activation/src/ui/ActivateScreen.test.tsx`
Expected: PASS (6 tests).

- [ ] **Step 6: Commit**

```bash
git add packages/client/activation/src/ui/ActivateScreen.tsx packages/client/activation/src/ui/ActivateScreen.module.css packages/client/activation/src/ui/ActivateScreen.test.tsx
git commit -m "feat(activation): four-screen ActivateScreen (home/activate/no-code/used)"
```

---

### Task 4: Reactive App routing

**Files:**
- Modify: `packages/client/activation/src/App.tsx`
- Modify: `packages/client/activation/src/main.tsx`
- Test: `packages/client/activation/src/App.test.tsx` (new)

**Interfaces:**
- Consumes: `pathname` (Task 1); `makeActivationModel`/`ActivateScreen` (Tasks 2–3).

- [ ] **Step 1: Write the failing test**

```tsx
// @vitest-environment jsdom
import { context } from '@reatom/core'
import { render, screen } from '@testing-library/react'
import { beforeEach, describe, expect, it } from 'vitest'

import { App } from './App'
import { pathname, search } from './model/router'

beforeEach(() => context.reset())

describe('App routing', () => {
  it('renders the HOME login card at the board root (no token)', () => {
    window.history.replaceState(null, '', '/')
    pathname.set('/')
    search.set('')

    render(<App />)

    expect(screen.getByRole('heading', { name: 'Вход в myboard' })).toBeInTheDocument()
  })

  it('renders the ACTIVATE card when a token is present', () => {
    window.history.replaceState(null, '', '/activate?token=abc')
    pathname.set('/activate')
    search.set('?token=abc')

    render(<App />)

    expect(screen.getByRole('heading', { name: 'Активация устройства' })).toBeInTheDocument()
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm --filter client exec vitest run activation/src/App.test.tsx`
Expected: FAIL — current `App` reads `location.pathname` once (non-reactive) and there is no `pathname` import wiring; the ACTIVATE heading differs.

- [ ] **Step 3: Rewrite `App.tsx`**

```tsx
import { reatomMemo } from 'widget-sdk/reatom/reatom-memo'

import { pathname } from './model/router'
import { ActivateScreen } from './ui/ActivateScreen'
import { AddDeviceScreen } from './ui/AddDeviceScreen'

export const App = reatomMemo(() => {
  const path = pathname()

  if (path === '/add-device') {
    return <AddDeviceScreen />
  }

  return <ActivateScreen />
}, 'App')
```

- [ ] **Step 4: Wire `initRouter` in `main.tsx`**

Add the import and call it right after `initTheme()`:

```tsx
import { initRouter } from './model/router'
```

```tsx
initTheme()
initRouter()
```

- [ ] **Step 5: Run test to verify it passes**

Run: `pnpm --filter client exec vitest run activation/src/App.test.tsx`
Expected: PASS (2 tests).

- [ ] **Step 6: Commit**

```bash
git add packages/client/activation/src/App.tsx packages/client/activation/src/App.test.tsx packages/client/activation/src/main.tsx
git commit -m "feat(activation): route App reactively off the router pathname"
```

---

### Task 5: add-device model opens directly to the scanner

**Files:**
- Modify: `packages/client/activation/src/model/add-device-model.ts`
- Test: `packages/client/activation/src/model/add-device-model.test.ts`

**Interfaces:**
- Produces: `AddDeviceDeps.scan: boolean` (default from `?scan=1`); initial `mode` = `scanning` when `scan`, else `choose`.

- [ ] **Step 1: Write the failing test**

Add to `add-device-model.test.ts`:

```ts
describe('initial mode', () => {
  it('starts in scanning mode when scan is requested', () => {
    const model = createAddDeviceModel({
      currentOrigin: CURRENT_ORIGIN,
      scan: true,
      http: makeScriptedHttp({}).http,
    })
    expect(model.mode()).toBe('scanning')
  })

  it('starts in choose mode by default', () => {
    const model = createAddDeviceModel({
      currentOrigin: CURRENT_ORIGIN,
      http: makeScriptedHttp({}).http,
    })
    expect(model.mode()).toBe('choose')
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm --filter client exec vitest run activation/src/model/add-device-model.test.ts`
Expected: FAIL — `scan` is not an accepted dep; TS error / first test fails.

- [ ] **Step 3: Edit the model**

In `add-device-model.ts`, add to `AddDeviceDeps` (next to `token`):

```ts
  // True when the activation card routed here via `/add-device?scan=1` to open
  // the camera straight away, skipping the `choose` screen and its redundant
  // second "Сканировать QR-код" tap.
  scan: boolean
```

Add a reader next to `readTokenFromLocation`:

```ts
function readScanFromLocation(): boolean {
  if (typeof location === 'undefined') return false
  return new URLSearchParams(location.search).get('scan') === '1'
}
```

In `createAddDeviceModel`'s `deps`, add:

```ts
    scan: overrides.scan ?? readScanFromLocation(),
```

Change the `mode` atom initial value:

```ts
  const mode = atom<AddDeviceMode>(deps.scan ? 'scanning' : 'choose', 'addDevice.mode')
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm --filter client exec vitest run activation/src/model/add-device-model.test.ts`
Expected: PASS (all tests, including the 2 new).

- [ ] **Step 5: Commit**

```bash
git add packages/client/activation/src/model/add-device-model.ts packages/client/activation/src/model/add-device-model.test.ts
git commit -m "feat(activation): add-device opens directly to the scanner on ?scan=1"
```

---

### Task 6: Full-screen scanner overlay + close

**Files:**
- Modify: `packages/client/activation/src/ui/AddDeviceScreen.tsx`
- Modify: `packages/client/activation/src/ui/AddDeviceScreen.module.css`

**Interfaces:**
- Consumes: `navigateInApp` (Task 1); the add-device model's `?scan=1` initial mode (Task 5).

**Note on testing:** `useZxing` eagerly loads a barcode-detector wasm engine that crashes under jsdom, so the existing `AddDeviceScreen.test.tsx` never renders the scanner (it only covers the paste path in `choose` mode). This task is presentational + wiring; it is verified by the unchanged paste test still passing, `pnpm typecheck`, and the manual/e2e smoke in Tasks 7–8. Do **not** add a jsdom test that mounts the scanner.

- [ ] **Step 1: Replace the inline `Scanner` with a full-screen `ScannerOverlay`**

In `AddDeviceScreen.tsx`:

Add the router import:

```ts
import { navigateInApp } from '../model/router'
```

Replace the `Scanner` component (the `function Scanner(...)` block and its `ScannerProps` type) with:

```tsx
type ScannerOverlayProps = {
  onDecode: (rawValue: string) => void
  onCameraError: () => void
  onClose: () => void
}

// Full-screen camera overlay from Activate.dc.html. A separate component (not a
// branch inside AddDeviceScreen) so `useZxing` — and the wasm barcode engine it
// eagerly loads — only mounts once the user actually reaches the scanner.
function ScannerOverlay({ onDecode, onCameraError, onClose }: ScannerOverlayProps) {
  const { ref: videoRef } = useZxing({
    onDecodeResult: (result) => onDecode(result.rawValue),
    onError: onCameraError,
  })

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-label="Сканирование QR-кода"
      className={styles.scannerOverlay}
    >
      <video ref={videoRef} muted playsInline className={styles.scannerOverlayVideo} />
      <div aria-hidden className={styles.scannerFrame}>
        <div className={`${styles.scannerCorner} ${styles.scannerCornerTl}`} />
        <div className={`${styles.scannerCorner} ${styles.scannerCornerTr}`} />
        <div className={`${styles.scannerCorner} ${styles.scannerCornerBl}`} />
        <div className={`${styles.scannerCorner} ${styles.scannerCornerBr}`} />
      </div>
      <div className={styles.scannerTopBar}>
        <div className={styles.scannerTitle}>Сканирование QR-кода</div>
        <button
          type="button"
          onClick={onClose}
          aria-label="Закрыть сканер"
          className={styles.scannerClose}
        >
          <X size={17} strokeWidth={2.2} aria-hidden />
        </button>
      </div>
      <p className={styles.scannerOverlayHint}>Наведите камеру на QR-код активации</p>
    </div>
  )
}
```

- [ ] **Step 2: Add close wiring + render the overlay full-screen**

Inside the `AddDeviceScreen` component body, after `const [ceremonyPending, setCeremonyPending] = useState(false)` add:

```tsx
  // True when this screen mounted straight into scanning (activation card →
  // /add-device?scan=1). Its close ✕ returns to the activation card; a scanner
  // entered from the add-device `choose` screen returns to `choose` instead.
  const [enteredScanDirectly] = useState(() => model.mode() === 'scanning')

  function closeScanner() {
    if (enteredScanDirectly) {
      if (typeof window !== 'undefined' && window.history.length > 1) {
        window.history.back()
      } else {
        navigateInApp('/activate')
      }
      return
    }
    goToChoose()
  }
```

Then, just before the main `return (` of the component, add an early return so the overlay covers the whole viewport (replacing the old in-card `scanning && !cameraDenied` branch):

```tsx
  if (scanning && !cameraDenied) {
    return (
      <ScannerOverlay
        onDecode={handleDecode}
        onCameraError={handleCameraError}
        onClose={closeScanner}
      />
    )
  }
```

Remove the old in-card scanner branch:

```tsx
          {scanning && !cameraDenied ? (
            <Scanner onDecode={handleDecode} onCameraError={handleCameraError} />
          ) : null}
```

- [ ] **Step 3: Swap the CSS**

In `AddDeviceScreen.module.css`, remove the now-unused inline-scanner rules (`.scannerViewport`, `.scannerVideo`, `.scannerLine`, and the `.scanHeading`/`.scannerHint` used only by the old `Scanner`), and add the overlay rules. Keep the corner rules but ensure they read as below (white 3px brackets on the dark overlay):

```css
.scannerOverlay {
  position: fixed;
  inset: 0;
  z-index: 60;
  display: flex;
  align-items: center;
  justify-content: center;
  overflow: hidden;
  background: #000;
}

.scannerOverlayVideo {
  position: absolute;
  inset: 0;
  width: 100%;
  height: 100%;
  object-fit: cover;
}

.scannerFrame {
  position: relative;
  width: 250px;
  height: 250px;
  border-radius: 20px;
  box-shadow: 0 0 0 9999px rgba(0, 0, 0, 0.5);
}

.scannerCorner {
  position: absolute;
  width: 34px;
  height: 34px;
}
.scannerCornerTl {
  top: -2px;
  left: -2px;
  border-top: 3px solid #fff;
  border-left: 3px solid #fff;
  border-top-left-radius: 16px;
}
.scannerCornerTr {
  top: -2px;
  right: -2px;
  border-top: 3px solid #fff;
  border-right: 3px solid #fff;
  border-top-right-radius: 16px;
}
.scannerCornerBl {
  bottom: -2px;
  left: -2px;
  border-bottom: 3px solid #fff;
  border-left: 3px solid #fff;
  border-bottom-left-radius: 16px;
}
.scannerCornerBr {
  bottom: -2px;
  right: -2px;
  border-bottom: 3px solid #fff;
  border-right: 3px solid #fff;
  border-bottom-right-radius: 16px;
}

.scannerTopBar {
  position: absolute;
  top: 0;
  left: 0;
  right: 0;
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 22px 20px;
}
.scannerTitle {
  font-size: 14.5px;
  font-weight: 600;
  color: #fff;
}
.scannerClose {
  display: flex;
  width: 36px;
  height: 36px;
  align-items: center;
  justify-content: center;
  border: none;
  border-radius: 999px;
  background: rgba(255, 255, 255, 0.14);
  color: #fff;
  cursor: pointer;
}

.scannerOverlayHint {
  position: absolute;
  bottom: 56px;
  left: 24px;
  right: 24px;
  margin: 0;
  text-align: center;
  font-size: 14px;
  line-height: 1.5;
  font-weight: 500;
  color: rgba(255, 255, 255, 0.85);
  text-wrap: pretty;
}
```

If any removed class (`.scannerCornerTl` etc.) already existed with different values, replace it with the version above (search the file first so no duplicate selectors remain).

- [ ] **Step 4: Verify build + existing tests**

Run: `pnpm --filter client exec vitest run activation/src/ui/AddDeviceScreen.test.tsx`
Expected: PASS (the paste test still renders `choose` mode, unaffected).

Run: `pnpm --filter client exec tsc -p tsconfig.json --noEmit` (or `pnpm typecheck` from root)
Expected: no type errors in the activation files.

- [ ] **Step 5: Commit**

```bash
git add packages/client/activation/src/ui/AddDeviceScreen.tsx packages/client/activation/src/ui/AddDeviceScreen.module.css
git commit -m "feat(activation): full-screen QR scanner overlay with close affordance"
```

---

### Task 7: e2e — copy update, used screen, HOME login

**Files:**
- Modify: `packages/client/e2e/pages/ActivatePage.ts`
- Modify: `packages/client/e2e/auth-activation.spec.ts`

**Interfaces:**
- Consumes: the new copy/screens (Tasks 2–4); `seedInvite`, `enableVirtualAuthenticator` (existing e2e support).

**Note:** Running these specs needs a reachable Valkey and `ALLOW_TEST_DB_RESET=1` (`pnpm test:e2e`, or `pnpm test:e2e:docker`). If that infra is not available in this environment, still make the edits and run `pnpm --filter client exec tsc` over the e2e project so the specs typecheck; flag that the suite must be run in CI / a docker run.

- [ ] **Step 1: Update the `ActivatePage` page object**

Replace the button locators (copy changed from "ключ доступа" → "passkey") and add the new affordances:

```ts
import type { Locator, Page } from '@playwright/test'

export class ActivatePage {
  readonly nameInput: Locator
  readonly createPasskeyButton: Locator
  readonly signInButton: Locator
  readonly scanButton: Locator
  readonly homeHeading: Locator
  readonly usedHeading: Locator
  readonly errorText: Locator

  constructor(readonly page: Page) {
    this.nameInput = page.getByLabel('Ваше имя')
    this.createPasskeyButton = page.getByRole('button', { name: /Создать passkey/ })
    this.signInButton = page.getByRole('button', { name: /Войти с passkey/ })
    this.scanButton = page.getByRole('button', { name: /Сканировать QR-код/ })
    this.homeHeading = page.getByRole('heading', { name: 'Вход в myboard' })
    this.usedHeading = page.getByRole('heading', { name: 'Приглашение уже использовано' })
    this.errorText = page.locator('.text-destructive')
  }

  async gotoActivate(token: string): Promise<void> {
    await this.page.goto(`/activate?token=${token}`)
  }

  /** The login landing (no invite token). */
  async gotoHome(): Promise<void> {
    await this.page.goto('/activate')
  }

  async fillName(name: string): Promise<void> {
    await this.nameInput.click()
    await this.nameInput.pressSequentially(name)
  }

  async submitRegister(): Promise<void> {
    await this.createPasskeyButton.click()
  }

  async submitLogin(): Promise<void> {
    await this.signInButton.click()
  }

  /** Waits for the successful-registration/login redirect back to the board root. */
  async waitForBoardRedirect(): Promise<void> {
    await this.page.waitForURL('/')
  }
}
```

- [ ] **Step 2: Update the spent-invite assertion in `auth-activation.spec.ts`**

Replace the final block (from `// The activation screen reflects the same spent-invite state ...` to the end of the test) with:

```ts
  // The activation screen reflects the same spent-invite state by showing the
  // dedicated "Приглашение уже использовано" screen with a login affordance
  // instead of the registration form.
  await activate.gotoActivate(token)
  await activate.fillName('Second Attempt')
  await activate.submitRegister()

  await expect(activate.usedHeading).toBeVisible()
  await expect(activate.signInButton).toBeVisible()
  await expect(activate.createPasskeyButton).toHaveCount(0)
})
```

- [ ] **Step 3: Add the HOME-login test**

Append to `auth-activation.spec.ts`:

```ts
test('login landing signs in with an existing passkey after logout', async ({ page, request }) => {
  const { token } = await seedInvite(request)
  await enableVirtualAuthenticator(page)

  const activate = new ActivatePage(page)

  // Register a passkey (this stores the credential hint in localStorage).
  await activate.gotoActivate(token)
  await activate.fillName('Returning User')
  await activate.submitRegister()
  await activate.waitForBoardRedirect()

  // Log out: the server session is cleared, but the credential + hint remain on
  // this device.
  const logout = await page.request.post('/api/auth/logout', {
    headers: { 'X-Requested-With': 'MyBoard' },
  })
  expect(logout.status()).toBe(204)

  // The login landing (no token) offers passkey sign-in, not registration.
  await activate.gotoHome()
  await expect(activate.homeHeading).toBeVisible()
  await expect(activate.createPasskeyButton).toHaveCount(0)

  await activate.submitLogin()
  await activate.waitForBoardRedirect()
  expect(new URL(page.url()).pathname).toBe('/')

  const session = await page.request.get('/api/auth/session')
  expect(session.status()).toBe(200)
})
```

- [ ] **Step 4: Run (or typecheck) the specs**

If Valkey is available: `ALLOW_TEST_DB_RESET=1 pnpm test:e2e` (or `pnpm test:e2e:docker`), filtered to `auth-activation.spec.ts`.
Otherwise: `pnpm --filter client exec tsc -p tsconfig.json --noEmit` and flag that the suite must run in CI.
Expected: the invite-activation test and the new login-landing test pass; spent-invite now asserts the used screen.

- [ ] **Step 5: Commit**

```bash
git add packages/client/e2e/pages/ActivatePage.ts packages/client/e2e/auth-activation.spec.ts
git commit -m "test(activation): e2e for used screen and login-landing sign-in"
```

---

### Task 8: Integration verification

**Files:** none (verification only; commit only if a fix is required).

- [ ] **Step 1: Run the client unit/component suite**

Run: `pnpm --filter client test`
Expected: all activation tests green (router, activation-model, ActivateScreen, App, add-device-model, AddDeviceScreen).

- [ ] **Step 2: Typecheck + lint the workspace**

Run: `pnpm typecheck`
Run: `pnpm lint`
Expected: no errors. Fix any surfaced issue in the owning file and re-run.

- [ ] **Step 3: Manual smoke (use the `/run` or `verify` skill)**

Start the activation app (`pnpm dev` and open the `/activate/` dev URL) and confirm each state:
- `/activate` (no token) → **HOME** "Вход в myboard", with "Войти с passkey" + "Сканировать QR-код".
- `/activate?token=` (empty) → **NO-CODE** "Нужен код приглашения".
- `/activate?token=abc` → **ACTIVATE** "Активация устройства" with the name field.
- On ACTIVATE, "Сканировать QR-код" navigates to `/add-device` with the camera opening directly (no `choose` step) and the ✕ returns to the activation card **without a full reload**.
- The ACTIVATE cross-link "Войти с passkey" switches to HOME in place.
Confirm theme toggle (light/dark/system) still restyles the card.

- [ ] **Step 4: Final commit (only if fixes were made)**

```bash
git add -A
git commit -m "fix(activation): address integration verification findings"
```

---

## Self-Review

**Spec coverage:**
- Four-screen model (home/activate/no-code/used) → Tasks 2–3. ✅
- HOME login landing (fixes `/` no-token dead end) → Tasks 2–4, verified in Task 7's login-landing test. ✅
- `invite_consumed → activate-used` runtime transition → Task 2. ✅
- Reactive in-app router, hard nav to `/` untouched → Tasks 1, 4. ✅
- Scanner reuse via `/add-device?scan=1`, opens camera directly → Tasks 3, 5. ✅
- Full-screen scanner overlay + close per entry point → Task 6. ✅
- Token param `?token=`, `make*` rename, tokens/theme reuse → Tasks 2–3 (Global Constraints). ✅
- Tests (model, router, component, App, e2e) → Tasks 1–7. ✅

**Placeholder scan:** No TBD/TODO; every code step carries full content. The one deliberate no-unit-test note (Task 6) is justified by the documented `useZxing`/jsdom incompatibility and is covered by typecheck + e2e/manual.

**Type consistency:** `screen`/`ActivationScreen` used identically across Tasks 2–4; `makeActivationModel` renamed once and consumed by Tasks 3–4; `navigateInApp(path)` signature identical across Tasks 1, 3, 6; `AddDeviceDeps.scan: boolean` consumed by Task 5 only. Copy strings match `Activate.dc.html` verbatim.
