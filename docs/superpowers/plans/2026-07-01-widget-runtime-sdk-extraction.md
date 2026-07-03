# Widget Runtime + SDK Extraction Implementation Plan (Plan 1 of 3)

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Extract the board-internal code that widgets depend on into two new source-only workspace packages — `widget-runtime` (live-connection singletons) and `widget-sdk` (stateless React glue + UI) — with zero behavior change and all existing tests, typecheck, build, and e2e staying green.

**Architecture:** Both packages are _source-only_ (no build step), consumed through path aliases exactly like the existing `shared` package. Package names stay unscoped (`widget-runtime`, `widget-sdk`); their import aliases are `@widget-runtime/*` and `@widget-sdk/*` — mirroring how the `shared` package is imported via `@shared/*`. **Every** consumer — the board (`client/src`) and the widgets (`widgets/*`) — imports the moved code through those aliases. The `@/` alias is restored to its true meaning: `client/src` and nothing else. There are no redirect aliases pointing `@/...` outside `src`.

**Tech Stack:** pnpm workspaces + catalog, Vite 8 (Rolldown) / Vitest 4, TypeScript (`moduleResolution: bundler`), React 19, `@reatom/core` + `@reatom/react`, Dexie, Zod, errore.

## Global Constraints

- No behavior change. This is a pure refactor; the only acceptance signal is that the **existing** test suite, `pnpm typecheck`, `pnpm build`, and `pnpm test:e2e` all stay green. Do not add features.
- `@/` resolves to `client/src` only. Cross-package imports use `@shared/*` (the `shared` package), `@widget-runtime/*`, or `@widget-sdk/*`. No file may import board internals through anything other than `@/` (and no widget may use `@/` at all — widgets are not part of `client/src`).
- Every exported React function component stays wrapped with `reatomMemo` (project hard rule). Moving `reatomMemo` must not change any call site's wrapping — only the import specifier.
- errore pattern: errors are values (`Error | T` unions, tagged errors), never thrown for control flow. Moved code keeps its existing error handling verbatim.
- The new packages are **source-only**, consumed via aliases — no `tsc`/bundler build step is added for them, mirroring how `shared` is consumed today.
- Shared dependency versions come from the pnpm `catalog` (`catalog:` specifier) wherever a catalog entry exists (`react`, `react-dom`, `@reatom/core`, `zod`, `lucide-react`, `@testing-library/react`, `vitest`, `@types/react`, `@types/react-dom`).
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
      index.ts                  # ← storage.ts renamed → imports as @widget-runtime/storage (no storage/storage)
      types.ts scope.ts validate.ts subscribe-key.ts
      client/{db,dexie-storage,channel}.ts
      server/{http-storage,sse-client}.ts
      reatom/reatom-storage.ts
      test/fakes.ts
    widget-api.ts               # ← client/src/widget-api/widget-api.ts (flat → @widget-runtime/widget-api)
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
    vite-dev-config.ts          # NEW: shared dev Vite config factory (/api proxy + remoteHmr seam)
    lib/utils.ts                # ← client/src/lib/utils.ts (cn)
    ui/
      WidgetControls.tsx + .module.css  # ← client/src/widget-host/ui/WidgetControls.*
      tabs.tsx                  # ← client/src/components/ui/tabs.tsx
```

**Architecture note — why `tier` is in `widget-runtime`, not `widget-sdk`:** the brainstorm placed `tier` in `widget-sdk`, but `WidgetRuntimeProps.tier: WidgetTier` (a runtime contract type) and `define-widget-client` (sdk) both reference `tier`. If `tier` lived in `widget-sdk` while the contract types lived in `widget-runtime`, the two packages would import each other (a cycle). Co-locating `tier` with the contract types in `widget-runtime` keeps the dependency one-way (`widget-sdk → widget-runtime`). `tier` is pure logic with no live state, so this does not affect the singleton boundary. This is the one deviation from the spec's package table and is intentional.

**Import rewrite — applied to BOTH `client/src` and `widgets/`** (each move task does its row, for every consumer, in one substitution):

| Old specifier (in `client/src` and/or `widgets/`)   | New specifier                      |
| --------------------------------------------------- | ---------------------------------- |
| `@/storage/model/storage` (exact)                   | `@widget-runtime/storage`          |
| `@/storage/model/` (prefix, all other subpaths)     | `@widget-runtime/storage/`         |
| `@/widget-api/widget-api` (exact)                   | `@widget-runtime/widget-api`       |
| `@/shared/timer/model/` (prefix)                    | `@widget-runtime/timer/`           |
| `@/widget-host/model/tier` (exact)                  | `@widget-runtime/tier`             |
| `@/widget-host/model/types` (exact)                 | `@widget-runtime/types`            |
| `@/shared/reatom/` (prefix)                         | `@widget-sdk/reatom/`              |
| `@/lib/utils` (exact)                               | `@widget-sdk/lib/utils`            |
| `@/components/ui/tabs` (exact)                      | `@widget-sdk/ui/tabs`              |
| `@/widget-host/ui/WidgetControls` (exact)           | `@widget-sdk/ui/WidgetControls`    |
| `@/widget-registry/model/widget-definition` (exact) | `@widget-sdk/define-widget-client` |

Rows marked **exact** are full-module-specifier replacements (not directory prefixes). This matters in two ways: (1) sibling board files that stay put — `@/widget-host/model/widget-frame-model`, `@/widget-host/ui/WidgetFrame`, etc. — are untouched; (2) the storage barrel and the single-file widget-api map to `@widget-runtime/storage` and `@widget-runtime/widget-api` with **no `storage/storage` or `widget-api/widget-api` duplication**. Apply the exact storage-barrel replacement _before_ the `@/storage/model/` prefix rule so the barrel doesn't pick up a trailing `/storage`.

**Aliases added once (Task 1):** `@widget-runtime/*` → `../widget-runtime/src/*` and `@widget-sdk/*` → `../widget-sdk/src/*`, in `client/vite.config.ts` (covers vite + vitest), `client/tsconfig.json`, and each new package's own `tsconfig.json` + `vitest.config.ts`. The `@` / `@shared` / `@widgets` aliases keep their current meaning.

---

## Task 1: Scaffold both packages and the two package aliases

**Files:**

- Create: `widget-runtime/package.json`, `widget-runtime/tsconfig.json`, `widget-runtime/vitest.config.ts`, `widget-runtime/vitest.setup.ts`, `widget-runtime/src/.gitkeep`
- Create: `widget-sdk/package.json`, `widget-sdk/tsconfig.json`, `widget-sdk/vitest.config.ts`, `widget-sdk/vitest.setup.ts`, `widget-sdk/src/.gitkeep`
- Modify: `pnpm-workspace.yaml`, `client/vite.config.ts`, `client/tsconfig.json`, `client/package.json`, `widgets/package.json`

**Interfaces:**

- Produces: workspace packages `widget-runtime` and `widget-sdk`; aliases `@widget-runtime/*` → `../widget-runtime/src/*`, `@widget-sdk/*` → `../widget-sdk/src/*` resolvable from the client (vite + tsc + vitest) and from the packages themselves.

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
      "@widget-runtime/*": ["./src/*"]
    }
  },
  "include": ["src"]
}
```

- [ ] **Step 6: Write `widget-sdk/tsconfig.json`** (adds the cross-package alias to `@widget-runtime`)

```json
{
  "compilerOptions": {
    "target": "ESNext",
    "lib": ["ES2023", "ESNext", "DOM", "DOM.Iterable"],
    "module": "ESNext",
    "moduleResolution": "bundler",
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
      "@widget-runtime/*": ["../widget-runtime/src/*"],
      "@widget-sdk/*": ["./src/*"]
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
      '@widget-runtime': path.resolve(import.meta.dirname, './src'),
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
      '@widget-runtime': path.resolve(import.meta.dirname, '../widget-runtime/src'),
      '@widget-sdk': path.resolve(import.meta.dirname, './src'),
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

- [ ] **Step 11: Add the two aliases to the client (vite + tsc)**

In `client/vite.config.ts`, add to `resolve.alias` (object form is fine — these keys never collide with `@`, `@shared`, `@widgets`, since none is a prefix of another up to a `/` boundary):

```ts
  resolve: {
    alias: {
      '@': resolve(__dirname, './src'),
      '@shared': resolve(__dirname, '../shared'),
      '@widgets': resolve(__dirname, '../widgets'),
      '@widget-runtime': resolve(__dirname, '../widget-runtime/src'),
      '@widget-sdk': resolve(__dirname, '../widget-sdk/src'),
    },
  },
```

In `client/tsconfig.json`, add to `paths`:

```json
      "@widget-runtime/*": ["../widget-runtime/src/*"],
      "@widget-sdk/*": ["../widget-sdk/src/*"]
```

- [ ] **Step 12: Declare the workspace deps on the consumers**

Add to BOTH `client/package.json` and `widgets/package.json` `dependencies`:

```json
    "widget-runtime": "workspace:*",
    "widget-sdk": "workspace:*",
```

- [ ] **Step 13: Install and verify nothing regressed**

Run: `pnpm install && pnpm typecheck && pnpm test`
Expected: install links the two new workspace packages; typecheck no errors; all tests pass. Nothing imports the new packages yet, so this only proves the scaffold is inert.

- [ ] **Step 14: Commit**

```bash
git add pnpm-workspace.yaml widget-runtime widget-sdk client/vite.config.ts client/tsconfig.json client/package.json widgets/package.json pnpm-lock.yaml
git commit -m "feat(widgets): scaffold widget-runtime and widget-sdk packages"
```

---

## Task 2: Move the storage tree into `widget-runtime`

**Files:**

- Move: `client/src/storage/model/**` → `widget-runtime/src/storage/**` (every file, including `*.test.ts`)
- Modify: every file under `client/src/**` and `widgets/**` importing `@/storage/model/...`

**Interfaces:**

- Consumes: aliases from Task 1.
- Produces: `@widget-runtime/storage` (`makeWidgetStorage`, `WidgetStorage` — the directory barrel), `@widget-runtime/storage/types` (`StorageApi`, `StorageListener`), `@widget-runtime/storage/reatom/reatom-storage`, `@widget-runtime/storage/test/fakes`. The storage tree's only external import is `@shared/storage/scope` (aliased in the package configs).

- [ ] **Step 1: Move the whole tree (preserves git history and co-located tests) and rename the barrel**

```bash
mkdir -p widget-runtime/src/storage
git mv client/src/storage/model/* widget-runtime/src/storage/
git rm -r client/src/storage
# rename the barrel so it imports as @widget-runtime/storage, not @widget-runtime/storage/storage
git mv widget-runtime/src/storage/storage.ts widget-runtime/src/storage/index.ts
```

The only internal reference to the renamed barrel is its own test. Edit `widget-runtime/src/storage/storage.test.ts`: change `import { makeWidgetStorage } from './storage'` to `from './index'`. No other moved file imports the barrel relatively (the barrel's own imports of its siblings — `./client/dexie-storage`, `./scope`, etc. — are unaffected by the rename since it stays in the same directory); the tree's only alias import is `@shared/storage/scope`, which `widget-runtime` aliases.

- [ ] **Step 2: Rewrite every consumer's import specifier (exact barrel first, then the prefix)**

Find all sites: `git grep -l "@/storage/model" -- client/src widgets`. Apply, in order:

1. exact: `@/storage/model/storage` → `@widget-runtime/storage`
2. prefix (everything else): `@/storage/model/` → `@widget-runtime/storage/` (e.g. `@/storage/model/types` → `@widget-runtime/storage/types`; `@/storage/model/reatom/reatom-storage` → `@widget-runtime/storage/reatom/reatom-storage`; `@/storage/model/test/fakes` → `@widget-runtime/storage/test/fakes`)

- [ ] **Step 3: Confirm no stale references remain**

Run: `git grep -n "@/storage/model" -- client/src widgets`
Expected: empty.

- [ ] **Step 4: Run the moved tests and the full suite**

Run: `pnpm --filter widget-runtime test && pnpm typecheck && pnpm test`
Expected: the storage suite runs and passes under `widget-runtime`'s vitest (jsdom + polyfills + fake-indexeddb + Temporal); board typecheck + full suite green.

- [ ] **Step 5: Commit**

```bash
git add -A
git commit -m "refactor(widgets): move storage into widget-runtime"
```

---

## Task 3: Move `widget-api` into `widget-runtime`

**Files:**

- Move: `client/src/widget-api/{widget-api.ts,widget-api.test.ts}` → `widget-runtime/src/widget-api/`
- Modify: every consumer importing `@/widget-api/...`

**Interfaces:**

- Produces: `@widget-runtime/widget-api` (`makeWidgetApi`, `WidgetApiError`, `MakeWidgetApiOptions` — a single flat module, no `widget-api/widget-api`). External imports: `@shared/widgets/contracts`, `errore`, `zod`.

- [ ] **Step 1: Move the file flat (it is a single module, so no `widget-api/` directory)**

```bash
git mv client/src/widget-api/widget-api.ts widget-runtime/src/widget-api.ts
git mv client/src/widget-api/widget-api.test.ts widget-runtime/src/widget-api.test.ts
git rm -r client/src/widget-api
```

No edits to the moved file — it imports only `@shared/widgets/contracts`, `errore`, `zod`.

- [ ] **Step 2: Rewrite consumers (exact module)**

Find: `git grep -l "@/widget-api" -- client/src widgets`
Replace exact `@/widget-api/widget-api` → `@widget-runtime/widget-api`. Then confirm empty: `git grep -n "@/widget-api" -- client/src widgets`.

- [ ] **Step 3: Verify**

Run: `pnpm --filter widget-runtime test && pnpm typecheck && pnpm test`
Expected: `widget-api.test.ts` passes under `widget-runtime`; full suite + typecheck green.

- [ ] **Step 4: Commit**

```bash
git add -A
git commit -m "refactor(widgets): move widget-api into widget-runtime"
```

---

## Task 4: Move the timer (server-time) into `widget-runtime`

**Files:**

- Move: `client/src/shared/timer/model/*` → `widget-runtime/src/timer/`
- Modify: every consumer importing `@/shared/timer/model/...`

**Interfaces:**

- Produces: `@widget-runtime/timer/server-time` (`getServerTime`, `createServerTime`, `ServerTime`), `@widget-runtime/timer/http-time`, `@widget-runtime/timer/fakes` (`createFakeTimer`). External imports: `@reatom/core`, `errore`, `zod`.

- [ ] **Step 1: Move the files**

```bash
mkdir -p widget-runtime/src/timer
git mv client/src/shared/timer/model/* widget-runtime/src/timer/
git rm -r client/src/shared/timer
```

The moved files import each other relatively (`./http-time`) and `@reatom/core`/`errore`/`zod` — no edits.

- [ ] **Step 2: Rewrite consumers**

Find: `git grep -l "@/shared/timer/model" -- client/src widgets`
Replace prefix `@/shared/timer/model/` with `@widget-runtime/timer/`. Confirm empty: `git grep -n "@/shared/timer/model" -- client/src widgets`.

- [ ] **Step 3: Verify**

Run: `pnpm --filter widget-runtime test && pnpm typecheck && pnpm test`
Expected: timer tests pass under `widget-runtime`; full suite + typecheck green.

- [ ] **Step 4: Commit**

```bash
git add -A
git commit -m "refactor(widgets): move server-time into widget-runtime"
```

---

## Task 5: Move tier + the runtime contract types into `widget-runtime`

**Files:**

- Move: `client/src/widget-host/model/{tier.ts,tier.test.ts}` → `widget-runtime/src/{tier.ts,tier.test.ts}`
- Move: `client/src/widget-host/model/types.ts` → `widget-runtime/src/types.ts`
- Create: `widget-runtime/src/theme.ts`
- Modify: `widget-runtime/src/types.ts` (import block); `client/src/shared/theme/types.ts`; every consumer of `@/widget-host/model/tier` and `@/widget-host/model/types`

**Interfaces:**

- Consumes: `@widget-runtime/storage` (`WidgetStorage`), `@widget-runtime/widget-api` (`WidgetApiError`) from Tasks 2–3.
- Produces: `@widget-runtime/tier` (`WidgetTier`, `TierConfig`, tier helpers), `@widget-runtime/types` (`WidgetRuntimeProps`, `WidgetComponent`, `WidgetComponentModule`, `WidgetLoader`, `WidgetMode`), `@widget-runtime/theme` (`ResolvedTheme`).

- [ ] **Step 1: Move tier and the contract types**

```bash
git mv client/src/widget-host/model/tier.ts widget-runtime/src/tier.ts
git mv client/src/widget-host/model/tier.test.ts widget-runtime/src/tier.test.ts
git mv client/src/widget-host/model/types.ts widget-runtime/src/types.ts
```

(`widget-host/model/` keeps `widget-frame-model.ts`, which stays in the board.)

- [ ] **Step 2: Create `widget-runtime/src/theme.ts`**

```ts
/** What actually gets applied and sent to widgets. */
export type ResolvedTheme = 'light' | 'dark'
```

- [ ] **Step 3: Rewrite the import block of `widget-runtime/src/types.ts`** (body of `export type` declarations unchanged)

```ts
import type { WidgetApi, WidgetEventMap } from '@shared/widgets/contracts'
import type { ComponentType } from 'react'

import { WidgetStorage } from './storage'
import type { WidgetApiError } from './widget-api'
import type { ResolvedTheme } from './theme'
import type { WidgetTier } from './tier'
```

- [ ] **Step 4: Point the board's theme types at the runtime copy of `ResolvedTheme`**

Edit `client/src/shared/theme/types.ts` so `ResolvedTheme` has a single definition (in `widget-runtime`) while `ThemeMode` stays board-local:

```ts
/** What the user picks. */
export type ThemeMode = 'light' | 'dark' | 'system'

export type { ResolvedTheme } from '@widget-runtime/theme'
```

- [ ] **Step 5: Rewrite consumers of tier and types (exact-module, not prefix)**

Find: `git grep -l "@/widget-host/model/tier\|@/widget-host/model/types" -- client/src widgets`
Replace `@/widget-host/model/tier` → `@widget-runtime/tier` and `@/widget-host/model/types` → `@widget-runtime/types`. Do **not** touch `@/widget-host/model/widget-frame-model`. Confirm: `git grep -n "@/widget-host/model/tier\b\|@/widget-host/model/types\b" -- client/src widgets` is empty.

- [ ] **Step 6: Verify**

Run: `pnpm --filter widget-runtime test && pnpm typecheck && pnpm test`
Expected: `tier.test.ts` passes under `widget-runtime`; Board/WidgetFrame/FullscreenOverlay and other consumers of the contract types compile against `@widget-runtime/types`; full suite + typecheck green.

- [ ] **Step 7: Commit**

```bash
git add -A
git commit -m "refactor(widgets): move tier and runtime contract types into widget-runtime"
```

---

## Task 6: Move the reatom React glue into `widget-sdk`

**Files:**

- Move: `client/src/shared/reatom/{reatom-memo.ts,reatom-memo.test.tsx,use-atom-value.ts}` → `widget-sdk/src/reatom/`
- Modify: every consumer importing `@/shared/reatom/...`

**Interfaces:**

- Produces: `@widget-sdk/reatom/reatom-memo` (`reatomMemo`), `@widget-sdk/reatom/use-atom-value` (`useAtomValue`). External imports: `@reatom/core`, `@reatom/react`, `react`.

- [ ] **Step 1: Move the files**

```bash
mkdir -p widget-sdk/src/reatom
git mv client/src/shared/reatom/* widget-sdk/src/reatom/
git rm -r client/src/shared/reatom
```

No edits — the files import only `@reatom/core`, `@reatom/react`, `react`.

- [ ] **Step 2: Rewrite consumers (this is the highest-fan-out move — `reatomMemo` is imported by nearly every component)**

Find: `git grep -l "@/shared/reatom" -- client/src widgets`
Replace prefix `@/shared/reatom/` with `@widget-sdk/reatom/`. Confirm empty: `git grep -n "@/shared/reatom" -- client/src widgets`.

- [ ] **Step 3: Verify**

Run: `pnpm --filter widget-sdk test && pnpm typecheck && pnpm test`
Expected: `reatom-memo.test.tsx` passes under `widget-sdk`; every board component (all wrapped with `reatomMemo`) typechecks and tests pass.

- [ ] **Step 4: Commit**

```bash
git add -A
git commit -m "refactor(widgets): move reatomMemo/useAtomValue into widget-sdk"
```

---

## Task 7: Move `cn`, `tabs`, and `WidgetControls` into `widget-sdk`

**Files:**

- Move: `client/src/lib/utils.ts` → `widget-sdk/src/lib/utils.ts`; `client/src/components/ui/tabs.tsx` → `widget-sdk/src/ui/tabs.tsx`; `client/src/widget-host/ui/WidgetControls.{tsx,module.css,test.tsx}` → `widget-sdk/src/ui/`
- Modify: the moved files' import lines; consumers of `@/lib/utils`, `@/components/ui/tabs`, `@/widget-host/ui/WidgetControls`

**Interfaces:**

- Consumes: `@widget-sdk/reatom/reatom-memo` from Task 6.
- Produces: `@widget-sdk/lib/utils` (`cn`), `@widget-sdk/ui/tabs` (`Tabs`, `TabsList`, `TabsTrigger`, `TabsContent`), `@widget-sdk/ui/WidgetControls` (`WidgetControls`).

- [ ] **Step 1: Move the files**

```bash
mkdir -p widget-sdk/src/lib widget-sdk/src/ui
git mv client/src/lib/utils.ts widget-sdk/src/lib/utils.ts
git mv client/src/components/ui/tabs.tsx widget-sdk/src/ui/tabs.tsx
git mv client/src/widget-host/ui/WidgetControls.tsx widget-sdk/src/ui/WidgetControls.tsx
git mv client/src/widget-host/ui/WidgetControls.module.css widget-sdk/src/ui/WidgetControls.module.css
git mv client/src/widget-host/ui/WidgetControls.test.tsx widget-sdk/src/ui/WidgetControls.test.tsx
```

- [ ] **Step 2: Rewrite imports inside the moved files to package-internal relative paths**

`widget-sdk/src/ui/tabs.tsx`:

```ts
import { cn } from '../lib/utils'
import { reatomMemo } from '../reatom/reatom-memo'
```

`widget-sdk/src/ui/WidgetControls.tsx`:

```ts
import { reatomMemo } from '../reatom/reatom-memo'
```

(`widget-sdk/src/lib/utils.ts` imports only `clsx`/`tailwind-merge` — no edit.)

- [ ] **Step 3: Rewrite consumers (exact-module replacements)**

Find: `git grep -l "@/lib/utils\|@/components/ui/tabs\|@/widget-host/ui/WidgetControls" -- client/src widgets`
Replace: `@/lib/utils` → `@widget-sdk/lib/utils`; `@/components/ui/tabs` → `@widget-sdk/ui/tabs`; `@/widget-host/ui/WidgetControls` → `@widget-sdk/ui/WidgetControls`. Note `cn` is used by every `client/src/components/ui/*` primitive — update all of them. Confirm empty afterwards.

- [ ] **Step 4: Verify**

Run: `pnpm --filter widget-sdk test && pnpm typecheck && pnpm test`
Expected: `WidgetControls.test.tsx` passes under `widget-sdk`; all `cn` consumers resolve; full suite + typecheck green.

- [ ] **Step 5: Commit**

```bash
git add -A
git commit -m "refactor(widgets): move cn, tabs, and WidgetControls into widget-sdk"
```

---

## Task 8: Move `defineWidgetClient` into `widget-sdk`

**Files:**

- Move: `client/src/widget-registry/model/widget-definition.ts` → `widget-sdk/src/define-widget-client.ts`; `client/src/widget-registry/model/widget-definition.test.ts` → `widget-sdk/src/define-widget-client.test.ts`
- Modify: the moved files' imports; consumers of `@/widget-registry/model/widget-definition`

**Interfaces:**

- Consumes: `@widget-runtime/tier` (`TierConfig`), `@widget-runtime/types` (`WidgetComponentModule`, `WidgetLoader`) from Task 5.
- Produces: `@widget-sdk/define-widget-client` (`defineWidgetClient`, `toWidgetType`, `WidgetType`, `WidgetMetadata`, `WidgetClientDefinition`, `WidgetIconName`).

- [ ] **Step 1: Move the files**

```bash
git mv client/src/widget-registry/model/widget-definition.ts widget-sdk/src/define-widget-client.ts
git mv client/src/widget-registry/model/widget-definition.test.ts widget-sdk/src/define-widget-client.test.ts
```

- [ ] **Step 2: Rewrite the import block of `widget-sdk/src/define-widget-client.ts`**

```ts
import type { WidgetEventMap } from '@shared/widgets/contracts'

import type { TierConfig } from '@widget-runtime/tier'
import type { WidgetComponentModule, WidgetLoader } from '@widget-runtime/types'
```

- [ ] **Step 3: Fix the test file's self-import**

In `widget-sdk/src/define-widget-client.test.ts`, change `from './widget-definition'` → `from './define-widget-client'`, and any `@/widget-host/...` imports to the `@widget-runtime/...` equivalents.

- [ ] **Step 4: Rewrite consumers**

Find: `git grep -l "@/widget-registry/model/widget-definition" -- client/src widgets`
Replace `@/widget-registry/model/widget-definition` → `@widget-sdk/define-widget-client` (the board's `client/src/widget-registry/model/registry.ts` re-exports `WidgetType`/`WidgetIconName` and calls `toWidgetType`). Confirm empty.

- [ ] **Step 5: Verify**

Run: `pnpm --filter widget-sdk test && pnpm typecheck && pnpm test`
Expected: `define-widget-client.test.ts` passes; registry resolves; full suite + typecheck green.

- [ ] **Step 6: Commit**

```bash
git add -A
git commit -m "refactor(widgets): move defineWidgetClient into widget-sdk"
```

---

## Task 9: Add the shared dev Vite config factory to `widget-sdk`

**Files:**

- Create: `widget-sdk/src/vite-dev-config.ts`, `widget-sdk/src/vite-dev-config.test.ts`
- Modify: `client/vite.config.ts` (use the factory for the `/api` proxy)

**Interfaces:**

- Produces: `@widget-sdk/vite-dev-config` exporting `apiProxy()` returning the `/api` proxy config used by both the board and (in Plan 2) every widget dev server.

- [ ] **Step 1: Write the failing test** — `widget-sdk/src/vite-dev-config.test.ts`

```ts
import { describe, expect, it } from 'vitest'

import { apiProxy } from './vite-dev-config'

describe('apiProxy', () => {
  it('defaults to the local storage server and rewrites origin', () => {
    const proxy = apiProxy()
    expect(proxy['/api']).toMatchObject({ target: 'http://localhost:8787', changeOrigin: true })
  })

  it('honours an explicit target override', () => {
    expect(apiProxy('http://example.test:9000')['/api'].target).toBe('http://example.test:9000')
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
import { apiProxy } from '@widget-sdk/vite-dev-config'
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
Expected: typecheck + tests green; `pnpm build` succeeds, proving the client still bundles widgets (via `@widgets`) with the shared proxy factory in place.

- [ ] **Step 7: Commit**

```bash
git add -A
git commit -m "feat(widgets): add shared dev Vite config factory in widget-sdk"
```

---

## Task 10: Full-stack verification, boundary check, dead-directory cleanup

**Files:**

- Delete: any now-empty board directories left behind
- Verify only; no functional changes

**Interfaces:**

- Consumes: everything from Tasks 1–9.

- [ ] **Step 1: Restore `@/` to "src only" — there must be no `@/` escaping into a package and no `@/` inside widgets**

Run: `git grep -n "from '@/" -- widgets`
Expected: empty (widgets only use `@shared`, `@widget-runtime`, `@widget-sdk`).
Run: `git grep -n "from '@/" -- widget-runtime widget-sdk`
Expected: empty (the packages never import board `src`).

- [ ] **Step 2: Confirm the one-way package dependency (no cycle)**

Run: `git grep -n "@widget-sdk" -- widget-runtime/src`
Expected: empty — `widget-runtime` never imports `widget-sdk`.

- [ ] **Step 3: Remove genuinely empty leftover directories**

Run: `find client/src -type d -empty`
Delete only directories now empty after the moves (e.g. confirm `client/src/storage`, `client/src/widget-api`, `client/src/shared/timer`, `client/src/shared/reatom`, `client/src/lib` if `utils.ts` was its only file). Do **not** remove `client/src/components/ui/` — it still holds `button.tsx`, `dialog.tsx`, etc.

- [ ] **Step 4: Run the complete verification matrix**

```bash
pnpm install
pnpm typecheck
pnpm --filter widget-runtime test
pnpm --filter widget-sdk test
pnpm test
pnpm build
pnpm test:e2e
```

Expected: all green — install clean; typecheck no errors; both package suites pass; full `pnpm -r test` passes; `pnpm build` succeeds; Playwright e2e passes (the running app — board + bundled widgets + storage/SSE — behaves exactly as before).

- [ ] **Step 5: Commit**

```bash
git add -A
git commit -m "chore(widgets): remove empty board dirs after runtime/sdk extraction"
```

---

## Self-Review

**Spec coverage (Plan 1 scope = Phased Rollout step 2):**

- "Extract `widget-runtime` (storage, widget-api, SSE/BroadcastChannel, server-time, runtime types)" → Tasks 2,3,4,5 (SSE/BroadcastChannel move inside the storage tree in Task 2).
- "Extract `widget-sdk` (reatomMemo, useAtomValue, defineWidgetClient, tier, shared dev Vite config, WidgetControls/Tabs)" → Tasks 6,7,8,9 — **except `tier`**, intentionally in `widget-runtime` (architecture note) to avoid a package cycle. Documented deviation, not a gap.
- "Rewrite the `@/` imports in `widgets/*` to point at these packages" → done per-module in Tasks 2–8, verified empty in Task 10.
- "Refactor with no behavior change" → enforced by the green-suite gate ending every task and the full matrix in Task 10.
- User constraint "`@/` only for `client/src`; use `@widget-runtime`/`@widget-sdk` for the packages" → satisfied: no redirect aliases; board and widgets both import via the package aliases; verified in Task 10 Steps 1–2.

**Placeholder scan:** No "TBD"/"add error handling"/"similar to" — every move lists exact `git mv` commands, every config/import-rewrite shows full content. The only "fill from the source file" instructions are Task 1 Steps 8/10 (copy polyfill blocks verbatim from `client/src/vitest.setup.ts`) and the version-pin lookups in Task 1 Steps 3–4 — both point at an exact existing file.

**Type/specifier consistency:** `WidgetTier`/`TierConfig` (Task 5) consumed in Task 8; `WidgetComponentModule`/`WidgetLoader` (Task 5) consumed in Task 8; `WidgetStorage`/`WidgetApiError` (Tasks 2/3) consumed by `types.ts` in Task 5; `reatomMemo` (Task 6) consumed by tabs/WidgetControls in Task 7; `apiProxy` produced+consumed in Task 9. Every alias used in a consumer (`@widget-runtime/*`, `@widget-sdk/*`) is registered in Task 1. No name/alias drift.

---

## Follow-on Plans (to be written after Plan 1 lands)

Deferred so their concrete config is written against the real, extracted package boundary. Each is its own spec→plan deliverable. Both reuse the `@widget-runtime/*` / `@widget-sdk/*` alias convention established here.

**Plan 2 — Federation + per-widget packages + codegen (Phased Rollout steps 3–4):**
split `widgets/package.json` into per-widget packages named `widgets-<dir>`; add `@module-federation/vite` to each widget (`exposes: { './ui': ... }`, `base: '/widgets/<id>/'`, `dev.remoteHmr`, shared singletons incl. `strictVersion`) and to the host; build each widget's `dev/` standalone harness from `@widget-sdk/vite-dev-config`; write the single `codegen` script (client registry with inlined static metadata, `WidgetIconName` union, server registry, federation manifest) and wire it as a `pre*` step of `dev`/`build`/`dev:server`/`typecheck`/`test`; switch the client registry to a synchronous codegen'd catalog with `loadRemote()` component loaders; add `widgets/.ports.json`; give each widget its own `vitest.config.ts` and remove the `../widgets/**` glob from `client/vite.config.ts`.

**Plan 3 — Production build, deploy, PWA, docs (Phased Rollout steps 5–6):**
update `pnpm build` to build widgets then client; copy widget `dist/` into the client output before the PWA service worker is generated and add `/widgets/**` to the Workbox precache; reconcile the manual `codeSplitting.groups` with federation `shared`; update Dockerfile + nginx to serve `/widgets/<id>/` and verify the board loads `remoteEntry.js` from the nginx image (not just `vite preview`); re-verify the Pi build timeout; run board e2e against the production-style build plus the standalone-harness smoke test; correct the stale widget-path references in `AGENTS.md`/`CLAUDE.md`.

```

```
