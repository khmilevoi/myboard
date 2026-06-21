# myboard UI Redesign Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Re-skin myboard in the "Soft Clay" design system with light/dark/system themes, integrate `lucide-react`, and propagate the active theme into widget iframes live over the bridge.

**Architecture:** A single shared `tokens.css` (CSS variables, imported by host and every widget) is the only source of color/shape/font. A Reatom theme model (`themeMode` + `systemPrefersDark` → computed `resolvedTheme`) applies `data-theme` to `<html>`, persists the mode via an errore-wrapped localStorage module, and pushes a new `theme-change` bridge message into each iframe so widgets re-theme without reloading. All chrome (header, theme toggle, add-widget menu, cards, overlay, states) is rebuilt with lucide icons.

**Tech Stack:** React 19, Reatom v1000 (`@reatom/core`, `@reatom/react`), react-grid-layout v2, lucide-react, errore (errors-as-values), CSS Modules + global tokens, self-hosted `@fontsource-variable` fonts, Vite 8, Vitest 4 + Testing Library.

**Design spec:** [docs/superpowers/specs/2026-06-16-myboard-redesign-design.md](../specs/2026-06-16-myboard-redesign-design.md)

**Conventions for every task:**

- UI strings and `aria-label`s stay in **English** (matches the current codebase and existing tests). Translating UI text is out of scope.
- Targeted test run: `pnpm test <path>` (this forwards to `vitest run <path>`).
- Typecheck: `pnpm typecheck`. Full build: `pnpm build`. Full test suite: `pnpm test`.
- Commit after each task. Keep commits focused.

---

## Task 1: Fonts, theme types, design tokens, global base

**Files:**

- Modify: `package.json` (add font deps)
- Create: `src/shared/theme/types.ts`
- Create: `src/shared/theme/tokens.css`
- Modify: `src/app/global.css`

- [ ] **Step 1: Install self-hosted variable fonts**

Run: `pnpm add @fontsource-variable/fraunces @fontsource-variable/nunito`
Expected: both packages added under `dependencies` in `package.json`.

- [ ] **Step 2: Create the theme types**

Create `src/shared/theme/types.ts`:

```ts
/** What the user picks. */
export type ThemeMode = 'light' | 'dark' | 'system'

/** What actually gets applied and sent to widgets. */
export type ResolvedTheme = 'light' | 'dark'
```

- [ ] **Step 3: Create the shared design tokens**

Create `src/shared/theme/tokens.css`:

```css
@import '@fontsource-variable/fraunces';
@import '@fontsource-variable/nunito';

:root,
:root[data-theme='light'] {
  color-scheme: light;
  --bg: #efe6d8;
  --bg-grad: radial-gradient(130% 100% at 85% -10%, #f6efe2, #ebe0d0);
  --surface: #faf5ec;
  --surface-inset: #e4d8c5;
  --text: #463726;
  --text-dim: #8a755c;
  --accent: #cf7b53;
  --accent-contrast: #ffffff;
  --accent-2: #3f5d4a;
  --shadow-dark: #d8c9b2;
  --shadow-light: #fffdf6;
  --border: rgba(70, 55, 38, 0.1);
  --skeleton: rgba(70, 55, 38, 0.08);
}

:root[data-theme='dark'] {
  color-scheme: dark;
  --bg: #0d0e11;
  --bg-grad: radial-gradient(130% 100% at 85% -10%, #1a1c20, #0d0e11);
  --surface: #1b1d22;
  --surface-inset: #15161a;
  --text: #e9e4d9;
  --text-dim: #9a9488;
  --accent: #e08a5f;
  --accent-contrast: #15161a;
  --accent-2: #a3c79a;
  --shadow-dark: #060708;
  --shadow-light: #24262d;
  --border: rgba(233, 228, 217, 0.08);
  --skeleton: rgba(233, 228, 217, 0.06);
}

:root {
  --radius-sm: 8px;
  --radius-md: 16px;
  --radius-lg: 18px;
  --radius-xl: 22px;
  --radius-pill: 999px;
  --font-display: 'Fraunces Variable', Georgia, serif;
  --font-ui: 'Nunito Variable', system-ui, sans-serif;
  --shadow-raised: 5px 5px 13px var(--shadow-dark), -5px -5px 13px var(--shadow-light);
  --shadow-raised-sm: 3px 3px 8px var(--shadow-dark), -3px -3px 8px var(--shadow-light);
  --shadow-pressed: inset 2px 2px 5px var(--shadow-dark), inset -2px -2px 5px var(--shadow-light);
  --shadow-accent: 0 4px 14px color-mix(in srgb, var(--accent) 30%, transparent);
  --ease: cubic-bezier(0.22, 1, 0.36, 1);
}
```

- [ ] **Step 4: Rewrite `src/app/global.css` to use tokens + base theming**

Replace the entire contents of `src/app/global.css` with:

```css
@import '../shared/theme/tokens.css';
@import 'react-grid-layout/css/styles.css';
@import 'react-resizable/css/styles.css';

* {
  box-sizing: border-box;
}

html,
body,
#root {
  margin: 0;
  height: 100%;
}

body {
  background-color: var(--bg);
  background-image: var(--bg-grad);
  background-attachment: fixed;
  color: var(--text);
  font-family: var(--font-ui);
  transition:
    background-color 0.45s var(--ease),
    color 0.45s var(--ease);
}

.react-grid-item.react-grid-placeholder {
  background: var(--accent) !important;
  opacity: 0.18;
  border-radius: var(--radius-lg);
}

/* View Transitions: circular reveal of the new theme from the toggle click. */
::view-transition-new(root) {
  animation: themeReveal 0.45s var(--ease);
}
@keyframes themeReveal {
  from {
    clip-path: circle(0 at var(--vt-x, 50%) var(--vt-y, 0));
  }
  to {
    clip-path: circle(150vmax at var(--vt-x, 50%) var(--vt-y, 0));
  }
}

@media (prefers-reduced-motion: reduce) {
  *,
  *::before,
  *::after {
    animation-duration: 0.001ms !important;
    animation-iteration-count: 1 !important;
    transition-duration: 0.001ms !important;
  }
}
```

- [ ] **Step 5: Verify the build resolves fonts and CSS imports**

Run: `pnpm build`
Expected: build completes with no errors (host + widget entries emitted). This confirms the `@fontsource-variable/*` and tokens imports resolve.

- [ ] **Step 6: Commit**

```bash
git add package.json pnpm-lock.yaml src/shared/theme/types.ts src/shared/theme/tokens.css src/app/global.css
git commit -m "feat(theme): add Soft Clay design tokens, theme types and self-hosted fonts"
```

---

## Task 2: Theme storage (errore)

**Files:**

- Create: `src/theme/theme-storage.ts`
- Test: `src/theme/theme-storage.test.ts`

- [ ] **Step 1: Write the failing test**

Create `src/theme/theme-storage.test.ts`:

```ts
// @vitest-environment jsdom
import { afterEach, describe, expect, it } from 'vitest'
import { loadThemeMode, saveThemeMode, THEME_STORAGE_KEY, ThemeStorageError } from './theme-storage'

afterEach(() => localStorage.clear())

describe('theme storage', () => {
  it('returns null when nothing is stored', () => {
    expect(loadThemeMode()).toBeNull()
  })

  it('round-trips a theme mode', () => {
    expect(saveThemeMode('dark')).toBeUndefined()
    expect(loadThemeMode()).toBe('dark')
  })

  it('returns ThemeStorageError when the stored value is not a theme mode', () => {
    localStorage.setItem(THEME_STORAGE_KEY, 'purple')
    expect(loadThemeMode()).toBeInstanceOf(ThemeStorageError)
  })
})
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `pnpm test src/theme/theme-storage.test.ts`
Expected: FAIL — cannot find module `./theme-storage`.

- [ ] **Step 3: Implement the storage module**

Create `src/theme/theme-storage.ts`:

```ts
import * as errore from 'errore'
import type { ThemeMode } from '../shared/theme/types'

export const THEME_STORAGE_KEY = 'myboard.theme'

export class ThemeStorageError extends errore.createTaggedError({
  name: 'ThemeStorageError',
  message: 'Theme storage operation failed: $reason',
}) {}

const MODES: ThemeMode[] = ['light', 'dark', 'system']

function isThemeMode(value: unknown): value is ThemeMode {
  return typeof value === 'string' && (MODES as string[]).includes(value)
}

export function loadThemeMode(): ThemeStorageError | ThemeMode | null {
  const raw = errore.try({
    try: () => localStorage.getItem(THEME_STORAGE_KEY),
    catch: (cause) => new ThemeStorageError({ reason: 'read failed', cause }),
  })
  if (raw instanceof ThemeStorageError) return raw
  if (raw === null) return null
  if (!isThemeMode(raw))
    return new ThemeStorageError({ reason: 'stored value is not a theme mode' })
  return raw
}

export function saveThemeMode(mode: ThemeMode): ThemeStorageError | void {
  const result = errore.try({
    try: () => localStorage.setItem(THEME_STORAGE_KEY, mode),
    catch: (cause) => new ThemeStorageError({ reason: 'write failed', cause }),
  })
  if (result instanceof ThemeStorageError) return result
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `pnpm test src/theme/theme-storage.test.ts`
Expected: PASS (3 tests).

- [ ] **Step 5: Commit**

```bash
git add src/theme/theme-storage.ts src/theme/theme-storage.test.ts
git commit -m "feat(theme): errore-wrapped localStorage for theme mode"
```

---

## Task 3: Theme resolution + Reatom model + jsdom matchMedia mock

**Files:**

- Create: `src/theme/resolve-theme.ts`
- Test: `src/theme/resolve-theme.test.ts`
- Create: `src/theme/theme-model.ts`
- Test: `src/theme/theme-model.test.ts`
- Modify: `src/vitest.setup.ts`

- [ ] **Step 1: Write the failing pure-logic test**

Create `src/theme/resolve-theme.test.ts`:

```ts
import { describe, expect, it } from 'vitest'
import { resolveTheme } from './resolve-theme'

describe('resolveTheme', () => {
  it('returns the explicit mode when not system', () => {
    expect(resolveTheme('light', true)).toBe('light')
    expect(resolveTheme('dark', false)).toBe('dark')
  })

  it('follows the system preference when mode is system', () => {
    expect(resolveTheme('system', true)).toBe('dark')
    expect(resolveTheme('system', false)).toBe('light')
  })
})
```

- [ ] **Step 2: Run it to verify it fails**

Run: `pnpm test src/theme/resolve-theme.test.ts`
Expected: FAIL — cannot find module `./resolve-theme`.

- [ ] **Step 3: Implement the pure resolver**

Create `src/theme/resolve-theme.ts`:

```ts
import type { ResolvedTheme, ThemeMode } from '../shared/theme/types'

export function resolveTheme(mode: ThemeMode, prefersDark: boolean): ResolvedTheme {
  if (mode === 'system') return prefersDark ? 'dark' : 'light'
  return mode
}
```

- [ ] **Step 4: Run it to verify it passes**

Run: `pnpm test src/theme/resolve-theme.test.ts`
Expected: PASS (2 tests).

- [ ] **Step 5: Add a matchMedia mock to the shared vitest setup**

Modify `src/vitest.setup.ts` — append after the existing `ResizeObserver` block:

```ts
// jsdom lacks matchMedia; the theme model reads prefers-color-scheme.
if (typeof window !== 'undefined' && !window.matchMedia) {
  window.matchMedia = ((query: string) => ({
    matches: false,
    media: query,
    onchange: null,
    addEventListener() {},
    removeEventListener() {},
    addListener() {},
    removeListener() {},
    dispatchEvent() {
      return false
    },
  })) as unknown as typeof window.matchMedia
}
```

- [ ] **Step 6: Write the failing theme-model test**

Create `src/theme/theme-model.test.ts`:

```ts
// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { context } from '@reatom/core'
import { initTheme, systemPrefersDark, themeMode } from './theme-model'
import { THEME_STORAGE_KEY } from './theme-storage'

function mockMatchMedia(matches: boolean) {
  window.matchMedia = ((query: string) => ({
    matches,
    media: query,
    onchange: null,
    addEventListener() {},
    removeEventListener() {},
    addListener() {},
    removeListener() {},
    dispatchEvent() {
      return false
    },
  })) as unknown as typeof window.matchMedia
}

beforeEach(() => {
  context.reset()
  localStorage.clear()
})
afterEach(() => localStorage.clear())

describe('theme model init', () => {
  it('reads the persisted mode', () => {
    localStorage.setItem(THEME_STORAGE_KEY, 'dark')
    mockMatchMedia(false)
    initTheme()
    expect(themeMode()).toBe('dark')
  })

  it('reflects the system preference for prefers-color-scheme: dark', () => {
    mockMatchMedia(true)
    initTheme()
    expect(systemPrefersDark()).toBe(true)
  })

  it('applies data-theme to <html>', () => {
    localStorage.setItem(THEME_STORAGE_KEY, 'dark')
    mockMatchMedia(false)
    initTheme()
    expect(document.documentElement.dataset.theme).toBe('dark')
  })
})
```

- [ ] **Step 7: Run it to verify it fails**

Run: `pnpm test src/theme/theme-model.test.ts`
Expected: FAIL — cannot find module `./theme-model`.

- [ ] **Step 8: Implement the theme model**

Create `src/theme/theme-model.ts`:

```ts
import { atom, computed, effect, wrap } from '@reatom/core'
import type { ResolvedTheme, ThemeMode } from '../shared/theme/types'
import { resolveTheme } from './resolve-theme'
import { loadThemeMode, saveThemeMode } from './theme-storage'

export const themeMode = atom<ThemeMode>('system', 'theme.mode')
export const systemPrefersDark = atom(false, 'theme.systemPrefersDark')

export const resolvedTheme = computed(
  () => resolveTheme(themeMode(), systemPrefersDark()),
  'theme.resolved',
)

const themeInitialized = atom(false, 'theme.initialized')

function applyTheme(theme: ResolvedTheme) {
  if (typeof document !== 'undefined') {
    document.documentElement.dataset.theme = theme
  }
}

export function initTheme() {
  const stored = loadThemeMode()
  if (stored instanceof Error) {
    console.warn('Theme load failed:', stored.message)
  } else if (stored !== null) {
    themeMode.set(stored)
  }

  if (typeof window !== 'undefined' && typeof window.matchMedia === 'function') {
    const mq = window.matchMedia('(prefers-color-scheme: dark)')
    systemPrefersDark.set(mq.matches)
    mq.addEventListener(
      'change',
      wrap((event: MediaQueryListEvent) => systemPrefersDark.set(event.matches)),
    )
  }

  // Apply synchronously so first paint has the right theme (no reliance on effect timing).
  applyTheme(resolveTheme(themeMode(), systemPrefersDark()))
  themeInitialized.set(true)
}

// Keep <html data-theme> in sync with the resolved theme.
effect(() => {
  applyTheme(resolvedTheme())
}, 'theme.apply')

// Persist the user's mode after init (mirrors board-model persistence).
effect(() => {
  if (!themeInitialized()) return
  const result = saveThemeMode(themeMode())
  if (result instanceof Error) console.warn('Theme save failed:', result.message)
}, 'theme.persist')
```

- [ ] **Step 9: Run it to verify it passes**

Run: `pnpm test src/theme/theme-model.test.ts`
Expected: PASS (3 tests).

- [ ] **Step 10: Commit**

```bash
git add src/theme/resolve-theme.ts src/theme/resolve-theme.test.ts src/theme/theme-model.ts src/theme/theme-model.test.ts src/vitest.setup.ts
git commit -m "feat(theme): Reatom theme model (light/dark/system) with matchMedia"
```

---

## Task 4: Bridge protocol — init.theme + theme-change message

**Files:**

- Modify: `src/shared/widget-bridge/messages.ts`
- Modify: `src/shared/widget-bridge/parse.ts`
- Test: `src/shared/widget-bridge/parse.test.ts`

- [ ] **Step 1: Update the message schema**

Replace the contents of `src/shared/widget-bridge/messages.ts` with:

```ts
import type { ResolvedTheme } from '../theme/types'

export type WidgetMode = 'small' | 'large'

// host -> widget
export type InitMessage = {
  type: 'init'
  instanceId: string
  mode: WidgetMode
  theme: ResolvedTheme
}
export type ModeChangeMessage = { type: 'mode-change'; mode: WidgetMode }
export type ThemeChangeMessage = { type: 'theme-change'; theme: ResolvedTheme }
export type PingMessage = { type: 'ping' }
export type HostMessage = InitMessage | ModeChangeMessage | ThemeChangeMessage | PingMessage

// widget -> host
export type ReadyMessage = { type: 'ready'; instanceId: string }
export type RequestFullscreenMessage = { type: 'request-fullscreen'; instanceId: string }
export type RequestCloseMessage = { type: 'request-close'; instanceId: string }
export type WidgetErrorMessage = { type: 'error'; message: string; name?: string }
export type PongMessage = { type: 'pong' }
export type WidgetMessage =
  | ReadyMessage
  | RequestFullscreenMessage
  | RequestCloseMessage
  | WidgetErrorMessage
  | PongMessage
```

- [ ] **Step 2: Update the failing parser test**

In `src/shared/widget-bridge/parse.test.ts`, replace the first test and add new ones. The full `describe('parseHostMessage', ...)` block becomes:

```ts
describe('parseHostMessage', () => {
  it('accepts a valid init message and defaults a missing theme to light', () => {
    const result = parseHostMessage({ type: 'init', instanceId: 'a1', mode: 'small' })
    expect(result).toEqual({ type: 'init', instanceId: 'a1', mode: 'small', theme: 'light' })
  })

  it('keeps an explicit theme on init', () => {
    const result = parseHostMessage({
      type: 'init',
      instanceId: 'a1',
      mode: 'small',
      theme: 'dark',
    })
    expect(result).toEqual({ type: 'init', instanceId: 'a1', mode: 'small', theme: 'dark' })
  })

  it('rejects an init message with an invalid theme', () => {
    const result = parseHostMessage({
      type: 'init',
      instanceId: 'a1',
      mode: 'small',
      theme: 'neon',
    })
    expect(result).toBeInstanceOf(BridgeError)
  })

  it('rejects an init message with an invalid mode', () => {
    const result = parseHostMessage({ type: 'init', instanceId: 'a1', mode: 'huge' })
    expect(result).toBeInstanceOf(BridgeError)
  })

  it('accepts a valid theme-change message', () => {
    expect(parseHostMessage({ type: 'theme-change', theme: 'dark' })).toEqual({
      type: 'theme-change',
      theme: 'dark',
    })
  })

  it('rejects a theme-change message with an invalid theme', () => {
    expect(parseHostMessage({ type: 'theme-change', theme: 'beige' })).toBeInstanceOf(BridgeError)
  })

  it('rejects non-object input', () => {
    expect(parseHostMessage(null)).toBeInstanceOf(BridgeError)
    expect(parseHostMessage('init')).toBeInstanceOf(BridgeError)
  })

  it('rejects an unknown type', () => {
    expect(parseHostMessage({ type: 'nope' })).toBeInstanceOf(BridgeError)
  })
})
```

- [ ] **Step 3: Run the test to verify it fails**

Run: `pnpm test src/shared/widget-bridge/parse.test.ts`
Expected: FAIL — `init` result lacks `theme`, and `theme-change` is rejected as unknown type.

- [ ] **Step 4: Implement parser changes**

In `src/shared/widget-bridge/parse.ts`:

Add the `ResolvedTheme` import and an `isTheme` guard near the top (after the existing `isMode` helper):

```ts
import type { HostMessage, WidgetMessage, WidgetMode } from './messages'
import type { ResolvedTheme } from '../theme/types'
```

```ts
function isTheme(value: unknown): value is ResolvedTheme {
  return value === 'light' || value === 'dark'
}
```

Replace the `init` branch inside `parseHostMessage` with:

```ts
if (data.type === 'init') {
  if (typeof data.instanceId !== 'string') {
    return new BridgeError({ reason: 'init.instanceId must be a string' })
  }
  if (!isMode(data.mode)) return new BridgeError({ reason: 'init.mode is invalid' })
  if (data.theme !== undefined && !isTheme(data.theme)) {
    return new BridgeError({ reason: 'init.theme is invalid' })
  }
  const theme: ResolvedTheme = isTheme(data.theme) ? data.theme : 'light'
  return { type: 'init', instanceId: data.instanceId, mode: data.mode, theme }
}
```

Add a new `theme-change` branch immediately after the `mode-change` branch:

```ts
if (data.type === 'theme-change') {
  if (!isTheme(data.theme)) return new BridgeError({ reason: 'theme-change.theme is invalid' })
  return { type: 'theme-change', theme: data.theme }
}
```

- [ ] **Step 5: Run the test to verify it passes**

Run: `pnpm test src/shared/widget-bridge/parse.test.ts`
Expected: PASS (all parseHostMessage + parseWidgetMessage tests).

- [ ] **Step 6: Commit**

```bash
git add src/shared/widget-bridge/messages.ts src/shared/widget-bridge/parse.ts src/shared/widget-bridge/parse.test.ts
git commit -m "feat(bridge): carry theme in init and add theme-change message"
```

---

## Task 5: Widget client SDK — theme + onThemeChange

**Files:**

- Modify: `src/shared/widget-bridge/client.ts`
- Test: `src/shared/widget-bridge/client.test.ts`

- [ ] **Step 1: Update the failing client test**

Replace the contents of `src/shared/widget-bridge/client.test.ts` with:

```ts
// @vitest-environment jsdom
import { describe, expect, it, vi } from 'vitest'
import { createWidgetClient } from './client'
import { HandshakeTimeoutError } from './errors'
import type { ResolvedTheme } from '../theme/types'
import type { WidgetMessage } from './messages'

function sendInit(instanceId: string, mode: 'small' | 'large', theme: ResolvedTheme = 'light') {
  const channel = new MessageChannel()
  const received: WidgetMessage[] = []
  channel.port1.onmessage = (e) => received.push(e.data as WidgetMessage)
  channel.port1.start()
  window.dispatchEvent(
    new MessageEvent('message', {
      data: { type: 'init', instanceId, mode, theme },
      ports: [channel.port2],
    }),
  )
  return { hostPort: channel.port1, received }
}

describe('createWidgetClient', () => {
  it('resolves with instanceId, mode and theme from init and replies ready', async () => {
    const clientPromise = createWidgetClient()
    const { received } = sendInit('inst-1', 'small', 'dark')

    const client = await clientPromise
    if (client instanceof Error) throw client

    expect(client.instanceId).toBe('inst-1')
    expect(client.mode).toBe('small')
    expect(client.theme).toBe('dark')
    await vi.waitFor(() => expect(received).toContainEqual({ type: 'ready', instanceId: 'inst-1' }))
  })

  it('requestFullscreen posts a request-fullscreen message over the port', async () => {
    const clientPromise = createWidgetClient()
    const { received } = sendInit('inst-2', 'small')
    const client = await clientPromise
    if (client instanceof Error) throw client

    client.requestFullscreen()
    await vi.waitFor(() =>
      expect(received).toContainEqual({ type: 'request-fullscreen', instanceId: 'inst-2' }),
    )
  })

  it('notifies onThemeChange subscribers when the host pushes a theme-change', async () => {
    const clientPromise = createWidgetClient()
    const { hostPort } = sendInit('inst-3', 'small', 'light')
    const client = await clientPromise
    if (client instanceof Error) throw client

    const seen: ResolvedTheme[] = []
    client.onThemeChange((theme) => seen.push(theme))
    hostPort.postMessage({ type: 'theme-change', theme: 'dark' })

    await vi.waitFor(() => expect(seen).toContain('dark'))
  })

  it('times out when no init arrives', async () => {
    const result = await createWidgetClient({ timeoutMs: 20 })
    expect(result).toBeInstanceOf(HandshakeTimeoutError)
  })
})
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `pnpm test src/shared/widget-bridge/client.test.ts`
Expected: FAIL — `client.theme` is undefined and `client.onThemeChange` is not a function.

- [ ] **Step 3: Implement client changes**

Replace the contents of `src/shared/widget-bridge/client.ts` with:

```ts
import { BridgeError, HandshakeTimeoutError } from './errors'
import { parseHostMessage } from './parse'
import type { ResolvedTheme } from '../theme/types'
import type { WidgetMessage, WidgetMode } from './messages'

export type WidgetClient = {
  instanceId: string
  mode: WidgetMode
  theme: ResolvedTheme
  requestFullscreen: () => void
  requestClose: () => void
  reportError: (error: Error) => void
  onModeChange: (cb: (mode: WidgetMode) => void) => () => void
  onThemeChange: (cb: (theme: ResolvedTheme) => void) => () => void
}

export type CreateWidgetClientOptions = {
  timeoutMs?: number
  target?: Window
}

export function createWidgetClient(
  options: CreateWidgetClientOptions = {},
): Promise<BridgeError | HandshakeTimeoutError | WidgetClient> {
  const timeoutMs = options.timeoutMs ?? 5000
  const target = options.target ?? window

  return new Promise((resolve) => {
    const modeChangeListeners = new Set<(mode: WidgetMode) => void>()
    const themeChangeListeners = new Set<(theme: ResolvedTheme) => void>()

    const timer = setTimeout(() => {
      target.removeEventListener('message', onWindowMessage)
      resolve(new HandshakeTimeoutError({ instanceId: 'unknown', timeoutMs }))
    }, timeoutMs)

    function onWindowMessage(event: MessageEvent) {
      const parsed = parseHostMessage(event.data)
      if (parsed instanceof Error) return
      if (parsed.type !== 'init') return

      const port = event.ports[0]
      if (!port) {
        clearTimeout(timer)
        target.removeEventListener('message', onWindowMessage)
        resolve(new BridgeError({ reason: 'init message carried no MessagePort' }))
        return
      }

      clearTimeout(timer)
      target.removeEventListener('message', onWindowMessage)

      const { instanceId, mode, theme } = parsed

      port.onmessage = (portEvent: MessageEvent) => {
        const hostMsg = parseHostMessage(portEvent.data)
        if (hostMsg instanceof Error) return
        if (hostMsg.type === 'mode-change') {
          modeChangeListeners.forEach((cb) => cb(hostMsg.mode))
        }
        if (hostMsg.type === 'theme-change') {
          themeChangeListeners.forEach((cb) => cb(hostMsg.theme))
        }
      }
      port.start()

      const send = (message: WidgetMessage) => port.postMessage(message)
      send({ type: 'ready', instanceId })

      resolve({
        instanceId,
        mode,
        theme,
        requestFullscreen: () => send({ type: 'request-fullscreen', instanceId }),
        requestClose: () => send({ type: 'request-close', instanceId }),
        reportError: (error: Error) =>
          send({ type: 'error', message: error.message, name: error.name }),
        onModeChange: (cb) => {
          modeChangeListeners.add(cb)
          return () => modeChangeListeners.delete(cb)
        },
        onThemeChange: (cb) => {
          themeChangeListeners.add(cb)
          return () => themeChangeListeners.delete(cb)
        },
      })
    }

    target.addEventListener('message', onWindowMessage)
  })
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `pnpm test src/shared/widget-bridge/client.test.ts`
Expected: PASS (4 tests).

- [ ] **Step 5: Commit**

```bash
git add src/shared/widget-bridge/client.ts src/shared/widget-bridge/client.test.ts
git commit -m "feat(bridge): widget client exposes theme and onThemeChange"
```

---

## Task 6: WidgetConnection carries theme in init

**Files:**

- Modify: `src/widget-host/widget-connection.ts`
- Test: `src/widget-host/widget-connection.test.ts`
- Test: `tests/bridge-handshake.test.ts`

- [ ] **Step 1: Update the failing connection test**

In `src/widget-host/widget-connection.test.ts`, add `theme: 'light'` to every `createWidgetConnection({ ... })` options object (there are three). For example the first becomes:

```ts
const conn = createWidgetConnection({
  instanceId: 'inst-1',
  mode: 'small',
  targetOrigin: 'http://localhost',
  theme: 'light',
  handlers: {},
})
```

Apply the same `theme: 'light'` addition to the `inst-2` and `inst-3` connections in that file.

- [ ] **Step 2: Run the test to verify it fails**

Run: `pnpm test src/widget-host/widget-connection.test.ts`
Expected: FAIL — TypeScript error: `theme` is missing in the connection options type (and/or type error reported by Vitest).

- [ ] **Step 3: Implement connection changes**

In `src/widget-host/widget-connection.ts`:

Update the imports to include `ResolvedTheme`:

```ts
import { HandshakeTimeoutError, parseWidgetMessage } from '../shared/widget-bridge'
import type {
  HostMessage,
  ResolvedTheme,
  WidgetErrorMessage,
  WidgetMode,
} from '../shared/widget-bridge'
```

Add `theme` to the options type:

```ts
export type CreateWidgetConnectionOptions = {
  instanceId: string
  mode: WidgetMode
  targetOrigin: string
  theme: ResolvedTheme
  handlers: WidgetConnectionHandlers
}
```

Destructure `theme` and include it in the `init` message:

```ts
const { instanceId, mode, targetOrigin, theme, handlers } = options
```

```ts
const init: HostMessage = { type: 'init', instanceId, mode, theme }
```

Note: `ResolvedTheme` is re-exported from `../shared/widget-bridge` because `messages.ts` is barrelled through `index.ts`. To make that re-export available, add this line to `src/shared/widget-bridge/messages.ts` (top, just below the existing `ResolvedTheme` type import):

```ts
export type { ResolvedTheme, ThemeMode } from '../theme/types'
```

- [ ] **Step 4: Update the integration handshake test**

In `tests/bridge-handshake.test.ts`, add `theme: 'light'` to the `createWidgetConnection({ ... })` options:

```ts
const conn = createWidgetConnection({
  instanceId: 'inst-int',
  mode: 'small',
  targetOrigin: '*',
  theme: 'light',
  handlers: { onReady, onRequestFullscreen },
})
```

- [ ] **Step 5: Run both tests to verify they pass**

Run: `pnpm test src/widget-host/widget-connection.test.ts tests/bridge-handshake.test.ts`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add src/widget-host/widget-connection.ts src/widget-host/widget-connection.test.ts tests/bridge-handshake.test.ts src/shared/widget-bridge/messages.ts
git commit -m "feat(bridge): host connection sends resolved theme on init"
```

---

## Task 7: Widget registry icon + Add-widget menu

**Files:**

- Modify: `src/widget-registry/registry.ts`
- Create: `src/board/AddWidgetMenu.tsx`
- Create: `src/board/AddWidgetMenu.module.css`
- Test: `src/board/AddWidgetMenu.test.tsx`

Note: the menu uses React-controlled visibility + absolute positioning (rather than the native Popover API mentioned as an option in the spec) for cross-browser robustness and testability.

- [ ] **Step 1: Add an `icon` field to widget types**

In `src/widget-registry/registry.ts`, add `icon` to the `WidgetType` type and the `clock` entry:

```ts
export type WidgetType = {
  id: string
  title: string
  /** URL of the widget's HTML entry, relative to the app origin. */
  entry: string
  defaultSize: { w: number; h: number }
  /** lucide-react icon name used in the catalog menu. */
  icon: string
}
```

```ts
export const widgetTypes: WidgetType[] = [
  {
    id: 'clock',
    title: 'Clock',
    entry: '/widgets/clock/index.html',
    defaultSize: { w: 3, h: 2 },
    icon: 'Clock',
  },
]
```

- [ ] **Step 2: Write the failing menu test**

Create `src/board/AddWidgetMenu.test.tsx`:

```tsx
// @vitest-environment jsdom
import { beforeEach, describe, expect, it } from 'vitest'
import { context } from '@reatom/core'
import { fireEvent, render, screen } from '@testing-library/react'
import { instances } from '../board-model/board-model'
import { AddWidgetMenu } from './AddWidgetMenu'

beforeEach(() => {
  context.reset()
  localStorage.clear()
})

describe('AddWidgetMenu', () => {
  it('adds a widget when a catalog item is clicked', () => {
    render(<AddWidgetMenu />)
    expect(instances()).toHaveLength(0)
    fireEvent.click(screen.getByRole('button', { name: /add widget/i }))
    fireEvent.click(screen.getByRole('menuitem', { name: /clock/i }))
    expect(instances()).toHaveLength(1)
  })
})
```

- [ ] **Step 3: Run it to verify it fails**

Run: `pnpm test src/board/AddWidgetMenu.test.tsx`
Expected: FAIL — cannot find module `./AddWidgetMenu`.

- [ ] **Step 4: Implement the menu component**

Create `src/board/AddWidgetMenu.tsx`:

```tsx
import { reatomComponent } from '@reatom/react'
import { useState } from 'react'
import { Clock, Plus } from 'lucide-react'
import type { LucideIcon } from 'lucide-react'
import { addInstance } from '../board-model/board-model'
import { widgetTypes } from '../widget-registry/registry'
import styles from './AddWidgetMenu.module.css'

const WIDGET_ICONS: Record<string, LucideIcon> = { Clock }

export const AddWidgetMenu = reatomComponent(() => {
  const [open, setOpen] = useState(false)

  return (
    <div className={styles.wrap}>
      <button
        type="button"
        className={styles.trigger}
        aria-haspopup="menu"
        aria-expanded={open}
        onClick={() => setOpen((value) => !value)}
      >
        <Plus size={16} strokeWidth={2.4} aria-hidden />
        <span>Add widget</span>
      </button>

      {open && (
        <>
          <div className={styles.scrim} onClick={() => setOpen(false)} />
          <ul className={styles.menu} role="menu">
            {widgetTypes.map((type) => {
              const Icon = WIDGET_ICONS[type.icon] ?? Plus
              return (
                <li key={type.id} role="none">
                  <button
                    type="button"
                    role="menuitem"
                    className={styles.item}
                    onClick={() => {
                      addInstance(type.id)
                      setOpen(false)
                    }}
                  >
                    <Icon size={18} strokeWidth={2} aria-hidden />
                    <span>{type.title}</span>
                  </button>
                </li>
              )
            })}
          </ul>
        </>
      )}
    </div>
  )
}, 'AddWidgetMenu')
```

- [ ] **Step 5: Create the menu styles**

Create `src/board/AddWidgetMenu.module.css`:

```css
.wrap {
  position: relative;
}

.trigger {
  display: flex;
  align-items: center;
  gap: 7px;
  height: 36px;
  padding: 0 16px;
  border: 0;
  border-radius: var(--radius-pill);
  background: var(--accent);
  color: var(--accent-contrast);
  font-family: var(--font-ui);
  font-weight: 800;
  font-size: 13px;
  cursor: pointer;
  box-shadow: var(--shadow-accent);
  transition:
    transform 0.15s var(--ease),
    filter 0.15s var(--ease);
}
.trigger:hover {
  transform: translateY(-1px);
  filter: brightness(1.05);
}
.trigger:focus-visible {
  outline: 2px solid var(--accent);
  outline-offset: 2px;
}

.scrim {
  position: fixed;
  inset: 0;
  z-index: 20;
}

.menu {
  position: absolute;
  right: 0;
  top: calc(100% + 8px);
  z-index: 30;
  min-width: 200px;
  margin: 0;
  padding: 6px;
  list-style: none;
  border-radius: var(--radius-md);
  background: var(--surface);
  border: 1px solid var(--border);
  box-shadow:
    var(--shadow-raised),
    0 12px 32px rgba(0, 0, 0, 0.18);
  animation: menuIn 0.14s var(--ease);
}
@keyframes menuIn {
  from {
    opacity: 0;
    transform: translateY(-4px);
  }
  to {
    opacity: 1;
    transform: none;
  }
}

.item {
  display: flex;
  align-items: center;
  gap: 10px;
  width: 100%;
  padding: 9px 10px;
  border: 0;
  border-radius: var(--radius-sm);
  background: transparent;
  color: var(--text);
  font-family: var(--font-ui);
  font-size: 14px;
  font-weight: 600;
  text-align: left;
  cursor: pointer;
}
.item:hover {
  background: var(--surface-inset);
  color: var(--accent);
}
.item:focus-visible {
  outline: 2px solid var(--accent);
  outline-offset: -2px;
}
```

- [ ] **Step 6: Run the test to verify it passes**

Run: `pnpm test src/board/AddWidgetMenu.test.tsx`
Expected: PASS (1 test).

- [ ] **Step 7: Commit**

```bash
git add src/widget-registry/registry.ts src/board/AddWidgetMenu.tsx src/board/AddWidgetMenu.module.css src/board/AddWidgetMenu.test.tsx
git commit -m "feat(board): add-widget catalog menu with registry icons"
```

---

## Task 8: ThemeToggle component

**Files:**

- Create: `src/app/ThemeToggle.tsx`
- Create: `src/app/ThemeToggle.module.css`
- Test: `src/app/ThemeToggle.test.tsx`

- [ ] **Step 1: Write the failing test**

Create `src/app/ThemeToggle.test.tsx`:

```tsx
// @vitest-environment jsdom
import { beforeEach, describe, expect, it } from 'vitest'
import { context } from '@reatom/core'
import { fireEvent, render, screen } from '@testing-library/react'
import { themeMode } from '../theme/theme-model'
import { ThemeToggle } from './ThemeToggle'

beforeEach(() => {
  context.reset()
  localStorage.clear()
})

describe('ThemeToggle', () => {
  it('renders a button per mode', () => {
    render(<ThemeToggle />)
    expect(screen.getByRole('button', { name: /light/i })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: /dark/i })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: /system/i })).toBeInTheDocument()
  })

  it('sets the theme mode on click', () => {
    render(<ThemeToggle />)
    fireEvent.click(screen.getByRole('button', { name: /dark/i }))
    expect(themeMode()).toBe('dark')
  })

  it('marks the active mode with aria-pressed', () => {
    render(<ThemeToggle />)
    fireEvent.click(screen.getByRole('button', { name: /dark/i }))
    expect(screen.getByRole('button', { name: /dark/i })).toHaveAttribute('aria-pressed', 'true')
  })
})
```

- [ ] **Step 2: Run it to verify it fails**

Run: `pnpm test src/app/ThemeToggle.test.tsx`
Expected: FAIL — cannot find module `./ThemeToggle`.

- [ ] **Step 3: Implement the component**

Create `src/app/ThemeToggle.tsx`:

```tsx
import { reatomComponent } from '@reatom/react'
import type { MouseEvent } from 'react'
import { Monitor, Moon, Sun } from 'lucide-react'
import type { LucideIcon } from 'lucide-react'
import type { ThemeMode } from '../shared/theme/types'
import { themeMode } from '../theme/theme-model'
import styles from './ThemeToggle.module.css'

const OPTIONS: { mode: ThemeMode; label: string; Icon: LucideIcon }[] = [
  { mode: 'light', label: 'Light', Icon: Sun },
  { mode: 'dark', label: 'Dark', Icon: Moon },
  { mode: 'system', label: 'System theme', Icon: Monitor },
]

function setMode(mode: ThemeMode, event: MouseEvent) {
  const root = document.documentElement
  root.style.setProperty('--vt-x', `${event.clientX}px`)
  root.style.setProperty('--vt-y', `${event.clientY}px`)

  const prefersReducedMotion = window.matchMedia?.('(prefers-reduced-motion: reduce)').matches
  const startViewTransition = (
    document as Document & { startViewTransition?: (cb: () => void) => void }
  ).startViewTransition

  if (startViewTransition && !prefersReducedMotion) {
    startViewTransition(() => themeMode.set(mode))
  } else {
    themeMode.set(mode)
  }
}

export const ThemeToggle = reatomComponent(() => {
  const current = themeMode()
  return (
    <div className={styles.group} role="group" aria-label="Theme">
      {OPTIONS.map(({ mode, label, Icon }) => (
        <button
          key={mode}
          type="button"
          className={styles.button}
          aria-label={label}
          aria-pressed={current === mode}
          data-active={current === mode}
          onClick={(event) => setMode(mode, event)}
        >
          <Icon size={16} strokeWidth={2.2} aria-hidden />
        </button>
      ))}
    </div>
  )
}, 'ThemeToggle')
```

- [ ] **Step 4: Create the styles**

Create `src/app/ThemeToggle.module.css`:

```css
.group {
  display: flex;
  gap: 2px;
  padding: 3px;
  border-radius: var(--radius-pill);
  background: var(--surface-inset);
  box-shadow: var(--shadow-pressed);
}

.button {
  display: grid;
  place-items: center;
  width: 30px;
  height: 28px;
  border: 0;
  border-radius: var(--radius-pill);
  background: transparent;
  color: var(--text-dim);
  cursor: pointer;
  transition:
    color 0.15s var(--ease),
    background 0.15s var(--ease),
    box-shadow 0.15s var(--ease);
}
.button:hover {
  color: var(--text);
}
.button[data-active='true'] {
  background: var(--surface);
  color: var(--accent);
  box-shadow: var(--shadow-raised-sm);
}
.button:focus-visible {
  outline: 2px solid var(--accent);
  outline-offset: 2px;
}
```

- [ ] **Step 5: Run the test to verify it passes**

Run: `pnpm test src/app/ThemeToggle.test.tsx`
Expected: PASS (3 tests).

- [ ] **Step 6: Commit**

```bash
git add src/app/ThemeToggle.tsx src/app/ThemeToggle.module.css src/app/ThemeToggle.test.tsx
git commit -m "feat(theme): segmented light/dark/system toggle with view-transition reveal"
```

---

## Task 9: Header + app shell wiring

**Files:**

- Create: `src/app/Header.tsx`
- Create: `src/app/Header.module.css`
- Test: `src/app/Header.test.tsx`
- Modify: `src/app/App.tsx`
- Modify: `src/app/App.module.css`
- Modify: `src/app/main.tsx`

- [ ] **Step 1: Write the failing Header test**

Create `src/app/Header.test.tsx`:

```tsx
// @vitest-environment jsdom
import { beforeEach, describe, expect, it } from 'vitest'
import { context } from '@reatom/core'
import { render, screen } from '@testing-library/react'
import { Header } from './Header'

beforeEach(() => {
  context.reset()
  localStorage.clear()
})

describe('Header', () => {
  it('renders brand, theme toggle and the add-widget control', () => {
    render(<Header />)
    expect(screen.getByText('myboard')).toBeInTheDocument()
    expect(screen.getByRole('group', { name: /theme/i })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: /add widget/i })).toBeInTheDocument()
  })
})
```

- [ ] **Step 2: Run it to verify it fails**

Run: `pnpm test src/app/Header.test.tsx`
Expected: FAIL — cannot find module `./Header`.

- [ ] **Step 3: Implement the Header**

Create `src/app/Header.tsx`:

```tsx
import { LayoutGrid } from 'lucide-react'
import { AddWidgetMenu } from '../board/AddWidgetMenu'
import { ThemeToggle } from './ThemeToggle'
import styles from './Header.module.css'

export function Header() {
  return (
    <header className={styles.header}>
      <div className={styles.brand}>
        <span className={styles.logo}>
          <LayoutGrid size={18} strokeWidth={2.2} aria-hidden />
        </span>
        <span className={styles.name}>myboard</span>
      </div>
      <div className={styles.actions}>
        <ThemeToggle />
        <AddWidgetMenu />
      </div>
    </header>
  )
}
```

- [ ] **Step 4: Create the Header styles**

Create `src/app/Header.module.css`:

```css
.header {
  position: sticky;
  top: 0;
  z-index: 10;
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 16px;
  padding: 14px 20px;
  background: color-mix(in srgb, var(--bg) 80%, transparent);
  backdrop-filter: blur(12px);
  border-bottom: 1px solid var(--border);
}

.brand {
  display: flex;
  align-items: center;
  gap: 10px;
}
.logo {
  display: grid;
  place-items: center;
  width: 32px;
  height: 32px;
  border-radius: var(--radius-sm);
  background: linear-gradient(140deg, var(--accent), color-mix(in srgb, var(--accent) 70%, #000));
  color: var(--accent-contrast);
  box-shadow: var(--shadow-raised-sm);
}
.name {
  font-family: var(--font-display);
  font-weight: 600;
  font-size: 19px;
  color: var(--text);
}

.actions {
  display: flex;
  align-items: center;
  gap: 12px;
}
```

- [ ] **Step 5: Wire the Header into the app shell**

Replace the contents of `src/app/App.tsx` with:

```tsx
import { Board } from '../board/Board'
import { FullscreenOverlay } from '../widget-host/FullscreenOverlay'
import styles from './App.module.css'
import { ErrorBoundary } from './ErrorBoundary'
import { Header } from './Header'

export function App() {
  return (
    <ErrorBoundary>
      <div className={styles.app}>
        <Header />
        <main className={styles.main}>
          <Board />
        </main>
        <FullscreenOverlay />
      </div>
    </ErrorBoundary>
  )
}
```

Replace the contents of `src/app/App.module.css` with:

```css
.app {
  height: 100%;
  overflow-y: auto;
}

.main {
  min-height: 0;
}
```

- [ ] **Step 6: Initialize the theme on startup**

In `src/app/main.tsx`, add the theme import and call `initTheme()` before `initBoard()`:

```tsx
import '../setup'
import './global.css'
import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { initBoard } from '../board-model/board-model'
import { initTheme } from '../theme/theme-model'
import { App } from './App'

initTheme()
initBoard()

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
  </StrictMode>,
)
```

- [ ] **Step 7: Run the Header test + typecheck**

Run: `pnpm test src/app/Header.test.tsx`
Expected: PASS (1 test).

Run: `pnpm typecheck`
Expected: no type errors.

- [ ] **Step 8: Commit**

```bash
git add src/app/Header.tsx src/app/Header.module.css src/app/Header.test.tsx src/app/App.tsx src/app/App.module.css src/app/main.tsx
git commit -m "feat(app): sticky header with brand, theme toggle and add-widget; init theme on boot"
```

---

## Task 10: WidgetFrame — live theme push + restyled states

**Files:**

- Modify: `src/widget-host/WidgetFrame.tsx`
- Modify: `src/widget-host/WidgetFrame.module.css`

Note: WidgetFrame becomes a `reatomComponent` so it re-renders on `resolvedTheme` change. The connection is kept in a ref; theme changes are pushed via a **separate** effect that does NOT re-create the connection (so the iframe never reloads on theme switch). The existing `WidgetFrame.test.tsx` keeps passing unchanged (it asserts iframe `src` and the unknown-type error card; both are preserved).

- [ ] **Step 1: Reimplement WidgetFrame**

Replace the contents of `src/widget-host/WidgetFrame.tsx` with:

```tsx
import { reatomComponent } from '@reatom/react'
import { useEffect, useRef, useState } from 'react'
import { AlertTriangle, RotateCw } from 'lucide-react'
import { env } from '../env'
import type { WidgetMode } from '../shared/widget-bridge'
import { resolvedTheme } from '../theme/theme-model'
import { findWidgetType } from '../widget-registry/registry'
import { createWidgetConnection, type WidgetConnection } from './widget-connection'
import styles from './WidgetFrame.module.css'

export type WidgetFrameProps = {
  instanceId: string
  typeId: string
  mode: WidgetMode
  onRequestFullscreen?: () => void
  onRequestClose?: () => void
}

type Status = 'connecting' | 'ready' | 'error'

export const WidgetFrame = reatomComponent<WidgetFrameProps>((props) => {
  const { instanceId, typeId, mode, onRequestFullscreen, onRequestClose } = props
  const type = findWidgetType(typeId)
  const theme = resolvedTheme()
  const themeRef = useRef(theme)
  themeRef.current = theme
  const connectionRef = useRef<WidgetConnection | null>(null)
  const iframeRef = useRef<HTMLIFrameElement | null>(null)
  const [status, setStatus] = useState<Status>('connecting')
  const [reloadKey, setReloadKey] = useState(0)

  const src =
    type instanceof Error
      ? ''
      : `${type.entry}?mode=${mode}&instanceId=${encodeURIComponent(instanceId)}`

  useEffect(() => {
    if (type instanceof Error) return
    const iframe = iframeRef.current
    if (!iframe) return
    setStatus('connecting')

    const connection = createWidgetConnection({
      instanceId,
      mode,
      targetOrigin: window.location.origin,
      theme: themeRef.current,
      handlers: {
        onRequestFullscreen,
        onRequestClose,
        onWidgetError: (message) => console.warn(`[widget ${instanceId}] error:`, message.message),
      },
    })
    connectionRef.current = connection

    let cancelled = false
    const onLoad = async () => {
      const win = iframe.contentWindow
      if (!win) {
        setStatus('error')
        return
      }
      const result = await connection.handshake(win, env.VITE_WIDGET_HANDSHAKE_TIMEOUT_MS)
      if (cancelled) return
      setStatus(result instanceof Error ? 'error' : 'ready')
      if (result instanceof Error) {
        console.warn(`[widget ${instanceId}] handshake failed:`, result.message)
      }
    }

    iframe.addEventListener('load', onLoad)
    return () => {
      cancelled = true
      iframe.removeEventListener('load', onLoad)
      connection.close()
      connectionRef.current = null
    }
  }, [instanceId, type, mode, reloadKey, onRequestFullscreen, onRequestClose])

  // Push live theme changes into the widget without reloading the iframe.
  useEffect(() => {
    connectionRef.current?.send({ type: 'theme-change', theme })
  }, [theme])

  if (type instanceof Error) {
    return (
      <div className={styles.frame}>
        <div className={styles.errorCard}>
          <AlertTriangle className={styles.errorIcon} size={22} aria-hidden />
          <div>Widget unavailable</div>
          <small>{type.message}</small>
        </div>
      </div>
    )
  }

  return (
    <div className={styles.frame}>
      <iframe
        ref={iframeRef}
        key={reloadKey}
        className={styles.iframe}
        title={`${typeId} (${instanceId})`}
        src={src}
      />
      {status === 'connecting' && <div className={styles.skeleton} aria-hidden />}
      {status === 'error' && (
        <div className={styles.errorCard}>
          <AlertTriangle className={styles.errorIcon} size={22} aria-hidden />
          <div>Widget failed to load</div>
          <button
            className={styles.retry}
            aria-label="Retry"
            onClick={() => setReloadKey((key) => key + 1)}
          >
            <RotateCw size={15} aria-hidden /> Retry
          </button>
        </div>
      )}
    </div>
  )
}, 'WidgetFrame')
```

- [ ] **Step 2: Restyle WidgetFrame states**

Replace the contents of `src/widget-host/WidgetFrame.module.css` with:

```css
.frame {
  position: relative;
  width: 100%;
  height: 100%;
  background: var(--surface);
}

.iframe {
  width: 100%;
  height: 100%;
  border: 0;
  display: block;
}

.skeleton {
  position: absolute;
  inset: 0;
  background: linear-gradient(
    100deg,
    var(--skeleton) 30%,
    color-mix(in srgb, var(--skeleton) 50%, transparent) 50%,
    var(--skeleton) 70%
  );
  background-size: 200% 100%;
  animation: shimmer 1.2s linear infinite;
}
@keyframes shimmer {
  from {
    background-position: 200% 0;
  }
  to {
    background-position: -200% 0;
  }
}

.errorCard {
  position: absolute;
  inset: 0;
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  gap: 8px;
  padding: 12px;
  text-align: center;
  background: var(--surface);
  color: var(--text);
}
.errorIcon {
  color: var(--accent);
}
.errorCard small {
  color: var(--text-dim);
}

.retry {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  margin-top: 6px;
  padding: 6px 14px;
  border: 0;
  border-radius: var(--radius-pill);
  background: var(--accent);
  color: var(--accent-contrast);
  font-weight: 700;
  cursor: pointer;
}
.retry:focus-visible {
  outline: 2px solid var(--accent);
  outline-offset: 2px;
}
```

- [ ] **Step 3: Run the existing WidgetFrame test**

Run: `pnpm test src/widget-host/WidgetFrame.test.tsx`
Expected: PASS (2 tests) — `src` and unknown-type behavior unchanged.

- [ ] **Step 4: Commit**

```bash
git add src/widget-host/WidgetFrame.tsx src/widget-host/WidgetFrame.module.css
git commit -m "feat(widget-host): live theme push to iframes + Soft Clay loading/error states"
```

---

## Task 11: Board re-skin + empty state + lucide controls

**Files:**

- Create: `src/board/EmptyState.tsx`
- Create: `src/board/EmptyState.module.css`
- Modify: `src/board/Board.tsx`
- Modify: `src/board/Board.module.css`
- Test: `src/board/Board.test.tsx`

- [ ] **Step 1: Create the EmptyState component**

Create `src/board/EmptyState.tsx`:

```tsx
import { LayoutGrid } from 'lucide-react'
import styles from './EmptyState.module.css'

export function EmptyState() {
  return (
    <div className={styles.empty}>
      <span className={styles.icon}>
        <LayoutGrid size={32} strokeWidth={1.6} aria-hidden />
      </span>
      <h2 className={styles.title}>No widgets yet</h2>
      <p className={styles.hint}>Use “Add widget” in the top bar to place your first widget.</p>
    </div>
  )
}
```

Create `src/board/EmptyState.module.css`:

```css
.empty {
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  gap: 12px;
  min-height: 60vh;
  text-align: center;
  color: var(--text-dim);
  animation: fadeIn 0.5s var(--ease) backwards;
}
.icon {
  display: grid;
  place-items: center;
  width: 72px;
  height: 72px;
  border-radius: var(--radius-xl);
  background: var(--surface);
  box-shadow: var(--shadow-raised);
  color: var(--accent);
}
.title {
  margin: 4px 0 0;
  font-family: var(--font-display);
  font-weight: 500;
  font-size: 22px;
  color: var(--text);
}
.hint {
  margin: 0;
  font-size: 14px;
  max-width: 320px;
}
@keyframes fadeIn {
  from {
    opacity: 0;
    transform: translateY(8px);
  }
  to {
    opacity: 1;
    transform: none;
  }
}
```

- [ ] **Step 2: Rewrite the Board test for the new structure**

Replace the contents of `src/board/Board.test.tsx` with:

```tsx
// @vitest-environment jsdom
import { beforeEach, describe, expect, it } from 'vitest'
import { context } from '@reatom/core'
import { fireEvent, render, screen, within } from '@testing-library/react'
import { addInstance, instances } from '../board-model/board-model'
import { Board } from './Board'

beforeEach(() => {
  context.reset()
  localStorage.clear()
})

describe('Board', () => {
  it('shows the empty state when there are no widgets', () => {
    render(<Board />)
    expect(screen.getByText(/no widgets yet/i)).toBeInTheDocument()
  })

  it('renders a card for each instance', () => {
    const id = addInstance('clock')
    if (id instanceof Error) throw id
    render(<Board />)
    expect(screen.getByTestId('widget-card')).toBeInTheDocument()
  })

  it('removes a widget via its remove button', async () => {
    const id = addInstance('clock')
    if (id instanceof Error) throw id
    render(<Board />)
    const card = await screen.findByTestId('widget-card')
    fireEvent.click(within(card).getByRole('button', { name: /remove/i }))
    expect(instances()).toHaveLength(0)
  })

  it('renders a stable drag handle for grid interactions', async () => {
    const id = addInstance('clock')
    if (id instanceof Error) throw id
    render(<Board />)
    const card = await screen.findByTestId('widget-card')
    const handle = within(card).getByText('Clock')
    expect(handle).toHaveClass('widget-drag-handle')
  })
})
```

- [ ] **Step 3: Run it to verify it fails**

Run: `pnpm test src/board/Board.test.tsx`
Expected: FAIL — empty-state text not found; toolbar add button removed; structure mismatch.

- [ ] **Step 4: Rewrite the Board component**

Replace the contents of `src/board/Board.tsx` with:

```tsx
import { reatomComponent } from '@reatom/react'
import type { CSSProperties } from 'react'
import ReactGridLayout, { useContainerWidth, verticalCompactor } from 'react-grid-layout'
import { GripVertical, Maximize2, X } from 'lucide-react'
import {
  expandedInstanceId,
  instances,
  layout,
  removeInstance,
  updateLayout,
} from '../board-model/board-model'
import { WidgetFrame } from '../widget-host/WidgetFrame'
import { findWidgetType } from '../widget-registry/registry'
import { EmptyState } from './EmptyState'
import styles from './Board.module.css'

export const Board = reatomComponent(() => {
  const currentInstances = instances()
  const currentLayout = layout()
  const { width, containerRef } = useContainerWidth()

  if (currentInstances.length === 0) {
    return (
      <div className={styles.root}>
        <EmptyState />
      </div>
    )
  }

  return (
    <div className={styles.root}>
      <div ref={containerRef}>
        <ReactGridLayout
          className="layout"
          width={width || 1200}
          layout={currentLayout}
          gridConfig={{ cols: 12, rowHeight: 30 }}
          dragConfig={{ enabled: true, handle: '.widget-drag-handle', cancel: 'button,iframe' }}
          resizeConfig={{ enabled: true, handles: ['se'] }}
          compactor={verticalCompactor}
          onLayoutChange={(next) => updateLayout([...next])}
        >
          {currentInstances.map((instance, index) => {
            const type = findWidgetType(instance.typeId)
            const title = type instanceof Error ? instance.typeId : type.title
            return (
              <div key={instance.id} data-testid="widget-card" className={styles.gridItem}>
                <div className={styles.card} style={{ '--i': index } as CSSProperties}>
                  <div className={styles.header}>
                    <span className={`${styles.handle} widget-drag-handle`}>
                      <GripVertical className={styles.grip} size={14} aria-hidden />
                      {title}
                    </span>
                    <div className={styles.headerActions}>
                      <button
                        className={styles.iconButton}
                        aria-label="Expand"
                        onClick={() => expandedInstanceId.set(instance.id)}
                      >
                        <Maximize2 size={15} aria-hidden />
                      </button>
                      <button
                        className={styles.iconButton}
                        aria-label="Remove"
                        onClick={() => removeInstance(instance.id)}
                      >
                        <X size={15} aria-hidden />
                      </button>
                    </div>
                  </div>
                  <div className={styles.body}>
                    <WidgetFrame
                      instanceId={instance.id}
                      typeId={instance.typeId}
                      mode="small"
                      onRequestFullscreen={() => expandedInstanceId.set(instance.id)}
                    />
                  </div>
                </div>
              </div>
            )
          })}
        </ReactGridLayout>
      </div>
    </div>
  )
}, 'Board')
```

- [ ] **Step 5: Restyle the Board**

Replace the contents of `src/board/Board.module.css` with:

```css
.root {
  min-height: 100%;
  padding: 20px;
}

.gridItem {
  height: 100%;
}

.card {
  display: flex;
  flex-direction: column;
  height: 100%;
  border-radius: var(--radius-lg);
  background: var(--surface);
  box-shadow: var(--shadow-raised);
  overflow: hidden;
  animation: cardRise 0.5s var(--ease) backwards;
  animation-delay: calc(var(--i, 0) * 60ms);
  transition:
    box-shadow 0.2s var(--ease),
    transform 0.2s var(--ease);
}
.card:hover {
  transform: translateY(-2px);
  box-shadow:
    var(--shadow-raised),
    0 8px 20px rgba(0, 0, 0, 0.06);
}
@keyframes cardRise {
  from {
    opacity: 0;
    transform: translateY(12px);
  }
  to {
    opacity: 1;
    transform: none;
  }
}

.header {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 8px 10px;
  border-bottom: 1px solid var(--border);
}

.handle {
  flex: 1;
  display: flex;
  align-items: center;
  gap: 6px;
  cursor: grab;
  font-size: 12px;
  font-weight: 700;
  letter-spacing: 0.04em;
  text-transform: uppercase;
  color: var(--text-dim);
  user-select: none;
}
.handle:active {
  cursor: grabbing;
}
.grip {
  opacity: 0.5;
}

.headerActions {
  display: flex;
  gap: 4px;
  opacity: 0;
  transition: opacity 0.15s var(--ease);
}
.card:hover .headerActions,
.card:focus-within .headerActions {
  opacity: 1;
}

.iconButton {
  display: grid;
  place-items: center;
  width: 28px;
  height: 28px;
  border: 0;
  border-radius: var(--radius-sm);
  background: var(--surface-inset);
  color: var(--text-dim);
  cursor: pointer;
  transition:
    color 0.15s,
    background 0.15s;
}
.iconButton:hover {
  color: var(--accent);
}
.iconButton:focus-visible {
  outline: 2px solid var(--accent);
  outline-offset: 2px;
}

.body {
  flex: 1;
  min-height: 0;
}
```

- [ ] **Step 6: Run the Board test to verify it passes**

Run: `pnpm test src/board/Board.test.tsx`
Expected: PASS (4 tests).

- [ ] **Step 7: Commit**

```bash
git add src/board/EmptyState.tsx src/board/EmptyState.module.css src/board/Board.tsx src/board/Board.module.css src/board/Board.test.tsx
git commit -m "feat(board): Soft Clay cards, empty state and lucide card controls"
```

---

## Task 12: FullscreenOverlay — Escape/focus + re-skin

**Files:**

- Modify: `src/widget-host/FullscreenOverlay.tsx`
- Modify: `src/widget-host/FullscreenOverlay.module.css`
- Test: `src/widget-host/FullscreenOverlay.test.tsx`

- [ ] **Step 1: Add the failing Escape test**

In `src/widget-host/FullscreenOverlay.test.tsx`, add the imports `addInstance` and `expandedInstanceId` to the existing import from `../board-model/board-model` (it already imports `addInstance, expandedInstanceId, instances`), then add this test inside the `describe` block:

```tsx
it('closes on Escape', () => {
  const id = addInstance('clock')
  if (id instanceof Error) throw id
  expandedInstanceId.set(id)

  render(<FullscreenOverlay />)
  fireEvent.keyDown(document, { key: 'Escape' })
  expect(expandedInstanceId()).toBeNull()
})
```

- [ ] **Step 2: Run it to verify it fails**

Run: `pnpm test src/widget-host/FullscreenOverlay.test.tsx`
Expected: FAIL — Escape does not close the overlay yet.

- [ ] **Step 3: Reimplement the overlay with Escape + focus handling**

Replace the contents of `src/widget-host/FullscreenOverlay.tsx` with:

```tsx
import { reatomComponent } from '@reatom/react'
import { useEffect, useRef } from 'react'
import { X } from 'lucide-react'
import { expandedInstanceId, instances } from '../board-model/board-model'
import { findWidgetType } from '../widget-registry/registry'
import { WidgetFrame } from './WidgetFrame'
import styles from './FullscreenOverlay.module.css'

export const FullscreenOverlay = reatomComponent(() => {
  const id = expandedInstanceId()
  const closeRef = useRef<HTMLButtonElement | null>(null)

  useEffect(() => {
    if (id === null) return
    const previouslyFocused = document.activeElement as HTMLElement | null
    closeRef.current?.focus()

    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') expandedInstanceId.set(null)
    }
    document.addEventListener('keydown', onKeyDown)
    return () => {
      document.removeEventListener('keydown', onKeyDown)
      previouslyFocused?.focus?.()
    }
  }, [id])

  if (id === null) return null

  const instance = instances().find((item) => item.id === id)
  if (!instance) return null

  const type = findWidgetType(instance.typeId)
  const title = type instanceof Error ? instance.typeId : type.title
  const close = () => expandedInstanceId.set(null)

  return (
    <div className={styles.backdrop} role="dialog" aria-modal="true" aria-label={title}>
      <div className={styles.bar}>
        <span className={styles.title}>{title}</span>
        <button ref={closeRef} className={styles.close} aria-label="Close" onClick={close}>
          <X size={18} aria-hidden />
        </button>
      </div>
      <div className={styles.body}>
        <WidgetFrame
          instanceId={instance.id}
          typeId={instance.typeId}
          mode="large"
          onRequestClose={close}
        />
      </div>
    </div>
  )
}, 'FullscreenOverlay')
```

- [ ] **Step 4: Restyle the overlay**

Replace the contents of `src/widget-host/FullscreenOverlay.module.css` with:

```css
.backdrop {
  position: fixed;
  inset: 0;
  z-index: 50;
  display: flex;
  flex-direction: column;
  background: color-mix(in srgb, var(--bg) 70%, transparent);
  backdrop-filter: blur(16px);
  animation: overlayIn 0.2s var(--ease);
}
@keyframes overlayIn {
  from {
    opacity: 0;
  }
  to {
    opacity: 1;
  }
}

.bar {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 14px 20px;
  border-bottom: 1px solid var(--border);
}
.title {
  font-family: var(--font-display);
  font-weight: 600;
  font-size: 17px;
  color: var(--text);
}

.close {
  display: grid;
  place-items: center;
  width: 36px;
  height: 36px;
  border: 0;
  border-radius: var(--radius-sm);
  background: var(--surface);
  color: var(--text-dim);
  box-shadow: var(--shadow-raised-sm);
  cursor: pointer;
  transition: color 0.15s;
}
.close:hover {
  color: var(--accent);
}
.close:focus-visible {
  outline: 2px solid var(--accent);
  outline-offset: 2px;
}

.body {
  flex: 1;
  min-height: 0;
  padding: 16px;
}
```

- [ ] **Step 5: Run the overlay tests to verify they pass**

Run: `pnpm test src/widget-host/FullscreenOverlay.test.tsx`
Expected: PASS (3 tests — empty render, close button, Escape).

- [ ] **Step 6: Commit**

```bash
git add src/widget-host/FullscreenOverlay.tsx src/widget-host/FullscreenOverlay.module.css src/widget-host/FullscreenOverlay.test.tsx
git commit -m "feat(widget-host): re-skin fullscreen overlay; Escape-to-close + focus restore"
```

---

## Task 13: Clock widget re-skin + theme application

**Files:**

- Modify: `widgets/clock/main.tsx`
- Modify: `widgets/clock/Clock.tsx`
- Modify: `widgets/clock/clock.module.css`

This is a visual/iframe task verified by running the app (Task 14); it has no unit test.

- [ ] **Step 1: Apply theme + import tokens in the widget entry**

Replace the contents of `widgets/clock/main.tsx` with:

```tsx
import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { createWidgetClient } from '../../src/shared/widget-bridge'
import '../../src/shared/theme/tokens.css'
import { Clock } from './Clock'

const root = createRoot(document.getElementById('root')!)

const client = await createWidgetClient()
if (client instanceof Error) {
  root.render(
    <div style={{ color: 'var(--accent)', padding: 16, fontFamily: 'var(--font-ui)' }}>
      Bridge error: {client.message}
    </div>,
  )
} else {
  document.documentElement.dataset.theme = client.theme
  client.onThemeChange((theme) => {
    document.documentElement.dataset.theme = theme
  })
  root.render(
    <StrictMode>
      <Clock client={client} />
    </StrictMode>,
  )
}
```

- [ ] **Step 2: Add lucide controls to the Clock**

Replace the contents of `widgets/clock/Clock.tsx` with:

```tsx
import { useEffect, useState } from 'react'
import { Maximize2, X } from 'lucide-react'
import type { WidgetClient, WidgetMode } from '../../src/shared/widget-bridge'
import styles from './clock.module.css'

const timeFmt = new Intl.DateTimeFormat(undefined, {
  hour: '2-digit',
  minute: '2-digit',
  second: '2-digit',
})

const dateFmt = new Intl.DateTimeFormat(undefined, {
  weekday: 'long',
  year: 'numeric',
  month: 'long',
  day: 'numeric',
})

function useNow() {
  const [now, setNow] = useState(() => new Date())
  useEffect(() => {
    const id = setInterval(() => setNow(new Date()), 1000)
    return () => clearInterval(id)
  }, [])
  return now
}

export function Clock({ client }: { client: WidgetClient }) {
  const [mode, setMode] = useState<WidgetMode>(client.mode)
  useEffect(() => client.onModeChange(setMode), [client])
  const now = useNow()

  if (mode === 'large') {
    return (
      <div className={styles.root}>
        <button className={styles.close} aria-label="Close" onClick={() => client.requestClose()}>
          <X size={18} aria-hidden />
        </button>
        <div className={styles.timeLarge}>{timeFmt.format(now)}</div>
        <div className={styles.date}>{dateFmt.format(now)}</div>
      </div>
    )
  }

  return (
    <button
      className={styles.smallButton}
      title="Open fullscreen"
      onClick={() => client.requestFullscreen()}
    >
      <span className={styles.timeSmall}>{timeFmt.format(now)}</span>
      <Maximize2 className={styles.smallExpand} size={14} aria-hidden />
    </button>
  )
}
```

- [ ] **Step 3: Re-theme the Clock styles with tokens**

Replace the contents of `widgets/clock/clock.module.css` with:

```css
.root {
  height: 100vh;
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  gap: 8px;
  position: relative;
  background: var(--surface);
  color: var(--text);
  font-family: var(--font-ui);
  user-select: none;
}

.smallButton {
  width: 100%;
  height: 100vh;
  border: 0;
  background: var(--surface);
  color: var(--text);
  cursor: pointer;
  display: flex;
  align-items: center;
  justify-content: center;
  position: relative;
  font-family: var(--font-ui);
}

.smallExpand {
  position: absolute;
  top: 8px;
  right: 8px;
  color: var(--text-dim);
  opacity: 0;
  transition: opacity 0.15s var(--ease);
}
.smallButton:hover .smallExpand {
  opacity: 1;
}

.timeSmall {
  font-family: var(--font-display);
  font-weight: 500;
  font-size: clamp(20px, 12vw, 56px);
  font-variant-numeric: tabular-nums;
  letter-spacing: 1px;
  color: var(--accent-2);
}

.timeLarge {
  font-family: var(--font-display);
  font-weight: 500;
  font-size: clamp(48px, 18vw, 160px);
  font-variant-numeric: tabular-nums;
  letter-spacing: 2px;
  color: var(--accent-2);
}

.date {
  font-size: clamp(14px, 3vw, 28px);
  color: var(--text-dim);
}

.close {
  position: absolute;
  top: 16px;
  right: 16px;
  display: grid;
  place-items: center;
  width: 40px;
  height: 40px;
  border: 0;
  border-radius: var(--radius-sm);
  background: var(--surface-inset);
  color: var(--text-dim);
  cursor: pointer;
}
.close:hover {
  color: var(--accent);
}
```

- [ ] **Step 4: Typecheck**

Run: `pnpm typecheck`
Expected: no type errors.

- [ ] **Step 5: Commit**

```bash
git add widgets/clock/main.tsx widgets/clock/Clock.tsx widgets/clock/clock.module.css
git commit -m "feat(clock): Soft Clay re-skin + theme-aware iframe"
```

---

## Task 14: Full verification

**Files:** none (verification only)

- [ ] **Step 1: Run the full test suite**

Run: `pnpm test`
Expected: PASS — all suites green (theme storage/model/resolve, bridge parse/client/connection/handshake, ThemeToggle, AddWidgetMenu, Header, Board, WidgetFrame, FullscreenOverlay).

- [ ] **Step 2: Typecheck the whole project**

Run: `pnpm typecheck`
Expected: no errors.

- [ ] **Step 3: Production build**

Run: `pnpm build`
Expected: build succeeds (host + `widget-clock` entries emitted).

- [ ] **Step 4: Manual smoke test in the browser**

Run: `pnpm dev`, open the printed URL, and confirm:

- Empty state shows "No widgets yet" on a fresh board (clear `localStorage` if needed).
- "Add widget" opens the catalog menu; clicking "Clock" adds a card.
- Card hover reveals the `Maximize2` and `X` controls; the grip/title drags the card; resize handle works.
- `Maximize2` opens the fullscreen overlay; `Escape` and the `X` button both close it; focus returns to the card.
- Theme toggle: Light, Dark, and System all apply; the host AND the clock inside the iframe both change theme; switching does NOT reload the iframe (the seconds keep ticking).
- Reload the page: the chosen theme mode persists; on "System", changing the OS color scheme flips the app.
- With OS "reduce motion" enabled, card entrance/theme-reveal animations are suppressed.

- [ ] **Step 5: Commit any final adjustments (if needed)**

If the manual smoke test required tweaks, commit them:

```bash
git add -A
git commit -m "fix(redesign): adjustments from manual verification"
```

---

## Self-Review Notes

- **Spec coverage:** tokens/palette/fonts (T1), theme storage (T2), theme model + system (T3), bridge theme protocol (T4–T6), live theme into widgets (T5/T6/T10/T13), lucide + components Header/ThemeToggle/AddWidgetMenu/EmptyState (T7–T9, T11), card/overlay re-skin + a11y Escape/focus (T11–T12), loading/error states (T10), clock re-skin (T13), animations + reduced-motion + View Transitions (T1/T8/T11), tests (every logic task), final verification (T14). All spec sections map to a task.
- **Type consistency:** `ThemeMode`/`ResolvedTheme` (shared/theme/types) flow through messages → parse → client → connection → WidgetFrame → theme-model unchanged. `resolveTheme(mode, prefersDark)`, `themeMode`, `systemPrefersDark`, `resolvedTheme`, `initTheme`, `loadThemeMode`/`saveThemeMode`/`THEME_STORAGE_KEY`/`ThemeStorageError`, `WidgetType.icon`, `WidgetConnection`/`createWidgetConnection({..., theme})` are referenced with identical names across tasks.
- **Placeholder scan:** no TBD/TODO; every code/test/CSS step contains complete content.
