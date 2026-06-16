# myboard — Widget Board Infrastructure Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build the local-first platform ("board engine") that hosts isolated iframe widgets on a react-grid-layout board, with a typed host↔widget bridge, small/large views, Reatom state, localStorage persistence, and errore error handling — proven by a single clock widget.

**Architecture:** A Vite multi-entry SPA. The host app renders a `react-grid-layout` board of widget instances; each instance is an `<iframe>` loaded from its own HTML entry (Approach A). Host and widget talk over a private `MessageChannel` using a typed postMessage protocol defined in a shared `widget-bridge` module. Board structure (instances + layout) lives in Reatom atoms persisted to localStorage. Every fallible boundary returns `Error | T` via errore.

**Tech Stack:** Vite 6 (multi-entry) · React 18 · TypeScript 5 · react-grid-layout 1.5 · Reatom v1000 (`@reatom/core@1000`, `@reatom/react@1000`) · errore · zod (env validation) · CSS Modules · Vitest + @testing-library/react (jsdom). Package manager: pnpm.

---

## Conventions used in every task

- **errore:** `import * as errore from 'errore'`. Return errors, never throw for expected failures. Check `instanceof Error`, early-return. Tagged errors via `errore.createTaggedError`.
- **Reatom v1000:** implicit context (no `ctx`). Read atom by calling it `atom()`. Write with `atom.set(value | (prev) => next)`. `action((args) => ..., 'name')`. Name every atom/action.
- **Package manager:** pnpm. Use `pnpm install` / `pnpm run <script>` / `pnpm exec <bin>` — never npm or yarn. A `pnpm-lock.yaml` is committed; do not add `package-lock.json`.
- **Commits:** after each task. Prefix git commands with `rtk` per repo convention (RTK passthrough is safe). End commit messages with the Co-Authored-By trailer:

  ```
  Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>
  ```
- **Run a single test:** `pnpm exec vitest run <path>` ; watch with `pnpm exec vitest <path>`.

---

## File Structure

Created by this plan (responsibility in parentheses):

```
myboard/
  index.html                                  (host HTML entry)
  package.json                                (deps + scripts)
  tsconfig.json / tsconfig.node.json          (TS config)
  vite.config.ts                              (auto-discovered multi-entry build + vitest config)
  .env.example                                (documents optional env vars)
  src/
    vitest.setup.ts                           (jest-dom matchers)
    env.ts                                    (zod-validated env: parseEnv + env)
    setup.ts                                  (Reatom logger in dev — imported first)
    app/
      main.tsx                                (host bootstrap: initBoard + render)
      App.tsx                                 (shell: Board + FullscreenOverlay)
      App.module.css
      ErrorBoundary.tsx                       (top-level React error boundary)
      global.css                              (reset + theme vars + RGL css imports)
    shared/widget-bridge/
      messages.ts                             (message type unions + WidgetMode)
      errors.ts                               (BridgeError, WidgetLoadError, HandshakeTimeoutError)
      parse.ts                                (parseHostMessage / parseWidgetMessage)
      client.ts                               (createWidgetClient — widget-side SDK)
      index.ts                                (barrel export)
    widget-registry/
      registry.ts                             (WidgetType catalog + findWidgetType + UnknownWidgetTypeError)
    board-model/
      types.ts                                (WidgetInstance, LayoutItem, BoardSnapshot)
      board-storage.ts                        (loadBoard/saveBoard + StorageError)
      board-model.ts                          (instances/layout/expanded atoms + actions + persistence effect)
    widget-host/
      widget-connection.ts                    (host side of the bridge for one iframe)
      WidgetFrame.tsx                          (iframe + connection lifecycle + error card)
      WidgetFrame.module.css
      FullscreenOverlay.tsx                    (large-mode overlay)
      FullscreenOverlay.module.css
    board/
      Board.tsx                               (react-grid-layout wiring + toolbar + cards)
      Board.module.css
  widgets/
    clock/
      index.html                              (clock widget entry)
      main.tsx                                (clock bootstrap via createWidgetClient)
      Clock.tsx                               (small: time / large: time + date)
      clock.module.css
  tests/                                       (cross-module integration tests)
    bridge-handshake.test.ts
```

Unit tests live next to their module as `*.test.ts(x)`.

---

## Task 1: Project scaffolding

**Files:**
- Create: `package.json`, `tsconfig.json`, `tsconfig.node.json`, `vite.config.ts`, `index.html`, `.env.example`, `src/vitest.setup.ts`, `src/env.ts`, `src/env.test.ts`, `src/setup.ts`, `src/app/global.css`, `src/app/main.tsx`, `src/app/App.tsx`

- [ ] **Step 1: Create `package.json`**

```json
{
  "name": "myboard",
  "private": true,
  "version": "0.0.0",
  "type": "module",
  "scripts": {
    "dev": "vite",
    "build": "tsc -b && vite build",
    "preview": "vite preview",
    "test": "vitest run",
    "test:watch": "vitest",
    "typecheck": "tsc -b --noEmit"
  },
  "dependencies": {
    "@reatom/core": "1000",
    "@reatom/react": "1000",
    "errore": "latest",
    "react": "^18.3.1",
    "react-dom": "^18.3.1",
    "react-grid-layout": "^1.5.0",
    "zod": "^3.23.8"
  },
  "devDependencies": {
    "@testing-library/jest-dom": "^6.4.0",
    "@testing-library/react": "^16.0.0",
    "@types/react": "^18.3.0",
    "@types/react-dom": "^18.3.0",
    "@types/react-grid-layout": "^1.3.5",
    "@vitejs/plugin-react": "^4.3.0",
    "jsdom": "^25.0.0",
    "typescript": "^5.5.0",
    "vite": "^6.0.0",
    "vitest": "^3.0.0"
  }
}
```

- [ ] **Step 2: Install dependencies**

Run: `rtk pnpm install`
Expected: completes without peer-dependency errors. If `@reatom/react@1000` is not found, run `rtk pnpm view @reatom/react dist-tags` to find the tag that matches `@reatom/core@1000` and pin that exact version. Verify `react-grid-layout` resolved to 1.5.x with `rtk pnpm ls react-grid-layout`.

- [ ] **Step 3: Create `tsconfig.json`**

```json
{
  "compilerOptions": {
    "target": "ES2022",
    "lib": ["ES2022", "DOM", "DOM.Iterable"],
    "module": "ESNext",
    "moduleResolution": "bundler",
    "jsx": "react-jsx",
    "strict": true,
    "noUnusedLocals": true,
    "noUnusedParameters": true,
    "skipLibCheck": true,
    "types": ["vitest/globals", "@testing-library/jest-dom"]
  },
  "include": ["src", "widgets", "tests"],
  "references": [{ "path": "./tsconfig.node.json" }]
}
```

- [ ] **Step 4: Create `tsconfig.node.json`**

```json
{
  "compilerOptions": {
    "target": "ES2022",
    "lib": ["ES2022"],
    "module": "ESNext",
    "moduleResolution": "bundler",
    "composite": true,
    "strict": true,
    "skipLibCheck": true
  },
  "include": ["vite.config.ts"]
}
```

- [ ] **Step 5: Create `vite.config.ts` (multi-entry build + vitest)**

```ts
import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import { existsSync, readdirSync } from 'node:fs'
import { resolve } from 'node:path'

const widgetsDir = resolve(__dirname, 'widgets')

// Auto-discover every widget entry (widgets/<name>/index.html) so adding a new
// widget directory is enough — no need to edit this config by hand.
function widgetEntries(): Record<string, string> {
  if (!existsSync(widgetsDir)) return {}
  const entries: Record<string, string> = {}
  for (const dirent of readdirSync(widgetsDir, { withFileTypes: true })) {
    if (!dirent.isDirectory()) continue
    const indexHtml = resolve(widgetsDir, dirent.name, 'index.html')
    if (existsSync(indexHtml)) entries[`widget-${dirent.name}`] = indexHtml
  }
  return entries
}

export default defineConfig({
  plugins: [react()],
  build: {
    rollupOptions: {
      input: {
        main: resolve(__dirname, 'index.html'),
        ...widgetEntries(),
      },
    },
  },
  test: {
    globals: true,
    environment: 'jsdom',
    setupFiles: ['./src/vitest.setup.ts'],
  },
})
```

- [ ] **Step 6: Create `src/vitest.setup.ts`**

```ts
import '@testing-library/jest-dom/vitest'
```

- [ ] **Step 7: Create `src/env.ts` (zod schema + errore boundary)**

```ts
import * as errore from 'errore'
import { z } from 'zod'

export class EnvError extends errore.createTaggedError({
  name: 'EnvError',
  message: 'Invalid environment: $reason',
}) {}

const envSchema = z.object({
  MODE: z.string().default('production'),
  DEV: z.boolean().default(false),
  PROD: z.boolean().default(true),
  // Host↔widget handshake timeout (ms). Env vars are strings, so coerce.
  VITE_WIDGET_HANDSHAKE_TIMEOUT_MS: z.coerce.number().int().positive().default(5000),
})

export type Env = z.infer<typeof envSchema>

/** Validate a raw env object. Testable boundary — returns the error as a value. */
export function parseEnv(raw: unknown): EnvError | Env {
  const result = envSchema.safeParse(raw)
  if (!result.success) return new EnvError({ reason: result.error.message })
  return result.data
}

/**
 * Validated env, resolved once at module load. Invalid configuration is an
 * unrecoverable startup error, so this is the one place we fail fast (throw).
 */
export const env: Env = (() => {
  const parsed = parseEnv(import.meta.env)
  if (parsed instanceof Error) throw parsed
  return parsed
})()
```

- [ ] **Step 8: Write the env test**

```ts
import { describe, expect, it } from 'vitest'
import { parseEnv, EnvError } from './env'

describe('parseEnv', () => {
  it('parses a valid env and applies the timeout default', () => {
    const env = parseEnv({ MODE: 'development', DEV: true, PROD: false })
    if (env instanceof Error) throw env
    expect(env.MODE).toBe('development')
    expect(env.VITE_WIDGET_HANDSHAKE_TIMEOUT_MS).toBe(5000)
  })

  it('coerces the handshake timeout from a string', () => {
    const env = parseEnv({
      MODE: 'production',
      DEV: false,
      PROD: true,
      VITE_WIDGET_HANDSHAKE_TIMEOUT_MS: '3000',
    })
    if (env instanceof Error) throw env
    expect(env.VITE_WIDGET_HANDSHAKE_TIMEOUT_MS).toBe(3000)
  })

  it('returns EnvError for a non-positive timeout', () => {
    const result = parseEnv({ MODE: 'x', DEV: false, PROD: true, VITE_WIDGET_HANDSHAKE_TIMEOUT_MS: '-5' })
    expect(result).toBeInstanceOf(EnvError)
  })
})
```

Run: `pnpm exec vitest run src/env.test.ts`
Expected: PASS (3 cases). (`src/env.test.ts` lives next to `src/env.ts`.)

- [ ] **Step 9: Create `.env.example`**

```bash
# Optional: override the host↔widget handshake timeout, in milliseconds.
# VITE_WIDGET_HANDSHAKE_TIMEOUT_MS=5000
```

- [ ] **Step 10: Create `src/setup.ts` (dev logger — imported before app code)**

```ts
import { connectLogger } from '@reatom/core'
import { env } from './env'

if (env.DEV) {
  connectLogger()
}
```

- [ ] **Step 11: Create `src/app/global.css`**

```css
@import 'react-grid-layout/css/styles.css';
@import 'react-resizable/css/styles.css';

:root {
  --bg: #0f1115;
  --surface: #1b1f27;
  --surface-2: #232834;
  --border: #2e3441;
  --text: #e6e9ef;
  --text-dim: #9aa3b1;
  --accent: #4f8cff;
  --danger: #ff5d5d;
}

* { box-sizing: border-box; }

html, body, #root {
  margin: 0;
  height: 100%;
}

body {
  background: var(--bg);
  color: var(--text);
  font-family: system-ui, -apple-system, Segoe UI, Roboto, sans-serif;
}
```

- [ ] **Step 12: Create `index.html` (host entry)**

```html
<!doctype html>
<html lang="en">
  <head>
    <meta charset="UTF-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1.0" />
    <title>myboard</title>
  </head>
  <body>
    <div id="root"></div>
    <script type="module" src="/src/app/main.tsx"></script>
  </body>
</html>
```

- [ ] **Step 13: Create placeholder `src/app/App.tsx`**

```tsx
export function App() {
  return <div>myboard</div>
}
```

- [ ] **Step 14: Create `src/app/main.tsx`**

```tsx
import '../setup'
import './global.css'
import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { App } from './App'

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
  </StrictMode>,
)
```

- [ ] **Step 15: Verify dev server boots**

Run: `rtk pnpm run dev` (then stop it with Ctrl+C after confirming)
Expected: Vite prints a local URL and starts with no errors. Opening it shows "myboard".

- [ ] **Step 16: Verify typecheck passes**

Run: `rtk pnpm run typecheck`
Expected: no errors.

- [ ] **Step 17: Commit**

```bash
rtk git add -A && rtk git commit -m "chore: scaffold Vite + React + TS + vitest project with zod env validation

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

## Task 2: Bridge message types and tagged errors

**Files:**
- Create: `src/shared/widget-bridge/messages.ts`
- Create: `src/shared/widget-bridge/errors.ts`

- [ ] **Step 1: Create `src/shared/widget-bridge/messages.ts`**

```ts
export type WidgetMode = 'small' | 'large'

// host -> widget
export type InitMessage = { type: 'init'; instanceId: string; mode: WidgetMode }
export type ModeChangeMessage = { type: 'mode-change'; mode: WidgetMode }
export type PingMessage = { type: 'ping' }
export type HostMessage = InitMessage | ModeChangeMessage | PingMessage

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

> `theme` is intentionally omitted from `InitMessage` — theming is deferred (spec §12). `mode-change` is reserved for future in-place switching; MVP uses separate iframes per mode.

- [ ] **Step 2: Create `src/shared/widget-bridge/errors.ts`**

```ts
import * as errore from 'errore'

export class BridgeError extends errore.createTaggedError({
  name: 'BridgeError',
  message: 'Bridge protocol error: $reason',
}) {}

export class WidgetLoadError extends errore.createTaggedError({
  name: 'WidgetLoadError',
  message: 'Widget $instanceId failed to load',
}) {}

export class HandshakeTimeoutError extends errore.createTaggedError({
  name: 'HandshakeTimeoutError',
  message: 'Widget $instanceId did not handshake within $timeoutMs ms',
}) {}
```

- [ ] **Step 3: Typecheck**

Run: `rtk pnpm run typecheck`
Expected: no errors.

- [ ] **Step 4: Commit**

```bash
rtk git add -A && rtk git commit -m "feat(bridge): message type unions and tagged errors

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

## Task 3: Message validation (parse functions)

**Files:**
- Create: `src/shared/widget-bridge/parse.ts`
- Test: `src/shared/widget-bridge/parse.test.ts`

- [ ] **Step 1: Write the failing test**

```ts
import { describe, expect, it } from 'vitest'
import { parseHostMessage, parseWidgetMessage } from './parse'
import { BridgeError } from './errors'

describe('parseHostMessage', () => {
  it('accepts a valid init message', () => {
    const result = parseHostMessage({ type: 'init', instanceId: 'a1', mode: 'small' })
    expect(result).toEqual({ type: 'init', instanceId: 'a1', mode: 'small' })
  })

  it('rejects an init message with an invalid mode', () => {
    const result = parseHostMessage({ type: 'init', instanceId: 'a1', mode: 'huge' })
    expect(result).toBeInstanceOf(BridgeError)
  })

  it('rejects non-object input', () => {
    expect(parseHostMessage(null)).toBeInstanceOf(BridgeError)
    expect(parseHostMessage('init')).toBeInstanceOf(BridgeError)
  })

  it('rejects an unknown type', () => {
    expect(parseHostMessage({ type: 'nope' })).toBeInstanceOf(BridgeError)
  })
})

describe('parseWidgetMessage', () => {
  it('accepts a valid ready message', () => {
    const result = parseWidgetMessage({ type: 'ready', instanceId: 'a1' })
    expect(result).toEqual({ type: 'ready', instanceId: 'a1' })
  })

  it('accepts a request-fullscreen message', () => {
    const result = parseWidgetMessage({ type: 'request-fullscreen', instanceId: 'a1' })
    expect(result).toEqual({ type: 'request-fullscreen', instanceId: 'a1' })
  })

  it('accepts an error message', () => {
    const result = parseWidgetMessage({ type: 'error', message: 'boom' })
    expect(result).toEqual({ type: 'error', message: 'boom' })
  })

  it('rejects a ready message without instanceId', () => {
    expect(parseWidgetMessage({ type: 'ready' })).toBeInstanceOf(BridgeError)
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm exec vitest run src/shared/widget-bridge/parse.test.ts`
Expected: FAIL — `parse.ts` does not exist / functions not defined.

- [ ] **Step 3: Write `src/shared/widget-bridge/parse.ts`**

```ts
import { BridgeError } from './errors'
import type { HostMessage, WidgetMessage, WidgetMode } from './messages'

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null
}

function isMode(value: unknown): value is WidgetMode {
  return value === 'small' || value === 'large'
}

export function parseHostMessage(data: unknown): BridgeError | HostMessage {
  if (!isRecord(data)) return new BridgeError({ reason: 'message is not an object' })

  if (data.type === 'init') {
    if (typeof data.instanceId !== 'string') {
      return new BridgeError({ reason: 'init.instanceId must be a string' })
    }
    if (!isMode(data.mode)) return new BridgeError({ reason: 'init.mode is invalid' })
    return { type: 'init', instanceId: data.instanceId, mode: data.mode }
  }

  if (data.type === 'mode-change') {
    if (!isMode(data.mode)) return new BridgeError({ reason: 'mode-change.mode is invalid' })
    return { type: 'mode-change', mode: data.mode }
  }

  if (data.type === 'ping') return { type: 'ping' }

  return new BridgeError({ reason: `unknown host message type: ${String(data.type)}` })
}

export function parseWidgetMessage(data: unknown): BridgeError | WidgetMessage {
  if (!isRecord(data)) return new BridgeError({ reason: 'message is not an object' })

  if (data.type === 'ready') {
    if (typeof data.instanceId !== 'string') {
      return new BridgeError({ reason: 'ready.instanceId must be a string' })
    }
    return { type: 'ready', instanceId: data.instanceId }
  }

  if (data.type === 'request-fullscreen') {
    if (typeof data.instanceId !== 'string') {
      return new BridgeError({ reason: 'request-fullscreen.instanceId must be a string' })
    }
    return { type: 'request-fullscreen', instanceId: data.instanceId }
  }

  if (data.type === 'request-close') {
    if (typeof data.instanceId !== 'string') {
      return new BridgeError({ reason: 'request-close.instanceId must be a string' })
    }
    return { type: 'request-close', instanceId: data.instanceId }
  }

  if (data.type === 'error') {
    if (typeof data.message !== 'string') {
      return new BridgeError({ reason: 'error.message must be a string' })
    }
    const name = typeof data.name === 'string' ? data.name : undefined
    return name ? { type: 'error', message: data.message, name } : { type: 'error', message: data.message }
  }

  if (data.type === 'pong') return { type: 'pong' }

  return new BridgeError({ reason: `unknown widget message type: ${String(data.type)}` })
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm exec vitest run src/shared/widget-bridge/parse.test.ts`
Expected: PASS (all cases).

- [ ] **Step 5: Commit**

```bash
rtk git add -A && rtk git commit -m "feat(bridge): typed message validation returning BridgeError

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

## Task 4: Widget-side SDK (`createWidgetClient`)

**Files:**
- Create: `src/shared/widget-bridge/client.ts`
- Create: `src/shared/widget-bridge/index.ts`
- Test: `src/shared/widget-bridge/client.test.ts`

The widget runs inside the iframe. `createWidgetClient` waits for the host's `init` message (which carries a private `MessagePort` in `event.ports[0]`), replies `ready` over that port, and returns a client object for sending widget→host messages.

- [ ] **Step 1: Write the failing test**

```ts
// @vitest-environment jsdom
import { describe, expect, it, vi } from 'vitest'
import { createWidgetClient } from './client'
import { HandshakeTimeoutError } from './errors'
import type { WidgetMessage } from './messages'

function sendInit(instanceId: string, mode: 'small' | 'large') {
  const channel = new MessageChannel()
  const received: WidgetMessage[] = []
  channel.port1.onmessage = (e) => received.push(e.data as WidgetMessage)
  channel.port1.start()
  window.dispatchEvent(
    new MessageEvent('message', {
      data: { type: 'init', instanceId, mode },
      ports: [channel.port2],
    }),
  )
  return { hostPort: channel.port1, received }
}

describe('createWidgetClient', () => {
  it('resolves with instanceId and mode from init and replies ready', async () => {
    const clientPromise = createWidgetClient()
    const { received } = sendInit('inst-1', 'small')

    const client = await clientPromise
    if (client instanceof Error) throw client

    expect(client.instanceId).toBe('inst-1')
    expect(client.mode).toBe('small')
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

  it('times out when no init arrives', async () => {
    const result = await createWidgetClient({ timeoutMs: 20 })
    expect(result).toBeInstanceOf(HandshakeTimeoutError)
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm exec vitest run src/shared/widget-bridge/client.test.ts`
Expected: FAIL — `client.ts` not found.

- [ ] **Step 3: Write `src/shared/widget-bridge/client.ts`**

```ts
import { BridgeError, HandshakeTimeoutError } from './errors'
import { parseHostMessage } from './parse'
import type { WidgetMessage, WidgetMode } from './messages'

export type WidgetClient = {
  instanceId: string
  mode: WidgetMode
  requestFullscreen: () => void
  requestClose: () => void
  reportError: (error: Error) => void
  onModeChange: (cb: (mode: WidgetMode) => void) => () => void
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

    const timer = setTimeout(() => {
      target.removeEventListener('message', onWindowMessage)
      resolve(new HandshakeTimeoutError({ instanceId: 'unknown', timeoutMs }))
    }, timeoutMs)

    function onWindowMessage(event: MessageEvent) {
      const parsed = parseHostMessage(event.data)
      if (parsed instanceof Error) return // ignore unrelated/invalid messages
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

      const { instanceId, mode } = parsed

      port.onmessage = (portEvent: MessageEvent) => {
        const hostMsg = parseHostMessage(portEvent.data)
        if (hostMsg instanceof Error) return
        if (hostMsg.type === 'mode-change') {
          modeChangeListeners.forEach((cb) => cb(hostMsg.mode))
        }
      }
      port.start()

      const send = (message: WidgetMessage) => port.postMessage(message)
      send({ type: 'ready', instanceId })

      resolve({
        instanceId,
        mode,
        requestFullscreen: () => send({ type: 'request-fullscreen', instanceId }),
        requestClose: () => send({ type: 'request-close', instanceId }),
        reportError: (error: Error) => send({ type: 'error', message: error.message, name: error.name }),
        onModeChange: (cb) => {
          modeChangeListeners.add(cb)
          return () => modeChangeListeners.delete(cb)
        },
      })
    }

    target.addEventListener('message', onWindowMessage)
  })
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm exec vitest run src/shared/widget-bridge/client.test.ts`
Expected: PASS (3 cases).

- [ ] **Step 5: Create the barrel `src/shared/widget-bridge/index.ts`**

```ts
export * from './messages'
export * from './errors'
export * from './parse'
export * from './client'
```

- [ ] **Step 6: Typecheck + commit**

Run: `rtk pnpm run typecheck`
Expected: no errors.

```bash
rtk git add -A && rtk git commit -m "feat(bridge): createWidgetClient widget SDK with handshake + timeout

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

## Task 5: Host-side connection (`createWidgetConnection`)

**Files:**
- Create: `src/widget-host/widget-connection.ts`
- Test: `src/widget-host/widget-connection.test.ts`

The host creates one connection per iframe. It owns a `MessageChannel`, transfers `port2` to the widget inside the `init` message, listens on `port1`, and resolves once the widget replies `ready` (or rejects with `HandshakeTimeoutError`).

- [ ] **Step 1: Write the failing test**

```ts
// @vitest-environment jsdom
import { describe, expect, it, vi } from 'vitest'
import { createWidgetConnection } from './widget-connection'
import { HandshakeTimeoutError } from '../shared/widget-bridge'
import type { HostMessage } from '../shared/widget-bridge'

// A fake contentWindow that plays the widget side: it grabs the transferred
// port and immediately replies `ready`, then records anything the host sends.
function fakeWidgetWindow(instanceId: string, sink: HostMessage[]) {
  return {
    postMessage(message: unknown, _targetOrigin: string, transfer?: Transferable[]) {
      const port = transfer?.[0] as MessagePort | undefined
      if (!port) return
      port.onmessage = (e: MessageEvent) => sink.push(e.data as HostMessage)
      port.start()
      port.postMessage({ type: 'ready', instanceId })
    },
  } as unknown as Window
}

describe('createWidgetConnection', () => {
  it('resolves after the widget replies ready', async () => {
    const sink: HostMessage[] = []
    const conn = createWidgetConnection({
      instanceId: 'inst-1',
      mode: 'small',
      targetOrigin: 'http://localhost',
      handlers: {},
    })

    const result = await conn.handshake(fakeWidgetWindow('inst-1', sink), 1000)
    expect(result).toBeUndefined() // no error
    conn.close()
  })

  it('invokes onRequestFullscreen when the widget asks', async () => {
    const sink: HostMessage[] = []
    const onRequestFullscreen = vi.fn()
    const channelWindow = {
      postMessage(_m: unknown, _o: string, transfer?: Transferable[]) {
        const port = transfer?.[0] as MessagePort
        port.start()
        port.postMessage({ type: 'ready', instanceId: 'inst-2' })
        port.postMessage({ type: 'request-fullscreen', instanceId: 'inst-2' })
      },
    } as unknown as Window

    const conn = createWidgetConnection({
      instanceId: 'inst-2',
      mode: 'small',
      targetOrigin: 'http://localhost',
      handlers: { onRequestFullscreen },
    })
    await conn.handshake(channelWindow, 1000)
    await vi.waitFor(() => expect(onRequestFullscreen).toHaveBeenCalledTimes(1))
    conn.close()
    void sink
  })

  it('rejects with HandshakeTimeoutError when ready never arrives', async () => {
    const silentWindow = { postMessage() {} } as unknown as Window
    const conn = createWidgetConnection({
      instanceId: 'inst-3',
      mode: 'small',
      targetOrigin: 'http://localhost',
      handlers: {},
    })
    const result = await conn.handshake(silentWindow, 20)
    expect(result).toBeInstanceOf(HandshakeTimeoutError)
    conn.close()
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm exec vitest run src/widget-host/widget-connection.test.ts`
Expected: FAIL — `widget-connection.ts` not found.

- [ ] **Step 3: Write `src/widget-host/widget-connection.ts`**

```ts
import {
  HandshakeTimeoutError,
  parseWidgetMessage,
} from '../shared/widget-bridge'
import type {
  HostMessage,
  WidgetErrorMessage,
  WidgetMode,
} from '../shared/widget-bridge'

export type WidgetConnectionHandlers = {
  onReady?: () => void
  onRequestFullscreen?: () => void
  onRequestClose?: () => void
  onWidgetError?: (message: WidgetErrorMessage) => void
}

export type CreateWidgetConnectionOptions = {
  instanceId: string
  mode: WidgetMode
  targetOrigin: string
  handlers: WidgetConnectionHandlers
}

export type WidgetConnection = {
  handshake: (contentWindow: Window, timeoutMs?: number) => Promise<HandshakeTimeoutError | void>
  send: (message: HostMessage) => void
  close: () => void
}

export function createWidgetConnection(
  options: CreateWidgetConnectionOptions,
): WidgetConnection {
  const { instanceId, mode, targetOrigin, handlers } = options
  const channel = new MessageChannel()
  let closed = false

  channel.port1.onmessage = (event: MessageEvent) => {
    const message = parseWidgetMessage(event.data)
    if (message instanceof Error) {
      console.warn(`[widget ${instanceId}] invalid message:`, message.message)
      return
    }
    if (message.type === 'ready') return handlers.onReady?.()
    if (message.type === 'request-fullscreen') return handlers.onRequestFullscreen?.()
    if (message.type === 'request-close') return handlers.onRequestClose?.()
    if (message.type === 'error') return handlers.onWidgetError?.(message)
  }
  channel.port1.start()

  function handshake(contentWindow: Window, timeoutMs = 5000): Promise<HandshakeTimeoutError | void> {
    return new Promise((resolve) => {
      const timer = setTimeout(() => {
        resolve(new HandshakeTimeoutError({ instanceId, timeoutMs }))
      }, timeoutMs)

      // Wrap the user's onReady so the first ready also resolves the handshake.
      const userOnReady = handlers.onReady
      handlers.onReady = () => {
        clearTimeout(timer)
        handlers.onReady = userOnReady
        userOnReady?.()
        resolve()
      }

      const init: HostMessage = { type: 'init', instanceId, mode }
      contentWindow.postMessage(init, targetOrigin, [channel.port2])
    })
  }

  function send(message: HostMessage) {
    if (closed) return
    channel.port1.postMessage(message)
  }

  function close() {
    closed = true
    channel.port1.onmessage = null
    channel.port1.close()
  }

  return { handshake, send, close }
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm exec vitest run src/widget-host/widget-connection.test.ts`
Expected: PASS (3 cases).

- [ ] **Step 5: Commit**

```bash
rtk git add -A && rtk git commit -m "feat(bridge): host-side WidgetConnection with handshake + routing

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

## Task 6: Widget registry

**Files:**
- Create: `src/widget-registry/registry.ts`
- Test: `src/widget-registry/registry.test.ts`

- [ ] **Step 1: Write the failing test**

```ts
import { describe, expect, it } from 'vitest'
import { findWidgetType, widgetTypes, UnknownWidgetTypeError } from './registry'

describe('widget registry', () => {
  it('contains the clock widget', () => {
    expect(widgetTypes.some((t) => t.id === 'clock')).toBe(true)
  })

  it('finds a known type', () => {
    const type = findWidgetType('clock')
    if (type instanceof Error) throw type
    expect(type.id).toBe('clock')
    expect(type.entry).toBe('/widgets/clock/index.html')
    expect(type.defaultSize).toEqual({ w: 3, h: 2 })
  })

  it('returns UnknownWidgetTypeError for an unknown type', () => {
    const result = findWidgetType('missing')
    expect(result).toBeInstanceOf(UnknownWidgetTypeError)
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm exec vitest run src/widget-registry/registry.test.ts`
Expected: FAIL — `registry.ts` not found.

- [ ] **Step 3: Write `src/widget-registry/registry.ts`**

```ts
import * as errore from 'errore'

export type WidgetType = {
  id: string
  title: string
  /** URL of the widget's HTML entry, relative to the app origin. */
  entry: string
  defaultSize: { w: number; h: number }
}

export class UnknownWidgetTypeError extends errore.createTaggedError({
  name: 'UnknownWidgetTypeError',
  message: 'Unknown widget type: $typeId',
}) {}

export const widgetTypes: WidgetType[] = [
  {
    id: 'clock',
    title: 'Clock',
    entry: '/widgets/clock/index.html',
    defaultSize: { w: 3, h: 2 },
  },
]

export function findWidgetType(typeId: string): UnknownWidgetTypeError | WidgetType {
  const type = widgetTypes.find((t) => t.id === typeId)
  if (!type) return new UnknownWidgetTypeError({ typeId })
  return type
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm exec vitest run src/widget-registry/registry.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
rtk git add -A && rtk git commit -m "feat(registry): widget type catalog with findWidgetType

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

## Task 7: Board storage (errore-wrapped localStorage)

**Files:**
- Create: `src/board-model/types.ts`
- Create: `src/board-model/board-storage.ts`
- Test: `src/board-model/board-storage.test.ts`

- [ ] **Step 1: Create `src/board-model/types.ts`**

```ts
export type WidgetInstance = { id: string; typeId: string }

export type LayoutItem = {
  i: string
  x: number
  y: number
  w: number
  h: number
  minW?: number
  minH?: number
}

export type BoardSnapshot = {
  instances: WidgetInstance[]
  layout: LayoutItem[]
}
```

- [ ] **Step 2: Write the failing test**

```ts
// @vitest-environment jsdom
import { afterEach, describe, expect, it } from 'vitest'
import { loadBoard, saveBoard, STORAGE_KEY } from './board-storage'
import { StorageError } from './board-storage'
import type { BoardSnapshot } from './types'

const snapshot: BoardSnapshot = {
  instances: [{ id: 'a', typeId: 'clock' }],
  layout: [{ i: 'a', x: 0, y: 0, w: 3, h: 4 }],
}

afterEach(() => localStorage.clear())

describe('board storage', () => {
  it('returns null when nothing is stored', () => {
    expect(loadBoard()).toBeNull()
  })

  it('round-trips a snapshot', () => {
    const saved = saveBoard(snapshot)
    expect(saved).toBeUndefined()
    expect(loadBoard()).toEqual(snapshot)
  })

  it('returns StorageError for corrupt JSON', () => {
    localStorage.setItem(STORAGE_KEY, '{not json')
    expect(loadBoard()).toBeInstanceOf(StorageError)
  })

  it('returns StorageError when the stored shape is wrong', () => {
    localStorage.setItem(STORAGE_KEY, JSON.stringify({ instances: 'nope' }))
    expect(loadBoard()).toBeInstanceOf(StorageError)
  })
})
```

- [ ] **Step 3: Run test to verify it fails**

Run: `pnpm exec vitest run src/board-model/board-storage.test.ts`
Expected: FAIL — `board-storage.ts` not found.

- [ ] **Step 4: Write `src/board-model/board-storage.ts`**

```ts
import * as errore from 'errore'
import type { BoardSnapshot } from './types'

export const STORAGE_KEY = 'myboard.board'

export class StorageError extends errore.createTaggedError({
  name: 'StorageError',
  message: 'Storage operation failed: $reason',
}) {}

function isSnapshot(value: unknown): value is BoardSnapshot {
  if (typeof value !== 'object' || value === null) return false
  const record = value as Record<string, unknown>
  return Array.isArray(record.instances) && Array.isArray(record.layout)
}

export function loadBoard(): StorageError | BoardSnapshot | null {
  const raw = errore.try(
    () => localStorage.getItem(STORAGE_KEY),
    (e) => new StorageError({ reason: 'read failed', cause: e }),
  )
  if (raw instanceof Error) return raw
  if (raw === null) return null

  const parsed = errore.try(
    () => JSON.parse(raw) as unknown,
    (e) => new StorageError({ reason: 'invalid JSON', cause: e }),
  )
  if (parsed instanceof Error) return parsed
  if (!isSnapshot(parsed)) return new StorageError({ reason: 'stored value has wrong shape' })

  return parsed
}

export function saveBoard(snapshot: BoardSnapshot): StorageError | void {
  const result = errore.try(
    () => localStorage.setItem(STORAGE_KEY, JSON.stringify(snapshot)),
    (e) => new StorageError({ reason: 'write failed', cause: e }),
  )
  if (result instanceof Error) return result
}
```

- [ ] **Step 5: Run test to verify it passes**

Run: `pnpm exec vitest run src/board-model/board-storage.test.ts`
Expected: PASS (4 cases).

- [ ] **Step 6: Commit**

```bash
rtk git add -A && rtk git commit -m "feat(board): errore-wrapped localStorage load/save

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

## Task 8: Board model (Reatom atoms + actions)

**Files:**
- Create: `src/board-model/board-model.ts`
- Test: `src/board-model/board-model.test.ts`

State for the board: `instances`, `layout`, and the UI atom `expandedInstanceId`. Actions mutate them. Persistence is wired with an `effect` that saves on every change; initial load happens in `initBoard()` called at app startup.

- [ ] **Step 1: Write the failing test**

```ts
// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { context } from '@reatom/core'
import {
  instances,
  layout,
  expandedInstanceId,
  addInstance,
  removeInstance,
  updateLayout,
} from './board-model'

beforeEach(() => {
  context.reset()
  localStorage.clear()
})
afterEach(() => localStorage.clear())

describe('board-model', () => {
  it('starts empty', () => {
    expect(instances()).toEqual([])
    expect(layout()).toEqual([])
  })

  it('adds an instance with a layout item sized from the registry', () => {
    const id = addInstance('clock')
    if (id instanceof Error) throw id

    expect(instances()).toHaveLength(1)
    expect(instances()[0]).toMatchObject({ id, typeId: 'clock' })

    const item = layout().find((l) => l.i === id)
    expect(item).toMatchObject({ w: 3, h: 2 })
  })

  it('returns an error when adding an unknown type', () => {
    const result = addInstance('nope')
    expect(result).toBeInstanceOf(Error)
    expect(instances()).toHaveLength(0)
  })

  it('removes an instance and its layout item', () => {
    const id = addInstance('clock')
    if (id instanceof Error) throw id
    removeInstance(id)
    expect(instances()).toHaveLength(0)
    expect(layout().some((l) => l.i === id)).toBe(false)
  })

  it('replaces the layout via updateLayout', () => {
    const next = [{ i: 'x', x: 1, y: 2, w: 3, h: 4 }]
    updateLayout(next)
    expect(layout()).toEqual(next)
  })

  it('tracks the expanded instance', () => {
    expect(expandedInstanceId()).toBeNull()
    expandedInstanceId.set('abc')
    expect(expandedInstanceId()).toBe('abc')
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm exec vitest run src/board-model/board-model.test.ts`
Expected: FAIL — `board-model.ts` not found.

- [ ] **Step 3: Write `src/board-model/board-model.ts`**

```ts
import { atom, action, effect } from '@reatom/core'
import { findWidgetType } from '../widget-registry/registry'
import { loadBoard, saveBoard } from './board-storage'
import type { LayoutItem, WidgetInstance } from './types'

export const instances = atom<WidgetInstance[]>([], 'board.instances')
export const layout = atom<LayoutItem[]>([], 'board.layout')
export const expandedInstanceId = atom<string | null>(null, 'board.expandedInstanceId')

export const addInstance = action((typeId: string) => {
  const type = findWidgetType(typeId)
  if (type instanceof Error) return type

  const id = crypto.randomUUID()
  instances.set((list) => [...list, { id, typeId }])
  layout.set((items) => [
    ...items,
    { i: id, x: 0, y: Infinity, w: type.defaultSize.w, h: type.defaultSize.h, minW: 2, minH: 2 },
  ])
  return id
}, 'board.addInstance')

export const removeInstance = action((id: string) => {
  instances.set((list) => list.filter((item) => item.id !== id))
  layout.set((items) => items.filter((item) => item.i !== id))
  if (expandedInstanceId() === id) expandedInstanceId.set(null)
}, 'board.removeInstance')

export const updateLayout = action((next: LayoutItem[]) => {
  layout.set(next)
}, 'board.updateLayout')

/** Load persisted board into the atoms. Call once at app startup. */
export const initBoard = action(() => {
  const snapshot = loadBoard()
  if (snapshot instanceof Error) {
    console.warn('Board load failed:', snapshot.message)
    return
  }
  if (snapshot === null) return
  instances.set(snapshot.instances)
  layout.set(snapshot.layout)
}, 'board.init')

// Persist on every change. The effect auto-subscribes to the atoms it reads.
effect(() => {
  const snapshot = { instances: instances(), layout: layout() }
  const result = saveBoard(snapshot)
  if (result instanceof Error) console.warn('Board save failed:', result.message)
}, 'board.persist')
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm exec vitest run src/board-model/board-model.test.ts`
Expected: PASS (6 cases).

> If `instances()` does not reset to `[]` between tests, confirm `context.reset()` runs in `beforeEach` (it clears the default global context). If `crypto.randomUUID` is undefined in the test env, upgrade Node to 19+ — jsdom uses Node's webcrypto.

- [ ] **Step 5: Commit**

```bash
rtk git add -A && rtk git commit -m "feat(board): Reatom board model with persistence effect

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

## Task 9: WidgetFrame component

**Files:**
- Create: `src/widget-host/WidgetFrame.tsx`
- Create: `src/widget-host/WidgetFrame.module.css`
- Test: `src/widget-host/WidgetFrame.test.tsx`

`WidgetFrame` renders one iframe for an instance in a given mode, drives the connection lifecycle, and shows an error card on load/handshake failure. The iframe's `src` carries `mode` and `instanceId`. Connection status is local React state (UI-only).

- [ ] **Step 1: Write the failing test**

```tsx
// @vitest-environment jsdom
import { describe, expect, it } from 'vitest'
import { render, screen } from '@testing-library/react'
import { WidgetFrame } from './WidgetFrame'

describe('WidgetFrame', () => {
  it('renders an iframe whose src carries the entry, mode and instanceId', () => {
    render(<WidgetFrame instanceId="inst-1" typeId="clock" mode="small" />)
    const iframe = screen.getByTitle('clock (inst-1)') as HTMLIFrameElement
    expect(iframe.src).toContain('/widgets/clock/index.html')
    expect(iframe.src).toContain('mode=small')
    expect(iframe.src).toContain('instanceId=inst-1')
  })

  it('shows an error card for an unknown widget type', () => {
    render(<WidgetFrame instanceId="inst-2" typeId="missing" mode="small" />)
    expect(screen.getByText(/widget unavailable/i)).toBeInTheDocument()
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm exec vitest run src/widget-host/WidgetFrame.test.tsx`
Expected: FAIL — `WidgetFrame.tsx` not found.

- [ ] **Step 3: Write `src/widget-host/WidgetFrame.module.css`**

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
  color: var(--danger);
}

.retry {
  padding: 4px 12px;
  border: 1px solid var(--border);
  border-radius: 6px;
  background: var(--surface-2);
  color: var(--text);
  cursor: pointer;
}
```

- [ ] **Step 4: Write `src/widget-host/WidgetFrame.tsx`**

```tsx
import { useEffect, useRef, useState } from 'react'
import { findWidgetType } from '../widget-registry/registry'
import { createWidgetConnection } from './widget-connection'
import { env } from '../env'
import type { WidgetMode } from '../shared/widget-bridge'
import styles from './WidgetFrame.module.css'

export type WidgetFrameProps = {
  instanceId: string
  typeId: string
  mode: WidgetMode
  onRequestFullscreen?: () => void
  onRequestClose?: () => void
}

type Status = 'connecting' | 'ready' | 'error'

export function WidgetFrame(props: WidgetFrameProps) {
  const { instanceId, typeId, mode, onRequestFullscreen, onRequestClose } = props
  const type = findWidgetType(typeId)
  const iframeRef = useRef<HTMLIFrameElement | null>(null)
  const [status, setStatus] = useState<Status>('connecting')
  const [reloadKey, setReloadKey] = useState(0)

  // `type` is a stable array reference for a valid id (so the effect does not
  // re-run every render); an unknown id makes the effect return early.
  const src =
    type instanceof Error
      ? ''
      : `${type.entry}?mode=${mode}&instanceId=${encodeURIComponent(instanceId)}`

  // All hooks run unconditionally (rules of hooks). The unknown-type branch is
  // a plain render-time early return AFTER the hooks below.
  useEffect(() => {
    if (type instanceof Error) return
    const iframe = iframeRef.current
    if (!iframe) return
    setStatus('connecting')

    const connection = createWidgetConnection({
      instanceId,
      mode,
      targetOrigin: window.location.origin,
      handlers: {
        onRequestFullscreen,
        onRequestClose,
        onWidgetError: (m) => console.warn(`[widget ${instanceId}] error:`, m.message),
      },
    })

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
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [instanceId, typeId, mode, reloadKey, onRequestFullscreen, onRequestClose])

  if (type instanceof Error) {
    return (
      <div className={styles.frame}>
        <div className={styles.errorCard}>
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
      {status === 'error' && (
        <div className={styles.errorCard}>
          <div>Widget failed to load</div>
          <button className={styles.retry} onClick={() => setReloadKey((k) => k + 1)}>
            Retry
          </button>
        </div>
      )}
    </div>
  )
}
```

- [ ] **Step 5: Run test to verify it passes**

Run: `pnpm exec vitest run src/widget-host/WidgetFrame.test.tsx`
Expected: PASS (2 cases). The handshake won't complete in jsdom (no real widget), so status stays `connecting` — both assertions only check the iframe attributes and the unknown-type card, which is fine.

- [ ] **Step 6: Commit**

```bash
rtk git add -A && rtk git commit -m "feat(host): WidgetFrame iframe + connection lifecycle + error card

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

## Task 10: Board component (react-grid-layout)

**Files:**
- Create: `src/board/Board.tsx`
- Create: `src/board/Board.module.css`
- Test: `src/board/Board.test.tsx`

`Board` reads `instances`/`layout` from the model, renders the grid, a toolbar to add the clock widget, and a card per instance (drag handle, expand, remove, small WidgetFrame). It is a `reatomComponent` so it re-renders on atom reads.

- [ ] **Step 1: Write the failing test**

```tsx
// @vitest-environment jsdom
import { beforeEach, describe, expect, it } from 'vitest'
import { context } from '@reatom/core'
import { render, screen, fireEvent, within } from '@testing-library/react'
import { Board } from './Board'
import { instances } from '../board-model/board-model'

beforeEach(() => {
  context.reset()
  localStorage.clear()
})

describe('Board', () => {
  it('adds a widget when the toolbar button is clicked', () => {
    render(<Board />)
    expect(instances()).toHaveLength(0)
    fireEvent.click(screen.getByRole('button', { name: /add clock/i }))
    expect(instances()).toHaveLength(1)
  })

  it('removes a widget via its remove button', () => {
    render(<Board />)
    fireEvent.click(screen.getByRole('button', { name: /add clock/i }))
    const card = screen.getByTestId('widget-card')
    fireEvent.click(within(card).getByRole('button', { name: /remove/i }))
    expect(instances()).toHaveLength(0)
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm exec vitest run src/board/Board.test.tsx`
Expected: FAIL — `Board.tsx` not found.

- [ ] **Step 3: Write `src/board/Board.module.css`**

```css
.root {
  min-height: 100%;
  padding: 12px;
}

.toolbar {
  display: flex;
  gap: 8px;
  padding: 8px 4px 16px;
}

.addButton {
  padding: 6px 14px;
  border: 1px solid var(--border);
  border-radius: 8px;
  background: var(--accent);
  color: white;
  cursor: pointer;
}

.card {
  display: flex;
  flex-direction: column;
  height: 100%;
  border: 1px solid var(--border);
  border-radius: 10px;
  overflow: hidden;
  background: var(--surface);
}

.header {
  display: flex;
  align-items: center;
  gap: 6px;
  padding: 4px 6px;
  background: var(--surface-2);
  border-bottom: 1px solid var(--border);
}

.handle {
  flex: 1;
  cursor: move;
  font-size: 12px;
  color: var(--text-dim);
  user-select: none;
}

.iconButton {
  border: 0;
  background: transparent;
  color: var(--text);
  cursor: pointer;
  padding: 2px 6px;
  border-radius: 4px;
}

.iconButton:hover { background: var(--border); }

.body {
  flex: 1;
  min-height: 0;
}
```

- [ ] **Step 4: Write `src/board/Board.tsx`**

```tsx
import GridLayout, { WidthProvider } from 'react-grid-layout'
import { reatomComponent } from '@reatom/react'
import {
  instances,
  layout,
  addInstance,
  removeInstance,
  updateLayout,
  expandedInstanceId,
} from '../board-model/board-model'
import { findWidgetType } from '../widget-registry/registry'
import { WidgetFrame } from '../widget-host/WidgetFrame'
import type { LayoutItem } from '../board-model/types'
import styles from './Board.module.css'

// WidthProvider must be created once, outside render, to avoid remounting.
const Grid = WidthProvider(GridLayout)

export const Board = reatomComponent(() => {
  const currentInstances = instances()
  const currentLayout = layout()

  return (
    <div className={styles.root}>
      <div className={styles.toolbar}>
        <button className={styles.addButton} onClick={() => addInstance('clock')}>
          Add clock
        </button>
      </div>

      <Grid
        className="layout"
        layout={currentLayout}
        cols={12}
        rowHeight={30}
        isDraggable
        isResizable
        draggableHandle={`.${styles.handle}`}
        onLayoutChange={(next: LayoutItem[]) => updateLayout(next)}
      >
        {currentInstances.map((instance) => {
          const type = findWidgetType(instance.typeId)
          const title = type instanceof Error ? instance.typeId : type.title
          return (
            <div key={instance.id} data-testid="widget-card" className={styles.card}>
              <div className={styles.header}>
                <span className={styles.handle}>{title}</span>
                <button
                  className={styles.iconButton}
                  aria-label="Expand"
                  onClick={() => expandedInstanceId.set(instance.id)}
                >
                  ⤢
                </button>
                <button
                  className={styles.iconButton}
                  aria-label="Remove"
                  onClick={() => removeInstance(instance.id)}
                >
                  ✕
                </button>
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
          )
        })}
      </Grid>
    </div>
  )
}, 'Board')
```

- [ ] **Step 5: Run test to verify it passes**

Run: `pnpm exec vitest run src/board/Board.test.tsx`
Expected: PASS (2 cases).

> If `reatomComponent` import fails, check the React adapter's exact export name with `rtk pnpm ls @reatom/react` and the package's `dist` types; the v1000 handbook documents `reatomComponent` as the binding. If the installed adapter exposes `useAtom` instead, wrap reads with `useAtom(instances)` and keep the rest identical.

- [ ] **Step 6: Commit**

```bash
rtk git add -A && rtk git commit -m "feat(board): grid board with add/remove/expand and small frames

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

## Task 11: Fullscreen overlay

**Files:**
- Create: `src/widget-host/FullscreenOverlay.tsx`
- Create: `src/widget-host/FullscreenOverlay.module.css`
- Test: `src/widget-host/FullscreenOverlay.test.tsx`

- [ ] **Step 1: Write the failing test**

```tsx
// @vitest-environment jsdom
import { beforeEach, describe, expect, it } from 'vitest'
import { context } from '@reatom/core'
import { render, screen, fireEvent } from '@testing-library/react'
import { FullscreenOverlay } from './FullscreenOverlay'
import { instances, expandedInstanceId, addInstance } from '../board-model/board-model'

beforeEach(() => {
  context.reset()
  localStorage.clear()
})

describe('FullscreenOverlay', () => {
  it('renders nothing when no instance is expanded', () => {
    const { container } = render(<FullscreenOverlay />)
    expect(container).toBeEmptyDOMElement()
  })

  it('renders a large frame for the expanded instance and closes', () => {
    const id = addInstance('clock')
    if (id instanceof Error) throw id
    expandedInstanceId.set(id)

    render(<FullscreenOverlay />)
    expect(screen.getByTitle(`clock (${id})`)).toBeInTheDocument()

    fireEvent.click(screen.getByRole('button', { name: /close/i }))
    expect(expandedInstanceId()).toBeNull()
    void instances
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm exec vitest run src/widget-host/FullscreenOverlay.test.tsx`
Expected: FAIL — `FullscreenOverlay.tsx` not found.

- [ ] **Step 3: Write `src/widget-host/FullscreenOverlay.module.css`**

```css
.backdrop {
  position: fixed;
  inset: 0;
  z-index: 50;
  display: flex;
  flex-direction: column;
  background: rgba(8, 10, 14, 0.85);
}

.bar {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 10px 16px;
  border-bottom: 1px solid var(--border);
}

.title { color: var(--text); font-size: 14px; }

.close {
  padding: 6px 12px;
  border: 1px solid var(--border);
  border-radius: 8px;
  background: var(--surface-2);
  color: var(--text);
  cursor: pointer;
}

.body { flex: 1; min-height: 0; }
```

- [ ] **Step 4: Write `src/widget-host/FullscreenOverlay.tsx`**

```tsx
import { reatomComponent } from '@reatom/react'
import { instances, expandedInstanceId } from '../board-model/board-model'
import { findWidgetType } from '../widget-registry/registry'
import { WidgetFrame } from './WidgetFrame'
import styles from './FullscreenOverlay.module.css'

export const FullscreenOverlay = reatomComponent(() => {
  const id = expandedInstanceId()
  if (id === null) return null

  const instance = instances().find((item) => item.id === id)
  if (!instance) return null

  const type = findWidgetType(instance.typeId)
  const title = type instanceof Error ? instance.typeId : type.title
  const close = () => expandedInstanceId.set(null)

  return (
    <div className={styles.backdrop}>
      <div className={styles.bar}>
        <span className={styles.title}>{title}</span>
        <button className={styles.close} aria-label="Close" onClick={close}>
          Close ✕
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

- [ ] **Step 5: Run test to verify it passes**

Run: `pnpm exec vitest run src/widget-host/FullscreenOverlay.test.tsx`
Expected: PASS (2 cases).

- [ ] **Step 6: Commit**

```bash
rtk git add -A && rtk git commit -m "feat(host): fullscreen overlay rendering large-mode frame

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

## Task 12: App shell + error boundary + bootstrap

**Files:**
- Create: `src/app/ErrorBoundary.tsx`
- Create: `src/app/App.module.css`
- Modify: `src/app/App.tsx` (replace placeholder from Task 1)
- Modify: `src/app/main.tsx` (add `initBoard()` call)

- [ ] **Step 1: Write `src/app/ErrorBoundary.tsx`**

```tsx
import { Component, type ReactNode } from 'react'

type Props = { children: ReactNode }
type State = { error: Error | null }

export class ErrorBoundary extends Component<Props, State> {
  state: State = { error: null }

  static getDerivedStateFromError(error: Error): State {
    return { error }
  }

  componentDidCatch(error: Error) {
    console.error('Host render error:', error)
  }

  render() {
    if (this.state.error) {
      return (
        <div style={{ padding: 24, color: 'var(--danger)' }}>
          <h2>Something went wrong</h2>
          <pre>{this.state.error.message}</pre>
        </div>
      )
    }
    return this.props.children
  }
}
```

- [ ] **Step 2: Write `src/app/App.module.css`**

```css
.app {
  height: 100%;
  overflow: auto;
}
```

- [ ] **Step 3: Replace `src/app/App.tsx`**

```tsx
import { ErrorBoundary } from './ErrorBoundary'
import { Board } from '../board/Board'
import { FullscreenOverlay } from '../widget-host/FullscreenOverlay'
import styles from './App.module.css'

export function App() {
  return (
    <ErrorBoundary>
      <div className={styles.app}>
        <Board />
        <FullscreenOverlay />
      </div>
    </ErrorBoundary>
  )
}
```

- [ ] **Step 4: Update `src/app/main.tsx` to initialize the board**

```tsx
import '../setup'
import './global.css'
import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { App } from './App'
import { initBoard } from '../board-model/board-model'

initBoard()

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
  </StrictMode>,
)
```

- [ ] **Step 5: Typecheck**

Run: `rtk pnpm run typecheck`
Expected: no errors.

- [ ] **Step 6: Commit**

```bash
rtk git add -A && rtk git commit -m "feat(app): shell with error boundary and board bootstrap

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

## Task 13: Clock widget

**Files:**
- Create: `widgets/clock/index.html`
- Create: `widgets/clock/main.tsx`
- Create: `widgets/clock/Clock.tsx`
- Create: `widgets/clock/clock.module.css`

The clock is the first real widget and proves the infrastructure end to end. It connects via `createWidgetClient`, reads its `mode`, and renders the **small** view (time only) or the **large** view (time + full date). Clicking the small view requests fullscreen; the large view has a close button — exercising both bridge requests. It is deliberately simple and self-contained: no external data, no host storage, just a 1-second tick.

- [ ] **Step 1: Create `widgets/clock/index.html`**

```html
<!doctype html>
<html lang="en">
  <head>
    <meta charset="UTF-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1.0" />
    <title>Clock Widget</title>
  </head>
  <body style="margin: 0">
    <div id="root"></div>
    <script type="module" src="./main.tsx"></script>
  </body>
</html>
```

- [ ] **Step 2: Create `widgets/clock/clock.module.css`**

```css
.root {
  height: 100vh;
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  gap: 8px;
  font-family: system-ui, sans-serif;
  background: #12151c;
  color: #e6e9ef;
  user-select: none;
}

/* small view: the whole area is a button that opens fullscreen */
.smallButton {
  width: 100%;
  height: 100vh;
  border: 0;
  background: #12151c;
  color: #e6e9ef;
  cursor: pointer;
  display: flex;
  align-items: center;
  justify-content: center;
  font-family: system-ui, sans-serif;
}

.timeSmall {
  font-size: clamp(20px, 12vw, 56px);
  font-variant-numeric: tabular-nums;
  letter-spacing: 1px;
}

.timeLarge {
  font-size: clamp(48px, 18vw, 160px);
  font-variant-numeric: tabular-nums;
  letter-spacing: 2px;
}

.date {
  font-size: clamp(14px, 3vw, 28px);
  color: #9aa3b1;
}

.btn {
  margin-top: 16px;
  padding: 8px 16px;
  border: 1px solid #2e3441;
  border-radius: 8px;
  background: #232834;
  color: #e6e9ef;
  cursor: pointer;
}
```

- [ ] **Step 3: Create `widgets/clock/Clock.tsx`**

```tsx
import { useEffect, useState } from 'react'
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
  // Subscribe once; onModeChange returns an unsubscribe used for cleanup.
  useEffect(() => client.onModeChange(setMode), [client])
  const now = useNow()

  if (mode === 'large') {
    return (
      <div className={styles.root}>
        <div className={styles.timeLarge}>{timeFmt.format(now)}</div>
        <div className={styles.date}>{dateFmt.format(now)}</div>
        <button className={styles.btn} onClick={() => client.requestClose()}>
          Close
        </button>
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
    </button>
  )
}
```

- [ ] **Step 4: Create `widgets/clock/main.tsx`**

```tsx
import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { createWidgetClient } from '../../src/shared/widget-bridge'
import { Clock } from './Clock'

const root = createRoot(document.getElementById('root')!)

const client = await createWidgetClient()
if (client instanceof Error) {
  root.render(<div style={{ color: '#ff5d5d', padding: 16 }}>Bridge error: {client.message}</div>)
} else {
  root.render(
    <StrictMode>
      <Clock client={client} />
    </StrictMode>,
  )
}
```

> Top-level `await` is supported in ES modules bundled by Vite. The TS `"target": "ES2022"` (already set) allows it.

- [ ] **Step 5: Typecheck**

Run: `rtk pnpm run typecheck`
Expected: no errors.

- [ ] **Step 6: Commit**

```bash
rtk git add -A && rtk git commit -m "feat(widget): clock widget (time small / time+date large) via bridge SDK

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

## Task 14: End-to-end bridge integration test

**Files:**
- Create: `tests/bridge-handshake.test.ts`

Proves the host connection and the widget client agree on the protocol, wired port-to-port through a single `MessageChannel`, with no DOM.

- [ ] **Step 1: Write the test**

```ts
import { describe, expect, it, vi } from 'vitest'
import { createWidgetConnection } from '../src/widget-host/widget-connection'
import { parseWidgetMessage, parseHostMessage } from '../src/shared/widget-bridge'

// Minimal widget that mirrors createWidgetClient's port behavior without a DOM:
// it receives a port via the host's postMessage transfer and replies ready,
// then forwards a request-fullscreen.
function attachFakeWidget(port: MessagePort, instanceId: string) {
  port.onmessage = (e: MessageEvent) => {
    const msg = parseHostMessage(e.data)
    if (msg instanceof Error) return
    if (msg.type === 'init') {
      port.postMessage({ type: 'ready', instanceId })
      port.postMessage({ type: 'request-fullscreen', instanceId })
    }
  }
  port.start()
}

describe('host ↔ widget handshake (integration)', () => {
  it('completes handshake and routes request-fullscreen', async () => {
    const onRequestFullscreen = vi.fn()
    const onReady = vi.fn()

    const fakeWindow = {
      postMessage(message: unknown, _origin: string, transfer?: Transferable[]) {
        const port = transfer?.[0] as MessagePort
        // The widget receives the init payload on its port, so re-deliver it there.
        attachFakeWidget(port, 'inst-int')
        // Deliver the init message to the widget's port (the host sent it via postMessage).
        port.dispatchEvent(new MessageEvent('message', { data: message }))
      },
    } as unknown as Window

    const conn = createWidgetConnection({
      instanceId: 'inst-int',
      mode: 'small',
      targetOrigin: '*',
      handlers: { onReady, onRequestFullscreen },
    })

    const result = await conn.handshake(fakeWindow, 1000)
    expect(result).toBeUndefined()
    expect(onReady).toHaveBeenCalledTimes(1)
    await vi.waitFor(() => expect(onRequestFullscreen).toHaveBeenCalledTimes(1))

    // sanity: protocol parsers agree
    expect(parseWidgetMessage({ type: 'ready', instanceId: 'x' })).toEqual({
      type: 'ready',
      instanceId: 'x',
    })
    conn.close()
  })
})
```

> Note: in the real browser the widget's `init` arrives via `window.postMessage` with the port in `event.ports[0]`; this test injects the port directly and re-delivers the init payload onto that port to keep the test DOM-free. The production handshake is exercised manually in Task 15.

- [ ] **Step 2: Run the test**

Run: `pnpm exec vitest run tests/bridge-handshake.test.ts`
Expected: PASS. If `MessagePort.dispatchEvent` is unavailable in the test environment, change `// @vitest-environment` to `jsdom` at the top of the file (jsdom provides `MessageChannel`/`MessagePort` with `dispatchEvent`).

- [ ] **Step 3: Run the full suite**

Run: `rtk pnpm test`
Expected: all test files PASS.

- [ ] **Step 4: Commit**

```bash
rtk git add -A && rtk git commit -m "test: end-to-end host/widget handshake integration

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

## Task 15: Manual verification (dev + build)

**Files:** none (verification only)

- [ ] **Step 1: Start the dev server**

Run: `rtk pnpm run dev`
Open the printed URL in a browser.

- [ ] **Step 2: Verify the full flow**

Confirm each, by observation:
1. Click **Add clock** → a card appears on the board showing the clock's **small** view (current time, `HH:MM:SS`).
2. The small view **ticks every second** (proves the widget runs live inside its iframe).
3. **Drag** the card by its header → it moves; **resize** from the corner → it resizes.
4. Click the card's **⤢ (Expand)**, or click the clock's small view, or the widget's request → the fullscreen overlay opens showing the **large** view (large time **plus the full date**).
5. In the overlay click the host **Close** bar button or the widget's **Close** → returns to the board (exercises both the host close and the widget's `request-close`).
6. **Reload the page** → the previously added widget(s) and their positions persist (localStorage).
7. Remove a widget with **✕** → it disappears and stays gone after reload.

- [ ] **Step 3: Verify a production build**

Run: `rtk pnpm run build`
Expected: `tsc -b` passes and Vite emits **two** HTML entries (`index.html` and the clock widget, auto-discovered from `widgets/`) under `dist/`. Run `rtk pnpm run preview` and repeat the smoke check from Step 2.

- [ ] **Step 4: Final commit (if any build config tweaks were needed)**

```bash
rtk git add -A && rtk git commit -m "chore: verify dev + production multi-entry build

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

## Self-Review Notes (for the implementer)

- **Spec §2 scope** is fully covered: board CRUD (Task 8, 10), iframe isolation + bridge (Tasks 2–5), small/large views (Tasks 10, 11), clock widget proving the infra (Task 13), errore at every boundary (Tasks 2, 7, parse/connection, env). Deferred items (KV storage, IndexedDB, separate origin, theming) are intentionally absent.
- **Type consistency:** message unions defined once in `messages.ts` and imported everywhere; `LayoutItem` defined once in `board-model/types.ts` and used by the model, RGL `onLayoutChange`, and storage; `WidgetType.entry` is always `/widgets/<id>/index.html`; the only widget id is `clock`.
- **Config additions:** `vite.config.ts` auto-discovers widget entries from `widgets/<name>/index.html`, so adding a widget needs no config edit (only a new registry entry for board metadata). Env is validated once with zod in `src/env.ts` (testable `parseEnv` boundary + fail-fast `env`); its one custom var `VITE_WIDGET_HANDSHAKE_TIMEOUT_MS` feeds the host handshake (Task 9).
- **Known environment caveats flagged inline:** exact `@reatom/react` version/exports (Tasks 1, 10), `crypto.randomUUID` needing Node 19+ (Task 8), and the `MessagePort.dispatchEvent` env note (Task 14).
```
