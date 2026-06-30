# Widget Runtime + SDK Extraction Implementation Plan (Plan 1 of 3)

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Extract the board-internal code that widgets depend on into two new source-only workspace packages — `widget-runtime` (live-connection singletons) and `widget-sdk` (stateless React glue + UI) — with zero behavior change and all existing tests, typecheck, build, and e2e staying green.

**Architecture:** Both packages are *source-only* (no build step), consumed through path aliases exactly like the existing `shared` package (`@shared/*`). The board keeps its current `@/...` imports unchanged: per-area alias redirects point those paths at the new packages, so board source is barely touched. Widgets (still bundled into the client via `@widgets` in this plan) switch their imports from `@/...` to the new package names, which is the forward-prep that lets them become standalone packages in Plan 2.

**Tech Stack:** pnpm workspaces + catalog, Vite 8 (Rolldown) / Vitest 4, TypeScript (`moduleResolution: bundler`), React 19, `@reatom/core` + `@reatom/react`, Dexie, Zod, errore.

## Global Constraints

- No behavior change. This is a pure refactor; the only acceptance signal is that the **existing** test suite, `pnpm typecheck`, `pnpm build`, and `pnpm test:e2e` all stay green. Do not add features.
- Every exported React function component stays wrapped with `reatomMemo` (project hard rule). Moving `reatomMemo` must not change any call site's wrapping.
- errore pattern: errors are values (`Error | T` unions, tagged errors), never thrown for control flow. Moved code keeps its existing error handling verbatim.
- The new packages are **source-only**, consumed via aliases (`widget-runtime/*`, `widget-sdk/*`) — no `tsc`/bundler build step is added for them, mirroring how `shared` is consumed today.
- Shared dependency versions come from the pnpm `catalog` (`catalog:` specifier) wherever a catalog entry exists (`react`, `react-dom`, `@reatom/core`, `zod`, `lucide-react`, `@testing-library/react`, `vitest`, `@types/react`, `@types/react-dom`).
- After this plan, **no file under `widgets/` imports from `@/...`** (it may still import `@shared/...`). This is verified in Task 11.
- Commit after every task. Use the existing commit-message style; do not push.

---

## File Structure

New packages (final layout after this plan):

```text
widget-runtime/                 # live connections + runtime contract types (Plan 2: federation singleton)
  package.json
  tsconfig.json
  vitest.config.ts
  vitest.setup.ts               # BroadcastChannel/EventSource/Temporal polyfills (from client setup)
  src/
    storage/                    # ← client/src/storage/model/* (whole tree, incl. *.test.ts)
      storage.ts types.ts scope.ts validate.ts subscribe-key.ts
      client/{db,dexie-storage,channel}.ts
      server/{http-storage,sse-client}.ts
      reatom/reatom-storage.ts
      test/fakes.ts
    widget-api/widget-api.ts    # ← client/src/widget-api/widget-api.ts
    timer/{server-time,http-time,fakes}.ts  # ← client/src/shared/timer/model/*
    tier.ts                     # ← client/src/widget-host/model/tier.ts
    types.ts                    # ← client/src/widget-host/model/types.ts (WidgetRuntimeProps, WidgetComponent[Module], WidgetLoader, WidgetMode)
    theme.ts                    # ResolvedTheme (extracted so the runtime contract has no board import)

widget-sdk/                     # stateless React glue + UI (Plan 2: shared, not singleton)
  package.json
  tsconfig.json
  vitest.config.ts
  vitest.setup.ts               # jest-dom + ResizeObserver/matchMedia (from client setup)
  src/
    reatom/{reatom-memo,use-atom-value}.ts  # ← client/src/shared/reatom/*
    define-widget-client.ts     # ← client/src/widget-registry/model/widget-definition.ts
    tier.ts is NOT here         # tier lives in widget-runtime (see architecture note below)
    vite-dev-config.ts          # NEW: shared dev Vite config factory (/api proxy + remoteHmr seam)
    lib/utils.ts                # ← client/src/lib/utils.ts (cn)
    ui/
      WidgetControls.tsx + .module.css  # ← client/src/widget-host/ui/WidgetControls.*
      tabs.tsx                  # ← client/src/components/ui/tabs.tsx
```

**Architecture note — why `tier` is in `widget-runtime`, not `widget-sdk`:** the brainstorm placed `tier` in `widget-sdk`, but `WidgetRuntimeProps.tier: WidgetTier` (a runtime contract type) and `define-widget-client` (sdk) both reference `tier`. If `tier` lived in `widget-sdk` while the contract types lived in `widget-runtime`, the two packages would import each other (a cycle). Co-locating `tier` with the contract types in `widget-runtime` keeps the dependency one-way (`widget-sdk → widget-runtime`). `tier` is pure logic with no live state, so this does not affect the singleton boundary. This is the one deviation from the spec's package table and is intentional.

**Board-side alias redirects** (added incrementally, each in the task that performs the matching move) so board `@/...` imports resolve to the packages without editing board source:

| Board import prefix | Redirects to |
| --- | --- |
| `@/storage/model` | `../widget-runtime/src/storage` |
| `@/widget-api` | `../widget-runtime/src/widget-api` |
| `@/shared/timer/model` | `../widget-runtime/src/timer` |
| `@/widget-host/model/tier` | `../widget-runtime/src/tier` |
| `@/widget-host/model/types` | `../widget-runtime/src/types` |
| `@/shared/reatom` | `../widget-sdk/src/reatom` |
| `@/widget-registry/model/widget-definition` | `../widget-sdk/src/define-widget-client` |
| `@/lib/utils` | `../widget-sdk/src/lib/utils` |
| `@/components/ui/tabs` | `../widget-sdk/src/ui/tabs` |
| `@/widget-host/ui/WidgetControls` | `../widget-sdk/src/ui/WidgetControls` |

Plus two base aliases (added once in Task 1): `widget-runtime` → `../widget-runtime/src`, `widget-sdk` → `../widget-sdk/src`.

**Widget import remap** (applied in Task 10):

| Old (`widgets/*`) | New |
| --- | --- |
| `@/storage/model/storage` | `widget-runtime/storage/storage` |
| `@/storage/model/types` | `widget-runtime/storage/types` |
| `@/storage/model/reatom/reatom-storage` | `widget-runtime/storage/reatom/reatom-storage` |
| `@/storage/model/test/fakes` | `widget-runtime/storage/test/fakes` |
| `@/shared/timer/model/server-time` | `widget-runtime/timer/server-time` |
| `@/shared/timer/model/fakes` | `widget-runtime/timer/fakes` |
| `@/widget-host/model/tier` | `widget-runtime/tier` |
| `@/widget-host/model/types` | `widget-runtime/types` |
| `@/shared/reatom/reatom-memo` | `widget-sdk/reatom/reatom-memo` |
| `@/shared/reatom/use-atom-value` | `widget-sdk/reatom/use-atom-value` |
| `@/widget-registry/model/widget-definition` | `widget-sdk/define-widget-client` |
| `@/components/ui/tabs` | `widget-sdk/ui/tabs` |
| `@/widget-host/ui/WidgetControls` | `widget-sdk/ui/WidgetControls` |
| `@shared/widgets/contracts` | unchanged |

---

## Task 1: Scaffold both packages and base aliases

**Files:**
- Create: `widget-runtime/package.json`, `widget-runtime/tsconfig.json`, `widget-runtime/vitest.config.ts`, `widget-runtime/vitest.setup.ts`, `widget-runtime/src/.gitkeep`
- Create: `widget-sdk/package.json`, `widget-sdk/tsconfig.json`, `widget-sdk/vitest.config.ts`, `widget-sdk/vitest.setup.ts`, `widget-sdk/src/.gitkeep`
- Modify: `pnpm-workspace.yaml`, `client/vite.config.ts` (resolve.alias), `client/tsconfig.json` (paths)

**Interfaces:**
- Produces: workspace packages `widget-runtime` and `widget-sdk`; aliases `widget-runtime` → `../widget-runtime/src`, `widget-sdk` → `../widget-sdk/src` resolvable from the client (vite + tsc + vitest).

- [ ] **Step 1: Baseline — confirm the suite is green before touching anything**

Run: `pnpm install && pnpm typecheck && pnpm test`
Expected: install succeeds; typecheck reports no errors; all tests pass (exit 0). Record this as the baseline.

- [ ] **Step 2: Add the packages to the workspace**

Edit `pnpm-workspace.yaml` — add the two packages to `packages:`:

```yaml
packages:
  - client
  - server
  - shared
  - widgets
  - widget-runtime
  - widget-sdk
```

- [ ] **Step 3: Write `widget-runtime/package.json`**

```json
{
  "name": "widget-runtime",
  "version": "0.0.0",
  "private": true,
  "type": "module",
  "scripts": {
    "typecheck": "tsc --noEmit",
    "test": "vitest run"
  },
  "dependencies": {
    "@reatom/core": "catalog:",
    "@reatom/react": "^1001.0.0",
    "dexie": "^4.4.4",
    "errore": "*",
    "react": "catalog:",
    "zod": "catalog:"
  },
  "devDependencies": {
    "@types/react": "catalog:",
    "fake-indexeddb": "*",
    "jsdom": "*",
    "react-dom": "catalog:",
    "vitest": "catalog:"
  }
}
```

Set `errore`, `fake-indexeddb`, and `jsdom` to the exact versions already pinned in `client/package.json` (read them from that file rather than using `*`).

- [ ] **Step 4: Write `widget-sdk/package.json`**

```json
{
  "name": "widget-sdk",
  "version": "0.0.0",
  "private": true,
  "type": "module",
  "scripts": {
    "typecheck": "tsc --noEmit",
    "test": "vitest run"
  },
  "dependencies": {
    "@reatom/core": "catalog:",
    "@reatom/react": "^1001.0.0",
    "clsx": "*",
    "lucide-react": "catalog:",
    "radix-ui": "^1.6.0",
    "react": "catalog:",
    "tailwind-merge": "*",
    "widget-runtime": "workspace:*"
  },
  "devDependencies": {
    "@testing-library/jest-dom": "*",
    "@testing-library/react": "catalog:",
    "@types/react": "catalog:",
    "jsdom": "*",
    "react-dom": "catalog:",
    "vitest": "catalog:"
  }
}
```

Set `clsx`, `tailwind-merge`, `@testing-library/jest-dom`, and `jsdom` to the exact versions from `client/package.json`.

- [ ] **Step 5: Write `widget-runtime/tsconfig.json`**

```json
{
  "compilerOptions": {
    "target": "ESNext",
    "lib": ["ES2023", "ESNext", "DOM", "DOM.Iterable"],
    "module": "ESNext",
    "moduleResolution": "bundler",
    "ignoreDeprecations": "6.0",
    "baseUrl": ".",
    "jsx": "react-jsx",
    "strict": true,
    "noUnusedLocals": true,
    "noUnusedParameters": true,
    "skipLibCheck": true,
    "noEmit": true,
    "types": ["vitest/globals", "@testing-library/jest-dom"],
    "paths": {
      "@shared/*": ["../shared/*"],
      "widget-runtime/*": ["./src/*"]
    }
  },
  "include": ["src"]
}
```

- [ ] **Step 6: Write `widget-sdk/tsconfig.json`** (same shape, with the cross-package alias to `widget-runtime`)

```json
{
  "compilerOptions": {
    "target": "ESNext",
    "lib": ["ES2023", "ESNext", "DOM", "DOM.Iterable"],
    "module": "ESNext",
    "moduleResolution": "bundler",
    "ignoreDeprecations": "6.0",
    "baseUrl": ".",
    "jsx": "react-jsx",
    "strict": true,
    "noUnusedLocals": true,
    "noUnusedParameters": true,
    "skipLibCheck": true,
    "noEmit": true,
    "types": ["vitest/globals", "@testing-library/jest-dom"],
    "paths": {
      "@shared/*": ["../shared/*"],
      "widget-runtime/*": ["../widget-runtime/src/*"],
      "widget-sdk/*": ["./src/*"]
    }
  },
  "include": ["src"]
}
```

- [ ] **Step 7: Write `widget-runtime/vitest.config.ts`** (jsdom + setup + Temporal flag, mirroring the client)

```ts
import path from 'node:path'

import { defineConfig } from 'vitest/config'

export default defineConfig({
  resolve: {
    alias: {
      '@shared': path.resolve(import.meta.dirname, '../shared'),
      'widget-runtime': path.resolve(import.meta.dirname, './src'),
    },
  },
  test: {
    globals: true,
    environment: 'jsdom',
    setupFiles: ['./vitest.setup.ts'],
    execArgv: ['--harmony-temporal'],
  },
})
```

- [ ] **Step 8: Write `widget-runtime/vitest.setup.ts`**

Copy the BroadcastChannel polyfill, the EventSource polyfill, and the `node:vm` Temporal block from `client/src/vitest.setup.ts` verbatim (these are the globals the storage/timer tests rely on). Omit the `@testing-library/jest-dom` import, ResizeObserver, and matchMedia — the runtime package has no component tests.

```ts
// jsdom lacks BroadcastChannel; the storage layer broadcasts key changes across tabs.
if (typeof globalThis.BroadcastChannel === 'undefined') {
  // ...exact copy of the BroadcastChannelPolyfill block from client/src/vitest.setup.ts...
}

if (typeof globalThis.EventSource === 'undefined') {
  // ...exact copy of the EventSourcePolyfill block...
}

// @ts-expect-error node:vm is a Node builtin not typed in browser context
import vm from 'node:vm'
try {
  const nodeGlobalTemporal = vm.runInThisContext('Temporal')
  if (nodeGlobalTemporal) {
    ;(globalThis as any).Temporal = nodeGlobalTemporal
  }
} catch {
  // Ignore
}
```

- [ ] **Step 9: Write `widget-sdk/vitest.config.ts`**

```ts
import path from 'node:path'

import { defineConfig } from 'vitest/config'

export default defineConfig({
  resolve: {
    alias: {
      '@shared': path.resolve(import.meta.dirname, '../shared'),
      'widget-runtime': path.resolve(import.meta.dirname, '../widget-runtime/src'),
      'widget-sdk': path.resolve(import.meta.dirname, './src'),
    },
  },
  test: {
    globals: true,
    environment: 'jsdom',
    setupFiles: ['./vitest.setup.ts'],
  },
})
```

- [ ] **Step 10: Write `widget-sdk/vitest.setup.ts`** (component-test globals)

Copy the `@testing-library/jest-dom/vitest` import, the ResizeObserverMock block, and the matchMedia block from `client/src/vitest.setup.ts` verbatim.

```ts
import '@testing-library/jest-dom/vitest'

// ...exact copy of the ResizeObserverMock block...
// ...exact copy of the matchMedia block...
```

- [ ] **Step 11: Add the two base aliases to the client (vite + tsc)**

In `client/vite.config.ts`, convert `resolve.alias` to **array form** (so ordering is explicit; specific entries added in later tasks must precede the bare `@` entry) and add the two base aliases:

```ts
  resolve: {
    alias: [
      // widget package base aliases (specific @/... redirects get inserted ABOVE the '@' entry in later tasks)
      { find: 'widget-runtime', replacement: resolve(__dirname, '../widget-runtime/src') },
      { find: 'widget-sdk', replacement: resolve(__dirname, '../widget-sdk/src') },
      { find: '@', replacement: resolve(__dirname, './src') },
      { find: '@shared', replacement: resolve(__dirname, '../shared') },
      { find: '@widgets', replacement: resolve(__dirname, '../widgets') },
    ],
  },
```

In `client/tsconfig.json`, add to `paths` (these don't conflict with `@/*`):

```json
      "widget-runtime/*": ["../widget-runtime/src/*"],
      "widget-sdk/*": ["../widget-sdk/src/*"],
```

- [ ] **Step 12: Install and verify nothing regressed**

Run: `pnpm install && pnpm typecheck && pnpm test`
Expected: install links the two new workspace packages; typecheck no errors; all tests pass. Nothing imports the new packages yet, so this only proves the scaffold is inert.

- [ ] **Step 13: Commit**

```bash
git add pnpm-workspace.yaml widget-runtime widget-sdk client/vite.config.ts client/tsconfig.json pnpm-lock.yaml
git commit -m "feat(widgets): scaffold widget-runtime and widget-sdk packages"
```

---

## Task 2: Move the storage tree into `widget-runtime`

**Files:**
- Move: `client/src/storage/model/**` → `widget-runtime/src/storage/**` (every file, including `*.test.ts`)
- Modify: `client/vite.config.ts`, `client/tsconfig.json` (add `@/storage/model` redirect)

**Interfaces:**
- Consumes: base aliases from Task 1.
- Produces: `widget-runtime/storage/storage` (`makeWidgetStorage`, `WidgetStorage`), `widget-runtime/storage/types` (`StorageApi`, `StorageListener`), `widget-runtime/storage/reatom/reatom-storage` (`withStorageKeyReadonly`, …), `widget-runtime/storage/test/fakes`. The storage tree's only external import is `@shared/storage/scope` (already aliased in the package configs).

- [ ] **Step 1: Move the whole tree (preserves git history and co-located tests)**

```bash
mkdir -p widget-runtime/src/storage
git mv client/src/storage/model/* widget-runtime/src/storage/
git rm -r client/src/storage   # remove the now-empty directory
```

No edits to the moved files are needed: their cross-imports are all relative (resolve unchanged after the move) and their only alias import is `@shared/storage/scope`, which `widget-runtime` aliases.

- [ ] **Step 2: Add the board redirect so existing `@/storage/model/...` imports keep resolving**

In `client/vite.config.ts`, insert ABOVE the `{ find: '@', ... }` entry:

```ts
      { find: '@/storage/model', replacement: resolve(__dirname, '../widget-runtime/src/storage') },
```

In `client/tsconfig.json` `paths`, add (TS picks the most specific match):

```json
      "@/storage/model/*": ["../widget-runtime/src/storage/*"],
```

- [ ] **Step 3: Run the moved tests under the runtime package**

Run: `pnpm --filter widget-runtime test`
Expected: the storage suite (`storage.test.ts`, `dexie-storage.test.ts`, `reatom-storage.test.ts`, `channel.test.ts`, `scope.test.ts`, `subscribe-key.test.ts`, `validate.test.ts`, `http-storage.test.ts`, `sse-client.test.ts`, `fakes.test.ts`) runs and passes under `widget-runtime`'s vitest (jsdom + polyfills + fake-indexeddb + Temporal).

- [ ] **Step 4: Verify the board still resolves storage and is green**

Run: `pnpm typecheck && pnpm test`
Expected: no typecheck errors; the full suite passes. The board's `@/storage/model/*` imports now resolve through the redirect; client tests that imported storage (e.g. `board-storage.test.ts`) still pass.

- [ ] **Step 5: Commit**

```bash
git add -A
git commit -m "refactor(widgets): move storage into widget-runtime"
```

---

## Task 3: Move `widget-api` into `widget-runtime`

**Files:**
- Move: `client/src/widget-api/widget-api.ts` and `client/src/widget-api/widget-api.test.ts` → `widget-runtime/src/widget-api/`
- Modify: `client/vite.config.ts`, `client/tsconfig.json` (add `@/widget-api` redirect)

**Interfaces:**
- Produces: `widget-runtime/widget-api/widget-api` (`makeWidgetApi`, `WidgetApiError`, `MakeWidgetApiOptions`). External imports: `@shared/widgets/contracts`, `errore`, `zod` (all available in the package).

- [ ] **Step 1: Move the files**

```bash
mkdir -p widget-runtime/src/widget-api
git mv client/src/widget-api/widget-api.ts widget-runtime/src/widget-api/widget-api.ts
git mv client/src/widget-api/widget-api.test.ts widget-runtime/src/widget-api/widget-api.test.ts
git rm -r client/src/widget-api
```

No edits needed — the file imports only `@shared/widgets/contracts`, `errore`, and `zod`.

- [ ] **Step 2: Add the board redirect**

`client/vite.config.ts` (above `@`):

```ts
      { find: '@/widget-api', replacement: resolve(__dirname, '../widget-runtime/src/widget-api') },
```

`client/tsconfig.json` `paths`:

```json
      "@/widget-api/*": ["../widget-runtime/src/widget-api/*"],
```

- [ ] **Step 3: Verify**

Run: `pnpm --filter widget-runtime test && pnpm typecheck && pnpm test`
Expected: `widget-api.test.ts` passes under `widget-runtime`; full suite and typecheck green.

- [ ] **Step 4: Commit**

```bash
git add -A
git commit -m "refactor(widgets): move widget-api into widget-runtime"
```

---

## Task 4: Move the timer (server-time) into `widget-runtime`

**Files:**
- Move: `client/src/shared/timer/model/{server-time,http-time,fakes}.ts` and their `*.test.ts` → `widget-runtime/src/timer/`
- Modify: `client/vite.config.ts`, `client/tsconfig.json` (add `@/shared/timer/model` redirect)

**Interfaces:**
- Produces: `widget-runtime/timer/server-time` (`getServerTime`, `createServerTime`, `ServerTime`), `widget-runtime/timer/http-time` (`fetchServerTime`, `TimeError`), `widget-runtime/timer/fakes` (`createFakeTimer`). External imports: `@reatom/core`, `errore`, `zod`.

- [ ] **Step 1: Move the files**

```bash
mkdir -p widget-runtime/src/timer
git mv client/src/shared/timer/model/* widget-runtime/src/timer/
git rm -r client/src/shared/timer
```

The moved files import each other relatively (`./http-time`) and `@reatom/core`/`errore`/`zod` — no edits needed.

- [ ] **Step 2: Add the board redirect**

`client/vite.config.ts` (above `@`):

```ts
      { find: '@/shared/timer/model', replacement: resolve(__dirname, '../widget-runtime/src/timer') },
```

`client/tsconfig.json` `paths`:

```json
      "@/shared/timer/model/*": ["../widget-runtime/src/timer/*"],
```

- [ ] **Step 3: Verify**

Run: `pnpm --filter widget-runtime test && pnpm typecheck && pnpm test`
Expected: timer tests pass under `widget-runtime`; full suite + typecheck green (the board's server-time consumers — e.g. theme/clock — resolve through the redirect).

- [ ] **Step 4: Commit**

```bash
git add -A
git commit -m "refactor(widgets): move server-time into widget-runtime"
```

---

## Task 5: Move tier + the runtime contract types into `widget-runtime`

**Files:**
- Move: `client/src/widget-host/model/tier.ts`, `client/src/widget-host/model/tier.test.ts` → `widget-runtime/src/tier.ts`, `widget-runtime/src/tier.test.ts`
- Move: `client/src/widget-host/model/types.ts` → `widget-runtime/src/types.ts`
- Create: `widget-runtime/src/theme.ts`
- Modify: `widget-runtime/src/types.ts` (rewrite import block), `client/src/shared/theme/types.ts` (re-export `ResolvedTheme`), `client/vite.config.ts`, `client/tsconfig.json`

**Interfaces:**
- Consumes: `widget-runtime/storage/storage` (`WidgetStorage`), `widget-runtime/widget-api/widget-api` (`WidgetApiError`) from Tasks 2–3.
- Produces: `widget-runtime/tier` (`WidgetTier`, `TierConfig`, tier resolution helpers), `widget-runtime/types` (`WidgetRuntimeProps`, `WidgetComponent`, `WidgetComponentModule`, `WidgetLoader`, `WidgetMode`), `widget-runtime/theme` (`ResolvedTheme`).

- [ ] **Step 1: Move tier and the contract types**

```bash
git mv client/src/widget-host/model/tier.ts widget-runtime/src/tier.ts
git mv client/src/widget-host/model/tier.test.ts widget-runtime/src/tier.test.ts
git mv client/src/widget-host/model/types.ts widget-runtime/src/types.ts
```

(`tier.ts` has no imports, so it moves clean. `widget-host/model/` keeps `widget-frame-model.ts`, which stays in the board.)

- [ ] **Step 2: Create `widget-runtime/src/theme.ts`**

```ts
/** What actually gets applied and sent to widgets. */
export type ResolvedTheme = 'light' | 'dark'
```

- [ ] **Step 3: Rewrite the import block of `widget-runtime/src/types.ts`**

Replace the four leading import lines (the `@shared`, `@/shared/theme/types`, `@/storage/...`, `@/widget-api/...`, `./tier` imports) with package-internal paths. The body (the `export type ...` declarations) is unchanged:

```ts
import type { WidgetApi, WidgetEventMap } from '@shared/widgets/contracts'
import type { ComponentType } from 'react'

import { WidgetStorage } from './storage/storage'
import type { WidgetApiError } from './widget-api/widget-api'
import type { ResolvedTheme } from './theme'
import type { WidgetTier } from './tier'
```

- [ ] **Step 4: Point the board's theme types at the runtime copy of `ResolvedTheme`**

Edit `client/src/shared/theme/types.ts` so `ResolvedTheme` has a single definition (in `widget-runtime`) while `ThemeMode` stays board-local:

```ts
/** What the user picks. */
export type ThemeMode = 'light' | 'dark' | 'system'

export type { ResolvedTheme } from 'widget-runtime/theme'
```

- [ ] **Step 5: Add the board redirects for tier and types**

`client/vite.config.ts` (above `@`):

```ts
      { find: '@/widget-host/model/tier', replacement: resolve(__dirname, '../widget-runtime/src/tier') },
      { find: '@/widget-host/model/types', replacement: resolve(__dirname, '../widget-runtime/src/types') },
```

`client/tsconfig.json` `paths`:

```json
      "@/widget-host/model/tier": ["../widget-runtime/src/tier"],
      "@/widget-host/model/types": ["../widget-runtime/src/types"],
```

- [ ] **Step 6: Verify**

Run: `pnpm --filter widget-runtime test && pnpm typecheck && pnpm test`
Expected: `tier.test.ts` passes under `widget-runtime`; the many board files importing `@/widget-host/model/types` (Board, WidgetFrame, FullscreenOverlay, etc.) resolve through the redirect; full suite + typecheck green.

- [ ] **Step 7: Commit**

```bash
git add -A
git commit -m "refactor(widgets): move tier and runtime contract types into widget-runtime"
```

---

## Task 6: Move the reatom React glue into `widget-sdk`

**Files:**
- Move: `client/src/shared/reatom/{reatom-memo.ts,reatom-memo.test.tsx,use-atom-value.ts}` → `widget-sdk/src/reatom/`
- Modify: `client/vite.config.ts`, `client/tsconfig.json` (add `@/shared/reatom` redirect)

**Interfaces:**
- Produces: `widget-sdk/reatom/reatom-memo` (`reatomMemo`), `widget-sdk/reatom/use-atom-value` (`useAtomValue`). External imports: `@reatom/core`, `@reatom/react`, `react`.

- [ ] **Step 1: Move the files**

```bash
mkdir -p widget-sdk/src/reatom
git mv client/src/shared/reatom/* widget-sdk/src/reatom/
git rm -r client/src/shared/reatom
```

No edits needed — the files import only `@reatom/core`, `@reatom/react`, and `react`.

- [ ] **Step 2: Add the board redirect**

`client/vite.config.ts` (above `@`):

```ts
      { find: '@/shared/reatom', replacement: resolve(__dirname, '../widget-sdk/src/reatom') },
```

`client/tsconfig.json` `paths`:

```json
      "@/shared/reatom/*": ["../widget-sdk/src/reatom/*"],
```

- [ ] **Step 3: Verify (this is the highest-fan-out move — the redirect must catch every `reatomMemo` import)**

Run: `pnpm --filter widget-sdk test && pnpm typecheck && pnpm test`
Expected: `reatom-memo.test.tsx` passes under `widget-sdk`; every board component (all wrapped with `reatomMemo` via the redirect) typechecks and tests pass.

- [ ] **Step 4: Commit**

```bash
git add -A
git commit -m "refactor(widgets): move reatomMemo/useAtomValue into widget-sdk"
```

---

## Task 7: Move `cn`, `tabs`, and `WidgetControls` into `widget-sdk`

**Files:**
- Move: `client/src/lib/utils.ts` → `widget-sdk/src/lib/utils.ts`
- Move: `client/src/components/ui/tabs.tsx` → `widget-sdk/src/ui/tabs.tsx`
- Move: `client/src/widget-host/ui/{WidgetControls.tsx,WidgetControls.module.css,WidgetControls.test.tsx}` → `widget-sdk/src/ui/`
- Modify: the three moved files' import lines; `client/vite.config.ts`; `client/tsconfig.json`

**Interfaces:**
- Consumes: `widget-sdk/reatom/reatom-memo` from Task 6.
- Produces: `widget-sdk/lib/utils` (`cn`), `widget-sdk/ui/tabs` (`Tabs`, `TabsList`, `TabsTrigger`, `TabsContent`), `widget-sdk/ui/WidgetControls` (`WidgetControls`).

- [ ] **Step 1: Move the files**

```bash
mkdir -p widget-sdk/src/lib widget-sdk/src/ui
git mv client/src/lib/utils.ts widget-sdk/src/lib/utils.ts
git mv client/src/components/ui/tabs.tsx widget-sdk/src/ui/tabs.tsx
git mv client/src/widget-host/ui/WidgetControls.tsx widget-sdk/src/ui/WidgetControls.tsx
git mv client/src/widget-host/ui/WidgetControls.module.css widget-sdk/src/ui/WidgetControls.module.css
git mv client/src/widget-host/ui/WidgetControls.test.tsx widget-sdk/src/ui/WidgetControls.test.tsx
```

- [ ] **Step 2: Rewrite imports inside the moved files to package-internal paths**

In `widget-sdk/src/ui/tabs.tsx`, change the two aliased imports:

```ts
import { cn } from '../lib/utils'
import { reatomMemo } from '../reatom/reatom-memo'
```

In `widget-sdk/src/ui/WidgetControls.tsx`, change:

```ts
import { reatomMemo } from '../reatom/reatom-memo'
```

(`widget-sdk/src/lib/utils.ts` imports only `clsx` and `tailwind-merge` — no edit.)

- [ ] **Step 3: Add the board redirects**

`client/vite.config.ts` (above `@`):

```ts
      { find: '@/lib/utils', replacement: resolve(__dirname, '../widget-sdk/src/lib/utils') },
      { find: '@/components/ui/tabs', replacement: resolve(__dirname, '../widget-sdk/src/ui/tabs') },
      { find: '@/widget-host/ui/WidgetControls', replacement: resolve(__dirname, '../widget-sdk/src/ui/WidgetControls') },
```

`client/tsconfig.json` `paths`:

```json
      "@/lib/utils": ["../widget-sdk/src/lib/utils"],
      "@/components/ui/tabs": ["../widget-sdk/src/ui/tabs"],
      "@/widget-host/ui/WidgetControls": ["../widget-sdk/src/ui/WidgetControls"],
```

- [ ] **Step 4: Verify**

Run: `pnpm --filter widget-sdk test && pnpm typecheck && pnpm test`
Expected: `WidgetControls.test.tsx` passes under `widget-sdk`; every board file importing `cn` (all `components/ui/*` use it) resolves via the redirect; full suite + typecheck green.

- [ ] **Step 5: Commit**

```bash
git add -A
git commit -m "refactor(widgets): move cn, tabs, and WidgetControls into widget-sdk"
```

---

## Task 8: Move `defineWidgetClient` into `widget-sdk`

**Files:**
- Move: `client/src/widget-registry/model/widget-definition.ts`, `client/src/widget-registry/model/widget-definition.test.ts` → `widget-sdk/src/define-widget-client.ts`, `widget-sdk/src/define-widget-client.test.ts`
- Modify: the moved file's import block; `client/vite.config.ts`; `client/tsconfig.json`

**Interfaces:**
- Consumes: `widget-runtime/tier` (`TierConfig`), `widget-runtime/types` (`WidgetComponentModule`, `WidgetLoader`) from Task 5.
- Produces: `widget-sdk/define-widget-client` (`defineWidgetClient`, `toWidgetType`, `WidgetType`, `WidgetMetadata`, `WidgetClientDefinition`, `WidgetIconName`).

- [ ] **Step 1: Move the files**

```bash
git mv client/src/widget-registry/model/widget-definition.ts widget-sdk/src/define-widget-client.ts
git mv client/src/widget-registry/model/widget-definition.test.ts widget-sdk/src/define-widget-client.test.ts
```

- [ ] **Step 2: Rewrite the import block of `widget-sdk/src/define-widget-client.ts`**

Replace the `@/widget-host/model/tier` and `@/widget-host/model/types` imports with cross-package paths (the `@shared/widgets/contracts` import is unchanged):

```ts
import type { WidgetEventMap } from '@shared/widgets/contracts'

import type { TierConfig } from 'widget-runtime/tier'
import type { WidgetComponentModule, WidgetLoader } from 'widget-runtime/types'
```

- [ ] **Step 3: Update the test file's import if it referenced the old path**

In `widget-sdk/src/define-widget-client.test.ts`, change any `from './widget-definition'` to `from './define-widget-client'`, and any `@/widget-host/...` imports to the `widget-runtime/...` equivalents.

- [ ] **Step 4: Add the board redirect**

`client/vite.config.ts` (above `@`):

```ts
      { find: '@/widget-registry/model/widget-definition', replacement: resolve(__dirname, '../widget-sdk/src/define-widget-client') },
```

`client/tsconfig.json` `paths`:

```json
      "@/widget-registry/model/widget-definition": ["../widget-sdk/src/define-widget-client"],
```

- [ ] **Step 5: Verify**

Run: `pnpm --filter widget-sdk test && pnpm typecheck && pnpm test`
Expected: `define-widget-client.test.ts` passes; `client/src/widget-registry/model/registry.ts` (which re-exports `WidgetType`/`WidgetIconName` and calls `toWidgetType`) resolves via the redirect; full suite + typecheck green.

- [ ] **Step 6: Commit**

```bash
git add -A
git commit -m "refactor(widgets): move defineWidgetClient into widget-sdk"
```

---

## Task 9: Add the shared dev Vite config factory to `widget-sdk`

**Files:**
- Create: `widget-sdk/src/vite-dev-config.ts`
- Modify: `client/vite.config.ts` (use the factory for the `/api` proxy)

**Interfaces:**
- Produces: `widget-sdk/vite-dev-config` exporting `apiProxy()` returning the `/api` proxy config object used by both the board and (in Plan 2) every widget dev server.

- [ ] **Step 1: Write the failing test**

Create `widget-sdk/src/vite-dev-config.test.ts`:

```ts
import { describe, expect, it } from 'vitest'

import { apiProxy } from './vite-dev-config'

describe('apiProxy', () => {
  it('defaults to the local storage server and rewrites origin', () => {
    const proxy = apiProxy()
    expect(proxy['/api']).toMatchObject({
      target: 'http://localhost:8787',
      changeOrigin: true,
    })
  })

  it('honours VITE_API_PROXY override', () => {
    const proxy = apiProxy('http://example.test:9000')
    expect(proxy['/api'].target).toBe('http://example.test:9000')
  })
})
```

- [ ] **Step 2: Run it to confirm it fails**

Run: `pnpm --filter widget-sdk test vite-dev-config`
Expected: FAIL — `Cannot find module './vite-dev-config'`.

- [ ] **Step 3: Implement `widget-sdk/src/vite-dev-config.ts`**

```ts
/** Proxy config so a widget dev server (own port) reaches the storage API same-origin. */
export function apiProxy(target = process.env.VITE_API_PROXY ?? 'http://localhost:8787') {
  return {
    '/api': {
      target,
      changeOrigin: true,
    },
  }
}
```

- [ ] **Step 4: Run the test to confirm it passes**

Run: `pnpm --filter widget-sdk test vite-dev-config`
Expected: PASS (both cases).

- [ ] **Step 5: Adopt the factory in the client dev/preview proxy**

In `client/vite.config.ts`, import the factory and replace the two hand-written `/api` proxy objects (`server.proxy` and `preview.proxy`) with `apiProxy()`:

```ts
import { apiProxy } from 'widget-sdk/vite-dev-config'
// ...
  server: {
    watch:
      process.env.CHOKIDAR_USEPOLLING === 'true' ? { usePolling: true, interval: 100 } : undefined,
    proxy: apiProxy(),
  },
  preview: {
    proxy: apiProxy(),
  },
```

- [ ] **Step 6: Verify dev/build still resolve and the suite is green**

Run: `pnpm typecheck && pnpm test && pnpm build`
Expected: typecheck + tests green; `pnpm build` (typecheck + client build) succeeds, proving the client still bundles widgets (via `@widgets`) with the shared proxy factory in place.

- [ ] **Step 7: Commit**

```bash
git add -A
git commit -m "feat(widgets): add shared dev Vite config factory in widget-sdk"
```

---

## Task 10: Repoint `widgets/*` imports to the new packages

**Files:**
- Modify: every file under `widgets/clock/**` and `widgets/ofelia-poop-duty/**` that imports `@/...` (source and tests)
- Modify: `widgets/package.json` (declare the package deps)

**Interfaces:**
- Consumes: every `widget-runtime/*` and `widget-sdk/*` entrypoint produced in Tasks 2–9.
- Produces: a `widgets/` tree with **no `@/...` imports** (only `@shared/...` and the two new packages).

- [ ] **Step 1: Apply the import remap from the File Structure table**

Replace each specifier across `widgets/`. Exact mapping:

```text
@/storage/model/storage                  -> widget-runtime/storage/storage
@/storage/model/types                    -> widget-runtime/storage/types
@/storage/model/reatom/reatom-storage    -> widget-runtime/storage/reatom/reatom-storage
@/storage/model/test/fakes               -> widget-runtime/storage/test/fakes
@/shared/timer/model/server-time         -> widget-runtime/timer/server-time
@/shared/timer/model/fakes               -> widget-runtime/timer/fakes
@/widget-host/model/tier                 -> widget-runtime/tier
@/widget-host/model/types                -> widget-runtime/types
@/shared/reatom/reatom-memo              -> widget-sdk/reatom/reatom-memo
@/shared/reatom/use-atom-value           -> widget-sdk/reatom/use-atom-value
@/widget-registry/model/widget-definition -> widget-sdk/define-widget-client
@/components/ui/tabs                      -> widget-sdk/ui/tabs
@/widget-host/ui/WidgetControls          -> widget-sdk/ui/WidgetControls
```

Leave `@shared/widgets/contracts` untouched.

- [ ] **Step 2: Declare the package deps in `widgets/package.json`**

Add to `dependencies` (so the workspace links them; versions resolve to the workspace copies):

```json
    "widget-runtime": "workspace:*",
    "widget-sdk": "workspace:*",
```

- [ ] **Step 3: Confirm no `@/` imports remain under `widgets/`**

Run: `git grep -n "from '@/" -- widgets/`
Expected: no output (empty result).

- [ ] **Step 4: Verify the full suite, typecheck, and build**

Run: `pnpm install && pnpm typecheck && pnpm test && pnpm build`
Expected: all green. Widget tests still execute under the client vitest (`../widgets/**` include) and resolve the new package names via the client's `widget-runtime`/`widget-sdk` base aliases; the client build still bundles widgets via `@widgets`.

- [ ] **Step 5: Commit**

```bash
git add -A
git commit -m "refactor(widgets): import widget-runtime/widget-sdk packages instead of @/ board paths"
```

---

## Task 11: Full-stack verification and dead-directory cleanup

**Files:**
- Delete: any now-empty board directories left behind (`client/src/components/ui/` only if `tabs.tsx` was its last member — verify first; it is not, so it stays)
- Verify only; no functional changes

**Interfaces:**
- Consumes: everything from Tasks 1–10.

- [ ] **Step 1: Remove genuinely empty leftover directories**

Run: `git status --porcelain` and `find client/src -type d -empty`
Delete only directories that are now empty (e.g. `client/src/storage`, `client/src/widget-api`, `client/src/shared/timer`, `client/src/shared/reatom` were removed via `git rm -r` already; confirm none linger). Do **not** remove `client/src/components/ui/` — it still holds `button.tsx`, `dialog.tsx`, etc.

- [ ] **Step 2: Run the complete verification matrix**

Run each and confirm green:

```bash
pnpm install
pnpm typecheck
pnpm --filter widget-runtime test
pnpm --filter widget-sdk test
pnpm test
pnpm build
pnpm test:e2e
```

Expected: install clean; typecheck no errors; both package suites pass; full `pnpm -r test` passes; `pnpm build` succeeds; Playwright e2e passes (proves the running app — board + bundled widgets + storage/SSE — behaves exactly as before).

- [ ] **Step 3: Sanity-check the boundary**

Run: `git grep -n "from '@/" -- widgets/` (expect empty) and confirm `widget-runtime/src` has no import of `widget-sdk`:
Run: `git grep -n "widget-sdk" -- widget-runtime/src/`
Expected: both empty — confirms the one-way `widget-sdk → widget-runtime` dependency with no cycle.

- [ ] **Step 4: Commit any cleanup**

```bash
git add -A
git commit -m "chore(widgets): remove empty board dirs after runtime/sdk extraction"
```

---

## Self-Review

**Spec coverage (Plan 1 scope = Phased Rollout step 2):**
- "Extract `widget-runtime` (storage, widget-api, SSE/BroadcastChannel, server-time, runtime types)" → Tasks 2,3,4,5 (SSE/BroadcastChannel move inside the storage tree in Task 2).
- "Extract `widget-sdk` (reatomMemo, useAtomValue, defineWidgetClient, tier, shared dev Vite config, WidgetControls/Tabs)" → Tasks 6,7,8,9 — **except `tier`**, which is intentionally in `widget-runtime` (architecture note) to avoid a package cycle. Documented deviation, not a gap.
- "Rewrite the `@/` imports in `widgets/*` to point at these packages" → Task 10, verified empty in Tasks 10/11.
- "Refactor with no behavior change" → enforced by the green-suite gate at the end of every task and the full matrix in Task 11.

**Placeholder scan:** No "TBD"/"add error handling"/"similar to" — every move lists exact `git mv` commands, every config/shim/import-rewrite shows full content. The only intentional "fill from the source file" instructions are Step 8/10 of Task 1 (copy the polyfill blocks verbatim from `client/src/vitest.setup.ts`) and the version-pin lookups in Task 1 Steps 3–4 — both point at an exact existing file rather than leaving a value undefined.

**Type consistency:** `WidgetTier`/`TierConfig` consumed in Task 8 are produced in Task 5; `WidgetComponentModule`/`WidgetLoader` consumed in Task 8 produced in Task 5; `WidgetStorage`/`WidgetApiError` consumed by `types.ts` in Task 5 produced in Tasks 2/3; `reatomMemo` consumed by tabs/WidgetControls in Task 7 produced in Task 6; `apiProxy` produced and consumed within Task 9. No cross-task name drift.

---

## Follow-on Plans (to be written after Plan 1 lands)

These are deferred so their concrete config is written against the real, extracted package boundary. Each is its own spec→plan deliverable.

**Plan 2 — Federation + per-widget packages + codegen (Phased Rollout steps 3–4):**
split `widgets/package.json` into per-widget packages named `widgets-<dir>`; add `@module-federation/vite` to each widget (`exposes: { './ui': ... }`, `base: '/widgets/<id>/'`, `dev.remoteHmr`, shared singletons incl. `strictVersion`) and to the host; build each widget's `dev/` standalone harness from `widget-sdk/vite-dev-config`; write the single `codegen` script (client registry with inlined static metadata, `WidgetIconName` union, server registry, federation manifest) and wire it as a `pre*` step of `dev`/`build`/`dev:server`/`typecheck`/`test`; switch the client registry to a synchronous codegen'd catalog with `loadRemote()` component loaders; add `widgets/.ports.json` assignment; give each widget its own `vitest.config.ts` and remove the `../widgets/**` glob from `client/vite.config.ts`.

**Plan 3 — Production build, deploy, PWA, docs (Phased Rollout steps 5–6):**
update `pnpm build` to build widgets then client; copy widget `dist/` into the client output before the PWA service worker is generated and add `/widgets/**` to the Workbox precache; reconcile the manual `codeSplitting.groups` with federation `shared`; update Dockerfile + nginx to serve `/widgets/<id>/` and verify the board loads `remoteEntry.js` from the nginx image (not just `vite preview`); re-verify the Pi build timeout; run board e2e against the production-style build plus the standalone-harness smoke test; correct the stale widget-path references in `AGENTS.md`/`CLAUDE.md`.
```
